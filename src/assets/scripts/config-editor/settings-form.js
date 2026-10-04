import { typeAtPath, unwrapNullable } from "./schema-types.js";
import { labelForKey } from "./schema-options.js";
import { optionTier } from "./editor-capabilities.js";
import { isMessageEntryType, messageEntryType } from "./message-entry.js";

export const GENERAL_SECTION = "__general__";

export function buildFormStructure(index, rootSchema) {
  const topLevelEntries = index.entries.filter((entry) => entry.path.length === 1);
  const sectionKeys = new Set();

  for (const entry of topLevelEntries) {
    const type = unwrapNullable(typeAtPath(rootSchema, entry.path));
    const hasChildren = index.entries.some((candidate) => candidate.path.length > 1 && candidate.path[0] === entry.key);
    const complexSequence = isComplexSequence(entry, type);

    if (!inlineMessageEntry(type)
      && !complexSequence
      && (hasChildren || entry.container || type?.kind === "object" || type?.kind === "mapping")) {
      sectionKeys.add(entry.key);
    }
  }

  for (const entry of index.entries) {
    const topLevel = topLevelEntries.find((candidate) => candidate.key === entry.path[0]);
    const topLevelType = topLevel && unwrapNullable(typeAtPath(rootSchema, topLevel.path));

    if (entry.path.length > 1
      && !inlineMessageEntry(topLevelType)
      && !isComplexSequence(topLevel, topLevelType)) {
      sectionKeys.add(entry.path[0]);
    }
  }

  const sections = [];
  const generalKeys = new Set(topLevelEntries.filter((entry) => !sectionKeys.has(entry.key)).map((entry) => entry.key));
  const generalEntries = index.entries.filter((entry) => generalKeys.has(entry.path[0]));

  if (generalEntries.length || missingStructuredFields(index, rootSchema, []).length) {
    sections.push(buildSection(GENERAL_SECTION, [], generalEntries, rootSchema, index.entries));
  }

  for (const entry of topLevelEntries) {
    if (!sectionKeys.has(entry.key)) {
      continue;
    }

    const entries = index.entries.filter((candidate) => candidate.path[0] === entry.key);
    sections.push(buildSection(entry.key, [entry.key], entries, rootSchema));
  }

  for (const key of sectionKeys) {
    if (sections.some((section) => section.key === key)) {
      continue;
    }

    const entries = index.entries.filter((candidate) => candidate.path[0] === key);
    sections.push(buildSection(key, [key], entries, rootSchema));
  }

  return sections;
}

function inlineMessageEntry(type) {
  return isMessageEntryType(unwrapNullable(type));
}

export function orderedOwnerContent(owner) {
  const inlineGroups = new Set((owner.groups ?? []).filter((group) => group.inline));
  const primary = [
    ...(owner.fields ?? []).map((field) => ({ kind: "field", value: field })),
    ...[...inlineGroups].map((group) => ({ kind: "group", value: group }))
  ].sort((left, right) => sourcePosition(left.value) - sourcePosition(right.value));
  const structuralGroups = (owner.groups ?? [])
    .filter((group) => !inlineGroups.has(group))
    .map((group) => ({ kind: "group", value: group }));

  return [...primary, ...structuralGroups];
}

function sourcePosition(owner) {
  return owner.entry?.lineFrom ?? owner.entry?.line ?? Number.MAX_SAFE_INTEGER;
}

export function removalPolicy(rootSchema, path) {
  const parentPath = path.slice(0, -1);
  const parent = structuredType(typeAtPath(rootSchema, parentPath));
  const type = typeAtPath(rootSchema, path);

  if (!type) {
    return { allowed: true, reason: "custom" };
  }

  if (parent?.kind === "mapping") {
    const required = Array.isArray(parent.required) ? parent.required.map(String) : [];

    return required.includes(String(path.at(-1)))
      ? { allowed: false, reason: "required-mapping-key" }
      : { allowed: true, reason: "mapping-entry" };
  }

  if (parent?.kind === "object") {
    const staticField = parent.fields?.find((candidate) => candidate.key === path.at(-1));

    if (!staticField && parent.additionalProperties) {
      return { allowed: true, reason: "mapping-entry" };
    }

    const required = Array.isArray(parent.required) ? parent.required.map(String) : [];

    if (required.includes(String(path.at(-1))) || type?.required === true) {
      return { allowed: false, reason: "required-object-field" };
    }

    if (staticField) {
      return { allowed: true, reason: "optional-object-field" };
    }
  }

  if (type.optional === true || unwrapNullable(type)?.optional === true) {
    return { allowed: true, reason: "optional" };
  }

  return { allowed: false, reason: "schema-field" };
}

export function sectionKeyForPath(path, sections) {
  const topLevelSection = sections.find((section) => section.key === path[0]);

  if (topLevelSection) {
    return topLevelSection.key;
  }

  if (sections.some((section) => section.key === GENERAL_SECTION)) {
    return GENERAL_SECTION;
  }

  return path[0] ?? GENERAL_SECTION;
}

function buildSection(key, rootPath, entries, rootSchema, availableEntries = entries) {
  const root = createGroup(rootPath, key === GENERAL_SECTION ? "General" : labelForKey(key), rootSchema);
  const rootEntry = rootPath.length ? entries.find((entry) => samePath(entry.path, rootPath)) : null;

  if (rootEntry) {
    root.label = semanticGroupLabel(rootEntry, root.label);
    root.entry = rootEntry;
    root.removal = removalPolicy(rootSchema, rootPath);
    assignEditableKey(root, editableKey(rootSchema, rootPath));
  }

  const complexSequences = entries.filter((entry) =>
    isComplexSequence(entry, unwrapNullable(typeAtPath(rootSchema, entry.path)))
  );

  for (const entry of entries) {
    if (rootPath.length && samePath(entry.path, rootPath)) {
      continue;
    }

    if (complexSequences.some((sequence) => isDescendant(entry.path, sequence.path))) {
      continue;
    }

    const relativePath = rootPath.length ? entry.path.slice(rootPath.length) : entry.path;

    if (!relativePath.length) {
      continue;
    }

    const type = typeAtPath(rootSchema, entry.path);
    const current = unwrapNullable(type);
    const representsGroup = !isComplexSequence(entry, current)
      && (entry.container || entry.emptyMapping || current?.kind === "object");
    const parentSegments = representsGroup ? relativePath : relativePath.slice(0, -1);
    const parent = ensureGroups(root, rootPath, parentSegments, rootSchema);

    if (representsGroup) {
      parent.entry = entry;
      parent.comments = entry.comments;
      parent.annotations = entry.annotations;
      parent.syntax = entry.syntax;
      parent.label = semanticGroupLabel(entry, parent.label);
      parent.removal = removalPolicy(rootSchema, entry.path);
      assignEditableKey(parent, editableKey(rootSchema, entry.path));
      const schemaType = structuredType(typeAtPath(rootSchema, entry.path));

      if (schemaType?.description) {
        parent.typeDescription = schemaType.description;
      }
    } else {
      parent.fields.push({
        path: entry.path,
        entry,
        type: reusableReferenceType(entry, type),
        inferred: !type,
        removal: removalPolicy(rootSchema, entry.path),
        ...editableKey(rootSchema, entry.path)
      });
    }
  }

  populateAvailableFields(root, availableEntries, rootSchema);
  populateGroupCounts(root);

  return {
    key,
    label: root.label,
    comments: rootEntry?.comments ?? [],
    typeDescription: root.typeDescription ?? "",
    annotations: rootEntry?.annotations ?? [],
    syntax: rootEntry?.syntax ?? null,
    path: rootPath,
    fields: root.fields,
    groups: root.groups,
    dynamicMapping: root.dynamicMapping,
    creation: root.creation,
    valueType: root.valueType,
    keyType: root.keyType,
    requiredKeys: root.requiredKeys,
    entry: root.entry,
    removal: root.removal,
    keyEditable: root.keyEditable,
    renameKeyType: root.renameKeyType,
    availableFields: root.availableFields,
    fieldCount: root.fieldCount,
    groupCount: countVisibleGroups(root)
  };
}

function reusableReferenceType(entry, type) {
  if (!["alias", "mapping-merge"].includes(entry.syntax?.kind)) {
    return type;
  }

  return {
    kind: "advanced",
    typeName: "Linked value",
    linkedType: type,
    description: "Gets its value from shared settings defined earlier in this file."
  };
}

function ensureGroups(root, rootPath, segments, rootSchema) {
  let group = root;

  for (const segment of segments) {
    let child = group.groups.find((candidate) => candidate.key === segment);

    if (!child) {
      const path = [...group.path, segment];
      child = createGroup(path, labelForKey(segment), rootSchema);
      group.groups.push(child);
    }

    group = child;
  }

  return group;
}

function createGroup(path, label, rootSchema) {
  const type = structuredType(typeAtPath(rootSchema, path));
  const dynamicObject = type?.kind === "object" && type.additionalProperties;

  return {
    key: path.at(-1) ?? GENERAL_SECTION,
    label,
    path,
    fields: [],
    groups: [],
    comments: [],
    typeDescription: type?.description ?? "",
    annotations: [],
    syntax: null,
    entry: null,
    removal: { allowed: false, reason: "root" },
    keyEditable: false,
    renameKeyType: null,
    availableFields: [],
    dynamicMapping: type?.kind === "mapping" || Boolean(dynamicObject) || (!rootSchema && !type && path.length > 0),
    creation: type?.creation ?? null,
    valueType: type?.kind === "mapping"
      ? type.values
      : dynamicObject
        ? type.additionalProperties
        : !rootSchema && !type && path.length > 0 ? { kind: "advanced", typeName: "any" } : null,
    keyType: type?.kind === "mapping" ? type.keys : dynamicObject ? type.additionalKeyType ?? { kind: "string" } : null,
    requiredKeys: type?.kind === "mapping" && Array.isArray(type.required) ? type.required.map(String) : [],
    inline: isMessageEntryType(type),
    fieldCount: 0
  };
}

function populateAvailableFields(group, entries, rootSchema) {
  group.availableFields = missingStructuredFields({ entries }, rootSchema, group.path);
  group.groups.forEach((child) => populateAvailableFields(child, entries, rootSchema));
}

function missingStructuredFields(index, rootSchema, path) {
  const type = structuredType(typeAtPath(rootSchema, path));

  if (!["mapping", "object"].includes(type?.kind)) {
    return [];
  }

  const existing = new Set(index.entries
    .filter((entry) => entry.path.length === path.length + 1 && path.every((segment, position) => entry.path[position] === segment))
    .map((entry) => entry.key));
  const required = new Set((type.required ?? []).map(String));

  return (type.fields ?? [])
    .filter((candidate) => !existing.has(candidate.key))
    .map((candidate) => ({
      key: candidate.key,
      label: labelForKey(candidate.key),
      path: [...path, candidate.key],
      type: candidate.type,
      required: required.has(candidate.key) || candidate.type.required === true,
      description: candidate.type.description ?? "",
      tier: optionTier(candidate.type)
    }));
}

function structuredType(type) {
  const current = unwrapNullable(type);

  if (current?.messageEntry === true) {
    return messageEntryType();
  }

  if (current?.kind !== "union") {
    return current;
  }

  return current.choices.map(unwrapNullable).find((choice) => ["mapping", "object"].includes(choice?.kind)) ?? current;
}

function editableKey(rootSchema, path) {
  if (!path.length) {
    return { keyEditable: false, keyType: null };
  }

  const parent = structuredType(typeAtPath(rootSchema, path.slice(0, -1)));

  if (parent?.kind === "mapping") {
    return { keyEditable: true, keyType: parent.keys };
  }

  if (parent?.kind === "object" && parent.additionalProperties
    && !parent.fields?.some((candidate) => candidate.key === path.at(-1))) {
    return { keyEditable: true, keyType: parent.additionalKeyType ?? { kind: "string" } };
  }

  return { keyEditable: false, keyType: null };
}

function assignEditableKey(owner, policy) {
  owner.keyEditable = policy.keyEditable;
  owner.renameKeyType = policy.keyType;
}

function populateGroupCounts(group) {
  group.groups.forEach(populateGroupCounts);
  group.fieldCount = group.fields.length + group.groups.reduce((total, child) => total + child.fieldCount, 0);
}

function countVisibleGroups(group) {
  return group.groups.reduce((total, child) => total + 1 + countVisibleGroups(child), 0);
}

function samePath(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function isDescendant(path, parentPath) {
  return path.length > parentPath.length && parentPath.every((segment, index) => path[index] === segment);
}

function isComplexSequence(entry, type) {
  if (!entry) {
    return false;
  }

  if (entry.complexSequence) {
    return true;
  }

  if (type?.kind === "list" || type?.kind === "set") {
    return entry.container;
  }

  if (!entry.container || type?.kind === "object" || type?.kind === "mapping") {
    return false;
  }

  const firstValueLine = entry.source
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  return firstValueLine?.startsWith("- ") ?? false;
}

function semanticGroupLabel(entry, fallback) {
  if (entry.syntax?.kind === "module") {
    return "Shared Template Definition";
  }

  if (entry.syntax?.kind === "import") {
    return "Parent Templates";
  }

  if (entry.syntax?.kind === "function-declaration") {
    return `Entry Generator: ${entry.key.slice(1, -1).replace(/^fn-/, "")}`;
  }

  return fallback;
}
