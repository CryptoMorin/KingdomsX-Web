CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  normalized_host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 25565 CHECK (port BETWEEN 1 AND 65535),
  website_url TEXT,
  social_links_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended', 'hidden_offline')),
  featured_rank INTEGER NOT NULL DEFAULT 0 CHECK (featured_rank >= 0),
  approved_at TEXT,
  suspended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX idx_servers_address ON servers (normalized_host, port);
CREATE INDEX idx_servers_public_order ON servers (status, featured_rank DESC, approved_at DESC);
CREATE INDEX idx_servers_updated_status ON servers (status, updated_at);

CREATE TABLE server_status (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
  players_online INTEGER CHECK (players_online IS NULL OR players_online >= 0),
  players_max INTEGER CHECK (players_max IS NULL OR players_max >= 0),
  motd_text TEXT,
  version_name TEXT,
  favicon_url_or_hash TEXT,
  checked_at TEXT,
  provider TEXT NOT NULL DEFAULT 'mcsrvstat',
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  offline_since TEXT
) STRICT;

CREATE INDEX idx_server_status_online ON server_status (online, checked_at);
CREATE INDEX idx_server_status_offline_since ON server_status (offline_since);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('staff_reviewed', 'plugin_callback_verified')),
  proof_redacted TEXT NOT NULL,
  submitter_ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  turnstile_result TEXT NOT NULL,
  moderation_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_submissions_ip_created ON submissions (submitter_ip_hash, created_at);
CREATE INDEX idx_submissions_server_created ON submissions (server_id, created_at);

CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_moderation_events_server ON moderation_events (server_id, created_at);
