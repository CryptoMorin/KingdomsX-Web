import {
  DISCORD_ADMIN_MESSAGE_REPOST_AFTER_MS,
  DISCORD_JOB_BATCH_LIMIT,
  DISCORD_JOB_MAX_ATTEMPTS,
  DISCORD_LEASE_MS
} from "../config";
import type {
  DirectoryEnv,
  DiscordEmbedJob,
  DiscordEmbedRecord,
  DiscordServerRow,
  DiscordReviewDeletionJob,
  DiscordReviewDeletionSnapshot,
  DiscordReviewNotification,
  DiscordReviewNotificationJob,
  DiscordReviewSubmissionRow,
  ServerState
} from "../contracts";
import { runD1Statement } from "../core/d1";
import { logError, logWarn, nowIso } from "../core/runtime";
import { discordFailureSchedule } from "./webhook-client";
import { buildDiscordReviewNotificationMessage } from "./messages";

// Public listing embed jobs
export function discordEmbedJobStatement(
  env: DirectoryEnv,
  serverId: string,
  action: "upsert" | "delete",
  version: string
): D1PreparedStatement {
  // One row per server means newer changes replace old jobs instead of piling up
  return env.DB.prepare(
    `
    INSERT INTO discord_embed_jobs (
      server_id, desired_action, desired_version, attempt_count, next_attempt_at,
      last_attempt_at, last_error_code, last_error, lease_token, lease_expires_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      desired_action = excluded.desired_action,
      desired_version = excluded.desired_version,
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = NULL,
      last_error_code = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at
  `
  ).bind(serverId, action, version, version, version, version);
}

// Review notification jobs
export function discordReviewStatusJobStatement(
  env: DirectoryEnv,
  serverId: string,
  desiredStatus: ServerState,
  desiredVersion: string
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO discord_review_notification_jobs (
      server_id, submission_id, notification_type, desired_status, desired_version,
      attempt_count, next_attempt_at, last_attempt_at, last_error_code, last_error,
      lease_token, lease_expires_at, created_at, updated_at
    )
    SELECT
      ?, latest.id,
      COALESCE(
        (SELECT notification_type FROM discord_review_notifications WHERE server_id = ?),
        CASE WHEN (SELECT COUNT(*) FROM submissions WHERE server_id = ?) > 1 THEN 'resubmitted' ELSE 'submitted' END
      ),
      ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?
    FROM submissions latest
    WHERE latest.server_id = ?
    ORDER BY latest.created_at DESC, latest.id DESC
    LIMIT 1
    ON CONFLICT(server_id) DO UPDATE SET
      submission_id = excluded.submission_id,
      desired_status = excluded.desired_status,
      desired_version = excluded.desired_version,
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = NULL,
      last_error_code = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at
  `
  ).bind(
    serverId,
    serverId,
    serverId,
    desiredStatus,
    desiredVersion,
    desiredVersion,
    desiredVersion,
    desiredVersion,
    serverId
  );
}

export function discordReviewNotificationJobStatement(
  env: DirectoryEnv,
  serverId: string,
  submissionId: string,
  notificationType: "submitted" | "resubmitted",
  timestamp: string,
  desiredStatus: ServerState = "pending"
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO discord_review_notification_jobs (
      server_id, submission_id, notification_type, desired_status, desired_version, attempt_count, next_attempt_at,
      last_attempt_at, last_error_code, last_error, lease_token, lease_expires_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      submission_id = excluded.submission_id,
      notification_type = excluded.notification_type,
      desired_status = excluded.desired_status,
      desired_version = excluded.desired_version,
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = NULL,
      last_error_code = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at
  `
  ).bind(
    serverId,
    submissionId,
    notificationType,
    desiredStatus,
    timestamp,
    timestamp,
    timestamp,
    timestamp
  );
}

// Review deletion jobs
export function discordReviewDeletionJobStatement(
  env: DirectoryEnv,
  snapshot: DiscordReviewDeletionSnapshot,
  timestamp: string
): D1PreparedStatement {
  const payload = buildDiscordReviewNotificationMessage(
    { ...snapshot, updated_at: timestamp },
    snapshot.review_notification_type,
    "deleted"
  );

  return env.DB.prepare(
    `
    INSERT INTO discord_review_deletion_jobs (
      server_id, message_id, payload_json, replace_message, superseded_message_id,
      attempt_count, next_attempt_at,
      last_attempt_at, last_error_code, last_error, lease_token, lease_expires_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, NULL, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      message_id = excluded.message_id,
      payload_json = excluded.payload_json,
      replace_message = excluded.replace_message,
      superseded_message_id = NULL,
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = NULL,
      last_error_code = NULL,
      last_error = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = excluded.updated_at
  `
  ).bind(
    snapshot.id,
    snapshot.review_message_id,
    JSON.stringify(payload),
    discordMessageShouldBeReposted(snapshot.review_synced_at, DISCORD_ADMIN_MESSAGE_REPOST_AFTER_MS)
      ? 1
      : 0,
    timestamp,
    timestamp,
    timestamp
  );
}

// Shared leasing
type DiscordJobTable = "discord_embed_jobs" | "discord_review_notification_jobs" | "discord_review_deletion_jobs";

type DiscordLeasedJobConfig<TJob extends { server_id: string }> = {
  table: DiscordJobTable;
  selectedColumns: string;
  failureEvent: string;
  process: (env: DirectoryEnv, job: TJob, leaseToken: string) => Promise<void>;
};

export async function processLeasedDiscordJobs<TJob extends { server_id: string }>(
  env: DirectoryEnv,
  config: DiscordLeasedJobConfig<TJob>
): Promise<void> {
  const now = nowIso();
  const candidates = await env.DB.prepare(
    `
    SELECT server_id
    FROM ${config.table}
    WHERE next_attempt_at <= ?
      AND attempt_count < ?
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    ORDER BY next_attempt_at, created_at
    LIMIT ?
  `
  )
    .bind(now, DISCORD_JOB_MAX_ATTEMPTS, now, DISCORD_JOB_BATCH_LIMIT)
    .all<{ server_id: string }>();

  await Promise.all(
    candidates.results.map(async ({ server_id: serverId }) => {
      try {
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(Date.now() + DISCORD_LEASE_MS).toISOString();

        await runD1Statement(
          env.DB.prepare(
            `
        UPDATE ${config.table}
        SET lease_token = ?, lease_expires_at = ?
        WHERE server_id = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      `
          ).bind(leaseToken, leaseExpiresAt, serverId, now)
        );

        // Read the job back with our token because the UPDATE alone does not prove we won the lease
        const job = await env.DB.prepare(
          `
        SELECT ${config.selectedColumns}
        FROM ${config.table} WHERE server_id = ? AND lease_token = ?
      `
        )
          .bind(serverId, leaseToken)
          .first<TJob>();

        if (job) {
          await config.process(env, job, leaseToken);
        }
      } catch (error) {
        logError(config.failureEvent, error, { serverId });
      }
    })
  );
}

export function discordMessageShouldBeReposted(lastSyncedAt: string, thresholdMs: number): boolean {
  const timestamp = Date.parse(lastSyncedAt);

  return Number.isFinite(timestamp) && Date.now() - timestamp >= thresholdMs;
}

// Retry state belongs to the job row
export async function recordDiscordFailure(
  env: DirectoryEnv,
  job: DiscordEmbedJob,
  leaseToken: string,
  error: unknown
): Promise<void> {
  const { failure, attempts, permanent, nextAttemptAt } = discordFailureSchedule(
    error,
    job.attempt_count,
    "Unexpected Discord embed failure."
  );

  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_embed_jobs
    SET attempt_count = ?, next_attempt_at = ?, last_attempt_at = ?,
        last_error_code = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL
    WHERE server_id = ? AND desired_version = ? AND lease_token = ?
  `
    ).bind(
      attempts,
      nextAttemptAt,
      nowIso(),
      failure.code,
      failure.message.slice(0, 500),
      job.server_id,
      job.desired_version,
      leaseToken
    )
  );
  logWarn(permanent ? "discord.embed_failed" : "discord.embed_retry_scheduled", failure, {
    serverId: job.server_id,
    code: failure.code,
    attempts
  });
}

export async function recordDiscordReviewNotificationFailure(
  env: DirectoryEnv,
  job: DiscordReviewNotificationJob,
  leaseToken: string,
  error: unknown
): Promise<void> {
  const { failure, attempts, permanent, nextAttemptAt } = discordFailureSchedule(
    error,
    job.attempt_count,
    "Unexpected Discord review notification failure."
  );

  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_notification_jobs
    SET attempt_count = ?, next_attempt_at = ?, last_attempt_at = ?,
        last_error_code = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL
    WHERE server_id = ? AND submission_id = ? AND notification_type = ?
      AND desired_status = ? AND desired_version = ? AND lease_token = ?
  `
    ).bind(
      attempts,
      nextAttemptAt,
      nowIso(),
      failure.code,
      failure.message.slice(0, 500),
      job.server_id,
      job.submission_id,
      job.notification_type,
      job.desired_status,
      job.desired_version,
      leaseToken
    )
  );
  logWarn(
    permanent
      ? "discord.review_notification_failed"
      : "discord.review_notification_retry_scheduled",
    failure,
    {
      serverId: job.server_id,
      submissionId: job.submission_id,
      code: failure.code,
      attempts,
      status: job.desired_status
    }
  );
}

export async function recordDiscordReviewDeletionFailure(
  env: DirectoryEnv,
  job: DiscordReviewDeletionJob,
  leaseToken: string,
  error: unknown
): Promise<void> {
  const { failure, attempts, permanent, nextAttemptAt } = discordFailureSchedule(
    error,
    job.attempt_count,
    "Unexpected Discord review deletion failure."
  );

  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_deletion_jobs
    SET attempt_count = ?, next_attempt_at = ?, last_attempt_at = ?,
        last_error_code = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL
    WHERE server_id = ? AND message_id = ? AND lease_token = ?
  `
    ).bind(
      attempts,
      nextAttemptAt,
      nowIso(),
      failure.code,
      failure.message.slice(0, 500),
      job.server_id,
      job.message_id,
      leaseToken
    )
  );
  logWarn(
    permanent ? "discord.review_deletion_failed" : "discord.review_deletion_retry_scheduled",
    failure,
    {
      serverId: job.server_id,
      code: failure.code,
      attempts
    }
  );
}

// Save the source rows before the delete batch removes them
export async function getDiscordReviewDeletionSnapshot(
  env: DirectoryEnv,
  serverId: string
): Promise<DiscordReviewDeletionSnapshot | null> {
  // Capture everything the outbox needs because its source rows are deleted in the same batch
  return env.DB.prepare(
    `
    SELECT
      s.*,
      submission.id AS submission_id,
      submission.created_at AS submission_created_at,
      submission.verification_evidence AS submission_verification_evidence,
      submission.moderation_notes AS submission_moderation_notes,
      owner.discord_user_id AS owner_discord_user_id,
      public_embed.message_id AS public_discord_message_id,
      public_embed.guild_id AS public_discord_guild_id,
      public_embed.channel_id AS public_discord_channel_id,
      review.message_id AS review_message_id,
      review.notification_type AS review_notification_type,
      review.synced_at AS review_synced_at
    FROM servers s
    JOIN discord_review_notifications review ON review.server_id = s.id
    JOIN submissions submission ON submission.id = review.submission_id
    LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id
    LEFT JOIN discord_embeds public_embed ON public_embed.server_id = s.id
    WHERE s.id = ?
  `
  )
    .bind(serverId)
    .first<DiscordReviewDeletionSnapshot>();
}

// Review notification state
export async function discordReviewNotificationJobStillCurrent(
  env: DirectoryEnv,
  job: DiscordReviewNotificationJob,
  leaseToken: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT server_id
    FROM discord_review_notification_jobs
    WHERE server_id = ? AND submission_id = ? AND notification_type = ?
      AND desired_status = ? AND desired_version = ? AND lease_token = ?
  `
  )
    .bind(
      job.server_id,
      job.submission_id,
      job.notification_type,
      job.desired_status,
      job.desired_version,
      leaseToken
    )
    .first<{ server_id: string }>();

  return Boolean(row);
}

export async function storeDiscordReviewNotification(
  env: DirectoryEnv,
  submission: DiscordReviewSubmissionRow,
  job: DiscordReviewNotificationJob,
  messageId: string,
  supersededMessageId: string | null
): Promise<void> {
  const timestamp = nowIso();

  await runD1Statement(
    env.DB.prepare(
      `
    INSERT INTO discord_review_notifications (
      server_id, submission_id, message_id, superseded_message_id, notification_type, synced_status,
      synced_version, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      submission_id = excluded.submission_id,
      message_id = excluded.message_id,
      superseded_message_id = excluded.superseded_message_id,
      notification_type = excluded.notification_type,
      synced_status = excluded.synced_status,
      synced_version = excluded.synced_version,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `
    ).bind(
      job.server_id,
      job.submission_id,
      messageId,
      supersededMessageId,
      job.notification_type,
      submission.status,
      submission.updated_at,
      timestamp,
      timestamp,
      timestamp
    )
  );
}

export async function deleteDiscordReviewNotificationJob(
  env: DirectoryEnv,
  job: DiscordReviewNotificationJob,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    DELETE FROM discord_review_notification_jobs
    WHERE server_id = ? AND submission_id = ? AND notification_type = ?
      AND desired_status = ? AND desired_version = ? AND lease_token = ?
  `
    ).bind(
      job.server_id,
      job.submission_id,
      job.notification_type,
      job.desired_status,
      job.desired_version,
      leaseToken
    )
  );
}

export async function releaseDiscordReviewNotificationLease(
  env: DirectoryEnv,
  serverId: string,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_notification_jobs
    SET lease_token = NULL, lease_expires_at = NULL
    WHERE server_id = ? AND lease_token = ?
  `
    ).bind(serverId, leaseToken)
  );
}

// Public listing embed state
export async function discordEmbedJobStillCurrent(
  env: DirectoryEnv,
  job: DiscordEmbedJob,
  leaseToken: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT server_id
    FROM discord_embed_jobs
    WHERE server_id = ? AND desired_action = ? AND desired_version = ? AND lease_token = ?
  `
  )
    .bind(job.server_id, job.desired_action, job.desired_version, leaseToken)
    .first<{ server_id: string }>();

  return Boolean(row);
}

export async function releaseDiscordEmbedLease(
  env: DirectoryEnv,
  serverId: string,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_embed_jobs
    SET lease_token = NULL, lease_expires_at = NULL
    WHERE server_id = ? AND lease_token = ?
  `
    ).bind(serverId, leaseToken)
  );
}

export async function storeDiscordEmbed(
  env: DirectoryEnv,
  serverId: string,
  messageId: string,
  guildId: string | null,
  channelId: string | null,
  supersededMessageId: string | null,
  syncedVersion: string,
  timestamp: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    INSERT INTO discord_embeds (
      server_id, message_id, guild_id, channel_id, superseded_message_id,
      synced_version, synced_at, updated_at, last_verified_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      message_id = excluded.message_id,
      guild_id = COALESCE(excluded.guild_id, discord_embeds.guild_id),
      channel_id = COALESCE(excluded.channel_id, discord_embeds.channel_id),
      superseded_message_id = excluded.superseded_message_id,
      synced_version = excluded.synced_version,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at,
      last_verified_at = excluded.last_verified_at
  `
    ).bind(
      serverId,
      messageId,
      guildId,
      channelId,
      supersededMessageId,
      syncedVersion,
      timestamp,
      timestamp,
      timestamp
    )
  );
  await runD1Statement(discordReviewStatusJobStatement(env, serverId, "approved", syncedVersion));
}

// Review deletion state
export async function updateReviewDeletionMessage(
  env: DirectoryEnv,
  job: DiscordReviewDeletionJob,
  leaseToken: string,
  messageId: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_deletion_jobs
    SET message_id = ?, superseded_message_id = ?, replace_message = 0, updated_at = ?
    WHERE server_id = ? AND message_id = ? AND lease_token = ?
  `
    ).bind(messageId, job.message_id, nowIso(), job.server_id, job.message_id, leaseToken)
  );
}

export async function clearReviewDeletionSuperseded(
  env: DirectoryEnv,
  job: DiscordReviewDeletionJob,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_deletion_jobs SET superseded_message_id = NULL, updated_at = ?
    WHERE server_id = ? AND message_id = ? AND superseded_message_id = ? AND lease_token = ?
  `
    ).bind(nowIso(), job.server_id, job.message_id, job.superseded_message_id, leaseToken)
  );
}

export async function deleteReviewDeletionJob(
  env: DirectoryEnv,
  job: DiscordReviewDeletionJob,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
      DELETE FROM discord_review_deletion_jobs
      WHERE server_id = ? AND message_id = ? AND lease_token = ?
    `
    ).bind(job.server_id, job.message_id, leaseToken)
  );
}

// Review notification lookups
export function getReviewSubmission(
  env: DirectoryEnv,
  job: DiscordReviewNotificationJob
): Promise<DiscordReviewSubmissionRow | null> {
  return env.DB.prepare(
    `
    SELECT s.*, submission.id AS submission_id, submission.created_at AS submission_created_at,
      submission.verification_evidence AS submission_verification_evidence,
      submission.moderation_notes AS submission_moderation_notes,
      owner.discord_user_id AS owner_discord_user_id,
      public_embed.message_id AS public_discord_message_id,
      public_embed.guild_id AS public_discord_guild_id,
      public_embed.channel_id AS public_discord_channel_id
    FROM servers s
    JOIN submissions submission ON submission.id = ? AND submission.server_id = s.id
    LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id
    LEFT JOIN discord_embeds public_embed ON public_embed.server_id = s.id
    WHERE s.id = ?
  `
  )
    .bind(job.submission_id, job.server_id)
    .first<DiscordReviewSubmissionRow>();
}

export function getReviewNotification(
  env: DirectoryEnv,
  serverId: string
): Promise<DiscordReviewNotification | null> {
  return env.DB.prepare("SELECT message_id, superseded_message_id, synced_at FROM discord_review_notifications WHERE server_id = ?")
    .bind(serverId)
    .first<DiscordReviewNotification>();
}

export async function clearReviewNotificationSuperseded(
  env: DirectoryEnv,
  serverId: string,
  messageId: string,
  supersededMessageId: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_review_notifications SET superseded_message_id = NULL, updated_at = ?
    WHERE server_id = ? AND message_id = ? AND superseded_message_id = ?
  `
    ).bind(nowIso(), serverId, messageId, supersededMessageId)
  );
}

// Public listing embed lookups
export function getDiscordServer(
  env: DirectoryEnv,
  serverId: string
): Promise<DiscordServerRow | null> {
  return env.DB.prepare(
    `
    SELECT s.*, owner.discord_user_id AS owner_discord_user_id
    FROM servers s LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id WHERE s.id = ?
  `
  )
    .bind(serverId)
    .first<DiscordServerRow>();
}

export async function deleteEmbedJob(
  env: DirectoryEnv,
  job: DiscordEmbedJob,
  leaseToken: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
      DELETE FROM discord_embed_jobs
      WHERE server_id = ? AND desired_version = ? AND lease_token = ?
    `
    ).bind(job.server_id, job.desired_version, leaseToken)
  );
}

export function getEmbedRecord(
  env: DirectoryEnv,
  serverId: string
): Promise<DiscordEmbedRecord | null> {
  return env.DB.prepare("SELECT message_id, guild_id, channel_id, superseded_message_id, synced_at FROM discord_embeds WHERE server_id = ?")
    .bind(serverId)
    .first<DiscordEmbedRecord>();
}

export async function clearSupersededDiscordEmbed(
  env: DirectoryEnv,
  serverId: string,
  messageId: string,
  supersededMessageId: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
    UPDATE discord_embeds SET superseded_message_id = NULL, updated_at = ?
    WHERE server_id = ? AND message_id = ? AND superseded_message_id = ?
  `
    ).bind(nowIso(), serverId, messageId, supersededMessageId)
  );
}

export function getDiscordEmbedForDeletion(env: DirectoryEnv, serverId: string) {
  return env.DB.prepare("SELECT message_id, superseded_message_id FROM discord_embeds WHERE server_id = ?")
    .bind(serverId)
    .first<{ message_id: string; superseded_message_id: string | null }>();
}

export async function deleteDiscordEmbedRecord(env: DirectoryEnv, serverId: string): Promise<void> {
  await runD1Statement(
    env.DB.prepare(
      `
      DELETE FROM discord_embeds
      WHERE server_id = ?
    `
    ).bind(serverId)
  );
}

// Admin initiated sync
export function getAdminSyncServer(env: DirectoryEnv, serverId: string) {
  return env.DB.prepare("SELECT status, updated_at FROM servers WHERE id = ?")
    .bind(serverId)
    .first<{
      status: "approved" | "pending" | "rejected" | "suspended" | "hidden_offline";
      updated_at: string;
    }>();
}

export function adminSyncStatements(
  env: DirectoryEnv,
  serverId: string,
  actor: string,
  desiredAction: "upsert" | "delete",
  version: string,
  timestamp: string
) {
  return [
    discordEmbedJobStatement(env, serverId, desiredAction, version),
    env.DB.prepare(
      "INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(),
      serverId,
      actor,
      "discord-embed-sync",
      desiredAction === "upsert"
        ? "Staff requested Discord embed update."
        : "Staff requested Discord embed removal.",
      timestamp
    )
  ];
}
