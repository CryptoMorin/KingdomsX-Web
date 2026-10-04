import { isEnchantKeyType, mappingKeyHelp, mappingKeyLabel } from "./mapping-key-control.js";
import { labelForKey } from "./schema-options.js";
import { unwrapNullable } from "./schema-types.js";

export function mappingCreationSpec({
  schemaId = "",
  fileName = "",
  group,
  entryKey = "",
  guiSlot = null
}) {
  const spec = resolveMappingCreationSpec({ schemaId, fileName, group, entryKey, guiSlot });
  const noun = spec.noun ?? "entry";

  return {
    ...spec,
    announcements: {
      started: `Started a new ${noun}. Choose it and set its value.`,
      unfinished: `Choose the ${noun} for the unfinished row before adding another.`,
      cancelled: `Cancelled the unfinished ${noun}.`,
      added: entryKey ? `Added ${labelForKey(entryKey)}.` : "Added the new entry."
    }
  };
}

function resolveMappingCreationSpec({ schemaId, fileName, group, entryKey, guiSlot }) {
  const direct = directEntrySpec(group);

  if (direct) {
    return direct;
  }

  if (schemaId === "guis/schema" && samePath(group.path, ["options"])) {
    return dialogSpec({
      eyebrow: "GUI button",
      descriptionCopy: "Create a named button inside ",
      parentLabel: group.label,
      title: "Add a button",
      actionLabel: "Add button",
      keyLabel: "Button name",
      blankLabel: "Create a new button",
      keyHelp: "Use a unique name that describes the button's purpose.",
      templateHelp: "Choose a new button with the usual name, material, and position settings, or duplicate an existing button.",
      submitLabel: "Create button"
    }, {
      starter: {
        kind: "fields",
        fields: guiSlot === null
          ? [
              ["name", JSON.stringify(`&f${labelForKey(entryKey)}`)],
              ["material", "STONE"],
              ["posx", "1"],
              ["posy", "1"]
            ]
          : [
              ["name", JSON.stringify(`&f${labelForKey(entryKey)}`)],
              ["material", "STONE"],
              ["slot", String(guiSlot)]
            ]
      }
    });
  }

  if (schemaId === "ranks"
    && group.path.length === 1
    && ["kingdom-ranks", "national-ranks"].includes(group.key)) {
    return dialogSpec({
      eyebrow: "Custom rank",
      descriptionCopy: "Create a rank inside ",
      title: "Add a rank",
      actionLabel: "Add rank",
      keyLabel: "Rank ID",
      blankLabel: "Create a new rank",
      keyHelp: "Use a short unique ID such as builder or officer.",
      templateHelp: "Start with the usual rank identity and permission settings, or duplicate an existing rank. Rank order determines priority.",
      submitLabel: "Create rank"
    }, {
      starter: {
        kind: "fields",
        fields: [
          ["name", JSON.stringify(labelForKey(entryKey))],
          ["color", JSON.stringify("&f")],
          ["symbol", JSON.stringify("♟")],
          ["material", "STONE"],
          ["max-claims", "0"],
          ["permissions", "[]"]
        ]
      }
    });
  }

  if (schemaId === "chat" && samePath(group.path, ["channels"])) {
    const format = "{$spy}{$nationPrefix}{$kingdomPrefix}%displayname% {$sep}≫ {$groupColor}%message%";

    return dialogSpec({
      eyebrow: "Chat channel",
      descriptionCopy: "Create a player chat channel inside ",
      parentLabel: group.label,
      title: "Add a chat channel",
      actionLabel: "Add chat channel",
      keyLabel: "Channel ID",
      blankLabel: "Create a new channel",
      keyHelp: "Use a permanent short ID. KingdomsX saves each player's selected channel using this name.",
      templateHelp: "A new channel starts with an audience condition, color, player format, and console/Discord format. You can also duplicate an existing channel.",
      submitLabel: "Create channel"
    }, {
      starter: {
        kind: "fields",
        fields: [
          ["color", JSON.stringify("&f")],
          ["recipients-condition", JSON.stringify("true")],
          ["admin-formats", JSON.stringify(format)],
          ["formats", JSON.stringify(format)]
        ]
      }
    });
  }

  if (schemaId === "chat" && samePath(group.path, ["show-item", "main-hand", "replace"])) {
    return dialogSpec({
      eyebrow: "Chat marker",
      descriptionCopy: "Create an item marker inside ",
      parentLabel: "Show Item / Main Hand / Replace",
      title: "Add a chat marker",
      actionLabel: "Add chat marker",
      keyLabel: "Marker",
      blankLabel: "Create a new marker",
      keyHelp: "Enter the exact text players will type, such as [showthis].",
      templateHelp: "Start with a blank message or duplicate an existing linked marker to reuse the same YAML anchor.",
      submitLabel: "Create marker"
    });
  }

  if (schemaId === "invasions" && samePath(group.path, ["countdown", "sound"])) {
    return dialogSpec({
      eyebrow: "Countdown sound",
      descriptionCopy: "Add a sound at another countdown second inside ",
      parentLabel: "Countdown / Sound",
      title: "Add a countdown sound",
      actionLabel: "Add countdown sound",
      keyLabel: "Countdown second",
      blankLabel: "Create a new sound cue",
      keyHelp: "Enter the countdown second when this sound should play.",
      templateHelp: "Start with a standard sound or duplicate an existing cue, then edit its sound, volume, pitch, category, and seed.",
      submitLabel: "Create sound cue"
    }, {
      starter: { kind: "source", source: JSON.stringify("ENTITY_EXPERIENCE_ORB_PICKUP, 1, 1") }
    });
  }

  if (isConditionMapping(group)) {
    const allowsFallback = group.keyType.allowFallback;

    return dialogSpec({
      eyebrow: allowsFallback ? "Conditional output" : "Condition",
      descriptionCopy: "Add another conditional result inside ",
      parentLabel: group.label,
      title: "Add a condition",
      actionLabel: "Add condition",
      keyLabel: allowsFallback ? "Condition or fallback" : "Condition",
      blankLabel: "Create a new condition",
      keyHelp: allowsFallback
        ? "Enter a Kingdoms condition, or enter else to add the optional fallback."
        : "Enter the Kingdoms condition that triggers the mapped value.",
      templateHelp: allowsFallback
        ? "Conditions are evaluated from top to bottom. New conditions are placed before an existing else fallback."
        : "Create the condition, then edit it and its matching value separately.",
      submitLabel: "Create condition"
    }, { conditional: allowsFallback, keyValidation: "condition" });
  }

  if (schemaId === "resource-points" && samePath(group.path, ["advanced"])) {
    return dialogSpec({
      eyebrow: "Advanced converter",
      descriptionCopy: "Create an item matcher inside ",
      title: "Add an advanced converter",
      actionLabel: "Add converter",
      keyLabel: "Converter name",
      blankLabel: "Create a new converter",
      keyHelp: "Use a short unique name that describes what this entry matches.",
      templateHelp: "Start with material and resource points, or duplicate an existing matcher and adjust its filters.",
      submitLabel: "Create converter"
    }, {
      starter: { kind: "fields", fields: [["material", "STONE"], ["resource-points", "1"]] }
    });
  }

  if (schemaId === "resource-points" && samePath(group.path, ["custom-items"])) {
    return dialogSpec({
      eyebrow: "Custom item",
      descriptionCopy: "Create an obtainable item inside ",
      title: "Add a custom item",
      actionLabel: "Add custom item",
      keyLabel: "Item ID",
      blankLabel: "Create a new custom item",
      keyHelp: "Use a short unique name that describes what this entry matches.",
      templateHelp: "Start with name, material, resource points, and lore, or duplicate an existing custom item.",
      submitLabel: "Create item"
    }, {
      starter: {
        kind: "fields",
        fields: [
          ["name", JSON.stringify(`&f${labelForKey(entryKey)}`)],
          ["material", "STONE"],
          ["resource-points", "1"],
          ["lore", "[]"]
        ]
      }
    });
  }

  if (isOutpostStock(fileName, group)) {
    return dialogSpec({
      eyebrow: "Outpost stock",
      descriptionCopy: "Create a traded item inside ",
      parentLabel: group.label,
      title: "Add a stock item",
      actionLabel: "Add stock item",
      keyLabel: "Stock ID",
      blankLabel: "Create from the standard stock settings",
      keyHelp: "Use a stable unique ID such as copper-ingot. Saved server-wide stock data uses this name.",
      templateHelp: "Start with the standard price, stock range, and item settings, or duplicate an existing stock to retain its custom limits.",
      submitLabel: "Create stock item"
    }, { starter: { kind: "source", source: "*fn-base [ 1, STONE ]" } });
  }

  if (schemaId === "config" && samePath(group.path, ["commands"])) {
    return dialogSpec({
      eyebrow: "Kingdoms command",
      descriptionCopy: "Add a command override inside ",
      parentLabel: group.label,
      title: "Add a command",
      actionLabel: "Add to Commands",
      keyLabel: "Command ID",
      blankLabel: "Create with disable, cooldown, and world settings",
      keyHelp: "Use the command's main node name from /k admin cmd.",
      templateHelp: "A new command starts with disabled, cooldown, and disabled-worlds. You can also duplicate an existing command entry.",
      submitLabel: "Add to Commands"
    }, {
      panel: "commands",
      starter: {
        kind: "fields",
        fields: [["disabled", "false"], ["cooldown", "0"], ["disabled-worlds", "[]"]]
      }
    });
  }

  return schemaOwnedOrGenericSpec(group);
}

function directEntrySpec(group) {
  if (isEnchantKeyType(group?.keyType)) {
    return {
      mode: "direct",
      panel: "standard",
      templates: false,
      eyebrow: "Enchantments",
      title: "Add enchant",
      help: "Add an enchant row, then choose the enchantment and set its level.",
      actionLabel: "Add enchant",
      noun: "enchant",
      keyLabel: "Enchant",
      keyHelp: mappingKeyHelp(group.keyType),
      starter: { kind: "source", source: "1" },
      submitLabel: "Add enchant"
    };
  }

  const value = unwrapNullable(group?.valueType);

  if (group?.keyType?.typeName === "Material" && ["integer", "decimal"].includes(value?.kind)) {
    return {
      mode: "direct",
      panel: "standard",
      templates: false,
      eyebrow: "Item values",
      title: "Add item",
      help: "Add an item row, then choose its material and set its value.",
      actionLabel: "Add item",
      noun: "item",
      keyLabel: "Item",
      keyHelp: mappingKeyHelp(group.keyType),
      starter: { kind: "source", source: String(value.minimum ?? 0) },
      submitLabel: "Add item"
    };
  }

  return null;
}

function schemaOwnedOrGenericSpec(group) {
  const recipe = group?.creation;
  const starter = recipe?.starter?.length
    ? { kind: "tree", fields: structuredClone(recipe.starter) }
    : requiredObjectStarter(group?.valueType);

  if (recipe?.entryLabel) {
    const noun = String(recipe.entryLabel).trim();
    const lowerNoun = noun.toLocaleLowerCase("en-US");
    const article = /^[aeiou]/i.test(lowerNoun) ? "an" : "a";
    const contents = starter?.kind === "tree"
      ? formatList(starter.fields.map((field) => labelForKey(field.key).toLocaleLowerCase("en-US")))
      : "";

    return dialogSpec({
      eyebrow: `${noun} entry`,
      descriptionCopy: `Create ${article} ${lowerNoun} inside `,
      title: `Add ${article} ${lowerNoun}`,
      actionLabel: `Add ${lowerNoun}`,
      keyLabel: mappingKeyLabel(group?.keyType) === "Entry name" ? `${labelForKey(noun)} name` : mappingKeyLabel(group?.keyType),
      blankLabel: contents ? `Create with ${contents}` : `Create a new ${lowerNoun}`,
      keyHelp: sentence(group?.keyType?.description || mappingKeyHelp(group?.keyType)
        || `Use a unique name for this ${lowerNoun}.`),
      blankHelp: contents
        ? `The new ${lowerNoun} includes editable ${contents} fields.`
        : unwrapNullable(group?.valueType)?.description || `The new ${lowerNoun} starts empty.`,
      templateHelp: contents
        ? `Start with editable ${contents} fields, or duplicate an existing ${lowerNoun}.`
        : `Create a new ${lowerNoun}, or duplicate an existing one as a starting point.`,
      submitLabel: `Create ${lowerNoun}`
    }, { starter });
  }

  const label = String(group?.label || labelForKey(String(group?.key ?? "entry"))).trim() || "this section";

  return dialogSpec({
    eyebrow: "Custom entry",
    descriptionCopy: "Create a named entry inside ",
    title: `Add entry to ${label}`,
    actionLabel: "Add entry",
    keyLabel: mappingKeyLabel(group?.keyType),
    blankLabel: "Create an empty entry",
    keyHelp: sentence(group?.keyType?.description || mappingKeyHelp(group?.keyType) || "Use a unique entry name."),
    blankHelp: unwrapNullable(group?.valueType)?.description || "The new entry starts empty so you can add only the settings it needs.",
    templateHelp: "Create an empty entry, or duplicate an existing entry as a starting point.",
    submitLabel: "Create entry"
  }, { starter });
}

function dialogSpec(profile, options = {}) {
  return {
    mode: "dialog",
    panel: options.panel ?? "standard",
    templates: true,
    conditional: options.conditional ?? false,
    keyValidation: options.keyValidation ?? null,
    starter: options.starter ?? null,
    help: profile.blankHelp ?? profile.templateHelp,
    ...profile
  };
}

function requiredObjectStarter(type) {
  const current = unwrapNullable(type);

  if (current?.kind !== "object") {
    return null;
  }

  const required = new Set((current.required ?? []).map(String));
  const fields = (current.fields ?? [])
    .filter((field) => required.has(field.key) || field.type?.required === true)
    .map((field) => starterField(field.key, field.type));

  return fields.length ? { kind: "tree", fields } : null;
}

function starterField(key, type) {
  const nested = requiredObjectStarter(type);

  return nested ? { key, children: nested.fields } : { key, source: initialSource(type) };
}

function initialSource(type) {
  const current = unwrapNullable(type);

  if (!current) {
    return '""';
  }

  if (current.kind === "union") {
    const choice = current.choices?.find((candidate) => unwrapNullable(candidate)?.kind !== "null") ?? current.choices?.[0];

    return initialSource(choice);
  }

  if (current.kind === "literal") {
    return scalarSource(current.value);
  }

  if (current.kind === "enum") {
    return scalarSource(current.values?.[0] ?? "");
  }

  if (current.kind === "boolean") {
    return "false";
  }

  if (["integer", "decimal"].includes(current.kind)) {
    return String(current.minimum ?? 0);
  }

  if (["list", "set"].includes(current.kind)) {
    return "[]";
  }

  if (["mapping", "object"].includes(current.kind)) {
    return "{}";
  }

  if (current.kind === "null") {
    return "null";
  }

  return '""';
}

function scalarSource(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function isConditionMapping(group) {
  return group?.keyType?.kind === "expression" && group.keyType.language === "condition";
}

function isOutpostStock(fileName, group) {
  const path = String(fileName).replaceAll("\\", "/");

  return /(?:^|\/)Structures\/outpost\.ya?ml$/i.test(path)
    && !/(?:^|\/)guis\//i.test(path)
    && samePath(group.path, ["stocks"]);
}

function samePath(left = [], right = []) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function formatList(values) {
  if (values.length < 2) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function sentence(value) {
  const text = String(value ?? "").trim();

  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}
