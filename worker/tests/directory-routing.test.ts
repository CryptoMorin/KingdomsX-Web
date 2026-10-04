import { describe, expect, it } from "vitest";
import {
  workerRoute,
  webWorkerRoute
} from "../test-support/directory";

describe("main website Worker routing", () => {
  it.each([
    ["https://www.kingdomsx.com/", "https://kingdomsx.com/"],
    ["https://kingdomsx.com/servers/all", "https://servers.kingdomsx.com/all"],
    ["https://kingdomsx.com/servers/submit.html", "https://servers.kingdomsx.com/submit"],
    ["https://kingdomsx.com/editor", "https://editor.kingdomsx.com/"],
    ["https://kingdomsx.com/editor.html?from=old", "https://editor.kingdomsx.com/?from=old"]
  ])("redirects %s to its canonical URL", async (url, location) => {
    const requestedAssets: string[] = [];
    const response = await webWorkerRoute(url, requestedAssets);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(location);
  });

  it.each([
    ["https://assets.kingdomsx.com/build/example.js", 200, "/build/example.js"],
    ["https://assets.kingdomsx.com/favicon.ico", 404, "/404"]
  ])("routes %s with status %i", async (url, status, assetPath) => {
    const requestedAssets: string[] = [];
    const response = await webWorkerRoute(url, requestedAssets);

    expect(response.status).toBe(status);
    expect(requestedAssets.at(-1)).toBe(assetPath);
  });
});

describe("server directory Worker routing", () => {
  it.each([
    ["http://172.19.83.150:8787/", 200, "/servers.html"],
    ["http://172.19.83.150:8787/submit", 200, "/servers/submit.html"],
    ["http://172.19.83.150:8787/servers", 404, "/404"],
    ["http://172.19.83.150:8787/servers/submit", 404, "/404"],
    ["http://172.19.83.150:8787/servers/submit.html", 404, "/404"]
  ])("keeps the standalone server directory at its root for %s", async (url, status, assetPath) => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(url, requestedAssets, "local");

    expect(response.status).toBe(status);
    expect(requestedAssets.at(-1)).toBe(assetPath);
  });

  it.each([
    ["https://servers.kingdomsx.com/servers.html", "https://servers.kingdomsx.com/"],
    ["https://servers.kingdomsx.com/all.html", "https://servers.kingdomsx.com/all"],
    ["https://servers.kingdomsx.com/submit.html", "https://servers.kingdomsx.com/submit"],
    ["https://servers.kingdomsx.com/admin.html", "https://servers.kingdomsx.com/admin"]
  ])("redirects %s to its canonical URL", async (url, location) => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(url, requestedAssets);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(location);
  });

  it("serves standalone static assets through the asset binding", async () => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(
      "https://servers.kingdomsx.com/apple-touch-icon.png",
      requestedAssets
    );

    expect(response.status).toBe(200);
    expect(requestedAssets).toEqual(["/apple-touch-icon.png"]);
  });

  it("serves server-directory discovery documents", async () => {
    const requestedAssets: string[] = [];
    const robots = await workerRoute(
      "https://servers.kingdomsx.com/robots.txt",
      requestedAssets
    );

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
    ["/", "Servers | KingdomsX", "https://servers.kingdomsx.com/", false],
    ["/all", "All Servers | KingdomsX", "https://servers.kingdomsx.com/all", false],
    ["/offline", "Offline Servers | KingdomsX", "https://servers.kingdomsx.com/offline", false],
    ["/sort/name", "Servers | KingdomsX", "https://servers.kingdomsx.com/sort/name", false],
    [
      "/all/sort/players/page/2",
      "All Servers - Page 2 | KingdomsX",
      "https://servers.kingdomsx.com/all/sort/players/page/2",
      true
    ]
  ])("keeps metadata and JSON-LD consistent for %s", async (
    pathname,
    title,
    canonicalUrl,
    laterPage
  ) => {
    const response = await workerRoute(
      `https://servers.kingdomsx.com${pathname}`,
      []
    );
    const html = await response.text();
    const structuredDataMatch = html.match(
      /<script[^>]*data-structured-data="webpage"[^>]*>([\s\S]*?)<\/script>/
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("link")).toBe(`<${canonicalUrl}>; rel="canonical"`);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`rel="canonical" href="${canonicalUrl}"`);
    expect(structuredDataMatch).not.toBeNull();

    const structuredData = JSON.parse(structuredDataMatch?.[1] ?? "null");
    const expectedDescription = laterPage
      ? "Browse public servers running KingdomsX, whether you want to test the plugin or find a community already using it. Page 2."
      : "Browse public servers running KingdomsX, whether you want to test the plugin or find a community already using it.";

    expect(html).toContain(`name="description" content="${expectedDescription}"`);
    expect(structuredData).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      "url": canonicalUrl,
      "name": title,
      "description": expectedDescription
    });
  });

  it.each([
    ["https://servers.kingdomsx.com/all/sort/name/page/2", 200, "/servers.html"],
    ["https://servers.kingdomsx.com/submit", 200, "/servers/submit.html"],
    ["https://servers.kingdomsx.com/page/101", 404, "/404"],
    ["https://kingdomsx.com/", 404, "/404"]
  ])("routes %s with status %i", async (url, status, assetPath) => {
    const requestedAssets: string[] = [];
    const response = await workerRoute(url, requestedAssets);

    expect(response.status).toBe(status);
    expect(requestedAssets.at(-1)).toBe(assetPath);
  });
});
