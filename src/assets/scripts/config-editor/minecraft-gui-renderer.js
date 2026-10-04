import {
  materialTextureCandidates,
  normalizeMaterialId,
  playerHeadTextureUrl
} from "./minecraft-assets.js";
import { drawMinecraftText } from "./minecraft-bitmap-font.js";
import { readMinecraftFile, renderMinecraftModel } from "./minecraft-renderer.js";

const GUI_SCALE = 2;
const GUI_WIDTH = 176;
const PLAYER_INVENTORY_HEIGHT = 96;
const GENERIC_PLAYER_SOURCE_Y = 126;
const CONTAINER_TEXTURE_ROOT = "assets/minecraft/textures/gui/container";
const containerImages = new Map();
const fallbackImages = new Map();

const FIXED_CONTAINERS = {
  HOPPER: fixedContainer("hopper", 133, rowSlots(5, 44, 20)),
  DISPENSER: fixedContainer("dispenser", 166, gridSlots(3, 3, 62, 17)),
  DROPPER: fixedContainer("dispenser", 166, gridSlots(3, 3, 62, 17)),
  ANVIL: fixedContainer("anvil", 166, [
    itemSlot(27, 47),
    itemSlot(76, 47),
    itemSlot(134, 47)
  ]),
  FURNACE: fixedContainer("furnace", 166, [
    itemSlot(56, 17),
    itemSlot(56, 53),
    itemSlot(116, 35)
  ]),
  BLAST_FURNACE: fixedContainer("blast_furnace", 166, [
    itemSlot(56, 17),
    itemSlot(56, 53),
    itemSlot(116, 35)
  ]),
  SMOKER: fixedContainer("smoker", 166, [
    itemSlot(56, 17),
    itemSlot(56, 53),
    itemSlot(116, 35)
  ]),
  WORKBENCH: fixedContainer("crafting_table", 166, [
    itemSlot(124, 35),
    ...gridSlots(3, 3, 30, 17)
  ], {
    titleX: 29
  }),
  CRAFTING: fixedContainer("crafting_table", 166, gridSlots(3, 3, 30, 17), {
    titleX: 29
  })
};

export function minecraftGuiLayout(type, rows = 1) {
  const fixed = FIXED_CONTAINERS[String(type).toLocaleUpperCase("en-US")];

  if (fixed) {
    return fixed;
  }

  const visibleRows = Math.min(6, Math.max(1, Number(rows) || 1));
  const topHeight = 18 + visibleRows * 18;

  return {
    type: "CHEST",
    texture: "generic_54",
    width: GUI_WIDTH,
    height: topHeight + PLAYER_INVENTORY_HEIGHT,
    titleX: 8,
    titleY: 6,
    inventoryLabelX: 8,
    inventoryLabelY: topHeight + 2,
    slots: gridSlots(9, visibleRows, 8, 18),
    genericTopHeight: topHeight
  };
}

export function minecraftGuiRenderScale(layoutWidth, displayWidth, pixelRatio = 1) {
  const requiredScale = Number(displayWidth) * Math.max(1, Number(pixelRatio) || 1) / layoutWidth;

  return Math.max(GUI_SCALE, Math.ceil(requiredScale));
}

export async function renderMinecraftGui(canvas, preview, {
  title = preview.title,
  scale = GUI_SCALE
} = {}) {
  const layout = minecraftGuiLayout(preview.type, preview.rows);
  const renderScale = Math.max(GUI_SCALE, Math.ceil(Number(scale) || GUI_SCALE));

  canvas.width = layout.width * renderScale;
  canvas.height = layout.height * renderScale;
  canvas.dataset.minecraftGuiScale = String(renderScale);

  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const background = await containerImage(layout.texture);
  drawBackground(context, background, layout, renderScale);

  await Promise.all([
    drawMinecraftText(context, title, {
      x: layout.titleX,
      y: layout.titleY,
      scale: renderScale,
      maxWidth: layout.width - layout.titleX - 8,
      fit: true,
      minimumScale: 0.65
    }),
    drawMinecraftText(context, "Inventory", {
      x: layout.inventoryLabelX,
      y: layout.inventoryLabelY,
      scale: renderScale,
      maxWidth: layout.width - layout.inventoryLabelX - 8
    })
  ]);

  await drawItems(canvas, preview, layout, renderScale);
  return layout;
}

function fixedContainer(texture, height, slots, {
  titleX = 8,
  titleY = 6
} = {}) {
  return {
    type: texture.toLocaleUpperCase("en-US"),
    texture,
    width: GUI_WIDTH,
    height,
    titleX,
    titleY,
    inventoryLabelX: 8,
    inventoryLabelY: height - 94,
    slots
  };
}

function rowSlots(count, x, y) {
  return Array.from({ length: count }, (_, index) => itemSlot(x + index * 18, y));
}

function gridSlots(columns, rows, x, y) {
  return Array.from({ length: columns * rows }, (_, index) =>
    itemSlot(x + index % columns * 18, y + Math.floor(index / columns) * 18)
  );
}

function itemSlot(itemX, itemY) {
  return {
    itemX,
    itemY,
    x: itemX - 1,
    y: itemY - 1,
    width: 18,
    height: 18
  };
}

function drawBackground(context, image, layout, scale) {
  if (!layout.genericTopHeight) {
    context.drawImage(
      image,
      0,
      0,
      layout.width,
      layout.height,
      0,
      0,
      layout.width * scale,
      layout.height * scale
    );
    return;
  }

  const topHeight = layout.genericTopHeight;
  context.drawImage(
    image,
    0,
    0,
    layout.width,
    topHeight,
    0,
    0,
    layout.width * scale,
    topHeight * scale
  );
  context.drawImage(
    image,
    0,
    GENERIC_PLAYER_SOURCE_Y,
    layout.width,
    PLAYER_INVENTORY_HEIGHT,
    0,
    topHeight * scale,
    layout.width * scale,
    PLAYER_INVENTORY_HEIGHT * scale
  );
}

async function drawItems(canvas, preview, layout, scale) {
  const groups = new Map();

  preview.slots.forEach((slot, index) => {
    const option = slot.options.at(-1);
    const geometry = layout.slots[index];
    const materialSource = Object.hasOwn(option ?? {}, "previewMaterial")
      ? option.previewMaterial
      : option?.material;
    const material = normalizeMaterialId(materialSource);

    if (!option || !geometry || !material) {
      return;
    }

    const skinUrl = material === "player_head"
      ? playerHeadTextureUrl(option.previewSkull || option.representativeSkull || option.skull)
      : "";
    const key = `${material}\u0000${skinUrl}\u0000${JSON.stringify(option.components ?? {})}`;
    const group = groups.get(key) ?? {
      material,
      skinUrl,
      components: option.components ?? {},
      placements: []
    };
    group.placements.push({
      canvas,
      x: geometry.itemX * scale,
      y: geometry.itemY * scale,
      width: 16 * scale,
      height: 16 * scale
    });
    groups.set(key, group);
  });

  await Promise.all([...groups.values()].map(async (group) => {
    try {
      await renderMinecraftModel({
        material: group.material,
        skinUrl: group.skinUrl,
        components: group.components,
        canvas: group.placements,
        width: 16 * scale,
        height: 16 * scale,
        clear: false
      });
    } catch {
      await Promise.all(group.placements.map((placement) =>
        drawFallbackItem(placement, group.material)
      ));
    }
  }));
}

async function drawFallbackItem(placement, material) {
  const image = await firstFallbackImage(materialTextureCandidates(material));

  if (!image) {
    return;
  }

  const context = placement.canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
}

async function containerImage(name) {
  const path = `${CONTAINER_TEXTURE_ROOT}/${name}.png`;
  let image = containerImages.get(path);

  if (!image) {
    image = readMinecraftFile(path).then((contents) => {
      if (!contents) {
        throw new Error(`Minecraft container texture ${name} is unavailable.`);
      }

      return createImageBitmap(new Blob([contents], { type: "image/png" }));
    });
    containerImages.set(path, image);
    image.catch(() => {
      if (containerImages.get(path) === image) {
        containerImages.delete(path);
      }
    });
  }

  return image;
}

async function firstFallbackImage(candidates) {
  for (const url of candidates) {
    let image = fallbackImages.get(url);

    if (!image) {
      image = fetch(url, {
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }).then(async (response) => response.ok
        ? createImageBitmap(await response.blob())
        : null);
      fallbackImages.set(url, image);
    }

    const loaded = await image;

    if (loaded) {
      return loaded;
    }
  }

  return null;
}
