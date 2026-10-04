import {
  SUBMITTER_RETURN_PATH,
  SUBMITTER_SESSION_COOKIE,
  SUBMITTER_SESSION_TOUCH_INTERVAL_MS
} from "../config";
import type { DirectoryEnv } from "../contracts";
import { sha256 } from "../core/crypto";
import { runD1Batch, runD1Statement } from "../core/d1";
import { ApiError } from "../core/http";
import { logError, nowIso } from "../core/runtime";

export interface DiscordProfile {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface SubmitterAccount {
  id: string;
  discord_user_id: string;
  username: string;
  global_name: string | null;
  avatar_hash: string | null;
}

export interface SubmitterSession {
  account: SubmitterAccount;
  sessionHash: string;
}

export async function requireSubmitter(
  request: Request,
  env: DirectoryEnv
): Promise<{ ok: true; account: SubmitterAccount } | { ok: false; status: number; error: string }> {
  const session = await getSubmitterSession(request, env);

  return session
    ? { ok: true, account: session.account }
    : { ok: false, status: 401, error: "Sign in with Discord before submitting a server." };
}

export async function getSubmitterSession(
  request: Request,
  env: DirectoryEnv
): Promise<SubmitterSession | null> {
  if (!env.SESSION_SECRET) {
    if (env.APP_ENVIRONMENT !== "local") {
      logError("auth.missing_session_secret");
    }

    return null;
  }

  const token = parseCookies(request.headers.get("cookie") ?? "")[SUBMITTER_SESSION_COOKIE] ?? "";

  if (!isValidSessionToken(token)) {
    return null;
  }

  const sessionHash = await hashSessionToken(token, env);
  const row = await env.DB.prepare(
    `
    SELECT sess.session_hash, sess.last_seen_at, acc.id, acc.discord_user_id, acc.username, acc.global_name, acc.avatar_hash
    FROM submitter_sessions sess
    JOIN submitter_accounts acc ON acc.id = sess.account_id
    WHERE sess.session_hash = ? AND sess.expires_at > ?
    LIMIT 1
  `
  )
    .bind(sessionHash, nowIso())
    .first<{
      session_hash: string;
      last_seen_at: string;
      id: string;
      discord_user_id: string;
      username: string;
      global_name: string | null;
      avatar_hash: string | null;
    }>();

  if (!row) {
    return null;
  }

  // Touch sessions at most once per interval to avoid a D1 write on every poll
  const lastSeenAt = new Date(row.last_seen_at).getTime();

  if (
    !Number.isFinite(lastSeenAt) ||
    Date.now() - lastSeenAt > SUBMITTER_SESSION_TOUCH_INTERVAL_MS
  ) {
    await runD1Statement(
      env.DB.prepare("UPDATE submitter_sessions SET last_seen_at = ? WHERE session_hash = ?").bind(
        nowIso(),
        sessionHash
      )
    );
  }

  return {
    sessionHash,
    account: {
      id: row.id,
      discord_user_id: row.discord_user_id,
      username: row.username,
      global_name: row.global_name,
      avatar_hash: row.avatar_hash
    }
  };
}

export async function upsertSubmitterAccount(
  env: DirectoryEnv,
  profile: DiscordProfile
): Promise<SubmitterAccount> {
  const timestamp = nowIso();
  const existing = await env.DB.prepare("SELECT id FROM submitter_accounts WHERE discord_user_id = ?")
    .bind(profile.id)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();

  await runD1Statement(
    env.DB.prepare(
      `
    INSERT INTO submitter_accounts (id, discord_user_id, username, global_name, avatar_hash, guild_member_checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      username = excluded.username, global_name = excluded.global_name, avatar_hash = excluded.avatar_hash,
      guild_member_checked_at = excluded.guild_member_checked_at, updated_at = excluded.updated_at
  `
    ).bind(
      id,
      profile.id,
      profile.username,
      profile.global_name,
      profile.avatar,
      timestamp,
      timestamp,
      timestamp
    )
  );

  return {
    id,
    discord_user_id: profile.id,
    username: profile.username,
    global_name: profile.global_name,
    avatar_hash: profile.avatar
  };
}

export function toSubmitterUser(account: SubmitterAccount) {
  return {
    id: account.discord_user_id,
    username: account.username,
    displayName: account.global_name || account.username,
    avatarUrl: discordAvatarUrl(account)
  };
}

export function discordAvatarUrl(account: SubmitterAccount): string | null {
  if (!account.avatar_hash) {
    return null;
  }

  const extension = account.avatar_hash.startsWith("a_") ? "gif" : "png";

  return `https://cdn.discordapp.com/avatars/${account.discord_user_id}/${account.avatar_hash}.${extension}?size=80`;
}

export function submitterContact(account: SubmitterAccount): string {
  return `${account.global_name || account.username} (${account.discord_user_id})`;
}

export async function hashSessionToken(token: string, env: DirectoryEnv): Promise<string> {
  const secret = env.SESSION_SECRET ?? "";

  if (!secret) {
    throw new ApiError(503, "Discord login is not configured.");
  }

  return sha256(`${secret}:${token}`);
}

export function isValidSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{64}$/.test(value);
}

export function submitterReturnPath(value?: string | null): string {
  const path = safeReturnPath(value);

  if (!path) {
    return SUBMITTER_RETURN_PATH;
  }

  const url = new URL(path, "https://kingdomsx.local");

  return `${url.pathname}${url.search}${url.hash}`;
}

function safeReturnPath(value: string | null | undefined): string | null {
  const path = (value ?? "").trim();

  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/api/") ? path : null;
}

export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  header.split(";").forEach((part) => {
    const [name, ...rest] = part.trim().split("=");

    if (!name || rest.length === 0) {
      return;
    }

    try {
      cookies[name] = decodeURIComponent(rest.join("="));
    } catch {
      cookies[name] = rest.join("=");
    }
  });

  return cookies;
}

export function setCookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export function deleteCookie(request: Request, name: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export function expiredSessionCleanupStatement(
  env: DirectoryEnv,
  timestamp: string,
  limit: number
): D1PreparedStatement {
  return env.DB.prepare(
    `
    DELETE FROM submitter_sessions
    WHERE id IN (
      SELECT id FROM submitter_sessions
      WHERE expires_at <= ?
      ORDER BY expires_at ASC
      LIMIT ?
    )
  `
  ).bind(timestamp, limit);
}

export async function createSubmitterSession(
  env: DirectoryEnv,
  input: {
    accountId: string;
    sessionHash: string;
    expiresAt: string;
    createdAt: string;
    maxActive: number;
  }
): Promise<void> {
  // Create the session and trim older ones in one batch
  // Otherwise concurrent logins could bypass the active session limit
  await runD1Batch(env, [
    env.DB.prepare("INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      input.accountId,
      input.sessionHash,
      input.expiresAt,
      input.createdAt,
      input.createdAt
    ),
    env.DB.prepare(
      `
      DELETE FROM submitter_sessions
      WHERE account_id = ? AND id NOT IN (
        SELECT id FROM submitter_sessions WHERE account_id = ?
        ORDER BY last_seen_at DESC, created_at DESC, id DESC LIMIT ?
      )
    `
    ).bind(input.accountId, input.accountId, input.maxActive)
  ]);
}

export async function deleteSubmitterSession(
  env: DirectoryEnv,
  sessionHash: string
): Promise<void> {
  await runD1Statement(
    env.DB.prepare("DELETE FROM submitter_sessions WHERE session_hash = ?").bind(sessionHash)
  );
}
