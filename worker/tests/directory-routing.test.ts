import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, workerRoute } from "../test-support/directory";

beforeEach(resetDatabase);

describe("Worker routing", () => {
  it.each([
    ["https://www.kingdomsx.com/", "https://kingdomsx.com/"],
    ["https://kingdomsx.com/servers/all", "https://servers.kingdomsx.com/all"],
    ["https://kingdomsx.com/servers/submit.html", "https://servers.kingdomsx.com/submit"],
    ["https://servers.kingdomsx.com/submit.html", "https://servers.kingdomsx.com/submit"],
    ["https://servers.kingdomsx.com/admin.html", "https://servers.kingdomsx.com/admin"]
  ])("redirects %s to its canonical URL", async (url, location) => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(url, requestedAssets);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(location);
  });

  it("serves server-directory discovery documents", async () => {
    const requestedAssets: string[] = [];
    const robots = await workerRoute("https://servers.kingdomsx.com/robots.txt", requestedAssets);

    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toContain("text/plain");
    const robotsTxt = await robots.text();

    expect(robotsTxt).toContain("Sitemap: https://servers.kingdomsx.com/sitemap-index.xml");
    expect(robotsTxt).toContain("Disallow: /admin");
    expect(robotsTxt).not.toContain("Disallow: /submit");

    const sitemapIndex = await workerRoute(
      "https://servers.kingdomsx.com/sitemap-index.xml",
      requestedAssets
    );

    expect(sitemapIndex.status).toBe(200);
    await expect(sitemapIndex.text()).resolves.toContain("https://servers.kingdomsx.com/sitemap-0.xml");

    const sitemap = await workerRoute(
      "https://servers.kingdomsx.com/sitemap-0.xml",
      requestedAssets
    );

    expect(sitemap.status).toBe(200);
    const sitemapXml = await sitemap.text();

    expect(sitemapXml).toContain("<loc>https://servers.kingdomsx.com/</loc>");
    expect(sitemapXml).toContain("<loc>https://servers.kingdomsx.com/all</loc>");
    expect(sitemapXml).toContain("<loc>https://servers.kingdomsx.com/offline</loc>");
    expect(sitemapXml).not.toContain("/submit");
    expect(sitemapXml).not.toContain("/admin");
  });

  it.each([
    ["https://servers.kingdomsx.com/all/sort/name/page/2", 200, "/servers.html"],
    ["https://servers.kingdomsx.com/submit", 200, "/servers/submit.html"],
    ["https://servers.kingdomsx.com/page/101", 404, "/404"],
    ["https://assets.kingdomsx.com/build/example.js", 200, "/build/example.js"],
    ["https://assets.kingdomsx.com/favicon.ico", 404, "/404"]
  ])("routes %s with status %i", async (url, status, assetPath) => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(url, requestedAssets);

    expect(response.status).toBe(status);
    expect(requestedAssets.at(-1)).toBe(assetPath);
  });
});
