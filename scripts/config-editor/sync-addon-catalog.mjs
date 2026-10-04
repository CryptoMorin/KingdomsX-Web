import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { strFromU8, unzipSync } from "fflate";
import { parse } from "yaml";
import { indexYamlSource } from "../../src/assets/scripts/config-editor/yaml-source.js";
import {
  buildProfileSignature,
  profileFileName,
  profileOption,
  safeFileName
} from "./profile-snapshot.mjs";
import { normalizeSchemaSource } from "./schema-snapshot.mjs";

const GITHUB_SOURCE = {
  repository: "CryptoMorin/KingdomsX",
  ref: "master"
};
const ADDONS = [
  { id: "admin-tools", artifactName: "Kingdoms-Addon-Admin-Tools" },
  { id: "enginehub", artifactName: "Kingdoms-Addon-EngineHub" },
  { id: "map-viewers", artifactName: "Kingdoms-Addon-Map-Viewers" },
  { id: "outposts", artifactName: "Kingdoms-Addon-Outposts" },
  { id: "peace-treaties", artifactName: "Kingdoms-Addon-Peace-Treaties" }
];
const FILE_MATCHERS = [
  { pattern: "enginehub.yml", schemaId: "addons/enginehub" },
  { pattern: "maps/map.yml", schemaId: "addons/maps/map" },
  { pattern: "maps/*.yml", schemaId: "addons/maps/marker" },
  { pattern: "outposts.yml", schemaId: "addons/outposts" },
  { pattern: "peace-treaties.yml", schemaId: "addons/peace-treaties" }
];
const SYNTHETIC_SCHEMAS = [
  {
    id: "addons/enginehub",
    resourceName: "enginehub.yml",
    addonId: "enginehub",
    reason: "The addon ships a default file without a schema. Its typed fields are derived from that default and its comments."
  },
  {
    id: "addons/outposts",
    resourceName: "outposts.yml",
    addonId: "outposts",
    reason: "The addon creates this runtime data file after an outpost is configured. Its structure is supplied by the editor's Outposts data contract."
  }
];
const ENGINEHUB_SCHEMATIC = /^schematics\/(?:structures|turrets)\/[^/]+\/[1-9]\d*\.schematic$/i;

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = path.join(repositoryRoot, "src/data/config-editor/addons");
const mode = process.argv[2] ?? "write";

if (!new Set(["write", "check"]).has(mode)) {
  fail("Usage: sync-addon-catalog.mjs [write|check]");
}

const commit = await fetchGitHubJson(`/commits/${encodeURIComponent(GITHUB_SOURCE.ref)}`);

if (!/^[0-9a-f]{40}$/.test(commit.sha ?? "")) {
  fail("GitHub returned an invalid KingdomsX commit identifier.");
}

const tree = await fetchGitHubJson(`/git/trees/${commit.sha}?recursive=1`);

if (tree.truncated || !Array.isArray(tree.tree)) {
  fail("GitHub returned an incomplete KingdomsX repository tree.");
}

const artifactEntries = ADDONS.map((addon) => {
  const pattern = new RegExp(`^addons/${escapeRegExp(addon.artifactName)}-[^/]+\\.jar$`);
  const matches = tree.tree.filter((entry) => entry.type === "blob" && pattern.test(entry.path));

  if (matches.length !== 1) {
    fail(`Expected one ${addon.artifactName} JAR in KingdomsX/addons, found ${matches.length}.`);
  }

  return { ...addon, entry: matches[0] };
});

const artifacts = await Promise.all(artifactEntries.map(loadAddonArtifact));
const artifactByAddon = new Map(artifacts.map((artifact) => [artifact.addonId, artifact]));
const schemas = [];
const defaultProfiles = [];
const schematicProfiles = [];

for (const artifact of artifacts) {
  for (const [resourcePath, contents] of artifact.yamlResources) {
    if (resourcePath.startsWith("schemas/")) {
      const descriptor = addonSchemaDescriptor(artifact.addonId, resourcePath);
      schemas.push({
        ...descriptor,
        addonId: artifact.addonId,
        source: artifact.source,
        schema: normalizeSchemaSource(contents, resourcePath)
      });
      continue;
    }

    const resourceName = resourcePath;
    const index = indexYamlSource(contents);
    defaultProfiles.push({
      resourceName,
      schemaId: schemaIdForAddonResource(artifact.addonId, resourceName),
      fileName: profileFileName(resourceName),
      signature: buildProfileSignature(index),
      source: artifact.source,
      sha256: sha256(contents),
      options: index.entries.map(profileOption)
    });
  }

  for (const [resourceName, contents] of artifact.schematicResources) {
    schematicProfiles.push({
      resourceName,
      source: artifact.source,
      sha256: sha256(contents),
      data: Buffer.from(contents).toString("base64")
    });
  }
}

for (const descriptor of SYNTHETIC_SCHEMAS) {
  const artifact = artifactByAddon.get(descriptor.addonId);
  schemas.push({
    ...descriptor,
    fileName: `schema--${safeFileName(descriptor.id)}.json`,
    source: artifact.source,
    schema: { kind: "object", fields: [] }
  });
}

schemas.sort((left, right) => left.id.localeCompare(right.id, "en-US"));
defaultProfiles.sort((left, right) => left.resourceName.localeCompare(right.resourceName, "en-US"));
schematicProfiles.sort((left, right) => left.resourceName.localeCompare(right.resourceName, "en-US", { numeric: true }));
assertUniqueGeneratedNames(schemas, defaultProfiles);

const source = {
  kind: "kingdomsx-addon-jars",
  repository: GITHUB_SOURCE.repository,
  ref: GITHUB_SOURCE.ref,
  commitSha: commit.sha,
  artifacts: artifacts.map(({ source: artifactSource }) => artifactSource)
};
const generatedFiles = new Map([
  ["index.json", stableJson({
    formatVersion: 1,
    source,
    schemaCount: schemas.length,
    defaultCount: defaultProfiles.length,
    schematicCount: schematicProfiles.length,
    schematicCatalog: "schematics.json",
    files: FILE_MATCHERS,
    defaults: defaultProfiles.map(({ resourceName, schemaId, fileName, signature, source: profileSource, sha256: contentsSha256 }) => ({
      resourceName,
      schemaId,
      fileName,
      signature,
      source: profileSource,
      sha256: contentsSha256
    })),
    schemas: schemas.map(({ id, resourceName, fileName, source: schemaSource, reason = null }) => ({
      id,
      resourceName,
      fileName,
      source: schemaSource,
      reason
    })),
    schematics: schematicProfiles.map(({ resourceName, source: schematicSource, sha256: contentsSha256 }) => ({
      resourceName,
      source: schematicSource,
      sha256: contentsSha256
    }))
  })],
  ["schematics.json", stableJson({
    formatVersion: 1,
    source: artifactByAddon.get("enginehub").source,
    schematics: schematicProfiles
  })],
  ...defaultProfiles.map(({ resourceName, schemaId, fileName, source: profileSource, sha256: contentsSha256, options }) => [
    fileName,
    stableJson({ formatVersion: 1, source: profileSource, resourceName, schemaId, sha256: contentsSha256, options })
  ]),
  ...schemas.map(({ id, resourceName, fileName, source: schemaSource, reason = null, schema }) => [
    fileName,
    stableJson({ formatVersion: 1, source: schemaSource, id, resourceName, reason, schema })
  ])
]);

if (mode === "check") {
  await checkGeneratedFiles(generatedFiles);
  process.stdout.write(
    `Addon catalog matches KingdomsX commit ${commit.sha.slice(0, 12)} (${schemas.length} schemas, ${defaultProfiles.length} defaults, ${schematicProfiles.length} schematics).\n`
  );
} else {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const [fileName, contents] of generatedFiles) {
    await writeFile(path.join(outputDirectory, fileName), contents);
  }

  process.stdout.write(
    `Synced ${schemas.length} addon schemas, ${defaultProfiles.length} defaults, and ${schematicProfiles.length} schematics from KingdomsX commit ${commit.sha.slice(0, 12)}.\n`
  );
}

async function loadAddonArtifact({ id, entry }) {
  const response = await fetch(`https://raw.githubusercontent.com/${GITHUB_SOURCE.repository}/${commit.sha}/${entry.path}`, {
    headers: { "User-Agent": "KingdomsX-Web-catalog-generator" }
  });

  if (!response.ok) {
    fail(`Could not download ${GITHUB_SOURCE.repository}/${entry.path} (${response.status} ${response.statusText}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(bytes, {
    filter: (zipEntry) => zipEntry.name === "plugin.yml"
      || /\.ya?ml$/i.test(zipEntry.name)
      || ENGINEHUB_SCHEMATIC.test(zipEntry.name)
  });
  const pluginSource = textFile(files, "plugin.yml", entry.path);
  const plugin = parse(pluginSource);
  const yamlResources = Object.keys(files)
    .filter((resourcePath) => resourcePath !== "plugin.yml" && /\.ya?ml$/i.test(resourcePath))
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .map((resourcePath) => [resourcePath, textFile(files, resourcePath, entry.path)]);
  const schematicResources = Object.keys(files)
    .filter((resourcePath) => ENGINEHUB_SCHEMATIC.test(resourcePath))
    .sort((left, right) => left.localeCompare(right, "en-US", { numeric: true }))
    .map((resourcePath) => [resourcePath, files[resourcePath]]);

  if (id !== "enginehub" && schematicResources.length) {
    fail(`${entry.path} contains unexpected schematic resources.`);
  }

  const source = {
    addonId: id,
    artifactPath: entry.path,
    artifactBlobSha: entry.sha,
    artifactSha256: sha256(bytes),
    addonVersion: String(plugin?.version ?? "unknown")
  };

  return { addonId: id, source, yamlResources, schematicResources };
}

function addonSchemaDescriptor(addonId, resourcePath) {
  if (addonId === "map-viewers" && resourcePath === "schemas/maps/map.yml") {
    return {
      id: "addons/maps/map",
      resourceName: resourcePath,
      fileName: "schema--addons__maps__map.json"
    };
  }

  if (addonId === "map-viewers" && resourcePath === "schemas/maps/marker.yml") {
    return {
      id: "addons/maps/marker",
      resourceName: resourcePath,
      fileName: "schema--addons__maps__marker.json"
    };
  }

  if (addonId === "peace-treaties" && resourcePath === "schemas/peace-treaties.yml") {
    return {
      id: "addons/peace-treaties",
      resourceName: resourcePath,
      fileName: "schema--addons__peace-treaties.json"
    };
  }

  fail(`Unsupported addon schema ${addonId}:${resourcePath}. Add an explicit file and schema mapping.`);
}

function schemaIdForAddonResource(addonId, resourceName) {
  if (resourceName.startsWith("guis/")) {
    return "guis/schema";
  }

  if (addonId === "enginehub" && resourceName === "enginehub.yml") {
    return "addons/enginehub";
  }

  if (addonId === "map-viewers" && resourceName === "maps/map.yml") {
    return "addons/maps/map";
  }

  if (addonId === "map-viewers" && /^maps\/(?:kingdoms|nations|top-kingdoms)\.yml$/.test(resourceName)) {
    return "addons/maps/marker";
  }

  if (addonId === "peace-treaties" && resourceName === "peace-treaties.yml") {
    return "addons/peace-treaties";
  }

  fail(`Unsupported addon default ${addonId}:${resourceName}. Add an explicit schema mapping.`);
}

function assertUniqueGeneratedNames(schemaDescriptors, profiles) {
  const owners = new Map();

  for (const descriptor of [...schemaDescriptors, ...profiles]) {
    const existing = owners.get(descriptor.fileName);

    if (existing) {
      fail(`Generated addon file ${descriptor.fileName} is shared by ${existing} and ${descriptor.resourceName}.`);
    }

    owners.set(descriptor.fileName, descriptor.resourceName);
  }
}

async function fetchGitHubJson(apiPath) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_SOURCE.repository}${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "KingdomsX-Web-catalog-generator",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    fail(`Could not read ${GITHUB_SOURCE.repository} from GitHub (${response.status} ${response.statusText}).`);
  }

  return response.json();
}

function textFile(files, fileName, artifactPath) {
  const contents = files[fileName];

  if (!contents) {
    fail(`${artifactPath} is missing ${fileName}.`);
  }

  return strFromU8(contents);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function checkGeneratedFiles(expectedFiles) {
  let actualFiles;

  try {
    actualFiles = new Set(await readdir(outputDirectory));
  } catch {
    fail("The generated addon catalog is missing. Run npm run editor:addons:sync.");
  }

  for (const [fileName, expected] of expectedFiles) {
    let actual;

    try {
      actual = await readFile(path.join(outputDirectory, fileName), "utf8");
    } catch {
      fail(`Generated addon catalog file ${fileName} is missing. Run npm run editor:addons:sync.`);
    }

    if (actual !== expected) {
      fail(`Generated addon catalog file ${fileName} is stale. Run npm run editor:addons:sync.`);
    }

    actualFiles.delete(fileName);
  }

  if (actualFiles.size) {
    fail(`Unexpected generated addon catalog files: ${[...actualFiles].sort().join(", ")}.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
