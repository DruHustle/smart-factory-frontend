ALTER TABLE alerts ADD COLUMN evidence_snapshot jsonb;
ALTER TABLE alerts ADD COLUMN latest_evidence_snapshot jsonb;
ALTER TABLE alerts ADD COLUMN last_observed_at timestamptz;
ALTER TABLE alerts ADD COLUMN occurrences integer NOT NULL DEFAULT 1;
CREATE TABLE incident_activity (
 id bigserial PRIMARY KEY,
 alert_id integer NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('note','assigned','acknowledged','downtime_confirmed','resolved')),
 actor_id integer REFERENCES users(id) ON DELETE SET NULL,
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_activity_history_idx ON incident_activity(alert_id,id);
CREATE TABLE gateway_observations (
 id bigserial PRIMARY KEY,
 device_id integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 occurred_at bigint NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 reported_status text NOT NULL CHECK(reported_status IN ('online','offline')),
 current_eligible boolean NOT NULL,
 reason text,
 UNIQUE(device_id,occurred_at,reported_status)
);
CREATE INDEX gateway_observations_time_idx ON gateway_observations(device_id,occurred_at DESC);
