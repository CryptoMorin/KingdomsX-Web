import { decodeBase64Url, encodeBase64Url } from "./remote-session-crypto.js";

const DATABASE_NAME = "kingdomsx-editor";
const DATABASE_VERSION = 1;
const STORE_NAME = "remote-drafts";
const DRAFT_VERSION = 2;
const NONCE_BYTES = 12;
const LENGTH_BYTES = 4;
const AAD_PREFIX = "kingdomsx-editor-local-draft-v2";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function createRemoteDraftRecovery(link, {
  indexedDb = globalThis.indexedDB,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now()
} = {}) {
  if (!indexedDb || !cryptoImpl?.subtle) {
    return null;
  }

  return new RemoteDraftRecovery(link, {
    storage: indexedDbDraftStorage(indexedDb),
    cryptoImpl,
    draftId: randomDraftId(cryptoImpl),
    now
  });
}

export class RemoteDraftRecovery {
  constructor(link, {
    storage,
    cryptoImpl = globalThis.crypto,
    draftId = randomDraftId(cryptoImpl),
    now = () => Date.now()
  }) {
    validateLink(link);
    validateDraftId(draftId);

    this.link = link;
    this.storage = storage;
    this.crypto = cryptoImpl;
    this.draftId = draftId;
    this.storageKey = `${link.id}:${draftId}`;
    this.loadedStorageKey = null;
    this.now = now;
  }

  async save({
    remoteRevision,
    expiresAt,
    archiveName,
    archiveBytes,
    activePath = "",
    editorMode = "visual",
    codeDraft = null
  }) {
    validateRevision(remoteRevision);

    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) {
      await this.clear();
      return;
    }

    const bytes = asBytes(archiveBytes);
    const updatedAt = this.now();
    const metadata = encoder.encode(JSON.stringify({
      archiveName: String(archiveName || "kingdomsx-server-configs.zip"),
      activePath: String(activePath || ""),
      editorMode: editorMode === "source" ? "source" : "visual",
      codeDraft: normalizeCodeDraft(codeDraft),
      updatedAt
    }));

    const plaintext = new Uint8Array(LENGTH_BYTES + metadata.byteLength + bytes.byteLength);
    new DataView(plaintext.buffer).setUint32(0, metadata.byteLength);
    plaintext.set(metadata, LENGTH_BYTES);
    plaintext.set(bytes, LENGTH_BYTES + metadata.byteLength);

    const nonce = new Uint8Array(NONCE_BYTES);
    this.crypto.getRandomValues(nonce);
    const key = await this.importKey();
    const ciphertext = new Uint8Array(await this.crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: nonce,
      additionalData: draftAdditionalData(this.link.id, this.draftId, remoteRevision, expiresAt),
      tagLength: 128
    }, key, plaintext));

    await this.storage.put({
      id: this.storageKey,
      sessionId: this.link.id,
      draftId: this.draftId,
      version: DRAFT_VERSION,
      protocol: this.link.protocol,
      remoteRevision,
      expiresAt,
      updatedAt,
      nonce,
      ciphertext
    });
  }

  async load({ remoteRevision, expiresAt }) {
    validateRevision(remoteRevision);

    const now = this.now();
    await this.storage.deleteExpired(now);

    const records = (await this.storage.list(this.link.id))
      .filter((record) => record.id === this.storageKey || record.sessionId === this.link.id)
      .sort((left, right) => {
        if (left.id === this.storageKey) {
          return -1;
        }

        if (right.id === this.storageKey) {
          return 1;
        }

        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      });
    let corrupt = false;

    for (const record of records) {
      if (record.version !== DRAFT_VERSION
        || record.protocol !== this.link.protocol
        || record.sessionId !== this.link.id
        || !/^[A-Za-z0-9_-]{22}$/.test(record.draftId)
        || record.expiresAt <= now
        || record.expiresAt !== expiresAt
        || record.remoteRevision !== remoteRevision) {
        await this.storage.delete(record.id);
        continue;
      }

      try {
        const key = await this.importKey();
        const plaintext = new Uint8Array(await this.crypto.subtle.decrypt({
          name: "AES-GCM",
          iv: asBytes(record.nonce),
          additionalData: draftAdditionalData(this.link.id, record.draftId, remoteRevision, expiresAt),
          tagLength: 128
        }, key, asBytes(record.ciphertext)));

        if (plaintext.byteLength < LENGTH_BYTES) {
          throw new Error("missing metadata");
        }

        const metadataBytes = new DataView(
          plaintext.buffer,
          plaintext.byteOffset,
          plaintext.byteLength
        ).getUint32(0);
        const archiveOffset = LENGTH_BYTES + metadataBytes;

        if (metadataBytes === 0 || archiveOffset > plaintext.byteLength) {
          throw new Error("invalid metadata length");
        }

        const metadata = JSON.parse(decoder.decode(plaintext.subarray(LENGTH_BYTES, archiveOffset)));

        if (!metadata || typeof metadata !== "object" || typeof metadata.archiveName !== "string") {
          throw new Error("invalid metadata");
        }

        this.loadedStorageKey = record.id;

        return {
          archiveName: metadata.archiveName,
          archiveBytes: plaintext.slice(archiveOffset),
          activePath: typeof metadata.activePath === "string" ? metadata.activePath : "",
          editorMode: metadata.editorMode === "source" ? "source" : "visual",
          codeDraft: normalizeCodeDraft(metadata.codeDraft),
          updatedAt: Number.isSafeInteger(metadata.updatedAt) ? metadata.updatedAt : record.updatedAt
        };
      } catch {
        corrupt = true;
        await this.storage.delete(record.id);
      }
    }

    if (corrupt) {
      throw new Error("The saved local draft could not be decrypted and was discarded.");
    }

    return null;
  }

  async clear() {
    const keys = new Set([this.storageKey, this.loadedStorageKey]);
    this.loadedStorageKey = null;

    for (const key of keys) {
      if (key) {
        await this.storage.delete(key);
      }
    }
  }

  async clearSession() {
    this.loadedStorageKey = null;
    const records = await this.storage.list(this.link.id);

    for (const record of records) {
      await this.storage.delete(record.id);
    }
  }

  async importKey() {
    return this.crypto.subtle.importKey(
      "raw",
      decodeBase64Url(this.link.key, 32),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
  }
}

function indexedDbDraftStorage(indexedDb) {
  let databasePromise;
  const database = () => {
    if (!databasePromise) {
      databasePromise = openDatabase(indexedDb);
    }

    return databasePromise;
  };

  return {
    async list(sessionId) {
      const db = await database();
      const records = await requestResult(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll());

      return records.filter((record) => record.sessionId === sessionId);
    },
    async put(record) {
      const db = await database();
      await transactionResult(db, "readwrite", (store) => store.put(record));
    },
    async delete(id) {
      const db = await database();
      await transactionResult(db, "readwrite", (store) => store.delete(id));
    },
    async deleteExpired(now) {
      const db = await database();
      await transactionResult(db, "readwrite", (store) => {
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;

          if (!cursor) {
            return;
          }

          if (Number.isSafeInteger(cursor.value?.expiresAt) && cursor.value.expiresAt <= now) {
            cursor.delete();
          }

          cursor.continue();
        };
      });
    }
  };
}

function openDatabase(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Local draft storage could not be opened."));
    request.onblocked = () => reject(new Error("Local draft storage is blocked by another editor tab."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("Local draft storage failed."));
  });
}

function transactionResult(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    operation(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local draft storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local draft storage was cancelled."));
  });
}

function normalizeCodeDraft(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof value.fileName !== "string" || typeof value.source !== "string") {
    return null;
  }

  return { fileName: value.fileName, source: value.source };
}

function draftAdditionalData(sessionId, draftId, revision, expiresAt) {
  return encoder.encode(`${AAD_PREFIX}:${sessionId}:${draftId}:${revision}:${expiresAt}`);
}

function randomDraftId(cryptoImpl) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);

  return encodeBase64Url(bytes);
}

function validateLink(link) {
  if (link?.protocol !== 1
    || !/^[A-Za-z0-9_-]{22}$/.test(link.id)
    || !/^[A-Za-z0-9_-]{43}$/.test(link.key)
    || !/^[A-Za-z0-9_-]{43}$/.test(link.browserToken)) {
    throw new Error("The editor session cannot be used for local draft recovery.");
  }
}

function validateRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 0xffffffff) {
    throw new Error("The editor draft revision is invalid.");
  }
}

function validateDraftId(draftId) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(draftId)) {
    throw new Error("The editor draft identity is invalid.");
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new TypeError("Expected a byte array.");
}
