import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BROWSER_SOCKETS,
  MAX_RESULT_REVISION,
  MAX_SESSION_DOWNLOAD_BYTES,
  MAX_SESSION_UPLOAD_BYTES,
  TERMINAL_GRACE_MS,
  type SessionRecord
} from "../contracts";
import editorWorker from "../index";
import { boundedPayload, EditorSession } from "../editor-session";
import { readJson } from "../http";

let sessionId = "session_identifier_000";
let sessionCounter = 0;
const serverToken = "A".repeat(43);
const browserToken = "B".repeat(43);
const original = new Uint8Array(64).fill(7);
let originalSha256 = "";
let serverTokenHash = "";
let browserTokenHash = "";

beforeAll(async () => {
  [originalSha256, serverTokenHash, browserTokenHash] = await Promise.all([
    digest(original),
    digest(new TextEncoder().encode(serverToken)),
    digest(new TextEncoder().encode(browserToken))
  ]);
});

beforeEach(() => {
  sessionCounter += 1;
  sessionId = `session_identifier_${String(sessionCounter).padStart(3, "0")}`;
});

describe("editor Worker routes", () => {
  it("rejects new sessions when the rate limit is reached", async () => {
    const runtimeEnv: Cloudflare.Env = {
      ...env,
      EDITOR_SESSION_CREATES: {
        async limit() {
          return { success: false };
        }
      }
    };
    const response = await editorWorker.fetch(new Request(
      "https://editor.test/api/editor/v1/sessions/session_identifier_999",
      { method: "PUT" }
    ), runtimeEnv);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("rejects session traffic when either traffic limit is reached", async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: key.startsWith("session:") }));
    const runtimeEnv: Cloudflare.Env = {
      ...env,
      EDITOR_SESSION_TRAFFIC: { limit }
    };
    const response = await editorWorker.fetch(new Request(
      "https://editor.test/api/editor/v1/sessions/session_identifier_999",
      { headers: auth(browserToken) }
    ), runtimeEnv);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "rate_limited" });
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it("forwards non-API routes to the static files", async () => {
    const response = await editorWorker.fetch(new Request("https://editor.test/"), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Editor Worker test asset");
  });

  it("keeps unknown editor API routes out of the asset fallback", async () => {
    const response = await editorWorker.fetch(new Request("https://editor.test/api/editor/v2/sessions"), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });
});

describe("editor sessions", () => {
  it("rejects a session that uses the same secret for both roles", async () => {
    const response = await createSession({ browserTokenHash: serverTokenHash });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_session" });
  });

  it("cancels oversized JSON streams without a declared length", async () => {
    const cancel = vi.fn();
    const request = new Request("https://editor.test/", {
      method: "PUT",
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(4096).fill(32));
        },
        cancel
      })
    });

    expect(request.headers.has("Content-Length")).toBe(false);
    await expect(readJson(request)).rejects.toMatchObject({
      status: 413,
      code: "request_too_large"
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("decodes multibyte JSON split across stream chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"é"}');
    const request = new Request("https://editor.test/", {
      method: "PUT",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) {
            controller.enqueue(new Uint8Array([byte]));
          }

          controller.close();
        }
      })
    });

    await expect(readJson(request, bytes.length)).resolves.toEqual({ name: "é" });
  });

  it("creates each session once and keeps the owner and server roles separate", async () => {
    const created = await createSession();
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      type: "session",
      state: "awaiting_original",
      resultRevision: 0
    });

    expect((await createSession()).status).toBe(200);
    expect((await api("", { headers: auth(browserToken) })).status).toBe(200);
    expect((await api("", { headers: auth("C".repeat(43)) })).status).toBe(401);

    const mismatch = await api("", {
      method: "PUT",
      body: JSON.stringify(createBody({ name: "different.zip" }))
    });
    expect(mismatch.status).toBe(409);
  });

  it("accepts only exact file routes and plain decimal revision numbers", async () => {
    await createSession();
    expect((await api("payloads/original/extra", { headers: auth(browserToken) })).status).toBe(404);
    const nonCanonical = await api("payloads/result/01", { headers: auth(browserToken) });
    expect(nonCanonical.status).toBe(400);
    await expect(nonCanonical.json()).resolves.toMatchObject({ error: "invalid_revision" });
  });

  it("stores encrypted files in R2 and follows the save steps", async () => {
    await createSession();
    const upload = await api("payloads/original", payloadRequest(original, serverToken, originalSha256));
    expect(upload.status).toBe(201);
    await expect(upload.json()).resolves.toMatchObject({ state: "ready" });

    const downloaded = await api("payloads/original", { headers: auth(browserToken) });
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);

    const result = new Uint8Array(80).fill(9);
    const resultSha256 = await digest(result);
    expect((await api("payloads/result/1", payloadRequest(result, browserToken, resultSha256))).status).toBe(201);
    expect((await api("payloads/result/1", payloadRequest(result, browserToken, resultSha256))).status).toBe(200);
    expect((await api("payloads/result/3", payloadRequest(result, browserToken, resultSha256))).status).toBe(409);

    expect((await apply("started")).status).toBe(200);
    expect((await api("payloads/result/1", payloadRequest(result, browserToken, resultSha256))).status).toBe(409);
    expect((await api("payloads/result/2", payloadRequest(result, browserToken, resultSha256))).status).toBe(409);
    const applied = await apply("applied");
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({ state: "applied", resultRevision: 1 });
  });

  it("recovers an original upload interrupted after R2 saved it", async () => {
    await createSession();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    await env.EDITOR_PAYLOADS.put(`${sessionId}/original.bin`, original, {
      customMetadata: { sha256: originalSha256 }
    });
    await runInDurableObject(stub, async (_instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.uploadedBytes = original.byteLength;
      record.pending = {
        kind: "original",
        operationId: "interrupted-original",
        revision: 0,
        bytes: original.byteLength,
        sha256: originalSha256
      };
      await state.storage.put("session", record);
    });

    const resumed = await api("payloads/original", payloadRequest(original, serverToken, originalSha256));

    expect(resumed.status).toBe(201);
    await expect(resumed.json()).resolves.toMatchObject({ state: "ready" });
    const record = await runInDurableObject(stub, async (_instance: EditorSession, state) =>
      state.storage.get<SessionRecord>("session")
    );
    expect(record?.pending).toBeUndefined();
  });

  it("recovers a result upload interrupted after R2 saved it", async () => {
    await prepareResult();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    const result = new Uint8Array(96).fill(11);
    const resultSha256 = await digest(result);
    await env.EDITOR_PAYLOADS.put(`${sessionId}/result-2.bin`, result, {
      customMetadata: { sha256: resultSha256 }
    });
    await runInDurableObject(stub, async (_instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.uploadedBytes += result.byteLength;
      record.pending = {
        kind: "result",
        operationId: "interrupted-result",
        revision: 2,
        bytes: result.byteLength,
        sha256: resultSha256
      };
      await state.storage.put("session", record);
    });

    const resumed = await api("payloads/result/2", payloadRequest(result, browserToken, resultSha256));

    expect(resumed.status).toBe(201);
    await expect(resumed.json()).resolves.toMatchObject({ state: "result_ready", resultRevision: 2 });
    const record = await runInDurableObject(stub, async (_instance: EditorSession, state) =>
      state.storage.get<SessionRecord>("session")
    );
    expect(record?.pending).toBeUndefined();
  });

  it("rejects a duplicate while the first upload is still running", async () => {
    await createSession();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);

    const raced = await runInDurableObject(stub, async (instance: EditorSession) => {
      const putStarted = deferred();
      const releasePut = deferred();
      const runtimeEnv = objectEnv(instance);
      const originalBucket = runtimeEnv.EDITOR_PAYLOADS;
      const delayedPut = (async (...args: unknown[]) => {
        putStarted.resolve();
        await releasePut.promise;
        return Reflect.apply(originalBucket.put, originalBucket, args);
      }) as R2Bucket["put"];
      const restore = replaceBucket(instance, { put: delayedPut });

      try {
        const firstPromise = instance.fetch(sessionRequest(
          "payloads/original",
          payloadRequest(original, serverToken, originalSha256)
        ));
        await putStarted.promise;
        const duplicate = await instance.fetch(sessionRequest(
          "payloads/original",
          payloadRequest(original, serverToken, originalSha256)
        ));
        releasePut.resolve();
        const first = await firstPromise;

        return {
          firstStatus: first.status,
          duplicateStatus: duplicate.status,
          duplicateBody: await duplicate.json<{ error: string }>()
        };
      } finally {
        releasePut.resolve();
        restore();
      }
    });

    expect(raced.firstStatus).toBe(201);
    expect(raced.duplicateStatus).toBe(409);
    expect(raced.duplicateBody).toMatchObject({ error: "upload_in_progress" });
  });

  it("rejects conflicting sizes, wrong hashes, and the wrong role", async () => {
    await createSession();
    const missingLength = await api("payloads/original", {
      method: "PUT",
      headers: {
        ...auth(serverToken),
        "Content-Type": "application/octet-stream",
        "X-KingdomsX-Payload-Sha256": originalSha256
      },
      body: original
    });
    expect(missingLength.status).toBe(411);

    const wrongRole = await api("payloads/original", payloadRequest(original, browserToken, originalSha256));
    expect(wrongRole.status).toBe(401);

    const wrongDigest = await api("payloads/original", payloadRequest(original, serverToken, "0".repeat(64)));
    expect(wrongDigest.status).toBe(422);

    const corruptPayload = new Uint8Array(original).fill(8);
    const corrupt = await api("payloads/original", payloadRequest(corruptPayload, serverToken, originalSha256));
    expect(corrupt.status).toBe(422);
    await expect(corrupt.json()).resolves.toMatchObject({ error: "payload_integrity_failed" });
    expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);
  });

  it("rejects a streamed payload as soon as it exceeds its declared size", async () => {
    const bytes = new Uint8Array(original.byteLength + 1).fill(3);
    const bounded = boundedPayload(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }), original.byteLength);

    await expect(new Response(bounded.body).arrayBuffer()).rejects.toThrow();
    await bounded.completion;
    expect(bounded.error()).toMatchObject({
      message: "The encrypted file size does not match its metadata."
    });
  });

  it("counts failed uploads toward the session upload limit", async () => {
    await createSession();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    await runInDurableObject(stub, async (_instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.uploadedBytes = MAX_SESSION_UPLOAD_BYTES - original.byteLength;
      await state.storage.put("session", record);
    });

    const corrupt = new Uint8Array(original).fill(8);
    const failed = await api("payloads/original", payloadRequest(corrupt, serverToken, originalSha256));
    expect(failed.status).toBe(422);

    const retry = await runInDurableObject(stub, async (instance: EditorSession) => instance.fetch(
      sessionRequest("payloads/original", payloadRequest(original, serverToken, originalSha256))
    ));
    expect(retry.status).toBe(413);
    await expect(retry.json()).resolves.toMatchObject({ error: "upload_limit_reached" });
  });

  it("enforces the save and download limits for each session", async () => {
    await createSession();
    expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    await runInDurableObject(stub, async (_instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.state = "applied";
      record.resultRevision = MAX_RESULT_REVISION;
      record.downloadedBytes = MAX_SESSION_DOWNLOAD_BYTES - original.byteLength + 1;
      await state.storage.put("session", record);
    });

    const result = new Uint8Array(80).fill(9);
    const resultSha256 = await digest(result);
    const revisionLimit = await runInDurableObject(stub, async (instance: EditorSession) => instance.fetch(
      sessionRequest(
        `payloads/result/${MAX_RESULT_REVISION + 1}`,
        payloadRequest(result, browserToken, resultSha256)
      )
    ));
    expect(revisionLimit.status).toBe(413);
    await expect(revisionLimit.json()).resolves.toMatchObject({ error: "result_limit_reached" });

    const downloadLimit = await runInDurableObject(stub, async (instance: EditorSession) => {
      const restore = replaceBucket(instance, {
        get: async () => ({
          size: original.byteLength,
          customMetadata: { sha256: originalSha256 },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(original);
              controller.close();
            }
          })
        })
      });

      try {
        return await instance.fetch(sessionRequest("payloads/original", { headers: auth(browserToken) }));
      } finally {
        restore();
      }
    });
    expect(downloadLimit.status).toBe(429);
    await expect(downloadLimit.json()).resolves.toMatchObject({ error: "download_limit_reached" });
  });

  it("rejects unknown save results without changing the session", async () => {
    await createSession();
    expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);

    const result = new Uint8Array(80).fill(9);
    const resultSha256 = await digest(result);
    const revision = 1;
    expect((await api(`payloads/result/${revision}`, payloadRequest(result, browserToken, resultSha256))).status).toBe(201);
    expect((await apply("started", revision)).status).toBe(200);

    const invalid = await apply("not-a-real-outcome", revision);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "invalid_outcome" });

    const snapshot = await api("", { headers: auth(serverToken) });
    await expect(snapshot.json()).resolves.toMatchObject({ state: "applying", resultRevision: revision });
  });

  it("does not apply a result while it is still uploading", async () => {
    await prepareResult();
    const nextResult = new Uint8Array(96).fill(11);
    const nextSha256 = await digest(nextResult);
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);

    const raced = await runInDurableObject(stub, async (instance: EditorSession) => {
      const putStarted = deferred();
      const releasePut = deferred();
      const runtimeEnv = objectEnv(instance);
      const originalBucket = runtimeEnv.EDITOR_PAYLOADS;
      const delayedPut = (async (...args: unknown[]) => {
        putStarted.resolve();
        await releasePut.promise;
        return Reflect.apply(originalBucket.put, originalBucket, args);
      }) as R2Bucket["put"];
      const restore = replaceBucket(instance, { put: delayedPut });

      try {
        const uploadPromise = instance.fetch(sessionRequest(
          "payloads/result/2",
          payloadRequest(nextResult, browserToken, nextSha256)
        ));
        await putStarted.promise;

        const started = await instance.fetch(sessionRequest("apply", applyRequest("started", 1)));
        releasePut.resolve();
        const upload = await uploadPromise;

        return {
          startedStatus: started.status,
          startedBody: await started.json<{ error: string }>(),
          uploadStatus: upload.status,
          uploadBody: await upload.json<{ state: string; resultRevision: number }>()
        };
      } finally {
        releasePut.resolve();
        restore();
      }
    });

    expect(raced.startedStatus).toBe(409);
    expect(raced.startedBody).toMatchObject({ error: "invalid_state" });
    expect(raced.uploadStatus).toBe(201);
    expect(raced.uploadBody).toMatchObject({ state: "result_ready", resultRevision: 2 });
    expect((await apply("started", 2)).status).toBe(200);
  });

  it("does not let an old upload completion undo cancellation", async () => {
    await prepareResult();
    const nextResult = new Uint8Array(96).fill(12);
    const nextSha256 = await digest(nextResult);
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);

    const raced = await runInDurableObject(stub, async (instance: EditorSession) => {
      const putStarted = deferred();
      const releasePut = deferred();
      const runtimeEnv = objectEnv(instance);
      const originalBucket = runtimeEnv.EDITOR_PAYLOADS;
      const delayedPut = (async (...args: unknown[]) => {
        putStarted.resolve();
        await releasePut.promise;
        return Reflect.apply(originalBucket.put, originalBucket, args);
      }) as R2Bucket["put"];
      const restore = replaceBucket(instance, { put: delayedPut });

      try {
        const uploadPromise = instance.fetch(sessionRequest(
          "payloads/result/2",
          payloadRequest(nextResult, browserToken, nextSha256)
        ));
        await putStarted.promise;

        const cancelled = await instance.fetch(sessionRequest("", {
          method: "DELETE",
          headers: auth(serverToken)
        }));
        releasePut.resolve();
        const upload = await uploadPromise;

        return {
          cancelledStatus: cancelled.status,
          uploadStatus: upload.status,
          uploadBody: await upload.json<{ error: string }>()
        };
      } finally {
        releasePut.resolve();
        restore();
      }
    });

    expect(raced.cancelledStatus).toBe(200);
    expect(raced.uploadStatus).toBe(409);
    expect(raced.uploadBody).toMatchObject({ error: "mutation_superseded" });
    const snapshot = await api("", { headers: auth(serverToken) });
    await expect(snapshot.json()).resolves.toMatchObject({ state: "cancelled", resultRevision: 1 });
  });

  it("cancels conflicted sessions without extending cleanup on repeated requests", async () => {
    await prepareResult();
    expect((await apply("started")).status).toBe(200);
    expect((await apply("conflicted", 1, "live_files_changed")).status).toBe(200);

    const earliestCleanupAt = Date.now() + TERMINAL_GRACE_MS;
    const cancelled = await api("", {
      method: "DELETE",
      headers: auth(serverToken)
    });
    const cancelledSnapshot = await cancelled.json<{
      state: string;
      failureCode?: string;
    }>();
    expect(cancelled.status).toBe(200);
    expect(cancelledSnapshot).toMatchObject({ state: "cancelled" });
    expect(cancelledSnapshot).not.toHaveProperty("failureCode");

    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    const firstCancellation = await runInDurableObject(stub, async (_instance: EditorSession, state) => ({
      record: await state.storage.get<SessionRecord>("session"),
      alarm: await state.storage.getAlarm()
    }));
    expect(firstCancellation.record?.cleanupAt).toBeGreaterThanOrEqual(earliestCleanupAt);
    expect(firstCancellation.alarm).toBe(firstCancellation.record?.cleanupAt);

    const repeated = await api("", {
      method: "DELETE",
      headers: auth(serverToken)
    });
    await expect(repeated.json()).resolves.toEqual(cancelledSnapshot);

    const repeatedCancellation = await runInDurableObject(stub, async (_instance: EditorSession, state) => ({
      record: await state.storage.get<SessionRecord>("session"),
      alarm: await state.storage.getAlarm()
    }));
    expect(repeatedCancellation.record?.cleanupAt).toBe(firstCancellation.record?.cleanupAt);
    expect(repeatedCancellation.alarm).toBe(firstCancellation.alarm);

    const result = new Uint8Array(80).fill(9);
    const resultSha256 = await digest(result);
    expect((await api("payloads/result/1", payloadRequest(result, browserToken, resultSha256))).status).toBe(410);
  });

  it("keeps a session canceled when it expires before cleanup", async () => {
    await createSession();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);

    const observed = await runInDurableObject(stub, async (instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.state = "cancelled";
      record.expiresAt = Date.now() - 1;
      record.cleanupAt = Date.now() + 60_000;
      await state.storage.put("session", record);
      await instance.alarm();
      return {
        record: await state.storage.get<SessionRecord>("session"),
        alarm: await state.storage.getAlarm()
      };
    });

    expect(observed.record?.state).toBe("cancelled");
    expect(observed.alarm).toBe(observed.record?.cleanupAt);
  });

  it("rejects WebSocket upgrades after cancellation", async () => {
    await createSession();
    expect((await api("", { method: "DELETE", headers: auth(serverToken) })).status).toBe(200);

    const response = await SELF.fetch(
      `https://editor.test/socket/editor/v1/sessions/${sessionId}`,
      {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `kingdomsx-editor-v1, kingdomsx-editor-cap.browser.${browserToken}`
        }
      }
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: "session_closed" });
  });

  it("accepts only one of two competing final save results", async () => {
    await prepareResult();
    expect((await apply("started")).status).toBe(200);

    const [applied, failed] = await Promise.all([
      apply("applied"),
      apply("failed", 1, "replace_failed")
    ]);
    expect([applied.status, failed.status].sort()).toEqual([200, 409]);

    const winningResponse = applied.status === 200 ? applied : failed;
    const winningSnapshot = await winningResponse.json<{ state: string; failureCode?: string }>();
    const current = await api("", { headers: auth(serverToken) });
    await expect(current.json()).resolves.toEqual(winningSnapshot);
  });

  it("checks failure codes and clears them after a successful save", async () => {
    await prepareResult();
    expect((await apply("started")).status).toBe(200);

    const nonString = await apply("failed", 1, 42);
    expect(nonString.status).toBe(400);
    await expect(nonString.json()).resolves.toMatchObject({ error: "invalid_failure_code" });

    const successMetadata = await apply("applied", 1, "should-not-survive");
    expect(successMetadata.status).toBe(400);
    await expect(successMetadata.json()).resolves.toMatchObject({ error: "invalid_failure_code" });

    const tooLong = await apply("failed", 1, "x".repeat(81));
    expect(tooLong.status).toBe(400);

    const unsafe = await apply("failed", 1, "contains space");
    expect(unsafe.status).toBe(400);

    const failed = await apply("failed", 1, "replace_failed");
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toMatchObject({ state: "failed", failureCode: "replace_failed" });

    expect((await apply("started")).status).toBe(200);
    const applied = await apply("applied");
    const appliedSnapshot = await applied.json<{ state: string; failureCode?: string }>();
    expect(appliedSnapshot).toMatchObject({ state: "applied" });
    expect(appliedSnapshot).not.toHaveProperty("failureCode");
  });

  it.each(["get", "put"] as const)("logs unexpected R2 %s failures without exposing session secrets", async (operation) => {
    await createSession();

    if (operation === "get") {
      expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);
    }

    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    const sensitiveMessage = `${sessionId}:${serverToken}:ciphertext-details`;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const failure = await runInDurableObject(stub, async (instance: EditorSession) => {
        const failingOperation = (async (...args: unknown[]) => {
          if (operation === "put" && args[1] instanceof ReadableStream) {
            await new Response(args[1]).arrayBuffer();
          }

          throw new Error(sensitiveMessage);
        });
        const restore = replaceBucket(instance, { [operation]: failingOperation });

        try {
          const response = await instance.fetch(sessionRequest(
            "payloads/original",
            operation === "get"
              ? { headers: auth(browserToken) }
              : payloadRequest(original, serverToken, originalSha256)
          ));

          return {
            status: response.status,
            body: await response.json<{ error: string; message: string }>()
          };
        } finally {
          restore();
        }
      });

      expect(failure.status).toBe(500);
      expect(failure.body).toEqual({
        error: "internal_error",
        message: "The editor session could not process this request."
      });
      const logs = errorLog.mock.calls.flat().map(String).join("\n");
      expect(logs).toContain('"event":"editor_session_unexpected_error"');
      expect(logs).toContain(`"operation":"${operation === "get" ? "download_original" : "upload_original"}"`);
      expect(logs).toContain('"error":"Error"');
      expect(logs).not.toContain(sessionId);
      expect(logs).not.toContain(serverToken);
    } finally {
      errorLog.mockRestore();
    }

    if (operation === "put") {
      expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);
    }
  });

  it("retries cleanup after some R2 files fail", async () => {
    await createSession();
    const stub = env.EDITOR_SESSIONS.getByName(sessionId);
    const keys = [
      `${sessionId}/original.bin`,
      ...Array.from({ length: 1_002 }, (_, index) => `${sessionId}/result-${index + 1}.bin`),
      `${sessionId}/residual-upload.bin`
    ];

    for (let offset = 0; offset < keys.length; offset += 100) {
      await Promise.all(keys.slice(offset, offset + 100).map((key) =>
        env.EDITOR_PAYLOADS.put(key, new Uint8Array([1]))
      ));
    }

    await runInDurableObject(stub, async (_instance: EditorSession, state) => {
      const record = await state.storage.get<SessionRecord>("session");

      if (!record) {
        throw new Error("Expected the test session record.");
      }

      record.state = "expired";
      record.resultRevision = 1_001;
      record.pending = {
        kind: "result",
        operationId: "pending-cleanup-test",
        revision: 1_002,
        bytes: 64,
        sha256: "0".repeat(64)
      };
      record.cleanupAt = Date.now() - 1;
      await state.storage.put("session", record);
    });

    const failedCleanup = await runInDurableObject(stub, async (instance: EditorSession, state) => {
      const runtimeEnv = objectEnv(instance);
      const originalBucket = runtimeEnv.EDITOR_PAYLOADS;
      const deleteBatchSizes: number[] = [];
      let deleteCalls = 0;
      const failingDelete = (async (batch: string | string[]) => {
        deleteBatchSizes.push(typeof batch === "string" ? 1 : batch.length);
        deleteCalls += 1;

        if (deleteCalls === 2) {
          throw new Error("synthetic cleanup failure");
        }

        await originalBucket.delete(batch);
      }) as R2Bucket["delete"];
      const restore = replaceBucket(instance, { delete: failingDelete });

      try {
        await instance.alarm();
      } finally {
        restore();
      }

      return {
        deleteBatchSizes,
        recordRetained: Boolean(await state.storage.get("session")),
        retryAlarm: await state.storage.getAlarm()
      };
    });

    expect(failedCleanup.deleteBatchSizes.every((size) => size <= 1_000)).toBe(true);
    expect(failedCleanup.recordRetained).toBe(true);
    expect(failedCleanup.retryAlarm).not.toBeNull();
    expect((await env.EDITOR_PAYLOADS.list({ prefix: `${sessionId}/` })).objects).toHaveLength(4);

    const retryCleanup = await runInDurableObject(stub, async (instance: EditorSession, state) => {
      await instance.alarm();
      return state.storage.get("session");
    });
    expect((await env.EDITOR_PAYLOADS.list({ prefix: `${sessionId}/` })).objects).toHaveLength(0);
    expect(retryCleanup).toBeUndefined();
    await runInDurableObject(stub, async (instance: EditorSession) => instance.alarm());
  }, 30_000);

  it("requires the browser secret for WebSockets and sends the current session", async () => {
    await createSession();
    const unauthorized = await SELF.fetch(
      `https://editor.test/socket/editor/v1/sessions/${sessionId}`,
      { headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "kingdomsx-editor-v1" } }
    );
    expect(unauthorized.status).toBe(401);

    const response = await SELF.fetch(
      `https://editor.test/socket/editor/v1/sessions/${sessionId}`,
      {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `kingdomsx-editor-v1, kingdomsx-editor-cap.browser.${browserToken}`
        }
      }
    );
    expect(response.status).toBe(101);
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe("kingdomsx-editor-v1");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket?.accept();
    const message = await new Promise<string>((resolve) => {
      socket?.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
    });
    expect(JSON.parse(message)).toMatchObject({ type: "session", protocol: 1 });
    socket?.close();
  });

  it("limits simultaneous browser WebSockets for each session", async () => {
    await createSession();
    const sockets: WebSocket[] = [];

    for (let index = 0; index < MAX_BROWSER_SOCKETS; index += 1) {
      const response = await browserSocket();
      expect(response.status).toBe(101);
      if (response.webSocket) {
        response.webSocket.accept();
        sockets.push(response.webSocket);
      }
    }

    const rejected = await browserSocket();
    expect(rejected.status).toBe(429);
    await expect(rejected.json()).resolves.toMatchObject({ error: "socket_limit_reached" });
    for (const socket of sockets) {
      socket.close();
    }
  });
});

function createSession(overrides: Record<string, unknown> = {}) {
  return api("", {
    method: "PUT",
    body: JSON.stringify(createBody(overrides))
  });
}

async function prepareResult(): Promise<void> {
  await createSession();
  expect((await api("payloads/original", payloadRequest(original, serverToken, originalSha256))).status).toBe(201);
  const result = new Uint8Array(80).fill(9);
  const resultSha256 = await digest(result);
  expect((await api("payloads/result/1", payloadRequest(result, browserToken, resultSha256))).status).toBe(201);
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    protocol: 1,
    name: "server-configs.zip",
    pluginVersion: "1.17.27",
    serverTokenHash,
    browserTokenHash,
    original: { bytes: original.byteLength, sha256: originalSha256 },
    ...overrides
  };
}

function payloadRequest(bytes: Uint8Array, token: string, sha256: string): RequestInit {
  return {
    method: "PUT",
    headers: {
      ...auth(token),
      "Content-Type": "application/octet-stream",
      "X-KingdomsX-Payload-Bytes": String(bytes.byteLength),
      "X-KingdomsX-Payload-Sha256": sha256
    },
    body: bytes
  };
}

function apply(outcome: string, revision = 1, failureCode?: unknown) {
  return api("apply", applyRequest(outcome, revision, failureCode));
}

function applyRequest(outcome: string, revision = 1, failureCode?: unknown): RequestInit {
  return {
    method: "POST",
    headers: auth(serverToken),
    body: JSON.stringify({ revision, outcome, ...(failureCode === undefined ? {} : { failureCode }) })
  };
}

function sessionRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://editor.test/api/editor/v1/sessions/${sessionId}${path ? `/${path}` : ""}`, init);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

function objectEnv(instance: EditorSession): Cloudflare.Env {
  const runtimeEnv = Reflect.get(instance, "env") as Cloudflare.Env | undefined;

  if (!runtimeEnv) {
    throw new Error("Expected the editor session environment.");
  }

  return runtimeEnv;
}

function replaceBucket(instance: EditorSession, methods: Record<PropertyKey, unknown>): () => void {
  const runtimeEnv = objectEnv(instance);
  const original = runtimeEnv.EDITOR_PAYLOADS;

  runtimeEnv.EDITOR_PAYLOADS = new Proxy(original, {
    get(target, property) {
      if (Object.hasOwn(methods, property)) {
        return methods[property];
      }

      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  return () => {
    runtimeEnv.EDITOR_PAYLOADS = original;
  };
}

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://editor.test/api/editor/v1/sessions/${sessionId}${path ? `/${path}` : ""}`, init);
}

function browserSocket() {
  return SELF.fetch(`https://editor.test/socket/editor/v1/sessions/${sessionId}`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `kingdomsx-editor-v1, kingdomsx-editor-cap.browser.${browserToken}`
    }
  });
}

function auth(token: string): Record<string, string> {
  return { Authorization: `KingdomsX-Editor ${token}` };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
