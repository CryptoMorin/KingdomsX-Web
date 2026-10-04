export const MINECRAFT_ASSET_VERSION = "26.2";
export const MINECRAFT_ASSET_ORIGIN = "https://assets.mcasset.cloud";
export const MINECRAFT_RENDERER_ASSET_URL = "https://cdn.jsdelivr.net/npm/block-model-renderer@2.11.0/assets.zip";

const ASSET_ROOT = `${MINECRAFT_ASSET_ORIGIN}/${MINECRAFT_ASSET_VERSION}/assets/minecraft`;

const MATERIAL_ALIASES = new Map([
  ["grass", "short_grass"],
  ["grass_path", "dirt_path"],
  ["gold_axe", "golden_axe"],
  ["gold_boots", "golden_boots"],
  ["gold_chestplate", "golden_chestplate"],
  ["gold_helmet", "golden_helmet"],
  ["gold_hoe", "golden_hoe"],
  ["gold_leggings", "golden_leggings"],
  ["gold_pickaxe", "golden_pickaxe"],
  ["gold_spade", "golden_shovel"],
  ["gold_sword", "golden_sword"],
  ["sign", "oak_sign"],
  ["skull_item", "skeleton_skull"],
  ["wood_door", "oak_door"],
  ["wooden_door", "oak_door"],
  ["workbench", "crafting_table"]
]);

const MATERIAL_TEXTURE_FALLBACKS = new Map([
  ["beacon", ["textures/block/beacon.png"]],
  ["brick_stairs", ["textures/block/bricks.png"]],
  ["cartography_table", ["textures/block/cartography_table_top.png"]],
  ["clock", ["textures/item/clock_00.png"]],
  ["compass", ["textures/item/compass_16.png"]],
  ["crafting_table", ["textures/block/crafting_table_top.png"]],
  ["dispenser", ["textures/block/dispenser_front.png"]],
  ["dropper", ["textures/block/dropper_front.png"]],
  ["enchanting_table", ["textures/block/enchanting_table_top.png"]],
  ["enchanted_golden_apple", ["textures/item/golden_apple.png"]],
  ["end_portal_frame", ["textures/block/end_portal_frame_top.png"]],
  ["furnace", ["textures/block/furnace_front.png"]],
  ["grass_block", ["textures/block/grass_block_top.png"]],
  ["hay_block", ["textures/block/hay_block_top.png"]],
  ["heavy_weighted_pressure_plate", ["textures/block/gold_block.png"]],
  ["jigsaw", ["textures/block/jigsaw_top.png"]],
  ["lectern", ["textures/block/lectern_top.png"]],
  ["light_weighted_pressure_plate", ["textures/block/iron_block.png"]],
  ["loom", ["textures/block/loom_top.png"]],
  ["oak_pressure_plate", ["textures/block/oak_planks.png"]],
  ["piston", ["textures/block/piston_top.png"]],
  ["red_bed", ["textures/block/red_wool.png"]],
  ["smithing_table", ["textures/block/smithing_table_top.png"]],
  ["smoker", ["textures/block/smoker_front.png"]],
  ["stone_pressure_plate", ["textures/block/stone.png"]],
  ["tnt", ["textures/block/tnt_side.png"]]
]);

const BLOCK_MODEL_ITEMS = new Set(["beacon"]);

export function minecraftAssetUrl(path) {
  return `${ASSET_ROOT}/${String(path).replace(/^\/+/, "")}`;
}

export function normalizeMaterialId(material) {
  const source = String(material ?? "").trim().toLocaleLowerCase("en-US");

  if (!source || /[%{}[\]]/.test(source)) {
    return "";
  }

  const withoutNamespace = source.replace(/^minecraft:/, "");
  const withoutData = withoutNamespace.replace(/:\d+$/, "");
  const normalized = withoutData
    .replaceAll(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_./]/g, "");

  if (!normalized || ["air", "generated", "unspecified", "none"].includes(normalized)) {
    return "";
  }

  return MATERIAL_ALIASES.get(normalized) ?? normalized;
}

export function materialTextureCandidates(material) {
  const id = normalizeMaterialId(material);

  if (!id) {
    return [];
  }

  const candidates = [
    minecraftAssetUrl(`textures/item/${id}.png`),
    minecraftAssetUrl(`textures/block/${id}.png`)
  ];

  if (id === "glass_pane") {
    candidates.push(minecraftAssetUrl("textures/block/glass.png"));
  } else if (id.endsWith("_stained_glass_pane")) {
    candidates.push(minecraftAssetUrl(`textures/block/${id.replace(/_pane$/, "")}.png`));
  }

  for (const path of MATERIAL_TEXTURE_FALLBACKS.get(id) ?? []) {
    candidates.push(minecraftAssetUrl(path));
  }

  return candidates;
}

export function minecraftModelRenderTarget(material) {
  return BLOCK_MODEL_ITEMS.has(normalizeMaterialId(material)) ? "block" : "item";
}

export function playerHeadTextureUrl(value) {
  const source = String(value ?? "").trim();

  if (!source || /[%{}<>]/.test(source)) {
    return "";
  }

  try {
    const decoded = source.startsWith("{")
      ? source
      : globalThis.atob(source.replaceAll(/\s/g, ""));
    const parsed = JSON.parse(decoded);

    return safeMinecraftTextureUrl(parsed?.textures?.SKIN?.url);
  } catch {
    return safeMinecraftTextureUrl(source);
  }
}

function safeMinecraftTextureUrl(value) {
  try {
    const url = new URL(String(value));

    if (url.hostname !== "textures.minecraft.net") {
      return "";
    }

    if (!/^\/texture\/[a-z0-9]+$/i.test(url.pathname)) {
      return "";
    }

    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.port = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
