import { sql } from "drizzle-orm";
import {
  batchSchema,
  receiptSchema,
  type IntegrationEvent,
  CONTRACT,
} from "./contract";
import { integrationConfig } from "./config";
import { rows, database, ensureScope, normalizeCaptured } from "./store";
export function retryDelay(
  attempt: number,
  retryAfter: string | null,
  now = Date.now(),
  random = Math.random,
) {
  const seconds =
    retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : retryAfter
        ? Date.parse(retryAfter) - now
        : 0;
  return Math.min(
    3600000,
    Math.max(
      Number.isFinite(seconds) ? seconds : 0,
      Math.min(300000, 1000 * 2 ** Math.min(attempt, 9)) *
        (0.5 + random() * 0.5),
    ),
  );
}
async function limitedReceipt(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing receipt body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new Error("Oversized receipt");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function classify(status: number) {
  return status === 401 || status === 403
    ? "credentials"
    : status === 408 || status === 425 || status === 429 || status >= 500
      ? "transient"
      : status >= 200 && status < 300
        ? "receipt"
        : "permanent";
}
export async function drain(fetcher: typeof fetch = fetch) {
  const c = integrationConfig();
  if (!c) return;
  const db = await database();
  await db.transaction(async (tx) => {
    const [{ locked }] = await rows<{ locked: boolean }>(
      tx,
      sql`select pg_try_advisory_xact_lock(202610253) as locked`,
    );
    if (!locked) return;
    await tx.execute(sql`select pg_advisory_xact_lock(202610251)`);
    await ensureScope(tx, c);
    // Expire with accounting; retain immutable receipts for the configured horizon.
    const expired = await rows(
      tx,
      sql`delete from onesa_outbox where created_at<now()-(${c.retentionHours}*interval '1 hour') returning state`,
    );
    const dropped = expired.filter((r) => r.state !== "acknowledged").length;
    if (dropped)
      await tx.execute(
        sql`update onesa_installation set discarded=discarded+${dropped},last_error='retention_expired'`,
      );
    await tx.execute(
      sql`delete from onesa_audit where created_at<now()-interval '90 days'`,
    );
    await normalizeCaptured(tx, c);
  });
  // Release the capture/capacity lock before any network I/O. An outage can
  // delay this worker but cannot hold acquisition's transaction behind HTTP.
  await db.transaction(async (tx) => {
    const [{ locked }] = await rows<{ locked: boolean }>(
      tx,
      sql`select pg_try_advisory_xact_lock(202610253) as locked`,
    );
    if (!locked) return;
    const state = await ensureScope(tx, c);
    if (state.suspended) return;
    const pending = await rows(
      tx,
      sql`select * from onesa_outbox where state='pending' and next_attempt<=now() order by id limit ${c.batchSize}`,
    );
    // A source sample can fan out to multiple events. Bound by wire events too.
    const selected: typeof pending = [];
    let items: IntegrationEvent[] = [];
    for (const r of pending) {
      const next = r.payload as IntegrationEvent[];
      if (items.length + next.length > c.batchSize) {
        if (!selected.length) {
          selected.push(r);
          items = next.slice(0, c.batchSize);
        }
        break;
      }
      selected.push(r);
      items.push(...next);
    }
    if (!items.length) return;
    let results: ReturnType<typeof receiptSchema.parse>["results"] | null =
        null,
      error = "network",
      responseClass = "transient",
      retryAfter: string | null = null;
    let transportReceived = false;
    try {
      const body = batchSchema.parse({
        schema: CONTRACT,
        installationId: c.installationId,
        workspaceId: c.workspaceId,
        items,
      });
      const response = await fetcher(c.url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + c.token,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs),
        redirect: "error",
      });
      responseClass = classify(response.status);
      error = "http_" + response.status;
      retryAfter = response.headers.get("retry-after");
      transportReceived = true;
      if (responseClass === "receipt") {
        const text = await limitedReceipt(response);
        const receipt = receiptSchema.parse(JSON.parse(text));
        const expected = new Set(items.map((e) => e.eventId));
        if (
          receipt.workspaceId !== c.workspaceId ||
          receipt.results.length !== items.length ||
          new Set(receipt.results.map((r) => r.eventId)).size !==
            items.length ||
          receipt.results.some(
            (r) =>
              !expected.has(r.eventId) ||
              ((r.status === "accepted" || r.status === "duplicate") &&
                (!r.ingestedAt || r.code !== "ok")),
          )
        )
          throw new Error("Invalid receipt");
        results = receipt.results;
      }
    } catch {
      if (responseClass === "receipt") error = "invalid_receipt";
    }
    if (transportReceived)
      await tx.execute(sql`update onesa_installation set last_transport=now()`);
    if (responseClass === "credentials")
      await tx.execute(
        sql`update onesa_installation set suspended=true,last_error='credentials_rejected'`,
      );
    const acceptedIds = new Set(
      results
        ?.filter((r) => r.status === "accepted" || r.status === "duplicate")
        .map((r) => r.eventId) ?? [],
    );
    let acknowledged = 0;
    for (const r of selected) {
      const original = r.payload as IntegrationEvent[];
      const remaining = original.filter((e) => !acceptedIds.has(e.eventId));
      const rejected = results?.some(
        (result) =>
          original.some((e) => e.eventId === result.eventId) &&
          result.status === "rejected",
      );
      const attempts = Number(r.attempts) + 1;
      const permanent =
        rejected || responseClass === "permanent" || attempts >= c.maxAttempts;
      const nextState = !remaining.length
        ? "acknowledged"
        : permanent
          ? "quarantine"
          : "pending";
      if (nextState === "acknowledged") acknowledged++;
      await tx.execute(
        sql`update onesa_outbox set payload=${JSON.stringify(remaining.length ? remaining : original)}::jsonb,state=${nextState},attempts=${attempts},next_attempt=now()+(${retryDelay(attempts, retryAfter)}*interval '1 millisecond'),acknowledged_at=${nextState === "acknowledged" ? new Date().toISOString() : null}::timestamptz,error_code=${nextState === "acknowledged" ? null : rejected ? "receiver_rejected" : error},receipt=${JSON.stringify(results)}::jsonb where id=${r.id as number}`,
      );
      if (nextState === "quarantine")
        await tx.execute(
          sql`update onesa_installation set quarantined=quarantined+1`,
        );
    }
    if (acceptedIds.size)
      await tx.execute(
        sql`update onesa_installation set last_ack=now(),acknowledged=acknowledged+${acknowledged},last_error=${acceptedIds.size === items.length ? null : "partial_acceptance"}`,
      );
    else
      await tx.execute(
        sql`update onesa_installation set last_error=${responseClass === "credentials" ? "credentials_rejected" : error}`,
      );
  });
}
export function startOnesaWorker() {
  let active = false;
  const timer = setInterval(async () => {
    if (active) return;
    active = true;
    try {
      await drain();
    } catch {
      console.warn("[Onesa] Delivery unavailable; acquisition continues.");
    } finally {
      active = false;
    }
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
