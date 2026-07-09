import { HOMEPAGE_DIRECTORY_ORDER, PUBLIC_DIRECTORY_ORDER } from "../config";
import type { DirectoryEnv, PublicServerRow, PublicSort, PublicStatusFilter } from "../contracts";
import { SERVER_STATUS_SELECT_COLUMNS } from "../core/server-status-columns";

function publicSelectSql(whereSql: string, orderBySql: string, tail: string): string {
  return `
    SELECT${SERVER_STATUS_SELECT_COLUMNS},
      owner.username AS owner_username,
      owner.global_name AS owner_global_name
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id
    WHERE ${whereSql}
    ORDER BY ${orderBySql}
    ${tail}
  `;
}

function publicOrderBy(sort: PublicSort): string {
  switch (sort) {
    case "players":
      return "COALESCE(ss.players_online, 0) DESC, COALESCE(ss.online, 0) DESC, COALESCE(s.approved_at, s.created_at) DESC, s.id ASC";
    case "name":
      return "s.name COLLATE NOCASE ASC, s.id ASC";
    default:
      return PUBLIC_DIRECTORY_ORDER;
  }
}

function publicWhere(status: PublicStatusFilter): string {
  if (status === "online")
    return "s.status = 'approved' AND ss.online = 1";

  if (status === "offline")
    return "s.status = 'approved' AND COALESCE(ss.online, 0) = 0";

  return "s.status = 'approved'";
}

export async function listPublicServerRows(
  env: DirectoryEnv,
  status: PublicStatusFilter,
  sort: PublicSort,
  limit: number,
  offset: number
): Promise<PublicServerRow[]> {
  const rows = await env.DB.prepare(
    publicSelectSql(publicWhere(status), publicOrderBy(sort), "LIMIT ? OFFSET ?")
  )
    .bind(limit, offset)
    .all<PublicServerRow>();

  return rows.results;
}

export async function recentPublicServerRows(
  env: DirectoryEnv,
  limit: number
): Promise<PublicServerRow[]> {
  const rows = await env.DB.prepare(
    publicSelectSql(publicWhere("all"), HOMEPAGE_DIRECTORY_ORDER, "LIMIT ?")
  )
    .bind(limit)
    .all<PublicServerRow>();

  return rows.results;
}

export function getPublicServerRow(
  env: DirectoryEnv,
  slug: string
): Promise<PublicServerRow | null> {
  return env.DB.prepare(
    publicSelectSql("s.status = 'approved' AND s.slug = ?", PUBLIC_DIRECTORY_ORDER, "LIMIT 1")
  )
    .bind(slug)
    .first<PublicServerRow>();
}

export async function publicStatusCounts(
  env: DirectoryEnv
): Promise<Record<PublicStatusFilter, number>> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS all_total,
      COALESCE(SUM(CASE WHEN ss.online = 1 THEN 1 ELSE 0 END), 0) AS online_total,
      COALESCE(SUM(CASE WHEN COALESCE(ss.online, 0) = 0 THEN 1 ELSE 0 END), 0) AS offline_total
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
  `
  ).first<{ all_total: number; online_total: number; offline_total: number }>();

  return {
    all: row?.all_total ?? 0,
    online: row?.online_total ?? 0,
    offline: row?.offline_total ?? 0
  };
}
