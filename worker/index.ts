import { handleServerDirectoryRequest, scheduleServerDirectoryRefresh, type ServerDirectoryEnv } from "./server-directory";

interface StaticAssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env extends ServerDirectoryEnv {
  ASSETS: StaticAssetsBinding;
}

const APEX_HOST = "kingdomsx.com";
const WWW_HOST = "www.kingdomsx.com";
const ASSETS_HOST = "assets.kingdomsx.com";
const SERVERS_HOST = "servers.kingdomsx.com";
const SERVER_DIRECTORY_DESCRIPTION = "Browse public servers running KingdomsX, whether you want to test the plugin or find a community already using it.";
type DirectoryStatus = "all" | "online" | "offline";
type DirectorySort = "newest" | "players" | "name";

interface DirectoryRoute {
  status: DirectoryStatus;
  sort: DirectorySort;
  page: number;
  canonicalPath: string;
}

const ERROR_STATUS_TEXT: Record<number, string> = {
  403: "Forbidden",
  404: "Not Found"
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const localRequest = env.APP_ENVIRONMENT === "local";

    if (url.hostname === WWW_HOST) {
      url.hostname = APEX_HOST;
      return Response.redirect(url.toString(), 301);
    }

    if (url.hostname === ASSETS_HOST && !url.pathname.startsWith("/build/")) {
      return renderErrorPage(request, env, 404);
    }

    if (!localRequest && url.hostname === APEX_HOST && isLegacyServersPath(url.pathname)) {
      return Response.redirect(serverDirectoryRedirect(url), 301);
    }

    if (localRequest) {
      if (url.pathname.startsWith("/api/")) {
        return handleServerDirectoryRequest(request, env, ctx);
      }

      const localResponse = await serveServerSurface(request, url, env, "/servers");
      return localResponse ?? env.ASSETS.fetch(request);
    }

    if (url.hostname === SERVERS_HOST) {
      if (url.pathname.startsWith("/api/")) {
        return handleServerDirectoryRequest(request, env, ctx);
      }

      const serverResponse = await serveServerSurface(request, url, env);
      return serverResponse ?? renderErrorPage(request, env, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    scheduleServerDirectoryRefresh(env, ctx);
  }
} satisfies ExportedHandler<Env>;

function isLegacyServersPath(pathname: string): boolean {
  return pathname === "/servers" || pathname === "/servers/" || pathname.startsWith("/servers/");
}

function serverDirectoryRedirect(url: URL): string {
  const redirect = new URL(url);
  redirect.hostname = SERVERS_HOST;
  redirect.pathname = redirect.pathname.replace(/^\/servers/, "") || "/";
  return redirect.toString();
}

async function serveServerSurface(request: Request, url: URL, env: Env, basePath = ""): Promise<Response | null> {
  const utilityAsset = serverUtilityAsset(url.pathname, basePath);

  if (utilityAsset) {
    const canonicalPath = `${basePath}${utilityAsset.publicPath}` || "/";

    if (url.pathname !== canonicalPath) {
      const redirect = new URL(url);
      redirect.pathname = canonicalPath;
      return Response.redirect(redirect.toString(), 301);
    }

    return fetchAsset(request, url, env, utilityAsset.assetPath);
  }

  const route = parseDirectoryRoute(url.pathname, basePath);
  return route ? serveDirectoryPage(request, url, env, route) : null;
}

function serverUtilityAsset(pathname: string, basePath: string): { publicPath: string; assetPath: string } | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized === `${basePath}/submit`) {
    return { publicPath: "/submit", assetPath: "/servers/submit.html" };
  }

  if (normalized === `${basePath}/admin`) {
    return { publicPath: "/admin", assetPath: "/servers/admin.html" };
  }

  return null;
}

function parseDirectoryRoute(pathname: string, basePath = ""): DirectoryRoute | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  let relativePath = normalized;

  if (basePath) {
    if (normalized === basePath) {
      return { status: "online", sort: "newest", page: 1, canonicalPath: basePath };
    }

    if (!normalized.startsWith(`${basePath}/`)) {
      return null;
    }

    relativePath = normalized.slice(basePath.length) || "/";
  }

  const segments = relativePath.split("/").filter(Boolean);
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
    return { status, sort, page: 1, canonicalPath: directoryPath(status, sort, 1, basePath) };
  }

  if (segments.length !== 2 || segments[0] !== "page" || !/^[1-9]\d*$/.test(segments[1])) {
    return null;
  }

  const page = Number(segments[1]);
  return page <= 10_000
    ? { status, sort, page, canonicalPath: directoryPath(status, sort, page, basePath) }
    : null;
}

function directoryPath(status: DirectoryStatus, sort: DirectorySort, page: number, basePath = ""): string {
  const segments: string[] = status === "online" ? [] : [status];

  if (sort !== "newest") {
    segments.push("sort", sort);
  }

  if (page > 1) {
    segments.push("page", String(page));
  }

  const suffix = segments.length ? `/${segments.join("/")}` : "";
  return `${basePath}${suffix}` || "/";
}

async function serveDirectoryPage(request: Request, url: URL, env: Env, route: DirectoryRoute): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        "Allow": "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (url.searchParams.has("sort")) {
    const querySort = parseDirectorySort(url.searchParams.get("sort"));
    const redirect = new URL(url);
    redirect.pathname = directoryPath(route.status, querySort, route.page, url.pathname.startsWith("/servers") ? "/servers" : "");
    redirect.searchParams.delete("sort");
    return Response.redirect(redirect.toString(), 301);
  }

  if (url.pathname !== route.canonicalPath) {
    const redirect = new URL(url);
    redirect.pathname = route.canonicalPath;
    return Response.redirect(redirect.toString(), 301);
  }

  const response = await fetchAsset(request, url, env, "/servers.html");
  const canonical = new URL(route.canonicalPath, url);
  canonical.search = "";
  canonical.hash = "";

  if (request.method === "HEAD") {
    const headers = new Headers(response.headers);
    headers.set("Link", `<${canonical.toString()}>; rel="canonical"`);
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }

  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }

  return rewriteDirectoryMetadata(response, canonical.toString(), route);
}

function parseDirectorySort(value: string | null): DirectorySort {
  return value === "players" || value === "name" ? value : "newest";
}

function fetchAsset(request: Request, url: URL, env: Env, pathname: string): Promise<Response> {
  const assetUrl = new URL(url);
  assetUrl.pathname = pathname;
  assetUrl.search = "";
  const headers = new Headers(request.headers);
  headers.delete("If-Modified-Since");
  headers.delete("If-None-Match");
  headers.delete("Range");
  return env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers }));
}

function rewriteDirectoryMetadata(response: Response, canonicalUrl: string, route: DirectoryRoute): Response {
  const statusLabel = route.status === "all" ? "All" : route.status === "offline" ? "Offline" : "Online";
  const pageLabel = route.page > 1 ? ` - Page ${route.page}` : "";
  const titlePrefix = route.status === "online" ? "Servers" : `${statusLabel} Servers`;
  const title = `${titlePrefix}${pageLabel} | KingdomsX`;
  const description = route.page > 1 ? `${SERVER_DIRECTORY_DESCRIPTION} Page ${route.page}.` : SERVER_DIRECTORY_DESCRIPTION;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Link", `<${canonicalUrl}>; rel="canonical"`);

  return new HTMLRewriter()
    .on("title", new TextContentHandler(title))
    .on('link[rel="canonical"]', new AttributeHandler("href", canonicalUrl))
    .on('link[rel="alternate"]', new AttributeHandler("href", canonicalUrl))
    .on('meta[property="og:url"]', new AttributeHandler("content", canonicalUrl))
    .on('meta[property="og:title"]', new AttributeHandler("content", title))
    .on('meta[name="twitter:title"]', new AttributeHandler("content", title))
    .on('meta[name="description"]', new AttributeHandler("content", description))
    .on('meta[property="og:description"]', new AttributeHandler("content", description))
    .on('meta[name="twitter:description"]', new AttributeHandler("content", description))
    .transform(new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
}

class AttributeHandler implements HTMLRewriterElementContentHandlers {
  constructor(private readonly attribute: string, private readonly value: string) {}

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

async function renderErrorPage(request: Request, env: Env, status: number): Promise<Response> {
  const url = new URL(request.url);
  url.hostname = APEX_HOST;
  url.pathname = `/${status}`;
  url.search = "";

  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.delete("Location");

  if (!response.body) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response(ERROR_STATUS_TEXT[status] ?? "Error", {
      status,
      statusText: ERROR_STATUS_TEXT[status] ?? response.statusText,
      headers
    });
  }

  return new Response(response.body, {
    status,
    statusText: ERROR_STATUS_TEXT[status] ?? response.statusText,
    headers
  });
}
