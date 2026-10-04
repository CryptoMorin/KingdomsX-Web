import { typeAtPath, unwrapNullable } from "./schema-types.js";

export function reusableSettingsCompatible(rootSchema, definitionPath, targetPath) {
  const definitionType = typeAtPath(rootSchema, definitionPath);
  const targetType = typeAtPath(rootSchema, targetPath);

  if (!definitionType || !targetType) {
    return true;
  }

  return reusableSettingsTypeSignature(definitionType) === reusableSettingsTypeSignature(targetType);
}

export function reusableSettingsTypeSignature(type, seen = new WeakSet()) {
  const current = unwrapNullable(type);

  if (!current) {
    return "unknown";
  }

  if (seen.has(current)) {
    return `recursive:${current.typeName ?? current.kind}`;
  }

  if (typeof current !== "object") {
    return String(current);
  }

  seen.add(current);
  let signature;

  if (["boolean", "decimal", "duration", "integer", "null"].includes(current.kind)) {
    signature = current.kind;
  } else if (["advanced", "expression", "string", "suggestion"].includes(current.kind)) {
    signature = [current.kind, current.typeName ?? "", current.language ?? ""].join(":");
  } else if (current.kind === "enum") {
    signature = `enum:${current.typeName ?? ""}:${[...(current.values ?? [])].sort().join(",")}`;
  } else if (current.kind === "list" || current.kind === "set") {
    signature = `${current.kind}<${reusableSettingsTypeSignature(current.elements, seen)}>`;
  } else if (current.kind === "mapping") {
    const fixed = fieldSignatures(current.fields, seen);
    signature = `mapping<${reusableSettingsTypeSignature(current.keys, seen)},${reusableSettingsTypeSignature(current.values, seen)}>${fixed}`;
  } else if (current.kind === "object") {
    const additional = current.additionalProperties
      ? `+${reusableSettingsTypeSignature(current.additionalProperties, seen)}`
      : "";
    signature = `object${fieldSignatures(current.fields, seen)}${additional}`;
  } else if (current.kind === "union") {
    signature = `union<${(current.choices ?? [])
      .map((choice) => reusableSettingsTypeSignature(choice, seen))
      .sort()
      .join("|")}>`;
  } else {
    signature = `${current.kind}:${current.typeName ?? ""}`;
  }

  seen.delete(current);
  return signature;
}

function fieldSignatures(fields, seen) {
  if (!fields?.length) {
    return "{}";
  }

  const values = fields
    .map((field) => `${field.key}:${reusableSettingsTypeSignature(field.type, seen)}`)
    .sort();

  return `{${values.join(",")}}`;
}
