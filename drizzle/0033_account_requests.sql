CREATE TABLE account_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind varchar(24) NOT NULL CHECK(kind IN ('registration','password_reset')),
 email varchar(320) NOT NULL,
 name varchar(255),
 organization varchar(255),
 job_title varchar(255),
 password_hash text,
 status varchar(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
 CHECK(kind <> 'registration' OR (name IS NOT NULL AND organization IS NOT NULL AND password_hash IS NOT NULL) OR status <> 'pending'),
 CHECK(kind <> 'password_reset' OR password_hash IS NULL)
);
CREATE UNIQUE INDEX account_requests_pending_identity ON account_requests(lower(email),kind) WHERE status='pending';
CREATE INDEX account_requests_review_queue ON account_requests(status,created_at DESC);
