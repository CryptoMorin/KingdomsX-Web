export type PluginId = "kingdomsx" | "factionsuuid" | "lands" | "towny" | "griefprevention";

export type CellValue = "yes" | "partial" | "addon" | "no" | "na" | string;

export type ComparisonRow = {
  feature: string;
  hint?: string;
  values: Record<PluginId, CellValue>;
};

export type ComparisonCategory = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  rows: ComparisonRow[];
};

export const plugins: { id: PluginId; label: string }[] = [
  { id: "kingdomsx", label: "KingdomsX" },
  { id: "factionsuuid", label: "FactionsUUID" },
  { id: "lands", label: "Lands" },
  { id: "towny", label: "Towny" },
  { id: "griefprevention", label: "GriefPrevention" },
];

export const comparisonCategories: ComparisonCategory[] = [
  {
    id: "general",
    label: "General",
    defaultOpen: true,
    rows: [
      {
        feature: "Best fit",
        hint: "The server type where the core plugin's mechanics make the most sense.",
        values: {
          kingdomsx: "PvP servers",
          factionsuuid: "PvP servers",
          lands: "SMP servers",
          towny: "SMP / roleplay servers",
          griefprevention: "SMP servers",
        },
      },
      {
        feature: "Pricing model",
        hint: "Whether downloading the plugin requires purchasing it or not.",
        values: {
          kingdomsx: "Free (Discord)",
          factionsuuid: "Premium",
          lands: "Premium",
          towny: "Free",
          griefprevention: "Free",
        },
      },
      {
        feature: "Open source",
        hint: "Whether the plugin's source code is publicly accessible and open-source.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "yes",
          lands: "no",
          towny: "yes",
          griefprevention: "yes",
        },
      },
      {
        feature: "Setup complexity",
        hint: "How much setup and balancing work a typical server owner should expect.",
        values: {
          kingdomsx: "High",
          factionsuuid: "Low",
          lands: "Medium",
          towny: "High",
          griefprevention: "Low",
        },
      },
    ],
  },
  {
    id: "claiming",
    label: "Land claiming",
    defaultOpen: false,
    rows: [
      {
        feature: "Claim shape",
        hint: "The basic shape used for protected territory.",
        values: {
          kingdomsx: "Chunks",
          factionsuuid: "Chunks",
          lands: "Chunks + block-based subareas",
          towny: "Townblocks / grid squares",
          griefprevention: "Block-level rectangles",
        },
      },
      {
        feature: "Dynamic claim limits",
        hint: "Whether claim limits can scale with power, members, upgrades, economy, levels, or playtime.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
        },
      },
      {
        feature: "Map-based claiming",
        hint: "Whether players can claim land from an in-game territory map instead of only standing in the claim.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "no",
          griefprevention: "no",
        },
      },
      {
        feature: "Detached claims",
        hint: "Whether a group can claim land away from its main territory and in separate claim clusters.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "partial",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Solo or starter claims",
        hint: "Whether a player can protect land without joining a larger group, including starter camps or automatic first claims.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "yes",
        },
      },
      {
        feature: "Claim border visualizers",
        hint: "Whether players can see claim borders in-game with particles, fake blocks, chunk outlines, or similar indicators.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "partial",
          griefprevention: "yes",
        },
      },
      {
        feature: "Subclaims / areas",
        hint: "Whether a claim can be divided into smaller managed areas, plots, zones, subdivisions, or equivalent per-area controls.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
        },
      },
      {
        feature: "Land rent / sale",
        hint: "Whether players can rent, sell, or market specific land areas to other players.",
        values: {
          kingdomsx: "no",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "addon",
        },
      },
      {
        feature: "Claim flight",
        hint: "Whether players can fly inside their own group territory or trusted claims.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "addon",
        },
      },
    ],
  },
  {
    id: "ux",
    label: "Commands & GUIs",
    defaultOpen: false,
    rows: [
      {
        feature: "Management GUIs",
        hint: "Whether the plugin has built-in GUIs for managing claims, members, roles, and other settings.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "addon",
          griefprevention: "no",
        },
      },
      {
        feature: "Clickable chat actions",
        hint: "Whether chat messages include clickable commands, hover details, or interactive help actions.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "partial",
          towny: "no",
          griefprevention: "no",
        },
      },
      {
        feature: "Interactive claim map",
        hint: "Whether the in-game map can show territory details and support direct claim-related actions.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "no",
        },
      },
      {
        feature: "Bedrock form support",
        hint: "Whether Bedrock / Geyser players get native forms or partial form-compatible GUI behavior.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "no",
          lands: "yes",
          towny: "no",
          griefprevention: "no",
        },
      },
    ],
  },
  {
    id: "chat",
    label: "Chat & messages",
    defaultOpen: false,
    rows: [
      {
        feature: "Global chat formatter",
        hint: "Whether the plugin can format the normal server chat without needing a separate chat plugin.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "no",
          towny: "addon",
          griefprevention: "no",
        },
      },
      {
        feature: "Group chat channels",
        hint: "Dedicated chat channels for kingdoms, factions, lands, towns, nations, allies, or similar groups.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "na",
        },
      },
      {
        feature: "Contextual messages",
        hint: "Different messages based on the viewer, owner, faction, kingdom relation, or land relation. E.g. server join/leave messages.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "no",
        },
      },
    ],
  },
  {
    id: "config",
    label: "Configuration & placeholders",
    defaultOpen: false,
    rows: [
      {
        feature: "Built-in placeholders",
        hint: "Placeholders usable inside the plugin's own messages, GUIs, or configs without requiring PlaceholderAPI.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "partial",
          towny: "partial",
          griefprevention: "no",
        },
      },
      {
        feature: "PlaceholderAPI support",
        hint: "Whether the plugin exposes PlaceholderAPI placeholders for scoreboards, chat plugins, menus, or other integrations.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "addon",
        },
      },
      {
        feature: "Relational placeholders",
        hint: "Placeholders whose output changes based on the viewer, owner, faction, kingdom relation, or land relation.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "partial",
          griefprevention: "na",
        },
      },
      {
        feature: "Editable language files",
        hint: "Whether server owners can edit player messages through language or message files.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
        },
      },
      {
        feature: "Custom GUI files",
        hint: "Whether server owners can edit GUI layouts, items, names, lore, slots, or actions through config files.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "addon",
        },
      },
      {
        feature: "Automatic config updates",
        hint: "Updates config files across plugin versions while keeping existing values and comments where supported.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Automatic config reloads",
        hint: "Watches config files and reloads changed files automatically without running a reload command.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "no",
        },
      },
      {
        feature: "Startup config validation",
        hint: "Validates and optimizes config values during server startup.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "partial",
          towny: "partial",
          griefprevention: "partial",
        },
      },
    ],
  },
  {
    id: "economy",
    label: "Economy & progression",
    defaultOpen: false,
    rows: [
      {
        feature: "Group bank",
        hint: "Whether the group can store money in a shared bank, treasury, or balance.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Group vaults / storage",
        hint: "Built-in or integrated item storage for group resources.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "addon",
          lands: "yes",
          towny: "no",
          griefprevention: "no",
        },
      },
      {
        feature: "Plugin-specific currency",
        hint: "Currency distinct from Vault economy (e.g. resource points).",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "addon",
          griefprevention: "no",
        },
      },
      {
        feature: "Configurable taxes",
        hint: "Whether taxes, upkeep, or treasury calculations can be configured by server owners.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "partial",
          towny: "yes",
          griefprevention: "na",
        },
      },
      {
        feature: "Custom ranks / roles",
        hint: "Whether groups can define or use internal ranks, roles, permissions, or trusted member tiers.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Upgrades / levels",
        hint: "In-game purchasable or level-based upgrades that expand group capabilities over time.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Top lists / leaderboards",
        hint: "Whether the plugin has ranking commands, top lists, placeholders, signs, holograms, or leaderboard-style sorting.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
        },
      },
    ],
  },
  {
    id: "protection",
    label: "Land protection",
    defaultOpen: false,
    rows: [
      {
        feature: "Restore land on unclaim",
        hint: "Whether land can be restored after being unclaimed.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "yes",
          griefprevention: "partial",
        },
      },
      {
        feature: "Container protection",
        hint: "Whether chests, barrels, furnaces, doors and other similar containers are protected inside claims.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "partial",
          griefprevention: "yes",
        },
      },
      {
        feature: "Container locking / protection signs",
        hint: "Whether individual containers can be privately locked or access-controlled from other group members.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "partial",
          towny: "partial",
          griefprevention: "partial",
        },
      },
      {
        feature: "Private container / protection signs sharing",
        hint: "Whether the owner of an individually protected container can add specific players or groups to that container's access list.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "partial",
          towny: "partial",
          griefprevention: "partial",
        },
      },
    ],
  },
  {
    id: "relations",
    label: "Warfare & diplomacy",
    defaultOpen: false,
    rows: [
      {
        feature: "Wars / invasions",
        hint: "Whether the plugin has structured wars, invasions, sieges, or similar conflict systems.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "addon",
          griefprevention: "partial",
        },
      },
      {
        feature: "War shields",
        hint: "Temporary protection period preventing invasions or raids after a war ends or by player choice.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "no",
        },
      },
      {
        feature: "Turrets / placeable defenses",
        hint: "Whether the plugin includes placeable defensive blocks, turrets, siege equipment or other structures.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "no",
        },
      },
      {
        feature: "Explosion rollback / regen",
        hint: "Track and restore TNT / creeper explosion damage in claimed or protected land.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "yes",
          griefprevention: "partial",
        },
      },
      {
        feature: "Alliances / relations",
        hint: "Whether groups can set diplomatic relationships such as allies, truces, enemies, or peaceful status.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "na",
        },
      },
      {
        feature: "Peace treaties / war terms",
        hint: "Formal surrender, settlement, tribute, or treaty mechanics after war.",
        values: {
          kingdomsx: "addon",
          factionsuuid: "no",
          lands: "partial",
          towny: "addon",
          griefprevention: "na",
        },
      },
      {
        feature: "Elections / voting",
        hint: "Whether group leadership or political decisions can be handled through built-in voting or election mechanics.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "na",
        },
      },
      {
        feature: "Nations / federations",
        hint: "Whether multiple groups can join a higher-level nation, federation, or equivalent alliance structure.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "na",
        },
      },
      {
        feature: "Configurable relation rules",
        hint: "Whether server or group owners (kings, leaders, etc.) can configure what different relations are allowed to do in claims or wars.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "yes",
          towny: "partial",
          griefprevention: "na",
        },
      },
    ],
  },
  {
    id: "admin",
    label: "Administration & integrations",
    defaultOpen: false,
    rows: [
      {
        feature: "No required dependencies",
        hint: "Whether the plugin can run by itself without another plugin being required first.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
        },
      },
      {
        feature: "Multiple database backend options",
        hint: "Whether the plugin supports more than one storage backend, such as flatfile, SQLite, MySQL, or similar databases.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "partial",
        },
      },
      {
        feature: "Scheduled backups",
        hint: "Whether the plugin has a built-in scheduler to automatically backup the database.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "yes",
          griefprevention: "no",
        },
      },
      {
        feature: "Webmap plugin support",
        hint: "Dynmap, BlueMap, Squaremap, Pl3xMap, etc.",
        values: {
          kingdomsx: "addon",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "addon",
        },
      },
      {
        feature: "WorldGuard support",
        hint: "Prevents claiming inside server regions (e.g. spawn).",
        values: {
          kingdomsx: "addon",
          factionsuuid: "partial",
          lands: "yes",
          towny: "addon",
          griefprevention: "partial",
        },
      },
      {
        feature: "Discord bridge",
        hint: "Native or officially-supported Discord bridge for land/group event announcements or messages.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "addon",
          griefprevention: "no",
        },
      },
      {
        feature: "Cross-server sync",
        hint: "Whether claim or land data can synchronize across multiple servers in a network.",
        values: {
          kingdomsx: "no",
          factionsuuid: "no",
          lands: "yes",
          towny: "no",
          griefprevention: "no",
        },
      },
    ],
  },
];
