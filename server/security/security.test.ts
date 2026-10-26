import { setRuntimeDemoDataEnabled } from "../demoData";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  initialize,
  createSource,
  sourceCredential,
  credentialAction,
  ingest,
  database,
  rows,
  activateRule,
  proposeBaseline,
  approveBaseline,
} from "./store";
import { envelope, sourceInput, digest, canonical } from "./contract";
import {
  detail,
  filters,
  findings,
  act,
  importReport,
  exportEvents,
  events,
  observeCertificate,
  retryReport,
  sources as sourcePolicies,
} from "./service";
import { drainOutbox, nativeEvent } from "./runtime";
import { processReportChunk } from "./report-worker";
import { securityRouter } from "./router";
import { sweep } from "./runtime";
import { evaluate } from "./rules";
const originalDemoFlag = process.env.ENABLE_DEMO_ACCOUNTS;
const originalDemoDataFlag = process.env.ENABLE_DEMO_DATA;
const actor = 100001,
  other = 100002,
  namespace = "security-test-" + randomUUID(),
  sourceIds: string[] = [];
async function source(modes = ["live"]) {
  const r = await createSource(
    sourceInput.parse({
      name: "Fixture collector",
      namespace: namespace + "-" + sourceIds.length,
      targets: [{ kind: "application", id: null }],
      modes,
      types: [
        "auth.authentication_failed",
        "auth.authorization_denied",
        "tls.certificate_observed",
        "config.changed",
        "identity.unrecognized",
        "collector.health",
        "integrity.change_observed",
        "software.inventory_observed",
      ],
      connections: ["supplied-cert"],
      inputs: [{ inputRef: "local-mqtt", allowedIdentities: ["known"] }],
      expectedIntervalSeconds: 60,
    }),
    actor,
  );
  sourceIds.push(r.id);
  return { ...r, namespace: namespace + "-" + (sourceIds.length - 1) };
}
function event(
  s: { namespace: string },
  changes: Record<string, unknown> = {},
) {
  return envelope.parse({
    schemaVersion: "ot-security-evidence/v1",
    producerNamespace: s.namespace,
    sourceEventId: randomUUID(),
    occurredAt: new Date(Date.now() - 100).toISOString(),
    mode: "live",
    eventType: "auth.authentication_failed",
    assetRef: null,
    summary: "Fixture sign-in was denied.",
    quality: "good",
    producerVersion: "fixture-1",
    attributes: {
      service: "fixture",
      outcome: "denied",
      reasonCode: "INVALID_CREDENTIALS",
    },
    ...changes,
  });
}
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "persistent security domain",
  () => {
    beforeAll(async () => {
      process.env.ENABLE_DEMO_ACCOUNTS = "false";
      process.env.ENABLE_DEMO_DATA = "false";
      setRuntimeDemoDataEnabled(false);
      const db = await database();
      await db.execute(
        sql`insert into users(id,"openId",name,email,role) values(${actor},${namespace},'Security test administrator',${namespace + "@example.test"},'admin'),(${other},${namespace + "-other"},'Other engineer',${namespace + "-other@example.test"},'engineer')`,
      );
      await initialize();
    });
    afterAll(async () => {
      setRuntimeDemoDataEnabled(undefined);
      if (originalDemoDataFlag === undefined)
        delete process.env.ENABLE_DEMO_DATA;
      else process.env.ENABLE_DEMO_DATA = originalDemoDataFlag;
      if (originalDemoFlag === undefined)
        delete process.env.ENABLE_DEMO_ACCOUNTS;
      else process.env.ENABLE_DEMO_ACCOUNTS = originalDemoFlag;
      const db = await database();
      for (const id of sourceIds) {
        await db.execute(
          sql`delete from notification_inbox where "securityFindingId" in(select id from security_findings where source_id=${id})`,
        );
        await db.execute(
          sql`delete from security_audit where source_id=${id} or finding_id in(select id from security_findings where source_id=${id})`,
        );
        await db.execute(
          sql`delete from security_incidents where finding_id in(select id from security_findings where source_id=${id})`,
        );
        await db.execute(
          sql`delete from security_finding_evidence where finding_id in(select id from security_findings where source_id=${id})`,
        );
        await db.execute(
          sql`delete from security_findings where source_id=${id}`,
        );
        await db.execute(
          sql`delete from security_events where source_id=${id}`,
        );
        await db.execute(
          sql`delete from security_imports where source_id=${id}`,
        );
        await db.execute(
          sql`delete from security_baselines where source_id=${id}`,
        );
        await db.execute(
          sql`delete from security_mappings where source_id=${id}`,
        );
        await db.execute(sql`delete from security_sources where id=${id}`);
      }
      await db.execute(
        sql`delete from security_audit where actor_id in(${actor},${other})`,
      );
      await db.execute(
        sql`update security_rules set actor_id=null where actor_id in(${actor},${other})`,
      );
      await db.execute(sql`delete from users where id in(${actor},${other})`);
    });
    it("honors the persisted demonstration setting over the environment fallback", async () => {
      const db = await database();
      expect(
        await rows(
          db,
          sql`select id from security_sources where system_key='demonstration'`,
        ),
      ).toHaveLength(0);
      setRuntimeDemoDataEnabled(true);
      try {
        await initialize();
        const [demo] = await rows(
          db,
          sql`select * from security_sources where system_key='demonstration'`,
        );
        sourceIds.push(demo.id);
        expect(demo.is_demo).toBe(true);
        const [{ count }] = await rows(
          db,
          sql`select count(*)::int as count from security_events where source_id=${demo.id}`,
        );
        expect(count).toBe(28);
      } finally {
        setRuntimeDemoDataEnabled(false);
      }
    });
    it("enforces viewer/operator/engineer/admin and read-only demonstration boundaries", async () => {
      for (const role of ["viewer", "operator", "engineer", "admin"]) {
        const caller = securityRouter.createCaller({
          user: {
            id: actor,
            role,
            openId: "individual",
            email: "individual@example.test",
          },
          req: { headers: {} },
          res: {},
        } as any);
        expect((await caller.availability()).canAdmin).toBe(role === "admin");
        if (role !== "admin")
          await expect(
            caller.retention({ days: 30, reason: "Permission boundary test" }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        if (role === "viewer")
          await expect(caller.export({ format: "json" })).rejects.toMatchObject(
            { code: "FORBIDDEN" },
          );
        if (["viewer", "operator"].includes(role))
          await expect(
            caller.importEvidence({
              sourceId: randomUUID(),
              raw: '{"events":[]}',
              ndjson: false,
            }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const demo = securityRouter.createCaller({
        user: {
          id: actor,
          role: "admin",
          openId: "demo-admin",
          email: "shared@example.test",
        },
        req: { headers: {} },
        res: {},
      } as any);
      expect((await demo.availability()).canAdmin).toBe(false);
      expect(await demo.assignees()).toEqual([]);
      await expect(
        demo.retention({ days: 30, reason: "Forbidden shared change" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const anonymous = securityRouter.createCaller({
        user: null,
        req: { headers: {} },
        res: {},
      } as any);
      await expect(anonymous.overview()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
    it("escalates certificate severity with immutable evidence and reopens accepted risk", async () => {
      const s = await source();
      const cert = (days: number) =>
        event(s, {
          eventType: "tls.certificate_observed",
          attributes: {
            endpointRef: "supplied-cert",
            notBefore: new Date(Date.now() - 60 * 86400000).toISOString(),
            notAfter: new Date(Date.now() + days * 86400000).toISOString(),
            fingerprintSha256: "a".repeat(64),
          },
        });
      await ingest(s.id, [cert(10)]);
      const [f] = (await findings(filters.parse({ sourceId: s.id }), false))
        .items;
      await act(
        {
          id: f.id,
          expectedVersion: f.version,
          action: "accept_risk",
          reason: "Short renewal review",
          riskUntil: new Date(Date.now() + 86400000).toISOString(),
          evidenceIds: [],
        },
        { id: actor, role: "admin" },
      );
      let d = await detail(f.id, false, false);
      const until = d.risk_until;
      await act(
        {
          id: f.id,
          expectedVersion: d.version,
          action: "note",
          reason: "Renewal work reviewed",
          evidenceIds: [],
        },
        { id: actor, role: "admin" },
      );
      d = await detail(f.id, false, false);
      expect(d.risk_until).toEqual(until);
      const initial = d.evidence[0].fingerprint;
      await ingest(s.id, [cert(-1)]);
      d = await detail(f.id, false, false);
      expect(d.severity).toBe("high");
      expect(d.status).toBe("open");
      expect(d.risk_until).toBeNull();
      expect(d.evidence.some((e) => e.fingerprint === initial)).toBe(true);
      expect(d.timeline.some((t) => t.action === "finding_escalated")).toBe(
        true,
      );
    });
    it("uses inclusive window boundaries and excludes the preceding millisecond", async () => {
      const anchor = new Date(),
        db = await database();
      for (const offset of [0, 1]) {
        const s = await source();
        const batch = Array.from({ length: 5 }, (_, n) =>
          event(s, {
            occurredAt: new Date(
              anchor.getTime() - (n === 0 ? 300000 + offset : 0),
            ).toISOString(),
          }),
        );
        await ingest(s.id, batch);
        const [stored] = await rows(
          db,
          sql`select * from security_events where source_id=${s.id} order by occurred_at desc limit 1`,
        );
        const [scoped] = await rows(
          db,
          sql`select * from security_sources where id=${s.id}`,
        );
        await db.transaction((tx) =>
          evaluate(tx, scoped, stored as any, anchor),
        );
        expect(
          (await findings(filters.parse({ sourceId: s.id }), false)).items
            .length,
        ).toBe(offset === 0 ? 1 : 0);
      }
    });
    it("rejects at the storage budget but continues to acknowledge identical retries", async () => {
      const s = await source(),
        e = event(s),
        db = await database();
      await ingest(s.id, [e]);
      const [old] = await rows(
        db,
        sql`select bytes from security_usage where singleton=true`,
      );
      try {
        await db.execute(
          sql`update security_usage set bytes=268435456 where singleton=true`,
        );
        expect((await ingest(s.id, [e])).accepted[0].status).toBe("duplicate");
        await expect(ingest(s.id, [event(s)])).rejects.toMatchObject({
          status: 429,
        });
      } finally {
        await db.execute(
          sql`update security_usage set bytes=${old.bytes} where singleton=true`,
        );
      }
      expect((await ingest(s.id, [event(s)])).accepted[0].status).toBe(
        "accepted",
      );
    });
    it("redacts administrative rule rationale from non-admin policy responses", async () => {
      await activateRule(
        {
          id: "authentication-burst",
          threshold: 5,
          windowSeconds: 300,
          enabled: true,
          reason: "Private owner review rationale",
        },
        actor,
      );
      const admin = await sourcePolicies(false, true),
        reader = await sourcePolicies(false, false);
      expect(JSON.stringify(admin.rules)).toContain(
        "Private owner review rationale",
      );
      expect(JSON.stringify(reader.rules)).not.toContain(
        "Private owner review rationale",
      );
      expect(
        reader.rules.every(
          (r: any) =>
            Object.keys(r.settings).sort().join(",") ===
            "enabled,threshold,windowSeconds",
        ),
      ).toBe(true);
    });
    it("parses supplied public certificate metadata and rejects private material", async () => {
      const s = await source(),
        { rootCertificates } = await import("node:tls");
      await expect(
        observeCertificate(
          {
            sourceId: s.id,
            endpointRef: "supplied-cert",
            pem: "-----BEGIN PRIVATE KEY-----",
            mode: "live",
          },
          actor,
        ),
      ).rejects.toMatchObject({ status: 422 });
      await observeCertificate(
        {
          sourceId: s.id,
          endpointRef: "supplied-cert",
          pem: rootCertificates[0],
          mode: "live",
        },
        actor,
      );
      const page = await events(
        filters.parse({ sourceId: s.id }),
        false,
        false,
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0].event_type).toBe("tls.certificate_observed");
      const attrs = page.items[0].envelope.attributes as any;
      expect(attrs.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Date.parse(attrs.notAfter)).toBeGreaterThan(
        Date.parse(attrs.notBefore),
      );
      await expect(
        observeCertificate(
          {
            sourceId: s.id,
            endpointRef: "unreviewed",
            pem: rootCertificates[0],
            mode: "live",
          },
          actor,
        ),
      ).rejects.toMatchObject({ status: 422 });
    });
    it("expires finite risk independently and rejects evidence-history edits", async () => {
      const s = await source();
      await ingest(
        s.id,
        Array.from({ length: 5 }, () => event(s)),
      );
      const [f] = (await findings(filters.parse({ sourceId: s.id }), false))
          .items,
        db = await database();
      await act(
        {
          id: f.id,
          expectedVersion: f.version,
          action: "accept_risk",
          reason: "Finite test acceptance",
          riskUntil: new Date(Date.now() + 86400000).toISOString(),
          evidenceIds: [],
        },
        { id: actor, role: "admin" },
      );
      await db.execute(
        sql`update security_findings set risk_until=now()-interval '1 second' where id=${f.id}`,
      );
      await sweep();
      const d = await detail(f.id, false, false);
      expect(d.status).toBe("open");
      expect(
        d.timeline.some((t) => t.action === "risk_acceptance_expired"),
      ).toBe(true);
      await expect(
        db.execute(
          sql`update security_events set quality='bad' where source_id=${s.id}`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          sql`update security_finding_evidence set snapshot='{}'::jsonb where finding_id=${f.id}`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          sql`update security_audit set detail='{}'::jsonb where finding_id=${f.id}`,
        ),
      ).rejects.toThrow();
    });
    it("uses source-scoped hashed credentials and revokes/rotates them", async () => {
      const s = await source();
      expect((await sourceCredential(s.token)).id).toBe(s.id);
      const [stored] = await rows(
        await database(),
        sql`select token_hash from security_sources where id=${s.id}`,
      );
      expect(stored.token_hash).toBe(digest(s.token));
      expect(stored.token_hash).not.toContain(s.token);
      const rotated = await credentialAction(s.id, "rotate", actor);
      await expect(sourceCredential(s.token)).rejects.toMatchObject({
        status: 401,
      });
      expect((await sourceCredential(rotated.token!)).id).toBe(s.id);
      await credentialAction(s.id, "revoke", actor);
      await expect(sourceCredential(rotated.token!)).rejects.toMatchObject({
        status: 401,
      });
    });
    it("serializes concurrent identical retries and rejects conflicting content atomically", async () => {
      const s = await source(),
        e = event(s);
      const r = await Promise.all([ingest(s.id, [e]), ingest(s.id, [e])]);
      expect(
        r
          .flatMap((v) => v.accepted)
          .map((v) => v.status)
          .sort(),
      ).toEqual(["accepted", "duplicate"]);
      const fresh = event(s);
      await expect(
        ingest(s.id, [fresh, { ...e, summary: "different" }]),
      ).rejects.toMatchObject({ status: 409 });
      const p = await events(filters.parse({ sourceId: s.id }), false, false);
      expect(p.items).toHaveLength(1);
      expect(p.items[0].envelope).toMatchObject({
        sourceEventId: e.sourceEventId,
      });
    });
    it("rejects namespace/mode violations before persistence", async () => {
      const s = await source(),
        otherSource = await source(["simulated"]);
      await expect(ingest(otherSource.id, [event(s)])).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (
          await events(
            filters.parse({ sourceId: otherSource.id }),
            false,
            false,
          )
        ).items,
      ).toHaveLength(0);
    });
    it("preserves replay and simulation as separate finding scopes and never emits live notifications for either", async () => {
      const s = await source(["simulated", "replay"]);
      for (const mode of ["simulated", "replay"])
        await ingest(
          s.id,
          Array.from({ length: 5 }, () =>
            event(s, {
              mode,
              [mode === "simulated" ? "scenarioRunId" : "replayRunId"]: "run-1",
            }),
          ),
        );
      const fs = await findings(filters.parse({ sourceId: s.id }), false);
      expect(fs.items.map((v) => v.mode).sort()).toEqual([
        "replay",
        "simulated",
      ]);
      const [{ count }] = await rows(
        await database(),
        sql`select count(*)::int as count from notification_inbox where "securityFindingId" in(select id from security_findings where source_id=${s.id})`,
      );
      expect(count).toBe(0);
    });
    it("persists assigned lifecycle decisions, evidence and recurrence without clearing the observed condition", async () => {
      const s = await source();
      await ingest(
        s.id,
        Array.from({ length: 5 }, () => event(s)),
      );
      const [f] = (await findings(filters.parse({ sourceId: s.id }), false))
        .items;
      expect(f).toBeTruthy();
      let d = await detail(f.id, false, false);
      expect(d.evidence.length).toBeGreaterThanOrEqual(5);
      await expect(
        act(
          {
            id: f.id,
            expectedVersion: d.version,
            action: "resolve",
            reason: "Inspect evidence",
            evidenceIds: [],
          },
          { id: actor, role: "admin" },
        ),
      ).rejects.toMatchObject({ status: 422 });
      await act(
        {
          id: f.id,
          expectedVersion: d.version,
          action: "assign",
          reason: "Assigned for review",
          assignee: other,
          evidenceIds: [],
        },
        { id: actor, role: "admin" },
      );
      d = await detail(f.id, false, false);
      await expect(
        act(
          {
            id: f.id,
            expectedVersion: d.version,
            action: "resolve",
            reason: "Not my assignment",
            evidenceIds: [d.evidence[0].event_id],
          },
          { id: actor, role: "engineer" },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await act(
        {
          id: f.id,
          expectedVersion: d.version,
          action: "resolve",
          reason: "Reviewed as authorized test",
          evidenceIds: [d.evidence[0].event_id],
        },
        { id: other, role: "engineer" },
      );
      d = await detail(f.id, false, false);
      expect(d.status).toBe("resolved");
      expect(d.condition_active).toBe(true);
      await ingest(s.id, [event(s)]);
      d = await detail(f.id, false, false);
      expect(d.status).toBe("open");
      expect(d.recurrences).toBe(1);
      expect(d.timeline.some((t) => t.action === "investigation_resolve")).toBe(
        true,
      );
      expect(d.evidence.length).toBeGreaterThan(5);
    });
    it("requires administrator risk acceptance and finite expiry", async () => {
      const s = await source();
      await ingest(
        s.id,
        Array.from({ length: 5 }, () => event(s)),
      );
      const [f] = (await findings(filters.parse({ sourceId: s.id }), false))
        .items;
      await expect(
        act(
          {
            id: f.id,
            expectedVersion: f.version,
            action: "accept_risk",
            reason: "Risk reviewed",
            riskUntil: new Date(Date.now() + 86400000).toISOString(),
            evidenceIds: [],
          },
          { id: other, role: "engineer" },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await act(
        {
          id: f.id,
          expectedVersion: f.version,
          action: "accept_risk",
          reason: "Temporary review period",
          riskUntil: new Date(Date.now() + 86400000).toISOString(),
          evidenceIds: [],
        },
        { id: actor, role: "admin" },
      );
      await ingest(s.id, [event(s)]);
      expect((await detail(f.id, false, false)).status).toBe("accepted_risk");
    });
    it("requires an approved baseline and reviewed identity allowlist", async () => {
      const s = await source(),
        cfg = {
          eventType: "config.changed",
          attributes: { configRevision: "new", changedKeys: ["users.roles"] },
        };
      await ingest(s.id, [event(s, cfg)]);
      expect(
        (await findings(filters.parse({ sourceId: s.id }), false)).items,
      ).toHaveLength(0);
      const b = await proposeBaseline(
        {
          sourceId: s.id,
          revision: "baseline-1",
          configRevision: "approved",
          relevantKeys: ["users.roles"],
          reason: "Reviewed configuration baseline",
        },
        actor,
      );
      await approveBaseline(b.id, actor);
      await ingest(s.id, [
        event(s, cfg),
        event(s, {
          eventType: "identity.unrecognized",
          attributes: {
            inputRef: "not-reviewed",
            observedIdentityRef: "stranger",
          },
        }),
        event(s, {
          eventType: "identity.unrecognized",
          attributes: {
            inputRef: "local-mqtt",
            observedIdentityRef: "stranger",
          },
        }),
      ]);
      const fs = await findings(filters.parse({ sourceId: s.id }), false);
      expect(fs.items.map((f) => f.rule_id).sort()).toEqual([
        "configuration-drift",
        "unrecognized-identity",
      ]);
    });
    it("keeps future/poor-quality/stale live evidence out of intrusion findings", async () => {
      const s = await source();
      for (const change of [
        { occurredAt: new Date(Date.now() + 600000).toISOString() },
        { occurredAt: new Date(Date.now() - 2 * 86400000).toISOString() },
        { quality: "bad" },
      ])
        await ingest(
          s.id,
          Array.from({ length: 6 }, () => event(s, change)),
        );
      expect(
        (await findings(filters.parse({ sourceId: s.id }), false)).items,
      ).toHaveLength(0);
    });
    it("replays historical evidence against its historical window", async () => {
      const s = await source(["replay"]);
      await ingest(
        s.id,
        Array.from({ length: 5 }, (_, n) =>
          event(s, {
            mode: "replay",
            replayRunId: "historical",
            occurredAt: new Date(
              Date.now() - 90 * 86400000 + n * 1000,
            ).toISOString(),
          }),
        ),
      );
      const fs = await findings(filters.parse({ sourceId: s.id }), false);
      expect(fs.items).toHaveLength(1);
      expect(fs.items[0].mode).toBe("replay");
    });
    it("supports a strict scoped report, retains unknown provenance and preserves its original hash", async () => {
      const s = await source(),
        raw = JSON.stringify({
          SchemaVersion: 2,
          CreatedAt: new Date().toISOString(),
          ArtifactName: "fixture-image",
          ArtifactType: "container_image",
          Results: [
            {
              Target: "image",
              Class: "os-pkgs",
              Type: "alpine",
              Vulnerabilities: [
                {
                  VulnerabilityID: "CVE-2026-12345",
                  PkgName: "fixture-package",
                  InstalledVersion: "1.0.0",
                  Severity: "HIGH",
                  Title: "Unverified scanner report",
                },
              ],
            },
          ],
        });
      const p = {
        mode: "unknown" as const,
        producerVersion: "fixture-scanner-1",
      };
      const report = await importReport(
        raw,
        s.id,
        { kind: "application", id: null },
        actor,
        p,
      );
      expect(
        (
          await importReport(
            raw,
            s.id,
            { kind: "application", id: null },
            actor,
            p,
          )
        ).duplicate,
      ).toBe(true);
      const [stored] = await rows(
        await database(),
        sql`select * from security_imports where id=${report.id}`,
      );
      expect(stored.original_sha256).toBe(digest(raw));
      expect(stored.provenance.mode).toBe("unknown");
      const db = await database(),
        [budget] = await rows(
          db,
          sql`select bytes from security_usage where singleton=true`,
        );
      try {
        await db.execute(
          sql`update security_imports set processing_attempts=11 where id=${report.id}`,
        );
        await db.execute(
          sql`update security_usage set bytes=268435456 where singleton=true`,
        );
        await processReportChunk();
        const [paused] = await rows(
          db,
          sql`select * from security_imports where id=${report.id}`,
        );
        expect(paused.processing_state).toBe("quarantined");
        expect(paused.processing_cursor).toBe(0);
        expect(paused.last_error).toBe("analysis_capacity");
      } finally {
        await db.execute(
          sql`update security_usage set bytes=${budget.bytes} where singleton=true`,
        );
      }
      await retryReport(
        report.id,
        "Capacity recovered; authorized analysis retry",
        actor,
      );
      await processReportChunk();
      const [complete] = await rows(
        db,
        sql`select processing_state,processing_cursor from security_imports where id=${report.id}`,
      );
      expect(complete.processing_state).toBe("complete");
      expect(complete.processing_cursor).toBe(1);
      const fs = await findings(filters.parse({ sourceId: s.id }), false);
      expect(fs.items[0].mode).toBe("unknown");
      expect(fs.items[0].confidence).toBe("scanner_reported_candidate");
      await expect(
        importReport(raw, s.id, { kind: "application", id: null }, actor, {
          mode: "live",
          producerVersion: "fixture-scanner-1",
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("makes exports scoped, redacted and formula safe", async () => {
      const s = await source();
      await ingest(s.id, [event(s, { summary: '=HYPERLINK("untrusted")' })]);
      const viewer = await events(
        filters.parse({ sourceId: s.id }),
        false,
        true,
      );
      expect(viewer.items[0].envelope).toMatchObject({
        summary: "Redacted security evidence",
      });
      const csv = await exportEvents(
        filters.parse({ sourceId: s.id }),
        false,
        "csv",
      );
      expect(csv.body).toContain("'=HYPERLINK");
      const json = await exportEvents(
        filters.parse({ sourceId: s.id }),
        false,
        "json",
      );
      expect(JSON.parse(json.body).events).toHaveLength(1);
    });
    it("quarantines invalid stored deliveries while retrying capacity failures and preserving event identity", async () => {
      const db = await database(),
        bad = randomUUID();
      await db.execute(
        sql`insert into security_outbox(id,producer,event_type,attributes) values(${bad},'dotnet-services','auth.authentication_failed','{}'::jsonb)`,
      );
      await drainOutbox();
      const [r] = await rows(
        db,
        sql`select * from security_outbox where id=${bad}`,
      );
      expect(r.quarantined_at).toBeTruthy();
      expect(r.delivered_at).toBeNull();
      await db.execute(sql`delete from security_outbox where id=${bad}`);
    });
  },
);
