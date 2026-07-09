import {
  JSON_HEADERS,
  NO_STORE_JSON_HEADERS,
  PLUGIN_API_VERSION,
  PLUGIN_VERIFY_MAX_JSON_BODY_BYTES,
  PLUGIN_VERIFY_PATH,
  rejectionRequiresReverification,
  SUBMISSION_DESCRIPTION_MAX_LENGTH,
  VERIFICATION_CHALLENGE_TTL_MS,
  VERIFICATION_GENERATION_ACCOUNT_LIMIT_PER_HOUR,
  VERIFICATION_GENERATION_IP_LIMIT_PER_HOUR,
  VERIFICATION_PROOF_TTL_MS,
  VERIFICATION_RATE_LIMIT_RETRY_SECONDS
} from "../config";
import type { DirectoryEnv, DirectoryRequestContext } from "../contracts";
import { requireSubmitter } from "../auth/submitter-sessions";
import { isD1UniqueConstraintError } from "../core/d1";
import { ApiError, json, readJsonObject, stringField } from "../core/http";
import { normalizeAddress, parsePortField } from "../core/network-validation";
import { validateListingNameAndDescription } from "../core/listing-fields";
import {
  clientHashes,
  pluginVerifyRateLimit,
  rateLimitResponse,
  verificationCreateAccountRateLimit,
  verificationCreateRateLimit,
  verificationRateLimitResponse,
  verificationStatusAccountRateLimit,
  verificationStatusRateLimit
} from "../core/rate-limit";
import { logError, msAgoIso, nowIso } from "../core/runtime";
import {
  invalidVerificationCodeResponse,
  isUuidLike,
  normalizeVerificationCode,
  pluginCallbackPayload,
  pluginVerifyErrorResponse,
  publicVerificationChallenge,
  verificationChallengeCreatedResponse,
  verificationChallengeStatus,
  verificationCodeForChallenge,
  verificationCodeHash,
  verificationProofExpiresAt
} from "./proofs";
import {
  countRecentChallengesByAccount,
  countRecentChallengesByIp,
  expirePendingChallenge,
  getChallengeByCodeHash,
  getChallengeForOwner,
  getOwnedVerificationContext,
  getPendingChallenge,
  getReusableVerifiedChallenge,
  insertPendingChallenge,
  markChallengeVerified
} from "./challenge-storage";

export async function routeVerificationChallenges(
  context: DirectoryRequestContext
): Promise<Response | null> {
  const { request, url, env } = context;

  if (request.method === "POST" && url.pathname === "/api/servers/verification-challenges")
    return createVerificationChallenge(request, env);

  if (request.method === "GET" && url.pathname.startsWith("/api/servers/verification-challenges/"))
    return getVerificationChallenge(request, url, env);

  return null;
}

export async function routePluginVerification(
  context: DirectoryRequestContext
): Promise<Response | null> {
  const { request, url, env } = context;

  if (request.method !== "POST")
    return null;

  if (url.pathname === PLUGIN_VERIFY_PATH)
    return verifyPluginChallenge(request, env);

  const requestedVersion = pluginApiVersion(url.pathname);

  return requestedVersion !== null && requestedVersion < PLUGIN_API_VERSION
    ? outdatedPluginApiResponse(url)
    : null;
}

function pluginApiVersion(pathname: string): number | null {
  if (pathname === "/api/plugin/verify")
    return 0;

  const match = pathname.match(/^\/api\/v(\d+)\/plugin\/verify$/);

  return match ? Number(match[1]) : null;
}

function outdatedPluginApiResponse(url: URL): Response {
  const location = new URL(PLUGIN_VERIFY_PATH, url.origin).toString();

  return json(
    {
      ok: false,
      status: "outdated_api",
      message: `Latest API version is now v${PLUGIN_API_VERSION}`
    },
    301,
    {
      ...JSON_HEADERS,
      location
    }
  );
}

async function createVerificationChallenge(
  request: Request,
  env: DirectoryEnv
): Promise<Response> {
  if (
    !env.VERIFICATION_CODE_SECRET ||
    (env.APP_ENVIRONMENT !== "local" &&
      (!env.RATE_LIMIT_SALT || !env.VERIFICATION_CREATE_RATE_LIMIT))
  ) {
    logError("verification.missing_secrets");

    return json(
      { error: "Server verification is temporarily unavailable." },
      503,
      NO_STORE_JSON_HEADERS
    );
  }

  const generationRateLimit = await verificationCreateRateLimit(request, env);

  if (!generationRateLimit.ok)
    return verificationRateLimitResponse(generationRateLimit.error);

  const session = await requireSubmitter(request, env);

  if (!session.ok)
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);

  const accountRateLimit = await verificationCreateAccountRateLimit(session.account.id, env);

  if (!accountRateLimit.ok)
    return rateLimitResponse(accountRateLimit.error);

  const body = await readJsonObject(request);
  const name = stringField(body, "name", 80);
  const address = stringField(body, "address", 255);
  const description = stringField(body, "description", SUBMISSION_DESCRIPTION_MAX_LENGTH);
  const port = parsePortField(body.port);
  const normalized = normalizeAddress(address, port);

  validateListingNameAndDescription(name, description);

  if (!normalized.ok)
    throw new ApiError(400, normalized.error);

  const timestamp = nowIso();
  const ownedServer = await getOwnedVerificationContext(env, session.account.id);
  const pendingChallenge = await getPendingChallenge(env, session.account.id);

  if (pendingChallenge) {
    const pendingStatus = verificationChallengeStatus(pendingChallenge, timestamp);
    const sameTarget =
      pendingChallenge.normalized_host === normalized.host &&
      pendingChallenge.port === normalized.port;

    if (pendingStatus === "pending" && sameTarget) {
      const code = await verificationCodeForChallenge(pendingChallenge.id, env);

      if ((await verificationCodeHash(code, env)) === pendingChallenge.code_hash) {
        return verificationChallengeCreatedResponse({
          id: pendingChallenge.id,
          code,
          createdAt: pendingChallenge.created_at,
          expiresAt: pendingChallenge.expires_at,
          address: normalized.address,
          reused: true
        });
      }
    }

    await expirePendingChallenge(env, pendingChallenge.id, timestamp);
  }

  const proofLifetimeCutoff = msAgoIso(VERIFICATION_PROOF_TTL_MS);
  const latestRejectionAt =
    ownedServer?.status === "rejected" &&
    rejectionRequiresReverification(ownedServer.rejection_reason_code)
      ? (ownedServer.rejected_at ?? ownedServer.updated_at)
      : null;
  const reusableVerifiedAfter =
    latestRejectionAt && latestRejectionAt > proofLifetimeCutoff
      ? latestRejectionAt
      : proofLifetimeCutoff;

  // After staff rejection, only proof newer than the rejection counts as "reusable"
  const existingVerifiedChallenge = await getReusableVerifiedChallenge(
    env,
    session.account.id,
    normalized.host,
    normalized.port,
    reusableVerifiedAfter
  );

  if (existingVerifiedChallenge) {
    const expiresAt = verificationProofExpiresAt(existingVerifiedChallenge);

    return json(
      {
        ok: true,
        reused: true,
        id: existingVerifiedChallenge.id,
        status: "verified",
        expiresAt,
        address: normalized.address
      },
      200,
      NO_STORE_JSON_HEADERS
    );
  }

  const oneHourAgo = msAgoIso(60 * 60 * 1000);
  const { ipHash, userAgentHash } = await clientHashes(request, env);
  const recentByAccount = await countRecentChallengesByAccount(env, session.account.id, oneHourAgo);

  if (recentByAccount >= VERIFICATION_GENERATION_ACCOUNT_LIMIT_PER_HOUR) {
    return json(
      { error: "Too many verification codes. Try again later." },
      429,
      NO_STORE_JSON_HEADERS
    );
  }

  const recentByIp = await countRecentChallengesByIp(env, ipHash, oneHourAgo);

  if (recentByIp >= VERIFICATION_GENERATION_IP_LIMIT_PER_HOUR) {
    return json(
      { error: "Too many verification codes. Try again later." },
      429,
      NO_STORE_JSON_HEADERS
    );
  }

  const createdAt = timestamp;
  const expiresAt = new Date(Date.now() + VERIFICATION_CHALLENGE_TTL_MS).toISOString();
  const challenge = await insertVerificationChallenge(env, {
    ownerAccountId: session.account.id,
    serverName: name,
    host: normalized.host,
    port: normalized.port,
    expiresAt,
    ipHash,
    userAgentHash,
    createdAt
  });

  return verificationChallengeCreatedResponse({
    id: challenge.id,
    code: challenge.code,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    address: normalized.address,
    reused: challenge.reused
  });
}

async function getVerificationChallenge(
  request: Request,
  url: URL,
  env: DirectoryEnv
): Promise<Response> {
  const readRateLimit = await verificationStatusRateLimit(request, env);

  if (!readRateLimit.ok)
    return rateLimitResponse(readRateLimit.error);

  const session = await requireSubmitter(request, env);

  if (!session.ok)
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);

  const id = url.pathname.replace("/api/servers/verification-challenges/", "").replace(/\/+$/, "");

  if (!isUuidLike(id))
    return json({ error: "Verification code not found." }, 404, NO_STORE_JSON_HEADERS);

  const accountRateLimit = await verificationStatusAccountRateLimit(session.account.id, env);

  if (!accountRateLimit.ok)
    return rateLimitResponse(accountRateLimit.error);

  const row = await getChallengeForOwner(env, id, session.account.id);

  if (!row)
    return json({ error: "Verification code not found." }, 404, NO_STORE_JSON_HEADERS);

  return json(
    { ok: true, challenge: publicVerificationChallenge(row) },
    200,
    NO_STORE_JSON_HEADERS
  );
}

async function verifyPluginChallenge(
  request: Request,
  env: DirectoryEnv
): Promise<Response> {
  try {
    if (
      !env.VERIFICATION_CODE_SECRET ||
      (env.APP_ENVIRONMENT !== "local" &&
        (!env.RATE_LIMIT_SALT ||
          !env.PLUGIN_VERIFY_RATE_LIMIT ||
          !env.PLUGIN_VERIFY_GLOBAL_RATE_LIMIT))
    ) {
      logError("verification.missing_secrets");

      return pluginVerifyErrorResponse(
        "service_unavailable",
        "Server verification is temporarily unavailable.",
        503
      );
    }

    const body = await readJsonObject(request, false, PLUGIN_VERIFY_MAX_JSON_BODY_BYTES);
    const code = normalizeVerificationCode(stringField(body, "code", 64));

    if (!code)
      return pluginVerifyErrorResponse("invalid_request", "Invalid request.", 400);

    const callbackPayload = pluginCallbackPayload(body);

    if (
      !callbackPayload.pluginVersion ||
      !callbackPayload.serverSoftware ||
      !callbackPayload.minecraftVersion
    )
      return pluginVerifyErrorResponse("invalid_request", "Invalid request.", 400);

    const rateLimit = await pluginVerifyRateLimit(request, env);

    if (!rateLimit.ok) {
      return pluginVerifyErrorResponse("rate_limited", rateLimit.error, 429, {
        "retry-after": String(VERIFICATION_RATE_LIMIT_RETRY_SECONDS)
      });
    }

    const codeHash = await verificationCodeHash(code, env);
    const timestamp = nowIso();
    const row = await getChallengeByCodeHash(env, codeHash);

    if (!row)
      return invalidVerificationCodeResponse();

    const visibleStatus = verificationChallengeStatus(row, timestamp);

    if (visibleStatus === "expired" || visibleStatus === "consumed")
      return invalidVerificationCodeResponse();

    if (visibleStatus === "verified") {
      const message = "Server verification is already complete. Return to the submission page.";

      // ( ͡° ͜ʖ ͡°)
      return json(
        {
          ok: false,
          status: "already_verified",
          expiresAt: verificationProofExpiresAt(row),
          message
        },
        409,
        NO_STORE_JSON_HEADERS
      );
    }

    const { ip, ipHash, userAgentHash } = await clientHashes(request, env);
    const pluginVersion = callbackPayload.pluginVersion;
    const serverSoftware = callbackPayload.serverSoftware;
    const minecraftVersion = callbackPayload.minecraftVersion;
    const updated = await markChallengeVerified(env, {
      id: row.id,
      timestamp,
      pluginVersion,
      serverSoftware,
      minecraftVersion,
      ip,
      ipHash,
      userAgentHash
    });

    if (!updated)
      return invalidVerificationCodeResponse();

    return json(
      {
        ok: true,
        status: "verified",
        expiresAt: verificationProofExpiresAt(timestamp),
        message: "Server verification complete. Return to the submission page."
      },
      200,
      NO_STORE_JSON_HEADERS
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return pluginVerifyErrorResponse(
        error.status === 413 ? "payload_too_large" : "invalid_request",
        error.status === 413 ? error.message : "Invalid request.",
        error.status === 413 ? 413 : 400
      );
    }

    logError("verification.plugin_unhandled", error);

    return pluginVerifyErrorResponse(
      "internal_error",
      "Server verification failed unexpectedly.",
      500
    );
  }
}

async function insertVerificationChallenge(
  env: DirectoryEnv,
  challenge: {
    ownerAccountId: string;
    serverName: string;
    host: string;
    port: number;
    expiresAt: string;
    ipHash: string;
    userAgentHash: string;
    createdAt: string;
  }
): Promise<{ id: string; code: string; createdAt: string; expiresAt: string; reused: boolean }> {
  // Unique pending challenge constraint also closes races between simultaneous create requests
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = crypto.randomUUID();
    const code = await verificationCodeForChallenge(id, env);
    const codeHash = await verificationCodeHash(code, env);

    try {
      await insertPendingChallenge(env, { id, codeHash, ...challenge });

      return {
        id,
        code,
        createdAt: challenge.createdAt,
        expiresAt: challenge.expiresAt,
        reused: false
      };
    } catch (error) {
      if (attempt >= 2 || !isD1UniqueConstraintError(error))
        throw error;

      const existing = await getPendingChallenge(env, challenge.ownerAccountId);

      if (!existing)
        continue;

      const sameTarget = existing.normalized_host === challenge.host && existing.port === challenge.port;

      if (verificationChallengeStatus(existing, nowIso()) === "pending" && sameTarget) {
        const existingCode = await verificationCodeForChallenge(existing.id, env);

        if ((await verificationCodeHash(existingCode, env)) === existing.code_hash) {
          return {
            id: existing.id,
            code: existingCode,
            createdAt: existing.created_at,
            expiresAt: existing.expires_at,
            reused: true
          };
        }
      }

      await expirePendingChallenge(env, existing.id, nowIso());
    }
  }

  throw new ApiError(503, "Server verification is temporarily unavailable.");
}
