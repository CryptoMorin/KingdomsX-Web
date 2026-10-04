import { Buffer } from "buffer";
import { Gunzip } from "fflate";
import legacyMinecraftData from "minecraft-data/minecraft-data/data/pc/common/legacy.json";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_NBT_BYTES = 16 * 1024 * 1024;
const MAX_AXIS_LENGTH = 256;
const MAX_VOLUME = 256 * 1024;
const EMPTY_BLOCKS = new Set(["air", "cave_air", "void_air", "structure_void"]);
const LEGACY_BLOCKS = legacyMinecraftData.blocks;
const LEGACY_SKULL_TYPES = [
  ["skeleton_skull", "skeleton_wall_skull"],
  ["wither_skeleton_skull", "wither_skeleton_wall_skull"],
  ["zombie_head", "zombie_wall_head"],
  ["player_head", "player_wall_head"],
  ["creeper_head", "creeper_wall_head"],
  ["dragon_head", "dragon_wall_head"]
];

let prismarinePromise;

export async function parseWorldEditSchematic(input) {
  const bytes = toBytes(input);

  if (!bytes.length) {
    throw new Error("This schematic is empty.");
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("This schematic is larger than the 2 MiB preview limit.");
  }

  const { nbt, Schematic } = await loadPrismarine();

  try {
    const decompressed = decompressNbt(bytes);
    const buffer = Buffer.from(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    const parsed = nbt.parseUncompressed(buffer);
    const document = nbt.simplify(parsed);

    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("The root NBT tag is not a compound.");
    }

    const root = schematicRoot(document);
    const dimensions = validateDimensions(root);
    const format = schematicFormat(root);
    assertVanillaPalette(root);
    const warnings = [];
    let blocks;

    if (format.type === "mcedit") {
      warnings.push(...legacyBlockWarnings(root));
      const schematic = await Schematic.read(buffer);
      assertLoadedDimensions(schematic, dimensions);
      blocks = prismarineBlocks(schematic, root);
    } else {
      blocks = spongeBlocks(root, dimensions);
    }

    return {
      format: format.type === "sponge" ? `SPONGE_V${format.version}_SCHEMATIC` : "MCEDIT_SCHEMATIC",
      dataVersion: numericTag(tag(root, "DataVersion"), -1),
      dimensions,
      origin: schematicOrigin(root),
      blocks,
      skinTexture: findSkinTexture(schematicBlockEntities(root)),
      warnings
    };
  } catch (error) {
    throw new Error(`This schematic could not be read: ${error.message}`);
  }
}

async function loadPrismarine() {
  if (!prismarinePromise) {
    if (!globalThis.Buffer) {
      globalThis.Buffer = Buffer;
    }

    prismarinePromise = Promise.all([
      import("prismarine-nbt"),
      import("prismarine-schematic")
    ]).then(([nbt, schematic]) => ({
      nbt: nbt.default ?? nbt,
      Schematic: (schematic.default ?? schematic).Schematic
    })).catch((error) => {
      prismarinePromise = undefined;
      throw error;
    });
  }

  return prismarinePromise;
}

function legacyBlockWarnings(root) {
  const blocks = tag(root, "Blocks");
  const data = tag(root, "Data");
  const addBlocks = tag(root, "AddBlocks");
  const unknownBlocks = new Map();
  const unknownVariants = new Map();

  for (let index = 0; index < blocks.length; index += 1) {
    let id = blocks[index] & 0xff;

    if (addBlocks) {
      const extension = addBlocks[index >> 1] & 0xff;
      id += (index & 1 ? extension & 0x0f : extension >> 4) << 8;
    }

    const metadata = data[index] & 0xff;
    const state = `${id}:${metadata}`;

    if (LEGACY_BLOCKS[state]) {
      continue;
    }

    const unsupported = LEGACY_BLOCKS[`${id}:0`] ? unknownVariants : unknownBlocks;
    unsupported.set(state, (unsupported.get(state) ?? 0) + 1);
  }

  const warnings = [];

  if (unknownBlocks.size) {
    warnings.push(
      `Some legacy blocks could not be identified and are shown as stone: ${legacyStateSummary(unknownBlocks)}.`
    );
  }

  if (unknownVariants.size) {
    warnings.push(
      `Some legacy block variants could not be identified exactly and use their default state: ${legacyStateSummary(unknownVariants)}.`
    );
  }

  return warnings;
}

function legacyStateSummary(states) {
  const entries = [...states.entries()];
  const shown = entries.slice(0, 5).map(([state, count]) => `${state} (${count.toLocaleString("en-US")})`);

  if (entries.length > shown.length) {
    shown.push(`${entries.length - shown.length} more`);
  }

  return shown.join(", ");
}

function prismarineBlocks(schematic, root) {
  const entities = schematicBlockEntities(root);
  const legacySkulls = legacySkullOverrides(entities);
  const blocks = [];
  const start = schematic.start();

  for (let y = 0; y < schematic.size.y; y += 1) {
    for (let z = 0; z < schematic.size.z; z += 1) {
      for (let x = 0; x < schematic.size.x; x += 1) {
        const source = schematic.getBlock(start.offset(x, y, z));

        if (!source?.name) {
          throw new Error("This schematic's block data does not match its dimensions.");
        }

        const pos = [x, y, z];
        const block = legacySkullBlock(normalizeLegacyBlock({
          type: source.name,
          properties: source.getProperties()
        }), pos, legacySkulls);
        const { namespace, id } = blockName(block.type);

        if (EMPTY_BLOCKS.has(id)) {
          continue;
        }

        blocks.push({
          namespace,
          id,
          properties: { ...block.properties },
          pos
        });
      }
    }
  }

  return blocks;
}

function normalizeLegacyBlock(block) {
  const properties = Object.fromEntries(
    Object.entries(block.properties ?? {}).map(([name, value]) => [name, String(value)])
  );

  // Prismarine defaults missing MCEdit properties to waterlogged
  if ("waterlogged" in properties) {
    properties.waterlogged = "false";
  }

  // Old wall booleans need the newer none low tall states and a center post
  if (block.type.endsWith("_wall")) {
    for (const direction of ["north", "east", "south", "west"]) {
      properties[direction] = properties[direction] === "true" ? "low" : "none";
    }

    properties.up = "true";
  }

  return { ...block, properties };
}

function validateDimensions(root) {
  const width = numericTag(tag(root, "Width"));
  const height = numericTag(tag(root, "Height"));
  const length = numericTag(tag(root, "Length"));

  if (![width, height, length].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("This schematic has invalid dimensions.");
  }

  if ([width, height, length].some((value) => value > MAX_AXIS_LENGTH)) {
    throw new Error(`This schematic exceeds the ${MAX_AXIS_LENGTH}-block preview limit on one axis.`);
  }

  const volume = width * height * length;

  if (volume > MAX_VOLUME) {
    throw new Error(`This schematic exceeds the ${MAX_VOLUME.toLocaleString("en-US")}-block preview volume limit.`);
  }

  return { width, height, length };
}

function assertLoadedDimensions(schematic, expected) {
  if (
    schematic.size.x !== expected.width
    || schematic.size.y !== expected.height
    || schematic.size.z !== expected.length
    || schematic.blocks.length !== expected.width * expected.height * expected.length
  ) {
    throw new Error("The loaded schematic dimensions do not match its NBT header.");
  }
}

function schematicFormat(root) {
  const version = numericTag(tag(root, "Version"), -1);
  const blockContainer = tag(root, "Blocks");
  const palette = tag(blockContainer, "Palette") ?? tag(root, "Palette");
  const blockData = tag(blockContainer, "Data") ?? tag(root, "BlockData");

  if (Number.isInteger(version) && version >= 1 && version <= 3 && palette && blockData) {
    return { type: "sponge", version };
  }

  if (tag(root, "Materials") === "Alpha" && tag(root, "Blocks") && tag(root, "Data")) {
    return { type: "mcedit" };
  }

  throw new Error("Only Sponge v1-v3 and legacy MCEdit schematics are supported.");
}

function spongeBlocks(root, dimensions) {
  const blockContainer = tag(root, "Blocks");
  const palette = tag(blockContainer, "Palette") ?? tag(root, "Palette");
  const blockData = tag(blockContainer, "Data") ?? tag(root, "BlockData");
  const blockPalette = [];

  for (const [blockState, rawIndex] of Object.entries(palette)) {
    const index = numericTag(rawIndex, -1);

    if (!Number.isInteger(index) || index < 0 || blockPalette[index]) {
      throw new Error("This schematic has an invalid Sponge block palette.");
    }

    blockPalette[index] = parseBlockState(blockState);
  }

  const indices = decodeVarints(blockData);
  const volume = dimensions.width * dimensions.height * dimensions.length;

  if (indices.length !== volume) {
    throw new Error("This schematic's block data does not match its dimensions.");
  }

  const blocks = [];

  for (let index = 0; index < indices.length; index += 1) {
    const block = blockPalette[indices[index]];

    if (!block) {
      throw new Error("This schematic references a missing palette entry.");
    }

    if (EMPTY_BLOCKS.has(block.id)) {
      continue;
    }

    const x = index % dimensions.width;
    const z = Math.floor(index / dimensions.width) % dimensions.length;
    const y = Math.floor(index / (dimensions.width * dimensions.length));
    blocks.push({ ...block, pos: [x, y, z] });
  }

  return blocks;
}

function parseBlockState(value) {
  const source = String(value);
  const openingBracket = source.indexOf("[");
  const name = openingBracket === -1 ? source : source.slice(0, openingBracket);
  const { namespace, id } = blockName(name);

  if (openingBracket === -1) {
    return { namespace, id, properties: {} };
  }

  if (!source.endsWith("]")) {
    throw new Error("This schematic has an invalid Sponge block state.");
  }

  const propertySource = source.slice(openingBracket + 1, -1);
  const properties = propertySource
    ? Object.fromEntries(propertySource.split(",").map((property) => {
        const separator = property.indexOf("=");

        if (separator <= 0 || separator === property.length - 1) {
          throw new Error("This schematic has an invalid Sponge block state.");
        }

        return [property.slice(0, separator), property.slice(separator + 1)];
      }))
    : {};

  return { namespace, id, properties };
}

function decodeVarints(bytes) {
  const values = [];
  let value = 0;
  let byteCount = 0;

  for (const signedByte of bytes) {
    const byte = signedByte & 0xff;
    value |= (byte & 0x7f) << (byteCount * 7);
    byteCount += 1;

    if (byteCount > 5) {
      throw new Error("This schematic contains an invalid Sponge block index.");
    }

    if ((byte & 0x80) === 0) {
      values.push(value >>> 0);
      value = 0;
      byteCount = 0;
    }
  }

  if (byteCount) {
    throw new Error("This schematic contains an incomplete Sponge block index.");
  }

  return values;
}

function assertVanillaPalette(root) {
  const palette = tag(tag(root, "Blocks"), "Palette") ?? tag(root, "Palette");

  if (!palette || typeof palette !== "object" || Array.isArray(palette)) {
    return;
  }

  const namespaces = new Set();
  const blockStates = palette instanceof Map ? palette.keys() : Object.keys(palette);

  for (const blockState of blockStates) {
    const paletteBlock = String(blockState).split("[", 1)[0];
    const separator = paletteBlock.indexOf(":");

    if (separator !== -1 && paletteBlock.slice(0, separator) !== "minecraft") {
      namespaces.add(paletteBlock.slice(0, separator));
    }
  }

  if (namespaces.size) {
    throw new Error(`This preview supports vanilla blocks only. Found namespaces: ${[...namespaces].sort().join(", ")}.`);
  }
}

function schematicRoot(document) {
  return tag(document, "Schematic") ?? document;
}

function schematicOrigin(root) {
  const spongeOffset = tag(root, "Offset");
  const offset = spongeOffset?.length === 3
    ? [...spongeOffset].map((value) => numericTag(value))
    : ["X", "Y", "Z"].map((axis) => numericTag(tag(root, `WEOffset${axis}`)));

  return offset.map((coordinate) => -coordinate);
}

function schematicBlockEntities(root) {
  const blockContainer = tag(root, "Blocks");

  return tag(blockContainer, "BlockEntities")
    ?? tag(root, "BlockEntities")
    ?? tag(root, "TileEntities")
    ?? [];
}

function legacySkullOverrides(entities) {
  const overrides = new Map();

  for (const entity of entities) {
    const skullType = numericTag(tag(entity, "SkullType"), -1);

    if (!LEGACY_SKULL_TYPES[skullType]) {
      continue;
    }

    const position = entityPosition(entity);

    if (!position) {
      continue;
    }

    overrides.set(position.join(","), {
      rotation: numericTag(tag(entity, "Rot"), 0) & 0x0f,
      type: LEGACY_SKULL_TYPES[skullType]
    });
  }

  return overrides;
}

function legacySkullBlock(block, position, overrides) {
  const override = overrides.get(position.join(","));

  if (!override) {
    return block;
  }

  const wallMounted = block.type.includes("wall_");

  return {
    type: override.type[wallMounted ? 1 : 0],
    properties: wallMounted
      ? { facing: block.properties.facing ?? "north" }
      : { rotation: String(override.rotation) }
  };
}

function entityPosition(entity) {
  const position = tag(entity, "Pos");

  if (position?.length === 3) {
    return [...position].map((value) => numericTag(value));
  }

  const coordinates = ["x", "y", "z"].map((axis) => numericTag(tag(entity, axis), NaN));

  return coordinates.every(Number.isFinite) ? coordinates : null;
}

function findSkinTexture(entities) {
  for (const entity of entities) {
    const data = tag(entity, "Data") ?? entity;
    const profile = tag(data, "profile");
    const modern = tag(profile, "properties")?.find((property) => tag(property, "name") === "textures");
    const modernValue = tag(modern, "value");

    if (modernValue) {
      return modernValue;
    }

    const owner = tag(data, "Owner") ?? tag(data, "SkullOwner");
    const legacy = tag(tag(tag(owner, "Properties"), "textures")?.[0], "Value");

    if (legacy) {
      return legacy;
    }
  }

  return "";
}

function blockName(value) {
  const source = String(value);
  const separator = source.indexOf(":");

  return separator === -1
    ? { namespace: "minecraft", id: source }
    : { namespace: source.slice(0, separator), id: source.slice(separator + 1) };
}

function tag(container, name) {
  if (container instanceof Map) {
    return container.get(name);
  }

  return container?.[name];
}

function numericTag(value, fallback = 0) {
  const numeric = Number(value?.value ?? value);

  return Number.isFinite(numeric) ? numeric : fallback;
}

function decompressNbt(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    if (bytes.byteLength > MAX_NBT_BYTES) {
      throw new Error("This schematic expands beyond the 16 MiB preview limit.");
    }

    return bytes;
  }

  const chunks = [];
  let total = 0;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.byteLength;

    if (total > MAX_NBT_BYTES) {
      throw new Error("This schematic expands beyond the 16 MiB preview limit.");
    }

    chunks.push(chunk.slice());
  });

  gunzip.push(bytes, true);

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function toBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  throw new TypeError("Schematic data must be binary.");
}
