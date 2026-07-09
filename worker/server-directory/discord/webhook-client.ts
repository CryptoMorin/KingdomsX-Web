import { DISCORD_API_TIMEOUT_MS, DISCORD_JOB_MAX_ATTEMPTS } from "../config";
import { isRecord } from "../core/http";

export function parseDiscordWebhookUrl(value: string | undefined, purpose = "embed"): string {
  const candidate = value?.trim();

  if (!candidate) {
    throw new DiscordDeliveryError(
      "not_configured",
      `Discord ${purpose} is not configured.`,
      false
    );
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new DiscordDeliveryError(
      "invalid_configuration",
      `Discord ${purpose} webhook configuration is invalid.`,
      false
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new DiscordDeliveryError(
      "invalid_configuration",
      `Discord ${purpose} webhook configuration is invalid.`,
      false
    );
  }

  const match = url.pathname.match(/\/webhooks\/(\d+)\/([^/]+)/);

  if (!match) {
    throw new DiscordDeliveryError(
      "invalid_configuration",
      `Discord ${purpose} webhook configuration is invalid.`,
      false
    );
  }

  return `https://discord.com/api/v10/webhooks/${match[1]}/${match[2]}`;
}

export async function discordFetch(
  url: string,
  method: string,
  payload: Record<string, unknown> | null,
  creation: boolean
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_API_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      headers: payload ? { "content-type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    // A timed out create may have reached Discord
    // Retrying it blindly could create a duplicate message
    if (creation)
      throw error;

    throw new DiscordDeliveryError("network_error", "Discord request failed.", true, error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function deleteDiscordWebhookMessage(
  webhook: string,
  messageId: string,
  operation: string
): Promise<void> {
  const response = await discordFetch(
    `${webhook}/messages/${encodeURIComponent(messageId)}`,
    "DELETE",
    null,
    false
  );

  if (response.status !== 404) {
    await requireDiscordSuccess(response, operation);
  }

  await cancelResponseBody(response);
}

export async function requireDiscordSuccess(response: Response, operation: string): Promise<void> {
  if (response.ok)
    return;

  if (response.status === 429) {
    const body = await readBoundedDiscordJson(response);
    const retryAfter = Number(response.headers.get("retry-after") ?? body.retry_after ?? "0");

    throw new DiscordDeliveryError(
      "rate_limited",
      "Discord rate limited the embed request.",
      true,
      undefined,
      retryAfter
    );
  }

  if (response.status >= 500) {
    await cancelResponseBody(response);

    throw new DiscordDeliveryError(
      "discord_unavailable",
      "Discord is temporarily unavailable.",
      true
    );
  }

  const configurationFailure = response.status === 401 || response.status === 403 || response.status === 404;

  await cancelResponseBody(response);

  throw new DiscordDeliveryError(
    configurationFailure ? "invalid_webhook" : "invalid_payload",
    configurationFailure
      ? "Discord webhook access failed."
      : `Discord rejected the ${operation} payload.`,
    false
  );
}

export async function readBoundedDiscordJson(response: Response): Promise<Record<string, unknown>> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");

  if (contentLength > 32_768)
    return {};

  try {
    const value: unknown = await response.json();

    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The outcome is already known
    // A cancellation failure must not change delivery state
  }
}

export class DiscordDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
    readonly retryAfterSeconds = 0
  ) {
    super(message);
    this.name = "DiscordDeliveryError";
  }
}

type DiscordFailureSchedule = {
  failure: DiscordDeliveryError;
  attempts: number;
  permanent: boolean;
  nextAttemptAt: string;
};

export function discordFailureSchedule(
  error: unknown,
  currentAttempts: number,
  unexpectedMessage: string
): DiscordFailureSchedule {
  const failure =
    error instanceof DiscordDeliveryError
      ? error
      : new DiscordDeliveryError("unexpected_error", unexpectedMessage, true, error);
  const attempts = currentAttempts + 1;
  const permanent = !failure.retryable || attempts >= DISCORD_JOB_MAX_ATTEMPTS;
  const baseSeconds =
    failure.retryAfterSeconds > 0
      ? failure.retryAfterSeconds
      : Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7));
  const jitter = crypto.getRandomValues(new Uint16Array(1))[0] % 11;

  // Permanent failures stay visible in the outbox without being selected again
  const nextAttemptAt = permanent
    ? "9999-12-31T23:59:59.999Z"
    : new Date(Date.now() + (baseSeconds + jitter) * 1000).toISOString();

  return { failure, attempts, permanent, nextAttemptAt };
}
