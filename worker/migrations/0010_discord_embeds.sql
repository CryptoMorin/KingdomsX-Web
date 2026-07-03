CREATE TABLE discord_embeds (
  server_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  synced_version TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT
) STRICT;

CREATE TABLE discord_embed_jobs (
  server_id TEXT PRIMARY KEY,
  desired_action TEXT NOT NULL CHECK (desired_action IN ('upsert', 'delete')),
  desired_version TEXT NOT NULL,
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

CREATE INDEX idx_discord_embed_jobs_due
ON discord_embed_jobs (next_attempt_at, lease_expires_at);
