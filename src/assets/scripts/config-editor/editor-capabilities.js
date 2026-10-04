import { editorOverrides as overrides } from "./editor-overrides.js";

export function runtimeOnlyOptions(catalog, schemaId) {
  const family = catalog.families.find((candidate) => candidate.schemaId === schemaId);

  if (!family) {
    return [];
  }

  return family.options
    .filter((option) => option.runtimeUsed && !option.schemaCovered && !option.defaultCovered)
    .map((option) => {
      const policy = overrides.runtimeFields[`${schemaId}.${option.field}`];

      if (!policy?.type) {
        throw new Error(
          `Active JAR-only option ${schemaId}.${option.field} needs a type in editor-overrides.json.`
        );
      }

      return {
        ...option,
        runtimeField: option.field,
        source: "",
        comments: [],
        inferredType: structuredClone(policy.type),
        capability: {
          sources: ["jar-runtime"],
          tier: policy.tier ?? "advanced",
          runtimeField: option.field,
          consumers: option.consumers
        }
      };
    });
}

export function markCapabilityTree(root, source, seen = new WeakSet()) {
  if (!root || typeof root !== "object" || seen.has(root)) {
    return root;
  }

  seen.add(root);
  addCapability(root, { sources: [source] });

  if (root.kind === "object") {
    root.fields?.forEach((field) => markCapabilityTree(field.type, source, seen));
    markCapabilityTree(root.additionalProperties, source, seen);
  } else if (root.kind === "mapping") {
    root.fields?.forEach((field) => markCapabilityTree(field.type, source, seen));
    markCapabilityTree(root.keys, source, seen);
    markCapabilityTree(root.values, source, seen);
  } else if (root.kind === "union") {
    root.choices?.forEach((choice) => markCapabilityTree(choice, source, seen));
  } else if (root.kind === "list" || root.kind === "set") {
    markCapabilityTree(root.elements, source, seen);
  } else if (root.kind === "nullable") {
    markCapabilityTree(root.value, source, seen);
  }

  return root;
}

export function addCapability(type, capability) {
  if (!type || typeof type !== "object") {
    return type;
  }

  const sources = new Set([
    ...(type.capability?.sources ?? []),
    ...(capability.sources ?? [])
  ]);
  type.capability = {
    ...type.capability,
    ...capability,
    sources: [...sources]
  };
  return type;
}

export function applySettingCapabilities(root, schemaId) {
  const rules = overrides.settings.filter((rule) => rule.schemaId === schemaId);
  const unmatched = [];

  for (const rule of rules) {
    const type = typeAtPattern(root, rule.path);

    if (!type) {
      unmatched.push(rule.path);
      continue;
    }

    addCapability(type, { tier: rule.tier });
  }

  return unmatched;
}

export function optionTier(type) {
  if (type?.capability?.tier) {
    return type.capability.tier;
  }

  if (type?.capability?.sources?.some((source) => ["editor-overlay", "jar-runtime"].includes(source))) {
    return "advanced";
  }

  return "standard";
}

function typeAtPattern(root, path) {
  let current = root;

  for (const segment of path) {
    current = unwrap(current);
    if (!current) {
      return null;
    }

    const dynamic = /^\{[^}]+}$/.test(segment);

    if (current.kind === "mapping") {
      const named = !dynamic && current.fields?.find((field) => field.key === segment);
      current = named?.type ?? current.values;
    } else if (current.kind === "object") {
      const named = !dynamic && current.fields?.find((field) => field.key === segment);
      current = named?.type ?? current.additionalProperties;
    } else if (current.kind === "union") {
      current = current.choices
        ?.map((choice) => typeAtPattern(choice, [segment]))
        .find(Boolean);
    } else {
      return null;
    }
  }

  return current;
}

function unwrap(type) {
  let current = type;
  const seen = new Set();

  while (current && !seen.has(current) && ["nullable", "reference"].includes(current.kind)) {
    seen.add(current);
    current = current.kind === "nullable" ? current.value : current.target;
  }

  return current;
}
