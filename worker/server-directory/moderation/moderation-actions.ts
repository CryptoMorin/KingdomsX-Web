import { isRejectionReasonCode, NO_STORE_JSON_HEADERS } from "../config";
import type {
  AdminServerRow,
  AdminSort,
  DirectoryEnv,
  ServerState
} from "../contracts";
import { discordAvatarUrl } from "../auth/submitter-sessions";
import { runD1Batch } from "../core/d1";
import { clampInt, json, readJsonObject, stringField } from "../core/http";
import { logError, nowIso } from "../core/runtime";
import { handleAdminDiscordAction } from "../discord/public-listings";
import { getDiscordReviewDeletionSnapshot } from "../discord/outbox";
import { scheduleDiscordDeliveryProcessing } from "../discord/delivery";
import {
  fetchServerStatus,
  maybeHideOffline,
  refreshLocalApprovedStatuses
} from "../status/refresh";
import type { StatusSnapshot } from "../status/providers";
import { toPublicServer } from "../public-directory/listings";
import {
  deletionStatements,
  getAdminServer,
  getDeletionTarget,
  getModerationTarget,
  getStatusRefreshTarget,
  listAdminServers,
  manualRefreshStatements,
  moderationTransitionStatements
} from "./moderation-storage";

export async function handleAdmin(
  request: Request,
  url: URL,
  env: DirectoryEnv,
  actor: string,
  ctx?: ExecutionContext
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/admin/servers") {
    await refreshLocalApprovedStatuses(env);

    const status = parseServerState(url.searchParams.get("status") ?? "pending");
    const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10000, 1);
    const limit = clampInt(Number(url.searchParams.get("limit") ?? "8"), 1, 50, 8);
    const sort = parseAdminSort(url.searchParams.get("sort"));
    const offset = (page - 1) * limit;
    const result = await listAdminServers(env, status, sort, limit, offset);
    const total = result.total;

    return json(
      {
        items: result.rows.map(toAdminServer),
        page,
        limit,
        sort,
        total,
        counts: adminCounts(result.counts),
        totalPages: Math.max(1, Math.ceil(total / limit))
      },
      200,
      NO_STORE_JSON_HEADERS
    );
  }

  const deleteMatch = url.pathname.match(/^\/api\/admin\/servers\/([^/]+)$/);
  if (deleteMatch && request.method === "DELETE") {
    return deleteServer(deleteMatch[1], env, actor, ctx);
  }

  const discordMatch = url.pathname.match(/^\/api\/admin\/servers\/([^/]+)\/discord\/sync$/);
  if (discordMatch && request.method === "POST") {
    return handleAdminDiscordAction(discordMatch[1], env, actor, ctx);
  }

  const match = url.pathname.match(
    /^\/api\/admin\/servers\/([^/]+)\/(approve|reject|suspend|refresh-status)$/
  );
  if (!match || request.method !== "POST") {
    return json({ error: "Not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const [, id, action] = match;
  const body = await readJsonObject(request, true);
  const notes = stringField(body, "notes", 1000, false);
  const reasonCode = stringField(body, "reasonCode", 64, false);

  if ((action === "reject" || action === "suspend") && notes.length < 3) {
    return json(
      { error: "A feedback reason is required and will be shown to the submitter." },
      400,
      NO_STORE_JSON_HEADERS
    );
  }

  if (action === "reject" && !isRejectionReasonCode(reasonCode)) {
    return json(
      { error: "Choose a valid rejection reason before continuing." },
      400,
      NO_STORE_JSON_HEADERS
    );
  }

  if (action === "refresh-status") {
    return refreshOneServer(id, env, actor, notes);
  }

  const existing = await getModerationTarget(env, id);

  if (!existing) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const status: ServerState = action === "approve" ? "approved" : action === "reject" ? "rejected" : "suspended";
  const timestamp = nowIso();

  await runD1Batch(
    env,
    moderationTransitionStatements(env, {
      id,
      actor,
      action,
      status,
      notes,
      reasonCode,
      timestamp,
      host: existing.normalized_host,
      port: existing.port
    })
  );
  scheduleDiscordDeliveryProcessing(env, ctx);

  return json({ ok: true, id, status }, 200, NO_STORE_JSON_HEADERS);
}

async function deleteServer(
  id: string,
  env: DirectoryEnv,
  actor: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const existing = await getDeletionTarget(env, id);

  if (!existing) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const timestamp = nowIso();
  const reviewSnapshot = await getDiscordReviewDeletionSnapshot(env, id);
  await runD1Batch(
    env,
    deletionStatements(env, { id, actor, timestamp, server: existing, reviewSnapshot })
  );
  scheduleDiscordDeliveryProcessing(env, ctx);

  return json({ ok: true, id, deleted: true }, 200, NO_STORE_JSON_HEADERS);
}

async function refreshOneServer(
  id: string,
  env: DirectoryEnv,
  actor: string,
  notes: string
): Promise<Response> {
  const row = await getStatusRefreshTarget(env, id);

  if (!row) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  let snapshot: StatusSnapshot;

  try {
    snapshot = await fetchServerStatus(`${row.normalized_host}:${row.port}`);
  } catch (error) {
    logError("status.manual_refresh_failed", error, { id });

    return json(
      { error: "Server status verification is temporarily unavailable." },
      503,
      NO_STORE_JSON_HEADERS
    );
  }

  const timestamp = nowIso();
  await runD1Batch(env, manualRefreshStatements(env, id, actor, notes, snapshot, timestamp));
  await maybeHideOffline(env, id);

  const refreshed = await getAdminServer(env, id);

  return json(
    { ok: true, id, item: refreshed ? toAdminServer(refreshed) : null },
    200,
    NO_STORE_JSON_HEADERS
  );
}

export function toAdminServer(row: AdminServerRow) {
  const discordEmbedState = row.discord_job_last_error_code
    ? "failed"
    : row.discord_job_action === "delete"
      ? "deleting"
      : row.discord_job_action
        ? "pending"
        : row.status === "approved" && row.discord_message_id
          ? "synced"
          : "not_applicable";

  return {
    ...toPublicServer(row),
    id: row.id,
    reviewStatus: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    provider: row.provider,
    failureCount: row.failure_count,
    offlineSince: row.offline_since,
    refreshAttemptedAt: row.refresh_attempted_at,
    refreshError: row.refresh_error,
    submission: {
      contact: row.submission_contact,
      verificationEvidence: row.submission_verification_evidence,
      moderationNotes: row.submission_moderation_notes,
      createdAt: row.submission_created_at
    },
    owner: row.owner_discord_user_id
      ? {
        id: row.owner_discord_user_id,
        username: row.owner_username,
        displayName: row.owner_global_name || row.owner_username,
        avatarUrl: discordAvatarUrl({
          id: row.owner_discord_user_id,
          discord_user_id: row.owner_discord_user_id,
          username: row.owner_username ?? "Discord user",
          global_name: row.owner_global_name,
          avatar_hash: row.owner_avatar_hash
        })
      }
      : null,
    review: {
      action: row.review_event_action,
      createdAt: row.review_event_created_at,
      reasonCode: row.review_event_reason_code
    },
    discordEmbed: {
      state: discordEmbedState,
      syncedAt: row.discord_synced_at,
      attemptCount: row.discord_job_attempt_count ?? 0,
      lastError: row.discord_job_last_error
    }
  };
}

function parseServerState(value: string): ServerState {
  const states: ServerState[] = ["pending", "approved", "rejected", "suspended", "hidden_offline"];

  return states.includes(value as ServerState) ? (value as ServerState) : "pending";
}

function parseAdminSort(value: string | null): AdminSort {
  const sorts: AdminSort[] = ["newest", "oldest", "name", "online", "updated"];

  return sorts.includes(value as AdminSort) ? (value as AdminSort) : "newest";
}

function adminCounts(
  rows: Array<{ status: ServerState; total: number }>
): Record<ServerState, number> {
  const counts: Record<ServerState, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    suspended: 0,
    hidden_offline: 0
  };

  rows.forEach((row) => {
    counts[row.status] = row.total;
  });

  return counts;
}
