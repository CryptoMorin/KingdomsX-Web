import {
  LOCAL_TURNSTILE_TEST_SECRET,
  SOCIAL_KEYS,
  SUBMISSION_DESCRIPTION_MAX_LENGTH,
  TURNSTILE_ACTION,
  TURNSTILE_HOSTNAME,
  TURNSTILE_TIMEOUT_MS
} from "../config";
import type { AdminServerRow, DirectoryEnv, SocialLink } from "../contracts";
import { ApiError, isRecord, stringField } from "../core/http";
import { logError } from "../core/runtime";
import { optionalUrl } from "../core/network-validation";
import { safeParseSocialLinks } from "../core/social-links";
import { validateListingNameAndDescription } from "../core/listing-fields";

export function parsePublicDetailsInput(
  body: Record<string, unknown>,
  currentName: string
): { name: string; description: string; websiteUrl: string | null; socialLinks: SocialLink[] } {
  const name = Object.hasOwn(body, "name") ? stringField(body, "name", 80) : currentName;
  const description = stringField(body, "description", SUBMISSION_DESCRIPTION_MAX_LENGTH);
  const websiteValue = stringField(body, "websiteUrl", 255, false);
  const websiteUrl = normalizeWebsiteInput(websiteValue);
  const socialLinks = parseSocialLinks(body.socialLinks);

  validateListingNameAndDescription(name, description);

  if (websiteValue && !websiteUrl) {
    throw new ApiError(400, "Website must be a public domain or HTTP/HTTPS URL.");
  }

  return {
    name,
    description: description.trim(),
    websiteUrl,
    socialLinks
  };
}

export function publicDetailsMatch(
  owned: AdminServerRow,
  details: {
    name: string;
    description: string;
    websiteUrl: string | null;
    socialLinks: SocialLink[];
  }
): boolean {
  return (
    owned.name === details.name &&
    owned.description === details.description &&
    owned.website_url === details.websiteUrl &&
    comparableSocialLinks(safeParseSocialLinks(owned.social_links_json)) ===
      comparableSocialLinks(details.socialLinks)
  );
}

function comparableSocialLinks(links: Array<{ key?: string; url: string }>): string {
  return JSON.stringify(
    links
      .map((link) => ({ key: link.key ?? "", url: link.url }))
      .sort(
        (left, right) => left.key.localeCompare(right.key) || left.url.localeCompare(right.url)
      )
  );
}

export async function validateTurnstile(
  token: string,
  ip: string,
  env: DirectoryEnv
): Promise<Record<string, unknown> & { success: boolean }> {
  const secret = env.TURNSTILE_SECRET || (isLocalEnvironment(env) ? LOCAL_TURNSTILE_TEST_SECRET : "");

  if (!secret) {
    return { success: false, reason: "missing-secret" };
  }

  const form = new FormData();

  form.set("secret", secret);
  form.set("response", token);
  form.set("idempotency_key", crypto.randomUUID());

  if (ip) {
    form.set("remoteip", ip);
  }

  let response: Response;

  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
    });
  } catch (error) {
    logError("turnstile.siteverify_request_failed", error);

    throw new ApiError(503, "Submission verification is temporarily unavailable.");
  }

  if (!response.ok) {
    logError("turnstile.siteverify_bad_status", undefined, { status: response.status });

    throw new ApiError(503, "Submission verification is temporarily unavailable.");
  }

  const result = await response.json<Record<string, unknown>>();
  const hostname = typeof result.hostname === "string" ? result.hostname : undefined;
  const action = typeof result.action === "string" ? result.action : undefined;
  const validHostname = isLocalEnvironment(env) || hostname === TURNSTILE_HOSTNAME;
  const validAction = action === TURNSTILE_ACTION || (isLocalEnvironment(env) && (!action || action === "test"));

  return {
    success: result.success === true && validHostname && validAction,
    challenge_ts: typeof result.challenge_ts === "string" ? result.challenge_ts : undefined,
    hostname,
    action,
    "error-codes": Array.isArray(result["error-codes"])
      ? result["error-codes"]
        .filter((value): value is string => typeof value === "string")
        .slice(0, 10)
      : undefined
  };
}

export function parseSocialLinks(value: unknown): SocialLink[] {
  if (!isRecord(value)) {
    return [];
  }

  return SOCIAL_KEYS.flatMap((key) => {
    const rawValue = typeof value[key] === "string" ? value[key].trim() : "";
    const url = normalizeSocialInput(key, rawValue);

    if (rawValue && !url) {
      throw new ApiError(
        400,
        `${socialLabel(key)} must be a public URL or supported username/invite shorthand.`
      );
    }

    if (!url) {
      return [];
    }

    return [
      { key, label: socialLabel(key), url, host: new URL(url).hostname.replace(/^www\./, "") }
    ];
  });
}

export function normalizeWebsiteInput(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const direct = optionalUrl(trimmed);

  if (direct) {
    return direct;
  }

  return normalizePublicDomainInput(trimmed);
}

function normalizeSocialInput(key: (typeof SOCIAL_KEYS)[number], value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const direct = optionalUrl(trimmed);

  if (direct) {
    return direct;
  }

  const publicDomainUrl = normalizePublicDomainInput(trimmed);

  if (publicDomainUrl) {
    return publicDomainUrl;
  }

  if (key === "discord") {
    const code = trimmed
      .replace(/^discord(?:\.gg|\.com\/invite)\//i, "")
      .replace(/^invite\//i, "")
      .trim();

    return /^[a-z0-9_-]{2,100}$/i.test(code) ? `https://discord.gg/${code}` : null;
  }

  const handle = trimmed.replace(/^@/, "");
  const platformUrl = {
    facebook: "https://facebook.com/",
    instagram: "https://instagram.com/",
    x: "https://x.com/",
    youtube: "https://youtube.com/@",
    tiktok: "https://tiktok.com/@",
    twitch: "https://twitch.tv/"
  }[key];

  if (!platformUrl) {
    return null;
  }

  if (key === "facebook" && /^[a-z0-9.]{5,80}$/i.test(handle)) {
    return `${platformUrl}${handle}`;
  }

  if (key === "instagram" && /^[a-z0-9._]{1,30}$/i.test(handle)) {
    return `${platformUrl}${handle}`;
  }

  if (key === "x" && /^[a-z0-9_]{1,15}$/i.test(handle)) {
    return `${platformUrl}${handle}`;
  }

  if (key === "youtube" && /^[a-z0-9._-]{3,100}$/i.test(handle)) {
    return `${platformUrl}${handle.replace(/^@/, "")}`;
  }

  if (key === "tiktok" && /^[a-z0-9._]{2,24}$/i.test(handle)) {
    return `${platformUrl}${handle}`;
  }

  if (key === "twitch" && /^[a-z0-9_]{4,25}$/i.test(handle)) {
    return `${platformUrl}${handle}`;
  }

  return null;
}

function normalizePublicDomainInput(value: string): string | null {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?(?:\/[^\s]*)?$/i.test(
    value
  )
    ? optionalUrl(`https://${value}`)
    : null;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function socialLabel(value: string): string {
  if (value === "x") {
    return "Twitter/X";
  }

  if (value === "youtube") {
    return "YouTube";
  }

  if (value === "tiktok") {
    return "TikTok";
  }

  return titleCase(value);
}

function isLocalEnvironment(env: DirectoryEnv): boolean {
  return env.APP_ENVIRONMENT === "local";
}
