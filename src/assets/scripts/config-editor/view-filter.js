import { unwrapNullable } from "./schema-types.js";
import { optionTier } from "./editor-capabilities.js";

const VIEW_MODES = new Set(["all", "common", "advanced", "changed"]);

export function filterSections(sections, options = {}) {
  const query = normalizeSearch(options.query);
  const mode = VIEW_MODES.has(options.mode) ? options.mode : "all";
  const changed = options.changed ?? (() => false);

  return sections
    .map((section) => projectSection(section, { query, mode, changed }))
    .filter(Boolean);
}

export function firstMatchingFieldPath(sections, options = {}) {
  const query = normalizeSearch(options.query);

  if (!query) {
    return null;
  }

  const mode = VIEW_MODES.has(options.mode) ? options.mode : "all";
  const changed = options.changed ?? (() => false);
  const context = { query, mode, changed };

  for (const section of filterSections(sections, options)) {
    const hit = firstFieldInOwner(section, context, false, false);

    if (hit) {
      return hit;
    }
  }

  return null;
}

function firstFieldInOwner(owner, context, parentQueryMatched, parentModeMatched) {
  for (const field of owner.fields ?? []) {
    if (fieldMatches(field, context, parentQueryMatched, parentModeMatched)) {
      return field.path;
    }
  }

  for (const group of owner.groups ?? []) {
    const queryMatched = parentQueryMatched || matchesQuery(group, context.query);
    const modeMatched = inheritedModeMatch(group, context, parentModeMatched);
    const hit = firstFieldInOwner(group, context, queryMatched, modeMatched);

    if (hit) {
      return hit;
    }
  }

  return null;
}

export function ownerIsAdvanced(owner) {
  const type = unwrapNullable(owner.type ?? owner.valueType);

  return Boolean(
    optionTier(type) === "advanced"
      || owner.inferred
      || owner.entry?.advancedOnly
      || owner.syntax
      || owner.entry?.syntax
      || owner.annotations?.length
      || owner.entry?.annotations?.length
      || ["advanced", "expression", "mapping", "object", "unknown"].includes(type?.kind)
  );
}

export function ownerIsCommon(owner) {
  const type = unwrapNullable(owner.type ?? owner.valueType);

  return optionTier(type) === "common";
}

export function ownerSearchText(owner) {
  const type = unwrapNullable(owner.type ?? owner.valueType);

  return normalizeSearch([
    owner.label,
    owner.key,
    owner.path?.join(" "),
    owner.path?.join("."),
    owner.entry?.key,
    owner.entry && !owner.entry.container ? owner.entry.source : "",
    owner.entry?.comments?.join(" "),
    owner.comments?.join(" "),
    owner.syntax?.label,
    owner.annotations?.map((annotation) => annotation.label).join(" "),
    type?.typeName,
    type?.description,
    type?.kind
  ].filter(Boolean).join(" "));
}

function projectSection(section, context) {
  const queryMatched = matchesQuery(section, context.query);
  const modeMatched = inheritedModeMatch(section, context, false);
  const fields = section.fields.filter((field) => fieldMatches(field, context, queryMatched, modeMatched));
  const availableFields = projectAvailableFields(section, context, queryMatched);
  const groups = section.groups
    .map((group) => projectGroup(group, context, queryMatched, modeMatched))
    .filter(Boolean);
  const ownMatch = Boolean(section.entry) && ownerMatches(section, context, false);

  if (!ownMatch && !fields.length && !groups.length && !availableFields.length) {
    return null;
  }

  return {
    ...section,
    fields,
    groups,
    availableFields,
    visibleFieldCount: fields.length + groups.reduce((total, group) => total + group.visibleFieldCount, 0),
    visibleGroupCount: groups.reduce((total, group) => total + 1 + group.visibleGroupCount, 0),
    matchedDirectly: ownMatch
  };
}

function projectGroup(group, context, parentQueryMatched, parentModeMatched) {
  const queryMatched = parentQueryMatched || matchesQuery(group, context.query);
  const modeMatched = inheritedModeMatch(group, context, parentModeMatched);
  const fields = group.fields.filter((field) => fieldMatches(field, context, queryMatched, modeMatched));
  const availableFields = projectAvailableFields(group, context, queryMatched);
  const groups = group.groups
    .map((child) => projectGroup(child, context, queryMatched, modeMatched))
    .filter(Boolean);
  const ownMatch = Boolean(group.entry) && ownerMatches(group, context, parentQueryMatched);
  const ownsStructureControls = availableFields.length > 0
    || group.dynamicMapping && !context.query && context.mode === "all";

  if (!ownMatch && !fields.length && !groups.length && !ownsStructureControls) {
    return null;
  }

  return {
    ...group,
    fields,
    groups,
    availableFields,
    visibleFieldCount: fields.length + groups.reduce((total, child) => total + child.visibleFieldCount, 0),
    visibleGroupCount: groups.reduce((total, child) => total + 1 + child.visibleGroupCount, 0),
    matchedDirectly: ownMatch
  };
}

function fieldMatches(field, context, parentQueryMatched, parentModeMatched) {
  return (parentQueryMatched || matchesQuery(field, context.query))
    && (parentModeMatched || matchesMode(field, context));
}

function ownerMatches(owner, context, parentQueryMatched) {
  return (parentQueryMatched || matchesQuery(owner, context.query)) && matchesMode(owner, context);
}

function matchesQuery(owner, query) {
  return !query || ownerSearchText(owner).includes(query);
}

function matchesMode(owner, { mode, changed }) {
  if (mode === "all") {
    return true;
  }

  if (mode === "changed") {
    return changed(owner.path ?? []);
  }

  if (mode === "common") {
    return ownerIsCommon(owner);
  }

  return ownerIsAdvanced(owner);
}

function inheritedModeMatch(owner, context, parentMatched) {
  if (parentMatched) {
    return true;
  }

  if (!owner.entry || context.mode === "common") {
    return false;
  }

  return matchesMode(owner, context);
}

function projectAvailableFields(owner, context, parentQueryMatched) {
  if (context.mode === "changed") {
    return [];
  }

  return (owner.availableFields ?? []).filter((option) => {
    const modeMatches = context.mode === "all"
      || context.mode === "common" && option.tier === "common"
      || context.mode === "advanced" && option.tier === "advanced";

    if (!modeMatches) {
      return false;
    }

    if (!context.query || parentQueryMatched) {
      return true;
    }

    return normalizeSearch([
      option.label,
      option.key,
      option.path?.join("."),
      option.description
    ].filter(Boolean).join(" ")).includes(context.query);
  });
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}
