import { DISCORD_ADMIN_MESSAGE_REPOST_AFTER_MS } from "../config";
import type {
  DirectoryEnv,
  DiscordReviewDeletionJob,
  DiscordReviewNotificationJob
} from "../contracts";
import { isRecord } from "../core/http";
import { runD1Statement } from "../core/d1";
import { logInfo } from "../core/runtime";
import {
  cancelResponseBody,
  deleteDiscordWebhookMessage,
  DiscordDeliveryError,
  discordFetch,
  parseDiscordWebhookUrl,
  readBoundedDiscordJson,
  requireDiscordSuccess
} from "./webhook-client";
import { buildDiscordReviewNotificationMessage } from "./messages";
import { processDiscordEmbedJobs } from "./public-listings";
import {
  clearReviewDeletionSuperseded,
  clearReviewNotificationSuperseded,
  deleteDiscordReviewNotificationJob,
  deleteReviewDeletionJob,
  discordMessageShouldBeReposted,
  discordReviewNotificationJobStillCurrent,
  discordReviewStatusJobStatement,
  getReviewNotification,
  getReviewSubmission,
  processLeasedDiscordJobs,
  recordDiscordReviewDeletionFailure,
  recordDiscordReviewNotificationFailure,
  releaseDiscordReviewNotificationLease,
  storeDiscordReviewNotification,
  updateReviewDeletionMessage
} from "./outbox";

export function scheduleDiscordEmbedProcessing(
  env: DirectoryEnv,
  ctx?: ExecutionContext
): void {
  if (ctx) {
    ctx.waitUntil(processDiscordEmbedJobs(env));
  }
}

export function scheduleDiscordReviewNotificationProcessing(
  env: DirectoryEnv,
  ctx?: ExecutionContext
): void {
  if (ctx) {
    ctx.waitUntil(processDiscordReviewNotificationJobs(env));
  }
}

export function scheduleDiscordDeliveryProcessing(
  env: DirectoryEnv,
  ctx?: ExecutionContext
): void {
  if (ctx) {
    ctx.waitUntil(processDiscordDeliveryJobs(env));
  }
}

export async function processDiscordDeliveryJobs(env: DirectoryEnv): Promise<void> {
  await processDiscordEmbedJobs(env);
  await processDiscordReviewNotificationJobs(env);
  await processDiscordReviewDeletionJobs(env);
}

export async function processDiscordReviewNotificationJobs(env: DirectoryEnv): Promise<void> {
  await processLeasedDiscordJobs(env, {
    table: "discord_review_notification_jobs",
    selectedColumns: "server_id, submission_id, notification_type, desired_status, desired_version, attempt_count",
    failureEvent: "discord.review_notification_processing_failed",
    process: processDiscordReviewNotificationJob
  });
}

export async function processDiscordReviewDeletionJobs(env: DirectoryEnv): Promise<void> {
  await processLeasedDiscordJobs(env, {
    table: "discord_review_deletion_jobs",
    selectedColumns: "server_id, message_id, payload_json, replace_message, superseded_message_id, attempt_count",
    failureEvent: "discord.review_deletion_processing_failed",
    process: processDiscordReviewDeletionJob
  });
}

async function processDiscordReviewDeletionJob(
  env: DirectoryEnv,
  job: DiscordReviewDeletionJob,
  leaseToken: string
): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(job.payload_json);

    if (!isRecord(parsed)) {
      throw new DiscordDeliveryError(
        "invalid_payload",
        "Stored Discord deletion payload is invalid.",
        false
      );
    }

    const webhook = parseDiscordWebhookUrl(
      env.DISCORD_SERVER_REVIEW_WEBHOOK_URL,
      "review notification"
    );
    let newlyCreated = false;

    if (job.replace_message === 1) {
      let response: Response;

      try {
        response = await discordFetch(
          `${webhook}?wait=true&with_components=true`,
          "POST",
          parsed,
          true
        );
      } catch (error) {
        throw new DiscordDeliveryError(
          "ambiguous_create",
          "Discord deleted review notification had an ambiguous network result.",
          false,
          error
        );
      }

      await requireDiscordSuccess(response, "repost deleted review notification");
      const body = await readBoundedDiscordJson(response);

      if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) {
        throw new DiscordDeliveryError(
          "invalid_response",
          "Discord returned an invalid deleted review notification response.",
          false
        );
      }

      const previousMessageId = job.message_id;

      await updateReviewDeletionMessage(env, job, leaseToken, body.id);
      job.message_id = body.id;
      job.superseded_message_id = previousMessageId;
      job.replace_message = 0;
      newlyCreated = true;
    }

    if (!newlyCreated) {
      const response = await discordFetch(
        `${webhook}/messages/${encodeURIComponent(job.message_id)}?with_components=true`,
        "PATCH",
        parsed,
        false
      );

      if (response.status !== 404) {
        await requireDiscordSuccess(response, "update deleted review notification");
      }

      await cancelResponseBody(response);
    }

    if (job.superseded_message_id) {
      await deleteDiscordWebhookMessage(
        webhook,
        job.superseded_message_id,
        "delete superseded review notification"
      );
      await clearReviewDeletionSuperseded(env, job, leaseToken);
      job.superseded_message_id = null;
    }

    await deleteReviewDeletionJob(env, job, leaseToken);
    logInfo(newlyCreated ? "discord.review_deletion_reposted" : "discord.review_deletion_updated", {
      serverId: job.server_id
    });
  } catch (error) {
    await recordDiscordReviewDeletionFailure(env, job, leaseToken, error);
  }
}

async function processDiscordReviewNotificationJob(
  env: DirectoryEnv,
  job: DiscordReviewNotificationJob,
  leaseToken: string
): Promise<void> {
  try {
    const submission = await getReviewSubmission(env, job);

    if (!submission) {
      await deleteDiscordReviewNotificationJob(env, job, leaseToken);

      return;
    }

    if (submission.status !== job.desired_status || submission.updated_at !== job.desired_version) {
      await runD1Statement(
        discordReviewStatusJobStatement(
          env,
          job.server_id,
          submission.status,
          submission.updated_at
        )
      );
      await releaseDiscordReviewNotificationLease(env, job.server_id, leaseToken);

      return;
    }

    if (!(await discordReviewNotificationJobStillCurrent(env, job, leaseToken))) {
      await releaseDiscordReviewNotificationLease(env, job.server_id, leaseToken);

      return;
    }

    const webhook = parseDiscordWebhookUrl(
      env.DISCORD_SERVER_REVIEW_WEBHOOK_URL,
      "review notification"
    );
    const notification = await getReviewNotification(env, job.server_id);
    const payload = buildDiscordReviewNotificationMessage(submission, job.notification_type);
    let messageId = notification?.message_id ?? null;
    let supersededMessageId = notification?.superseded_message_id ?? null;
    const repostMessage = Boolean(
      messageId &&
      notification &&
      discordMessageShouldBeReposted(notification.synced_at, DISCORD_ADMIN_MESSAGE_REPOST_AFTER_MS)
    );
    let createdMessage = false;
    let repostedMessage = false;

    if (supersededMessageId) {
      await deleteDiscordWebhookMessage(
        webhook,
        supersededMessageId,
        "delete superseded review notification"
      );
      await clearReviewNotificationSuperseded(
        env,
        job.server_id,
        messageId as string,
        supersededMessageId
      );
      supersededMessageId = null;
    }

    if (messageId && !repostMessage) {
      const response = await discordFetch(
        `${webhook}/messages/${encodeURIComponent(messageId)}?with_components=true`,
        "PATCH",
        payload,
        false
      );

      if (response.status === 404) {
        await cancelResponseBody(response);
        messageId = null;
      } else {
        await requireDiscordSuccess(response, "update review notification");
        await cancelResponseBody(response);
      }
    }

    if (!messageId || repostMessage) {
      const previousMessageId = repostMessage ? messageId : null;
      let response: Response;

      try {
        response = await discordFetch(
          `${webhook}?wait=true&with_components=true`,
          "POST",
          payload,
          true
        );
      } catch (error) {
        throw new DiscordDeliveryError(
          "ambiguous_create",
          "Discord review notification had an ambiguous network result.",
          false,
          error
        );
      }

      await requireDiscordSuccess(response, "create review notification");
      const body = await readBoundedDiscordJson(response);

      if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) {
        throw new DiscordDeliveryError(
          "invalid_response",
          "Discord returned an invalid review notification response.",
          false
        );
      }

      messageId = body.id;
      supersededMessageId = previousMessageId;
      createdMessage = !previousMessageId;
      repostedMessage = Boolean(previousMessageId);
    }

    await storeDiscordReviewNotification(env, submission, job, messageId, supersededMessageId);

    if (supersededMessageId) {
      await deleteDiscordWebhookMessage(
        webhook,
        supersededMessageId,
        "delete superseded review notification"
      );
      await clearReviewNotificationSuperseded(env, job.server_id, messageId, supersededMessageId);
    }

    await deleteDiscordReviewNotificationJob(env, job, leaseToken);
    logInfo(
      createdMessage
        ? "discord.review_notification_created"
        : repostedMessage
          ? "discord.review_notification_reposted"
          : "discord.review_notification_updated",
      {
        serverId: job.server_id,
        submissionId: job.submission_id,
        notificationType: job.notification_type,
        status: job.desired_status
      }
    );
  } catch (error) {
    await recordDiscordReviewNotificationFailure(env, job, leaseToken, error);
    await releaseDiscordReviewNotificationLease(env, job.server_id, leaseToken);
  }
}
