# Service health and recovery evidence

Open **Infrastructure → Service health** on a private installation using an
individual administrator account. Overview, Services, Resources, Queues,
Collectors, History and Recovery expose recorded installation evidence. The
workspace has no restart, purge, deployment or hardware control actions.

Shared demo accounts and the Demo data workspace receive fixed synthetic
normal, failure and recovery scenarios. They do not collect private dependency,
process or queue evidence. Individual viewers, operators and engineers cannot
read the private infrastructure API or its notifications.

## Interpreting the evidence

| Evidence | Meaning |
| --- | --- |
| Application process | Liveness and resources for the measured process, not the VM or cloud account. |
| Configured readiness probe | The approved endpoint responded; this does not prove physical equipment availability. |
| Database sessions and size | The current application database; no provider-wide quota or memory allowance is inferred. |
| Worker receipt | Authenticated, timestamped worker evidence. Stale values retain their timestamps and cannot establish current delivery. |
| Pending, quarantined and failed deliveries | Separate queue states. Queue age uses acceptance time; unknown acceptance remains unknown. |
| History coverage | Recorded samples and missing collection intervals in the selected range. This is not independently measured uptime. |
| Backup and restore receipts | Separate operator-supplied attestations. A backup receipt never establishes a successful restore. |

Select a service or queue to inspect its source, timestamps, scope and reason.
Review missing and stale evidence before treating a status as current. An
unconfigured optional integration is distinct from a failed configured service.

## Collection and notifications

Collection defaults to demand-driven reads, cached for one minute. Probes use
bounded deadlines and the existing database pool; they do not add a monitoring
connection pool. A database lease deduplicates collection across replicas.

For continuous private-installation collection, an operator may configure
`INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS` to a whole number from 60 to 900.
Invalid or absent values retain demand collection. Shared-demo deployments
disable actual scheduled infrastructure collection. A page refresh is not an
independent monitor when the application itself is unavailable.

`INFRASTRUCTURE_FRONTEND_ORIGIN` optionally selects the approved frontend HTTPS
origin; otherwise the configured allowed application origin is used. Collection
targets come from operator configuration, never visitor input. Do not put
credentials in URLs.

Sustained problems and recoveries create deduplicated administrator inbox
notifications. Default incident and recovery durations are 120 and 60 seconds;
missing checks interrupt continuity. `INFRASTRUCTURE_EMAIL_ENABLED=true` opts
these notifications into the existing configured email delivery policy. Email
rechecks the current administrator role before sending. Provider acceptance
does not prove mailbox delivery.

Snapshots retain at most 24 hours and 1,440 samples; infrastructure events retain
at most seven days and 500 records. Event expiry removes the detailed event
link while preserving the owner's recorded notification and delivery history.
Demoted administrators cannot read that private history.

## Recovery receipts

Record only metadata from an actual independently verified procedure. The
operator CLI reads a bounded receipt from standard input:

```bash
INFRASTRUCTURE_RECEIPT_WRITE_APPROVED=owner-verified-receipt \
  node --import tsx scripts/infrastructure/record-recovery.ts < verified-receipt.json
```

The configured database must belong to the intended installation. Receipts
include a unique identity, kind, observation time, outcome, evidence source,
scope and artifact checksum. A reused identity must match exactly. A restore
receipt requires the `disposable-restore-drill` evidence source; it does not
claim a production restore. Failed attempts remain distinct from the most
recent verified backup.

An optional `/api/internal/recovery-status` intake requires a dedicated
`INFRASTRUCTURE_RECOVERY_TOKEN` of at least 32 bytes. Ordinary user sessions and
unrelated service tokens cannot import receipts. Never include credentials,
backup contents or recipient addresses in a receipt.

Follow the [operating guide](operations.md) and [API-first deployment
runbook](../deploy/oracle/README.md) for actual recovery or software promotion.
