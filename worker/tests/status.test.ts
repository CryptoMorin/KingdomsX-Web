import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { fetchServerStatus } from "../server-directory/status/providers";
import {
  adminApi,
  api,
  resetDatabase,
  scheduleServerDirectoryRefresh,
  seedOwnedServer,
  seedSubmitter,
  stubFetch,
  testEnv
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Status providers and refresh policy", () => {
  it.each([
    ["mcsrvstat.us", 0],
    ["mcstatus.io", 1],
    ["minecraftpinger.com", 2],
    ["mcapi.us", 3]
  ])(
    "uses the %s adapter after earlier providers fail",
    async (expectedProvider, successfulIndex) => {
      let requestIndex = 0;

      stubFetch(() => {
        const index = requestIndex++;

        if (index < successfulIndex)
          return new Response(null, { status: 503 });

        if (expectedProvider === "mcsrvstat.us")
          return Response.json({ online: true, players: { online: 1, max: 20 } });

        if (expectedProvider === "mcstatus.io")
          return Response.json({
            online: true,
            players: { online: 2, max: 30 },
            version: { name_clean: "Paper" },
            motd: { clean: "Hello" }
          });

        if (expectedProvider === "minecraftpinger.com")
          return Response.json({
            server: { players: { online: 3, max: 40 }, version: "Paper", motd: "Hello" }
          });

        return Response.json({
          status: "success",
          online: true,
          players: { now: 4, max: 50 },
          server: { name: "Paper" }
        });
      });
      const snapshot = await fetchServerStatus("play.example.com:25565");

      expect(snapshot.provider).toBe(expectedProvider);
      expect(snapshot.online).toBe(true);
    }
  );

  it("reports all-provider failure after trying every adapter", async () => {
    let attempts = 0;

    stubFetch(() => {
      attempts += 1;

      return new Response(null, { status: 503 });
    });
    await expect(fetchServerStatus("play.example.com:25565")).rejects.toThrow("mcapi.us returned 503");
    expect(attempts).toBe(4);
  });

  it("keeps local read refresh non-destructive while scheduled refresh can auto-hide", async () => {
    const oldTimestamp = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO servers (id, slug, name, description, normalized_host, port, social_links_json, status, approved_at, created_at, updated_at)
        VALUES ('status-policy', 'status-policy', 'Status Policy', 'A sufficiently long status policy description.', 'play.example.com', 25565, '[]', 'approved', ?, ?, ?)
      `
      ).bind(oldTimestamp, oldTimestamp, oldTimestamp),
      testEnv.DB.prepare(
        `
        INSERT INTO server_status (server_id, online, checked_at, provider, failure_count, offline_since, refresh_attempted_at)
        VALUES ('status-policy', 0, ?, 'seed', 20, ?, ?)
      `
      ).bind(oldTimestamp, oldTimestamp, oldTimestamp)
    ]);
    stubFetch(() => Response.json({ online: false, players: { online: 0, max: 20 } }));

    const localRead = await api("/api/servers");

    expect(localRead.status).toBe(200);
    expect(
      await testEnv.DB.prepare("SELECT status FROM servers WHERE id = 'status-policy'").first<{
        status: string;
      }>()
    ).toEqual({ status: "approved" });

    await testEnv.DB.prepare("UPDATE server_status SET refresh_attempted_at = ?, offline_since = ? WHERE server_id = 'status-policy'")
      .bind(oldTimestamp, oldTimestamp)
      .run();
    const ctx = createExecutionContext();

    scheduleServerDirectoryRefresh(testEnv, ctx, Date.now(), "*/5 * * * *");
    await waitOnExecutionContext(ctx);
    expect(
      await testEnv.DB.prepare("SELECT status FROM servers WHERE id = 'status-policy'").first<{
        status: string;
      }>()
    ).toEqual({ status: "hidden_offline" });
  });

  it("keeps manual refresh moderation behavior distinct from local read refresh", async () => {
    await seedSubmitter("manual-status");
    await seedOwnedServer("manual-status");
    const oldTimestamp = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    await testEnv.DB.prepare(
      `
      INSERT INTO server_status (server_id, online, checked_at, provider, failure_count, offline_since, refresh_attempted_at)
      VALUES ('server-manual-status', 0, ?, 'seed', 20, ?, ?)
    `
    )
      .bind(oldTimestamp, oldTimestamp, oldTimestamp)
      .run();
    stubFetch(() => Response.json({ online: false, players: { online: 0, max: 20 } }));

    const response = await adminApi("/api/admin/servers/server-manual-status/refresh-status", {
      notes: "Manual status check."
    });

    expect(response.status).toBe(200);
    expect(
      await testEnv.DB.prepare("SELECT status FROM servers WHERE id = 'server-manual-status'").first<{ status: string }>()
    ).toEqual({ status: "hidden_offline" });
  });
});
