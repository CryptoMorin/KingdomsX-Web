import registry from "../../../data/config-editor/latest/index.json";
import catalog from "../../../data/config-editor/catalog/index.json";
import addonCatalog from "../../../data/config-editor/addons/index.json";
import fullIndex from "../../../data/config-editor/latest/full/index.json";
import { defaultDescriptorForFile, inferSchemaDescriptor } from "./schema-files.js";
import { attachSchemaReferences } from "./editor-schema.js";
import { editorOverrides } from "./editor-overrides.js";

const dataModules = import.meta.glob([
  "../../../data/config-editor/latest/default--*.json",
  "../../../data/config-editor/latest/full/*.json",
  "../../../data/config-editor/catalog/default--*.json",
  "../../../data/config-editor/addons/default--*.json",
  "!../../../data/config-editor/latest/full/index.json"
]);
const fullSchemaById = new Map(fullIndex.schemas.map((entry) => [entry.id, entry]));
const fullSchemaCache = new Map();

const schemaRegistry = {
  files: [...registry.files, ...addonCatalog.files],
  defaults: [...registry.defaults, ...catalog.defaults, ...addonCatalog.defaults],
  schemas: [...registry.schemas, ...addonCatalog.schemas]
};

export async function schemaForFile(fileName, index) {
  if (isUnresolvedModule(index)) {
    return null;
  }

  const initialProfile = defaultDescriptorForFile(schemaRegistry, fileName, index);
  const schemaDescriptor = index && !initialProfile?.schemaId
    ? inferSchemaDescriptor(schemaRegistry, await loadInferenceSchemas(), fileName, index)
    : null;
  const defaultDescriptor = defaultDescriptorForFile(schemaRegistry, fileName, index, schemaDescriptor?.id)
    ?? initialProfile;
  const defaultModule = defaultDescriptor ? await loadProfileData(defaultDescriptor.fileName) : null;
  const schemaId = defaultDescriptor?.schemaId ?? schemaDescriptor?.id ?? "";

  if (!schemaId && !defaultModule) {
    return null;
  }

  const schema = await loadFullSchema(schemaId);

  if (!schema) {
    throw new Error(`Config guidance is unavailable for “${fileName}”. Reload the editor and try again.`);
  }

  const [ItemStack, ItemMatcher, Entity] = await Promise.all([
    loadFullSchema("item-stack"),
    loadFullSchema("item-matcher"),
    loadFullSchema("entity")
  ]);
  const references = { ItemStack, ItemMatcher, Entity };
  attachSchemaReferences(schema, references);

  return {
    id: schemaId || `profile:${defaultDescriptor.resourceName}`,
    schema,
    defaults: defaultModule?.options ?? [],
    resourceName: defaultDescriptor?.resourceName ?? null,
    showDefaultValues: shouldShowDefaultValues(defaultDescriptor?.resourceName, schemaId, fileName)
  };
}

export function isRegularConfigResource(resourceName) {
  return Boolean(resourceName && !resourceName.includes("/"));
}

export function shouldShowDefaultValues(resourceName, schemaId = "", fileName = resourceName) {
  if (!resourceName) {
    return false;
  }

  if (isRegularConfigResource(resourceName) || schemaId.startsWith("addons/")) {
    return true;
  }

  if (["Structures/structure", "Turrets/turret"].includes(schemaId)) {
    return true;
  }

  if (schemaId !== "language") {
    return false;
  }

  const resourceBaseName = resourceName.split("/").at(-1)?.toLocaleLowerCase("en-US");
  const fileBaseName = String(fileName).replaceAll("\\", "/").split("/").at(-1)?.toLocaleLowerCase("en-US");

  return resourceBaseName === fileBaseName;
}

function isUnresolvedModule(index) {
  if (!index?.byPath.has("(module)") || index.byPath.has("options")) {
    return false;
  }

  return !index.byPath.has("(import)\u0000structure")
    && !index.byPath.has("(import)\u0000building")
    && !index.byPath.has("(import)\u0000turret")
    && !index.byPath.has("(import)\u0000mine")
    && !index.byPath.has("(import)\u0000turretgui");
}

export function defaultOptionForFile(loadedSchema, path) {
  return loadedSchema?.defaults.find((option) =>
    option.path.length === path.length && option.path.every((segment, index) => segment === path[index])
  ) ?? null;
}

export function defaultOptionForDisplay(loadedSchema, path) {
  if (!loadedSchema?.showDefaultValues) {
    return null;
  }

  const example = editorOverrides.defaultValueExamples.some((candidate) =>
    candidate.resourceName === loadedSchema.resourceName
      && candidate.path.length <= path.length
      && candidate.path.every((segment, index) => segment === path[index])
  );

  return example ? null : defaultOptionForFile(loadedSchema, path);
}

export async function defaultOptionsForResource(resourceName) {
  const descriptor = schemaRegistry.defaults.find((candidate) => candidate.resourceName === resourceName);

  if (!descriptor) {
    return [];
  }

  return (await loadProfileData(descriptor.fileName)).options ?? [];
}

export async function templateProfileForKey(key) {
  const descriptor = templateDescriptor(key);

  if (!descriptor) {
    return null;
  }

  return {
    resourceName: descriptor.resourceName,
    data: await loadProfileData(descriptor.fileName)
  };
}

function templateDescriptor(key) {
  const candidates = [`guis/templates/${key}.yml`, `declarations/${key}.yml`];

  return candidates
    .map((resourceName) => schemaRegistry.defaults.find((candidate) => candidate.resourceName === resourceName))
    .find(Boolean) ?? null;
}

async function loadFullSchema(schemaId) {
  const schema = await loadCanonicalFullSchema(schemaId);

  return schema ? structuredClone(schema) : null;
}

async function loadCanonicalFullSchema(schemaId) {
  if (!schemaId) {
    return null;
  }

  const descriptor = fullSchemaById.get(schemaId);

  if (!descriptor) {
    return null;
  }

  if (!fullSchemaCache.has(schemaId)) {
    fullSchemaCache.set(schemaId, loadData(descriptor.fileName, "full").then((document) => document.schema));
  }

  return fullSchemaCache.get(schemaId);
}

async function loadInferenceSchemas() {
  return new Map(await Promise.all(schemaRegistry.schemas.map(async (descriptor) => [
    descriptor.id,
    await loadCanonicalFullSchema(descriptor.id)
  ])));
}

async function loadProfileData(fileName) {
  return loadData(fileName, "profile");
}

async function loadData(fileName, root = "profile") {
  const suffix = `/${fileName}`;
  const keys = Object.keys(dataModules).filter((candidate) => candidate.endsWith(suffix));
  let modulePath = null;

  if (root === "full") {
    modulePath = keys.find((candidate) => candidate.includes("/latest/full/"));
  } else {
    modulePath = keys.find((candidate) => candidate.includes("/catalog/"))
      ?? keys.find((candidate) => candidate.includes("/addons/"))
      ?? keys.find((candidate) => candidate.includes("/latest/") && !candidate.includes("/latest/full/"));
  }

  if (!modulePath) {
    throw new Error(`Config guidance is unavailable for “${fileName}”. Reload the editor and try again.`);
  }

  const module = await dataModules[modulePath]();

  return module.default;
}
