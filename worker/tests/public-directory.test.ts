import { beforeEach, describe, expect, it } from "vitest";
import {
  createExecutionContext,
  waitOnExecutionContext,
  testEnv,
  resetDatabase,
  seedSubmitter,
  api,
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
    await waitOnExecutionContext(firstContext);

    const second = await api("/api/servers/missing-server", {}, createExecutionContext());

    expect(second.status).toBe(404);
    expect(second.headers.get("x-kingdomsx-cache")).toBe("HIT");
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
});
