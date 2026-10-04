import { randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import {
  decryptRemotePayload,
  deriveRemoteEditorSecrets,
  encryptRemotePayload,
  REMOTE_PAYLOAD_KIND,
  sha256Hex
} from "../../src/assets/scripts/config-editor/remote-session-crypto.js";
import {
  readRemoteWorkspaceContract,
  validateRemoteWorkspaceOutput
} from "../../src/assets/scripts/config-editor/remote-workspace-manifest.js";
import { isKingdomsManagedFile } from "../../src/assets/scripts/config-editor/kingdoms-managed-files.js";
import { extractWorkspaceArchive } from "../../src/assets/scripts/config-editor/workspace-session.js";

const DEFAULT_ORIGIN = "http://localhost:8788";
const DEFAULT_SOURCE = "updates:\n  check: false\n";
const MANIFEST_PATH = "kingdomsx-editor.json";
const YAML_FILE = /\.ya?ml$/i;
const SCHEMATIC_FILE = /^(?:(.+)\/)?schematics\/(structures|turrets)\/([^/]+)\/([1-9]\d*)\.(?:schematic|schem)$/i;
const BUILDING_CONFIG = /^(?:(.+)\/)?(Structures|Turrets)\/([^/]+)\.ya?ml$/i;
const OUTPOST_PAGE = /^(?:(.+)\/)?guis\/[^/]+\/structures\/outpost\/[1-9]\d*\.ya?ml$/i;
const MAX_YAML_BYTES = 10 * 1024 * 1024;
const MAX_SCHEMATIC_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1_000;
const MAX_YAML_FILES = 500;
const EDITOR_SOCKET_PROTOCOL = "kingdomsx-editor-v1";
const encoder = new TextEncoder();

async function runLocalEditorSession(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const source = await loadWorkspaceSource(options.filePath);
  const session = await createSession(options.origin, source);
  const outputDirectory = await createOutputDirectory(options.outputDirectory);
  const monitoring = new AbortController();

  const stop = () => {
    monitoring.abort();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log("\nLocal KingdomsX plugin simulator is ready.");
  console.log(`Selected ${source.yamlCount.toLocaleString()} configuration files and ${source.schematicCount.toLocaleString()} schematics.`);
  console.log(`\nPrivate local editor link:\n${session.link}\n`);
  console.log(`Applied revisions will be written under:\n${outputDirectory}`);
  console.log("The source file is never overwritten. Press Ctrl+C to stop monitoring.\n");

  try {
    await monitorSession(options.origin, session, outputDirectory, monitoring.signal);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }

  console.log("Local plugin monitoring stopped. The relay session will expire on its own.");
}

async function monitorSession(origin, session, outputDirectory, signal) {
  const url = new URL(`/socket/editor/v1/sessions/${session.id}`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url, [
    EDITOR_SOCKET_PROTOCOL,
    `kingdomsx-editor-cap.server.${session.serverToken}`
  ]);

  await new Promise((resolve, reject) => {
    let terminalState = "";
    let processing = Promise.resolve();
    let settled = false;

    const settle = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", stop);
      error ? reject(error) : resolve();
    };

    const stop = () => {
      socket.close(1000, "Local monitoring stopped");
      settle();
    };

    signal.addEventListener("abort", stop, { once: true });

    if (signal.aborted) {
      stop();
      return;
    }

    socket.addEventListener("message", (event) => {
      processing = processing.then(async () => {
        const snapshot = JSON.parse(await socketMessageText(event.data));

        if (snapshot?.type !== "session" || snapshot.protocol !== 1) {
          return;
        }

        if (snapshot.state === "result_ready") {
          await applyRevision(origin, session, snapshot.resultRevision, outputDirectory);
          return;
        }

        if (["cancelled", "expired", "conflicted"].includes(snapshot.state)) {
          terminalState = snapshot.state;
          console.log(`The local editor session ended with state: ${snapshot.state}.`);
          socket.close(1000, "Editor session ended");
        }
      }).catch((error) => {
        socket.close(1011, "Local apply failed");
        settle(error);
      });
    });
    socket.addEventListener("close", () => {
      processing.then(() => {
        if (signal.aborted || terminalState) {
          settle();
        } else {
          settle(new Error("The live editor session connection closed unexpectedly. Restart the local session simulator."));
        }
      }, settle);
    });
    socket.addEventListener("error", () => {
      settle(new Error(`Could not open the live editor session connection at ${url.origin}. Is the production preview running?`));
    });
  });
}

async function socketMessageText(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }

  if (typeof data?.text === "function") {
    return data.text();
  }

  throw new Error("The local editor Worker sent an unsupported session message.");
}

function parseOptions(args) {
  let filePath = "";
  let origin = DEFAULT_ORIGIN;
  let outputDirectory = "";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--origin" || argument === "--output-dir") {
      const value = args[index + 1];

      if (!value) {
        throw new Error(`Expected a value after ${argument}.`);
      }

      if (argument === "--origin") {
        origin = normalizeOrigin(value);
      } else {
        outputDirectory = path.resolve(value);
      }

      index += 1;
      continue;
    }

    if (argument.startsWith("--origin=")) {
      origin = normalizeOrigin(argument.slice("--origin=".length));
      continue;
    }

    if (argument.startsWith("--output-dir=")) {
      const value = argument.slice("--output-dir=".length);

      if (!value) {
        throw new Error("Expected a non-empty --output-dir value.");
      }

      outputDirectory = path.resolve(value);
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown local editor session option: ${argument}`);
    }

    if (filePath) {
      throw new Error("Expected at most one YAML file, ZIP archive, or directory path.");
    }

    filePath = path.resolve(argument);
  }

  return { filePath, origin, outputDirectory };
}

async function loadWorkspaceSource(filePath) {
  if (!filePath) {
    return buildWorkspaceSource("kingdomsx-local-preview.zip", new Map([
      ["config.yml", encoder.encode(DEFAULT_SOURCE)]
    ]));
  }

  const details = await lstat(filePath);

  if (details.isSymbolicLink()) {
    throw new Error("The local session source cannot be a symbolic link.");
  }

  if (details.isDirectory()) {
    return buildWorkspaceSource(`${path.basename(filePath)}.zip`, await readWorkspaceDirectory(filePath));
  }

  if (!details.isFile()) {
    throw new Error("The local session source must be a YAML file, ZIP archive, or directory.");
  }

  const bytes = new Uint8Array(await readFile(filePath));

  if (YAML_FILE.test(filePath)) {
    if (!bytes.byteLength) {
      throw new Error("The YAML file is empty.");
    }

    return buildWorkspaceSource(`${path.basename(filePath)}.zip`, new Map([[path.basename(filePath), bytes]]));
  }

  if (/\.zip$/i.test(filePath)) {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error("The ZIP archive exceeds the 25 MiB editor limit.");
    }

    const extracted = await extractWorkspaceArchive(bytes);

    return buildWorkspaceSource(path.basename(filePath), new Map(extracted.map((entry) => [entry.path, entry.bytes])));
  }

  throw new Error("The local session simulator accepts a Kingdoms data directory, ZIP archive, or one YAML file.");
}

async function createSession(origin, source) {
  const linkSeed = secret(32);
  const { id, key, browserToken } = await deriveRemoteEditorSecrets(linkSeed);
  const serverToken = secret(32);
  const files = await Promise.all([...source.entries].map(async ([entryPath, bytes]) => ({
    path: entryPath,
    sha256: await sha256Hex(bytes)
  })));
  const manifest = encoder.encode(JSON.stringify({
    protocol: 1,
    pluginVersion: "local-preview",
    files,
    capabilities: source.capabilities
  }));
  const archiveEntries = Object.create(null);

  for (const [entryPath, bytes] of source.entries) {
    archiveEntries[entryPath] = bytes;
  }

  archiveEntries[MANIFEST_PATH] = manifest;

  const archive = zipSync(archiveEntries);

  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("The selected server config ZIP exceeds the 25 MiB limit.");
  }

  const remoteContract = await readRemoteWorkspaceContract(
    Object.entries(archiveEntries).map(([entryPath, bytes]) => ({ path: entryPath, bytes })),
    1
  );
  const encryptedOriginal = await encryptRemotePayload(archive, {
    sessionId: id,
    key,
    kind: REMOTE_PAYLOAD_KIND.original,
    revision: 0
  });

  await apiJson(origin, id, "", {
    method: "PUT",
    headers: {
      "CF-Connecting-IP": "127.0.0.1",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      protocol: 1,
      name: source.name,
      pluginVersion: "local-preview",
      serverTokenHash: await tokenHash(serverToken),
      browserTokenHash: await tokenHash(browserToken),
      original: {
        bytes: encryptedOriginal.byteLength,
        sha256: await sha256Hex(encryptedOriginal)
      }
    })
  });
  await apiJson(origin, id, "payloads/original", {
    method: "PUT",
    headers: await payloadHeaders(serverToken, encryptedOriginal),
    body: encryptedOriginal
  });

  return {
    id,
    key,
    serverToken,
    remoteContract,
    link: `${origin}/#s/v1/${linkSeed}`
  };
}

async function applyRevision(origin, session, revision, outputDirectory) {
  const snapshot = await apiJson(origin, session.id, "", {
    headers: authorization(session.serverToken)
  });

  if (snapshot.state !== "result_ready" || snapshot.resultRevision !== revision) {
    return;
  }

  console.log(`Revision ${revision} received. Simulating server validation and apply…`);
  await applyEvent(origin, session, revision, "started");

  try {
    const response = await api(origin, session.id, `payloads/result/${revision}`, {
      headers: authorization(session.serverToken)
    });
    const encrypted = new Uint8Array(await response.arrayBuffer());
    const archive = await decryptRemotePayload(encrypted, {
      sessionId: session.id,
      key: session.key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision
    });
    const entries = await extractWorkspaceArchive(archive);

    await validateResult(entries, session);

    const revisionDirectory = path.join(outputDirectory, `revision-${revision}`);

    await mkdir(revisionDirectory);

    for (const entry of entries) {
      if (entry.path === MANIFEST_PATH) {
        continue;
      }

      const destination = path.join(revisionDirectory, ...entry.path.split("/"));

      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, entry.bytes, { flag: "wx" });
    }

    await applyEvent(origin, session, revision, "applied");
    console.log(`Revision ${revision} acknowledged as applied: ${revisionDirectory}`);
  } catch (error) {
    await applyEvent(origin, session, revision, "failed", "local_preview_failed").catch(() => {});
    throw error;
  }
}

async function validateResult(entries, session) {
  await validateRemoteWorkspaceOutput({ remoteContract: session.remoteContract }, Object.fromEntries(
    entries.map((entry) => [entry.path, entry.bytes])
  ));
}

async function readWorkspaceDirectory(root) {
  const entries = new Map();

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        throw new Error(`The local session source contains a symbolic link: ${absolutePath}`);
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

      if (!YAML_FILE.test(relativePath) && !/\.(?:schematic|schem)$/i.test(relativePath)) {
        continue;
      }

      entries.set(relativePath, new Uint8Array(await readFile(absolutePath)));
    }
  }

  await walk(root);

  return entries;
}

function buildWorkspaceSource(name, availableEntries) {
  if (availableEntries.has(MANIFEST_PATH)) {
    throw new Error(`The local session source already contains the reserved ${MANIFEST_PATH} entry.`);
  }

  const yamlEntries = [...availableEntries]
    .filter(([entryPath]) => YAML_FILE.test(entryPath) && !isKingdomsManagedFile(entryPath));

  if (!yamlEntries.length) {
    throw new Error("The local session source does not contain editable YAML files.");
  }

  if (yamlEntries.length > MAX_YAML_FILES) {
    throw new Error(`The local session source contains more than ${MAX_YAML_FILES} YAML files.`);
  }

  const yamlByIdentity = new Map(yamlEntries.map(([entryPath]) => [identity(entryPath), entryPath]));
  const schematicDirectories = buildingCapabilities(yamlEntries);
  const schematicDirectoryIdentities = new Set(schematicDirectories.map((entry) => identity(entry.path)));
  const schematicEntries = [...availableEntries].filter(([entryPath]) => {
    const match = SCHEMATIC_FILE.exec(entryPath);

    if (!match) {
      return false;
    }

    return schematicDirectoryIdentities.has(identity(entryPath.slice(0, entryPath.lastIndexOf("/"))));
  });
  const outpostPageDirectories = [...new Set(yamlEntries.flatMap(([entryPath]) => {
    const match = OUTPOST_PAGE.exec(entryPath);

    return match ? [entryPath.slice(0, entryPath.lastIndexOf("/"))] : [];
  }))];
  const entries = new Map([...yamlEntries, ...schematicEntries].sort(([left], [right]) =>
    left.localeCompare(right, "en-US", { numeric: true, sensitivity: "base" })
  ));

  validateSelectedEntries(entries, yamlByIdentity);

  return {
    name,
    entries,
    yamlCount: yamlEntries.length,
    schematicCount: schematicEntries.length,
    capabilities: { schematicDirectories, outpostPageDirectories }
  };
}

function buildingCapabilities(yamlEntries) {
  return yamlEntries.flatMap(([config]) => {
    const match = BUILDING_CONFIG.exec(config);

    if (!match) {
      return [];
    }

    const [, prefix = "", family, building] = match;
    const directory = [prefix, "schematics", family.toLocaleLowerCase("en-US"), building]
      .filter(Boolean)
      .join("/");

    return [{ path: directory, config }];
  });
}

function validateSelectedEntries(entries, yamlByIdentity) {
  if (entries.size > MAX_ARCHIVE_FILES - 1) {
    throw new Error(`The selected server config ZIP contains more than ${(MAX_ARCHIVE_FILES - 1).toLocaleString()} files.`);
  }

  let expandedBytes = 0;
  const identities = new Set();

  for (const [entryPath, bytes] of entries) {
    const entryIdentity = identity(entryPath);

    if (identities.has(entryIdentity)) {
      throw new Error(`The local session source contains ${entryPath} more than once.`);
    }

    identities.add(entryIdentity);

    if (YAML_FILE.test(entryPath) && bytes.byteLength > MAX_YAML_BYTES) {
      throw new Error(`${entryPath} exceeds the 10 MiB YAML limit.`);
    }

    if (!YAML_FILE.test(entryPath) && bytes.byteLength > MAX_SCHEMATIC_BYTES) {
      throw new Error(`${entryPath} exceeds the 25 MiB schematic limit.`);
    }

    expandedBytes += bytes.byteLength;
  }

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error("The selected server config ZIP exceeds the 100 MiB expanded limit.");
  }

  if (yamlByIdentity.size !== [...entries.keys()].filter((entryPath) => YAML_FILE.test(entryPath)).length) {
    throw new Error("The local session source contains configuration paths that differ only by letter case.");
  }
}

function identity(value) {
  return value.toLocaleLowerCase("en-US");
}

async function createOutputDirectory(parent) {
  if (parent) {
    await mkdir(parent, { recursive: true });
    return mkdtemp(path.join(parent, "kingdomsx-editor-session-"));
  }

  return mkdtemp(path.join(tmpdir(), "kingdomsx-editor-session-"));
}

async function applyEvent(origin, session, revision, outcome, failureCode) {
  return apiJson(origin, session.id, "apply", {
    method: "POST",
    headers: {
      ...authorization(session.serverToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ revision, outcome, ...(failureCode ? { failureCode } : {}) })
  });
}

function authorization(token) {
  return { Authorization: `KingdomsX-Editor ${token}` };
}

async function payloadHeaders(token, bytes) {
  return {
    ...authorization(token),
    "Content-Type": "application/octet-stream",
    "X-KingdomsX-Payload-Bytes": String(bytes.byteLength),
    "X-KingdomsX-Payload-Sha256": await sha256Hex(bytes)
  };
}

async function apiJson(origin, id, route, init) {
  const response = await api(origin, id, route, init);

  return response.json();
}

async function api(origin, id, route, init = {}) {
  let response;

  try {
    response = await fetch(`${origin}/api/editor/v1/sessions/${id}${route ? `/${route}` : ""}`, init);
  } catch (error) {
    throw new Error(`Could not reach the local editor Worker at ${origin}. Is the production preview running?`, {
      cause: error
    });
  }

  if (response.ok) {
    return response;
  }

  let message = `The local editor Worker returned HTTP ${response.status}.`;

  try {
    message = (await response.json()).message ?? message;
  } catch {}

  throw new Error(message);
}

function normalizeOrigin(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid editor origin: ${value}`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid editor origin: ${value}`);
  }

  if (url.pathname !== "/") {
    throw new Error("The editor origin must not include a path.");
  }

  return url.origin;
}

function tokenHash(token) {
  return sha256Hex(encoder.encode(token));
}

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runLocalEditorSession();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
