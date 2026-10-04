import {
  parseAliasName,
  parseAnchorName,
  parseFunctionCall,
  parseImportedAnchor,
  parseSequenceMerge
} from "./kingdoms-yaml.js";
import { parseSimpleLiteral, reusableValueShape } from "./yaml-source.js";

export function customYamlWarnings(index) {
  const warnings = [];
  const definitions = anchorDefinitions(index);
  const functions = functionDefinitions(index);

  for (const entry of index.entries) {
    validateEntryAlias(entry, index, definitions, functions, warnings);
    validateFunctionCall(entry.source, entry.path, entry.line, definitions, functions, warnings);
    validateEmbeddedAnchors(entry, definitions, warnings);

    for (const item of entry.collectionItems ?? []) {
      const line = item.line ?? entry.line;
      validateListItem(item.source, entry.path, line, index, definitions, functions, warnings);
    }
  }

  return [...new Set(warnings)];
}

function validateEmbeddedAnchors(entry, definitions, warnings) {
  for (const match of entry.source.matchAll(/\[\*([A-Za-z0-9_-]+)]/g)) {
    if (!resolveDefinition(definitions, match[1], entry.line)) {
      warnings.push(`${displayPath(entry.path)} inserts shared value “${match[1]}” before that name is defined.`);
    }
  }
}

function validateEntryAlias(entry, index, definitions, functions, warnings) {
  const alias = parseAliasName(entry.source);

  if (!alias) {
    return;
  }

  if (entry.syntax?.kind === "named-function-call") {
    if (!validateFunctionTarget(alias, entry.path.slice(0, -1), entry.line, definitions, functions, warnings)) {
      return;
    }

    const definition = resolveFunction(functions, alias, entry.line);

    if (!definition) {
      return;
    }

    const ownerPath = entry.path.slice(0, -1);
    const supplied = index.entries
      .filter((candidate) => candidate.path.length === ownerPath.length + 1
        && startsWithPath(candidate.path, ownerPath)
        && candidate.key !== "[fn]")
      .map((candidate) => candidate.key);
    const missing = definition.arguments.filter((name) => !supplied.includes(name));
    const unknown = supplied.filter((name) => !definition.arguments.includes(name));

    if (missing.length) {
      warnings.push(`${displayPath(ownerPath)} is missing ${word(missing.length, "generator input")}: ${missing.join(", ")}.`);
    }

    if (unknown.length) {
      warnings.push(`${displayPath(ownerPath)} supplies unknown ${word(unknown.length, "generator input")}: ${unknown.join(", ")}.`);
    }

    return;
  }

  if (functionParameterAvailable(entry, alias, functions)) {
    return;
  }

  const definition = resolveDefinition(definitions, alias, entry.line);

  if (!definition) {
    warnings.push(`${displayPath(entry.path)} links to shared value “${alias}” before that name is defined.`);
    return;
  }

  if (entry.syntax?.kind === "mapping-merge" && definition.entry
    && reusableValueShape(definition.entry, index) !== "section") {
    warnings.push(`${displayPath(entry.path)} can only merge a shared section, but “${alias}” contains a ${reusableValueShape(definition.entry, index)}.`);
  }
}

function validateListItem(source, parentPath, line, index, definitions, functions, warnings) {
  const call = parseFunctionCall(source);

  if (call) {
    validateParsedFunctionCall(call, parentPath, line, definitions, functions, warnings);
    return;
  }

  const merge = parseSequenceMerge(source);

  if (merge) {
    const definition = resolveDefinition(definitions, merge.anchor, line);

    if (!definition) {
      warnings.push(`${displayPath(parentPath)} adds shared list “${merge.anchor}” before that name is defined.`);
    } else if (definition.entry && reusableValueShape(definition.entry, index) !== "list") {
      warnings.push(`${displayPath(parentPath)} can only add shared list items, but “${merge.anchor}” contains a ${reusableValueShape(definition.entry, index)}.`);
    }

    return;
  }

  const alias = parseAliasName(source);

  if (alias && !resolveDefinition(definitions, alias, line) && !functionParameterAvailableAtPath(parentPath, alias, functions)) {
    warnings.push(`${displayPath(parentPath)} links to shared value “${alias}” before that name is defined.`);
  }
}

function validateFunctionCall(source, path, line, definitions, functions, warnings) {
  const call = parseFunctionCall(source);

  if (call) {
    validateParsedFunctionCall(call, path, line, definitions, functions, warnings);
  }
}

function validateParsedFunctionCall(call, path, line, definitions, functions, warnings) {
  if (!validateFunctionTarget(call.name, path, line, definitions, functions, warnings)) {
    return;
  }

  const definition = resolveFunction(functions, call.name, line);

  if (definition && definition.arguments.length !== call.args.length) {
    warnings.push(`${displayPath(path)} supplies ${call.args.length} ${word(call.args.length, "input")} to “${call.name}”, but it expects ${definition.arguments.length}.`);
  }
}

function validateFunctionTarget(name, path, line, definitions, functions, warnings) {
  const definition = resolveDefinition(definitions, name, line);

  if (!definition) {
    warnings.push(`${displayPath(path)} uses entry generator “${name}” before that name is defined.`);
    return false;
  }

  if (definition.imported || resolveFunction(functions, name, line)) {
    return true;
  }

  warnings.push(`${displayPath(path)} calls “${name}” as a generator, but that shared value is not an entry generator.`);
  return false;
}

function anchorDefinitions(index) {
  const definitions = [];

  for (const entry of index.entries) {
    const name = parseAnchorName(entry.source);

    if (name) {
      definitions.push({ name, line: entry.line, entry, imported: false });
    }

    for (const item of entry.collectionItems ?? []) {
      const imported = entry.path.includes("anchors") && parseImportedAnchor(item.source);
      const itemName = parseAnchorName(item.source);

      if (itemName) {
        definitions.push({
          name: itemName,
          line: item.line ?? entry.line,
          entry: null,
          imported: Boolean(imported)
        });
      }
    }
  }

  return definitions;
}

function functionDefinitions(index) {
  return index.entries
    .filter((entry) => entry.syntax?.kind === "function-declaration")
    .map((entry) => {
      const args = index.byPath.get([...entry.path, "args"].join("\u0000"));

      return {
        name: parseAnchorName(entry.source),
        line: entry.line,
        path: entry.path,
        arguments: (args?.collectionItems ?? []).map((item) => String(parseSimpleLiteral(item.source).value))
      };
    })
    .filter((definition) => definition.name);
}

function resolveDefinition(definitions, name, line) {
  return definitions.filter((definition) => definition.name === name && definition.line <= line).at(-1);
}

function resolveFunction(functions, name, line) {
  return functions.filter((definition) => definition.name === name && definition.line <= line).at(-1);
}

function functionParameterAvailable(entry, alias, functions) {
  return functionParameterAvailableAtPath(entry.path, alias, functions);
}

function functionParameterAvailableAtPath(path, alias, functions) {
  const owner = functions.find((definition) => startsWithPath(path, definition.path));

  return owner?.arguments.includes(alias) ?? false;
}

function startsWithPath(path, prefix) {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

function displayPath(path) {
  return path.join(" → ") || "Config";
}

function word(count, singular) {
  return `${singular}${count === 1 ? "" : "s"}`;
}
