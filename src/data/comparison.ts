export type PluginId = "kingdomsx" | "factionsuuid" | "lands" | "towny" | "griefprevention" | "residence";

export type CellValue = "yes" | "partial" | "addon" | "no" | "na" | string | { label: string; hint?: string; href?: string };

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
  { id: "residence", label: "Residence" },
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
          residence: "SMP servers",
        },
      },
      {
        feature: "Pricing model",
        hint: "Whether downloading the plugin requires purchasing it or not.",
        values: {
          kingdomsx: "Free (Discord)",
          factionsuuid: {
            label: "Premium",
            hint: "Free development builds are available, but support is only offered to users who purchase the plugin.",
          },
          lands: "Premium",
          towny: "Free",
          griefprevention: "Free",
          residence: "Free (Dev builds)",
        },
      },
      {
        feature: "Open source",
        hint: "Whether the plugin's source code is publicly accessible and open-source.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "yes",
          lands: "no",
          towny: "Source available",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Minecraft version support",
        hint: "The Minecraft server versions supported by current latest plugin version.",
        values: {
          kingdomsx: {
            label: "1.9–26.2",
            href: "https://kingdoms.wiki/FAQ#supported-server-versions-by-the-plugin",
          },
          factionsuuid: "26.2–26.3",
          lands: "1.21–26.3",
          towny: "1.19–26.2",
          griefprevention: "1.21.10–26.3",
          residence: "1.7.10–26.3",
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
          residence: "Medium",
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
          lands: "Chunks + block subareas",
          towny: "Townblocks (grid squares)",
          griefprevention: "Block rectangles",
          residence: "Block cuboids",
        },
      },
      {
        feature: "Dynamic claim limits",
        hint: "Whether claim limits can grow with membership, upgrades, activity or other progression.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "partial",
        },
      },
      {
        feature: "Map-based claiming",
        hint: "Whether players can claim and unclaim territory by clicking an in-game map.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Detached claims",
        hint: "Whether a group can claim land away from its main territory and in separate claim clusters.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Solo claiming",
        hint: "Whether a player can protect land without joining a larger group, including starter camps or automatic first claims.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Claim border visualizers",
        hint: "Whether players can see claim borders in-game with particles, fake blocks, chunk outlines, or similar indicators.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Subclaims / areas",
        hint: "Whether territory can be divided into smaller areas (plots, zones, etc.) with separate ownership or permissions.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Land rent / sale",
        hint: "Whether players can rent or sell specific land areas to other players.",
        values: {
          kingdomsx: "no",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "addon",
          residence: "yes",
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
          residence: "yes",
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
          factionsuuid: "partial",
          lands: "yes",
          towny: "partial",
          griefprevention: "addon",
          residence: "partial",
        },
      },
      {
        feature: "Clickable chat actions",
        hint: "Whether chat messages include clickable commands, hover details, or interactive help actions.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
          residence: "yes",
        },
      },
      {
        feature: "Interactive claim map",
        hint: "Whether players can inspect territory details and manage claims directly from an in-game map.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "partial",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Bedrock form support",
        hint: "Whether Bedrock players can use native forms through Geyser/Floodgate.",
        values: {
          kingdomsx: "partial",
          factionsuuid: "no",
          lands: "yes",
          towny: "no",
          griefprevention: "no",
          residence: "no",
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
          residence: "partial",
        },
      },
      {
        feature: "Group chat channels",
        hint: "Whether groups have dedicated private chat channels.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "na",
          residence: "yes",
        },
      },
      {
        feature: "Contextual messages",
        hint: "Whether messages can change based on the viewer's relationship to another player or group.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "partial",
          towny: "no",
          griefprevention: "no",
          residence: "no",
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
        hint: "Whether player, group and economy placeholders work across the plugin's messages, GUIs and configs without requiring PlaceholderAPI.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "partial",
          towny: "partial",
          griefprevention: "partial",
          residence: "partial",
        },
      },
      {
        feature: "PlaceholderAPI support",
        hint: "Whether the plugin exposes its data to other plugins through PlaceholderAPI.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "addon",
          residence: "yes",
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
          residence: "no",
        },
      },
      {
        feature: "Editable language files",
        hint: "Whether the plugin messages can be customized through language or message files.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Custom GUI files",
        hint: "Whether GUI layouts, items, conditions and actions can be configured through config files.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "yes",
          towny: "addon",
          griefprevention: "addon",
          residence: "partial",
        },
      },
      {
        feature: "Automatic config updates",
        hint: "Whether new config entries are added automatically between plugin versions while keeping existing values and default comments.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "Unverified",
          towny: "yes",
          griefprevention: "partial",
          residence: "yes",
        },
      },
      {
        feature: "Automatic config reloads",
        hint: "Whether config changes are applied automatically without a reload command.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Startup config validation",
        hint: "Whether setting types, values and expressions are checked for errors during startup.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "Unverified",
          towny: "partial",
          griefprevention: "partial",
          residence: "partial",
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
        hint: "Whether members can deposit and withdraw money from a shared group balance.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
          residence: "yes",
        },
      },
      {
        feature: "Group vaults / storage",
        hint: "Whether members can store items in a shared group inventory.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "addon",
          lands: "partial",
          towny: "no",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Plugin-specific currency",
        hint: "Whether the plugin provides its own group currency (distinct from Vault economy) for upgrades and other gameplay costs (e.g. resource points).",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "addon",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Configurable taxes",
        hint: "Whether taxes, upkeep, or treasury calculations can be configured by server owners.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "partial",
          towny: "partial",
          griefprevention: "na",
          residence: "partial",
        },
      },
      {
        feature: "Custom ranks / roles",
        hint: "Whether groups can create ranks or roles and configure their permissions.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "yes",
          towny: "partial",
          griefprevention: "no",
          residence: "no",
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
          residence: "no",
        },
      },
      {
        feature: "Top lists / leaderboards",
        hint: "Whether the plugin has a mechanism to rank groups based on scores, wealth or progression (e.g. top lists, placeholders, leaderboards, etc.).",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
          residence: "partial",
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
        hint: "Whether land can be restored automatically after being unclaimed.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "yes",
          griefprevention: "partial",
          residence: "no",
        },
      },
      {
        feature: "Container protection",
        hint: "Whether chests, barrels, furnaces, doors and other similar containers are protected inside claims.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Container locking / protection signs",
        hint: "Whether individual containers can be privately locked or access-controlled from other group members.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "no",
          griefprevention: "no",
          residence: "addon",
        },
      },
      {
        feature: "Private container / protection signs sharing",
        hint: "Whether the owner of an individually protected container can add specific players or groups to that container's access list.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "no",
          griefprevention: "no",
          residence: "addon",
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
          factionsuuid: "partial",
          lands: "yes",
          towny: "partial",
          griefprevention: "partial",
          residence: "partial",
        },
      },
      {
        feature: "War shields",
        hint: "Whether players can activate timed shields to protect their territory from attacks.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "partial",
          towny: "addon",
          griefprevention: "no",
          residence: "partial",
        },
      },
      {
        feature: "Turrets / placeable defenses",
        hint: "Whether the plugin has placeable defenses or siege buildings, such as turrets, cannons or other structures.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "no",
          residence: "no",
        },
      },
      {
        feature: "Explosion regeneration",
        hint: "Whether the plugin has a mechanism to track and restore explosion damage in claimed territory (e.g. TNT or Creeper explosions).",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "partial",
          griefprevention: "no",
          residence: "no",
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
          residence: "no",
        },
      },
      {
        feature: "Peace treaties / war terms",
        hint: "Whether groups can agree on peace terms, such as reparations, territory or ongoing obligations.",
        values: {
          kingdomsx: "addon",
          factionsuuid: "no",
          lands: "partial",
          towny: "addon",
          griefprevention: "na",
          residence: "no",
        },
      },
      {
        feature: "Elections / voting",
        hint: "Whether group leadership can be chosen through elections or member voting.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "no",
          towny: "no",
          griefprevention: "na",
          residence: "no",
        },
      },
      {
        feature: "Nations / federations",
        hint: "Whether multiple groups can form a shared group entity with shared leadership and settings (e.g. nations).",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "na",
          residence: "no",
        },
      },
      {
        feature: "Configurable relation rules",
        hint: "Whether group leaders can configure access and combat rules for allies, truces and enemies.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "partial",
          lands: "yes",
          towny: "partial",
          griefprevention: "na",
          residence: "no",
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
        hint: "Whether the plugin can run by itself, without requiring another plugin to be installed.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "yes",
          lands: "yes",
          towny: "yes",
          griefprevention: "yes",
          residence: "no",
        },
      },
      {
        feature: "Multiple storage backends",
        hint: "Whether the plugin supports more than one storage backend, such as flatfile, SQLite, MySQL, or similar databases.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "partial",
          residence: "no",
        },
      },
      {
        feature: "Scheduled backups",
        hint: "Whether the plugin has a built-in scheduler to automatically backup the database.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "yes",
          towny: "yes",
          griefprevention: "no",
          residence: "partial",
        },
      },
      {
        feature: "Webmap plugin support",
        hint: "Whether claims can be displayed on browser maps such as Dynmap, BlueMap or squaremap.",
        values: {
          kingdomsx: "addon",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "addon",
          residence: "yes",
        },
      },
      {
        feature: "WorldGuard support",
        hint: "Whether claiming can be restricted inside WorldGuard regions (e.g. spawn).",
        values: {
          kingdomsx: "addon",
          factionsuuid: "yes",
          lands: "yes",
          towny: "addon",
          griefprevention: "yes",
          residence: "yes",
        },
      },
      {
        feature: "Discord bridge",
        hint: "Whether group chat or event announcements can be bridged to Discord.",
        values: {
          kingdomsx: "yes",
          factionsuuid: "no",
          lands: "addon",
          towny: "addon",
          griefprevention: "no",
          residence: "no",
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
          residence: "no",
        },
      },
    ],
  },
];
