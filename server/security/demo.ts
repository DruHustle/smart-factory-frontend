import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  database,
  rows,
  ingestInTransaction,
  audit,
  securityTransaction,
} from "./store";
import { ownedEnvelope, SecurityError, ownedEventTypes } from "./contract";
/** Authored simulation only; no live asset/incident is changed. */
export async function seedDemonstration(actor: number | null = null) {
  const db = await database(),
    source = await securityTransaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
      const [old] = await rows(
        tx,
        sql`select * from security_sources where system_key='demonstration-v2'`,
      );
      if (old)
        return {
          id: old.id,
          namespace: old.namespace,
          anchor: new Date(old.created_at).getTime(),
        };
      const id = randomUUID(),
        namespace = "smart-factory-demonstration-v2";
      const policy = {
        targets: [{ kind: "application", id: null }],
        modes: ["simulated", "replay"],
        types: ownedEventTypes,
        connections: ["supplied-certificate", "mqtt-cloud"],
        inputs: [
          { inputRef: "local-mqtt", allowedIdentities: ["fixture-known"] },
        ],
        expectedIntervalSeconds: 0,
      };
      await tx.execute(
        sql`insert into security_sources(id,name,namespace,system_key,is_demo,policy) values(${id},'Authored security demonstration',${namespace},'demonstration-v2',true,${JSON.stringify(policy)}::jsonb)`,
      );
      await tx.execute(
        sql`insert into security_baselines(id,source_id,revision,settings,proposed_by,approved_at,approved_by) values(${randomUUID()},${id},'authored-demo-baseline',${JSON.stringify({ configRevision: "approved-demo", relevantKeys: ["asset_connections"], expectedTls: true, basis: "authored demonstration; no live approval" })}::jsonb,${actor},now(),${actor})`,
      );
      await audit(
        tx,
        "demonstration_source_initialized",
        actor,
        { basis: "authored simulation/replay; no live equipment claim" },
        null,
        id,
      );
      const [saved] = await rows(
        tx,
        sql`select created_at from security_sources where id=${id}`,
      );
      return { id, namespace, anchor: new Date(saved.created_at).getTime() };
    });
  const [{ count }] = await rows(
    db,
    sql`select count(*)::int as count from security_events where source_id=${source.id} and source_event_id like 'demo-%'`,
  );
  if (count === 28) return { sourceId: source.id, created: false };
  for (const mode of ["simulated", "replay"] as const) {
    const anchor = source.anchor - (mode === "replay" ? 90 * 86400000 : 10000),
      date = (delta: number) => new Date(anchor + delta).toISOString();
    const entries: Array<[string, Record<string, unknown>]> = [
      ...Array.from(
        { length: 5 },
        () =>
          [
            "auth.authentication_failed",
            {
              service: "demonstration",
              outcome: "denied",
              reasonCode: "INVALID_CREDENTIALS",
            },
          ] as [string, Record<string, unknown>],
      ),
      ...Array.from(
        { length: 3 },
        () =>
          [
            "auth.authorization_denied",
            {
              service: "demonstration-admin",
              outcome: "denied",
              reasonCode: "FORBIDDEN",
            },
          ] as [string, Record<string, unknown>],
      ),
      [
        "tls.certificate_observed",
        {
          endpointRef: "supplied-certificate",
          notBefore: date(-86400000),
          notAfter: date(10 * 86400000),
          fingerprintSha256: "a".repeat(64),
        },
      ],
      [
        "config.changed",
        { configRevision: "changed-demo", changedKeys: ["asset_connections"] },
      ],
      [
        "identity.unrecognized",
        { inputRef: "local-mqtt", observedIdentityRef: "fixture-unknown" },
      ],
      ["collector.health", { state: "offline", expectedIntervalSeconds: 300 }],
      [
        "integrity.change_observed",
        {
          previousSha256: "a".repeat(64),
          currentSha256: "b".repeat(64),
          evidenceBasis: "self_reported",
        },
      ],
      [
        "transport.connection_observed",
        {
          connectionRef: "mqtt-cloud",
          protocol: "mqtt",
          tlsActive: false,
          evidenceBasis: "declared_config",
        },
      ],
    ];
    const events = entries.map(([eventType, attributes], n) =>
      ownedEnvelope.parse({
        schemaVersion:
          eventType === "transport.connection_observed"
            ? "smart-factory-ot-observation/v1"
            : "ot-security-evidence/v1",
        producerNamespace: source.namespace,
        sourceEventId: `demo-${mode}-${n}`,
        occurredAt: date(n * 10),
        mode,
        scenarioRunId:
          mode === "simulated" ? "authored-demo-v2-001" : undefined,
        replayRunId: mode === "replay" ? "authored-replay-v2-001" : undefined,
        eventType,
        assetRef: null,
        summary: `Authored ${mode} example: ${eventType}. No physical attack is asserted.`,
        quality: "good",
        producerVersion: "smart-factory-demo-2",
        attributes,
      }),
    );
    await securityTransaction((tx) =>
      ingestInTransaction(tx, source.id, events, {
        kind: "application",
        id: null,
      }),
    );
  }
  return { sourceId: source.id, created: true };
}
export async function simulateRecurrence(id: string, actor: number) {
  const db = await database(),
    [f] = await rows(
      db,
      sql`select f.*,s.namespace from security_findings f join security_sources s on s.id=f.source_id where f.id=${id} and f.mode='simulated' and s.system_key='demonstration-v2' and f.rule_id='authentication-burst'`,
    );
  if (!f) throw new SecurityError(422, "authored_simulation_finding_required");
  const events = Array.from({ length: 5 }, () =>
    ownedEnvelope.parse({
      schemaVersion: "ot-security-evidence/v1",
      producerNamespace: f.namespace,
      sourceEventId: randomUUID(),
      occurredAt: new Date(Date.now() - 100).toISOString(),
      mode: "simulated",
      scenarioRunId: f.run_id,
      eventType: "auth.authentication_failed",
      assetRef: null,
      summary:
        "An explicitly requested simulation repeats a rejected sign-in pattern.",
      quality: "good",
      producerVersion: "smart-factory-demo-2",
      attributes: {
        service: "demonstration",
        outcome: "denied",
        reasonCode: "INVALID_CREDENTIALS",
      },
    }),
  );
  const result = await securityTransaction((tx) =>
    ingestInTransaction(tx, f.source_id, events, f.target),
  );
  await securityTransaction(async (tx) =>
    audit(
      tx,
      "demonstration_repeated",
      actor,
      { mode: "simulated", liveStateChanged: false },
      id,
      f.source_id,
    ),
  );
  return result;
}
