import { describe, expect, it } from "vitest";
import {
  investigationContext,
  assistantInvestigationHref,
  investigationFromSearch,
  investigationKey,
} from "../shared/assistant-investigation";
import {
  selectAssistantInvestigation,
  assistantHistory,
  mayAdoptInferredContext,
} from "../client/src/lib/assistant-history";
import type { AssistantSession } from "../client/src/lib/assistant-session";

describe("investigation handoff", () => {
  const context = {
    assetId: "urn:factory:pump",
    incidentId: 12,
    metric: "vibration" as const,
    scope: "simulated" as const,
    startTime: 1793610000000,
    endTime: 1793613600000,
  };
  it("roundtrips canonical equipment, alarm, metric and time without URL interpolation", () => {
    const href = assistantInvestigationHref(
      context,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(
      investigationFromSearch(new URLSearchParams(href.split("?")[1])),
    ).toEqual({ context });
    expect(href).toContain("factory=");
  });
  it("rejects partial, reversed, oversized and unscoped windows visibly", () => {
    for (const patch of [
      { endTime: undefined },
      { endTime: context.startTime },
      { endTime: context.startTime + 86400001 },
      { assetId: undefined, incidentId: undefined },
    ])
      expect(
        investigationContext.safeParse({ ...context, ...patch }).success,
      ).toBe(false);
    expect(
      investigationFromSearch(new URLSearchParams("incident=1&from=wrong")),
    ).toHaveProperty("error");
    expect(
      investigationFromSearch(new URLSearchParams("asset=urn:only:asset")),
    ).toEqual({});
  });
  it("changes conversation evidence generation when only the window changes", () => {
    const session: AssistantSession = {
      owner: "test",
      generation: 1,
      draft: "",
      selectedAssetId: context.assetId,
      selectedAssetName: "Pump",
      contextRevision: 1,
      selection: { provider: "auto" },
      turns: [],
      selectedTurnId: null,
      scrollTop: 0,
      followLatest: true,
    };
    const first = selectAssistantInvestigation(session, context);
    const second = selectAssistantInvestigation(first, {
      ...context,
      startTime: context.startTime + 1000,
    });
    expect(second.contextRevision).toBeGreaterThan(first.contextRevision);
    expect(
      selectAssistantInvestigation(second, second.investigation)
        .contextRevision,
    ).toBe(second.contextRevision);
    expect(investigationKey(context)).not.toBe(
      investigationKey(second.investigation),
    );
    const handoff = selectAssistantInvestigation(second, {
      scenario: "gateway-outage",
      scope: "simulated",
      startTime: context.startTime,
      endTime: context.endTime,
    });
    expect(handoff.selectedAssetId).toBe("automatic");
    expect(handoff.selectedAssetName).toBeNull();
    expect(
      mayAdoptInferredContext(handoff, {
        contextRevision: handoff.contextRevision,
      } as any),
    ).toBe(false);
    expect(
      investigationContext.safeParse({
        ...handoff.investigation,
        assetId: context.assetId,
      }).success,
    ).toBe(false);
    expect(
      assistantHistory(
        [
          {
            id: "old",
            contextRevision: first.contextRevision,
            question: "old window",
            submittedAt: "",
            context: null,
            request: { question: "old window", history: [] },
            status: "complete",
            result: { answer: "old result", sources: [], contextAt: "" },
          },
        ],
        second.contextRevision,
      ),
    ).toEqual([]);
  });
  it("retains visible earlier turns while excluding them from a new source's request", () => {
    const first = {
      owner: "source-handoff",
      generation: 1,
      draft: "",
      selectedAssetId: "automatic",
      selectedAssetName: null,
      contextRevision: 1,
      selection: { provider: "auto" },
      investigation: {
        deviceId: 1,
        metric: "temperature",
        startTime: context.startTime,
        endTime: context.endTime,
      },
      turns: [
        {
          id: "old",
          contextRevision: 1,
          question: "Source one",
          submittedAt: "",
          context: null,
          request: { question: "Source one", history: [] },
          status: "complete",
          result: { answer: "Source one answer", sources: [], contextAt: "" },
        },
      ],
      selectedTurnId: "old",
      scrollTop: 0,
      followLatest: true,
    } as AssistantSession;
    const second = selectAssistantInvestigation(first, {
      ...first.investigation,
      deviceId: 5,
    });
    expect(second.investigation?.deviceId).toBe(5);
    expect(second.contextRevision).toBe(2);
    expect(second.turns).toHaveLength(1);
    expect(assistantHistory(second.turns, second.contextRevision)).toEqual([]);
  });
});
