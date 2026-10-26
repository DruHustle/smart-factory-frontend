-- Application-owned observations, detections and focused investigations; additive.
CREATE TABLE security_sources (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL, namespace varchar(64) NOT NULL UNIQUE,
 system_key varchar(32) UNIQUE, token_hash char(64), active boolean NOT NULL DEFAULT true, is_demo boolean NOT NULL DEFAULT false,
 policy jsonb NOT NULL, last_received_at timestamptz, latest_event_at timestamptz, last_error varchar(96),
 created_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE security_mappings (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES security_sources(id), namespace varchar(128) NOT NULL,
 asset_ref varchar(128) NOT NULL, component_ref varchar(128) NOT NULL DEFAULT '', target jsonb NOT NULL,
 installed_component_id uuid, reviewed_by integer NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_id,namespace,asset_ref,component_ref)
);
CREATE TABLE security_rules (
 id varchar(64) NOT NULL, version integer NOT NULL, settings jsonb NOT NULL, active boolean NOT NULL,
 actor_id integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,version)
);
CREATE UNIQUE INDEX security_rule_active ON security_rules(id) WHERE active;
CREATE TABLE security_baselines (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES security_sources(id), revision varchar(128) NOT NULL,
 settings jsonb NOT NULL, proposed_by integer REFERENCES users(id), approved_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, UNIQUE(source_id,revision)
);
CREATE TABLE security_events (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES security_sources(id), source_event_id varchar(128) NOT NULL,
 fingerprint char(64) NOT NULL, envelope jsonb NOT NULL, event_type varchar(64) NOT NULL,
 mode varchar(16) NOT NULL CHECK(mode IN ('live','simulated','replay','unknown')), quality varchar(16) NOT NULL,
 target jsonb, installed_component_id uuid, association varchar(24) NOT NULL,
 occurred_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 clock_skew boolean NOT NULL, late boolean NOT NULL, bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 8192),
 UNIQUE(source_id,source_event_id)
);
CREATE INDEX security_events_source_time ON security_events(source_id,event_type,mode,occurred_at DESC);
CREATE INDEX security_events_page ON security_events(ingested_at DESC,id);
CREATE TABLE security_findings (
 id uuid PRIMARY KEY, fingerprint char(64) NOT NULL UNIQUE, source_id uuid NOT NULL REFERENCES security_sources(id),
 rule_id varchar(64) NOT NULL, rule_version integer NOT NULL, baseline_id uuid REFERENCES security_baselines(id),
 title varchar(200) NOT NULL, category varchar(24) NOT NULL, severity varchar(16) NOT NULL, confidence varchar(32) NOT NULL,
 target jsonb, installed_component_id uuid, mode varchar(16) NOT NULL, run_id varchar(128),
 explanation jsonb NOT NULL, status varchar(24) NOT NULL DEFAULT 'open', condition_active boolean NOT NULL DEFAULT true,
 occurrences integer NOT NULL DEFAULT 1, recurrences integer NOT NULL DEFAULT 0,
 first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, condition_until timestamptz NOT NULL,
 risk_until timestamptz, version integer NOT NULL DEFAULT 1, FOREIGN KEY(rule_id,rule_version) REFERENCES security_rules(id,version)
);
CREATE INDEX security_findings_target ON security_findings ((target->>'kind'),(target->>'id'),last_seen DESC);
CREATE INDEX security_findings_status_time ON security_findings(mode,status,last_seen DESC);
CREATE TABLE security_finding_evidence (
 finding_id uuid NOT NULL REFERENCES security_findings(id), event_id uuid NOT NULL, source_id uuid NOT NULL,
 snapshot jsonb NOT NULL, fingerprint char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(finding_id,event_id)
);
CREATE TABLE security_incidents (
 id uuid PRIMARY KEY, finding_id uuid NOT NULL UNIQUE REFERENCES security_findings(id),
 assigned_to integer REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE security_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action varchar(64) NOT NULL, actor_id integer REFERENCES users(id),
 finding_id uuid REFERENCES security_findings(id), source_id uuid REFERENCES security_sources(id),
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_finding_time ON security_audit(finding_id,id);
CREATE TABLE security_posture (
 target_key varchar(64) PRIMARY KEY, target jsonb NOT NULL, zone varchar(100), criticality varchar(16) NOT NULL,
 reason varchar(1000) NOT NULL, reviewed_by integer REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE security_imports (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES security_sources(id), original_sha256 char(64) NOT NULL,
 producer_version varchar(64) NOT NULL, produced_at timestamptz NOT NULL, target jsonb NOT NULL,
 report jsonb NOT NULL, provenance jsonb NOT NULL, matching_method varchar(64) NOT NULL, actor_id integer REFERENCES users(id),
 bytes integer NOT NULL, rule_version integer NOT NULL, event_snapshot jsonb NOT NULL, evidence_id uuid NOT NULL,
 processing_cursor integer NOT NULL DEFAULT 0, processing_attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(), processing_state varchar(24) NOT NULL DEFAULT 'queued', last_error varchar(96),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_id,original_sha256)
);
CREATE TABLE security_outbox (
 id uuid PRIMARY KEY, producer varchar(64) NOT NULL, event_type varchar(64) NOT NULL, attributes jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(), quarantined_at timestamptz, error_code varchar(96),
 delivered_at timestamptz
);
CREATE INDEX security_outbox_pending ON security_outbox(next_attempt) WHERE delivered_at IS NULL AND quarantined_at IS NULL;
ALTER TABLE notification_inbox ADD COLUMN "securityFindingId" uuid REFERENCES security_findings(id);
CREATE OR REPLACE FUNCTION security_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Security evidence is append only'; END; $$;
CREATE TRIGGER security_event_immutable BEFORE UPDATE ON security_events FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER security_snapshot_immutable BEFORE UPDATE ON security_finding_evidence FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER security_audit_immutable BEFORE UPDATE ON security_audit FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TABLE security_usage (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), bytes bigint NOT NULL DEFAULT 0,
 events integer NOT NULL DEFAULT 0, reports integer NOT NULL DEFAULT 0, findings integer NOT NULL DEFAULT 0,
 retention_days integer NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 7 AND 90)
);
INSERT INTO security_usage(singleton) VALUES(true);
