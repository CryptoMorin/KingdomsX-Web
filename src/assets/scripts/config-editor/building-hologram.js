import { parseAnchoredValue } from "./kingdoms-yaml.js";
import { resolveMessageMacros } from "./message-macros.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

const RUNTIME_PLACEHOLDER = /%[^%\r\n]+%/;

export function buildingHologramPreview(index, level, {
  macros = null,
  fallbackName = "Building",
  setupHeight = null
} = {}) {
  if (!Number.isSafeInteger(level) || level < 1) {
    return [];
  }

  const statePath = ["building", String(level), "holograms", "main"];
  const displayName = scalarValue(index?.byPath?.get(pathKey(["name"]))?.source) || fallbackName;
  const holograms = index?.entries?.filter((entry) =>
    entry.container
      && entry.path.length === statePath.length + 1
      && startsWith(entry.path, statePath)
  ) ?? [];

  return holograms.flatMap((entry) => {
    const linesPath = [...entry.path, "lines"];
    const configuredLineCount = index?.byPath?.get(pathKey(linesPath))?.collectionItems?.length ?? 0;
    const lines = previewLines(index, linesPath, {
      displayName,
      level,
      macros
    });

    if (!lines.length) {
      return [];
    }

    const background = colorValue(index, [...entry.path, "background-color"]);
    const position = positionValue(index, entry.path, configuredLineCount, setupHeight);

    return [{ id: String(entry.key), lines, background, ...position }];
  });
}

function previewLines(index, path, context) {
  const entry = index?.byPath?.get(pathKey(path));

  return (entry?.collectionItems ?? []).flatMap((item) => {
    const source = scalarValue(item.source);
    const resolved = replaceStablePlaceholders(
      resolveLevelConditionals(resolveMessageMacros(source, context.macros), context.level),
      context
    );

    if (!resolved.trim()
      || /^\[\s*]$/.test(resolved.trim())
      || resolved.includes("{?")
      || resolved.includes("{$$")
      || /<[^<>\r\n]+>/.test(resolved)
      || RUNTIME_PLACEHOLDER.test(resolved)) {
      return [];
    }

    return [resolved];
  });
}

function resolveLevelConditionals(source, level) {
  return String(source).replace(
    /\{\?\s*(level\s*(?:>=|<=|==|!=|>|<)\s*\d+)\s*\?\s*(?:"([^"]*)"|'([^']*)'|([^{}]*?))\s*}/gi,
    (token, condition, doubleQuoted, singleQuoted, unquoted) => {
      const match = /^level\s*(>=|<=|==|!=|>|<)\s*(\d+)$/i.exec(condition.trim());

      if (!match) {
        return token;
      }

      const expected = Number(match[2]);
      const matches = {
        ">=": level >= expected,
        "<=": level <= expected,
        "==": level === expected,
        "!=": level !== expected,
        ">": level > expected,
        "<": level < expected
      }[match[1]];

      return matches ? (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim() : "";
    }
  );
}

function replaceStablePlaceholders(source, { displayName, level }) {
  const replacements = new Map([
    ["building_displayname", displayName],
    ["building_name", displayName],
    ["building_level", String(level)],
    ["level", String(level)],
    ["roman@level", romanNumeral(level)],
    ["roman@next_level", romanNumeral(level + 1)]
  ]);

  return String(source).replace(/%([^%\r\n]+)%/g, (token, name) =>
    replacements.get(name.toLocaleLowerCase("en-US")) ?? token
  );
}

function colorValue(index, path) {
  const value = scalarValue(index?.byPath?.get(pathKey(path))?.source);
  const channels = value.split(",").map((channel) => Number(channel.trim()));

  if (channels.length !== 4 || channels.some((channel) => !Number.isFinite(channel))) {
    return [0, 0, 0, 0];
  }

  return channels.map((channel) => Math.min(255, Math.max(0, Math.round(channel))));
}

function positionValue(index, hologramPath, lineCount, setupHeight) {
  const offset = scalarValue(index?.byPath?.get(pathKey([...hologramPath, "offset"]))?.source)
    .split(",")
    .map((coordinate) => Number(coordinate.trim()));

  if (offset.length === 3 && offset.every(Number.isFinite)) {
    return { offset };
  }

  const heightEntry = index?.byPath?.get(pathKey([...hologramPath, "height"]));
  const height = Number(scalarValue(heightEntry?.source));
  const engineHubHeight = heightEntry?.profile && Number.isFinite(setupHeight) ? setupHeight : null;
  const resolvedHeight = engineHubHeight
    ?? (Number.isFinite(height) && height !== 0
      ? height
      : 0.5 + lineCount * 0.3);

  return { offset: [0, resolvedHeight, 0] };
}

export function engineHubSetupHologramHeight(fileName) {
  const normalized = String(fileName ?? "").replaceAll("\\", "/");
  const building = /(?:^|\/)(structures|turrets)\/([^/]+?)(?:\.ya?ml|\/)/i.exec(normalized);

  if (!building) {
    return null;
  }

  if (building[1].toLocaleLowerCase("en-US") === "structures") {
    const structureHeights = new Map([
      ["outpost", 4],
      ["warppad", 5],
      ["siege-cannon", 5]
    ]);
    const structureHeight = structureHeights.get(building[2].toLocaleLowerCase("en-US"));

    if (structureHeight) {
      return structureHeight;
    }
  }

  return 2.5;
}

export function buildingCoreMaterial(index, level) {
  const entry = index?.byPath?.get(pathKey(["building", String(level), "block", "material"]));
  const material = scalarValue(entry?.source).trim().toLocaleLowerCase("en-US");

  return material.replace(/^minecraft:/, "") || null;
}

export function buildingHologramOrigin(blocks, schematicOrigin, coreMaterial) {
  const fallback = validVector(schematicOrigin) ? schematicOrigin : [0, 0, 0];

  if (!coreMaterial) {
    return [...fallback];
  }

  const matches = (blocks ?? []).filter((block) => block.id === coreMaterial && validVector(block.pos));

  if (!matches.length) {
    return [...fallback];
  }

  const closest = matches.reduce((selected, candidate) =>
    squaredDistance(candidate.pos, fallback) < squaredDistance(selected.pos, fallback)
      ? candidate
      : selected
  );

  return [...closest.pos];
}

function scalarValue(source = "") {
  const anchored = parseAnchoredValue(source);

  return String(parseSimpleLiteral(anchored?.value ?? source).value ?? "");
}

function romanNumeral(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    return String(value);
  }

  const numerals = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remainder = value;
  let output = "";

  for (const [amount, numeral] of numerals) {
    while (remainder >= amount) {
      output += numeral;
      remainder -= amount;
    }
  }

  return output;
}

function startsWith(path, prefix) {
  return prefix.every((segment, index) => path[index] === segment);
}

function validVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function squaredDistance(left, right) {
  return left.reduce((total, coordinate, axis) => total + (coordinate - right[axis]) ** 2, 0);
}
