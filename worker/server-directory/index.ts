import {
  DISCORD_EMBED_CRON,
  NO_STORE_JSON_HEADERS,
  PUBLIC_DIRECTORY_MAX_PAGE,
  SUBMITTER_SESSION_CLEANUP_BATCH_LIMIT,
  VERIFICATION_CLEANUP_BATCH_LIMIT,
  VERIFICATION_CONSUMED_RETENTION_MS,
  VERIFICATION_PROOF_TTL_MS,
  VERIFICATION_STALE_RETENTION_MS
} from "./config";
import type { DirectoryEnv, DirectoryRequestContext } from "./contracts";
import { expiredSessionCleanupStatement } from "./auth/submitter-sessions";
import { requireAdmin } from "./auth/admin-access";
import { routeAuth } from "./auth/discord-login";
import { runD1Batch } from "./core/d1";
import { ApiError, json } from "./core/http";
import { validateSameOriginMutation } from "./core/network-validation";
import { logError, msAgoIso, nowIso } from "./core/runtime";
import { processDiscordDeliveryJobs } from "./discord/delivery";
import { handleAdmin } from "./moderation/moderation-actions";
import { routePublicCollections, routePublicDetail } from "./public-directory/listings";
import { refreshApprovedServers } from "./status/refresh";
import { routeNewSubmission, routeOwnerSubmissions } from "./submissions/submission-workflows";
import {
  orphanedProofCleanupStatement,
  staleChallengeCleanupStatement
} from "./verification/challenge-storage";
import { routePluginVerification, routeVerificationChallenges } from "./verification/challenges";

export { PUBLIC_DIRECTORY_MAX_PAGE };
export { buildDiscordServerMessage } from "./discord/messages";
export { processDiscordEmbedJobs } from "./discord/public-listings";
export {
  processDiscordReviewDeletionJobs,
  processDiscordReviewNotificationJobs
} from "./discord/delivery";
export { DISCORD_EMBED_CRON } from "./config";

export async function handleServerDirectoryRequest(
  request: Request,
  env: DirectoryEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  try {
    return await routeServerDirectory({
      request,
      url: new URL(request.url),
      env,
      executionCtx: ctx
    });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status, NO_STORE_JSON_HEADERS);

    logError("server-directory.unhandled", error);

    return json({ error: "Internal server error." }, 500, NO_STORE_JSON_HEADERS);
  }
}

async function routeServerDirectory(context: DirectoryRequestContext): Promise<Response> {
  const { request, url, env } = context;

  if (!url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);

  const sameOriginFailure = validateSameOriginMutation(request, url);
  if (sameOriginFailure) return sameOriginFailure;

  // Owner, recent and verification routes must be checked before the generic slug route
  const authResponse = await routeAuth(context);
  if (authResponse) return authResponse;

  const publicCollectionResponse = await routePublicCollections(context);
  if (publicCollectionResponse) return publicCollectionResponse;

  const ownerResponse = await routeOwnerSubmissions(context);
  if (ownerResponse) return ownerResponse;

  const verificationResponse = await routeVerificationChallenges(context);
  if (verificationResponse) return verificationResponse;

  const publicDetailResponse = await routePublicDetail(context);
  if (publicDetailResponse) return publicDetailResponse;

  const submissionResponse = await routeNewSubmission(context);
  if (submissionResponse) return submissionResponse;

  const pluginResponse = await routePluginVerification(context);
  if (pluginResponse) return pluginResponse;

  if (url.pathname.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);

    if (!admin.ok) return json({ error: admin.error }, 403, NO_STORE_JSON_HEADERS);

    return handleAdmin(request, url, env, admin.actor, context.executionCtx);
  }

  return json({ error: "Not found." }, 404);
}

export function scheduleServerDirectoryRefresh(
  env: DirectoryEnv,
  ctx: ExecutionContext,
  scheduledTime = Date.now(),
  cron = "*/5 * * * *"
): void {
  if (cron === DISCORD_EMBED_CRON) {
    ctx.waitUntil(processDiscordDeliveryJobs(env));

    return;
  }

  ctx.waitUntil(refreshApprovedServers(env));

  const scheduledDate = new Date(scheduledTime);

  if (scheduledDate.getUTCMinutes() === 0) {
    ctx.waitUntil(cleanupDirectoryData(env, scheduledDate.getUTCHours() === 0));
  }
}

async function cleanupDirectoryData(
  env: DirectoryEnv,
  includeOrphanedProofs: boolean
): Promise<void> {
  const staleCutoff = msAgoIso(VERIFICATION_STALE_RETENTION_MS);
  const verifiedProofCutoff = msAgoIso(VERIFICATION_PROOF_TTL_MS);
  const statements = [
    staleChallengeCleanupStatement(
      env,
      staleCutoff,
      verifiedProofCutoff,
      VERIFICATION_CLEANUP_BATCH_LIMIT
    ),
    expiredSessionCleanupStatement(env, nowIso(), SUBMITTER_SESSION_CLEANUP_BATCH_LIMIT)
  ];

  if (includeOrphanedProofs) {
    // Orphan scans are heavier and only run during the midnight cleanup
    const consumedCutoff = msAgoIso(VERIFICATION_CONSUMED_RETENTION_MS);

    statements.push(
      orphanedProofCleanupStatement(env, consumedCutoff, VERIFICATION_CLEANUP_BATCH_LIMIT)
    );
  }

  await runD1Batch(env, statements);
}
