import {
  NO_STORE_JSON_HEADERS,
  VERIFICATION_CODE_ALPHABET,
  VERIFICATION_CODE_GROUP_LENGTH,
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_CODE_RANDOM_BUCKET,
  VERIFICATION_PROOF_TTL_MS
} from "../config";
import type {
  DirectoryEnv,
  PluginVerifyStatus,
  SubmissionInput,
  VerificationChallengeRow,
  VerificationChallengeStatus,
  VerifiedChallenge
} from "../contracts";
import { bytesToHex, hmacSha256 } from "../core/crypto";
import { ApiError, json } from "../core/http";
import { nowIso } from "../core/runtime";
import { consumeVerificationChallengeStatement, getChallengeForOwner } from "./challenge-storage";

export function normalizeVerificationCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(normalized) ? normalized : null;
}

export async function verificationCodeForChallenge(
  challengeId: string,
  env: DirectoryEnv
): Promise<string> {
  const secret = requiredVerificationCodeSecret(env);
  let characters = "";
  let counter = 0;

  while (characters.length < VERIFICATION_CODE_LENGTH) {
    const bytes = await hmacSha256(secret, `server-verification-code:${challengeId}:${counter}`);

    counter += 1;

    for (const byte of bytes) {
      // Skip the uneven tail to give every character the same chance of being picked
      if (byte >= VERIFICATION_CODE_RANDOM_BUCKET)
        continue;

      characters += VERIFICATION_CODE_ALPHABET[byte % VERIFICATION_CODE_ALPHABET.length];

      if (characters.length === VERIFICATION_CODE_LENGTH)
        break;
    }
  }

  return `${characters.slice(0, VERIFICATION_CODE_GROUP_LENGTH)}-${characters.slice(VERIFICATION_CODE_GROUP_LENGTH)}`;
}

export async function verificationCodeHash(code: string, env: DirectoryEnv): Promise<string> {
  const normalizedCode = normalizeVerificationCode(code) ?? code;
  const hash = await hmacSha256(
    requiredVerificationCodeSecret(env),
    `server-verification-hash:${normalizedCode}`
  );

  return bytesToHex(hash);
}

function requiredVerificationCodeSecret(env: DirectoryEnv): string {
  if (!env.VERIFICATION_CODE_SECRET)
    throw new ApiError(503, "Server verification is temporarily unavailable.");

  return env.VERIFICATION_CODE_SECRET;
}

export async function requireVerifiedChallenge(
  env: DirectoryEnv,
  id: string,
  ownerAccountId: string,
  host: string,
  port: number,
  verifiedAfter: string | null = null
): Promise<VerifiedChallenge> {
  if (!isUuidLike(id))
    throw new ApiError(400, "Run the in-game verification command before submitting.");

  const row = await getChallengeForOwner(env, id, ownerAccountId);

  if (!row)
    throw new ApiError(400, "Run the in-game verification command before submitting.");

  if (row.normalized_host !== host || row.port !== port)
    throw new ApiError(
      400,
      "Verification does not match this server address or port. Generate a new code."
    );

  const status = verificationChallengeStatus(row, nowIso());

  if (status !== "verified" || !row.verified_at)
    throw new ApiError(400, "Run the in-game verification command before submitting.");

  if (verifiedAfter && row.verified_at <= verifiedAfter)
    throw new ApiError(
      400,
      "Verify your server again after the latest staff rejection before resubmitting."
    );

  return { ...row, status: "verified", verified_at: row.verified_at };
}

export function verificationConsumptionStatements(
  env: DirectoryEnv,
  input: SubmissionInput,
  timestamp: string
): D1PreparedStatement[] {
  return input.verification
    ? [consumeVerificationChallengeStatement(env, input.verification.id, timestamp)]
    : [];
}

export function storedSubmissionVerificationEvidence(
  challenge: VerifiedChallenge | null,
  serverName: string,
  previousEvidence: string | null = null
): string {
  // Resubmissions without fresh proof still need the original verification evidence for staff
  if (!challenge) {
    if (previousEvidence)
      return previousEvidence;

    throw new ApiError(
      409,
      "Previous verification evidence is unavailable. Verify your server again before resubmitting."
    );
  }

  return [
    `Verified: ${challenge.verified_at}`,
    `Verification IP: ${challenge.callback_ip || "not available"}`,
    `Server name: ${serverName}`,
    `Address: ${challenge.normalized_host}:${challenge.port}`,
    `Plugin version: ${challenge.plugin_version || "not provided"}`,
    `Server software: ${challenge.server_software || "not provided"}`,
    `Minecraft version: ${challenge.minecraft_version || "not provided"}`
  ]
    .join("\n")
    .slice(0, 12000);
}

export function verificationChallengeCreatedResponse(input: {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  address: string;
  reused: boolean;
}): Response {
  return json(
    {
      ok: true,
      reused: input.reused,
      id: input.id,
      code: input.code,
      command: `/k admin verify ${input.code}`,
      status: "pending",
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      address: input.address
    },
    input.reused ? 200 : 201,
    NO_STORE_JSON_HEADERS
  );
}

export function pluginVerifyErrorResponse(
  statusValue: Exclude<PluginVerifyStatus, "verified">,
  message: string,
  status: number,
  extraHeaders: HeadersInit = {}
): Response {
  const headers = new Headers(NO_STORE_JSON_HEADERS);

  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));

  return json({ ok: false, status: statusValue, message }, status, headers);
}

export function invalidVerificationCodeResponse(): Response {
  return pluginVerifyErrorResponse("unknown_code", "Verification code is invalid or expired.", 404);
}

export function verificationProofExpiresAt(
  value: VerificationChallengeRow | string
): string | null {
  const verifiedAt = typeof value === "string" ? value : value.verified_at;
  const verifiedAtMs = verifiedAt ? new Date(verifiedAt).getTime() : Number.NaN;

  return Number.isFinite(verifiedAtMs)
    ? new Date(verifiedAtMs + VERIFICATION_PROOF_TTL_MS).toISOString()
    : null;
}

export function verificationChallengeStatus(
  row: VerificationChallengeRow,
  timestamp = nowIso()
): VerificationChallengeStatus {
  if (row.status === "pending" && row.expires_at <= timestamp)
    return "expired";

  if (row.status === "verified") {
    const expiresAt = verificationProofExpiresAt(row);

    if (!expiresAt || expiresAt <= timestamp)
      return "expired";
  }

  return row.status;
}

export function publicVerificationChallenge(row: VerificationChallengeRow) {
  return {
    id: row.id,
    status: verificationChallengeStatus(row),
    name: row.server_name,
    address: row.port === 25565 ? row.normalized_host : `${row.normalized_host}:${row.port}`,
    host: row.normalized_host,
    port: row.port,
    createdAt: row.created_at,
    expiresAt: row.status === "verified" ? verificationProofExpiresAt(row) : row.expires_at,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at,
    plugin: row.verified_at
      ? {
        version: row.plugin_version,
        serverSoftware: row.server_software,
        minecraftVersion: row.minecraft_version
      }
      : null
  };
}

export function pluginCallbackPayload(body: Record<string, unknown>): {
  pluginVersion: string | null;
  serverSoftware: string | null;
  minecraftVersion: string | null;
} {
  return {
    pluginVersion: callbackTextField(body, "pluginVersion", 80),
    serverSoftware: callbackTextField(body, "serverSoftware", 80),
    minecraftVersion: callbackTextField(body, "minecraftVersion", 80)
  };
}

function callbackTextField(
  body: Record<string, unknown>,
  key: string,
  maxLength: number
): string | null {
  if (typeof body[key] !== "string")
    return null;

  const value = body[key]
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (value.length > maxLength)
    throw new ApiError(400, `${key} is too long.`);

  return value || null;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
