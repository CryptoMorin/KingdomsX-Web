import { readdir } from "node:fs/promises";
import path from "node:path";
import { isKingdomsManagedFile } from "../../src/assets/scripts/config-editor/kingdoms-managed-files.js";

const TRANSIENT_ROOT_DIRECTORIES = new Set(["temp"]);

export async function findKingdomsConfigFiles(configsDirectory) {
  const files = await walk(configsDirectory, true);

  return files
    .filter((filePath) => /\.ya?ml$/i.test(filePath) && !isKingdomsManagedFile(filePath))
    .sort();
}

async function walk(directory, isRoot = false) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    if (isRoot && entry.isDirectory() && TRANSIENT_ROOT_DIRECTORIES.has(entry.name.toLocaleLowerCase("en-US"))) {
      return [];
    }

    const entryPath = path.join(directory, entry.name);

    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));

  return files.flat();
}
