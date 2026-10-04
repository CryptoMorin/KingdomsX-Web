import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { indexYamlSource } from "../../src/assets/scripts/config-editor/yaml-source.js";
import { profileFileName, profileOption } from "./profile-snapshot.mjs";

const GITHUB_SOURCE = {
  repository: "CryptoMorin/KingdomsX",
  ref: "master",
  rootPath: "resources/languages"
};
const SCHEMA_ID = "language";

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = path.join(repositoryRoot, "src/data/config-editor/catalog");
const mode = process.argv[2] ?? "write";

if (!new Set(["write", "check"]).has(mode)) {
  throw new Error("Usage: sync-language-profile.mjs [write|check]");
}

const requestedCommit = process.env.KINGDOMSX_LANGUAGE_COMMIT?.trim() ?? "";

if (requestedCommit && !/^[0-9a-f]{40}$/.test(requestedCommit)) {
  throw new Error("KINGDOMSX_LANGUAGE_COMMIT must be a 40-character lower-case Git commit.");
}

const commitSha = requestedCommit || await fetchRefCommit();
const languageDirectory = await fetchGitHubDirectory(GITHUB_SOURCE.rootPath, commitSha);
const locales = languageDirectory
  .filter((entry) => entry.type === "dir" && /^[a-z]{2}(?:[-_][A-Za-z]{2})?$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "en-US"));

if (!locales.includes("en")) {
  throw new Error("The KingdomsX language directory does not contain English.");
}

const profiles = await Promise.all(locales.map(fetchLanguageProfile));
const english = profiles.find((profile) => profile.locale === "en");
const source = {
  kind: "kingdomsx-github-languages",
  repository: GITHUB_SOURCE.repository,
  ref: GITHUB_SOURCE.ref,
  commitSha,
  rootPath: GITHUB_SOURCE.rootPath,
  languages: profiles.map(({ locale, source: profileSource }) => ({
    locale,
    path: profileSource.path,
    blobSha: profileSource.blobSha,
    sha256: profileSource.sha256
  }))
};
const kingdomCommandIds = english.options
  .filter((option) =>
    option.path.length === 2
      && option.path[0] === "command"
      && option.path[1] !== "not-intended-for-direct-use"
  )
  .map((option) => option.path[1])
  .sort((left, right) => left.localeCompare(right, "en-US"));

const generatedFiles = new Map([
  ["index.json", stableJson({
    formatVersion: 4,
    source,
    catalogs: {
      kingdomCommandIds: "kingdom-command-ids.json"
    },
    defaults: profiles.map((profile) => ({
      resourceName: profile.resourceName,
      schemaId: SCHEMA_ID,
      fileName: profile.fileName,
      sha256: profile.source.sha256
    }))
  })],
  ["kingdom-command-ids.json", stableJson({
    formatVersion: 1,
    source: english.source,
    values: kingdomCommandIds
  })]
]);

for (const profile of profiles) {
  generatedFiles.set(profile.fileName, stableJson({
    formatVersion: 1,
    source: profile.source,
    resourceName: profile.resourceName,
    schemaId: SCHEMA_ID,
    sha256: profile.source.sha256,
    options: profile.options
  }));
}

if (mode === "check") {
  const actualFiles = new Set(await readdir(outputDirectory));

  for (const [generatedName, expected] of generatedFiles) {
    const actual = await readFile(path.join(outputDirectory, generatedName), "utf8");

    if (actual !== expected) {
      throw new Error(`Generated language catalog ${generatedName} is stale.`);
    }

    actualFiles.delete(generatedName);
  }

  if (actualFiles.size) {
    throw new Error(`Unexpected generated language catalog files: ${[...actualFiles].join(", ")}.`);
  }

  process.stdout.write(`${profiles.length} language catalogs match KingdomsX commit ${commitSha.slice(0, 12)}.\n`);
} else {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const [generatedName, generatedContents] of generatedFiles) {
    await writeFile(path.join(outputDirectory, generatedName), generatedContents);
  }

  process.stdout.write(`Synced ${profiles.length} language catalogs from KingdomsX commit ${commitSha.slice(0, 12)}.\n`);
}

async function fetchLanguageProfile(locale) {
  const sourcePath = `${GITHUB_SOURCE.rootPath}/${locale}/${locale}.yml`;
  const githubFile = await fetchGitHubFile(sourcePath, commitSha);
  const contents = Buffer.from(githubFile.content.replaceAll(/\s/g, ""), "base64").toString("utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const profileSource = {
    kind: "kingdomsx-github",
    repository: GITHUB_SOURCE.repository,
    ref: GITHUB_SOURCE.ref,
    commitSha,
    path: sourcePath,
    blobSha: githubFile.sha,
    sha256
  };
  const index = indexYamlSource(contents);
  const resourceName = `languages/${locale}.yml`;

  return {
    locale,
    source: profileSource,
    resourceName,
    fileName: profileFileName(resourceName),
    options: index.entries.map(profileOption)
  };
}

async function fetchRefCommit() {
  const { repository, ref } = GITHUB_SOURCE;
  const commit = await fetchGitHubJson(
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
    `Could not resolve ${repository}@${ref}`
  );

  if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error(`GitHub returned an unexpected commit for ${repository}@${ref}.`);
  }

  return commit.sha;
}

async function fetchGitHubDirectory(sourcePath, ref) {
  const { repository } = GITHUB_SOURCE;
  const directory = await fetchGitHubJson(
    `https://api.github.com/repos/${repository}/contents/${sourcePath}?ref=${encodeURIComponent(ref)}`,
    `Could not list ${repository}/${sourcePath}`
  );

  if (!Array.isArray(directory)) {
    throw new Error(`GitHub returned an unexpected directory for ${repository}/${sourcePath}.`);
  }

  return directory;
}

async function fetchGitHubFile(sourcePath, ref) {
  const { repository } = GITHUB_SOURCE;
  const file = await fetchGitHubJson(
    `https://api.github.com/repos/${repository}/contents/${sourcePath}?ref=${encodeURIComponent(ref)}`,
    `Could not download ${repository}/${sourcePath}`
  );

  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || typeof file.sha !== "string") {
    throw new Error(`GitHub returned an unexpected response for ${repository}/${sourcePath}.`);
  }

  return file;
}

async function fetchGitHubJson(url, failureMessage) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "KingdomsX-Web-catalog-generator",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    throw new Error(`${failureMessage} (${response.status} ${response.statusText}).`);
  }

  return response.json();
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
