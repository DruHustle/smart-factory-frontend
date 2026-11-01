/** Bookmarks and saved filters are untrusted input, just like form fields. */
export function listPage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 0 && page <= 100000 ? page : 0;
}

export function filterChoice<T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback;
}

const statuses = [
  "all",
  "live",
  "stale",
  "offline",
  "unknown",
  "maintenance",
  "error",
] as const;

export function inventoryFilters(params: URLSearchParams) {
  return {
    search: (params.get("search") ?? "").slice(0, 100),
    view: filterChoice(
      params.get("view"),
      ["all", "assets", "devices", "gateways", "equipment"],
      "all",
    ),
    zone: (params.get("zone") ?? "").slice(0, 100),
    status: filterChoice(params.get("status"), statuses, "all"),
    mode: filterChoice(
      params.get("mode"),
      ["all", "live", "simulated", "replay", "unknown"],
      "all",
    ),
    capability: filterChoice(
      params.get("capability"),
      ["all", "aas", "3d"],
      "all",
    ),
    sort: filterChoice(params.get("sort"), ["name", "recent"], "name"),
    page: listPage(params.get("page")),
    pageSize: 25,
  };
}

export function monitoringFilters(params: URLSearchParams, demo = false) {
  return {
    search: (params.get("search") ?? "").slice(0, 100),
    type: filterChoice(
      params.get("type"),
      ["all", "sensor", "edge_device", "gateway", "actuator", "controller"],
      "all",
    ),
    status: filterChoice(params.get("status"), statuses, "all"),
    scope: filterChoice(
      params.get("scope"),
      ["operational", "live", "simulated", "replay", "unknown", "all"],
      demo ? "simulated" : "operational",
    ),
    page: listPage(params.get("page")),
  };
}
