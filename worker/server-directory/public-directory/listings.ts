import {
  PUBLIC_DIRECTORY_LIMITS,
  PUBLIC_DIRECTORY_MAX_PAGE,
  PUBLIC_JSON_CACHE_SECONDS,
  PUBLIC_JSON_HEADERS,
  RECENT_SERVER_LIMITS
} from "../config";
import type {
  DirectoryEnv,
  DirectoryRequestContext,
  PublicServerRow,
  PublicSort,
  PublicStatusFilter
} from "../contracts";
import { clampInt, publicJson } from "../core/http";
import { optionalUrl } from "../core/network-validation";
import { publicApiRateLimit, rateLimitResponse } from "../core/rate-limit";
import { logWarn } from "../core/runtime";
import { safeParseSocialLinks } from "../core/social-links";
import { isStatusStale, refreshLocalApprovedStatuses } from "../status/refresh";
import { validatedStatusIcon } from "../status/providers";
import {
  getPublicServerRow,
  listPublicServerRows,
  publicStatusCounts,
  recentPublicServerRows
} from "./listing-queries";

export async function routePublicCollections(
  context: DirectoryRequestContext
): Promise<Response | null> {
  const { request, url, env, executionCtx } = context;

  if (request.method !== "GET")
    return null;

  if (url.pathname === "/api/servers") {
    return cachedPublicJson(request, publicServersCacheKey(url), env, executionCtx, () =>
      listPublicServers(url, env)
    );
  }

  if (url.pathname === "/api/servers/recent") {
    return cachedPublicJson(request, recentServersCacheKey(url), env, executionCtx, () =>
      recentPublicServers(url, env)
    );
  }

  return null;
}

export async function routePublicDetail(
  context: DirectoryRequestContext
): Promise<Response | null> {
  const { request, url, env, executionCtx } = context;

  if (request.method !== "GET" || !url.pathname.startsWith("/api/servers/"))
    return null;

  const slug = url.pathname.replace("/api/servers/", "").replace(/\/+$/, "");

  return cachedPublicJson(request, publicServerCacheKey(url, slug), env, executionCtx, () =>
    getPublicServer(slug, env)
  );
}

async function listPublicServers(url: URL, env: DirectoryRequestContext["env"]): Promise<Response> {
  await refreshLocalApprovedStatuses(env);

  const page = clampInt(
    Number(url.searchParams.get("page") ?? "1"),
    1,
    PUBLIC_DIRECTORY_MAX_PAGE,
    1
  );
  const limit = parsePublicDirectoryLimit(url.searchParams.get("limit"));
  const status = parseStatusFilter(url.searchParams.get("status"));
  const sort = parsePublicSort(url.searchParams.get("sort"));
  const counts = await publicStatusCounts(env);
  const total = counts[status];
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rows =
    page > totalPages
      ? []
      : await listPublicServerRows(env, status, sort, limit, (page - 1) * limit);

  return publicJson({
    items: rows.map(toPublicServer),
    page,
    limit,
    sort,
    total,
    totalPages,
    counts
  });
}

async function recentPublicServers(
  url: URL,
  env: DirectoryRequestContext["env"]
): Promise<Response> {
  await refreshLocalApprovedStatuses(env);
  const rows = await recentPublicServerRows(
    env,
    parseRecentServerLimit(url.searchParams.get("limit"))
  );

  return publicJson({ items: rows.map(toPublicServer) });
}

async function getPublicServer(
  slug: string,
  env: DirectoryRequestContext["env"]
): Promise<Response> {
  await refreshLocalApprovedStatuses(env);

  if (!/^[a-z0-9-]{3,90}$/.test(slug))
    return publicJson({ error: "Server not found." }, 404);

  const row = await getPublicServerRow(env, slug);

  return row
    ? publicJson({ item: toPublicServer(row) })
    : publicJson({ error: "Server not found." }, 404);
}

function parseStatusFilter(value: string | null): PublicStatusFilter {
  return value === "online" || value === "offline" ? value : "all";
}

function parsePublicDirectoryLimit(value: string | null): number {
  const limit = Number(value);

  return PUBLIC_DIRECTORY_LIMITS.includes(limit as (typeof PUBLIC_DIRECTORY_LIMITS)[number])
    ? limit
    : 8;
}

function parseRecentServerLimit(value: string | null): number {
  const limit = Number(value);

  return RECENT_SERVER_LIMITS.includes(limit as (typeof RECENT_SERVER_LIMITS)[number]) ? limit : 4;
}

function parsePublicSort(value: string | null): PublicSort {
  return value === "players" || value === "name" ? value : "newest";
}

async function cachedPublicJson(
  request: Request,
  cacheKey: Request,
  env: DirectoryEnv,
  ctx: ExecutionContext | undefined,
  load: () => Promise<Response>
): Promise<Response> {
  if (request.method !== "GET")
    return withCacheDiagnostic(await load(), "MISS");

  // Skip cache lookup when tests call the loader without an execution context
  if (ctx) {
    try {
      const cached = await caches.default.match(cacheKey);

      if (cached) {
        const response = withCacheDiagnostic(cached, "HIT");

        // Restore the browser policy after cache storage and zone TTL adjustments.
        response.headers.set("cache-control", PUBLIC_JSON_HEADERS["cache-control"]);

        return response;
      }
    } catch (error) {
      logWarn("public_json_cache.match_failed", error, { pathname: new URL(request.url).pathname });
    }
  }

  const rateLimit = await publicApiRateLimit(request, env);

  if (!rateLimit.ok)
    return rateLimitResponse(rateLimit.error);

  const response = await load();

  if (ctx && (response.status === 200 || response.status === 404)) {
    const cachedResponse = new Response(response.clone().body, response);

    cachedResponse.headers.set("cache-control", `public, max-age=${PUBLIC_JSON_CACHE_SECONDS}`);
    cachedResponse.headers.delete("x-kingdomsx-cache");
    ctx.waitUntil(
      caches.default
        .put(cacheKey, cachedResponse)
        .catch((error) =>
          logWarn("public_json_cache.put_failed", error, {
            pathname: new URL(request.url).pathname
          })
        )
    );
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
  normalized.searchParams.set(
    "limit",
    String(parsePublicDirectoryLimit(url.searchParams.get("limit")))
  );
  normalized.searchParams.set(
    "page",
    String(clampInt(Number(url.searchParams.get("page") ?? "1"), 1, PUBLIC_DIRECTORY_MAX_PAGE, 1))
  );
  normalized.searchParams.set("sort", parsePublicSort(url.searchParams.get("sort")));
  normalized.searchParams.set("status", parseStatusFilter(url.searchParams.get("status")));

  return new Request(normalized.toString(), { method: "GET" });
}

function recentServersCacheKey(url: URL): Request {
  const normalized = new URL(url.origin);
  normalized.pathname = "/api/servers/recent";
  normalized.searchParams.set(
    "limit",
    String(parseRecentServerLimit(url.searchParams.get("limit")))
  );

  return new Request(normalized.toString(), { method: "GET" });
}

function publicServerCacheKey(url: URL, slug: string): Request {
  const normalized = new URL(url.origin);
  normalized.pathname = `/api/servers/${slug}`;

  return new Request(normalized.toString(), { method: "GET" });
}

export function toPublicServer(row: PublicServerRow) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    address: row.port === 25565 ? row.normalized_host : `${row.normalized_host}:${row.port}`,
    websiteUrl: optionalUrl(row.website_url ?? ""),
    socialLinks: safeParseSocialLinks(row.social_links_json),
    approvedAt: row.approved_at,
    owner: row.owner_username
      ? {
        username: row.owner_username,
        displayName: row.owner_global_name || row.owner_username
      }
      : null,
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
