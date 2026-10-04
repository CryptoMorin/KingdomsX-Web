import { editorOverrides } from "./editor-overrides.js";
import kingdomCommands from "../../../data/config-editor/catalog/kingdom-command-ids.json" with { type: "json" };
import runtimeCatalog from "../../../data/config-editor/runtime-options.json" with { type: "json" };
import spigotApi from "../../../data/config-editor/spigot/index.json" with { type: "json" };

const knownEnums = editorOverrides.knownEnums;
const enumByTypeName = new Map(
  Object.values(knownEnums).flatMap((definition) =>
    definition.typeNames.map((typeName) => [typeName, definition])
  )
);

export const KINGDOM_COMMANDS = Object.freeze([...kingdomCommands.values]);
export const KINGDOM_PERMISSIONS = Object.freeze([...runtimeCatalog.rankPermissions]);
export const BOSS_BAR_COLORS = spigotValuesFor("BarColor");
export const BOSS_BAR_FLAGS = spigotValuesFor("BarFlag");
export const BOSS_BAR_STYLES = spigotValuesFor("BarStyle");

function spigotValuesFor(typeName) {
  const registry = spigotApi.registries.find((entry) => entry.typeName === typeName);

  if (!registry) {
    throw new Error(`Missing Spigot registry for ${typeName}.`);
  }

  return Object.freeze([...registry.values]);
}

function knownEnumForTypeName(typeName) {
  if (!typeName) {
    return null;
  }

  return enumByTypeName.get(String(typeName)) ?? null;
}

export function applyKnownEnumTypes(type, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  const known = knownEnumForTypeName(type.typeName);

  if (known && ["suggestion", "string", "enum"].includes(type.kind)) {
    type.kind = "enum";
    type.values = [...known.values];
    if (!type.description) {
      type.description = known.description;
    }

    delete type.allowCustom;
  }

  if (type.kind === "object") {
    for (const child of type.fields ?? []) {
      applyKnownEnumTypes(child.type, seen);
    }

    applyKnownEnumTypes(type.additionalProperties, seen);
  } else if (type.kind === "mapping") {
    for (const child of type.fields ?? []) {
      applyKnownEnumTypes(child.type, seen);
    }

    applyKnownEnumTypes(type.keys, seen);
    applyKnownEnumTypes(type.values, seen);
  } else if (type.kind === "union") {
    for (const choice of type.choices ?? []) {
      applyKnownEnumTypes(choice, seen);
    }
  } else if (type.kind === "list" || type.kind === "set") {
    applyKnownEnumTypes(type.elements, seen);
  } else if (type.kind === "nullable") {
    applyKnownEnumTypes(type.value, seen);
  }
}
