import { parseBlockScalar } from "./kingdoms-yaml.js";
import { expandEffectiveAliases } from "./shared-settings.js";
import { parseSimpleLiteral } from "./yaml-source.js";

const MESSAGE_MACRO = /\{\$([^${}]+)}/g;
const MESSAGE_REFERENCE = /\{\$\$([^{}]+)}/g;
const MAX_EXPANSION_DEPTH = 64;
const MAX_PREVIEW_LENGTH = 65_536;
const MAX_EXPANSION_WORK = 1_000_000;
const MAX_RESOLVED_LENGTH = 2_000_000;
const RUNTIME_MESSAGE_MACROS = new Set([
  "channel",
  "groupcolor",
  "kingdomprefix",
  "nationprefix",
  "spy"
]);

export function messageMacroContext(
  workspace,
  session,
  fallbackLanguageOptions = [],
  fallbackConfigOptions = []
) {
  const configSession = findConfigSession(workspace, session);
  const languageSession = findLanguageSession(workspace, session, configSession);
  const definitions = new Map();
  const references = new Map();

  if (configSession) {
    collectDefinitions(definitions, configSession, ["placeholders", "variables"]);
  } else if (fallbackConfigOptions.length) {
    collectProfileDefinitions(
      definitions,
      fallbackConfigOptions,
      ["placeholders", "variables"],
      "config.yml"
    );
  }

  if (languageSession) {
    collectDefinitions(definitions, languageSession, ["variables"]);
    collectLanguageReferences(
      references,
      expandEffectiveAliases(languageSession.document.index).entries,
      languageSession.fileName
    );
  } else if (fallbackLanguageOptions.length) {
    collectProfileDefinitions(definitions, fallbackLanguageOptions, ["variables"], "languages/en.yml");
    collectLanguageReferences(references, fallbackLanguageOptions, "languages/en.yml");
  }

  const budget = { work: 0, length: 0 };

  return {
    configFileName: configSession?.fileName ?? "",
    languageFileName: languageSession?.fileName ?? "",
    canValidate: Boolean(configSession) && (!guiLanguage(session?.fileName) || languageSession),
    definitions,
    values: resolveDefinitions(definitions, MESSAGE_MACRO, normalizeName, "$", budget),
    references: resolveDefinitions(references, MESSAGE_REFERENCE, normalizeReference, "$$", budget)
  };
}

export function resolveMessageMacros(source, context) {
  const values = context?.values ?? context ?? new Map();
  const references = context?.references ?? new Map();
  const referenced = replaceWithinPreviewLimit(String(source ?? ""), MESSAGE_REFERENCE, (token, name) =>
    references.get(normalizeReference(name)) ?? token
  );

  return replaceWithinPreviewLimit(referenced, MESSAGE_MACRO, (token, name) =>
    values.get(normalizeName(name)) ?? token
  );
}

export function undefinedMessageMacroWarnings(index, context) {
  if (!context?.canValidate) {
    return [];
  }

  const unknown = new Map();

  for (const entry of index?.entries ?? []) {
    if (entry.container) {
      continue;
    }

    collectUnknownMacros(unknown, entry.source, entry.path, context.definitions);
    for (const item of entry.collectionItems ?? []) {
      collectUnknownMacros(unknown, item.source, entry.path, context.definitions);
    }
  }

  return [...unknown.values()].map(({ token, path }) =>
    `${displayPath(path)} uses undefined macro ${token}. Add it under placeholders → variables in ${context.configFileName}, or under variables in this language file.`
  );
}

function findConfigSession(workspace, session) {
  const candidates = (workspace?.files ?? []).filter((candidate) =>
    /(?:^|\/)config\.ya?ml$/i.test(normalizePath(candidate.fileName))
  );

  if (!candidates.length) {
    return null;
  }

  const currentPath = normalizePath(session?.fileName);

  return candidates
    .map((candidate) => ({
      session: candidate,
      directory: normalizePath(candidate.fileName).replace(/(?:^|\/)config\.ya?ml$/i, "")
    }))
    .filter(({ directory }) => !directory || currentPath.startsWith(`${directory}/`) || currentPath === directory)
    .sort((left, right) => right.directory.length - left.directory.length)[0]?.session
    ?? candidates.find((candidate) => !normalizePath(candidate.fileName).includes("/"))
    ?? candidates[0];
}

function findLanguageSession(workspace, session, configSession) {
  const currentPath = normalizePath(session?.fileName);
  const ownLanguage = /(?:^|\/)languages\/([^/]+)\.ya?ml$/i.exec(currentPath);
  const locale = (ownLanguage?.[1] ?? guiLanguage(currentPath)) || "en";

  const candidates = (workspace?.files ?? []).filter((candidate) =>
    new RegExp(`(?:^|/)languages/${escapeRegExp(locale)}\\.ya?ml$`, "i")
      .test(normalizePath(candidate.fileName))
  );

  if (!candidates.length) {
    return ownLanguage ? session : null;
  }

  const configRoot = normalizePath(configSession?.fileName)
    .replace(/(?:^|\/)config\.ya?ml$/i, "");

  if (configRoot) {
    const local = candidates.find((candidate) =>
      normalizePath(candidate.fileName).startsWith(`${configRoot}/languages/`)
    );

    if (local) {
      return local;
    }
  }

  const expectedRoot = currentPath.replace(/(?:^|\/)(?:languages\/[^/]+\.ya?ml|guis\/[^/]+\/.*)$/i, "");

  return candidates.find((candidate) =>
    normalizePath(candidate.fileName).replace(/(?:^|\/)languages\/[^/]+\.ya?ml$/i, "") === expectedRoot
  ) ?? candidates[0];
}

function collectProfileDefinitions(target, entries, parentPath, fileName) {
  for (const entry of entries) {
    if (entry.container
      || entry.path.length !== parentPath.length + 1
      || !startsWith(entry.path, parentPath)) {
      continue;
    }

    target.set(normalizeName(entry.path.at(-1)), {
      name: String(entry.path.at(-1)),
      path: entry.path,
      fileName,
      value: scalarValue(entry.source)
    });
  }
}

function collectLanguageReferences(target, entries, fileName) {
  for (const entry of entries) {
    if (entry.container || !entry.path?.length || startsWith(entry.path, ["variables"])) {
      continue;
    }

    const name = entry.path.join(".");
    target.set(normalizeReference(name), {
      name,
      path: entry.path,
      fileName,
      value: scalarValue(entry.source)
    });
  }
}

function collectDefinitions(target, session, parentPath) {
  const index = expandEffectiveAliases(session.document.index);

  for (const entry of index.entries) {
    if (entry.container
      || entry.path.length !== parentPath.length + 1
      || !startsWith(entry.path, parentPath)) {
      continue;
    }

    target.set(normalizeName(entry.key), {
      name: String(entry.key),
      path: entry.path,
      fileName: session.fileName,
      value: scalarValue(entry.source)
    });
  }
}

function resolveDefinitions(definitions, pattern, normalize, prefix, budget) {
  const resolved = new Map();

  const resolve = (name, stack = new Set()) => {
    if (resolved.has(name)) {
      return resolved.get(name);
    }

    const definition = definitions.get(name);

    if (!definition || stack.has(name) || stack.size >= MAX_EXPANSION_DEPTH
      || budget.work >= MAX_EXPANSION_WORK || budget.length >= MAX_RESOLVED_LENGTH) {
      return `{${prefix}${definition?.name ?? name}}`;
    }

    const nextStack = new Set(stack).add(name);
    const value = replaceWithinPreviewLimit(definition.value, pattern, (token, referencedName) => {
      budget.work += 1;
      const referencedKey = normalize(referencedName);

      return budget.work <= MAX_EXPANSION_WORK && definitions.has(referencedKey)
        ? resolve(referencedKey, nextStack) : token;
    });
    if (value.length > MAX_PREVIEW_LENGTH || budget.length + value.length > MAX_RESOLVED_LENGTH) {
      return `{${prefix}${definition.name}}`;
    }
    budget.length += value.length;
    resolved.set(name, value);
    return value;
  };

  for (const name of definitions.keys()) {
    resolve(name);
  }

  return resolved;
}

function replaceWithinPreviewLimit(source, pattern, replacement) {
  let length = source.length;

  return source.replace(pattern, (token, name) => {
    const value = replacement(token, name);
    const nextLength = length - token.length + value.length;

    if (nextLength > MAX_PREVIEW_LENGTH && nextLength > length) {
      return token;
    }

    length = nextLength;
    return value;
  });
}

function collectUnknownMacros(target, source, path, definitions) {
  for (const match of String(source ?? "").matchAll(MESSAGE_MACRO)) {
    const name = normalizeName(match[1]);

    if (!name || definitions.has(name) || RUNTIME_MESSAGE_MACROS.has(name) || target.has(name)) {
      continue;
    }

    target.set(name, { token: match[0], path });
  }
}

function scalarValue(source) {
  const block = parseBlockScalar(source);

  return block?.content ?? String(parseSimpleLiteral(source).value ?? "");
}

function normalizeName(name) {
  return String(name).trim().toLocaleLowerCase("en-US");
}

function normalizeReference(name) {
  return String(name).trim().split(".").map((part) => normalizeName(part)).join(".");
}

function normalizePath(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/^\.?\//, "");
}

function guiLanguage(path) {
  return /(?:^|\/)guis\/([^/]+)\//i.exec(normalizePath(path))?.[1] ?? "";
}

function startsWith(path, prefix) {
  return prefix.every((segment, index) => path[index] === segment);
}

function displayPath(path) {
  return path?.length ? path.join(" → ") : "This file";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
