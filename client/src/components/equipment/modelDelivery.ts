import { industrialModels, type IndustrialModel } from "@shared/industrial-assets";

const MAX_MODEL_BYTES = 20 * 1024 * 1024;

/** No arbitrary static paths, credentials, redirects or third-party model origins. */
export function modelDelivery(input: string, origin: string) {
  const url = new URL(input, origin);
  if (url.origin !== origin || url.username || url.password || url.hash)
    throw new Error("Model must use authorized Smart Factory file delivery");
  const bundled = industrialModels.find((model) => url.pathname === model.url);
  if (bundled && !url.search) return { url, bundled };
  if (url.pathname.startsWith("/api/equipment/")) return { url, bundled: undefined };
  throw new Error("Model must use authorized Smart Factory file delivery");
}

export async function verifyBundledModel(bytes: Uint8Array, model: IndustrialModel) {
  if (bytes.byteLength !== model.bytes || bytes.byteLength > MAX_MODEL_BYTES)
    throw new Error("Model size does not match the reviewed asset");
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure model verification is unavailable in this browser");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  const actual = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  if (actual !== model.sha256)
    throw new Error("Model integrity check failed; the file was not rendered");
}

/** Bounded delivery also used for an explicitly requested local import. */
export async function fetchBundledModel(model: IndustrialModel, signal: AbortSignal) {
  const delivery = modelDelivery(model.url, window.location.origin);
  if (delivery.bundled !== model) throw new Error("Unreviewed model revision");
  const response = await fetch(delivery.url, { credentials: "same-origin", redirect: "error", signal });
  if (!response.ok) throw new Error(`Model delivery returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Model data missing");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_MODEL_BYTES || size > model.bytes) {
      await reader.cancel();
      throw new Error("Model exceeds reviewed byte budget");
    }
    chunks.push(item.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  await verifyBundledModel(result, model);
  return result;
}
