CREATE TABLE ot_operations_configuration (
 scope text PRIMARY KEY CHECK (scope='installation' OR scope ~ '^[a-f0-9-]{36}$'),
 configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration)='object'),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 updated_by integer REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ot_production_periods (
 id serial PRIMARY KEY,
 scope text NOT NULL REFERENCES ot_operations_configuration(scope),
 start_time timestamptz NOT NULL,
 end_time timestamptz NOT NULL CHECK (end_time>start_time),
 boundary_label varchar(120) NOT NULL,
 input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 author_name varchar(320) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ot_production_periods_scope_time_idx ON ot_production_periods(scope,start_time,end_time);
CREATE TABLE ot_shift_handover (
 id serial PRIMARY KEY,
 scope text NOT NULL REFERENCES ot_operations_configuration(scope),
 shift_key varchar(100) NOT NULL,
 shift_start timestamptz NOT NULL,
 shift_end timestamptz NOT NULL CHECK (shift_end>shift_start),
 shift_name varchar(60) NOT NULL,
 time_zone varchar(80) NOT NULL,
 text text NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 4000),
 next_step text NOT NULL CHECK (length(trim(next_step)) BETWEEN 1 AND 1000),
 asset_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(asset_refs)='array'),
 incident_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(incident_ids)='array'),
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 author_name varchar(320) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ot_shift_handover_scope_shift_idx ON ot_shift_handover(scope,shift_start,id DESC);
CREATE TABLE ot_operations_activity (
 id bigserial PRIMARY KEY,
 scope text NOT NULL,
 kind varchar(40) NOT NULL,
 detail jsonb NOT NULL,
 actor_id integer REFERENCES users(id) ON DELETE SET NULL,
 actor_name varchar(320) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ot_operations_activity_scope_idx ON ot_operations_activity(scope,id DESC);
