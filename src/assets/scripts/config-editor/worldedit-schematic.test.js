import { gzipSync } from "fflate";
import nbt from "prismarine-nbt";
import { describe, expect, it } from "vitest";
import { parseWorldEditSchematic } from "./worldedit-schematic.js";

describe("WorldEdit schematic preview parsing", () => {
  it.each([1, 2])("reads Sponge v%s palettes and block properties", async (version) => {
    const root = nbt.comp({
      Version: nbt.int(version),
      DataVersion: nbt.int(1631),
      Width: nbt.short(2),
      Height: nbt.short(1),
      Length: nbt.short(1),
      Offset: nbt.intArray([-1, 2, -3]),
      Palette: nbt.comp({
        "minecraft:air": nbt.int(0),
        "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]": nbt.int(1)
      }),
      BlockData: nbt.byteArray([0, 1])
    }, "Schematic");

    const preview = await parseWorldEditSchematic(gzipSync(nbt.writeUncompressed(root)));

    expect(preview.format).toBe(`SPONGE_V${version}_SCHEMATIC`);
    expect(preview.origin).toEqual([1, -2, 3]);
    expect(preview.blocks).toEqual([{
      namespace: "minecraft",
      id: "oak_stairs",
      properties: {
        facing: "east",
        half: "bottom",
        shape: "straight",
        waterlogged: "false"
      },
      pos: [1, 0, 0]
    }]);
  });

  it("maps representative legacy block IDs through Prismarine", async () => {
    const preview = await parseWorldEditSchematic(legacySchematic({
      width: 4,
      blocks: [20, 53, 85, 138],
      offset: [-2, 1, 4]
    }));

    expect(preview.origin).toEqual([2, -1, -4]);
    expect(preview.blocks.map(({ id }) => id)).toEqual([
      "glass",
      "oak_stairs",
      "oak_fence",
      "beacon"
    ]);
  });

  it("normalizes legacy waterlogging and wall states for modern block models", async () => {
    const preview = await parseWorldEditSchematic(legacySchematic({
      width: 3,
      blocks: [53, 85, 139]
    }));

    expect(preview.blocks).toEqual([
      expect.objectContaining({
        id: "oak_stairs",
        properties: expect.objectContaining({ waterlogged: "false" })
      }),
      expect.objectContaining({
        id: "oak_fence",
        properties: {
          east: "false",
          north: "false",
          south: "false",
          waterlogged: "false",
          west: "false"
        }
      }),
      expect.objectContaining({
        id: "cobblestone_wall",
        properties: {
          east: "none",
          north: "none",
          south: "none",
          up: "true",
          waterlogged: "false",
          west: "none"
        }
      })
    ]);
  });

  it("warns when a legacy block has to use a fallback", async () => {
    const preview = await parseWorldEditSchematic(legacySchematic({
      width: 2,
      blocks: [1, 253]
    }));

    expect(preview.blocks.map(({ id }) => id)).toEqual(["stone", "stone"]);
    expect(preview.warnings).toEqual([
      "Some legacy blocks could not be identified and are shown as stone: 253:0 (1)."
    ]);
  });

  it("rejects unsafe dimensions before Prismarine allocates the schematic", async () => {
    await expect(parseWorldEditSchematic(legacySchematic({
      width: 257,
      blocks: [1]
    }))).rejects.toThrow("exceeds the 256-block preview limit");
  });

  it("rejects non-vanilla Sponge palettes instead of rendering the wrong block", async () => {
    const root = nbt.comp({
      Version: nbt.int(2),
      DataVersion: nbt.int(3700),
      Width: nbt.short(1),
      Height: nbt.short(1),
      Length: nbt.short(1),
      Palette: nbt.comp({ "example:machine": nbt.int(0) }),
      BlockData: nbt.byteArray([0])
    }, "Schematic");

    await expect(parseWorldEditSchematic(gzipSync(nbt.writeUncompressed(root))))
      .rejects.toThrow("supports vanilla blocks only. Found namespaces: example");
  });
});

function legacySchematic({ width, blocks, offset = [0, 0, 0] }) {
  const root = nbt.comp({
    Materials: nbt.string("Alpha"),
    Width: nbt.short(width),
    Height: nbt.short(1),
    Length: nbt.short(1),
    Blocks: nbt.byteArray(blocks.map((block) => block > 127 ? block - 256 : block)),
    Data: nbt.byteArray(new Array(blocks.length).fill(0)),
    WEOffsetX: nbt.int(offset[0]),
    WEOffsetY: nbt.int(offset[1]),
    WEOffsetZ: nbt.int(offset[2]),
    Entities: nbt.list(),
    TileEntities: nbt.list()
  }, "Schematic");

  return gzipSync(nbt.writeUncompressed(root));
}
