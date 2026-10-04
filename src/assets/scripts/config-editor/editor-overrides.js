import data from "../../../data/config-editor/editor-overrides.json" with { type: "json" };

export const editorOverrides = validateEditorOverrides(data);

function validateEditorOverrides(value) {
  if (value?.formatVersion !== 3) {
    throw new Error(`Unsupported editor overrides format ${value?.formatVersion ?? "unknown"}.`);
  }

  if (!value.runtimeFields || !Array.isArray(value.defaultValueExamples)
    || !Array.isArray(value.commentTypes) || !Array.isArray(value.settings)
    || !value.documentedValues || !value.knownEnums) {
    throw new Error("Editor overrides must define runtime fields, default-value examples, comment types, settings, documented values, and known enums.");
  }

  unique(value.defaultValueExamples.map((entry) => `${entry.resourceName}:${entry.path.join(".")}`), "default-value example");
  unique(value.commentTypes.map((entry) => `${entry.schemaId}.${entry.path.join(".")}`), "comment type");
  unique(value.settings.map((entry) => `${entry.schemaId}.${entry.path.join(".")}`), "setting override");
  unique(Object.values(value.knownEnums).flatMap((entry) => entry.typeNames), "known enum type");
  unique(value.settingGuidance.map((entry) => entry.id), "setting guidance id");

  for (const [id, values] of Object.entries(value.documentedValues)) {
    if (!Array.isArray(values) || !values.length) {
      throw new Error(`Documented values ${id} must be a non-empty list.`);
    }

    unique(values, `documented value in ${id}`);
  }

  for (const entry of value.settings) {
    if (!["common", "advanced"].includes(entry.tier)) {
      throw new Error(`Editor setting ${entry.schemaId}.${entry.path.join(".")} has an invalid tier.`);
    }
  }

  for (const entry of value.commentTypes) {
    if (!entry.schemaId || !Array.isArray(entry.path) || !entry.path.length || !entry.type?.kind || !entry.reason) {
      throw new Error("Every comment type must define schemaId, path, reason, and type.");
    }
  }

  for (const entry of value.defaultValueExamples) {
    if (!entry.resourceName || !Array.isArray(entry.path) || !entry.path.length) {
      throw new Error("Every default-value example must define a resource name and path.");
    }
  }

  for (const rule of value.settingGuidance) {
    if (!["schemaId", "root", "syntax", "pathPattern", "keyPattern", "typePattern", "commentsPattern"]
      .some((key) => rule[key])) {
      throw new Error(`Setting guidance ${rule.id} must define at least one matching constraint.`);
    }

    for (const key of ["pathPattern", "keyPattern", "typePattern", "commentsPattern"]) {
      if (rule[key]) {
        new RegExp(rule[key], "i");
      }
    }
  }

  return Object.freeze(value);
}

function unique(values, label) {
  const seen = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}.`);
    }

    seen.add(value);
  }
}
