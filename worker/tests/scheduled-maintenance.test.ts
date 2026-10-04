import { beforeEach, describe, expect, it } from "vitest";
import {
  createExecutionContext,
  waitOnExecutionContext,
  scheduleServerDirectoryRefresh,
  testEnv,
  resetDatabase,
  seedSubmitter
} from "../test-support/directory";

beforeEach(resetDatabase);

describe("Scheduled maintenance", () => {
  it("cleans up a limited batch hourly and checks orphaned used verification records only daily", async () => {
    await seedSubmitter();
    const old = "2000-01-01T00:00:00.000Z";
    const verifiedWithinTtl = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
    const verifiedPastTtl = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO submitter_sessions (id, account_id, session_hash, expires_at, created_at, last_seen_at)
        VALUES ('expired-session', 'account-one', 'expired-session-hash', ?, ?, ?)
      `
      ).bind(old, old, old),
      testEnv.DB.prepare(
        `
        INSERT INTO servers (
          id, slug, name, description, normalized_host, port, social_links_json,
          status, owner_account_id, created_at, updated_at
        )
        VALUES (
          'server-one', 'server-one', 'Server One', 'A sufficiently long server description for testing.',
          'mc.hypixel.net', 25565, '[]', 'pending', 'account-one', ?, ?
        )
      `
      ).bind(old, old),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash,
          status, expires_at, verified_at, consumed_at, created_at, updated_at
        )
        VALUES (
          'linked-challenge', 'account-one', 'Server One', 'mc.hypixel.net', 25565,
          'linked-code', 'consumed', ?, ?, ?, ?, ?
        )
      `
      ).bind(old, old, old, old, old),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash,
          status, expires_at, consumed_at, created_at, updated_at
        )
        VALUES (
          'orphan-challenge', 'account-one', 'Server One', 'play.cubecraft.net', 25565,
          'orphan-code', 'consumed', ?, ?, ?, ?
        )
      `
      ).bind(old, old, old, old),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash,
          status, expires_at, created_at, updated_at
        )
        VALUES (
          'stale-pending-challenge', 'account-one', 'Server One', 'stale.kingdomsx.com',
          25565, 'stale-code', 'pending', ?, ?, ?
        )
      `
      ).bind(old, old, old),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash,
          status, expires_at, verified_at, created_at, updated_at
        )
        VALUES (
          'verified-within-ttl', 'account-one', 'Server One', 'verified-valid.kingdomsx.com',
          25565, 'verified-valid-code', 'verified', ?, ?, ?, ?
        )
      `
      ).bind(old, verifiedWithinTtl, verifiedWithinTtl, verifiedWithinTtl),
      testEnv.DB.prepare(
        `
        INSERT INTO server_verification_challenges (
          id, owner_account_id, server_name, normalized_host, port, code_hash,
          status, expires_at, verified_at, created_at, updated_at
        )
        VALUES (
          'verified-past-ttl', 'account-one', 'Server One', 'verified-expired.kingdomsx.com',
          25565, 'verified-expired-code', 'verified', ?, ?, ?, ?
        )
      `
      ).bind(old, verifiedPastTtl, verifiedPastTtl, verifiedPastTtl),
      testEnv.DB.prepare(
        `
        INSERT INTO submissions (
          id, server_id, owner_account_id, contact, verification_method, verification_evidence,
          submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id, created_at
        )
        VALUES (
          'submission-one', 'server-one', 'account-one', 'Tester', 'plugin_callback',
          'proof', 'ip', 'ua', '{}', 'linked-challenge', ?
        )
      `
      ).bind(old)
    ]);

    const offHourContext = createExecutionContext();

    scheduleServerDirectoryRefresh(testEnv, offHourContext, Date.UTC(2026, 5, 30, 12, 5));
    await waitOnExecutionContext(offHourContext);

    const hourlyContext = createExecutionContext();

    scheduleServerDirectoryRefresh(testEnv, hourlyContext, Date.UTC(2026, 5, 30, 13, 0));
    await waitOnExecutionContext(hourlyContext);

    const hourlyRows = await testEnv.DB.prepare("SELECT id FROM server_verification_challenges ORDER BY id").all<{ id: string }>();

    expect(hourlyRows.results.map((row) => row.id)).toEqual([
      "linked-challenge",
      "orphan-challenge",
      "verified-within-ttl"
    ]);
    expect(
      await testEnv.DB.prepare("SELECT id FROM submitter_sessions WHERE id = 'expired-session'").first()
    ).toBeNull();

    const dailyContext = createExecutionContext();

    scheduleServerDirectoryRefresh(testEnv, dailyContext, Date.UTC(2026, 6, 1, 0, 0));
    await waitOnExecutionContext(dailyContext);

    const dailyRows = await testEnv.DB.prepare("SELECT id FROM server_verification_challenges ORDER BY id").all<{ id: string }>();

    expect(dailyRows.results.map((row) => row.id)).toEqual([
      "linked-challenge",
      "verified-within-ttl"
    ]);
  });
});
