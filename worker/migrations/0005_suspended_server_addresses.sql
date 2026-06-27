CREATE TABLE suspended_server_addresses (
  normalized_host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 25565 CHECK (port BETWEEN 1 AND 65535),
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  reason TEXT,
  suspended_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (normalized_host, port)
) STRICT;

CREATE INDEX idx_suspended_server_addresses_server ON suspended_server_addresses (server_id);

INSERT INTO suspended_server_addresses (normalized_host, port, server_id, reason, suspended_at, created_at, updated_at)
SELECT
  normalized_host,
  port,
  id,
  'Backfilled from suspended server listing.',
  COALESCE(suspended_at, updated_at),
  COALESCE(suspended_at, updated_at),
  updated_at
FROM servers
WHERE status = 'suspended'
ON CONFLICT(normalized_host, port) DO NOTHING;
