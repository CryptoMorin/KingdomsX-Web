import { parseMessagePreview } from "./message-preview.js";
import { readMinecraftFile } from "./minecraft-renderer.js";

const DEFAULT_FONT = "minecraft:default";
const DEFAULT_COLOR = "#404040";
const fontPromises = new Map();

export async function drawMinecraftText(context, source, {
  x = 0,
  y = 0,
  scale = 2,
  color = DEFAULT_COLOR,
  maxWidth = Infinity,
  fit = false,
  minimumScale = 0.65,
  macros = null
} = {}) {
  const font = await minecraftFont(DEFAULT_FONT);
  const line = parseMessagePreview(source, { macros }).lines[0] ?? [];
  const width = lineWidth(font, line);
  const textScale = fit ? minecraftTextScale(width, maxWidth, minimumScale) : 1;
  const sourceMaxWidth = maxWidth / textScale;
  let cursor = 0;

  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(x * scale, y * scale);
  context.scale(textScale, textScale);

  outer:
  for (const segment of line) {
    for (const sourceCharacter of Array.from(segment.text)) {
      const character = segment.style.obfuscated ? "?" : sourceCharacter;
      const glyph = font.glyphs.get(character) ?? font.glyphs.get("?");
      const advance = font.spaces.get(character) ?? glyph?.advance ?? 4;
      const boldAdvance = segment.style.bold ? 1 : 0;

      if (cursor + advance + boldAdvance > sourceMaxWidth) {
        break outer;
      }

      if (glyph) {
        const glyphColor = segment.style.color || color;
        drawGlyph(context, font, glyph, cursor, 0, glyphColor, segment.style, scale);
      }

      if (segment.style.strike) {
        drawLine(context, cursor, 4, advance + boldAdvance, segment.style.color || color, scale);
      }

      if (segment.style.underline) {
        drawLine(context, cursor, 8, advance + boldAdvance, segment.style.color || color, scale);
      }

      cursor += advance + boldAdvance;
    }
  }

  context.restore();
  return cursor * textScale;
}

export async function measureMinecraftTextBounds(source, { macros = null } = {}) {
  const font = await minecraftFont(DEFAULT_FONT);
  const line = parseMessagePreview(source, { macros }).lines[0] ?? [];

  return lineBounds(font, line);
}

export function minecraftTextScale(width, maxWidth, minimumScale = 0.65) {
  if (!Number.isFinite(maxWidth) || width <= maxWidth || width <= 0) {
    return 1;
  }

  return Math.max(minimumScale, maxWidth / width);
}

function lineWidth(font, line) {
  return lineBounds(font, line).width;
}

function lineBounds(font, line) {
  let width = 0;
  let top = Infinity;
  let bottom = -Infinity;

  for (const segment of line) {
    for (const sourceCharacter of Array.from(segment.text)) {
      const character = segment.style.obfuscated ? "?" : sourceCharacter;
      const glyph = font.glyphs.get(character) ?? font.glyphs.get("?");
      width += (font.spaces.get(character) ?? glyph?.advance ?? 4) + (segment.style.bold ? 1 : 0);

      if (glyph?.visibleTop != null) {
        top = Math.min(top, glyph.visibleTop);
        bottom = Math.max(bottom, glyph.visibleBottom);
      }

      if (segment.style.strike) {
        top = Math.min(top, 4);
        bottom = Math.max(bottom, 5);
      }

      if (segment.style.underline) {
        top = Math.min(top, 8);
        bottom = Math.max(bottom, 9);
      }
    }
  }

  return {
    width,
    top: Number.isFinite(top) ? top : 0,
    bottom: Number.isFinite(bottom) ? bottom : 8
  };
}

async function minecraftFont(id) {
  let font = fontPromises.get(id);

  if (!font) {
    font = loadMinecraftFont(id);
    fontPromises.set(id, font);
    font.catch(() => {
      if (fontPromises.get(id) === font) {
        fontPromises.delete(id);
      }
    });
  }

  return font;
}

async function loadMinecraftFont(id) {
  const providers = [];
  await collectFontProviders(id, providers, new Set());
  const glyphs = new Map();
  const spaces = new Map();
  const coloredGlyphs = new Map();

  for (const provider of providers) {
    if (provider.type === "space") {
      for (const [character, advance] of Object.entries(provider.advances ?? {})) {
        if (!spaces.has(character)) {
          spaces.set(character, Number(advance));
        }
      }

      continue;
    }

    if (provider.type !== "bitmap" || !provider.file || !provider.chars?.length) {
      continue;
    }

    const bitmap = await loadBitmapProvider(provider);

    for (const glyph of bitmap.glyphs) {
      if (glyph.character !== "\0" && !glyphs.has(glyph.character)) {
        glyphs.set(glyph.character, glyph);
      }
    }
  }

  return { glyphs, spaces, coloredGlyphs };
}

async function collectFontProviders(id, target, visited) {
  const normalized = normalizeResourceId(id);

  if (visited.has(normalized)) {
    return;
  }

  visited.add(normalized);

  const definition = await readJson(fontDefinitionPath(normalized));

  for (const provider of definition?.providers ?? []) {
    if (provider.type === "reference" && provider.id) {
      await collectFontProviders(provider.id, target, visited);
    } else {
      target.push(provider);
    }
  }
}

async function loadBitmapProvider(provider) {
  const contents = await readMinecraftFile(texturePath(provider.file));

  if (!contents) {
    throw new Error(`Minecraft font texture ${provider.file} is unavailable.`);
  }

  const image = await createImageBitmap(new Blob([contents], { type: "image/png" }));
  const rows = provider.chars.length;
  const columns = Math.max(...provider.chars.map((row) => Array.from(row).length));
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;
  const displayHeight = Number(provider.height ?? 8);
  const scale = displayHeight / cellHeight;
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const glyphs = [];

  provider.chars.forEach((row, rowIndex) => {
    Array.from(row).forEach((character, columnIndex) => {
      const sourceX = columnIndex * cellWidth;
      const sourceY = rowIndex * cellHeight;
      const visible = glyphBounds(pixels, image.width, sourceX, sourceY, cellWidth, cellHeight);
      const glyphTop = 7 - Number(provider.ascent ?? 7);
      glyphs.push({
        character,
        bitmap: provider.file,
        image,
        sourceX,
        sourceY,
        sourceWidth: cellWidth,
        sourceHeight: cellHeight,
        width: cellWidth * scale,
        height: displayHeight,
        top: glyphTop,
        visibleTop: visible ? glyphTop + visible.top * scale : null,
        visibleBottom: visible ? glyphTop + visible.bottom * scale : null,
        advance: visible ? visible.right * scale + 1 : 4
      });
    });
  });

  return { glyphs };
}

function drawGlyph(context, font, glyph, x, y, color, style, scale) {
  const image = coloredGlyph(font, glyph, color);
  const left = x * scale;
  const top = (y + glyph.top) * scale;
  const width = glyph.width * scale;
  const height = glyph.height * scale;

  context.save();

  if (style.italic) {
    context.translate(left + height * 0.2, top);
    context.transform(1, 0, -0.25, 1, 0, 0);
    context.drawImage(image, 0, 0, width, height);

    if (style.bold) {
      context.drawImage(image, scale, 0, width, height);
    }
  } else {
    context.drawImage(image, left, top, width, height);

    if (style.bold) {
      context.drawImage(image, left + scale, top, width, height);
    }
  }

  context.restore();
}

function coloredGlyph(font, glyph, color) {
  const key = `${glyph.bitmap}:${glyph.sourceX}:${glyph.sourceY}:${color}`;
  let canvas = font.coloredGlyphs.get(key);

  if (canvas) {
    return canvas;
  }

  canvas = new OffscreenCanvas(glyph.sourceWidth, glyph.sourceHeight);
  const context = canvas.getContext("2d");
  context.drawImage(
    glyph.image,
    glyph.sourceX,
    glyph.sourceY,
    glyph.sourceWidth,
    glyph.sourceHeight,
    0,
    0,
    glyph.sourceWidth,
    glyph.sourceHeight
  );
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  font.coloredGlyphs.set(key, canvas);
  return canvas;
}

function drawLine(context, x, y, width, color, scale) {
  context.fillStyle = color;
  context.fillRect(x * scale, y * scale, width * scale, scale);
}

function glyphBounds(pixels, imageWidth, x, y, width, height) {
  let right = 0;
  let top = height;
  let bottom = 0;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (pixels[((y + row) * imageWidth + x + column) * 4 + 3]) {
        right = Math.max(right, column + 1);
        top = Math.min(top, row);
        bottom = Math.max(bottom, row + 1);
      }
    }
  }

  return bottom ? { right, top, bottom } : null;
}

async function readJson(path) {
  const contents = await readMinecraftFile(path);

  return contents ? JSON.parse(new TextDecoder().decode(contents)) : null;
}

function fontDefinitionPath(id) {
  const [namespace, resource] = normalizeResourceId(id).split(":", 2);

  return `assets/${namespace}/font/${resource}.json`;
}

function texturePath(id) {
  const [namespace, resource] = normalizeResourceId(id).split(":", 2);

  return `assets/${namespace}/textures/${resource}`;
}

function normalizeResourceId(id) {
  const source = String(id);

  return source.includes(":") ? source : `minecraft:${source}`;
}
