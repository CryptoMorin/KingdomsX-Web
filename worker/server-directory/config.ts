import type { RejectionReasonCode } from "./contracts";

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
};
export const NO_STORE_JSON_HEADERS = { ...JSON_HEADERS, "cache-control": "no-store" };
export const PUBLIC_JSON_CACHE_SECONDS = 120;
export const PUBLIC_DIRECTORY_MAX_PAGE = 100;
export const PUBLIC_DIRECTORY_LIMITS = [8, 16, 32] as const;
export const RECENT_SERVER_LIMITS = [4, 8, 12] as const;
export const PUBLIC_JSON_HEADERS = {
  ...JSON_HEADERS,
  "cache-control": `public, max-age=${PUBLIC_JSON_CACHE_SECONDS}, stale-while-revalidate=300`,
  "access-control-allow-origin": "*"
};

export const SOCIAL_KEYS = [
  "discord",
  "facebook",
  "instagram",
  "x",
  "youtube",
  "tiktok",
  "twitch"
] as const;
export const MAX_JSON_BODY_BYTES = 20_000;
export const PLUGIN_VERIFY_MAX_JSON_BODY_BYTES = 4_096;
export const PLUGIN_API_VERSION = 1;
export const PLUGIN_VERIFY_PATH = `/api/v${PLUGIN_API_VERSION}/plugin/verify`;
export const STATUS_REFRESH_BATCH_LIMIT = 12;
export const STATUS_REFRESH_CONCURRENCY = 5;
export const STATUS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const STATUS_STALE_AFTER_MS = 30 * 60 * 1000;
export const TURNSTILE_TIMEOUT_MS = 8_000;
export const TURNSTILE_ACTION = "server-submit";
export const TURNSTILE_HOSTNAME = "servers.kingdomsx.com";
export const LOCAL_TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
export const SUBMISSION_DESCRIPTION_MAX_LENGTH = 240;
export const DISCORD_API_TIMEOUT_MS = 8_000;
export const DISCORD_JOB_BATCH_LIMIT = 4;
export const DISCORD_JOB_MAX_ATTEMPTS = 8;
export const DISCORD_LEASE_MS = 60_000;
export const DISCORD_ADMIN_MESSAGE_REPOST_AFTER_MS = 24 * 60 * 60 * 1000;
export const DISCORD_PUBLIC_MESSAGE_REPOST_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const DISCORD_EMBED_CRON = "1-56/5 * * * *";
export const VERIFICATION_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const VERIFICATION_PROOF_TTL_MS = 48 * 60 * 60 * 1000;
const REJECTION_REASON_CODES: RejectionReasonCode[] = [
  "server_unreachable",
  "kingdomsx_not_verified",
  "public_details_incomplete",
  "inappropriate_or_unsafe"
];
const REJECTION_REVERIFICATION_EXEMPT_REASON_CODES = new Set<RejectionReasonCode>([
  "public_details_incomplete",
  "inappropriate_or_unsafe"
]);

export function isRejectionReasonCode(value: string | null): value is RejectionReasonCode {
  return REJECTION_REASON_CODES.includes(value as RejectionReasonCode);
}

export function rejectionRequiresReverification(value: string | null): boolean {
  return !isRejectionReasonCode(value) || !REJECTION_REVERIFICATION_EXEMPT_REASON_CODES.has(value);
}
export const VERIFICATION_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const VERIFICATION_CODE_LENGTH = 8;
export const VERIFICATION_CODE_GROUP_LENGTH = 4;
export const VERIFICATION_CODE_RANDOM_BUCKET = Math.floor(256 / VERIFICATION_CODE_ALPHABET.length) * VERIFICATION_CODE_ALPHABET.length;
export const VERIFICATION_GENERATION_ACCOUNT_LIMIT_PER_HOUR = 5;
export const VERIFICATION_GENERATION_IP_LIMIT_PER_HOUR = 20;
export const VERIFICATION_CLEANUP_BATCH_LIMIT = 50;
export const VERIFICATION_STALE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const VERIFICATION_CONSUMED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const VERIFICATION_RATE_LIMIT_RETRY_SECONDS = 60;
export const SUBMISSION_ACCOUNT_LIMIT_PER_DAY = 3;
export const SUBMISSION_IP_LIMIT_PER_DAY = 3;
export const SUBMITTER_SESSION_CLEANUP_BATCH_LIMIT = 50;
export const SUBMITTER_SESSION_MAX_ACTIVE_PER_ACCOUNT = 5;
export const DISCORD_API_BASE = "https://discord.com/api/v10";
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_OAUTH_SCOPE = "identify guilds.members.read";
export const OAUTH_STATE_COOKIE = "kingdomsx_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "kingdomsx_oauth_verifier";
export const OAUTH_RETURN_COOKIE = "kingdomsx_oauth_return";
export const SUBMITTER_SESSION_COOKIE = "kingdomsx_submit_session";
export const LOCAL_SUBMITTER_RETURN_PATH = "/servers/submit";
export const SERVER_SUBDOMAIN_SUBMITTER_RETURN_PATH = "/submit";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const SUBMITTER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SUBMITTER_SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const PUBLIC_DIRECTORY_ORDER = "s.approved_at DESC, s.created_at DESC, s.id ASC";
export const HOMEPAGE_DIRECTORY_ORDER = "COALESCE(ss.players_online, 0) DESC, COALESCE(ss.online, 0) DESC, s.approved_at DESC, s.created_at DESC, s.id ASC";
export const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^198\.18\./,
  /^198\.19\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^224\./,
  /^240\./
];
