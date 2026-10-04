import * as THREE from "three";

import { drawMinecraftText, measureMinecraftTextBounds } from "./minecraft-bitmap-font.js";

const BLOCK_SIZE = 16;
const HALF_BLOCK = BLOCK_SIZE / 2;
const TEXTURE_SCALE = 3;
const LINE_HEIGHT = 10;
const HORIZONTAL_PADDING = 3;
const VERTICAL_PADDING = 2;
const WORLD_UNITS_PER_FONT_PIXEL = 0.5;

export async function createMinecraftHolograms(holograms, {
  origin = [0, 0, 0]
} = {}) {
  const group = new THREE.Group();
  const resources = [];

  for (const hologram of holograms ?? []) {
    const sprite = await hologramSprite(hologram);
    const [x, y, z] = minecraftHologramPosition(origin, hologram.offset);
    sprite.position.set(x, y, z);
    group.add(sprite);
    resources.push({ texture: sprite.material.map, material: sprite.material });
  }

  return {
    group,
    dispose() {
      group.removeFromParent();

      for (const { texture, material } of resources) {
        texture.dispose();
        material.dispose();
      }
    }
  };
}

async function hologramSprite({ lines, background }) {
  const metrics = await Promise.all(lines.map((line) => measureMinecraftTextBounds(line)));
  const widths = metrics.map(({ width }) => width);
  const contentWidth = Math.max(1, ...widths);
  const logicalWidth = contentWidth + HORIZONTAL_PADDING * 2;
  const logicalHeight = lines.length * LINE_HEIGHT + VERTICAL_PADDING * 2;
  const canvas = new OffscreenCanvas(
    Math.ceil(logicalWidth * TEXTURE_SCALE),
    Math.ceil(logicalHeight * TEXTURE_SCALE)
  );
  const context = canvas.getContext("2d");

  const [red, green, blue, alpha] = background;
  context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < lines.length; index += 1) {
    const x = HORIZONTAL_PADDING + (contentWidth - widths[index]) / 2;
    const lineTop = VERTICAL_PADDING + index * LINE_HEIGHT;
    const textHeight = metrics[index].bottom - metrics[index].top;
    const y = lineTop + (LINE_HEIGHT - textHeight) / 2 - metrics[index].top;
    await drawMinecraftText(context, lines[index], {
      x,
      y,
      scale: TEXTURE_SCALE,
      color: "#ffffff"
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(
    logicalWidth * WORLD_UNITS_PER_FONT_PIXEL,
    logicalHeight * WORLD_UNITS_PER_FONT_PIXEL,
    1
  );
  return sprite;
}

function minecraftHologramPosition(origin, offset) {
  const schematicOrigin = validVector(origin) ? origin : [0, 0, 0];
  const configuredOffset = validVector(offset) ? offset : [0, 0, 0];

  // Kingdoms offsets undo X and Z centering while Y starts at the bottom face
  return [
    (schematicOrigin[0] + configuredOffset[0]) * BLOCK_SIZE,
    (schematicOrigin[1] + configuredOffset[1]) * BLOCK_SIZE - HALF_BLOCK,
    (schematicOrigin[2] + configuredOffset[2]) * BLOCK_SIZE
  ];
}

function validVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
