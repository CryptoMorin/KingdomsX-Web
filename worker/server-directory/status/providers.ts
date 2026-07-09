const STATUS_PROVIDER_TIMEOUT_MS = 8_000;
const STATUS_ICON_MAX_BYTES = 64 * 1024;

export interface StatusSnapshot {
  online: boolean;
  playersOnline: number | null;
  playersMax: number | null;
  motdText: string | null;
  versionName: string | null;
  favicon: string | null;
  provider: string;
}

export async function fetchServerStatus(
  address: string,
  onProviderFailure?: (error: unknown) => void
): Promise<StatusSnapshot> {
  const providers = [
    fetchMcsrvstatStatus,
    fetchMcstatusStatus,
    fetchMinecraftPingerStatus,
    fetchMcapiStatus
  ];
  let lastError: unknown;

  for (const provider of providers) {
    try {
      return await provider(address);
    } catch (error) {
      lastError = error;
      onProviderFailure?.(error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All status providers failed.");
}

async function fetchStatusJson(
  url: URL | string,
  provider: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "KingdomsX-Web/1.0 server-directory"
    },
    signal: AbortSignal.timeout(STATUS_PROVIDER_TIMEOUT_MS),
    cf: { cacheTtl: 300, cacheEverything: true }
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`${provider} returned ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data)) {
    throw new Error(`${provider} returned unusable JSON`);
  }

  return data;
}

async function fetchMcapiStatus(address: string): Promise<StatusSnapshot> {
  const { host, port } = statusAddressParts(address);
  const url = new URL("https://mcapi.us/server/status");

  url.searchParams.set("ip", host);
  url.searchParams.set("port", String(port));

  const data = await fetchStatusJson(url, "mcapi.us");
  const status = typeof data.status === "string" ? data.status : "";
  const error = typeof data.error === "string" ? data.error.trim() : "";

  if (status !== "success" || error) {
    throw new Error(`mcapi.us did not return a clean status${error ? `: ${error}` : ""}`);
  }

  const players = isRecord(data.players) ? data.players : {};
  const server = isRecord(data.server) ? data.server : {};

  return {
    online: data.online === true,
    playersOnline: numberOrNull(players.now),
    playersMax: numberOrNull(players.max),
    motdText: cleanStatusText(data.motd, 500),
    versionName: cleanStatusText(server.name, 100),
    favicon: validatedStatusIcon(data.favicon),
    provider: "mcapi.us"
  };
}

async function fetchMcsrvstatStatus(address: string): Promise<StatusSnapshot> {
  const data = await fetchStatusJson(
    `https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`,
    "mcsrvstat.us"
  );

  if (typeof data.online !== "boolean") {
    throw new Error("mcsrvstat returned an uncertain status");
  }

  const players = isRecord(data.players) ? data.players : {};
  const motd = isRecord(data.motd) ? data.motd : {};
  const protocol = isRecord(data.protocol) ? data.protocol : {};
  const motdClean = Array.isArray(motd.clean)
    ? motd.clean.filter((item): item is string => typeof item === "string").join(" ")
    : null;
  const version = cleanStatusText(data.version, 100) ?? cleanStatusText(protocol.name, 100);

  return {
    online: data.online,
    playersOnline: numberOrNull(players.online),
    playersMax: numberOrNull(players.max),
    motdText: motdClean?.slice(0, 500) ?? null,
    versionName: version,
    favicon: validatedStatusIcon(data.icon),
    provider: "mcsrvstat.us"
  };
}

async function fetchMcstatusStatus(address: string): Promise<StatusSnapshot> {
  const url = new URL(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(address)}`);

  url.searchParams.set("query", "false");
  url.searchParams.set("timeout", "5");

  const data = await fetchStatusJson(url, "mcstatus.io");

  if (typeof data.online !== "boolean") {
    throw new Error("mcstatus.io returned an uncertain status");
  }

  const players = isRecord(data.players) ? data.players : {};
  const version = isRecord(data.version) ? data.version : {};
  const motd = isRecord(data.motd) ? data.motd : {};

  return {
    online: data.online,
    playersOnline: numberOrNull(players.online),
    playersMax: numberOrNull(players.max),
    motdText: cleanStatusText(motd.clean, 500),
    versionName: cleanStatusText(version.name_clean, 100) ?? cleanStatusText(version.name_raw, 100),
    favicon: validatedStatusIcon(data.icon),
    provider: "mcstatus.io"
  };
}

async function fetchMinecraftPingerStatus(address: string): Promise<StatusSnapshot> {
  const data = await fetchStatusJson(
    `https://www.minecraftpinger.com/api/v1/${encodeURIComponent(address)}`,
    "minecraftpinger.com"
  );

  if (data.server === null) {
    return {
      online: false,
      playersOnline: null,
      playersMax: null,
      motdText: null,
      versionName: null,
      favicon: null,
      provider: "minecraftpinger.com"
    };
  }

  if (!isRecord(data.server)) {
    throw new Error("minecraftpinger.com returned an uncertain status");
  }

  const players = isRecord(data.server.players) ? data.server.players : {};

  return {
    online: true,
    playersOnline: numberOrNull(players.online),
    playersMax: numberOrNull(players.max),
    motdText: cleanStatusText(data.server.motd, 500),
    versionName: cleanStatusText(data.server.version, 100),
    favicon: validatedStatusIcon(data.server.favicon),
    provider: "minecraftpinger.com"
  };
}

function statusAddressParts(address: string): { host: string; port: number } {
  const [host, portValue] = address.split(":");
  const port = Number(portValue ?? 25565);

  return { host, port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 25565 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanStatusText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.slice(0, maxLength) : null;
}

export function validatedStatusIcon(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const icon = value.trim();
  const prefix = "data:image/png;base64,";

  if (!icon.startsWith(prefix) || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon)) {
    return null;
  }

  try {
    const bytes = atob(icon.slice(prefix.length));
    const pngSignature = "\x89PNG\r\n\x1a\n";

    if (
      bytes.length > STATUS_ICON_MAX_BYTES ||
      bytes.slice(0, pngSignature.length) !== pngSignature
    ) {
      return null;
    }

    return icon;
  } catch {
    return null;
  }
}
