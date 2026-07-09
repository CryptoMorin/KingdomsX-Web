export interface DirectoryEnv {
  DB: D1Database;
  APP_ENVIRONMENT: "local" | "production";
  PLUGIN_VERIFY_RATE_LIMIT?: RateLimit;
  PLUGIN_VERIFY_GLOBAL_RATE_LIMIT?: RateLimit;
  VERIFICATION_CREATE_RATE_LIMIT?: RateLimit;
  PUBLIC_API_RATE_LIMIT?: RateLimit;
  PUBLIC_API_LOCATION_RATE_LIMIT?: RateLimit;
  VERIFICATION_CREATE_ACCOUNT_RATE_LIMIT?: RateLimit;
  SUBMITTER_READ_RATE_LIMIT?: RateLimit;
  VERIFICATION_STATUS_RATE_LIMIT?: RateLimit;
  VERIFICATION_STATUS_ACCOUNT_RATE_LIMIT?: RateLimit;
  PUBLIC_DETAILS_MUTATION_RATE_LIMIT?: RateLimit;
  SUBMISSION_MUTATION_RATE_LIMIT?: RateLimit;
  TURNSTILE_SECRET?: string;
  RATE_LIMIT_SALT?: string;
  VERIFICATION_CODE_SECRET?: string;
  SESSION_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_REDIRECT_URI?: string;
  LOCAL_ADMIN_TOKEN?: string;
  ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DISCORD_SERVER_DIRECTORY_WEBHOOK_URL?: string;
  DISCORD_SERVER_REVIEW_WEBHOOK_URL?: string;
}

export interface DirectoryRequestContext {
  request: Request;
  url: URL;
  env: DirectoryEnv;
  executionCtx?: ExecutionContext;
}

export type ServerState = "pending" | "approved" | "rejected" | "suspended" | "hidden_offline";
export type VerificationChallengeStatus = "pending" | "verified" | "consumed" | "expired";
export type RejectionReasonCode =
  | "server_unreachable"
  | "kingdomsx_not_verified"
  | "public_details_incomplete"
  | "inappropriate_or_unsafe";
export type PublicStatusFilter = "all" | "online" | "offline";
export type PublicSort = "newest" | "players" | "name";
export type AdminSort = "newest" | "oldest" | "name" | "online" | "updated";
export type PluginVerifyStatus =
  | "verified"
  | "already_verified"
  | "invalid_request"
  | "unknown_code"
  | "payload_too_large"
  | "rate_limited"
  | "service_unavailable"
  | "internal_error";

export interface ServerRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  normalized_host: string;
  port: number;
  website_url: string | null;
  social_links_json: string;
  status: ServerState;
  approved_at: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
  online: number | null;
  players_online: number | null;
  players_max: number | null;
  motd_text: string | null;
  version_name: string | null;
  favicon_url_or_hash: string | null;
  checked_at: string | null;
  provider: string | null;
  failure_count: number | null;
  offline_since: string | null;
  refresh_attempted_at: string | null;
  refresh_error: string | null;
}

export interface PublicServerRow extends ServerRow {
  owner_username: string | null;
  owner_global_name: string | null;
}

export interface AdminServerRow extends PublicServerRow {
  submission_contact: string | null;
  submission_verification_evidence: string | null;
  submission_moderation_notes: string | null;
  submission_created_at: string | null;
  owner_discord_user_id: string | null;
  owner_avatar_hash: string | null;
  review_event_action: string | null;
  review_event_created_at: string | null;
  review_event_reason_code: string | null;
  discord_message_id: string | null;
  discord_synced_version: string | null;
  discord_synced_at: string | null;
  discord_job_action: "upsert" | "delete" | null;
  discord_job_attempt_count: number | null;
  discord_job_last_error_code: string | null;
  discord_job_last_error: string | null;
}

export interface DiscordServerRow extends ServerRow {
  owner_discord_user_id: string | null;
}

export interface DiscordEmbedJob {
  server_id: string;
  desired_action: "upsert" | "delete";
  desired_version: string;
  attempt_count: number;
}

export interface DiscordReviewNotificationJob {
  server_id: string;
  submission_id: string;
  notification_type: "submitted" | "resubmitted";
  desired_status: ServerState;
  desired_version: string;
  attempt_count: number;
}

export interface DiscordReviewNotification {
  message_id: string;
  superseded_message_id: string | null;
  synced_at: string;
}

export interface DiscordReviewDeletionJob {
  server_id: string;
  message_id: string;
  payload_json: string;
  replace_message: number;
  superseded_message_id: string | null;
  attempt_count: number;
}

export interface DiscordReviewSubmissionRow extends DiscordServerRow {
  submission_id: string;
  submission_created_at: string;
  submission_verification_evidence: string | null;
  submission_moderation_notes: string | null;
  public_discord_message_id: string | null;
  public_discord_guild_id: string | null;
  public_discord_channel_id: string | null;
}

export interface DiscordReviewDeletionSnapshot extends DiscordReviewSubmissionRow {
  review_message_id: string;
  review_notification_type: "submitted" | "resubmitted";
  review_synced_at: string;
}

export interface DiscordEmbedRecord {
  message_id: string;
  guild_id: string | null;
  channel_id: string | null;
  superseded_message_id: string | null;
  synced_at: string;
}

export interface SuspendedAddressRow {
  normalized_host: string;
  port: number;
  reason: string | null;
  suspended_at: string;
}

export interface SocialLink {
  key: string;
  label: string;
  url: string;
  host: string;
}

export interface VerificationChallengeRow {
  id: string;
  owner_account_id: string;
  server_name: string;
  normalized_host: string;
  port: number;
  status: VerificationChallengeStatus;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  plugin_version: string | null;
  server_software: string | null;
  minecraft_version: string | null;
  callback_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingVerificationChallengeRow extends VerificationChallengeRow {
  code_hash: string;
}

export interface VerifiedChallenge extends VerificationChallengeRow {
  status: "verified";
  verified_at: string;
}

export interface SubmissionInput {
  name: string;
  address: string;
  description: string;
  websiteUrl: string | null;
  socialLinks: SocialLink[];
  normalized: { host: string; port: number; address: string };
  verification: VerifiedChallenge | null;
  turnstile: Record<string, unknown> & { success: boolean };
  ipHash: string;
  userAgentHash: string;
}

// (╯°□°）╯︵ ┻━┻
