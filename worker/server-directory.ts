export interface ServerDirectoryEnv {
  DB: D1Database;
  APP_ENVIRONMENT: "local" | "production";
  TURNSTILE_SECRET?: string;
  RATE_LIMIT_SALT?: string;
  SESSION_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_REDIRECT_URI?: string;
  LOCAL_ADMIN_TOKEN?: string;
  ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

interface ServerRow {
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

interface AdminServerRow extends ServerRow {
  submission_contact: string | null;
  submission_proof_redacted: string | null;
  submission_moderation_notes: string | null;
  submission_created_at: string | null;
  owner_discord_user_id: string | null;
  owner_username: string | null;
  owner_global_name: string | null;
  owner_avatar_hash: string | null;
  review_event_action: string | null;
  review_event_created_at: string | null;
}

interface StatusSnapshot {
  online: boolean;
  playersOnline: number | null;
  playersMax: number | null;
  motdText: string | null;
  versionName: string | null;
  favicon: string | null;
  provider: string;
}

interface SubmitterAccount {
  id: string;
  discord_user_id: string;
  username: string;
  global_name: string | null;
  avatar_hash: string | null;
}

interface SubmitterSession {
  account: SubmitterAccount;
  sessionHash: string;
}

interface SuspendedAddressRow {
  normalized_host: string;
  port: number;
  reason: string | null;
  suspended_at: string;
}

interface SubmissionInput {
  name: string;
  address: string;
  description: string;
  proof: string;
  websiteUrl: string | null;
  socialLinks: SocialLink[];
  normalized: { host: string; port: number; address: string };
  turnstile: Record<string, unknown> & { success: boolean };
  ipHash: string;
  userAgentHash: string;
}

interface SocialLink {
  key: string;
  label: string;
  url: string;
  host: string;
}

type ServerState = "pending" | "approved" | "rejected" | "suspended" | "hidden_offline";
type PublicStatusFilter = "all" | "online" | "offline";
type PublicSort = "newest" | "players" | "name";
type AdminSort = "newest" | "oldest" | "name" | "online" | "updated";

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface AccessJwtPayload {
  aud: string | string[];
  email: string;
  exp: number;
  iss: string;
  nbf?: number;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
};
const NO_STORE_JSON_HEADERS = {
  ...JSON_HEADERS,
  "cache-control": "no-store"
};
const PUBLIC_JSON_CACHE_SECONDS = 120;
const PUBLIC_JSON_HEADERS = {
  ...JSON_HEADERS,
  "cache-control": `public, max-age=${PUBLIC_JSON_CACHE_SECONDS}, stale-while-revalidate=300`,
  "access-control-allow-origin": "*"
};

const SOCIAL_KEYS = ["discord", "facebook", "instagram", "x", "youtube"] as const;
const MAX_JSON_BODY_BYTES = 20_000;
const STATUS_PROVIDER_TIMEOUT_MS = 8_000;
const STATUS_ICON_MAX_BYTES = 64 * 1024;
const STATUS_REFRESH_BATCH_LIMIT = 16;
const STATUS_REFRESH_CONCURRENCY = 5;
const STATUS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STATUS_STALE_AFTER_MS = 30 * 60 * 1000;
const TURNSTILE_TIMEOUT_MS = 8_000;
const D1_WRITE_RETRY_ATTEMPTS = 3;
const D1_WRITE_RETRY_BASE_DELAY_MS = 50;
const TURNSTILE_ACTION = "server-submit";
const TURNSTILE_HOSTNAME = "servers.kingdomsx.com";
const LOCAL_TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const SUBMISSION_DESCRIPTION_MAX_LENGTH = 120;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_OAUTH_SCOPE = "identify guilds guilds.members.read";
const OAUTH_STATE_COOKIE = "kx_oauth_state";
const OAUTH_VERIFIER_COOKIE = "kx_oauth_verifier";
const OAUTH_RETURN_COOKIE = "kx_oauth_return";
const SUBMITTER_SESSION_COOKIE = "kx_submit_session";
const LOCAL_SUBMITTER_RETURN_PATH = "/servers/submit";
const SERVER_SUBDOMAIN_SUBMITTER_RETURN_PATH = "/submit";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const SUBMITTER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const PUBLIC_DIRECTORY_ORDER = "s.approved_at DESC, s.created_at DESC, s.id ASC";
const HOMEPAGE_DIRECTORY_ORDER = "COALESCE(ss.players_online, 0) DESC, COALESCE(ss.online, 0) DESC, s.approved_at DESC, s.created_at DESC, s.id ASC";
const PRIVATE_IPV4_RANGES = [
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

const nowIso = () => new Date().toISOString();
const daysAgoIso = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const msAgoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

export async function handleServerDirectoryRequest(request: Request, env: ServerDirectoryEnv, ctx?: ExecutionContext): Promise<Response> {
  try {
    return await handleRequest(request, env, ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status, NO_STORE_JSON_HEADERS);
    }

    logError("server-directory.unhandled", error);
    return json({ error: "Internal server error." }, 500, NO_STORE_JSON_HEADERS);
  }
}

export function scheduleServerDirectoryRefresh(env: ServerDirectoryEnv, ctx: ExecutionContext): void {
  ctx.waitUntil(refreshApprovedServers(env));
}

async function handleRequest(request: Request, env: ServerDirectoryEnv, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }

  const sameOriginFailure = validateSameOriginMutation(request, url);
  if (sameOriginFailure) {
    return sameOriginFailure;
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return handleAuth(request, url, env);
  }

  if (request.method === "GET" && url.pathname === "/api/servers") {
    return cachedPublicJson(request, publicServersCacheKey(url), ctx, () => listPublicServers(url, env));
  }

  if (request.method === "GET" && url.pathname === "/api/servers/recent") {
    return cachedPublicJson(request, recentServersCacheKey(url), ctx, () => recentPublicServers(url, env));
  }

  if (request.method === "GET" && url.pathname === "/api/servers/me") {
    return getMySubmission(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/servers/me/resubmit") {
    return resubmitMyServer(request, env);
  }

  if (request.method === "PATCH" && url.pathname === "/api/servers/me/details") {
    return updateMyPublicDetails(request, env);
  }

  if (request.method === "DELETE" && url.pathname === "/api/servers/me") {
    return deleteMyServer(request, env);
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/servers/")) {
    const slug = url.pathname.replace("/api/servers/", "").replace(/\/+$/, "");
    return cachedPublicJson(request, publicServerCacheKey(url, slug), ctx, () => getPublicServer(slug, env));
  }

  if (request.method === "POST" && url.pathname === "/api/servers/submit") {
    return submitServer(request, env);
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);
    if (!admin.ok) {
      return json({ error: admin.error }, 403, NO_STORE_JSON_HEADERS);
    }
    return handleAdmin(request, url, env, admin.actor);
  }

  return json({ error: "Not found." }, 404);
}

async function handleAuth(request: Request, url: URL, env: ServerDirectoryEnv): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/auth/discord/login") {
    return startDiscordLogin(request, url, env);
  }

  if (request.method === "GET" && url.pathname === "/api/auth/discord/callback") {
    return finishDiscordLogin(request, url, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    return logoutSubmitter(request, env);
  }

  return json({ error: "Not found." }, 404, NO_STORE_JSON_HEADERS);
}

async function startDiscordLogin(request: Request, url: URL, env: ServerDirectoryEnv): Promise<Response> {
  const config = discordConfig(request, env);

  if (!config.ok) {
    return json({ error: config.error }, 503, NO_STORE_JSON_HEADERS);
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await base64UrlDigest(verifier);
  const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", DISCORD_OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const returnTo = submitterReturnPath(env, url.searchParams.get("returnTo"));
  const headers = new Headers({ location: authorizeUrl.toString() });
  headers.append("set-cookie", setCookie(request, OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_MAX_AGE_SECONDS));
  headers.append("set-cookie", setCookie(request, OAUTH_VERIFIER_COOKIE, verifier, OAUTH_COOKIE_MAX_AGE_SECONDS));
  headers.append("set-cookie", setCookie(request, OAUTH_RETURN_COOKIE, returnTo, OAUTH_COOKIE_MAX_AGE_SECONDS));
  return new Response(null, { status: 302, headers });
}

async function finishDiscordLogin(request: Request, url: URL, env: ServerDirectoryEnv): Promise<Response> {
  const config = discordConfig(request, env);
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  const expectedState = cookies[OAUTH_STATE_COOKIE] ?? "";
  const verifier = cookies[OAUTH_VERIFIER_COOKIE] ?? "";
  const returnTo = submitterReturnPath(env, cookies[OAUTH_RETURN_COOKIE]);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  if (!config.ok) {
    return redirectWithAuthCookiesCleared(request, `${submitterReturnPath(env)}?auth=not-configured`);
  }

  if (error) {
    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "denied"));
  }

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return redirectWithAuthCookiesCleared(request, authRedirectPath(returnTo, "invalid"));
  }

  let token: string;

  try {
    token = await exchangeDiscordCode(code, verifier, config.clientId, config.clientSecret, config.redirectUri);
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
  await runD1Statement(env.DB.prepare(`
    INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), account.id, sessionHash, expiresAt, createdAt, createdAt));

  const redirect = new URL(returnTo, url.origin);
  redirect.searchParams.set("auth", "ok");
  const headers = new Headers({ location: redirect.toString() });
  headers.append("set-cookie", deleteCookie(request, OAUTH_STATE_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_VERIFIER_COOKIE));
  headers.append("set-cookie", deleteCookie(request, OAUTH_RETURN_COOKIE));
  headers.append("set-cookie", setCookie(request, SUBMITTER_SESSION_COOKIE, sessionToken, SUBMITTER_SESSION_MAX_AGE_SECONDS));
  return new Response(null, { status: 302, headers });
}

async function logoutSubmitter(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  const token = cookies[SUBMITTER_SESSION_COOKIE] ?? "";

  if (token && env.SESSION_SECRET) {
    const sessionHash = await hashSessionToken(token, env);
    await runD1Statement(env.DB.prepare("DELETE FROM submitter_sessions WHERE session_hash = ?").bind(sessionHash));
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

async function listPublicServers(url: URL, env: ServerDirectoryEnv): Promise<Response> {
  await refreshLocalApprovedStatuses(env);

  const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10000, 1);
  const limit = clampInt(Number(url.searchParams.get("limit") ?? "9"), 1, 50, 9);
  const status = parseStatusFilter(url.searchParams.get("status"));
  const sort = parsePublicSort(url.searchParams.get("sort"));
  const offset = (page - 1) * limit;
  const where = publicWhere(status);
  const rows = await env.DB.prepare(publicSelectSql(where.sql, publicOrderBy(sort), "LIMIT ? OFFSET ?"))
    .bind(...where.bindings, limit, offset)
    .all<ServerRow>();
  const counts = await publicStatusCounts(env);
  const total = counts[status];

  return publicJson({
    items: rows.results.map(toPublicServer),
    page,
    limit,
    sort,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts
  });
}

async function recentPublicServers(url: URL, env: ServerDirectoryEnv): Promise<Response> {
  await refreshLocalApprovedStatuses(env);

  const limit = clampInt(Number(url.searchParams.get("limit") ?? "6"), 1, 12, 6);
  const where = publicWhere("all");
  const rows = await env.DB.prepare(publicSelectSql(where.sql, HOMEPAGE_DIRECTORY_ORDER, "LIMIT ?"))
    .bind(...where.bindings, limit)
    .all<ServerRow>();

  return publicJson({ items: rows.results.map(toPublicServer) });
}

async function getPublicServer(slug: string, env: ServerDirectoryEnv): Promise<Response> {
  await refreshLocalApprovedStatuses(env);

  if (!/^[a-z0-9-]{3,90}$/.test(slug)) {
    return publicJson({ error: "Server not found." }, 404);
  }

  const row = await env.DB.prepare(`${publicSelectSql("s.status = 'approved' AND s.slug = ?", PUBLIC_DIRECTORY_ORDER, "LIMIT 1")}`)
    .bind(slug)
    .first<ServerRow>();

  if (!row) {
    return publicJson({ error: "Server not found." }, 404);
  }

  return publicJson({ item: toPublicServer(row) });
}

async function cachedPublicJson(request: Request, cacheKey: Request, ctx: ExecutionContext | undefined, load: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET" || !ctx) {
    return withCacheDiagnostic(await load(), "MISS");
  }

  try {
    const cached = await caches.default.match(cacheKey);

    if (cached) {
      return withCacheDiagnostic(cached, "HIT");
    }
  } catch (error) {
    logWarn("public_json_cache.match_failed", error, { pathname: new URL(request.url).pathname });
  }

  const response = await load();

  if (response.status === 200) {
    const cachedResponse = new Response(response.clone().body, response);
    cachedResponse.headers.set("cache-control", `public, max-age=${PUBLIC_JSON_CACHE_SECONDS}`);
    cachedResponse.headers.delete("x-kingdomsx-cache");
    ctx.waitUntil(caches.default.put(cacheKey, cachedResponse)
      .catch((error) => logWarn("public_json_cache.put_failed", error, { pathname: new URL(request.url).pathname })));
  }

  return withCacheDiagnostic(response, "MISS");
}

function withCacheDiagnostic(response: Response, value: "HIT" | "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.set("x-kingdomsx-cache", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function publicServersCacheKey(url: URL): Request {
  const normalized = new URL(url.origin);
  normalized.pathname = "/api/servers";
  normalized.searchParams.set("limit", String(clampInt(Number(url.searchParams.get("limit") ?? "9"), 1, 50, 9)));
  normalized.searchParams.set("page", String(clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10000, 1)));
  normalized.searchParams.set("sort", parsePublicSort(url.searchParams.get("sort")));
  normalized.searchParams.set("status", parseStatusFilter(url.searchParams.get("status")));
  return new Request(normalized.toString(), { method: "GET" });
}

function recentServersCacheKey(url: URL): Request {
  const normalized = new URL(url.origin);
  normalized.pathname = "/api/servers/recent";
  normalized.searchParams.set("limit", String(clampInt(Number(url.searchParams.get("limit") ?? "6"), 1, 12, 6)));
  return new Request(normalized.toString(), { method: "GET" });
}

function publicServerCacheKey(url: URL, slug: string): Request {
  const normalized = new URL(url.origin);
  normalized.pathname = `/api/servers/${slug}`;
  return new Request(normalized.toString(), { method: "GET" });
}

async function submitServer(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const body = await readJsonObject(request);
  const input = await parseSubmissionInput(request, env, body);
  const oneDayAgo = daysAgoIso(1);
  const sevenDaysAgo = daysAgoIso(7);
  const recentSubmissions = await env.DB.prepare("SELECT COUNT(*) AS total FROM submissions WHERE submitter_ip_hash = ? AND created_at > ?")
    .bind(input.ipHash, oneDayAgo)
    .first<{ total: number }>();

  if ((recentSubmissions?.total ?? 0) >= 3) {
    return json({ error: "Too many submissions today. Try again later." }, 429);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (owned) {
    if (owned.status === "suspended") {
      return json({
        error: "This server is suspended. Contact staff before submitting it again.",
        item: toOwnerServer(owned)
      }, 409, NO_STORE_JSON_HEADERS);
    }

    if (owned.status === "rejected") {
      return json({
        error: "Your previous submission was rejected. Update it on this page and resubmit it for review.",
        item: toOwnerServer(owned)
      }, 409, NO_STORE_JSON_HEADERS);
    }

    return json({
      error: "Your Discord account already owns a server submission.",
      item: toOwnerServer(owned)
    }, 409, NO_STORE_JSON_HEADERS);
  }

  const existing = await env.DB.prepare("SELECT id, slug, status, updated_at FROM servers WHERE normalized_host = ? AND port = ?")
    .bind(input.normalized.host, input.normalized.port)
    .first<{ id: string; slug: string; status: ServerState; updated_at: string }>();

  if (existing?.status === "pending") {
    return json({ error: "This server already has a pending submission." }, 409);
  }

  if (existing?.status === "approved") {
    return json({ error: "This server is already listed." }, 409);
  }

  if (existing?.status === "suspended") {
    return json({ error: "This server is suspended. Contact staff before submitting it again." }, 409);
  }

  const suspendedAddress = await getSuspendedAddress(env, input.normalized.host, input.normalized.port);

  if (suspendedAddress) {
    return autoSuspendSubmission(env, session.account, input, existing, suspendedAddress.reason);
  }

  if (existing?.status === "rejected" && existing.updated_at > sevenDaysAgo) {
    return json({ error: "This server was recently rejected. Please wait before resubmitting." }, 409);
  }

  let snapshot: StatusSnapshot;

  try {
    snapshot = await fetchServerStatus(input.normalized.address);
  } catch (error) {
    logError("status.submission_verification_failed", error, { address: input.normalized.address });
    return json({ error: "Server status verification is temporarily unavailable." }, 503, NO_STORE_JSON_HEADERS);
  }

  if (!snapshot.online) {
    return json({ error: "The server must be online and reachable before staff can review it." }, 400);
  }

  const id = existing?.id ?? crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const slug = existing?.slug ?? `${slugify(input.name)}-${(await sha256(`${input.normalized.host}:${input.normalized.port}`)).slice(0, 8)}`;
  const createdAt = nowIso();
  const contact = submitterContact(session.account);
  const serverMutation = existing
    ? env.DB.prepare(`
        UPDATE servers
        SET name = ?, description = ?, website_url = ?, social_links_json = ?, status = 'pending',
            owner_account_id = ?, approved_at = NULL, suspended_at = NULL, updated_at = ?
        WHERE id = ?
      `).bind(input.name, input.description, input.websiteUrl, JSON.stringify(input.socialLinks), session.account.id, createdAt, id)
    : env.DB.prepare(`
        INSERT INTO servers (id, slug, name, description, normalized_host, port, website_url, social_links_json, status, owner_account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).bind(id, slug, input.name, input.description, input.normalized.host, input.normalized.port, input.websiteUrl, JSON.stringify(input.socialLinks), session.account.id, createdAt, createdAt);

  await runD1Batch(env, [
    serverMutation,
    ...statusSnapshotStatements(env, id, snapshot, createdAt),
    env.DB.prepare(`
      INSERT INTO submissions (id, server_id, owner_account_id, contact, proof_type, proof_redacted, submitter_ip_hash, user_agent_hash, turnstile_result, created_at)
      VALUES (?, ?, ?, ?, 'staff_reviewed', ?, ?, ?, ?, ?)
    `).bind(submissionId, id, session.account.id, contact, redactProof(input.proof), input.ipHash, input.userAgentHash, JSON.stringify(input.turnstile), createdAt),
    env.DB.prepare(`
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      VALUES (?, ?, 'system', 'submitted', ?, ?)
    `).bind(crypto.randomUUID(), id, existing ? "Resubmitted through public website form." : "Submitted through public website form.", createdAt)
  ]);

  return json({ ok: true, id, slug, status: "pending" }, 202);
}

async function getMySubmission(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const session = await getSubmitterSession(request, env);

  if (!session) {
    return json({
      authenticated: false,
      loginUrl: `/api/auth/discord/login?returnTo=${encodeURIComponent(submitterReturnPath(env))}`
    }, 200, NO_STORE_JSON_HEADERS);
  }

  const item = await getOwnedServerRow(env, session.account.id);
  return json({
    authenticated: true,
    user: toSubmitterUser(session.account),
    item: item ? toOwnerServer(item) : null
  }, 200, NO_STORE_JSON_HEADERS);
}

async function resubmitMyServer(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json({ error: "You do not have a rejected submission to update." }, 404, NO_STORE_JSON_HEADERS);
  }

  if (owned.status === "pending") {
    return json({ error: "Pending submissions cannot be edited until staff review is complete." }, 409, NO_STORE_JSON_HEADERS);
  }

  if (owned.status === "suspended") {
    return json({ error: "Suspended submissions cannot be edited or resubmitted. Contact staff for help." }, 409, NO_STORE_JSON_HEADERS);
  }

  const body = await readJsonObject(request);
  const input = await parseSubmissionInput(request, env, body);
  const existingAddress = await env.DB.prepare("SELECT id, status FROM servers WHERE normalized_host = ? AND port = ? AND id <> ?")
    .bind(input.normalized.host, input.normalized.port, owned.id)
    .first<{ id: string; status: ServerState }>();

  if (existingAddress?.status === "pending") {
    return json({ error: "This server already has a pending submission." }, 409);
  }

  if (existingAddress?.status === "approved") {
    return json({ error: "This server is already listed." }, 409);
  }

  if (existingAddress?.status === "suspended") {
    return json({ error: "This server is suspended. Contact staff before submitting it again." }, 409);
  }

  const suspendedAddress = await getSuspendedAddress(env, input.normalized.host, input.normalized.port);

  if (suspendedAddress) {
    return autoSuspendOwnedSubmission(env, session.account, owned, input, suspendedAddress.reason);
  }

  let snapshot: StatusSnapshot;

  try {
    snapshot = await fetchServerStatus(input.normalized.address);
  } catch (error) {
    logError("status.resubmission_verification_failed", error, { address: input.normalized.address });
    return json({ error: "Server status verification is temporarily unavailable." }, 503, NO_STORE_JSON_HEADERS);
  }

  if (!snapshot.online) {
    return json({ error: "The server must be online and reachable before staff can review it." }, 400);
  }

  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  await runD1Batch(env, [
    env.DB.prepare(`
      UPDATE servers
      SET name = ?, description = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
          status = 'pending', approved_at = NULL, suspended_at = NULL, updated_at = ?
      WHERE id = ? AND owner_account_id = ?
    `).bind(input.name, input.description, input.normalized.host, input.normalized.port, input.websiteUrl, JSON.stringify(input.socialLinks), timestamp, owned.id, session.account.id),
    ...statusSnapshotStatements(env, owned.id, snapshot, timestamp),
    env.DB.prepare(`
      INSERT INTO submissions (id, server_id, owner_account_id, contact, proof_type, proof_redacted, submitter_ip_hash, user_agent_hash, turnstile_result, created_at)
      VALUES (?, ?, ?, ?, 'staff_reviewed', ?, ?, ?, ?, ?)
    `).bind(submissionId, owned.id, session.account.id, submitterContact(session.account), redactProof(input.proof), input.ipHash, input.userAgentHash, JSON.stringify(input.turnstile), timestamp),
    env.DB.prepare(`
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      VALUES (?, ?, 'system', 'submitted', 'Resubmitted through public website form.', ?)
    `).bind(crypto.randomUUID(), owned.id, timestamp)
  ]);

  const refreshed = await getOwnedServerRow(env, session.account.id);
  return json({ ok: true, id: owned.id, status: "pending", item: refreshed ? toOwnerServer(refreshed) : null }, 202, NO_STORE_JSON_HEADERS);
}

async function updateMyPublicDetails(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json({ error: "You do not have a server listing to update." }, 404, NO_STORE_JSON_HEADERS);
  }

  if (owned.status !== "approved") {
    return json({ error: "Only approved listings can save public details without a new review." }, 409, NO_STORE_JSON_HEADERS);
  }

  const body = await readJsonObject(request);
  const details = parsePublicDetailsInput(body);
  const timestamp = nowIso();
  await runD1Batch(env, [
    env.DB.prepare(`
      UPDATE servers
      SET description = ?, website_url = ?, social_links_json = ?, updated_at = ?
      WHERE id = ? AND owner_account_id = ? AND status = 'approved'
    `).bind(details.description, details.websiteUrl, JSON.stringify(details.socialLinks), timestamp, owned.id, session.account.id),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, 'owner', 'public-details-updated', 'Owner updated public description and links.', ?)")
      .bind(crypto.randomUUID(), owned.id, timestamp)
  ]);

  const refreshed = await getOwnedServerRow(env, session.account.id);
  return json({ ok: true, item: refreshed ? toOwnerServer(refreshed) : null }, 200, NO_STORE_JSON_HEADERS);
}

async function deleteMyServer(request: Request, env: ServerDirectoryEnv): Promise<Response> {
  const session = await requireSubmitter(request, env);

  if (!session.ok) {
    return json({ error: session.error }, session.status, NO_STORE_JSON_HEADERS);
  }

  const owned = await getOwnedServerRow(env, session.account.id);

  if (!owned) {
    return json({ error: "You do not have a server listing to delete." }, 404, NO_STORE_JSON_HEADERS);
  }

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    ...(owned.status === "suspended" ? [
      suspendedAddressStatement(env, owned.normalized_host, owned.port, owned.id, owned.submission_moderation_notes, owned.suspended_at ?? timestamp, timestamp)
    ] : []),
    env.DB.prepare("DELETE FROM submissions WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM server_status WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM moderation_events WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM servers WHERE id = ? AND owner_account_id = ?").bind(owned.id, session.account.id)
  ];

  await runD1Batch(env, statements);

  return json({ ok: true, id: owned.id, deleted: true }, 200, NO_STORE_JSON_HEADERS);
}

async function parseSubmissionInput(request: Request, env: ServerDirectoryEnv, body: Record<string, unknown>): Promise<SubmissionInput> {
  if (!isLocalEnvironment(env) && (!env.TURNSTILE_SECRET || !env.RATE_LIMIT_SALT)) {
    logError("submission.missing_required_secrets");
    throw new ApiError(503, "Server submissions are temporarily unavailable.");
  }

  const turnstileToken = stringField(body, "turnstileToken", 2048);
  const ip = request.headers.get("cf-connecting-ip") ?? (isLocalEnvironment(env) ? "127.0.0.1" : "");
  const userAgent = request.headers.get("user-agent") ?? "";
  const name = stringField(body, "name", 80);
  const address = stringField(body, "address", 255);
  const port = parsePortField(body.port);
  const description = stringField(body, "description", SUBMISSION_DESCRIPTION_MAX_LENGTH);
  const proof = stringField(body, "proof", 12000);
  const websiteValue = stringField(body, "websiteUrl", 255, false);
  const websiteUrl = normalizeWebsiteInput(websiteValue);
  const socialLinks = parseSocialLinks(body.socialLinks);
  const normalized = normalizeAddress(address, port);

  if (!name || name.length < 3) {
    throw new ApiError(400, "Server name must be at least 3 characters.");
  }

  if (!description || description.length < 40) {
    throw new ApiError(400, "Description must be at least 40 characters.");
  }

  if (!normalized.ok) {
    throw new ApiError(400, normalized.error);
  }

  if (!looksLikeKingdomsProof(proof)) {
    throw new ApiError(400, "Proof must include the relevant /k about all output.");
  }

  if (websiteValue && !websiteUrl) {
    throw new ApiError(400, "Website must be a public domain or HTTP/HTTPS URL.");
  }

  if (!ip) {
    logError("submission.missing_cf_connecting_ip");
    throw new ApiError(503, "Server submissions are temporarily unavailable.");
  }

  const turnstile = await validateTurnstile(turnstileToken, ip, env);

  if (!turnstile.success) {
    throw new ApiError(400, "Turnstile verification failed.");
  }

  const rateLimitSalt = env.RATE_LIMIT_SALT ?? "local-development-rate-limit-salt";
  const ipHash = await sha256(`${rateLimitSalt}:${ip}`);
  const userAgentHash = await sha256(`${rateLimitSalt}:${userAgent}`);

  return {
    name: name.trim(),
    address,
    description: description.trim(),
    proof,
    websiteUrl,
    socialLinks,
    normalized,
    turnstile,
    ipHash,
    userAgentHash
  };
}

function parsePublicDetailsInput(body: Record<string, unknown>): { description: string; websiteUrl: string | null; socialLinks: SocialLink[] } {
  const description = stringField(body, "description", SUBMISSION_DESCRIPTION_MAX_LENGTH);
  const websiteValue = stringField(body, "websiteUrl", 255, false);
  const websiteUrl = normalizeWebsiteInput(websiteValue);
  const socialLinks = parseSocialLinks(body.socialLinks);

  if (!description || description.length < 40) {
    throw new ApiError(400, "Description must be at least 40 characters.");
  }

  if (websiteValue && !websiteUrl) {
    throw new ApiError(400, "Website must be a public domain or HTTP/HTTPS URL.");
  }

  return {
    description: description.trim(),
    websiteUrl,
    socialLinks
  };
}

async function requireSubmitter(request: Request, env: ServerDirectoryEnv): Promise<{ ok: true; account: SubmitterAccount } | { ok: false; status: number; error: string }> {
  const session = await getSubmitterSession(request, env);

  if (!session) {
    return { ok: false, status: 401, error: "Sign in with Discord before submitting a server." };
  }

  return { ok: true, account: session.account };
}

async function getSubmitterSession(request: Request, env: ServerDirectoryEnv): Promise<SubmitterSession | null> {
  if (!env.SESSION_SECRET) {
    if (!isLocalEnvironment(env)) {
      logError("auth.missing_session_secret");
    }
    return null;
  }

  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  const token = cookies[SUBMITTER_SESSION_COOKIE] ?? "";

  if (!token) {
    return null;
  }

  const sessionHash = await hashSessionToken(token, env);
  const row = await env.DB.prepare(`
    SELECT
      sess.session_hash,
      acc.id,
      acc.discord_user_id,
      acc.username,
      acc.global_name,
      acc.avatar_hash
    FROM submitter_sessions sess
    JOIN submitter_accounts acc ON acc.id = sess.account_id
    WHERE sess.session_hash = ? AND sess.expires_at > ?
    LIMIT 1
  `).bind(sessionHash, nowIso()).first<{
    session_hash: string;
    id: string;
    discord_user_id: string;
    username: string;
    global_name: string | null;
    avatar_hash: string | null;
  }>();

  if (!row) {
    return null;
  }

  await runD1Statement(env.DB.prepare("UPDATE submitter_sessions SET last_seen_at = ? WHERE session_hash = ?")
    .bind(nowIso(), sessionHash));

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

async function getOwnedServerRow(env: ServerDirectoryEnv, accountId: string): Promise<AdminServerRow | null> {
  return env.DB.prepare(adminSelectSql("s.owner_account_id = ?", "s.updated_at DESC, s.id ASC", "LIMIT 1"))
    .bind(accountId)
    .first<AdminServerRow>();
}

async function getSuspendedAddress(env: ServerDirectoryEnv, host: string, port: number): Promise<SuspendedAddressRow | null> {
  return env.DB.prepare(`
    SELECT normalized_host, port, reason, suspended_at
    FROM suspended_server_addresses
    WHERE normalized_host = ? AND port = ?
    LIMIT 1
  `).bind(host, port).first<SuspendedAddressRow>();
}

function suspendedAddressStatement(
  env: ServerDirectoryEnv,
  host: string,
  port: number,
  serverId: string | null,
  reason: string | null,
  suspendedAt: string,
  updatedAt: string
): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT INTO suspended_server_addresses (normalized_host, port, server_id, reason, suspended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_host, port) DO UPDATE SET
      server_id = excluded.server_id,
      reason = excluded.reason,
      suspended_at = excluded.suspended_at,
      updated_at = excluded.updated_at
  `).bind(host, port, serverId, reason || "Suspended by staff.", suspendedAt, updatedAt, updatedAt);
}

async function autoSuspendSubmission(
  env: ServerDirectoryEnv,
  account: SubmitterAccount,
  input: SubmissionInput,
  existing: { id: string; slug: string; status: ServerState; updated_at: string } | null,
  reason: string | null
): Promise<Response> {
  const id = existing?.id ?? crypto.randomUUID();
  const slug = existing?.slug ?? `${slugify(input.name)}-${(await sha256(`${input.normalized.host}:${input.normalized.port}`)).slice(0, 8)}`;
  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  const notes = reason || "This server address is suspended by staff.";
  const serverMutation = existing
    ? env.DB.prepare(`
        UPDATE servers
        SET name = ?, description = ?, website_url = ?, social_links_json = ?, status = 'suspended',
            owner_account_id = ?, approved_at = NULL, suspended_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(input.name, input.description, input.websiteUrl, JSON.stringify(input.socialLinks), account.id, timestamp, timestamp, id)
    : env.DB.prepare(`
        INSERT INTO servers (id, slug, name, description, normalized_host, port, website_url, social_links_json, status, owner_account_id, suspended_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?, ?, ?, ?)
      `).bind(id, slug, input.name, input.description, input.normalized.host, input.normalized.port, input.websiteUrl, JSON.stringify(input.socialLinks), account.id, timestamp, timestamp, timestamp);

  await runD1Batch(env, [
    serverMutation,
    env.DB.prepare(`
      INSERT INTO submissions (id, server_id, owner_account_id, contact, proof_type, proof_redacted, submitter_ip_hash, user_agent_hash, turnstile_result, moderation_notes, created_at)
      VALUES (?, ?, ?, ?, 'staff_reviewed', ?, ?, ?, ?, ?, ?)
    `).bind(submissionId, id, account.id, submitterContact(account), redactProof(input.proof), input.ipHash, input.userAgentHash, JSON.stringify(input.turnstile), notes, timestamp),
    env.DB.prepare(`
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      VALUES (?, ?, 'system', 'suspend', ?, ?)
    `).bind(crypto.randomUUID(), id, `Auto-suspended fresh submission for a suspended address. ${notes}`, timestamp),
    suspendedAddressStatement(env, input.normalized.host, input.normalized.port, id, notes, timestamp, timestamp)
  ]);

  const refreshed = await getOwnedServerRow(env, account.id);
  return json({ ok: true, id, slug, status: "suspended", item: refreshed ? toOwnerServer(refreshed) : null }, 202, NO_STORE_JSON_HEADERS);
}

async function autoSuspendOwnedSubmission(
  env: ServerDirectoryEnv,
  account: SubmitterAccount,
  owned: AdminServerRow,
  input: SubmissionInput,
  reason: string | null
): Promise<Response> {
  const timestamp = nowIso();
  const submissionId = crypto.randomUUID();
  const notes = reason || "This server address is suspended by staff.";

  await runD1Batch(env, [
    env.DB.prepare(`
      UPDATE servers
      SET name = ?, description = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
          status = 'suspended', approved_at = NULL, suspended_at = ?, updated_at = ?
      WHERE id = ? AND owner_account_id = ?
    `).bind(input.name, input.description, input.normalized.host, input.normalized.port, input.websiteUrl, JSON.stringify(input.socialLinks), timestamp, timestamp, owned.id, account.id),
    env.DB.prepare(`
      INSERT INTO submissions (id, server_id, owner_account_id, contact, proof_type, proof_redacted, submitter_ip_hash, user_agent_hash, turnstile_result, moderation_notes, created_at)
      VALUES (?, ?, ?, ?, 'staff_reviewed', ?, ?, ?, ?, ?, ?)
    `).bind(submissionId, owned.id, account.id, submitterContact(account), redactProof(input.proof), input.ipHash, input.userAgentHash, JSON.stringify(input.turnstile), notes, timestamp),
    env.DB.prepare(`
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      VALUES (?, ?, 'system', 'suspend', ?, ?)
    `).bind(crypto.randomUUID(), owned.id, `Auto-suspended resubmission for a suspended address. ${notes}`, timestamp),
    suspendedAddressStatement(env, input.normalized.host, input.normalized.port, owned.id, notes, timestamp, timestamp)
  ]);

  const refreshed = await getOwnedServerRow(env, account.id);
  return json({ ok: true, id: owned.id, status: "suspended", item: refreshed ? toOwnerServer(refreshed) : null }, 202, NO_STORE_JSON_HEADERS);
}

async function handleAdmin(request: Request, url: URL, env: ServerDirectoryEnv, actor: string): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/admin/servers") {
    await refreshLocalApprovedStatuses(env);

    const status = parseServerState(url.searchParams.get("status") ?? "pending");
    const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10000, 1);
    const limit = clampInt(Number(url.searchParams.get("limit") ?? "8"), 1, 50, 8);
    const sort = parseAdminSort(url.searchParams.get("sort"));
    const offset = (page - 1) * limit;
    const rows = await env.DB.prepare(adminSelectSql("s.status = ?", adminOrderBy(sort), "LIMIT ? OFFSET ?"))
      .bind(status, limit, offset)
      .all<AdminServerRow>();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM servers s WHERE s.status = ?")
      .bind(status)
      .first<{ total: number }>();
    const counts = await env.DB.prepare("SELECT status, COUNT(*) AS total FROM servers GROUP BY status")
      .all<{ status: ServerState; total: number }>();

    const total = count?.total ?? 0;
    return json({
      items: rows.results.map(toAdminServer),
      page,
      limit,
      sort,
      total,
      counts: adminCounts(counts.results),
      totalPages: Math.max(1, Math.ceil(total / limit))
    }, 200, NO_STORE_JSON_HEADERS);
  }

  const deleteMatch = url.pathname.match(/^\/api\/admin\/servers\/([^/]+)$/);

  if (deleteMatch && request.method === "DELETE") {
    return deleteServer(deleteMatch[1], env, actor);
  }

  const match = url.pathname.match(/^\/api\/admin\/servers\/([^/]+)\/(approve|reject|suspend|refresh-status)$/);

  if (!match || request.method !== "POST") {
    return json({ error: "Not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const [, id, action] = match;
  const body = await readJsonObject(request, true);
  const notes = stringField(body, "notes", 1000, false);

  if ((action === "reject" || action === "suspend") && notes.length < 3) {
    return json({ error: "A feedback reason is required and will be shown to the submitter." }, 400, NO_STORE_JSON_HEADERS);
  }

  if (action === "refresh-status") {
    return refreshOneServer(id, env, actor, notes);
  }

  const existing = await env.DB.prepare("SELECT status, normalized_host, port FROM servers WHERE id = ?")
    .bind(id)
    .first<{ status: ServerState; normalized_host: string; port: number }>();

  if (!existing) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const status: ServerState = action === "approve" ? "approved" : action === "reject" ? "rejected" : "suspended";
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE servers
      SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END,
          suspended_at = CASE WHEN ? = 'suspended' THEN ? ELSE NULL END,
          updated_at = ?
      WHERE id = ?
    `).bind(status, status, timestamp, status, timestamp, timestamp, id),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, actor, action, notes, timestamp),
    env.DB.prepare(`
      UPDATE submissions
      SET moderation_notes = CASE WHEN ? <> '' THEN ? ELSE moderation_notes END
      WHERE id = (SELECT id FROM submissions WHERE server_id = ? ORDER BY created_at DESC LIMIT 1)
    `).bind(notes, notes, id)
  ];

  if (status === "suspended") {
    statements.push(suspendedAddressStatement(env, existing.normalized_host, existing.port, id, notes, timestamp, timestamp));
  }

  if (status === "approved") {
    statements.push(env.DB.prepare("DELETE FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?").bind(existing.normalized_host, existing.port));
  }

  await runD1Batch(env, statements);

  return json({ ok: true, id, status }, 200, NO_STORE_JSON_HEADERS);
}

async function deleteServer(id: string, env: ServerDirectoryEnv, actor: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id, name, status, normalized_host, port, suspended_at FROM servers WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; status: ServerState; normalized_host: string; port: number; suspended_at: string | null }>();

  if (!existing) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    ...(existing.status === "suspended" ? [
      suspendedAddressStatement(env, existing.normalized_host, existing.port, existing.id, `Deleted suspended server listing: ${existing.name}`, existing.suspended_at ?? timestamp, timestamp)
    ] : []),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, 'delete', ?, ?)")
      .bind(crypto.randomUUID(), id, actor, `Deleted server listing: ${existing.name}`, timestamp),
    env.DB.prepare("DELETE FROM submissions WHERE server_id = ?").bind(id),
    env.DB.prepare("DELETE FROM server_status WHERE server_id = ?").bind(id),
    env.DB.prepare("DELETE FROM moderation_events WHERE server_id = ?").bind(id),
    env.DB.prepare("DELETE FROM servers WHERE id = ?").bind(id)
  ];

  await runD1Batch(env, statements);

  return json({ ok: true, id, deleted: true }, 200, NO_STORE_JSON_HEADERS);
}

async function refreshOneServer(id: string, env: ServerDirectoryEnv, actor: string, notes: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT normalized_host, port FROM servers WHERE id = ?")
    .bind(id)
    .first<{ normalized_host: string; port: number }>();

  if (!row) {
    return json({ error: "Server not found." }, 404, NO_STORE_JSON_HEADERS);
  }

  let snapshot: StatusSnapshot;

  try {
    snapshot = await fetchServerStatus(`${row.normalized_host}:${row.port}`);
  } catch (error) {
    logError("status.manual_refresh_failed", error, { id });
    return json({ error: "Server status verification is temporarily unavailable." }, 503, NO_STORE_JSON_HEADERS);
  }
  const timestamp = nowIso();
  await runD1Batch(env, [
    ...statusSnapshotStatements(env, id, snapshot, timestamp),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, 'refresh-status', ?, ?)")
      .bind(crypto.randomUUID(), id, actor, notes, timestamp),
    env.DB.prepare(`
      UPDATE submissions
      SET moderation_notes = CASE WHEN ? <> '' THEN ? ELSE moderation_notes END
      WHERE id = (SELECT id FROM submissions WHERE server_id = ? ORDER BY created_at DESC LIMIT 1)
    `).bind(notes, notes, id)
  ]);
  await maybeHideOffline(env, id);

  const refreshed = await env.DB.prepare(adminSelectSql("s.id = ?", "s.id ASC", "LIMIT 1"))
    .bind(id)
    .first<AdminServerRow>();

  return json({ ok: true, id, item: refreshed ? toAdminServer(refreshed) : null }, 200, NO_STORE_JSON_HEADERS);
}

async function refreshApprovedServers(env: ServerDirectoryEnv): Promise<void> {
  const dueBefore = msAgoIso(STATUS_REFRESH_INTERVAL_MS);
  const rows = await env.DB.prepare(`
    SELECT s.id, s.normalized_host, s.port
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
      AND (ss.refresh_attempted_at IS NULL OR ss.refresh_attempted_at <= ?)
    ORDER BY ss.refresh_attempted_at IS NULL DESC, ss.refresh_attempted_at ASC, ss.checked_at ASC, s.updated_at ASC
    LIMIT ?
  `)
    .bind(dueBefore, STATUS_REFRESH_BATCH_LIMIT)
    .all<{ id: string; normalized_host: string; port: number }>();

  await mapWithConcurrency(rows.results, STATUS_REFRESH_CONCURRENCY, async (row) => {
    try {
      const snapshot = await fetchServerStatus(`${row.normalized_host}:${row.port}`);
      await storeStatusSnapshot(env, row.id, snapshot);
      await maybeHideOffline(env, row.id);
    } catch (error) {
      logError("status.scheduled_refresh_failed", error, { id: row.id, address: `${row.normalized_host}:${row.port}` });
      const timestamp = nowIso();
      await runD1Batch(env, statusRefreshFailureStatements(env, row.id, timestamp, errorMessage(error)));
    }
  });
}

async function refreshLocalApprovedStatuses(env: ServerDirectoryEnv): Promise<void> {
  if (!isLocalEnvironment(env)) {
    return;
  }

  const dueBefore = msAgoIso(STATUS_REFRESH_INTERVAL_MS);
  const rows = await env.DB.prepare(`
    SELECT s.id, s.normalized_host, s.port
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
      AND (
        ss.server_id IS NULL
        OR ss.refresh_attempted_at IS NULL
        OR ss.refresh_attempted_at <= ?
      )
    ORDER BY ss.refresh_attempted_at IS NULL DESC, ss.refresh_attempted_at ASC, s.updated_at ASC
    LIMIT ?
  `)
    .bind(dueBefore, STATUS_REFRESH_BATCH_LIMIT)
    .all<{ id: string; normalized_host: string; port: number }>();

  await mapWithConcurrency(rows.results, STATUS_REFRESH_CONCURRENCY, async (row) => {
    try {
      const snapshot = await fetchServerStatus(`${row.normalized_host}:${row.port}`);
      await storeStatusSnapshot(env, row.id, snapshot);
    } catch (error) {
      logWarn("status.local_refresh_failed", error, { id: row.id, address: `${row.normalized_host}:${row.port}` });
      const timestamp = nowIso();
      await runD1Batch(env, statusRefreshFailureStatements(env, row.id, timestamp, errorMessage(error)));
    }
  });
}

async function storeStatusSnapshot(env: ServerDirectoryEnv, serverId: string, snapshot: StatusSnapshot): Promise<void> {
  const timestamp = nowIso();
  await runD1Batch(env, statusSnapshotStatements(env, serverId, snapshot, timestamp));
}

function statusSnapshotStatements(env: ServerDirectoryEnv, serverId: string, snapshot: StatusSnapshot, timestamp: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(`
      INSERT INTO server_status (server_id, online, players_online, players_max, motd_text, version_name, favicon_url_or_hash, checked_at, provider, failure_count, offline_since, refresh_attempted_at, refresh_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(server_id) DO UPDATE SET
        online = excluded.online,
        players_online = excluded.players_online,
        players_max = excluded.players_max,
        motd_text = excluded.motd_text,
        version_name = excluded.version_name,
        favicon_url_or_hash = excluded.favicon_url_or_hash,
        checked_at = excluded.checked_at,
        provider = excluded.provider,
        refresh_attempted_at = excluded.refresh_attempted_at,
        refresh_error = NULL,
        failure_count = CASE WHEN excluded.online = 1 THEN 0 ELSE server_status.failure_count + 1 END,
        offline_since = CASE
          WHEN excluded.online = 1 THEN NULL
          WHEN server_status.offline_since IS NULL THEN excluded.checked_at
          ELSE server_status.offline_since
        END
    `).bind(
      serverId,
      snapshot.online ? 1 : 0,
      snapshot.playersOnline,
      snapshot.playersMax,
      snapshot.motdText,
      snapshot.versionName,
      snapshot.favicon,
      timestamp,
      snapshot.provider,
      snapshot.online ? 0 : 1,
      snapshot.online ? null : timestamp,
      timestamp
    )
  ];
}

function statusRefreshFailureStatements(env: ServerDirectoryEnv, serverId: string, timestamp: string, message: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(`
      INSERT INTO server_status (server_id, online, checked_at, provider, failure_count, refresh_attempted_at, refresh_error)
      VALUES (?, 0, NULL, 'refresh-error', 1, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        refresh_attempted_at = excluded.refresh_attempted_at,
        refresh_error = excluded.refresh_error,
        failure_count = server_status.failure_count + 1
    `).bind(serverId, timestamp, message)
  ];
}

async function maybeHideOffline(env: ServerDirectoryEnv, serverId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT offline_since FROM server_status WHERE server_id = ? AND online = 0")
    .bind(serverId)
    .first<{ offline_since: string | null }>();

  if (!row?.offline_since || row.offline_since > daysAgoIso(14)) {
    return;
  }

  const timestamp = nowIso();
  await runD1Batch(env, [
    env.DB.prepare("UPDATE servers SET status = 'hidden_offline', updated_at = ? WHERE id = ? AND status = 'approved'")
      .bind(timestamp, serverId),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, 'system', 'hidden-offline', 'Auto-hidden after 14 days offline.', ?)")
      .bind(crypto.randomUUID(), serverId, timestamp)
  ]);
}

async function fetchServerStatus(address: string): Promise<StatusSnapshot> {
  const providers = [fetchMcsrvstatStatus, fetchMcstatusStatus, fetchMcapiStatus];
  let lastError: unknown;

  for (const provider of providers) {
    try {
      return await provider(address);
    } catch (error) {
      lastError = error;
      logWarn("status.provider_failed", error, { address });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All status providers failed.");
}

function discordConfig(request: Request, env: ServerDirectoryEnv): { ok: true; clientId: string; clientSecret: string; guildId: string; redirectUri: string } | { ok: false; error: string } {
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim() || `${new URL(request.url).origin}/api/auth/discord/callback`;

  if (!clientId || !clientSecret || !guildId || !env.SESSION_SECRET) {
    logError("discord.missing_oauth_configuration");
    return { ok: false, error: "Discord login is not configured." };
  }

  if (!/^\d{10,32}$/.test(clientId) || !/^\d{10,32}$/.test(guildId)) {
    return { ok: false, error: "Discord login is not configured." };
  }

  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:" && !(isLocalEnvironment(env) && parsed.protocol === "http:")) {
      return { ok: false, error: "Discord login is not configured." };
    }
  } catch {
    return { ok: false, error: "Discord login is not configured." };
  }

  return { ok: true, clientId, clientSecret, guildId, redirectUri };
}

async function exchangeDiscordCode(code: string, verifier: string, clientId: string, clientSecret: string, redirectUri: string): Promise<string> {
  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);
  form.set("code_verifier", verifier);

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: form,
    signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Discord token endpoint returned ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data) || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Discord token response did not include an access token.");
  }

  return data.access_token;
}

async function fetchDiscordProfile(token: string): Promise<{ id: string; username: string; global_name: string | null; avatar: string | null }> {
  const data = await fetchDiscordJson(`${DISCORD_API_BASE}/users/@me`, token);

  if (typeof data.id !== "string" || typeof data.username !== "string") {
    throw new Error("Discord profile response was incomplete.");
  }

  return {
    id: data.id,
    username: data.username,
    global_name: typeof data.global_name === "string" ? data.global_name : null,
    avatar: typeof data.avatar === "string" ? data.avatar : null
  };
}

async function verifyDiscordGuildMembership(token: string, guildId: string): Promise<void> {
  await fetchDiscordJson(`${DISCORD_API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`, token);
}

async function fetchDiscordJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Discord API returned ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data)) {
    throw new Error("Discord API returned unusable JSON.");
  }

  return data;
}

async function upsertSubmitterAccount(env: ServerDirectoryEnv, profile: { id: string; username: string; global_name: string | null; avatar: string | null }): Promise<SubmitterAccount> {
  const timestamp = nowIso();
  const existing = await env.DB.prepare("SELECT id FROM submitter_accounts WHERE discord_user_id = ?")
    .bind(profile.id)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();

  await runD1Statement(env.DB.prepare(`
    INSERT INTO submitter_accounts (id, discord_user_id, username, global_name, avatar_hash, guild_member_checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      avatar_hash = excluded.avatar_hash,
      guild_member_checked_at = excluded.guild_member_checked_at,
      updated_at = excluded.updated_at
  `).bind(id, profile.id, profile.username, profile.global_name, profile.avatar, timestamp, timestamp, timestamp));

  return {
    id,
    discord_user_id: profile.id,
    username: profile.username,
    global_name: profile.global_name,
    avatar_hash: profile.avatar
  };
}

function toSubmitterUser(account: SubmitterAccount) {
  return {
    id: account.discord_user_id,
    username: account.username,
    displayName: account.global_name || account.username,
    avatarUrl: discordAvatarUrl(account)
  };
}

function toOwnerServer(row: AdminServerRow) {
  const latestReviewReason = row.status !== "pending" && row.status !== "approved" ? row.submission_moderation_notes : null;
  return {
    ...toAdminServer(row),
    host: row.normalized_host,
    port: row.port,
    rejectionReason: latestReviewReason,
    editable: row.status !== "pending" && row.status !== "suspended",
    canEditPublicDetails: row.status === "approved",
    canRequestReview: row.status === "rejected" || row.status === "hidden_offline"
  };
}

function discordAvatarUrl(account: SubmitterAccount): string | null {
  if (!account.avatar_hash) {
    return null;
  }

  const extension = account.avatar_hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${account.discord_user_id}/${account.avatar_hash}.${extension}?size=80`;
}

function submitterContact(account: SubmitterAccount): string {
  const name = account.global_name || account.username;
  return `${name} (${account.discord_user_id})`;
}

async function hashSessionToken(token: string, env: ServerDirectoryEnv): Promise<string> {
  const secret = env.SESSION_SECRET ?? "";

  if (!secret) {
    throw new ApiError(503, "Discord login is not configured.");
  }

  return sha256(`${secret}:${token}`);
}

async function base64UrlDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeReturnPath(value: string | null | undefined): string | null {
  const path = (value ?? "").trim();
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/api/") ? path : null;
}

function submitterDefaultReturnPath(env: ServerDirectoryEnv): string {
  return isLocalEnvironment(env) ? LOCAL_SUBMITTER_RETURN_PATH : SERVER_SUBDOMAIN_SUBMITTER_RETURN_PATH;
}

function submitterReturnPath(env: ServerDirectoryEnv, value?: string | null): string {
  const path = safeReturnPath(value);
  const defaultPath = submitterDefaultReturnPath(env);

  if (!path) {
    return defaultPath;
  }

  const url = new URL(path, "https://kingdomsx.local");

  if (isLocalEnvironment(env) && url.pathname === SERVER_SUBDOMAIN_SUBMITTER_RETURN_PATH) {
    url.pathname = LOCAL_SUBMITTER_RETURN_PATH;
  } else if (!isLocalEnvironment(env) && url.pathname === LOCAL_SUBMITTER_RETURN_PATH) {
    url.pathname = SERVER_SUBDOMAIN_SUBMITTER_RETURN_PATH;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function parseCookies(header: string): Record<string, string> {
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

function setCookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

function deleteCookie(request: Request, name: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

async function fetchStatusJson(url: URL | string, provider: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "KingdomsX-Web/1.0 server-directory"
    },
    signal: AbortSignal.timeout(STATUS_PROVIDER_TIMEOUT_MS),
    cf: { cacheTtl: 300, cacheEverything: true }
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`${provider} returned ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data)) {
    throw new Error(`${provider} returned unusable JSON`);
  }

  return data;
}

async function fetchMcapiStatus(address: string): Promise<StatusSnapshot> {
  const { host, port } = statusAddressParts(address);
  const url = new URL("https://mcapi.us/server/status");
  url.searchParams.set("ip", host);
  url.searchParams.set("port", String(port));

  const data = await fetchStatusJson(url, "mcapi.us");
  const status = typeof data.status === "string" ? data.status : "";
  const error = typeof data.error === "string" ? data.error.trim() : "";

  if (status !== "success" || error) {
    throw new Error(`mcapi.us did not return a clean status${error ? `: ${error}` : ""}`);
  }

  const players = isRecord(data.players) ? data.players : {};
  const server = isRecord(data.server) ? data.server : {};

  return {
    online: data.online === true,
    playersOnline: numberOrNull(players.now),
    playersMax: numberOrNull(players.max),
    motdText: cleanStatusText(data.motd, 500),
    versionName: cleanStatusText(server.name, 100),
    favicon: validatedStatusIcon(data.favicon),
    provider: "mcapi.us"
  };
}

async function fetchMcsrvstatStatus(address: string): Promise<StatusSnapshot> {
  const data = await fetchStatusJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`, "mcsrvstat.us");

  if (typeof data.online !== "boolean") {
    throw new Error("mcsrvstat returned an uncertain status");
  }

  const players = isRecord(data.players) ? data.players : {};
  const motd = isRecord(data.motd) ? data.motd : {};
  const protocol = isRecord(data.protocol) ? data.protocol : {};
  const motdClean = Array.isArray(motd.clean) ? motd.clean.filter((item): item is string => typeof item === "string").join(" ") : null;
  const version = cleanStatusText(data.version, 100) ?? cleanStatusText(protocol.name, 100);

  return {
    online: data.online === true,
    playersOnline: numberOrNull(players.online),
    playersMax: numberOrNull(players.max),
    motdText: motdClean?.slice(0, 500) ?? null,
    versionName: version,
    favicon: validatedStatusIcon(data.icon),
    provider: "mcsrvstat.us"
  };
}

async function fetchMcstatusStatus(address: string): Promise<StatusSnapshot> {
  const url = new URL(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(address)}`);
  url.searchParams.set("query", "false");
  url.searchParams.set("timeout", "5");

  const data = await fetchStatusJson(url, "mcstatus.io");

  if (typeof data.online !== "boolean") {
    throw new Error("mcstatus.io returned an uncertain status");
  }

  const players = isRecord(data.players) ? data.players : {};
  const version = isRecord(data.version) ? data.version : {};
  const motd = isRecord(data.motd) ? data.motd : {};

  return {
    online: data.online === true,
    playersOnline: numberOrNull(players.online),
    playersMax: numberOrNull(players.max),
    motdText: cleanStatusText(motd.clean, 500),
    versionName: cleanStatusText(version.name_clean, 100) ?? cleanStatusText(version.name_raw, 100),
    favicon: validatedStatusIcon(data.icon),
    provider: "mcstatus.io"
  };
}

function statusAddressParts(address: string): { host: string; port: number } {
  const [host, portValue] = address.split(":");
  const port = Number(portValue ?? 25565);
  return { host, port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 25565 };
}

async function validateTurnstile(token: string, ip: string, env: ServerDirectoryEnv): Promise<Record<string, unknown> & { success: boolean }> {
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
      ? result["error-codes"].filter((value): value is string => typeof value === "string").slice(0, 10)
      : undefined
  };
}

async function requireAdmin(request: Request, env: ServerDirectoryEnv): Promise<{ ok: true; actor: string } | { ok: false; error: string }> {
  if (isLocalEnvironment(env)) {
    if (await secureCompareString(env.LOCAL_ADMIN_TOKEN ?? "", request.headers.get("x-admin-token") ?? "")) {
      return { ok: true, actor: "local-admin" };
    }

    return { ok: false, error: "Local admin token is required." };
  }

  const teamDomain = normalizeAccessTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? "");
  const audience = env.CF_ACCESS_AUD?.trim() ?? "";
  const assertion = request.headers.get("cf-access-jwt-assertion") ?? "";

  if (!teamDomain || !audience) {
    logError("access.missing_jwt_configuration");
    return { ok: false, error: "Admin access is not configured." };
  }

  if (!assertion) {
    return { ok: false, error: "Admin endpoints require Cloudflare Access." };
  }

  const payload = await verifyAccessJwt(assertion, teamDomain, audience);

  if (!payload) {
    return { ok: false, error: "Cloudflare Access authentication is invalid." };
  }

  const actor = payload.email;
  const accessEmail = request.headers.get("cf-access-authenticated-user-email") ?? "";

  if (accessEmail && accessEmail.toLowerCase() !== actor.toLowerCase()) {
    return { ok: false, error: "Cloudflare Access identity headers do not match." };
  }

  const allowlist = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    logError("access.empty_admin_email_allowlist");
    return { ok: false, error: "Admin access is not configured." };
  }

  if (!allowlist.includes(actor.toLowerCase())) {
    return { ok: false, error: "Admin email is not allowed." };
  }

  return { ok: true, actor };
}

async function verifyAccessJwt(token: string, teamDomain: string, audience: string): Promise<AccessJwtPayload | null> {
  if (token.length > 16_384) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const headerData = decodeJwtObject(parts[0]);
  const payloadData = decodeJwtObject(parts[1]);

  if (
    !headerData ||
    headerData.alg !== "RS256" ||
    typeof headerData.kid !== "string" ||
    !headerData.kid ||
    !payloadData ||
    (typeof payloadData.aud !== "string" && !(Array.isArray(payloadData.aud) && payloadData.aud.every((value) => typeof value === "string"))) ||
    typeof payloadData.email !== "string" ||
    typeof payloadData.exp !== "number" ||
    typeof payloadData.iss !== "string" ||
    (payloadData.nbf !== undefined && typeof payloadData.nbf !== "number")
  ) {
    return null;
  }

  const header = { alg: headerData.alg, kid: headerData.kid };
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
  ) {
    return null;
  }

  try {
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
    const key = document.keys?.find((candidate) => candidate.kid === header.kid);

    if (!key) {
      return null;
    }

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signature = decodeBase64Url(parts[2]);
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
    return valid ? payload : null;
  } catch (error) {
    logError("access.jwt_verification_failed", error);
    return null;
  }
}

function normalizeAccessTeamDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(normalized) ? normalized : "";
}

function decodeJwtObject(value: string): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(decodeBase64Url(value));
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function publicSelectSql(whereSql: string, orderBySql: string, tail: string): string {
  return `
    SELECT s.*, ss.online, ss.players_online, ss.players_max, ss.motd_text, ss.version_name, ss.favicon_url_or_hash, ss.checked_at, ss.provider, ss.failure_count, ss.offline_since, ss.refresh_attempted_at, ss.refresh_error
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE ${whereSql}
    ORDER BY ${orderBySql}
    ${tail}
  `;
}

function adminSelectSql(whereSql: string, orderBySql: string, tail: string): string {
  return `
    SELECT
      s.*,
      ss.online,
      ss.players_online,
      ss.players_max,
      ss.motd_text,
      ss.version_name,
      ss.favicon_url_or_hash,
      ss.checked_at,
      ss.provider,
      ss.failure_count,
      ss.offline_since,
      ss.refresh_attempted_at,
      ss.refresh_error,
      sub.contact AS submission_contact,
      sub.proof_redacted AS submission_proof_redacted,
      sub.moderation_notes AS submission_moderation_notes,
      sub.created_at AS submission_created_at,
      owner.discord_user_id AS owner_discord_user_id,
      owner.username AS owner_username,
      owner.global_name AS owner_global_name,
      owner.avatar_hash AS owner_avatar_hash,
      event.action AS review_event_action,
      event.created_at AS review_event_created_at
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    LEFT JOIN submitter_accounts owner ON owner.id = s.owner_account_id
    LEFT JOIN submissions sub ON sub.id = (
      SELECT latest.id
      FROM submissions latest
      WHERE latest.server_id = s.id
      ORDER BY latest.created_at DESC
      LIMIT 1
    )
    LEFT JOIN moderation_events event ON event.id = (
      SELECT latest_event.id
      FROM moderation_events latest_event
      WHERE latest_event.server_id = s.id
        AND (
          (s.status = 'pending' AND latest_event.action = 'submitted')
          OR (s.status = 'approved' AND latest_event.action IN ('approve', 'approved'))
          OR (s.status = 'rejected' AND latest_event.action IN ('reject', 'rejected'))
          OR (s.status = 'suspended' AND latest_event.action IN ('suspend', 'suspended'))
          OR (s.status = 'hidden_offline' AND latest_event.action IN ('hidden-offline', 'hidden_offline'))
        )
      ORDER BY latest_event.created_at DESC
      LIMIT 1
    )
    WHERE ${whereSql}
    ORDER BY ${orderBySql}
    ${tail}
  `;
}

function adminOrderBy(sort: AdminSort): string {
  switch (sort) {
    case "oldest":
      return "COALESCE(sub.created_at, s.created_at) ASC, s.created_at ASC, s.id ASC";
    case "name":
      return "s.name COLLATE NOCASE ASC, s.id ASC";
    case "online":
      return "COALESCE(ss.online, 0) DESC, s.name COLLATE NOCASE ASC, s.id ASC";
    case "updated":
      return "COALESCE(ss.checked_at, ss.refresh_attempted_at, s.updated_at) DESC, s.id ASC";
    case "newest":
    default:
      return "COALESCE(sub.created_at, s.created_at) DESC, s.created_at DESC, s.id ASC";
  }
}

function publicOrderBy(sort: PublicSort): string {
  switch (sort) {
    case "players":
      return "COALESCE(ss.players_online, 0) DESC, COALESCE(ss.online, 0) DESC, COALESCE(s.approved_at, s.created_at) DESC, s.id ASC";
    case "name":
      return "s.name COLLATE NOCASE ASC, s.id ASC";
    case "newest":
    default:
      return PUBLIC_DIRECTORY_ORDER;
  }
}

function publicWhere(status: PublicStatusFilter): { sql: string; bindings: unknown[] } {
  if (status === "online") {
    return { sql: "s.status = 'approved' AND ss.online = 1", bindings: [] };
  }

  if (status === "offline") {
    return { sql: "s.status = 'approved' AND COALESCE(ss.online, 0) = 0", bindings: [] };
  }

  return { sql: "s.status = 'approved'", bindings: [] };
}

async function publicStatusCounts(env: ServerDirectoryEnv): Promise<Record<PublicStatusFilter, number>> {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS all_total,
      COALESCE(SUM(CASE WHEN ss.online = 1 THEN 1 ELSE 0 END), 0) AS online_total,
      COALESCE(SUM(CASE WHEN COALESCE(ss.online, 0) = 0 THEN 1 ELSE 0 END), 0) AS offline_total
    FROM servers s
    LEFT JOIN server_status ss ON ss.server_id = s.id
    WHERE s.status = 'approved'
  `).first<{ all_total: number; online_total: number; offline_total: number }>();

  return {
    all: row?.all_total ?? 0,
    online: row?.online_total ?? 0,
    offline: row?.offline_total ?? 0
  };
}

function toPublicServer(row: ServerRow) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    address: row.port === 25565 ? row.normalized_host : `${row.normalized_host}:${row.port}`,
    websiteUrl: optionalUrl(row.website_url ?? ""),
    socialLinks: safeParseSocialLinks(row.social_links_json),
    approvedAt: row.approved_at,
    status: {
      online: row.online === 1,
      playersOnline: row.players_online,
      playersMax: row.players_max,
      version: row.version_name,
      icon: validatedStatusIcon(row.favicon_url_or_hash),
      provider: row.provider,
      checkedAt: row.checked_at,
      refreshAttemptedAt: row.refresh_attempted_at,
      stale: isStatusStale(row.checked_at)
    }
  };
}

function toAdminServer(row: AdminServerRow) {
  return {
    ...toPublicServer(row),
    id: row.id,
    reviewStatus: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    provider: row.provider,
    failureCount: row.failure_count,
    offlineSince: row.offline_since,
    refreshAttemptedAt: row.refresh_attempted_at,
    refreshError: row.refresh_error,
    submission: {
      contact: row.submission_contact,
      proofRedacted: row.submission_proof_redacted,
      moderationNotes: row.submission_moderation_notes,
      createdAt: row.submission_created_at
    },
    owner: row.owner_discord_user_id ? {
      id: row.owner_discord_user_id,
      username: row.owner_username,
      displayName: row.owner_global_name || row.owner_username,
      avatarUrl: discordAvatarUrl({
        id: row.owner_discord_user_id,
        discord_user_id: row.owner_discord_user_id,
        username: row.owner_username ?? "Discord user",
        global_name: row.owner_global_name,
        avatar_hash: row.owner_avatar_hash
      })
    } : null,
    review: {
      action: row.review_event_action,
      createdAt: row.review_event_created_at
    }
  };
}

function parseStatusFilter(value: string | null): PublicStatusFilter {
  return value === "online" || value === "offline" ? value : "all";
}

function parsePublicSort(value: string | null): PublicSort {
  const sorts: PublicSort[] = ["newest", "players", "name"];
  return sorts.includes(value as PublicSort) ? (value as PublicSort) : "newest";
}

function parseServerState(value: string): ServerState {
  const states: ServerState[] = ["pending", "approved", "rejected", "suspended", "hidden_offline"];
  return states.includes(value as ServerState) ? (value as ServerState) : "pending";
}

function parseAdminSort(value: string | null): AdminSort {
  const sorts: AdminSort[] = ["newest", "oldest", "name", "online", "updated"];
  return sorts.includes(value as AdminSort) ? (value as AdminSort) : "newest";
}

function adminCounts(rows: Array<{ status: ServerState; total: number }>): Record<ServerState, number> {
  const counts: Record<ServerState, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    suspended: 0,
    hidden_offline: 0
  };

  rows.forEach((row) => {
    counts[row.status] = row.total;
  });

  return counts;
}

function parseSocialLinks(value: unknown): SocialLink[] {
  if (!isRecord(value)) {
    return [];
  }

  return SOCIAL_KEYS.flatMap((key) => {
    const rawValue = typeof value[key] === "string" ? value[key].trim() : "";
    const url = normalizeSocialInput(key, rawValue);

    if (rawValue && !url) {
      throw new ApiError(400, `${socialLabel(key)} must be a public URL or supported username/invite shorthand.`);
    }

    if (!url) {
      return [];
    }
    return [{ key, label: socialLabel(key), url, host: new URL(url).hostname.replace(/^www\./, "") }];
  });
}

function safeParseSocialLinks(value: string): Array<{ key?: string; label: string; url: string; host: string }> {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord).flatMap((item) => {
      const url = optionalUrl(typeof item.url === "string" ? item.url : "");

      if (!url) {
        return [];
      }

      return [{
        key: typeof item.key === "string" ? item.key.slice(0, 24) : undefined,
        label: String(item.label ?? "Link").slice(0, 24),
        url,
        host: new URL(url).hostname.replace(/^www\./, "")
      }];
    }) : [];
  } catch {
    return [];
  }
}

function parsePortField(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";

  if (!/^\d{1,5}$/.test(text)) {
    throw new ApiError(400, "Server port is invalid.");
  }

  const port = Number(text);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError(400, "Server port is invalid.");
  }

  return port;
}

function normalizeAddress(value: string, explicitPort: number | null = null): { ok: true; host: string; port: number; address: string } | { ok: false; error: string } {
  const raw = value.trim().toLowerCase();

  if (!raw || raw.length > 255 || raw.includes("/") || raw.includes("@") || raw.includes("?") || raw.includes("#")) {
    return { ok: false, error: "Use a plain Minecraft address, not a URL." };
  }

  const ipv6Match = raw.match(/^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i);

  if (ipv6Match || isIpv6Literal(raw)) {
    return { ok: false, error: "Use a public hostname or IPv4 address; IPv6 literals are not supported." };
  }

  const parts = ipv6Match ? [ipv6Match[1], ipv6Match[2] ?? "25565"] : raw.split(":");

  if (!ipv6Match && parts.length > 2) {
    return { ok: false, error: "IPv6 addresses must use [address]:port format." };
  }

  if (explicitPort !== null && parts.length > 1) {
    return { ok: false, error: "Use Address and Port fields separately." };
  }

  const host = (parts[0] ?? "").replace(/\.$/, "");
  const port = explicitPort ?? Number(parts[1] ?? 25565);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Server port is invalid." };
  }

  if (isBlockedHost(host)) {
    return { ok: false, error: "Private, reserved, and local addresses are not allowed." };
  }

  if (!isValidHost(host)) {
    return { ok: false, error: "Server hostname is invalid." };
  }

  return { ok: true, host, port, address: port === 25565 ? host : `${host}:${port}` };
}

function isBlockedHost(host: string): boolean {
  const blockedSuffixes = [".localhost", ".local", ".internal", ".invalid", ".test", ".example"];

  if (["localhost", "localhost.localdomain", "internal", "invalid", "test", "example"].includes(host) || blockedSuffixes.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  if (isIpv6Literal(host) && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) {
    return true;
  }

  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host));
}

function isIpv6Literal(host: string): boolean {
  return /^[0-9a-f:]+$/i.test(host) && host.includes(":");
}

function isValidHost(host: string): boolean {
  if (isIpv6Literal(host)) {
    return host.length <= 45;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }

  return host.includes(".") && /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/.test(host);
}

function optionalUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const publicProtocol = url.protocol === "https:" || url.protocol === "http:";
    const hasCredentials = Boolean(url.username || url.password);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const publicHost = !isIpv6Literal(hostname) && !isBlockedHost(hostname);
    return publicProtocol && !hasCredentials && publicHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeWebsiteInput(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const direct = optionalUrl(trimmed);

  if (direct) {
    return direct;
  }

  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?(?:\/[^\s]*)?$/i.test(trimmed)) {
    return optionalUrl(`https://${trimmed}`);
  }

  return null;
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
    youtube: "https://youtube.com/@"
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

  return null;
}

function looksLikeKingdomsProof(value: string): boolean {
  const proof = value.toLowerCase();
  return proof.includes("kingdoms") && proof.includes("version:") && proof.includes("platform:");
}

function redactProof(value: string): string {
  return value
    .replace(/\| Key:.*$/gim, "| Key: [redacted]")
    .replace(/\b([a-f0-9]{32,}|[A-Za-z0-9_-]{36,})\b/g, "[redacted-token]")
    .trim()
    .slice(0, 12000);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "server";
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

  return titleCase(value);
}

function stringField(source: Record<string, unknown>, key: string, maxLength: number, required = true): string {
  const rawValue = typeof source[key] === "string" ? source[key] : "";

  if (rawValue.length > maxLength) {
    throw new ApiError(400, `${key} is too long.`);
  }

  const value = rawValue.trim();

  if (!value && required) {
    return "";
  }

  return value;
}

async function readJsonObject(request: Request, optional = false): Promise<Record<string, unknown>> {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader ?? "0");

  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large.");
  }

  if (optional && contentLengthHeader === "0") {
    return {};
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large.");
  }

  if (!text && optional) {
    return {};
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json.");
  }

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, "Request body must contain valid JSON.");
  }

  if (!isRecord(data)) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }

  return data;
}

function isLocalEnvironment(env: ServerDirectoryEnv): boolean {
  return env.APP_ENVIRONMENT === "local";
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;

  const consume = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await task(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
}

async function runD1Statement(statement: D1PreparedStatement): Promise<D1Result> {
  return retryD1Write(() => statement.run());
}

async function runD1Batch(env: ServerDirectoryEnv, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return retryD1Write(() => env.DB.batch(statements));
}

async function retryD1Write<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= D1_WRITE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= D1_WRITE_RETRY_ATTEMPTS || !isRetryableD1Error(error)) {
        throw error;
      }

      await sleep(D1_WRITE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + jitterDelay());
    }
  }

  throw lastError;
}

function isRetryableD1Error(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("network connection lost") ||
    message.includes("storage caused object to be reset") ||
    message.includes("reset because its code was updated");
}

function jitterDelay(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % 25;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStatusStale(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || Date.now() - timestamp > STATUS_STALE_AFTER_MS;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Status refresh failed.";
}

function logError(event: string, error?: unknown, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify(logPayload(event, error, fields)));
}

function logWarn(event: string, error?: unknown, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify(logPayload(event, error, fields)));
}

function logPayload(event: string, error?: unknown, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event,
    ...fields,
    ...(error === undefined ? {} : { error: errorMessage(error) })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanStatusText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.slice(0, maxLength) : null;
}

function validateSameOriginMutation(request: Request, url: URL): Response | null {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
    return null;
  }

  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase() ?? "";

  if (origin && origin !== url.origin) {
    return json({ error: "Cross-origin API mutations are not allowed." }, 403, NO_STORE_JSON_HEADERS);
  }

  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return json({ error: "Cross-site API mutations are not allowed." }, 403, NO_STORE_JSON_HEADERS);
  }

  return null;
}

async function secureCompareString(expected: string, actual: string): Promise<boolean> {
  if (!expected || !actual) {
    return false;
  }

  return constantTimeEqual(await sha256(expected), await sha256(actual));
}

function constantTimeEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function validatedStatusIcon(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const icon = value.trim();
  const prefix = "data:image/png;base64,";

  if (!icon.startsWith(prefix) || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon)) {
    return null;
  }

  try {
    const bytes = atob(icon.slice(prefix.length));
    const pngSignature = "\x89PNG\r\n\x1a\n";

    if (bytes.length > STATUS_ICON_MAX_BYTES || bytes.slice(0, pngSignature.length) !== pngSignature) {
      return null;
    }

    return icon;
  } catch {
    return null;
  }
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200, headers: HeadersInit = JSON_HEADERS): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function publicJson(data: unknown, status = 200): Response {
  return json(data, status, PUBLIC_JSON_HEADERS);
}
