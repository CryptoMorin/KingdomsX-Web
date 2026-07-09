import { beforeEach, describe, expect, it } from "vitest";
import {
  sha256,
  testEnv,
  origin,
  resetDatabase,
  seedSubmitter,
  api,
  jsonApi,
  createChallenge,
  requestChallenge,
  pluginPayload,
  verifyPlugin,
  stubSubmissionServices,
  seedOwnedServer
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Plugin verification API", () => {
  it.each([
    {
      name: "malformed code",
      contentType: "application/json",
      body: { code: "invalid" },
      expectedStatus: 400,
      expectedApiStatus: "invalid_request"
    },
    {
      name: "incomplete metadata",
      contentType: "application/json",
      body: { code: "abcd-1234" },
      expectedStatus: 400,
      expectedApiStatus: "invalid_request"
    },
    {
      name: "wrong content type",
      contentType: "text/plain",
      body: pluginPayload("abcd-1234"),
      expectedStatus: 400,
      expectedApiStatus: "invalid_request"
    },
    {
      name: "legacy metadata fields",
      contentType: "application/json",
      body: {
        code: "abcd-1234",
        version: "1.17.27.1.1",
        software: "Paper",
        serverVersion: "26.1.2"
      },
      expectedStatus: 400,
      expectedApiStatus: "invalid_request"
    },
    {
      name: "oversized body",
      contentType: "application/json",
      body: { ...pluginPayload("abcd-1234"), padding: "x".repeat(4_096) },
      expectedStatus: 413,
      expectedApiStatus: "payload_too_large"
    }
  ])("rejects $name", async ({ contentType, body, expectedStatus, expectedApiStatus }) => {
    const response = await api("/api/v1/plugin/verify", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body)
    });

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: expectedApiStatus
    });
  });

  it.each(["/api/plugin/verify", "/api/v0/plugin/verify"])(
    "redirects outdated endpoint %s",
    async (pathname) => {
      const response = await api(pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pluginPayload("abcd-1234"))
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(`${origin}/api/v1/plugin/verify`);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        status: "outdated_api",
        message: "Latest API version is now v1"
      });
    }
  );

  it("does not route unknown future API versions", async () => {
    const response = await api("/api/v2/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload("abcd-1234"))
    });

    expect(response.status).toBe(404);
  });
});

describe("Verification challenge input", () => {
  it("accepts server descriptions up to 240 characters", async () => {
    const cookie = await seedSubmitter("description-limit");
    const headers = {
      "content-type": "application/json",
      "cf-connecting-ip": "198.51.100.210",
      cookie
    };
    const requestBody = (description: string) =>
      JSON.stringify({
        name: "Description Limit Test",
        address: "mc.hypixel.net",
        port: 25565,
        description
      });

    const accepted = await api("/api/servers/verification-challenges", {
      method: "POST",
      headers,
      body: requestBody("x".repeat(240))
    });

    expect(accepted.status).toBe(201);

    const rejected = await api("/api/servers/verification-challenges", {
      method: "POST",
      headers,
      body: requestBody("x".repeat(241))
    });

    expect(rejected.status).toBe(400);
  });
});

describe("Verification challenges and quotas", () => {
  it("reuses, verifies, and expires a challenge consistently", async () => {
    const cookie = await seedSubmitter();
    const created = await createChallenge(cookie, "mc.hypixel.net", "127.0.0.1");
    const reusedPending = await createChallenge(cookie);

    expect(reusedPending.id).toBe(created.id);
    expect(reusedPending.code).toBe(created.code);

    const verify = await verifyPlugin(String(created.code).toUpperCase(), "203.0.113.42");

    expect(verify.status).toBe(200);
    const callback = await testEnv.DB.prepare("SELECT callback_ip FROM server_verification_challenges WHERE id = ?")
      .bind(created.id)
      .first<{ callback_ip: string | null }>();

    expect(callback?.callback_ip).toBe("203.0.113.42");
    const verified = await verify.json<{ expiresAt: string }>();

    expect(verified).toMatchObject({
      ok: true,
      status: "verified",
      message: "Server verification complete. Return to the submission page."
    });
    expect(new Date(verified.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 47 * 60 * 60 * 1000
    );

    const duplicate = await verifyPlugin(String(created.code));

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: false,
      status: "already_verified",
      message: "Server verification is already complete. Return to the submission page."
    });

    const status = await api(`/api/servers/verification-challenges/${created.id}`, {
      headers: { cookie }
    });
    const statusBody = await status.json<{ challenge: Record<string, unknown> }>();

    expect(statusBody.challenge.status).toBe("verified");
    expect(statusBody.challenge).not.toHaveProperty("code");
    expect(statusBody.challenge).not.toHaveProperty("command");

    await testEnv.DB.prepare("UPDATE server_verification_challenges SET verified_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(), created.id)
      .run();

    const expiredStatus = await api(`/api/servers/verification-challenges/${created.id}`, {
      headers: { cookie }
    });

    expect((await expiredStatus.json<{ challenge: { status: string } }>()).challenge.status).toBe("expired");

    const expiredCallback = await verifyPlugin(String(created.code));

    expect(expiredCallback.status).toBe(404);
    await expect(expiredCallback.json()).resolves.toMatchObject({
      ok: false,
      status: "unknown_code",
      message: "Verification code is invalid or expired."
    });

    const replacement = await createChallenge(cookie);

    expect(replacement.id).not.toBe(created.id);
  });

  it("rate-limits challenge generation by Discord account before further D1 reads", async () => {
    const cookie = await seedSubmitter("create-limit");
    const createdIds: unknown[] = [];

    for (let index = 0; index < 5; index += 1) {
      const response = await requestChallenge(cookie, "mc.hypixel.net", `198.51.101.${index + 1}`);

      expect([200, 201]).toContain(response.status);
      createdIds.push((await response.json<Record<string, unknown>>()).id);
    }

    expect(new Set(createdIds).size).toBe(1);

    const blocked = await requestChallenge(cookie, "mc.hypixel.net", "198.51.101.6");

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });

  it("rate-limits verification status checks before and after authentication", async () => {
    const unauthenticatedPath = "/api/servers/verification-challenges/00000000-0000-4000-8000-000000000000";

    for (let index = 0; index < 10; index += 1) {
      const response = await api(unauthenticatedPath, {
        headers: { "cf-connecting-ip": "198.51.100.250" }
      });

      expect(response.status).toBe(401);
    }

    const ipBlocked = await api(unauthenticatedPath, {
      headers: { "cf-connecting-ip": "198.51.100.250" }
    });

    expect(ipBlocked.status).toBe(429);

    const cookie = await seedSubmitter("status-limit");
    const created = await createChallenge(cookie, "mc.hypixel.net", "198.51.100.249");

    for (let index = 0; index < 6; index += 1) {
      const response = await api(`/api/servers/verification-challenges/${created.id}`, {
        headers: {
          cookie,
          "cf-connecting-ip": `198.51.101.${index + 20}`
        }
      });

      expect(response.status).toBe(200);
    }

    const accountBlocked = await api(`/api/servers/verification-challenges/${created.id}`, {
      headers: {
        cookie,
        "cf-connecting-ip": "198.51.101.26"
      }
    });

    expect(accountBlocked.status).toBe(429);
  });

  it("keeps challenges isolated by Discord account and server address", async () => {
    const ownerCookie = await seedSubmitter("owner");
    const otherCookie = await seedSubmitter("other");
    const created = await createChallenge(ownerCookie);

    const crossAccount = await api(`/api/servers/verification-challenges/${created.id}`, {
      headers: { cookie: otherCookie }
    });

    expect(crossAccount.status).toBe(404);

    await verifyPlugin(String(created.code));

    stubSubmissionServices(false);

    const mismatch = await jsonApi(
      "/api/servers/submit",
      "POST",
      {
        name: "Verification Test",
        address: "play.cubecraft.net",
        port: 25565,
      description: "This test description is long enough for server verification.",
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        socialLinks: []
      },
      { cookie: ownerCookie }
    );

    expect(mismatch.status).toBe(400);
    expect((await mismatch.json<{ error: string }>()).error).toContain("does not match");
  });

  it("does not accept or reuse a consumed challenge", async () => {
    const cookie = await seedSubmitter();
    const created = await createChallenge(cookie);

    await verifyPlugin(String(created.code));

    const consumedAt = new Date().toISOString();

    await testEnv.DB.prepare(
      `
      UPDATE server_verification_challenges
      SET status = 'consumed', consumed_at = ?, updated_at = ?
      WHERE id = ?
    `
    )
      .bind(consumedAt, consumedAt, created.id)
      .run();

    const duplicate = await verifyPlugin(String(created.code));

    expect(duplicate.status).toBe(404);

    const replacement = await createChallenge(cookie);

    expect(replacement.id).not.toBe(created.id);
    expect(replacement.status).toBe("pending");
  });

  it("keeps daily submission quotas after listing data is deleted", async () => {
    const cookie = await seedSubmitter("quota");
    const timestamp = new Date().toISOString();
    const ipHash = await sha256("verification-test-rate-limit-salt:127.0.0.1");

    await testEnv.DB.batch(
      Array.from({ length: 3 }, (_, index) =>
        testEnv.DB.prepare(
          `
      INSERT INTO server_verification_challenges (
        id, owner_account_id, server_name, normalized_host, port, code_hash, status,
        expires_at, verified_at, consumed_at, created_ip_hash, created_at, updated_at
      )
      VALUES (?, 'account-quota', 'Quota Test', ?, 25565, ?, 'consumed', ?, ?, ?, ?, ?, ?)
    `
        ).bind(
          `consumed-quota-${index}`,
          `old-${index}.kingdomsx.com`,
          `consumed-code-${index}`,
          timestamp,
          timestamp,
          timestamp,
          ipHash,
          timestamp,
          timestamp
        )
      )
    );

    const created = await createChallenge(cookie, "mc.hypixel.net", "127.0.0.1");
    const verify = await verifyPlugin(String(created.code));

    expect(verify.status).toBe(200);

    const submit = await jsonApi(
      "/api/servers/submit",
      "POST",
      {
        name: "Verification Test",
        address: "mc.hypixel.net",
        port: 25565,
      description: "This test description is long enough for server verification.",
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        socialLinks: {}
      },
      { cookie }
    );

    expect(submit.status).toBe(429);
    expect((await submit.json<{ error: string }>()).error).toContain("Too many submissions");

    const current = await testEnv.DB.prepare("SELECT status FROM server_verification_challenges WHERE id = ?")
      .bind(created.id)
      .first<{ status: string }>();

    expect(current?.status).toBe("verified");
  });

  it("retains consumed verification proof after owner deletion for durable quotas", async () => {
    const cookie = await seedSubmitter("delete-proof");

    await seedOwnedServer("delete-proof");
    const timestamp = new Date().toISOString();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash, status,
          expires_at, verified_at, consumed_at, created_at, updated_at
        )
        VALUES (
          'delete-proof-challenge', 'account-delete-proof', 'Delete Proof',
          'play-delete-proof.kingdomsx.com', 25565, 'delete-proof-code',
          'consumed', ?, ?, ?, ?, ?
        )
      `
      ).bind(timestamp, timestamp, timestamp, timestamp, timestamp),
      testEnv.DB.prepare(
        `
        INSERT INTO submissions (
          id, server_id, owner_account_id, contact, verification_method, verification_evidence,
          submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id, created_at
        )
        VALUES ('delete-proof-submission', 'server-delete-proof', 'account-delete-proof', 'Tester',
                'plugin_callback', 'proof', 'ip', 'ua', '{}', 'delete-proof-challenge', ?)
      `
      ).bind(timestamp)
    ]);

    const response = await api("/api/servers/me", {
      method: "DELETE",
      headers: { cookie }
    });

    expect(response.status).toBe(200);
    expect(
      await testEnv.DB.prepare("SELECT id FROM server_verification_challenges WHERE id = 'delete-proof-challenge'").first()
    ).not.toBeNull();
    expect(
      await testEnv.DB.prepare("SELECT id FROM submissions WHERE id = 'delete-proof-submission'").first()
    ).toBeNull();
  });
});
