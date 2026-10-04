import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EDITOR_HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://assets.mcasset.cloud https://textures.minecraft.net; font-src 'self' data:; media-src https://assets.mcasset.cloud; manifest-src 'self'; connect-src 'self' https://assets.mcasset.cloud https://textures.minecraft.net https://cdn.jsdelivr.net; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow

/build/*
  Cache-Control: public, max-age=31536000, immutable

/healthz
  Cache-Control: no-store
  Content-Type: text/plain; charset=utf-8

/robots.txt
  Cache-Control: public, max-age=3600
  Content-Type: text/plain; charset=utf-8

`;

const EDITOR_REDIRECTS = `/editor / 301
/editor/ / 301
/editor.html / 301
`;

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const BUILD_TARGETS = {
  main: {
    outputName: "dist",
    htmlRoots: ["index.html", "403.html", "404.html"]
  },
  "server-directory": {
    outputName: "dist-server-directory",
    htmlRoots: [
      "servers.html",
      "servers/submit.html",
      "servers/admin.html",
      "403.html",
      "404.html"
    ],
    removeFiles: ["sitemap-index.xml", "sitemap-0.xml"]
  },
  editor: {
    outputName: "dist-editor",
    htmlRoots: ["index.html"],
    promotedPage: "editor.html",
    removeFiles: ["sitemap-index.xml", "sitemap-0.xml"]
  }
};

export async function prepareSiteBuild(target, outputDirectory) {
  const config = BUILD_TARGETS[target];

  if (!config) {
    throw new Error(`Unknown deployment build target: ${target}`);
  }

  const root = path.resolve(outputDirectory);

  if (path.basename(root) !== config.outputName) {
    throw new Error(`Refusing to prepare unexpected ${target} output directory: ${root}`);
  }

  if (config.promotedPage) {
    await copyFile(path.join(root, config.promotedPage), path.join(root, "index.html"));
  }

  await assertFilesExist(root, config.htmlRoots);
  await removeUnownedHtml(root, new Set(config.htmlRoots));
  await pruneBuildAssets(root, config.htmlRoots);

  await Promise.all((config.removeFiles ?? []).map((file) =>
    rm(path.join(root, file), { force: true })
  ));

  if (target === "editor") {
    await Promise.all([
      writeFile(path.join(root, "_headers"), EDITOR_HEADERS),
      writeFile(path.join(root, "_redirects"), EDITOR_REDIRECTS),
      writeFile(path.join(root, "robots.txt"), "User-agent: *\nDisallow: /\n")
    ]);
  }
}

export function siteBuildOutputName(target) {
  const config = BUILD_TARGETS[target];

  if (!config) {
    throw new Error(`Unknown deployment build target: ${target}`);
  }

  return config.outputName;
}

async function assertFilesExist(root, relativePaths) {
  for (const relativePath of relativePaths) {
    await readFile(path.join(root, relativePath));
  }
}

async function removeUnownedHtml(root, retainedRelativePaths) {
  for (const filePath of await collectFiles(root)) {
    if (!filePath.endsWith(".html")) {
      continue;
    }

    const relativePath = path.relative(root, filePath).split(path.sep).join("/");

    if (!retainedRelativePaths.has(relativePath)) {
      await rm(filePath);
    }
  }

  await removeEmptyDirectories(root);
}

async function pruneBuildAssets(root, htmlRoots) {
  const buildDirectory = path.join(root, "build");
  const assets = await collectFiles(buildDirectory);
  const byName = new Map();

  for (const asset of assets) {
    const name = path.basename(asset);

    if (byName.has(name)) {
      throw new Error(`Deployment build contains duplicate asset name ${name}.`);
    }

    byName.set(name, asset);
  }

  const required = new Set();
  const pending = htmlRoots.map((relativePath) => path.join(root, relativePath));

  while (pending.length) {
    const source = await readFile(pending.pop(), "utf8");

    for (const [name, asset] of byName) {
      if (required.has(asset) || !source.includes(name)) {
        continue;
      }

      required.add(asset);

      if (/\.(?:css|js|mjs)$/i.test(asset)) {
        pending.push(asset);
      }
    }
  }

  await Promise.all(assets
    .filter((asset) => !required.has(asset))
    .map((asset) => rm(asset)));
  await removeEmptyDirectories(buildDirectory);
}

async function collectFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(filePath));
    } else {
      files.push(filePath);
    }
  }

  return files;
}

async function removeEmptyDirectories(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const child = path.join(directory, entry.name);
    await removeEmptyDirectories(child);

    if ((await readdir(child)).length === 0) {
      await rm(child, { recursive: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const target = process.argv[2];
  const config = BUILD_TARGETS[target];

  if (!config) {
    throw new Error("Expected deployment build target: main, server-directory, or editor");
  }

  await prepareSiteBuild(target, path.join(repositoryRoot, siteBuildOutputName(target)));
}
