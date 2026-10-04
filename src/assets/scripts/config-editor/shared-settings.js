import {
  classifyKingdomsEntry,
  classifySequenceItem,
  parseAliasName,
  parseAnchorName,
  parseBlockScalar,
  parseSequenceMerge
} from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

export function expandEffectiveAliases(index, importedDefinitions = new Map()) {
  const explicitPaths = new Set(index.entries
    .filter((entry) => entry.syntax?.kind !== "mapping-merge")
    .map((entry) => pathKey(entry.path)));
  const expanded = [];

  for (const entry of index.entries) {
    const importedTemplate = expandImportedAnchorTemplate(entry, importedDefinitions);

    if (importedTemplate) {
      expanded.push(...importedTemplate);
      continue;
    }

    const alias = parseAliasName(entry.source);
    const definition = alias && resolveDefinition(index, importedDefinitions, alias, entry);

    if (entry.syntax?.kind === "mapping-merge" && definition?.entry.container) {
      const targetPath = entry.path.slice(0, -1);

      for (const child of definition.descendants) {
        const relative = child.path.slice(definition.entry.path.length);
        const nextPath = [...targetPath, ...relative];

        if (!explicitPaths.has(pathKey(nextPath))) {
          expanded.push(sharedEntry(child, nextPath, entry, definition, alias));
        }
      }

      continue;
    }

    if (entry.syntax?.kind === "alias" && definition) {
      expanded.push(sharedEntry(definition.entry, entry.path, entry, definition, alias, { root: true }));

      for (const child of definition.descendants) {
        expanded.push(sharedEntry(
          child,
          [...entry.path, ...child.path.slice(definition.entry.path.length)],
          entry,
          definition,
          alias
        ));
      }

      continue;
    }

    expanded.push(expandSequenceMerges(entry, index, importedDefinitions));
  }

  return indexFromEntries(expanded);
}

function expandImportedAnchorTemplate(entry, importedDefinitions) {
  const value = String(parseSimpleLiteral(entry.source).value ?? "");
  const exact = /^\[\*([A-Za-z0-9_-]+)]$/.exec(value);

  if (exact) {
    const definition = importedDefinitions.get(exact[1]);

    if (!definition) {
      return null;
    }

    return [
      sharedEntry(definition.entry, entry.path, entry, definition, exact[1], { root: true }),
      ...definition.descendants.map((child) => sharedEntry(
        child,
        [...entry.path, ...child.path.slice(definition.entry.path.length)],
        entry,
        definition,
        exact[1]
      ))
    ];
  }

  let source = entry.source;
  let changed = false;

  for (const [name, definition] of importedDefinitions) {
    const token = `[*${name}]`;

    if (!source.includes(token) || definition.entry.container || definition.entry.collectionItems) {
      continue;
    }

    const sharedSource = withoutAnchor(definition.entry.source);
    const replacement = String(parseSimpleLiteral(sharedSource).value ?? "");
    source = source.replaceAll(token, replacement);
    changed = true;
  }

  if (!changed) {
    return null;
  }

  const projected = { ...entry, source, inherited: true, shared: true };
  projected.syntax = classifyKingdomsEntry(projected);
  projected.blockScalar = parseBlockScalar(source);
  return [projected];
}

function expandSequenceMerges(entry, index, importedDefinitions) {
  if (!entry.collectionItems?.some((item) => parseSequenceMerge(item.source))) {
    return entry;
  }

  const items = [];

  for (const item of entry.collectionItems) {
    const merge = parseSequenceMerge(item.source);
    const definition = merge && resolveDefinition(index, importedDefinitions, merge.anchor, {
      ...entry,
      line: item.line ?? entry.line
    });

    if (!merge || !definition?.entry.collectionItems) {
      items.push(item);
      continue;
    }

    items.push(...definition.entry.collectionItems.map((candidate) => ({
      ...candidate,
      syntax: classifySequenceItem(candidate.source, entry.path),
      inherited: true,
      shared: true,
      sharedBy: merge.anchor,
      sharedOrigin: definition.origin
    })));
  }

  return { ...entry, collectionItems: items };
}

function resolveDefinition(index, importedDefinitions, name, useEntry) {
  const own = index.entries
    .filter((candidate) => candidate.origin === useEntry.origin
      && candidate.line <= useEntry.line
      && parseAnchorName(candidate.source) === name)
    .at(-1);

  if (own) {
    return definitionFromIndex(index, own);
  }

  return importedDefinitions.get(name) ?? null;
}

function definitionFromIndex(index, entry) {
  return {
    entry,
    descendants: index.entries.filter((candidate) => startsWith(candidate.path, entry.path)),
    origin: entry.origin ?? ""
  };
}

function sharedEntry(template, path, useEntry, definition, name, { root = false } = {}) {
  const source = root ? withoutAnchor(template.source) : template.source;
  const entry = {
    ...template,
    path,
    key: path.at(-1),
    source,
    line: useEntry.line,
    inherited: true,
    inheritedBy: useEntry.origin,
    origin: definition.origin,
    shared: true,
    sharedBy: name,
    sharedCallPath: [...useEntry.path],
    sharedDefinitionPath: [...definition.entry.path],
    sharedDefinitionSource: definition.entry.source,
    sharedDefinitionIndent: definition.entry.indent ?? 0,
    sharedOrigin: definition.origin,
    collectionItems: template.collectionItems?.map((item) => ({ ...item })) ?? null
  };
  entry.syntax = classifyKingdomsEntry(entry);
  entry.blockScalar = parseBlockScalar(source);
  return entry;
}

function withoutAnchor(source) {
  return String(source).replace(/^(\s*)&[A-Za-z0-9_-]+(?:[ \t])?/, "$1");
}

function indexFromEntries(entries) {
  return { entries, byPath: new Map(entries.map((entry) => [pathKey(entry.path), entry])) };
}

function startsWith(path, prefix) {
  return path.length > prefix.length && prefix.every((segment, index) => path[index] === segment);
}
