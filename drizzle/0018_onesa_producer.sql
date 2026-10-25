ALTER TABLE sensor_readings ADD COLUMN integration jsonb;
-- Optional adapter; no credentials or arbitrary tenant fields are stored here.
CREATE TABLE onesa_installation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 installation_id uuid NOT NULL, workspace_id varchar(128) NOT NULL, destination_fingerprint text NOT NULL,
 suspended boolean NOT NULL DEFAULT false, last_ack timestamptz, last_transport timestamptz,
 last_error varchar(80), discarded bigint NOT NULL DEFAULT 0, captured bigint NOT NULL DEFAULT 0,
 acknowledged bigint NOT NULL DEFAULT 0, quarantined bigint NOT NULL DEFAULT 0
);
CREATE TABLE onesa_equipment (
 equipment_id uuid PRIMARY KEY, external_asset_id varchar(128) NOT NULL UNIQUE,
 device_id varchar(128) NOT NULL, registration jsonb NOT NULL, mapping jsonb,
 version integer NOT NULL DEFAULT 0, retired boolean NOT NULL DEFAULT false,
 updated_by integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onesa_outbox (
 id bigserial PRIMARY KEY, source_id varchar(64) NOT NULL UNIQUE,
 equipment_id uuid, payload jsonb NOT NULL, state varchar(24) NOT NULL DEFAULT 'captured'
 CHECK (state IN ('captured','pending','quarantine','acknowledged')),
 attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz,
 error_code varchar(80), receipt jsonb, normalized boolean NOT NULL DEFAULT false
);
CREATE INDEX onesa_outbox_pending_idx ON onesa_outbox (state,next_attempt,id);
CREATE TABLE onesa_audit (
 id bigserial PRIMARY KEY, actor integer NOT NULL, action varchar(40) NOT NULL,
 equipment_id uuid, version integer, created_at timestamptz NOT NULL DEFAULT now()
);
