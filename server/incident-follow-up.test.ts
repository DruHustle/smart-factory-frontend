import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
import { incidentNoteLabel } from "../shared/incidentNotes";
import type { TrpcContext } from "./_core/context";
import * as fixtureBoundary from "./demoTarget";
import * as incidents from "./incidents";
import { appRouter } from "./routers";

function caller(role: User["role"]) {
  const user = {
    id: 42,
    openId: "followup-test",
    email: "engineer@example.test",
    name: "Reviewer",
    loginMethod: "password",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } satisfies User;
  return appRouter.createCaller({
    user,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  });
}

describe("incident follow-up", () => {
  beforeEach(() => {
    vi.spyOn(fixtureBoundary, "rejectFixtureMutation").mockResolvedValue(
      undefined,
    );
    vi.spyOn(incidents, "addIncidentNote").mockResolvedValue({ id: 7 });
  });
  afterEach(() => vi.restoreAllMocks());

  it("preserves category, trimmed text, and authenticated actor", async () => {
    await caller("operator").alerts.addNote({
      id: 12,
      category: "next_step",
      text: "  Inspect the pump  ",
    });
    expect(incidents.addIncidentNote).toHaveBeenCalledWith(
      12,
      "Inspect the pump",
      42,
      "next_step",
    );
  });

  it("accepts legacy clients and rejects invalid or empty updates", async () => {
    await caller("operator").alerts.addNote({
      id: 12,
      text: "Existing client",
    });
    expect(incidents.addIncidentNote).toHaveBeenCalledWith(
      12,
      "Existing client",
      42,
      "note",
    );
    await expect(
      caller("operator").alerts.addNote({ id: 12, text: "  " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("operator").alerts.addNote({ id: 12, text: "bad\u0001data" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("operator").alerts.addNote({
        id: 12,
        text: "Text",
        category: "unknown" as never,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(incidents.addIncidentNote).toHaveBeenCalledTimes(1);
  });

  it("does not let a viewer record follow-up", async () => {
    await expect(
      caller("viewer").alerts.addNote({
        id: 12,
        text: "Text",
        category: "outcome",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(incidents.addIncidentNote).not.toHaveBeenCalled();
  });

  it("renders legacy and unknown categories as review notes", () => {
    expect(incidentNoteLabel("finding")).toBe("Finding");
    expect(incidentNoteLabel("outcome")).toBe("Outcome");
    expect(incidentNoteLabel(undefined)).toBe("Review note");
    expect(incidentNoteLabel("toString")).toBe("Review note");
  });
});
