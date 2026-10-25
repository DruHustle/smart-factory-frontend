ALTER TABLE equipment_workspaces ADD COLUMN source_device_id varchar(64);
CREATE TABLE equipment_model_packages (
 id text PRIMARY KEY, manifest jsonb NOT NULL, glb bytea NOT NULL,
 sha256 varchar(64) NOT NULL, bytes integer NOT NULL CHECK (bytes BETWEEN 28 AND 20971520),
 created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
