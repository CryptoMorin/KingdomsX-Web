import { STATUS_REFRESH_BATCH_LIMIT, STATUS_REFRESH_INTERVAL_MS } from "../config";
import type { DirectoryEnv } from "../contracts";
import { msAgoIso } from "../core/runtime";
import type { StatusSnapshot } from "./providers";
import { discordEmbedJobStatement, discordReviewStatusJobStatement } from "../discord/outbox";

export interface StatusRefreshRow {
  id: string;
  normalized_host: string;
  port: number;
}

export async function scheduledStatusRows(env: DirectoryEnv): Promise<StatusRefreshRow[]> {
  const result = await env.DB.prepare(
    `
    SELECT s.id, s.normalized_host, s.port
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
      AND (ss.refresh_attempted_at IS NULL OR ss.refresh_attempted_at <= ?)
    ORDER BY ss.refresh_attempted_at IS NULL DESC, ss.refresh_attempted_at ASC, ss.checked_at ASC, s.updated_at ASC
    LIMIT ?
  `
  )
    .bind(msAgoIso(STATUS_REFRESH_INTERVAL_MS), STATUS_REFRESH_BATCH_LIMIT)
    .all<StatusRefreshRow>();

  return result.results;
}

export async function localStatusRows(env: DirectoryEnv): Promise<StatusRefreshRow[]> {
  const result = await env.DB.prepare(
    `
    SELECT s.id, s.normalized_host, s.port
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
      AND (ss.server_id IS NULL OR ss.refresh_attempted_at IS NULL OR ss.refresh_attempted_at <= ?)
    ORDER BY ss.refresh_attempted_at IS NULL DESC, ss.refresh_attempted_at ASC, s.updated_at ASC
    LIMIT ?
  `
  )
    .bind(msAgoIso(STATUS_REFRESH_INTERVAL_MS), STATUS_REFRESH_BATCH_LIMIT)
    .all<StatusRefreshRow>();

  return result.results;
}

export function statusSnapshotStatements(
  env: DirectoryEnv,
  serverId: string,
  snapshot: StatusSnapshot,
  timestamp: string
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `
    INSERT INTO server_status (server_id, online, players_online, players_max, motd_text, version_name, favicon_url_or_hash, checked_at, provider, failure_count, offline_since, refresh_attempted_at, refresh_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(server_id) DO UPDATE SET
      online = excluded.online,
      players_online = excluded.players_online,
      players_max = excluded.players_max,
      motd_text = excluded.motd_text,
      version_name = excluded.version_name,
      favicon_url_or_hash = excluded.favicon_url_or_hash,
      checked_at = excluded.checked_at,
      provider = excluded.provider,
      refresh_attempted_at = excluded.refresh_attempted_at,
      refresh_error = NULL,
      failure_count = CASE WHEN excluded.online = 1 THEN 0 ELSE server_status.failure_count + 1 END,
      offline_since = CASE
        WHEN excluded.online = 1 THEN NULL
        WHEN server_status.offline_since IS NULL THEN excluded.checked_at
        ELSE server_status.offline_since
      END
  `
    ).bind(
      serverId,
      snapshot.online ? 1 : 0,
      snapshot.playersOnline,
      snapshot.playersMax,
      snapshot.motdText,
      snapshot.versionName,
      snapshot.favicon,
      timestamp,
      snapshot.provider,
      snapshot.online ? 0 : 1,
      snapshot.online ? null : timestamp,
      timestamp
    )
  ];
}

export function statusRefreshFailureStatements(
  env: DirectoryEnv,
  serverId: string,
  timestamp: string,
  message: string
): D1PreparedStatement[] {
  return [
    // Provider failures count as failed attempts
    // They must not start or extend the confirmed offline window
    env.DB.prepare(
      `
    INSERT INTO server_status (server_id, online, checked_at, provider, failure_count, refresh_attempted_at, refresh_error)
    VALUES (?, 0, NULL, 'refresh-error', 1, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      refresh_attempted_at = excluded.refresh_attempted_at,
      refresh_error = excluded.refresh_error,
      failure_count = server_status.failure_count + 1
  `
    ).bind(serverId, timestamp, message)
  ];
}

export async function offlineSince(env: DirectoryEnv, serverId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT offline_since FROM server_status WHERE server_id = ? AND online = 0")
    .bind(serverId)
    .first<{ offline_since: string | null }>();

  return row?.offline_since ?? null;
}

export function autoHideOfflineStatements(
  env: DirectoryEnv,
  serverId: string,
  timestamp: string
): D1PreparedStatement[] {
  return [
    env.DB.prepare("UPDATE servers SET status = 'hidden_offline', updated_at = ? WHERE id = ? AND status = 'approved'").bind(timestamp, serverId),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, 'system', 'hidden-offline', 'Auto-hidden after 14 days offline.', ?)").bind(crypto.randomUUID(), serverId, timestamp),
    discordEmbedJobStatement(env, serverId, "delete", timestamp),
    discordReviewStatusJobStatement(env, serverId, "hidden_offline", timestamp)
  ];
}
