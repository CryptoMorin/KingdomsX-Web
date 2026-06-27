ALTER TABLE server_status ADD COLUMN refresh_attempted_at TEXT;
ALTER TABLE server_status ADD COLUMN refresh_error TEXT;

UPDATE server_status
SET refresh_attempted_at = checked_at
WHERE refresh_attempted_at IS NULL;

CREATE INDEX idx_server_status_refresh_due ON server_status (refresh_attempted_at, checked_at);
