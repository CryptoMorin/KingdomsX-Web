import { workspaceSupportFiles } from "./workspace-session.js";
import { evaluateExpression } from "./expression-evaluator.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

const BUILDING_SCHEMAS = new Map([
  ["Structures/structure", "structures"],
  ["Turrets/turret", "turrets"]
]);
const SCHEMATIC_FILE = /\.(?:schematic|schem)$/i;

let bundledCatalogPromise;

export async function schematicSelectionForBuilding(workspace, fileName, schemaId) {
  if (!schematicPreviewsEnabled(workspace)) {
    return { resources: [], source: null };
  }

  const building = buildingDetails(fileName, schemaId);

  if (!building) {
    return { resources: [], source: null };
  }

  const workspaceFiles = workspaceSupportFiles(workspace);
  const fromWorkspace = matchingSchematics(workspaceFiles, building.family, building.id, "workspace");

  if (fromWorkspace.length) {
    return { resources: fromWorkspace, source: "workspace" };
  }

  if (workspaceContainsSchematics(workspaceFiles)) {
    return { resources: [], source: "workspace" };
  }

  const bundled = await bundledSchematics();

  return {
    resources: matchingSchematics(bundled, building.family, building.id, "bundled"),
    source: "bundled"
  };
}

export function schematicPreviewsEnabled(workspace) {
  const engineHub = workspace?.files?.find((session) =>
    /(?:^|\/)enginehub\.ya?ml$/i.test(normalizedPath(session.fileName))
  );
  const enabled = engineHub?.document?.index?.byPath?.get(pathKey(["worldedit", "schematics", "enabled"]));

  return Boolean(enabled && !enabled.container && parseSimpleLiteral(enabled.source).value === true);
}

export function configuredBuildingMaxLevel(index) {
  const entry = index?.byPath?.get(pathKey(["max-level"]));

  if (!entry || entry.container) {
    return null;
  }

  const literal = parseSimpleLiteral(entry.source);

  if (!["integer", "string"].includes(literal.kind)) {
    return null;
  }

  const { value, problem } = evaluateExpression(String(literal.value));

  if (problem) {
    return null;
  }

  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function schematicFolderForBuilding(fileName, schemaId) {
  const building = buildingDetails(fileName, schemaId);

  if (!building) {
    return "";
  }

  return [building.prefix, "schematics", building.family, building.id].filter(Boolean).join("/");
}

export function schematicLevelRanges(resources, maxLevel) {
  const configuredMaximum = Number.isSafeInteger(maxLevel) && maxLevel >= 1 ? maxLevel : null;

  return resources.map((resource, index) => {
    const nextLevel = resources[index + 1]?.level;
    const inferredEnd = nextLevel ? nextLevel - 1 : configuredMaximum;
    const boundedEnd = configuredMaximum === null || inferredEnd === null
      ? inferredEnd
      : Math.min(inferredEnd, configuredMaximum);
    const endLevel = Math.max(resource.level, boundedEnd ?? resource.level);

    return {
      ...resource,
      endLevel,
      levelLabel: endLevel > resource.level
        ? `Level ${resource.level}-${endLevel}`
        : `Level ${resource.level}`
    };
  });
}

export function schematicLevelPreviews(resources, maxLevel) {
  return schematicLevelRanges(resources, maxLevel).flatMap((resource) => {
    const sourceLevel = resource.level;

    return Array.from({ length: resource.endLevel - sourceLevel + 1 }, (_, offset) => {
      const level = sourceLevel + offset;

      return {
        ...resource,
        sourceLevel,
        level,
        endLevel: level,
        levelLabel: `Level ${level}`
      };
    });
  });
}

function matchingSchematics(files, family, building, origin) {
  const suffix = new RegExp(
    `(?:^|/)schematics/${escapeRegExp(family)}/${escapeRegExp(building)}/([1-9]\\d*)\\.(?:schematic|schem)$`,
    "i"
  );

  return files.flatMap((file) => {
    const match = suffix.exec(normalizedPath(file.path ?? file.resourceName));

    if (!match) {
      return [];
    }

    return [{
      level: Number.parseInt(match[1], 10),
      path: file.path ?? file.resourceName,
      bytes: file.bytes,
      origin
    }];
  }).sort((left, right) => left.level - right.level);
}

function workspaceContainsSchematics(files) {
  return files.some((file) => SCHEMATIC_FILE.test(file.path) && /(?:^|\/)schematics\//i.test(normalizedPath(file.path)));
}

function bundledSchematics() {
  if (!bundledCatalogPromise) {
    bundledCatalogPromise = import("../../../data/config-editor/addons/schematics.json").then(({ default: catalog }) =>
      catalog.schematics.map((entry) => ({
        resourceName: entry.resourceName,
        bytes: decodeBase64(entry.data)
      }))
    );
  }

  return bundledCatalogPromise;
}

function buildingDetails(fileName, schemaId) {
  const family = BUILDING_SCHEMAS.get(schemaId);

  if (!family) {
    return null;
  }

  const normalized = normalizedPath(fileName);
  const familyFolder = family === "turrets" ? "Turrets" : "Structures";
  const match = new RegExp(`(?:^|/)${familyFolder}/([^/]+)\\.ya?ml$`, "i").exec(normalized);

  if (!match) {
    return null;
  }

  return {
    family,
    id: match[1].toLocaleLowerCase("en-US"),
    prefix: normalized.slice(0, match.index).replace(/\/$/, "")
  };
}

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function decodeBase64(value) {
  const binary = globalThis.atob(value);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
