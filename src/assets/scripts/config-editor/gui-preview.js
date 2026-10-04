import { labelForKey } from "./schema-options.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";
import { lorePreviewText } from "./lore-value.js";
import { parseAnchoredValue } from "./kingdoms-yaml.js";
import { resolveMessageMacros } from "./message-macros.js";
import { parseMessagePreview, readableCondition } from "./message-preview.js";

const INVENTORY_SLOT_COUNTS = new Map([
  ["ANVIL", 3],
  ["BARREL", 27],
  ["BEACON", 1],
  ["BLAST_FURNACE", 3],
  ["BREWING", 5],
  ["CARTOGRAPHY", 3],
  ["CHEST", 54],
  ["CHISELED_BOOKSHELF", 6],
  ["COMPOSTER", 1],
  ["CRAFTER", 9],
  ["CRAFTING", 5],
  ["CREATIVE", 9],
  ["DECORATED_POT", 1],
  ["DISPENSER", 9],
  ["DROPPER", 9],
  ["ENCHANTING", 2],
  ["ENDER_CHEST", 27],
  ["FURNACE", 3],
  ["GRINDSTONE", 3],
  ["HOPPER", 5],
  ["JUKEBOX", 1],
  ["LECTERN", 1],
  ["LOOM", 4],
  ["MERCHANT", 3],
  ["PLAYER", 41],
  ["SHULKER_BOX", 27],
  ["SMITHING", 4],
  ["SMITHING_NEW", 4],
  ["SMOKER", 3],
  ["STONECUTTER", 2],
  ["WORKBENCH", 10]
]);

const INVENTORY_COORDINATE_GRIDS = new Map([
  ["CHEST", { columns: 9, rows: 6 }],
  ["BARREL", { columns: 9, rows: 3 }],
  ["ENDER_CHEST", { columns: 9, rows: 3 }],
  ["SHULKER_BOX", { columns: 9, rows: 3 }],
  ["CRAFTER", { columns: 3, rows: 3 }],
  ["DISPENSER", { columns: 3, rows: 3 }],
  ["DROPPER", { columns: 3, rows: 3 }]
]);

const INVENTORY_PREVIEW_LAYOUTS = new Map([
  ["HOPPER", { columns: 5, rows: 1 }],
  ["DISPENSER", { columns: 3, rows: 3 }],
  ["DROPPER", { columns: 3, rows: 3 }],
  ["ANVIL", { columns: 3, rows: 1 }],
  ["FURNACE", { columns: 3, rows: 1 }],
  ["BLAST_FURNACE", { columns: 3, rows: 1 }],
  ["SMOKER", { columns: 3, rows: 1 }],
  ["WORKBENCH", { columns: 3, rows: 3 }],
  ["CRAFTING", { columns: 3, rows: 3 }]
]);

export function guiPositionBounds(type, key) {
  const inventoryType = String(type || "CHEST").toLocaleUpperCase("en-US");
  const slotCount = INVENTORY_SLOT_COUNTS.get(inventoryType);

  if (["slot", "slots", "interactable"].includes(key)) {
    return slotCount ? { minimum: 0, maximum: slotCount - 1 } : null;
  }

  const grid = INVENTORY_COORDINATE_GRIDS.get(inventoryType);

  if (key === "rows" && inventoryType === "CHEST") {
    return { minimum: 1, maximum: 6 };
  }

  if (key === "posx" && grid) {
    return { minimum: 1, maximum: grid.columns };
  }

  if (key === "posy" && grid) {
    return { minimum: 1, maximum: grid.rows };
  }

  if (key === "context-start-row" && grid) {
    return { minimum: 1, maximum: grid.rows };
  }

  return null;
}

export function buildGuiPreview(index, { macros = null } = {}) {
  const type = scalarValue(index, ["type"]) || "CHEST";
  const inventoryType = type.toLocaleUpperCase("en-US");
  const declaredRows = integerValue(index, ["rows"]);
  const fixedLayout = INVENTORY_PREVIEW_LAYOUTS.get(inventoryType);
  const coordinateGrid = INVENTORY_COORDINATE_GRIDS.get(inventoryType);
  const capacity = INVENTORY_SLOT_COUNTS.get(inventoryType);
  const columns = fixedLayout?.columns ?? coordinateGrid?.columns ?? 9;

  const options = optionRoots(index).flatMap((root) =>
    directChildren(index, root.path).flatMap((entry) =>
      switchOptionPreviews(index, optionPreview(index, entry, columns, macros), macros)
    )
  );
  const inheritedCount = options.filter((option) => option.inherited).length;
  const localCount = options.length - inheritedCount;
  const inheritedOnly = inheritedCount > 0 && localCount === 0;

  const highestSlot = Math.max(-1, ...options.flatMap((option) => option.slots));
  const inferredRows = Math.max(1, Math.ceil((highestSlot + 1) / columns));
  const rows = inventoryType === "CHEST"
    ? Math.min(6, Math.max(1, declaredRows ?? inferredRows))
    : fixedLayout?.rows
      ?? coordinateGrid?.rows
      ?? Math.min(6, Math.max(1, Math.ceil((capacity ?? highestSlot + 1) / columns)));
  const slotCount = inventoryType === "CHEST" || !capacity ? columns * rows : capacity;
  const slots = Array.from({ length: slotCount }, (_, slot) => ({ slot, options: [] }));
  const unplaced = [];
  const invalid = [];

  for (const option of options) {
    if (!option.slots.length) {
      unplaced.push(option);
      continue;
    }

    for (const slot of option.slots) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) {
        invalid.push({ option, slot });
        continue;
      }

      slots[slot].options.push(option);
    }
  }

  return {
    title: scalarValue(index, ["title"]) || "Inventory menu",
    type,
    columns,
    rows,
    slotCount,
    slots,
    options,
    unplaced,
    invalid,
    collisions: slots.filter((slot) => slot.options.length > 1),
    inheritedOnly,
    inheritedCount,
    localCount
  };
}

export function availableGuiSlots(preview) {
  return (preview?.slots ?? [])
    .filter((slot) => slot.options.length === 0)
    .map((slot) => slot.slot);
}

export function plainGuiText(value) {
  return String(value ?? "")
    .replace(/\\n/g, " ")
    .replace(/&(?:#[0-9a-f]{6}|[0-9a-fk-or])/gi, "")
    .replace(/\{\$[^}]+}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function previewGuiText(value, macros = null) {
  return parseMessagePreview(value, { macros }).lines
    .map((line) => line.map((segment) => segment.text).join(""))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function previewGuiMessage(value, macros = null) {
  return resolveMessageMacros(value, macros);
}

export function guiTooltipMessage(option, macros = null) {
  const name = previewGuiMessage(option.previewName ?? option.name, macros);
  const lore = previewGuiMessage(option.previewLore ?? option.lore, macros);

  return hasVisibleGuiText(lore) ? `${name}\n&r${lore}` : name;
}

function hasVisibleGuiText(value) {
  return parseMessagePreview(value).lines.some((line) =>
    line.some((segment) => segment.text.trim())
  );
}

function optionPreview(index, entry, columns, macros) {
  const path = entry.path;
  const directSlot = integerEntry(index, [...path, "slot"]);
  const repeatedSlot = listValues(index, [...path, "slot"]);
  const posx = integerEntry(index, [...path, "posx"]);
  const posy = integerEntry(index, [...path, "posy"]);
  const slotList = listValues(index, [...path, "slots"]);
  let slots = slotList.length ? slotList : repeatedSlot;
  let position = slotList.length
    ? { kind: "slots", path: [...path, "slots"] }
    : repeatedSlot.length
      ? { kind: "slots", path: [...path, "slot"] }
      : null;

  if (!slots.length && directSlot) {
    slots = [directSlot.value];
    position = { kind: "slot", path: directSlot.path };
  } else if (!slots.length && posx && posy) {
    slots = [(posy.value - 1) * columns + posx.value - 1];
    position = { kind: "coordinates", xPath: posx.path, yPath: posy.path };
  }

  const directName = scalarValue(index, [...path, "name"]);
  const directMaterial = scalarValue(index, [...path, "material"]);
  const directSkull = scalarValue(index, [...path, "skull"]);
  const directLore = loreValue(index, [...path, "lore"]);
  const directComponents = itemComponents(index, path, directMaterial);
  const directAppearance = {
    name: directName,
    material: directMaterial,
    skull: resolveMessageMacros(directSkull, macros),
    lore: directLore,
    components: directComponents
  };
  const switchName = scalarValue(index, [...path, "[switch]"]);
  const states = resolvedConditionalStates(index, path, directAppearance, macros);
  const stateMaterials = uniqueStateValues(states, "material");
  const name = directName;
  const material = directMaterial;
  const skull = resolveMessageMacros(directSkull, macros);
  const lore = directLore;
  const previewName = name || commonStateValue(states, "name");
  const previewMaterial = material || commonStateValue(states, "material");
  const previewSkull = skull || commonStateValue(states, "skull");
  const representativeSkull = previewSkull || states[0]?.skull || "";
  const previewLore = lore || commonStateValue(states, "lore");

  return {
    key: entry.key,
    label: labelForKey(entry.key),
    path,
    slots,
    position,
    name,
    material: material || (entry.syntax ? "Generated" : "Unspecified"),
    skull,
    lore,
    components: directComponents,
    previewName,
    previewMaterial,
    previewSkull,
    representativeSkull,
    previewLore,
    stateMaterials,
    displayName: previewGuiText(previewName, macros),
    displayLore: previewGuiText(previewLore, macros),
    states,
    switchName,
    inherited: Boolean(entry.inherited),
    origin: entry.origin ?? "",
    generated: Boolean(entry.generated),
    generatedBy: entry.generatedBy ?? ""
  };
}

function switchOptionPreviews(index, parent, macros) {
  if (!parent.switchName || !parent.slots.length) {
    return [parent];
  }

  const rootPath = [`[${parent.switchName}]`];
  const root = index.byPath.get(pathKey(rootPath));

  if (!root?.container) {
    return [parent];
  }

  const variants = directChildren(index, rootPath).filter((variant) => variant.key !== "[else]");

  if (!variants.length) {
    return [parent];
  }

  const parentAppearance = {
    name: parent.name,
    material: scalarValue(index, [...parent.path, "material"]),
    skull: parent.skull,
    lore: parent.lore,
    components: parent.components
  };

  return parent.slots.map((slot, position) => {
    const variant = variants[position % variants.length];
    const appearance = resolvedAppearance(index, variant.path, parentAppearance, macros);
    const states = resolvedConditionalStates(index, variant.path, appearance, macros);

    return switchVariantPreview(parent, variant, appearance, states, slot, macros);
  });
}

function switchVariantPreview(parent, variant, appearance, states, slot, macros) {
  const stateMaterials = uniqueStateValues(states, "material");
  const previewName = appearance.name || commonStateValue(states, "name");
  const previewMaterial = appearance.material || commonStateValue(states, "material");
  const previewSkull = appearance.skull || commonStateValue(states, "skull");
  const representativeSkull = previewSkull || states[0]?.skull || "";
  const previewLore = appearance.lore || commonStateValue(states, "lore");

  return {
    ...parent,
    key: variant.key,
    label: labelForKey(variant.key),
    path: variant.path,
    slots: [slot],
    position: null,
    name: appearance.name,
    material: appearance.material || (variant.syntax ? "Generated" : "Unspecified"),
    skull: appearance.skull,
    lore: appearance.lore,
    components: appearance.components,
    previewName,
    previewMaterial,
    previewSkull,
    representativeSkull,
    previewLore,
    stateMaterials,
    displayName: previewGuiText(previewName, macros),
    displayLore: previewGuiText(previewLore, macros),
    states,
    switchValue: variant.key,
    switchShared: true,
    inherited: Boolean(parent.inherited || variant.inherited),
    origin: variant.origin || parent.origin,
    generated: Boolean(variant.generated),
    generatedBy: variant.generatedBy ?? ""
  };
}

function resolvedAppearance(index, path, parent, macros) {
  const directMaterial = scalarValue(index, [...path, "material"]);
  const material = directMaterial || parent.material;

  return {
    name: scalarValue(index, [...path, "name"]) || parent.name,
    material,
    skull: resolveMessageMacros(scalarValue(index, [...path, "skull"]) || parent.skull, macros),
    lore: loreValue(index, [...path, "lore"]) || parent.lore,
    components: itemComponents(index, path, material, parent.components)
  };
}

function resolvedConditionalStates(index, path, parent, macros) {
  return conditionalStates(index, path).map((state) => {
    const appearance = resolvedAppearance(index, state.path, parent, macros);

    return { ...state, ...appearance };
  });
}

function commonStateValue(states, key) {
  if (!states.length) {
    return "";
  }

  const values = states.map((state) => state[key] ?? "");

  return values[0] && values.every((value) => value === values[0]) ? values[0] : "";
}

function uniqueStateValues(states, key) {
  return states
    .map((state) => state[key] ?? "")
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function conditionalStates(index, optionPath) {
  const candidates = directChildren(index, optionPath).filter((entry) => entry.container);

  return candidates.filter((candidate) =>
    index.byPath.has(pathKey([...candidate.path, "condition"]))
      || ["else", "enabled", "disabled", "maxxed", "upgrade", "disallowed"].includes(candidate.key)
  ).map((candidate) => {
    const condition = scalarValue(index, [...candidate.path, "condition"]);

    return {
      key: candidate.key,
      label: labelForKey(candidate.key),
      path: candidate.path,
      condition,
      conditionLabel: condition ? `When ${readableCondition(condition)}` : "Otherwise",
      name: scalarValue(index, [...candidate.path, "name"]),
      material: scalarValue(index, [...candidate.path, "material"]),
      skull: scalarValue(index, [...candidate.path, "skull"]),
      lore: loreValue(index, [...candidate.path, "lore"]),
      inherited: Boolean(candidate.inherited),
      origin: candidate.origin ?? "",
      generated: Boolean(candidate.generated),
      generatedBy: candidate.generatedBy ?? ""
    };
  });
}

function itemComponents(index, path, material, inherited = {}) {
  const components = structuredClone(inherited);
  const glow = literalValue(index, [...path, "glow"]);
  const color = minecraftColor(scalarValue(index, [...path, "color"]));
  const customModelData = customModelDataComponent(index, [...path, "custom-model-data"]);
  const patterns = bannerPatternComponents(index, [...path, "patterns"]);
  const materialId = String(material).toLocaleLowerCase("en-US");

  if (typeof glow === "boolean") {
    components.enchantment_glint_override = glow;
  }

  if (customModelData !== null) {
    components.custom_model_data = customModelData;
  }

  if (patterns.length) {
    components.banner_patterns = patterns;
  }

  if (color !== null) {
    if (materialId.includes("leather") || materialId.includes("wolf_armor")) {
      components.dyed_color = color;
    } else if (materialId.includes("potion") || materialId === "tipped_arrow") {
      components.potion_contents = {
        ...(components.potion_contents ?? {}),
        custom_color: color
      };
    } else if (materialId.includes("map")) {
      components.map_color = color;
    }
  }

  return components;
}

function customModelDataComponent(index, path) {
  const entry = index.byPath.get(pathKey(path));

  if (!entry) {
    return null;
  }

  if (!entry.container) {
    const value = parseSimpleLiteral(entry.source).value;

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value) {
      return { strings: [value] };
    }

    return null;
  }

  const component = {};

  for (const field of ["floats", "strings", "colors", "flags"]) {
    const values = rawListValues(index, [...path, field]);

    if (!values.length) {
      continue;
    }

    component[field] = field === "floats"
      ? values.map(Number).filter(Number.isFinite)
      : field === "flags"
        ? values.map((value) => value === true || String(value).toLocaleLowerCase("en-US") === "true")
        : field === "colors"
          ? values.map(minecraftColor).filter((value) => value !== null)
          : values.map(String);
  }

  return Object.keys(component).length ? component : null;
}

function bannerPatternComponents(index, path) {
  const entry = index.byPath.get(pathKey(path));

  if (!entry?.container) {
    return [];
  }

  return directChildren(index, path).flatMap((pattern) => {
    if (pattern.container) {
      return [];
    }

    const color = scalarSource(pattern.source).trim().toLocaleLowerCase("en-US");
    const id = String(pattern.key).trim().toLocaleLowerCase("en-US");

    return color && id ? [{
      pattern: id.includes(":") ? id : `minecraft:${id}`,
      color
    }] : [];
  });
}

function minecraftColor(value) {
  const source = String(value ?? "").trim();

  if (!source) {
    return null;
  }

  if (/^\d+$/.test(source)) {
    const integer = Number(source);

    return integer <= 0xffffff ? integer : null;
  }

  const hex = /^#?([0-9a-f]{6})$/i.exec(source);

  if (hex) {
    return Number.parseInt(hex[1], 16);
  }

  const rgb = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(source);

  if (!rgb || rgb.slice(1).some((channel) => Number(channel) > 255)) {
    return null;
  }

  return Number(rgb[1]) * 0x10000 + Number(rgb[2]) * 0x100 + Number(rgb[3]);
}

function literalValue(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return entry && !entry.container ? parseSimpleLiteral(entry.source).value : null;
}

function optionRoots(index) {
  const options = index.byPath.get("options");
  const switchedRoots = new Set(index.entries
    .filter((entry) => entry.path.length === 3
      && entry.path[0] === "options"
      && entry.path[2] === "[switch]"
      && !entry.container)
    .map((entry) => `[${scalarSource(entry.source)}]`));
  const dynamic = index.entries.filter((entry) =>
    entry.path.length === 1
      && entry.container
      && /^\[[^\]]+]$/.test(entry.key)
      && !switchedRoots.has(entry.key)
      && entry.syntax?.kind !== "function-declaration"
      && !entry.source.trimStart().startsWith("&")
  );

  return [options, ...dynamic].filter(Boolean);
}

function scalarValue(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return entry && !entry.container ? scalarSource(entry.source) : "";
}

function loreValue(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return entry ? lorePreviewText(entry, index).replace(/[\r\n]+$/, "") : "";
}

function scalarSource(source) {
  const anchored = parseAnchoredValue(source);

  return String(parseSimpleLiteral(anchored?.value ?? source).value ?? "");
}

function integerValue(index, path) {
  return integerEntry(index, path)?.value ?? null;
}

function integerEntry(index, path) {
  const entry = index.byPath.get(pathKey(path));

  if (!entry) {
    return null;
  }

  const value = Number.parseInt(String(parseSimpleLiteral(entry.source).value), 10);

  return Number.isInteger(value) ? { path, value } : null;
}

function listValues(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return (entry?.collectionItems ?? [])
    .map((item) => Number.parseInt(String(parseSimpleLiteral(item.source).value), 10))
    .filter(Number.isInteger);
}

function rawListValues(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return (entry?.collectionItems ?? []).map((item) => parseSimpleLiteral(item.source).value);
}

function directChildren(index, path) {
  return index.entries.filter((entry) =>
    entry.path.length === path.length + 1
      && path.every((segment, position) => entry.path[position] === segment)
  );
}
