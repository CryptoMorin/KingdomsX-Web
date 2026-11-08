CREATE TABLE server_public_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE
) STRICT;

INSERT INTO server_public_ids (server_id)
SELECT id
FROM servers
ORDER BY created_at, id;

CREATE TRIGGER servers_assign_public_id
AFTER INSERT ON servers
BEGIN
  INSERT INTO server_public_ids (server_id) VALUES (NEW.id);
END;
