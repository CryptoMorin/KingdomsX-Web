import { jitterDelay } from "./crypto";
import { errorMessage, sleep } from "./runtime";

const D1_WRITE_RETRY_ATTEMPTS = 3;
const D1_WRITE_RETRY_BASE_DELAY_MS = 50;

interface D1Env {
  DB: D1Database;
}

export async function runD1Statement(statement: D1PreparedStatement): Promise<D1Result> {
  return retryD1Write(() => statement.run());
}

export async function runD1Batch(
  env: D1Env,
  statements: D1PreparedStatement[]
): Promise<D1Result[]> {
  return retryD1Write(() => env.DB.batch(statements));
}

async function retryD1Write<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= D1_WRITE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Only retry the transient reset errors D1 can recover from
      if (attempt >= D1_WRITE_RETRY_ATTEMPTS || !isRetryableD1Error(error)) {
        throw error;
      }

      await sleep(D1_WRITE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + jitterDelay());
    }
  }

  throw lastError;
}

function isRetryableD1Error(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("network connection lost") ||
    message.includes("storage caused object to be reset") ||
    message.includes("reset because its code was updated")
  );
}

export function isD1UniqueConstraintError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("unique constraint failed") || message.includes("constraint failed: unique")
  );
}
