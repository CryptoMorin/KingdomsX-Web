import {
  createFileSession,
  fileSessionHasChanges,
  fileSessionBlob,
  renameFileSession
} from "./file-session.js";
import { isKingdomsManagedFile } from "./kingdoms-managed-files.js";
import {
  remoteOutpostPagePathEditable,
  remoteSchematicPathEditable,
  readRemoteWorkspaceContract,
  validateRemoteWorkspaceOutput
} from "./remote-workspace-manifest.js";
import { documentBytes, replaceDocumentSource } from "./yaml-source.js";

const MAX_YAML_BYTES = 10 * 1024 * 1024;
const MAX_SCHEMATIC_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1_000;
const MAX_YAML_FILES = 500;
const YAML_FILE = /\.ya?ml$/i;
const SCHEMATIC_FILE = /\.(?:schematic|schem)$/i;
const ZIP_FILE = /\.zip$/i;
const UTF8_ENCODER = new TextEncoder();

export async function openWorkspaceSelection(files) {
  const selected = [...files];

  if (!selected.length) {
    throw new Error("Choose one or more YAML files, or one ZIP archive.");
  }

  const archives = selected.filter((file) => ZIP_FILE.test(file.name));

  if (archives.length) {
    if (selected.length !== 1) {
      throw new Error("Open one ZIP archive by itself, or select YAML files without a ZIP.");
    }

    return openZipWorkspace(archives[0]);
  }

  return openYamlWorkspace(selected);
}

export async function openWorkspaceArtifact({
  name,
  bytes,
  remoteProtocol = null,
  remoteRevision = 0,
  originalBytes = null,
  remoteContract = null
}) {
  const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const artifact = artifactFromBytes(name, content);

  if (!remoteProtocol) {
    return openWorkspaceSelection([artifact]);
  }

  let contract = remoteContract;

  if (remoteRevision > 0 && !contract) {
    if (!originalBytes) {
      throw new Error("The original server config ZIP is required to check this saved version.");
    }

    const original = originalBytes instanceof Uint8Array ? originalBytes : new Uint8Array(originalBytes);
    const baseline = await openZipWorkspace(artifactFromBytes(name, original), {
      remoteProtocol,
      remoteRevision: 0
    });
    contract = baseline.remoteContract;
  }

  return openZipWorkspace(artifact, { remoteProtocol, remoteRevision, remoteContract: contract });
}

export async function restoreRemoteWorkspaceDraft(workspace, { name, bytes }) {
  if (workspace?.sourceKind !== "zip" || !workspace.remoteContract) {
    throw new Error("A local draft can only restore a server editor session.");
  }

  const draft = await openWorkspaceArtifact({
    name,
    bytes,
    remoteProtocol: workspace.remoteContract.protocol,
    remoteRevision: Math.max(1, workspace.remoteRevision),
    remoteContract: workspace.remoteContract
  });

  if (!equalBytes(draft.remoteContract.manifestBytes, workspace.remoteContract.manifestBytes)) {
    throw new Error("The local draft does not match this server editor session.");
  }

  const baselineFiles = new Map(workspace.files.map((session) => [session.fileName, session]));
  const sessions = draft.files.map((draftSession) => {
    const baseline = baselineFiles.get(draftSession.fileName);

    if (!baseline) {
      draftSession.created = true;
      draftSession.originalFileName = "";
      draftSession.exported = false;
      return draftSession;
    }

    const session = createFileSession(baseline.fileName, documentBytes(baseline.document));
    replaceDocumentSource(session.document, draftSession.document.currentText);
    return session;
  });
  const restored = createWorkspace({
    name: workspace.name,
    sourceKind: "zip",
    sessions,
    archiveEntries: draft.archiveEntries,
    remoteContract: workspace.remoteContract,
    remoteRevision: workspace.remoteRevision,
    originalArchiveBytes: workspace.originalArchiveBytes,
    originalName: workspace.originalName,
    downloadName: workspace.downloadName
  });

  restored.originalYamlEntries = new Map(
    workspace.files.map((session) => [session.fileName, documentBytes(session.document)])
  );
  restored.originalSupportEntries = new Map(workspace.originalSupportEntries);
  restored.removedFiles = new Map(
    workspace.files
      .filter((session) => !draft.files.some((candidate) => samePath(candidate.fileName, session.fileName)))
      .map((session) => [session.fileName, session.fileName])
  );
  restored.changedSupportFiles = new Set(
    draft.archiveEntries
      .filter((entry) => !YAML_FILE.test(entry.path))
      .filter((entry) => {
        const original = workspace.originalSupportEntries.get(entry.path);

        return !original || !equalBytes(original, entry.bytes);
      })
      .map((entry) => entry.path)
  );
  restored.removedSupportFiles = new Set(
    [...workspace.originalSupportEntries.keys()]
      .filter((path) => !draft.archiveEntries.some((entry) => samePath(entry.path, path)))
  );
  restored.activePath = sessions.some((session) => session.fileName === workspace.activePath)
    ? workspace.activePath
    : preferredInitialPath(sessions);

  return restored;
}

export async function exampleWorkspace() {
  const [{ defaultOptionsForResource }, { default: schematicCatalog }] = await Promise.all([
    import("./schema-registry.js"),
    import("../../../data/config-editor/addons/schematics.json")
  ]);
  const demoSettings = [
    ["config.yml", [
      "prefix", "lang", "group-levels", "disabled-worlds", "building-visuals",
      "command", "commands", "guis", "placeholders", "max-members", "kingdom-name", "creation", "nexus"
    ]],
    ["claims.yml", [
      "distance", "claim-on-create", "unclaim-cooldown", "max-claims",
      "resource-points", "money", "indicator"
    ]],
    ["declarations/building.yml"],
    ["declarations/structure.yml"],
    ["Structures/nexus.yml"],
    ["guis/structures/nexus/nexus.yml", ["title", "rows", "sound", "options"]],
    ["languages/en.yml", [
      "prefix", "chat-input", "worlds", "variables", "time-formatter",
      "date-formatter", "none", "building", "nexus", "no-kingdom"
    ]],
    ["enginehub.yml"]
  ];
  const sessions = (await Promise.all(demoSettings.map(async ([resourceName, keys]) => {
    const options = await defaultOptionsForResource(resourceName);
    const source = demoConfigSource(resourceName, options, keys);
    const fileName = resourceName === "guis/structures/nexus/nexus.yml"
      ? "guis/en/structures/nexus/nexus.yml"
      : resourceName;

    return createFileSession(fileName, UTF8_ENCODER.encode(source), true);
  }))).sort(compareSessions);
  const archiveEntries = schematicCatalog.schematics
    .filter(({ resourceName }) => /^schematics\/structures\/nexus\/[1-5]\.schematic$/.test(resourceName))
    .map(({ resourceName: path, data }) => ({ path, bytes: decodeBase64(data) }));

  return createWorkspace({
    name: "kingdomsx-demo.zip",
    sourceKind: "example",
    sessions,
    archiveEntries
  });
}

function demoConfigSource(resourceName, options, keys) {
  const roots = options.filter((option) => option.path.length === 1);
  const selected = keys ? keys.map((key) => roots.find((option) => option.path[0] === key)) : roots;

  if (!selected.length || selected.some((option) => !option)) {
    throw new Error(`The demo settings for ${resourceName} no longer match the current defaults.`);
  }

  return selected.map((option) => {
    const source = option.source.replaceAll("\r\n", "\n");
    const comments = option.comments.map((comment) => `# ${comment}\n`).join("");
    const space = source.startsWith("\n") ? "" : " ";

    return `${comments}${option.path[0]}:${space}${source}\n`;
  }).join("\n");
}

export function selectWorkspaceFile(workspace, path) {
  const session = workspace.files.find((candidate) => candidate.fileName === path);

  if (!session) {
    throw new Error("That config file is no longer open.");
  }

  workspace.activePath = session.fileName;
  return session;
}

export function workspaceSupportFiles(workspace) {
  return (workspace?.archiveEntries ?? []).filter((entry) => !YAML_FILE.test(entry.path));
}

export function workspaceSchematicFiles(workspace) {
  return workspaceSupportFiles(workspace).filter((entry) => SCHEMATIC_FILE.test(entry.path));
}

export function workspaceSchematicEditable(workspace, path) {
  return workspace?.sourceKind !== "example"
    && remoteSchematicPathEditable(workspace?.remoteContract, path);
}

export function workspaceOutpostPageEditable(workspace, path) {
  return workspace?.sourceKind !== "example"
    && remoteOutpostPagePathEditable(workspace?.remoteContract, path);
}

export async function addWorkspaceSchematic(workspace, folder, level, file, { maxLevel = null } = {}) {
  requireEditableSchematic(workspace, folder);

  const schematicLevel = Number(level);

  if (!Number.isSafeInteger(schematicLevel) || schematicLevel < 1) {
    throw new Error("A schematic level must be a positive whole number.");
  }

  if (Number.isSafeInteger(maxLevel) && schematicLevel > maxLevel) {
    throw new Error(`This building has ${maxLevel} levels. Choose level ${maxLevel} or lower.`);
  }

  const directory = safeArchivePath(String(folder ?? "").replace(/\/$/, ""));

  if (!/(?:^|\/)schematics\/(?:structures|turrets)\/[^/]+$/i.test(directory)) {
    throw new Error("That building's schematic folder could not be determined.");
  }

  const extension = schematicExtension(file?.name);
  const path = `${directory}/${schematicLevel}.${extension}`;
  const folderFiles = workspaceSchematicFiles(workspace).filter((entry) =>
    normalizedDirectory(entry.path) === directory.toLocaleLowerCase("en-US")
  );

  if (!folderFiles.length && schematicLevel !== 1) {
    throw new Error("Add the level 1 schematic first so lower building levels have a design.");
  }

  if (folderFiles.some((entry) => schematicLevelForPath(entry.path) === schematicLevel)) {
    throw new Error(`A schematic is already defined for level ${schematicLevel}.`);
  }

  const workspaceFileCount = workspace.archiveEntries.length + (workspace.sourceKind === "zip"
    ? 0
    : workspace.files.length + workspace.preservedEntries.size);

  if (workspaceFileCount >= MAX_ARCHIVE_FILES) {
    throw new Error(`The editor already has ${MAX_ARCHIVE_FILES.toLocaleString()} files open.`);
  }

  const bytes = await schematicBytes(file);
  const expandedBytes = workspace.archiveEntries.reduce((total, entry) => total + entry.bytes.byteLength, 0)
    + (workspace.sourceKind === "zip" ? 0 : standaloneWorkspaceBytes(workspace))
    + bytes.byteLength;

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error("Adding this schematic would exceed the 100 MiB ZIP limit.");
  }

  const entry = { path, bytes };
  workspace.archiveEntries.push(entry);
  workspace.removedSupportFiles.delete(path);

  const original = workspace.originalSupportEntries.get(path);

  if (original && equalBytes(original, bytes)) {
    workspace.changedSupportFiles.delete(path);
  } else {
    workspace.changedSupportFiles.add(path);
  }

  workspace.supportFilesExported = false;

  if (workspace.sourceKind !== "zip") {
    workspace.downloadName = "kingdomsx-configs-edited.zip";
  }

  return entry;
}

export async function replaceWorkspaceSchematic(workspace, path, file) {
  requireEditableSchematic(workspace, path);

  const entry = workspaceSchematicFiles(workspace).find((candidate) => samePath(candidate.path, path));

  if (!entry) {
    throw new Error("That schematic is no longer open.");
  }

  schematicExtension(file?.name);

  const bytes = await schematicBytes(file);
  const expandedBytes = workspace.archiveEntries.reduce((total, candidate) =>
    total + (candidate === entry ? bytes.byteLength : candidate.bytes.byteLength), 0)
    + (workspace.sourceKind === "zip" ? 0 : standaloneWorkspaceBytes(workspace));

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error("Replacing this schematic would exceed the 100 MiB ZIP limit.");
  }

  entry.bytes = bytes;

  const original = workspace.originalSupportEntries.get(entry.path);

  if (original && equalBytes(original, bytes)) {
    workspace.changedSupportFiles.delete(entry.path);
  } else {
    workspace.changedSupportFiles.add(entry.path);
  }

  workspace.supportFilesExported = false;
  return entry;
}

export function removeWorkspaceSchematic(workspace, path) {
  requireEditableSchematic(workspace, path);

  const index = workspace.archiveEntries.findIndex((entry) =>
    SCHEMATIC_FILE.test(entry.path) && samePath(entry.path, path)
  );

  if (index < 0) {
    throw new Error("That schematic is no longer open.");
  }

  const entry = workspace.archiveEntries[index];
  const level = schematicLevelForPath(entry.path);
  const directory = normalizedDirectory(entry.path);
  const laterLevelExists = level === 1 && workspaceSchematicFiles(workspace).some((candidate) =>
    candidate !== entry
    && normalizedDirectory(candidate.path) === directory
    && schematicLevelForPath(candidate.path) > 1
  );

  if (laterLevelExists) {
    throw new Error("Remove the later level schematics before removing level 1.");
  }

  workspace.archiveEntries.splice(index, 1);
  workspace.changedSupportFiles.delete(entry.path);

  if (workspace.originalSupportEntries.has(entry.path)) {
    workspace.removedSupportFiles.add(entry.path);
  } else {
    workspace.removedSupportFiles.delete(entry.path);
  }

  workspace.supportFilesExported = false;
  return entry;
}

export function workspaceHasChanges(workspace) {
  return workspaceChangeSummary(workspace).changes > 0;
}

export function workspaceHasUnexportedChanges(workspace) {
  return Boolean(workspace?.files.some((session) => fileSessionHasChanges(session) && !session.exported)
    || (workspace?.removedFiles.size && !workspace.removedFilesExported)
    || (workspaceSupportChangeCount(workspace) && !workspace.supportFilesExported));
}

export function workspaceChangeSummary(workspace) {
  const changedFiles = workspace?.files.filter(fileSessionHasChanges) ?? [];
  const removedFiles = workspace?.removedFiles.size ?? 0;
  const supportFiles = workspaceSupportChangeCount(workspace);

  return {
    files: changedFiles.length + removedFiles + supportFiles,
    changes: changedFiles.reduce((total, session) => total + session.document.changes.size + fileLifecycleChangeCount(session), 0)
      + removedFiles
      + supportFiles
  };
}

export function workspaceFileChanges(workspace) {
  const changes = [];

  for (const session of workspace?.files ?? []) {
    if (session.created) {
      changes.push({ kind: "File", path: session.fileName, summary: `Created ${session.fileName}.` });
    } else if (session.originalFileName !== session.fileName) {
      changes.push({
        kind: "File",
        path: session.fileName,
        summary: `Renamed ${session.originalFileName} to ${session.fileName}.`
      });
    }
  }

  for (const fileName of workspace?.removedFiles.keys() ?? []) {
    changes.push({ kind: "File", path: fileName, summary: `Deleted ${fileName}.` });
  }

  for (const path of workspace?.changedSupportFiles ?? []) {
    const action = workspace.originalSupportEntries.has(path) ? "Replaced" : "Added";
    changes.push({ kind: "Schematic", path, summary: `${action} ${path}.` });
  }

  for (const path of workspace?.removedSupportFiles ?? []) {
    changes.push({ kind: "Schematic", path, summary: `Removed ${path}.` });
  }

  return changes;
}

export function createWorkspaceFile(workspace, fileName, source) {
  const path = safeArchivePath(fileName);
  requireEditableFileSet(workspace, path);

  if (!YAML_FILE.test(path)) {
    throw new Error("A new config file must use a .yml or .yaml extension.");
  }

  if (isKingdomsManagedFile(path)) {
    throw managedFileError(path);
  }

  if (workspace.files.some((session) => samePath(session.fileName, path))) {
    throw new Error(`${path} is already open.`);
  }

  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : new Uint8Array(source);

  if (bytes.byteLength > MAX_YAML_BYTES) {
    throw new Error(`${path} is larger than the 10 MiB per-file limit.`);
  }

  const currentEntries = archiveOutputEntries(workspace, false);
  const yamlCount = Object.keys(currentEntries).filter((entryPath) => YAML_FILE.test(entryPath)).length;

  if (yamlCount >= MAX_YAML_FILES) {
    throw new Error(`The editor already has ${MAX_YAML_FILES} YAML files open.`);
  }

  if (Object.keys(currentEntries).length >= MAX_ARCHIVE_FILES) {
    throw new Error(`The editor already has ${MAX_ARCHIVE_FILES.toLocaleString()} files open.`);
  }

  const expandedBytes = Object.values(currentEntries)
    .reduce((total, entryBytes) => total + entryBytes.byteLength, bytes.byteLength);

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error("Adding this config would exceed the 100 MiB ZIP limit.");
  }

  const session = createFileSession(path, bytes);
  session.created = true;
  session.originalFileName = "";
  workspace.files.push(session);
  workspace.files.sort(compareSessions);
  workspace.activePath = path;
  workspace.removedFiles.delete(path);
  workspace.removedFilesExported = false;

  if (workspace.sourceKind !== "zip" && workspace.files.length > 1) {
    workspace.downloadName = "kingdomsx-configs-edited.zip";
  }

  return session;
}

export function removeWorkspaceFile(workspace, fileName) {
  requireEditableFileSet(workspace, fileName);

  if (workspace.files.length <= 1) {
    throw new Error("Keep at least one config file open.");
  }

  const index = workspace.files.findIndex((session) => session.fileName === fileName);

  if (index < 0) {
    throw new Error("That config file is no longer open.");
  }

  const [session] = workspace.files.splice(index, 1);

  if (!session.created) {
    workspace.removedFiles.set(session.originalFileName, session.fileName);
  }

  workspace.removedFilesExported = false;
  const next = workspace.files[Math.min(index, workspace.files.length - 1)];
  workspace.activePath = next.fileName;
  return session;
}

export function renameWorkspaceFile(workspace, fileName, nextFileName) {
  const path = safeArchivePath(nextFileName);
  requireEditableFileSet(workspace, fileName, path);

  if (workspace?.remoteContract && normalizedDirectory(fileName) !== normalizedDirectory(path)) {
    throw new Error("An outpost page cannot be moved outside its declared server editor folder.");
  }

  if (isKingdomsManagedFile(path)) {
    throw managedFileError(path);
  }

  const session = workspace.files.find((candidate) => candidate.fileName === fileName);

  if (!session) {
    throw new Error("That config file is no longer open.");
  }

  if (workspace.files.some((candidate) => candidate !== session && samePath(candidate.fileName, path))) {
    throw new Error(`${path} is already open.`);
  }

  renameFileSession(session, path);
  workspace.files.sort(compareSessions);

  if (workspace.activePath === fileName) {
    workspace.activePath = path;
  }

  return session;
}

export async function workspaceDownloadArtifact(workspace) {
  const [onlySession] = workspace.files;
  const remainsSingleOriginal = workspace.files.length === 1
    && workspace.sourceKind === "file"
    && workspace.removedFiles.size === 0
    && workspace.changedSupportFiles.size === 0
    && !onlySession.created
    && onlySession.originalFileName === onlySession.fileName;

  if (remainsSingleOriginal) {
    const [session] = workspace.files;
    const bytes = documentBytes(session.document);

    if (bytes.byteLength > MAX_YAML_BYTES) {
      throw new Error(`${session.fileName} is larger than the 10 MiB per-file limit.`);
    }

    return { blob: fileSessionBlob(session), name: session.downloadName };
  }

  if (workspace.sourceKind === "zip" && !workspaceHasChanges(workspace)) {
    return {
      blob: new Blob([workspace.originalArchiveBytes], { type: "application/zip" }),
      name: workspace.downloadName
    };
  }

  const entries = archiveOutputEntries(workspace, false);
  validateWorkspaceOutputLimits(entries);
  await validateRemoteWorkspaceOutput(workspace, entries);

  const bytes = await zipArchive(entries);

  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("The edited ZIP archive is larger than the 25 MiB upload limit.");
  }

  return {
    blob: new Blob([bytes], { type: "application/zip" }),
    name: workspace.downloadName
  };
}

export async function workspaceOriginalArtifact(workspace) {
  if (workspace.sourceKind === "zip") {
    return {
      blob: new Blob([workspace.originalArchiveBytes], { type: "application/zip" }),
      name: originalArchiveName(workspace.originalName)
    };
  }

  if (workspace.originalYamlEntries.size === 1) {
    const [[fileName, bytes]] = workspace.originalYamlEntries;

    return {
      blob: new Blob([bytes], { type: "text/yaml;charset=utf-8" }),
      name: fileName.replace(/(\.ya?ml)$/i, "-original$1")
    };
  }

  return {
    blob: new Blob([await zipArchive(archiveOutputEntries(workspace, true))], { type: "application/zip" }),
    name: "kingdomsx-configs-original.zip"
  };
}

export async function downloadWorkspace(workspace) {
  const artifact = await workspaceDownloadArtifact(workspace);
  downloadBlob(artifact.blob, artifact.name);
  markWorkspaceSaved(workspace);
  return artifact.name;
}

export async function workspaceRecoveryArtifact(workspace, codeDraft = null) {
  const currentEntries = archiveOutputEntries(workspace, false);
  const entries = Object.create(null);

  for (const [path, bytes] of Object.entries(currentEntries)) {
    if (path !== "kingdomsx-editor.json") {
      entries[`configs/${path}`] = bytes;
    }
  }

  const instructions = [
    "KingdomsX editor recovery backup",
    "",
    "Downloading this backup does not save or apply anything to your server.",
    "The configs/ folder contains your current workspace files at their original paths.",
    "Run /k admin editor to open a fresh session with the current server files.",
    "Compare the backup with those files and manually recover the changes you want to keep."
  ];

  if (codeDraft) {
    const path = safeArchivePath(codeDraft.fileName);
    entries[`pending-code/${path}.txt`] = UTF8_ENCODER.encode(codeDraft.source);
    instructions.push(
      "",
      "The pending-code/ folder contains unapplied Code-mode text, which may be invalid YAML.",
      "This text is separate from configs/ and has not been applied to its corresponding config.",
      "Review and fix it before manually recovering it in a fresh session."
    );
  }

  const removedPaths = [
    ...workspace.originalYamlEntries.keys(),
    ...workspace.originalSupportEntries.keys()
  ].filter((path) => path !== "kingdomsx-editor.json" && !Object.hasOwn(currentEntries, path));

  if (removedPaths.length) {
    instructions.push(
      "",
      "These files were removed or renamed in this workspace:",
      ...removedPaths.map((path) => `- ${path}`),
      "Review these paths separately if you want to recover those deletions."
    );
  }

  entries["README.txt"] = UTF8_ENCODER.encode(`${instructions.join("\n")}\n`);

  return {
    blob: new Blob([await zipArchive(entries)], { type: "application/zip" }),
    name: "kingdomsx-configs-recovery.zip"
  };
}

export async function downloadWorkspaceRecovery(workspace, codeDraft = null) {
  const artifact = await workspaceRecoveryArtifact(workspace, codeDraft);
  downloadBlob(artifact.blob, artifact.name);
  return artifact.name;
}

function markWorkspaceSaved(workspace) {
  workspace.files.forEach((session) => {
    if (fileSessionHasChanges(session)) {
      session.exported = true;
    }
  });
  workspace.removedFilesExported = true;
  workspace.supportFilesExported = true;
}

export function acceptRemoteWorkspaceSave(workspace, archiveBytes, revision) {
  if (workspace?.sourceKind !== "zip" || !workspace.remoteContract || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Only a saved server result can become the editor's new unchanged version.");
  }

  const entries = archiveOutputEntries(workspace, false);
  workspace.archiveEntries = Object.entries(entries).map(([path, bytes]) => ({ path, bytes }));
  workspace.originalArchiveBytes = archiveBytes instanceof Uint8Array ? archiveBytes : new Uint8Array(archiveBytes);
  workspace.remoteRevision = revision;
  workspace.originalYamlEntries = new Map();
  workspace.originalSupportEntries = new Map();

  for (const session of workspace.files) {
    const bytes = documentBytes(session.document);
    session.originalFileName = session.fileName;
    session.created = false;
    session.exported = false;
    session.document.originalBytes = bytes;
    session.document.originalText = session.document.currentText;
    session.document.originalIndex = session.document.index;
    session.document.changes.clear();
    workspace.originalYamlEntries.set(session.fileName, bytes);
  }

  for (const [path, bytes] of Object.entries(entries)) {
    if (!YAML_FILE.test(path)) {
      workspace.originalSupportEntries.set(path, bytes);
    }
  }

  workspace.changedSupportFiles.clear();
  workspace.removedSupportFiles.clear();
  workspace.removedFiles.clear();
  workspace.supportFilesExported = false;
  workspace.removedFilesExported = false;
}

export async function downloadOriginalWorkspace(workspace) {
  const artifact = await workspaceOriginalArtifact(workspace);
  downloadBlob(artifact.blob, artifact.name);
  return artifact.name;
}

async function openYamlWorkspace(files) {
  if (files.length > MAX_YAML_FILES) {
    throw new Error(`Choose no more than ${MAX_YAML_FILES} YAML files at once.`);
  }

  let totalBytes = 0;
  const paths = new Set();
  const sessions = [];
  const preservedEntries = new Map();

  for (const file of files) {
    if (!YAML_FILE.test(file.name)) {
      throw new Error(`${file.name} is not a .yml or .yaml config file.`);
    }

    if (file.size > MAX_YAML_BYTES) {
      throw new Error(`${file.name} is larger than the 10 MiB per-file limit.`);
    }

    totalBytes += file.size;

    if (totalBytes > MAX_EXPANDED_BYTES) {
      throw new Error("The selected YAML files are larger than the 100 MiB limit.");
    }

    const path = safeArchivePath(file.webkitRelativePath || file.name);
    const identity = path.toLocaleLowerCase("en-US");

    if (paths.has(identity)) {
      throw new Error(`The selection contains more than one file named ${path}.`);
    }

    paths.add(identity);

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (!isKingdomsManagedFile(path)) {
      sessions.push(createFileSession(path, bytes));
    } else {
      preservedEntries.set(path, bytes);
    }
  }

  if (!sessions.length) {
    throw managedFileError(files[0]?.name ?? "globals.yml");
  }

  sessions.sort(compareSessions);
  return createWorkspace({
    name: files.length === 1 ? sessions[0].fileName : `${files.length} config files`,
    sourceKind: files.length === 1 ? "file" : "files",
    sessions,
    preservedEntries
  });
}

async function openZipWorkspace(file, {
  remoteProtocol = null,
  remoteRevision = 0,
  remoteContract: trustedRemoteContract = null
} = {}) {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error("This ZIP archive is larger than the 25 MiB upload limit.");
  }

  const originalArchiveBytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractWorkspaceArchive(originalArchiveBytes);
  let remoteContract = null;

  if (remoteProtocol) {
    if (trustedRemoteContract) {
      if (trustedRemoteContract.protocol !== remoteProtocol) {
        throw new Error("This editor session uses a version that is not supported.");
      }

      await validateRemoteWorkspaceOutput(
        { remoteContract: trustedRemoteContract },
        Object.fromEntries(extracted.map((entry) => [entry.path, entry.bytes]))
      );
      remoteContract = trustedRemoteContract;
    } else {
      if (remoteRevision !== 0) {
        throw new Error("The original server config ZIP is required to check this saved version.");
      }

      remoteContract = await readRemoteWorkspaceContract(extracted, remoteProtocol);
    }
  }

  const yamlEntries = extracted.filter((entry) => YAML_FILE.test(entry.path));

  if (!yamlEntries.length) {
    throw new Error("This ZIP archive does not contain any .yml or .yaml config files.");
  }

  if (yamlEntries.length > MAX_YAML_FILES) {
    throw new Error(`This ZIP archive contains more than ${MAX_YAML_FILES} YAML files.`);
  }

  const sessions = yamlEntries
    .filter((entry) => !isKingdomsManagedFile(entry.path))
    .map((entry) => createFileSession(entry.path, entry.bytes))
    .sort(compareSessions);

  if (!sessions.length) {
    throw managedFileError(yamlEntries[0]?.path ?? "globals.yml");
  }

  return createWorkspace({
    name: file.name,
    sourceKind: "zip",
    sessions,
    archiveEntries: extracted,
    remoteContract,
    remoteRevision,
    originalArchiveBytes,
    originalName: file.name,
    downloadName: editedArchiveName(file.name)
  });
}

function artifactFromBytes(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function createWorkspace({
  name,
  sourceKind,
  sessions,
  archiveEntries = [],
  remoteContract = null,
  remoteRevision = 0,
  preservedEntries = new Map(),
  originalArchiveBytes = null,
  originalName = "",
  downloadName = ""
}) {
  return {
    name,
    sourceKind,
    files: sessions,
    activePath: preferredInitialPath(sessions),
    archiveEntries,
    remoteContract,
    remoteRevision,
    preservedEntries,
    originalArchiveBytes,
    originalName,
    originalYamlEntries: new Map([
      ...preservedEntries,
      ...sessions.map((session) => [session.fileName, session.document.originalBytes])
    ]),
    originalSupportEntries: new Map(
      archiveEntries
        .filter((entry) => !YAML_FILE.test(entry.path))
        .map((entry) => [entry.path, entry.bytes])
    ),
    changedSupportFiles: new Set(),
    removedSupportFiles: new Set(),
    supportFilesExported: false,
    removedFiles: new Map(),
    removedFilesExported: false,
    downloadName: downloadName || (
      sourceKind === "file" && sessions.length === 1
        ? sessions[0].downloadName
        : "kingdomsx-configs-edited.zip"
    )
  };
}

function preferredInitialPath(sessions) {
  return sessions.find((session) => session.fileName.toLocaleLowerCase("en-US") === "config.yml")?.fileName
    ?? sessions.find((session) => session.fileName.toLocaleLowerCase("en-US").endsWith("/config.yml"))?.fileName
    ?? sessions[0]?.fileName
    ?? "";
}

function compareSessions(left, right) {
  return left.fileName.localeCompare(right.fileName, "en-US", { numeric: true, sensitivity: "base" });
}

function decodeBase64(value) {
  const binary = globalThis.atob(value);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function extractWorkspaceArchive(bytes) {
  const { Unzip, UnzipInflate, UnzipPassThrough } = await import("fflate");

  return new Promise((resolve, reject) => {
    const entries = [];
    const paths = new Map();
    const activeFiles = new Set();
    let fileCount = 0;
    let declaredBytes = 0;
    let expandedBytes = 0;
    let pendingFiles = 0;
    let inputFinished = false;
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      activeFiles.forEach((file) => file.terminate?.());
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const finish = () => {
      if (settled || !inputFinished || pendingFiles) {
        return;
      }

      settled = true;
      resolve(entries);
    };

    const archive = new Unzip((file) => {
      if (settled) {
        return;
      }

      let path;

      try {
        path = safeArchivePath(file.name);

        if (path.endsWith("/")) {
          file.ondata = (error) => {
            if (error) {
              fail(new Error(`This ZIP archive could not be opened: ${error.message}`));
            }
          };
          return;
        }

        fileCount += 1;
        declaredBytes += file.originalSize ?? 0;

        if (fileCount > MAX_ARCHIVE_FILES) {
          throw new Error(`This ZIP archive contains more than ${MAX_ARCHIVE_FILES.toLocaleString()} files.`);
        }

        if (declaredBytes > MAX_EXPANDED_BYTES) {
          throw new Error("This ZIP expands beyond the 100 MiB limit.");
        }

        if (YAML_FILE.test(path) && (file.originalSize ?? 0) > MAX_YAML_BYTES) {
          throw new Error(`${path} is larger than the 10 MiB per-file limit.`);
        }

        if (SCHEMATIC_FILE.test(path) && (file.originalSize ?? 0) > MAX_SCHEMATIC_BYTES) {
          throw new Error(`${path} is larger than the 25 MiB per-file limit.`);
        }

        const identity = path.toLocaleLowerCase("en-US");

        if (paths.has(identity)) {
          throw new Error(`This ZIP archive contains the path ${path} more than once.`);
        }

        paths.set(identity, path);
      } catch (error) {
        fail(error);
        return;
      }

      const chunks = [];
      let fileBytes = 0;
      pendingFiles += 1;
      activeFiles.add(file);
      file.ondata = (error, chunk, final) => {
        if (settled) {
          return;
        }

        if (error) {
          fail(new Error(`This ZIP archive could not be opened: ${error.message}`));
          return;
        }

        fileBytes += chunk.length;
        expandedBytes += chunk.length;

        if (expandedBytes > MAX_EXPANDED_BYTES) {
          fail(new Error("This ZIP expands beyond the 100 MiB limit."));
          return;
        }

        if (YAML_FILE.test(path) && fileBytes > MAX_YAML_BYTES) {
          fail(new Error(`${path} is larger than the 10 MiB per-file limit.`));
          return;
        }

        if (SCHEMATIC_FILE.test(path) && fileBytes > MAX_SCHEMATIC_BYTES) {
          fail(new Error(`${path} is larger than the 25 MiB per-file limit.`));
          return;
        }

        chunks.push(chunk);

        if (final) {
          activeFiles.delete(file);
          pendingFiles -= 1;
          entries.push({ path, bytes: joinChunks(chunks, fileBytes) });
          finish();
        }
      };

      try {
        file.start();
      } catch (error) {
        fail(new Error(`This ZIP archive uses an unsupported compression method: ${error.message}`));
      }
    });

    archive.register(UnzipPassThrough);
    archive.register(UnzipInflate);

    try {
      archive.push(bytes, true);
      inputFinished = true;
      finish();
    } catch (error) {
      fail(new Error(`This ZIP archive could not be opened: ${error.message}`));
    }
  });
}

function joinChunks(chunks, size) {
  if (chunks.length === 1 && chunks[0].length === size) {
    return chunks[0];
  }

  const output = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function safeArchivePath(input) {
  const path = String(input).replaceAll("\\", "/");

  if (!path || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error("The selection contains an unsafe or invalid file path.");
  }

  const directory = path.endsWith("/");
  const body = directory ? path.slice(0, -1) : path;
  const segments = body.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`The path ${path} is not safe to open.`);
  }

  return directory ? `${body}/` : body;
}

function archiveOutputEntries(workspace, originals) {
  const entries = Object.create(null);

  if (originals) {
    for (const [path, bytes] of workspace.originalYamlEntries) {
      entries[path] = bytes;
    }

    for (const [path, bytes] of workspace.originalSupportEntries) {
      entries[path] = bytes;
    }

    return entries;
  }

  if (workspace.sourceKind === "zip") {
    for (const entry of workspace.archiveEntries) {
      entries[entry.path] = entry.bytes;
    }
  } else {
    for (const [path, bytes] of workspace.preservedEntries) {
      entries[path] = bytes;
    }

    for (const entry of workspace.archiveEntries) {
      entries[entry.path] = entry.bytes;
    }
  }

  for (const path of workspace.removedFiles.keys()) {
    delete entries[path];
  }

  for (const session of workspace.files) {
    if (!session.created && session.originalFileName !== session.fileName) {
      delete entries[session.originalFileName];
    }
  }

  for (const session of workspace.files) {
    entries[session.fileName] = documentBytes(session.document);
  }

  return entries;
}

function validateWorkspaceOutputLimits(entries) {
  const files = Object.entries(entries);

  if (files.length > MAX_ARCHIVE_FILES) {
    throw new Error(`The edited ZIP contains more than ${MAX_ARCHIVE_FILES.toLocaleString()} files.`);
  }

  const yamlFiles = files.filter(([path]) => YAML_FILE.test(path));

  if (yamlFiles.length > MAX_YAML_FILES) {
    throw new Error(`The edited ZIP contains more than ${MAX_YAML_FILES} YAML files.`);
  }

  let expandedBytes = 0;

  for (const [path, bytes] of files) {
    expandedBytes += bytes.byteLength;

    if (YAML_FILE.test(path) && bytes.byteLength > MAX_YAML_BYTES) {
      throw new Error(`${path} is larger than the 10 MiB per-file limit.`);
    }

    if (SCHEMATIC_FILE.test(path) && bytes.byteLength > MAX_SCHEMATIC_BYTES) {
      throw new Error(`${path} is larger than the 25 MiB per-file limit.`);
    }
  }

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error("The edited ZIP is larger than the 100 MiB expanded limit.");
  }
}

function fileLifecycleChangeCount(session) {
  return session.created || session.originalFileName !== session.fileName ? 1 : 0;
}

function workspaceSupportChangeCount(workspace) {
  return (workspace?.changedSupportFiles.size ?? 0) + (workspace?.removedSupportFiles.size ?? 0);
}

function requireEditableSchematic(workspace, path) {
  if (!workspaceSchematicEditable(workspace, path)) {
    throw new Error("That schematic folder is not editable in this server editor session.");
  }
}

function requireEditableFileSet(workspace, ...paths) {
  if (paths.some((path) => !workspaceOutpostPageEditable(workspace, path))) {
    throw new Error("Only declared outpost page folders can add, remove, or rename YAML files in a server editor session.");
  }
}

function samePath(left, right) {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return left.every((byte, index) => byte === right[index]);
}

function schematicExtension(fileName) {
  const match = /\.(schematic|schem)$/i.exec(String(fileName ?? ""));

  if (!match) {
    throw new Error("Choose a .schematic or .schem file.");
  }

  return match[1].toLocaleLowerCase("en-US");
}

async function schematicBytes(file) {
  if (file.size > MAX_SCHEMATIC_BYTES) {
    throw new Error("This schematic is larger than the 25 MiB per-file limit.");
  }

  return new Uint8Array(await file.arrayBuffer());
}

function normalizedDirectory(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/");

  return normalized.slice(0, normalized.lastIndexOf("/")).toLocaleLowerCase("en-US");
}

function schematicLevelForPath(path) {
  const match = /\/([1-9]\d*)\.(?:schematic|schem)$/i.exec(String(path ?? "").replaceAll("\\", "/"));

  return Number.parseInt(match?.[1] ?? "0", 10);
}

function standaloneWorkspaceBytes(workspace) {
  return workspace.files.reduce((total, session) => total + documentBytes(session.document).byteLength, 0)
    + [...workspace.preservedEntries.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
}

function managedFileError(fileName) {
  return new Error(`${fileName} is managed by KingdomsX and cannot be edited here.`);
}

async function zipArchive(entries) {
  const { zip } = await import("fflate");

  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) {
        reject(new Error(`The config ZIP could not be created: ${error.message}`));
      } else {
        resolve(data);
      }
    });
  });
}

function editedArchiveName(name) {
  return name.replace(/\.zip$/i, "-edited.zip");
}

function originalArchiveName(name) {
  return name.replace(/\.zip$/i, "-original.zip");
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
