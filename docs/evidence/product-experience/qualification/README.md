# Disposable qualification evidence

All data and credentials used by these tests are synthetic and local. These artifacts establish their recorded software revisions and environment. They do not establish production promotion, physical equipment or actual Onesa acceptance. No database dump, spool, private payload, cookie or session trace is committed.

| Artifact | Actual result and scope |
| --- | --- |
| [Immutable image/source manifest](release-manifest.json) | Clean frontend `6f4475b`, backend `43ad1f3`, edge `be917a4`; Linux ARM64, schema 0028 and migration hashes. Generated from Git/image identity, not hand-authored. The image was built/loaded locally; no registry publication or production promotion is asserted. |
| [ARM64 bundle and compatible rollback](arm64-bundle.json) | All six services non-root; repeated migrations; bootstrap/roles; native outboxes; owner notifications; .NET coverage/units; QoS 0/1; direct sensor; fresh compatible worker; readiness failure/recovery; hardened rollback/roll-forward retains revoked sessions and reading identities. |
| [Image dependency audit](container-audit.json) | Pinned Trivy 0.75.0, zero high/critical findings in this exact image. Public vulnerability database download only; no application data upload. |
| [RabbitMQ traversal and restore](rabbitmq-restore.json) | Real Pi-local Mosquitto, durable edge spool, RabbitMQ 4.3.6 MQTT 5, .NET 10, Node and PostgreSQL. Punctuated/legacy identities, units, retained/quality/age/modes, duplicates/restart, quarantine and fresh database restore. |
| [Mosquitto traversal and restore](mosquitto-restore.json) | Independent cloud Mosquitto 2.0.22 repetition of the same real service path and restore checks. |
| [AAS cross-service result](aas-cross-service.txt) | .NET 10 AASX import/administrative metadata/semantic submodel/embedded attachment against disposable BaSyx 1.1.0; Node registration → .NET provisioning → persisted Pi profile; allowlisted serial stub command/ack and viewer denial; telemetry, outage/restart, Assistant and readiness recovery. |
| [Equipment provenance result](equipment-provenance.txt) | Twenty simulated/replay source samples persist through receiver outage and are acknowledged after recovery, with zero quarantine and original UTC metadata. Optional peer export disabled. |
| [Large-history query plan](analytics-budget.json) | 300,000 rows, 240,000 in selected live scope, 601 returned buckets, 313,981 bytes, 705.656 ms. Actual EXPLAIN ANALYZE/BUFFERS plus sampled process memory. |
| [Active workload](resources-active.json) | Seven latest-observation requests in 35 seconds; ten total API calls; 0.1291 seconds renderer task time, zero commands. |
| [Stale workload](resources-stale.json) | One latest-observation request in 35 seconds, zero commands. |
| [Disconnected workload](resources-disconnected.json) | One latest-observation request in 35 seconds, zero commands. |
| [Browser-offline workload](resources-browser-offline.json) | Actual browser offline state: zero API calls and zero commands during measurement. |
| [Visibility-event workload](resources-visibility-event.json) | Explicitly simulated hidden-page event: zero latest-observation requests, one inventory request, zero commands. Browser automation keeps actual background tabs visible. |

The broker/query artifacts record earlier clean application source `18a7fa9`; the relevant ingress/query code is unchanged in `6f4475b`. Current pinned-source CI repeats both broker/restore paths on `6f4475b` with backend `43ad1f3` and edge `be917a4`. Screenshot JSON records each actual source independently. Workload artifacts record clean `6f4475b`.

Current code CI:

- [Frontend application, workspace, broker/restore and AAS qualification](https://github.com/DruHustle/smart-factory-iot-frontend/actions/runs/40463772343).
- [Backend 233 tests and all five standalone image builds](https://github.com/DruHustle/smart-factory-iot-backend/actions/runs/40463039292).
- [Edge tests, audits and firmware compile](https://github.com/DruHustle/smart-factory-iot-edge/actions/runs/40453867724).

Use the current PR checks for any later documentation-only commit; do not treat historical CI as a new source attestation.

Reproduction uses the repository's own disposable runners: `pnpm e2e`, `pnpm e2e:public-demo`, `pnpm e2e:workspace`, `pnpm e2e:equipment`, `pnpm e2e:security`, `pnpm e2e:experience`, `pnpm e2e:resources`, `scripts/cross-repo-smoke.py`, `scripts/qualification/trusted-path.py`, `scripts/qualification/analytics-budget.mts`, and `scripts/bundle-smoke.py`. CI pins companion revisions in `deploy/qualification-sources.json`. The final bundle acceptance and rollback result is recorded alongside the generated manifest.
