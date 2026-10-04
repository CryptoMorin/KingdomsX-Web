import { messageEntryType } from "./message-entry.js";

export function typeAtPath(rootType, path) {
  let current = rootType;

  for (const segment of path) {
    current = unwrapNullable(current);
    if (!current) {
      return null;
    }

    if (current.messageEntry === true) {
      current = messageEntryType();
    }

    if (current.kind === "object") {
      const field = current.fields.find((candidate) => candidate.key === segment);

      if (field) {
        current = field.type;
      } else if (current.additionalProperties) {
        current = current.additionalProperties;
      } else {
        return null;
      }
    } else if (current.kind === "mapping") {
      const field = current.fields?.find((candidate) => candidate.key === segment);
      current = field?.type ?? current.values;
    } else if (current.kind === "union") {
      current = unionChildType(current, segment);
      if (!current) {
        return null;
      }
    } else {
      return null;
    }
  }

  return current;
}

export function describeType(type) {
  const current = unwrapNullable(type);

  if (!current) {
    return "Unknown";
  }

  if (current.kind === "integer") {
    return "Whole number";
  }

  if (current.kind === "decimal") {
    return "Decimal number";
  }

  if (current.kind === "boolean") {
    return "On or off";
  }

  if (current.kind === "literal") {
    return current.label || `Use ${String(current.value)}`;
  }

  if (current.kind === "enum") {
    return "Choose one";
  }

  if (current.kind === "duration") {
    return "Duration";
  }

  if (current.kind === "expression") {
    return `${titleCase(current.language)} expression`;
  }

  if (current.kind === "string") {
    return "Text";
  }

  if (current.kind === "suggestion") {
    return current.typeName || "Suggested value";
  }

  if (current.kind === "union") {
    return "Multiple choice";
  }

  if (current.kind === "nullable") {
    return `Optional ${describeType(current.value)}`;
  }

  if (current.kind === "reference") {
    return current.typeName || "Referenced options";
  }

  if (current.kind === "advanced") {
    return current.typeName || "Advanced value";
  }

  return titleCase(current.kind);
}

export function unwrapNullable(type) {
  let current = type;
  const visited = new Set();

  while (current && !visited.has(current) && ["nullable", "reference"].includes(current.kind)) {
    visited.add(current);
    current = current.kind === "nullable" ? current.value : current.target;
  }

  return current;
}

function unionChildType(type, segment) {
  for (const choice of type.choices ?? []) {
    const current = unwrapNullable(choice);

    if (current?.kind === "object") {
      const field = current.fields.find((candidate) => candidate.key === segment);

      if (field) {
        return field.type;
      }

      if (current.additionalProperties) {
        return current.additionalProperties;
      }
    } else if (current?.kind === "mapping") {
      const field = current.fields?.find((candidate) => candidate.key === segment);

      return field?.type ?? current.values;
    }
  }

  return null;
}

function titleCase(value) {
  return String(value).replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
