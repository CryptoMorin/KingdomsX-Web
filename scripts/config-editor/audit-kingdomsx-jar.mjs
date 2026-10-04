import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { kingdomsConfigFieldUsage } from "./class-file-references.mjs";
import { readKingdomsJar } from "./kingdomsx-jar.mjs";

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const argumentsList = process.argv.slice(2);
const writeCatalog = argumentsList.includes("--write");
const jarArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const jarInput = jarArgument ?? process.env.KINGDOMSX_JAR;

if (!jarInput?.trim()) {
  fail(writeCatalog
    ? "KINGDOMSX_JAR is required. Runtime catalog regeneration writes src/data/config-editor/runtime-options.json."
    : "KINGDOMSX_JAR is required. The audit reads the selected JAR without writing files.");
}

const jarPath = path.resolve(jarInput);
const generatedRoot = path.join(repositoryRoot, "src/data/config-editor/latest");

const jar = await readKingdomsJar(jarPath, (fileName) => fileName.endsWith(".class"));
const classFiles = Object.keys(jar.files)
  .filter((file) => /^org\/kingdoms\/config\/KingdomsConfig(?:\$[^$]+)?\.class$/.test(file))
  .sort();
const fieldUsage = kingdomsConfigFieldUsage(jar.files);
const schemas = await loadSchemas();
const defaultsBySchema = await loadDefaultPaths();
const rankPermissions = readRankPermissions();
const families = [];

for (const classFile of classFiles) {
  const className = classFile.replace(/\.class$/, "").replaceAll("/", ".");
  const familyName = className.split("$")[1] ?? "config";
  const schemaId = familyName === "config" ? "config" : kebabCase(familyName);
  const bytecode = execFileSync("javap", ["-classpath", jarPath, "-p", "-c", className], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const paths = parseEnumPaths(bytecode, className.replaceAll(".", "/"));
  const schema = schemas.get(schemaId);
  const defaults = defaultsBySchema.get(schemaId) ?? new Set();
  const details = paths.map(({ field, path: configPath }) => ({
    field,
    path: configPath,
    schemaCovered: schema ? schemaCoversPath(schema, configPath.split(".")) : false,
    defaultCovered: [...defaults].some((candidate) => pathsMatch(configPath.split("."), candidate.split("\u0000"))),
    consumers: [...(fieldUsage.get(`${className.replaceAll(".", "/")}#${field}`) ?? [])].sort()
  }));

  families.push({
    className,
    schemaId,
    runtimePathCount: details.length,
    schemaCovered: details.filter((entry) => entry.schemaCovered).length,
    defaultCovered: details.filter((entry) => entry.defaultCovered).length,
    runtimeUsed: details.filter((entry) => entry.consumers.length > 0).length,
    uncovered: details.filter((entry) => !entry.schemaCovered && !entry.defaultCovered),
    options: details.map(({ field, path: optionPath, schemaCovered, defaultCovered, consumers }) => ({
      field,
      path: optionPath.split("."),
      schemaCovered,
      defaultCovered,
      runtimeUsed: consumers.length > 0,
      consumers
    }))
  });
}

const audit = {
  source: jar.source,
  rankPermissions,
  configEnumCount: families.length,
  runtimePathCount: families.reduce((total, family) => total + family.runtimePathCount, 0),
  activeRuntimeOnlyPathCount: families.reduce(
    (total, family) => total + family.uncovered.filter((option) => option.consumers.length > 0).length,
    0
  ),
  families
};

if (writeCatalog) {
  const catalog = {
    formatVersion: 3,
    source: jar.source,
    rankPermissions,
    configEnumCount: audit.configEnumCount,
    runtimePathCount: audit.runtimePathCount,
    activeRuntimeOnlyPathCount: audit.activeRuntimeOnlyPathCount,
    families: families.map(({ schemaId, options }) => ({ schemaId, options }))
  };

  await writeFile(path.join(repositoryRoot, "src/data/config-editor/runtime-options.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  process.stdout.write(`Wrote ${catalog.runtimePathCount} runtime config paths from ${path.basename(jar.path)}.\n`);
} else {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

function readRankPermissions() {
  const className = "org.kingdoms.constants.player.StandardKingdomPermission";
  const output = execFileSync("javap", ["-classpath", jarPath, "-p", className], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  const fieldType = className.replaceAll(".", "\\.");
  const pattern = new RegExp(`^  public static final ${fieldType} ([A-Z][A-Z0-9_]*);$`, "gm");
  const permissions = [...output.matchAll(pattern)].map((match) => match[1]);

  if (!permissions.length) {
    throw new Error(`No standard rank permissions were found in ${className}.`);
  }

  return permissions;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseEnumPaths(bytecode, enumClassName) {
  const blocks = [];
  const pattern = new RegExp(`new\\s+#\\d+\\s+// class ${escapeRegExp(enumClassName)}\\n([\\s\\S]*?)putstatic\\s+#\\d+\\s+// Field ([^:]+):`, "g");
  let match;

  while ((match = pattern.exec(bytecode))) {
    const body = match[1];
    const field = match[2];
    const strings = [...body.matchAll(/\/\/ String (.+)$/gm)].map((candidate) => candidate[1]);
    const explicit = strings.find((value) => value !== field);
    const groups = groupedIndices(body);
    blocks.push({ field, path: explicit ?? groupedOption(field, groups) });
  }

  return blocks;
}

function groupedIndices(body) {
  const lines = body.split(/\r?\n/);
  const indices = [];

  for (let index = 1; index < lines.length; index += 1) {
    if (!/\biastore\b/.test(lines[index])) {
      continue;
    }

    const value = instructionInteger(lines[index - 1]);

    if (value !== null) {
      indices.push(value);
    }
  }

  return indices;
}

function instructionInteger(line) {
  const iconst = /\biconst_([0-5])\b/.exec(line);

  if (iconst) {
    return Number(iconst[1]);
  }

  if (/\biconst_m1\b/.test(line)) {
    return -1;
  }

  const pushed = /\b(?:bi|si)push\s+(-?\d+)\b/.exec(line);

  return pushed ? Number(pushed[1]) : null;
}

function groupedOption(field, groups) {
  const words = field.toLocaleLowerCase("en-US").split("_");
  const boundaries = new Set(groups.map((group) => group - 1));

  return words.map((word, index) => `${word}${index < words.length - 1 ? boundaries.has(index) ? "." : "-" : ""}`).join("");
}

async function loadSchemas() {
  const registry = JSON.parse(await readFile(path.join(generatedRoot, "index.json"), "utf8"));
  const entries = await Promise.all(registry.schemas.map(async ({ id, fileName }) => {
    const document = JSON.parse(await readFile(path.join(generatedRoot, fileName), "utf8"));

    return [id, document.schema];
  }));

  return new Map(entries);
}

async function loadDefaultPaths() {
  const registry = JSON.parse(await readFile(path.join(generatedRoot, "index.json"), "utf8"));

  if (registry.source?.sha256 !== jar.source.sha256) {
    throw new Error(
      "Generated schema data belongs to a different KingdomsX JAR. Run npm run editor:schema:sync first."
    );
  }

  const bySchema = new Map();

  for (const descriptor of registry.defaults) {
    if (!descriptor.schemaId) {
      continue;
    }

    const profile = JSON.parse(await readFile(path.join(generatedRoot, descriptor.fileName), "utf8"));
    const paths = bySchema.get(descriptor.schemaId) ?? new Set();

    for (const option of profile.options ?? []) {
      paths.add(option.path.join("\u0000"));
    }

    bySchema.set(descriptor.schemaId, paths);
  }

  return bySchema;
}

function schemaCoversPath(root, pathSegments) {
  let current = root;

  for (const segment of pathSegments) {
    if (!current) {
      return false;
    }

    if (current.kind === "nullable") {
      current = current.value;
    }

    if (current.kind === "object") {
      const field = current.fields?.find((candidate) => segmentMatches(segment, candidate.key));
      current = field?.type ?? current.additionalProperties;
    } else if (current.kind === "mapping") {
      const field = current.fields?.find((candidate) => segmentMatches(segment, candidate.key));
      current = field?.type ?? current.values;
    } else {
      return false;
    }
  }

  return Boolean(current);
}

function pathsMatch(runtime, actual) {
  return runtime.length === actual.length && runtime.every((segment, index) => segmentMatches(segment, actual[index]));
}

function segmentMatches(runtime, actual) {
  return /^\{[^}]+}$/.test(runtime) || runtime === actual;
}

function kebabCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLocaleLowerCase("en-US");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
