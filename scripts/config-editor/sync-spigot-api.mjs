import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { unzipSync } from "fflate";

const JAVADOC_ROOT = "https://hub.spigotmc.org/javadocs/bukkit";
const SPIGOT_SNAPSHOT_REPOSITORY = "https://hub.spigotmc.org/nexus/repository/snapshots/org/spigotmc/spigot-api";
const REGISTRIES = [
  ["attribute", "Attribute", "org/bukkit/attribute/Attribute.html"],
  ["attribute-operation", "AttributeOperation", "org/bukkit/attribute/AttributeModifier.Operation.html"],
  ["axolotl-variant", "AxolotlVariant", "org/bukkit/entity/Axolotl.Variant.html"],
  ["bar-color", "BarColor", "org/bukkit/boss/BarColor.html"],
  ["bar-flag", "BarFlag", "org/bukkit/boss/BarFlag.html"],
  ["bar-style", "BarStyle", "org/bukkit/boss/BarStyle.html"],
  ["biome", "Biome", "org/bukkit/block/Biome.html"],
  ["book-generation", "BookGeneration", "org/bukkit/inventory/meta/BookMeta.Generation.html"],
  ["dye-color", "DyeColor", "org/bukkit/DyeColor.html"],
  ["damage-cause", "DamageCause", "org/bukkit/event/entity/EntityDamageEvent.DamageCause.html"],
  ["enchantment", "Enchantment", "org/bukkit/enchantments/Enchantment.html"],
  ["entity-type", "EntityType", "org/bukkit/entity/EntityType.html"],
  ["equipment-slot", "EquipmentSlot", "org/bukkit/inventory/EquipmentSlot.html"],
  ["firework-type", "FireworkType", "org/bukkit/FireworkEffect.Type.html"],
  ["inventory-type", "InventoryType", "org/bukkit/event/inventory/InventoryType.html"],
  ["item-flag", "ItemFlag", "org/bukkit/inventory/ItemFlag.html"],
  ["map-scale", "MapScale", "org/bukkit/map/MapView.Scale.html"],
  ["material", "Material", "org/bukkit/Material.html"],
  ["particle", "Particle", "org/bukkit/Particle.html"],
  ["pattern-type", "PatternType", "org/bukkit/block/banner/PatternType.html"],
  ["potion-effect-type", "PotionEffectType", "org/bukkit/potion/PotionEffectType.html"],
  ["sound", "Sound", "org/bukkit/Sound.html"],
  ["sound-category", "SoundCategory", "org/bukkit/SoundCategory.html"],
  ["tropical-fish-pattern", "TropicalFishPattern", "org/bukkit/entity/TropicalFish.Pattern.html"]
];

// EntityType does not expose the animals relationship used by anti-trample misc upgrade
// This list fills that gap and every entry is checked while the registry is generated
const ANIMAL_ENTITY_TYPES = [
  "ARMADILLO", "AXOLOTL", "BEE", "CAMEL", "CAMEL_HUSK", "CAT", "CHICKEN",
  "COW", "DONKEY", "FOX", "FROG", "GOAT", "HAPPY_GHAST", "HOGLIN", "HORSE",
  "LLAMA", "MOOSHROOM", "MULE", "NAUTILUS", "OCELOT", "PANDA", "PARROT", "PIG",
  "POLAR_BEAR", "RABBIT", "SHEEP", "SKELETON_HORSE", "SNIFFER", "STRIDER",
  "TRADER_LLAMA", "TURTLE", "WOLF", "ZOMBIE_HORSE", "ZOMBIE_NAUTILUS"
];

// Since Kingdoms defaults still use the old effect names, we're adding them as aliases
const LEGACY_ALIASES = new Map([
  ["potion-effect-type", {
    SLOW: "SLOWNESS",
    FAST_DIGGING: "HASTE",
    SLOW_DIGGING: "MINING_FATIGUE",
    INCREASE_DAMAGE: "STRENGTH",
    HEAL: "INSTANT_HEALTH",
    HARM: "INSTANT_DAMAGE",
    JUMP: "JUMP_BOOST",
    CONFUSION: "NAUSEA",
    DAMAGE_RESISTANCE: "RESISTANCE"
  }]
]);

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = path.join(repositoryRoot, "src/data/config-editor/spigot");
const mode = process.argv[2] ?? "write";
const target = await readTarget(path.join(scriptDirectory, "spigot-api-target.json"));
const artifactUrl = `${SPIGOT_SNAPSHOT_REPOSITORY}/${target.apiVersion}/spigot-api-${target.artifactVersion}-javadoc.jar`;

if (!new Set(["write", "check"]).has(mode)) {
  fail("Usage: sync-spigot-api.mjs [write|check]");
}

const resources = new Set(REGISTRIES.map(([, , resource]) => resource));
const javadocs = await fetchJavadocs(resources);
const pages = REGISTRIES.map(([id, typeName, resource]) => {
  const url = `${JAVADOC_ROOT}/${resource}`;
  const html = readJavadoc(javadocs, resource);
  const values = documentedConstants(html);
  const aliases = LEGACY_ALIASES.get(id);

  if (!values.length) {
    fail(`No documented constants were found in ${url}.`);
  }

  for (const [alias, canonical] of Object.entries(aliases ?? {})) {
    if (!values.includes(canonical)) {
      fail(`${id} alias ${alias} points to missing API value ${canonical}.`);
    }
  }

  return { id, typeName, url, apiVersion: apiVersion(html), publishedAt: publishedAt(html), values, aliases };
});

const entityTypes = pages.find((page) => page.id === "entity-type");
const unknownAnimals = ANIMAL_ENTITY_TYPES.filter((value) => !entityTypes.values.includes(value));

if (unknownAnimals.length) {
  fail(`Animal entity types are missing from EntityType: ${unknownAnimals.join(", ")}.`);
}

const animalPage = {
  id: "animal-entity-type",
  typeName: "AnimalEntityType",
  url: `${JAVADOC_ROOT}/org/bukkit/entity/Animals.html`,
  apiVersion: entityTypes.apiVersion,
  publishedAt: entityTypes.publishedAt,
  values: [...ANIMAL_ENTITY_TYPES].sort((left, right) => left.localeCompare(right))
};
pages.splice(pages.indexOf(entityTypes) + 1, 0, animalPage);

const versions = [...new Set(pages.map((page) => page.apiVersion))];

if (versions.length !== 1) {
  fail(`Spigot Javadocs returned inconsistent API versions: ${versions.join(", ")}.`);
}

if (versions[0] !== target.apiVersion) {
  fail(`Pinned Spigot artifact reports ${versions[0]}, expected ${target.apiVersion}.`);
}

const publicationDates = [...new Set(pages.map((page) => page.publishedAt))];

if (publicationDates.length !== 1) {
  fail(`Spigot Javadocs returned inconsistent publication dates: ${publicationDates.join(", ")}.`);
}

const registry = {
  formatVersion: 1,
  source: {
    name: "Spigot API Javadocs",
    apiVersion: versions[0],
    publishedAt: publicationDates[0],
    rootUrl: JAVADOC_ROOT,
    artifactVersion: target.artifactVersion,
    artifactSha256: target.artifactSha256,
    artifactUrl
  },
  registries: pages.map(({ id, typeName, url, values, aliases }) => ({
    id,
    typeName,
    url,
    values,
    ...(aliases ? { aliases } : {})
  }))
};
const generatedFiles = new Map([["index.json", stableJson(registry)]]);

if (mode === "check") {
  await checkGeneratedFiles(generatedFiles);
  process.stdout.write(`Spigot API data matches pinned ${versions[0]} artifact ${target.artifactVersion} (${pages.length} registries).\n`);
} else {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...generatedFiles].map(([fileName, source]) => writeFile(path.join(outputDirectory, fileName), source)));
  process.stdout.write(`Synced Spigot API ${versions[0]} (${pages.length} registries).\n`);
}

async function readTarget(filePath) {
  let value;

  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(`Could not read the Spigot API target at ${filePath}: ${error.message}`);
  }

  for (const field of ["apiVersion", "artifactVersion"]) {
    if (typeof value[field] !== "string" || !/^[A-Za-z0-9._-]+$/.test(value[field])) {
      fail(`Spigot API target ${field} must be a Maven-safe string.`);
    }
  }

  if (!/^[0-9a-f]{64}$/.test(value.artifactSha256 ?? "")) {
    fail("Spigot API target artifactSha256 must be a lowercase SHA-256 hash.");
  }

  const artifactPrefix = value.apiVersion.replace(/-SNAPSHOT$/, "-");

  if (artifactPrefix === value.apiVersion || !value.artifactVersion.startsWith(artifactPrefix)) {
    fail(`Spigot artifact ${value.artifactVersion} does not belong to ${value.apiVersion}.`);
  }

  return value;
}

async function fetchJavadocs(resources) {
  const response = await fetch(artifactUrl, {
    headers: {
      Accept: "application/java-archive",
      "User-Agent": "KingdomsX-Config-Editor"
    }
  });

  if (!response.ok) {
    fail(`Spigot Javadocs returned ${response.status} for ${artifactUrl}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");

  if (actualSha256 !== target.artifactSha256) {
    fail(`Spigot Javadoc artifact hash mismatch: expected ${target.artifactSha256}, received ${actualSha256}.`);
  }

  try {
    return unzipSync(bytes, { filter: ({ name }) => resources.has(name) });
  } catch (error) {
    fail(`Could not read the pinned Spigot Javadoc artifact: ${error.message}`);
  }
}

function readJavadoc(javadocs, resource) {
  const bytes = javadocs[resource];

  if (!bytes) {
    fail(`Pinned Spigot Javadoc artifact is missing ${resource}.`);
  }

  return new TextDecoder().decode(bytes);
}

function apiVersion(html) {
  const title = /<title>[^<]*\(Spigot-API\s+(.+?)\s+API\)<\/title>/i.exec(html)?.[1];

  if (!title) {
    fail("The Spigot API version could not be read from the Javadocs title.");
  }

  return decodeHtml(title.trim());
}

function publishedAt(html) {
  const date = /<meta\s+name="dc\.created"\s+content="([^"]+)"/i.exec(html)?.[1];

  if (!date) {
    fail("The publication date could not be read from the Spigot Javadocs metadata.");
  }

  return date;
}

function documentedConstants(html) {
  const sections = [
    section(html, "enum-constant-summary"),
    section(html, "field-summary")
  ].filter(Boolean);
  const names = new Set();

  for (const source of sections) {
    for (const match of source.matchAll(/class="member-name-link"[^>]*>([A-Z][A-Z0-9_]*)<\/a>/g)) {
      names.add(match[1]);
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

function section(html, id) {
  const start = html.indexOf(`id="${id}"`);

  if (start < 0) {
    return "";
  }

  const end = html.indexOf("</section>", start);

  return html.slice(start, end < 0 ? html.length : end);
}

function decodeHtml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function checkGeneratedFiles(expectedFiles) {
  const actualNames = new Set(await readdir(outputDirectory));

  for (const [fileName, expected] of expectedFiles) {
    let actual;

    try {
      actual = await readFile(path.join(outputDirectory, fileName), "utf8");
    } catch {
      fail(`Missing generated Spigot API file ${fileName}. Run npm run editor:spigot:refresh.`);
    }

    if (actual !== expected) {
      fail(`Generated Spigot API file ${fileName} is stale. Run npm run editor:spigot:refresh.`);
    }

    actualNames.delete(fileName);
  }

  if (actualNames.size) {
    fail(`Unexpected generated Spigot API files: ${[...actualNames].sort().join(", ")}.`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
