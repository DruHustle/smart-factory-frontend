CREATE TABLE factory_layouts (
 id uuid PRIMARY KEY,
 owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 layout_scope varchar(16) NOT NULL CHECK (layout_scope IN ('live','configured')),
 name varchar(120) NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX factory_layouts_owner_scope ON factory_layouts(owner_id,layout_scope,updated_at DESC);
