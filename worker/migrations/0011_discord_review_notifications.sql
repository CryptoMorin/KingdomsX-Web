CREATE TABLE discord_review_notification_jobs (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('submitted', 'resubmitted')),
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

CREATE INDEX idx_discord_review_notification_jobs_due
ON discord_review_notification_jobs (next_attempt_at, lease_expires_at);
