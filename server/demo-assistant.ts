import type { DemoAssistantContext } from "../shared/demo-assistant";
import { canonicalUnits } from "../shared/measurements";
import { requestedAssistantMetric } from "../shared/assistant-conversation";
export function answerDemoQuestion(
  question: string,
  context: DemoAssistantContext,
) {
  const metric = requestedAssistantMetric(question),
    parts: string[] = [];
  const sources: Array<{
    title: string;
    section: string;
    path: string;
    href: string;
    timestamp?: string;
    excerpt: string;
    kind: "live-data";
  }> = [];
  if (/\b(?:fx|tsn|network|clock|timing)\b/i.test(question))
    parts.push(
      context.scenario === "clock-loss"
        ? "Your browser demo is using the clock-loss scenario. Simulated synchronization is lost, so one-way latency is unavailable."
        : `Your browser demo is using the ${context.scenario} network scenario. These are authored diagnostics; physical network timing remains unverified.`,
    );
  else if (/\b(?:security|cyber|finding|vulnerabilit)\b/i.test(question)) {
    parts.push(
      `Your browser demo has ${context.findings.length} supplied simulated security findings.`,
    );
    parts.push(
      ...context.findings
        .slice(0, 6)
        .map(
          (f) =>
            `- **${context.items.find((i) => i.ref === f.itemRef)?.name ?? "Demo equipment"}**: ${f.title} — ${f.state}${f.decision ? `. Decision: ${f.decision}` : ""}.`,
        ),
    );
  } else if (metric) {
    if (!context.items.length)
      return {
        answer: `Which demo equipment’s ${metric} would you like me to check? Include its name or choose it in the sandbox.`,
        sources,
      };
    for (const item of context.items.slice(0, 4)) {
      const sample = item.samples.find(
        (s) => s.metric === metric && s.unit === canonicalUnits[metric],
      );
      parts.push(
        sample
          ? `**${item.name}** has a simulated ${metric} reading of **${sample.value.toLocaleString("en", { maximumFractionDigits: 2 })} ${sample.unit}**, recorded ${sample.at}.`
          : `There is no verified-unit ${metric} sample for **${item.name}** in the submitted browser demo context.`,
      );
    }
  } else
    parts.push(
      `Your browser demo **${context.name}** contains ${context.itemCount} items (${context.assetCount} assets/equipment and ${context.deviceCount} devices), with ${context.openIncidents} open simulated incidents.`,
    );
  const relevant = new Set(context.items.map((i) => i.ref));
  if (!/\b(?:security|cyber|finding|fx|tsn|network|clock)\b/i.test(question))
    parts.push(
      ...context.incidents
        .filter((i) => i.status !== "resolved" && relevant.has(i.itemRef))
        .slice(0, 4)
        .map(
          (i) =>
            `- **${context.items.find((a) => a.ref === i.itemRef)?.name ?? "Demo equipment"}**: ${i.severity} incident, ${i.status}. ${i.message}`,
        ),
    );
  parts.push(
    "These are user-supplied browser simulation records. Acknowledging an incident does not resolve it, and a simulated reading does not establish a physical cause.",
  );
  sources.push({
    title: "Browser demo workspace",
    section: "User-supplied simulation",
    path: "demo://browser-workspace",
    href: "/sandbox",
    timestamp: context.capturedAt,
    excerpt: `${context.name}: ${context.itemCount} items; ${context.openIncidents} open simulated incidents. Captured for this question; no operational state is inferred.`,
    kind: "live-data",
  });
  for (const item of context.items.slice(0, 4))
    sources.push({
      title: `${item.name} · browser demo`,
      section: "Simulated observations",
      path: `demo://${encodeURIComponent(item.ref)}`,
      href: `/sandbox?tab=telemetry&item=${encodeURIComponent(item.ref)}`,
      excerpt:
        item.samples
          .map(
            (s) => `${s.metric}: ${s.value} ${s.unit} at ${s.at} (simulated)`,
          )
          .join("; ") || "No simulated samples supplied.",
      kind: "live-data",
    });
  return { answer: parts.filter(Boolean).join("\n\n"), sources };
}
