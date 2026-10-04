import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

export async function readKingdomsJar(jarPath, include) {
  if (!jarPath) {
    throw new Error("A KingdomsX JAR path is required.");
  }

  const resolvedPath = path.resolve(jarPath);
  const bytes = new Uint8Array(await readFile(resolvedPath));
  const files = unzipSync(bytes, {
    filter: (entry) => entry.name === "plugin.yml" || include(entry.name)
  });
  const pluginSource = textFile(files, "plugin.yml");

  return {
    path: resolvedPath,
    files,
    source: {
      kind: "kingdomsx-jar",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      pluginVersion: pluginValue(pluginSource, "version")
    }
  };
}

export function textFile(files, fileName) {
  const contents = files[fileName];

  if (!contents) {
    throw new Error(`KingdomsX JAR is missing ${fileName}.`);
  }

  return strFromU8(contents);
}

function pluginValue(source, key) {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m").exec(source);

  return match?.[1].replace(/^(['"])(.*)\1$/, "$2") ?? null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
