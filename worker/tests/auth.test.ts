import { beforeEach, describe, expect, it } from "vitest";
import { handleServerDirectoryRequest } from "../server-directory";
import type { DirectoryEnv } from "../server-directory/contracts";
import { api, origin, resetDatabase, stubFetch, testEnv } from "../test-support/directory";

beforeEach(resetDatabase);

function oauthEnv(): DirectoryEnv {
  return {
    DB: testEnv.DB,
    APP_ENVIRONMENT: "local",
    SESSION_SECRET: "oauth-test-session-secret",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_GUILD_ID: "222222222222222222",
    DISCORD_REDIRECT_URI: `${origin}/api/auth/discord/callback`
  };
}

function oauthCallback(search: string, cookie: string, env = oauthEnv()): Promise<Response> {
  return handleServerDirectoryRequest(
    new Request(`${origin}/api/auth/discord/callback?${search}`, {
      headers: { cookie }
    }),
    env
  );
}

describe("Submitter authentication", () => {
  it("rejects cross-origin mutations before authentication routing", async () => {
    const response = await api("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://attacker.example" }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cross-origin API mutations are not allowed."
    });
  });

  it("clears OAuth cookies for denied and mismatched callbacks", async () => {
    const denied = await oauthCallback(
      "error=access_denied",
      "kingdomsx_oauth_return=%2Fsubmit"
    );

    expect(denied.status).toBe(302);
    expect(denied.headers.get("location")).toBe("/servers/submit?auth=denied");
    expect(denied.headers.get("set-cookie")).toContain("kingdomsx_oauth_state=");
    expect(denied.headers.get("set-cookie")).toContain("Max-Age=0");

    const invalid = await oauthCallback(
      "code=code&state=wrong",
      "kingdomsx_oauth_state=expected; kingdomsx_oauth_verifier=verifier; kingdomsx_oauth_return=%2Fsubmit"
    );

    expect(invalid.status).toBe(302);
    expect(invalid.headers.get("location")).toBe("/servers/submit?auth=invalid");
  });

  it("creates a session after membership verification and rejects non-members", async () => {
    stubFetch((request) => {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/oauth2/token"))
        return Response.json({ access_token: "token" });

      if (url.pathname.endsWith("/users/@me"))
        return Response.json({
          id: "333333333333333333",
          username: "Tester",
          global_name: "Test User",
          avatar: null
        });

      if (url.pathname.includes("/member"))
        return Response.json({ roles: [] });

      throw new Error(`Unexpected OAuth request: ${request.url}`);
    });
    const success = await oauthCallback(
      "code=code&state=expected",
      "kingdomsx_oauth_state=expected; kingdomsx_oauth_verifier=verifier; kingdomsx_oauth_return=%2Fsubmit"
    );

    expect(success.status).toBe(302);
    expect(success.headers.get("location")).toBe(`${origin}/servers/submit?auth=ok`);
    expect(success.headers.get("set-cookie")).toContain("kingdomsx_submit_session=");
    expect(
      await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM submitter_sessions").first<{
        total: number;
      }>()
    ).toMatchObject({ total: 1 });

    await resetDatabase();
    stubFetch((request) => {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/oauth2/token"))
        return Response.json({ access_token: "token" });

      if (url.pathname.endsWith("/users/@me"))
        return Response.json({ id: "333333333333333333", username: "Tester" });

      return new Response(null, { status: 403 });
    });
    const rejected = await oauthCallback(
      "code=code&state=expected",
      "kingdomsx_oauth_state=expected; kingdomsx_oauth_verifier=verifier; kingdomsx_oauth_return=%2Fsubmit"
    );

    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toBe("/servers/submit?auth=not-member");
  });

  it("keeps local-token and production Access authorization paths separate", async () => {
    const local = await api("/api/admin/servers");

    expect(local.status).toBe(403);
    await expect(local.json()).resolves.toEqual({ error: "Local admin token is required." });

    const productionEnv: DirectoryEnv = {
      DB: testEnv.DB,
      APP_ENVIRONMENT: "production",
      CF_ACCESS_TEAM_DOMAIN: "kingdomsx.cloudflareaccess.com",
      CF_ACCESS_AUD: "audience",
      ADMIN_EMAILS: "admin@kingdomsx.com"
    };
    const production = await handleServerDirectoryRequest(
      new Request(`${origin}/api/admin/servers`, {
        headers: { "x-admin-token": "local-admin-token" }
      }),
      productionEnv
    );

    expect(production.status).toBe(403);
    await expect(production.json()).resolves.toEqual({
      error: "Admin endpoints require Cloudflare Access."
    });
  });
});
