import {
  handleServerDirectoryRequest,
  PUBLIC_DIRECTORY_MAX_PAGE,
  scheduleServerDirectoryRefresh
} from "./index";
import type { DirectoryEnv } from "./contracts";
import { routePublicCollections, type PublicServerCollection } from "./public-directory/listings";
import { logError } from "./core/runtime";
import { publicDirectoryHtml, publicDirectoryStateHtml, publicPaginationHtml } from "../../src/assets/scripts/server-directory/listing-html";
import { DIRECTORY_UNAVAILABLE, publicDirectoryPath as directoryPath } from "../../src/assets/scripts/server-directory/listing-presentation";

type WorkerEnv = Omit<Cloudflare.Env, "APP_ENVIRONMENT"> & DirectoryEnv;

const APEX_HOST = "kingdomsx.com";
const SERVERS_HOST = "servers.kingdomsx.com";
const SERVERS_ORIGIN = `https://${SERVERS_HOST}`;
const SERVER_DIRECTORY_DESCRIPTION = "Browse public servers running KingdomsX, whether you want to test the plugin or find a community already using it.";
const SERVER_DIRECTORY_SITEMAP_PATHS = ["/"] as const;

type DirectoryStatus = "all" | "online" | "offline";
type DirectorySort = "newest" | "players" | "name";

interface DirectoryRoute {
  status: DirectoryStatus;
  sort: DirectorySort;
  page: number;
  canonicalPath: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const localRequest = env.APP_ENVIRONMENT === "local";

    if (!localRequest && url.hostname !== SERVERS_HOST) {
      return renderNotFoundPage(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleServerDirectoryRequest(request, env, ctx);
    }

    const seoResponse = serverSeoAsset(request, url);

    if (seoResponse) {
      return seoResponse;
    }

    const serverResponse = await serveServerSurface(request, url, env, ctx);

    if (serverResponse) {
      return serverResponse;
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.endsWith(".html")) {
      const assetResponse = await env.ASSETS.fetch(request);

      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return renderNotFoundPage(request, env);
  },

  async scheduled(
    controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    scheduleServerDirectoryRefresh(env, ctx, controller.scheduledTime, controller.cron);
  }
} satisfies ExportedHandler<Cloudflare.Env>;

async function serveServerSurface(
  request: Request,
  url: URL,
  env: WorkerEnv,
  ctx: ExecutionContext
): Promise<Response | null> {
  const normalizedPath = normalizeServerHtmlPath(url.pathname);
  const utilityAsset = serverUtilityAsset(normalizedPath);

  if (utilityAsset) {
    const canonicalPath = utilityAsset.publicPath;

    if (url.pathname !== canonicalPath) {
      const redirect = new URL(url);
      redirect.pathname = canonicalPath;

      return Response.redirect(redirect.toString(), 301);
    }

    return fetchAsset(request, url, env, utilityAsset.assetPath);
  }

  const route = parseDirectoryRoute(normalizedPath);

  return route ? serveDirectoryPage(request, url, env, route, ctx) : null;
}

function serverUtilityAsset(pathname: string): { publicPath: string; assetPath: string } | null {
  if (pathname === "/submit") {
    return { publicPath: "/submit", assetPath: "/servers/submit.html" };
  }

  if (pathname === "/admin") {
    return { publicPath: "/admin", assetPath: "/servers/admin.html" };
  }

  return null;
}

function normalizeServerHtmlPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "") || "/";

  if (withoutTrailingSlash === "/servers.html") {
    return "/";
  }

  if (withoutTrailingSlash.endsWith(".html")) {
    return withoutTrailingSlash.slice(0, -".html".length) || "/";
  }

  return withoutTrailingSlash;
}

function serverSeoAsset(request: Request, url: URL): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/robots.txt") {
    return textResponse(request, serverRobotsTxt(), "text/plain; charset=utf-8");
  }

  if (pathname === "/sitemap-index.xml") {
    return textResponse(request, serverSitemapIndexXml(), "application/xml; charset=utf-8");
  }

  if (pathname === "/sitemap-0.xml") {
    return textResponse(request, serverSitemapXml(), "application/xml; charset=utf-8");
  }

  return null;
}

function textResponse(request: Request, body: string, contentType: string): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function serverRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin",
    "",
    `Sitemap: ${SERVERS_ORIGIN}/sitemap-index.xml`,
    ""
  ].join("\n");
}

function serverSitemapIndexXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<sitemap><loc>${SERVERS_ORIGIN}/sitemap-0.xml</loc></sitemap>`,
    "</sitemapindex>"
  ].join("");
}

function serverSitemapXml(): string {
  const urls = SERVER_DIRECTORY_SITEMAP_PATHS.map((pathname) => {
    const loc = pathname === "/" ? `${SERVERS_ORIGIN}/` : `${SERVERS_ORIGIN}${pathname}`;

    return `<url><loc>${loc}</loc></url>`;
  }).join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>"
  ].join("");
}

function parseDirectoryRoute(pathname: string): DirectoryRoute | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const segments = normalized.split("/").filter(Boolean);
  let status: DirectoryStatus = "online";
  let sort: DirectorySort = "newest";

  if (segments[0] === "all" || segments[0] === "online" || segments[0] === "offline") {
    status = segments.shift() as DirectoryStatus;
  }

  if (segments[0] === "sort") {
    segments.shift();

    const sortSegment = segments.shift();

    if (sortSegment !== "newest" && sortSegment !== "players" && sortSegment !== "name") {
      return null;
    }

    sort = sortSegment;
  }

  if (segments.length === 0) {
    return { status, sort, page: 1, canonicalPath: directoryPath(status, 1, sort) };
  }

  if (segments.length !== 2 || segments[0] !== "page" || !/^[1-9]\d*$/.test(segments[1])) {
    return null;
  }

  const page = Number(segments[1]);

  return page <= PUBLIC_DIRECTORY_MAX_PAGE
    ? { status, sort, page, canonicalPath: directoryPath(status, page, sort) }
    : null;
}

async function serveDirectoryPage(
  request: Request,
  url: URL,
  env: WorkerEnv,
  route: DirectoryRoute,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (url.searchParams.has("sort")) {
    const querySort = parseDirectorySort(url.searchParams.get("sort"));
    const redirect = new URL(url);
    redirect.pathname = directoryPath(route.status, route.page, querySort);
    redirect.searchParams.delete("sort");

    return Response.redirect(redirect.toString(), 301);
  }

  if (url.pathname !== route.canonicalPath) {
    const redirect = new URL(url);
    redirect.pathname = route.canonicalPath;

    return Response.redirect(redirect.toString(), 301);
  }

  let data: PublicServerCollection | null = null;
  let status = 200;
  let retryAfter: string | null = null;

  try {
    const apiUrl = new URL("/api/servers", url);
    apiUrl.searchParams.set("limit", "8");
    apiUrl.searchParams.set("page", String(route.page));
    apiUrl.searchParams.set("status", route.status);
    apiUrl.searchParams.set("sort", route.sort);

    // Share the API's approved projection, normalized cache and rate limits without an HTTP request
    const collection = await routePublicCollections({
      request: new Request(apiUrl, { headers: request.headers }),
      url: apiUrl,
      env,
      executionCtx: ctx
    });

    if (collection?.ok) {
      data = await collection.json<PublicServerCollection>();
    } else {
      status = collection?.status === 429 ? 429 : 503;
      retryAfter = collection?.headers.get("retry-after") ?? null;
    }
  } catch (error) {
    logError("public_directory.page_failed", error);
    status = 503;
  }

  if (data && route.page > data.totalPages) {
    return renderNotFoundPage(request, env);
  }

  const response = await fetchAsset(request, url, env, "/servers.html");
  const canonical = new URL(route.canonicalPath, url);
  canonical.search = "";
  canonical.hash = "";

  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }

  const headers = new Headers(response.headers);

  if (retryAfter) {
    headers.set("Retry-After", retryAfter);
  }

  return rewriteDirectoryMetadata(new Response(request.method === "HEAD" ? null : response.body, { status, headers }), canonical.toString(), route, data);
}

function parseDirectorySort(value: string | null): DirectorySort {
  return value === "players" || value === "name" ? value : "newest";
}

function fetchAsset(
  request: Request,
  url: URL,
  env: WorkerEnv,
  pathname: string
): Promise<Response> {
  const assetUrl = new URL(url);
  assetUrl.pathname = pathname;
  assetUrl.search = "";

  const headers = new Headers(request.headers);

  // Asset validators no longer apply after the path is rewritten
  headers.delete("If-Modified-Since");
  headers.delete("If-None-Match");
  headers.delete("Range");

  return env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers }));
}

function rewriteDirectoryMetadata(
  response: Response,
  canonicalUrl: string,
  route: DirectoryRoute,
  data: PublicServerCollection | null
): Response {
  const statusLabel = route.status === "all" ? "All" : route.status === "offline" ? "Offline" : "Online";
  const pageLabel = route.page > 1 ? ` - Page ${route.page}` : "";
  const titlePrefix = route.status === "online" ? "Servers" : `${statusLabel} Servers`;
  const title = `${titlePrefix}${pageLabel} | KingdomsX`;
  const description =
    route.page > 1
      ? `${SERVER_DIRECTORY_DESCRIPTION} Page ${route.page}.`
      : SERVER_DIRECTORY_DESCRIPTION;
  const headers = new Headers(response.headers);

  // Remove length and validator headers because HTMLRewriter changes the body
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Link", `<${canonicalUrl}>; rel="canonical"`);
  const robots = response.ok && route.status === "online" && route.sort === "newest"
    ? "index, follow, max-image-preview:large"
    : "noindex, follow";
  headers.set("X-Robots-Tag", robots);
  headers.set("Cache-Control", "no-store");

  if (!response.body) {
    return new Response(null, { status: response.status, headers });
  }

  const webPageStructuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonicalUrl}#webpage`,
    "url": canonicalUrl,
    "name": title,
    "description": description,
    "isPartOf": { "@id": `${new URL(canonicalUrl).origin}/#website` },
    "about": { "@id": `https://${APEX_HOST}/#software` },
    "inLanguage": "en"
  });

  return new HTMLRewriter()
    .on("title", new TextContentHandler(title))
    .on('link[rel="canonical"]', new AttributeHandler("href", canonicalUrl))
    .on('link[rel="alternate"]', new AttributeHandler("href", canonicalUrl))
    .on('meta[property="og:url"]', new AttributeHandler("content", canonicalUrl))
    .on('meta[property="og:title"]', new AttributeHandler("content", title))
    .on('meta[name="twitter:title"]', new AttributeHandler("content", title))
    .on('meta[name="description"]', new AttributeHandler("content", description))
    .on('meta[name="robots"], meta[name="googlebot"]', new AttributeHandler("content", robots))
    .on('meta[property="og:description"]', new AttributeHandler("content", description))
    .on('meta[name="twitter:description"]', new AttributeHandler("content", description))
    .on(
      'script[data-structured-data="webpage"]',
      new TextContentHandler(webPageStructuredData)
    )
    .on('[data-server-list]', {
      element(element) {
        element.setAttribute("data-server-rendered", "true");
        element.removeAttribute("aria-busy");
        element.setInnerContent(data ? publicDirectoryHtml(data, route.status) : publicDirectoryStateHtml(DIRECTORY_UNAVAILABLE, true), { html: true });
      }
    })
    .on('[data-server-pagination]', {
      element(element) {
        element.setInnerContent(data ? publicPaginationHtml(data, route.status) : "", { html: true });
      }
    })
    .on('[data-server-filter]', {
      element(element) {
        const filter = element.getAttribute("data-server-filter") as DirectoryStatus;
        element.setAttribute("href", directoryPath(filter, 1, route.sort));
        element.setAttribute("class", `btn btn-site${filter === route.status ? " is-active" : ""}`);

        if (filter === route.status) {
          element.setAttribute("aria-current", "page");
        } else {
          element.removeAttribute("aria-current");
        }
      }
    })
    .on('[data-server-sort] option', {
      element(element) {
        if (element.getAttribute("value") === route.sort) {
          element.setAttribute("selected", "");
        } else {
          element.removeAttribute("selected");
        }
      }
    })
    .on('[data-server-sort-form]', new AttributeHandler("action", directoryPath(route.status, 1)))
    .on('[data-server-noscript]', { element(element) { element.remove(); } })
    .transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    );
}

class AttributeHandler implements HTMLRewriterElementContentHandlers {
  constructor(
    private readonly attribute: string,
    private readonly value: string
  ) {}

  element(element: Element): void {
    element.setAttribute(this.attribute, this.value);
  }
}

class TextContentHandler implements HTMLRewriterElementContentHandlers {
  constructor(private readonly value: string) {}

  element(element: Element): void {
    element.setInnerContent(this.value);
  }
}

async function renderNotFoundPage(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const url = new URL(request.url);
  url.hostname = APEX_HOST;
  url.pathname = "/404";
  url.search = "";

  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.delete("Location");
  headers.set("X-Robots-Tag", "noindex, follow");

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 404,
      statusText: "Not Found",
      headers
    });
  }

  if (!response.body) {
    headers.set("Content-Type", "text/plain; charset=utf-8");

    return new Response("Not Found", {
      status: 404,
      statusText: "Not Found",
      headers
    });
  }

  return new Response(response.body, {
    status: 404,
    statusText: "Not Found",
    headers
  });
}
