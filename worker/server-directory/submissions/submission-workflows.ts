import {
  NO_STORE_JSON_HEADERS,
  rejectionRequiresReverification,
  SUBMISSION_ACCOUNT_LIMIT_PER_DAY,
  SUBMISSION_DESCRIPTION_MAX_LENGTH,
  SUBMISSION_IP_LIMIT_PER_DAY
} from "../config";
import type {
  AdminServerRow,
  DirectoryEnv,
  DirectoryRequestContext,
  ServerState,
  SubmissionInput
} from "../contracts";
import {
  getSubmitterSession,
  requireSubmitter,
  submitterContact,
  submitterReturnPath,
  toSubmitterUser,
  type SubmitterAccount
} from "../auth/submitter-sessions";
import {
  discordEmbedJobStatement,
  discordReviewNotificationJobStatement,
  getDiscordReviewDeletionSnapshot
} from "../discord/outbox";
import {
  scheduleDiscordDeliveryProcessing,
  scheduleDiscordEmbedProcessing,
  scheduleDiscordReviewNotificationProcessing
} from "../discord/delivery";
import { sha256 } from "../core/crypto";
import { runD1Batch } from "../core/d1";
import { ApiError, json, readJsonObject, stringField } from "../core/http";
import { daysAgoIso, logError, nowIso } from "../core/runtime";
import { normalizeAddress, parsePortField } from "../core/network-validation";
import {
  publicDetailsMutationRateLimit,
  rateLimitResponse,
  submissionMutationRateLimit,
  submitterReadRateLimit
} from "../core/rate-limit";
import { toAdminServer } from "../moderation/moderation-actions";
import { fetchServerStatus } from "../status/refresh";
import { statusSnapshotStatements } from "../status/status-storage";
import type { StatusSnapshot } from "../status/providers";
import {
  requireVerifiedChallenge,
  storedSubmissionVerificationEvidence,
  verificationConsumptionStatements
} from "../verification/proofs";
import {
  autoSuspensionStatements,
  autoSuspendOwnedServerStatement,
  autoSuspendServerStatement,
  getConflictingAddress,
  getExistingAddress,
  getOwnedServerRow,
  getSuspendedAddress,
  newSubmissionServerStatement,
  ownerDeletionStatements,
  publicDetailsStatements,
  resubmissionEventStatement,
  resubmissionServerStatement,
  submissionQuotaCounts,
  submissionInsertStatement,
  submittedEventStatement
} from "./submission-storage";
import {
  normalizeWebsiteInput,
  parsePublicDetailsInput,
  parseSocialLinks,
  publicDetailsMatch,
  validateTurnstile
} from "./validation";
import { validateListingNameAndDescription } from "../core/listing-fields";

export async function routeOwnerSubmissions(
  context: DirectoryRequestContext
): Promise<Response | null> {
  const { request, url, env, executionCtx } = context;

  if (request.method === "GET" && url.pathname === "/api/servers/me") {
    return getMySubmission(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/servers/me/resubmit") {
    return resubmitMyServer(request, env, executionCtx);
  }

  if (request.method === "PATCH" && url.pathname === "/api/servers/me/details") {
    return updateMyPublicDetails(request, env, executionCtx);
  }

  if (request.method === "DELETE" && url.pathname === "/api/servers/me") {
    return deleteMyServer(request, env, executionCtx);
  }

  return null;
}

export async function routeNewSubmission(
  context: DirectoryRequestContext
): Promise<Response | null> {
  return context.request.method === "POST" && context.url.pathname === "/api/servers/submit"
    ? submitServer(context.request, context.env, context.executionCtx)
    : null;
}

function toOwnerServer(row: AdminServerRow) {
  const latestReviewReason = row.status !== "pending" && row.status !== "approved" ? row.submission_moderation_notes : null;
  const reverificationRequired =
    row.status === "rejected"
      ? rejectionRequiresReverification(row.review_event_reason_code) ||
        !row.submission_verification_evidence
      : row.status === "hidden_offline";

  return {
    ...toAdminServer(row),
    host: row.normalized_host,
    port: row.port,
    rejectionReason: latestReviewReason,
    reverificationRequired,
    editable: row.status !== "pending" && row.status !== "suspended",
    canEditPublicDetails: row.status === "approved",
    canRequestReview: row.status === "rejected" || row.status === "hidden_offline"
  };
}

async function submitServer(
  request: Request,
  env: DirectoryEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const mutationRateLimit = await submissionMutationRateLimit(session.account.id, env);

  if (!mutationRateLimit.ok) {
    return rateLimitResponse(mutationRateLimit.error);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (owned) {
    if (owned.status === "suspended") {
      return json(
        {
          error: "This server is suspended. Contact staff before submitting it again.",
          item: toOwnerServer(owned)
        },
        409,
        NO_STORE_JSON_HEADERS
      );
    }

    if (owned.status === "rejected") {
      return json(
        {
          error: "Your previous submission was rejected. Update it on this page and resubmit it for review.",
          item: toOwnerServer(owned)
        },
        409,
        NO_STORE_JSON_HEADERS
      );
    }

    return json(
      {
        error: "Your Discord account already owns a server submission.",
        item: toOwnerServer(owned)
      },
      409,
      NO_STORE_JSON_HEADERS
    );
  }

  const body = await readJsonObject(request);
  const input = await parseSubmissionInput(request, env, body, session.account.id);
  const sevenDaysAgo = daysAgoIso(7);

  const existing = await getExistingAddress(env, input.normalized.host, input.normalized.port);
  const conflict = conflictingAddressResponse(existing);

  if (conflict) {
    return conflict;
  }

  const suspendedAddress = await getSuspendedAddress(
    env,
    input.normalized.host,
    input.normalized.port
  );

  if (suspendedAddress) {
    return autoSuspendSubmission(env, session.account, input, existing, suspendedAddress.reason);
  }

  if (existing?.status === "rejected" && existing.updated_at > sevenDaysAgo) {
    return json(
      { error: "This server was recently rejected. Please wait before resubmitting." },
      409
    );
  }

  const verification = await verifyReachableServer(
    input.normalized.address,
    "status.submission_verification_failed",
    "The server must be online and reachable before staff can review it."
  );

  if (!verification.ok) {
    return verification.response;
  }

  const id = existing?.id ?? crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const slug =
    existing?.slug ??
    `${slugify(input.name)}-${(await sha256(`${input.normalized.host}:${input.normalized.port}`)).slice(0, 8)}`;
  const createdAt = nowIso();
  const contact = submitterContact(session.account);
  const serverMutation = newSubmissionServerStatement(env, {
    existing,
    id,
    slug,
    accountId: session.account.id,
    submission: input,
    timestamp: createdAt
  });

  // Staff should never see a submission without the proof/status rows it was reviewed against
  await runD1Batch(env, [
    serverMutation,
    ...statusSnapshotStatements(env, id, verification.snapshot, createdAt),
    submissionInsertStatement(env, {
      id: submissionId,
      serverId: id,
      ownerAccountId: session.account.id,
      contact,
      verificationEvidence: storedSubmissionVerificationEvidence(input.verification, input.name),
      input,
      moderationNotes: null,
      createdAt
    }),
    ...verificationConsumptionStatements(env, input, createdAt),
    submittedEventStatement(env, id, Boolean(existing), createdAt),
    discordReviewNotificationJobStatement(
      env,
      id,
      submissionId,
      existing ? "resubmitted" : "submitted",
      createdAt
    )
  ]);

  scheduleDiscordReviewNotificationProcessing(env, ctx);

  return json({ ok: true, id, slug, status: "pending" }, 202);
}

async function enforceSubmissionQuota(
  env: DirectoryEnv,
  ownerAccountId: string,
  ipHash: string
): Promise<void> {
  const oneDayAgo = daysAgoIso(1);
  const { accountTotal, ipTotal } = await submissionQuotaCounts(
    env,
    ownerAccountId,
    ipHash,
    oneDayAgo
  );

  if (accountTotal >= SUBMISSION_ACCOUNT_LIMIT_PER_DAY || ipTotal >= SUBMISSION_IP_LIMIT_PER_DAY) {
    throw new ApiError(429, "Too many submissions today. Try again later.");
  }
}

async function getMySubmission(
  request: Request,
  env: DirectoryEnv
): Promise<Response> {
  const readRateLimit = await submitterReadRateLimit(request, env);

  if (!readRateLimit.ok) {
    return rateLimitResponse(readRateLimit.error);
  }

  const session = await getSubmitterSession(request, env);

  if (!session) {
    return json(
      {
        authenticated: false,
        loginUrl: `/api/auth/discord/login?returnTo=${encodeURIComponent(submitterReturnPath())}`
      },
      200,
      NO_STORE_JSON_HEADERS
    );
  }

  const item = await getOwnedServerRow(env, session.account.id);

  return json(
    {
      authenticated: true,
      user: toSubmitterUser(session.account),
      item: item ? toOwnerServer(item) : null
    },
    200,
    NO_STORE_JSON_HEADERS
  );
}

async function resubmitMyServer(
  request: Request,
  env: DirectoryEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const mutationRateLimit = await submissionMutationRateLimit(session.account.id, env);

  if (!mutationRateLimit.ok) {
    return rateLimitResponse(mutationRateLimit.error);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json(
      { error: "You do not have a server listing or submission to update." },
      404,
      NO_STORE_JSON_HEADERS
    );
  }

  if (owned.status === "pending") {
    return json(
      { error: "Pending submissions cannot be edited until staff review is complete." },
      409,
      NO_STORE_JSON_HEADERS
    );
  }

  if (owned.status === "suspended") {
    return json(
      { error: "Suspended submissions cannot be edited or resubmitted. Contact staff for help." },
      409,
      NO_STORE_JSON_HEADERS
    );
  }

  // Approved listings stay approved after verification while rejected and hidden listings go back through review
  const keepsApproval = owned.status === "approved";
  const body = await readJsonObject(request);
  const requestedAddress = normalizeAddress(
    stringField(body, "address", 255),
    parsePortField(body.port)
  );
  const addressChanged =
    !requestedAddress.ok ||
    requestedAddress.host !== owned.normalized_host ||
    requestedAddress.port !== owned.port;
  const rejectionRequiresFreshVerification =
    owned.status === "rejected" &&
    (rejectionRequiresReverification(owned.review_event_reason_code) ||
      !owned.submission_verification_evidence);
  const verificationRequired = owned.status === "rejected" ? rejectionRequiresFreshVerification || addressChanged : true;
  const input = await parseSubmissionInput(request, env, body, session.account.id, {
    verificationRequired,
    verifiedAfter: rejectionRequiresFreshVerification
      ? (owned.review_event_created_at ?? owned.updated_at)
      : null
  });

  const existingAddress = await getConflictingAddress(
    env,
    input.normalized.host,
    input.normalized.port,
    owned.id
  );
  const conflict = conflictingAddressResponse(existingAddress);

  if (conflict) {
    return conflict;
  }

  const suspendedAddress = await getSuspendedAddress(
    env,
    input.normalized.host,
    input.normalized.port
  );

  if (suspendedAddress) {
    return autoSuspendOwnedSubmission(env, session.account, owned, input, suspendedAddress.reason);
  }

  const verification = await verifyReachableServer(
    input.normalized.address,
    "status.resubmission_verification_failed",
    "The server must be online and reachable before these changes can be saved."
  );

  if (!verification.ok) {
    return verification.response;
  }

  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  const serverMutation = resubmissionServerStatement(
    env,
    input,
    owned,
    session.account.id,
    keepsApproval,
    timestamp
  );

  await runD1Batch(env, [
    serverMutation,
    ...statusSnapshotStatements(env, owned.id, verification.snapshot, timestamp),
    submissionInsertStatement(env, {
      id: submissionId,
      serverId: owned.id,
      ownerAccountId: session.account.id,
      contact: submitterContact(session.account),
      verificationEvidence: storedSubmissionVerificationEvidence(
        input.verification,
        input.name,
        owned.submission_verification_evidence
      ),
      input,
      moderationNotes: null,
      createdAt: timestamp
    }),
    ...verificationConsumptionStatements(env, input, timestamp),
    resubmissionEventStatement(env, owned.id, keepsApproval, timestamp),
    ...(keepsApproval
      ? [discordEmbedJobStatement(env, owned.id, "upsert", timestamp)]
      : [
        discordReviewNotificationJobStatement(
          env,
          owned.id,
          submissionId,
          "resubmitted",
          timestamp
        )
      ])
  ]);

  if (keepsApproval) {
    scheduleDiscordEmbedProcessing(env, ctx);
  } else {
    scheduleDiscordReviewNotificationProcessing(env, ctx);
  }

  const refreshed = await getOwnedServerRow(env, session.account.id);

  return json(
    {
      ok: true,
      id: owned.id,
      status: keepsApproval ? "approved" : "pending",
      item: refreshed ? toOwnerServer(refreshed) : null
    },
    keepsApproval ? 200 : 202,
    NO_STORE_JSON_HEADERS
  );
}

async function updateMyPublicDetails(
  request: Request,
  env: DirectoryEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json(
      { error: "You do not have a server listing to update." },
      404,
      NO_STORE_JSON_HEADERS
    );
  }

  if (owned.status !== "approved") {
    return json(
      { error: "Only approved listings can save public details without a new review." },
      409,
      NO_STORE_JSON_HEADERS
    );
  }

  const body = await readJsonObject(request);
  const details = parsePublicDetailsInput(body, owned.name);

  if (publicDetailsMatch(owned, details)) {
    return json(
      { ok: true, unchanged: true, item: toOwnerServer(owned) },
      200,
      NO_STORE_JSON_HEADERS
    );
  }

  const mutationRateLimit = await publicDetailsMutationRateLimit(session.account.id, env);

  if (!mutationRateLimit.ok) {
    return rateLimitResponse(mutationRateLimit.error);
  }

  const timestamp = nowIso();

  await runD1Batch(
    env,
    publicDetailsStatements(env, {
      details,
      serverId: owned.id,
      accountId: session.account.id,
      timestamp
    })
  );

  scheduleDiscordEmbedProcessing(env, ctx);

  const refreshed = await getOwnedServerRow(env, session.account.id);

  return json(
    { ok: true, item: refreshed ? toOwnerServer(refreshed) : null },
    200,
    NO_STORE_JSON_HEADERS
  );
}

async function deleteMyServer(
  request: Request,
  env: DirectoryEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json(
      { error: "You do not have a server listing to delete." },
      404,
      NO_STORE_JSON_HEADERS
    );
  }

  const timestamp = nowIso();
  const reviewSnapshot = await getDiscordReviewDeletionSnapshot(env, owned.id);
  const statements = ownerDeletionStatements(env, {
    owned,
    accountId: session.account.id,
    timestamp,
    reviewSnapshot
  });

  await runD1Batch(env, statements);
  scheduleDiscordDeliveryProcessing(env, ctx);

  return json({ ok: true, id: owned.id, deleted: true }, 200, NO_STORE_JSON_HEADERS);
}

async function parseSubmissionInput(
  request: Request,
  env: DirectoryEnv,
  body: Record<string, unknown>,
  ownerAccountId: string,
  verificationPolicy: { verificationRequired?: boolean; verifiedAfter?: string | null } = {}
): Promise<SubmissionInput> {
  if (env.APP_ENVIRONMENT !== "local" && (!env.TURNSTILE_SECRET || !env.RATE_LIMIT_SALT)) {
    logError("submission.missing_required_secrets");

    throw new ApiError(503, "Server submissions are temporarily unavailable.");
  }

  const turnstileToken = stringField(body, "turnstileToken", 2048);
  const ip = request.headers.get("cf-connecting-ip") ?? (env.APP_ENVIRONMENT === "local" ? "127.0.0.1" : "");
  const userAgent = request.headers.get("user-agent") ?? "";
  const name = stringField(body, "name", 80);
  const address = stringField(body, "address", 255);
  const port = parsePortField(body.port);
  const description = stringField(body, "description", SUBMISSION_DESCRIPTION_MAX_LENGTH);
  const verificationChallengeId = stringField(body, "verificationChallengeId", 64);
  const websiteValue = stringField(body, "websiteUrl", 255, false);
  const websiteUrl = normalizeWebsiteInput(websiteValue);
  const socialLinks = parseSocialLinks(body.socialLinks);
  const normalized = normalizeAddress(address, port);

  validateListingNameAndDescription(name, description);

  if (!normalized.ok) {
    throw new ApiError(400, normalized.error);
  }

  if (websiteValue && !websiteUrl) {
    throw new ApiError(400, "Website must be a public domain or HTTP/HTTPS URL.");
  }

  if (!ip) {
    logError("submission.missing_cf_connecting_ip");

    throw new ApiError(503, "Server submissions are temporarily unavailable.");
  }

  const rateLimitSalt = env.RATE_LIMIT_SALT ?? "local-development-rate-limit-salt";
  const ipHash = await sha256(`${rateLimitSalt}:${ip}`);
  const userAgentHash = await sha256(`${rateLimitSalt}:${userAgent}`);

  await enforceSubmissionQuota(env, ownerAccountId, ipHash);

  const turnstile = await validateTurnstile(turnstileToken, ip, env);

  if (!turnstile.success) {
    throw new ApiError(400, "Turnstile verification failed.");
  }

  const verification =
    verificationPolicy.verificationRequired === false
      ? null
      : await requireVerifiedChallenge(
        env,
        verificationChallengeId,
        ownerAccountId,
        normalized.host,
        normalized.port,
        verificationPolicy.verifiedAfter ?? null
      );

  return {
    name: name.trim(),
    address,
    description: description.trim(),
    websiteUrl,
    socialLinks,
    normalized,
    verification,
    turnstile,
    ipHash,
    userAgentHash
  };
}

function conflictingAddressResponse(row: { status: ServerState } | null): Response | null {
  const error =
    row?.status === "pending"
      ? "This server already has a pending submission."
      : row?.status === "approved"
        ? "This server is already listed."
        : row?.status === "suspended"
          ? "This server is suspended. Contact staff before submitting it again."
          : null;

  return error ? json({ error }, 409) : null;
}

async function verifyReachableServer(
  address: string,
  failureEvent: string,
  offlineMessage: string
): Promise<{ ok: true; snapshot: StatusSnapshot } | { ok: false; response: Response }> {
  let snapshot: StatusSnapshot;

  try {
    snapshot = await fetchServerStatus(address);
  } catch (error) {
    logError(failureEvent, error, { address });

    return {
      ok: false,
      response: json(
        { error: "Server status verification is temporarily unavailable." },
        503,
        NO_STORE_JSON_HEADERS
      )
    };
  }

  return snapshot.online
    ? { ok: true, snapshot }
    : { ok: false, response: json({ error: offlineMessage }, 400) };
}

async function autoSuspendSubmission(
  env: DirectoryEnv,
  account: SubmitterAccount,
  input: SubmissionInput,
  existing: { id: string; slug: string; status: ServerState; updated_at: string } | null,
  reason: string | null
): Promise<Response> {
  const id = existing?.id ?? crypto.randomUUID();
  const slug =
    existing?.slug ??
    `${slugify(input.name)}-${(await sha256(`${input.normalized.host}:${input.normalized.port}`)).slice(0, 8)}`;
  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  const notes = reason || "This server address is suspended by staff.";
  const serverMutation = autoSuspendServerStatement(env, {
    existing,
    id,
    slug,
    accountId: account.id,
    submission: input,
    timestamp
  });

  await runD1Batch(
    env,
    autoSuspensionStatements(env, {
      serverMutation,
      serverId: id,
      submissionId,
      account,
      input,
      verificationEvidence: storedSubmissionVerificationEvidence(input.verification, input.name),
      notes,
      eventNotes: `Auto-suspended fresh submission for a suspended address. ${notes}`,
      timestamp
    })
  );

  const refreshed = await getOwnedServerRow(env, account.id);

  return json(
    { ok: true, id, slug, status: "suspended", item: refreshed ? toOwnerServer(refreshed) : null },
    202,
    NO_STORE_JSON_HEADERS
  );
}

async function autoSuspendOwnedSubmission(
  env: DirectoryEnv,
  account: SubmitterAccount,
  owned: AdminServerRow,
  input: SubmissionInput,
  reason: string | null
): Promise<Response> {
  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  const notes = reason || "This server address is suspended by staff.";
  const serverMutation = autoSuspendOwnedServerStatement(env, input, owned, account.id, timestamp);

  await runD1Batch(
    env,
    autoSuspensionStatements(env, {
      serverMutation,
      serverId: owned.id,
      submissionId,
      account,
      input,
      verificationEvidence: storedSubmissionVerificationEvidence(
        input.verification,
        input.name,
        owned.submission_verification_evidence
      ),
      notes,
      eventNotes: `Auto-suspended resubmission for a suspended address. ${notes}`,
      timestamp
    })
  );

  const refreshed = await getOwnedServerRow(env, account.id);

  return json(
    {
      ok: true,
      id: owned.id,
      status: "suspended",
      item: refreshed ? toOwnerServer(refreshed) : null
    },
    202,
    NO_STORE_JSON_HEADERS
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "server"
  );
}
