CREATE TABLE password_reset_tokens (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email varchar(320) NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 auth_version integer NOT NULL,
 delivery_payload text NOT NULL DEFAULT '',
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 delivery_status varchar(24) NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error varchar(96),
 CONSTRAINT password_reset_tokens_delivery_status_check
  CHECK(delivery_status IN ('pending','accepted','failed','unconfigured','blocked','expired'))
);
CREATE INDEX password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_delivery ON password_reset_tokens(delivery_status,next_attempt_at,id) WHERE used_at IS NULL;
CREATE INDEX password_reset_tokens_expiry ON password_reset_tokens(expires_at);
