/** Contract-test receiver only. This is not the Onesa application. */
import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  batchSchema,
  CONTRACT,
  type Mapping,
} from "../../server/onesa/contract";
import { rows, type Executor } from "../../server/onesa/store";
export async function createReceiver(
  db: Executor,
  scope: {
    token: string;
    workspaceId: string;
    installationId: string;
    mappings: Mapping[];
  },
  fault?: () => number,
) {
  await db.execute(
    sql`create table if not exists proposed_receiver_history (event_id text primary key,digest text not null,payload jsonb not null,ingested_at timestamptz not null default now())`,
  );
  await db.execute(
    sql`create table if not exists proposed_receiver_current (state_key text primary key,observed_at timestamptz not null,payload jsonb not null)`,
  );
  await db.execute(
    sql`create table if not exists proposed_receiver_alarms (alarm_key text primary key,observed_at timestamptz not null,state text not null,mode text not null,live_incidents integer not null default 0)`,
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));
  app.post("/proposed/v1/batches", async (req, res) => {
    const provided = Buffer.from(
        (req.header("authorization") ?? "").replace(/^Bearer /, ""),
      ),
      expected = Buffer.from(scope.token);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      return res.status(401).json({ error: "unauthorized" });
    const b = batchSchema.safeParse(req.body);
    if (!b.success) return res.status(422).json({ error: "validation_failed" });
    if (
      b.data.workspaceId !== scope.workspaceId ||
      b.data.installationId !== scope.installationId
    )
      return res.status(403).json({ error: "scope_mismatch" });
    const failure = fault?.();
    if (failure)
      return res
        .status(failure)
        .setHeader("Retry-After", "1")
        .json({ error: "fixture_failure" });
    try {
      const results = [];
      for (const e of b.data.items) {
        const mapping = scope.mappings.find(
          (m) => m.equipmentId === e.equipmentId && !m.retired,
        );
        if (
          !mapping?.targets.some(
            (t) =>
              t.componentId === e.componentId &&
              t.equipmentId === e.target.equipmentId &&
              t.targetComponentId === e.target.componentId,
          )
        ) {
          results.push({
            eventId: e.eventId,
            status: "rejected",
            ingestedAt: null,
            code: "missing_mapping",
          });
          continue;
        }
        const digest = createHash("sha256")
          .update(JSON.stringify(e))
          .digest("hex");
        // Immutable event content is persisted before a receipt can be returned.
        const inserted = await rows(
          db,
          sql`insert into proposed_receiver_history (event_id,digest,payload) values (${e.eventId},${digest},${JSON.stringify(e)}::jsonb) on conflict do nothing returning ingested_at`,
        );
        const [previous] = await rows(
          db,
          sql`select digest,ingested_at from proposed_receiver_history where event_id=${e.eventId}`,
        );
        if (previous.digest !== digest) {
          results.push({
            eventId: e.eventId,
            status: "rejected",
            ingestedAt: null,
            code: "conflict",
          });
          continue;
        }
        // Run even after duplicate delivery: recover a crash between history and
        // current-state projection. Replay never projects into live/simulated state.
        if (
          e.mode !== "replay" &&
          e.sourceQuality === "good" &&
          e.clockSkew !== "future"
        ) {
          const key = JSON.stringify([
            e.target.workspaceId,
            e.target.equipmentId,
            e.target.componentId,
            e.metric?.metricId ?? e.kind,
            e.mode,
            e.mode === "simulated" ? e.scenarioRunId : null,
          ]);
          await db.execute(
            sql`insert into proposed_receiver_current (state_key,observed_at,payload) values (${key},${e.observedAt}::timestamptz,${JSON.stringify(e)}::jsonb) on conflict(state_key) do update set observed_at=excluded.observed_at,payload=excluded.payload where proposed_receiver_current.observed_at<excluded.observed_at`,
          );
        }
        if (e.kind === "source_alarm" && e.sourceEvent && e.mode !== "replay") {
          const key = JSON.stringify([
            e.installationId,
            e.equipmentId,
            e.componentId,
            e.sourceEvent.id,
            e.mode,
            e.scenarioRunId,
          ]);
          const live =
            e.mode === "live" && e.sourceEvent.state === "active" ? 1 : 0;
          await db.execute(
            sql`insert into proposed_receiver_alarms (alarm_key,observed_at,state,mode,live_incidents) values (${key},${e.observedAt}::timestamptz,${e.sourceEvent.state},${e.mode},${live}) on conflict(alarm_key) do update set observed_at=excluded.observed_at,state=excluded.state,live_incidents=proposed_receiver_alarms.live_incidents+case when proposed_receiver_alarms.state<>'active' then excluded.live_incidents else 0 end where proposed_receiver_alarms.observed_at<excluded.observed_at`,
          );
        }
        results.push({
          eventId: e.eventId,
          status: inserted.length ? "accepted" : "duplicate",
          ingestedAt: new Date(previous.ingested_at as string).toISOString(),
          code: "ok",
        });
      }
      return res.json({
        schema: CONTRACT,
        workspaceId: scope.workspaceId,
        results,
      });
    } catch {
      return res.status(503).json({ error: "persistence_unavailable" });
    }
  });
  return app;
}
