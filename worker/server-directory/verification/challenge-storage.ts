import type {
  DirectoryEnv,
  PendingVerificationChallengeRow,
  ServerState,
  VerificationChallengeRow
} from "../contracts";
import { runD1Statement } from "../core/d1";

const CHALLENGE_COLUMNS = `
  id, owner_account_id, server_name, normalized_host, port, status, expires_at, verified_at, consumed_at,
  plugin_version, server_software, minecraft_version, callback_ip, created_at, updated_at`;
const PENDING_CHALLENGE_COLUMNS = CHALLENGE_COLUMNS.replace(
  "port, status",
  "port, code_hash, status"
);

export function getOwnedVerificationContext(env: DirectoryEnv, ownerAccountId: string) {
  return env.DB.prepare(
    `
    SELECT s.status, s.updated_at, rejection.created_at AS rejected_at, rejection.reason_code AS rejection_reason_code
    FROM servers s
    LEFT JOIN moderation_events rejection ON rejection.id = (
      SELECT me.id FROM moderation_events me
      WHERE me.server_id = s.id AND me.action IN ('reject', 'rejected')
      ORDER BY me.created_at DESC LIMIT 1
    )
    WHERE s.owner_account_id = ?
    LIMIT 1
  `
  )
    .bind(ownerAccountId)
    .first<{
      status: ServerState;
      updated_at: string;
      rejected_at: string | null;
      rejection_reason_code: string | null;
    }>();
}

export function getPendingChallenge(
  env: DirectoryEnv,
  ownerAccountId: string
): Promise<PendingVerificationChallengeRow | null> {
  return env.DB.prepare(
    `SELECT ${PENDING_CHALLENGE_COLUMNS} FROM server_verification_challenges
    WHERE owner_account_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`
  )
    .bind(ownerAccountId)
    .first<PendingVerificationChallengeRow>();
}

export function getReusableVerifiedChallenge(
  env: DirectoryEnv,
  ownerAccountId: string,
  host: string,
  port: number,
  verifiedAfter: string
): Promise<VerificationChallengeRow | null> {
  return env.DB.prepare(
    `SELECT ${CHALLENGE_COLUMNS} FROM server_verification_challenges
    WHERE owner_account_id = ? AND normalized_host = ? AND port = ? AND status = 'verified'
      AND consumed_at IS NULL AND verified_at > ?
    ORDER BY created_at DESC LIMIT 1`
  )
    .bind(ownerAccountId, host, port, verifiedAfter)
    .first<VerificationChallengeRow>();
}

export async function countRecentChallengesByAccount(
  env: DirectoryEnv,
  accountId: string,
  after: string
): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM server_verification_challenges WHERE owner_account_id = ? AND created_at > ?")
    .bind(accountId, after)
    .first<{ total: number }>();

  return row?.total ?? 0;
}

export async function countRecentChallengesByIp(
  env: DirectoryEnv,
  ipHash: string,
  after: string
): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM server_verification_challenges WHERE created_ip_hash = ? AND created_at > ?")
    .bind(ipHash, after)
    .first<{ total: number }>();

  return row?.total ?? 0;
}

export function getChallengeForOwner(
  env: DirectoryEnv,
  id: string,
  ownerAccountId: string
): Promise<VerificationChallengeRow | null> {
  return env.DB.prepare(`SELECT ${CHALLENGE_COLUMNS} FROM server_verification_challenges WHERE id = ? AND owner_account_id = ? LIMIT 1`)
    .bind(id, ownerAccountId)
    .first<VerificationChallengeRow>();
}

export function getChallengeByCodeHash(
  env: DirectoryEnv,
  codeHash: string
): Promise<VerificationChallengeRow | null> {
  return env.DB.prepare(`SELECT ${CHALLENGE_COLUMNS} FROM server_verification_challenges WHERE code_hash = ? LIMIT 1`)
    .bind(codeHash)
    .first<VerificationChallengeRow>();
}

export async function markChallengeVerified(
  env: DirectoryEnv,
  input: {
    id: string;
    timestamp: string;
    pluginVersion: string;
    serverSoftware: string;
    minecraftVersion: string;
    ip: string;
    ipHash: string;
    userAgentHash: string;
  }
): Promise<boolean> {
  const result = await runD1Statement(
    env.DB.prepare(
      `
    UPDATE server_verification_challenges
    SET status = 'verified', verified_at = ?, plugin_version = ?, server_software = ?, minecraft_version = ?,
        callback_ip = ?, callback_ip_hash = ?, callback_user_agent_hash = ?, updated_at = ?
    WHERE id = ? AND status = 'pending' AND expires_at > ?
  `
    ).bind(
      input.timestamp,
      input.pluginVersion || null,
      input.serverSoftware || null,
      input.minecraftVersion || null,
      input.ip,
      input.ipHash,
      input.userAgentHash,
      input.timestamp,
      input.id,
      input.timestamp
    )
  );

  return result.meta.changes === 1;
}

export function insertPendingChallenge(
  env: DirectoryEnv,
  input: {
    id: string;
    ownerAccountId: string;
    serverName: string;
    host: string;
    port: number;
    codeHash: string;
    expiresAt: string;
    ipHash: string;
    userAgentHash: string;
    createdAt: string;
  }
): Promise<D1Result<unknown>> {
  return runD1Statement(
    env.DB.prepare(
      `
    INSERT INTO server_verification_challenges (
      id, owner_account_id, server_name, normalized_host, port, code_hash, status,
      expires_at, created_ip_hash, created_user_agent_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `
    ).bind(
      input.id,
      input.ownerAccountId,
      input.serverName,
      input.host,
      input.port,
      input.codeHash,
      input.expiresAt,
      input.ipHash,
      input.userAgentHash,
      input.createdAt,
      input.createdAt
    )
  );
}

export function expirePendingChallenge(
  env: DirectoryEnv,
  id: string,
  timestamp: string
): Promise<D1Result<unknown>> {
  return runD1Statement(
    env.DB.prepare(
      `
    UPDATE server_verification_challenges SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'
  `
    ).bind(timestamp, id)
  );
}

export function consumeVerificationChallengeStatement(
  env: DirectoryEnv,
  id: string,
  timestamp: string
): D1PreparedStatement {
  return env.DB.prepare(
    `
    UPDATE server_verification_challenges
    SET status = 'consumed', consumed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'verified' AND consumed_at IS NULL
  `
  ).bind(timestamp, timestamp, id);
}

export function staleChallengeCleanupStatement(
  env: DirectoryEnv,
  staleCutoff: string,
  verifiedProofCutoff: string,
  limit: number
): D1PreparedStatement {
  return env.DB.prepare(
    `
    DELETE FROM server_verification_challenges
    WHERE id IN (
      SELECT challenge.id FROM server_verification_challenges challenge
      WHERE (challenge.status = 'pending' AND challenge.expires_at <= ?)
         OR (challenge.status = 'expired' AND challenge.updated_at <= ?)
         OR (challenge.status = 'verified' AND challenge.consumed_at IS NULL
             AND challenge.verified_at IS NOT NULL AND challenge.verified_at <= ?)
      ORDER BY challenge.updated_at ASC LIMIT ?
    )
  `
  ).bind(staleCutoff, staleCutoff, verifiedProofCutoff, limit);
}

export function orphanedProofCleanupStatement(
  env: DirectoryEnv,
  consumedCutoff: string,
  limit: number
): D1PreparedStatement {
  return env.DB.prepare(
    `
    DELETE FROM server_verification_challenges
    WHERE id IN (
      SELECT challenge.id FROM server_verification_challenges challenge
      WHERE challenge.status = 'consumed' AND challenge.consumed_at IS NOT NULL AND challenge.consumed_at <= ?
        AND NOT EXISTS (SELECT 1 FROM submissions submission WHERE submission.verification_challenge_id = challenge.id)
      ORDER BY challenge.consumed_at ASC LIMIT ?
    )
  `
  ).bind(consumedCutoff, limit);
}
