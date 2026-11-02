// Diagnostic-only: copied to an ephemeral checkout, never to the released app.
type Metric = { category: string; count: number; sumUs: number; maxUs: number };
let metrics: Record<string, Metric> = {};

export function profileRecord(category: string, started: number) {
  const us = Math.max(0, Math.round((performance.now() - started) * 1000));
  const item = metrics[category] ?? { category, count: 0, sumUs: 0, maxUs: 0 };
  item.count++;
  item.sumUs += us;
  item.maxUs = Math.max(item.maxUs, us);
  metrics[category] = item;
}

function flush() {
  const batch = Object.values(metrics);
  metrics = {};
  if (batch.length) console.info("SF_PROFILE_BATCH " + JSON.stringify(batch));
}
setInterval(flush, 500);
window.addEventListener("pagehide", flush);
