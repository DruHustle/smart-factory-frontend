ALTER TABLE sensor_readings ADD COLUMN measurements jsonb;
--> statement-breakpoint
ALTER TABLE alert_thresholds ADD COLUMN unit varchar(32);
--> statement-breakpoint
CREATE TABLE telemetry_rejections (
 fingerprint varchar(64) PRIMARY KEY,
 device_id varchar(64) NOT NULL,
 reason varchar(64) NOT NULL,
 occurred_at bigint NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 last_received_at timestamptz NOT NULL DEFAULT now(),
 occurrences integer NOT NULL DEFAULT 1,
 evidence jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX telemetry_rejections_time ON telemetry_rejections(last_received_at DESC);
--> statement-breakpoint
CREATE TABLE ingestion_rejection_counters (
 reason varchar(64) PRIMARY KEY,
 total bigint NOT NULL DEFAULT 0,
 last_received_at timestamptz NOT NULL DEFAULT now()
);
