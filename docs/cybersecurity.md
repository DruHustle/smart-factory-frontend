# Independent OT cybersecurity workspace

Smart Factory owns this workspace, its validators, rules, evidence, fixtures and UI. It needs the existing primary PostgreSQL database and application authentication. It does not require Onesa, a model provider, a SIEM, a vulnerability feed, a gateway or WebGL. Security failures do not change the telemetry, control, AAS or login decisions being observed. This release does not perform remediation, scans, remote commands or physical commissioning.

The persistent Cybersecurity navigation has Overview, Asset posture, Events, Findings, Incidents, and Sources and policies. Asset and device details link to scoped findings. Overview reports configured-source coverage, explicitly unknown controls and live receipt freshness, rather than a Secure score. Events have source/event/ingestion/expiry times, mode, quality, clock-skew and late flags. Filter state persists in local storage; evidence and credentials do not. Results are pages of 50, bounded to 201 pages. Exports contain the selected page and report whether another page exists.

## Setup and native demonstration

Apply the normal additive Drizzle migrations, including `0022_ot_security.sql`. The module starts inside the existing Node server; there is no new daemon or database. `SECURITY_ENABLED=false` disables capture and writes and hides the workspace. Unconfigured collectors remain unknown. Node and .NET events use the existing primary database outbox; the API owns deterministic processing independently of the singleton MQTT worker.

Use an individual engineer/admin on a private installation (`ENABLE_DEMO_ACCOUNTS=false`) for changes. The existing global public-demonstration mode and known shared demo identities are read-only, including exports restricted by role. Do not disable a public installation's demonstration boundary to test private administration; use the isolated runner.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm e2e:security
```

The runner provisions and removes its own local PostgreSQL/Redis project, migrates from empty, seeds individual fixture roles, clears peer/provider configuration and starts the app in standalone mode. Actual rejected HTTP sign-ins/privileged requests are classified `simulated` with `actual-isolated-requests`, never as a physical attack. The UI journeys configure a source, import a file, inspect evidence, assign/acknowledge/investigate/resolve, reload, repeat evidence and test narrow/light/dark layouts. An explicit mapping exercises equipment focus; security investigations also work as lists.

Private engineers can select **Load local security demonstration**. It creates separate authored simulation and historical replay runs with sign-in failures, denials, certificate warning, reviewed configuration drift, identity allowlist mismatch, coverage outage, transport and integrity examples. The simulated authentication finding has an explicit repeat action for recurrence after resolution. These sources cannot be given an external credential. Fixed exchange fixtures in `fixtures/security/v1` are independently maintained examples; timestamps are historical, not a fake live clock. Use the native demonstration for current simulated evidence.

## Data flow and identities

Actual Node authentication failures, role-guard denials, successful role changes and rejected internal ingestion decisions create sanitized events after the relevant decision. Principal references are HMAC-SHA256 pseudonyms under the existing session key; no passwords, cookies, request bodies, raw account names or IP addresses are collected. .NET DashboardAccess records actual private authentication/authorization decisions; DeviceService observes its existing API JWT decisions. Neither path lets the requester choose producer, source or target authority. Capture is bounded and failures leave the original decision intact with capture diagnostics or a bounded .NET warning.

The Node outbox drains at most 100 due events per sweep, retains their complete original envelope through retries and marks delivery only after ingestion acknowledgement. Attempts use exponential backoff capped at 300 seconds, at most 12 attempts, with permanent rejections quarantined. Admins can inspect and authorize retries with an audit reason. Pending/quarantined work is capped at 10,000. Acknowledged delivery rows are pruned in batches when needed for capacity; unacknowledged evidence is never pruned to make room. Node capture has eight concurrent attempts and a 1.5-second database statement bound. Security writes acquire a separate in-process queue (16 waiting), advisory transaction locks, 1.5-second lock and 5-second statement limits before doing bounded work. They use the existing pool; no competing broker subscriber is added.

Sources authorize a reviewed set of local registered asset/device/application IDs, modes, event types, connection references, expected intervals and input allowlists. Credentials are one-time `sfsec` values stored only as SHA-256 hashes, scoped to ingestion, rotatable and revocable. A token cannot authenticate a user API, retrieve evidence or administer another source. Copy it into a collector's protected configuration; never browser storage. Rotating reactivates an explicitly revoked source and invalidates its old key.

A null external asset reference uses the single configured source scope. Non-null external references resolve only by an admin-reviewed namespace/asset/component mapping. Unmapped evidence is retained with unknown association and does not derive asset findings. Mapping changes apply to future events; existing evidence never silently acquires a new target. No IP, display name, MQTT client label or model coordinate establishes identity. Application-image imports require a reviewed scope and never propagate to every factory asset.

A supplied certificate is parsed with Node X509 from a public PEM, max 64 KiB, for an already configured symbolic connection reference. Private keys are rejected; URLs are never fetched. The rule checks validity dates and records the fingerprint, not certificate-chain or runtime connection trust.

## Observations, findings and incidents

`security_events` stores immutable normalized observations. `security_findings` stores rule-derived conditions, severity, confidence and workflow separately. `security_incidents` provides a focused assigned investigation linked to existing users and the per-user notification inbox, distinct from operational threshold alerts. The append-only audit and evidence snapshots preserve original rule/version, source, target, run, observed/expected facts and checks. Database triggers reject updates to event/snapshot/audit content; a privileged database administrator can still alter the database. This is not an external tamper-proof log.

Initial rule versions are immutable configuration snapshots; activating settings creates a new version. Existing findings retain their old version. Allowed settings are only enablement, threshold (1–100) and window (60–86,400 seconds); uploaded code/SQL/regular expressions are never executed.

| Rule | Initial behavior | Evidence limits |
| --- | --- | --- |
| authentication-burst | 5 rejected authentications / 300 seconds | Same source, service, pseudonymous principal, mode and run; quality good |
| authorization-burst | 3 real denials / 300 seconds | Same bounded grouping; no raw request data |
| certificate-expiry | Warning within 30 days; high severity when expired | Configured connection reference, real supplied/reported certificate dates |
| configuration-drift | Relevant keys differ from latest approved revision | Proposed baseline has no effect before approval |
| unrecognized-identity | Identity outside reviewed authorized-input allowlist | Unreviewed input yields no identity finding |
| collector-coverage | Reported offline/degraded/paused, or 3 missed expected live intervals | Coverage category, low severity; never proof of intrusion; interval 0 means event-driven |
| plaintext-transport | Configured connection reports no TLS | Local extension distinguishes reported existing socket from declaration; no ACL/path inference |
| integrity-change | Reported previous/current hashes differ | Self-report/collector/artifact labels stay source claims; no invented attestation |
| reported-vulnerability | Strict report package/version candidate | Scanner advisory severity/CVSS, unknown exploitability, reviewed artifact scope |

Auth windows include the exact lower boundary and exclude the preceding millisecond. Queries inspect at most 101 matching events. Future events more than five minutes ahead remain stored and marked clock-skew but do not derive findings. Late live evidence older than one day does not derive a current condition; earlier in-window evidence can contribute. Replay uses the historical maximum event time within its own replay run. Different modes/runs never share a finding or live notification. Evidence quality is not proof of authenticity.

Condition keys include source, rule version, approved baseline, target/component, mode/run and rule-specific group. New qualifying evidence updates a condition transactionally. Resolved/dismissed investigations reopen on recurrence. Accepted risk lasts no more than 30 days; expiry reopens explicitly, and higher severity reopens accepted risk immediately. Certificate escalation preserves the original explanation/snapshot and appends escalation evidence and audit. Routine snapshots are capped at 100, with four reserved for severity escalation; occurrence counters count qualifying evaluations, not unique raw events. First/last time and recurrence counts remain visible after snapshot saturation. Condition freshness expires separately from workflow status; resolution does not claim an active condition disappeared. A new healthy event alone is not proof that a different security condition was remediated.

Priority = severity rank (info 0, low 1, medium 2, high 3, critical 4) + reviewed asset criticality (unknown/low 0, medium 1, high 2). Confidence remains separate. The UI labels firmware/zone registry values and the existing AAS asset-device protocol/endpoint-scheme model as declarations, excludes endpoints/secrets, leaves authentication controls unknown without evidence, and displays imported package versions with scanner, mode and time. Fact freshness uses 24 hours in the posture presentation; per-rule condition windows and configured-source intervals remain explicit.

Live non-demo findings use the existing inbox/email delivery infrastructure for individual engineers/admins. Simulation and replay never create operational alerts or live email. Notification title/body are bounded, and links identify the security finding. Existing notification ownership checks still apply.

## Permissions

| Capability | Viewer / legacy user | Operator | Engineer | Admin |
| --- | --- | --- | --- | --- |
| Overview, posture, findings, original report hash | Redacted | Yes | Yes | Yes |
| Detailed normalized evidence, snapshots, scoped export | No | Yes | Yes | Yes |
| Acknowledge | No | Yes | Yes | Yes |
| Assign/investigate/note/resolve/dismiss | No | No | Own assigned case; self-assign unassigned case | Any case; assign eligible engineer/admin |
| Posture review, baseline proposal, evidence/report/public-certificate import | No | No | Yes | Yes |
| Credentials, mappings, rule activation, baseline approval | No | No | No | Yes |
| Finite risk acceptance, sensitive audit, delivery retry, retention/purge | No | No | No | Yes |

All API boundaries enforce these permissions. Shared demonstration identities remain read-only even if their historical role is engineer/admin; they see authored demo scope. This is a single existing application scope, not new tenant isolation. Sessions remain HttpOnly cookies. Authentication changes and logout clear the authenticated React Query cache so previous-role evidence cannot stay visible.

## 3D, optional sources and data boundaries

The security overlay is opt-in. Separate blue rings indicate explicitly mapped installed-component findings and do not change process alarm colors. A finding link focuses only its supported mapping. Gateway/software findings with no installed-component mapping stay in lists; they never imply an internal pump part is compromised. Missing security service evidence does not prevent model rendering. The complete Cybersecurity workflow is available without loading a model or WebGL.

The optional Pi collector samples only its already established MQTT socket/certificate, successful applied configuration hashes, authorized local input identity rejections and health. It reads no private keys, probes no devices and creates no subscriber. It uses its existing SQLite delivery file with a separate 1,000-row queue, verified HTTPS to the configured Smart Factory origin, stable IDs, bounded retries and quarantine. Existing telemetry queue quotas and retained-message behavior are unchanged. See the gateway checkout's own `docs/cybersecurity-collector.md` for opt-in commissioning and a disposable HTTP outage/restart probe. No plant installation is part of this release.

The assistant detects a security question and returns a bounded deterministic summary/checklist with the current authorized workspace counts and links; provider keys are unnecessary. Event text and report titles are never instructions, model input or executable remediation.

## Storage, privacy and operations

Maximum ingestion body 1,048,576 raw bytes; 100 events; 8,192 UTF-8 bytes per normalized event. Four concurrent raw security request bodies are admitted per process. Compressed bodies are rejected. See [the wire/API profile](cybersecurity-api.md). Separate reports are at most 4 MiB, 20 results / 2,000 vulnerabilities (500 per result). Report analysis processes 20 candidates per transaction with a durable cursor, finite exponential retry and quarantine diagnostics; admins can authorize a retry with an audit reason. HTTP acceptance does not wait for all rule work. The captured immutable rule version is used across restart.

Logical content budget is 256 MiB, 200,000 events, 100 sources, 100 reports / 64 MiB raw report bytes, 10,000 findings, 10,000 events per source, 100 versions per rule, 100 baselines per source, 10,000 identity mappings / 1,000 per source. Accounted event/snapshot/audit/report sizes include fixed record allowances; PostgreSQL indexes/page overhead, backups and WAL are additional deployment capacity. Quotas reject new work explicitly (429); exact retries still receive duplicate acknowledgement. No finding is fabricated on quota loss. Review diagnostics and capacity before commissioning collectors. Default raw-event retention is 30 days; admins can set 7–90 days for future evidence. The audited purge removes at most 1,000 expired raw events per action and retains bounded finding snapshots/audits. Investigation decisions are not silently deleted. Reports/closed investigations require database-owner archival planning when the fixed budget fills; no misleading unlimited retention is claimed.

The neutral wire profile rejects arbitrary attributes and caller authority. Summaries redact credential assignments, bearer values, URLs, accounts and IPv4 labels; symbolic references reject URLs/userinfo. Do not submit secrets in any metadata, notes or imported package/version identifiers. SQL values are parameterized. Browser rendering is escaped plain text; JSON/NDJSON exports only contain the authorized selected page, and CSV cells neutralize formula prefixes. Private keys/raw connection configuration are never accepted as event attributes. Machine and user failures have bounded errors without SQL/token payloads. There is no arbitrary URL/feed fetch or automatic outbound peer adapter.

## Release and rollback

Follow [the canonical Oracle procedure](../deploy/oracle/README.md): prepare the backend context, build/test/scan the combined ARM64 image, preserve existing primary database/broker/SMTP variables and the singleton worker ID, stop the old worker, update the image selection only, wait for API readiness, then start the single worker. Deploy the tested backend before merging the UI release to main, because the checked Vercel workflow then publishes the new navigation against that API. Existing equipment/AAS/alert regressions remain required. Never install the optional collector on physical hardware as part of an API update.

The migration is additive. Retain the old image and owner-only `.env` rollback copy. Roll back UI and API/worker image using the same singleton order; leave new tables/nullable notification link intact. Set `SECURITY_ENABLED=false` on an explicitly approved configuration update if module isolation is needed. Do not drop security tables to undo the UI: evidence and audit retention are an independent owner decision. Back up the existing database under its established procedure before release. Production acceptance and physical/external-consumer acceptance are separate from local code checks.

Engineering references: [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final) and [CISA OT asset-inventory guidance](https://www.cisa.gov/resources-tools/resources/foundations-ot-cybersecurity-asset-inventory-guidance-owners-and-operators). These inform passive collection, explicit inventory scope and human decisions; this workspace makes no certification or regulatory-compliance claim.
