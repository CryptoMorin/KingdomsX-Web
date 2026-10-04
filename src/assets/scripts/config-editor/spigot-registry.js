import registry from "../../../data/config-editor/spigot/index.json";
import {
  loadMinecraftSounds,
  minecraftSoundValues,
  minecraftSoundValueStyle
} from "./minecraft-sounds.js";

const byId = new Map(registry.registries.map((entry) => [entry.id, entry]));
const byType = new Map([
  ["Attribute", "attribute"],
  ["AttributeOperation", "attribute-operation"],
  ["AxolotlVariant", "axolotl-variant"],
  ["AnimalEntityType", "animal-entity-type"],
  ["BarColor", "bar-color"],
  ["BarFlag", "bar-flag"],
  ["BarStyle", "bar-style"],
  ["Biome", "biome"],
  ["BookGeneration", "book-generation"],
  ["DyeColor", "dye-color"],
  ["DamageCause", "damage-cause"],
  ["Enchant", "enchantment"],
  ["Enchantment", "enchantment"],
  ["Enum<org.bukkit.entity.EntityType>", "entity-type"],
  ["EntityType", "entity-type"],
  ["EquipmentSlot", "equipment-slot"],
  ["FireworkType", "firework-type"],
  ["InventoryType", "inventory-type"],
  ["ItemFlag", "item-flag"],
  ["Material", "material"],
  ["MapScale", "map-scale"],
  ["Particle", "particle"],
  ["PatternType", "pattern-type"],
  ["PotionEffectType", "potion-effect-type"],
  ["Sound", "sound"],
  ["SoundCategory", "sound-category"],
  ["TropicalFishPattern", "tropical-fish-pattern"]
]);

const keyRegistries = new Map([
  ["biome", "biome"],
  ["biomes", "biome"],
  ["attribute", "attribute"],
  ["book-generation", "book-generation"],
  ["dye-color", "dye-color"],
  ["enchant", "enchantment"],
  ["enchantment", "enchantment"],
  ["entity-type", "entity-type"],
  ["item-flag", "item-flag"],
  ["inventory-type", "inventory-type"],
  ["pattern-type", "pattern-type"],
  ["material", "material"],
  ["particle", "particle"],
  ["potion-effect", "potion-effect-type"],
  ["sound", "sound"]
]);

const pickerControllers = new WeakMap();
const soundRegistryFormats = new WeakMap();
const MAX_PICKER_RESULTS = 80;

export const spigotRegistry = registry;

export function registryForType(type, key = "") {
  const typeName = namedType(type);
  const direct = byType.get(typeName);

  if (direct) {
    return byId.get(direct) ?? null;
  }

  if (typeName) {
    return null;
  }

  if (type?.kind && !["string", "suggestion"].includes(type.kind)) {
    return null;
  }

  const normalizedKey = String(key)
    .toLocaleLowerCase("en-US")
    .replace(/^[<{\[]+/, "")
    .replace(/[>}\]]+$/, "");
  const inferred = keyRegistries.get(normalizedKey) ?? keyRegistries.get(normalizedKey.replace(/s$/, ""));

  return inferred ? byId.get(inferred) ?? null : null;
}

export function attachRegistry(input, entry) {
  if (!entry || typeof document === "undefined") {
    return input;
  }

  input.removeAttribute("list");
  input.autocomplete = "off";

  const existing = pickerControllers.get(input);

  if (existing) {
    existing.setRegistry(entry);
    return existing.root;
  }

  const root = document.createElement("div");
  root.className = "editor-search-select position-relative w-100 min-w-0";
  const control = document.createElement("div");
  control.className = "editor-search-select-control position-relative";
  const valuePreview = document.createElement("span");
  valuePreview.className = "editor-search-select-value-preview position-absolute d-flex align-items-center text-truncate";
  valuePreview.setAttribute("aria-hidden", "true");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-chevron-down editor-search-select-icon position-absolute";
  icon.setAttribute("aria-hidden", "true");
  const menu = document.createElement("div");
  menu.className = "editor-search-select-menu position-absolute start-0 end-0";
  menu.hidden = true;
  menu.role = "listbox";
  const results = document.createElement("div");
  const footer = document.createElement("div");
  footer.className = "editor-search-select-footer";
  menu.append(results, footer);

  const parent = input.parentNode;

  if (parent) {
    parent.replaceChild(root, input);
  }

  control.append(input, valuePreview, icon);
  root.append(control, menu);

  input.role = "combobox";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `editor-picker-${entry.id}-${nextPickerId()}`);
  menu.id = input.getAttribute("aria-controls");

  let baseRegistry = entry;
  let currentRegistry = entry;
  let visibleValues = [];
  let activeIndex = -1;
  let registryRevision = 0;
  let currentQuery = "";

  const updateValuePreview = () => {
    const previewName = registryPreviewName(currentRegistry, input.value);
    valuePreview.textContent = previewName;
    control.classList.toggle("has-clean-preview", Boolean(previewName));
  };

  const close = () => {
    menu.hidden = true;
    root.classList.remove("is-open", "opens-up");
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const useRegistry = (nextRegistry) => {
    currentRegistry = nextRegistry;
    updateValuePreview();

    if (!menu.hidden) {
      open(currentQuery);
    }
  };

  const refreshSoundFormat = () => {
    const revision = ++registryRevision;

    if (baseRegistry.id !== "sound") {
      useRegistry(baseRegistry);
      return;
    }

    const style = minecraftSoundValueStyle(input.value);

    if (style === "bukkit") {
      useRegistry(baseRegistry);
      return;
    }

    loadSoundRegistryFormat(baseRegistry, style)
      .then((nextRegistry) => {
        if (revision !== registryRevision || minecraftSoundValueStyle(input.value) !== style) {
          return;
        }

        useRegistry(nextRegistry);
      })
      .catch(() => {});
  };

  const setActive = (index) => {
    const choices = [...results.querySelectorAll("[role=option]")];

    if (!choices.length) {
      return;
    }

    activeIndex = Math.max(0, Math.min(index, choices.length - 1));
    choices.forEach((choice, position) => {
      const selected = position === activeIndex;
      choice.classList.toggle("is-active", selected);
      choice.setAttribute("aria-selected", String(selected));
    });
    const active = choices[activeIndex];
    input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  };

  const choose = (value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();

    if (input.isConnected) {
      input.focus();
    }
  };

  const open = (query = "") => {
    currentQuery = query;
    const matches = filterRegistryValues(currentRegistry, query, MAX_PICKER_RESULTS);
    visibleValues = matches.values;
    activeIndex = -1;
    results.replaceChildren();

    for (const [index, value] of visibleValues.entries()) {
      const choice = document.createElement("button");
      choice.type = "button";
      const displayName = registryDisplayName(value);
      choice.className = "editor-search-select-option d-grid align-items-center w-100 text-start border-0 bg-transparent";
      choice.id = `${menu.id}-option-${index}`;
      choice.role = "option";
      choice.tabIndex = -1;
      choice.setAttribute("aria-selected", "false");
      choice.setAttribute("aria-label", `${displayName} (${value})`);
      choice.append(
        textElement("span", "editor-search-select-name text-truncate", displayName),
        textElement("span", "editor-search-select-identifier text-truncate", value)
      );
      choice.addEventListener("mousedown", (event) => event.preventDefault());
      choice.addEventListener("click", () => choose(value));
      results.append(choice);
    }

    if (!visibleValues.length) {
      results.append(textElement("p", "editor-search-select-empty", "No matching values."));
    }

    footer.textContent = matches.remaining
      ? `${matches.remaining.toLocaleString()} more values. Keep typing to narrow the list.`
      : `${matches.total.toLocaleString()} ${matches.total === 1 ? "value" : "values"}`;
    const bounds = root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - bounds.bottom;
    root.classList.toggle("opens-up", spaceBelow < 300 && bounds.top > spaceBelow);
    root.classList.add("is-open");
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const handleFocus = () => {
    open("");
    refreshSoundFormat();

    if (baseRegistry.id === "sound" && minecraftSoundValueStyle(input.value) === "bukkit") {
      loadSoundRegistryFormat(baseRegistry, "dotted").catch(() => {});
    }
  };
  const handleInput = () => {
    updateValuePreview();
    refreshSoundFormat();
    open(input.value);
  };
  const handleClick = () => {
    if (menu.hidden) {
      open("");
    }
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (menu.hidden) {
        open();
      }

      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }

    if (event.key === "Enter" && !menu.hidden && activeIndex >= 0) {
      event.preventDefault();
      choose(visibleValues[activeIndex]);
    }
  };
  const handleFocusOut = (event) => {
    if (!root.contains(event.relatedTarget)) {
      close();
    }
  };

  input.addEventListener("focus", handleFocus);
  input.addEventListener("click", handleClick);
  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", handleKeydown);
  root.addEventListener("focusout", handleFocusOut);
  updateValuePreview();

  const controller = {
    root,
    setRegistry(nextRegistry) {
      baseRegistry = nextRegistry;
      input.setAttribute("aria-controls", `editor-picker-${nextRegistry.id}-${nextPickerId()}`);
      menu.id = input.getAttribute("aria-controls");
      refreshSoundFormat();
    },
    destroy() {
      close();
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("click", handleClick);
      input.removeEventListener("input", handleInput);
      input.removeEventListener("keydown", handleKeydown);
      root.removeEventListener("focusout", handleFocusOut);
      input.removeAttribute("role");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");

      if (root.parentNode) {
        root.replaceWith(input);
      }
    }
  };
  pickerControllers.set(input, controller);
  refreshSoundFormat();
  return root;
}

export function detachRegistry(input) {
  const controller = pickerControllers.get(input);

  if (!controller) {
    return input;
  }

  controller.destroy();
  pickerControllers.delete(input);
  return input;
}

function filterRegistryValues(entry, query, limit = MAX_PICKER_RESULTS) {
  const search = String(query).trim().toLocaleLowerCase("en-US");
  const selectableValues = entry.values.filter((value) => !/^LEGACY_/i.test(value));
  const aliasesByValue = Object.entries(entry.aliases ?? {}).reduce((byValue, [alias, value]) => {
    const aliases = byValue.get(value) ?? [];
    aliases.push(alias);
    byValue.set(value, aliases);
    return byValue;
  }, new Map());
  const matches = search
    ? selectableValues.filter((value) =>
        value.toLocaleLowerCase("en-US").includes(search)
          || registryDisplayName(value).toLocaleLowerCase("en-US").includes(search)
          || (aliasesByValue.get(value) ?? []).some((alias) =>
            alias.toLocaleLowerCase("en-US").includes(search)
              || registryDisplayName(alias).toLocaleLowerCase("en-US").includes(search)
          )
      )
    : selectableValues;

  return {
    values: matches.slice(0, limit),
    total: matches.length,
    remaining: Math.max(0, matches.length - limit)
  };
}

export function registryContains(entry, value) {
  const normalized = String(value).toLocaleUpperCase("en-US");

  return Boolean(entry?.values.includes(normalized) || entry?.aliases?.[normalized]);
}

function namedType(type) {
  if (!type) {
    return "";
  }

  if (type.kind === "nullable") {
    return namedType(type.value);
  }

  return type.typeName ?? "";
}

function registryDisplayName(value) {
  return value.toLocaleLowerCase("en-US").replace(/[._]/g, " ").replace(/\b\w/g, (character) => character.toLocaleUpperCase("en-US"));
}

function registryPreviewName(entry, value) {
  const source = String(value);
  const normalized = source.toLocaleUpperCase("en-US");
  const knownValue = entry?.values.find((candidate) => candidate.toLocaleUpperCase("en-US") === normalized);

  if (knownValue) {
    return registryDisplayName(knownValue);
  }

  return entry?.aliases?.[normalized] ? registryDisplayName(normalized) : source;
}

let pickerId = 0;

function nextPickerId() {
  pickerId += 1;
  return pickerId;
}

function loadSoundRegistryFormat(entry, style) {
  let formats = soundRegistryFormats.get(entry);

  if (!formats) {
    formats = new Map();
    soundRegistryFormats.set(entry, formats);
  }

  let request = formats.get(style);

  if (!request) {
    request = loadMinecraftSounds().then((catalog) => ({
      ...entry,
      values: minecraftSoundValues(catalog, style)
    })).catch((error) => {
      formats.delete(style);
      throw error;
    });
    formats.set(style, request);
  }

  return request;
}

function textElement(tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  return node;
}
