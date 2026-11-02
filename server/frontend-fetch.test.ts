import { describe, expect, it, vi } from "vitest";
import { frontendFetch } from "../scripts/frontend-fetch";

const source = new URL(
  "https://smart-factory-iot-app.vercel.app/release.json?revision=abc",
);
const target = "https://smart-factory-ui.vercel.app/release.json?revision=abc";
const redirect = (status: number, location: string) =>
  new Response(null, { status, headers: { location } });

describe("verified frontend delivery", () => {
  it("accepts a direct response or one exact 307 with path and query preserved", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(new Response("direct", { status: 200 }));
    expect(await (await frontendFetch(source, {}, fetcher)).text()).toBe(
      "direct",
    );
    fetcher.mockResolvedValueOnce(redirect(307, target));
    fetcher.mockResolvedValueOnce(new Response("alias", { status: 200 }));
    expect(await (await frontendFetch(source, {}, fetcher)).text()).toBe(
      "alias",
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      redirect: "manual",
      credentials: "omit",
    });
    expect(fetcher.mock.calls[2][0].toString()).toBe(target);
    expect(fetcher.mock.calls[2][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });

  it("rejects changed hosts, paths, queries, codes and chained redirects", async () => {
    for (const [status, location] of [
      [307, "https://example.com/release.json?revision=abc"],
      [307, "https://smart-factory-ui.vercel.app/other?revision=abc"],
      [307, "https://smart-factory-ui.vercel.app/release.json?revision=other"],
      [302, target],
    ] as const) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(redirect(status, location));
      await expect(frontendFetch(source, {}, fetcher)).rejects.toThrow(
        "unexpected redirect",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const chained = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect(307, target))
      .mockResolvedValueOnce(redirect(307, "https://example.com/"));
    await expect(frontendFetch(source, {}, chained)).rejects.toThrow(
      "unexpected redirect",
    );
    expect(chained).toHaveBeenCalledTimes(2);
  });

  it("does not permit mutation requests and does not follow redirects at other origins", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    await expect(
      frontendFetch(source, { method: "POST" }, fetcher),
    ).rejects.toThrow("only public GET");
    await expect(
      frontendFetch(source, { headers: { Authorization: "secret" } }, fetcher),
    ).rejects.toThrow("only public GET");
    await frontendFetch(new URL("https://api.example.com/health"), {}, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("does not treat a double-slash path as a different host", async () => {
    const url = new URL(
      "https://smart-factory-iot-app.vercel.app//evil.example/file",
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirect(307, "https://evil.example/file"));
    await expect(frontendFetch(url, {}, fetcher)).rejects.toThrow(
      "unexpected redirect",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
