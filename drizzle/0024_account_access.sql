ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS session_revocations (
 session_hash varchar(64) PRIMARY KEY CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 user_id integer NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS session_revocations_expiry ON session_revocations(expires_at);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_credential_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_credential_used_at timestamptz;
