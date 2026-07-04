CREATE TABLE discord_review_deletion_jobs (
  server_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_discord_review_deletion_jobs_due
ON discord_review_deletion_jobs (next_attempt_at, lease_expires_at);
