-- Latest authenticated worker receipt only; no factory identifiers or credentials.
CREATE TABLE runtime_worker_status (
  worker varchar(32) PRIMARY KEY CHECK(worker='telemetry'),
  report jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
