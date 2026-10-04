import { sha256Hex } from "./remote-session-crypto.js";

const REMOTE_WORKSPACE_MANIFEST = "kingdomsx-editor.json";

const YAML_FILE = /\.ya?ml$/i;
const SCHEMATIC_FILE = /\.(?:schematic|schem)$/i;
const SCHEMATIC_DIRECTORY = /^(?:(.+)\/)?schematics\/(structures|turrets)\/([^/]+)$/i;
const SCHEMATIC_LEVEL_FILE = /^([1-9]\d*)\.(?:schematic|schem)$/i;
const OUTPOST_PAGE_DIRECTORY = /^(?:(.+)\/)?guis\/[^/]+\/structures\/outpost$/i;
const OUTPOST_PAGE_FILE = /^[1-9]\d*\.ya?ml$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export async function readRemoteWorkspaceContract(entries, expectedProtocol) {
  if (expectedProtocol !== 1) {
    throw new Error("This editor session uses a version that is not supported.");
  }

  const manifestEntry = entries.find((entry) => entry.path === REMOTE_WORKSPACE_MANIFEST);

  if (!manifestEntry) {
    throw new Error(`The server did not include ${REMOTE_WORKSPACE_MANIFEST}.`);
  }

  let manifest;

  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(manifestEntry.bytes);
    manifest = JSON.parse(source);
  } catch {
    throw new Error(`The server sent an invalid ${REMOTE_WORKSPACE_MANIFEST}.`);
  }

  if (!plainObject(manifest) || manifest.protocol !== expectedProtocol) {
    throw new Error("The server sent editor data in a format that is not supported.");
  }

  if (typeof manifest.pluginVersion !== "string" || !manifest.pluginVersion.trim()) {
    throw new Error("The server did not include its KingdomsX version.");
  }

  const files = declaredFiles(manifest.files);
  const yamlFiles = new Map([...files].filter(([path]) => YAML_FILE.test(path)));
  const schematicFiles = new Map([...files].filter(([path]) => SCHEMATIC_FILE.test(path)));

  if (!yamlFiles.size) {
    throw new Error("The server did not include any editable YAML files.");
  }

  const capabilities = declaredCapabilities(manifest.capabilities, yamlFiles);

  for (const path of schematicFiles.keys()) {
    if (!remoteSchematicPathEditable({ schematicDirectories: capabilities.schematicDirectories }, path)) {
      throw new Error(`The server did not mark the schematic folder for ${path} as editable.`);
    }
  }

  const contract = {
    protocol: expectedProtocol,
    pluginVersion: manifest.pluginVersion,
    files,
    yamlFiles,
    schematicFiles,
    ...capabilities,
    manifestBytes: manifestEntry.bytes.slice()
  };

  const archiveFiles = new Map(entries.map((entry) => [entry.path, entry.bytes]));

  const expectedPaths = new Set([REMOTE_WORKSPACE_MANIFEST, ...files.keys()]);
  const undeclared = entries.find((entry) => !expectedPaths.has(entry.path));

  if (undeclared) {
    throw new Error(`The server sent an unexpected file: ${undeclared.path}.`);
  }

  const missing = [...expectedPaths].find((path) => !archiveFiles.has(path));

  if (missing) {
    throw new Error(`The server did not include ${missing}.`);
  }

  validateRemoteEntries(contract, archiveFiles);
  await Promise.all([...files].map(async ([path, expectedHash]) => {
    const actualHash = await sha256Hex(archiveFiles.get(path));

    if (actualHash !== expectedHash) {
      throw new Error(`${path} does not match the file list sent by the server.`);
    }
  }));

  return contract;
}

export async function validateRemoteWorkspaceOutput(workspace, entries) {
  const contract = workspace?.remoteContract;

  if (!contract) {
    return;
  }

  const output = new Map(Object.entries(entries));
  validateRemoteEntries(contract, output);

  if (!equalBytes(output.get(REMOTE_WORKSPACE_MANIFEST), contract.manifestBytes)) {
    throw new Error("The server's editor file list cannot be changed.");
  }
}

export function remoteSchematicPathEditable(contract, path) {
  if (!contract) {
    return true;
  }

  const normalized = manifestPath(String(path ?? "").replace(/\/(?:[1-9]\d*)\.(?:schematic|schem)$/i, ""));

  return contract.schematicDirectories.has(identity(normalized));
}

export function remoteOutpostPagePathEditable(contract, path) {
  if (!contract) {
    return true;
  }

  const normalized = manifestPath(path);
  const separator = normalized.lastIndexOf("/");

  if (separator < 0 || !OUTPOST_PAGE_FILE.test(normalized.slice(separator + 1))) {
    return false;
  }

  return contract.outpostPageDirectories.has(identity(normalized.slice(0, separator)));
}

function declaredFiles(value) {
  if (!Array.isArray(value)) {
    throw new Error("The server sent an invalid editor file list.");
  }

  const files = new Map();
  const identities = new Set();

  for (const entry of value) {
    if (!plainObject(entry) || typeof entry.path !== "string" || !SHA256.test(entry.sha256)) {
      throw new Error("The server sent invalid information for one of its editor files.");
    }

    const path = manifestPath(entry.path);

    if ((!YAML_FILE.test(path) && !SCHEMATIC_FILE.test(path)) || path === REMOTE_WORKSPACE_MANIFEST) {
      throw new Error("The server sent invalid information for one of its editor files.");
    }

    const pathIdentity = identity(path);

    if (identities.has(pathIdentity)) {
      throw new Error(`The server listed ${path} more than once.`);
    }

    identities.add(pathIdentity);
    files.set(path, entry.sha256);
  }

  return files;
}

function declaredCapabilities(value, yamlFiles) {
  if (!plainObject(value)) {
    throw new Error("The server sent invalid editor permissions.");
  }

  const schematicDirectories = declaredSchematicDirectories(value.schematicDirectories, yamlFiles);
  const outpostPageDirectories = declaredOutpostPageDirectories(value.outpostPageDirectories, yamlFiles);

  return { schematicDirectories, outpostPageDirectories };
}

function declaredSchematicDirectories(value, yamlFiles) {
  if (!Array.isArray(value)) {
    throw new Error("The server sent an invalid schematic folder list.");
  }

  const directories = new Map();

  for (const entry of value) {
    if (!plainObject(entry) || typeof entry.path !== "string" || typeof entry.config !== "string") {
      throw new Error("The server sent invalid information for a schematic folder.");
    }

    const path = manifestPath(entry.path);
    const config = manifestPath(entry.config);
    const details = SCHEMATIC_DIRECTORY.exec(path);

    if (!details || !YAML_FILE.test(config) || !yamlFiles.has(config) || !schematicConfigMatches(details, config)) {
      throw new Error("The server sent invalid information for a schematic folder.");
    }

    const pathIdentity = identity(path);

    if (directories.has(pathIdentity)) {
      throw new Error(`The server listed ${path} more than once.`);
    }

    directories.set(pathIdentity, { path, config });
  }

  return directories;
}

function declaredOutpostPageDirectories(value, yamlFiles) {
  if (!Array.isArray(value)) {
    throw new Error("The server sent an invalid outpost page folder list.");
  }

  const directories = new Map();

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("The server sent invalid information for an outpost page folder.");
    }

    const path = manifestPath(entry);
    const pathIdentity = identity(path);
    const includesPage = [...yamlFiles.keys()].some((file) => directChild(file, path, OUTPOST_PAGE_FILE));

    if (!OUTPOST_PAGE_DIRECTORY.test(path) || !includesPage) {
      throw new Error("The server sent invalid information for an outpost page folder.");
    }

    if (directories.has(pathIdentity)) {
      throw new Error(`The server listed ${path} more than once.`);
    }

    directories.set(pathIdentity, path);
  }

  return directories;
}

function validateRemoteEntries(contract, output) {
  const manifest = output.get(REMOTE_WORKSPACE_MANIFEST);

  if (!(manifest instanceof Uint8Array)) {
    throw new Error(`The server did not include ${REMOTE_WORKSPACE_MANIFEST}.`);
  }

  for (const path of output.keys()) {
    if (path === REMOTE_WORKSPACE_MANIFEST) {
      continue;
    }

    if (YAML_FILE.test(path)) {
      if (contract.yamlFiles.has(path) || remoteOutpostPagePathEditable(contract, path)) {
        continue;
      }
    } else if (SCHEMATIC_FILE.test(path) && remoteSchematicPathEditable(contract, path)) {
      continue;
    }

    throw new Error(`${path} cannot be added to this server editor session.`);
  }

  for (const path of contract.yamlFiles.keys()) {
    if (remoteOutpostPagePathEditable(contract, path)) {
      continue;
    }

    if (!output.has(path)) {
      throw new Error(`${path} cannot be removed from this server editor session.`);
    }
  }

  for (const directory of contract.outpostPageDirectories.values()) {
    const pages = [...output.keys()].filter((path) => directChild(path, directory, OUTPOST_PAGE_FILE));

    if (!pages.length) {
      throw new Error(`${directory} must keep at least one outpost page.`);
    }
  }

  for (const { path: directory } of contract.schematicDirectories.values()) {
    const levels = new Set();

    for (const path of output.keys()) {
      if (!directChild(path, directory, SCHEMATIC_LEVEL_FILE)) {
        continue;
      }

      const level = Number.parseInt(path.slice(directory.length + 1), 10);

      if (levels.has(level)) {
        throw new Error(`${directory} contains more than one schematic for level ${level}.`);
      }

      levels.add(level);
    }

    if (levels.size && !levels.has(1)) {
      throw new Error(`${directory} must include a level 1 schematic before later levels.`);
    }
  }
}

function schematicConfigMatches(directoryDetails, config) {
  const [, prefix = "", family, building] = directoryDetails;
  const configFamily = family.toLocaleLowerCase("en-US") === "turrets" ? "Turrets" : "Structures";
  const expected = [prefix, configFamily, `${building}.yml`].filter(Boolean).join("/");
  const expectedLong = expected.replace(/\.yml$/i, ".yaml");

  return [expected, expectedLong].some((path) => identity(path) === identity(config));
}

function directChild(path, directory, pattern) {
  const prefix = `${directory}/`;

  if (!identity(path).startsWith(identity(prefix))) {
    return false;
  }

  const relative = path.slice(prefix.length);

  return !relative.includes("/") && pattern.test(relative);
}

function manifestPath(value) {
  const path = String(value ?? "");

  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error("The server sent an unsafe or invalid editor file path.");
  }

  if (path.endsWith("/") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("The server sent an unsafe or invalid editor file path.");
  }

  return path;
}

function identity(value) {
  return value.toLocaleLowerCase("en-US");
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || left.byteLength !== right.byteLength) {
    return false;
  }

  return left.every((byte, index) => byte === right[index]);
}
