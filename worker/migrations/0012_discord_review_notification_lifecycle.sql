CREATE TABLE discord_review_notifications (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('submitted', 'resubmitted')),
  synced_status TEXT NOT NULL CHECK (synced_status IN ('pending', 'approved', 'rejected', 'suspended', 'hidden_offline')),
  synced_version TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

ALTER TABLE discord_review_notification_jobs
ADD COLUMN desired_status TEXT NOT NULL DEFAULT 'pending'
CHECK (desired_status IN ('pending', 'approved', 'rejected', 'suspended', 'hidden_offline'));

ALTER TABLE discord_review_notification_jobs
ADD COLUMN desired_version TEXT NOT NULL DEFAULT '';
