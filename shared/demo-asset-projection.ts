import { buildDemoAasDocuments } from "./demo-aas";

/** The same authored model powers the API, engineering viewer and demo export.
 * It is never applied to operational records or imported vendor packages. Reads
 * enrich legacy fixtures in memory without rewriting their historical evidence.
 */
export function authoredDemoAas(
  asset:
    | (Parameters<typeof buildDemoAasDocuments>[0] & {
        isDemo?: boolean;
        aasxImported?: boolean;
      })
    | null
    | undefined,
) {
  if (!asset?.isDemo || asset.aasxImported) return undefined;
  return buildDemoAasDocuments(asset);
}
