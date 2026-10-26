import { sql } from "drizzle-orm";
import { rows, securityTransaction, audit } from "./store";
import { finding } from "./rules";
import { trivy } from "./reports";
import { SecurityError } from "./contract";
import type { RecordedEvidence } from "./contract";
/** At most twenty candidates per transaction; uploads never wait for bulk rule work. */
export async function processReportChunk() {
  let jobId: string | null = null;
  try {
    return await securityTransaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
      const [report] = await rows(
        tx,
        sql`select i.*,s.is_demo from security_imports i join security_sources s on s.id=i.source_id where i.processing_state='queued' and i.next_attempt<=now() order by i.created_at for update of i skip locked limit 1`,
      );
      if (!report) return false;
      jobId = report.id;
      const parsed = trivy.safeParse(report.report),
        [rule] = await rows(
          tx,
          sql`select * from security_rules where id='reported-vulnerability' and version=${report.rule_version}`,
        );
      if (!parsed.success || !rule) {
        await tx.execute(
          sql`update security_imports set processing_state='failed',last_error='unsupported_stored_report_or_rule' where id=${report.id}`,
        );
        await audit(
          tx,
          "report_processing_quarantined",
          null,
          { id: report.id, code: "unsupported_stored_report_or_rule" },
          null,
          report.source_id,
        );
        return true;
      }
      const entries = parsed.data.Results.flatMap((r) => r.Vulnerabilities),
        cursor = report.processing_cursor ?? 0;
      const event = {
        id: report.evidence_id,
        envelope: report.event_snapshot as RecordedEvidence,
        target: report.target,
        installed_component_id: null,
        clock_skew: false,
      };
      for (const v of entries.slice(cursor, cursor + 20))
        await finding(
          tx,
          { id: report.source_id, is_demo: report.is_demo },
          rule,
          event,
          {
            title: `${v.VulnerabilityID}: ${v.PkgName}`.slice(0, 200),
            severity:
              v.Severity === "UNKNOWN" ? "low" : v.Severity.toLowerCase(),
            confidence: "scanner_reported_candidate",
            observed: {
              package: v.PkgName,
              installedVersion: v.InstalledVersion,
              advisory: v.VulnerabilityID,
              advisorySeverity: v.Severity,
              advisoryCvss: v.CVSS?.nvd?.V3Score ?? null,
              reportId: report.id,
              sha256: report.original_sha256,
              producedAt: report.produced_at,
            },
            expected: {
              fixedVersion: v.FixedVersion ?? "unknown",
              applicability: "requires inventory and operational review",
            },
            group: `${v.VulnerabilityID}:${v.PkgName}:${v.InstalledVersion}`,
            checks: [
              "Verify the scanner artifact scope and exact installed package/version.",
              "Separate advisory severity/CVSS from exploitability and local priority.",
              "An application-image finding applies only to this reviewed scope, not every factory asset.",
            ],
          },
          [event],
          new Date(),
        );
      const next = Math.min(entries.length, cursor + 20),
        complete = next === entries.length;
      await tx.execute(
        sql`update security_imports set processing_cursor=${next},processing_attempts=0,processing_state=${complete ? "complete" : "queued"},last_error=null where id=${report.id}`,
      );
      if (complete)
        await audit(
          tx,
          "report_analysis_completed",
          null,
          {
            id: report.id,
            candidates: entries.length,
            ruleVersion: report.rule_version,
          },
          null,
          report.source_id,
        );
      return true;
    });
  } catch (error) {
    if (!jobId) throw error;
    await securityTransaction(async (tx) => {
      await tx.execute(
        sql`update security_imports set processing_attempts=processing_attempts+1,next_attempt=now()+(least(300,power(2,least(8,processing_attempts+1)))*interval '1 second'),processing_state=case when processing_attempts+1>=12 then 'quarantined' else 'queued' end,last_error=${error instanceof SecurityError && error.status === 429 ? "analysis_capacity" : "analysis_unconfirmed"} where id=${jobId} and processing_state='queued'`,
      );
    });
    return true;
  }
}
