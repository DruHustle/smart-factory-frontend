# Trusted observation contract — candidate, 27 October 2026

This coordinated frontend/API, .NET and edge change is a software candidate. It does not attest a production rollout or physical commissioning. Onesa remains optional.

## Identity and commissioned routes

Site, line and device topic parts use `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`. Examples include `a`, `sensor.temp:01` and `legacy_01`. Slashes, wildcard characters, control characters and leading punctuation are rejected. Asset URNs retain their separate contract. MQTT topic and payload device identity must match. Firmware mDNS uses a separate compatible network alias when needed; the application identity is preserved.

Registration records a software identity and reviewed route; it does not provision broker credentials, deploy a profile or commission hardware. Incoming telemetry cannot rewrite configured kind, gateway, route or asset relationships. Source/asset links must be explicit and share the same demonstration scope. Duplicates are identified before topology or current-state effects. Unknown devices and route/mapping mismatches enter a bounded review queue, with rejection counters continuing at capacity. Discovery never silently creates operational inventory.

## Evidence and time

Evidence scopes are operational, explicit live, simulated, replay, unclassified and combined. Scope is applied before selecting latest readings or calculating statistics. Missing historical provenance remains unclassified. Operational scope includes explicit live acquisitions and only future legacy acquisitions explicitly reviewed by an engineer; that review never rewrites old records. Declared live acquisition mode alone does not establish a current physical condition.

Current-state updates require a commissioned route and an acquisition eligible under its quality, source connection, lateness, clock-skew and monotonic-time policy. Retained delivery, bad/uncertain quality, failed sensor reads, old samples and out-of-order observations remain inspectable without raising a new current threshold incident. Acquisition timestamps and application receipt timestamps are preserved separately. Gateway observations have their own durable history with bounded detail reads and cannot fabricate scalar sensor values. No freshness window means current availability remains unknown.

## Engineering units and scaling

| Metric             | Canonical unit | Accepted source units |
| ------------------ | -------------- | --------------------- |
| Temperature        | °C             | °C, C, Cel, °F, F, K  |
| Relative humidity  | %              | %, fraction           |
| Vibration velocity | mm/s           | mm/s, m/s             |
| Power              | W              | W, kW, MW             |
| Pressure           | Pa             | Pa, kPa, MPa, bar     |
| Rotation           | rpm            | rpm, r/min, 1/min, Hz |

Conversions use `sf-units-v1`. A value is stored with its original engineering value/unit, double-precision canonical value/unit, source quality and conversion version. Register/native mappings additionally preserve raw value/unit, scale/offset and `sf-mapping-v1`, checked against the reviewed connection mapping and AAS revision. Repeated scalar mappings are rejected. Acceleration in g is not converted to vibration velocity. Unknown legacy units stay unknown; their raw values remain inspectable and are excluded from engineering averages and current threshold evaluation.

Thresholds must be explicitly reviewed in the metric's canonical unit. Existing unitless limits are retained and inactive until reviewed; no guessed conversion is applied. Native 3D bindings use verified, compatible units only and never copy unrelated parent measurements onto a component. Optional Onesa export uses the acquisition's actual preserved unit/conversion, rather than assuming a binding label. Named asset signals preserve their latest scalar values with unknown units and have no automatic engineering average.

## Queries, reports and investigations

SQL calculates complete selected-range summaries. Trends return at most 601 display buckets, with missing buckets represented as gaps and an accessible UTC table. Detail limits are explicit. Incident and inbox searches run on the server across the full authorized history, with totals and paginated rows. Reports retain escaping and scope/return/truncation metadata; they do not calculate period statistics from a first page.

Process incidents retain initial and latest reading snapshots, including source, time, unit and conversion evidence. Acknowledgement, assignment, confirmed downtime, resolution and review notes are recorded as durable activity. Acknowledgement does not resolve an event. Connectivity loss does not automatically establish factory downtime. Notifications stay owner-scoped; provider acceptance is distinct from established recipient delivery.

## Additive cutover

Dashboard migrations 0024–0027 introduce session generations, passport publications, measurement/rejection evidence and investigation/gateway histories. The .NET `20261027_engineering_units.sql` migration preserves units, mapping evidence and retained-delivery metadata in the durable outbox. Apply and verify migrations before promoting compatible application binaries. Keep additive storage during rollback; never restore the shared-demo privilege gap or automatic numeric public passport route.

Focused disposable regressions cover 200,501-row histories, reports beyond 1,000 readings, incident search beyond 500 rows, mixed modes, scaling, retained/delayed/out-of-order delivery, route mismatches, session revocation, immutable publication, last usable administrator protection and owner-scoped inboxes. Full broker, rendered browser, restore and release-bundle outcomes are recorded separately with final source identities.
