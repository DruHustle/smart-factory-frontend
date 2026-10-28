# Cybersecurity release qualification — 2026-10-26

The native workspace, strict import/export boundary, actual Node/.NET access observations, optional Pi collector, assigned investigation flow and explicitly mapped 3D overlay were implemented in separately owned Smart Factory repositories. This records observed checks, not physical plant or external-platform acceptance.

## Revisions and artifacts

| Component | Qualified source | Release identity |
| --- | --- | --- |
| Node server, migration, rules and API | frontend `f1aa16864731f0a5c6ffd8737a642a541f2e67f2` | Tested Oracle ARM64 image below |
| UI and real light/dark palette | frontend `82626097df5bf235c72cae49e349520a844d79aa` | UI layout unchanged in f1aa168; final evidence commit changes docs only |
| .NET services | `905ef8ebb9a13090bab9288a8fd8677e1373fe8d` | Merged main `b10e6391d239d7f3db534da097362435f6fbd790`; source tree matches |
| Gateway | `b63c2ad351b1da22a1c590dc1df9d9445ddc5afe` | Merged default master `1722f197c47a46371af76e778267d16ac477abd1`; source tree matches; no hardware deployment |

Image: `smart-factory-backend:security-f1aa168-905ef8e`, ARM64, image-store identity `sha256:b5c606032d2c0b95e75889e4998a7ed0704573382536354fe6eb20025b8d18ab`. The running Oracle containers identify its architecture-specific manifest `sha256:99cdcbaa90787f911f6aef8e4841d7a8caead76ab95545a41a8c4e6e89880cfb` and retain the source revision labels. Node is 22.23.4 and ASP.NET/.NET runtime is 8.0.33. The transferred archive SHA-256 was verified as `0a63c8bd6782aa5bd74028870d1e045702fd029b25ecb5d19193984a3197fc40` before deployment. The scanner reported zero high/critical findings; this is not a claim of zero vulnerabilities at other severities or future advisory dates.

## Verified workflows

- A fresh standalone checkout installed locked dependencies and built without sibling services, peer configuration, model keys or a vulnerability feed. The receiver and collector use their own local validators/examples. The API's existing primary PostgreSQL/Redis are the only standalone runner services.
- Seven browser journeys passed: actual failed login/denied privileged HTTP requests through durable capture into findings; source setup/credential isolation/1 MiB rejection; file import and original evidence inspection; acknowledgement/assignment/investigation/resolution/reload/recurrence; explicit registered asset and Volute casing mapping into 3D focus; same-browser admin-to-viewer cache redaction; and all six sections at 1440/390 pixels in both actual themes. Nonlocal browser requests were blocked and none were attempted by the native workflow.
- The optional **real local collector** posted to the Node receiver after an unreachable endpoint and SQLite reopen, preserving its immutable event ID, simulated provenance, configuration hash and ordinary telemetry queue. This is local integration evidence, not a physical Pi commissioning claim.
- 337 application tests passed with disposable PostgreSQL/Redis, including source-token hashing/revocation, concurrent duplicate/conflict atomicity, UTC/mode/run/size/encoding validation, exact rule-window boundaries, rule/baseline scope, certificate metadata/escalation, immutable evidence triggers, finite risk expiry, persisted demo-setting behavior, lifecycle/assignment ownership, report hash/context/CVSS, import analysis backpressure/quarantine/authorized recovery, and viewer/export redaction, shared-demo assignee isolation and administrative-policy rationale redaction. Operator acknowledgement can hand off to an engineer without undoing investigation progress. Unit and browser suites remained at one worker; no timeout or pass criterion was relaxed.
- 26 existing general browser journeys passed for accounts, operational incidents/notifications, AAS/OAuth/AASX, analytics, assistant, safe mocked controls and responsive landmarks. Fourteen scope skips are the separately run native equipment/security journeys and disabled optional integration journeys, not waived failures.
- Five native equipment journeys passed with `SECURITY_ENABLED=false`, covering desktop/tablet/mobile saved work, local files, detailed inspection and measurement. Its one public-demo journey runs in the general suite. Mechanical geometry/source assets are unchanged by the security release; reference revision 4 retains SHA-256 `cb1d547822ae954d698ae330ee6d2083fa966f6af3aec889c4605c1305d29712`.
- 216 .NET tests and 70 gateway tests passed. Backend CI [40362127244](https://github.com/DruHustle/smart-factory-backend/actions/runs/40362127244) and gateway CI [40362140633](https://github.com/DruHustle/smart-factory-edge/actions/runs/40362140633) passed, including dependency checks, real MQTT outage/restart recovery and the firmware compile check. Firmware was not flashed.
- The real combined six-service ARM64 image passed repeatable migrations, non-root runtime, first-admin bootstrap refusal, actual anonymous IdentityService rejection into the Node security outbox, notification ownership/restart, analytics, QoS 0/1 persistence and service/database outage recovery. The production image audit found no high/critical vulnerabilities; the application package audit found no known vulnerabilities at its checked threshold.

An earlier local general-suite attempt timed out in the unchanged model-import persistence test while other work ran. The serial frozen-source rerun passed all 337 tests and 26 browser journeys. A browser route race, missing inherited light palette and test readiness/screenshot timing were corrected before final qualification; no failure was converted to a skip.

## Rendered evidence

The screenshot [manifest](evidence/security-20261026/manifest.json) records source revisions and checksums. Captures use synthetic local fixture identities and contain no source credential or session cookie.

- [Desktop light](evidence/security-20261026/overview-light-1440.png), [desktop dark](evidence/security-20261026/overview-dark-1440.png).
- [Narrow light](evidence/security-20261026/overview-light-390.png), [narrow dark](evidence/security-20261026/overview-dark-390.png).
- [Persisted investigation](evidence/security-20261026/investigation-dark.png), [explicit mapped component focus](evidence/security-20261026/mapped-equipment-security.png).

## Hosted state and remaining acceptance

The tested Oracle image was deployed using the canonical API-first/single-worker procedure. Both containers became healthy, all four API and two worker processes run in their intended roles, the public API passed readiness and authenticated security/asset/notification reads and logout, and the original environment files/MQTT client identity were preserved. The final read-only database check confirmed two native sources, nine active rules and actual live Node health receipt; [only aggregate counts/times](evidence/security-20261026/production-native.json) were recorded. The pre-feature image `smart-factory-backend:oracle-20261016` and the original owner-only selection backup in `releases/security-20261026/environment.before.env` remain the rollback baseline. Intermediate qualification images are not the approved rollback target.

Production's pre-existing `ENABLE_DEMO_DATA=false` setting remains off. Its shared viewer session is read-only and sees an honest empty demo-only security/equipment scope; no private live security evidence was exposed to populate the public view. [The API proof](evidence/security-20261026/production-api.json) records this boundary. The complete private workflow and labelled authored simulation/replay are demonstrated in the isolated qualification, not fabricated as live factory incidents.

Track the final checked main/Vercel workflow and deployed UI identity in [frontend release PR #4](https://github.com/DruHustle/smart-factory-frontend/pull/4); deployment follows successful exact-revision main CI. Backend [PR #4](https://github.com/DruHustle/smart-factory-backend/pull/4) and gateway [PR #3](https://github.com/DruHustle/smart-factory-edge/pull/3) record their merges and CI.

Physical collector commissioning, physical mobile performance and an actual external consumer/Onesa acceptance remain separate manual acceptance. No physical collector, firmware, broker ACL, firewall, control command, credential rotation, patch or plant remediation was deployed. The supported import profile is the documented strict Trivy schema-2 subset; advisory package/version candidates require applicability review. No regulatory certification or device attestation is claimed.
