import { useHashLocation } from "wouter/use-hash-location";
/** Keep workspace context inside the hash. Wouter's stock navigate moves ?query
 * to URL.search; that would discard nested return links and evidence filters. */
export function navigateWorkspace(
  to: string,
  {
    replace = false,
    state = null,
  }: { replace?: boolean; state?: unknown } = {},
) {
  const oldURL = window.location.href;
  const url = new URL(oldURL);
  url.hash = to.startsWith("#") ? to.slice(1) : to;
  window.history[replace ? "replaceState" : "pushState"](state, "", url);
  window.dispatchEvent(
    new HashChangeEvent("hashchange", { oldURL, newURL: url.href }),
  );
}
export function useWorkspaceLocation(): ReturnType<typeof useHashLocation> {
  const [location] = useHashLocation();
  return [location, navigateWorkspace];
}
useWorkspaceLocation.hrefs = (href: string) => "#" + href;
