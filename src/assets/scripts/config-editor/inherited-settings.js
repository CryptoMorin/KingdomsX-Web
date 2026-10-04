import {
  annotationsFromComments,
  classifyKingdomsEntry,
  classifySequenceItem,
  parseAnchorName,
  parseBlockScalar,
  parseImportedAnchor
} from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey, scanAnchorTokens } from "./yaml-source.js";
import { resolveImportPath } from "./workspace-dependencies.js";
import { expandEffectiveFunctions } from "./generated-settings.js";
import { expandEffectiveAliases } from "./shared-settings.js";

export async function effectiveIndexForSession(workspace, session, { templateProfileForKey = null } = {}) {
  if (!session?.document?.index) {
    return emptyIndex();
  }

  return effectiveSessionIndex(workspace, session, new Set(), templateProfileForKey);
}

export function canMaterializeEffectiveEntry(entry) {
  if (!entry?.inherited && !entry?.generated) {
    return false;
  }

  const tokens = scanAnchorTokens(entry.source);

  return tokens.every((token) => token.kind !== "alias"
    || tokens.some((candidate) => candidate.kind === "anchor"
      && candidate.name === token.name
      && candidate.from < token.from));
}

async function effectiveSessionIndex(workspace, session, loading, templateProfileForKey) {
  if (loading.has(session.fileName)) {
    return ownIndex(session.document.index, session.fileName);
  }

  const nextLoading = new Set(loading).add(session.fileName);

  return composeIndex(session.document.index, session.fileName, async (name) => {
    const resolvedPath = resolveImportPath(workspace, session.fileName, name);
    const parent = workspace?.files?.find((candidate) => candidate.fileName === resolvedPath);

    if (parent) {
      return effectiveSessionIndex(workspace, parent, nextLoading, templateProfileForKey);
    }

    return templateProfileForKey ? effectiveProfileIndex(name, nextLoading, templateProfileForKey) : null;
  });
}

async function effectiveProfileIndex(name, loading, templateProfileForKey) {
  const profile = await templateProfileForKey(name);

  if (!profile || loading.has(profile.resourceName)) {
    return null;
  }

  const index = profileIndex(profile.data.options);
  const nextLoading = new Set(loading).add(profile.resourceName);

  return composeIndex(index, profile.resourceName, (parentName) => effectiveProfileIndex(parentName, nextLoading, templateProfileForKey));
}

async function composeIndex(localIndex, sourceName, resolveParent) {
  let entries = [];
  const imports = directImports(localIndex);
  const importedDefinitions = new Map();

  for (const imported of imports) {
    const parent = await resolveParent(imported.key);

    if (!parent) {
      continue;
    }

    const parameters = importParameters(localIndex, imported.key, parent);
    collectImportedAnchors(localIndex, imported.key, parent, parameters, sourceName, importedDefinitions);

    if (importExtends(localIndex, imported.key)) {
      const inherited = parent.entries
        .filter((entry) => !specialRoot(entry.path[0]))
        .flatMap((entry) => substituteEntries(entry, parameters, sourceName));
      entries = mergeEntries(entries, inherited);
    }
  }

  entries = mergeEntries(entries, localIndex.entries.map((entry) => ({
    ...entry,
    path: [...entry.path],
    key: entry.key ?? entry.path.at(-1),
    inherited: false,
    origin: sourceName
  })));

  const aliases = expandEffectiveAliases(indexFromEntries(entries), importedDefinitions);

  return expandEffectiveFunctions(aliases);
}

function directImports(index) {
  return index.entries.filter((entry) =>
    (entry.container || entry.emptyMapping)
      && entry.path.length === 2
      && entry.path[0] === "(import)"
  );
}

function importParameters(index, importName, parent) {
  const prefix = ["(import)", importName, "parameters"];
  const parameters = moduleParameterDefaults(parent);

  for (const [name, input] of index.entries
    .filter((entry) => entry.path.length === prefix.length + 1 && startsWith(entry.path, prefix))
    .map((entry) => [entry.key, parameterInput(index, entry)])) {
    parameters.set(name, input);
  }

  return parameters;
}

function moduleParameterDefaults(index) {
  const parameters = new Map();

  for (const entry of index.entries) {
    if (entry.path.length !== 4
      || entry.path[0] !== "(module)"
      || entry.path[1] !== "parameters"
      || entry.path[3] !== "default") {
      continue;
    }

    parameters.set(entry.path[2], parameterInput(index, entry));
  }

  return parameters;
}

function parameterInput(index, entry) {
  const blockScalar = parseBlockScalar(entry.source);

  return {
    entry,
    source: entry.source,
    value: blockScalar?.content ?? String(parseSimpleLiteral(entry.source).value ?? ""),
    collectionItems: entry.collectionItems?.map((item) => ({ ...item })) ?? null,
    blockScalar,
    descendants: index.entries.filter((candidate) => startsWith(candidate.path, entry.path))
  };
}

function importExtends(index, importName) {
  const entry = index.byPath.get(pathKey(["(import)", importName, "extend"]));

  if (!entry) {
    return true;
  }

  const value = parseSimpleLiteral(entry.source);

  return value.kind !== "boolean" || value.value;
}

function collectImportedAnchors(index, importName, parent, parameters, sourceName, definitions) {
  const anchors = index.byPath.get(pathKey(["(import)", importName, "anchors"]));

  for (const item of anchors?.collectionItems ?? []) {
    const imported = parseImportedAnchor(item.source);

    if (!imported) {
      continue;
    }

    const parentEntry = parent.entries
      .filter((entry) => parseAnchorName(entry.source) === imported.parentName)
      .at(-1);

    if (!parentEntry) {
      continue;
    }

    const substituted = [
      parentEntry,
      ...parent.entries.filter((entry) => startsWith(entry.path, parentEntry.path))
    ].flatMap((entry) => substituteEntries(entry, parameters, sourceName));
    definitions.set(imported.localName, {
      entry: substituted[0],
      descendants: substituted.slice(1),
      origin: parentEntry.origin
    });
  }
}

function substituteEntries(entry, parameters, inheritedBy) {
  const path = entry.path.map((segment) => replaceParameters(String(segment), parameters, false));
  const wholeInput = parameters.get(String(parseSimpleLiteral(entry.source).value ?? ""));

  if (wholeInput?.entry?.container) {
    return materializedMappingInput(entry, path, wholeInput, parameters, inheritedBy);
  }

  const source = wholeInput?.source ?? replaceParameters(entry.source, parameters, true);
  const collectionItems = wholeInput?.collectionItems
    ?? substituteCollectionItems(entry.collectionItems, parameters, path);
  const substituted = {
    ...entry,
    path,
    key: path.at(-1),
    source,
    container: wholeInput?.entry ? wholeInput.entry.container : entry.container,
    emptyMapping: wholeInput?.entry ? wholeInput.entry.emptyMapping : entry.emptyMapping,
    collectionItems,
    inherited: true,
    inheritedBy,
    origin: entry.origin
  };

  substituted.syntax = classifyKingdomsEntry(substituted);
  substituted.blockScalar = parseBlockScalar(source);

  return [substituted];
}

function materializedMappingInput(template, path, input, parameters, inheritedBy) {
  const inputPath = input.entry.path;

  return [input.entry, ...input.descendants].map((entry) => {
    const relativePath = entry.path.slice(inputPath.length);
    const nextPath = [...path, ...relativePath.map((segment) => replaceParameters(String(segment), parameters, false))];
    const source = replaceParameters(entry.source, parameters, true);
    const substituted = {
      ...entry,
      path: nextPath,
      key: nextPath.at(-1),
      source,
      collectionItems: substituteCollectionItems(entry.collectionItems, parameters, nextPath),
      comments: relativePath.length ? entry.comments : template.comments,
      annotations: relativePath.length ? entry.annotations : template.annotations,
      inherited: true,
      inheritedBy,
      origin: template.origin
    };

    substituted.syntax = classifyKingdomsEntry(substituted);
    substituted.blockScalar = parseBlockScalar(source);

    return substituted;
  });
}

function substituteCollectionItems(items, parameters, parentPath) {
  if (!items) {
    return null;
  }

  const substituted = [];

  for (const item of items) {
    const input = parameters.get(String(parseSimpleLiteral(item.source).value ?? ""));

    if (input?.collectionItems) {
      substituted.push(...input.collectionItems.map((candidate) => ({
        ...candidate,
        syntax: classifySequenceItem(candidate.source, parentPath)
      })));
      continue;
    }

    if (input?.blockScalar) {
      const lines = input.blockScalar.content.split(/\r\n|\n|\r/);

      while (lines.at(-1) === "") {
        lines.pop();
      }

      for (const line of lines) {
        substituted.push({
          ...item,
          source: JSON.stringify(line),
          syntax: classifySequenceItem(JSON.stringify(line), parentPath)
        });
      }

      continue;
    }

    const source = input?.source ?? replaceParameters(item.source, parameters, true);
    substituted.push({ ...item, source, syntax: classifySequenceItem(source, parentPath) });
  }

  return substituted;
}

function replaceParameters(source, parameters, preserveWholeNode) {
  const text = String(source);

  if (preserveWholeNode) {
    const literal = String(parseSimpleLiteral(text).value ?? "");
    const input = parameters.get(literal);

    if (input) {
      return input.source;
    }
  }

  let replaced = text;

  for (const [name, input] of parameters) {
    replaced = replaced.replaceAll(name, input.value);
  }

  return replaced;
}

function mergeEntries(baseEntries, overlayEntries) {
  const merged = [...baseEntries];

  for (const entry of overlayEntries) {
    const exact = merged.find((candidate) => samePath(candidate.path, entry.path));
    const blocksChildren = !entry.container || entry.emptyMapping || entry.annotations?.some((annotation) => annotation.id === "final");
    const parentStopsAtExisting = exact?.annotations?.some((annotation) => annotation.id === "ignore-if-set");

    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const candidate = merged[index];

      if (samePath(candidate.path, entry.path)
        || ((blocksChildren || parentStopsAtExisting) && startsWith(candidate.path, entry.path))) {
        merged.splice(index, 1);
      }
    }

    merged.push(entry);
  }

  return merged;
}

function ownIndex(index, sourceName) {
  return indexFromEntries(index.entries.map((entry) => ({
    ...entry,
    path: [...entry.path],
    inherited: false,
    origin: sourceName
  })));
}

function profileIndex(options) {
  const moduleParameters = options
    .filter((option) => option.path.length === 3 && option.path[0] === "(module)" && option.path[1] === "parameters")
    .map((option) => option.path[2]);
  const entries = options.map((option, line) => ({
    ...option,
    profile: true,
    path: [...option.path],
    key: option.path.at(-1),
    line,
    indent: option.indent ?? Math.max(0, (option.path.length - 1) * 2),
    annotations: annotationsFromComments(option.comments),
    syntax: classifyKingdomsEntry({ ...option, key: option.path.at(-1) }, moduleParameters),
    collectionItems: option.collectionItems?.map((source) => ({
      source,
      syntax: classifySequenceItem(source, option.path)
    })) ?? null
  }));

  return indexFromEntries(entries);
}

function indexFromEntries(entries) {
  return {
    entries,
    byPath: new Map(entries.map((entry) => [pathKey(entry.path), entry]))
  };
}

function emptyIndex() {
  return { entries: [], byPath: new Map() };
}

function specialRoot(key) {
  return key === "(module)" || key === "(import)";
}

function startsWith(path, prefix) {
  return path.length > prefix.length && prefix.every((segment, index) => path[index] === segment);
}

function samePath(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
