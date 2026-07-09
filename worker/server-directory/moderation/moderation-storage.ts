import type {
  AdminServerRow,
  AdminSort,
  DirectoryEnv,
  DiscordReviewDeletionSnapshot,
  ServerState
} from "../contracts";
import { SERVER_STATUS_SELECT_COLUMNS } from "../core/server-status-columns";
import type { StatusSnapshot } from "../status/providers";
import { statusSnapshotStatements } from "../status/status-storage";
import {
  discordEmbedJobStatement,
  discordReviewDeletionJobStatement,
  discordReviewStatusJobStatement
} from "../discord/outbox";

export function adminSelectSql(whereSql: string, orderBySql: string, tail: string): string {
  return `
    SELECT${SERVER_STATUS_SELECT_COLUMNS},
      sub.contact AS submission_contact,
      sub.verification_evidence AS submission_verification_evidence,
      sub.moderation_notes AS submission_moderation_notes,
      sub.created_at AS submission_created_at,
      owner.discord_user_id AS owner_discord_user_id,
      owner.username AS owner_username,
      owner.global_name AS owner_global_name,
      owner.avatar_hash AS owner_avatar_hash,
      event.action AS review_event_action,
      event.created_at AS review_event_created_at,
      event.reason_code AS review_event_reason_code,
      embed.message_id AS discord_message_id,
      embed.synced_version AS discord_synced_version,
      embed.synced_at AS discord_synced_at,
      discord_job.desired_action AS discord_job_action,
      discord_job.attempt_count AS discord_job_attempt_count,
      discord_job.last_error_code AS discord_job_last_error_code,
      discord_job.last_error AS discord_job_last_error
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id
    LEFT JOIN submissions sub ON sub.id = (
      SELECT latest.id FROM submissions latest WHERE latest.server_id = s.id ORDER BY latest.created_at DESC LIMIT 1
    )
    LEFT JOIN moderation_events event ON event.id = (
      SELECT latest_event.id
      FROM moderation_events latest_event
      WHERE latest_event.server_id = s.id
        AND (
          (s.status = 'pending' AND latest_event.action = 'submitted')
          OR (s.status = 'approved' AND latest_event.action IN ('approve', 'approved'))
          OR (s.status = 'rejected' AND latest_event.action IN ('reject', 'rejected'))
          OR (s.status = 'suspended' AND latest_event.action IN ('suspend', 'suspended'))
          OR (s.status = 'hidden_offline' AND latest_event.action IN ('hidden-offline', 'hidden_offline'))
        )
      ORDER BY latest_event.created_at DESC
      LIMIT 1
    )
    LEFT JOIN discord_embeds embed ON embed.server_id = s.id
    LEFT JOIN discord_embed_jobs discord_job ON discord_job.server_id = s.id
    WHERE ${whereSql}
    ORDER BY ${orderBySql}
    ${tail}
`;
}

export function suspendedAddressStatement(
  env: DirectoryEnv,
  host: string,
  port: number,
  serverId: string | null,
  reason: string | null,
  suspendedAt: string,
  updatedAt: string
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO suspended_server_addresses (normalized_host, port, server_id, reason, suspended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_host, port) DO UPDATE SET
      server_id = excluded.server_id,
      reason = excluded.reason,
      suspended_at = excluded.suspended_at,
      updated_at = excluded.updated_at
  `
  ).bind(host, port, serverId, reason || "Suspended by staff.", suspendedAt, updatedAt, updatedAt);
}

function adminOrderBy(sort: AdminSort): string {
  switch (sort) {
    case "oldest":
      return "COALESCE(sub.created_at, s.created_at) ASC, s.created_at ASC, s.id ASC";
    case "name":
      return "s.name COLLATE NOCASE ASC, s.id ASC";
    case "online":
      return "COALESCE(ss.online, 0) DESC, s.name COLLATE NOCASE ASC, s.id ASC";
    case "updated":
      return "COALESCE(ss.checked_at, ss.refresh_attempted_at, s.updated_at) DESC, s.id ASC";
    default:
      return "COALESCE(sub.created_at, s.created_at) DESC, s.created_at DESC, s.id ASC";
  }
}

export async function listAdminServers(
  env: DirectoryEnv,
  status: ServerState,
  sort: AdminSort,
  limit: number,
  offset: number
) {
  const rows = await env.DB.prepare(
    adminSelectSql("s.status = ?", adminOrderBy(sort), "LIMIT ? OFFSET ?")
  )
    .bind(status, limit, offset)
    .all<AdminServerRow>();
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM servers s WHERE s.status = ?")
    .bind(status)
    .first<{ total: number }>();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS total FROM servers GROUP BY status").all<{ status: ServerState; total: number }>();

  return { rows: rows.results, total: count?.total ?? 0, counts: counts.results };
}

export function getModerationTarget(env: DirectoryEnv, id: string) {
  return env.DB.prepare("SELECT status, normalized_host, port FROM servers WHERE id = ?")
    .bind(id)
    .first<{ status: ServerState; normalized_host: string; port: number }>();
}

export function moderationTransitionStatements(
  env: DirectoryEnv,
  input: {
    id: string;
    actor: string;
    action: string;
    status: ServerState;
    notes: string;
    reasonCode: string;
    timestamp: string;
    host: string;
    port: number;
  }
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `
      UPDATE servers
      SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END,
          suspended_at = CASE WHEN ? = 'suspended' THEN ? ELSE NULL END, updated_at = ?
      WHERE id = ?
    `
    ).bind(
      input.status,
      input.status,
      input.timestamp,
      input.status,
      input.timestamp,
      input.timestamp,
      input.id
    ),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      input.id,
      input.actor,
      input.action,
      input.notes,
      input.action === "reject" ? input.reasonCode : null,
      input.timestamp
    ),
    env.DB.prepare(
      `
      UPDATE submissions SET moderation_notes = CASE WHEN ? <> '' THEN ? ELSE moderation_notes END
      WHERE id = (SELECT id FROM submissions WHERE server_id = ? ORDER BY created_at DESC LIMIT 1)
    `
    ).bind(input.notes, input.notes, input.id)
  ];

  if (input.status === "suspended") {
    statements.push(
      suspendedAddressStatement(
        env,
        input.host,
        input.port,
        input.id,
        input.notes,
        input.timestamp,
        input.timestamp
      )
    );
  }

  if (input.status === "approved") {
    statements.push(
      env.DB.prepare("DELETE FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?").bind(input.host, input.port)
    );
  }

  statements.push(
    discordEmbedJobStatement(
      env,
      input.id,
      input.status === "approved" ? "upsert" : "delete",
      input.timestamp
    )
  );
  statements.push(discordReviewStatusJobStatement(env, input.id, input.status, input.timestamp));

  return statements;
}

export function getDeletionTarget(env: DirectoryEnv, id: string) {
  return env.DB.prepare("SELECT id, name, status, normalized_host, port, suspended_at FROM servers WHERE id = ?")
    .bind(id)
    .first<{
      id: string;
      name: string;
      status: ServerState;
      normalized_host: string;
      port: number;
      suspended_at: string | null;
    }>();
}

export function deletionStatements(
  env: DirectoryEnv,
  input: {
    id: string;
    actor: string;
    timestamp: string;
    server: {
      id: string;
      name: string;
      status: ServerState;
      normalized_host: string;
      port: number;
      suspended_at: string | null;
    };
    reviewSnapshot: DiscordReviewDeletionSnapshot | null;
  }
): D1PreparedStatement[] {
  const { server } = input;

  return [
    // Deleting a suspended listing must not remove the address-level suspension
    ...(server.status === "suspended"
      ? [
        suspendedAddressStatement(
          env,
          server.normalized_host,
          server.port,
          server.id,
          "This listing is suspended because staff found content or behavior that violates the server listing rules. Contact staff after correcting the issue.",
          server.suspended_at ?? input.timestamp,
          input.timestamp
        )
      ]
      : []),
    discordEmbedJobStatement(env, input.id, "delete", input.timestamp),
    ...(input.reviewSnapshot
      ? [discordReviewDeletionJobStatement(env, input.reviewSnapshot, input.timestamp)]
      : []),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, 'delete', ?, ?)").bind(
      crypto.randomUUID(),
      input.id,
      input.actor,
      `Deleted server listing: ${server.name}`,
      input.timestamp
    ),
    env.DB.prepare("DELETE FROM submissions WHERE server_id = ?").bind(input.id),
    env.DB.prepare("DELETE FROM server_status WHERE server_id = ?").bind(input.id),
    env.DB.prepare("DELETE FROM moderation_events WHERE server_id = ?").bind(input.id),
    env.DB.prepare("DELETE FROM servers WHERE id = ?").bind(input.id)
  ];
}

export function getStatusRefreshTarget(env: DirectoryEnv, id: string) {
  return env.DB.prepare("SELECT normalized_host, port FROM servers WHERE id = ?")
    .bind(id)
    .first<{ normalized_host: string; port: number }>();
}

export function manualRefreshStatements(
  env: DirectoryEnv,
  id: string,
  actor: string,
  notes: string,
  snapshot: StatusSnapshot,
  timestamp: string
): D1PreparedStatement[] {
  return [
    ...statusSnapshotStatements(env, id, snapshot, timestamp),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, 'refresh-status', ?, ?)").bind(crypto.randomUUID(), id, actor, notes, timestamp),
    env.DB.prepare(
      `
      UPDATE submissions SET moderation_notes = CASE WHEN ? <> '' THEN ? ELSE moderation_notes END
      WHERE id = (SELECT id FROM submissions WHERE server_id = ? ORDER BY created_at DESC LIMIT 1)
    `
    ).bind(notes, notes, id)
  ];
}

export function getAdminServer(env: DirectoryEnv, id: string): Promise<AdminServerRow | null> {
  return env.DB.prepare(adminSelectSql("s.id = ?", "s.id ASC", "LIMIT 1"))
    .bind(id)
    .first<AdminServerRow>();
}
