import {
  DISCORD_AUTHORIZE_URL,
  DISCORD_API_BASE,
  DISCORD_OAUTH_SCOPE,
  DISCORD_TOKEN_URL,
  NO_STORE_JSON_HEADERS,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  SUBMITTER_SESSION_COOKIE,
  SUBMITTER_SESSION_MAX_ACTIVE_PER_ACCOUNT,
  SUBMITTER_SESSION_MAX_AGE_SECONDS,
  TURNSTILE_TIMEOUT_MS
} from "../config";
import type { DirectoryEnv, DirectoryRequestContext } from "../contracts";
import { base64UrlDigest, randomToken } from "../core/crypto";
import { isRecord, json } from "../core/http";
import { logError, nowIso } from "../core/runtime";
import {
  deleteCookie,
  createSubmitterSession,
  deleteSubmitterSession,
  hashSessionToken,
  isValidSessionToken,
  parseCookies,
  setCookie,
  submitterReturnPath,
  upsertSubmitterAccount,
  type DiscordProfile,
  type SubmitterAccount
} from "./submitter-sessions";

export async function routeAuth({
  request,
  url,
  env
}: DirectoryRequestContext): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/auth/"))
    return null;

  if (request.method === "GET" && url.pathname === "/api/auth/discord/login")
    return startDiscordLogin(request, url, env);

  if (request.method === "GET" && url.pathname === "/api/auth/discord/callback")
    return finishDiscordLogin(request, url, env);

  if (request.method === "POST" && url.pathname === "/api/auth/logout")
    return logoutSubmitter(request, env);

  return json({ error: "Not found." }, 404, NO_STORE_JSON_HEADERS);
}

async function startDiscordLogin(
  request: Request,
  url: URL,
  env: DirectoryRequestContext["env"]
): Promise<Response> {
  const config = discordConfig(request, env);

  if (!config.ok)
    return json({ error: config.error }, 503, NO_STORE_JSON_HEADERS);

  // State blocks callback forgery
  // PKCE keeps an intercepted code from being exchanged
  const state = randomToken(24);
  const verifier = randomToken(48);
  const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);

  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", DISCORD_OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", await base64UrlDigest(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const headers = new Headers({ location: authorizeUrl.toString() });

  headers.append(
    "set-cookie",
    setCookie(request, OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_MAX_AGE_SECONDS)
  );
  headers.append(
    "set-cookie",
    setCookie(request, OAUTH_VERIFIER_COOKIE, verifier, OAUTH_COOKIE_MAX_AGE_SECONDS)
  );
  headers.append(
    "set-cookie",
    setCookie(
      request,
      OAUTH_RETURN_COOKIE,
      submitterReturnPath(env, url.searchParams.get("returnTo")),
      OAUTH_COOKIE_MAX_AGE_SECONDS
    )
  );

  return new Response(null, { status: 302, headers });
}

async function finishDiscordLogin(
  request: Request,
  url: URL,
  env: DirectoryRequestContext["env"]
): Promise<Response> {
  const config = discordConfig(request, env);
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  const expectedState = cookies[OAUTH_STATE_COOKIE] ?? "";
  const verifier = cookies[OAUTH_VERIFIER_COOKIE] ?? "";
  const returnTo = submitterReturnPath(env, cookies[OAUTH_RETURN_COOKIE]);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  if (!config.ok)
    return redirectWithAuthCookiesCleared(
      request,
      `${submitterReturnPath(env)}?auth=not-configured`
    );

  if (error)
    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "denied"));

  if (!code || !state || !expectedState || state !== expectedState || !verifier)
    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "invalid"));

  let token: string;

  try {
    token = await exchangeDiscordCode(
      code,
      verifier,
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  } catch (exchangeError) {
    logError("discord.oauth_token_exchange_failed", exchangeError);

    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "failed"));
  }

  let account: SubmitterAccount;

  try {
    const profile = await fetchDiscordProfile(token);

    await verifyDiscordGuildMembership(token, config.guildId);
    account = await upsertSubmitterAccount(env, profile);
  } catch (profileError) {
    logError("discord.membership_verification_failed", profileError);

    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "not-member"));
  }

  const sessionToken = randomToken(48);
  const sessionHash = await hashSessionToken(sessionToken, env);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SUBMITTER_SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await createSubmitterSession(env, {
    accountId: account.id,
    sessionHash,
    expiresAt,
    createdAt,
    maxActive: SUBMITTER_SESSION_MAX_ACTIVE_PER_ACCOUNT
  });
  const redirect = new URL(returnTo, url.origin);

  redirect.searchParams.set("auth", "ok");
  const headers = new Headers({ location: redirect.toString() });

  headers.append("set-cookie", deleteCookie(request, OAUTH_STATE_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_VERIFIER_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_RETURN_COOKIE));
  headers.append(
    "set-cookie",
    setCookie(request, SUBMITTER_SESSION_COOKIE, sessionToken, SUBMITTER_SESSION_MAX_AGE_SECONDS)
  );

  return new Response(null, { status: 302, headers });
}

async function logoutSubmitter(
  request: Request,
  env: DirectoryRequestContext["env"]
): Promise<Response> {
  const token = parseCookies(request.headers.get("cookie") ?? "")[SUBMITTER_SESSION_COOKIE] ?? "";

  if (isValidSessionToken(token) && env.SESSION_SECRET) {
    await deleteSubmitterSession(env, await hashSessionToken(token, env));
  }

  const headers = new Headers(NO_STORE_JSON_HEADERS);

  headers.append("set-cookie", deleteCookie(request, SUBMITTER_SESSION_COOKIE));

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function redirectWithAuthCookiesCleared(request: Request, location: string): Response {
  const headers = new Headers({ location });

  headers.append("set-cookie", deleteCookie(request, OAUTH_STATE_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_VERIFIER_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_RETURN_COOKIE));

  return new Response(null, { status: 302, headers });
}

function authRedirectPath(returnTo: string, status: string): string {
  const url = new URL(returnTo, "https://kingdomsx.local");

  url.searchParams.set("auth", status);

  return `${url.pathname}${url.search}`;
}

interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  guildId: string;
  redirectUri: string;
}

function discordConfig(
  request: Request,
  env: DirectoryEnv
): ({ ok: true } & DiscordOAuthConfig) | { ok: false; error: string } {
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim() || `${new URL(request.url).origin}/api/auth/discord/callback`;

  if (!clientId || !clientSecret || !guildId || !env.SESSION_SECRET) {
    logError("discord.missing_oauth_configuration");

    return { ok: false, error: "Discord login is not configured." };
  }

  if (!/^\d{10,32}$/.test(clientId) || !/^\d{10,32}$/.test(guildId))
    return { ok: false, error: "Discord login is not configured." };

  try {
    const parsed = new URL(redirectUri);

    if (
      parsed.protocol !== "https:" &&
      !(env.APP_ENVIRONMENT === "local" && parsed.protocol === "http:")
    ) {
      return { ok: false, error: "Discord login is not configured." };
    }
  } catch {
    return { ok: false, error: "Discord login is not configured." };
  }

  return { ok: true, clientId, clientSecret, guildId, redirectUri };
}

async function exchangeDiscordCode(
  code: string,
  verifier: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<string> {
  const form = new URLSearchParams();

  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);
  form.set("code_verifier", verifier);
  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
  });

  if (!response.ok)
    throw new Error(`Discord token endpoint returned ${response.status}`);

  const data: unknown = await response.json();

  if (!isRecord(data) || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Discord token response did not include an access token.");
  }

  return data.access_token;
}

async function fetchDiscordProfile(token: string): Promise<DiscordProfile> {
  const data = await fetchDiscordJson(`${DISCORD_API_BASE}/users/@me`, token);

  if (typeof data.id !== "string" || typeof data.username !== "string")
    throw new Error("Discord profile response was incomplete.");

  return {
    id: data.id,
    username: data.username,
    global_name: typeof data.global_name === "string" ? data.global_name : null,
    avatar: typeof data.avatar === "string" ? data.avatar : null
  };
}

async function verifyDiscordGuildMembership(token: string, guildId: string): Promise<void> {
  await fetchDiscordJson(
    `${DISCORD_API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
    token
  );
}

async function fetchDiscordJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
  });

  if (!response.ok)
    throw new Error(`Discord API returned ${response.status}`);

  const data: unknown = await response.json();

  if (!isRecord(data))
    throw new Error("Discord API returned unusable JSON.");

  return data;
}
