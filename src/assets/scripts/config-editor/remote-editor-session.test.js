import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteEditorSession } from "./remote-editor-session.js";
import {
  decryptRemotePayload,
  encryptRemotePayload,
  REMOTE_PAYLOAD_KIND
} from "./remote-session-crypto.js";

const link = {
  protocol: 1,
  id: "session_identifier_123",
  key: "A".repeat(43),
  browserToken: "B".repeat(43)
};

describe("remote editor sessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens the encrypted original and waits for an applied result", async () => {
    const original = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const encryptedOriginal = await encryptRemotePayload(original, {
      sessionId: link.id,
      key: link.key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    });
    let uploaded;
    const fetcher = async (url, init = {}) => {
      if (url.endsWith(`/sessions/${link.id}`)) {
        return jsonResponse(snapshot("ready", 0, 1));
      }

      if (url.endsWith("/payloads/original")) {
        return new Response(encryptedOriginal);
      }

      if (url.endsWith("/payloads/result/1")) {
        expect(init.headers.Authorization).toBe(`KingdomsX-Editor ${link.browserToken}`);
        expect(init.headers["X-KingdomsX-Payload-Bytes"]).toBe(String(init.body.byteLength));
        uploaded = new Uint8Array(init.body);
        return jsonResponse(snapshot("applied", 1, 3));
      }

      throw new Error(`Unexpected request: ${url}`);
    };
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher,
      WebSocketClass: null
    });

    await expect(session.open()).resolves.toEqual({
      name: "kingdomsx-server-configs.zip",
      bytes: original,
      originalBytes: original,
      remoteProtocol: 1,
      remoteRevision: 0
    });

    const edited = new Uint8Array([80, 75, 3, 4, 9, 8, 7]);
    await expect(session.save(edited, 0)).resolves.toBe(1);
    await expect(decryptRemotePayload(uploaded, {
      sessionId: link.id,
      key: link.key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision: 1
    })).resolves.toEqual(edited);
  });

  it("does not treat a failed server apply as a save", async () => {
    const fetcher = async (url) => {
      if (url.endsWith(`/sessions/${link.id}`)) {
        return jsonResponse(snapshot("ready", 0, 1));
      }

      if (url.endsWith("/payloads/result/1")) {
        return jsonResponse({ ...snapshot("failed", 1, 3), failureCode: "replace_failed" });
      }

      throw new Error(`Unexpected request: ${url}`);
    };
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher,
      WebSocketClass: null
    });

    await expect(session.save(new Uint8Array([1, 2, 3]), 0)).rejects.toThrow("replace_failed");
  });

  it("reopens the latest result instead of a stale original", async () => {
    const original = new Uint8Array([80, 75, 3, 4, 1]);
    const latest = new Uint8Array([80, 75, 3, 4, 5]);
    const encryptedOriginal = await encryptRemotePayload(original, {
      sessionId: link.id,
      key: link.key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    });
    const encrypted = await encryptRemotePayload(latest, {
      sessionId: link.id,
      key: link.key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision: 2
    });
    const fetcher = async (url) => {
      if (url.endsWith(`/sessions/${link.id}`)) {
        return jsonResponse(snapshot("applied", 2, 8));
      }

      if (url.endsWith("/payloads/original")) {
        return new Response(encryptedOriginal);
      }

      if (url.endsWith("/payloads/result/2")) {
        return new Response(encrypted);
      }

      throw new Error(`Unexpected request: ${url}`);
    };
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher,
      WebSocketClass: null
    });

    await expect(session.open()).resolves.toMatchObject({ bytes: latest, originalBytes: original });
  });

  it("rejects a stale base revision before uploading a result", async () => {
    let payloadRequests = 0;
    const fetcher = async (url) => {
      if (url.endsWith(`/sessions/${link.id}`)) {
        return jsonResponse(snapshot("applied", 3, 4));
      }

      if (url.includes("/payloads/result/")) {
        payloadRequests += 1;
      }

      throw new Error(`Unexpected request: ${url}`);
    };
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher,
      WebSocketClass: null
    });

    await expect(session.save(new Uint8Array([1, 2, 3]), 2)).rejects.toThrow("revision changed");
    expect(payloadRequests).toBe(0);
  });

  it("keeps the expired session details returned with HTTP 410", async () => {
    const expired = snapshot("expired", 2, 9);
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher: async () => jsonResponse(expired, 410),
      WebSocketClass: null
    });

    await expect(session.getStatus()).rejects.toMatchObject({ status: 410 });
    expect(session.snapshot).toEqual(expired);
  });

  it("times out active requests and cancels pending requests when closed", async () => {
    vi.useFakeTimers();
    const requests = [];
    const fetcher = (_url, init) => new Promise((_resolve, reject) => {
      requests.push(init);
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    const session = new RemoteEditorSession(link, {
      origin: "https://editor.test",
      fetcher,
      WebSocketClass: null,
      requestTimeoutMs: 100
    });

    const timedOut = expect(session.getStatus()).rejects.toMatchObject({ status: 408 });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(requests[0].signal.aborted).toBe(true);

    const closed = expect(session.getStatus()).rejects.toThrow("closed");
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    session.close();
    await closed;
    expect(requests[1].signal.aborted).toBe(true);
  });
});

function snapshot(state, resultRevision, sequence) {
  return {
    type: "session",
    protocol: 1,
    state,
    resultRevision,
    sequence,
    expiresAt: Date.now() + 60_000
  };
}

function jsonResponse(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
