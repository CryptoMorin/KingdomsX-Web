import { NO_STORE_JSON_HEADERS, PRIVATE_IPV4_RANGES } from "../config";
import { ApiError, json } from "./http";

export function parsePortField(value: unknown): number | null {
  if (value === undefined || value === null || value === "")
    return null;

  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";

  if (!/^\d{1,5}$/.test(text))
    throw new ApiError(400, "Server port is invalid.");

  const port = Number(text);

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ApiError(400, "Server port is invalid.");

  return port;
}

export function normalizeAddress(
  value: string,
  explicitPort: number | null = null
): { ok: true; host: string; port: number; address: string } | { ok: false; error: string } {
  const raw = value.trim().toLowerCase();

  if (
    !raw ||
    raw.length > 255 ||
    raw.includes("/") ||
    raw.includes("@") ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return { ok: false, error: "Use a plain Minecraft address, not a URL." };
  }

  const ipv6Match = raw.match(/^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i);

  if (ipv6Match || isIpv6Literal(raw)) {
    return {
      ok: false,
      error: "Use a public hostname or IPv4 address; IPv6 literals are not supported."
    };
  }

  const parts = ipv6Match ? [ipv6Match[1], ipv6Match[2] ?? "25565"] : raw.split(":");

  if (!ipv6Match && parts.length > 2)
    return { ok: false, error: "IPv6 addresses must use [address]:port format." };

  if (explicitPort !== null && parts.length > 1)
    return { ok: false, error: "Use Address and Port fields separately." };

  const host = (parts[0] ?? "").replace(/\.$/, "");
  const port = explicitPort ?? Number(parts[1] ?? 25565);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, error: "Server port is invalid." };

  if (isBlockedHost(host))
    return { ok: false, error: "Private, reserved, and local addresses are not allowed." };

  if (!isValidHost(host))
    return { ok: false, error: "Server hostname is invalid." };

  return { ok: true, host, port, address: port === 25565 ? host : `${host}:${port}` };
}

export function isBlockedHost(host: string): boolean {
  const blockedSuffixes = [".localhost", ".local", ".internal", ".invalid", ".test", ".example"];

  if (
    ["localhost", "localhost.localdomain", "internal", "invalid", "test", "example"].includes(
      host
    ) ||
    blockedSuffixes.some((suffix) => host.endsWith(suffix))
  )
    return true;

  if (
    isIpv6Literal(host) &&
    (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))
  )
    return true;

  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host));
}

export function isIpv6Literal(host: string): boolean {
  return /^[0-9a-f:]+$/i.test(host) && host.includes(":");
}

function isValidHost(host: string): boolean {
  if (isIpv6Literal(host))
    return host.length <= 45;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host))
    return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);

  return (
    host.includes(".") &&
    /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/.test(host)
  );
}

export function optionalUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed)
    return null;

  try {
    const url = new URL(trimmed);
    const publicProtocol = url.protocol === "https:" || url.protocol === "http:";
    const hasCredentials = Boolean(url.username || url.password);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    const publicHost = !isIpv6Literal(hostname) && !isBlockedHost(hostname);

    return publicProtocol && !hasCredentials && publicHost ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateSameOriginMutation(request: Request, url: URL): Response | null {
  if (!["POST", "PATCH", "DELETE"].includes(request.method))
    return null;

  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase() ?? "";

  // Only reject Origin / Sec-Fetch-Site when the client actually sent them
  if (origin && origin !== url.origin)
    return json(
      { error: "Cross-origin API mutations are not allowed." },
      403,
      NO_STORE_JSON_HEADERS
    );

  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none")
    return json({ error: "Cross-site API mutations are not allowed." }, 403, NO_STORE_JSON_HEADERS);

  return null;
}
