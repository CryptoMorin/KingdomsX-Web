import { beforeEach, describe, expect, it } from "vitest";
import {
  createExecutionContext,
  waitOnExecutionContext,
  testEnv,
  resetDatabase,
  seedSubmitter,
  api,
  jsonApi,
  updatePublicDetails,
  stubFetch,
  seedOwnedServer
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Public server APIs", () => {
  it("limits public pages and caches missing server slugs", async () => {
    const page = await api("/api/servers?page=10000&limit=8");

    expect(page.status).toBe(200);
    const pageBody = await page.json<{ page: number; items: unknown[] }>();

    expect(pageBody.page).toBe(100);
    expect(pageBody.items).toEqual([]);

    const unsupportedLimit = await api("/api/servers?limit=50");

    expect((await unsupportedLimit.json<{ limit: number }>()).limit).toBe(8);

    const firstContext = createExecutionContext();
    const first = await api("/api/servers/missing-server", {}, firstContext);

    expect(first.status).toBe(404);
    expect(first.headers.get("x-kingdomsx-cache")).toBe("MISS");
    expect(first.headers.get("cache-control")).toBe("public, max-age=120, stale-while-revalidate=300");
    await waitOnExecutionContext(firstContext);

    const second = await api("/api/servers/missing-server", {}, createExecutionContext());

    expect(second.status).toBe(404);
    expect(second.headers.get("x-kingdomsx-cache")).toBe("HIT");
    expect(second.headers.get("cache-control")).toBe(first.headers.get("cache-control"));
  });

  it("restores the public cache policy when Cloudflare changes cached response headers", async () => {
    const cacheKey = new Request("https://servers.kingdomsx.com/api/servers/cached-policy?projection=2");
    const cachedResponse = Response.json({ item: null }, {
      status: 404,
      headers: { "cache-control": "public, max-age=14400", "access-control-allow-origin": "*" }
    });

    await caches.default.put(cacheKey, cachedResponse);

    const response = await api("/api/servers/cached-policy", {}, createExecutionContext());

    expect(response.status).toBe(404);
    expect(response.headers.get("x-kingdomsx-cache")).toBe("HIT");
    expect(response.headers.get("cache-control")).toBe("public, max-age=120, stale-while-revalidate=300");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ item: null });
  });

  it("returns the owner's Discord display name and username in public listings", async () => {
    await seedSubmitter("public-owner");
    await seedOwnedServer("public-owner");
    stubFetch(async () =>
      Response.json({
        online: true,
        players: { online: 1, max: 20 },
        version: "26.2"
      })
    );

    const response = await api("/api/servers/server-public-owner");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      item: {
        regions: ["eu-west"],
        languages: [],
        owner: {
          displayName: "Tester public-owner",
          username: "Testerpublic-owner"
        }
      }
    });
  });

  it("rejects malformed session cookies before authenticated reads", async () => {
    const response = await api("/api/servers/me", {
      headers: { cookie: "kingdomsx_submit_session=short" }
    });

    expect(response.status).toBe(200);
    expect((await response.json<{ authenticated: boolean }>()).authenticated).toBe(false);
  });

  it("updates metadata without re-verification and preserves it for older detail clients", async () => {
    const cookie = await seedSubmitter("metadata-details");

    await seedOwnedServer("metadata-details");

    const changed = await updatePublicDetails(cookie, {
      description: "A sufficiently long server description for testing.",
      regions: ["eu-central", "eu-west"],
      languages: [" English ", "Deutsch", "english", "日本語"]
    });

    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({
      item: { regions: ["eu-central", "eu-west"], languages: ["English", "Deutsch", "日本語"], reviewStatus: "approved" }
    });

    const saved = await testEnv.DB.prepare("SELECT updated_at FROM servers WHERE id = 'server-metadata-details'").first<{ updated_at: string }>();
    const unchanged = await updatePublicDetails(cookie, {
      description: "A sufficiently long server description for testing.",
      regions: ["eu-west", "eu-central"],
      languages: ["日本語", "english", "DEUTSCH"]
    });

    await expect(unchanged.json()).resolves.toMatchObject({ unchanged: true });
    expect(await testEnv.DB.prepare("SELECT updated_at FROM servers WHERE id = 'server-metadata-details'").first()).toEqual(saved);

    const olderClient = await updatePublicDetails(cookie, {
      description: "This older client's changed description is long enough for validation."
    });

    await expect(olderClient.json()).resolves.toMatchObject({
      item: { regions: ["eu-central", "eu-west"], languages: ["English", "Deutsch", "日本語"] }
    });

    stubFetch(async () => Response.json({ online: true, players: { online: 1, max: 20 }, version: "26.2" }));

    for (const path of ["/api/servers/server-metadata-details", "/api/servers", "/api/servers/recent"]) {
      const response = await api(path);
      const body = await response.json<{ item?: unknown; items?: unknown[] }>();

      expect(body.item ?? body.items?.[0]).toMatchObject({ regions: ["eu-central", "eu-west"], languages: ["English", "Deutsch", "日本語"] });
    }

    const cleared = await updatePublicDetails(cookie, {
      description: "This older client's changed description is long enough for validation.",
      languages: []
    });

    await expect(cleared.json()).resolves.toMatchObject({ item: { regions: ["eu-central", "eu-west"], languages: [] } });
  });

  it.each([
    { regions: ["unsupported"] },
    { regions: "eu-west" },
    { languages: "English" },
    { languages: [false] },
    { languages: ["English\u0000"] },
    { languages: ["Chinese, Simplified"] },
    { languages: [""] },
    { languages: ["a".repeat(41)] },
    { languages: Array.from({ length: 11 }, (_, index) => `Language ${index}`) }
  ])("rejects malformed listing metadata %j before saving", async (metadata) => {
    const cookie = await seedSubmitter("invalid-metadata");

    await seedOwnedServer("invalid-metadata");

    const response = await jsonApi("/api/servers/me/details", "PATCH", {
      description: "A sufficiently long server description for testing.",
      ...metadata
    }, { cookie });

    expect(response.status).toBe(400);
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM moderation_events").first()).toEqual({ total: 0 });
  });

  it("does not write public detail updates when normalized values are unchanged", async () => {
    const cookie = await seedSubmitter("details");

    await seedOwnedServer("details");

    const unchanged = await updatePublicDetails(cookie, {
      description: "A sufficiently long server description for testing.",
      websiteUrl: ""
    });

    expect(unchanged.status).toBe(200);
    expect((await unchanged.json<{ unchanged?: boolean }>()).unchanged).toBe(true);

    const unchangedRow = await testEnv.DB.prepare("SELECT updated_at FROM servers WHERE id = 'server-details'").first<{ updated_at: string }>();
    const unchangedEvents = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM moderation_events WHERE server_id = 'server-details'").first<{ total: number }>();

    expect(unchangedRow?.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(unchangedEvents?.total).toBe(0);

    const changed = await updatePublicDetails(cookie, {
      name: "Renamed Server",
      description: "This changed description remains long enough for validation.",
      websiteUrl: "https://kingdomsx.com"
    });

    expect(changed.status).toBe(200);

    const changedServer = await testEnv.DB.prepare("SELECT name, status, approved_at FROM servers WHERE id = 'server-details'").first<{ name: string; status: string; approved_at: string | null }>();
    const changedEvents = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM moderation_events WHERE server_id = 'server-details'").first<{ total: number }>();

    expect(changedServer).toEqual({
      name: "Renamed Server",
      status: "approved",
      approved_at: "2026-01-01T00:00:00.000Z"
    });
    expect(changedEvents?.total).toBe(1);
    expect(
      await testEnv.DB.prepare("SELECT desired_action FROM discord_embed_jobs WHERE server_id = 'server-details'").first<{ desired_action: string }>()
    ).toEqual({ desired_action: "upsert" });
  });

  it("filters multi-region memberships and status counts without duplicating listings", async () => {
    const timestamp = new Date().toISOString();

    for (const [suffix, regions, online] of [
      ["region-west", ["eu-west"], 0],
      ["region-east", ["na-east"], 1],
      ["region-both", ["eu-west", "na-east", "eu-west"], 1]
    ] as const) {
      await seedSubmitter(suffix);
      await seedOwnedServer(suffix);
      await testEnv.DB.prepare("UPDATE servers SET regions_json = ? WHERE id = ?")
        .bind(JSON.stringify(regions), `server-${suffix}`).run();
      await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, checked_at, refresh_attempted_at) VALUES (?, ?, ?, ?)")
        .bind(`server-${suffix}`, online, timestamp, timestamp).run();
    }

    const west = await api("/api/servers?region=eu-west&status=all&sort=name");
    await expect(west.json()).resolves.toMatchObject({
      region: "eu-west",
      total: 2,
      totalPages: 1,
      counts: { all: 2, online: 1, offline: 1 },
      items: [{ slug: "server-region-both" }, { slug: "server-region-west" }]
    });

    const online = await api("/api/servers?region=eu-west&status=online");
    await expect(online.json()).resolves.toMatchObject({ total: 1, items: [{ slug: "server-region-both" }] });

    const east = await api("/api/servers?region=na-east");
    await expect(east.json()).resolves.toMatchObject({ region: "na-east", total: 2, counts: { all: 2, online: 2, offline: 0 } });

    const empty = await api("/api/servers?region=oceania");
    await expect(empty.json()).resolves.toMatchObject({ total: 0, items: [], counts: { all: 0, online: 0, offline: 0 } });

    const recent = await api("/api/servers/recent?region=oceania");
    expect((await recent.json<{ items: unknown[] }>()).items).toHaveLength(3);
  });

  it("isolates regional cache entries and normalizes invalid region filters to all regions", async () => {
    await seedSubmitter("cached-region");
    await seedOwnedServer("cached-region");
    const timestamp = new Date().toISOString();
    await testEnv.DB.prepare("INSERT INTO server_status (server_id, online, checked_at, refresh_attempted_at) VALUES ('server-cached-region', 1, ?, ?)")
      .bind(timestamp, timestamp).run();

    const westContext = createExecutionContext();
    const west = await api("/api/servers?region=eu-west", {}, westContext);
    expect(west.headers.get("x-kingdomsx-cache")).toBe("MISS");
    expect((await west.json<{ total: number }>()).total).toBe(1);
    await waitOnExecutionContext(westContext);

    const eastContext = createExecutionContext();
    const east = await api("/api/servers?region=na-east", {}, eastContext);
    expect(east.headers.get("x-kingdomsx-cache")).toBe("MISS");
    expect((await east.json<{ total: number }>()).total).toBe(0);
    await waitOnExecutionContext(eastContext);

    const westAgain = await api("/api/servers?region=EU-WEST", {}, createExecutionContext());
    expect(westAgain.headers.get("x-kingdomsx-cache")).toBe("HIT");
    await expect(westAgain.json()).resolves.toMatchObject({ region: "eu-west", total: 1 });

    const allContext = createExecutionContext();
    await api("/api/servers", {}, allContext);
    await waitOnExecutionContext(allContext);
    const invalid = await api("/api/servers?region=unsupported", {}, createExecutionContext());
    expect(invalid.headers.get("x-kingdomsx-cache")).toBe("HIT");
    await expect(invalid.json()).resolves.toMatchObject({ region: "", total: 1 });
  });
});
