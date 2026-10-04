import {
  MINECRAFT_ASSET_ORIGIN,
  MINECRAFT_ASSET_VERSION,
  MINECRAFT_RENDERER_ASSET_URL,
  minecraftModelRenderTarget
} from "./minecraft-assets.js";

const assetRequests = new Map();
const directoryRequests = new Map();
const skinAssets = new Map();
const RENDERER_OVERRIDE_FILES = new Map([
  ["assets/minecraft/items/clock.json", JSON.stringify({
    model: { type: "minecraft:model", model: "kingdomsx:item/clock" }
  })],
  ["assets/kingdomsx/models/item/clock.json", JSON.stringify({
    parent: "minecraft:item/generated",
    textures: { layer0: "minecraft:item/clock_00" }
  })],
  ["assets/minecraft/blockstates/beacon.json", JSON.stringify({
    variants: { "": { model: "kingdomsx:block/beacon" } }
  })],
  ["assets/kingdomsx/models/block/beacon.json", JSON.stringify({
    textures: {
      glass: "minecraft:block/glass",
      obsidian: "minecraft:block/obsidian",
      core: "minecraft:block/light_blue_concrete"
    },
    elements: [
      boxElement([0, 0, 0], [16, 16, 16], "#glass"),
      boxElement([2, 0.1, 2], [14, 3, 14], "#obsidian"),
      boxElement([3, 3, 3], [13, 14, 13], "#core")
    ]
  })]
]);
const RENDERER_OVERRIDE_DIRECTORIES = new Map([
  ["", ["assets"]],
  ["assets", ["kingdomsx", "minecraft"]],
  ["assets/minecraft", ["blockstates", "items"]],
  ["assets/minecraft/blockstates", ["beacon.json"]],
  ["assets/minecraft/items", ["clock.json"]],
  ["assets/kingdomsx", ["models"]],
  ["assets/kingdomsx/models", ["block", "item"]],
  ["assets/kingdomsx/models/block", ["beacon.json"]],
  ["assets/kingdomsx/models/item", ["clock.json"]]
]);

let rendererPromise;
let vanillaAssetsPromise;

export function canRenderMinecraftModels() {
  return typeof document !== "undefined"
    && typeof OffscreenCanvas !== "undefined"
    && typeof WebGLRenderingContext !== "undefined";
}

async function renderMinecraftItem({
  material,
  canvas,
  skinUrl = "",
  width = 128,
  height = 128,
  x,
  y,
  clear,
  components = {}
}) {
  const { renderer, assets } = await renderingContext(skinUrl);

  return renderer.renderItem({
    id: material,
    assets,
    canvas,
    width,
    height,
    x,
    y,
    clear,
    components,
    version: MINECRAFT_ASSET_VERSION
  });
}

async function renderMinecraftBlock({
  material,
  canvas,
  width = 128,
  height = 128,
  x,
  y,
  clear
}) {
  const { renderer, assets } = await renderingContext();

  return renderer.renderBlock({
    id: material,
    assets,
    canvas,
    width,
    height,
    x,
    y,
    clear,
    version: MINECRAFT_ASSET_VERSION
  });
}

export function renderMinecraftModel(options) {
  const render = minecraftModelRenderTarget(options.material) === "block"
    ? renderMinecraftBlock
    : renderMinecraftItem;

  return render(options);
}

export async function readMinecraftFile(filePath) {
  const { renderer, assets } = await renderingContext();

  return renderer.readFile(filePath, assets);
}

export async function createMinecraftBlockScene({ blocks, skinUrl = "" }) {
  const { renderer, assets } = await renderingContext(skinUrl);

  return renderer.createScene(assets, blocks, {
    animate: true,
    version: MINECRAFT_ASSET_VERSION
  });
}

export function minecraftAssetHandler() {
  return {
    async read(filePath) {
      if (!packPathSupported(filePath)) {
        return null;
      }

      return requestMinecraftAsset(filePath);
    },
    async list(directory) {
      if (directory === "") {
        return ["assets", "data"];
      }

      if (directory === "assets" || directory === "data") {
        return ["minecraft"];
      }

      if (!packDirectorySupported(directory)) {
        return [];
      }

      return requestMinecraftDirectory(directory);
    }
  };
}

async function renderingContext(skinUrl = "") {
  const renderer = await loadRenderer();
  const assets = skinUrl
    ? await assetsForSkin(renderer, skinUrl)
    : await vanillaAssets(renderer);

  return { renderer, assets };
}

async function loadRenderer() {
  if (!rendererPromise) {
    rendererPromise = Promise.all([
      import("../../vendor/block-model-renderer/block-model-renderer.min.js"),
      import("three")
    ]).then(([renderer, three]) => {
      renderer.configure({
        assetsUrl: MINECRAFT_RENDERER_ASSET_URL,
        three
      });
      return renderer;
    }).catch((error) => {
      rendererPromise = undefined;
      throw error;
    });
  }

  return rendererPromise;
}

function boxElement(from, to, texture) {
  return {
    from,
    to,
    faces: Object.fromEntries(
      ["down", "up", "north", "south", "west", "east"].map((face) => [face, { texture }])
    )
  };
}

function vanillaAssets(renderer) {
  if (!vanillaAssetsPromise) {
    vanillaAssetsPromise = renderer.prepareAssets([
      rendererOverrideAssets(),
      minecraftAssetHandler()
    ], {
      cache: true,
      version: MINECRAFT_ASSET_VERSION
    }).catch((error) => {
      vanillaAssetsPromise = undefined;
      throw error;
    });
  }

  return vanillaAssetsPromise;
}

function assetsForSkin(renderer, skinUrl) {
  let assets = skinAssets.get(skinUrl);

  if (!assets) {
    assets = renderer.prepareAssets([
      playerSkinHandler(skinUrl),
      rendererOverrideAssets(),
      minecraftAssetHandler()
    ], {
      cache: true,
      version: MINECRAFT_ASSET_VERSION
    });
    skinAssets.set(skinUrl, assets);
    assets.catch(() => {
      if (skinAssets.get(skinUrl) === assets) {
        skinAssets.delete(skinUrl);
      }
    });
  }

  return assets;
}

function rendererOverrideAssets() {
  return {
    read(filePath) {
      return RENDERER_OVERRIDE_FILES.get(filePath) ?? null;
    },
    list(directory) {
      return RENDERER_OVERRIDE_DIRECTORIES.get(directory) ?? [];
    }
  };
}

function playerSkinHandler(skinUrl) {
  return {
    async read(filePath) {
      if (filePath !== "assets/minecraft/textures/entity/player/wide/steve.png") {
        return null;
      }

      return requestAsset(skinUrl);
    },
    list(directory) {
      return directory === "assets" ? ["minecraft"] : [];
    }
  };
}

function packPathSupported(filePath) {
  return /^(?:assets|data)\/minecraft\//.test(String(filePath));
}

function packDirectorySupported(directory) {
  return /^(?:assets|data)\/minecraft(?:\/|$)/.test(String(directory));
}

async function requestMinecraftAsset(filePath) {
  const path = String(filePath).replace(/^\/+/, "");
  const separator = path.lastIndexOf("/");
  const directory = separator === -1 ? "" : path.slice(0, separator);
  const fileName = path.slice(separator + 1);
  const entries = await requestMinecraftDirectory(directory);

  if (!entries.includes(fileName)) {
    return null;
  }

  return requestAsset(`${MINECRAFT_ASSET_ORIGIN}/${MINECRAFT_ASSET_VERSION}/${path}`);
}

function requestMinecraftDirectory(directory) {
  const path = String(directory).replace(/^\/+|\/+$/g, "");
  let request = directoryRequests.get(path);

  if (!request) {
    request = knownDirectory(path).then((exists) => {
      if (!exists) {
        return null;
      }

      return requestAsset(`${MINECRAFT_ASSET_ORIGIN}/${MINECRAFT_ASSET_VERSION}/${path}/_list.json`);
    }).then((contents) => {
      if (!contents) {
        return [];
      }

      const listing = JSON.parse(new TextDecoder().decode(contents));

      return [...(listing.directories ?? []), ...(listing.files ?? [])];
    });
    directoryRequests.set(path, request);
    request.catch(() => {
      if (directoryRequests.get(path) === request) {
        directoryRequests.delete(path);
      }
    });
  }

  return request;
}

async function knownDirectory(path) {
  if (path === "assets/minecraft" || path === "data/minecraft") {
    return true;
  }

  const separator = path.lastIndexOf("/");

  if (separator === -1) {
    return false;
  }

  const parent = path.slice(0, separator);
  const name = path.slice(separator + 1);

  return (await requestMinecraftDirectory(parent)).includes(name);
}

function requestAsset(url) {
  let request = assetRequests.get(url);

  if (!request) {
    request = fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "force-cache",
      referrerPolicy: "no-referrer"
    }).then(async (response) => {
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }

      if (response.status >= 500 || response.status === 429) {
        throw new Error(`Minecraft asset request failed with status ${response.status}.`);
      }

      return null;
    });
    assetRequests.set(url, request);
    request.catch(() => {
      if (assetRequests.get(url) === request) {
        assetRequests.delete(url);
      }
    });
  }

  return request;
}
