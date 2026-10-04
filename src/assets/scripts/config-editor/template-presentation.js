import {
  parseAliasName,
  parseAnchorName,
  parseFunctionCall,
  parseImportedAnchor
} from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey, reusableValueShape } from "./yaml-source.js";
import { resolveImportPath, workspaceRelationships } from "./workspace-dependencies.js";

export function buildTemplatePresentation({
  index,
  effectiveIndex = index,
  workspace = null,
  session = null
}) {
  const definitions = functionDefinitions(index);
  const functionCalls = new Map();
  const namedCalls = new Map();
  const declarations = new Map(definitions.map((definition) => [pathKey(definition.entry.path), definition]));

  for (const entry of index.entries) {
    if (["function-call", "function-merge"].includes(entry.syntax?.kind)) {
      const parsed = parseFunctionCall(entry.source);

      if (!parsed) {
        continue;
      }

      const definition = matchingDefinition(definitions, parsed.name, entry);
      const parameters = definition?.parameters ?? [];

      functionCalls.set(pathKey(entry.path), {
        kind: entry.syntax.kind,
        entry,
        parsed,
        definition,
        definitions: definitionsBefore(definitions, entry),
        inputs: parsed.args.map((value, position) => ({
          name: parameters[position] ?? "",
          label: parameterLabel(parameters[position]) || `Argument ${position + 1}`,
          value,
          extra: position >= parameters.length
        })),
        missing: parameters.slice(parsed.args.length),
        generated: generatedForCall(effectiveIndex, entry.path)
      });
    }

    if (entry.syntax?.kind === "named-function-call") {
      const name = parseAliasName(entry.source);
      const definition = name && matchingDefinition(definitions, name, entry);
      const ownerPath = entry.path.slice(0, -1);
      const supplied = directChildren(index, ownerPath).filter((candidate) => candidate.key !== "[fn]");
      const suppliedNames = new Set(supplied.map((candidate) => candidate.key));
      const parameters = definition?.parameters ?? [];

      namedCalls.set(pathKey(ownerPath), {
        kind: "named-function-call",
        entry,
        ownerPath,
        name,
        definition,
        definitions: definitionsBefore(definitions, entry),
        supplied,
        missing: parameters.filter((parameter) => !suppliedNames.has(parameter)),
        unknown: supplied.filter((candidate) => !parameters.includes(candidate.key)),
        generated: generatedForCall(effectiveIndex, entry.path)
      });
    }
  }

  for (const definition of definitions) {
    definition.calls = [
      ...functionCalls.values(),
      ...namedCalls.values()
    ].filter((call) => call.definition?.entry === definition.entry);
  }

  const relationships = workspace && session
    ? workspaceRelationships(workspace, session)
    : { dependencies: [], consumers: [], related: [], warnings: [] };
  const imports = importPresentations(index, workspace, session, relationships);
  const module = modulePresentation(index, relationships.consumers);
  const importedAnchors = new Map();

  for (const entry of index.entries) {
    if (entry.syntax?.kind !== "imported-anchor") {
      continue;
    }

    const parsed = parseImportedAnchor(entry.source);

    if (!parsed) {
      continue;
    }

    const importName = entry.path[0] === "(import)" ? entry.path[1] : "";
    const imported = imports.get(pathKey(["(import)", importName]));

    importedAnchors.set(pathKey(entry.path), {
      parsed,
      importName,
      parentPath: imported?.parentPath ?? null,
      parentFileName: imported?.parentFileName ?? "",
      available: imported?.anchors ?? [],
      resolved: imported?.anchors.find((candidate) => candidate.name === parsed.parentName) ?? null
    });
  }

  return {
    definitions,
    declarations,
    functionCalls,
    namedCalls,
    imports,
    importedAnchors,
    module,
    relationships,
    effectiveEntries: effectiveIndex.entries.filter((entry) => !["(module)", "(import)"].includes(entry.path[0])),
    contextForEntry(entry) {
      const key = pathKey(entry.path);
      const imported = entry.path[0] === "(import)"
        ? imports.get(pathKey(entry.path.slice(0, 2)))
        : null;
      const importContext = imported && entry.path[2] === "anchors"
        ? { kind: "import-anchors", imported }
        : imported && entry.path[2] === "parameters"
          ? {
              kind: "import-parameter",
              imported,
              parameter: imported.parameters.find((parameter) => parameter.name === entry.key) ?? null
            }
          : null;

      return functionCalls.get(key)
        ?? importedAnchors.get(key)
        ?? importContext
        ?? templateUsage(index, module, entry, imports);
    }
  };
}

function functionDefinitions(index) {
  return index.entries.flatMap((entry) => {
    if (entry.syntax?.kind !== "function-declaration") {
      return [];
    }

    const name = parseAnchorName(entry.source);
    const args = index.byPath.get(pathKey([...entry.path, "args"]));
    const result = index.byPath.get(pathKey([...entry.path, "return"]));

    if (!name || !result) {
      return [];
    }

    return [{
      name,
      entry,
      parameters: (args?.collectionItems ?? []).map((item) => String(parseSimpleLiteral(item.source).value ?? "")),
      result,
      resultEntries: index.entries.filter((candidate) => startsWith(candidate.path, result.path)),
      calls: []
    }];
  });
}

function matchingDefinition(definitions, name, entry) {
  return definitions
    .filter((definition) => definition.name === name && definition.entry.line <= entry.line)
    .at(-1) ?? null;
}

function definitionsBefore(definitions, entry) {
  return definitions.filter((definition) => definition.entry.line <= entry.line);
}

function generatedForCall(index, callPath) {
  return index.entries.filter((entry) =>
    entry.generated
      && Array.isArray(entry.generatedCallPath)
      && samePath(entry.generatedCallPath, callPath)
  );
}

function modulePresentation(index, consumers) {
  const root = index.byPath.get(pathKey(["(module)"]));

  if (!root) {
    return null;
  }

  const parameters = directChildren(index, ["(module)", "parameters"]).map((entry) => {
    const typeEntry = entry.container ? index.byPath.get(pathKey([...entry.path, "type"])) : entry;
    const defaultEntry = entry.container ? index.byPath.get(pathKey([...entry.path, "default"])) : null;
    const usages = index.entries.filter((candidate) =>
      !startsWith(candidate.path, ["(module)"])
        && (candidate.key.includes(entry.key)
          || candidate.source.includes(entry.key)
          || candidate.collectionItems?.some((item) => item.source.includes(entry.key)))
    );

    return {
      name: entry.key,
      label: parameterLabel(entry.key),
      type: typeEntry ? String(parseSimpleLiteral(typeEntry.source).value ?? typeEntry.source) : "Any value",
      defaultValue: defaultEntry ? String(parseSimpleLiteral(defaultEntry.source).value ?? defaultEntry.source) : "",
      required: !defaultEntry,
      usages
    };
  });

  return { root, parameters, consumers };
}

function importPresentations(index, workspace, session, relationships) {
  const imports = new Map();

  for (const entry of directChildren(index, ["(import)"])) {
    const parentPath = workspace && session ? resolveImportPath(workspace, session.fileName, entry.key) : null;
    const parent = workspace?.files?.find((candidate) => candidate.fileName === parentPath) ?? null;
    const parentModule = parent ? modulePresentation(parent.document.index, []) : null;
    const parameters = parentModule?.parameters ?? [];
    const supplied = directChildren(index, ["(import)", entry.key, "parameters"]);
    const suppliedByName = new Map(supplied.map((candidate) => [candidate.key, candidate]));
    const anchors = parent
      ? parent.document.index.entries.flatMap((candidate) => {
        const name = parseAnchorName(candidate.source);

        return name ? [{ name, path: candidate.path, shape: reusableValueShape(candidate, parent.document.index) }] : [];
      })
      : [];
    const extendEntry = index.byPath.get(pathKey(["(import)", entry.key, "extend"]));
    imports.set(pathKey(entry.path), {
      entry,
      name: entry.key,
      parentPath,
      parentFileName: parent?.fileName ?? parentPath ?? "",
      resolved: Boolean(parent),
      parameters,
      supplied,
      suppliedByName,
      missing: parameters.filter((parameter) => parameter.required && !suppliedByName.has(parameter.name)),
      unknown: supplied.filter((candidate) => !parameters.some((parameter) => parameter.name === candidate.key)),
      extend: extendEntry ? parseSimpleLiteral(extendEntry.source).value !== false : true,
      anchors,
      dependency: relationships.dependencies.find((candidate) => candidate.name === entry.key) ?? null
    });
  }

  return imports;
}

function templateUsage(index, module, entry, imports) {
  if (entry.syntax?.kind === "imported-anchor-template") {
    const references = [...entry.source.matchAll(/\[\*([A-Za-z0-9_-]+)]/g)].map((match) => match[1]);

    return {
      kind: "imported-anchor-template",
      references,
      resolved: references.map((name) => {
        const declaration = index.entries.find((candidate) =>
          candidate.collectionItems?.some((item) => parseImportedAnchor(item.source)?.localName === name)
        );

        if (!declaration) {
          return { name, declarationPath: null, parentFileName: "", parentPath: null };
        }

        const imported = imports.get(pathKey(declaration.path.slice(0, 2)));
        const importedPair = declaration.collectionItems
          .map((item) => parseImportedAnchor(item.source))
          .find((candidate) => candidate?.localName === name);
        const parent = imported?.anchors.find((candidate) => candidate.name === importedPair?.parentName);

        return {
          name,
          declarationPath: declaration.path,
          parentFileName: imported?.parentFileName ?? "",
          parentPath: parent?.path ?? null
        };
      })
    };
  }

  if (entry.syntax?.kind !== "module-template" || !module) {
    return null;
  }

  const parameters = module.parameters.filter((parameter) =>
    entry.key.includes(parameter.name)
      || entry.source.includes(parameter.name)
      || entry.collectionItems?.some((item) => item.source.includes(parameter.name))
  );

  if (!parameters.length) {
    return null;
  }

  const literal = String(parseSimpleLiteral(entry.source).value ?? "");

  return {
    kind: "module-template",
    parameters,
    wholeNode: parameters.some((parameter) => literal === parameter.name),
    inKey: parameters.some((parameter) => entry.key.includes(parameter.name)),
    inList: Boolean(entry.collectionItems)
  };
}

function directChildren(index, parentPath) {
  return index.entries.filter((entry) =>
    entry.path.length === parentPath.length + 1 && startsWith(entry.path, parentPath)
  );
}

function parameterLabel(value) {
  return String(value ?? "")
    .replace(/^<|>$/g, "")
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("en-US"));
}

function startsWith(path, prefix) {
  return path.length >= prefix.length && prefix.every((segment, index) => path[index] === segment);
}

function samePath(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
