ALTER TABLE alerts ADD COLUMN source_condition text NOT NULL DEFAULT 'unknown'
  CHECK (source_condition IN ('unknown', 'active', 'cleared'));
ALTER TABLE alerts ADD COLUMN condition_observed_at timestamptz;
ALTER TABLE alerts ADD COLUMN condition_valid_until timestamptz;
ALTER TABLE alerts ADD COLUMN condition_invalid_reason varchar(100);
ALTER TABLE alerts ADD COLUMN condition_evidence jsonb;
CREATE INDEX alerts_source_condition_idx ON alerts
  ("deviceId", "assetId", metric, (condition_evidence->'thresholdConfiguration'), id DESC)
  WHERE source_condition IN ('active', 'cleared');

-- Existing review statuses are deliberately not treated as physical source evidence.
ALTER TABLE incident_activity DROP CONSTRAINT incident_activity_kind_check;
ALTER TABLE incident_activity ADD CONSTRAINT incident_activity_kind_check
  CHECK (kind IN ('note', 'assigned', 'acknowledged', 'downtime_confirmed', 'resolved',
    'source_active', 'source_cleared', 'source_unverified'));
