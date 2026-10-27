import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WebSocketManager, type SocketAuthorization } from "./websocket";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function fixture(
  authorize: () => Promise<boolean | SocketAuthorization> = async () => true,
) {
  const server = createServer(),
    manager = new WebSocketManager();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await manager.initialize(server, "/ws", authorize);
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing local socket port");
  const clients: WebSocket[] = [];
  cleanup.push(async () => {
    for (const c of clients) c.terminate();
    manager.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    manager,
    connect: async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      clients.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return ws;
    },
  };
}
const message = (ws: WebSocket) =>
  new Promise<any>((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
    ws.once("error", reject);
  });
const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) => ws.once("close", resolve));

describe("bounded, revocable WebSocket reads", () => {
  it("caps a single 40-channel subscription incrementally, including subsequent requests", async () => {
    const f = await fixture(),
      ws = await f.connect();
    let reply = message(ws);
    ws.send(
      JSON.stringify({
        type: "subscribe",
        channels: Array.from(
          { length: 40 },
          (_, i) => `device:${i + 1}:sensor`,
        ),
      }),
    );
    const first = await reply;
    expect(first.data.channels).toHaveLength(32);
    expect(first.data.rejected).toHaveLength(8);
    expect(f.manager.getSubscribedChannelsCount()).toBe(32);
    reply = message(ws);
    ws.send(
      JSON.stringify({
        type: "subscribe",
        channels: ["device:1:sensor", "device:99:sensor"],
      }),
    );
    expect((await reply).data.channels).toEqual(["device:1:sensor"]);
    ws.send(
      JSON.stringify({ type: "unsubscribe", channels: ["device:1:sensor"] }),
    );
    reply = message(ws);
    ws.send(
      JSON.stringify({ type: "subscribe", channels: ["device:99:sensor"] }),
    );
    expect((await reply).data.channels).toEqual(["device:99:sensor"]);
    expect(f.manager.getSubscribedChannelsCount()).toBe(32);
  });
  it("rejects oversized arrays and private transport control channels", async () => {
    const f = await fixture(),
      ws = await f.connect();
    let reply = message(ws);
    ws.send(
      JSON.stringify({
        type: "subscribe",
        channels: Array(65).fill("aas:all"),
      }),
    );
    expect((await reply).type).toBe("error");
    expect(f.manager.getSubscribedChannelsCount()).toBe(0);
    reply = message(ws);
    ws.send(JSON.stringify({ type: "subscribe", channels: ["auth:revoked"] }));
    expect((await reply).type).toBe("error");
    expect(f.manager.getSubscribedChannelsCount()).toBe(0);
  });
  it("closes expired sessions even without channel membership", async () => {
    const f = await fixture(async () => ({
      userId: 1,
      sessionId: randomUUID(),
      expiresAt: Date.now() + 150,
      reauthorize: async () => true,
    }));
    const ws = await f.connect();
    expect(f.manager.getConnectedClientsCount()).toBe(1);
    expect(await closed(ws)).toBe(4001);
    await expect.poll(() => f.manager.getConnectedClientsCount()).toBe(0);
  });
  it("revokes one authenticated session and preserves a different user's socket", async () => {
    const firstId = randomUUID(),
      secondId = randomUUID();
    let n = 0;
    const f = await fixture(async () => ({
      userId: ++n,
      sessionId: n === 1 ? firstId : secondId,
      expiresAt: Date.now() + 60_000,
      reauthorize: async () => true,
    }));
    const first = await f.connect(),
      second = await f.connect(),
      firstClosed = closed(first);
    await f.manager.invalidateSession(firstId);
    expect(await firstClosed).toBe(4001);
    expect(second.readyState).toBe(WebSocket.OPEN);
    const secondClosed = closed(second);
    await f.manager.invalidateUser(2);
    expect(await secondClosed).toBe(4001);
  });
  it("reauthorizes existing sockets before later subscriptions", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const reauthorize = vi.fn(async () => false);
    const f = await fixture(async () => ({
      userId: 1,
      sessionId: randomUUID(),
      expiresAt: now + 60_000,
      reauthorize,
    }));
    const ws = await f.connect(),
      finished = closed(ws);
    now += 16_000;
    ws.send(JSON.stringify({ type: "subscribe", channels: ["aas:all"] }));
    expect(await finished).toBe(4001);
    expect(reauthorize).toHaveBeenCalledOnce();
    expect(f.manager.getSubscribedChannelsCount()).toBe(0);
  });
  it("closes a message flood within the bounded request window", async () => {
    const f = await fixture(),
      ws = await f.connect(),
      finished = closed(ws);
    for (let i = 0; i < 25; i++)
      ws.send(JSON.stringify({ type: "subscribe", channels: ["aas:all"] }));
    expect(await finished).toBe(1008);
  });
  it("terminates a backpressured receiver before adding another payload", async () => {
    const f = await fixture(),
      ws = await f.connect();
    const reply = message(ws);
    ws.send(JSON.stringify({ type: "subscribe", channels: ["aas:all"] }));
    await reply;
    const serverSocket: WebSocket = [...(f.manager as any).wss.clients][0];
    Object.defineProperty(serverSocket, "bufferedAmount", {
      get: () => 2 * 1024 * 1024,
    });
    const finished = closed(ws);
    f.manager.broadcastAasChanged("urn:synthetic:bounded", "updated");
    expect(await finished).toBe(1006);
    await expect.poll(() => f.manager.getConnectedClientsCount()).toBe(0);
  });
});
