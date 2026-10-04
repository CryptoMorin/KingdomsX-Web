import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSiteBuild } from "./prepare-site-build.mjs";

describe("deployment builds", () => {
  const temporaryDirectories = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps only the main pages and the files they use", async () => {
    const output = await createOutput("dist", {
      "index.html": '<script src="/build/main.js"></script>',
      "403.html": '<link href="/build/errors.css">',
      "404.html": '<link href="/build/errors.css">',
      "editor.html": '<script src="/build/editor.js"></script>',
      "servers.html": '<script src="/build/servers.js"></script>',
      "servers/admin.html": "Admin",
      "build/main.js": 'import "./shared.js";',
      "build/shared.js": "console.log('shared');",
      "build/errors.css": "body { color: white; }",
      "build/editor.js": "console.log('editor');",
      "build/servers.js": "console.log('servers');",
      "favicon.svg": "<svg></svg>"
    });

    await prepareSiteBuild("main", output);

    expect(await htmlFiles(output)).toEqual(["403.html", "404.html", "index.html"]);
    expect(await buildFiles(output)).toEqual(["errors.css", "main.js", "shared.js"]);
    await expect(readFile(path.join(output, "favicon.svg"), "utf8")).resolves.toBe("<svg></svg>");
  });

  it("keeps only the server directory pages and the assets they use", async () => {
    const output = await createOutput("dist-server-directory", {
      "index.html": '<script src="/build/main.js"></script>',
      "editor.html": '<script src="/build/editor-schema.js"></script>',
      "servers.html": '<script src="/build/listings.js"></script>',
      "servers/submit.html": '<script src="/build/submit.js"></script>',
      "servers/admin.html": '<script src="/build/admin.js"></script>',
      "403.html": '<link href="/build/errors.css">',
      "404.html": '<link href="/build/errors.css">',
      "build/listings.js": 'import "./directory-shared.js";',
      "build/submit.js": 'import "./directory-shared.js";',
      "build/admin.js": 'import "./directory-shared.js";',
      "build/directory-shared.js": "console.log('directory');",
      "build/errors.css": "body { color: white; }",
      "build/main.js": "console.log('main');",
      "build/editor-schema.js": "export default 'config.yml';",
      "robots.txt": "User-agent: *",
      "sitemap-index.xml": "<sitemapindex />",
      "sitemap-0.xml": "<urlset />"
    });

    await prepareSiteBuild("server-directory", output);

    expect(await htmlFiles(output)).toEqual([
      "403.html",
      "404.html",
      "servers.html",
      "servers/admin.html",
      "servers/submit.html"
    ]);
    expect(await buildFiles(output)).toEqual([
      "admin.js",
      "directory-shared.js",
      "errors.css",
      "listings.js",
      "submit.js"
    ]);
    await expect(readFile(path.join(output, "robots.txt"), "utf8")).resolves.toBe("User-agent: *");
    await expect(readFile(path.join(output, "sitemap-index.xml"))).rejects.toThrow();
    await expect(readFile(path.join(output, "sitemap-0.xml"))).rejects.toThrow();
  });

  it("moves the editor to the root and keeps only the files it uses", async () => {
    const output = await createOutput("dist-editor", {
      "editor.html": '<script src="/build/editor.js"></script>',
      "index.html": "<h1>Main website</h1>",
      "404.html": "<h1>Not found</h1>",
      "servers/admin.html": "<h1>Admin</h1>",
      "build/editor.js": 'import "./editor.css";',
      "build/editor.css": "body { color: white; }",
      "build/unused.js": "console.log('unused');",
      "favicon.svg": "<svg></svg>",
      "sitemap-index.xml": "<sitemapindex />",
      "sitemap-0.xml": "<urlset />"
    });

    await prepareSiteBuild("editor", output);

    expect(await readFile(path.join(output, "index.html"), "utf8"))
      .toContain("/build/editor.js");
    expect(await htmlFiles(output)).toEqual(["index.html"]);
    expect(await buildFiles(output)).toEqual(["editor.css", "editor.js"]);
    expect(await readFile(path.join(output, "robots.txt"), "utf8"))
      .toBe("User-agent: *\nDisallow: /\n");

    const headers = await readFile(path.join(output, "_headers"), "utf8");

    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
    expect(headers).toContain("connect-src 'self' https://assets.mcasset.cloud https://textures.minecraft.net https://cdn.jsdelivr.net");
    expect(await readFile(path.join(output, "_redirects"), "utf8"))
      .toContain("/editor / 301");
    await expect(readFile(path.join(output, "sitemap-index.xml"))).rejects.toThrow();
  });

  it("refuses an output directory that does not belong to the target", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "kingdomsx-build-unsafe-"));
    temporaryDirectories.push(output);

    await expect(prepareSiteBuild("main", output)).rejects.toThrow(
      "Refusing to prepare unexpected main output directory"
    );
  });

  async function createOutput(name, files) {
    const parent = await mkdtemp(path.join(os.tmpdir(), "kingdomsx-deployment-build-"));
    temporaryDirectories.push(parent);

    const output = path.join(parent, name);

    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(output, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }

    return output;
  }

  async function htmlFiles(output) {
    return (await collectFiles(output))
      .filter((relativePath) => relativePath.endsWith(".html"));
  }

  async function buildFiles(output) {
    return (await readdir(path.join(output, "build"))).sort();
  }

  async function collectFiles(directory, root = directory) {
    const files = [];

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...await collectFiles(filePath, root));
      } else {
        files.push(path.relative(root, filePath).split(path.sep).join("/"));
      }
    }

    return files.sort();
  }
});
