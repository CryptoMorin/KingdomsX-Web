export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function problem(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

export async function discardRequestBody(request: Request): Promise<void> {
  if (!request.body || request.body.locked) {
    return;
  }

  try {
    await request.body.cancel();
  } catch {}
}

export function logUnexpectedError(operation: string, error: unknown): void {
  const knownErrorNames = ["Error", "TypeError", "RangeError", "SyntaxError"];
  const errorName = error instanceof Error && knownErrorNames.includes(error.name)
    ? error.name
    : error instanceof Error ? "Error" : typeof error;

  console.error(JSON.stringify({
    event: "editor_session_unexpected_error",
    operation,
    error: errorName
  }));
}

export async function readJson<T>(request: Request, maxBytes = 8 * 1024): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? "0");

  if (length > maxBytes) {
    throw new RequestProblem(413, "request_too_large", "The request body is too large.");
  }

  let text = "";

  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
          await reader.cancel("Request body is too large.");
          throw new RequestProblem(413, "request_too_large", "The request body is too large.");
        }

        text += decoder.decode(value, { stream: true });
      }

      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RequestProblem(400, "invalid_json", "The request body must be valid JSON.");
  }
}

export class RequestProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
