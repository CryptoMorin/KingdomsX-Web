import { minecraftAssetUrl } from "./minecraft-assets.js";

const SOUND_CATALOG_URL = minecraftAssetUrl("sounds.json");
const eventIndexes = new WeakMap();
let soundCatalogRequest = null;

export function loadMinecraftSounds() {
  if (soundCatalogRequest) {
    return soundCatalogRequest;
  }

  soundCatalogRequest = fetch(SOUND_CATALOG_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Minecraft sound catalog returned ${response.status}.`);
      }

      return response.json();
    })
    .then((catalog) => {
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
        throw new Error("Minecraft sound catalog is invalid.");
      }

      return catalog;
    })
    .catch((error) => {
      soundCatalogRequest = null;
      throw error;
    });

  return soundCatalogRequest;
}

export function minecraftSoundValueStyle(sound) {
  const source = String(sound ?? "").trim().toLocaleLowerCase("en-US");

  if (source.startsWith("minecraft:")) {
    return "namespaced";
  }

  if (!source.includes(":")) {
    return source.includes(".") ? "dotted" : "bukkit";
  }

  return "bukkit";
}

export function minecraftSoundValues(catalog, style = "dotted") {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return [];
  }

  const eventIds = Object.keys(catalog).sort((left, right) => left.localeCompare(right));

  return style === "namespaced"
    ? eventIds.map((eventId) => `minecraft:${eventId}`)
    : eventIds;
}

export function minecraftSoundEventId(catalog, sound) {
  if (!catalog || typeof catalog !== "object") {
    return "";
  }

  const source = String(sound ?? "").trim();
  const separator = source.indexOf(":");

  if (separator >= 0 && source.slice(0, separator).toLocaleLowerCase("en-US") !== "minecraft") {
    return "";
  }

  const id = (separator >= 0 ? source.slice(separator + 1) : source).toLocaleLowerCase("en-US");

  if (catalog[id]) {
    return id;
  }

  return soundEventIndex(catalog).get(id.toLocaleUpperCase("en-US")) ?? "";
}

export function resolveMinecraftSound(catalog, sound, random = Math.random) {
  const eventId = minecraftSoundEventId(catalog, sound);

  if (!eventId) {
    return null;
  }

  return resolveSoundEvent(catalog, eventId, random, new Set());
}

export function minecraftSoundPlayback(selection, { volume = "", pitch = "" } = {}) {
  if (!selection) {
    return null;
  }

  return {
    url: selection.url,
    volume: clamp(multiplier(volume) * selection.volume, 0, 1),
    playbackRate: clamp(multiplier(pitch) * selection.pitch, 0.0625, 16)
  };
}

function soundEventIndex(catalog) {
  let index = eventIndexes.get(catalog);

  if (index) {
    return index;
  }

  index = new Map(Object.keys(catalog).map((eventId) => [
    eventId.toLocaleUpperCase("en-US").replaceAll(".", "_"),
    eventId
  ]));
  eventIndexes.set(catalog, index);
  return index;
}

function resolveSoundEvent(catalog, eventId, random, visited) {
  if (visited.has(eventId)) {
    return null;
  }

  const sounds = catalog[eventId]?.sounds;

  if (!Array.isArray(sounds) || !sounds.length) {
    return null;
  }

  const nextVisited = new Set(visited).add(eventId);
  const selected = weightedSound(sounds, random);
  const descriptor = typeof selected === "string" ? { name: selected } : selected;

  if (!descriptor || typeof descriptor.name !== "string") {
    return null;
  }

  const volume = multiplier(descriptor.volume);
  const pitch = multiplier(descriptor.pitch);

  if (descriptor.type === "event") {
    const referencedId = minecraftSoundEventId(catalog, descriptor.name);
    const referenced = referencedId && resolveSoundEvent(catalog, referencedId, random, nextVisited);

    return referenced ? {
      ...referenced,
      volume: referenced.volume * volume,
      pitch: referenced.pitch * pitch
    } : null;
  }

  const path = soundFilePath(descriptor.name);

  return path ? {
    eventId,
    url: minecraftAssetUrl(`sounds/${path}.ogg`),
    volume,
    pitch
  } : null;
}

function weightedSound(sounds, random) {
  const weights = sounds.map((sound) => {
    const weight = Number(typeof sound === "object" && sound ? sound.weight : 1);

    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = clamp(Number(random()), 0, 0.999999999999) * total;

  for (let index = 0; index < sounds.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) {
      return sounds[index];
    }
  }

  return sounds.at(-1);
}

function soundFilePath(value) {
  const source = String(value).trim();
  const separator = source.indexOf(":");

  if (separator >= 0 && source.slice(0, separator) !== "minecraft") {
    return "";
  }

  const path = separator >= 0 ? source.slice(separator + 1) : source;

  if (!/^[a-z0-9_./-]+$/.test(path) || path.split("/").includes("..")) {
    return "";
  }

  return path.replace(/\.ogg$/i, "");
}

function multiplier(value) {
  if (value === "" || value === undefined || value === null) {
    return 1;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : 1;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
