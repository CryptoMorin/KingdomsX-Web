import { NO_STORE_JSON_HEADERS, VERIFICATION_RATE_LIMIT_RETRY_SECONDS } from "../config";
import type { DirectoryEnv } from "../contracts";
import { sha256 } from "./crypto";
import { json } from "./http";

export type RateLimitResult = { ok: true } | { ok: false; error: string };

export async function clientHashes(
  request: Request,
  env: DirectoryEnv
): Promise<{ ip: string; ipHash: string; userAgentHash: string }> {
  const salt = env.RATE_LIMIT_SALT ?? "local-development-rate-limit-salt";
  const ip =
    (
      request.headers.get("cf-connecting-ip") ??
      (env.APP_ENVIRONMENT === "local" ? "127.0.0.1" : "unknown")
    )
      .trim()
      .slice(0, 64) || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "";

  return {
    ip,
    ipHash: await clientIpHash(ip, env),
    userAgentHash: await sha256(`${salt}:${userAgent}`)
  };
}

export async function clientIpHash(ip: string, env: DirectoryEnv): Promise<string> {
  return sha256(`${env.RATE_LIMIT_SALT ?? "local-development-rate-limit-salt"}:${ip}`);
}

export async function limitBinding(
  binding: RateLimit | undefined,
  key: string,
  error: string
): Promise<RateLimitResult> {
  // Missing rate limit bindings intentionally allow requests in local dev
  const outcome = await binding?.limit({ key });

  return (outcome?.success ?? true) ? { ok: true } : { ok: false, error };
}

export async function requestIpRateLimitKey(request: Request, env: DirectoryEnv): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    (env.APP_ENVIRONMENT === "local" ? "127.0.0.1" : "unknown");

  return clientIpHash(ip, env);
}

export async function requestIpRateLimit(
  request: Request,
  env: DirectoryEnv,
  binding: RateLimit | undefined,
  error: string
): Promise<RateLimitResult> {
  if (!binding)
    return { ok: true };

  return limitBinding(binding, await requestIpRateLimitKey(request, env), error);
}

export async function pluginVerifyRateLimit(
  request: Request,
  env: DirectoryEnv
): Promise<RateLimitResult> {
  const key = await requestIpRateLimitKey(request, env);
  const [perIp, perLocation] = await Promise.all([
    env.PLUGIN_VERIFY_RATE_LIMIT?.limit({ key }),
    env.PLUGIN_VERIFY_GLOBAL_RATE_LIMIT?.limit({ key: "plugin-verification" })
  ]);

  return (perIp?.success ?? true) && (perLocation?.success ?? true)
    ? { ok: true }
    : { ok: false, error: "Too many verification attempts. Try again later." };
}

export const verificationCreateRateLimit = (request: Request, env: DirectoryEnv) =>
  requestIpRateLimit(
    request,
    env,
    env.VERIFICATION_CREATE_RATE_LIMIT,
    "Too many verification requests. Try again later."
  );

export async function publicApiRateLimit(
  request: Request,
  env: DirectoryEnv
): Promise<RateLimitResult> {
  const key = await requestIpRateLimitKey(request, env);
  const [perIp, perLocation] = await Promise.all([
    env.PUBLIC_API_RATE_LIMIT?.limit({ key }),
    env.PUBLIC_API_LOCATION_RATE_LIMIT?.limit({ key: "public-server-api" })
  ]);

  return (perIp?.success ?? true) && (perLocation?.success ?? true)
    ? { ok: true }
    : { ok: false, error: "Too many server directory requests. Try again later." };
}

export const verificationCreateAccountRateLimit = (accountId: string, env: DirectoryEnv) =>
  limitBinding(
    env.VERIFICATION_CREATE_ACCOUNT_RATE_LIMIT,
    accountId,
    "Too many verification requests. Try again later."
  );
export const submitterReadRateLimit = (request: Request, env: DirectoryEnv) =>
  requestIpRateLimit(
    request,
    env,
    env.SUBMITTER_READ_RATE_LIMIT,
    "Too many account requests. Try again later."
  );
export const verificationStatusRateLimit = (request: Request, env: DirectoryEnv) =>
  requestIpRateLimit(
    request,
    env,
    env.VERIFICATION_STATUS_RATE_LIMIT,
    "Too many verification checks. Try again later."
  );
export const verificationStatusAccountRateLimit = (accountId: string, env: DirectoryEnv) =>
  limitBinding(
    env.VERIFICATION_STATUS_ACCOUNT_RATE_LIMIT,
    accountId,
    "Too many verification checks. Try again later."
  );
export const publicDetailsMutationRateLimit = (accountId: string, env: DirectoryEnv) =>
  limitBinding(
    env.PUBLIC_DETAILS_MUTATION_RATE_LIMIT,
    accountId,
    "Too many detail updates. Try again later."
  );
export const submissionMutationRateLimit = (accountId: string, env: DirectoryEnv) =>
  limitBinding(
    env.SUBMISSION_MUTATION_RATE_LIMIT,
    accountId,
    "Too many submission attempts. Try again later."
  );

export function rateLimitResponse(error: string): Response {
  const headers = new Headers(NO_STORE_JSON_HEADERS);

  headers.set("retry-after", String(VERIFICATION_RATE_LIMIT_RETRY_SECONDS));

  return json({ error }, 429, headers);
}

export const verificationRateLimitResponse = rateLimitResponse;
