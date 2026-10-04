import addonCatalog from "../../../data/config-editor/addons/index.json";

const addonById = new Map(addonCatalog.source.artifacts.map((artifact) => [artifact.addonId, {
  id: artifact.addonId,
  label: addonLabel(artifact)
}]));
const addonDirectoryRoots = addonCatalog.defaults
  .map((descriptor) => ({
    addon: addonById.get(descriptor.source?.addonId),
    segments: ownershipRootSegments(descriptor.resourceName)
  }))
  .filter(({ addon, segments }) => addon && segments.length)
  .filter((candidate, index, entries) => entries.findIndex((entry) => entry.addon.id === candidate.addon.id
    && entry.segments.join("/").toLocaleLowerCase("en-US")
      === candidate.segments.join("/").toLocaleLowerCase("en-US")) === index)
  .sort((left, right) => right.segments.length - left.segments.length);

export function addonOwnershipForConfig(fileName) {
  const directoryOwnership = addonDirectoryOwnership(fileName);

  if (directoryOwnership) {
    return {
      ...directoryOwnership.addon,
      rootFolder: directoryOwnership.rootFolder
    };
  }

  const descriptor = exactDefaultDescriptor(fileName);
  const addon = addonById.get(descriptor?.source?.addonId);

  if (!addon) {
    return null;
  }

  return { ...addon, rootFolder: "" };
}

export function addonOwnershipForSchematic(fileName) {
  const normalized = normalizePath(fileName);
  const segments = normalized.split("/").filter(Boolean);
  const schematicIndex = segments.findIndex((segment) => segment.toLocaleLowerCase("en-US") === "schematics");
  const schematicType = segments[schematicIndex + 1]?.toLocaleLowerCase("en-US");

  if (schematicIndex < 0 || !["structures", "turrets"].includes(schematicType)) {
    return null;
  }

  const addon = addonById.get("enginehub");

  return addon ? {
    ...addon,
    rootFolder: segments.slice(0, schematicIndex + 1).join("/")
  } : null;
}

export function sharedAddonOwnership(ownerships) {
  if (!ownerships.length || ownerships.some((ownership) => !ownership)) {
    return null;
  }

  const [first] = ownerships;

  return ownerships.every((ownership) => ownership.id === first.id) ? first : null;
}

function exactDefaultDescriptor(fileName) {
  const normalized = normalizePath(fileName).toLocaleLowerCase("en-US");
  const withoutGuiLocale = normalized.replace(/(^|\/)guis\/[a-z]{2}(?:[-_][a-z]{2})?\//i, "$1guis/");

  return addonCatalog.defaults
    .filter(({ resourceName }) => {
      const resource = resourceName.toLocaleLowerCase("en-US");

      return normalized === resource
        || normalized.endsWith(`/${resource}`)
        || withoutGuiLocale === resource
        || withoutGuiLocale.endsWith(`/${resource}`);
    })
    .sort((left, right) => right.resourceName.length - left.resourceName.length)[0] ?? null;
}

function addonDirectoryOwnership(fileName) {
  const actualSegments = normalizePath(fileName).split("/").filter(Boolean);

  for (const candidate of addonDirectoryRoots) {
    const rootEnd = matchingRootEnd(actualSegments, candidate.segments);

    if (rootEnd >= 0) {
      return {
        addon: candidate.addon,
        rootFolder: actualSegments.slice(0, rootEnd + 1).join("/")
      };
    }
  }

  return null;
}

function matchingRootEnd(actualSegments, rootSegments) {
  for (let start = 0; start < actualSegments.length; start += 1) {
    if (actualSegments[start].toLocaleLowerCase("en-US") !== rootSegments[0].toLocaleLowerCase("en-US")) {
      continue;
    }

    if (rootSegments.length === 1) {
      return start;
    }

    let actualIndex = start + 1;

    if (rootSegments[0].toLocaleLowerCase("en-US") === "guis"
      && /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(actualSegments[actualIndex] ?? "")) {
      actualIndex += 1;
    }

    if (actualSegments[actualIndex]?.toLocaleLowerCase("en-US")
      === rootSegments[1].toLocaleLowerCase("en-US")) {
      return actualIndex;
    }
  }

  return -1;
}

function ownershipRootSegments(resourceName) {
  const segments = normalizePath(resourceName).split("/").filter(Boolean);

  if (segments.length < 2) {
    return [];
  }

  return segments[0]?.toLocaleLowerCase("en-US") === "guis" ? segments.slice(0, 2) : segments.slice(0, 1);
}

function addonLabel(artifact) {
  const fileName = artifact.artifactPath.split("/").at(-1) ?? artifact.addonId;
  const versionSuffix = artifact.addonVersion ? `-${artifact.addonVersion}.jar` : ".jar";
  const artifactName = fileName
    .replace(/^Kingdoms-Addon-/i, "")
    .replace(new RegExp(`${escapeRegExp(versionSuffix)}$`, "i"), "");

  return artifactName.replaceAll("-", " ");
}

function normalizePath(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
