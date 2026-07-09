export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;

  const consume = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];

      await task(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Status refresh failed.";
}

export function logError(
  event: string,
  error?: unknown,
  fields: Record<string, unknown> = {}
): void {
  console.error(JSON.stringify(logPayload(event, error, fields)));
}

export function logWarn(
  event: string,
  error?: unknown,
  fields: Record<string, unknown> = {}
): void {
  console.warn(JSON.stringify(logPayload(event, error, fields)));
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify(logPayload(event, undefined, fields)));
}

function logPayload(
  event: string,
  error?: unknown,
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    event,
    ...fields,
    ...(error === undefined ? {} : { error: errorMessage(error) })
  };
}

export const nowIso = () => new Date().toISOString();
export const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
export const msAgoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
