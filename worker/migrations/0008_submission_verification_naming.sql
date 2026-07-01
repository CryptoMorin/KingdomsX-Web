ALTER TABLE submissions RENAME TO submissions_legacy;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('legacy_console_output', 'plugin_callback')),
  verification_evidence TEXT NOT NULL,
  submitter_ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  turnstile_result TEXT NOT NULL,
  moderation_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  owner_account_id TEXT REFERENCES submitter_accounts(id) ON DELETE SET NULL,
  verification_challenge_id TEXT REFERENCES server_verification_challenges(id) ON DELETE SET NULL
) STRICT;

INSERT INTO submissions (
  id,
  server_id,
  contact,
  verification_method,
  verification_evidence,
  submitter_ip_hash,
  user_agent_hash,
  turnstile_result,
  moderation_notes,
  created_at,
  owner_account_id,
  verification_challenge_id
)
SELECT
  id,
  server_id,
  contact,
  CASE proof_type
    WHEN 'staff_reviewed' THEN 'legacy_console_output'
    WHEN 'plugin_callback_verified' THEN 'plugin_callback'
  END,
  proof_redacted,
  submitter_ip_hash,
  user_agent_hash,
  turnstile_result,
  moderation_notes,
  created_at,
  owner_account_id,
  verification_challenge_id
FROM submissions_legacy;

DROP TABLE submissions_legacy;

CREATE INDEX idx_submissions_ip_created ON submissions (submitter_ip_hash, created_at);
CREATE INDEX idx_submissions_server_created ON submissions (server_id, created_at);
CREATE INDEX idx_submissions_owner_created ON submissions (owner_account_id, created_at);
CREATE INDEX idx_submissions_verification_challenge ON submissions (verification_challenge_id);
CREATE UNIQUE INDEX idx_submissions_verification_challenge_unique
  ON submissions (verification_challenge_id)
  WHERE verification_challenge_id IS NOT NULL;

ALTER TABLE server_verification_challenges DROP COLUMN callback_payload_json;
