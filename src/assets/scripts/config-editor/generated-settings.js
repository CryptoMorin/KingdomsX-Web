import {
  classifyKingdomsEntry,
  classifySequenceItem,
  parseAliasName,
  parseAnchorName,
  parseBlockScalar,
  parseFunctionCall
} from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

export function expandEffectiveFunctions(index) {
  const definitions = functionDefinitions(index);

  if (!definitions.length) {
    return index;
  }

  const namedCalls = namedFunctionCalls(index, definitions);
  const namedOwners = new Map(namedCalls.map((call) => [pathKey(call.ownerPath), call]));
  const skippedNamedPaths = namedCalls.map((call) => call.ownerPath);
  const directCalls = new Map();

  for (const entry of index.entries) {
    if (!["function-call", "function-merge"].includes(entry.syntax?.kind)) {
      continue;
    }

    const parsed = parseFunctionCall(entry.source);
    const definition = parsed && matchingDefinition(definitions, parsed.name, entry);

    if (!definition) {
      continue;
    }

    directCalls.set(pathKey(entry.path), {
      entry,
      definition,
      inputs: positionalInputs(definition, parsed.args),
      merge: entry.syntax.kind === "function-merge"
    });
  }

  const replacedCollections = expandedCollections(index, definitions);
  const localPaths = new Set(index.entries
    .filter((entry) => !directCalls.has(pathKey(entry.path))
      && !skippedNamedPaths.some((path) => startsWithOrEqual(entry.path, path)))
    .map((entry) => pathKey(entry.path)));
  const expanded = [];

  for (const original of index.entries) {
    const key = pathKey(original.path);
    const named = namedOwners.get(key);

    if (named) {
      expanded.push(...mappingResultEntries(named.definition, named.targetPath, named.inputs, named.callEntry, localPaths));
      continue;
    }

    if (skippedNamedPaths.some((path) => startsWithOrEqual(original.path, path))) {
      continue;
    }

    const direct = directCalls.get(key);

    if (direct) {
      expanded.push(...directResultEntries(direct, localPaths));
      continue;
    }

    expanded.push(replacedCollections.get(key) ?? original);
  }

  return indexFromEntries(expanded);
}

function functionDefinitions(index) {
  return index.entries
    .map((entry, position) => {
      if (entry.syntax?.kind !== "function-declaration") {
        return null;
      }

      const name = parseAnchorName(entry.source);
      const args = index.byPath.get(pathKey([...entry.path, "args"]));
      const result = index.byPath.get(pathKey([...entry.path, "return"]));

      if (!name || !result) {
        return null;
      }

      return {
        name,
        entry,
        position,
        parameters: (args?.collectionItems ?? []).map((item) => String(parseSimpleLiteral(item.source).value)),
        result,
        resultEntries: index.entries.filter((candidate) => startsWith(candidate.path, result.path))
      };
    })
    .filter(Boolean);
}

function matchingDefinition(definitions, name, callEntry) {
  const sameSource = definitions.filter((definition) =>
    definition.name === name
      && definition.entry.origin === callEntry.origin
      && definition.entry.line <= callEntry.line
  ).at(-1);

  if (sameSource) {
    return sameSource;
  }

  return definitions.filter((definition) => definition.name === name).at(-1) ?? null;
}

function namedFunctionCalls(index, definitions) {
  const calls = [];

  for (const entry of index.entries) {
    if (entry.syntax?.kind !== "named-function-call") {
      continue;
    }

    const name = parseAliasName(entry.source);
    const definition = name && matchingDefinition(definitions, name, entry);

    if (!definition) {
      continue;
    }

    const ownerPath = entry.path.slice(0, -1);
    const merge = ownerPath.at(-1) === "<<";
    const targetPath = merge ? ownerPath.slice(0, -1) : ownerPath;
    const inputs = new Map();

    for (const parameter of definition.parameters) {
      const input = index.byPath.get(pathKey([...ownerPath, parameter]));

      if (input) {
        inputs.set(parameter, inputValue(input, index));
      }
    }

    calls.push({ ownerPath, targetPath, callEntry: entry, definition, inputs });
  }

  return calls;
}

function positionalInputs(definition, args) {
  return new Map(definition.parameters.map((parameter, index) => [parameter, {
    source: args[index] ?? "",
    value: String(parseSimpleLiteral(args[index] ?? "").value ?? ""),
    collectionItems: null,
    blockScalar: null
  }]));
}

function inputValue(entry, index) {
  const blockScalar = parseBlockScalar(entry.source);

  return {
    entry,
    source: entry.source,
    value: blockScalar?.content ?? String(parseSimpleLiteral(entry.source).value ?? ""),
    collectionItems: entry.collectionItems ?? null,
    blockScalar,
    descendants: index.entries.filter((candidate) => startsWith(candidate.path, entry.path))
  };
}

function directResultEntries(call, localPaths) {
  const { definition, entry, inputs, merge } = call;

  if (merge) {
    if (!definition.result.container) {
      return [];
    }

    return mappingResultEntries(definition, entry.path.slice(0, -1), inputs, entry, localPaths);
  }

  if (!definition.result.container) {
    return generatedEntries(definition.result, entry.path, inputs, entry);
  }

  const root = generatedEntries(definition.result, entry.path, inputs, entry)[0];
  root.container = true;
  root.collectionItems = null;
  root.generatedBy = definition.name;

  return [root, ...mappingResultEntries(definition, entry.path, inputs, entry, localPaths)];
}

function mappingResultEntries(definition, targetPath, inputs, callEntry, localPaths) {
  if (!definition.result.container) {
    return [];
  }

  return definition.resultEntries
    .flatMap((entry) => generatedEntries(
      entry,
      [...targetPath, ...substitutePath(entry.path.slice(definition.result.path.length), inputs)],
      inputs,
      callEntry
    ))
    .filter((entry) => !localPaths.has(pathKey(entry.path)));
}

function generatedEntries(template, path, inputs, callEntry) {
  const parameter = inputs.get(String(parseSimpleLiteral(template.source).value ?? ""));

  if (parameter?.entry?.container) {
    const entries = [parameter.entry, ...parameter.descendants].map((entry) => generatedEntry(
      entry,
      [...path, ...entry.path.slice(parameter.entry.path.length)],
      new Map(),
      callEntry
    ));

    return entries;
  }

  return [generatedEntry(template, path, inputs, callEntry)];
}

function generatedEntry(template, path, inputs, callEntry) {
  const source = substituteSource(template.source, inputs);
  const entry = {
    ...template,
    path,
    key: path.at(-1),
    source,
    line: callEntry.line,
    inherited: Boolean(callEntry.inherited),
    inheritedBy: callEntry.inheritedBy,
    origin: callEntry.origin,
    generated: true,
    generatedBy: parseFunctionCall(callEntry.source)?.name ?? parseAliasName(callEntry.source) ?? "",
    generatedCallPath: [...callEntry.path],
    collectionItems: substituteItems(template.collectionItems, inputs, template.path) ?? null
  };
  entry.syntax = classifyKingdomsEntry(entry);
  entry.blockScalar = parseBlockScalar(source);
  return entry;
}

function substitutePath(path, inputs) {
  return path.map((segment) => {
    let result = String(segment);

    for (const [name, input] of inputs) {
      result = result.replaceAll(name, input.value);
    }

    return result;
  });
}

function substituteSource(source, inputs) {
  const text = String(source);
  const literal = String(parseSimpleLiteral(text).value ?? "");
  const wholeInput = inputs.get(literal);

  if (wholeInput) {
    return wholeInput.source;
  }

  let result = text;

  for (const [name, input] of inputs) {
    result = result.replaceAll(name, input.value);
  }

  return result;
}

function substituteItems(items, inputs, parentPath) {
  if (!items) {
    return null;
  }

  const result = [];

  for (const item of items) {
    const literal = String(parseSimpleLiteral(item.source).value ?? "");
    const input = inputs.get(literal);

    if (input?.collectionItems) {
      result.push(...input.collectionItems.map((candidate) => ({
        ...candidate,
        syntax: classifySequenceItem(candidate.source, parentPath)
      })));
      continue;
    }

    const source = input?.blockScalar ? JSON.stringify(input.blockScalar.content) : substituteSource(item.source, inputs);
    result.push({ ...item, source, syntax: classifySequenceItem(source, parentPath) });
  }

  return result;
}

function expandedCollections(index, definitions) {
  const replacements = new Map();

  for (const entry of index.entries) {
    if (!entry.collectionItems?.some((item) => item.syntax?.kind === "function-call")) {
      continue;
    }

    const items = [];

    for (const item of entry.collectionItems) {
      if (item.syntax?.kind !== "function-call") {
        items.push(item);
        continue;
      }

      const parsed = parseFunctionCall(item.source);
      const definition = parsed && matchingDefinition(definitions, parsed.name, entry);

      if (!definition) {
        items.push(item);
        continue;
      }

      const inputs = positionalInputs(definition, parsed.args);

      if (definition.result.collectionItems) {
        items.push(...substituteItems(definition.result.collectionItems, inputs, entry.path));
      } else if (!definition.result.container) {
        const source = substituteSource(definition.result.source, inputs);

        items.push({
          ...item,
          source,
          syntax: classifySequenceItem(source, entry.path),
          generated: true,
          generatedBy: definition.name
        });
      } else {
        items.push(item);
      }
    }

    replacements.set(pathKey(entry.path), { ...entry, collectionItems: items });
  }

  return replacements;
}

function indexFromEntries(entries) {
  return { entries, byPath: new Map(entries.map((entry) => [pathKey(entry.path), entry])) };
}

function startsWith(path, prefix) {
  return path.length > prefix.length && prefix.every((segment, index) => path[index] === segment);
}

function startsWithOrEqual(path, prefix) {
  return path.length >= prefix.length && prefix.every((segment, index) => path[index] === segment);
}
