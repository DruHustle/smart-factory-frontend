CREATE TABLE infrastructure_snapshots (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 collected_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL
);
CREATE INDEX infrastructure_snapshots_time ON infrastructure_snapshots(collected_at DESC);
CREATE TABLE infrastructure_collection_lease (
 slot bigint PRIMARY KEY, claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE infrastructure_service_state (
 service_id varchar(64) PRIMARY KEY, state jsonb NOT NULL
);
CREATE TABLE infrastructure_events (
 id uuid PRIMARY KEY, service_id varchar(64) NOT NULL, name varchar(100) NOT NULL,
 previous_state varchar(24), state varchar(24) NOT NULL,
 occurred_at timestamptz NOT NULL, kind varchar(24) NOT NULL, reason varchar(96) NOT NULL,
 dedupe_key varchar(200) UNIQUE NOT NULL
);
CREATE INDEX infrastructure_events_time ON infrastructure_events(occurred_at DESC);
CREATE TABLE infrastructure_recovery_receipts (
 receipt_id varchar(100) PRIMARY KEY, kind varchar(16) NOT NULL,
 observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 receipt jsonb NOT NULL
);
ALTER TABLE notification_inbox ADD COLUMN "infrastructureEventId" uuid REFERENCES infrastructure_events(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Occurrence and outbox acceptance have different meanings. Existing entries
-- predate this ledger and remain explicitly unclassified for queue age.
ALTER TABLE security_outbox ADD COLUMN accepted_at timestamptz;
ALTER TABLE security_outbox ALTER COLUMN accepted_at SET DEFAULT now();
