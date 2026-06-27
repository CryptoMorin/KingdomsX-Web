DROP INDEX IF EXISTS idx_servers_public_order;

CREATE INDEX idx_servers_public_approved_order ON servers (status, approved_at DESC, created_at DESC);
CREATE INDEX idx_server_status_players_order ON server_status (players_online DESC, online DESC, checked_at DESC);
