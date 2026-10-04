import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { indexYamlSource } from "../../src/assets/scripts/config-editor/yaml-source.js";
import { readKingdomsJar, textFile } from "./kingdomsx-jar.mjs";
import {
  buildProfileSignature,
  profileFileName,
  profileOption,
  safeFileName
} from "./profile-snapshot.mjs";
import {
  buildFileMatchers,
  normalizeSchemaSource,
  schemaIdForResource
} from "./schema-snapshot.mjs";

const SCHEMA_ROOT = "schemas/";
const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = path.join(repositoryRoot, "src/data/config-editor/latest");
const mode = process.argv[2] ?? "write";

if (!new Set(["write", "check"]).has(mode)) {
  fail("Usage: sync-schema.mjs [write|check] [/path/to/KingdomsX.jar]");
}

const jarInput = process.argv[3] ?? process.env.KINGDOMSX_JAR;

if (!jarInput?.trim()) {
  fail(mode === "write"
    ? "KINGDOMSX_JAR is required. Schema regeneration writes generated editor snapshots."
    : "KINGDOMSX_JAR is required. Schema verification reads the selected JAR without writing files.");
}

const jarPath = path.resolve(jarInput);

const jar = await readKingdomsJar(jarPath, (fileName) =>
  fileName.startsWith(SCHEMA_ROOT) || isDefaultResource(fileName)
);
const schemaPaths = Object.keys(jar.files)
  .filter((fileName) => fileName.startsWith(SCHEMA_ROOT) && /\.ya?ml$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right));
const defaultPaths = Object.keys(jar.files)
  .filter(isDefaultResource)
  .sort((left, right) => left.localeCompare(right));

if (!schemaPaths.includes(`${SCHEMA_ROOT}config.yml`)) {
  fail(`No config.yml schema was found in ${path.basename(jar.path)}.`);
}

const schemaSources = schemaPaths.map((fileName) => [fileName, textFile(jar.files, fileName)]);
const defaultSources = defaultPaths.map((fileName) => [fileName, textFile(jar.files, fileName)]);

const schemas = schemaSources.map(([schemaPath, source]) => {
  const resourceName = schemaPath.slice(SCHEMA_ROOT.length);
  const id = resourceName.replace(/\.ya?ml$/i, "");

  return {
    id,
    resourceName,
    fileName: `${safeFileName(id)}.json`,
    schema: normalizeSchemaSource(source, resourceName)
  };
});

const source = jar.source;
const fileMatchers = buildFileMatchers(schemas);
const defaultProfiles = defaultSources.map(([defaultPath, contents]) => {
  const resourceName = defaultPath;
  const index = indexYamlSource(contents);
  const schemaId = schemaIdForResource(resourceName, fileMatchers);

  return {
    resourceName,
    schemaId,
    fileName: profileFileName(resourceName),
    signature: buildProfileSignature(index),
    options: index.entries.map(profileOption)
  };
});
const registry = {
  formatVersion: 4,
  source,
  schemaCount: schemas.length,
  defaultCount: defaultProfiles.length,
  files: fileMatchers,
  defaults: defaultProfiles.map(({ resourceName, schemaId, fileName, signature }) => ({
    resourceName,
    schemaId,
    fileName,
    signature
  })),
  schemas: schemas.map(({ id, resourceName, fileName }) => ({ id, resourceName, fileName }))
};

const generatedFiles = new Map([
  ["index.json", stableJson(registry)],
  ...defaultProfiles.map(({ resourceName, schemaId, fileName, options }) => [
    fileName,
    stableJson({ formatVersion: 3, source, resourceName, schemaId, options })
  ]),
  ...schemas.map(({ fileName, id, resourceName, schema }) => [
    fileName,
    stableJson({ formatVersion: 2, source, id, resourceName, schema })
  ])
]);

if (mode === "check") {
  await checkGeneratedFiles(generatedFiles);
  process.stdout.write(
    `Schema data matches KingdomsX ${source.pluginVersion} (${schemas.length} schemas, ${defaultProfiles.length} defaults, ${source.sha256.slice(0, 12)}).\n`
  );
} else {
  await mkdir(outputDirectory, { recursive: true });
  const existingEntries = await readdir(outputDirectory, { withFileTypes: true });
  await Promise.all(existingEntries
    .filter((entry) => entry.isFile())
    .map((entry) => rm(path.join(outputDirectory, entry.name))));

  for (const [fileName, contents] of generatedFiles) {
    await writeFile(path.join(outputDirectory, fileName), contents);
  }

  process.stdout.write(
    `Synced ${schemas.length} schemas and ${defaultProfiles.length} defaults from KingdomsX ${source.pluginVersion} (${source.sha256.slice(0, 12)}).\n`
  );
}

function isDefaultResource(fileName) {
  return !fileName.startsWith(SCHEMA_ROOT)
    && !/(?:^|\/)(?:plugin|cachASCII-16)\.ya?ml$/i.test(fileName)
    && !/(?:^|\/)globals\.ya?ml$/i.test(fileName)
    && /\.ya?ml$/i.test(fileName);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function checkGeneratedFiles(expectedFiles) {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const actualNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

  for (const [fileName, expected] of expectedFiles) {
    let actual;

    try {
      actual = await readFile(path.join(outputDirectory, fileName), "utf8");
    } catch {
      fail(`Missing generated schema file ${fileName}. Run npm run editor:schema:sync.`);
    }

    if (actual !== expected) {
      fail(`Generated schema file ${fileName} is stale. Run npm run editor:schema:sync.`);
    }

    actualNames.delete(fileName);
  }

  if (actualNames.size) {
    fail(`Unexpected generated schema files: ${[...actualNames].sort().join(", ")}.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
