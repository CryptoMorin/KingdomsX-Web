import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { EditorAdmission } from "../editor-admission";

let objectCounter = 0;

describe("global editor admission", () => {
  it("enforces the ceiling across concurrent admission calls", async () => {
    const stub = admissionStub();
    const ceiling = Math.min(Number(env.EDITOR_DAILY_SESSION_LIMIT), Number(env.EDITOR_HOURLY_SESSION_LIMIT));
    const results = await Promise.all(Array.from({ length: ceiling + 5 }, () => stub.admit()));

    expect(results.filter((result) => result.allowed)).toHaveLength(ceiling);
    expect(results.filter((result) => !result.allowed).every((result) => result.retryAfter > 0)).toBe(true);
  });

  it("persists the daily budget across reconstruction", async () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    await configuredAdmission("2", "10", now, (instance, state, bindings) => {
      expect(instance.admit()).toEqual({ allowed: true, retryAfter: 0 });
      expect(instance.admit()).toEqual({ allowed: true, retryAfter: 0 });
      expect(instance.admit()).toEqual({ allowed: false, retryAfter: 12 * 60 * 60 });
      expect(state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM admissions").one().count).toBe(2);

      const queries = vi.spyOn(state.storage.sql, "exec");

      try {
        expect(instance.admit()).toEqual({ allowed: false, retryAfter: 12 * 60 * 60 });
        expect(queries).not.toHaveBeenCalled();
      } finally {
        queries.mockRestore();
      }

      const reopened = new EditorAdmission(state, bindings);
      expect(reopened.admit().allowed).toBe(false);
    });
  });

  it("preserves the rolling hourly ceiling across UTC midnight", async () => {
    const now = Date.parse("2026-10-05T00:15:00Z");
    await configuredAdmission("10", "2", now, (instance, state) => {
      const previousDay = Date.parse("2026-10-04T23:45:00Z");
      state.storage.sql.exec("INSERT INTO admissions (admitted_at) VALUES (?), (?)", previousDay, previousDay);

      expect(instance.admit()).toEqual({ allowed: false, retryAfter: 30 * 60 });
      vi.spyOn(Date, "now").mockReturnValue(previousDay + 60 * 60 * 1_000);
      expect(instance.admit()).toEqual({ allowed: true, retryAfter: 0 });
    });
  });

  it("resets the daily budget at UTC midnight and removes expired records", async () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    await configuredAdmission("1", "10", now, (instance, state) => {
      const expired = now - 24 * 60 * 60 * 1_000;
      state.storage.sql.exec("INSERT INTO admissions (admitted_at) VALUES (?)", expired);
      expect(instance.admit()).toEqual({ allowed: true, retryAfter: 0 });
      expect(state.storage.sql.exec("SELECT sequence FROM admissions WHERE admitted_at = ?", expired).toArray()).toHaveLength(0);
      expect(instance.admit().allowed).toBe(false);

      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-06T00:00:00Z"));
      expect(instance.admit()).toEqual({ allowed: true, retryAfter: 0 });
    });
  });

  it("waits until enough hourly slots clear when a configured limit is reduced", async () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    await configuredAdmission("10", "1", now, (instance, state) => {
      state.storage.sql.exec("INSERT INTO admissions (admitted_at) VALUES (?), (?)", now - 30 * 60 * 1_000, now - 10 * 60 * 1_000);
      expect(instance.admit()).toEqual({ allowed: false, retryAfter: 50 * 60 });
    });
  });

  it("fails closed for malformed limits", async () => {
    for (const limit of ["0", "1.5", "9007199254740992"]) {
      for (const [daily, hourly] of [[limit, "10"], ["10", limit]]) {
        await configuredAdmission(daily, hourly, Date.parse("2026-10-05T12:00:00Z"), (instance, state) => {
          expect(() => instance.admit()).toThrow("must be a positive safe integer");
          expect(state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM admissions").one().count).toBe(0);
        });
      }
    }
  });
});

function admissionStub() {
  objectCounter += 1;
  return env.EDITOR_ADMISSION.getByName(`admission-test-${objectCounter}`);
}

async function configuredAdmission(
  daily: string,
  hourly: string,
  now: number,
  check: (instance: EditorAdmission, state: DurableObjectState, bindings: Cloudflare.Env) => void
): Promise<void> {
  await runInDurableObject(admissionStub(), async (_instance: EditorAdmission, state) => {
    const bindings = {
      ...env,
      EDITOR_DAILY_SESSION_LIMIT: daily,
      EDITOR_HOURLY_SESSION_LIMIT: hourly
    } as Cloudflare.Env;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      check(new EditorAdmission(state, bindings), state, bindings);
    } finally {
      clock.mockRestore();
    }
  });
}
