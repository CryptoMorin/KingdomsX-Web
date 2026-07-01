CREATE TABLE server_verification_challenges (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES submitter_accounts(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  normalized_host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 25565 CHECK (port BETWEEN 1 AND 65535),
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT,
  plugin_version TEXT,
  server_software TEXT,
  minecraft_version TEXT,
  created_ip_hash TEXT,
  created_user_agent_hash TEXT,
  callback_ip TEXT,
  callback_ip_hash TEXT,
  callback_user_agent_hash TEXT,
  callback_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_verification_challenges_owner_created ON server_verification_challenges (owner_account_id, created_at);
CREATE INDEX idx_verification_challenges_owner_status ON server_verification_challenges (owner_account_id, status, expires_at);
CREATE UNIQUE INDEX idx_verification_challenges_owner_pending
  ON server_verification_challenges (owner_account_id)
  WHERE status = 'pending';
CREATE INDEX idx_verification_challenges_status_expiry ON server_verification_challenges (status, expires_at);
CREATE INDEX idx_verification_challenges_ip_created ON server_verification_challenges (created_ip_hash, created_at);

ALTER TABLE submissions ADD COLUMN verification_challenge_id TEXT REFERENCES server_verification_challenges(id) ON DELETE SET NULL;
CREATE INDEX idx_submissions_verification_challenge ON submissions (verification_challenge_id);
CREATE UNIQUE INDEX idx_submissions_verification_challenge_unique
  ON submissions (verification_challenge_id)
  WHERE verification_challenge_id IS NOT NULL;
