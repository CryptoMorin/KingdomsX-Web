import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDiscordServerMessage,
  processDiscordEmbedJobs,
  processDiscordReviewDeletionJobs,
  processDiscordReviewNotificationJobs,
  testEnv,
  resetDatabase,
  seedSubmitter,
  api,
  adminApi,
  updatePublicDetails,
  localDiscordEnv,
  localReviewDiscordEnv,
  stubFetch,
  captureDiscordRequests,
  seedOwnedServer,
  seedDiscordEmbed
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Discord embed payload", () => {
  it("contains listing fields, disables mentions, and excludes runtime status", () => {
    const payload = buildDiscordServerMessage(
      {
        id: "server-discord",
        slug: "server-discord",
        name: "@everyone *Example*",
        description: "A public server description with @here and markdown.",
        normalized_host: "play.kingdomsx.com",
        port: 25566,
        website_url: "https://kingdomsx.com/",
        social_links_json: JSON.stringify([
          {
            key: "discord",
            label: "Discord",
            url: "https://discord.gg/cKsSwtt",
            host: "discord.gg"
          }
        ]),
        status: "approved",
        approved_at: "2026-01-01T00:00:00.000Z",
        suspended_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        online: 1,
        players_online: 123,
        players_max: 500,
        motd_text: "Runtime MOTD",
        version_name: "Runtime version",
        favicon_url_or_hash: null,
        checked_at: "2026-01-01T00:00:00.000Z",
        provider: "provider",
        failure_count: 0,
        offline_since: null,
        refresh_attempted_at: null,
        refresh_error: null,
        owner_discord_user_id: "123456789012345678"
      },
      { updated: false, timestamp: "2026-07-02T20:15:00.000Z" }
    );

    expect(payload.allowed_mentions).toEqual({ parse: [], users: ["123456789012345678"] });
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("play.kingdomsx.com:25566");
    expect(serialized).toContain("```\\nplay.kingdomsx.com:25566\\n```");
    expect(serialized).toContain("https://api.mcstatus.io/v2/icon/play.kingdomsx.com%3A25566?timeout=5");
    expect(serialized).toContain("<@123456789012345678>");
    expect(payload).toMatchObject({
      embeds: [
        {
          fields: expect.arrayContaining([
            {
              name: "Website",
              value: "<https://kingdomsx.com/>",
              inline: true
            },
            {
              name: "Owner",
              value: "<@123456789012345678>",
              inline: true
            },
            {
              name: "Socials",
              value: expect.stringContaining("[Discord](https://discord.gg/cKsSwtt)")
            }
          ]),
          author: {
            name: "KingdomsX Servers",
            url: "https://servers.kingdomsx.com/",
            icon_url: "https://i.imgur.com/yJI3kra.png"
          },
          footer: { text: "Listed" },
          timestamp: "2026-07-02T20:15:00.000Z"
        }
      ]
    });
    expect(serialized).not.toContain("players");
    expect(serialized).not.toContain("Runtime MOTD");
    expect(serialized).not.toContain("Runtime version");
  });

  it("omits unset website and social fields while retaining the sync timestamp", () => {
    const payload = buildDiscordServerMessage(
      {
        id: "server-no-website",
        slug: "server-no-website",
        name: "No Website",
        description: "A public description without a website.",
        normalized_host: "play.kingdomsx.com",
        port: 25565,
        website_url: null,
        social_links_json: "[]",
        status: "approved",
        approved_at: "2026-01-01T00:00:00.000Z",
        suspended_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        online: null,
        players_online: null,
        players_max: null,
        motd_text: null,
        version_name: null,
        favicon_url_or_hash: null,
        checked_at: null,
        provider: null,
        failure_count: null,
        offline_since: null,
        refresh_attempted_at: null,
        refresh_error: null,
        owner_discord_user_id: "123456789012345678"
      },
      { updated: true, timestamp: "2026-07-02T20:30:00.000Z" }
    );
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('"name":"Website"');
    expect(serialized).not.toContain('"name":"Socials"');
    expect(payload).toMatchObject({
      embeds: [
        {
          footer: { text: "Updated" },
          timestamp: "2026-07-02T20:30:00.000Z"
        }
      ]
    });
  });
});

describe("Discord delivery", () => {
  it("creates a review notification and updates it across moderation and deletion", async () => {
    await seedSubmitter("review-notification");
    await seedOwnedServer("review-notification", "pending");
    const timestamp = new Date().toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        UPDATE submitter_accounts
        SET discord_user_id = '123456789012345678'
        WHERE id = 'account-review-notification'
      `),
      testEnv.DB.prepare(
        `
        UPDATE servers
        SET website_url = 'https://kingdomsx.com/',
            social_links_json = '[{"key":"discord","label":"Discord","url":"https://discord.gg/example","host":"discord.gg"}]',
            updated_at = ?
        WHERE id = 'server-review-notification'
      `
      ).bind(timestamp),
      testEnv.DB.prepare(
        `
        INSERT INTO submissions (
          id, server_id, owner_account_id, contact, verification_method, verification_evidence,
          submitter_ip_hash, user_agent_hash, turnstile_result, created_at
        )
        VALUES (
          'submission-review-notification', 'server-review-notification', 'account-review-notification',
          'Tester', 'plugin_callback', 'Verified: 2026-07-04T14:15:16.000Z\nPlugin version: 1.2.3',
          'ip', 'ua', '{}', ?
        )
      `
      ).bind(timestamp),
      testEnv.DB.prepare(
        `
        INSERT INTO discord_review_notification_jobs (
          server_id, submission_id, notification_type, desired_status, desired_version,
          next_attempt_at, created_at, updated_at
        )
        VALUES (
          'server-review-notification', 'submission-review-notification', 'submitted', 'pending', ?, ?, ?, ?
        )
      `
      ).bind(timestamp, timestamp, timestamp, timestamp)
    ]);
    const createdMessageIds = ["123456789012345678", "555555555555555555", "666666666666666666"];
    const requests = captureDiscordRequests(createdMessageIds);

    await processDiscordReviewNotificationJobs(localReviewDiscordEnv());

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST" });
    expect(requests[0].url).toContain("/api/v10/webhooks/987654321/review-token?wait=true");
    expect(requests[0].url).toContain("with_components=true");
    expect(requests[0].body).toMatchObject({
      allowed_mentions: { parse: [], users: ["123456789012345678"] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Open admin dashboard",
              url: "https://servers.kingdomsx.com/admin"
            }
          ]
        }
      ],
      embeds: [
        {
          title: "Server review\\-notification",
          footer: { text: "Submitted for review" },
          fields: expect.arrayContaining([
            {
              name: "Owner",
              value: "<@123456789012345678>",
              inline: true
            },
            {
              name: "Website",
              value: "<https://kingdomsx.com/>",
              inline: true
            },
            {
              name: "Socials",
              value: "[Discord](https://discord.gg/example)"
            },
            {
              name: "Verification",
              value: "```\nVerified (UTC): 04/07/2026 14:15:16\nPlugin version: 1.2.3\n```"
            }
          ])
        }
      ]
    });
    const serialized = JSON.stringify(requests[0].body);

    expect(serialized).toContain("https://servers.kingdomsx.com/admin");
    expect(serialized).not.toContain('"name":"Review"');
    expect(
      await testEnv.DB.prepare("SELECT server_id FROM discord_review_notification_jobs").first()
    ).toBeNull();
    expect(
      await testEnv.DB.prepare(
        `
      SELECT message_id, synced_status
      FROM discord_review_notifications
      WHERE server_id = 'server-review-notification'
    `
      ).first()
    ).toEqual({ message_id: "123456789012345678", synced_status: "pending" });
    await testEnv.DB.prepare(
      `
      INSERT INTO discord_embeds (
        server_id, message_id, guild_id, channel_id, synced_version, synced_at, updated_at
      )
      VALUES (
        'server-review-notification', '222222222222222222', '333333333333333333',
        '444444444444444444', ?, ?, ?
      )
    `
    )
      .bind(timestamp, timestamp, timestamp)
      .run();
    await testEnv.DB.prepare(
      `
      UPDATE discord_review_notifications
      SET synced_at = ?
      WHERE server_id = 'server-review-notification'
    `
    )
      .bind(twoDaysAgo)
      .run();

    const approval = await adminApi("/api/admin/servers/server-review-notification/approve");

    expect(approval.status).toBe(200);
    await processDiscordReviewNotificationJobs(localReviewDiscordEnv());

    expect(requests[1]).toMatchObject({ method: "POST" });
    expect(requests[1].url).toContain("?wait=true");
    expect(requests[1].url).toContain("with_components=true");
    expect(requests[1].body).toMatchObject({
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Open admin dashboard",
              url: "https://servers.kingdomsx.com/admin"
            },
            {
              type: 2,
              style: 5,
              label: "View public embed",
              url: "https://discord.com/channels/333333333333333333/444444444444444444/222222222222222222"
            }
          ]
        }
      ],
      embeds: [
        {
          title: "Server review\\-notification",
          color: 0x57f287,
          footer: { text: "Approved" }
        }
      ]
    });
    expect(JSON.stringify(requests[1].body)).not.toContain('"name":"Public Embed"');
    expect(requests[2]).toMatchObject({ method: "DELETE" });
    expect(requests[2].url).toContain("/messages/123456789012345678");
    expect(
      await testEnv.DB.prepare(
        `
      SELECT message_id, synced_status
      FROM discord_review_notifications
      WHERE server_id = 'server-review-notification'
    `
      ).first()
    ).toEqual({ message_id: "555555555555555555", synced_status: "approved" });

    const rejection = await adminApi("/api/admin/servers/server-review-notification/reject", {
      reasonCode: "public_details_incomplete",
      notes: "Public details need correction."
    });

    expect(rejection.status).toBe(200);
    await processDiscordReviewNotificationJobs(localReviewDiscordEnv());
    expect(requests[3]).toMatchObject({ method: "PATCH" });
    expect(requests[3].url).toContain("/messages/555555555555555555");
    expect(requests[3].url).toContain("with_components=true");
    expect(requests[3].body).toMatchObject({
      embeds: [
        {
          color: 0xed4245,
          footer: { text: "Rejected" },
          fields: expect.arrayContaining([
            {
              name: "Rejection reason",
              value: "Public details need correction\\."
            }
          ])
        }
      ]
    });
    expect(JSON.stringify(requests[3].body)).not.toContain("View public embed");

    const suspension = await adminApi("/api/admin/servers/server-review-notification/suspend", {
      notes: "Listing suspended pending owner contact."
    });

    expect(suspension.status).toBe(200);
    await processDiscordReviewNotificationJobs(localReviewDiscordEnv());
    expect(requests[4].body).toMatchObject({
      embeds: [
        {
          color: 0xc53030,
          footer: { text: "Suspended" },
          fields: expect.arrayContaining([
            {
              name: "Suspension reason",
              value: "Listing suspended pending owner contact\\."
            }
          ])
        }
      ]
    });
    await testEnv.DB.prepare(
      `
      UPDATE discord_review_notifications
      SET synced_at = ?
      WHERE server_id = 'server-review-notification'
    `
    )
      .bind(twoDaysAgo)
      .run();

    const deletion = await api("/api/admin/servers/server-review-notification", {
      method: "DELETE",
      headers: { "x-admin-token": "local-admin-token" }
    });

    expect(deletion.status).toBe(200);
    expect(
      await testEnv.DB.prepare("SELECT id FROM servers WHERE id = 'server-review-notification'").first()
    ).toBeNull();
    await processDiscordReviewDeletionJobs(localReviewDiscordEnv());
    expect(requests[5]).toMatchObject({ method: "POST" });
    expect(requests[5].url).toContain("?wait=true");
    expect(requests[5].url).toContain("with_components=true");
    expect(requests[5].body).toMatchObject({
      embeds: [
        {
          color: 0xb22222,
          footer: { text: "Deleted" }
        }
      ]
    });
    expect(requests[6]).toMatchObject({ method: "DELETE" });
    expect(requests[6].url).toContain("/messages/555555555555555555");
    expect(JSON.stringify(requests[5].body)).not.toContain("View public embed");
    expect(
      await testEnv.DB.prepare("SELECT server_id FROM discord_review_deletion_jobs").first()
    ).toBeNull();
  });

  it("creates and edits one Discord message for recent listing changes", async () => {
    const cookie = await seedSubmitter("discord-lifecycle");

    await seedOwnedServer("discord-lifecycle");
    const requests = captureDiscordRequests(["123456789012345678"]);
    const discordEnv = localDiscordEnv();

    const firstEdit = await updatePublicDetails(cookie, {
      name: "Discord Lifecycle",
      description: "A public description for Discord lifecycle testing.",
      websiteUrl: "https://kingdomsx.com",
      socialLinks: { discord: "https://discord.gg/example" }
    });

    expect(firstEdit.status).toBe(200);
    await processDiscordEmbedJobs(discordEnv);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toContain("?wait=true");
    expect(requests[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(
      await testEnv.DB.prepare(
        `
      SELECT message_id, guild_id, channel_id
      FROM discord_embeds
      WHERE server_id = 'server-discord-lifecycle'
    `
      ).first()
    ).toEqual({
      message_id: "123456789012345678",
      guild_id: "333333333333333333",
      channel_id: "444444444444444444"
    });

    const secondEdit = await updatePublicDetails(cookie, {
      name: "Discord Lifecycle Renamed",
      description: "A second public description for Discord lifecycle testing.",
      websiteUrl: "https://kingdomsx.com"
    });

    expect(secondEdit.status).toBe(200);
    await processDiscordEmbedJobs(discordEnv);
    expect(requests[1]).toMatchObject({ method: "PATCH" });
    expect(requests[1].url).toContain("/messages/123456789012345678");
  });

  it("reposts stale Discord messages and removes them when the listing is suspended", async () => {
    const cookie = await seedSubmitter("discord-lifecycle");

    await seedOwnedServer("discord-lifecycle");
    await seedDiscordEmbed(
      "server-discord-lifecycle",
      "123456789012345678",
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    );
    const requests = captureDiscordRequests(["222222222222222222"]);
    const discordEnv = localDiscordEnv();

    const staleEdit = await updatePublicDetails(cookie, {
      name: "Discord Lifecycle Reposted",
      description: "An old public message should be reposted at the bottom of the channel.",
      websiteUrl: "https://kingdomsx.com"
    });

    expect(staleEdit.status).toBe(200);
    await processDiscordEmbedJobs(discordEnv);
    expect(requests[0]).toMatchObject({ method: "POST" });
    expect(requests[0].url).toContain("?wait=true");
    expect(requests[1]).toMatchObject({ method: "DELETE" });
    expect(requests[1].url).toContain("/messages/123456789012345678");
    expect(
      await testEnv.DB.prepare("SELECT message_id FROM discord_embeds WHERE server_id = 'server-discord-lifecycle'").first()
    ).toEqual({ message_id: "222222222222222222" });

    const recentEdit = await updatePublicDetails(cookie, {
      name: "Discord Lifecycle Recent Edit",
      description: "A recent public description should edit the replacement message in place.",
      websiteUrl: "https://kingdomsx.com"
    });

    expect(recentEdit.status).toBe(200);
    await processDiscordEmbedJobs(discordEnv);
    expect(requests[2]).toMatchObject({ method: "PATCH" });
    expect(requests[2].url).toContain("/messages/222222222222222222");

    const suspend = await adminApi("/api/admin/servers/server-discord-lifecycle/suspend", {
      notes: "Lifecycle test suspension."
    });

    expect(suspend.status).toBe(200);
    await processDiscordEmbedJobs(discordEnv);
    expect(requests[3]).toMatchObject({ method: "DELETE" });
    expect(requests[3].url).toContain("/messages/222222222222222222");
    expect(
      await testEnv.DB.prepare("SELECT server_id FROM discord_embeds WHERE server_id = 'server-discord-lifecycle'").first()
    ).toBeNull();
    expect(
      await testEnv.DB.prepare("SELECT server_id FROM discord_embed_jobs WHERE server_id = 'server-discord-lifecycle'").first()
    ).toBeNull();
  });

  it("preserves an active Discord embed lease when a newer edit coalesces into the same job", async () => {
    const cookie = await seedSubmitter("discord-lease");

    await seedOwnedServer("discord-lease");
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();

    await testEnv.DB.prepare(
      `
      INSERT INTO discord_embed_jobs (
        server_id, desired_action, desired_version, attempt_count, next_attempt_at,
        lease_token, lease_expires_at, created_at, updated_at
      )
      VALUES ('server-discord-lease', 'upsert', '2026-01-01T00:00:00.000Z', 0, ?, 'active-lease', ?, ?, ?)
    `
    )
      .bind(
        new Date().toISOString(),
        leaseExpiresAt,
        new Date().toISOString(),
        new Date().toISOString()
      )
      .run();

    const response = await updatePublicDetails(cookie, {
      name: "Discord Lease",
      description: "A public description for Discord lease coalescing."
    });

    expect(response.status).toBe(200);
    const job = await testEnv.DB.prepare(
      `
      SELECT desired_version, attempt_count, last_error_code, lease_token, lease_expires_at
      FROM discord_embed_jobs
      WHERE server_id = 'server-discord-lease'
    `
    ).first<{
      desired_version: string;
      attempt_count: number;
      last_error_code: string | null;
      lease_token: string | null;
      lease_expires_at: string | null;
    }>();

    expect(job?.desired_version).not.toBe("2026-01-01T00:00:00.000Z");
    expect(job).toMatchObject({
      attempt_count: 0,
      last_error_code: null,
      lease_token: "active-lease",
      lease_expires_at: leaseExpiresAt
    });
  });

  it("retains rate-limited and ambiguous creation failures for safe recovery", async () => {
    const cookie = await seedSubmitter("discord-failure");

    await seedOwnedServer("discord-failure");
    let editNumber = 0;
    const queueEdit = () =>
      updatePublicDetails(cookie, {
        name: "Discord Failure",
        description: `A sufficiently long Discord failure description for attempt ${(editNumber += 1)}.`
      });
    const discordEnv = localDiscordEnv();

    expect((await queueEdit()).status).toBe(200);
    stubFetch(async () =>
      Response.json(
        { message: "rate limited", retry_after: 1.5 },
        { status: 429, headers: { "retry-after": "1.5" } }
      )
    );
    await processDiscordEmbedJobs(discordEnv);
    expect(
      await testEnv.DB.prepare("SELECT attempt_count, last_error_code FROM discord_embed_jobs WHERE server_id = 'server-discord-failure'").first()
    ).toEqual({ attempt_count: 1, last_error_code: "rate_limited" });

    expect((await queueEdit()).status).toBe(200);
    stubFetch(async () => {
      throw new Error("network failed for a redacted endpoint");
    });
    await processDiscordEmbedJobs(discordEnv);
    const ambiguous = await testEnv.DB.prepare("SELECT last_error_code, next_attempt_at FROM discord_embed_jobs WHERE server_id = 'server-discord-failure'").first<{ last_error_code: string; next_attempt_at: string }>();

    expect(ambiguous?.last_error_code).toBe("ambiguous_create");
    expect(ambiguous?.next_attempt_at).toBe("9999-12-31T23:59:59.999Z");
  });
});

describe("Discord lease claims", () => {
  it("reclaims an expired lease without allowing competing workers to duplicate delivery", async () => {
    await seedSubmitter("expired-lease");
    await seedOwnedServer("expired-lease");
    const now = new Date().toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();

    await testEnv.DB.prepare(
      `
      INSERT INTO discord_embed_jobs (
        server_id, desired_action, desired_version, attempt_count, next_attempt_at,
        lease_token, lease_expires_at, created_at, updated_at
      ) VALUES ('server-expired-lease', 'upsert', '2026-01-01T00:00:00.000Z', 0, ?, 'expired-owner', ?, ?, ?)
    `
    )
      .bind(now, expired, now, now)
      .run();
    const requests = captureDiscordRequests(["777777777777777777"]);

    await Promise.all([
      processDiscordEmbedJobs(localDiscordEnv()),
      processDiscordEmbedJobs(localDiscordEnv())
    ]);

    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(
      await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM discord_embed_jobs WHERE server_id = 'server-expired-lease'").first<{ total: number }>()
    ).toEqual({ total: 0 });
  });
});
