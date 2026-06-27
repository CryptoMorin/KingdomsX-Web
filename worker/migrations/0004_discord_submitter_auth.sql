CREATE TABLE submitter_accounts (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar_hash TEXT,
  guild_member_checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE submitter_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES submitter_accounts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

ALTER TABLE servers ADD COLUMN owner_account_id TEXT REFERENCES submitter_accounts(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN owner_account_id TEXT REFERENCES submitter_accounts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_servers_owner_account ON servers (owner_account_id) WHERE owner_account_id IS NOT NULL;
CREATE INDEX idx_submitter_sessions_account_expires ON submitter_sessions (account_id, expires_at);
CREATE INDEX idx_submitter_sessions_expires ON submitter_sessions (expires_at);
CREATE INDEX idx_submissions_owner_created ON submissions (owner_account_id, created_at);
