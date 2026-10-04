import { describe, expect, it } from "vitest";
import {
  decryptRemotePayload,
  deriveRemoteEditorSecrets,
  encryptRemotePayload,
  encodeBase64Url,
  REMOTE_PAYLOAD_KIND,
  sha256Hex
} from "./remote-session-crypto.js";

const sessionId = "session_identifier_123";
const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("remote session encryption", () => {
  it("matches the link derivation vector used by the Java plugin", async () => {
    const seed = encodeBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index));

    expect(seed).toBe("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    await expect(deriveRemoteEditorSecrets(seed)).resolves.toEqual({
      id: "OS8PHhPTaDvkj-Zhn8zWIw",
      key: "HnlqpSd7Zo7EFO5seTziZSsZBSni0_GsWr3kF9l8b9M",
      browserToken: "stV5NmIsEd7x_4DIH_LTBCLVsGPpwN2lIMCU3ibLXXY"
    });
  });

  it("rejects invalid and non-canonical link seeds", async () => {
    await expect(deriveRemoteEditorSecrets("A".repeat(42))).rejects.toThrow("seed is invalid");
    await expect(deriveRemoteEditorSecrets("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh9"))
      .rejects.toThrow("seed is invalid");
  });

  it("encrypts and decrypts a result without losing its contents", async () => {
    const plaintext = new TextEncoder().encode("secret: database-password");
    const encrypted = await encryptRemotePayload(plaintext, {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision: 3
    });

    expect(encrypted.byteLength).toBe(plaintext.byteLength + 43);
    await expect(decryptRemotePayload(encrypted, {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision: 3
    })).resolves.toEqual(plaintext);
  });

  it("rejects changed data and data copied from another session", async () => {
    const encrypted = await encryptRemotePayload(new Uint8Array([1, 2, 3]), {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    });
    encrypted[encrypted.length - 1] ^= 1;

    await expect(decryptRemotePayload(encrypted, {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    })).rejects.toThrow("damaged or changed");

    const valid = await encryptRemotePayload(new Uint8Array([1, 2, 3]), {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    });
    await expect(decryptRemotePayload(valid, {
      sessionId: "another_session_id_123",
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    })).rejects.toThrow("damaged or changed");
  });

  it("rejects a file opened as the wrong type or revision", async () => {
    const encrypted = await encryptRemotePayload(new Uint8Array([1]), {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision: 8
    });

    await expect(decryptRemotePayload(encrypted, {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    })).rejects.toThrow("wrong type or revision");
  });

  it("matches the protocol vector used by the Java plugin", async () => {
    const random = {
      getRandomValues(bytes) {
        bytes.set(Uint8Array.from({ length: bytes.length }, (_, index) => index));
        return bytes;
      }
    };
    const encrypted = await encryptRemotePayload(new TextEncoder().encode("hello KingdomsX"), {
      sessionId,
      key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0,
      random
    });

    expect(Buffer.from(encrypted).toString("hex")).toBe(
      "4b494e47444f4d5358010100000000000102030405060708090a0be0ae5f3e6fddc490ac1f368a907086ffe051791b5a7d5be0e6c42d6b0f5888"
    );
    expect(await sha256Hex(encrypted)).toBe("586dfdf19d9670fce8d9fd5698705b1b858448f345e5e8aca58d9648fd1f4559");
  });
});
