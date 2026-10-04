import { renderMinecraftModel } from "./minecraft-renderer.js";

export const MINECRAFT_MODEL_ICON_SIZE = 48;
const modelIcons = new Map();

export async function drawMinecraftModelIcon(canvas, material, {
  skinUrl = "",
  components = {}
} = {}) {
  const source = await renderedModel(material, skinUrl, components);
  canvas.width = MINECRAFT_MODEL_ICON_SIZE;
  canvas.height = MINECRAFT_MODEL_ICON_SIZE;

  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, MINECRAFT_MODEL_ICON_SIZE, MINECRAFT_MODEL_ICON_SIZE);
  context.drawImage(source, 0, 0, MINECRAFT_MODEL_ICON_SIZE, MINECRAFT_MODEL_ICON_SIZE);
}

async function renderedModel(material, skinUrl, components) {
  const key = `${material}\u0000${skinUrl}\u0000${JSON.stringify(components)}`;
  let icon = modelIcons.get(key);

  if (!icon) {
    icon = renderModel(material, skinUrl, components);
    modelIcons.set(key, icon);
    icon.catch(() => {
      if (modelIcons.get(key) === icon) {
        modelIcons.delete(key);
      }
    });
  }

  return icon;
}

async function renderModel(material, skinUrl, components) {
  return renderMinecraftModel({
    material,
    skinUrl,
    components,
    width: MINECRAFT_MODEL_ICON_SIZE,
    height: MINECRAFT_MODEL_ICON_SIZE
  });
}
