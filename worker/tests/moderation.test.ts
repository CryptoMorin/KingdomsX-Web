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

describe("Staff listing edits", () => {
  const serverId = "server-staff-edit";
  const path = `/api/admin/servers/${serverId}/details`;
  const adminHeaders = { "x-admin-token": "local-admin-token" };
  const originalVersion = "2026-01-01T00:00:00.000Z";
  const details = {
    updatedAt: originalVersion,
    name: "Corrected listing name",
    description: "Staff corrected the description of the server listing.",
    regions: ["eu-west", "na-east"],
    languages: ["English", "French"],
    websiteUrl: "https://kingdomsx.com/",
    socialLinks: { discord: "https://discord.gg/kingdomsx" },
  };

  async function seedListing(status: "pending" | "approved" | "rejected") {
    await seedSubmitter("staff-edit");
    await seedOwnedServer("staff-edit", status);
  }

  it.each(["pending", "approved"] as const)("edits %s details and queues Discord updates without recording an event", async (status) => {
    await seedListing(status);
    await testEnv.DB.prepare(
      `
      INSERT INTO submissions (
        id, server_id, owner_account_id, contact, verification_method, verification_evidence,
        submitter_ip_hash, user_agent_hash, turnstile_result, created_at
      )
      VALUES ('staff-edit-submission', ?, 'account-staff-edit', 'Tester', 'plugin_callback', 'verified', 'ip-hash', 'ua-hash', '{}', ?)
      `
    ).bind(serverId, originalVersion).run();

    const response = await jsonApi(path, "PATCH", {
      ...details,
      address: "other.kingdomsx.com",
      port: 25566,
      reviewStatus: "suspended",
    }, { headers: adminHeaders });

    expect(response.status).toBe(200);
    const { item } = await response.json<{ item: { updatedAt: string } }>();
    expect(item).toMatchObject({
      name: details.name,
      description: details.description,
      regions: details.regions,
      languages: details.languages,
      websiteUrl: details.websiteUrl,
      socialLinks: [{ key: "discord", url: "https://discord.gg/kingdomsx" }],
      reviewStatus: status,
      address: "play-staff-edit.kingdomsx.com",
    });
    expect(await testEnv.DB.prepare("SELECT desired_status, desired_version FROM discord_review_notification_jobs WHERE server_id = ?")
      .bind(serverId).first()).toEqual({ desired_status: status, desired_version: item.updatedAt });
    expect(await testEnv.DB.prepare("SELECT desired_action, desired_version FROM discord_embed_jobs WHERE server_id = ?")
      .bind(serverId).first()).toEqual(status === "approved" ? { desired_action: "upsert", desired_version: item.updatedAt } : null);
    expect(await testEnv.DB.prepare("SELECT id FROM moderation_events WHERE server_id = ?")
      .bind(serverId).first()).toBeNull();
  });

  it("rejects edits to a listing outside the editable states", async () => {
    await seedListing("rejected");

    const response = await jsonApi(path, "PATCH", details, { headers: adminHeaders });

    expect(response.status).toBe(409);
  });

  it("rejects concurrent saves based on the same revision", async () => {
    await seedListing("approved");

    const responses = await Promise.all(["First correction", "Second correction"].map((name) =>
      jsonApi(path, "PATCH", { ...details, name }, { headers: adminHeaders })
    ));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = responses.find((response) => response.ok);
    const result = await saved?.json<{ item: { name: string; updatedAt: string } }>();

    expect(await testEnv.DB.prepare("SELECT name, updated_at FROM servers WHERE id = ?").bind(serverId).first())
      .toEqual({ name: result?.item.name, updated_at: result?.item.updatedAt });
    expect(await testEnv.DB.prepare("SELECT desired_version FROM discord_embed_jobs WHERE server_id = ?").bind(serverId).first())
      .toEqual({ desired_version: result?.item.updatedAt });
  });
});

describe("Moderation and submission jobs", () => {
  it("approves a listing without waiting for Discord and queues its embed in the same transaction", async () => {
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

  it("queues the review notification in the same transaction as a new public submission", async () => {
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
        regions: ["eu-west"],
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
  it("preserves owner feedback independently of deleted listing records", async () => {
    const cookie = await seedSubmitter("suspension-feedback");

    await seedOwnedServer("suspension-feedback");
    const timestamp = new Date().toISOString();

    await testEnv.DB.prepare(
      `
      INSERT INTO submissions (
        id, server_id, owner_account_id, contact, verification_method, verification_evidence,
        submitter_ip_hash, user_agent_hash, turnstile_result, created_at
      )
      VALUES (
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
  });
});
