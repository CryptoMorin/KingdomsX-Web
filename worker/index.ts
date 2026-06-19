interface StaticAssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: StaticAssetsBinding;
}

const APEX_HOST = "kingdomsx.com";
const WWW_HOST = "www.kingdomsx.com";
const ASSETS_HOST = "assets.kingdomsx.com";
const ERROR_STATUS_TEXT: Record<number, string> = {
  403: "Forbidden",
  404: "Not Found"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === WWW_HOST) {
      url.hostname = APEX_HOST;
      return Response.redirect(url.toString(), 301);
    }

    if (url.hostname === ASSETS_HOST && !url.pathname.startsWith("/build/")) {
      return renderErrorPage(request, env, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

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
