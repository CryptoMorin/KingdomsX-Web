import { typeAtPath, unwrapNullable } from "./schema-types.js";

export function schemaDescriptorForFile(registry, fileName) {
  const normalized = normalizeConfigPath(fileName);
  const matcher = registry.files
    .filter(({ pattern }) => matchesPattern(normalized, pattern))
    .sort((left, right) => patternSpecificity(right.pattern) - patternSpecificity(left.pattern))[0];

  return matcher ? registry.schemas.find(({ id }) => id === matcher.schemaId) ?? null : null;
}

export function inferSchemaDescriptor(registry, schemas, fileName, index, profile = null) {
  if (profile?.schemaId) {
    const descriptor = registry.schemas.find(({ id }) => id === profile.schemaId);

    if (descriptor) {
      return descriptor;
    }
  }

  if (index.byPath.has("(module)")) {
    if (index.byPath.has("options")) {
      return registry.schemas.find(({ id }) => id === "guis/schema") ?? null;
    }

    const hintedId = schemaHint(index);

    return hintedId ? registry.schemas.find(({ id }) => id === hintedId) ?? null : null;
  }

  const hintedId = schemaHint(index);

  if (hintedId) {
    return registry.schemas.find(({ id }) => id === hintedId) ?? null;
  }

  const direct = schemaDescriptorForFile(registry, fileName);
  const candidateIds = new Set([
    direct?.id,
    ...registry.files.map(({ schemaId }) => schemaId)
  ].filter(Boolean));
  const ranked = [...candidateIds]
    .map((id) => ({ descriptor: registry.schemas.find((candidate) => candidate.id === id), ...schemaFit(schemas.get(id), index) }))
    .filter(({ descriptor }) => descriptor)
    .sort((left, right) => right.score - left.score || right.rootCoverage - left.rootCoverage);
  const best = ranked[0];

  if (!best || (best.matchedRoots === 0 && best.matchedEntries === 0)) {
    return direct ?? null;
  }

  if (!direct && best.rootCoverage < 0.25) {
    return null;
  }

  return best.descriptor;
}

export function defaultDescriptorForFile(registry, fileName, index = null, schemaId = "") {
  const normalized = normalizeConfigPath(fileName);
  const withoutGuiLocale = normalized.replace(/(^|\/)guis\/[a-z]{2}(?:[-_][A-Za-z]{2})?\//i, "$1guis/");
  const hasDirectory = normalized.includes("/");
  const exactResource = !index && registry.defaults.find(({ resourceName }) => normalized === resourceName);

  if (exactResource) {
    return exactResource;
  }

  const exact = hasDirectory ? registry.defaults
    .filter(({ resourceName }) => normalized.endsWith(`/${resourceName}`)
      || withoutGuiLocale === resourceName
      || withoutGuiLocale.endsWith(`/${resourceName}`))
    .sort((left, right) => right.resourceName.length - left.resourceName.length)[0] : null;

  if (exact) {
    return exact;
  }

  if (/(?:^|\/)languages\/[^/]+\.ya?ml$/i.test(normalized)) {
    const languageDefault = registry.defaults.find(({ resourceName, schemaId: candidateSchemaId }) =>
      resourceName === "languages/en.yml" && candidateSchemaId === "language"
    );

    if (languageDefault) {
      return languageDefault;
    }
  }

  const baseName = normalized.split("/").at(-1)?.toLocaleLowerCase("en-US");
  let candidates = registry.defaults.filter(({ resourceName }) =>
    resourceName.split("/").at(-1)?.toLocaleLowerCase("en-US") === baseName
  );

  if (schemaId) {
    const sameSchema = candidates.filter((candidate) => candidate.schemaId === schemaId);

    if (sameSchema.length) {
      candidates = sameSchema;
    }
  }

  if (candidates.length <= 1 || !index) {
    return candidates[0] ?? null;
  }

  return candidates
    .map((candidate) => ({ candidate, score: profileFit(candidate.signature, index) }))
    .sort((left, right) => right.score - left.score
      || right.candidate.resourceName.length - left.candidate.resourceName.length)[0]?.candidate ?? null;
}

function normalizeConfigPath(fileName) {
  return fileName.replaceAll("\\", "/").replace(/^\.\//, "");
}

function matchesPattern(fileName, pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", "(?:.*/)?");

  return new RegExp(`^(?:.*\/)?${escaped}$`, "i").test(fileName);
}

function patternSpecificity(pattern) {
  const segments = pattern.split("/").length - 1;
  const literals = pattern.replaceAll("*", "").length;

  return segments * 1_000 + literals;
}

function schemaHint(index) {
  if (index.byPath.has("(import)\u0000turretgui")) {
    return "guis/schema";
  }

  if (index.byPath.has("(import)\u0000structure") || index.byPath.has("(import)\u0000building")) {
    return "Structures/structure";
  }

  if (index.byPath.has("(import)\u0000turret") || index.byPath.has("(import)\u0000mine")) {
    return "Turrets/turret";
  }

  return null;
}

function schemaFit(schema, index) {
  if (!schema) {
    return { score: 0, matchedEntries: 0, matchedRoots: 0, rootCoverage: 0 };
  }

  let score = 0;
  let matchedEntries = 0;
  let matchedRoots = 0;
  let totalRoots = 0;

  for (const entry of index.entries) {
    if (entry.path.length === 1) {
      totalRoots += 1;
    }

    const type = unwrapNullable(typeAtPath(schema, entry.path));

    if (!type) {
      continue;
    }

    matchedEntries += 1;
    if (entry.path.length === 1) {
      matchedRoots += 1;
      score += 12;
    } else {
      score += entry.container ? 1 : 3;
    }

    if (entry.container && (type.kind === "object" || type.kind === "mapping")) {
      score += 3;
    }

    if (!entry.container && type.kind !== "object" && type.kind !== "mapping") {
      score += 2;
    }
  }

  return {
    score,
    matchedEntries,
    matchedRoots,
    rootCoverage: totalRoots ? matchedRoots / totalRoots : 0
  };
}

function profileFit(signature, index) {
  if (!signature) {
    return 0;
  }

  const roots = new Set(index.entries.filter((entry) => entry.path.length === 1).map((entry) => entry.key));
  const paths = new Set(index.entries.map((entry) => entry.path.slice(0, 2).join("\u0000")));
  let score = 0;

  for (const root of signature.rootKeys ?? []) {
    if (roots.has(root)) {
      score += 24;
    }
  }

  for (const path of signature.paths ?? []) {
    if (paths.has(path)) {
      score += 4;
    }
  }

  const sizeDifference = Math.abs((signature.entryCount ?? 0) - index.entries.length);

  return score - Math.min(sizeDifference / 20, 10);
}
