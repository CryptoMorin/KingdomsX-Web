import { JSON_HEADERS, MAX_JSON_BODY_BYTES, PUBLIC_JSON_HEADERS } from "../config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readJsonObject(
  request: Request,
  optional = false,
  maxBytes = MAX_JSON_BODY_BYTES
): Promise<Record<string, unknown>> {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader ?? "0");

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, "Request body is too large.");
  }

  if (optional && contentLengthHeader === "0") {
    return {};
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    (!optional || (contentLengthHeader && contentLength > 0)) &&
    !contentType.startsWith("application/json")
  ) {
    throw new ApiError(415, "Content-Type must be application/json.");
  }

  const text = await readBoundedRequestText(request, maxBytes);

  if (!text && optional) {
    return {};
  }

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

async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) {
    return "";
  }

  // Cap the stream ourselves because Content-Length is untrusted
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
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

        throw new ApiError(413, "Request body is too large.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

export function json(data: unknown, status = 200, headers: HeadersInit = JSON_HEADERS): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

export function publicJson(data: unknown, status = 200): Response {
  return json(data, status, PUBLIC_JSON_HEADERS);
}

export function stringField(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  required = true
): string {
  const rawValue = typeof source[key] === "string" ? source[key] : "";

  if (rawValue.length > maxLength)
    throw new ApiError(400, `${key} is too long.`);

  const value = rawValue.trim();

  if (!value && required)
    return "";

  return value;
}
