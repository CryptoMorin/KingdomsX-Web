import { beforeEach, describe, expect, it } from "vitest";
import {
  testEnv,
  resetDatabase,
  seedSubmitter,
  api,
  jsonApi,
  createChallenge,
  requestChallenge,
  verifyPlugin,
  stubSubmissionServices,
  seedOwnedServer
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Resubmission rules", () => {
  it.each([
    { label: "missing", regions: undefined },
    { label: "empty", regions: [] }
  ])("requires supported regions for a new listing ($label)", async ({ label, regions }) => {
    const cookie = await seedSubmitter(`required-regions-${label}`);
    const response = await jsonApi("/api/servers/submit", "POST", {
      name: "Metadata Server",
      address: "mc.hypixel.net",
      port: 25565,
      description: "This server description is long enough for a new listing review.",
      regions,
      turnstileToken: "test-token"
    }, { cookie });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("region") });
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM servers").first()).toEqual({ total: 0 });
  });

  it.each([true, false])("keeps approval and handles metadata on verified address changes (metadata supplied: %s)", async (includesMetadata) => {
    const suffix = `approved-address-${includesMetadata}`;
    const cookie = await seedSubmitter(suffix);

    await seedOwnedServer(suffix);
    await testEnv.DB.prepare("UPDATE servers SET regions_json = '[\"eu-west\"]', languages_json = '[\"English\"]' WHERE id = ?")
      .bind(`server-${suffix}`)
      .run();
    const created = await createChallenge(cookie, "mc.hypixel.net", "198.51.100.180");
    const verify = await verifyPlugin(String(created.code), "203.0.113.180");

    expect(verify.status).toBe(200);

    stubSubmissionServices();

    const response = await jsonApi(
      "/api/servers/me/resubmit",
      "POST",
      {
        name: "Renamed Approved Server",
        address: "mc.hypixel.net",
        port: 25565,
        description: "This approved server description remains valid after its address changes.",
        ...(includesMetadata ? { regions: ["na-east", "eu-central"], languages: ["English", "French"] } : {}),
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        websiteUrl: "",
        socialLinks: {}
      },
      { cookie, clientIp: "198.51.100.181" }
    );

    expect(response.status).toBe(200);
    expect((await response.json<{ status: string }>()).status).toBe("approved");

    const server = await testEnv.DB.prepare(
      `
      SELECT name, normalized_host, port, status, approved_at, regions_json, languages_json
      FROM servers
      WHERE id = ?
    `
    ).bind(`server-${suffix}`).first<{
      name: string;
      normalized_host: string;
      port: number;
      status: string;
      approved_at: string | null;
      regions_json: string;
      languages_json: string;
    }>();

    expect(server).toEqual({
      name: "Renamed Approved Server",
      normalized_host: "mc.hypixel.net",
      port: 25565,
      status: "approved",
      approved_at: "2026-01-01T00:00:00.000Z",
      regions_json: includesMetadata ? '["na-east","eu-central"]' : '["eu-west"]',
      languages_json: includesMetadata ? '["English","French"]' : '["English"]'
    });
  });

  it("stores normalized regions and languages when creating a listing", async () => {
    const cookie = await seedSubmitter("new-metadata");
    const challenge = await createChallenge(cookie);

    expect((await verifyPlugin(String(challenge.code))).status).toBe(200);
    stubSubmissionServices();

    const response = await jsonApi("/api/servers/submit", "POST", {
      name: "Metadata Server",
      address: "mc.hypixel.net",
      port: 25565,
      description: "This server description is long enough for a new listing review.",
      regions: [" EU-CENTRAL ", "na-east", "eu-central"],
      languages: [" English ", "German", "english", "Bosanski jezik"],
      verificationChallengeId: challenge.id,
      turnstileToken: "test-token"
    }, { cookie, clientIp: "198.51.100.190" });

    expect(response.status).toBe(202);

    const owner = await api("/api/servers/me", { headers: { cookie } });

    await expect(owner.json()).resolves.toMatchObject({
      item: { regions: ["eu-central", "na-east"], languages: ["English", "German", "Bosanski jezik"] }
    });
    const admin = await api("/api/admin/servers?status=pending", {
      headers: { "x-admin-token": "local-admin-token" }
    });

    await expect(admin.json()).resolves.toMatchObject({
      items: [{ regions: ["eu-central", "na-east"], languages: ["English", "German", "Bosanski jezik"] }]
    });
  });

  it("requires rejected listings to verify again after the rejection", async () => {
    const cookie = await seedSubmitter("rejected-cutoff");

    await seedOwnedServer("rejected-cutoff", "rejected");
    const challengeId = crypto.randomUUID();
    const now = Date.now();
    const verifiedAt = new Date(now - 60_000).toISOString();
    const rejectedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 15 * 60_000).toISOString();
    const address = "play-rejected-cutoff.kingdomsx.com";

    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE servers SET updated_at = ? WHERE id = 'server-rejected-cutoff'").bind(rejectedAt),
      testEnv.DB.prepare(
        `
        INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
        VALUES ('rejected-cutoff-event', 'server-rejected-cutoff', 'staff@example.com', 'reject', 'Test rejection.', ?)
      `
      ).bind(rejectedAt),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash, status,
          expires_at, verified_at, created_at, updated_at
        )
        VALUES (
          ?, 'account-rejected-cutoff', 'Rejected Server', ?, 25565,
          'rejected-cutoff-code', 'verified', ?, ?, ?, ?
        )
      `
      ).bind(challengeId, address, expiresAt, verifiedAt, verifiedAt, verifiedAt)
    ]);

    const replacement = await requestChallenge(cookie, address, "198.51.100.182");

    expect(replacement.status).toBe(201);
    expect(await replacement.json<Record<string, unknown>>()).toMatchObject({ status: "pending" });

    stubSubmissionServices(false);

    const response = await jsonApi(
      "/api/servers/me/resubmit",
      "POST",
      {
        name: "Rejected Server",
        address,
        port: 25565,
        description: "This rejected server description is long enough for another staff review.",
        verificationChallengeId: challengeId,
        turnstileToken: "test-token",
        websiteUrl: "",
        socialLinks: {}
      },
      { cookie, clientIp: "198.51.100.183" }
    );

    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toContain("after the latest staff rejection");
  });

  it.each(["public_details_incomplete", "inappropriate_or_unsafe"])(
    "retains verification for %s rejections unless the address changes",
    async (reasonCode) => {
      const cookie = await seedSubmitter("content-rejection");

      await seedOwnedServer("content-rejection", "rejected");
      const timestamp = new Date().toISOString();
      const address = "play-content-rejection.kingdomsx.com";
      const verificationEvidence = "Verified plugin callback evidence";

      await testEnv.DB.batch([
        testEnv.DB.prepare("UPDATE servers SET updated_at = ? WHERE id = 'server-content-rejection'").bind(timestamp),
        testEnv.DB.prepare(
          `
          INSERT INTO submissions (
            id, server_id, owner_account_id, contact, verification_method, verification_evidence,
            submitter_ip_hash, user_agent_hash, turnstile_result, created_at
          )
          VALUES ('content-rejection-submission', 'server-content-rejection', 'account-content-rejection',
                  'Tester', 'plugin_callback', ?, 'ip', 'ua', '{}', ?)
        `
        ).bind(verificationEvidence, timestamp),
        testEnv.DB.prepare(
          `
          INSERT INTO moderation_events (id, server_id, actor, action, notes, reason_code, created_at)
          VALUES ('content-rejection-event', 'server-content-rejection', 'staff@example.com', 'reject',
                  'Fix the public details.', ?, ?)
        `
        ).bind(reasonCode, timestamp)
      ]);

      const ownerState = await api("/api/servers/me", { headers: { cookie } });

      expect(
        (await ownerState.json<{ item: { reverificationRequired: boolean } }>()).item
          .reverificationRequired
      ).toBe(false);

      stubSubmissionServices();

      const requestBody = (serverAddress: string) => ({
        name: "Content Rejection Server",
        address: serverAddress,
        port: 25565,
        description: "The corrected public description is complete and accurate for another review.",
        verificationChallengeId: "",
        turnstileToken: "test-token",
        websiteUrl: "",
        socialLinks: {}
      });

      const changedAddress = await jsonApi(
        "/api/servers/me/resubmit",
        "POST",
        requestBody("new-content-rejection.kingdomsx.com"),
        { cookie, clientIp: "198.51.100.184" }
      );

      expect(changedAddress.status).toBe(400);

      const unchangedAddress = await jsonApi(
        "/api/servers/me/resubmit",
        "POST",
        requestBody(address),
        {
          cookie,
          clientIp: "198.51.100.185"
        }
      );

      expect(unchangedAddress.status).toBe(202);

      const latestSubmission = await testEnv.DB.prepare(
        `
        SELECT verification_evidence, verification_challenge_id
        FROM submissions
        WHERE server_id = 'server-content-rejection'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      ).first<{ verification_evidence: string; verification_challenge_id: string | null }>();

      expect(latestSubmission).toEqual({
        verification_evidence: verificationEvidence,
        verification_challenge_id: null
      });
      expect(
        await testEnv.DB.prepare(
          `
        SELECT submission_id, notification_type
        FROM discord_review_notification_jobs
        WHERE server_id = 'server-content-rejection'
      `
        ).first()
      ).toEqual({
        submission_id: expect.any(String),
        notification_type: "resubmitted"
      });
    }
  );
});
