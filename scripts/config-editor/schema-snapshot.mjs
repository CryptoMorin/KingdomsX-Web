import { parse } from "yaml";

const DIRECTIVES = new Set([
  "(elements)",
  "(extends)",
  "(keys)",
  "(max)",
  "(min)",
  "(optional)",
  "(required)",
  "(type)",
  "(values)",
  "(values-keys)"
]);

export function normalizeSchemaSource(source, resourceName) {
  const rawSchema = parse(source, { merge: true });

  assertKnownDirectives(rawSchema, resourceName);

  return normalizeType(rawSchema);
}

export function buildFileMatchers(schemaResources) {
  const ids = new Set(schemaResources.map(({ id }) => id));
  const matchers = [];

  for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
    if (id === "Structures/structure") {
      matchers.push({ pattern: "Structures/*.yml", schemaId: id });
    } else if (id === "Turrets/turret") {
      matchers.push({ pattern: "Turrets/*.yml", schemaId: id });
    } else if (id === "guis/schema") {
      matchers.push({ pattern: "guis/**/*.yml", schemaId: id });
    } else if (!id.includes("/") && !["commands", "entity", "item-matcher", "item-stack", "permission"].includes(id)) {
      matchers.push({ pattern: `${id}.yml`, schemaId: id });
    }
  }

  return matchers;
}

export function schemaIdForResource(resourceName, matchers) {
  if (/^languages\/.*\.ya?ml$/i.test(resourceName)) {
    return "language";
  }

  if (/^declarations\/(?:building|structure)\.ya?ml$/i.test(resourceName)) {
    return "Structures/structure";
  }

  if (/^declarations\/(?:mine|turret)\.ya?ml$/i.test(resourceName)) {
    return "Turrets/turret";
  }

  const matcher = matchers
    .filter(({ pattern }) => resourceMatchesPattern(resourceName, pattern))
    .sort((left, right) => right.pattern.length - left.pattern.length)[0];

  return matcher?.schemaId ?? null;
}

function assertKnownDirectives(value, resourceName, sourcePath = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertKnownDirectives(entry, resourceName, [...sourcePath, String(index)]));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/^\(.+\)$/.test(key) && !DIRECTIVES.has(key)) {
      throw new Error(`Unknown schema directive ${key} at ${resourceName}:${[...sourcePath, key].join(".")}.`);
    }

    assertKnownDirectives(child, resourceName, [...sourcePath, key]);
  }
}

function normalizeType(value) {
  if (typeof value === "string") {
    return normalizeNamedType(value);
  }

  if (Array.isArray(value)) {
    if (isFixedEnum(value)) {
      return { kind: "enum", values: value.map(String), allowCustom: false };
    }

    if (value.length === 2 && value.includes("null")) {
      return { kind: "nullable", value: normalizeType(value.find((entry) => entry !== "null")) };
    }

    return { kind: "union", choices: value.map(normalizeType) };
  }

  if (!isRecord(value)) {
    return { kind: "advanced", typeName: String(value) };
  }

  const fields = Object.entries(value).filter(([key]) => !key.startsWith("("));
  const declaredType = value["(type)"];
  const hasMapping = "(keys)" in value || "(values)" in value || "(values-keys)" in value;

  if (hasMapping) {
    const definition = {
      kind: "mapping",
      keys: normalizeType(value["(keys)"] ?? value["(values-keys)"] ?? "str"),
      values: normalizeType(value["(values)"] ?? "any"),
      fields: fields
        .filter(([key]) => key !== "<<")
        .map(([key, child]) => ({ key, type: normalizeType(child) }))
    };

    addSchemaMetadata(definition, value);

    return definition;
  }

  if (declaredType === "list" || declaredType === "set") {
    const definition = {
      kind: declaredType,
      elements: normalizeType(value["(elements)"] ?? "any")
    };

    addSchemaMetadata(definition, value);

    return definition;
  }

  if (declaredType !== undefined) {
    const definition = normalizeType(declaredType);

    addSchemaMetadata(definition, value);

    return definition;
  }

  const definition = {
    kind: "object",
    fields: fields.map(([key, child]) => ({ key, type: normalizeType(child) }))
  };

  addSchemaMetadata(definition, value);

  return definition;
}

function resourceMatchesPattern(resourceName, pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", "(?:.*/)?");

  return new RegExp(`^${escaped}$`, "i").test(resourceName);
}

function addSchemaMetadata(definition, schema) {
  if (typeof schema["(min)"] === "number") {
    definition.minimum = schema["(min)"];
  }

  if (typeof schema["(max)"] === "number") {
    definition.maximum = schema["(max)"];
  }

  if (schema["(optional)"] !== undefined) {
    definition.optional = schema["(optional)"];
  }

  if (schema["(required)"] !== undefined) {
    definition.required = schema["(required)"];
  }

  if (schema["(extends)"] !== undefined) {
    definition.extends = arrayOf(schema["(extends)"]).map(String);
  }
}

function normalizeNamedType(typeName) {
  const nullable = typeName.endsWith("?");
  const bareType = nullable ? typeName.slice(0, -1) : typeName;
  let definition;

  if (bareType === "bool") {
    definition = { kind: "boolean" };
  } else if (bareType === "int") {
    definition = { kind: "integer" };
  } else if (["decimal", "double", "float"].includes(bareType)) {
    definition = { kind: "decimal" };
  } else if (["str", "Message", "MessageEntry"].includes(bareType)) {
    definition = { kind: "string", typeName: bareType };
  } else if (["Period", "Time"].includes(bareType)) {
    definition = { kind: "duration", typeName: bareType };
  } else if (bareType === "Math") {
    definition = { kind: "expression", language: "math" };
  } else if (bareType === "Condition") {
    definition = { kind: "expression", language: "condition" };
  } else if (bareType === "RegEx") {
    definition = { kind: "expression", language: "regex" };
  } else if (["list", "set"].includes(bareType)) {
    definition = { kind: bareType, elements: { kind: "advanced", typeName: "any" } };
  } else if (bareType === "null") {
    definition = { kind: "null" };
  } else if (bareType.startsWith("Enum<") && bareType.endsWith(">")) {
    definition = { kind: "suggestion", typeName: bareType, allowCustom: true };
  } else if (["Biome", "Enchant", "Entity", "ItemFlag", "Material", "Particle", "PotionEffectType", "Sound", "StructureType", "TurretType", "World"].includes(bareType)) {
    definition = { kind: "suggestion", typeName: bareType, allowCustom: true };
  } else {
    definition = { kind: "advanced", typeName: bareType };
  }

  return nullable ? { kind: "nullable", value: definition } : definition;
}

function isFixedEnum(value) {
  return value.length > 0 && value.every((entry) => typeof entry === "string") && !value.some((entry) => isNamedSchemaType(entry));
}

function isNamedSchemaType(value) {
  return /^(?:bool|int|decimal|double|float|str|list|set|any|null|Period|Time|Math|Condition|RegEx|Message|MessageEntry)(?:\?)?$/.test(value)
    || value.startsWith("Enum<")
    || /^[A-Z][A-Za-z0-9]+\??$/.test(value);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [value];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
