CREATE TABLE asset_passport_publications (
 id uuid PRIMARY KEY,
 asset_id integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 document jsonb NOT NULL,
 published_by integer NOT NULL REFERENCES users(id),
 published_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
--> statement-breakpoint
CREATE INDEX passport_asset_publication ON asset_passport_publications(asset_id, published_at DESC);
