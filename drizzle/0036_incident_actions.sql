CREATE TABLE incident_actions (
 id serial PRIMARY KEY,
 alert_id integer NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
 title varchar(240) NOT NULL CHECK (length(trim(title)) > 0),
 owner_id integer REFERENCES users(id) ON DELETE SET NULL,
 due_date date,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
 outcome text CHECK (outcome IS NULL OR length(outcome) <= 2000),
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 CHECK (status <> 'completed' OR (outcome IS NOT NULL AND length(trim(outcome)) > 0))
);
CREATE INDEX incident_actions_alert_idx ON incident_actions(alert_id, id DESC);
CREATE INDEX incident_actions_owner_status_due_idx ON incident_actions(owner_id, status, due_date);
CREATE INDEX incident_actions_open_due_idx ON incident_actions(due_date, id) WHERE status IN ('open', 'in_progress');
