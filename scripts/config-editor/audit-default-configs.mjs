import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildFormStructure } from "../../src/assets/scripts/config-editor/settings-form.js";
import { defaultDescriptorForFile, inferSchemaDescriptor, schemaDescriptorForFile } from "../../src/assets/scripts/config-editor/schema-files.js";
import { attachSchemaReferences } from "../../src/assets/scripts/config-editor/editor-schema.js";
import { unwrapNullable } from "../../src/assets/scripts/config-editor/schema-types.js";
import { semanticWarnings } from "../../src/assets/scripts/config-editor/semantic-validation.js";
import { createSourceDocument, documentBytes, pathKey } from "../../src/assets/scripts/config-editor/yaml-source.js";
import { workspaceRelationships } from "../../src/assets/scripts/config-editor/workspace-dependencies.js";
import { findKingdomsConfigFiles } from "./kingdoms-config-files.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const configsDirectoryInput = process.argv[2];

if (!configsDirectoryInput?.trim()) {
  fail("A Kingdoms config directory is required as the first argument. The default config audit reads configuration files without writing generated data.");
}

const configsDirectory = path.resolve(configsDirectoryInput);
const generatedRoot = path.join(repositoryRoot, "src/data/config-editor/latest");
const fullSchemaRoot = path.join(generatedRoot, "full");

const registry = JSON.parse(await readFile(path.join(generatedRoot, "index.json"), "utf8"));
const localCatalog = JSON.parse(await readFile(path.join(repositoryRoot, "src/data/config-editor/catalog/index.json"), "utf8"));
const addonCatalog = JSON.parse(await readFile(path.join(repositoryRoot, "src/data/config-editor/addons/index.json"), "utf8"));

registry.files = [...registry.files, ...addonCatalog.files];
registry.defaults = [...registry.defaults, ...localCatalog.defaults, ...addonCatalog.defaults];
registry.schemas = [...registry.schemas, ...addonCatalog.schemas];

const fullSchemaIndex = JSON.parse(await readFile(path.join(fullSchemaRoot, "index.json"), "utf8"));
const schemas = new Map(await Promise.all(fullSchemaIndex.schemas.map(async (descriptor) => {
  const generated = JSON.parse(await readFile(path.join(fullSchemaRoot, descriptor.fileName), "utf8"));

  return [descriptor.id, generated.schema];
})));
const references = {
  ItemStack: schemas.get("item-stack"),
  ItemMatcher: schemas.get("item-matcher"),
  Entity: schemas.get("entity")
};

const filePaths = await findKingdomsConfigFiles(configsDirectory);
const results = [];
const workspaceFiles = [];

for (const filePath of filePaths) {
  const relativePath = path.relative(configsDirectory, filePath).replaceAll(path.sep, "/");
  const bytes = new Uint8Array(await readFile(filePath));
  const document = createSourceDocument(relativePath, bytes);

  workspaceFiles.push({ fileName: relativePath, document });

  const relativeDescriptor = schemaDescriptorForFile(registry, relativePath);
  const relativeProfile = defaultDescriptorForFile(registry, relativePath, document.index, relativeDescriptor?.id);
  const browserProfile = defaultDescriptorForFile(registry, path.basename(filePath), document.index);
  const browserDescriptor = inferSchemaDescriptor(registry, schemas, path.basename(filePath), document.index, browserProfile);
  const expectedSchemaId = relativeProfile?.schemaId ?? relativeDescriptor?.id ?? null;
  const browserSchemaId = browserProfile?.schemaId ?? browserDescriptor?.id ?? null;
  const schema = structuredClone(schemas.get(browserSchemaId) ?? { kind: "object", fields: [] });

  attachSchemaReferences(schema, references);

  const sections = buildFormStructure(document.index, schema);
  const fields = sections.flatMap(sectionFields);
  const groups = sections.flatMap(sectionGroups);

  const pathCounts = new Map();

  for (const entry of document.index.entries) {
    const key = pathKey(entry.path);
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }

  const duplicatePaths = [...pathCounts]
    .filter(([, count]) => count > 1)
    .map(([key]) => key.replaceAll("\u0000", "."));
  const fieldPaths = new Set(fields.map((field) => pathKey(field.path)));
  const groupPaths = new Set(groups.map((group) => pathKey(group.path)));
  const owningFields = fields.filter((field) => field.entry.container || field.entry.advancedOnly);
  const uncoveredPaths = document.index.entries.filter((entry) => {
    const key = pathKey(entry.path);

    if (fieldPaths.has(key) || groupPaths.has(key)) {
      return false;
    }

    return !owningFields.some((field) => isDescendant(entry.path, field.path));
  });
  const structuredFields = fields.filter((field) => {
    const type = unwrapNullable(field.type);

    return type?.kind === "object" || type?.kind === "mapping";
  });
  const misplacedComments = document.index.entries.filter((entry) => {
    if (!entry.comments.length) {
      return false;
    }

    const key = pathKey(entry.path);

    if (fieldPaths.has(key) || groupPaths.has(key)) {
      return false;
    }

    return !owningFields.some((field) => sameOrDescendant(entry.path, field.path));
  });
  const roundTripMatches = Buffer.from(documentBytes(document)).equals(Buffer.from(bytes));
  const ambiguousFields = fields
    .filter((field) => document.index.byPath.get(pathKey(field.path)) !== field.entry)
    .map((field) => field.path.join("."));
  const semanticIssues = semanticWarnings({ index: document.index, schemaId: browserSchemaId, sections });

  results.push({
    file: relativePath,
    bytes: bytes.length,
    entries: document.index.entries.length,
    sections: sections.length,
    fields: fields.length,
    groups: groups.length,
    profile: relativeProfile?.resourceName ?? null,
    schemaByPath: expectedSchemaId,
    schemaInBrowser: browserSchemaId,
    pathDependentSchema: expectedSchemaId !== browserSchemaId,
    warnings: document.warnings,
    semanticWarnings: semanticIssues,
    editable: document.editable,
    roundTripMatches,
    duplicatePaths,
    ambiguousFields,
    uncoveredPaths: uncoveredPaths.map((entry) => entry.path.join(".")),
    structuredFields: structuredFields.map((field) => field.path.join(".")),
    misplacedComments: misplacedComments.map((entry) => entry.path.join("."))
  });
}

const failures = results.filter((result) =>
  !result.editable
  || !result.roundTripMatches
  || result.pathDependentSchema
  || result.warnings.length
  || result.duplicatePaths.length
  || result.ambiguousFields.length
  || result.uncoveredPaths.length
  || result.structuredFields.length
  || result.misplacedComments.length
);
const workspace = { files: workspaceFiles };
const workspaceWarnings = workspaceFiles.flatMap((session) =>
  workspaceRelationships(workspace, session).warnings.map((message) => ({ file: session.fileName, message }))
);
const semanticFindings = results.flatMap((result) =>
  result.semanticWarnings.map((message) => ({ file: result.file, message }))
);
const pathDependent = results.filter((result) => result.pathDependentSchema);
const summary = {
  configsDirectory,
  files: results.length,
  bytes: results.reduce((total, result) => total + result.bytes, 0),
  entries: results.reduce((total, result) => total + result.entries, 0),
  fields: results.reduce((total, result) => total + result.fields, 0),
  schemaMatchedInBrowser: results.filter((result) => result.schemaInBrowser).length,
  pathDependentSchemas: pathDependent.length,
  invariantFailures: failures.length,
  workspaceWarnings: workspaceWarnings.length,
  semanticWarnings: results.reduce((total, result) => total + result.semanticWarnings.length, 0)
};

process.stdout.write(`${JSON.stringify({ summary, pathDependent, failures, workspaceWarnings, semanticFindings }, null, 2)}\n`);

if (failures.length || workspaceWarnings.length) {
  process.exitCode = 1;
}

function sectionFields(section) {
  return [...section.fields, ...section.groups.flatMap(groupFields)];
}

function groupFields(group) {
  return [...group.fields, ...group.groups.flatMap(groupFields)];
}

function sectionGroups(section) {
  const root = section.path.length ? [{ path: section.path, comments: section.comments }] : [];

  return [...root, ...section.groups.flatMap(flattenGroup)];
}

function flattenGroup(group) {
  return [group, ...group.groups.flatMap(flattenGroup)];
}

function isDescendant(candidate, parent) {
  return candidate.length > parent.length && parent.every((segment, index) => candidate[index] === segment);
}

function sameOrDescendant(candidate, parent) {
  return candidate.length >= parent.length && parent.every((segment, index) => candidate[index] === segment);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
