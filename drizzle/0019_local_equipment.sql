-- Local equipment is independent of optional Onesa installation/configuration.
CREATE TABLE equipment_workspaces (
 id uuid PRIMARY KEY, asset_id integer NOT NULL UNIQUE, template_revision text NOT NULL,
 components jsonb NOT NULL, kind varchar(16) NOT NULL CHECK (kind IN ('real','simulated')),
 is_demo boolean NOT NULL DEFAULT false, selected_component uuid,
 annotations jsonb NOT NULL DEFAULT '[]', viewpoints jsonb NOT NULL DEFAULT '[]',
 version integer NOT NULL DEFAULT 1, updated_by integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE equipment_scenario_runs (
 id uuid PRIMARY KEY, equipment_id uuid NOT NULL REFERENCES equipment_workspaces(id),
 scenario varchar(16) NOT NULL, started_at timestamptz NOT NULL DEFAULT now()
);
