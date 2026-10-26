# Unified inventory and contextual workspaces

The application has one **Assets & devices** workspace over its existing authoritative records. It does not copy records into a new inventory table or depend on Onesa. The shared shell stays mounted while route panels load.

## Navigation

Overview; Assets & devices; Operations (Monitoring, Alerts, Firmware & updates); Cybersecurity; Analytics; Assistant; Administration (Integrations, Users & access). Empty role-restricted groups are omitted. The persistent header contains Notifications/history and the single light/dark theme control. The mobile drawer closes on selection or Escape and restores its trigger focus. Links, disclosure controls and Radix section tabs support keyboard use.

Inventory views are All items, Assets, IoT devices, Gateways and 3D equipment. Views overlap: 3D is a capability, not another physical item. Search, zone, observed status, latest evidence mode, capability, sort and pagination are URL state. Lists return at most 50 items (the UI requests 25); search and query inputs are validated. Desktop tables and narrow cards both expose identity, freshness and an explicit Open action. Full identifiers remain copyable.

## Identity and relationships

References are `asset:<integer>`, `device:<integer>` and `equipment:<uuid>`. Equal numeric IDs never alias. Asset/device links remain many-to-many. Gateway child relationships use the stored gateway ID, never matching names or location text. The compatibility `assets.getForDevice` remains available; current relationship views use `assets.getAllForDevice`. Direct telemetry without an explicit asset attribution is attached automatically only when exactly one stored asset link exists.

The additive `0023_inventory_context` migration records equipment creation origin explicitly. New independent instances set `is_standalone=true`; equipment attached to an existing asset sets false and appears as that asset's 3D capability. Existing workspaces conservatively retain their authoritative asset as the canonical row and remain available in the 3D equipment view. The migration does not guess their origin from names, identifiers or locations, change component identities, or create duplicate physical items.

The existing local equipment implementation uses an internal asset record for observations. Independent instances need no provisioned AAS, gateway, peer account or remote model service. Their inventory workspace does not advertise an AAS capability.

## Contextual sections

| Item | Sections |
| --- | --- |
| Asset | Overview, Telemetry; engineering-authorized AAS & submodels, Connections and Activity; explicit 3D sections when linked; Security when available; Control only for the supported ADA031 connection and authorized engineers |
| Gateway | Overview, Connected items, Connectivity, Diagnostics, Activity; supported firmware/security capabilities according to role |
| Ordinary IoT device | Overview, Telemetry, Connectivity, Activity; engineer thresholds and available firmware/security capabilities |
| Independent 3D equipment | Overview, 3D inspection, Components/BOM, Observations, Saved views, supported notes/history |

AAS engineering preserves manufacturer validation, original imported structures, revisions, restore-as-new-revision, exports, lifecycle history and public passports. Searchable submodels collapse independently. Full IDs are copyable; semantic/schema identifiers and raw JSON are secondary details. Unsupported sections show a useful capability/permission state rather than invoking a protected API.

Control is an explicit section. Existing authentication, allowlists, expiring commands, software limits, acknowledgement, confirmation and physical-state caveats are retained. Leaving the section resets its motion acknowledgement. Navigation, refresh, registration and selection send no physical control command. Firmware delivery remains intentionally disabled.

## Registration and mappings

**Add item** distinguishes device, gateway, AAS create/import and local 3D create/import. Device registration separates its kind from Direct MQTT, Via gateway or Not configured. Supported sensor/actuator/controller/edge IDs use the existing safe telemetry identity grammar. Parent gateways must be registered real gateways. Registration starts with no observed availability; it cannot fabricate an online report.

The ingestion contract already accepts `deviceId` with optional `gatewayId` and optional `assetId`. A direct device can therefore register and ingest without creating an AAS or gateway. Device-scoped TLS credentials and broker topic ACLs still require commissioning; the UI does not advertise automatic credential provisioning or unsupported protocols.

AAS registration uses identity, manufacturer and optional connection steps, retains AASX/direct MQTT paths, and reports completion or pending gateway publication with links to the created records. Broker acceptance never claims applied configuration. Metric/source/unit editors replace mandatory JSON entry. Advanced JSON remains available for supported protocol-specific settings, with the original service validators authoritative.

## Status and provenance policy

Configuration, observed connectivity, sample freshness, lifecycle and security coverage are separate fields. A stored link means **Connection configured**, never proof that a machine is live. A receiving gateway does not establish child availability.

- No connectivity observation: **Unknown / No observations**, even if the record starts with a stored offline value.
- An explicit offline report after an observation: **Offline**.
- Maintenance/error are explicit stored operational states.
- A commissioned per-device maximum age (5–86,400 seconds at registration) governs that device's live/stale evidence.
- The supported MQTT gateway/child bridge uses its documented 120-second grace policy for five-second reports. Actual gateway heartbeats record that protocol policy. Unknown direct device cadence has no invented default.
- ADA031 assets use only their own attributed connection observation with the existing 120-second policy. Other asset protocols remain Unknown without a commissioned observed policy; a linked gateway is not substituted.
- The latest sample has its own timestamp, mode and quality. Historical samples are labelled; accessible timestamps include the full date/time and timezone. Missing provenance remains Unknown, with authored demonstration records labelled Simulated.

Existing operational analytics deliberately excludes explicitly simulated/replayed integration streams and retains its legacy unclassified-sample compatibility. The UI labels that scope. The independent 3D observation streams preserve their existing live/simulated/replay classification and source-quality limitations.

Cybersecurity has one prominent evidence-mode scope for overview, posture, events, findings, incidents and supported exports. Combined scope retains mode breakdowns. Severity summaries open findings in the same scope; finding links use typed inventory identities and retain the originating investigation. Source receipt/event-driven freshness is coverage evidence, never proof of security. Demonstration loading is secondary setup. Immutable evidence, scoped mappings, permissions and the optional security-to-3D focus are unchanged.

## Routing, preferences and release

The application retains Wouter's hash router. A small navigation adapter preserves the complete hash query; the stock installed Wouter navigation moves a query into URL.search, which otherwise loses return/filter context. The existing equipment selection in URL.search remains supported. Legacy device and AAS detail URLs resolve to the typed item workspace; list routes resolve to inventory views. Alert details, public passports, cybersecurity finding/filter links and mapped 3D focus remain supported. Back/Forward, reload and return-to-results preserve context.

Inventory and security preferences are keyed by authenticated user ID. Authentication already clears query caches on account changes. Preferences contain no credentials or source keys. Expensive routes/3D remain lazy; protected queries are enabled only for appropriate roles and relevant panels. Inventory and item summaries refresh with one bounded query every 30 seconds while mounted; hidden 3D polling is paused. Imported-model mapping options come from the selected owned model, via an engineer-only query, rather than reusing bundled component IDs.

Use the existing Oracle/Vercel release procedure. Deploy the additive migration and compatible Node server before publishing a UI that queries the new inventory endpoints. The prior image and owner-only environment selection backup remain the rollback baseline; do not revert the database migration by dropping records. Existing equipment/security functionality and the production demo-data-off setting are preserved. No physical collector or firmware rollout is needed for this redesign.

## Verification

The focused runner is `pnpm e2e:workspace`; it starts disposable PostgreSQL/Redis, guarded local fixtures and individually named accounts. It exercises direct registration and real HTTP ingestion without an AAS/gateway, many-to-many relationships, imported AAS, explicit linked/standalone equipment, capability permissions, protected APIs, deep links, reload, Back/Forward, filters, mode scope, mobile focus and actual themes at 360/390/768/1440px. Its fixtures cannot run against a production or non-local database.

Run `pnpm check`, `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm e2e:equipment`, `pnpm e2e:security`, `pnpm e2e:workspace`, `pnpm docs:check`, `pnpm deployment:check`, `pnpm equipment:schemas:check` and `pnpm onesa:contract:check`. The workspace journeys are also a separate job in the existing checked CI workflow, so the Vercel gate waits for them. Runtime image acceptance and audit follow the canonical deployment guide.

Qualification counts, sources, representative rendered screenshots and hosted workflow links are recorded with the release evidence. Local populated fixtures do not claim that production has those records. Production UI testing does not seed a live demonstration, mutate records, publish gateway profiles, deliver firmware or move equipment.
