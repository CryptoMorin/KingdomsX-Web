import { STATUS_REFRESH_CONCURRENCY, STATUS_STALE_AFTER_MS } from "../config";
import type { DirectoryEnv } from "../contracts";
import { runD1Batch } from "../core/d1";
import {
  daysAgoIso,
  errorMessage,
  logError,
  logWarn,
  mapWithConcurrency,
  nowIso
} from "../core/runtime";
import { fetchServerStatus as fetchStatusSnapshot, type StatusSnapshot } from "./providers";
import {
  localStatusRows,
  autoHideOfflineStatements,
  offlineSince,
  scheduledStatusRows,
  statusRefreshFailureStatements,
  statusSnapshotStatements,
  type StatusRefreshRow
} from "./status-storage";

interface StatusRefreshOptions {
  failureEvent: string;
  logFailure: (event: string, error?: unknown, context?: Record<string, unknown>) => void;
  afterSuccess?: (env: DirectoryEnv, serverId: string) => Promise<void>;
}

export async function fetchServerStatus(address: string): Promise<StatusSnapshot> {
  return fetchStatusSnapshot(address, (error) =>
    logWarn("status.provider_failed", error, { address })
  );
}

export async function refreshApprovedServers(env: DirectoryEnv): Promise<void> {
  await refreshStatusRows(env, await scheduledStatusRows(env), {
    failureEvent: "status.scheduled_refresh_failed",
    logFailure: logError,
    afterSuccess: maybeHideOffline
  });
}

export async function refreshLocalApprovedStatuses(env: DirectoryEnv): Promise<void> {
  if (env.APP_ENVIRONMENT !== "local")
    return;

  // Local page loads may refresh stale data but they must never trigger the scheduled auto-hide policy
  await refreshStatusRows(env, await localStatusRows(env), {
    failureEvent: "status.local_refresh_failed",
    logFailure: logWarn
  });
}

export async function refreshStatusRows(
  env: DirectoryEnv,
  rows: StatusRefreshRow[],
  options: StatusRefreshOptions
): Promise<void> {
  await mapWithConcurrency(rows, STATUS_REFRESH_CONCURRENCY, async (row) => {
    try {
      const snapshot = await fetchServerStatus(`${row.normalized_host}:${row.port}`);

      await runD1Batch(
        env,
        statusSnapshotStatements(env, row.id, snapshot, nowIso())
      );
      await options.afterSuccess?.(env, row.id);
    } catch (error) {
      options.logFailure(options.failureEvent, error, {
        id: row.id,
        address: `${row.normalized_host}:${row.port}`
      });
      const timestamp = nowIso();

      await runD1Batch(
        env,
        statusRefreshFailureStatements(env, row.id, timestamp, errorMessage(error))
      );
    }
  });
}

export async function maybeHideOffline(env: DirectoryEnv, serverId: string): Promise<void> {
  const offlineTimestamp = await offlineSince(env, serverId);

  if (!offlineTimestamp || offlineTimestamp > daysAgoIso(14))
    return;

  const timestamp = nowIso();

  await runD1Batch(env, autoHideOfflineStatements(env, serverId, timestamp));
}

export function isStatusStale(value: string | null): boolean {
  if (!value)
    return true;

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) || Date.now() - timestamp > STATUS_STALE_AFTER_MS;
}
