import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server-directory/worker";
import {
  assetBinding,
  createExecutionContext,
  waitOnExecutionContext,
  resetDatabase,
  seedOwnedServer,
  seedSubmitter,
  testEnv
} from "../test-support/directory";

const origin = "https://servers.kingdomsx.com";
type RouteEnv = Parameters<typeof worker.fetch>[1];

async function page(path: string, method = "GET", overrides: Partial<RouteEnv> = {}, requestOrigin = origin) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${requestOrigin}${path}`, { method }), {
    APP_ENVIRONMENT: "production",
    DB: testEnv.DB,
    ASSETS: assetBinding([]),
    ...overrides
  } as RouteEnv, ctx);

  await waitOnExecutionContext(ctx);

  return response;
}

beforeEach(async () => {
  await resetDatabase();

  for (const status of ["all", "online", "offline"]) {
    for (const sort of ["newest", "name", "players"]) {
      for (const page of [1, 2, 3]) {
        await caches.default.delete(`${origin}/api/servers?projection=2&limit=8&page=${page}&sort=${sort}&status=${status}`);
      }
    }
  }
});

describe("public directory HTML", () => {
  it("renders only approved public fields and escapes user and provider text", async () => {
    await seedSubmitter("public");
    await seedOwnedServer("public");
    await seedSubmitter("private");
    await seedOwnedServer("private", "pending");
    await testEnv.DB.prepare(`UPDATE servers SET name = ?, description = ?, website_url = ?, social_links_json = ? WHERE id = 'server-public'`)
      .bind('<img src=x onerror="alert(1)">', '</p><script>alert(2)</script> & "description"', "javascript:alert(3)", JSON.stringify([
        { key: "discord", label: '<svg onload="alert(4)">', url: "https://discord.gg/example" },
        { key: "x", label: "Bad URL", url: "javascript:alert(5)" }
      ])).run();
    await testEnv.DB.prepare("UPDATE servers SET regions_json = '[\"eu-west\",\"na-east\"]', languages_json = ? WHERE id = 'server-public'")
      .bind(JSON.stringify(["English", "Spanish", '<img src=x onerror="alert(8)">'])).run();
    await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, version_name, favicon_url_or_hash) VALUES ('server-public', 1, ?, ?)")
      .bind('<svg onload="alert(6)">', "javascript:alert(7)").run();

    const response = await page("/all");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;description&quot;');
    expect(html).toContain('href="https://discord.gg/example"');
    expect(html).toContain('&lt;svg onload=&quot;alert(6)&quot;&gt;');
    expect(html).toContain('src="/apple-touch-icon.png"');
    expect(html).toContain('rel="ugc nofollow noopener noreferrer"');
    expect(html).not.toMatch(/<script>alert|<svg onload|javascript:|Skeleton|JavaScript required|server-private|account-public|discord-public|session_hash/);
    expect(html).toContain('data-copy-server-address="play-public.kingdomsx.com"');
    expect(html).toContain("Tester public");
    expect(html).toContain("EU West, NA East");
    expect(html).toContain('data-bs-title="&lt;img src=x onerror=&quot;alert(8)&quot;&gt;"');
  });

  it("keeps valid pagination crawlable and marks filter/sort variations noindex", async () => {
    for (let index = 0; index < 9; index += 1) {
      const suffix = `page-${index}`;
      await seedSubmitter(suffix);
      await seedOwnedServer(suffix);
      await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, checked_at) VALUES (?, 1, ?)")
        .bind(`server-${suffix}`, new Date().toISOString()).run();
    }

    const first = await page("/");
    expect(first.headers.get("x-robots-tag")).toBe("index, follow, max-image-preview:large");
    expect(await first.text()).toContain('href="/page/2"');

    const second = await page("/page/2");
    const html = await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get("link")).toBe(`<${origin}/page/2>; rel="canonical"`);
    expect(second.headers.get("x-robots-tag")).toContain("index, follow");
    expect(html).toContain("Servers - Page 2 | KingdomsX");
    expect(html).toContain(`"isPartOf":{"@id":"${origin}/#website"}`);
    expect(html.match(/<article /g)).toHaveLength(1);

    for (const path of ["/all", "/offline", "/sort/name"]) {
      const filtered = await page(path);
      expect(filtered.headers.get("x-robots-tag")).toBe("noindex, follow");
      expect(await filtered.text()).toContain('name="robots" content="noindex, follow"');
    }

    const sorted = await page("/all/sort/name");
    const sortedHtml = await sorted.text();
    expect(sortedHtml).toContain('data-server-sort-form action="/all"');
    expect(sortedHtml).toContain('value="name" selected');
    expect(sortedHtml).toContain('href="/offline/sort/name"');
  });

  it("redirects by ID after an offline listing is renamed and moves to a later page", async () => {
    await seedSubmitter("permalink-target");
    await seedOwnedServer("permalink-target");
    const serverId = "server-permalink-target";
    const publicId = await testEnv.DB.prepare("SELECT id FROM server_public_ids WHERE server_id = ?")
      .bind(serverId).first<number>("id");
    const originalPath = `/server-permalink-target.${publicId}/`;
    const first = await page(originalPath);
    const firstHtml = await first.text();
    expect(first.status).toBe(200);
    expect(firstHtml).toContain('data-server-directory-path="/all"');
    expect(firstHtml).toContain(`data-copy-server-link="${origin}${originalPath}"`);

    for (let index = 0; index < 9; index += 1) {
      const suffix = `permalink-newer-${index}`;
      await seedSubmitter(suffix);
      await seedOwnedServer(suffix);
    }

    await testEnv.DB.prepare("UPDATE servers SET approved_at = ? WHERE id != ?")
      .bind("2026-01-02T00:00:00.000Z", serverId).run();
    await testEnv.DB.prepare("UPDATE servers SET name = 'All', normalized_host = 'new-address.example.com' WHERE id = ?")
      .bind(serverId).run();
    await caches.default.delete(`${origin}/api/servers?projection=2&limit=8&page=1&sort=newest&status=all`);

    const currentPath = `/all.${publicId}/`;
    for (const path of [originalPath, `/${publicId}/`]) {
      const alias = await page(path);
      expect(alias.status).toBe(302);
      expect(alias.headers.get("location")).toBe(`${origin}${currentPath}`);
      expect(alias.headers.get("cache-control")).toBe("no-store");
    }

    const later = await page(currentPath);
    const html = await later.text();

    expect(later.status).toBe(200);
    expect(later.headers.get("location")).toBeNull();
    expect(later.headers.get("link")).toBe(`<${origin}${currentPath}>; rel="canonical"`);
    expect(later.headers.get("x-robots-tag")).toBe("noindex, follow");
    expect(html).toContain('data-server-directory-path="/all/page/2"');
    expect(html).toContain('data-server-filter="all" href="/all" aria-current="page"');
    expect(html).toContain('href="/all/page/2" aria-current="page"');
    expect(html.match(/<article /g)).toHaveLength(2);
    expect(html.match(/data-server-highlighted/g)).toHaveLength(1);
    expect(html).toContain('id="linked-server-title">All</h3>');
    expect(html).toContain(`data-copy-server-link="${origin}${currentPath}"`);

    const cached = await page(currentPath, "HEAD", {
      DB: { prepare() { throw new Error("Unexpected database read"); } } as unknown as D1Database
    });
    expect(cached.status).toBe(200);
    expect(await cached.text()).toBe("");
  });

  it("renders copy links with the local preview's scheme, host, and port", async () => {
    const localOrigin = "http://172.19.83.150:8787";
    await seedSubmitter("local-link");
    await seedOwnedServer("local-link");
    await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, checked_at) VALUES ('server-local-link', 1, ?)")
      .bind(new Date().toISOString()).run();
    const publicId = await testEnv.DB.prepare("SELECT id FROM server_public_ids WHERE server_id = 'server-local-link'")
      .first<number>("id");

    const response = await page("/all", "GET", { APP_ENVIRONMENT: "local" }, localOrigin);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`data-copy-server-link="${localOrigin}/server-local-link.${publicId}/"`);
  });

  it("keeps existing routes ahead of permalinks and returns 404 for private or missing listings", async () => {
    await seedSubmitter("permalink-private");
    await seedOwnedServer("permalink-private", "pending");
    const privateId = await testEnv.DB.prepare("SELECT id FROM server_public_ids WHERE server_id = 'server-permalink-private'")
      .first<number>("id");

    const directory = await page("/all");
    expect(directory.status).toBe(200);
    expect(await directory.text()).not.toContain("data-server-highlighted");
    expect((await page(`/${privateId}/`)).status).toBe(404);
    expect((await page("/permalink-missing/")).status).toBe(404);
    expect((await page("/9999999/", "HEAD")).status).toBe(404);
  });

  it("returns a real 404 for nonexistent pages on GET and HEAD, preserving the empty first page", async () => {
    const empty = await page("/");
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain("No approved servers yet.");

    for (const method of ["GET", "HEAD"]) {
      const missing = await page("/page/2", method);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("x-robots-tag")).toBe("noindex, follow");
      expect(missing.headers.get("content-type")).toContain("text/html");
      if (method === "HEAD") {
        expect(await missing.text()).toBe("");
      }
    }
  });

  it("renders regional results and preserves the filter in links, controls, and canonical metadata", async () => {
    for (let index = 0; index < 10; index += 1) {
      const suffix = `regional-${index}`;
      await seedSubmitter(suffix);
      await seedOwnedServer(suffix);
      await testEnv.DB.prepare("UPDATE servers SET regions_json = ? WHERE id = ?")
        .bind(index === 9 ? '["na-east"]' : '["eu-west","eu-central"]', `server-${suffix}`).run();
      await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, checked_at) VALUES (?, 1, ?)")
        .bind(`server-${suffix}`, new Date().toISOString()).run();
    }

    const response = await page("/region/eu-west?utm_source=test");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, follow");
    expect(response.headers.get("link")).toBe(`<${origin}/region/eu-west>; rel="canonical"`);
    expect(html).toContain(`rel="canonical" href="${origin}/region/eu-west"`);
    expect(html.match(/<article /g)).toHaveLength(8);
    expect(html).toContain('href="/region/eu-west/page/2"');
    expect(html).toContain('href="/offline/region/eu-west"');
    expect(html).toContain('value="eu-west" selected');
    expect(html).not.toContain("play-regional-9.kingdomsx.com");

    const second = await page("/all/region/eu-west/sort/name/page/2");
    const secondHtml = await second.text();

    expect(second.status).toBe(200);
    expect(secondHtml.match(/<article /g)).toHaveLength(1);
    expect(secondHtml).toContain('href="/all/region/eu-west/sort/name"');
    expect(secondHtml).toContain('data-server-sort-form action="/all"');
    expect(secondHtml).toContain('value="name" selected');

    const empty = await page("/region/oceania");
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain("No servers match this region.");
  });

  it("redirects the native filter form to the clean directory URL", async () => {
    const response = await page("/all?region=eu-west&sort=name");

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`${origin}/all/region/eu-west/sort/name`);
  });

  it("shares the normalized public API cache instead of repeating database reads", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const overrides = { PUBLIC_API_RATE_LIMIT: { limit } };
    const first = await page("/all", "GET", overrides);
    await first.text();

    const second = await page("/all?utm_source=test", "HEAD", {
      ...overrides,
      DB: { prepare() { throw new Error("Unexpected database read"); } } as unknown as D1Database
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("");
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable HTML for storage errors and preserves rate-limit status and retry headers", async () => {
    const failed = await page("/", "GET", {
      DB: { prepare() { throw new Error("Test database unavailable"); } } as unknown as D1Database
    });
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.text()).toContain("Server listings are temporarily unavailable.");

    const limited = await page("/", "GET", {
      PUBLIC_API_RATE_LIMIT: { limit: async () => ({ success: false }) }
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.headers.get("x-robots-tag")).toBe("noindex, follow");
    expect(await limited.text()).not.toContain("No approved servers yet.");
  });
});
