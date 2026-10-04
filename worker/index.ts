const APEX_HOST = "kingdomsx.com";
const WWW_HOST = "www.kingdomsx.com";
const ASSETS_HOST = "assets.kingdomsx.com";
const SERVERS_HOST = "servers.kingdomsx.com";
const EDITOR_ORIGIN = "https://editor.kingdomsx.com";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === WWW_HOST) {
      url.hostname = APEX_HOST;
      return Response.redirect(url.toString(), 301);
    }

    if (url.hostname === ASSETS_HOST && !url.pathname.startsWith("/build/")) {
      return renderNotFound(request, env);
    }

    if (url.hostname === APEX_HOST && isLegacyServersPath(url.pathname)) {
      return Response.redirect(serverDirectoryRedirect(url), 301);
    }

    if (url.hostname === APEX_HOST && isLegacyEditorPath(url.pathname)) {
      const editorUrl = new URL(EDITOR_ORIGIN);
      editorUrl.search = url.search;
      return Response.redirect(editorUrl.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Cloudflare.Env>;

function isLegacyServersPath(pathname: string): boolean {
  return (
    pathname === "/servers" ||
    pathname === "/servers/" ||
    pathname === "/servers.html" ||
    pathname.startsWith("/servers/")
  );
}

function isLegacyEditorPath(pathname: string): boolean {
  return pathname === "/editor" || pathname === "/editor/" || pathname === "/editor.html";
}

function serverDirectoryRedirect(url: URL): string {
  const redirect = new URL(url);
  redirect.hostname = SERVERS_HOST;
  redirect.pathname = redirect.pathname.replace(/^\/servers/, "") || "/";
  redirect.pathname = normalizeServerHtmlPath(redirect.pathname);
  return redirect.toString();
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

async function renderNotFound(
  request: Request,
  env: Cloudflare.Env
): Promise<Response> {
  const url = new URL(request.url);
  url.hostname = APEX_HOST;
  url.pathname = "/404";
  url.search = "";

  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.delete("Location");

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
