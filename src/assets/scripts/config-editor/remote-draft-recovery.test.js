import { describe, expect, it } from "vitest";
import { RemoteDraftRecovery } from "./remote-draft-recovery.js";

const link = {
  protocol: 1,
  id: "session_identifier_123",
  key: "A".repeat(43),
  browserToken: "B".repeat(43)
};

describe("remote editor local draft recovery", () => {
  it("stores only encrypted content and restores the matching remote revision", async () => {
    const storage = memoryStorage();
    const recovery = new RemoteDraftRecovery(link, {
      storage,
      draftId: "A".repeat(22),
      now: () => 1_000
    });
    const archiveBytes = Uint8Array.from([80, 75, 3, 4, 1, 2, 3]);

    await recovery.save({
      remoteRevision: 2,
      expiresAt: 10_000,
      archiveName: "configs-edited.zip",
      archiveBytes,
      activePath: "config.yml",
      editorMode: "source",
      codeDraft: { fileName: "config.yml", source: "enabled: false\n" }
    });

    const stored = storage.value();
    expect(stored.id).toBe(`${link.id}:${"A".repeat(22)}`);
    expect(stored.sessionId).toBe(link.id);
    expect(stored.draftId).toBe("A".repeat(22));
    expect(stored.remoteRevision).toBe(2);
    expect(stored).not.toHaveProperty("archiveName");
    expect(Buffer.from(stored.ciphertext).toString()).not.toContain("enabled");
    await expect(recovery.load({ remoteRevision: 2, expiresAt: 10_000 })).resolves.toMatchObject({
      archiveName: "configs-edited.zip",
      archiveBytes,
      activePath: "config.yml",
      editorMode: "source",
      codeDraft: { fileName: "config.yml", source: "enabled: false\n" }
    });
  });

  it("discards expired and stale-revision drafts", async () => {
    const expiredStorage = memoryStorage();
    const expired = new RemoteDraftRecovery(link, {
      storage: expiredStorage,
      draftId: "A".repeat(22),
      now: () => 5_000
    });
    expiredStorage.seed({
      id: `${link.id}:${"A".repeat(22)}`,
      sessionId: link.id,
      draftId: "A".repeat(22),
      version: 1,
      protocol: 1,
      remoteRevision: 0,
      expiresAt: 4_999
    });

    await expect(expired.load({ remoteRevision: 0, expiresAt: 4_999 })).resolves.toBeNull();
    const staleStorage = memoryStorage();
    const stale = new RemoteDraftRecovery(link, { storage: staleStorage, draftId: "A".repeat(22), now: () => 1_000 });
    await stale.save({
      remoteRevision: 1,
      expiresAt: 5_000,
      archiveName: "configs.zip",
      archiveBytes: Uint8Array.from([1])
    });

    await expect(stale.load({ remoteRevision: 2, expiresAt: 5_000 })).resolves.toBeNull();
    expect(staleStorage.value()).toBeNull();
  });

  it("rejects a draft encrypted with another key", async () => {
    const storage = memoryStorage();
    const recovery = new RemoteDraftRecovery(link, { storage, draftId: "A".repeat(22), now: () => 1_000 });
    await recovery.save({
      remoteRevision: 0,
      expiresAt: 5_000,
      archiveName: "configs.zip",
      archiveBytes: Uint8Array.from([1, 2, 3])
    });

    const wrongKey = new RemoteDraftRecovery({ ...link, key: "C".repeat(43) }, {
      storage,
      draftId: "A".repeat(22),
      now: () => 1_000
    });
    await expect(wrongKey.load({ remoteRevision: 0, expiresAt: 5_000 })).rejects.toThrow("could not be decrypted");
    expect(storage.value()).toBeNull();
  });

  it("keeps simultaneous tab drafts in separate records and recovers the newest one", async () => {
    const storage = memoryStorage();
    const firstTab = new RemoteDraftRecovery(link, { storage, draftId: "A".repeat(22), now: () => 1_000 });
    const secondTab = new RemoteDraftRecovery(link, { storage, draftId: "B".repeat(22), now: () => 2_000 });

    await firstTab.save({ remoteRevision: 0, expiresAt: 10_000, archiveName: "first.zip", archiveBytes: Uint8Array.from([1]) });
    await secondTab.save({ remoteRevision: 0, expiresAt: 10_000, archiveName: "second.zip", archiveBytes: Uint8Array.from([2]) });

    expect(storage.values()).toHaveLength(2);
    await expect(secondTab.load({ remoteRevision: 0, expiresAt: 10_000 })).resolves.toMatchObject({ archiveName: "second.zip" });
    const freshTab = new RemoteDraftRecovery(link, { storage, draftId: "C".repeat(22), now: () => 2_000 });
    await expect(freshTab.load({ remoteRevision: 0, expiresAt: 10_000 })).resolves.toMatchObject({ archiveName: "second.zip" });

    await freshTab.clearSession();
    expect(storage.values()).toEqual([]);
  });

  it("sweeps expired records for every session during load", async () => {
    const storage = memoryStorage();
    const existing = new RemoteDraftRecovery(link, { storage, draftId: "A".repeat(22), now: () => 1_000 });
    await existing.save({
      remoteRevision: 0,
      expiresAt: 5_000,
      archiveName: "configs.zip",
      archiveBytes: Uint8Array.from([1])
    });
    storage.seed({
      id: "other-session:other-draft",
      sessionId: "other-session",
      draftId: "D".repeat(22),
      version: 2,
      protocol: 1,
      expiresAt: 999
    });
    const recovery = new RemoteDraftRecovery(link, { storage, draftId: "B".repeat(22), now: () => 1_000 });

    await expect(recovery.load({ remoteRevision: 0, expiresAt: 5_000 })).resolves.toMatchObject({ archiveName: "configs.zip" });
    expect(storage.values()).toHaveLength(1);
    expect(storage.values()[0].sessionId).toBe(link.id);
  });
});

function memoryStorage() {
  const records = new Map();

  return {
    list: async (sessionId) => [...records.values()]
      .filter((record) => record.sessionId === sessionId)
      .map((record) => structuredClone(record)),
    put: async (value) => {
      records.set(value.id, structuredClone(value));
    },
    delete: async (id) => {
      records.delete(id);
    },
    deleteExpired: async (now) => {
      for (const [id, record] of records) {
        if (record.expiresAt <= now) {
          records.delete(id);
        }
      }
    },
    seed(value) {
      records.set(value.id, structuredClone(value));
    },
    value() {
      return structuredClone(records.values().next().value ?? null);
    },
    values() {
      return [...records.values()].map((record) => structuredClone(record));
    }
  };
}
