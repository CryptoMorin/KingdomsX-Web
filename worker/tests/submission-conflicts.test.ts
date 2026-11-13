import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminApi,
  createChallenge,
  jsonApi,
  resetDatabase,
  seedOwnedServer,
  seedSubmitter,
  stubFetch,
  testEnv,
  verifyPlugin
} from "../test-support/directory";
import { getOwnedServerRow, ownerDeletionStatements } from "../server-directory/submissions/submission-storage";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const description = "This server has a sufficiently long description for another review.";

function statusAfter(change: () => Promise<void>) {
  stubFetch(async (request) => {
    const hostname = new URL(request.url).hostname;

    if (hostname === "challenges.cloudflare.com") {
      return Response.json({ success: true, action: "server-submit" });
    }

    if (hostname === "api.mcsrvstat.us") {
      await change();

      return Response.json({ online: true, players: { online: 1, max: 20 }, version: "26.2" });
    }

    throw new Error(`Unexpected external request: ${request.method} ${request.url}`);
  });
}

describe("Submission conflicts", () => {
  it.each(["approval", "ownership"])("rejects a new submission when the existing listing changes during verification (%s)", async (change) => {
    await seedSubmitter("reclaim-original");
    await seedOwnedServer("reclaim-original", "rejected");
    const cookie = await seedSubmitter("reclaim-request");
    await seedSubmitter("reclaim-winner");
    const address = "play-reclaim-original.kingdomsx.com";
    const challenge = await createChallenge(cookie, address);

    expect((await verifyPlugin(String(challenge.code))).status).toBe(200);

    statusAfter(async () => {
      if (change === "approval") {
        expect((await adminApi("/api/admin/servers/server-reclaim-original/approve")).status).toBe(200);
      } else {
        // Leave the timestamp unchanged to catch checks that rely on it alone
        await testEnv.DB.prepare("UPDATE servers SET owner_account_id = 'account-reclaim-winner', status = 'pending' WHERE id = 'server-reclaim-original'").run();
      }
    });

    const response = await jsonApi("/api/servers/submit", "POST", {
      name: "Stale Reclaim",
      address,
      port: 25565,
      description,
      regions: ["eu-west"],
      verificationChallengeId: challenge.id,
      turnstileToken: "test-token"
    }, { cookie, clientIp: "198.51.100.201" });

    expect(response.status).toBe(409);
    expect(await testEnv.DB.prepare("SELECT owner_account_id, status FROM servers WHERE id = 'server-reclaim-original'").first())
      .toEqual({
        owner_account_id: change === "approval" ? "account-reclaim-original" : "account-reclaim-winner",
        status: change === "approval" ? "approved" : "pending"
      });
    expect(await testEnv.DB.prepare("SELECT status FROM server_verification_challenges WHERE id = ?").bind(challenge.id).first())
      .toEqual({ status: "verified" });
    expect(await testEnv.DB.prepare("SELECT id FROM submissions WHERE owner_account_id = 'account-reclaim-request'").first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT server_id FROM server_status WHERE server_id = 'server-reclaim-original'").first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT id FROM moderation_events WHERE server_id = 'server-reclaim-original' AND action = 'submitted'").first()).toBeNull();
  });

  it("keeps a staff suspension made while a resubmission is being checked", async () => {
    const cookie = await seedSubmitter("resubmit-suspended");
    await seedOwnedServer("resubmit-suspended", "rejected");
    const address = "play-resubmit-suspended.kingdomsx.com";
    const challenge = await createChallenge(cookie, address);

    expect((await verifyPlugin(String(challenge.code))).status).toBe(200);

    statusAfter(async () => {
      expect((await adminApi("/api/admin/servers/server-resubmit-suspended/suspend", { notes: "Staff suspension must survive this request." })).status).toBe(200);
    });

    const response = await jsonApi("/api/servers/me/resubmit", "POST", {
      name: "Stale Resubmission",
      address,
      port: 25565,
      description,
      verificationChallengeId: challenge.id,
      turnstileToken: "test-token"
    }, { cookie, clientIp: "198.51.100.202" });

    expect(response.status).toBe(409);
    const server = await testEnv.DB.prepare("SELECT status, suspended_at FROM servers WHERE id = 'server-resubmit-suspended'")
      .first<{ status: string; suspended_at: string | null }>();

    expect(server?.status).toBe("suspended");
    expect(server?.suspended_at).not.toBeNull();
    expect(await testEnv.DB.prepare("SELECT reason FROM suspended_server_addresses WHERE normalized_host = ?").bind(address).first())
      .toEqual({ reason: "Staff suspension must survive this request." });
    expect(await testEnv.DB.prepare("SELECT desired_action FROM discord_embed_jobs WHERE server_id = 'server-resubmit-suspended'").first())
      .toEqual({ desired_action: "delete" });
    expect(await testEnv.DB.prepare("SELECT status FROM server_verification_challenges WHERE id = ?").bind(challenge.id).first())
      .toEqual({ status: "verified" });
    expect(await testEnv.DB.prepare("SELECT id FROM submissions WHERE server_id = 'server-resubmit-suspended'").first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT server_id FROM server_status WHERE server_id = 'server-resubmit-suspended'").first()).toBeNull();
  });

  it("rejects an outdated submission even when both updates use the same timestamp", async () => {
    const cookie = await seedSubmitter("same-timestamp");
    await seedOwnedServer("same-timestamp");
    const address = "play-same-timestamp.kingdomsx.com";
    const challenge = await createChallenge(cookie, address);

    expect((await verifyPlugin(String(challenge.code))).status).toBe(200);

    const timestamp = new Date(Date.now() + 1_000).toISOString();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp));
    statusAfter(async () => {
      await testEnv.DB.prepare("UPDATE servers SET name = 'Concurrent winner', updated_at = ? WHERE id = 'server-same-timestamp'")
        .bind(timestamp).run();
    });

    const response = await jsonApi("/api/servers/me/resubmit", "POST", {
      name: "Stale Timestamp Update",
      address,
      port: 25565,
      description,
      verificationChallengeId: challenge.id,
      turnstileToken: "test-token"
    }, { cookie, clientIp: "198.51.100.203" });

    expect(response.status).toBe(409);
    expect(await testEnv.DB.prepare("SELECT name, updated_at FROM servers WHERE id = 'server-same-timestamp'").first())
      .toEqual({ name: "Concurrent winner", updated_at: timestamp });
    expect(await testEnv.DB.prepare("SELECT status FROM server_verification_challenges WHERE id = ?").bind(challenge.id).first())
      .toEqual({ status: "verified" });
    expect(await testEnv.DB.prepare("SELECT id FROM submissions WHERE server_id = 'server-same-timestamp'").first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT server_id FROM server_status WHERE server_id = 'server-same-timestamp'").first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT server_id FROM discord_embed_jobs WHERE server_id = 'server-same-timestamp'").first()).toBeNull();
  });

  it("keeps the new owner's submission and history when the previous owner deletes", async () => {
    await seedSubmitter("delete-original");
    await seedSubmitter("delete-winner");
    await seedOwnedServer("delete-original", "rejected");
    const owned = await getOwnedServerRow(testEnv, "account-delete-original");

    expect(owned).not.toBeNull();

    if (!owned) {
      throw new Error("The test owner snapshot is missing.");
    }

    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE servers SET owner_account_id = 'account-delete-winner', status = 'pending' WHERE id = ?").bind(owned.id),
      testEnv.DB.prepare("INSERT INTO submissions (id, server_id, owner_account_id, contact, verification_method, verification_evidence, submitter_ip_hash, user_agent_hash, turnstile_result) VALUES ('new-owner-submission', ?, 'account-delete-winner', 'Tester', 'plugin_callback', 'verified', 'ip', 'ua', '{}')").bind(owned.id),
      testEnv.DB.prepare("INSERT INTO server_status (server_id, online, provider) VALUES (?, 1, 'test-provider')").bind(owned.id),
      testEnv.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action) VALUES ('new-owner-event', ?, 'system', 'submitted')").bind(owned.id)
    ]);

    const results = await testEnv.DB.batch(ownerDeletionStatements(testEnv, {
      owned,
      accountId: "account-delete-original",
      timestamp: new Date().toISOString(),
      reviewSnapshot: null
    }));

    expect(results.at(-1)?.meta.changes).toBe(0);
    expect(await testEnv.DB.prepare("SELECT owner_account_id FROM servers WHERE id = ?").bind(owned.id).first())
      .toEqual({ owner_account_id: "account-delete-winner" });
    expect(await testEnv.DB.prepare("SELECT id FROM submissions WHERE server_id = ?").bind(owned.id).first())
      .toEqual({ id: "new-owner-submission" });
    expect(await testEnv.DB.prepare("SELECT provider FROM server_status WHERE server_id = ?").bind(owned.id).first())
      .toEqual({ provider: "test-provider" });
    expect(await testEnv.DB.prepare("SELECT id FROM moderation_events WHERE server_id = ?").bind(owned.id).first())
      .toEqual({ id: "new-owner-event" });
    expect(await testEnv.DB.prepare("SELECT server_id FROM discord_embed_jobs WHERE server_id = ?").bind(owned.id).first()).toBeNull();
  });
});
