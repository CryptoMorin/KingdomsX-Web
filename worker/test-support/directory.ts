import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import webWorker from "../index";
import worker from "../server-directory/worker";
import {
  buildDiscordServerMessage,
  handleServerDirectoryRequest,
  processDiscordEmbedJobs,
  processDiscordReviewDeletionJobs,
  processDiscordReviewNotificationJobs,
  scheduleServerDirectoryRefresh
} from "../server-directory";
import type { DirectoryEnv } from "../server-directory/contracts";

const testEnv = env as DirectoryEnv;
const origin = "https://servers.kingdomsx.com";
let challengeIpCounter = 1;

const TEST_SERVER_DESCRIPTION = "This test description is long enough for server verification.";

interface ApiOptions {
  cookie?: string;
  clientIp?: string;
  headers?: HeadersInit;
}

interface CapturedRequest {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

interface PublicDetailsInput {
  name?: string;
  description: string;
  websiteUrl?: string;
  socialLinks?: Record<string, string>;
}

async function resetDatabase(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM discord_review_deletion_jobs"),
    testEnv.DB.prepare("DELETE FROM discord_review_notification_jobs"),
    testEnv.DB.prepare("DELETE FROM discord_review_notifications"),
    testEnv.DB.prepare("DELETE FROM discord_embed_jobs"),
    testEnv.DB.prepare("DELETE FROM discord_embeds"),
    testEnv.DB.prepare("DELETE FROM submissions"),
    testEnv.DB.prepare("DELETE FROM server_verification_challenges"),
    testEnv.DB.prepare("DELETE FROM server_status"),
    testEnv.DB.prepare("DELETE FROM moderation_events"),
    testEnv.DB.prepare("DELETE FROM servers"),
    testEnv.DB.prepare("DELETE FROM submitter_sessions"),
    testEnv.DB.prepare("DELETE FROM submitter_accounts")
  ]);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Auth/session seed helpers

async function seedSubmitter(suffix = "one"): Promise<string> {
  const token = await sha256(`test-session-${suffix}`);
  const sessionHash = await sha256(`verification-test-session-secret:${token}`);
  const timestamp = new Date().toISOString();

  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `
      INSERT INTO submitter_accounts (
        id, discord_user_id, username, global_name, guild_member_checked_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).bind(
      `account-${suffix}`,
      `discord-${suffix}`,
      `Tester${suffix}`,
      `Tester ${suffix}`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `
      INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).bind(
      `session-${suffix}`,
      `account-${suffix}`,
      sessionHash,
      new Date(Date.now() + 86_400_000).toISOString(),
      timestamp,
      timestamp
    )
  ]);

  return `kingdomsx_submit_session=${token}`;
}

// Request helpers

async function api(
  pathname: string,
  init: RequestInit = {},
  ctx?: ExecutionContext
): Promise<Response> {
  return handleServerDirectoryRequest(new Request(`${origin}${pathname}`, init), testEnv, ctx);
}

async function jsonApi(
  pathname: string,
  method: "POST" | "PATCH",
  body: unknown,
  options: ApiOptions = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");

  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }

  if (options.clientIp) {
    headers.set("cf-connecting-ip", options.clientIp);
  }

  return api(pathname, { method, headers, body: JSON.stringify(body) });
}

async function adminApi(pathname: string, body: unknown = {}): Promise<Response> {
  return jsonApi(pathname, "POST", body, {
    headers: { "x-admin-token": "local-admin-token" }
  });
}

async function updatePublicDetails(cookie: string, details: PublicDetailsInput): Promise<Response> {
  return jsonApi(
    "/api/servers/me/details",
    "PATCH",
    {
      websiteUrl: "",
      socialLinks: {},
      ...details
    },
    { cookie }
  );
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

async function requestChallenge(
  cookie: string,
  address: string,
  clientIp: string
): Promise<Response> {
  return api("/api/servers/verification-challenges", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": clientIp, cookie },
    body: JSON.stringify({
      name: "Verification Test",
      address,
      port: 25565,
      description: TEST_SERVER_DESCRIPTION
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

async function verifyPlugin(code: string, clientIp?: string): Promise<Response> {
  return jsonApi("/api/v1/plugin/verify", "POST", pluginPayload(code), { clientIp });
}

// Discord test env helpers

function localDiscordEnv(): DirectoryEnv {
  return {
    DB: testEnv.DB,
    APP_ENVIRONMENT: "local",
    DISCORD_SERVER_DIRECTORY_WEBHOOK_URL: "https://discord.com/api/webhooks/123456789/test-token"
  };
}

function localReviewDiscordEnv(): DirectoryEnv {
  return {
    DB: testEnv.DB,
    APP_ENVIRONMENT: "local",
    DISCORD_SERVER_REVIEW_WEBHOOK_URL: "https://discord.com/api/webhooks/987654321/review-token"
  };
}

function stubFetch(handler: (request: Request) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(new Request(input, init));
  });
}

function stubSubmissionServices(includeStatusProvider = true): void {
  stubFetch(async (request) => {
    const hostname = new URL(request.url).hostname;

    if (hostname === "challenges.cloudflare.com") {
      return Response.json({ success: true, action: "server-submit" });
    }

    if (includeStatusProvider && hostname === "api.mcsrvstat.us") {
      return Response.json({
        online: true,
        players: { online: 1, max: 20 },
        version: "26.2"
      });
    }

    throw new Error(`Unexpected external request: ${request.method} ${request.url}`);
  });
}

function captureDiscordRequests(messageIds: string[]): CapturedRequest[] {
  const requests: CapturedRequest[] = [];

  stubFetch(async (request) => {
    const method = request.method;
    const body = request.body ? await request.clone().json<Record<string, unknown>>() : {};

    requests.push({ url: request.url, method, body });

    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    return Response.json({
      id: method === "POST" ? messageIds.shift() : (messageIds[0] ?? "555555555555555555"),
      guild_id: "333333333333333333",
      channel_id: "444444444444444444"
    });
  });

  return requests;
}

function assetBinding(requestedAssets: string[]): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input);
      const pathname = new URL(request.url).pathname;

      requestedAssets.push(pathname);

      const available = pathname === "/403"
        || pathname === "/404"
        || pathname === "/apple-touch-icon.png"
        || pathname === "/build/example.js"
        || pathname === "/servers.html"
        || pathname === "/servers/submit.html"
        || pathname === "/servers/admin.html";

      if (!available) {
        return new Response("Missing test asset", { status: 404 });
      }

      return new Response(
        `<!doctype html><html><head>
          <title>Test</title>
          <meta name="description" content="Test description">
          <link rel="canonical" href="https://kingdomsx.com/servers">
          <link rel="alternate" hreflang="en" href="https://kingdomsx.com/servers">
          <meta property="og:url" content="https://kingdomsx.com/servers">
          <meta property="og:title" content="Test">
          <meta property="og:description" content="Test description">
          <meta name="twitter:title" content="Test">
          <meta name="twitter:description" content="Test description">
          <script type="application/ld+json" data-structured-data="webpage">{"@context":"https://schema.org","@type":"WebPage","url":"https://kingdomsx.com/servers","name":"Test"}</script>
        </head><body>Asset</body></html>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }
  } as Fetcher;
}

async function workerRoute(
  url: string,
  requestedAssets: string[],
  appEnvironment: "local" | "production" = "production"
): Promise<Response> {
  const routeEnv = {
    APP_ENVIRONMENT: appEnvironment,
    DB: testEnv.DB,
    ASSETS: assetBinding(requestedAssets)
  } as Parameters<typeof worker.fetch>[1];
  const ctx = createExecutionContext();

  return worker.fetch(new Request(url), routeEnv, ctx);
}

function webWorkerRoute(url: string, requestedAssets: string[]): Promise<Response> {
  const routeEnv = {
    ASSETS: assetBinding(requestedAssets)
  } as Parameters<typeof webWorker.fetch>[1];

  return webWorker.fetch(new Request(url), routeEnv);
}

// Server/submission seed helpers

async function seedOwnedServer(
  accountSuffix = "one",
  status: "approved" | "pending" | "rejected" = "approved"
): Promise<void> {
  const timestamp = "2026-01-01T00:00:00.000Z";

  await testEnv.DB.prepare(
    `
    INSERT INTO servers (
      id, slug, name, description, normalized_host, port, website_url, social_links_json,
      status, owner_account_id, approved_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 25565, NULL, '[]', ?, ?, ?, ?, ?)
  `
  )
    .bind(
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
    )
    .run();
}

async function seedDiscordEmbed(
  serverId: string,
  messageId: string,
  syncedAt: string
): Promise<void> {
  await testEnv.DB.prepare(
    `
    INSERT INTO discord_embeds (
      server_id, message_id, guild_id, channel_id, synced_version, synced_at, updated_at
    )
    VALUES (?, ?, '333333333333333333', '444444444444444444', ?, ?, ?)
  `
  )
    .bind(serverId, messageId, syncedAt, syncedAt, syncedAt)
    .run();
}

export {
  createExecutionContext,
  waitOnExecutionContext,
  buildDiscordServerMessage,
  processDiscordEmbedJobs,
  processDiscordReviewDeletionJobs,
  processDiscordReviewNotificationJobs,
  scheduleServerDirectoryRefresh,
  testEnv,
  origin,
  resetDatabase,
  sha256,
  seedSubmitter,
  api,
  jsonApi,
  adminApi,
  updatePublicDetails,
  createChallenge,
  requestChallenge,
  pluginPayload,
  verifyPlugin,
  localDiscordEnv,
  localReviewDiscordEnv,
  stubFetch,
  stubSubmissionServices,
  captureDiscordRequests,
  workerRoute,
  webWorkerRoute,
  seedOwnedServer,
  seedDiscordEmbed
};
