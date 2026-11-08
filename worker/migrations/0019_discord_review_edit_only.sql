ALTER TABLE discord_review_notification_jobs
ADD COLUMN edit_only INTEGER NOT NULL DEFAULT 0
CHECK (edit_only IN (0, 1));
