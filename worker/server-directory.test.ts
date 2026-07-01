import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import {
  handleServerDirectoryRequest,
  scheduleServerDirectoryRefresh,
  type ServerDirectoryEnv
} from "./server-directory";

const testEnv = env as ServerDirectoryEnv;
const origin = "https://servers.kingdomsx.com";
let challengeIpCounter = 1;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSubmitter(suffix = "one"): Promise<string> {
  const token = await sha256(`test-session-${suffix}`);
  const sessionHash = await sha256(`verification-test-session-secret:${token}`);
  const timestamp = new Date().toISOString();
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO submitter_accounts (id, discord_user_id, username, global_name, guild_member_checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(`account-${suffix}`, `discord-${suffix}`, `Tester${suffix}`, `Tester ${suffix}`, timestamp, timestamp, timestamp),
    testEnv.DB.prepare(`
      INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`session-${suffix}`, `account-${suffix}`, sessionHash, new Date(Date.now() + 86_400_000).toISOString(), timestamp, timestamp)
  ]);
  return `kx_submit_session=${token}`;
}

async function api(pathname: string, init: RequestInit = {}, ctx?: ExecutionContext): Promise<Response> {
  return handleServerDirectoryRequest(new Request(`${origin}${pathname}`, init), testEnv, ctx);
}

async function createChallenge(
  cookie: string,
  address = "mc.hypixel.net",
  clientIp = `198.51.100.${challengeIpCounter++}`
): Promise<Record<string, unknown>> {
  const response = await requestChallenge(cookie, address, clientIp);
  expect([200, 201]).toContain(response.status);
  return response.json<Record<string, unknown>>();
}

async function requestChallenge(cookie: string, address: string, clientIp: string): Promise<Response> {
  return api("/api/servers/verification-challenges", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": clientIp, cookie },
    body: JSON.stringify({
      name: "Verification Test",
      address,
      port: 25565,
      description: "This test description is long enough for server verification."
    })
  });
}

function pluginPayload(code: string) {
  return {
    code,
    pluginVersion: "1.17.27.1.1",
    serverSoftware: "Paper",
    minecraftVersion: "26.1.2"
  };
}

async function workerRoute(url: string, requestedAssets: string[]): Promise<Response> {
  const routeEnv = {
    APP_ENVIRONMENT: "production",
    DB: testEnv.DB,
    ASSETS: {
      async fetch(input: RequestInfo | URL): Promise<Response> {
        const request = input instanceof Request ? input : new Request(input);
        requestedAssets.push(new URL(request.url).pathname);
        return new Response(`<!doctype html><html><head><title>Test</title></head><body>Asset</body></html>`, {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    }
  } as Parameters<typeof worker.fetch>[1];
  const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
  return worker.fetch(new Request(url), routeEnv, ctx);
}

async function seedOwnedServer(accountSuffix = "one", status: "approved" | "pending" = "approved"): Promise<void> {
  const timestamp = "2026-01-01T00:00:00.000Z";
  await testEnv.DB.prepare(`
    INSERT INTO servers (
      id, slug, name, description, normalized_host, port, website_url, social_links_json,
      status, owner_account_id, approved_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 25565, NULL, '[]', ?, ?, ?, ?, ?)
  `).bind(
    `server-${accountSuffix}`,
    `server-${accountSuffix}`,
    `Server ${accountSuffix}`,
    "A sufficiently long server description for testing.",
    `play-${accountSuffix}.kingdomsx.com`,
    status,
    `account-${accountSuffix}`,
    status === "approved" ? timestamp : null,
    timestamp,
    timestamp
  ).run();
}

describe("server verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("DELETE FROM submissions"),
      testEnv.DB.prepare("DELETE FROM server_verification_challenges"),
      testEnv.DB.prepare("DELETE FROM server_status"),
      testEnv.DB.prepare("DELETE FROM moderation_events"),
      testEnv.DB.prepare("DELETE FROM servers"),
      testEnv.DB.prepare("DELETE FROM submitter_sessions"),
      testEnv.DB.prepare("DELETE FROM submitter_accounts")
    ]);
  });

  it("rejects malformed and incomplete callbacks before verification", async () => {
    const malformed = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "invalid" })
    });
    expect(malformed.status).toBe(400);

    const incomplete = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abcd-1234" })
    });
    expect(incomplete.status).toBe(400);

    const legacyFieldNames = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "abcd-1234",
        version: "1.17.27.1.1",
        software: "Paper",
        serverVersion: "26.1.2"
      })
    });
    expect(legacyFieldNames.status).toBe(400);

    const oversized = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...pluginPayload("abcd-1234"), padding: "x".repeat(4_096) })
    });
    expect(oversized.status).toBe(413);
  });

  it("accepts server descriptions up to 240 characters", async () => {
    const cookie = await seedSubmitter("description-limit");
    const headers = {
      "content-type": "application/json",
      "cf-connecting-ip": "198.51.100.210",
      cookie
    };
    const requestBody = (description: string) => JSON.stringify({
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

  it("preserves canonical routing on every production hostname", async () => {
    const requestedAssets: string[] = [];

    const www = await workerRoute("https://www.kingdomsx.com/", requestedAssets);
    expect(www.status).toBe(301);
    expect(www.headers.get("location")).toBe("https://kingdomsx.com/");

    const legacy = await workerRoute("https://kingdomsx.com/servers/all", requestedAssets);
    expect(legacy.status).toBe(301);
    expect(legacy.headers.get("location")).toBe("https://servers.kingdomsx.com/all");

    const directory = await workerRoute("https://servers.kingdomsx.com/all/sort/name/page/2", requestedAssets);
    expect(directory.status).toBe(200);
    expect(requestedAssets.at(-1)).toBe("/servers.html");

    const submit = await workerRoute("https://servers.kingdomsx.com/submit", requestedAssets);
    expect(submit.status).toBe(200);
    expect(requestedAssets.at(-1)).toBe("/servers/submit.html");

    const invalidPage = await workerRoute("https://servers.kingdomsx.com/page/101", requestedAssets);
    expect(invalidPage.status).toBe(404);
    expect(requestedAssets.at(-1)).toBe("/404");

    const assetHostBuild = await workerRoute("https://assets.kingdomsx.com/build/example.js", requestedAssets);
    expect(assetHostBuild.status).toBe(200);
    expect(requestedAssets.at(-1)).toBe("/build/example.js");

    const assetHostOther = await workerRoute("https://assets.kingdomsx.com/favicon.ico", requestedAssets);
    expect(assetHostOther.status).toBe(404);
    expect(requestedAssets.at(-1)).toBe("/404");
  });

  it("bounds public pagination and negatively caches missing server slugs", async () => {
    const page = await api("/api/servers?page=10000&limit=8");
    expect(page.status).toBe(200);
    const pageBody = await page.json<{ page: number; items: unknown[] }>();
    expect(pageBody.page).toBe(100);
    expect(pageBody.items).toEqual([]);

    const unsupportedLimit = await api("/api/servers?limit=50");
    expect((await unsupportedLimit.json<{ limit: number }>()).limit).toBe(8);

    const firstTasks: Promise<unknown>[] = [];
    const first = await api(
      "/api/servers/missing-server",
      {},
      { waitUntil: (promise) => firstTasks.push(promise) } as ExecutionContext
    );
    expect(first.status).toBe(404);
    expect(first.headers.get("x-kingdomsx-cache")).toBe("MISS");
    await Promise.all(firstTasks);

    const second = await api(
      "/api/servers/missing-server",
      {},
      { waitUntil: () => undefined } as unknown as ExecutionContext
    );
    expect(second.status).toBe(404);
    expect(second.headers.get("x-kingdomsx-cache")).toBe("HIT");
  });

  it("rejects malformed session cookies before authenticated reads", async () => {
    const response = await api("/api/servers/me", {
      headers: { cookie: "kx_submit_session=short" }
    });
    expect(response.status).toBe(200);
    expect((await response.json<{ authenticated: boolean }>()).authenticated).toBe(false);
  });

  it("does not write public detail updates when normalized values are unchanged", async () => {
    const cookie = await seedSubmitter("details");
    await seedOwnedServer("details");

    const unchanged = await api("/api/servers/me/details", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        description: "A sufficiently long server description for testing.",
        websiteUrl: "",
        socialLinks: {}
      })
    });
    expect(unchanged.status).toBe(200);
    expect((await unchanged.json<{ unchanged?: boolean }>()).unchanged).toBe(true);

    const unchangedRow = await testEnv.DB.prepare("SELECT updated_at FROM servers WHERE id = 'server-details'")
      .first<{ updated_at: string }>();
    const unchangedEvents = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM moderation_events WHERE server_id = 'server-details'")
      .first<{ total: number }>();
    expect(unchangedRow?.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(unchangedEvents?.total).toBe(0);

    const changed = await api("/api/servers/me/details", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Renamed Server",
        description: "This changed description remains long enough for validation.",
        websiteUrl: "https://kingdomsx.com",
        socialLinks: {}
      })
    });
    expect(changed.status).toBe(200);

    const changedServer = await testEnv.DB.prepare("SELECT name, status, approved_at FROM servers WHERE id = 'server-details'")
      .first<{ name: string; status: string; approved_at: string | null }>();
    const changedEvents = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM moderation_events WHERE server_id = 'server-details'")
      .first<{ total: number }>();
    expect(changedServer).toEqual({
      name: "Renamed Server",
      status: "approved",
      approved_at: "2026-01-01T00:00:00.000Z"
    });
    expect(changedEvents?.total).toBe(1);
  });

  it("keeps an approved listing approved after a verified address change", async () => {
    const cookie = await seedSubmitter("approved-address");
    await seedOwnedServer("approved-address");
    const created = await createChallenge(cookie, "mc.hypixel.net", "198.51.100.180");
    const verify = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.180" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });
    expect(verify.status).toBe(200);

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.hostname === "challenges.cloudflare.com") {
        return Response.json({ success: true, action: "test" });
      }

      if (url.hostname === "api.mcsrvstat.us") {
        return Response.json({
          online: true,
          players: { online: 1, max: 20 },
          version: "26.2"
        });
      }

      return new Response("Not mocked", { status: 500 });
    });

    const response = await api("/api/servers/me/resubmit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.181",
        cookie
      },
      body: JSON.stringify({
        name: "Renamed Approved Server",
        address: "mc.hypixel.net",
        port: 25565,
        description: "This approved server description remains valid after its address changes.",
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        websiteUrl: "",
        socialLinks: {}
      })
    });
    expect(response.status).toBe(200);
    expect((await response.json<{ status: string }>()).status).toBe("approved");

    const server = await testEnv.DB.prepare(`
      SELECT name, normalized_host, port, status, approved_at
      FROM servers
      WHERE id = 'server-approved-address'
    `).first<{ name: string; normalized_host: string; port: number; status: string; approved_at: string | null }>();
    expect(server).toEqual({
      name: "Renamed Approved Server",
      normalized_host: "mc.hypixel.net",
      port: 25565,
      status: "approved",
      approved_at: "2026-01-01T00:00:00.000Z"
    });
  });

  it("reuses, verifies, and expires a challenge consistently", async () => {
    const cookie = await seedSubmitter();
    const created = await createChallenge(cookie, "mc.hypixel.net", "127.0.0.1");
    const reusedPending = await createChallenge(cookie);
    expect(reusedPending.id).toBe(created.id);
    expect(reusedPending.code).toBe(created.code);

    const verify = await api("/api/plugin/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.42"
      },
      body: JSON.stringify(pluginPayload(String(created.code).toUpperCase()))
    });
    expect(verify.status).toBe(200);
    const callback = await testEnv.DB.prepare("SELECT callback_ip FROM server_verification_challenges WHERE id = ?")
      .bind(created.id)
      .first<{ callback_ip: string | null }>();
    expect(callback?.callback_ip).toBe("203.0.113.42");
    const verified = await verify.json<{ expiresAt: string }>();
    expect(new Date(verified.expiresAt).getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);

    const duplicate = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });
    expect(duplicate.status).toBe(200);

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

    const expiredCallback = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });
    expect(expiredCallback.status).toBe(404);

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

    await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.hostname === "challenges.cloudflare.com") {
        return Response.json({ success: true, action: "test" });
      }

      return new Response("Not mocked", { status: 500 });
    });

    const mismatch = await api("/api/servers/submit", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({
        name: "Verification Test",
        address: "play.cubecraft.net",
        port: 25565,
        description: "This test description is long enough for server verification.",
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        socialLinks: []
      })
    });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json<{ error: string }>()).error).toContain("does not match");
  });

  it("does not accept or reuse a consumed challenge", async () => {
    const cookie = await seedSubmitter();
    const created = await createChallenge(cookie);
    await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });

    const consumedAt = new Date().toISOString();
    await testEnv.DB.prepare(`
      UPDATE server_verification_challenges
      SET status = 'consumed', consumed_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(consumedAt, consumedAt, created.id).run();

    const duplicate = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });
    expect(duplicate.status).toBe(404);

    const replacement = await createChallenge(cookie);
    expect(replacement.id).not.toBe(created.id);
    expect(replacement.status).toBe("pending");
  });

  it("keeps daily submission quotas after listing data is deleted", async () => {
    const cookie = await seedSubmitter("quota");
    const timestamp = new Date().toISOString();
    const ipHash = await sha256("verification-test-rate-limit-salt:127.0.0.1");
    await testEnv.DB.batch(Array.from({ length: 3 }, (_, index) => testEnv.DB.prepare(`
      INSERT INTO server_verification_challenges (
        id, owner_account_id, server_name, normalized_host, port, code_hash, status,
        expires_at, verified_at, consumed_at, created_ip_hash, created_at, updated_at
      )
      VALUES (?, 'account-quota', 'Quota Test', ?, 25565, ?, 'consumed', ?, ?, ?, ?, ?, ?)
    `).bind(
      `consumed-quota-${index}`,
      `old-${index}.kingdomsx.com`,
      `consumed-code-${index}`,
      timestamp,
      timestamp,
      timestamp,
      ipHash,
      timestamp,
      timestamp
    )));

    const created = await createChallenge(cookie, "mc.hypixel.net", "127.0.0.1");
    const verify = await api("/api/plugin/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pluginPayload(String(created.code)))
    });
    expect(verify.status).toBe(200);

    const submit = await api("/api/servers/submit", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Verification Test",
        address: "mc.hypixel.net",
        port: 25565,
        description: "This test description is long enough for server verification.",
        verificationChallengeId: created.id,
        turnstileToken: "test-token",
        socialLinks: {}
      })
    });
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
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash, status,
          expires_at, verified_at, consumed_at, created_at, updated_at
        )
        VALUES ('delete-proof-challenge', 'account-delete-proof', 'Delete Proof', 'play-delete-proof.kingdomsx.com', 25565,
                'delete-proof-code', 'consumed', ?, ?, ?, ?, ?)
      `).bind(timestamp, timestamp, timestamp, timestamp, timestamp),
      testEnv.DB.prepare(`
        INSERT INTO submissions (
          id, server_id, owner_account_id, contact, proof_type, proof_redacted,
          submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id, created_at
        )
        VALUES ('delete-proof-submission', 'server-delete-proof', 'account-delete-proof', 'Tester',
                'plugin_callback_verified', 'proof', 'ip', 'ua', '{}', 'delete-proof-challenge', ?)
      `).bind(timestamp)
    ]);

    const response = await api("/api/servers/me", {
      method: "DELETE",
      headers: { cookie }
    });
    expect(response.status).toBe(200);
    expect(await testEnv.DB.prepare("SELECT id FROM server_verification_challenges WHERE id = 'delete-proof-challenge'").first()).not.toBeNull();
    expect(await testEnv.DB.prepare("SELECT id FROM submissions WHERE id = 'delete-proof-submission'").first()).toBeNull();
  });

  it("runs bounded hourly cleanup and scans orphaned consumed proofs only daily", async () => {
    await seedSubmitter();
    const old = "2000-01-01T00:00:00.000Z";
    const verifiedWithinTtl = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
    const verifiedPastTtl = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at)
        VALUES ('expired-session', 'account-one', 'expired-session-hash', ?, ?, ?)
      `).bind(old, old, old),
      testEnv.DB.prepare(`
        INSERT INTO servers (id, slug, name, description, normalized_host, port, social_links_json, status, owner_account_id, created_at, updated_at)
        VALUES ('server-one', 'server-one', 'Server One', 'A sufficiently long server description for testing.', 'mc.hypixel.net', 25565, '[]', 'pending', 'account-one', ?, ?)
      `).bind(old, old),
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (id, owner_account_id, server_name, normalized_host, port, code_hash, status, expires_at, verified_at, consumed_at, created_at, updated_at)
        VALUES ('linked-challenge', 'account-one', 'Server One', 'mc.hypixel.net', 25565, 'linked-code', 'consumed', ?, ?, ?, ?, ?)
      `).bind(old, old, old, old, old),
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (id, owner_account_id, server_name, normalized_host, port, code_hash, status, expires_at, consumed_at, created_at, updated_at)
        VALUES ('orphan-challenge', 'account-one', 'Server One', 'play.cubecraft.net', 25565, 'orphan-code', 'consumed', ?, ?, ?, ?)
      `).bind(old, old, old, old),
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (id, owner_account_id, server_name, normalized_host, port, code_hash, status, expires_at, created_at, updated_at)
        VALUES ('stale-pending-challenge', 'account-one', 'Server One', 'stale.kingdomsx.com', 25565, 'stale-code', 'pending', ?, ?, ?)
      `).bind(old, old, old),
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (id, owner_account_id, server_name, normalized_host, port, code_hash, status, expires_at, verified_at, created_at, updated_at)
        VALUES ('verified-within-ttl', 'account-one', 'Server One', 'verified-valid.kingdomsx.com', 25565, 'verified-valid-code', 'verified', ?, ?, ?, ?)
      `).bind(old, verifiedWithinTtl, verifiedWithinTtl, verifiedWithinTtl),
      testEnv.DB.prepare(`
        INSERT INTO server_verification_challenges (id, owner_account_id, server_name, normalized_host, port, code_hash, status, expires_at, verified_at, created_at, updated_at)
        VALUES ('verified-past-ttl', 'account-one', 'Server One', 'verified-expired.kingdomsx.com', 25565, 'verified-expired-code', 'verified', ?, ?, ?, ?)
      `).bind(old, verifiedPastTtl, verifiedPastTtl, verifiedPastTtl),
      testEnv.DB.prepare(`
        INSERT INTO submissions (id, server_id, owner_account_id, contact, proof_type, proof_redacted, submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id, created_at)
        VALUES ('submission-one', 'server-one', 'account-one', 'Tester', 'plugin_callback_verified', 'proof', 'ip', 'ua', '{}', 'linked-challenge', ?)
      `).bind(old)
    ]);

    const offHourTasks: Promise<unknown>[] = [];
    scheduleServerDirectoryRefresh(testEnv, { waitUntil: (promise) => offHourTasks.push(promise) } as ExecutionContext, Date.UTC(2026, 5, 30, 12, 5));
    expect(offHourTasks).toHaveLength(1);
    await Promise.all(offHourTasks);

    const hourlyTasks: Promise<unknown>[] = [];
    scheduleServerDirectoryRefresh(testEnv, { waitUntil: (promise) => hourlyTasks.push(promise) } as ExecutionContext, Date.UTC(2026, 5, 30, 13, 0));
    expect(hourlyTasks).toHaveLength(2);
    await Promise.all(hourlyTasks);

    const hourlyRows = await testEnv.DB.prepare("SELECT id FROM server_verification_challenges ORDER BY id").all<{ id: string }>();
    expect(hourlyRows.results.map((row) => row.id)).toEqual(["linked-challenge", "orphan-challenge", "verified-within-ttl"]);
    expect(await testEnv.DB.prepare("SELECT id FROM submitter_sessions WHERE id = 'expired-session'").first()).toBeNull();

    const dailyTasks: Promise<unknown>[] = [];
    scheduleServerDirectoryRefresh(testEnv, { waitUntil: (promise) => dailyTasks.push(promise) } as ExecutionContext, Date.UTC(2026, 6, 1, 0, 0));
    expect(dailyTasks).toHaveLength(2);
    await Promise.all(dailyTasks);

    const dailyRows = await testEnv.DB.prepare("SELECT id FROM server_verification_challenges ORDER BY id").all<{ id: string }>();
    expect(dailyRows.results.map((row) => row.id)).toEqual(["linked-challenge", "verified-within-ttl"]);
  });
});
