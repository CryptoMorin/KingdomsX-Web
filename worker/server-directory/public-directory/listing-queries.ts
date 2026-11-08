import {
  HOMEPAGE_DIRECTORY_ORDER,
  PUBLIC_DIRECTORY_MAX_PAGE,
  PUBLIC_DIRECTORY_ORDER,
  PUBLIC_DIRECTORY_PAGE_SIZE
} from "../config";
import type { DirectoryEnv, PublicServerRow, PublicSort, PublicStatusFilter } from "../contracts";
import { SERVER_STATUS_SELECT_COLUMNS } from "../core/server-status-columns";

function publicSelectSql(whereSql: string, orderBySql: string, tail: string, extraColumns = ""): string {
  return `
    SELECT${SERVER_STATUS_SELECT_COLUMNS},
      public_id.id AS public_id,
      owner.username AS owner_username,
      owner.global_name AS owner_global_name${extraColumns}
    FROM servers s
    JOIN server_public_ids public_id ON public_id.server_id = s.id
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

const REGION_FILTER_SQL = "EXISTS (SELECT 1 FROM json_each(s.regions_json) server_region WHERE server_region.value = ?)";

export async function listPublicServerRows(
  env: DirectoryEnv,
  status: PublicStatusFilter,
  sort: PublicSort,
  limit: number,
  offset: number,
  region = ""
): Promise<PublicServerRow[]> {
  const rows = await env.DB.prepare(
    publicSelectSql(`${publicWhere(status)}${region ? ` AND ${REGION_FILTER_SQL}` : ""}`, publicOrderBy(sort), "LIMIT ? OFFSET ?")
  )
    .bind(...(region ? [region] : []), limit, offset)
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

type StatusTotals = { all_total: number; online_total: number; offline_total: number };

export async function getPublicPermalinkPage(env: DirectoryEnv, publicId: number) {
  const pageSize = PUBLIC_DIRECTORY_PAGE_SIZE;
  const pageRows = env.DB.prepare(`
    WITH ranked AS (
      SELECT s.id,
        (ROW_NUMBER() OVER (ORDER BY ${PUBLIC_DIRECTORY_ORDER}) - 1) / CAST(? AS INTEGER) + 1 AS page
      FROM servers s
      WHERE ${publicWhere("all")}
      ORDER BY ${PUBLIC_DIRECTORY_ORDER}
      LIMIT ?
    ), target AS (
      SELECT page FROM ranked WHERE id = (SELECT server_id FROM server_public_ids WHERE id = ?)
    )
    ${publicSelectSql(
      "s.id IN (SELECT id FROM ranked WHERE page = (SELECT page FROM target))",
      PUBLIC_DIRECTORY_ORDER,
      "",
      ", (SELECT page FROM target) AS page"
    )}
  `).bind(pageSize, pageSize * PUBLIC_DIRECTORY_MAX_PAGE, publicId);

  // Read the target's page and the pagination counts in the same snapshot
  const [cards, totals] = await env.DB.batch<PublicServerRow & { page: number } | StatusTotals>([
    pageRows,
    publicStatusCountsStatement(env, "")
  ]);
  const rows = cards.results as (PublicServerRow & { page: number })[];

  return rows.length
    ? { page: rows[0].page, rows, counts: statusCounts(totals.results[0] as StatusTotals | undefined) }
    : null;
}

export async function publicStatusCounts(
  env: DirectoryEnv,
  region = ""
): Promise<Record<PublicStatusFilter, number>> {
  const row = await publicStatusCountsStatement(env, region).first<StatusTotals>();

  return statusCounts(row);
}

function publicStatusCountsStatement(env: DirectoryEnv, region: string): D1PreparedStatement {
  return env.DB.prepare(
    `
    SELECT
      COUNT(*) AS all_total,
      COALESCE(SUM(CASE WHEN ss.online = 1 THEN 1 ELSE 0 END), 0) AS online_total,
      COALESCE(SUM(CASE WHEN COALESCE(ss.online, 0) = 0 THEN 1 ELSE 0 END), 0) AS offline_total
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'${region ? ` AND ${REGION_FILTER_SQL}` : ""}
  `
  ).bind(...(region ? [region] : []));
}

function statusCounts(row: StatusTotals | null | undefined): Record<PublicStatusFilter, number> {
  return {
    all: row?.all_total ?? 0,
    online: row?.online_total ?? 0,
    offline: row?.offline_total ?? 0
  };
}
