import type {
  AdminServerRow,
  DirectoryEnv,
  DiscordReviewDeletionSnapshot,
  ServerState,
  SubmissionInput,
  SuspendedAddressRow
} from "../contracts";
import { submitterContact, type SubmitterAccount } from "../auth/submitter-sessions";
import {
  discordEmbedJobStatement,
  discordReviewDeletionJobStatement
} from "../discord/outbox";
import { adminSelectSql, suspendedAddressStatement } from "../moderation/moderation-storage";
import { verificationConsumptionStatements } from "../verification/proofs";
import { listingWriteCondition, type ListingWriteGuard } from "../core/listing-write-guard";
import type { parsePublicDetailsInput } from "./validation";

export async function getOwnedServerRow(
  env: DirectoryEnv,
  accountId: string
): Promise<AdminServerRow | null> {
  return env.DB.prepare(
    adminSelectSql("s.owner_account_id = ?", "s.updated_at DESC, s.id ASC", "LIMIT 1")
  )
    .bind(accountId)
    .first<AdminServerRow>();
}

export async function getSuspendedAddress(
  env: DirectoryEnv,
  host: string,
  port: number
): Promise<SuspendedAddressRow | null> {
  return env.DB.prepare(
    `
    SELECT normalized_host, port, reason, suspended_at
    FROM suspended_server_addresses
    WHERE normalized_host = ? AND port = ?
    LIMIT 1
  `
  )
    .bind(host, port)
    .first<SuspendedAddressRow>();
}

type SubmissionInsertInput = {
  id: string;
  serverId: string;
  ownerAccountId: string;
  contact: string;
  verificationEvidence: string;
  input: SubmissionInput;
  moderationNotes: string | null;
  createdAt: string;
};

export function submissionInsertStatement(
  env: DirectoryEnv,
  submission: SubmissionInsertInput
): D1PreparedStatement {
  // Keep this directly after the listing update because changes() reports the previous statement
  return env.DB.prepare(
    `
    INSERT INTO submissions (
      id, server_id, owner_account_id, contact, verification_method, verification_evidence,
      submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id,
      moderation_notes, created_at
    )
    SELECT ?, ?, ?, ?, 'plugin_callback', ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `
  ).bind(
    submission.id,
    submission.serverId,
    submission.ownerAccountId,
    submission.contact,
    submission.verificationEvidence,
    submission.input.ipHash,
    submission.input.userAgentHash,
    JSON.stringify(submission.input.turnstile),
    submission.input.verification?.id ?? null,
    submission.moderationNotes,
    submission.createdAt
  );
}

type AutoSuspensionInput = {
  serverMutation: D1PreparedStatement;
  serverId: string;
  submissionId: string;
  account: SubmitterAccount;
  input: SubmissionInput;
  verificationEvidence: string;
  notes: string;
  eventNotes: string;
  timestamp: string;
};

export function autoSuspensionStatements(
  env: DirectoryEnv,
  suspension: AutoSuspensionInput
): D1PreparedStatement[] {
  const guard = { submissionId: suspension.submissionId };
  const condition = listingWriteCondition(guard);

  return [
    suspension.serverMutation,
    submissionInsertStatement(env, {
      id: suspension.submissionId,
      serverId: suspension.serverId,
      ownerAccountId: suspension.account.id,
      contact: submitterContact(suspension.account),
      verificationEvidence: suspension.verificationEvidence,
      input: suspension.input,
      moderationNotes: suspension.notes,
      createdAt: suspension.timestamp
    }),
    ...verificationConsumptionStatements(env, suspension.input, suspension.timestamp, guard),
    env.DB.prepare(
      `
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      SELECT ?, ?, 'system', 'suspend', ?, ?
      WHERE ${condition.sql}
    `
    ).bind(crypto.randomUUID(), suspension.serverId, suspension.eventNotes, suspension.timestamp, ...condition.bindings),
    suspendedAddressStatement(
      env,
      suspension.input.normalized.host,
      suspension.input.normalized.port,
      suspension.serverId,
      suspension.notes,
      suspension.timestamp,
      suspension.timestamp,
      guard
    ),
    discordEmbedJobStatement(env, suspension.serverId, "delete", suspension.timestamp, undefined, guard)
  ];
}

export type ExistingAddressRow = {
  id: string;
  slug: string;
  status: ServerState;
  updated_at: string;
  owner_account_id: string | null;
};

export function getExistingAddress(
  env: DirectoryEnv,
  host: string,
  port: number
): Promise<ExistingAddressRow | null> {
  return env.DB.prepare("SELECT id, slug, status, updated_at, owner_account_id FROM servers WHERE normalized_host = ? AND port = ?")
    .bind(host, port)
    .first<ExistingAddressRow>();
}

export async function submissionQuotaCounts(
  env: DirectoryEnv,
  ownerAccountId: string,
  ipHash: string,
  after: string
) {
  const [accountResult, ipResult] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM server_verification_challenges WHERE owner_account_id = ? AND status = 'consumed' AND created_at > ?").bind(ownerAccountId, after),
    env.DB.prepare("SELECT COUNT(*) AS total FROM server_verification_challenges WHERE created_ip_hash = ? AND status = 'consumed' AND created_at > ?").bind(ipHash, after)
  ]);

  return {
    accountTotal: Number((accountResult.results[0] as { total?: unknown } | undefined)?.total ?? 0),
    ipTotal: Number((ipResult.results[0] as { total?: unknown } | undefined)?.total ?? 0)
  };
}

export function newSubmissionServerStatement(
  env: DirectoryEnv,
  input: {
    existing: ExistingAddressRow | null;
    id: string;
    slug: string;
    accountId: string;
    submission: SubmissionInput;
    timestamp: string;
  }
): D1PreparedStatement {
  return input.existing
    ? env.DB.prepare(
      `
        UPDATE servers SET name = ?, description = ?, regions_json = ?, languages_json = ?, website_url = ?, social_links_json = ?, status = 'pending',
          owner_account_id = ?, approved_at = NULL, suspended_at = NULL, updated_at = ?
        WHERE id = ? AND owner_account_id IS ? AND status = ? AND updated_at = ?
          AND NOT EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)
      `
    ).bind(
      input.submission.name,
      input.submission.description,
      JSON.stringify(input.submission.regions),
      JSON.stringify(input.submission.languages),
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.id,
      input.existing.owner_account_id,
      input.existing.status,
      input.existing.updated_at,
      input.submission.normalized.host,
      input.submission.normalized.port
    )
    : env.DB.prepare(
      `
        INSERT INTO servers (id, slug, name, description, regions_json, languages_json, normalized_host, port, website_url, social_links_json, status, owner_account_id, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)
      `
    ).bind(
      input.id,
      input.slug,
      input.submission.name,
      input.submission.description,
      JSON.stringify(input.submission.regions),
      JSON.stringify(input.submission.languages),
      input.submission.normalized.host,
      input.submission.normalized.port,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp,
      input.submission.normalized.host,
      input.submission.normalized.port
    );
}

export function submittedEventStatement(
  env: DirectoryEnv,
  serverId: string,
  resubmitted: boolean,
  timestamp: string,
  guard: ListingWriteGuard
): D1PreparedStatement {
  const condition = listingWriteCondition(guard);

  return env.DB.prepare(`INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) SELECT ?, ?, 'system', 'submitted', ?, ? WHERE ${condition.sql}`).bind(
    crypto.randomUUID(),
    serverId,
    resubmitted
      ? "Resubmitted through public website form."
      : "Submitted through public website form.",
    timestamp,
    ...condition.bindings
  );
}

export function getConflictingAddress(
  env: DirectoryEnv,
  host: string,
  port: number,
  excludedServerId: string
) {
  return env.DB.prepare("SELECT id, status FROM servers WHERE normalized_host = ? AND port = ? AND id <> ?")
    .bind(host, port, excludedServerId)
    .first<{ id: string; status: ServerState }>();
}

export function resubmissionServerStatement(
  env: DirectoryEnv,
  input: SubmissionInput,
  owned: AdminServerRow,
  accountId: string,
  keepsApproval: boolean,
  timestamp: string
) {
  return keepsApproval
    ? env.DB.prepare(
      `
        UPDATE servers SET name = ?, description = ?, regions_json = ?, languages_json = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?, updated_at = ?
        WHERE id = ? AND owner_account_id = ? AND status = 'approved' AND updated_at = ?
          AND NOT EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)
      `
    ).bind(
      input.name,
      input.description,
      JSON.stringify(input.regions),
      JSON.stringify(input.languages),
      input.normalized.host,
      input.normalized.port,
      input.websiteUrl,
      JSON.stringify(input.socialLinks),
      timestamp,
      owned.id,
      accountId,
      owned.updated_at,
      input.normalized.host,
      input.normalized.port
    )
    : env.DB.prepare(
      `
        UPDATE servers SET name = ?, description = ?, regions_json = ?, languages_json = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
          status = 'pending', approved_at = NULL, suspended_at = NULL, updated_at = ?
        WHERE id = ? AND owner_account_id = ? AND status = ? AND updated_at = ?
          AND NOT EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)
      `
    ).bind(
      input.name,
      input.description,
      JSON.stringify(input.regions),
      JSON.stringify(input.languages),
      input.normalized.host,
      input.normalized.port,
      input.websiteUrl,
      JSON.stringify(input.socialLinks),
      timestamp,
      owned.id,
      accountId,
      owned.status,
      owned.updated_at,
      input.normalized.host,
      input.normalized.port
    );
}

export function resubmissionEventStatement(
  env: DirectoryEnv,
  serverId: string,
  keepsApproval: boolean,
  timestamp: string,
  guard: ListingWriteGuard
) {
  const condition = listingWriteCondition(guard);

  return env.DB.prepare(`INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${condition.sql}`).bind(
    crypto.randomUUID(),
    serverId,
    keepsApproval ? "owner" : "system",
    keepsApproval ? "verified-address-updated" : "submitted",
    keepsApproval
      ? "Owner updated the address of an approved listing after plugin verification."
      : "Resubmitted through public website form.",
    timestamp,
    ...condition.bindings
  );
}

export function publicDetailsStatements(
  env: DirectoryEnv,
  input: {
    details: ReturnType<typeof parsePublicDetailsInput>;
    serverId: string;
    accountId: string;
    updatedAt: string;
    timestamp: string;
  }
): D1PreparedStatement[] {
  const eventId = crypto.randomUUID();

  return [
    publicDetailsUpdateStatement(env, input.serverId, input.details, input.timestamp, input),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) SELECT ?, ?, 'owner', 'public-details-updated', 'Owner updated approved listing details.', ? WHERE changes() = 1").bind(eventId, input.serverId, input.timestamp),
    discordEmbedJobStatement(env, input.serverId, "upsert", input.timestamp, undefined, { eventId })
  ];
}

export function publicDetailsUpdateStatement(
  env: DirectoryEnv,
  serverId: string,
  details: ReturnType<typeof parsePublicDetailsInput>,
  timestamp: string,
  target: { accountId: string; updatedAt: string } | { status: "pending" | "approved"; updatedAt: string }
): D1PreparedStatement {
  const owner = "accountId" in target;

  return env.DB.prepare(
    `UPDATE servers
    SET name = ?, description = ?, regions_json = ?, languages_json = ?, website_url = ?, social_links_json = ?, updated_at = ?
    WHERE id = ? AND ${owner ? "owner_account_id = ? AND status = 'approved' AND updated_at = ?" : "status = ? AND updated_at = ?"}`
  ).bind(
    details.name,
    details.description,
    JSON.stringify(details.regions),
    JSON.stringify(details.languages),
    details.websiteUrl,
    JSON.stringify(details.socialLinks),
    timestamp,
    serverId,
    ...(owner ? [target.accountId, target.updatedAt] : [target.status, target.updatedAt])
  );
}

export function ownerDeletionStatements(
  env: DirectoryEnv,
  input: {
    owned: AdminServerRow;
    accountId: string;
    timestamp: string;
    reviewSnapshot: DiscordReviewDeletionSnapshot | null;
  }
): D1PreparedStatement[] {
  const { owned } = input;
  const guard = {
    serverId: owned.id,
    ownerAccountId: input.accountId,
    status: owned.status,
    updatedAt: owned.updated_at
  };

  return [
    // Keep the address suspension after delete so another account cannot resubmit it
    ...(owned.status === "suspended"
      ? [
        suspendedAddressStatement(
          env,
          owned.normalized_host,
          owned.port,
          owned.id,
          owned.submission_moderation_notes,
          owned.suspended_at ?? input.timestamp,
          input.timestamp,
          guard
        )
      ]
      : []),
    discordEmbedJobStatement(env, owned.id, "delete", input.timestamp, undefined, guard),
    ...(input.reviewSnapshot
      ? [discordReviewDeletionJobStatement(env, input.reviewSnapshot, input.timestamp, guard)]
      : []),
    env.DB.prepare("DELETE FROM servers WHERE id = ? AND owner_account_id = ? AND status = ? AND updated_at = ?").bind(
      owned.id,
      input.accountId,
      owned.status,
      owned.updated_at
    )
  ];
}

export function autoSuspendServerStatement(
  env: DirectoryEnv,
  input: {
    existing: ExistingAddressRow | null;
    id: string;
    slug: string;
    accountId: string;
    submission: SubmissionInput;
    timestamp: string;
  }
): D1PreparedStatement {
  return input.existing
    ? env.DB.prepare(
      `UPDATE servers SET name = ?, description = ?, regions_json = ?, languages_json = ?, website_url = ?, social_links_json = ?, status = 'suspended',
        owner_account_id = ?, approved_at = NULL, suspended_at = ?, updated_at = ?
      WHERE id = ? AND owner_account_id IS ? AND status = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)`
    ).bind(
      input.submission.name,
      input.submission.description,
      JSON.stringify(input.submission.regions),
      JSON.stringify(input.submission.languages),
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp,
      input.id,
      input.existing.owner_account_id,
      input.existing.status,
      input.existing.updated_at,
      input.submission.normalized.host,
      input.submission.normalized.port
    )
    : env.DB.prepare(
      `INSERT INTO servers (id, slug, name, description, regions_json, languages_json, normalized_host, port, website_url, social_links_json, status, owner_account_id, suspended_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)`
    ).bind(
      input.id,
      input.slug,
      input.submission.name,
      input.submission.description,
      JSON.stringify(input.submission.regions),
      JSON.stringify(input.submission.languages),
      input.submission.normalized.host,
      input.submission.normalized.port,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp,
      input.timestamp,
      input.submission.normalized.host,
      input.submission.normalized.port
    );
}

export function autoSuspendOwnedServerStatement(
  env: DirectoryEnv,
  input: SubmissionInput,
  owned: AdminServerRow,
  accountId: string,
  timestamp: string
) {
  return env.DB.prepare(
    `UPDATE servers SET name = ?, description = ?, regions_json = ?, languages_json = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
      status = 'suspended', approved_at = NULL, suspended_at = ?, updated_at = ?
    WHERE id = ? AND owner_account_id = ? AND status = ? AND updated_at = ?
      AND EXISTS (SELECT 1 FROM suspended_server_addresses WHERE normalized_host = ? AND port = ?)`
  ).bind(
    input.name,
    input.description,
    JSON.stringify(input.regions),
    JSON.stringify(input.languages),
    input.normalized.host,
    input.normalized.port,
    input.websiteUrl,
    JSON.stringify(input.socialLinks),
    timestamp,
    timestamp,
    owned.id,
    accountId,
    owned.status,
    owned.updated_at,
    input.normalized.host,
    input.normalized.port
  );
}
