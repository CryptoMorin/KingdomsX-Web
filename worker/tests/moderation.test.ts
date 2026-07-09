import { beforeEach, describe, expect, it } from "vitest";
import {
  testEnv,
  resetDatabase,
  seedSubmitter,
  api,
  jsonApi,
  adminApi,
  createChallenge,
  verifyPlugin,
  stubSubmissionServices,
  seedOwnedServer
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Moderation and submission jobs", () => {
  it("approves independently of Discord and atomically queues an embed", async () => {
    await seedSubmitter("approval");
    await seedOwnedServer("approval", "pending");
    const response = await adminApi("/api/admin/servers/server-approval/approve");

    expect(response.status).toBe(200);
    expect(
      await testEnv.DB.prepare("SELECT status FROM servers WHERE id = 'server-approval'").first()
    ).toEqual({ status: "approved" });
    expect(
      await testEnv.DB.prepare("SELECT desired_action FROM discord_embed_jobs WHERE server_id = 'server-approval'").first()
    ).toEqual({ desired_action: "upsert" });
  });

  it("atomically queues a review notification for a new public submission", async () => {
    const cookie = await seedSubmitter("new-review");
    const challenge = await createChallenge(cookie);
    const verification = await verifyPlugin(String(challenge.code));

    expect(verification.status).toBe(200);
    stubSubmissionServices();

    const response = await jsonApi(
      "/api/servers/submit",
      "POST",
      {
        name: "New Review Server",
        address: "mc.hypixel.net",
        port: 25565,
        description: "A public server description ready for staff review.",
        verificationChallengeId: challenge.id,
        turnstileToken: "test-token",
        websiteUrl: "https://kingdomsx.com",
        socialLinks: {}
      },
      { cookie, clientIp: "198.51.100.220" }
    );

    expect(response.status).toBe(202);
    const body = await response.json<{ id: string }>();

    expect(
      await testEnv.DB.prepare(
        `
      SELECT notification_type
      FROM discord_review_notification_jobs
      WHERE server_id = ?
    `
      )
        .bind(body.id)
        .first()
    ).toEqual({ notification_type: "submitted" });
  });
});

describe("Suspension feedback", () => {
  it("keeps owner feedback separate from deleted-listing bookkeeping", async () => {
    const cookie = await seedSubmitter("suspension-feedback");

    await seedOwnedServer("suspension-feedback");
    const timestamp = new Date().toISOString();

    await testEnv.DB.prepare(
      `
      INSERT INTO submissions (
        id, server_id, owner_account_id, contact, verification_method, verification_evidence,
        submitter_ip_hash, user_agent_hash, turnstile_result, created_at
      ) VALUES (
        'submission-feedback', 'server-suspension-feedback', 'account-suspension-feedback', 'Tester',
        'plugin_callback', 'verified', 'ip-hash', 'ua-hash', '{}', ?
      )
    `
    )
      .bind(timestamp)
      .run();

    const suspension = await adminApi("/api/admin/servers/server-suspension-feedback/suspend", {
      notes: "Correct the rule-breaking public content before requesting review."
    });

    expect(suspension.status).toBe(200);

    const owner = await api("/api/servers/me", { headers: { cookie } });

    expect(owner.status).toBe(200);
    await expect(owner.json()).resolves.toMatchObject({
      item: {
        rejectionReason: "Correct the rule-breaking public content before requesting review."
      }
    });

    const deletion = await api("/api/admin/servers/server-suspension-feedback", {
      method: "DELETE",
      headers: { "x-admin-token": "local-admin-token" }
    });

    expect(deletion.status).toBe(200);
    const address = await testEnv.DB.prepare(
      `
      SELECT reason FROM suspended_server_addresses
      WHERE normalized_host = 'play-suspension-feedback.kingdomsx.com' AND port = 25565
    `
    ).first<{ reason: string }>();

    expect(address?.reason).toBe("This listing is suspended because staff found content or behavior that violates the server listing rules. Contact staff after correcting the issue.");
    expect(address?.reason).not.toContain("Deleted suspended server listing");
  });
});
