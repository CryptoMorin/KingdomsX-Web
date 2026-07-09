export const SERVER_STATUS_SELECT_COLUMNS = `
      s.*,
      ss.online,
      ss.players_online,
      ss.players_max,
      ss.motd_text,
      ss.version_name,
      ss.favicon_url_or_hash,
      ss.checked_at,
      ss.provider,
      ss.failure_count,
      ss.offline_since,
      ss.refresh_attempted_at,
      ss.refresh_error`;
