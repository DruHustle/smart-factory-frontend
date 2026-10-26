import { individualSecurityUser } from "./users";
import { reserve } from "./quota";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  SecurityError,
  digest,
  type Evidence,
  type RecordedEvidence,
} from "./contract";
import { audit, rows, type Conn } from "./store";
type EventRow<T = RecordedEvidence> = {
  id: string;
  envelope: T;
  target: any;
  installed_component_id: string | null;
  clock_skew: boolean;
};
export async function finding(
  c: Conn,
  s: any,
  r: any,
  e: EventRow,
  detail: {
    title: string;
    category?: string;
    severity: string;
    confidence: string;
    observed: unknown;
    expected: unknown;
    checks: string[];
    group?: string;
    baselineId?: string;
  },
  evidence: EventRow[],
  now: Date,
) {
  const run = e.envelope.scenarioRunId ?? e.envelope.replayRunId ?? null;
  const key = digest({
    source: s.id,
    rule: r.id,
    version: r.version,
    baseline: detail.baselineId ?? null,
    target: e.target,
    component: e.installed_component_id,
    mode: e.envelope.mode,
    run,
    group: detail.group ?? null,
  });
  const [prior] = await rows(
    c,
    sql`select * from security_findings where fingerprint=${key} for update`,
  );
  const id = prior?.id ?? randomUUID(),
    until = new Date(
      now.getTime() + r.settings.windowSeconds * 1000,
    ).toISOString();
  const rank: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  const escalated = !!prior && rank[detail.severity] > rank[prior.severity];
  const reopen =
    prior &&
    ["resolved", "dismissed", "accepted_risk"].includes(prior.status) &&
    (escalated ||
      !(prior.status === "accepted_risk" && new Date(prior.risk_until) > now));
  if (!prior) {
    const [{ count }] = await rows(
      c,
      sql`select count(*)::int as count from security_findings`,
    );
    if (count >= 10000) throw new SecurityError(429, "finding_capacity");
    await reserve(c, Buffer.byteLength(JSON.stringify(detail)) + 1024, 0, 0, 1);
    await c.execute(
      sql`insert into security_findings(id,fingerprint,source_id,rule_id,rule_version,baseline_id,title,category,severity,confidence,target,installed_component_id,mode,run_id,explanation,first_seen,last_seen,condition_until) values(${id},${key},${s.id},${r.id},${r.version},${detail.baselineId ?? null},${detail.title},${detail.category ?? "security"},${detail.severity},${detail.confidence},${e.target ? JSON.stringify(e.target) : null}::jsonb,${e.installed_component_id},${e.envelope.mode},${run},${JSON.stringify({ observed: detail.observed, expected: detail.expected, checks: detail.checks, windowSeconds: r.settings.windowSeconds, basis: detail.confidence })}::jsonb,${e.envelope.occurredAt},${e.envelope.occurredAt},${until})`,
    );
  } else
    await c.execute(
      sql`update security_findings set last_seen=greatest(last_seen,${e.envelope.occurredAt}::timestamptz),condition_until=${until},condition_active=true,occurrences=occurrences+1,recurrences=recurrences+${reopen ? 1 : 0},severity=case when ${escalated} then ${detail.severity} else severity end,title=case when ${escalated} then ${detail.title} else title end,status=case when ${!!reopen} then 'open' else status end,risk_until=case when ${!!reopen} then null else risk_until end,version=version+1 where id=${id}`,
    );
  const [{ count }] = await rows(
    c,
    sql`select count(*)::int as count from security_finding_evidence where finding_id=${id}`,
  );
  // Reserve four snapshots for severity escalation after the routine history cap.
  for (const item of evidence.slice(
    0,
    Math.max(0, (escalated ? 104 : 100) - count),
  )) {
    const inserted = await rows(
      c,
      sql`insert into security_finding_evidence(finding_id,event_id,source_id,snapshot,fingerprint) values(${id},${item.id},${s.id},${JSON.stringify(item.envelope)}::jsonb,${digest(item.envelope)}) on conflict do nothing returning event_id`,
    );
    if (inserted.length)
      await reserve(c, Buffer.byteLength(JSON.stringify(item.envelope)) + 256);
  }
  if (escalated)
    await audit(
      c,
      "finding_escalated",
      null,
      {
        previousSeverity: prior.severity,
        severity: detail.severity,
        observed: detail.observed,
        expected: detail.expected,
      },
      id,
      s.id,
    );
  if (!prior || reopen || escalated) {
    await audit(
      c,
      reopen
        ? "finding_recurred"
        : escalated
          ? "escalation_notified"
          : "finding_opened",
      null,
      { rule: r.id, version: r.version, mode: e.envelope.mode },
      id,
      s.id,
    );
    // The existing per-user inbox/email delivery mechanism owns notifications.
    // Simulation/replay never creates live operational alerts or live email.
    if (e.envelope.mode === "live" && !s.is_demo)
      await c.execute(
        sql`insert into notification_inbox("userId",kind,title,body,"securityFindingId","emailStatus") select id,'security_finding',${detail.title},'Review the evidence and versioned security rule in Cybersecurity.',${id},'pending' from users where role in ('engineer','admin') and ${individualSecurityUser()}`,
      );
  }
  return id;
}
export async function evaluate(
  c: Conn,
  s: any,
  e: EventRow<Evidence>,
  now = new Date(),
) {
  const p = e.envelope,
    a = p.attributes;
  if (p.mode === "replay") {
    const [anchor] = await rows(
      c,
      sql`select max(occurred_at) as at from security_events where source_id=${s.id} and mode='replay' and clock_skew=false and envelope->>'replayRunId'=${p.replayRunId ?? ""}`,
    );
    now = new Date(anchor?.at ?? p.occurredAt);
  }
  if (
    e.clock_skew ||
    p.quality !== "good" ||
    e.target === null ||
    now.getTime() - Date.parse(p.occurredAt) > 86400000
  )
    return;
  const rules = await rows(
    c,
    sql`select * from security_rules where active=true`,
  );
  const [baseline] = await rows(
    c,
    sql`select * from security_baselines where source_id=${s.id} and approved_at is not null order by approved_at desc limit 1`,
  );
  const invoke = async (
    id: string,
    detail: Parameters<typeof finding>[4],
    evidence: EventRow[] = [e],
  ) => {
    const r = rules.find((r) => r.id === id && r.settings.enabled);
    if (r) await finding(c, s, r, e, detail, evidence, now);
  };
  if (
    p.eventType === "auth.authentication_failed" ||
    p.eventType === "auth.authorization_denied"
  ) {
    const ruleId =
        p.eventType === "auth.authentication_failed"
          ? "authentication-burst"
          : "authorization-burst",
      r = rules.find((r) => r.id === ruleId && r.settings.enabled);
    if (
      r &&
      Date.parse(p.occurredAt) >=
        now.getTime() - r.settings.windowSeconds * 1000
    ) {
      const events = await rows(
        c,
        sql`select id,envelope,target,installed_component_id,clock_skew from security_events where source_id=${s.id} and event_type=${p.eventType} and mode=${p.mode} and clock_skew=false and quality='good' and occurred_at>=${new Date(now.getTime() - r.settings.windowSeconds * 1000).toISOString()} and occurred_at<=${now.toISOString()} and coalesce(envelope->>'scenarioRunId',envelope->>'replayRunId','')=${p.scenarioRunId ?? p.replayRunId ?? ""} and envelope->'attributes'->>'service'=${String(a.service)} and coalesce(envelope->'attributes'->>'principalRef','')=${String(a.principalRef ?? "")} order by occurred_at desc limit 101`,
      );
      if (events.length >= r.settings.threshold)
        await invoke(
          ruleId,
          {
            title:
              ruleId === "authentication-burst"
                ? "Repeated rejected sign-ins"
                : "Repeated denied privileged requests",
            severity: "medium",
            confidence: "observed_pattern",
            observed: { count: events.length, service: a.service },
            expected: {
              maximum: r.settings.threshold - 1,
              windowSeconds: r.settings.windowSeconds,
            },
            checks: [
              "Inspect the normalized outcomes and their time window.",
              "Confirm whether these were expected user errors or an authorized test.",
              "Investigate account/service access without changing plant controls.",
            ],
            group:
              String(a.service) + ":" + String(a.principalRef ?? "anonymous"),
          },
          events as EventRow[],
        );
    }
  }
  if (
    p.eventType === "tls.certificate_observed" &&
    s.policy.connections?.includes(a.endpointRef)
  ) {
    const r = rules.find(
        (r) => r.id === "certificate-expiry" && r.settings.enabled,
      ),
      remaining = (Date.parse(String(a.notAfter)) - now.getTime()) / 86400000;
    if (r && remaining <= r.settings.threshold)
      await invoke("certificate-expiry", {
        title:
          remaining <= 0
            ? "Observed certificate has expired"
            : "Observed certificate approaches expiry",
        severity: remaining <= 0 ? "high" : "medium",
        confidence: "reported_certificate",
        observed: {
          notAfter: a.notAfter,
          fingerprintSha256: a.fingerprintSha256,
          endpointRef: a.endpointRef,
        },
        expected: { minimumRemainingDays: r.settings.threshold },
        checks: [
          "Verify this fingerprint belongs to the configured connection.",
          "Review certificate-chain and renewal evidence separately; this observation does not prove connection trust.",
        ],
        group: String(a.endpointRef),
      });
  }
  if (
    (p.eventType === "config.changed" ||
      p.eventType === "config.drift_observed") &&
    baseline?.settings.configRevision &&
    baseline.settings.configRevision !== a.configRevision
  ) {
    const relevant = (a.changedKeys as string[]).filter((k) =>
      baseline.settings.relevantKeys.includes(k),
    );
    if (relevant.length)
      await invoke("configuration-drift", {
        title: "Reviewed security configuration differs from baseline",
        severity: "medium",
        confidence: "declared_configuration",
        observed: { revision: a.configRevision, changedKeys: relevant },
        expected: { revision: baseline.settings.configRevision },
        baselineId: baseline.id,
        checks: [
          "Compare the approved revision with the applied configuration record.",
          "Confirm change authorization; no secret configuration values are collected.",
        ],
      });
  }
  if (p.eventType === "identity.unrecognized") {
    const input = s.policy.inputs.find((v: any) => v.inputRef === a.inputRef);
    if (input && !input.allowedIdentities.includes(a.observedIdentityRef))
      await invoke("unrecognized-identity", {
        title: "Identity outside a reviewed input allowlist",
        severity: "medium",
        confidence: "reported_identity",
        observed: {
          inputRef: a.inputRef,
          observedIdentityRef: a.observedIdentityRef,
        },
        expected: { reviewedAllowlist: true },
        group: String(a.inputRef),
        checks: [
          "Review the configured input and identity mapping.",
          "Treat the payload as a source observation; it does not establish device attestation or intrusion.",
        ],
      });
  }
  if (
    p.eventType === "collector.health" &&
    ["offline", "degraded", "paused"].includes(String(a.state))
  )
    await invoke("collector-coverage", {
      title: "Security collector reports a coverage gap",
      category: "coverage",
      severity: "low",
      confidence: "source_reported",
      observed: { state: a.state },
      expected: { state: "online" },
      checks: [
        "Check collector health, timestamps and queue status.",
        "A coverage gap alone is not evidence of compromise.",
      ],
    });
  if (
    p.eventType === "transport.connection_observed" &&
    a.tlsActive === false &&
    s.policy.connections?.includes(a.connectionRef)
  )
    await invoke("plaintext-transport", {
      title: "Configured connection has no observed TLS",
      severity: "medium",
      confidence:
        a.evidenceBasis === "runtime_socket"
          ? "source_reported_socket"
          : "declared_configuration",
      observed: {
        connectionRef: a.connectionRef,
        protocol: a.protocol,
        tlsActive: false,
        basis: a.evidenceBasis,
      },
      expected: { tls: baseline?.settings.expectedTls ?? "review required" },
      group: String(a.connectionRef),
      checks: [
        "Verify the configured connection and observed socket evidence.",
        "Assess network segmentation and any independently verified protected tunnel separately. This fact does not establish broker ACLs or prove intrusion.",
      ],
    });
  if (
    p.eventType === "integrity.change_observed" &&
    a.previousSha256 !== a.currentSha256
  )
    await invoke("integrity-change", {
      title: "Reported artifact integrity changed",
      severity: "medium",
      confidence: "source_claimed_" + String(a.evidenceBasis),
      observed: { sha256: a.currentSha256, basis: a.evidenceBasis },
      expected: {
        previousSha256: a.previousSha256,
        approvedSha256: baseline?.settings.integritySha256 ?? "unknown",
      },
      baselineId: baseline?.id,
      checks: [
        "Compare hashes with the approved artifact/change record.",
        "A self-reported hash or a verified_artifact label does not prove signing or hardware attestation.",
      ],
    });
}
