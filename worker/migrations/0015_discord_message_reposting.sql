ALTER TABLE discord_embeds ADD COLUMN superseded_message_id TEXT;
ALTER TABLE discord_review_notifications ADD COLUMN superseded_message_id TEXT;

ALTER TABLE discord_review_deletion_jobs
ADD COLUMN replace_message INTEGER NOT NULL DEFAULT 0
CHECK (replace_message IN (0, 1));

ALTER TABLE discord_review_deletion_jobs ADD COLUMN superseded_message_id TEXT;
