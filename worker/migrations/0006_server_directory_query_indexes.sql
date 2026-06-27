CREATE INDEX idx_servers_status_name ON servers (status, name COLLATE NOCASE, id);
CREATE INDEX idx_moderation_events_server_action_created ON moderation_events (server_id, action, created_at);
