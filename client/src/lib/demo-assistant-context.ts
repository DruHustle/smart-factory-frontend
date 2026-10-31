import { latestSandboxSamples, type DemoSandbox } from "@shared/demo-sandbox";
import { demoAssistantContext } from "@shared/demo-assistant";
import { planAssistantConversation } from "@shared/assistant-conversation";

/** Freeze only the relevant bounded simulation snapshot with the submitted turn. */
export function buildDemoAssistantContext(
  s: DemoSandbox | null,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId?: string,
  factoryId?: string,
) {
  const plan = planAssistantConversation(question, history, selectedAssetId);
  if (!s || !plan.includeEvidence) return undefined;
  // The factory picker also initializes a reference copy. Its latest samples
  // cannot replace the server's retained measurements, incidents and models.
  // A selected factory or an edited simulation supplies its own bounded context.
  if (
    !factoryId &&
    s.audit.length === 0 &&
    !s.items.some((item) => item.custom)
  )
    return undefined;
  const factory = factoryId
    ? s.factories.find((f) => f.id === factoryId)
    : null;
  if (factoryId && !factory) return undefined;
  if (factory) {
    const refs = new Set(factory.draft.document.placements.map((p) => p.ref));
    s = {
      ...s,
      settings: { ...s.settings, name: factory.draft.document.name },
      items: s.items.filter((i) => refs.has(i.ref)),
      samples: s.samples.filter((i) => refs.has(i.itemRef)),
      incidents: s.incidents.filter((i) => refs.has(i.itemRef)),
      findings: s.findings.filter((i) => refs.has(i.itemRef)),
    };
  }
  const terms = plan.resolvedQuestion
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const ranked = s.items
    .map((item) => ({
      item,
      score:
        (selectedAssetId &&
        [
          item.ref,
          item.identifier,
          item.equipmentId,
          item.ref.replace(/^asset:/, ""),
        ].includes(selectedAssetId)
          ? 1000
          : 0) +
        terms.filter((t) =>
          `${item.name} ${item.identifier} ${item.itemType}`
            .toLowerCase()
            .includes(t),
        ).length,
    }))
    .sort((a, b) => b.score - a.score);
  const matched = ranked.filter((r) => r.score > 0);
  const chosen = (matched.length ? matched : ranked)
    .slice(0, 24)
    .map(({ item }) => item);
  return demoAssistantContext.parse({
    name: s.settings.name,
    capturedAt: new Date().toISOString(),
    itemCount: s.items.length,
    assetCount: s.items.filter((i) => i.kind !== "device").length,
    deviceCount: s.items.filter((i) => i.kind === "device").length,
    openIncidents: s.incidents.filter((i) => i.status !== "resolved").length,
    scenario: s.scenario,
    items: chosen.map((i) => ({
      ...Object.fromEntries(
        ["ref", "identifier", "name", "itemType", "connected"].map((k) => [
          k,
          i[k as keyof typeof i],
        ]),
      ),
      samples: latestSandboxSamples(s, i.ref)
        .slice(0, 6)
        .map(({ metric, value, unit, at }) => ({ metric, value, unit, at })),
    })),
    incidents: s.incidents
      .slice(-32)
      .map(({ itemRef, message, severity, status, at }) => ({
        itemRef,
        message,
        severity,
        status,
        at,
      })),
    findings: s.findings
      .slice(-32)
      .map(({ itemRef, title, state, decision }) => ({
        itemRef,
        title,
        state,
        decision,
      })),
  });
}
