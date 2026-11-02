const configuredOrigin = "https://smart-factory-iot-app.vercel.app";
const canonicalOrigin = "https://smart-factory-ui.vercel.app";

/** Follow only the verified production alias, preserving the exact path and query. */
export async function frontendFetch(
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (url.origin !== configuredOrigin)
    return fetcher(url, { ...init, redirect: "error" });
  if (
    (init.method ?? "GET").toUpperCase() !== "GET" ||
    init.body != null ||
    url.username ||
    url.password ||
    [...new Headers(init.headers).keys()].some(
      (header) => !["accept", "cache-control"].includes(header),
    )
  )
    throw new Error(
      "Frontend alias verification permits only public GET requests",
    );
  const response = await fetcher(url, {
    ...init,
    credentials: "omit",
    redirect: "manual",
  });
  if (response.status === 200 && !response.redirected) return response;
  const target = new URL(canonicalOrigin);
  target.pathname = url.pathname;
  target.search = url.search;
  if (target.origin !== canonicalOrigin)
    throw new Error("The frontend alias origin is invalid");
  const allowed =
    response.status === 307 &&
    !response.redirected &&
    response.headers.get("location") === target.href;
  await response.body?.cancel();
  if (!allowed)
    throw new Error("The frontend returned an unexpected redirect or status");
  const final = await fetcher(target, {
    ...init,
    credentials: "omit",
    redirect: "error",
  });
  if (final.redirected || (final.status >= 300 && final.status < 400)) {
    await final.body?.cancel();
    throw new Error("The frontend alias returned an unexpected redirect");
  }
  return final;
}
