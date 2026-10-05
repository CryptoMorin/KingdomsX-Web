import { EditorSession, validateCreateSession } from "./editor-session";
import { EditorAdmission } from "./editor-admission";
import { type CreateSessionRequest } from "./contracts";
import { discardRequestBody, logUnexpectedError, problem, readJson, RequestProblem } from "./http";

export { EditorAdmission, EditorSession };

const API_ROUTE = /^\/api\/editor\/v1\/sessions\/([A-Za-z0-9_-]{22})(?:\/.*)?$/;
const SOCKET_ROUTE = /^\/socket\/editor\/v1\/sessions\/([A-Za-z0-9_-]{22})$/;

async function fetchEditorRequest(request: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(request.url);
  const api = API_ROUTE.exec(url.pathname);
  const socket = SOCKET_ROUTE.exec(url.pathname);
  const route = api ?? socket;

  if (route) {
    const id = route[1];

    if (api && request.method === "PUT" && url.pathname === `/api/editor/v1/sessions/${id}`) {
      const limited = await creationAllowed(request, env.EDITOR_SESSION_CREATES);

      if (!limited) {
        return problem(429, "rate_limited", "Too many editor sessions were created from this connection.");
      }

      let input: CreateSessionRequest;

      try {
        input = await readJson<CreateSessionRequest>(request);
        validateCreateSession(input);
      } catch (error) {
        await discardRequestBody(request);

        if (error instanceof RequestProblem) {
          return problem(error.status, error.code, error.message);
        }

        logUnexpectedError("create_session", error);
        return problem(500, "internal_error", "The editor session could not process this request.");
      }

      const headers = new Headers(request.headers);
      headers.delete("Content-Length");

      return env.EDITOR_SESSIONS.getByName(id).fetch(new Request(request, {
        headers,
        body: JSON.stringify(input)
      }));
    } else {
      const limited = await sessionTrafficAllowed(request, id, env.EDITOR_SESSION_TRAFFIC);

      if (!limited) {
        return problem(429, "rate_limited", "Too many requests were made for this editor session.");
      }
    }

    return env.EDITOR_SESSIONS.getByName(id).fetch(request);
  }

  if (url.pathname.startsWith("/api/editor/") || url.pathname.startsWith("/socket/editor/")) {
    return problem(404, "not_found", "That editor endpoint does not exist.");
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch: fetchEditorRequest
} satisfies ExportedHandler<Cloudflare.Env>;

async function creationAllowed(request: Request, limiter: RateLimit): Promise<boolean> {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";

  return (await limiter.limit({ key: address })).success;
}

async function sessionTrafficAllowed(request: Request, id: string, limiter: RateLimit): Promise<boolean> {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";
  const [session, addressResult] = await Promise.all([
    limiter.limit({ key: `session:${id}` }),
    limiter.limit({ key: `address:${address}` })
  ]);

  return session.success && addressResult.success;
}
