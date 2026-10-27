/** A non-sensitive view preference can only narrow an authenticated account's data. */
export const dataWorkspaceCookie = "smart_factory_data_workspace";
export type DataWorkspace = "demo" | "live";
export function requestedDataWorkspace(
  cookie: string | undefined,
): DataWorkspace | undefined {
  const value = cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(dataWorkspaceCookie + "="))
    ?.slice(dataWorkspaceCookie.length + 1);
  return value === "demo" || value === "live" ? value : undefined;
}
