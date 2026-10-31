# Industrial connectivity implementation verification

Verification date: 31 October 2026. All device and network activity described here used disposable local fixtures. No plant device, PLC control program, physical TSN network or production data was modified.

## Application and backend checks

| Check | Result |
| --- | --- |
| Complete frontend/API Vitest regression suite with real disposable PostgreSQL | 767 passed; two existing optional tests skipped because Redis/XML-lint prerequisites were absent |
| Connectivity contracts, transactional workflow and network evidence suites | 33 passed |
| TypeScript | Passed |
| Production frontend build | Passed; connectivity is a lazy route |
| Browser workflow contracts | 12 passed on Chromium, covering 390 px and 1440 px layouts |
| Complete .NET backend suite with real PostgreSQL | 356 passed, none skipped; includes provisioning authorization, legacy identity compatibility, Unicode byte budgets, durable outbox and additive migrations |
| Edge unit/regression suite | 124 passed, including 13 staged-release installer checks |
| Gateway installer qualification | First install, existing-release upgrade, failed qualification, competing overrides and rollback covered; actual offline hash-pinned wheel installation and installed-version verification passed |
| Actual protocol suite | Nine passed: OPC UA subscriptions, model discovery, Modbus TCP, Modbus RTU pseudo-terminal, MQTT, UADP, and legacy v1 adapter reads |
| Dependency advisory audit | No known vulnerabilities reported by the pinned pnpm audit |
| Deployment contracts | Passed Oracle/Vercel topology, source identity and compatibility checks |
| Repository documentation | Local links, 14 Mermaid diagrams and generated PDF/diagram digests checked; updated FX/TSN guide rendered and visually reviewed |
| Workspace migration and image-cleanup regressions | Twelve passed |

The optional skipped tests belong to the existing Redis fan-out and XML schema tooling suites. They are not protocol-acquisition substitutes. Real Modbus RTU here means a wire-format exchange through a pseudo-terminal, including CRC behavior; a physical serial bus remains unqualified.

## Real continuous path

The qualification ran the actual Python `sensor_gateway.py` with its durable SQLite queue, persistent protocol drivers and retained configuration subscription. A separate local bench supplied OPC UA and Modbus servers, MQTT JSON messages and UADP datagrams. The actual MQTT 5 broker delivered these messages to the compiled .NET TelemetryService, its PostgreSQL persistence/outbox and the authenticated Node telemetry endpoint. The actual application database and browser were then inspected.

Configuration was saved and applied through authenticated HTTP tRPC calls, the private DeviceService and the scoped MQTT command topic. The gateway reported the same revision and emitted independently identified tag observations. The fixture used five connections and ten asset-bound tags. Its source mode remained `simulated`, and operational network projection deliberately excluded those simulated reports.

Verified values included `12.5`, Boolean `true`, the string `simulation-running`, and UInt64 `18446744073709551615` preserved exactly as a decimal string. Modbus reads displayed unknown sensor quality; unsecured UADP displayed unknown quality and `unauthenticated_udp` evidence. Neither was promoted into authenticated current evidence. The FX diagnostics view showed actual type-based discovery against the fixture's FX model, while TSN collector unavailability remained unknown.

One real browser **Test & discover** traversed the complete command/response path. The interface showed pending, then accepted only the matching command ID. The result was connected with five discovered variables. Desired configuration remained at revision 2. All five protocol views, ten bound asset signals and the mobile asset layout rendered without browser page errors.

The bench initially exposed a malformed UInt64 PublisherId header emitted by its pinned independent UADP encoder. The production receiver correctly rejected the reserved encoding. The fixture now documents and corrects that header against OPC UA Part 14; production decoding remains strict. Real packet tests also cover sequence handling, metadata mismatch, scalar encodings and rejection of unsupported packet shapes.

## Failure and recovery checks

Tests verify that saving a desired draft leaves published acquisition intact, including when all desired connections are removed. Published and desired mappings remain separate in the UI. A missing HTTP acknowledgement preserves durable dispatch context, so a later actual gateway receipt or probe result can resolve the uncertainty. An exact accepted event retry remains idempotent after a configuration change; conflicting reuse of its event ID is rejected.

Additional checks cover unknown tags/revisions, unlinked assets, retained messages, stale or unverified transport evidence, unauthorized roles, demo isolation, publisher tuple mismatches, incomplete UADP layouts, source types, 64-bit precision, Unicode serialization and configuration byte limits. The existing legacy driver path was exercised against the real OPC UA/Modbus bench after the implementation changes.

The Node service, compiled backend services and gateway were restarted against their persisted configuration and queues. During fresh schema qualification, the previous disposable dashboard database was preserved, a new database was created, and the actual migration script was run. Migration metadata was not edited to claim readiness. The actual runtime endpoint reported the new schema ready and advertised `industrial-connectivity-v1`.

A synchronized broker interruption lasted at most 3.229 seconds. The actual gateway SQLite queue held three connectivity events during that outage. After reconnect, each captured UUID was found exactly once in both the .NET and Node PostgreSQL stores, with its original acquisition timestamp. The existing singleton worker and gateway processes reconnected without restart. At the verification snapshot, all 560 accepted records were unique and forwarded, zero were pending or quarantined, the edge queue was empty and all five connections had fresh observations. The disposable broker used no broker-disk persistence; this proves gateway spool/outbox recovery, not broker-disk recovery.

## Reproduction

Use the repository-pinned pnpm 10.34.5, .NET SDK from the backend `global.json`, and hash-pinned edge requirements. Supply only disposable local database and broker addresses.

```bash
# Frontend/API; the test database name must end in _e2e for guarded DB suites.
pnpm install --frozen-lockfile
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
pnpm check
pnpm test
pnpm e2e:connectivity
pnpm build
pnpm docs:check
pnpm deployment:check
pnpm audit --audit-level=moderate

# From the backend checkout.
dotnet test src/SmartFactory.Tests/SmartFactory.Tests.csproj -c Release

# From the edge checkout, with the disposable MQTT broker running on loopback.
python -m unittest discover -s raspberry-pi/tests -v
CONNECTIVITY_PROTOCOL_TESTS=1 CONNECTIVITY_TEST_MQTT_PORT=18884 \
  python -m unittest discover -s raspberry-pi/tests -p test_connectivity_protocols.py -v
```

The frontend's `scripts/qualification/connectivity-fixture.mts` seeds only the explicitly guarded local connectivity database. The edge's `raspberry-pi/tests/connectivity_protocol_bench.py` supplies the independent protocol bench. The existing cross-repository process/broker qualification and ARM64 workflow remain required release gates.

## Production status and acceptance boundary

This document records local software qualification, not production promotion. Exact-commit hosted CI and ARM64 image qualification remain separate release steps. The companion qualification pins reference the published backend commit `8c71409a296eb1c65a9b9fdb2eff8e0923b645ae` and edge commit `28640232f003ba4310df4026bd33dbd39b8e6a54`, including the staged gateway installer repair. Their Git trees were independently verified to match the tested local sources exactly. The existing runtime gate requires `industrial-connectivity-v1` and the matching migrated API/worker before UI promotion. Production credentials, broker ACLs and gateway hardware are not supplied by these fixtures.

No complete UAFX conformance, signed/encrypted PubSub interoperability, physical TSN scheduling, clock accuracy under plant traffic, end-to-end deadlines or certification is claimed. Those require commissioning and measurements with the intended controllers, NICs, switches and clock sources. The prior cloud release cannot safely consume industrial envelopes; schema-compatible rollback qualification does not establish that capability. The release procedure requires pausing affected gateways, draining through compatible services and preserving any unresolved backlog offline before an incompatible consumer starts. See [industrial device connectivity](industrial-device-connectivity.md) for the supported subset and [the Oracle release procedure](../deploy/oracle/README.md) for API-first deployment and rollback.
