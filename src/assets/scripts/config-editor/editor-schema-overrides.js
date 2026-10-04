import {
  BOSS_BAR_COLORS,
  BOSS_BAR_FLAGS,
  BOSS_BAR_STYLES,
  KINGDOM_COMMANDS,
  KINGDOM_PERMISSIONS
} from "./editor-values.js";
import { addCapability, markCapabilityTree } from "./editor-capabilities.js";
import { editorOverrides } from "./editor-overrides.js";
import { isExpandedMessageEntry, messageEntryType } from "./message-entry.js";

const overlay = (type) => addCapability(type, { sources: ["editor-overlay"] });
const text = (typeName = "str", description = "") => overlay({ kind: "string", typeName, description, optional: true });
const message = (description = "") => text("Message", description);
const boolean = (description = "") => overlay({ kind: "boolean", description, optional: true });
const integer = (description = "", extra = {}) => overlay({ kind: "integer", description, optional: true, ...extra });
const decimal = (description = "", extra = {}) => overlay({ kind: "decimal", description, optional: true, ...extra });
const duration = (description = "") => overlay({ kind: "duration", description, optional: true });
const expression = (description = "", language = "math") => overlay({
  kind: "expression",
  language,
  description,
  optional: true
});
const enumeration = (values, description = "", valueLabels = null) => overlay({
  kind: "enum",
  values: [...values],
  description,
  optional: true,
  ...(valueLabels ? { valueLabels: { ...valueLabels } } : {})
});
const suggestion = (typeName, values, description = "") => overlay({
  kind: "suggestion",
  typeName,
  values: [...values],
  allowCustom: true,
  description,
  optional: true
});
const nullable = (value, description = "") => overlay({
  kind: "nullable",
  value,
  description,
  optional: true
});
const list = (elements, description = "") => overlay({ kind: "list", elements, description, optional: true });
const mapping = (keys, values, description = "") => overlay({ kind: "mapping", keys, values, description, optional: true });
const object = (fields, description = "", extra = {}) => overlay({
  kind: "object",
  fields,
  description,
  optional: true,
  ...extra
});
const field = (key, type) => ({ key, type });
const reference = (typeName, description = "") => overlay({ kind: "reference", typeName, description, optional: true });

function rankPermissionType(includeMemberCopy = false) {
  return overlay({
    kind: "enum",
    typeName: "KingdomPermission",
    values: includeMemberCopy ? ["@MEMBER", ...KINGDOM_PERMISSIONS] : [...KINGDOM_PERMISSIONS],
    description: includeMemberCopy
      ? "Standard rank permission or @MEMBER to copy the member rank permissions."
      : "Standard rank permission."
  });
}

const guiSlots = () => overlay({
  kind: "union",
  typeName: "GuiSlots",
  description: "One inventory slot or a list of inventory slots.",
  optional: true,
  choices: [
    integer("One inventory slot.", { minimum: 0 }),
    list(integer("Inventory slot.", { minimum: 0 }), "Inventory slots used by this button.")
  ]
});

function discordSrvEmbedType() {
  return object([
    field("description", message("Main embed text. Required when using an embed instead of plain text.")),
    field("message", message("Plain-text Discord message. Use this OR embed fields under the same option.")),
    field("color", text("Color", "Embed color. Supports RGB and hexadecimal notations.")),
    field("thumbnail", text("str", "Small embed thumbnail image URL.")),
    field("image", text("str", "Large embed image URL. Kingdoms placeholders are supported.")),
    field("title", object([
      field("text", message("Title text.")),
      field("url", text("str", "Clickable URL for the title."))
    ], "Optional embed title.")),
    field("author", object([
      field("name", message("Author name.")),
      field("url", text("str", "Clickable URL for the author name.")),
      field("icon", text("str", "Small circular author icon URL."))
    ], "Optional embed author block.")),
    field("footer", object([
      field("text", message("Footer text.")),
      field("icon", text("str", "Small circular footer icon URL."))
    ], "Optional embed footer.")),
    field("fields", mapping(
      text("str", "Field title"),
      message("Field message"),
      "Named embed fields. Each key is a field title and each value is that field's message."
    ))
  ], DISCORD_EMBED_HELP, { required: [] });
}

const DISCORD_EMBED_HELP = [
  "DiscordSRV announcement message.",
  "Use a plain text string, or an embed object.",
  "Embed options: message (plain), title (text/url), description (required for embeds), thumbnail, image, color (RGB or hex), author (name/url/icon), footer (text/icon), fields (title → message).",
  "All text supports placeholders.",
  "Channel may be a Discord channel ID/name, $main, $console, or ~ to disable."
].join(" ");

const DISCORD_CHANNEL_HELP = [
  "DiscordSRV channel destination.",
  "Use the channel ID or the exact Discord channel name (case-insensitive).",
  "Special values: $main (DiscordSRV main chat), $console (DiscordSRV console channel).",
  "Set to ~ to disable. Reload with /k reload after changing."
].join(" ");

function discordSrvMessageType() {
  return {
    kind: "union",
    description: DISCORD_EMBED_HELP,
    optional: true,
    choices: [
      message("Plain DiscordSRV message text."),
      discordSrvEmbedType()
    ]
  };
}

const RELATION_ATTRIBUTE_HELP = [
  "Relation attribute block.",
  "Common optional keys: auto-revoke, ceasefire, donate, build, invade, interact, use, home, manage-turrets, manage-structures, limit, effects, customizable, show-holograms, fly, disabled-commands, national-automation, cost, pvp, conditions.",
  "Omit a key to keep the plugin default for that attribute."
].join(" ");

function relationAttributesType() {
  return object([
    field("color", message("Relation color code. Supports Minecraft colors, RGB, hex, and shared color variables.")),
    field("name", message("Optional player-facing relation name.")),
    field("auto-revoke", boolean("Automatically revoke this relation when its conditions fail.")),
    field("ceasefire", boolean("Whether these kingdoms treat each other as non-hostile.")),
    field("donate", boolean("Allow resource-point donations.")),
    field("build", boolean("Allow building in the other kingdom's land.")),
    field("invade", boolean("Allow invasions against this relation.")),
    field("interact", boolean("Allow interacting with blocks in the other kingdom's land.")),
    field("use", boolean("Allow using containers/doors and similar blocks.")),
    field("home", boolean("Allow using the other kingdom's home.")),
    field("manage-turrets", boolean("Allow managing turrets in the other kingdom's land.")),
    field("manage-structures", boolean("Allow managing structures in the other kingdom's land.")),
    field("turret-ceasefire", boolean("Whether turrets refuse to fire at this relation.")),
    field("limit", integer(
      "Maximum kingdoms that may hold this relation at once. Set to 0 or -1 for unlimited.",
      { minimum: -1 }
    )),
    field("effects", list(
      { kind: "advanced", typeName: "Potion", description: "Potion effect applied while in these lands." },
      "Potion effects activated when standing in lands covered by this relation."
    )),
    field("customizable", boolean("Whether kingdoms can change this attribute in settings. Defaults to true when omitted.")),
    field("show-holograms", boolean("Show relation holograms for this relationship.")),
    field("fly", boolean("Allow kingdom flight in the other land when kingdom fly is enabled.")),
    field("disabled-commands", list(text("str"), "Commands disabled while this relation applies.")),
    field("national-automation", boolean("Whether nation automation applies for this relation.")),
    field("cost", integer("Resource-point cost to request or keep this relation.", { minimum: 0 })),
    field("pvp", enumeration(
      ["disabled", "disallowed", "normal", "claimed", "unclaimed", "masswar", "territory", "relational", "conditional"],
      "Only used when the root pvp mode is relational."
    )),
    field("conditions", list(
      { kind: "expression", language: "condition", description: "Condition that must pass for this relation attribute set." },
      "Extra conditions required for this relation."
    ))
  ], RELATION_ATTRIBUTE_HELP, { required: [] });
}

const COMMAND_PROPERTY_HELP = [
  "Optional per-command properties.",
  "disabled (default false), cooldown (default 0), disabled-worlds (default []), show-in-help-page (default true), permission-default (OP, NOT_OP, EVERYONE, or NO_ONE)."
].join(" ");

function commandPropertiesType(existingFields = []) {
  const extras = [
    field("disabled", boolean("Disable this command entirely.")),
    field("cooldown", { kind: "duration", description: "Command cooldown. 0 disables the cooldown.", optional: true }),
    field("disabled-worlds", list(text("str", "World name"), "Worlds where this command cannot be used.")),
    field("show-in-help-page", boolean("Show this command in /k help.")),
    field("permission-default", enumeration(
      ["OP", "NOT_OP", "EVERYONE", "NO_ONE"],
      "Who receives the command permission by default."
    ))
  ];
  const byKey = new Map(existingFields.map((item) => [item.key, item]));

  for (const extra of extras) {
    if (!byKey.has(extra.key)) {
      byKey.set(extra.key, extra);
    }
  }

  return object([...byKey.values()], COMMAND_PROPERTY_HELP, { required: [] });
}

const MAP_ELEMENT_HELP = [
  "Map element appearance.",
  "Typical keys: icon, hover (lore lines), action (click command/action), item (material used in the GUI map)."
].join(" ");

const MAP_STRUCTURE_GROUP_HELP = [
  "Grouped map element for a land or structure type.",
  "Optional priority controls draw order when elements overlap.",
  "Relation variants (self, ally, truce, neutral, enemy, nation) use the map element shape below."
].join(" ");

const MAP_RELATION_VARIANT_KEYS = new Set([
  "self", "ally", "truce", "neutral", "enemy", "nation", "added", "failed", "wilderness"
]);

function mapElementType() {
  return object([
    field("icon", message("Formatted map character or symbol shown in chat maps.")),
    field("hover", {
      kind: "union",
      optional: true,
      description: "Hover lore shown on the map element.",
      choices: [list(message()), message()]
    }),
    field("action", text("str", "Click action or command template for this map element.")),
    field("item", object([
      field("material", text("Material", "Item material used when this element appears in the GUI map.")),
      field("name", message("Optional item name override.")),
      field("lore", {
        kind: "union",
        optional: true,
        description: "Optional item lore.",
        choices: [list(message()), message()]
      })
    ], "GUI map item appearance.", { required: [] }))
  ], MAP_ELEMENT_HELP, { required: [] });
}

function mapStructureGroupType() {
  return object([
    field("priority", integer("Optional draw priority when multiple structures overlap on the map.", { minimum: 0 }))
  ], MAP_STRUCTURE_GROUP_HELP, { required: [] });
}

const RANK_DEFINITION_HELP = [
  "Rank definition.",
  "max-claims: -1 is unlimited (new ranks copy the member rank when set to -1).",
  "material: use RANDOM for a random rank icon.",
  "permissions: start with @MEMBER to copy the member rank permissions."
].join(" ");

function rankDefinitionType(existing = object([])) {
  return mergeObjectFields(existing, [
    field("node", text("str", "Internal rank node id.")),
    field("name", message("Rank display name.")),
    field("color", message("Rank color code. Supports Minecraft colors, RGB, hex, and shared color variables.")),
    field("symbol", text("str", "Rank chat symbol.")),
    field("max-claims", integer("Maximum claims for this rank. -1 is unlimited.", { minimum: -1 })),
    field("material", {
      kind: "union",
      optional: true,
      description: "Rank icon material. Use RANDOM for a random material.",
      choices: [
        { kind: "suggestion", typeName: "Material", allowCustom: true, description: "Fixed rank icon material." },
        {
          kind: "literal",
          value: "RANDOM",
          label: "Random material",
          description: "Pick a random material."
        }
      ]
    }),
    field("priority", {
      kind: "expression",
      language: "math",
      optional: true,
      description: "Rank ordering equation. Lower priority numbers outrank higher ones."
    }),
    field("permissions", overlay({
      kind: "set",
      elements: rankPermissionType(true),
      description: "Rank permissions. Start with @MEMBER to inherit member permissions.",
      optional: true
    }))
  ], RANK_DEFINITION_HELP);
}

const INVASION_COMMAND_LIST_HELP = [
  "Invasion command restriction list.",
  "whitelist: true allows only listed commands, false blocks listed commands.",
  "Commands are matched by prefix without the leading slash."
].join(" ");

function invasionCommandSideType({ kingdomWide = false } = {}) {
  const fields = [
    field("whitelist", boolean("true = allow-list, false = block-list.")),
    field("list", list(text("str", "Command prefix"), "Commands matched by prefix (aliases should be listed too)."))
  ];

  if (kingdomWide) {
    fields.splice(1, 0, field("kingdom-wide", boolean("Apply this restriction to the entire kingdom, not only the invading player.")));
  }

  return object(fields, INVASION_COMMAND_LIST_HELP, { required: [] });
}

const BIOME_RULE_SET_HELP = [
  "Named biome claim rule set.",
  "Keys under biomes can be any label (for example default).",
  "World and biome names support String Matchers."
].join(" ");

function biomeRuleSetType(existing = object([])) {
  return mergeObjectFields(existing, [
    field("worlds", list(text("str", "World name or String Matcher."), "Worlds this rule set applies to.")),
    field("whitelist", boolean("true = only listed biomes are claimable, false = listed biomes are blocked.")),
    field("biomes", list(
      { kind: "suggestion", typeName: "Biome", allowCustom: true },
      "Biomes affected by this rule set."
    )),
    field("cost-factor", mapping(
      { kind: "suggestion", typeName: "Biome", allowCustom: true },
      integer("Claim cost factor for this biome.", { minimum: 0 }),
      "Optional per-biome cost factor used by %biome_cost_factor%."
    ))
  ], BIOME_RULE_SET_HELP);
}

const DEFAULT_FLAGS_HELP = [
  "Default flags for new players, kingdoms, or nations.",
  "Player flags: admin, pvp, spy, markers, sneak-mode.",
  "Kingdom/nation flags: public-home, open, permanent, hidden."
].join(" ");

const CHAT_CHANNEL_HELP = [
  "Chat channel definition.",
  "Optional keys include color, formats, admin-formats, recipients-condition, use-conditions, and ranged settings when the channel is ranged."
].join(" ");

function chatChannelType(existing = object([])) {
  const conditionalText = (description) => mapping(
    {
      kind: "expression",
      language: "condition",
      allowFallback: true,
      description: "A Kingdoms condition, or else for the optional fallback."
    },
    message("Output used when this condition matches."),
    description
  );
  const formatType = (description, conditionalDescription) => ({
    kind: "union",
    optional: true,
    description,
    choices: [message(), conditionalText(conditionalDescription)]
  });
  const fields = [
    field("color", message("Channel color code or theme token.")),
    field("formats", formatType(
      "One chat format or an ordered set of conditional formats.",
      "Conditional player chat formats, evaluated from top to bottom."
    )),
    field("admin-formats", formatType(
      "One admin format or an ordered set of conditional formats.",
      "Conditional console and Discord formats, evaluated from top to bottom."
    )),
    field("recipients-condition", {
      kind: "expression",
      language: "condition",
      optional: true,
      description: "Who receives messages in this channel."
    }),
    field("use-conditions", {
      kind: "union",
      optional: true,
      description: "One requirement or ordered conditions mapped to the message shown when that requirement fails.",
      choices: [
        { kind: "expression", language: "condition", description: "Condition required to talk in this channel." },
        conditionalText("Channel requirements and their denial messages, evaluated from top to bottom.")
      ]
    }),
    field("ranged", boolean("Whether this channel is distance-limited.")),
    field("ranged-bypass-prefix", text("str", "Prefix that bypasses ranged chat limits."))
  ];
  const channel = mergeObjectFields(existing, fields, CHAT_CHANNEL_HELP);

  for (const [key, description, conditionalDescription] of [
    ["formats", "One chat format or an ordered set of conditional formats.", "Conditional player chat formats, evaluated from top to bottom."],
    ["admin-formats", "One admin format or an ordered set of conditional formats.", "Conditional console and Discord formats, evaluated from top to bottom."]
  ]) {
    replaceChild(channel, key, formatType(description, conditionalDescription));
  }

  return channel;
}

const INDICATOR_LAND_HELP = [
  "Claim indicator visuals for one land type.",
  "Optional keys: corner-block, two-blocks, particles, send-messages-for-same-chunk-type."
].join(" ");

function claimIndicatorLandType(existing = object([])) {
  const land = mergeObjectFields(existing, [
    field("corner-block", text("Material", "Corner block material for this land type.")),
    field("two-blocks", boolean("Whether two blocks are used for the indicator pillar.")),
    field("particles", text("str", "Particle style or particle entry name.")),
    field("send-messages-for-same-chunk-type", boolean("Send enter/leave messages when moving between matching land types."))
  ], INDICATOR_LAND_HELP);

  const particles = fieldType(land, ["particles"]);

  if (particles?.kind === "object") {
    for (const direction of ["horizontal", "vertical"]) {
      const settings = fieldType(particles, [direction]);

      if (settings?.kind !== "object") {
        continue;
      }

      replaceChild(settings, "color", {
        kind: "advanced",
        typeName: "RgbColor",
        optional: true,
        description: "RGB particle color, with each red, green, and blue channel from 0 to 255."
      });
    }
  }

  return land;
}

const RESOURCE_FILTER_HELP = [
  "general-filters lore/enchants accept true (whitelist), false (blacklist), or ~ (ignore that filter)."
].join(" ");

const structuralCatalogBySchema = new Map([
  ["chat", [applyChatStructures]],
  ["language", [applyLanguageStructures]],
  ["relations", [applyRelationStructures]],
  ["config", [applyConfigStructures]],
  ["map", [applyMapStructures]],
  ["claims", [applyClaimsStructures]],
  ["resource-points", [applyResourcePointStructures]],
  ["protection-signs", [applyProtectionSignStructures]],
  ["champion-upgrades", [applyChampionStructures]],
  ["invasions", [applyInvasionStructures]],
  ["turrets", [(root) => applyCatalogLimits(root, "turrets")]],
  ["structures", [(root) => applyCatalogLimits(root, "structures")]],
  ["misc-upgrades", [applyMiscUpgradeStructures]],
  ["ranks", [applyRankStructures]],
  ["powers", [applyPowersStructures]],
  ["guis/schema", [applyGuiStructures]],
  ["addons/enginehub", [applyEngineHubStructures]],
  ["addons/maps/map", [applyAddonMapStructures]],
  ["addons/maps/marker", [applyAddonMapMarkerStructures]],
  ["addons/peace-treaties", [applyPeaceTreatyStructures]],
  ["Structures/structure", [(root) => applyBuildingInstanceStructures(root, "structure")]],
  ["Turrets/turret", [(root) => applyBuildingInstanceStructures(root, "turret")]],
  ["addons/outposts", [applyOutpostDataStructures]]
]);

export function applySchemaOverrides(root, schemaId = "") {
  if (!root || typeof root !== "object") {
    return root;
  }

  for (const applyPatch of structuralCatalogBySchema.get(schemaId) ?? []) {
    applyPatch(root);
  }

  normalizePresentationFields(root, schemaId);
  normalizeRegistryFields(root, schemaId);
  normalizeConditionalMappings(root);
  return root;
}

function normalizePresentationFields(root, schemaId) {
  if (schemaId === "language") {
    return;
  }

  walkSchemaFields(root, (named) => {
    const key = named.key.toLocaleLowerCase("en-US");

    if (key === "bossbar" || key.endsWith("-bossbar")) {
      normalizeBossBar(named.type);
    } else if (key === "scoreboard") {
      normalizeScoreboard(named.type);
    } else if (key === "titles") {
      normalizeTitles(named.type);
    }
  });
}

function normalizeBossBar(type) {
  for (const bossBar of objectChoices(type)) {
    replaceExistingChild(bossBar, "title", message("Formatted text shown on the boss bar."));
    replaceExistingChild(bossBar, "color", enumeration(BOSS_BAR_COLORS, "Boss bar color."));
    replaceExistingChild(bossBar, "style", enumeration(BOSS_BAR_STYLES, "Boss bar segment style."));
    replaceExistingChild(bossBar, "flags", list(
      enumeration(BOSS_BAR_FLAGS, "Boss bar display effect."),
      "Optional boss bar display effects."
    ));

    const stateColors = fieldType(bossBar, ["state-colors"]);

    for (const state of objectChoices(stateColors)) {
      for (const named of state.fields ?? []) {
        named.type = preserveCapability(named.type, enumeration(BOSS_BAR_COLORS, "Boss bar color for this state."));
      }
    }
  }
}

function normalizeScoreboard(type) {
  for (const scoreboard of objectChoices(type)) {
    replaceExistingChild(scoreboard, "title", message("Formatted scoreboard title."));
    const lines = fieldType(scoreboard, ["lines"]);

    if (!["list", "set"].includes(lines?.kind)) {
      continue;
    }

    replaceExistingChild(scoreboard, "lines", {
      ...lines,
      elements: message("Formatted scoreboard line.")
    });
  }
}

function normalizeTitles(type) {
  walkSchemaFields(type, (named) => {
    const key = named.key.toLocaleLowerCase("en-US");

    if (["title", "subtitle"].includes(key)) {
      named.type = preserveCapability(named.type, message(`Formatted ${key} text.`));
    } else if (["fade-in", "stay", "fade-out"].includes(key)) {
      named.type = preserveCapability(named.type, integer(
        "Duration in Minecraft ticks. 20 ticks equal 1 second.",
        { minimum: 0, suffix: "ticks" }
      ));
    }
  });
}

function objectChoices(type) {
  if (!type || typeof type !== "object") {
    return [];
  }

  if (type.kind === "reference") {
    return objectChoices(type.target);
  }

  if (type.kind === "nullable") {
    return objectChoices(type.value);
  }

  if (type.kind === "union") {
    return type.choices.flatMap(objectChoices);
  }

  return type.kind === "object" ? [type] : [];
}

function preserveCapability(original, replacement) {
  if (original?.capability) {
    addCapability(replacement, original.capability);
  }

  return replacement;
}

function replaceExistingChild(parent, key, type) {
  if (parent?.fields?.some((candidate) => candidate.key === key)) {
    replaceChild(parent, key, type);
  }
}

function normalizeRegistryFields(root, schemaId) {
  if (schemaId === "language") {
    return;
  }

  walkSchemaFields(root, (named, path) => {
    const key = named.key.toLocaleLowerCase("en-US");
    const parent = path.at(-2)?.toLocaleLowerCase("en-US") ?? "";

    if ((key === "material"
      || key === "corner-block"
      || key === "block"
      || key.endsWith("-block")
      || /^<material(?:-\d+)?>$/.test(key))
      && parent !== "trim") {
      named.type = registryScalar(named.type, "Material", "Minecraft material.");
    } else if (key === "sound" || key.endsWith("-sound")) {
      named.type = registryScalar(named.type, "Sound", "Spigot sound with optional volume, pitch, category, and seed.");
    } else if (key === "particle") {
      named.type = registryScalar(named.type, "Particle", "Spigot particle or a custom particle name.");
    } else if (key === "entity-type"
      || (key === "type" && path.some((segment) => /^(?:champions?|soldiers?|entities|nexus-guards)$/i.test(segment)))) {
      named.type = registryScalar(named.type, "EntityType", "Spigot entity type.");
    } else if (key === "biome") {
      named.type = registryScalar(named.type, "Biome", "Spigot biome.");
    }

    if (["flags", "item-flags"].includes(key)) {
      named.type = registryScalar(named.type, "ItemFlag", "Spigot item flag or ALL.");
      named.type = registrySequence(named.type, "ItemFlag", "Spigot item flags.");
    } else if (key === "biomes") {
      named.type = registrySequence(named.type, "Biome", "Spigot biomes.");
    } else if (key === "potion-protected-effects") {
      named.type = registrySequence(named.type, "PotionEffectType", "Spigot potion effect types.");
    } else if (["disabled-damages", "disabled-causes"].includes(key)) {
      named.type = registrySequence(named.type, "DamageCause", "Spigot entity damage causes.");
    } else if (key === "blacklisted-animals") {
      named.type = registrySequence(named.type, "AnimalEntityType", "Bukkit animal entity types.");
    } else if (["interact-blocks", "ignored-blocks", "accepted-materials"].includes(key)
      || (key === "blocks" && parent === "interactable")
      || (key === "list" && ["material", "blocks"].includes(parent))) {
      named.type = registrySequence(
        named.type,
        "StringMatcher<Material>",
        "Material names or material matchers."
      );
    } else if (key === "blocks" && path.length === 1) {
      named.type = registrySequence(named.type, "Material", "Spigot block materials.");
    } else if ((key === "list" && parent === "entities")
      || (["friendly", "others"].includes(key) && parent === "disallow-accidental-mob-damage")) {
      named.type = registrySequence(named.type, "EntityType", "Spigot entity types.");
    }

    if (key === "enchants" || key === "stored-enchants") {
      normalizeMappingRegistry(named.type, "keys", "Enchant");
    } else if (key === "patterns") {
      normalizeMappingRegistry(named.type, "keys", "PatternType");
      normalizeMappingRegistry(named.type, "values", "DyeColor");
    }
  });
}

function walkSchemaFields(type, visit, path = [], seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  if (type.kind === "reference") {
    walkSchemaFields(type.target, visit, path, seen);
    return;
  }

  if (type.kind === "object" || type.kind === "mapping") {
    for (const named of type.fields ?? []) {
      const childPath = [...path, named.key];
      visit(named, childPath);
      walkSchemaFields(named.type, visit, childPath, seen);
    }

    if (type.kind === "object") {
      walkSchemaFields(type.additionalProperties, visit, [...path, "*"], seen);
    } else {
      walkSchemaFields(type.values, visit, [...path, "*"], seen);
    }

    return;
  }

  if (type.kind === "union") {
    for (const choice of type.choices ?? []) {
      walkSchemaFields(choice, visit, path, seen);
    }

    return;
  }

  if (["list", "set"].includes(type.kind)) {
    walkSchemaFields(type.elements, visit, [...path, "[]"], seen);
  }

  if (type.kind === "nullable") {
    walkSchemaFields(type.value, visit, path, seen);
  }
}

function registryScalar(type, typeName, description) {
  if (!type || typeof type !== "object") {
    return type;
  }

  if (type.kind === "nullable") {
    type.value = registryScalar(type.value, typeName, description);
    return type;
  }

  if (type.kind === "union") {
    type.choices = type.choices.map((choice) => registryScalar(choice, typeName, description));
    return type;
  }

  if (!["string", "suggestion"].includes(type.kind)
    || !["", "str", typeName].includes(type.typeName ?? "")) {
    return type;
  }

  return {
    ...type,
    kind: "suggestion",
    typeName,
    allowCustom: true,
    description: type.description || description
  };
}

function registrySequence(type, typeName, description) {
  if (!type || typeof type !== "object") {
    return type;
  }

  if (type.kind === "union") {
    type.choices = type.choices.map((choice) => registrySequence(choice, typeName, description));
    return type;
  }

  if (!["list", "set"].includes(type.kind)) {
    return type;
  }

  type.elements = registryElement(type.elements, typeName);
  type.description ||= description;
  return type;
}

function registryElement(type, typeName) {
  if (typeName === "StringMatcher<Material>") {
    return {
      ...type,
      kind: "advanced",
      typeName,
      description: type?.description || "Material name or matcher."
    };
  }

  return registryScalar(type, typeName, `Spigot ${typeName}.`);
}

function normalizeMappingRegistry(type, side, typeName) {
  if (!type || typeof type !== "object") {
    return;
  }

  if (type.kind === "union") {
    for (const choice of type.choices ?? []) {
      normalizeMappingRegistry(choice, side, typeName);
    }

    return;
  }

  if (type.kind !== "mapping") {
    return;
  }

  type[side] = registryScalar(type[side], typeName, `Spigot ${typeName}.`);
}

function normalizeConditionalMappings(type, seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);

  if (type.kind === "reference") {
    normalizeConditionalMappings(type.target, seen);
    return;
  }

  if (type.kind === "mapping") {
    if (type.keys?.kind === "expression" && type.keys.language === "condition") {
      if (type.keys.allowFallback !== false) {
        type.keys.allowFallback = true;
        type.keys.description ||= "A Kingdoms condition, or else for the optional fallback.";
        type.required = (type.required ?? []).filter((key) => key !== "else");
        if (!type.required.length) {
          delete type.required;
        }

        type.description ||= "Conditional outputs evaluated from top to bottom.";
      }
    }

    for (const named of type.fields ?? []) {
      normalizeConditionalMappings(named.type, seen);
    }

    normalizeConditionalMappings(type.keys, seen);
    normalizeConditionalMappings(type.values, seen);
    return;
  }

  if (type.kind === "object") {
    for (const named of type.fields ?? []) {
      normalizeConditionalMappings(named.type, seen);
    }

    normalizeConditionalMappings(type.additionalProperties, seen);
    return;
  }

  if (type.kind === "union") {
    for (const choice of type.choices ?? []) {
      normalizeConditionalMappings(choice, seen);
    }

    return;
  }

  if (["list", "set"].includes(type.kind)) {
    normalizeConditionalMappings(type.elements, seen);
  }

  if (type.kind === "nullable") {
    normalizeConditionalMappings(type.value, seen);
  }
}

function spawnGroupType() {
  return object([
    field("amount", integer("How many entities spawn in this group.", { minimum: 0 })),
    field("type", text("EntityType", "Entity type for this spawn group.")),
    field("name", message("Display name for spawned entities.")),
    field("health", decimal("Optional health override for spawned entities."))
  ], "Spawn group used by soldier turrets and nexus-guards.", { required: [] });
}

function buildingPreviewStateType() {
  return object([
    field("type", {
      kind: "enum",
      typeName: "BuildingPreviewType",
      values: ["INFO", "ERROR"],
      description: "INFO allows placement. ERROR blocks placement while this preview state is active.",
      optional: true
    }),
    field("message", message("Language key or message shown for this preview state.")),
    field("color", text("Color", "RGBA preview tint.")),
    field("block", object([
      field("material", text("Material", "Fake block material shown during preview."))
    ], "Optional preview block override.", { required: [] }))
  ], "Placement preview state (ok, out-of-chunk, not-owned, wrong-schema, conflict, …).", { required: [] });
}

function disableSentinel(description) {
  return { kind: "null", description: description || "Disable with ~." };
}

function applyOutpostDataStructures(root) {
  const location = (description) => text(
    "Location",
    `${description} Use world,x,y,z,yaw,pitch, for example world,120.5,64,-32.5,90,0.`
  );
  const bossBar = object([
    field("title", message("Formatted boss bar title.")),
    field("color", enumeration(BOSS_BAR_COLORS, "Boss bar color.")),
    field("style", enumeration(BOSS_BAR_STYLES, "Boss bar segment style.")),
    field("flags", list(enumeration(BOSS_BAR_FLAGS, "Boss bar display effect."), "Optional boss bar display effects."))
  ], "Boss bar shown while the outpost event is active.", { required: [] });
  const rewards = object([
    field("resource-points", expression("Resource points awarded to the winner.")),
    field("money", expression("Money awarded to the winner.")),
    field("commands", list(text("Command", "Command run for the winner."), "Commands run for the winner.")),
    field("items", mapping(
      text("str", "Saved item index or custom item name."),
      reference("ItemStack", "Item awarded to the winner."),
      "Saved reward items. Entry names are preserved and may be numeric."
    ))
  ], "Rewards given to the outpost winner.", { required: ["resource-points", "money"] });
  const arenaMob = object([
    field("label", text("Message", "Optional player-facing name for this arena mob.")),
    field("max-spawn-count", integer("Maximum number alive at once.", { minimum: 1 })),
    field("spawn-interval", duration("Delay between arena mob spawns.")),
    field("spawn-location", location("Arena mob spawn location.")),
    field("damage-bonus", expression("Damage formula. The dmg variable contains the original damage.")),
    field("entity", reference("Entity", "Entity settings used to spawn this arena mob."))
  ], "One arena mob or boss definition.", { required: [] });
  const outpost = object([
    field("region", text("str", "WorldGuard region used as the outpost arena.")),
    field("spawn", location("Player spawn location.")),
    field("center", location("Reward and firework center location.")),
    field("cost", expression("Money entrance cost formula.")),
    field("resource-points-cost", expression("Resource-point entrance cost formula.")),
    field("max-participants", integer("Maximum event participants.", { minimum: 3 })),
    field("min-online-members", integer("Minimum online members required to join.", { minimum: 2 })),
    field("bossbar", bossBar),
    field("rewards", rewards),
    field("arena-mobs", mapping(
      text("str", "Saved arena mob index or custom label."),
      arenaMob,
      "Saved arena mobs. Entry names are preserved and may be numeric."
    ))
  ], "One configured Outposts addon arena.", { required: ["region", "spawn", "center", "rewards"] });
  const schema = mapping(
    text("str", "User-defined outpost name."),
    outpost,
    "Outpost arenas are listed here by name. KingdomsX adds them as they are configured, so there is no default file."
  );

  for (const key of Object.keys(root)) {
    delete root[key];
  }

  Object.assign(root, schema);
}

function applyAddonMapStructures(root) {
  root.fields = (root.fields ?? []).filter((named) => named.key !== "banner");

  const banners = fieldType(root, ["banners"]);

  if (banners?.kind === "object") {
    replaceChild(banners, "scaling", integer("Scale applied to generated kingdom and nation banner images.", { minimum: 1 }));
  }

  const icons = fieldType(root, ["icons"]);

  if (icons?.kind !== "mapping") {
    return;
  }

  const iconTypes = [icons.values, ...(icons.fields ?? []).map((named) => named.type)]
    .filter((type) => type?.kind === "object");

  for (const icon of iconTypes) {
    replaceChild(icon, "disabled", boolean("Disable this map icon."));
    const zoom = fieldType(icon, ["zoom"]);

    if (zoom?.kind === "object") {
      applyMapZoomRange(zoom);
    }
  }

  const home = fieldType(icons, ["home"]);

  if (home?.kind === "object") {
    replaceChild(home, "use-banner", enumeration(
      ["banner", "flag"],
      "Use the in-game Minecraft banner or the kingdom/nation image flag as this icon."
    ));
  }
}

function applyEngineHubStructures(root) {
  const schematics = fieldType(root, ["worldedit", "schematics"]);

  if (schematics?.kind === "object") {
    replaceChild(schematics, "default-save-format", schematicFormat(
      "Format used by /k admin schematic save. Leave automatic to use the newest format supported by the installed WorldEdit implementation."
    ));

    const loading = fieldType(schematics, ["loading-mechanism"]);

    if (loading?.kind === "object") {
      replaceChild(loading, "forced-format", schematicFormat(
        "Force a format while loading schematics, mainly for debugging. Leave automatic to let WorldEdit detect the format."
      ));
    }

    replaceChild(schematics, "force-extension", nullable(
      text("FileExtension", "File extension applied to saved schematics, such as schem or schematic."),
      "Force a schematic file extension. Leave automatic to apply only the compatibility fixes required by the installed WorldEdit implementation."
    ));
  }

  const worldguard = fieldType(root, ["worldguard"]);

  if (worldguard?.kind !== "object") {
    return;
  }

  replaceChild(worldguard, "protected-region-radius", integer(
    "Claim-protection radius around WorldGuard regions, measured in lands rather than blocks.",
    { minimum: 0 }
  ));
  replaceChild(worldguard, "keep-kingdoms-flight-with-flag", nullable(
    text("WorldGuardFlag", "WorldGuard flag that permits Kingdoms flight outside claimed land."),
    "WorldGuard flag that preserves Kingdoms flight. Leave disabled to turn this integration off."
  ));
}

function schematicFormat(description) {
  return nullable(
    enumeration(
      editorOverrides.documentedValues.worldEditSchematicFormats,
      "Documented WorldEdit or FAWE schematic format."
    ),
    description
  );
}

function applyAddonMapMarkerStructures(root) {
  const zoom = fieldType(root, ["zoom"]);

  if (zoom?.kind === "object") {
    applyMapZoomRange(zoom);
  }

  applyMapMarkerStyle(fieldType(root, ["fill"]), { opacity: true });
  applyMapMarkerStyle(fieldType(root, ["line"]));
  applyMapMarkerStyle(fieldType(root, ["invasion", "fill"]), { opacity: true });
  applyMapMarkerStyle(fieldType(root, ["invasion", "line"]));
}

function applyMapZoomRange(zoom) {
  replaceChild(zoom, "min", integer("Minimum visible zoom percentage. Use -1 for no minimum.", { minimum: -1, maximum: 100 }));
  replaceChild(zoom, "max", integer("Maximum visible zoom percentage. Use -1 for no maximum.", { minimum: -1, maximum: 100 }));
}

function applyMapMarkerStyle(style, { opacity = false } = {}) {
  if (style?.kind !== "object") {
    return;
  }

  if (opacity) {
    replaceChild(style, "opacity", integer("Marker opacity from 0 through 255.", { minimum: 0, maximum: 255 }));
  }

  replaceChild(style, "color", text("Color", "Six-digit RGB hexadecimal marker color."));
}

function applyPeaceTreatyStructures(root) {
  replaceChild(root, "min-terms", integer("Minimum selected terms required to send a contract.", { minimum: 1 }));
  replaceChild(root, "unfinished-contract-reminder", duration("Interval between reminders about unfinished contracts."));

  const terms = fieldType(root, ["terms"]);

  if (terms?.kind !== "mapping" || terms.values?.kind !== "object") {
    return;
  }

  const term = terms.values;
  const termName = () => suggestion(
    "PeaceTreatyTerm",
    editorOverrides.documentedValues.peaceTreatyTerms,
    "Bundled peace-treaty term name. Custom addon-provided term names remain available."
  );

  replaceChild(term, "terms", overlay({
    kind: "set",
    elements: termName(),
    description: "Sub-terms applied by this selectable contract term.",
    optional: true
  }));
  replaceChild(term, "condition", mapping(
    expression("Condition that prevents this term from being selected.", "condition"),
    text("MessageEntry", "Language message shown when the condition matches."),
    "Selection-blocking conditions and their language message entries."
  ));
  replaceChild(term, "gui", nullable(
    text("GuiPath", "GUI opened to configure sub-terms."),
    "GUI opened to configure sub-terms. Leave disabled when no input GUI is required."
  ));

  const options = fieldType(term, ["term-options"]);

  if (options?.kind !== "mapping" || options.values?.kind !== "object") {
    return;
  }

  options.keys = termName();
  replaceChild(options.values, "amount", overlay({
    kind: "union",
    description: "Use true to ask the proposer for an amount, or provide a fixed value or math formula.",
    optional: true,
    choices: [
      overlay({ kind: "literal", value: true, label: "Prompt the proposer", optional: true }),
      expression("Fixed amount or math formula.")
    ]
  }));
  replaceChild(options.values, "min", decimal("Minimum amount accepted from the proposer."));
  replaceChild(options.values, "max", decimal("Maximum amount accepted from the proposer."));
}

function applyChatStructures(root) {
  replaceChild(root, "direct-prefix", {
    kind: "union",
    description: "Prefix that starts a private message. Set to ~ to disable direct messages.",
    optional: true,
    choices: [
      text("str", "Direct-message prefix character or string."),
      { kind: "null", description: "Disable direct messages (~)." }
    ]
  });

  const showItem = fieldType(root, ["show-item"]);

  if (showItem?.kind === "object" && fieldType(showItem, ["empty"])) {
    replaceChild(showItem, "empty", message("Text shown when the player has no item in the target slot."));
  }

  const mainHand = fieldType(showItem, ["main-hand"]);

  if (mainHand?.kind === "object" && fieldType(mainHand, ["replace"])) {
    replaceChild(mainHand, "replace", mapping(
      text("str", "Chat marker replaced by the formatted item, such as [i]."),
      message("Replacement text. May define or reuse a YAML anchor."),
      "User-defined chat markers mapped to their item display text."
    ));
  }

  const discordsrv = fieldType(root, ["discordsrv"]);

  if (discordsrv?.kind === "object") {
    discordsrv.description = DISCORD_CHANNEL_HELP;
    replaceChild(discordsrv, "global-channel", {
      kind: "union",
      description: DISCORD_CHANNEL_HELP,
      optional: true,
      choices: [
        text("str", DISCORD_CHANNEL_HELP),
        { kind: "null", description: "Disable this DiscordSRV channel." }
      ]
    });
    replaceChild(discordsrv, "private-channel", {
      kind: "union",
      description: DISCORD_CHANNEL_HELP,
      optional: true,
      choices: [
        text("str", DISCORD_CHANNEL_HELP),
        { kind: "null", description: "Disable this DiscordSRV channel." }
      ]
    });

    const announcements = fieldType(discordsrv, ["announcements"]);

    if (announcements) {
      announcements.description = DISCORD_EMBED_HELP;
      walkObjects(announcements, (node) => {
        const messageField = node.fields?.find((candidate) => candidate.key === "message");
        const channelField = node.fields?.find((candidate) => candidate.key === "channel");

        if (!messageField || !channelField) {
          return;
        }

        if (messageField.type?.kind === "union") {
          return;
        }

        messageField.type = discordSrvMessageType();
        channelField.type = {
          kind: "union",
          description: DISCORD_CHANNEL_HELP,
          optional: true,
          choices: [
            text("str", DISCORD_CHANNEL_HELP),
            { kind: "null", description: "Disable this announcement channel." }
          ]
        };
        node.description = DISCORD_EMBED_HELP;
      });
    }
  }

  const channels = fieldType(root, ["channels"]);

  if (channels?.kind === "mapping" || channels?.kind === "object") {
    const values = channels.kind === "mapping" ? channels.values : channels.additionalProperties;

    if (values) {
      const next = chatChannelType(values);

      if (channels.kind === "mapping") {
        channels.values = next;
      } else {
        channels.additionalProperties = next;
      }
    }

    for (const named of channels.fields ?? []) {
      named.type = chatChannelType(named.type);
    }
  }

  const relationalPlaceholders = fieldType(root, ["global-channel", "relational-placeholders"]);

  if (relationalPlaceholders?.kind === "object") {
    replaceChild(relationalPlaceholders, "color", message("Default relation placeholder color."));
  }
}

function applyRelationStructures(root) {
  const relations = fieldType(root, ["relations"]);

  if (relations) {
    const template = relationAttributesType();

    if (relations.kind === "mapping") {
      relations.values = mergeObjectFields(relations.values ?? object([]), template.fields, RELATION_ATTRIBUTE_HELP);
    }

    if (relations.kind === "object") {
      if (relations.additionalProperties) {
        relations.additionalProperties = mergeObjectFields(relations.additionalProperties, template.fields, RELATION_ATTRIBUTE_HELP);
      }
    }

    for (const named of relations.fields ?? []) {
      named.type = mergeObjectFields(named.type, template.fields, RELATION_ATTRIBUTE_HELP);
    }
  }

  replaceChild(root, "pvp-advanced", {
    kind: "expression",
    language: "condition",
    optional: true,
    description: [
      "Custom PvP condition used when the root pvp mode is conditional, or as an extra rule otherwise.",
      "Primary context is the attacker. Secondary context is the victim.",
      "Special variables: ceasefire, can_fight (when pvp is not conditional)."
    ].join(" ")
  });
}

function applyProtectionSignStructures(root) {
  const description = "Protection-sign type definition. Codes should stay lowercase unless case-sensitive-codes is enabled.";
  const fields = [
    field("enabled", boolean("Whether this protection type can be used.")),
    field("displayname", message("Player-facing name for this protection type.")),
    field("codes", list(text("str", "Protection code"), "Lowercase sign codes that activate this type.")),
    field("lines", list(message(), "Sign lines written when this protection type is created."))
  ];
  const protectionType = (existing) => {
    const type = mergeObjectFields(existing, fields, description);
    replaceChild(type, "lines", list(message(), "Sign lines written when this protection type is created."));
    return type;
  };

  replaceChild(root, "lines", list(message(), "Sign lines written for the default protection type."));

  if (root.kind === "mapping") {
    root.values = protectionType(root.values ?? object([]));
    root.description = description;
  }

  if (root.kind === "object") {
    if (root.additionalProperties) {
      root.additionalProperties = protectionType(root.additionalProperties);
    }

    for (const key of ["everyone-in-kingdom", "everyone"]) {
      const named = root.fields?.find((candidate) => candidate.key === key);

      if (named?.type?.kind === "object") {
        named.type = protectionType(named.type);
      }
    }
  }
}

function applyChampionStructures(root) {
  const champions = fieldType(root, ["champions"]);

  if (champions) {
    replaceChild(champions, "default", text("str", "Default champion type id. Requires a restart to apply."));

    const championType = object([
      field("name", message("Champion type display name used in messages.")),
      field("cost", expression("Resource-point cost formula. Usually uses lvl.")),
      field("max-level", integer("Maximum equipment level.", { minimum: 1 })),
      field("base", object([
        field("type", text("EntityType", "Vanilla entity type for this champion.")),
        field("baby", boolean("Whether the champion spawns as a baby variant.")),
        field("name", message("Champion display name.")),
        field("mythicmob", text("str", "Optional MythicMobs mob id used instead of the vanilla champion entity. MM level follows equipment level."))
      ], "Champion entity definition. Do not set max health here. The health upgrade overrides it.", { required: [] })),
      field("levels", mapping(
        integer("Equipment level"),
        object([
          field("equipment", mapping(
            text("str", "Equipment slot such as main-hand, helmet, chestplate, leggings, boots"),
            object([
              field("item", { kind: "reference", typeName: "ItemStack", description: "Item worn or held in this slot." })
            ], "Equipment slot entry.", { required: [] }),
            "Equipment slots for this champion level."
          ))
        ], "Champion level definition.", { required: [] }),
        "Per-level champion equipment."
      ))
    ], "Champion type definition.", { required: [] });

    if (champions.kind === "mapping") {
      champions.values = mergeObjectFields(champions.values ?? object([]), championType.fields, championType.description);
      // The JAR marks these level names as entity definitions
      replaceChild(champions.values, "base", championType.fields.find((item) => item.key === "base").type);
      replaceChild(champions.values, "levels", championType.fields.find((item) => item.key === "levels").type);
    }

    for (const named of champions.fields ?? []) {
      if (named.key === "default") {
        continue;
      }

      if (named.type?.kind === "object" || named.type?.kind === "suggestion") {
        named.type = mergeObjectFields(
          named.type?.kind === "object" ? named.type : object([]),
          championType.fields,
          championType.description
        );
        replaceChild(named.type, "base", championType.fields.find((item) => item.key === "base").type);
        replaceChild(named.type, "levels", championType.fields.find((item) => item.key === "levels").type);
      }
    }
  }

  const upgradeOptionals = [
    field("enabled", boolean("Whether players can buy this champion upgrade.")),
    field("name", message("Optional upgrade name used in messages.")),
    field("cost", expression("Resource-point cost formula. Usually uses lvl.")),
    field("scaling", expression("Upgrade effect formula. Meaning depends on the upgrade.")),
    field("max-level", integer("Maximum purchasable level.", { minimum: 0 })),
    field("chance", expression("Activation chance formula for chance-based upgrades.")),
    field("cooldown", {
      kind: "union",
      optional: true,
      description: "Fixed ability cooldown or a formula that returns milliseconds.",
      choices: [duration("Fixed cooldown."), expression("Cooldown formula.")]
    }),
    field("radius", expression("Ability radius. Enter a number or formula.")),
    field("range", expression("Ability range formula.")),
    field("min-targets", expression("Minimum targets required before the ability activates.")),
    field("champion-damage-boost", expression("Damage multiplier or formula applied to the champion.")),
    field("champion-damage-reduction", expression("Incoming damage reduction formula for the champion.")),
    field("condition", {
      kind: "expression",
      language: "condition",
      optional: true,
      description: "Single condition required before this upgrade can be bought."
    }),
    field("conditions", mapping(
      { kind: "expression", language: "condition" },
      message("Message shown when the condition fails."),
      "Optional upgrade-tree requirements."
    ))
  ];

  for (const named of root.fields ?? []) {
    if (named.key === "champions") {
      continue;
    }

    if (named.type?.kind !== "object") {
      continue;
    }

    named.type = mergeObjectFields(named.type, upgradeOptionals, "Champion upgrade definition. Optional keys vary by upgrade.");
  }
}

function applyInvasionStructures(root) {
  replaceChild(root, "strength-comparison", {
    kind: "union",
    optional: true,
    description: "Blocks stronger kingdoms from enemying/invading weaker ones when the condition is true. Set to false to disable.",
    choices: [
      boolean("Set false to disable strength comparison."),
      {
        kind: "expression",
        language: "condition",
        description: "Condition evaluated with the invader/enemier as primary context and the target as secondary."
      }
    ]
  });

  const commands = fieldType(root, ["commands"]);

  if (commands?.kind === "object") {
    commands.description = "Invasion command restrictions and execute hooks.";
    replaceChild(commands, "invader", invasionCommandSideType({ kingdomWide: true }));
    replaceChild(commands, "defender", invasionCommandSideType());
  }

  const invasionItems = fieldType(root, ["items"]);

  if (invasionItems?.kind === "object") {
    replaceChild(invasionItems, "list", list(
      overlay({
        kind: "suggestion",
        typeName: "Material",
        allowCustom: false,
        description: "Spigot material blocked or allowed during invasions."
      }),
      "Materials controlled by the invasion item whitelist setting."
    ));
  }

  for (const state of ["capturing", "protected"]) {
    const particleState = fieldType(root, ["plunder", "particles", "states", state]);

    if (particleState?.kind !== "object") {
      continue;
    }

    replaceChild(particleState, "color", {
      kind: "advanced",
      typeName: "RgbColor",
      optional: true,
      description: "Particle color as red, green, and blue channels from 0 to 255."
    });
  }

  const countdown = fieldType(root, ["countdown"]);

  if (countdown?.kind === "object") {
    replaceChild(countdown, "sound", mapping(
      integer("Countdown second."),
      {
        kind: "union",
        optional: true,
        description: "Sound played at this countdown second. Set to ~ for silence.",
        choices: [
          text("Sound", "Minecraft or resource-pack sound with optional volume, pitch, category, and seed."),
          disableSentinel("Do not play a sound at this second (~).")
        ]
      },
      "Sounds played at user-defined countdown seconds."
    ));
  }

  const champions = fieldType(root, ["champions"]);

  if (champions?.kind === "object") {
    replaceChild(champions, "death-messages", mapping(
      {
        kind: "suggestion",
        typeName: "DamageCause",
        allowCustom: true,
        description: "Champion death cause, or defaults for the fallback messages."
      },
      list(message("Message announced when the champion dies from this cause."), "Possible messages for this death cause."),
      "Champion death messages grouped by damage cause. One matching message is chosen at random."
    ));
  }

  const rewardEntry = object([
    field("chance", decimal("Drop chance for this reward entry.")),
    field("chances", decimal("Alternate spelling of chance used by some default tiers.")),
    field("tries", integer("How many times this entry may roll.", { minimum: 1 })),
    field("display-name", message("Optional hologram or list display name.")),
    field("hologram", object([
      field("lines", list(message(), "Hologram lines shown above the reward chest."))
    ], "Optional reward hologram.", { required: [] })),
    field("item", object([
      field("material", text("Material", "Reward item material.")),
      field("amount", integer("Stack amount.", { minimum: 1 })),
      field("enchants", mapping(text("Enchant"), integer("Level"), "Enchantments.")),
      field("effects", list(text("str"), "Potion effect specs."))
    ], "Reward item definition.", { required: [] }))
  ], "Invasion chest reward entry. chance and chances are interchangeable.", { required: [] });

  const chestTier = mapping(
    text("str", "Chest tier id such as common or rare"),
    object([
      field("total", integer("How many chests of this tier may spawn.", { minimum: 0 })),
      field("chance", decimal("Chance for this tier to be selected.")),
      field("display-name", message("Tier display name.")),
      field("hologram", object([
        field("lines", list(message(), "Hologram lines shown above the reward chest."))
      ], "Optional chest hologram.", { required: [] })),
      field("content", mapping(
        text("str", "Reward entry id"),
        rewardEntry,
        "Reward rolls inside this chest tier."
      ))
    ], "Invasion reward chest tier.", { required: [] }),
    "Named chest tiers for invasion item rewards."
  );

  const itemRewards = object([
    field("enabled", boolean("Whether invasion win chests spawn at all.")),
    field("chance", decimal("Overall chance to spawn reward chests.")),
    field("total", integer("Maximum chests spawned for a win.", { minimum: 0 })),
    field("chests", chestTier)
  ], "Invasion win item-reward chests. Anyone can open spawned chests.", { required: [] });

  const bonus = fieldType(root, ["bonus"]);

  if (bonus?.kind === "object") {
    replaceChild(bonus, "item-rewards", itemRewards);
  } else {
    replaceChild(root, "bonus", object([
      field("resource-points", expression("Resource-point plunder formula.")),
      field("bank", expression("Bank plunder formula.")),
      field("item-rewards", itemRewards)
    ], "Invasion win bonuses.", { required: [] }));
  }

  const rewards = fieldType(root, ["bonus", "item-rewards"]);

  if (!rewards) {
    return;
  }

  walkObjects(rewards, (node) => {
    const looksLikeReward = node.fields?.some((candidate) =>
      ["item", "chance", "chances", "tries", "display-name", "hologram"].includes(candidate.key)
    );

    if (!looksLikeReward) {
      return;
    }

    const next = mergeObjectFields(node, rewardEntry.fields, rewardEntry.description);
    node.fields = next.fields;
    node.description = next.description;
  });
}

function applyCatalogLimits(root, schemaId = "") {
  // Limits only work at the root
  if (root.kind !== "object") {
    return;
  }

  const limits = object([
    field("total", expression("Kingdom-wide placement limit. Enter a static number or formula. 0, -1, or omission disables it.")),
    field("per-land", expression("Per-land placement limit. Enter a static number or formula. 0, -1, or omission disables it."))
  ], [
    "Optional placement limits for this catalog file.",
    "Set total/per-land to 0 or -1, or omit the key, to disable that limit.",
    "Individual Turrets/*.yml and Structures/*.yml entries may override these."
  ].join(" "));

  replaceChild(root, "limits", limits);

  if (schemaId !== "turrets") {
    return;
  }

  replaceChild(root, "manual-by-default", boolean(
    "Whether turrets start in manual mode. See the turret GUI description for manual vs automatic."
  ));
  replaceChild(root, "allow-targetting-npcs", boolean(
    "Whether turrets may damage NPCs (for example Citizens). Requires a restart."
  ));

  const particleDisplay = object([
    field("particle", text("Particle", "Spigot particle or custom particle name.")),
    field("count", integer("Number of particles spawned.", { minimum: 0 })),
    field("offset", text("str", "Particle X, Y, Z spread.")),
    field("color", text("Color", "Particle RGB/hex color.")),
    field("size", decimal("Particle size."))
  ], "Turret effect particle display.", { required: [] });

  const effects = mapping(
    text("str", "Effect name such as damage, paralysis, hypnosis, slowness, weakness"),
    object([
      field("sound", text("Sound", "Sound played when this effect triggers.")),
      field("particles", particleDisplay)
    ], "Turret hit effect.", { required: [] }),
    "Global turret hit effects. Keys are effect names used by turret damaging factors."
  );
  effects.creation = {
    entryLabel: "effect",
    starter: [
      { key: "sound", source: '""' },
      {
        key: "particles",
        children: [
          { key: "particle", source: '""' },
          { key: "count", source: "0" },
          { key: "offset", source: '""' },
          { key: "color", source: '""' },
          { key: "size", source: "0" }
        ]
      }
    ]
  };
  replaceChild(root, "effects", effects);
}

function applyMiscUpgradeStructures(root) {
  const permissionLevels = mapping(
    integer("Upgrade level"),
    object([
      field("previous", enumeration(
        ["", "remove"],
        "Choose whether permissions granted by the previous level remain active. An empty value behaves like omitting this field.",
        {
          "": "Disabled (keep previous permissions)",
          remove: "Remove previous permissions"
        }
      )),
      field("permissions", list(text("Permission", "Permission node granted at this level."), "Permission nodes granted at this level."))
    ], "Permissions granted at one upgrade level.", { required: [] }),
    "Permissions granted at each upgrade level."
  );
  const templateFields = [
    field("enabled", boolean("Whether players can buy this upgrade.")),
    field("cost", expression("Resource-point cost formula. Usually uses lvl.")),
    field("scaling", expression("Optional scaling formula for the gameplay effect.")),
    field("max-level", integer("Maximum purchasable level.", { minimum: 0 })),
    field("default-level", integer("Starting level for new kingdoms.", { minimum: 0 })),
    field("can-be-disabled", boolean("Whether kingdoms can turn this upgrade off after buying it.")),
    field("refresh-cooldown", expression("Optional cooldown formula between uses. Bracket fixed times, for example [1hr].")),
    field("condition", {
      kind: "expression",
      language: "condition",
      optional: true,
      description: "Single condition required before this upgrade can be bought."
    }),
    field("conditions", mapping(
      { kind: "expression", language: "condition" },
      message("Message shown when the condition fails."),
      "Optional upgrade-tree requirements."
    )),
    field("levels", mapping(integer("Level"), { kind: "advanced", typeName: "any" }, "Optional per-level overrides.")),
    field("permissions", permissionLevels),
    field("commands", mapping(
      text("str", "Trigger such as enabled or !enabled"),
      {
        kind: "union",
        choices: [text("Command"), list(text("Command"))],
        description: "Commands run when the upgrade is enabled or disabled."
      },
      "Optional commands tied to upgrade state."
    ))
  ];

  const nexusGuardLevels = mapping(
    integer("Upgrade level"),
    mapping(text("str", "Spawn group id"), spawnGroupType(), "Named spawn groups for this level."),
    "Nexus-guards spawn groups by level. Same shape as Turrets/soldier.yml soldiers."
  );

  const keepInventoryLevels = mapping(
    integer("Upgrade level"),
    object([
      field("armor", boolean("Whether armor is retained on death.")),
      field("main-hand", boolean("Whether the main-hand item is retained on death.")),
      field("off-hand", boolean("Whether the off-hand item is retained on death.")),
      field("hotbar", boolean("Whether hotbar items are retained on death.")),
      field("items", list({
        kind: "advanced",
        typeName: "StringMatcher<Material>",
        description: "Material matcher for an item retained on death."
      }, "Item material matchers retained on death.")),
      field("blacklisted-causes", list(
        { kind: "suggestion", typeName: "DamageCause", allowCustom: true },
        "Spigot damage causes where this keep-inventory level does not apply."
      ))
    ], "Items retained by this keep-inventory level.", { required: [] }),
    "Keep-inventory behavior by upgrade level."
  );

  if (root.kind === "mapping") {
    root.values = mergeObjectFields(root.values ?? object([]), templateFields, "Misc upgrade definition. Optional keys documented in the file comments can be added per upgrade.");
  }

  for (const named of root.fields ?? []) {
    if (named.type?.kind === "object") {
      named.type = mergeObjectFields(named.type, templateFields, "Misc upgrade definition.");
      if (["nexus-guards", "guards"].includes(named.key)) {
        replaceChild(named.type, "levels", nexusGuardLevels);
        replaceChild(named.type, "spawn-delay", integer("Seconds before nexus guards spawn.", { minimum: 0 }));
      }

      if (named.key === "keep-inventory") {
        replaceChild(named.type, "levels", keepInventoryLevels);
      }
    }
  }
}

function applyBuildingInstanceStructures(root, family) {
  const buildingTypes = family === "turret"
    ? ["arrow", "healing", "inferno", "soldier", "pressure_mine"]
    : ["nexus", "national-nexus", "extractor", "outpost", "powercell", "regulator", "siege-cannon", "warppad"];
  replaceChild(root, "name", message(`Formatted ${family} name shown to players.`));
  replaceChild(root, "type", enumeration(buildingTypes, `Built-in ${family} behavior.`));

  const durationOrEquation = (description) => ({
    kind: "union",
    optional: true,
    description,
    choices: [
      duration("Fixed Kingdoms duration."),
      { kind: "expression", language: "math", description: "Duration equation." }
    ]
  });
  const damaging = object([
    field("damage", expression("Damage applied to the building. Enter a number or formula.")),
    field("paralyze", durationOrEquation("Paralyze duration or equation.")),
    field("hypnotize", durationOrEquation("Hypnotize duration or equation.")),
    field("slowness", object([
      field("delay", durationOrEquation("Delay before slowness applies.")),
      field("duration", durationOrEquation("Slowness duration."))
    ], "Optional slowness effect.")),
    field("weakness", object([
      field("damage-reduction", expression("Damage reduction. Enter a number or formula.")),
      field("duration", durationOrEquation("Weakness duration."))
    ], "Optional weakness effect.")),
    field("allowed-range", list(decimal("Axis distance in blocks."), "Maximum X, Y, and Z distance as [x, y, z].")),
    field("distance", decimal("Distance-related modifier."))
  ], "Damaging-factor effects. Structures generally only honor damage. Turrets support the fuller set.");

  const damagingSource = mapping(text("str", "Effect or nested source"), {
    kind: "union",
    choices: [damaging, expression("Damage, effect duration, or other numeric formula.")]
  }, "Effect map for this damage source.");
  damagingSource.fields = cloneSchemaValue(damaging.fields);
  upsertObjectField(root, "damaging-factors", mapping(
    text("str", "Damage source name"),
    damagingSource,
    "Optional damaging-factor vocabulary documented in declarations/building.yml."
  ));

  upsertObjectField(root, "limits", object([
    field("total", expression("Override the global total placement limit with a static number or formula. 0, -1, or omission disables it.")),
    field("per-land", expression("Override the global per-land limit with a static number or formula. 0, -1, or omission disables it."))
  ], "Optional placement limits for this building type."));

  const entities = object([
    field("whitelist", boolean("true = only listed entities, false = all except listed.")),
    field("list", list(text("EntityType"), "Entity types affected by this turret."))
  ], "Optional entity filter. It is commented in default turret files. Add it when you need targeting limits.");
  upsertObjectField(root, "entities", entities);

  upsertObjectField(root, "hide-holograms", boolean(
    "Hide this building's holograms. Relation show-holograms still applies to other buildings."
  ));

  upsertObjectField(root, "preview", mapping(
    integer("Building level"),
    mapping(
      text("str", "Preview state such as ok, out-of-chunk, not-owned, wrong-schema, conflict"),
      buildingPreviewStateType(),
      "Preview states for this level."
    ),
    "Placement preview visuals by level and state."
  ));

  const blockLevels = fieldType(root, ["block"]);

  if (blockLevels?.kind === "object") {
    replaceChild(root, "block", mapping(
      integer("Building level"),
      text("Material", "Block material used at this level."),
      "Block material used at each building level."
    ));
  }

  const projectileLevels = fieldType(root, ["projectile"]);

  if (projectileLevels?.kind === "mapping") {
    projectileLevels.values = registryScalar(
      projectileLevels.values,
      "EntityType",
      "Projectile entity type used at this level."
    );
    for (const named of projectileLevels.fields ?? []) {
      named.type = registryScalar(named.type, "EntityType", "Projectile entity type used at this level.");
    }
  }

  for (const [key, description] of [
    ["effects", "Configured effects, or ~ to disable effects for this building."],
    ["particle", "Projectile particle, or ~ to disable it."],
    ["projectile", "Projectile types by level, or ~ when this building has no projectile."]
  ]) {
    const current = fieldType(root, [key]);

    if (!current || current.kind === "nullable") {
      continue;
    }

    replaceChild(root, key, {
      kind: "nullable",
      value: current,
      description,
      optional: true
    });
  }

  upsertObjectField(root, "repair", object([
    field("cost", expression("Resource-point cost formula for a full repair.")),
    field("materials", mapping(
      text("str", "Material repair entry id"),
      object([
        field("amount", integer("Durability restored by one matching item.", { minimum: 0 })),
        field("item", { kind: "reference", typeName: "ItemMatcher", description: "Item matcher for instant repair drops." })
      ], "Instant repair material.", { required: [] }),
      "Items players can drop near the building for instant repairs."
    ))
  ], "Repair cost and instant material repairs.", { required: [] }));

  upsertObjectField(root, "build-duration", object([
    field("opening", expression("Construction-time formula. Bracket fixed times, for example [1min].")),
    field("upgrading", expression("Upgrade-time formula. Bracket fixed times, for example [1min].")),
    field("repairing", expression("Repair-time formula. Bracket fixed times, for example [1sec].")),
    field("demolishing", expression("Demolition-time formula. Bracket fixed times, for example [50ms]."))
  ], "Build times are formulas that return milliseconds. Fixed times inside them use brackets, for example [1min].", { required: [] }));

  upsertObjectField(root, "markers", mapping(
    integer("Building level"),
    mapping(
      text("str", "Construction stage such as opening, upgrading, repairing, demolishing"),
      object([
        field("progress", text("Color", "RGBA border color while construction progresses.")),
        field("paused", text("Color", "RGBA border color while construction is paused."))
      ], "Marker colors for this construction stage.", { required: [] }),
      "Marker colors by construction stage."
    ),
    "Border marker colors during construction, keyed by level then stage."
  ));

  upsertObjectField(root, "schema", mapping(
    integer("Building level"),
    object([
      field("origin", list(integer("XZ origin coordinate"), "XZ center of the pattern as [x, z].")),
      field("blocks", mapping(
        text("str", "Relative Y layer, often -1 for the layer under the click point"),
        text("str", "Multiline block pattern. x means any. Other symbols need mappings."),
        "Block pattern layers keyed by relative Y."
      )),
      field("mappings", mapping(
        text("str", "Pattern symbol"),
        object([
          field("displayname", message("Short name shown for schema errors.")),
          field("mismatch-message", message("Message when the placed block does not match this symbol.")),
          field("accepted-materials", list(
            text("str", "Material or REGEX: matcher"),
            "Blocks accepted for this symbol."
          ))
        ], "Symbol mapping for the placement schema.", { required: [] }),
        "Maps pattern symbols to accepted materials."
      ))
    ], "Placement schema for this level.", { required: [] }),
    "Interactive placement schemas. Players must match the pattern before the building can be placed."
  ));

  upsertObjectField(root, "soldiers", mapping(
    integer("Building level"),
    mapping(text("str", "Group id"), spawnGroupType(), "Named spawn groups for this level."),
    "Soldiers spawned by soldier turrets, keyed by level then group."
  ));

  const fuelVariant = object([
    field("material", text("Material", "Fuel item material.")),
    field("fill-amount-per-item", decimal("Fuel added per matching item.")),
    field("name", { kind: "advanced", typeName: "StringMatcher", description: "Optional name matcher." }),
    field("lore", { kind: "advanced", typeName: "StringMatcher", description: "Optional lore matcher." }),
    field("nbt", mapping(text(), { kind: "advanced", typeName: "StringMatcher" }, "Optional NBT matchers."))
  ], "Fuel variant. Uses ItemMatcher fields plus fill-amount-per-item.", { required: [] });

  upsertObjectField(root, "fuel", object([
    field("enabled", boolean("Whether this building consumes fuel.")),
    field("capacity", expression("Fuel capacity formula. Usually uses lvl.")),
    field("allow-hoppers", boolean("Whether hoppers may insert fuel.")),
    field("variants", mapping(
      text("str", "Fuel variant id"),
      fuelVariant,
      "Accepted fuel items and how much each fills."
    ))
  ], "Fuel settings shared by extractors and warp pads.", { required: [] }));

  upsertObjectField(root, "generator", mapping(
    integer("Building level"),
    object([
      field("amount", decimal("Resource points generated each tick.")),
      field("fuel", decimal("Fuel consumed each tick.")),
      field("every", text("str", "Interval between generations. Also affects MANUAL hologram updates."))
    ], "Per-level generator settings.", { required: [] }),
    "Extractor-style resource generator by level."
  ));

  upsertObjectField(root, "teleport-fuel-cost", expression("Warp-pad fuel cost formula. The distance variable is the block distance to the destination."));
  upsertObjectField(root, "other-world-distance-factor", decimal(
    "Distance value used when the warp target is in another world."
  ));

  const existingBuilding = fieldType(root, ["building"]);

  if (existingBuilding?.kind === "object") {
    const firstLevel = existingBuilding.fields?.find((candidate) =>
      candidate.key === "1" && candidate.type?.kind === "object"
    )?.type ?? existingBuilding.fields?.find((candidate) => candidate.type?.kind === "object")?.type;

    replaceChild(root, "building", mapping(
      integer("Building level"),
      cloneSchemaValue(firstLevel ?? object([])),
      "Appearance and behavior for each user-defined building level."
    ));
  }

  const building = fieldType(root, ["building"]);

  if (building?.kind === "mapping") {
    const functionalPoints = mapping(
      text("str", "Relative block coordinate such as 0, 0, 0."),
      list(
        object([
          field("type", enumeration(["activation", "interaction", "manual"], "How this functional point is used.")),
          field("name", text("str", "Optional point name."))
        ], "Building functional point.", { required: [] }),
        "Functions available at this coordinate."
      ),
      "Functional points keyed by relative block coordinate."
    );
    const holograms = mapping(
      text("str", "Building state such as main, opening, upgrading, demolishing, or repairing."),
      mapping(
        text("str", "Hologram id."),
        object([
          field("lines", list(message(), "Hologram lines.")),
          field("height", decimal("Hologram height.")),
          field("offset", text("str", "XYZ offset.")),
          field("background-color", text("Color", "Optional hologram background color."))
        ], "Hologram settings.", { required: [] }),
        "Named holograms shown in this state."
      ),
      "Holograms shown for each building state."
    );
    const levelFields = object([
      field("functional-points", functionalPoints),
      field("holograms", holograms)
    ], "Building level settings. Functional points and hologram keys may be omitted.");

    building.values = mergeObjectFields(building.values, levelFields.fields, levelFields.description);
    replaceChild(building.values, "functional-points", functionalPoints);
    replaceChild(building.values, "holograms", holograms);
  }

  upsertObjectField(root, "projectiles", mapping(
    text("str", "Projectile id"),
    object([
      field("name", message("Ammo tier display name.")),
      field("shield-damage", durationOrEquation("Shield time removed. Duration or equation.")),
      field("explosion-radius", decimal("Added explosion radius.")),
      field("damage", decimal("Added player damage.")),
      field("knockback", decimal("Added knockback.")),
      field("building-impact", object([
        field("damage", decimal("Damage dealt to buildings.")),
        field("paralyze", durationOrEquation("Paralyze duration applied to buildings."))
      ], "Extra building damage effects.")),
      field("item", { kind: "reference", typeName: "ItemMatcher", description: "Item matcher for this ammo type." })
    ], "Siege cannon projectile. Values add to the cannon's base stats.", { required: [] }),
    "Siege cannon ammo definitions keyed by projectile id."
  ));

  upsertObjectField(root, "allow-damaging", mapping(
    integer("Cannon level"),
    object([
      field("others", {
        kind: "union",
        optional: true,
        description: "Blocks that can be damaged. * disables normal block damage.",
        choices: [
          {
            kind: "literal",
            value: "*",
            label: "No ordinary block damage",
            description: "Disable damage to ordinary blocks."
          },
          list(text("Material"), "Whitelist of block materials."),
          boolean("true = damage all ordinary blocks.")
        ]
      }),
      field("turrets", boolean("Whether turrets can be damaged.")),
      field("structures", {
        kind: "union",
        optional: true,
        description: "Whether structures can be damaged.",
        choices: [
          boolean(),
          list(text("str", "Structure type id"), "Specific structure types.")
        ]
      }),
      field("protected-chests", boolean("Whether protected chests can be damaged.")),
      field("protected-blocks", boolean("Whether protected blocks can be damaged."))
    ], "Per-level block damage rules for siege cannons.", { required: [] }),
    "Siege cannon allow-damaging rules per cannon level."
  ));

  upsertObjectField(root, "stocks", mapping(
    text("str", "Stock entry id (referenced as stock-<id> in the outpost GUI)"),
    object([
      field("buy", expression("Buy price formula. The stock variable is the current server-wide stock.")),
      field("sell", expression("Sell price formula. The stock variable is the current server-wide stock.")),
      field("stock", object([
        field("initial", integer("Permanent starting stock.", { minimum: 0 })),
        field("max", integer("Maximum stock cap.", { minimum: 0 })),
        field("min", integer("Minimum stock floor.", { minimum: 0 }))
      ], "Server-wide stock limits for this item.")),
      field("item", { kind: "reference", typeName: "ItemMatcher", description: "Item given when purchased." }),
      field("purchase-limit", object([
        field("cooldown-per-item", expression("Cooldown added per purchased item. The formula returns milliseconds, so bracket fixed times such as [6hr].")),
        field("max-cooldown", duration("Maximum accumulated purchase cooldown."))
      ], "Optional per-kingdom purchase cooldown."))
    ], "Outpost stock market entry.", { required: [] }),
    "Outpost stock entries. Item keys are referenced in the outpost GUI as stock-<id>."
  ));
}

function upsertObjectField(root, key, type) {
  if (!root || typeof root !== "object") {
    return;
  }

  if (root.kind === "object") {
    replaceChild(root, key, type);
    return;
  }

  if (root.kind === "mapping" && root.values?.kind === "object") {
    replaceChild(root.values, key, type);
  }
}

function applyConfigStructures(root) {
  const conditionMessages = (description) => mapping(
    {
      ...expression("Condition that triggers its mapped message.", "condition"),
      allowFallback: false
    },
    message("Message shown when this condition matches."),
    description
  );

  walkSchemaFields(root, (named) => {
    if (named.key !== "other-conditions") {
      return;
    }

    named.type = preserveCapability(named.type, conditionMessages(
      "Extra conditional messages. Edit each condition on the left and the message shown when it matches on the right."
    ));
  });

  const databaseProperties = fieldType(root, ["database", "properties"]);

  if (databaseProperties?.kind === "mapping") {
    databaseProperties.values = {
      ...databaseProperties.values,
      valueLabel: "Property value",
      description: "Value passed to the database connection as an additional property."
    };
  }

  const privateKingdoms = fieldType(root, ["private-kingdoms"]);

  if (privateKingdoms?.kind === "object") {
    replaceChild(privateKingdoms, "items", list(
      text("Material", "Spigot material used in place of the nexus."),
      "Materials that prompt a player to create a private-kingdom camp when placed."
    ));
  }

  const automaticTags = fieldType(root, ["tags", "attempt-automatic-setting"]);

  if (automaticTags?.kind === "mapping" && automaticTags.values?.kind === "object") {
    replaceChild(automaticTags.values, "count", text(
      "NumberMatcher",
      "Number matcher that limits how many characters this automatic tag rule may use, for example 3 <= x <= 5."
    ));
  }

  const placeholderFormats = fieldType(root, ["placeholders", "formats"]);
  const placeholders = fieldType(root, ["placeholders"]);

  if (placeholderFormats && placeholders?.kind === "object") {
    replaceChild(placeholders, "formats", mapping(
      text("str", "Placeholder format modifier id."),
      {
        kind: "union",
        optional: true,
        description: "A format can use one value for every result or separate normal and default values.",
        choices: [
          text("str", "Format applied to normal and default values."),
          object([
            field("apply", list(
              text("str", "Another format modifier id."),
              "Extra modifiers applied in order when the normal value is used."
            )),
            field("normal", text("str", "Format used when the placeholder has a value.")),
            field("default", text("str", "Format used when the placeholder falls back to its default."))
          ], "Normal and fallback placeholder formats.", { required: [] })
        ]
      },
      "User-defined placeholder format modifiers."
    ));
  }

  const placeholderVariables = fieldType(root, ["placeholders", "variables"]);

  if (placeholderVariables?.kind === "mapping") {
    const variableText = {
      ...message("Formatted macro text. Supports colors, placeholders, and other non-recursive variables."),
      label: "Formatted text"
    };
    const conditionalText = {
      ...mapping(
        {
          ...expression("Condition checked before using its mapped text.", "condition"),
          allowFallback: true,
          description: "A Kingdoms condition, or else for the optional fallback."
        },
        message("Formatted text used when this condition matches."),
        "Conditional macro text evaluated from top to bottom."
      ),
      label: "Conditional text"
    };
    const variableValue = overlay({
      kind: "union",
      optional: true,
      description: "A variable can be formatted text or an ordered condition-to-text mapping.",
      choices: [variableText, conditionalText]
    });
    placeholderVariables.values = preserveCapability(
      placeholderVariables.values,
      cloneSchemaValue(variableValue)
    );
    for (const named of placeholderVariables.fields ?? []) {
      named.type = preserveCapability(named.type, cloneSchemaValue(variableValue));
    }
  }

  const topKingdomTypes = fieldType(root, ["top-kingdoms", "types"]);
  const topNations = fieldType(root, ["top-nations"]);

  if (topKingdomTypes?.kind === "mapping" && topNations?.kind === "object") {
    const nationTypes = cloneSchemaValue(topKingdomTypes);
    nationTypes.description = "User-defined nation leaderboard types.";
    replaceChild(topNations, "types", nationTypes);
  }

  const commands = fieldType(root, ["commands"]);

  if (commands?.kind === "mapping") {
    commands.description = "Per-command disable, cooldown, and world restrictions. Command names and aliases are edited in the language file.";
    commands.keys = {
      kind: "suggestion",
      typeName: "KingdomCommand",
      values: [...KINGDOM_COMMANDS],
      allowCustom: true,
      description: "Kingdoms command node ID."
    };
    const nextValues = commandPropertiesType(commands.values?.fields ?? []);
    commands.values = nextValues;
    commands.values.description = COMMAND_PROPERTY_HELP;
  } else if (commands) {
    walkObjects(commands, (node) => {
      const looksLikeCommand = node.fields?.some((candidate) =>
        ["usage", "permission", "aliases", "description"].includes(candidate.key)
      );

      if (!looksLikeCommand) {
        return;
      }

      const next = commandPropertiesType(node.fields ?? []);
      node.fields = next.fields;
      if (!node.description) {
        node.description = COMMAND_PROPERTY_HELP;
      }
    });
  }

  const defaultFlags = fieldType(root, ["default-flags"]);

  if (defaultFlags?.kind === "object") {
    defaultFlags.description = DEFAULT_FLAGS_HELP;
    const playerFlags = [
      field("admin", boolean("Default /k admin mode for new players.")),
      field("pvp", boolean("Default /k pvp for new players.")),
      field("spy", boolean("Default /k admin spy for new players.")),
      field("markers", boolean("Default /k visualize toggle for new players.")),
      field("sneak-mode", boolean("Default /k admin sneak for new players."))
    ];
    const groupFlags = [
      field("public-home", boolean("Whether outsiders can /k home to this kingdom or nation.")),
      field("open", boolean("Whether join requires an invite.")),
      field("permanent", boolean("Immune to inactivity disband.")),
      field("hidden", boolean("Hidden from online maps and /k map."))
    ];

    for (const named of defaultFlags.fields ?? []) {
      if (named.key === "players") {
        named.type = mergeObjectFields(named.type, playerFlags, "Default player flags.");
      }

      if (named.key === "kingdoms" || named.key === "nations") {
        named.type = mergeObjectFields(named.type, groupFlags, `Default ${named.key} flags.`);
      }
    }
  }

  const syncGuis = fieldType(root, ["updates", "synchronize-guis"]);

  if (syncGuis?.kind === "object") {
    replaceChild(syncGuis, "reference-language", {
      kind: "union",
      optional: true,
      description: "Language used to synchronize GUI layouts on startup and /k reload. Set to ~ to disable.",
      choices: [
        text("str", "Language code such as en."),
        disableSentinel("Disable GUI language synchronization (~).")
      ]
    });
  }

  const hammer = fieldType(root, ["building-visuals", "hammer-animation"]);

  if (hammer?.kind === "object") {
    replaceChild(hammer, "particle", {
      kind: "union",
      optional: true,
      description: "Particle shown when the build hammer hits. AUTO matches the hit block dust. Set to ~ to disable.",
      choices: [
        {
          kind: "literal",
          value: "AUTO",
          label: "AUTO",
          description: "Automatically use the hit block's dust particle."
        },
        text("str", "Custom particle name."),
        disableSentinel("Disable hammer particles (~).")
      ]
    });
    replaceChild(hammer, "sound", {
      kind: "union",
      optional: true,
      description: "Sound played when the build hammer hits. Set to ~ to disable.",
      choices: [
        { kind: "suggestion", typeName: "Sound", allowCustom: true, description: "Hammer hit sound." },
        disableSentinel("Disable hammer sound (~).")
      ]
    });
  }

  const hologramUpdate = fieldType(root, ["building-visuals", "holograms", "update"]);

  if (hologramUpdate?.kind === "object") {
    replaceChild(hologramUpdate, "method", {
      kind: "enum",
      typeName: "HologramUpdateMethod",
      values: ["MANUAL", "AUTOMATIC"],
      optional: true,
      description: "MANUAL updates holograms only when signaled (most performant). AUTOMATIC refreshes on interval."
    });
  }

  const database = fieldType(root, ["database"]);

  if (database?.kind === "object") {
    replaceChild(database, "method", {
      kind: "enum",
      typeName: "DatabaseMethod",
      values: ["PostgreSQL", "MariaDB", "MySQL", "MongoDB", "H2", "SQLite", "YAML", "JSON"],
      optional: true,
      description: "How Kingdoms stores data. Remote engines need connection settings. YAML and JSON are not recommended for live servers."
    });
  }

  const guis = fieldType(root, ["guis"]);

  if (guis?.kind === "object") {
    replaceChild(guis, "default-click-sound", {
      kind: "union",
      optional: true,
      description: "Default click sound for GUI options that use sound: default. Choose None for silence.",
      choices: [
        {
          kind: "suggestion",
          typeName: "Sound",
          allowCustom: true,
          label: "Sound",
          description: "Configure the sound name, category, volume, pitch, seed, and relative playback."
        },
        {
          kind: "literal",
          value: "none",
          label: "None",
          description: "Disable the default GUI click sound."
        }
      ]
    });
  }

  for (const itemPath of [
    ["mails", "envelope", "item"],
    ["mails", "envelope", "reply-item"]
  ]) {
    const item = fieldType(root, itemPath);

    if (item?.kind === "object") {
      replaceChild(item, "name", message("Formatted envelope item name shown to players."));
    }
  }

  replaceChild(root, "disabled-integrations", {
    kind: "set",
    optional: true,
    description: "Integration services to disable. Requires a restart.",
    elements: {
      kind: "enum",
      typeName: "KingdomsIntegration",
      values: [
        "PlaceholderAPI", "MVDWPlaceholderAPI",
        "BlueMap", "Dynmap", "SquareMap", "Pl3xMap",
        "LuckPerms", "Vault",
        "WorldGuard", "WorldEdit",
        "Essentials", "CMI",
        "MythicMobs", "MyPet", "SimplePets", "CombatPets", "MCPets",
        "AuthMe", "DiscordSRV", "Slimefun", "ProjectKorra", "Nova"
      ],
      description: "Integration service name."
    }
  });

  for (const side of ["players", "kingdoms"]) {
    const amount = fieldType(root, ["kingdom-fly", "charges", side, "amount"]);

    if (amount) {
      const wrapped = {
        kind: "union",
        optional: true,
        description: "Fly charge amount settings. Set to ~ to disable charges for this side.",
        choices: [
          amount.kind === "object" || amount.kind === "mapping" ? amount : object([
            field("default", decimal("Default charge amount."))
          ], "Charge amount mapping."),
          disableSentinel("Disable these fly charges (~).")
        ]
      };
      const parent = fieldType(root, ["kingdom-fly", "charges", side]);

      if (parent?.kind === "object") {
        replaceChild(parent, "amount", wrapped);
      }
    }

    const activation = fieldType(root, ["kingdom-fly", "charges", side, "activation-cost"]);

    if (activation) {
      const wrapped = {
        kind: "union",
        optional: true,
        description: "Activation cost settings. Set to ~ to disable.",
        choices: [
          activation.kind === "object" || activation.kind === "mapping" ? activation : object([
            field("default", decimal("Default activation cost."))
          ], "Activation cost mapping."),
          disableSentinel("Disable this activation cost (~).")
        ]
      };
      const parent = fieldType(root, ["kingdom-fly", "charges", side]);

      if (parent?.kind === "object") {
        replaceChild(parent, "activation-cost", wrapped);
      }
    }
  }
}

function applyRankStructures(root) {
  const permissionCategory = object([
    field("permissions", list(
      rankPermissionType(),
      "Permissions shown in the order listed."
    )),
    field("gui", text("str", "GUI file used to display this category."))
  ], "Permission category shown in the ranks GUI.", { required: [] });

  for (const key of ["permission-categories", "national-permission-categories"]) {
    if (!fieldType(root, [key])) {
      continue;
    }

    replaceChild(root, key, mapping(
      text("str", "Permission category id."),
      cloneSchemaValue(permissionCategory),
      "Ordered, user-defined permission categories for the ranks GUI."
    ));
  }

  const newRank = fieldType(root, ["new-rank"]);

  if (newRank?.kind === "object") {
    const next = rankDefinitionType(newRank);
    newRank.fields = next.fields;
    newRank.description = next.description;
  }

  for (const key of ["kingdom-ranks", "national-ranks", "ranks"]) {
    let ranks = fieldType(root, [key]);

    if (!ranks) {
      continue;
    }

    const template = rankDefinitionType();

    if (ranks.kind === "object") {
      const existingRank = ranks.fields?.find((candidate) => candidate.type?.kind === "object")?.type;
      replaceChild(root, key, mapping(
        text("str", "Rank node id."),
        rankDefinitionType(existingRank),
        "Rank definitions in priority order."
      ));
      ranks = fieldType(root, [key]);
    }

    if (ranks.kind === "mapping") {
      ranks.values = mergeObjectFields(ranks.values ?? object([]), template.fields, RANK_DEFINITION_HELP);
      ranks.description = RANK_DEFINITION_HELP;
    }

    for (const named of ranks.fields ?? []) {
      named.type = mergeObjectFields(named.type, template.fields, RANK_DEFINITION_HELP);
    }
  }
}

function applyLanguageStructures(root) {
  replaceChild(root, "true", message("Translated text used when a true value is shown to a player."));
  replaceChild(root, "false", message("Translated text used when a false value is shown to a player."));

  for (const [key, keyDescription, description] of [
    ["worlds", "World name.", "User-defined display names for Minecraft worlds."],
    ["variables", "Message variable id.", "Reusable message variables referenced as {$name}."]
  ]) {
    const existing = fieldType(root, [key]);

    if (existing?.kind !== "object") {
      continue;
    }

    replaceChild(root, key, mapping(
      text("str", keyDescription),
      message("Translated text."),
      description
    ));
  }

  const channels = fieldType(root, ["channels"]);

  if (channels?.kind === "object") {
    const defaultMessages = channels.fields?.find((candidate) => candidate.key === "default")?.type;
    const existingChannel = channels.fields?.find((candidate) =>
      candidate.key !== "default" && candidate.type?.kind === "object"
    )?.type;
    const channelType = mergeObjectFields(existingChannel, [
      field("name", message("Channel display name.")),
      field("short-name", message("Compact channel name."))
    ], "Display text for a chat channel.");
    const channelMap = mapping(
      text("str", "Chat channel id."),
      channelType,
      "Display names for default and custom chat channels."
    );

    if (defaultMessages) {
      channelMap.fields = [field("default", cloneSchemaValue(defaultMessages))];
    }

    replaceChild(root, "channels", channelMap);
  }

  normalizeLanguageMessageEntries(root);
}

function normalizeLanguageMessageEntries(type) {
  if (!type || typeof type !== "object") {
    return;
  }

  if (type.kind === "string" && type.typeName === "Message") {
    type.messageEntry = true;
    return;
  }

  if (isExpandedMessageEntry(type)) {
    const template = messageEntryType();
    const expanded = mergeObjectFields(type, template.fields, template.description);
    expanded.typeName = "MessageEntry";
    const sound = expanded.fields.find((candidate) => candidate.key === "sound");
    const soundTemplate = template.fields.find((candidate) => candidate.key === "sound").type;

    if (sound) {
      const description = sound.type?.description || soundTemplate.description;
      sound.type = { ...cloneSchemaValue(soundTemplate), description };
    }

    const titles = expanded.fields.find((candidate) => candidate.key === "titles");
    const titlesTemplate = template.fields.find((candidate) => candidate.key === "titles").type;

    if (titles) {
      titles.type = mergeObjectFields(titles.type, titlesTemplate.fields, titles.type?.description || titlesTemplate.description);
      titles.type.typeName = "MessageTitles";
    }

    markCapabilityTree(expanded, "editor-overlay");
    Object.assign(type, expanded);
    return;
  }

  for (const candidate of type.fields ?? []) {
    normalizeLanguageMessageEntries(candidate.type);
  }

  normalizeLanguageMessageEntries(type.values);
  normalizeLanguageMessageEntries(type.additionalProperties);
  normalizeLanguageMessageEntries(type.elements);

  for (const choice of type.choices ?? []) {
    normalizeLanguageMessageEntries(choice);
  }
}

function applyMapStructures(root) {
  replaceChild(root, "header", message("Formatted line shown above the map."));
  replaceChild(root, "footer", message("Formatted line shown below the map."));
  replaceChild(root, "compass", message("Formatted compass line shown with the map."));

  const scoreboard = fieldType(root, ["scoreboard"]);

  if (scoreboard?.kind === "object") {
    replaceChild(scoreboard, "header", message("Formatted scoreboard heading shown above map lines."));
  }

  const elements = fieldType(root, ["elements"]);

  if (!elements) {
    return;
  }

  const elementTemplate = mapElementType();
  const groupTemplate = mapStructureGroupType();
  applyMapElementTree(elements, elementTemplate, groupTemplate);
}

function applyMapElementTree(node, elementTemplate, groupTemplate) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.kind === "mapping") {
    for (const named of node.fields ?? []) {
      applyMapElementTree(named.type, elementTemplate, groupTemplate);
    }

    applyMapElementTree(node.values, elementTemplate, groupTemplate);
    return;
  }

  if (node.kind !== "object") {
    return;
  }

  const childKeys = new Set((node.fields ?? []).map((candidate) => candidate.key));
  const isMapElement = childKeys.has("icon")
    && ["hover", "action", "item"].some((key) => childKeys.has(key));

  if (isMapElement) {
    const merged = mergeObjectFields(node, elementTemplate.fields, elementTemplate.description);
    node.fields = merged.fields;

    if (!node.description) {
      node.description = elementTemplate.description;
    }
  }

  const isStructureGroup = [...MAP_RELATION_VARIANT_KEYS].some((key) => childKeys.has(key));

  if (isStructureGroup) {
    const merged = mergeObjectFields(node, groupTemplate.fields, groupTemplate.description);
    node.fields = merged.fields;

    if (!node.description) {
      node.description = groupTemplate.description;
    }
  }

  for (const named of node.fields ?? []) {
    if (MAP_RELATION_VARIANT_KEYS.has(named.key)) {
      named.type = mergeObjectFields(named.type, elementTemplate.fields, elementTemplate.description);
      continue;
    }

    if (named.type?.kind === "object" || named.type?.kind === "mapping") {
      applyMapElementTree(named.type, elementTemplate, groupTemplate);
    }
  }

  if (node.additionalProperties) {
    applyMapElementTree(node.additionalProperties, elementTemplate, groupTemplate);
  }
}

function applyClaimsStructures(root) {
  const biomes = fieldType(root, ["biomes"]);

  if (biomes?.kind === "mapping") {
    biomes.description = BIOME_RULE_SET_HELP;
    biomes.keys = text("str", "Named biome rule set (for example default).");
    const template = biomeRuleSetType(biomes.values ?? object([]));
    biomes.values = template;
    for (const named of biomes.fields ?? []) {
      named.type = biomeRuleSetType(named.type);
    }
  }

  const indicator = fieldType(root, ["indicator"]);

  if (!indicator?.fields) {
    return;
  }

  if (indicator.kind === "mapping" && indicator.values) {
    indicator.values = claimIndicatorLandType(indicator.values);
  }

  const landTypes = new Set(indicator.keys?.values ?? []);

  for (const named of indicator.fields) {
    if (landTypes.size && !landTypes.has(named.key)) {
      continue;
    }

    if (named.type?.kind === "object") {
      named.type = claimIndicatorLandType(named.type);
    }
  }
}

function applyResourcePointStructures(root) {
  const filters = fieldType(root, ["general-filters"]);

  if (filters?.kind === "object") {
    filters.description = RESOURCE_FILTER_HELP;
    for (const key of ["lore", "enchants"]) {
      const child = filters.fields?.find((candidate) => candidate.key === key);

      if (!child) {
        continue;
      }

      child.type = {
        kind: "union",
        description: RESOURCE_FILTER_HELP,
        optional: true,
        choices: [
          boolean("true = whitelist matching items, false = blacklist matching items."),
          disableSentinel("Ignore this filter (~)."),
          list(text("str"), "Explicit filter entries.")
        ]
      };
    }

    for (const key of ["with-lore", "enchanted"]) {
      if (filters.fields?.some((candidate) => candidate.key === key)) {
        continue;
      }

      (filters.fields ??= []).push(field(key, list(text("str"), `Optional ${key} filter list documented in comments.`)));
    }

    const material = filters.fields?.find((candidate) => candidate.key === "material")?.type;

    if (material?.kind === "object") {
      replaceChild(material, "blacklist", boolean("true = listed materials are blocked, false = only listed materials are allowed."));
      replaceChild(material, "list", list(text("Material"), "Materials matched by this filter."));
    } else if (!filters.fields?.some((candidate) => candidate.key === "material")) {
      (filters.fields ??= []).push(field("material", object([
        field("blacklist", boolean("true = listed materials are blocked.")),
        field("list", list(text("Material"), "Materials matched by this filter."))
      ], "Optional material filter with blacklist/list form.")));
    }
  }

  const matcherWorth = [
    field("name", { kind: "advanced", typeName: "StringMatcher", description: "Displayed-name matcher." }),
    field("lore", { kind: "advanced", typeName: "StringMatcher", description: "Lore matcher." }),
    field("material", { kind: "advanced", typeName: "StringMatcher<Material>", description: "Material matcher." }),
    field("nbt", mapping(text(), { kind: "advanced", typeName: "StringMatcher" }, "NBT paths mapped to string matchers.")),
    field("resource-points", {
      kind: "union",
      optional: true,
      description: "Resource-point worth of a matching item.",
      choices: [integer("Fixed worth.", { minimum: 0 }), expression("Worth formula.")]
    }),
    field("enchants", mapping(text("Enchant"), integer("Level"), "Optional enchant requirements."))
  ];

  for (const key of ["advanced", "custom-items"]) {
    const section = fieldType(root, [key]);

    if (!section) {
      continue;
    }

    const help = key === "advanced"
      ? "Advanced custom-item detectors. Uses ItemMatcher fields plus resource-points worth."
      : "Custom items given by /k item. Uses ItemStack-like fields plus resource-points worth.";

    if (section.kind === "mapping") {
      section.description = help;
      section.values = mergeObjectFields(section.values ?? object([]), matcherWorth, help);
      if (key === "custom-items") {
        replaceChild(section.values, "name", message("Formatted display name for this custom item."));
      }
    }

    for (const named of section.fields ?? []) {
      if (named.type?.kind === "object") {
        named.type = mergeObjectFields(named.type, matcherWorth, help);
        if (key === "custom-items") {
          replaceChild(named.type, "name", message("Formatted display name for this custom item."));
        }
      }
    }
  }
}

function applyPowersStructures(root) {
  const powerups = fieldType(root, ["powerups"]);

  if (!powerups) {
    return;
  }

  const templateFields = [
    field("enabled", boolean("Whether this powerup can be purchased.")),
    field("name", message("Name used in messages. Not used for GUIs.")),
    field("cost", expression("Resource-point cost formula. Usually uses lvl.")),
    field("scaling", expression("Effect formula. Meaning depends on the powerup.")),
    field("max-level", integer("Maximum purchasable level. Lowering this does not reduce existing kingdom levels.", { minimum: 0 })),
    field("own-land-only", boolean("Whether this powerup only works inside the kingdom's own lands.")),
    field("conditions", mapping(
      { kind: "expression", language: "condition" },
      message("Message shown when this condition is not met."),
      "Ordered powerup requirements."
    ))
  ];

  if (powerups.kind === "mapping") {
    powerups.values = mergeObjectFields(powerups.values ?? object([]), templateFields, "Powerup definition.");
  }

  for (const named of powerups.fields ?? []) {
    if (named.type?.kind === "object") {
      named.type = mergeObjectFields(named.type, templateFields, "Powerup definition.");
    }
  }
}

function applyGuiStructures(root) {
  replaceChild(root, "title", message("Display title shown at the top of this inventory."));
  replaceChild(root, "rows", integer("Number of rows in a chest-style inventory.", {
    minimum: 1,
    maximum: 6
  }));

  const interactable = fieldType(root, ["interactable"]);

  if (interactable) {
    interactable.description = "Inventory slots where players may freely take or place items.";
  }

  replaceChild(root, "context-start-row", integer(
    "Inventory row where context/player slots begin (used by invsee-style GUIs).",
    { minimum: 1 }
  ));

  const forms = fieldType(root, ["forms"]);

  if (forms?.kind === "object") {
    const formOptions = fieldType(forms, ["options"]);
    const componentType = object([
      field("component-type", {
        kind: "enum",
        typeName: "BedrockComponentType",
        values: ["LABEL", "BUTTON", "TOGGLE", "SLIDER", "STEP_SLIDER", "DROPDOWN", "INPUT"],
        optional: true,
        description: "Geyser/Floodgate Bedrock form component type."
      }),
      field("text", message("Button, label, or component text.")),
      field("steps", list(text("str"), "Options for STEP_SLIDER or DROPDOWN.")),
      field("min", decimal("Minimum value for SLIDER.")),
      field("max", decimal("Maximum value for SLIDER.")),
      field("step", decimal("Step size for SLIDER.")),
      field("placeholder", message("Placeholder text for INPUT.")),
      field("default-value", {
        kind: "union",
        optional: true,
        description: "Default value. Type depends on component-type.",
        choices: [boolean(), integer(), decimal(), text()]
      })
    ], "Bedrock form component.", { required: [] });

    if (formOptions?.kind === "mapping") {
      formOptions.values = mergeObjectFields(formOptions.values ?? object([]), componentType.fields, componentType.description);
    }

    if (forms.fields && !formOptions) {
      replaceChild(forms, "options", mapping(
        text("str", "Component id"),
        componentType,
        "User-named Bedrock form buttons or components."
      ));
    }
  }

  const colorButtons = fieldType(root, ["[color]"]);
  const disallowedColor = fieldType(colorButtons, ["disallowed"]);

  if (disallowedColor?.kind === "object") {
    replaceChild(disallowedColor, "condition", expression(
      "Condition that prevents this color from being selected.",
      "condition"
    ));
    replaceChild(disallowedColor, "lore", message(
      "Lore shown when this color cannot be selected."
    ));
  }

  const options = fieldType(root, ["options"]);

  if (options) {
    options.description = "GUI buttons keyed by their functional option names.";
  }

  const optionType = options?.kind === "mapping" ? options.values : null;

  if (optionType?.kind !== "object") {
    return;
  }

  replaceChild(optionType, "slot", guiSlots());
  replaceChild(optionType, "slots", list(
    integer("Inventory slot.", { minimum: 0 }),
    "Inventory slots used by this button."
  ));
  if (optionType.additionalProperties?.kind === "object") {
    replaceChild(optionType.additionalProperties, "slot", guiSlots());
    replaceChild(optionType.additionalProperties, "slots", list(
      integer("Inventory slot.", { minimum: 0 }),
      "Inventory slots used by this appearance."
    ));
  }

  const functionalFields = [
    field("ammo", {
      kind: "union",
      optional: true,
      description: "Ammo amount granted when this button is used.",
      choices: [integer("Fixed ammo amount.", { minimum: 0 }), expression("Ammo equation.")]
    }),
    field("cost", {
      kind: "union",
      optional: true,
      description: "Resource-point cost for this functional button.",
      choices: [integer("Fixed cost.", { minimum: 0 }), expression("Cost equation.")]
    }),
    field("fill-cost", {
      kind: "union",
      optional: true,
      description: "Shift-click fill cost equation. Set to 0 to disable.",
      choices: [integer("Fixed fill cost. 0 disables.", { minimum: 0 }), expression("Fill-cost equation.")]
    }),
    field("upgrade", object([
      field("condition", { kind: "expression", language: "condition", description: "When this upgrade appearance is used." }),
      field("name", message("Upgrade button name.")),
      field("lore", {
        kind: "union",
        optional: true,
        description: "Upgrade button lore.",
        choices: [list(message()), message()]
      }),
      field("material", text("Material", "Optional material override for the upgrade appearance.")),
      field("sound", text("Sound", "Optional click sound."))
    ], "Functional upgrade appearance object (distinct from other conditional variants).", { required: [] })),
    field("color", text("Color", "Hex or RGB color. Color-picker options that start with color use this value.")),
    field("context-start-row", integer("Optional per-option context start row override.", { minimum: 1 }))
  ];

  const merged = mergeObjectFields(optionType, functionalFields, optionType.description);
  optionType.fields = merged.fields;
}

function walkObjects(type, visit, path = [], seen = new WeakSet()) {
  if (!type || typeof type !== "object" || seen.has(type)) {
    return;
  }

  seen.add(type);
  const current = type.kind === "reference" ? type.target : type;

  if (!current || typeof current !== "object") {
    return;
  }

  if (current.kind === "object") {
    visit(current, path);

    for (const child of current.fields ?? []) {
      walkObjects(child.type, visit, [...path, child.key], seen);
    }

    if (current.additionalProperties) {
      walkObjects(current.additionalProperties, visit, [...path, "*"], seen);
    }
  } else if (current.kind === "mapping") {
    for (const child of current.fields ?? []) {
      walkObjects(child.type, visit, [...path, child.key], seen);
    }

    if (current.values) {
      walkObjects(current.values, visit, [...path, "*"], seen);
    }
  } else if (current.kind === "union") {
    for (const choice of current.choices ?? []) {
      walkObjects(choice, visit, path, seen);
    }
  } else if (current.kind === "list" || current.kind === "set") {
    walkObjects(current.elements, visit, path, seen);
  } else if (current.kind === "nullable") {
    walkObjects(current.value, visit, path, seen);
  }
}

function fieldType(root, path) {
  let current = root;

  for (const segment of path) {
    current = current?.kind === "reference" ? current.target : current;
    if (!current) {
      return null;
    }

    if (current.kind === "object" || current.kind === "mapping") {
      const child = current.fields?.find((candidate) => candidate.key === segment);
      current = child?.type ?? (current.kind === "mapping" ? current.values : current.additionalProperties);
      continue;
    }

    return null;
  }

  return current?.kind === "reference" ? current.target : current;
}

function replaceChild(parent, key, type) {
  if (!parent?.fields) {
    parent.fields = [];
  }

  const existing = parent.fields.find((candidate) => candidate.key === key);

  if (existing?.type?.capability) {
    addCapability(type, existing.type.capability);
  }

  markCapabilityTree(type, "editor-overlay");

  if (existing) {
    existing.type = type;
  } else {
    parent.fields.push(field(key, type));
  }
}

function cloneSchemaValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(cloneSchemaValue(item, seen));
    }

    return copy;
  }

  if (value.kind === "reference") {
    const copy = {
      kind: "reference",
      typeName: value.typeName,
      description: value.description,
      target: value.target
    };
    seen.set(value, copy);
    return copy;
  }

  const copy = {};
  seen.set(value, copy);
  for (const [key, nested] of Object.entries(value)) {
    copy[key] = cloneSchemaValue(nested, seen);
  }

  return copy;
}

function mergeObjectFields(existing, fields, description) {
  const base = existing?.kind === "object" || existing?.kind === "mapping"
    ? cloneSchemaValue(existing)
    : object([]);

  if (existing?.kind === "mapping") {
    base.kind = "mapping";
  }

  const byKey = new Map((base.fields ?? []).map((item) => [item.key, item]));

  for (const next of fields) {
    const overlayField = cloneSchemaValue(next);
    markCapabilityTree(overlayField.type, "editor-overlay");
    if (!byKey.has(next.key)) {
      byKey.set(next.key, overlayField);
    } else {
      enrichFieldType(byKey.get(next.key).type, overlayField.type);
      addCapability(byKey.get(next.key).type, { sources: ["editor-overlay"] });
    }
  }

  base.fields = [...byKey.values()];

  if (description) {
    base.description = description;
  }

  base.optional = true;
  base.required = base.required ?? [];
  return base;
}

function enrichFieldType(existing, template) {
  if (!existing || !template || typeof existing !== "object" || typeof template !== "object") {
    return;
  }

  if (template.kind === existing.kind && template.typeName) {
    existing.typeName = template.typeName;
  }

  if (template.kind === "object" && existing.kind !== "object") {
    for (const key of Object.keys(existing)) {
      delete existing[key];
    }

    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.kind === "mapping" && existing.kind !== "mapping") {
    for (const key of Object.keys(existing)) {
      delete existing[key];
    }

    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.kind === "union" && ["string", "expression", "nullable", "suggestion", "boolean", "list", "set"].includes(existing.kind)) {
    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.kind === "expression" && ["string", "integer", "decimal"].includes(existing.kind)) {
    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.kind === "list" && existing.kind === "boolean") {
    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.kind === "set" && existing.kind === "list") {
    Object.assign(existing, cloneSchemaValue(template));
    return;
  }

  if (template.description && !existing.description) {
    existing.description = template.description;
  }

  if (template.minimum !== undefined && existing.minimum === undefined) {
    existing.minimum = template.minimum;
  }

  if (template.maximum !== undefined && existing.maximum === undefined) {
    existing.maximum = template.maximum;
  }
}
