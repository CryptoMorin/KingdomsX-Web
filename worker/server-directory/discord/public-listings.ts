import { DISCORD_PUBLIC_MESSAGE_REPOST_AFTER_MS, NO_STORE_JSON_HEADERS } from "../config";
import type { DirectoryEnv, DiscordEmbedJob, DiscordServerRow } from "../contracts";
import { runD1Batch, runD1Statement } from "../core/d1";
import { json } from "../core/http";
import { logInfo, nowIso } from "../core/runtime";
import {
  cancelResponseBody,
  deleteDiscordWebhookMessage,
  DiscordDeliveryError,
  discordFetch,
  parseDiscordWebhookUrl,
  readBoundedDiscordJson,
  requireDiscordSuccess
} from "./webhook-client";
import { buildDiscordServerMessage } from "./messages";
import {
  adminSyncStatements,
  clearSupersededDiscordEmbed,
  deleteDiscordEmbedRecord,
  deleteEmbedJob,
  discordEmbedJobStatement,
  discordEmbedJobStillCurrent,
  discordMessageShouldBeReposted,
  getAdminSyncServer,
  getDiscordEmbedForDeletion,
  getDiscordServer,
  getEmbedRecord,
  processLeasedDiscordJobs,
  recordDiscordFailure,
  releaseDiscordEmbedLease,
  storeDiscordEmbed
} from "./outbox";

export async function handleAdminDiscordAction(
  serverId: string,
  env: DirectoryEnv,
  actor: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const server = await getAdminSyncServer(env, serverId);

  if (!server) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const timestamp = nowIso();
  const desiredAction = server.status === "approved" ? "upsert" : "delete";

  await runD1Batch(
    env,
    adminSyncStatements(env, serverId, actor, desiredAction, server.updated_at, timestamp)
  );

  if (ctx) ctx.waitUntil(processDiscordEmbedJobs(env));

  return json({ ok: true, id: serverId, discordEmbed: "pending" }, 202, NO_STORE_JSON_HEADERS);
}

export async function processDiscordEmbedJobs(env: DirectoryEnv): Promise<void> {
  await processLeasedDiscordJobs(env, {
    table: "discord_embed_jobs",
    selectedColumns: "server_id, desired_action, desired_version, attempt_count",
    failureEvent: "discord.embed_processing_failed",
    process: processDiscordEmbedJob
  });
}

async function processDiscordEmbedJob(
  env: DirectoryEnv,
  job: DiscordEmbedJob,
  leaseToken: string
): Promise<void> {
  try {
    const server = await getDiscordServer(env, job.server_id);
    const desiredAction = server?.status === "approved" ? "upsert" : "delete";
    const desiredVersion = server?.updated_at ?? job.desired_version;

    if (desiredAction !== job.desired_action || desiredVersion !== job.desired_version) {
      await runD1Statement(
        discordEmbedJobStatement(env, job.server_id, desiredAction, desiredVersion)
      );
      await releaseDiscordEmbedLease(env, job.server_id, leaseToken);

      return;
    }

    if (!(await discordEmbedJobStillCurrent(env, job, leaseToken))) {
      await releaseDiscordEmbedLease(env, job.server_id, leaseToken);

      return;
    }

    let delivered = false;

    if (desiredAction === "upsert" && server) {
      delivered = await upsertDiscordEmbed(env, server, job, leaseToken);
    } else {
      delivered = await deleteDiscordEmbed(env, job.server_id, job, leaseToken);
    }

    if (!delivered) {
      await releaseDiscordEmbedLease(env, job.server_id, leaseToken);

      return;
    }

    await deleteEmbedJob(env, job, leaseToken);
  } catch (error) {
    await recordDiscordFailure(env, job, leaseToken, error);
    await releaseDiscordEmbedLease(env, job.server_id, leaseToken);
  }
}

async function upsertDiscordEmbed(
  env: DirectoryEnv,
  server: DiscordServerRow,
  job: DiscordEmbedJob,
  leaseToken: string
): Promise<boolean> {
  const webhook = parseDiscordWebhookUrl(env.DISCORD_SERVER_DIRECTORY_WEBHOOK_URL);
  const embed = await getEmbedRecord(env, server.id);
  const timestamp = nowIso();
  let messageId = embed?.message_id ?? null;
  let guildId = embed?.guild_id ?? null;
  let channelId = embed?.channel_id ?? null;
  let supersededMessageId = embed?.superseded_message_id ?? null;
  const repostMessage = Boolean(
    messageId &&
    embed &&
    discordMessageShouldBeReposted(embed.synced_at, DISCORD_PUBLIC_MESSAGE_REPOST_AFTER_MS)
  );
  let createdMessage = false;
  let repostedMessage = false;

  if (supersededMessageId) {
    await deleteDiscordWebhookMessage(
      webhook,
      supersededMessageId,
      "delete superseded public embed"
    );
    await clearSupersededDiscordEmbed(env, server.id, messageId as string, supersededMessageId);
    supersededMessageId = null;
  }

  if (messageId && !repostMessage) {
    if (!(await discordEmbedJobStillCurrent(env, job, leaseToken)))
      return false;

    const payload = buildDiscordServerMessage(server, { updated: true, timestamp });
    const response = await discordFetch(
      `${webhook}/messages/${encodeURIComponent(messageId)}`,
      "PATCH",
      payload,
      false
    );

    if (response.status === 404) {
      await cancelResponseBody(response);
      messageId = null;
    } else {
      await requireDiscordSuccess(response, "edit");
      const body = await readBoundedDiscordJson(response);
      const location = discordMessageLocation(body, env.DISCORD_GUILD_ID);

      guildId = location.guildId ?? guildId;
      channelId = location.channelId ?? channelId;
    }
  }

  if (!messageId || repostMessage) {
    if (!(await discordEmbedJobStillCurrent(env, job, leaseToken)))
      return false;

    const previousMessageId = repostMessage ? messageId : null;
    const payload = buildDiscordServerMessage(server, { updated: false, timestamp });
    let response: Response;

    try {
      response = await discordFetch(`${webhook}?wait=true`, "POST", payload, true);
    } catch (error) {
      throw new DiscordDeliveryError(
        "ambiguous_create",
        "Discord message creation had an ambiguous network result.",
        false,
        error
      );
    }

    await requireDiscordSuccess(response, "create");
    const body = await readBoundedDiscordJson(response);

    if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) {
      throw new DiscordDeliveryError(
        "invalid_response",
        "Discord returned an invalid message response.",
        false
      );
    }

    messageId = body.id;
    const location = discordMessageLocation(body, env.DISCORD_GUILD_ID);

    guildId = location.guildId;
    channelId = location.channelId;
    supersededMessageId = previousMessageId;
    createdMessage = !previousMessageId;
    repostedMessage = Boolean(previousMessageId);
    logInfo(repostedMessage ? "discord.embed_reposted" : "discord.embed_created", {
      serverId: server.id
    });
  } else {
    logInfo("discord.embed_updated", { serverId: server.id });
  }

  if (!(await discordEmbedJobStillCurrent(env, job, leaseToken))) {
    // Persist a newly created message before releasing a stale lease so the next job can clean it up
    if (createdMessage || repostedMessage) {
      await storeDiscordEmbed(
        env,
        server.id,
        messageId,
        guildId,
        channelId,
        supersededMessageId,
        server.updated_at,
        timestamp
      );

      if (supersededMessageId) {
        await deleteDiscordWebhookMessage(
          webhook,
          supersededMessageId,
          "delete superseded public embed"
        );
        await clearSupersededDiscordEmbed(env, server.id, messageId, supersededMessageId);
      }
    }

    return false;
  }

  await storeDiscordEmbed(
    env,
    server.id,
    messageId,
    guildId,
    channelId,
    supersededMessageId,
    server.updated_at,
    timestamp
  );

  if (supersededMessageId) {
    await deleteDiscordWebhookMessage(
      webhook,
      supersededMessageId,
      "delete superseded public embed"
    );
    await clearSupersededDiscordEmbed(env, server.id, messageId, supersededMessageId);
  }

  return true;
}

function discordMessageLocation(
  body: Record<string, unknown>,
  fallbackGuildId: string | undefined
): { guildId: string | null; channelId: string | null } {
  const responseGuildId = typeof body.guild_id === "string" && /^\d{10,32}$/.test(body.guild_id) ? body.guild_id : null;
  const configuredGuildId = fallbackGuildId?.trim();
  const guildId =
    responseGuildId ??
    (configuredGuildId && /^\d{10,32}$/.test(configuredGuildId) ? configuredGuildId : null);
  const channelId =
    typeof body.channel_id === "string" && /^\d{10,32}$/.test(body.channel_id)
      ? body.channel_id
      : null;

  return { guildId, channelId };
}

async function deleteDiscordEmbed(
  env: DirectoryEnv,
  serverId: string,
  job: DiscordEmbedJob,
  leaseToken: string
): Promise<boolean> {
  const embed = await getDiscordEmbedForDeletion(env, serverId);

  if (!embed)
    return true;

  if (!(await discordEmbedJobStillCurrent(env, job, leaseToken)))
    return false;

  const webhook = parseDiscordWebhookUrl(env.DISCORD_SERVER_DIRECTORY_WEBHOOK_URL);

  await deleteDiscordWebhookMessage(webhook, embed.message_id, "delete public embed");

  if (embed.superseded_message_id && embed.superseded_message_id !== embed.message_id) {
    await deleteDiscordWebhookMessage(
      webhook,
      embed.superseded_message_id,
      "delete superseded public embed"
    );
  }

  if (!(await discordEmbedJobStillCurrent(env, job, leaseToken)))
    return false;

  await deleteDiscordEmbedRecord(env, serverId);
  logInfo("discord.embed_deleted", { serverId });

  return true;
}
