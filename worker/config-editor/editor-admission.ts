import { DurableObject } from "cloudflare:workers";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export class EditorAdmission extends DurableObject<Cloudflare.Env> {
  private blocked?: { until: number; dailyLimit: number; hourlyLimit: number };

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS admissions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, admitted_at INTEGER NOT NULL)");
      this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS admissions_by_time ON admissions (admitted_at)");
    });
  }

  admit(): { allowed: boolean; retryAfter: number } {
    const dailyLimit = positiveLimit(this.env.EDITOR_DAILY_SESSION_LIMIT, "EDITOR_DAILY_SESSION_LIMIT");
    const hourlyLimit = positiveLimit(this.env.EDITOR_HOURLY_SESSION_LIMIT, "EDITOR_HOURLY_SESSION_LIMIT");
    const now = Date.now();

    // Only cache denials so every admitted session is still charged in SQLite
    if (
      this.blocked
      && this.blocked.dailyLimit === dailyLimit
      && this.blocked.hourlyLimit === hourlyLimit
      && now < this.blocked.until
    ) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((this.blocked.until - now) / 1_000)) };
    }

    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const hourStart = now - HOUR_MS;

    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;

      // Keep previous-day admissions until they leave the rolling hour
      sql.exec("DELETE FROM admissions WHERE admitted_at < ?", Math.min(dayStart, hourStart));

      const daily = sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM admissions WHERE admitted_at >= ?", dayStart).one().count;
      const hourly = sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM admissions WHERE admitted_at > ?", hourStart).one().count;
      let retryAt = now;

      if (daily >= dailyLimit) {
        retryAt = dayStart + DAY_MS;
      }

      if (hourly >= hourlyLimit) {
        const nextSlot = sql.exec<{ admitted_at: number }>(
          "SELECT admitted_at FROM admissions WHERE admitted_at > ? ORDER BY admitted_at LIMIT 1 OFFSET ?",
          hourStart,
          hourly - hourlyLimit
        ).one().admitted_at;
        retryAt = Math.max(retryAt, nextSlot + HOUR_MS);
      }

      if (retryAt > now) {
        this.blocked = { until: retryAt, dailyLimit, hourlyLimit };
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1_000)) };
      }

      sql.exec("INSERT INTO admissions (admitted_at) VALUES (?)", now);
      this.blocked = undefined;

      return { allowed: true, retryAfter: 0 };
    });
  }
}

function positiveLimit(value: string, name: string): number {
  const parsed = Number(value);

  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }

  return parsed;
}
