// Builds the browser-ready schemas in latest/full without changing the raw JAR schemas
// Schema and runtime snapshots are required for both write and check modes

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  applySettingCapabilities,
  runtimeOnlyOptions
} from "../../src/assets/scripts/config-editor/editor-capabilities.js";
import { applyEditorSemantics } from "../../src/assets/scripts/config-editor/editor-schema.js";
import { safeFileName } from "./profile-snapshot.mjs";

const SHARED_SCHEMA_IDS = new Set([
  "guis/schema",
  "Structures/structure",
  "Turrets/turret",
  "addons/peace-treaties"
]);
const CATALOG_ONLY_SCHEMAS = [
  {
    id: "language",
    resourceName: "languages/en.yml",
    catalogFileName: "default--languages__en.json"
  }
];

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const latestRoot = path.join(repositoryRoot, "src/data/config-editor/latest");
const catalogRoot = path.join(repositoryRoot, "src/data/config-editor/catalog");
const addonRoot = path.join(repositoryRoot, "src/data/config-editor/addons");
const outputDirectory = path.join(latestRoot, "full");
const mode = process.argv[2] ?? "write";

if (!new Set(["write", "check"]).has(mode)) {
  fail("Usage: sync-full-schemas.mjs [write|check]");
}

const registry = JSON.parse(await readFile(path.join(latestRoot, "index.json"), "utf8"));
const localCatalog = JSON.parse(await readFile(path.join(catalogRoot, "index.json"), "utf8"));
const addonCatalog = JSON.parse(await readFile(path.join(addonRoot, "index.json"), "utf8"));
const runtimeCatalog = JSON.parse(await readFile(path.join(repositoryRoot, "src/data/config-editor/runtime-options.json"), "utf8"));
assertMatchingArtifact(registry.source, runtimeCatalog.source, "runtime catalog");
assertLanguageCatalog(localCatalog);
assertAddonCatalog(addonCatalog);

const schemaDescriptors = [...registry.schemas, ...addonCatalog.schemas];
const defaultDescriptors = [...registry.defaults, ...localCatalog.defaults, ...addonCatalog.defaults];
const catalogOnlySchemaIds = new Set(CATALOG_ONLY_SCHEMAS.map((schema) => schema.id));
const addonSchemaIds = new Set(addonCatalog.schemas.map((descriptor) => descriptor.id));
const schemaModules = new Map(await Promise.all(schemaDescriptors.map(async (descriptor) => {
  const root = addonSchemaIds.has(descriptor.id) ? addonRoot : latestRoot;
  const generated = JSON.parse(await readFile(path.join(root, descriptor.fileName), "utf8"));

  return [descriptor.id, generated];
})));

const referenceSchemas = {};

for (const [typeName, schemaId] of Object.entries({
  ItemStack: "item-stack",
  ItemMatcher: "item-matcher",
  Entity: "entity"
})) {
  const schema = schemaModules.get(schemaId)?.schema;

  if (!schema) {
    fail(`Missing required reference schema ${schemaId}.`);
  }

  referenceSchemas[typeName] = schema;
}

const defaultOptionsBySchema = await loadDefaultOptionsBySchema(
  defaultDescriptors.filter((descriptor) => !catalogOnlySchemaIds.has(descriptor.schemaId))
);
const generatedFiles = new Map();
const indexSchemas = [];

for (const descriptor of schemaDescriptors) {
  const module = schemaModules.get(descriptor.id);

  if (!module?.schema) {
    fail(`Missing schema module for ${descriptor.id}.`);
  }

  const baseSchema = structuredClone(module.schema);
  const profileOptions = defaultOptionsBySchema.get(descriptor.id) ?? [];
  const defaults = SHARED_SCHEMA_IDS.has(descriptor.id)
    ? templateOptionsForSharedSchema(baseSchema, profileOptions, {
        includeComments: descriptor.id !== "guis/schema"
      })
    : profileOptions;
  const runtimeOptions = addonSchemaIds.has(descriptor.id)
    ? []
    : runtimeOnlyOptions(runtimeCatalog, descriptor.id);
  const fullSchema = applyEditorSemantics(
    baseSchema,
    descriptor.id,
    referenceSchemas,
    defaults,
    runtimeOptions
  );
  const unmatchedCapabilities = applySettingCapabilities(fullSchema, descriptor.id);

  if (unmatchedCapabilities.length) {
    fail(
      `Capability overrides no longer match ${descriptor.id}: ${unmatchedCapabilities.map((path) => path.join(".")).join(", ")}.`
    );
  }

  writeFullDocument({
    id: descriptor.id,
    resourceName: descriptor.resourceName,
    schema: fullSchema,
    defaults,
    profileOptions,
    runtimeOptions,
    sources: {
      schema: {
        ...(descriptor.source ?? registry.source),
        fileName: descriptor.fileName
      },
      defaults: defaultDescriptors
        .filter((entry) => entry.schemaId === descriptor.id)
        .map((entry) => entry.fileName),
      runtime: addonSchemaIds.has(descriptor.id) ? null : runtimeCatalog.source
    }
  });
}

for (const catalogSchema of CATALOG_ONLY_SCHEMAS) {
  const catalogProfile = await readDefaultProfile(catalogSchema.catalogFileName);
  const profileOptions = catalogProfile.options ?? [];

  if (!profileOptions.length) {
    fail(`Missing catalog defaults for ${catalogSchema.id}. Expected ${catalogSchema.catalogFileName}.`);
  }

  const baseSchema = { kind: "object", fields: [] };
  const fullSchema = applyEditorSemantics(
    baseSchema,
    catalogSchema.id,
    referenceSchemas,
    profileOptions,
    []
  );
  const unmatchedCapabilities = applySettingCapabilities(fullSchema, catalogSchema.id);

  if (unmatchedCapabilities.length) {
    fail(
      `Capability overrides no longer match ${catalogSchema.id}: ${unmatchedCapabilities.map((path) => path.join(".")).join(", ")}.`
    );
  }

  writeFullDocument({
    id: catalogSchema.id,
    resourceName: catalogSchema.resourceName,
    schema: fullSchema,
    defaults: profileOptions,
    profileOptions,
    runtimeOptions: [],
    sources: {
      schema: null,
      catalog: [catalogSchema.catalogFileName],
      defaults: defaultDescriptors
        .filter((entry) => entry.schemaId === catalogSchema.id)
        .map((entry) => entry.fileName),
      runtime: runtimeCatalog.source
    }
  });
}

const indexDocument = {
  formatVersion: 1,
  source: {
    schema: registry.source ?? null,
    catalog: {
      core: localCatalog.source ?? null,
      addons: addonCatalog.source ?? null
    },
    runtime: runtimeCatalog.source ?? null
  },
  schemaCount: indexSchemas.length,
  schemas: indexSchemas
};
generatedFiles.set("index.json", stableJson(indexDocument));

if (mode === "check") {
  await checkGeneratedFiles(generatedFiles);
  process.stdout.write(
    `Full schema snapshot matches (${indexSchemas.length} schemas, jar ${runtimeCatalog.source?.pluginVersion ?? "unknown"}).\n`
  );
} else {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const [fileName, contents] of generatedFiles) {
    await writeFile(path.join(outputDirectory, fileName), contents);
  }

  process.stdout.write(
    `Wrote ${indexSchemas.length} full schemas to ${path.relative(repositoryRoot, outputDirectory)}.\n`
  );
}

function writeFullDocument({
  id,
  resourceName,
  schema,
  defaults,
  profileOptions,
  runtimeOptions,
  sources
}) {
  const coverage = {
    defaultPathCount: defaults.length,
    rawDefaultPathCount: profileOptions.length,
    activeRuntimePathCount: runtimeOptions.length,
    fieldCount: countObjectFields(schema),
    capabilitySourceCounts: capabilitySourceCounts(schema),
    commonSettingCount: countCapabilityTier(schema, "common")
  };

  const document = {
    formatVersion: 1,
    id,
    resourceName,
    sources,
    coverage,
    schema
  };

  const fileName = safeFileName(id) + ".json";
  generatedFiles.set(fileName, stableJson(cloneForJson(document)));
  indexSchemas.push({
    id,
    resourceName,
    fileName,
    coverage
  });
}

function assertMatchingArtifact(expected, actual, label) {
  if (expected?.sha256 && actual?.sha256 === expected.sha256) {
    return;
  }

  fail(
    `The ${label} does not match the schema JAR. `
    + "Regenerate every editor catalog from the same KingdomsX JAR."
  );
}

function assertLanguageCatalog(catalog) {
  const source = catalog?.source;
  const languages = source?.languages ?? [];
  const defaults = catalog?.defaults ?? [];
  const sourceByLocale = new Map(languages.map((language) => [language.locale, language]));
  const validSource = source?.kind === "kingdomsx-github-languages"
    && source.repository === "CryptoMorin/KingdomsX"
    && source.rootPath === "resources/languages"
    && /^[0-9a-f]{40}$/.test(source.commitSha ?? "")
    && languages.length > 0
    && languages.every((language) =>
      /^[a-z]{2}(?:[-_][A-Za-z]{2})?$/.test(language.locale ?? "")
        && language.path === `resources/languages/${language.locale}/${language.locale}.yml`
        && /^[0-9a-f]{40}$/.test(language.blobSha ?? "")
        && /^[0-9a-f]{64}$/.test(language.sha256 ?? "")
    );
  const validProfiles = defaults.length === languages.length
    && defaults.some((profile) => profile.resourceName === "languages/en.yml")
    && defaults.every((profile) => {
      const locale = /^languages\/([^/]+)\.yml$/.exec(profile.resourceName ?? "")?.[1];
      const language = sourceByLocale.get(locale);

      return language
        && profile.schemaId === "language"
        && profile.fileName === `default--languages__${locale}.json`
        && profile.sha256 === language.sha256;
    });

  if (!validSource || !validProfiles) {
    fail("The language catalog is invalid. Run npm run editor:language:sync.");
  }
}

function assertAddonCatalog(catalog) {
  const source = catalog?.source;
  const artifacts = source?.artifacts ?? [];
  const addonIds = artifacts.map((artifact) => artifact.addonId).sort();
  const validSource = source?.kind === "kingdomsx-addon-jars"
    && source.repository === "CryptoMorin/KingdomsX"
    && /^[0-9a-f]{40}$/.test(source.commitSha ?? "")
    && artifacts.every((artifact) =>
      /^addons\/Kingdoms-Addon-.+\.jar$/.test(artifact.artifactPath ?? "")
        && /^[0-9a-f]{40}$/.test(artifact.artifactBlobSha ?? "")
        && /^[0-9a-f]{64}$/.test(artifact.artifactSha256 ?? "")
        && typeof artifact.addonVersion === "string"
    );
  const validInventory = JSON.stringify(addonIds) === JSON.stringify([
    "admin-tools",
    "enginehub",
    "map-viewers",
    "outposts",
    "peace-treaties"
  ])
    && catalog.schemaCount === catalog.schemas?.length
    && catalog.defaultCount === catalog.defaults?.length;

  if (!validSource || !validInventory) {
    fail("The addon catalog is invalid. Run npm run editor:addons:sync.");
  }
}

function capabilitySourceCounts(root) {
  const counts = {};

  walkTypes(root, (type) => {
    for (const source of type.capability?.sources ?? []) {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  });

  return counts;
}

function countCapabilityTier(root, tier) {
  let count = 0;

  walkTypes(root, (type) => {
    if (type.capability?.tier === tier) {
      count += 1;
    }
  });

  return count;
}

function walkTypes(root, visit, seen = new WeakSet()) {
  if (!root || typeof root !== "object" || seen.has(root)) {
    return;
  }

  seen.add(root);
  visit(root);

  if (root.kind === "object") {
    root.fields?.forEach((field) => walkTypes(field.type, visit, seen));
    walkTypes(root.additionalProperties, visit, seen);
  } else if (root.kind === "mapping") {
    root.fields?.forEach((field) => walkTypes(field.type, visit, seen));
    walkTypes(root.keys, visit, seen);
    walkTypes(root.values, visit, seen);
  } else if (root.kind === "union") {
    root.choices?.forEach((choice) => walkTypes(choice, visit, seen));
  } else if (root.kind === "list" || root.kind === "set") {
    walkTypes(root.elements, visit, seen);
  } else if (root.kind === "nullable") {
    walkTypes(root.value, visit, seen);
  }
}

async function loadDefaultOptionsBySchema(descriptors) {
  const bySchema = new Map();

  for (const descriptor of descriptors) {
    if (!descriptor.schemaId) {
      continue;
    }

    const profile = await readDefaultProfile(descriptor.fileName);
    const list = bySchema.get(descriptor.schemaId) ?? [];
    list.push(...(profile.options ?? []));
    bySchema.set(descriptor.schemaId, list);
  }

  return bySchema;
}

async function readDefaultProfile(fileName) {
  for (const root of [latestRoot, catalogRoot, addonRoot]) {
    let source;

    try {
      source = await readFile(path.join(root, fileName), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    return JSON.parse(source);
  }

  fail(`Missing default profile ${fileName}. Regenerate the editor catalogs.`);
}

// Use one template entry for all dynamic keys
function templateOptionsForSharedSchema(schema, options, { includeComments = true } = {}) {
  const byPath = new Map();

  for (const option of options) {
    if (!option.path?.length) {
      continue;
    }

    const templated = {
      ...option,
      path: templatePath(schema, option.path),
      ...(!includeComments ? { comments: [] } : {})
    };
    const key = templated.path.join("\u0000");
    const existing = byPath.get(key);

    if (!existing) {
      byPath.set(key, templated);
      continue;
    }

    if ((!existing.comments || existing.comments.length === 0) && templated.comments?.length) {
      byPath.set(key, templated);
    }
  }

  return [...byPath.values()];
}

function templatePath(root, pathSegments) {
  let current = root;
  const result = [];

  for (const segment of pathSegments) {
    current = unwrapType(current);

    if (!current || typeof current !== "object") {
      result.push(segment);
      continue;
    }

    if (current.kind === "mapping") {
      const named = current.fields?.find((candidate) => candidate.key === segment);

      if (named) {
        result.push(segment);
        current = named.type;
      } else {
        result.push("{entry}");
        current = current.values;
      }

      continue;
    }

    if (current.kind === "object") {
      const named = current.fields?.find((candidate) => candidate.key === segment);

      if (named) {
        result.push(segment);
        current = named.type;
      } else if (current.additionalProperties) {
        result.push("{entry}");
        current = current.additionalProperties;
      } else {
        result.push(segment);
        current = null;
      }

      continue;
    }

    if (current.kind === "union") {
      const structured = (current.choices ?? [])
        .map(unwrapType)
        .find((choice) => choice && ["object", "mapping"].includes(choice.kind));

      if (structured) {
        current = structured;
        // Run this segment again against the structured union member
        const nested = templatePath(structured, [segment]);
        result.push(...nested);
        let walk = structured;

        for (const part of nested) {
          walk = descend(walk, part);
        }

        current = walk;
        continue;
      }
    }

    result.push(segment);
    current = null;
  }

  return result;
}

function descend(type, segment) {
  const current = unwrapType(type);

  if (!current) {
    return null;
  }

  if (current.kind === "mapping") {
    if (segment === "{entry}" || /^\{[^}]+\}$/.test(segment)) {
      return current.values;
    }

    return current.fields?.find((candidate) => candidate.key === segment)?.type ?? current.values;
  }

  if (current.kind === "object") {
    if (segment === "{entry}" || /^\{[^}]+\}$/.test(segment)) {
      return current.additionalProperties;
    }

    return current.fields?.find((candidate) => candidate.key === segment)?.type
      ?? current.additionalProperties
      ?? null;
  }

  return null;
}

function unwrapType(type) {
  if (!type || typeof type !== "object") {
    return type;
  }

  if (type.kind === "nullable") {
    return unwrapType(type.value);
  }

  if (type.kind === "reference") {
    return type.target ?? type;
  }

  return type;
}

function cloneForJson(value, ancestors = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value.kind === "reference") {
    return {
      kind: "reference",
      typeName: value.typeName,
      description: value.description || ""
    };
  }

  if (ancestors.has(value)) {
    return {
      kind: "advanced",
      typeName: value.typeName || "Recursive value",
      description: value.description || "Nested settings."
    };
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    const copy = value.map((item) => cloneForJson(item, ancestors));
    ancestors.delete(value);
    return copy;
  }

  const copy = {};

  for (const [key, nested] of Object.entries(value)) {
    copy[key] = cloneForJson(nested, ancestors);
  }

  ancestors.delete(value);
  return copy;
}

function countObjectFields(type, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return 0;
  }

  seen.add(type);

  if (type.kind === "reference") {
    return countObjectFields(type.target, seen);
  }

  if (type.kind === "object") {
    return (type.fields ?? []).reduce(
      (total, field) => total + 1 + countObjectFields(field.type, seen),
      countObjectFields(type.additionalProperties, seen)
    );
  }

  if (type.kind === "mapping") {
    return (type.fields ?? []).reduce(
      (total, field) => total + 1 + countObjectFields(field.type, seen),
      countObjectFields(type.values, seen) + countObjectFields(type.keys, seen)
    );
  }

  if (type.kind === "union") {
    return (type.choices ?? []).reduce((total, choice) => total + countObjectFields(choice, seen), 0);
  }

  if (type.kind === "list" || type.kind === "set") {
    return countObjectFields(type.elements, seen);
  }

  if (type.kind === "nullable") {
    return countObjectFields(type.value, seen);
  }

  return 0;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function checkGeneratedFiles(expectedFiles) {
  let actualNames;

  try {
    actualNames = new Set(await readdir(outputDirectory));
  } catch {
    fail(`Missing full schema directory ${path.relative(repositoryRoot, outputDirectory)}. Run npm run editor:schema:full.`);
  }

  for (const [fileName, expected] of expectedFiles) {
    let actual;

    try {
      actual = await readFile(path.join(outputDirectory, fileName), "utf8");
    } catch {
      fail(`Missing full schema file ${fileName}. Run npm run editor:schema:full.`);
    }

    if (actual !== expected) {
      fail(`Full schema file ${fileName} is stale. Run npm run editor:schema:full.`);
    }

    actualNames.delete(fileName);
  }

  if (actualNames.size) {
    fail(`Unexpected full schema files: ${[...actualNames].sort().join(", ")}.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
