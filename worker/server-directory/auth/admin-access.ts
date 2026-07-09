import { TURNSTILE_TIMEOUT_MS } from "../config";
import type { DirectoryEnv } from "../contracts";
import { secureCompareString } from "../core/crypto";
import { isRecord } from "../core/http";
import { logError } from "../core/runtime";

export interface AccessJwtPayload {
  aud: string | string[];
  email: string;
  exp: number;
  iss: string;
  nbf?: number;
}

export interface AccessJwk extends JsonWebKey {
  kid?: string;
}

export async function requireAdmin(
  request: Request,
  env: DirectoryEnv
): Promise<{ ok: true; actor: string } | { ok: false; error: string }> {
  if (env.APP_ENVIRONMENT === "local") {
    return (await secureCompareString(
      env.LOCAL_ADMIN_TOKEN ?? "",
      request.headers.get("x-admin-token") ?? ""
    ))
      ? { ok: true, actor: "local-admin" }
      : { ok: false, error: "Local admin token is required." };
  }

  const teamDomain = normalizeAccessTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? "");
  const audience = env.CF_ACCESS_AUD?.trim() ?? "";
  const assertion = request.headers.get("cf-access-jwt-assertion") ?? "";

  if (!teamDomain || !audience) {
    logError("access.missing_jwt_configuration");

    return { ok: false, error: "Admin access is not configured." };
  }

  if (!assertion)
    return { ok: false, error: "Admin endpoints require Cloudflare Access." };

  const payload = await verifyAccessJwt(assertion, teamDomain, audience);

  if (!payload)
    return { ok: false, error: "Cloudflare Access authentication is invalid." };

  const actor = payload.email;
  const accessEmail = request.headers.get("cf-access-authenticated-user-email") ?? "";

  if (accessEmail && accessEmail.toLowerCase() !== actor.toLowerCase())
    return { ok: false, error: "Cloudflare Access identity headers do not match." };

  const allowlist = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    logError("access.empty_admin_email_allowlist");

    return { ok: false, error: "Admin access is not configured." };
  }

  return allowlist.includes(actor.toLowerCase())
    ? { ok: true, actor }
    : { ok: false, error: "Admin email is not allowed." };
}

async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience: string
): Promise<AccessJwtPayload | null> {
  if (token.length > 16_384)
    return null;

  const parts = token.split(".");

  if (parts.length !== 3)
    return null;

  const headerData = decodeJwtObject(parts[0]);
  const payloadData = decodeJwtObject(parts[1]);

  if (
    !headerData ||
    headerData.alg !== "RS256" ||
    typeof headerData.kid !== "string" ||
    !headerData.kid ||
    !payloadData ||
    (typeof payloadData.aud !== "string" &&
      !(
        Array.isArray(payloadData.aud) &&
        payloadData.aud.every((value) => typeof value === "string")
      )) ||
    typeof payloadData.email !== "string" ||
    typeof payloadData.exp !== "number" ||
    typeof payloadData.iss !== "string" ||
    (payloadData.nbf !== undefined && typeof payloadData.nbf !== "number")
  )
    return null;

  const payload: AccessJwtPayload = {
    aud: payloadData.aud,
    email: payloadData.email,
    exp: payloadData.exp,
    iss: payloadData.iss,
    ...(typeof payloadData.nbf === "number" ? { nbf: payloadData.nbf } : {})
  };
  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://${teamDomain}`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

  if (
    payload.iss.replace(/\/$/, "") !== expectedIssuer ||
    !audiences.includes(audience) ||
    !payload.email ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now ||
    (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now + 60))
  )
    return null;

  try {
    // Cache Access public keys at the edge while still validating the full JWT on every request
    const response = await fetch(`${expectedIssuer}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      cf: { cacheTtl: 3600, cacheEverything: true }
    } as RequestInit);

    if (!response.ok) {
      logError("access.certs_bad_status", undefined, { status: response.status });

      return null;
    }

    const document = await response.json<{ keys?: AccessJwk[] }>();
    const key = document.keys?.find((candidate) => candidate.kid === headerData.kid);

    if (!key)
      return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    return (await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    ))
      ? payload
      : null;
  } catch (error) {
    logError("access.jwt_verification_failed", error);

    return null;
  }
}

function normalizeAccessTeamDomain(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(normalized) ? normalized : "";
}

function decodeJwtObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
