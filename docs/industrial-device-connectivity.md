# Industrial device connectivity

Smart Factory can acquire independently named, typed tags through its existing gateway and telemetry pipeline. Open **Assets & devices -> Device connectivity**, choose a registered operational gateway, and add a connection. The driver architecture is vendor independent; no Kepware installation or server preset is required.

## Implemented protocols

| Connection | Acquisition | Configuration and evidence |
| --- | --- | --- |
| OPC UA | Client/server reads, bounded browse, monitored subscriptions | Endpoint, stable namespace URI and NodeId, local credential reference, native status, source and server timestamps |
| Modbus TCP | Read-only register and coil polling | TCP endpoint, unit ID, zero-based address, register area, scalar encoding, byte/word order, engineering scale and offset |
| Modbus RTU | Read-only serial register and coil polling | Locally allowed serial device, baud/parity/stop settings and the same typed mappings as TCP |
| MQTT | Persistent subscriptions to exact topics with JSON extraction | Broker endpoint, local credentials, RFC 6901 value/quality/timestamp pointers; retained and malformed messages retain their evidence limitations |
| OPC UA FX diagnostics | Read-only, namespace/type-based model discovery | AutomationComponent, FunctionalEntity, ConnectionEndpoint and ConnectionManager observations; ordinary OPC UA nodes alone do not establish an FX model |
| OPC UA FX UDP/UADP observer | Bounded scalar DataSet keyframes from a commissioned publisher | Publisher ID and encoding, WriterGroup/DataSetWriter IDs, metadata versions, field indexes and explicit unsecured-observer acknowledgement |
| TSN diagnostics | Local, read-only clock/NIC/queue/counter collection | Interface and optional PTP domain/collector reference; observed clock state, hardware timestamping capability, queue disciplines, counters and unavailable collectors |

This delivery acquires observations. It does not write device values, establish PLC control connections, invoke ConnectionManager methods, configure switches or change clocks/schedules. The UDP observer rejects secured/chunked/delta/unsupported encodings. It does not implement the complete UAFX security, connection-establishment or certification stack. See the [FX and TSN guide](fx-tsn.md) for the distinction between process-data exchange, diagnostics and deterministic timing.

## Engineering workflow

1. Register and commission the gateway's direct telemetry route. Link its assets through the existing inventory. A tag can be bound only to an operational asset already linked to that gateway.
2. Commission the gateway's local destination allowlist and credential/collector references. Credentials, certificate files and local management sockets remain on the gateway; the browser stores references only. Install the pinned edge dependencies and any required serial or read-only Linux diagnostics tools.
3. Add a connection, endpoint and tags. A tag has a stable ID, a display name, source encoding, source address and optional engineering unit, asset/property binding, scale and offset. Distinct inlet/outlet pressures remain distinct tags. They are not collapsed into the legacy six telemetry fields.
4. Use **Test connection** to send a bounded read-only probe to that gateway. A command ID and expiry correlate the actual gateway response. A successful HTTP request alone does not establish device connectivity. OPC UA browse results can be selected as mappings.
5. **Save** creates an audited desired revision. It preserves the last published configuration and its observations. **Apply** sends that exact saved revision. The UI separately displays desired revision, publication, gateway receipt and acquired data. Connections removed from a draft continue to appear as published until the new configuration is applied.
6. Check tag value, quality, acquisition/source time and connection status. Asset overview, telemetry and connection tabs show explicitly bound tags with gateway provenance. The **FX & TSN** workspace also receives conservative live collector projections; unsupported topology or end-to-end timing remains unknown.

Delivery timeouts are shown as **unconfirmed**, because the gateway may have received a command before the HTTP response was lost. The server durably stores the publication/probe context before dispatch, accepts a later matching gateway receipt and never substitutes a local timer for an actual probe result. Known configuration errors remain visible and can be retried after correction.

Demo mode uses authored examples and cannot configure a real gateway. Viewer/operator sessions can inspect observations; engineer/admin permission is required to save, apply or probe. Simulated sources remain labelled and cannot become operational current evidence.

## Runtime and contracts

The authoritative application schemas are [shared/industrial-connectivity.ts](../shared/industrial-connectivity.ts). The companion backend and edge implement the same bounded contracts, with a cross-language fixture in [fixtures/connectivity/industrial-v1.json](../fixtures/connectivity/industrial-v1.json).

The saved schema is `industrial-connectivity/v1`. It supports at most 16 connections and 100 tags per connection, with a 64,000-byte compact UTF-8 configuration budget including headroom for the MQTT command wrapper. Connection identities are unique within a gateway; tag identities are unique within a connection. Source types must match their protocol and scalar encoding. Embedded endpoint credentials and unknown settings are rejected. `int64` and `uint64` values use exact decimal strings on the wire, without JavaScript precision loss or floating-point scaling.

The existing private DeviceService publishes configuration using `replace_connectivity_configuration` on the separate retained topic:

```text
factory/<encoded-site>/<encoded-line>/<encoded-gateway>/commands/connectivity
```

The legacy retained `replace_asset_configuration` command remains on `/commands`; sharing one retained topic would overwrite one configuration with the other. `probe_connectivity` is nonretained on `/commands`, carries a UUID and expires after at most 60 seconds. Update the broker ACL for the new scoped topic and the gateway subscription as part of commissioning. The change does not modify an external broker's ACL automatically.

The edge persists configuration atomically, rejects conflicting reuse of a revision, reconnects with bounded backoff and schedules connections independently. Cloud change reports are coalesced and periodic snapshots are bounded independently of device acquisition intervals. A separate explicit `gateway-configuration` receipt confirms application of a configuration, including an empty configuration; it cannot claim that a device is connected.

The existing gateway telemetry envelope carries a top-level `connectivity` object using `industrial-observation/v1`. It is separate from the existing strict `integration` provenance. Reports include connection/revision/event identities, UTC acquisition time, state, up to 20 typed tags and optional probe/FX/TSN evidence. The inner report budget is 15,000 bytes and the full transport envelope remains bounded to 16 KiB. The gateway chunks larger tag sets.

The .NET worker persists and forwards the extension through its existing durable outbox. Its nullable `ConnectivityJson` migration is additive; legacy observations retain their prior delivery identities. The Node receiver checks the commissioned gateway, active or durably attempted configuration, exact tag/type/unit bindings, transport retention, timestamps and probe correlation. Identical event retries remain idempotent after a later configuration change; conflicting reuse of an event ID is rejected. A draft save never interrupts published acquisition.

Latest values are indexed separately by gateway, connection and tag. Diagnostic history is bounded to seven days and 1,000 envelopes per gateway. Configuration history is append-only and records the authenticated actor. Unlinked assets immediately lose the tag attribution in their asset views. The original scalar telemetry, AAS models and legacy gateway configuration remain supported.

## OPC UA FX and TSN evidence limits

FX model discovery uses the types and namespace URIs in the OPC Foundation model. It does not infer a FunctionalEntity or a connection from a display name. The UADP receiver verifies the commissioned publisher/writer tuple and metadata versions, bounds allocations, rejects unsupported packet formats and tracks sequence/counter evidence. An unsecured UDP packet can never be promoted to authenticated, good-quality operational evidence, and a packet alone cannot verify an FX information model.

TSN collection reads local `pmc` management data, `ethtool` capabilities, `tc` queue disciplines and interface counters. Collector commands and local paths are provisioned on the gateway; remote configuration cannot supply arbitrary command lines or management socket paths. Missing tools or permissions produce unavailable evidence rather than invented zeros or synchronization success.

The network projection keeps NIC timestamp support separate from active hardware timestamp use. A `taprio` queue discipline can establish that a Linux schedule is configured; it does not prove hardware enforcement. The built-in collector does not invent publisher/subscriber topology, end-to-end latency, jitter, deadlines or conformance from one local interface. Determinism remains **unverified**. Real UAFX interoperability, supported TSN hardware, clock-loss recovery and traffic-load qualification must be measured on the intended installation before relying on deterministic control.

Primary references: [OPC UA Part 81 connection communication](https://reference.opcfoundation.org/specs/OPC-10000-81/5.5.6.1), [OPC UA Part 14 PubSub](https://reference.opcfoundation.org/specs/OPC-10000-14), [IEC/IEEE 60802](https://1.ieee802.org/tsn/iec-ieee-60802/), and [LinuxPTP pmc](https://www.linuxptp.org/documentation/pmc/).

## Verification and release

Application tests cover the schema, role/demo boundaries, PostgreSQL persistence/audit, draft isolation, receipt correlation, uncertain dispatch, replay/retention, out-of-order observations, event retries and unsecured UDP evidence. The browser suite checks desktop/mobile workflows, independent tag values, namespace-aware discovery, concurrent edits and published-versus-desired configuration. Run it with `pnpm e2e:connectivity`.

The edge suite includes actual local OPC UA and Modbus servers, a real MQTT broker, an independently encoded UADP UDP sender, FX positive/negative discovery and local TSN failure fixtures. The full qualification path uses those protocol simulators, the actual Python gateway, MQTT 5, the actual .NET outbox/forwarder, authenticated Node ingestion, PostgreSQL and the browser. Synthetic devices remain explicitly simulated throughout; successful software tests do not represent physical factory acceptance.

The dashboard adds `0035_industrial_connectivity`; the companion telemetry worker adds its nullable connectivity column. The API advertises `industrial-connectivity-v1`. Qualify the pinned backend/edge/frontend sources and ARM64 bundle, deploy the compatible API and singleton worker first, then pass the existing runtime gate before promoting the UI. Deploy the gateway code with its pinned dependencies and local configuration. Preserve the prior compatible images and all existing secrets. See the [Oracle release procedure](../deploy/oracle/README.md). Do not deploy or bypass a failing qualification or compatibility gate.
