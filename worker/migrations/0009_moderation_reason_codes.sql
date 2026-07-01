ALTER TABLE moderation_events ADD COLUMN reason_code TEXT
  CHECK (
    reason_code IS NULL OR reason_code IN (
      'server_unreachable',
      'kingdomsx_not_verified',
      'public_details_incomplete',
      'inappropriate_or_unsafe'
    )
  );
