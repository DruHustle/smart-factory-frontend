const durations = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};
const intervals = [60_000, 900_000, 3_600_000, 86_400_000];

/** Shareable analysis inputs are UTC; incomplete custom dates stay invalid. */
export function parseAnalysisDate(value: string | null): number {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?$/.test(value)
  )
    return NaN;
  const time = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  // Date.parse otherwise rolls invalid dates such as 30 February into March.
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 16) === value.slice(0, 16)
    ? time
    : NaN;
}

export function analysisRange(
  params: URLSearchParams,
  anchor: number,
  defaultRange: "1h" | "7d",
) {
  const custom =
    params.get("range") === "custom" || params.has("from") || params.has("to");
  const candidate = params.get("range") ?? defaultRange;
  const range = Object.hasOwn(durations, candidate)
    ? (candidate as keyof typeof durations)
    : defaultRange;
  const endTime = custom ? parseAnalysisDate(params.get("to")) : anchor;
  const startTime = custom
    ? parseAnalysisDate(params.get("from"))
    : endTime - durations[range];
  const interval = Number(params.get("interval") ?? 60_000);
  return {
    custom,
    range,
    startTime,
    endTime,
    intervalMs: intervals.includes(interval) ? interval : 60_000,
    valid:
      Number.isFinite(startTime) &&
      Number.isFinite(endTime) &&
      startTime > 0 &&
      endTime <= 8_640_000_000_000_000 &&
      endTime > startTime &&
      endTime - startTime <= 93 * 86_400_000,
  };
}
