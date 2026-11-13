import type { ServerState } from "../contracts";

export type ListingWriteGuard =
  | { submissionId: string }
  | { eventId: string }
  | { serverId: string; ownerAccountId: string; status: ServerState; updatedAt: string };

export function listingWriteCondition(guard?: ListingWriteGuard): { sql: string; bindings: string[] } {
  if (!guard) {
    return { sql: "1", bindings: [] };
  }

  if ("submissionId" in guard) {
    return { sql: "EXISTS (SELECT 1 FROM submissions WHERE id = ?)", bindings: [guard.submissionId] };
  }

  if ("eventId" in guard) {
    return { sql: "EXISTS (SELECT 1 FROM moderation_events WHERE id = ?)", bindings: [guard.eventId] };
  }

  return {
    sql: "EXISTS (SELECT 1 FROM servers WHERE id = ? AND owner_account_id = ? AND status = ? AND updated_at = ?)",
    bindings: [guard.serverId, guard.ownerAccountId, guard.status, guard.updatedAt]
  };
}
