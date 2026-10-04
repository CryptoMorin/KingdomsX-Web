import { applyKnownEnumTypes } from "./editor-values.js";
import { editorOverrides } from "./editor-overrides.js";
import { applySchemaOverrides } from "./editor-schema-overrides.js";
import { addCapability, markCapabilityTree } from "./editor-capabilities.js";

const overlay = (type) => addCapability(type, { sources: ["editor-overlay"] });
const text = (typeName = "str", description = "") => overlay({ kind: "string", typeName, description });
const integer = (description = "", extra = {}) => overlay({ kind: "integer", description, ...extra });
const decimal = (description = "", extra = {}) => overlay({ kind: "decimal", description, ...extra });
const boolean = (description = "") => overlay({ kind: "boolean", description });
const suggestion = (typeName, description = "") => overlay({ kind: "suggestion", typeName, allowCustom: true, description });
const enumeration = (values, description = "", allowCustom = false) => overlay({ kind: "enum", values, allowCustom, description });
const list = (elements, description = "") => overlay({ kind: "list", elements, description });
const mapping = (keys, values, description = "") => overlay({ kind: "mapping", keys, values, description });
const object = (fields, description = "", extra = {}) => overlay({ kind: "object", fields, description, ...extra });
const field = (key, type) => ({ key, type });
const reference = (typeName, description = "") => overlay({ kind: "reference", typeName, description });

const locationType = () => object([
  field("world", suggestion("World", "World name or namespace.")),
  field("x", decimal("World X coordinate.")),
  field("y", decimal("World Y coordinate.")),
  field("z", decimal("World Z coordinate."))
], "A Minecraft world location.");

const colorType = (description = "Minecraft RGB or hexadecimal color.") => ({
  kind: "advanced",
  typeName: "Color",
  description
});

const customModelDataType = () => ({
  kind: "union",
  description: "Legacy model number, text/flag/color value, or the modern custom-model-data component.",
  choices: [
    integer("Legacy custom model number."),
    decimal("Custom model floating-point value."),
    text("str", "Custom model string value."),
    boolean("Custom model flag value."),
    colorType("Custom model color value."),
    object([
      field("strings", list(text(), "Custom model string components.")),
      field("floats", list(decimal(), "Custom model floating-point components.")),
      field("colors", list(colorType(), "Custom model color components.")),
      field("flags", list(boolean(), "Custom model boolean components."))
    ], "Modern custom-model-data component values.")
  ]
});

function createItemStackType(sourceSchema) {
  const type = clone(sourceSchema);
  type.description = "An XItemStack item definition. Material is required for a standalone item. GUI condition variants may inherit it.";
  type.required = ["material"];

  upsertFields(type, [
    field("name", text("Message", "Displayed item name. Supports Kingdoms colors and placeholders.")),
    field("lore", {
      kind: "union",
      description: "One lore line, a multiline scalar, or a list of lore lines.",
      choices: [list(text("Message")), text("Message")]
    }),
    field("material", suggestion("Material", "Minecraft material. Required for a standalone item definition.")),
    field("amount", integer("Item stack amount.", { minimum: 1 })),
    field("damage", decimal("Item damage or durability value.")),
    field("skull", { kind: "advanced", typeName: "SkullTexture", description: "Player name, UUID, textures URL/hash, or Base64 texture." }),
    field("unbreakable", boolean("Whether the item is unbreakable.")),
    field("custom-model-data", customModelDataType()),
    field("item-model", text("str", "Namespaced item model identifier. Takes priority over custom model data.")),
    field("item-name", text("Message", "Minecraft item-name component, separate from the display name.")),
    field("enchants", mapping(
      suggestion("Enchant"),
      integer("Enchantment level.", { minimum: 1, maximum: 256 }),
      "Applied enchantments by enchantment name."
    )),
    field("stored-enchants", mapping(
      suggestion("Enchant"),
      integer("Stored enchantment level.", { minimum: 1, maximum: 256 }),
      "Stored enchantments for enchanted books."
    )),
    field("flags", {
      kind: "union",
      description: "One or more Bukkit item flags.",
      choices: [suggestion("ItemFlag"), { kind: "set", elements: suggestion("ItemFlag") }]
    }),
    field("glow", boolean("Adds the visual enchantment glow.")),
    field("attributes", mapping(
      suggestion("Attribute"),
      object([
        field("name", text("str", "Attribute modifier name.")),
        field("amount", decimal("Attribute modifier amount.")),
        field("operation", suggestion("AttributeOperation", "How the modifier amount is applied.")),
        field("slot", suggestion("EquipmentSlot", "Equipment slot in which this modifier applies."))
      ], "Attribute modifier settings.", { required: ["amount"] }),
      "Item attribute modifiers by Bukkit attribute name."
    )),
    field("patterns", mapping(suggestion("PatternType"), suggestion("DyeColor"), "Banner pattern names mapped to dye colors.")),
    field("color", colorType("Leather, potion, map, or entity color depending on material.")),
    field("pattern-color", suggestion("DyeColor", "Tropical fish pattern color.")),
    field("pattern", suggestion("TropicalFishPattern", "Tropical fish pattern.")),
    field("contents", mapping(text(), reference("ItemStack"), "Named items inside a shulker box.")),
    field("spawner", suggestion("EntityType", "Entity spawned by a spawner item.")),
    field("projectiles", mapping(text(), reference("ItemStack"), "Charged crossbow projectiles.")),
    field("effects", { kind: "set", elements: { kind: "advanced", typeName: "Potion" }, description: "Potion or suspicious-stew effects." }),
    field("base-effect", { kind: "set", elements: { kind: "advanced", typeName: "Potion" }, description: "Legacy base potion effect settings." }),
    field("base-type", text("str", "Base potion type and optional extended/upgraded state.")),
    field("author", text("Message", "Written-book author (legacy root form).")),
    field("title", text("Message", "Written-book title (legacy root form).")),
    field("pages", list(text("Message"), "Written-book pages (legacy root form).")),
    field("generation", suggestion("BookGeneration", "Written-book generation.")),
    field("book", object([
      field("author", text("Message", "Written-book author.")),
      field("title", text("Message", "Written-book title.")),
      field("pages", list(text("Message"), "Written-book pages.")),
      field("generation", suggestion("BookGeneration", "Written-book generation."))
    ], "Written-book metadata.")),
    field("scaling", boolean("Whether a filled map is allowed to scale (legacy root form).")),
    field("location", locationType()),
    field("map", object([
      field("location", text("str", "Displayed map location name.")),
      field("color", colorType("Map display color.")),
      field("view", object([
        field("world", suggestion("World")),
        field("scale", suggestion("MapScale")),
        field("center", object([
          field("x", decimal()),
          field("z", decimal())
        ], "Map center coordinates."))
      ], "Map view settings."))
    ], "Filled-map metadata.")),
    field("creature", suggestion("EntityType", "Legacy spawn-egg entity type.")),
    field("tracked", boolean("Whether a compass tracks its lodestone.")),
    field("lodestone", locationType()),
    field("power", decimal("Firework flight power.")),
    field("firework", mapping(text(), object([
      field("flicker", boolean("Whether the effect flickers.")),
      field("trail", boolean("Whether the effect has a trail.")),
      field("trial", boolean("Legacy misspelling accepted by older XItemStack versions.")),
      field("colors", object([
        field("base", list(colorType(), "Primary firework colors.")),
        field("fade", list(colorType(), "Fade firework colors."))
      ], "Firework colors.")),
      field("fade-colors", list(colorType(), "Legacy fade-color list.")),
      field("type", suggestion("FireworkType", "Firework effect shape."))
    ], "One firework effect."), "Named firework effects.")),
    field("trim", object([
      field("material", text("str", "Armor trim material key.")),
      field("pattern", text("str", "Armor trim pattern key."))
    ], "Armor trim settings.", { required: ["material", "pattern"] }))
  ]);

  makeObjectFieldsOptional(type, new Set(type.required));
  return type;
}

function createItemMatcherType(sourceSchema) {
  const type = clone(sourceSchema);
  type.description = "Optional item properties that must match. Unspecified properties are ignored.";
  upsertFields(type, [
    field("name", { kind: "advanced", typeName: "StringMatcher", description: "Displayed-name matcher." }),
    field("lore", { kind: "advanced", typeName: "StringMatcher", description: "Lore matcher." }),
    field("material", { kind: "advanced", typeName: "StringMatcher<Material>", description: "Material matcher." }),
    field("custom-model-data", {
      kind: "union",
      description: "Custom model data number, text, or color matcher.",
      choices: [integer(), text(), colorType()]
    }),
    field("enchants", mapping(suggestion("Enchant"), {
      kind: "union",
      description: "Any level (*), an exact level, or a condition using the lvl variable.",
      choices: [enumeration(["*"]), integer(), { kind: "expression", language: "condition" }]
    }, "Enchantment requirements.")),
    field("nbt", mapping(text(), { kind: "advanced", typeName: "StringMatcher" }, "NBT paths mapped to string matchers."))
  ]);
  type.required = [];
  return type;
}

function addBuildingSemantics(root) {
  const conditionBranch = mapping(
    { kind: "expression", language: "condition", description: "User-defined Kingdoms condition expression." },
    text("Message", "User-defined denial message returned when the condition matches."),
    "Ordered condition expressions mapped to denial messages."
  );
  const conditions = mapping(
    {
      kind: "suggestion",
      typeName: "BuildingConditionAction",
      values: ["purchase", "upgrade", "interact", "place", "break"],
      allowCustom: true,
      description: "Building action checked by this condition group."
    },
    conditionBranch,
    "Optional condition chains for each building action."
  );
  conditions.optional = true;
  upsertFields(root, [field("conditions", conditions)]);

  const soundsField = root.fields.find((candidate) => candidate.key === "sounds");

  if (soundsField) {
    soundsField.type.optional = true;
    soundsField.type.keys = {
      kind: "suggestion",
      typeName: "BuildingSoundStage",
      allowCustom: true,
      description: "User-defined level or stage name, such as 1, first, or veteran."
    };
    const eventMapping = soundsField.type.values;

    if (eventMapping?.kind === "mapping") {
      const documented = eventMapping.keys?.values ?? [];
      eventMapping.keys = {
        kind: "suggestion",
        typeName: "BuildingSoundEvent",
        values: documented,
        allowCustom: true,
        description: "Sound event name used by this building."
      };
      eventMapping.description = "User-defined sound event names mapped to a sound or a started/finished/stopped sound group.";
    }
  }

  const particleDisplay = object([
    field("particle", suggestion("Particle", "Particle name.")),
    field("count", integer("Number of particles spawned.", { minimum: 0 })),
    field("offset", text("str", "Particle X, Y, Z spread.")),
    field("color", colorType("Particle RGB/hex color.")),
    field("size", decimal("Particle size.")),
    field("speed", decimal("Particle speed or extra data value.")),
    field("extra", decimal("Particle-specific extra data.")),
    field("force", boolean("Whether the particle is forced for distant clients."))
  ], "Particle display settings.");
  const particleEvent = nestedParticleEvent(particleDisplay);
  const particles = mapping(
    {
      kind: "suggestion",
      typeName: "BuildingParticleStage",
      allowCustom: true,
      description: "Building level or custom particle stage name."
    },
    particleEvent,
    "Optional particle displays grouped by level/stage and user-defined event path."
  );
  particles.optional = true;
  upsertFields(root, [field("particles", particles)]);
}

function nestedParticleEvent(particleDisplay, depth = 4) {
  const event = clone(particleDisplay);
  event.additionalKeyType = text("str", "User-defined particle lifecycle/event name.");
  if (depth > 0) {
    event.additionalProperties = nestedParticleEvent(particleDisplay, depth - 1);
  }

  return event;
}

function addMiscUpgradeSemantics(root) {
  if (root.kind !== "mapping") {
    return;
  }

  const base = root.values;

  if (base?.kind !== "object") {
    return;
  }

  upsertFields(base, [
    field("conditions", mapping(
      { kind: "expression", language: "condition" },
      text("Message", "Message shown when this upgrade condition is not met."),
      "Optional user-defined upgrade requirements. Both the condition and message are editable."
    )),
    field("levels", mapping(integer("Upgrade level."), { kind: "advanced", typeName: "any" }, "Optional level-specific settings.")),
    field("commands", {
      kind: "union",
      choices: [text("Command"), list(text("Command"))],
      description: "Optional command or commands associated with this upgrade."
    }),
    field("permissions", { kind: "set", elements: text("str", "Permission node."), description: "Optional permission nodes associated with this upgrade." })
  ]);
}

function addPowersSemantics(root) {
  const powerups = root.fields?.find((candidate) => candidate.key === "powerups")?.type;
  const powerup = powerups?.kind === "mapping" ? powerups.values : null;

  if (powerup?.kind !== "object") {
    return;
  }

  const conditions = mapping(
    { kind: "expression", language: "condition", description: "Condition that must be met before this powerup level is available." },
    text("Message", "Message shown when this condition is not met."),
    "Ordered powerup requirements. Both the condition and its message are editable."
  );
  conditions.optional = true;
  upsertFields(powerup, [field("conditions", conditions)]);
}

function addGuiSemantics(root, itemStack) {
  upsertFields(root, [
    field("type", suggestion("InventoryType", "Inventory type used when rows is omitted.")),
    field("open-conditions", mapping(
      { kind: "expression", language: "condition" },
      text("Message"),
      "Conditions checked when the GUI opens."
    )),
    field("forms", object([
      field("type", enumeration(["SIMPLE", "MODAL", "CUSTOM"], "Bedrock form type.")),
      field("title", text("Message", "Bedrock form title.")),
      field("body", text("Message", "Bedrock form body text.")),
      field("options", mapping(text(), object([
        field("text", text("Message", "Button, label, or component text."))
      ], "Bedrock form component with component-specific settings.", {
        additionalProperties: { kind: "advanced", typeName: "any" },
        additionalKeyType: text()
      }), "User-named Bedrock form buttons or components."))
    ], "Optional Geyser/Floodgate Bedrock form config."))
  ]);

  const options = root.fields.find((candidate) => candidate.key === "options")?.type;
  const optionType = options?.kind === "mapping" ? options.values : null;

  if (optionType?.kind !== "object") {
    return;
  }

  mergeObjectFields(optionType, itemStack);
  optionType.required = [];
  upsertFields(optionType, [
    field("condition", { kind: "expression", language: "condition", description: "Condition for this appearance variant." }),
    field("commands", {
      kind: "union",
      description: "One command or a list of commands executed when clicked.",
      choices: [text("Command"), list(text("Command"))]
    }),
    field("perform-action", boolean("Set false to keep a functional option decorative."))
  ]);

  const conditionalVariant = clone(optionType);
  conditionalVariant.additionalProperties = null;
  conditionalVariant.description = "A user-named conditional appearance. The name is arbitrary. The condition may be omitted for a fallback branch.";
  conditionalVariant.required = [];
  optionType.additionalProperties = conditionalVariant;
  optionType.additionalKeyType = text("str", "User-defined variant name, commonly a descriptive name or else.");
}

export function applyEditorSemantics(schema, schemaId = "", referenceSchemas = {}, defaultOptions = [], runtimeOptions = []) {
  const root = clone(schema);
  markCapabilityTree(root, "jar-schema");

  const itemStackSource = clone(referenceSchemas.ItemStack ?? (schemaId === "item-stack" ? schema : object([])));
  const itemMatcherSource = clone(referenceSchemas.ItemMatcher ?? (schemaId === "item-matcher" ? schema : object([])));
  markCapabilityTree(itemStackSource, "jar-schema");
  markCapabilityTree(itemMatcherSource, "jar-schema");
  const itemStack = createItemStackType(itemStackSource);
  const itemMatcher = createItemMatcherType(itemMatcherSource);

  if (schemaId === "item-stack") {
    replaceObject(root, itemStack);
  }

  if (schemaId === "item-matcher") {
    replaceObject(root, itemMatcher);
  }

  if (["Structures/structure", "Turrets/turret"].includes(schemaId)) {
    addBuildingSemantics(root);
  }

  if (schemaId === "misc-upgrades") {
    addMiscUpgradeSemantics(root);
  }

  if (schemaId === "powers") {
    addPowersSemantics(root);
  }

  if (schemaId === "guis/schema") {
    addGuiSemantics(root, itemStack);
  }

  const references = new Map(Object.entries(referenceSchemas).filter(([, value]) => value));
  references.set("ItemStack", itemStack);
  references.set("ItemMatcher", itemMatcher);

  const entity = clone(referenceSchemas.Entity ?? object([]));
  markCapabilityTree(entity, "jar-schema");
  references.set("Entity", entity);

  expandExtends(root, references);
  augmentSchemaWithDefaults(root, defaultOptions, schemaId, "jar-default");
  augmentSchemaWithDefaults(root, runtimeOptions, schemaId, "jar-runtime");

  for (const referenceType of references.values()) {
    attachReferences(referenceType, references);
  }

  attachReferences(root, references);

  applyKnownEnumTypes(root);

  for (const referenceType of references.values()) {
    applyKnownEnumTypes(referenceType);
  }

  applySchemaOverrides(root, schemaId);
  applyCommentTypes(root, schemaId, defaultOptions);
  makeExplicitOptionalFields(root);

  return root;
}

function applyCommentTypes(root, schemaId, defaultOptions) {
  applyDocumentedDurationTypes(root, defaultOptions);
  applyDocumentedExpressionTypes(root, defaultOptions, schemaId);
  applyDefaultNullTypes(root, defaultOptions);
  applyBooleanConditionTypes(root, defaultOptions);

  for (const override of editorOverrides.commentTypes) {
    if (override.schemaId !== schemaId) {
      continue;
    }

    replaceTypeAtPath(root, override.path, override.type);
  }
}

function applyDocumentedExpressionTypes(root, defaultOptions, schemaId) {
  if (schemaId === "language") {
    return;
  }

  for (const option of defaultOptions) {
    if (option.container || !looksLikeExpressionSetting(option)) {
      continue;
    }

    const current = typeAtSchemaPath(root, option.path);
    const scalar = dereference(current);

    if (!scalar || !["string", "integer", "decimal"].includes(scalar.kind)) {
      continue;
    }

    const path = option.path.join(".");
    const language = /(?:^|\.)(?:condition|conditions)(?:\.|$)/i.test(path) ? "condition" : "math";
    replaceTypeAtPath(root, option.path, {
      kind: "expression",
      language,
      description: scalar.description || option.comments?.join(" ") || (language === "condition"
        ? "Condition expression."
        : "Math formula.")
    });
  }
}

function looksLikeExpressionSetting(option) {
  const source = String(option.source).trim().replace(/^(['"])(.*)\1$/s, "$2");

  if (/^[*&]/.test(source)) {
    return false;
  }

  if (!/[-+*/%^<>]|&&|\|\||\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(source)) {
    return false;
  }

  if (/%[^%]+%|\{\$|https?:\/\//i.test(source)) {
    return false;
  }

  const path = option.path.join(".");
  const key = String(option.path.at(-1));
  const comments = option.comments?.join(" ") ?? "";
  const parentPath = option.path.slice(0, -1).join(".");

  if (/(?:^|\.)(?:condition|conditions)(?:\.|$)/i.test(parentPath) && !/^condition$/i.test(key)) {
    return false;
  }

  return /formula|equation|math/i.test(comments)
    || /(?:^|\.)(?:condition|conditions|build-duration)(?:\.|$)/i.test(path)
    || /^(?:cost|scaling|range|radius|damage|durability|capacity|factor|(?:[a-z]+-)?modifier|priority|refund|buy|sell|knockback|min-targets|champion-damage-(?:boost|reduction)|cooldown-per-item|teleport-fuel-cost|repair-armor|armor-damage)$/i.test(key);
}

function applyDefaultNullTypes(root, defaultOptions) {
  for (const option of defaultOptions) {
    if (option.container || !/^\s*(?:~|null)\s*$/i.test(String(option.source))) {
      continue;
    }

    const current = typeAtSchemaPath(root, option.path);

    if (!current || acceptsKind(current, "null")) {
      continue;
    }

    replaceTypeAtPath(root, option.path, {
      kind: "nullable",
      value: current,
      description: current.description || option.comments?.join(" ") || "Set to ~ to disable."
    });
  }
}

function applyBooleanConditionTypes(root, defaultOptions) {
  for (const option of defaultOptions) {
    if (option.container || !/^\s*(?:true|false)\s*$/i.test(String(option.source))) {
      continue;
    }

    const current = typeAtSchemaPath(root, option.path);
    const scalar = dereference(current);

    if (scalar?.kind !== "expression" || scalar.language !== "condition") {
      continue;
    }

    replaceTypeAtPath(root, option.path, {
      kind: "union",
      description: scalar.description || option.comments?.join(" ") || "Use a toggle or a condition.",
      choices: [
        { kind: "boolean", label: "Always on or off" },
        { ...scalar, label: "Condition" }
      ]
    });
  }
}

function acceptsKind(type, kind) {
  if (!type) {
    return false;
  }

  if (type.kind === kind) {
    return true;
  }

  if (type.kind === "nullable") {
    return kind === "null" || acceptsKind(type.value, kind);
  }

  return type.kind === "union" && type.choices?.some((choice) => acceptsKind(choice, kind));
}

function applyDocumentedDurationTypes(root, defaultOptions) {
  for (const option of defaultOptions) {
    if (option.container || !looksLikeDurationSetting(option)) {
      continue;
    }

    const current = typeAtSchemaPath(root, option.path);

    if (dereference(current)?.kind !== "string") {
      continue;
    }

    replaceTypeAtPath(root, option.path, {
      kind: "duration",
      description: current.description || option.comments?.join(" ") || "Kingdoms duration."
    });
  }
}

function looksLikeDurationSetting(option) {
  const source = String(option.source).trim().replace(/^(['"])(.*)\1$/s, "$2");

  if (!/^\d+\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?)$/i.test(source)) {
    return false;
  }

  const key = String(option.path.at(-1));
  const comments = option.comments?.join(" ") ?? "";

  return /duration|cooldown|interval|every|expire|expiration|age|update-rate|shield-damage|paralyze/i.test(key)
    || /duration|cooldown|time|seconds?|minutes?|hours?|days?/i.test(comments);
}

function typeAtSchemaPath(root, path) {
  let current = root;

  for (const segment of path) {
    current = dereference(current);
    if (!current || !["object", "mapping"].includes(current.kind)) {
      return null;
    }

    const child = current.fields?.find((candidate) => candidate.key === segment);
    current = child?.type ?? (current.kind === "mapping" ? current.values : current.additionalProperties);
  }

  return current;
}

function replaceTypeAtPath(root, path, replacement) {
  let current = root;

  for (const segment of path.slice(0, -1)) {
    current = dereference(current);
    if (!current || !["object", "mapping"].includes(current.kind)) {
      return;
    }

    const child = current.fields?.find((candidate) => candidate.key === segment);
    current = child?.type ?? (current.kind === "mapping" ? current.values : current.additionalProperties);
  }

  current = dereference(current);
  if (!current || !["object", "mapping"].includes(current.kind)) {
    return;
  }

  const child = current.fields?.find((candidate) => candidate.key === path.at(-1));

  if (!child) {
    return;
  }

  const next = clone(replacement);

  if (child.type?.optional) {
    next.optional = true;
  }

  addCapability(next, child.type?.capability ?? { sources: ["editor-overlay"] });
  markCapabilityTree(next, "editor-overlay");
  child.type = next;
}

function makeExplicitOptionalFields(type, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  if (type.kind === "object") {
    const required = new Set((type.required ?? []).map(String));

    for (const child of type.fields ?? []) {
      if (!required.has(child.key) && child.type.optional === undefined) {
        child.type.optional = true;
      }

      makeExplicitOptionalFields(child.type, seen);
    }

    makeExplicitOptionalFields(type.additionalProperties, seen);
  } else if (type.kind === "mapping") {
    type.fields?.forEach((child) => makeExplicitOptionalFields(child.type, seen));
    makeExplicitOptionalFields(type.keys, seen);
    makeExplicitOptionalFields(type.values, seen);
  } else if (type.kind === "union") {
    type.choices?.forEach((choice) => makeExplicitOptionalFields(choice, seen));
  } else if (["list", "set"].includes(type.kind)) {
    makeExplicitOptionalFields(type.elements, seen);
  } else if (type.kind === "nullable") {
    makeExplicitOptionalFields(type.value, seen);
  }
}

function makeObjectFieldsOptional(type, required = new Set()) {
  if (type.kind !== "object") {
    return;
  }

  for (const child of type.fields) {
    if (!required.has(child.key)) {
      child.type.optional = true;
    }
  }
}

function expandExtends(type, references, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  if (type.kind === "object") {
    for (const name of type.extends ?? []) {
      const inherited = references.get(name);

      if (inherited) {
        mergeObjectFields(type, inherited);
      }
    }

    type.fields?.forEach((child) => expandExtends(child.type, references, seen));
    expandExtends(type.additionalProperties, references, seen);
  } else if (type.kind === "mapping") {
    type.fields?.forEach((child) => expandExtends(child.type, references, seen));
    expandExtends(type.keys, references, seen);
    expandExtends(type.values, references, seen);
  } else if (type.kind === "union") {
    type.choices?.forEach((choice) => expandExtends(choice, references, seen));
  } else if (["list", "set"].includes(type.kind)) {
    expandExtends(type.elements, references, seen);
  } else if (type.kind === "nullable") {
    expandExtends(type.value, references, seen);
  }
}

function attachReferences(type, references, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  if (type.kind === "advanced" && references.has(type.typeName)) {
    const typeName = type.typeName;
    const description = type.description;

    for (const key of Object.keys(type)) {
      delete type[key];
    }

    Object.assign(type, { kind: "reference", typeName, target: references.get(typeName) });
    if (description) {
      type.description = description;
    }

    return;
  }

  if (type.kind === "reference") {
    type.target = references.get(type.typeName) ?? null;
    return;
  }

  if (type.kind === "object") {
    type.fields?.forEach((child) => attachReferences(child.type, references, seen));
    attachReferences(type.additionalProperties, references, seen);
  } else if (type.kind === "mapping") {
    type.fields?.forEach((child) => attachReferences(child.type, references, seen));
    attachReferences(type.keys, references, seen);
    attachReferences(type.values, references, seen);
  } else if (type.kind === "union") {
    type.choices?.forEach((choice) => attachReferences(choice, references, seen));
  } else if (["list", "set"].includes(type.kind)) {
    attachReferences(type.elements, references, seen);
  } else if (type.kind === "nullable") {
    attachReferences(type.value, references, seen);
  }
}

// Restore reference targets after loading to avoid JSON cycles
export function attachSchemaReferences(root, referenceSchemas = {}) {
  const references = new Map(
    Object.entries(referenceSchemas).filter(([, value]) => value && typeof value === "object")
  );

  for (const referenceType of references.values()) {
    attachReferences(referenceType, references);
  }

  attachReferences(root, references);
  return root;
}

function augmentSchemaWithDefaults(root, defaultOptions, schemaId, capabilitySource) {
  const ordered = [...defaultOptions].sort((left, right) => left.path.length - right.path.length);

  for (const option of ordered) {
    if (!option.path.length) {
      continue;
    }

    ensureDefaultPath(root, option.path, option, schemaId, capabilitySource);
  }
}

function ensureDefaultPath(root, path, option, schemaId, capabilitySource) {
  let current = root;

  for (let index = 0; index < path.length; index += 1) {
    current = dereference(current);
    if (!current || !["mapping", "object"].includes(current.kind)) {
      return;
    }

    const key = path[index];
    const last = index === path.length - 1;
    const dynamicKey = /^\{[^}]+}$/.test(key);

    if (dynamicKey && current.kind === "mapping") {
      const remaining = path.slice(index + 1);

      for (const namedField of current.fields ?? []) {
        ensureDefaultPath(namedField.type, remaining, option, schemaId, capabilitySource);
      }

      current = current.values;
      continue;
    }

    if (dynamicKey && current.kind === "object" && current.additionalProperties) {
      current = current.additionalProperties;
      continue;
    }

    let child = current.fields?.find((candidate) => candidate.key === key);

    if (!child && current.kind === "mapping") {
      const remaining = path.slice(index + 1);
      const sharedSupportsPath = remaining.length === 0 || hasPath(current.values, remaining);

      if (!sharedSupportsPath) {
        child = field(key, clone(current.values));
        (current.fields ??= []).push(child);
      } else {
        current = current.values;
        continue;
      }
    }

    if (!child && current.kind === "object" && current.additionalProperties) {
      current = current.additionalProperties;
      continue;
    }

    if (!child) {
      child = field(key, last ? inferredDefaultType(option, schemaId) : object([]));
      (current.fields ??= []).push(child);
    }

    if (last) {
      const description = option.comments?.join(" ");

      if (description && !child.type.description) {
        child.type.description = description;
      }

      addCapability(child.type, option.capability ?? { sources: [capabilitySource] });
      return;
    }

    current = child.type;
  }
}

function hasPath(type, path) {
  let current = type;

  for (const segment of path) {
    current = dereference(current);
    if (!current) {
      return false;
    }

    if (current.kind === "object") {
      const child = current.fields?.find((candidate) => candidate.key === segment);
      current = child?.type ?? current.additionalProperties;
    } else if (current.kind === "mapping") {
      const child = current.fields?.find((candidate) => candidate.key === segment);
      current = child?.type ?? current.values;
    } else {
      return false;
    }
  }

  return Boolean(current);
}

function inferredDefaultType(option, schemaId) {
  if (option.inferredType) {
    return clone(option.inferredType);
  }

  const description = option.comments?.join(" ") ?? "";

  if (option.container || option.emptyMapping) {
    return object([], description);
  }

  if (option.collectionItems) {
    return list(text(), description);
  }

  const source = String(option.source).trim();

  if (/^(?:true|false)$/i.test(source)) {
    return boolean(description);
  }

  if (/^[+-]?\d+$/.test(source)) {
    return integer(description);
  }

  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(source)) {
    return decimal(description);
  }

  if (/^\[.*]$/s.test(source)) {
    return list(text(), description);
  }

  if (schemaId === "language") {
    return text("Message", description);
  }

  return text("str", description);
}

function dereference(type) {
  let current = type;
  const seen = new Set();

  while (current && !seen.has(current) && ["nullable", "reference"].includes(current.kind)) {
    seen.add(current);
    current = current.kind === "nullable" ? current.value : current.target;
  }

  return current;
}

function upsertFields(type, fields) {
  if (type.kind !== "object") {
    return;
  }

  for (const next of fields) {
    const index = type.fields.findIndex((candidate) => candidate.key === next.key);

    if (index < 0) {
      type.fields.push(next);
    } else {
      type.fields[index] = next;
    }
  }
}

function mergeObjectFields(target, inherited) {
  if (target.kind !== "object" || inherited.kind !== "object") {
    return;
  }

  const ownKeys = new Set(target.fields.map((candidate) => candidate.key));

  for (const inheritedField of inherited.fields) {
    if (!ownKeys.has(inheritedField.key)) {
      target.fields.push(clone(inheritedField));
    }
  }
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, source);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
