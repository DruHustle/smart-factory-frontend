# Application Database Schema

The dashboard uses PostgreSQL with Drizzle ORM. The source of truth is drizzle/schema.ts; checked-in SQL migrations live in drizzle/.

```mermaid
erDiagram
  USERS ||--o{ ASSET_LIFECYCLE_EVENTS : records
  USERS ||--o{ SYSTEM_SETTINGS : updates
  ASSETS ||--o{ ASSET_VERSIONS : snapshots
  ASSETS ||--o{ ASSET_DEVICES : connected_through
  DEVICES ||--o{ ASSET_DEVICES : gateways
  DEVICES ||--o{ SENSOR_READINGS : reports
  USERS {
    int id PK
    string email
    string password
    string role
  }
  SYSTEM_SETTINGS {
    string key PK
    json value
    int updatedBy
    timestamp updatedAt
  }
  ASSETS {
    int id PK
    string assetId
    string name
    string lifecycleStage
    int aasVersion
    json aasShell
    json aasSubmodels
    boolean isDemo
  }
  ASSET_DEVICES {
    int id PK
    int assetId
    int deviceId
    string protocol
    string endpoint
    json tagMappings
  }
  ASSET_LIFECYCLE_EVENTS {
    int id PK
    int assetId
    int changedBy
    string toStage
  }
  ASSET_VERSIONS {
    int id PK
    int assetId
    int version
    int changedBy
    string sha256
    json snapshot
  }
  LOGIN_RATE_LIMITS {
    string keyHash PK
    int attempts
    timestamp resetAt
  }
  DEVICES {
    int id PK
    string deviceId
    string type
    string status
  }
  SENSOR_READINGS {
    int id PK
    int deviceId
    string assetId
    string ingestionId
    json assetSignals
    float temperature
    float vibration
    bigint timestamp
  }
```

## Incident response and downtime records

```mermaid
flowchart LR
  Users[users<br/>id PK] -->|assignedToId / resolvedById| Alerts[alerts<br/>id PK<br/>deviceId<br/>errorCode<br/>status<br/>downtimeStartedAt<br/>resolvedAt]
  Devices[devices<br/>id PK] -->|deviceId| Alerts
  Devices -->|deviceId| Thresholds[alert_thresholds<br/>id PK<br/>metric<br/>warning and critical limits]
```

Threshold-generated incidents use stable `SF-*` platform classifications. A vendor diagnostic code is stored as supplied when available. The engineer role provides technician assignment and resolution permissions; downtime is explicitly confirmed by the assigned engineer or administrator. A lost device connection does not automatically prove a factory outage. Existing records inferred by migration 0010 need operational review before use in downtime KPIs. Mean downtime-to-resolution uses only records with both downtime and resolution timestamps.

| Table | Purpose |
|---|---|
| users | Local identity, bcrypt password hash in `password`, role, and sign-in timestamps. Never expose the hash in API responses. |
| system_settings | Durable application-wide settings changed by administrators. `demo_data_enabled` controls whether demo rows are included; replicas refresh it without requiring a deployment. |
| devices | Connectivity devices. Registrations support gateways, edge devices, sensors, actuators and controllers. Includes status, location, firmware, and simulator marker. Migration `0015_melted_dragon_lord` adds `edge_device`. |
| assets | Equipment identity, manufacturer name/designation, separate required postal fields, article and order codes, optional serial/rated values, lifecycle, current AAS JSON, monotonic AAS revision, and simulator marker. |
| asset_devices | Asset-to-gateway protocol, endpoint, and tag/register mappings. Store credentials on the edge gateway, not in mappings. |
| asset_lifecycle_events | Actor, transition, timestamp, and engineering note audit history. |
| asset_versions | Append-only AAS snapshots keyed by asset and revision, with change note, actor, and SHA-256 integrity digest. Migration baseline rows have no digest because prior revisions were not recorded. |
| login_rate_limits | Hashed IP/email identifiers, fixed-window counters, and expiration timestamps shared across application replicas. |
| sensor_readings | Nullable measurements, AAS asset attribution, named signals, Unix epoch millisecond timestamps, and a unique ingestion digest for retry deduplication. Indexes cover asset/date and device/date queries. |
| alerts | Stable platform/vendor error code, severity/status, metric observation, acknowledging actor/time, assigned engineer/time, confirmed downtime start, resolving actor/time, and lifecycle timestamps. Per-source transaction locks deduplicate threshold incidents by device/asset/metric; query indexes cover status/date and assignee/status. |
| alert_thresholds | Enabled per-device warning and critical bands used to classify telemetry into incidents. |
| firmware_versions, ota_deployments | Firmware catalog metadata and legacy rollout rows. OTA is disabled; a rollout row is not proof that a device downloaded, verified, installed, or booted a release. |

Connection and lifecycle ids are application-level relationships, not database-enforced foreign keys in the current schema. Oracle-hosted BaSyx owns separate storage in the Aiven `basyx` PostgreSQL database; it is not part of the Drizzle application schema. Demo rows are marked `isDemo`; startup and viewing never seed. An explicit local CLI creates isolated showcase fixtures. Administrators control visibility separately; shared identities see only approved demo records.

Review migration SQL before applying changes. Set DATABASE_URL to the intended database before running pnpm db:migrate. pnpm e2e uses its own disposable PostgreSQL container.

## Durable incident notifications

Migration `0013_incident_notifications` adds `notification_inbox` and an alert trigger. In the alert transaction, new warning/critical incidents and critical escalations notify current engineers/admins; assignment changes notify new/previous assignees and admins; resolution notifies the assigned technician/admins. Migration `0016_vengeful_victor_mancha` makes the alert link nullable so the same durable queue can carry account-created welcome mail without inventing an incident. The trigger does not backfill historical incidents or emit duplicate messages on unrelated incident updates.

Each row belongs to one account, optionally links to an alert, and retains title/body, read time, email status, attempts, next attempt time, safe error summary and provider acceptance time. Foreign-key cascades remove rows when their account or associated alert is deleted. The delivery worker atomically claims due rows using a two-minute lease and retries after a crash. `accepted` means the provider accepted the request, not that the email reached a mailbox. Eight failed attempts become `failed`; an authorized owner may retry an incident message after correcting configuration. `unconfigured` and `no_recipient` remain visible for incident messages; account welcome rows are email-only and do not appear in the incident inbox.

The inbox is queryable only by its owner. Reads do not acknowledge/resolve the factory incident. Email-provider credentials, sender identity and recipient policy are runtime secrets/configuration, not editable browser notification settings. Plan retention/archive policies for both telemetry and inbox history before long-term production operation.

Migration `0014_account_email_identity` adds a case-insensitive unique email index. Null emails remain allowed for legacy identity records. Existing duplicate case-folded email addresses must be reconciled by an administrator before migration. Production self-registration is closed; further accounts are created by an authenticated administrator after private first-admin bootstrap. Passwords are never included in account API responses.


## Trusted observation and access additions

Migrations 0024–0028 add disabled/recovery/session-generation state, hashed session revocations, immutable selected-field passport publications, engineering conversion metadata, reviewed threshold units, bounded ingestion quarantine with continuing counters, incident snapshots and append-only review history, acquired/received gateway observations, and a singleton authenticated worker-status receipt. Acquisition time, receipt time, current eligibility and evidence mode are separate fields.

Scopes precede sample selection and aggregation. Source values, units, conversion version and quality remain inspectable. Unitless thresholds require review. Passport publication is explicit and revocable. Runtime checks compare migration hashes with the applied ledger.

## Factory layouts and FX/TSN diagnostics

Migration `0031_factory_layouts` adds `factory_layouts`: UUID identity, owning user (with delete cascade), `live`/`configured` scope, name, JSON document, positive version, archive time and creation/update timestamps. The owner/scope/update index supports bounded layout listing. Saves check the expected version to reject stale updates. Geometry is visualization state, separate from asset identity, physical commissioning and telemetry history. Shared demo layout drafts and editable sandbox changes stay browser-local; they are not rows in this table. See [factory layouts](factory-layouts.md) and [editable demo](editable-demo.md).

FX/TSN reports use the existing `system_settings` JSON storage under a hashed `network-diagnostics:` gateway key; there is no separate diagnostics migration or high-rate packet-history table. The stored envelope contains the validated report, import time and actor. Each registered operational gateway retains one newest report, and an older replacement is rejected. Responses are bounded to 128 gateways and report coverage and staleness explicitly. Demo scenarios are synthetic examples, separate from operational reports. See [the diagnostics store](../server/network-diagnostics/store.ts) and [FX/TSN report contract](fx-tsn.md).
