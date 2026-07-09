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
  return env.DB.prepare(
    `
    INSERT INTO submissions (
      id, server_id, owner_account_id, contact, verification_method, verification_evidence,
      submitter_ip_hash, user_agent_hash, turnstile_result, verification_challenge_id,
      moderation_notes, created_at
    )
    VALUES (?, ?, ?, ?, 'plugin_callback', ?, ?, ?, ?, ?, ?, ?)
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
    ...verificationConsumptionStatements(env, suspension.input, suspension.timestamp),
    env.DB.prepare(
      `
      INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at)
      VALUES (?, ?, 'system', 'suspend', ?, ?)
    `
    ).bind(crypto.randomUUID(), suspension.serverId, suspension.eventNotes, suspension.timestamp),
    suspendedAddressStatement(
      env,
      suspension.input.normalized.host,
      suspension.input.normalized.port,
      suspension.serverId,
      suspension.notes,
      suspension.timestamp,
      suspension.timestamp
    ),
    discordEmbedJobStatement(env, suspension.serverId, "delete", suspension.timestamp)
  ];
}

export type ExistingAddressRow = {
  id: string;
  slug: string;
  status: ServerState;
  updated_at: string;
};

export function getExistingAddress(
  env: DirectoryEnv,
  host: string,
  port: number
): Promise<ExistingAddressRow | null> {
  return env.DB.prepare("SELECT id, slug, status, updated_at FROM servers WHERE normalized_host = ? AND port = ?")
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
        UPDATE servers SET name = ?, description = ?, website_url = ?, social_links_json = ?, status = 'pending',
          owner_account_id = ?, approved_at = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?
      `
    ).bind(
      input.submission.name,
      input.submission.description,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.id
    )
    : env.DB.prepare(
      `
        INSERT INTO servers (id, slug, name, description, normalized_host, port, website_url, social_links_json, status, owner_account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `
    ).bind(
      input.id,
      input.slug,
      input.submission.name,
      input.submission.description,
      input.submission.normalized.host,
      input.submission.normalized.port,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp
    );
}

export function submittedEventStatement(
  env: DirectoryEnv,
  serverId: string,
  resubmitted: boolean,
  timestamp: string
): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, 'system', 'submitted', ?, ?)`).bind(
    crypto.randomUUID(),
    serverId,
    resubmitted
      ? "Resubmitted through public website form."
      : "Submitted through public website form.",
    timestamp
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
        UPDATE servers SET name = ?, description = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?, updated_at = ?
        WHERE id = ? AND owner_account_id = ? AND status = 'approved'
      `
    ).bind(
      input.name,
      input.description,
      input.normalized.host,
      input.normalized.port,
      input.websiteUrl,
      JSON.stringify(input.socialLinks),
      timestamp,
      owned.id,
      accountId
    )
    : env.DB.prepare(
      `
        UPDATE servers SET name = ?, description = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
          status = 'pending', approved_at = NULL, suspended_at = NULL, updated_at = ? WHERE id = ? AND owner_account_id = ?
      `
    ).bind(
      input.name,
      input.description,
      input.normalized.host,
      input.normalized.port,
      input.websiteUrl,
      JSON.stringify(input.socialLinks),
      timestamp,
      owned.id,
      accountId
    );
}

export function resubmissionEventStatement(
  env: DirectoryEnv,
  serverId: string,
  keepsApproval: boolean,
  timestamp: string
) {
  return env.DB.prepare(`INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(),
    serverId,
    keepsApproval ? "owner" : "system",
    keepsApproval ? "verified-address-updated" : "submitted",
    keepsApproval
      ? "Owner updated the address of an approved listing after plugin verification."
      : "Resubmitted through public website form.",
    timestamp
  );
}

export function publicDetailsStatements(
  env: DirectoryEnv,
  input: {
    details: {
      name: string;
      description: string;
      websiteUrl: string | null;
      socialLinks: unknown[];
    };
    serverId: string;
    accountId: string;
    timestamp: string;
  }
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE servers SET name = ?, description = ?, website_url = ?, social_links_json = ?, updated_at = ?
      WHERE id = ? AND owner_account_id = ? AND status = 'approved'`
    ).bind(
      input.details.name,
      input.details.description,
      input.details.websiteUrl,
      JSON.stringify(input.details.socialLinks),
      input.timestamp,
      input.serverId,
      input.accountId
    ),
    env.DB.prepare("INSERT INTO moderation_events (id, server_id, actor, action, notes, created_at) VALUES (?, ?, 'owner', 'public-details-updated', 'Owner updated approved listing details.', ?)").bind(crypto.randomUUID(), input.serverId, input.timestamp),
    discordEmbedJobStatement(env, input.serverId, "upsert", input.timestamp)
  ];
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
          input.timestamp
        )
      ]
      : []),
    discordEmbedJobStatement(env, owned.id, "delete", input.timestamp),
    ...(input.reviewSnapshot
      ? [discordReviewDeletionJobStatement(env, input.reviewSnapshot, input.timestamp)]
      : []),
    env.DB.prepare("DELETE FROM submissions WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM server_status WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM moderation_events WHERE server_id = ?").bind(owned.id),
    env.DB.prepare("DELETE FROM servers WHERE id = ? AND owner_account_id = ?").bind(
      owned.id,
      input.accountId
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
      `UPDATE servers SET name = ?, description = ?, website_url = ?, social_links_json = ?, status = 'suspended',
        owner_account_id = ?, approved_at = NULL, suspended_at = ?, updated_at = ? WHERE id = ?`
    ).bind(
      input.submission.name,
      input.submission.description,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp,
      input.id
    )
    : env.DB.prepare(
      `INSERT INTO servers (id, slug, name, description, normalized_host, port, website_url, social_links_json, status, owner_account_id, suspended_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?, ?, ?, ?)`
    ).bind(
      input.id,
      input.slug,
      input.submission.name,
      input.submission.description,
      input.submission.normalized.host,
      input.submission.normalized.port,
      input.submission.websiteUrl,
      JSON.stringify(input.submission.socialLinks),
      input.accountId,
      input.timestamp,
      input.timestamp,
      input.timestamp
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
    `UPDATE servers SET name = ?, description = ?, normalized_host = ?, port = ?, website_url = ?, social_links_json = ?,
      status = 'suspended', approved_at = NULL, suspended_at = ?, updated_at = ? WHERE id = ? AND owner_account_id = ?`
  ).bind(
    input.name,
    input.description,
    input.normalized.host,
    input.normalized.port,
    input.websiteUrl,
    JSON.stringify(input.socialLinks),
    timestamp,
    timestamp,
    owned.id,
    accountId
  );
}
