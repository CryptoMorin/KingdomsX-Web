import { DurableObject } from "cloudflare:workers";
import { MINIMUM_KINGDOMSX_WEB_VERSION, supportsKingdomsWebIntegrations } from "../../src/kingdomsx-version";
import {
  CAPABILITY_HASH,
  EDITOR_PROTOCOL,
  MAX_BROWSER_SOCKETS,
  MAX_PAYLOAD_BYTES,
  MAX_RESULT_REVISION,
  MAX_SESSION_DOWNLOAD_BYTES,
  MAX_SESSION_UPLOAD_BYTES,
  PAYLOAD_HASH,
  SESSION_ID,
  SESSION_LIFETIME_MS,
  TERMINAL_GRACE_MS,
  type ApplyRequest,
  type CreateSessionRequest,
  type SessionRecord,
  type SessionState,
  type SessionSnapshot
} from "./contracts";
import { discardRequestBody, json, logUnexpectedError, problem, readJson, RequestProblem } from "./http";

const RECORD_KEY = "session";
const PAYLOAD_CLEANUP_PREFIX = "payload_cleanup:";
const PAYLOAD_CLEANUP_RETRY_KEY = "payload_cleanup_retry";
const API_PREFIX = "/api/editor/v1/sessions/";
const SOCKET_PREFIX = "/socket/editor/v1/sessions/";
const CLEANUP_RETRY_MS = 60_000;
const R2_DELETE_LIMIT = 1_000;
const MIN_ENCRYPTED_PAYLOAD_BYTES = 43;
const PAYLOAD_BYTES_HEADER = "X-KingdomsX-Payload-Bytes";
const PAYLOAD_DIGEST_HEADER = "X-KingdomsX-Payload-Sha256";
const EDITOR_SOCKET_PROTOCOL = "kingdomsx-editor-v1";
const FAILURE_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const RESULT_UPLOAD_STATES: SessionState[] = ["ready", "result_ready", "applied", "validation_rejected", "failed"];

type Role = "server" | "browser";
type PayloadMetadata = { bytes: number; sha256: string };
type BoundedPayload = {
  body: ReadableStream<Uint8Array>;
  completion: Promise<void>;
  error: () => unknown;
  cancel: () => Promise<void>;
};
type UploadReservation =
  | { status: "complete"; record: SessionRecord }
  | { status: "reserved" | "resumed"; operationId: string; record: SessionRecord };

export class EditorSession extends DurableObject<Cloudflare.Env> {
  private mutationQueue: Promise<void> = Promise.resolve();
  private activeUploads = new Set<string>();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    let operation = "route";

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith(SOCKET_PREFIX)) {
        operation = "open_socket";
        return await this.openSocket(request, url);
      }

      if (!url.pathname.startsWith(API_PREFIX)) {
        return problem(404, "not_found", "That editor endpoint does not exist.");
      }

      const parts = url.pathname.slice(API_PREFIX.length).split("/");
      const id = parts.shift() ?? "";

      if (!SESSION_ID.test(id)) {
        return problem(404, "not_found", "That editor session does not exist.");
      }

      if (!parts.length && request.method === "PUT") {
        operation = "create_session";
        return await this.create(request, id);
      }

      let record = await this.load();

      if (!record) {
        return problem(404, "not_found", "That editor session does not exist.");
      }

      if (Date.now() >= record.expiresAt && !["expired", "cancelled"].includes(record.state)) {
        operation = "expire_session";
        await this.expireIfNeeded();
        record = await this.load();

        if (!record) {
          return problem(404, "not_found", "That editor session does not exist.");
        }
      }

      if (!parts.length && request.method === "GET") {
        operation = "get_session";

        if (!await this.authorize(request, record)) {
          return unauthorized();
        }

        return json(this.snapshot(record), record.state === "expired" ? 410 : 200);
      }

      if (!parts.length && request.method === "DELETE") {
        operation = "cancel_session";
        return await this.cancel(request, record);
      }

      if (record.state === "expired") {
        return problem(410, "session_expired", "This editor session has expired.");
      }

      if (record.state === "cancelled" || record.state === "conflicted") {
        return problem(410, "session_closed", "This editor session is no longer available.");
      }

      if (parts.length === 2 && parts[0] === "payloads" && parts[1] === "original") {
        if (request.method === "PUT") {
          operation = "upload_original";
          return await this.uploadOriginal(request, record);
        }

        if (request.method === "GET") {
          operation = "download_original";
          return await this.download(request, record, this.originalKey(record));
        }
      }

      if (parts.length === 3 && parts[0] === "payloads" && parts[1] === "result" && parts[2]) {
        if (!/^[1-9]\d*$/.test(parts[2])) {
          return problem(400, "invalid_revision", "The result revision is invalid.");
        }

        const revision = Number(parts[2]);

        if (!Number.isSafeInteger(revision) || revision < 1) {
          return problem(400, "invalid_revision", "The result revision is invalid.");
        }

        if (request.method === "PUT") {
          operation = "upload_result";
          return await this.uploadResult(request, record, revision);
        }

        if (request.method === "GET") {
          operation = "download_result";
          return await this.downloadResult(request, record, revision);
        }
      }

      if (parts[0] === "apply" && parts.length === 1 && request.method === "POST") {
        operation = "apply_event";
        return await this.applyEvent(request, record);
      }

      return problem(404, "not_found", "That editor endpoint does not exist.");
    } catch (error) {
      await discardRequestBody(request);

      if (error instanceof RequestProblem) {
        return problem(error.status, error.code, error.message);
      }

      logUnexpectedError(operation, error);
      return problem(500, "internal_error", "The editor session could not process this request.");
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.serializeMutation(() => this.retryPayloadCleanup());

      const cleanup = await this.serializeMutation(async () => {
        const record = await this.load();

        if (!record) {
          return null;
        }

        const now = Date.now();

        if (record.cleanupAt && now >= record.cleanupAt) {
          return {
            prefix: this.payloadPrefix(record),
            cleanupAt: record.cleanupAt,
            hasUploads: record.uploadedBytes !== 0 || Boolean(record.pending) || record.resultRevision !== 0
          };
        }

        if (!(record.state === "expired" || record.state === "cancelled") && now >= record.expiresAt) {
          await this.markExpired(record);
          return null;
        }

        await this.scheduleAlarm(record.cleanupAt ?? record.expiresAt);
        return null;
      });

      if (!cleanup) {
        return;
      }

      try {
        if (cleanup.hasUploads) {
          await this.deleteSessionPayloads(cleanup.prefix);
        }
      } catch (error) {
        logUnexpectedError("cleanup_payloads", error);
        await this.scheduleCleanupRetry(cleanup.prefix, cleanup.cleanupAt);
        return;
      }

      await this.serializeMutation(async () => {
        const record = await this.load();

        if (!record || this.payloadPrefix(record) !== cleanup.prefix || record.cleanupAt !== cleanup.cleanupAt) {
          return;
        }

        // Deleting all storage here would also erase pending file cleanup
        await this.ctx.storage.delete(RECORD_KEY);
        await this.scheduleAlarm();
      });
    } catch (error) {
      logUnexpectedError("cleanup_session", error);
      throw error;
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "ping") {
      socket.send("pong");
      return;
    }

    socket.close(1008, "Editor sockets accept only ping messages");
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "Connection error");
  }

  private async create(request: Request, id: string): Promise<Response> {
    const input = await readJson<CreateSessionRequest>(request);

    validateCreateSession(input);

    const comparable = {
      protocol: input.protocol,
      name: input.name,
      pluginVersion: input.pluginVersion,
      serverTokenHash: input.serverTokenHash,
      browserTokenHash: input.browserTokenHash,
      originalBytes: input.original.bytes,
      originalSha256: input.original.sha256
    };

    return this.serializeMutation(async () => {
      const existing = await this.load();

      if (existing) {
        const matches = Object.entries(comparable).every(([key, value]) =>
          existing[key as keyof SessionRecord] === value
        );

        return matches
          ? json(this.snapshot(existing))
          : problem(409, "session_exists", "That session identifier is already in use.");
      }

      // Existing records are retries but recreating a cleaned session needs admission
      const admission = await this.env.EDITOR_ADMISSION.getByName("global").admit();

      if (!admission.allowed) {
        const response = problem(429, "rate_limited", "The editor has reached its new session limit. Try again later.");
        response.headers.set("Retry-After", String(admission.retryAfter));

        return response;
      }

      const createdAt = Date.now();
      const record: SessionRecord = {
        ...comparable,
        protocol: EDITOR_PROTOCOL,
        id,
        createdAt,
        expiresAt: createdAt + SESSION_LIFETIME_MS,
        sequence: 1,
        state: "awaiting_original",
        resultRevision: 0,
        uploadedBytes: 0,
        downloadedBytes: 0,
        // Keep new files outside folders that older session cleanup can delete
        payloadPrefix: `sessions/${id}/${crypto.randomUUID()}/`
      };

      await this.save(record);
      await this.scheduleAlarm(record.expiresAt);

      return json(this.snapshot(record), 201);
    });
  }

  private async uploadOriginal(request: Request, record: SessionRecord): Promise<Response> {
    if (!await this.authorize(request, record, "server")) {
      return unauthorized();
    }

    const payload = validatePayloadRequest(request);

    if (payload.bytes !== record.originalBytes || payload.sha256 !== record.originalSha256) {
      return problem(422, "payload_mismatch", "The original encrypted file does not match this editor session.");
    }

    const reservation = await this.reserveOriginal(record, payload);

    if (reservation.status === "complete") {
      return await this.payloadExists(this.originalKey(reservation.record), payload)
        ? json(this.snapshot(reservation.record))
        : problem(503, "payload_unavailable", "The encrypted file is not available yet.");
    }

    try {
      const key = this.originalKey(reservation.record);

      if (reservation.status === "resumed" && await this.payloadExists(key, payload)) {
        await consumeRequestBody(request);
      } else {
        try {
          await this.putPayload(key, request, payload);
        } catch (error) {
          await this.clearReservation(reservation.operationId);
          throw error;
        }
      }

      let finalized: SessionRecord;

      try {
        finalized = await this.finalizeOriginal(reservation.record, reservation.operationId, payload);
      } catch (error) {
        await this.cleanupRejectedPayload(reservation.record, key);
        throw error;
      }

      return json(this.snapshot(finalized), 201);
    } finally {
      this.activeUploads.delete(reservation.operationId);
    }
  }

  private async uploadResult(request: Request, record: SessionRecord, revision: number): Promise<Response> {
    if (!await this.authorize(request, record, "browser")) {
      return unauthorized();
    }

    const payload = validatePayloadRequest(request);
    const reservation = await this.reserveResult(record, revision, payload);

    if (reservation.status === "complete") {
      return await this.payloadExists(this.resultKey(reservation.record, revision), payload)
        ? json(this.snapshot(reservation.record))
        : problem(503, "payload_unavailable", "The encrypted file is not available yet.");
    }

    try {
      const key = this.resultKey(reservation.record, revision);

      if (reservation.status === "resumed" && await this.payloadExists(key, payload)) {
        await consumeRequestBody(request);
      } else {
        try {
          await this.putPayload(key, request, payload);
        } catch (error) {
          await this.clearReservation(reservation.operationId);
          throw error;
        }
      }

      let finalized: SessionRecord;

      try {
        finalized = await this.finalizeResult(reservation.record, reservation.operationId, revision, payload);
      } catch (error) {
        await this.cleanupRejectedPayload(reservation.record, key);
        throw error;
      }

      if (revision > 1) {
        this.ctx.waitUntil(
          this.env.EDITOR_PAYLOADS.delete(this.resultKey(finalized, revision - 1))
            .catch((error) => logUnexpectedError("delete_previous_result", error))
        );
      }

      return json(this.snapshot(finalized), 201);
    } finally {
      this.activeUploads.delete(reservation.operationId);
    }
  }

  private async applyEvent(request: Request, record: SessionRecord): Promise<Response> {
    if (!await this.authorize(request, record, "server")) {
      return unauthorized();
    }

    const input = validateApplyRequest(await readJson<unknown>(request));

    return this.serializeMutation(async () => {
      const current = await this.requireRecord();
      this.requireSameSession(current, record);

      if (!Number.isSafeInteger(input.revision) || input.revision !== current.resultRevision) {
        return problem(409, "invalid_revision", "The apply event does not match the current result revision.");
      }

      if (current.pending) {
        return problem(409, "invalid_state", "The encrypted file must finish uploading before this result can be applied.");
      }

      if (input.outcome === "started") {
        if (!["result_ready", "failed"].includes(current.state)) {
          return problem(409, "invalid_state", "This result is not ready to apply.");
        }

        current.state = "applying";
        current.failureCode = undefined;
      } else {
        if (current.state !== "applying") {
          return problem(409, "invalid_state", "No result is currently being applied.");
        }

        current.state = input.outcome;
        current.failureCode = input.failureCode;
      }

      current.sequence += 1;

      await this.saveAndBroadcast(current);

      return json(this.snapshot(current));
    });
  }

  private async cancel(request: Request, record: SessionRecord): Promise<Response> {
    if (!await this.authorize(request, record, "server")) {
      return unauthorized();
    }

    return this.serializeMutation(async () => {
      const current = await this.requireRecord();
      this.requireSameSession(current, record);

      if (current.state === "cancelled" || current.state === "expired") {
        return json(this.snapshot(current));
      }

      current.pending = undefined;
      current.failureCode = undefined;
      current.state = "cancelled";
      current.sequence += 1;
      current.cleanupAt = Date.now() + TERMINAL_GRACE_MS;

      await this.saveAndBroadcast(current);
      await this.scheduleAlarm(current.cleanupAt);
      this.closeSockets(1000, "Session cancelled");

      return json(this.snapshot(current));
    });
  }

  private async download(request: Request, record: SessionRecord, key: string): Promise<Response> {
    if (!await this.authorize(request, record)) {
      return unauthorized();
    }

    const object = await this.env.EDITOR_PAYLOADS.get(key);

    if (!object) {
      return problem(503, "payload_unavailable", "The encrypted file is not available yet.");
    }

    try {
      await this.reserveDownload(record, object.size);
    } catch (error) {
      try {
        await object.body.cancel();
      } catch {}

      throw error;
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        [PAYLOAD_DIGEST_HEADER]: object.customMetadata?.sha256 ?? "",
        "Cache-Control": "no-store"
      }
    });
  }

  private async downloadResult(request: Request, record: SessionRecord, revision: number): Promise<Response> {
    if (revision !== record.resultRevision || !record.resultRevision) {
      return problem(404, "result_not_found", "That result revision is not available.");
    }

    return this.download(request, record, this.resultKey(record, revision));
  }

  private async openSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLocaleLowerCase("en-US") !== "websocket") {
      return problem(426, "upgrade_required", "This endpoint requires a WebSocket connection.");
    }

    const id = url.pathname.slice(SOCKET_PREFIX.length);
    const preliminary = await this.load();

    if (!preliminary || preliminary.id !== id) {
      return problem(404, "not_found", "That editor session does not exist.");
    }

    const roleAndToken = socketCapability(request.headers.get("Sec-WebSocket-Protocol"));

    if (!roleAndToken || !await this.tokenMatches(roleAndToken.token, preliminary, roleAndToken.role)) {
      return unauthorized();
    }

    return this.serializeMutation(async () => {
      let record = await this.load();

      if (!record || record.id !== id) {
        return problem(404, "not_found", "That editor session does not exist.");
      }

      this.requireSameSession(record, preliminary);

      if (Date.now() >= record.expiresAt && !["expired", "cancelled"].includes(record.state)) {
        await this.markExpired(record);
        record = await this.requireRecord();
      }

      if (record.state === "expired") {
        return problem(410, "session_expired", "This editor session has expired.");
      }

      if (record.state === "cancelled" || record.state === "conflicted") {
        return problem(410, "session_closed", "This editor session is no longer available.");
      }

      if (roleAndToken.role === "browser") {
        const browserSockets = this.ctx.getWebSockets("browser").filter((socket) => socket.readyState !== WebSocket.CLOSED);

        if (browserSockets.length >= MAX_BROWSER_SOCKETS) {
          return problem(429, "socket_limit_reached", "Too many editor browser connections are open for this session.");
        }
      } else {
        for (const socket of this.ctx.getWebSockets("server")) {
          socket.close(1000, "Replaced by a newer server connection");
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server, [roleAndToken.role]);
      server.send(JSON.stringify(this.snapshot(record)));

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          "Sec-WebSocket-Protocol": EDITOR_SOCKET_PROTOCOL,
          "Cache-Control": "no-store"
        }
      });
    });
  }

  private async authorize(request: Request, record: SessionRecord, requiredRole?: Role): Promise<boolean> {
    const match = /^KingdomsX-Editor ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("Authorization") ?? "");

    if (!match) {
      return false;
    }

    if (requiredRole) {
      return this.tokenMatches(match[1], record, requiredRole);
    }

    return await this.tokenMatches(match[1], record, "server")
      || this.tokenMatches(match[1], record, "browser");
  }

  private async tokenMatches(token: string, record: SessionRecord, role: Role): Promise<boolean> {
    const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
    const expected = hexBytes(role === "server" ? record.serverTokenHash : record.browserTokenHash);

    return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
  }

  private async putPayload(
    key: string,
    request: Request,
    payload: { bytes: number; sha256: string }
  ): Promise<void> {
    if (!request.body) {
      throw new RequestProblem(400, "missing_payload", "The encrypted file is missing.");
    }

    const bounded = boundedPayload(request.body, payload.bytes);

    try {
      const object = await this.env.EDITOR_PAYLOADS.put(key, bounded.body, {
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: payload.sha256,
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { sha256: payload.sha256 }
      });
      await bounded.completion;

      if (bounded.error()) {
        throw bounded.error();
      }

      if (!object) {
        if (await this.payloadExists(key, payload)) {
          return;
        }

        throw new RequestProblem(409, "payload_exists", "A different encrypted file already exists for this save.");
      }

      if (object.size !== payload.bytes) {
        await this.env.EDITOR_PAYLOADS.delete(key);
        throw new RequestProblem(422, "payload_length_mismatch", "The uploaded file size does not match what the server expected.");
      }
    } catch (error) {
      await bounded.cancel();
      await bounded.completion;

      const streamError = bounded.error();

      // R2 puts BadDigest code 10037 in the error message
      if (
        streamError instanceof PayloadLengthError
        || error instanceof PayloadLengthError
        || error instanceof Error && error.message === "The encrypted file size does not match its metadata."
      ) {
        throw new RequestProblem(422, "payload_length_mismatch", "The encrypted file size does not match its metadata.");
      }

      if (error instanceof Error && /\(10037\)$/.test(error.message)) {
        throw new RequestProblem(422, "payload_integrity_failed", "The encrypted upload is incomplete or corrupted.");
      }

      throw error;
    }
  }

  private async payloadExists(key: string, payload: { bytes: number; sha256: string }): Promise<boolean> {
    const object = await this.env.EDITOR_PAYLOADS.head(key);

    return object?.size === payload.bytes && object.customMetadata?.sha256 === payload.sha256;
  }

  private async expireIfNeeded(): Promise<void> {
    await this.serializeMutation(async () => {
      const record = await this.load();

      if (!record || record.state === "expired" || record.state === "cancelled" || Date.now() < record.expiresAt) {
        return;
      }

      await this.markExpired(record);
    });
  }

  private async markExpired(record: SessionRecord): Promise<void> {
    record.pending = undefined;
    record.state = "expired";
    record.sequence += 1;
    record.cleanupAt = Date.now() + TERMINAL_GRACE_MS;

    await this.saveAndBroadcast(record);
    await this.scheduleAlarm(record.cleanupAt);
    this.closeSockets(1000, "Session expired");
  }

  private async reserveOriginal(expected: SessionRecord, payload: PayloadMetadata): Promise<UploadReservation> {
    return this.serializeMutation(async () => {
      const record = await this.requireRecord();
      this.requireSameSession(record, expected);

      if (record.state === "ready") {
        return { status: "complete", record };
      }

      if (record.state !== "awaiting_original") {
        throw new RequestProblem(409, "invalid_state", "The original file cannot be uploaded at this point in the editor session.");
      }

      if (record.pending) {
        if (pendingMatches(record.pending, "original", 0, payload)) {
          const operationId = record.pending.operationId;

          if (this.activeUploads.has(operationId)) {
            throw new RequestProblem(409, "upload_in_progress", "That file is already uploading.");
          }

          this.activeUploads.add(operationId);

          return { status: "resumed", operationId, record };
        }

        throw new RequestProblem(409, "invalid_state", "Another file is already uploading.");
      }

      if (uploadedBytes(record) + payload.bytes > MAX_SESSION_UPLOAD_BYTES) {
        throw new RequestProblem(413, "upload_limit_reached", "This editor session has reached its encrypted upload limit.");
      }

      const operationId = crypto.randomUUID();

      record.uploadedBytes = uploadedBytes(record) + payload.bytes;
      record.pending = { kind: "original", operationId, revision: 0, ...payload };

      await this.save(record);
      this.activeUploads.add(operationId);

      return { status: "reserved", operationId, record };
    });
  }

  private async finalizeOriginal(expected: SessionRecord, operationId: string, payload: PayloadMetadata): Promise<SessionRecord> {
    return this.serializeMutation(async () => {
      const record = await this.requireRecord();
      this.requireSameSession(record, expected);

      if (record.state === "ready") {
        return record;
      }

      if (record.state !== "awaiting_original" || !pendingMatches(record.pending, "original", 0, payload, operationId)) {
        throw new RequestProblem(409, "mutation_superseded", "A newer upload replaced this one. Try saving again.");
      }

      record.pending = undefined;
      record.state = "ready";
      record.sequence += 1;

      await this.saveAndBroadcast(record);

      return record;
    });
  }

  private async reserveResult(expected: SessionRecord, revision: number, payload: PayloadMetadata): Promise<UploadReservation> {
    return this.serializeMutation(async () => {
      const record = await this.requireRecord();
      this.requireSameSession(record, expected);

      if (!RESULT_UPLOAD_STATES.includes(record.state)) {
        throw new RequestProblem(409, "invalid_state", "A result cannot be uploaded in this session state.");
      }

      if (
        revision === record.resultRevision
        && record.resultBytes === payload.bytes
        && record.resultSha256 === payload.sha256
      ) {
        return { status: "complete", record };
      }

      const expectedRevision = record.resultRevision + 1;

      if (revision !== expectedRevision) {
        throw new RequestProblem(409, "invalid_revision", `The next result revision must be ${expectedRevision}.`);
      }

      if (revision > MAX_RESULT_REVISION) {
        throw new RequestProblem(413, "result_limit_reached", "This editor session has reached its save limit. Create a new editor link to continue.");
      }

      if (record.pending) {
        if (pendingMatches(record.pending, "result", revision, payload)) {
          const operationId = record.pending.operationId;

          if (this.activeUploads.has(operationId)) {
            throw new RequestProblem(409, "upload_in_progress", "That file is already uploading.");
          }

          this.activeUploads.add(operationId);

          return { status: "resumed", operationId, record };
        }

        throw new RequestProblem(409, "invalid_state", "Another file is already uploading.");
      }

      if (uploadedBytes(record) + payload.bytes > MAX_SESSION_UPLOAD_BYTES) {
        throw new RequestProblem(413, "upload_limit_reached", "This editor session has reached its encrypted upload limit.");
      }

      const operationId = crypto.randomUUID();

      record.uploadedBytes = uploadedBytes(record) + payload.bytes;
      record.pending = { kind: "result", operationId, revision, ...payload };

      await this.save(record);
      this.activeUploads.add(operationId);

      return { status: "reserved", operationId, record };
    });
  }

  private async finalizeResult(
    expected: SessionRecord,
    operationId: string,
    revision: number,
    payload: PayloadMetadata
  ): Promise<SessionRecord> {
    return this.serializeMutation(async () => {
      const record = await this.requireRecord();
      this.requireSameSession(record, expected);

      if (
        record.resultRevision === revision
        && record.resultBytes === payload.bytes
        && record.resultSha256 === payload.sha256
      ) {
        return record;
      }

      if (
        !RESULT_UPLOAD_STATES.includes(record.state)
        || record.resultRevision + 1 !== revision
        || !pendingMatches(record.pending, "result", revision, payload, operationId)
      ) {
        throw new RequestProblem(409, "mutation_superseded", "A newer session change replaced this result upload. Try saving again.");
      }

      record.pending = undefined;
      record.resultRevision = revision;
      record.resultBytes = payload.bytes;
      record.resultSha256 = payload.sha256;
      record.failureCode = undefined;
      record.state = "result_ready";
      record.sequence += 1;

      await this.saveAndBroadcast(record);

      return record;
    });
  }

  private async clearReservation(operationId: string): Promise<void> {
    await this.serializeMutation(async () => {
      const record = await this.load();

      if (!record || record.pending?.operationId !== operationId) {
        return;
      }

      record.pending = undefined;

      await this.save(record);
    });
  }

  private async reserveDownload(expected: SessionRecord, bytes: number): Promise<void> {
    await this.serializeMutation(async () => {
      const record = await this.requireRecord();
      this.requireSameSession(record, expected);

      if (["cancelled", "expired", "conflicted"].includes(record.state)) {
        throw new RequestProblem(410, "session_closed", "This editor session is no longer available.");
      }

      const used = downloadedBytes(record);

      if (used + bytes > MAX_SESSION_DOWNLOAD_BYTES) {
        throw new RequestProblem(429, "download_limit_reached", "This editor session has reached its encrypted download limit.");
      }

      record.downloadedBytes = used + bytes;

      await this.save(record);
    });
  }

  private async deleteSessionPayloads(prefix: string): Promise<void> {
    while (true) {
      const objects = await this.env.EDITOR_PAYLOADS.list({ prefix, limit: R2_DELETE_LIMIT });

      if (!objects.objects.length) {
        return;
      }

      await this.env.EDITOR_PAYLOADS.delete(objects.objects.map((object) => object.key));

      if (!objects.truncated) {
        return;
      }
    }
  }

  private async scheduleCleanupRetry(prefix: string, cleanupAt: number): Promise<void> {
    await this.serializeMutation(async () => {
      const record = await this.load();

      if (!record || this.payloadPrefix(record) !== prefix || record.cleanupAt !== cleanupAt) {
        return;
      }

      await this.scheduleAlarm(Date.now() + CLEANUP_RETRY_MS);
    });
  }

  private async cleanupRejectedPayload(expected: SessionRecord, key: string): Promise<void> {
    await this.serializeMutation(async () => {
      const current = await this.load();

      // A failed save can still be retried using the uploaded file
      if (current && this.payloadPrefix(current) === this.payloadPrefix(expected)
        && current.state !== "cancelled" && current.state !== "expired") {
        return;
      }

      const cleanupKey = `${PAYLOAD_CLEANUP_PREFIX}${key}`;

      // Save the retry before deleting the file in case the Worker stops
      await this.ctx.storage.transaction(async (storage) => {
        const retryAt = await storage.get<number>(PAYLOAD_CLEANUP_RETRY_KEY) ?? Date.now() + CLEANUP_RETRY_MS;

        await storage.put<string | number>({ [cleanupKey]: key, [PAYLOAD_CLEANUP_RETRY_KEY]: retryAt });
        await storage.setAlarm(Math.min(current?.cleanupAt ?? current?.expiresAt ?? Infinity, retryAt));
      });

      try {
        await this.env.EDITOR_PAYLOADS.delete(key);
        await this.ctx.storage.delete(cleanupKey);
      } catch (error) {
        logUnexpectedError("cleanup_rejected_payload", error);
      }

      const pending = await this.ctx.storage.list({ prefix: PAYLOAD_CLEANUP_PREFIX, limit: 1 });

      if (!pending.size) {
        await this.ctx.storage.delete(PAYLOAD_CLEANUP_RETRY_KEY);
      }

      await this.scheduleAlarm(current?.cleanupAt ?? current?.expiresAt);
    });
  }

  private async retryPayloadCleanup(): Promise<void> {
    const pending = await this.ctx.storage.list<string>({ prefix: PAYLOAD_CLEANUP_PREFIX, limit: R2_DELETE_LIMIT });

    if (!pending.size) {
      await this.ctx.storage.delete(PAYLOAD_CLEANUP_RETRY_KEY);
      return;
    }

    const current = await this.load();
    const retryAt = Date.now() + CLEANUP_RETRY_MS;

    await this.ctx.storage.transaction(async (storage) => {
      await storage.put(PAYLOAD_CLEANUP_RETRY_KEY, retryAt);
      await storage.setAlarm(Math.min(current?.cleanupAt ?? current?.expiresAt ?? Infinity, retryAt));
    });

    for (const [cleanupKey, key] of pending) {
      try {
        await this.env.EDITOR_PAYLOADS.delete(key);
        await this.ctx.storage.delete(cleanupKey);
      } catch (error) {
        logUnexpectedError("retry_payload_cleanup", error);
      }
    }

    const remaining = await this.ctx.storage.list({ prefix: PAYLOAD_CLEANUP_PREFIX, limit: 1 });

    if (!remaining.size) {
      await this.ctx.storage.delete(PAYLOAD_CLEANUP_RETRY_KEY);
    }

    await this.scheduleAlarm(current?.cleanupAt ?? current?.expiresAt);
  }

  private async scheduleAlarm(sessionAt?: number): Promise<void> {
    const retryAt = await this.ctx.storage.get<number>(PAYLOAD_CLEANUP_RETRY_KEY);
    const next = Math.min(sessionAt ?? Infinity, retryAt ?? Infinity);

    if (Number.isFinite(next)) {
      await this.ctx.storage.setAlarm(next);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private requireSameSession(current: SessionRecord, expected: SessionRecord): void {
    if (this.payloadPrefix(current) !== this.payloadPrefix(expected)) {
      throw new RequestProblem(409, "mutation_superseded", "A newer session change replaced this request.");
    }
  }

  private async requireRecord(): Promise<SessionRecord> {
    const record = await this.load();

    if (!record) {
      throw new RequestProblem(404, "not_found", "That editor session does not exist.");
    }

    return record;
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);

    return result;
  }

  private async load(): Promise<SessionRecord | undefined> {
    return this.ctx.storage.get<SessionRecord>(RECORD_KEY);
  }

  private async save(record: SessionRecord): Promise<void> {
    await this.ctx.storage.put(RECORD_KEY, record);
  }

  private async saveAndBroadcast(record: SessionRecord): Promise<void> {
    await this.save(record);

    const message = JSON.stringify(this.snapshot(record));

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Connection error");
      }
    }
  }

  private closeSockets(code: number, reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(code, reason);
    }
  }

  private snapshot(record: SessionRecord): SessionSnapshot {
    return {
      type: "session",
      protocol: EDITOR_PROTOCOL,
      sequence: record.sequence,
      state: record.state,
      resultRevision: record.resultRevision,
      expiresAt: record.expiresAt,
      ...(record.failureCode ? { failureCode: record.failureCode } : {})
    };
  }

  private originalKey(record: SessionRecord): string {
    return `${this.payloadPrefix(record)}original.bin`;
  }

  private resultKey(record: SessionRecord, revision: number): string {
    return `${this.payloadPrefix(record)}result-${revision}.bin`;
  }

  private payloadPrefix(record: SessionRecord): string {
    return record.payloadPrefix ?? `${record.id}/`;
  }
}

async function consumeRequestBody(request: Request): Promise<void> {
  if (!request.body || request.body.locked) {
    return;
  }

  await request.body.pipeTo(new WritableStream());
}

export function validateCreateSession(input: CreateSessionRequest): void {
  const valid = input
    && input.protocol === EDITOR_PROTOCOL
    && typeof input.name === "string"
    && input.name.length > 0
    && input.name.length <= 120
    && typeof input.pluginVersion === "string"
    && input.pluginVersion.length > 0
    && input.pluginVersion.length <= 40
    && CAPABILITY_HASH.test(input.serverTokenHash)
    && CAPABILITY_HASH.test(input.browserTokenHash)
    && input.serverTokenHash !== input.browserTokenHash
    && Number.isSafeInteger(input.original?.bytes)
    && input.original.bytes > MIN_ENCRYPTED_PAYLOAD_BYTES
    && input.original.bytes <= MAX_PAYLOAD_BYTES
    && PAYLOAD_HASH.test(input.original.sha256);

  if (!valid) {
    throw new RequestProblem(400, "invalid_session", "The editor session metadata is invalid.");
  }

  if (!supportsKingdomsWebIntegrations(input.pluginVersion)) {
    throw new RequestProblem(400, "invalid_session", `The config editor requires KingdomsX ${MINIMUM_KINGDOMSX_WEB_VERSION} or newer. Update KingdomsX and start a new editor session.`);
  }
}

function validatePayloadRequest(request: Request): { bytes: number; sha256: string } {
  if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/octet-stream") {
    throw new RequestProblem(415, "unsupported_media_type", "Editor uploads must use application/octet-stream.");
  }

  const rawLength = request.headers.get(PAYLOAD_BYTES_HEADER);

  if (!rawLength) {
    throw new RequestProblem(411, "length_required", `Editor uploads require ${PAYLOAD_BYTES_HEADER}.`);
  }

  const bytes = Number(rawLength);

  if (!Number.isSafeInteger(bytes) || bytes <= MIN_ENCRYPTED_PAYLOAD_BYTES) {
    throw new RequestProblem(400, "invalid_length", "The upload size is invalid.");
  }

  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new RequestProblem(413, "payload_too_large", "The encrypted file is too large.");
  }

  const contentLength = request.headers.get("Content-Length");

  if (contentLength && Number(contentLength) !== bytes) {
    throw new RequestProblem(400, "length_mismatch", "The upload size headers do not match.");
  }

  const sha256 = request.headers.get(PAYLOAD_DIGEST_HEADER)?.toLocaleLowerCase("en-US") ?? "";

  if (!PAYLOAD_HASH.test(sha256)) {
    throw new RequestProblem(400, "invalid_digest", "The upload SHA-256 hash is invalid.");
  }

  return { bytes, sha256 };
}

class PayloadLengthError extends Error {
  constructor() {
    super("The encrypted file size does not match its metadata.");
    this.name = "PayloadLengthError";
  }
}

export function boundedPayload(body: ReadableStream<Uint8Array>, expectedBytes: number): BoundedPayload {
  const fixed = new FixedLengthStream(expectedBytes);
  const reader = body.getReader();
  const writer = fixed.writable.getWriter();
  let streamError: unknown = null;
  const completion = (async () => {
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        totalBytes += value.byteLength;

        if (totalBytes > expectedBytes) {
          throw new PayloadLengthError();
        }

        await writer.write(value);
      }

      if (totalBytes !== expectedBytes) {
        throw new PayloadLengthError();
      }

      await writer.close();
    } catch (error) {
      streamError = error;
      try {
        await reader.cancel(error);
      } catch {}

      try {
        await writer.abort(error);
      } catch {}
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  })();

  return {
    body: fixed.readable,
    completion,
    error: () => streamError,
    async cancel() {
      try {
        await fixed.readable.cancel();
      } catch {}
    }
  };
}

function socketCapability(header: string | null): { role: Role; token: string } | null {
  const protocols = (header ?? "").split(",").map((value) => value.trim());

  if (!protocols.includes(EDITOR_SOCKET_PROTOCOL)) {
    return null;
  }

  for (const protocol of protocols) {
    const match = /^kingdomsx-editor-cap\.(server|browser)\.([A-Za-z0-9_-]{43})$/.exec(protocol);

    if (match) {
      return { role: match[1] as Role, token: match[2] };
    }
  }

  return null;
}

function isApplyOutcome(value: unknown): value is ApplyRequest["outcome"] {
  return value === "started"
    || value === "applied"
    || value === "validation_rejected"
    || value === "conflicted"
    || value === "failed";
}

function validateApplyRequest(value: unknown): ApplyRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestProblem(400, "invalid_outcome", "The apply outcome is invalid.");
  }

  const input = value as Record<string, unknown>;

  if (!isApplyOutcome(input.outcome)) {
    throw new RequestProblem(400, "invalid_outcome", "The apply outcome is invalid.");
  }

  if (
    input.failureCode !== undefined
    && (typeof input.failureCode !== "string" || !FAILURE_CODE.test(input.failureCode))
  ) {
    throw new RequestProblem(400, "invalid_failure_code", "The apply failure code is invalid.");
  }

  if (input.failureCode !== undefined && ["started", "applied"].includes(input.outcome)) {
    throw new RequestProblem(400, "invalid_failure_code", "This apply outcome cannot include a failure code.");
  }

  return {
    revision: input.revision as number,
    outcome: input.outcome,
    ...(typeof input.failureCode === "string" ? { failureCode: input.failureCode } : {})
  };
}

function pendingMatches(
  pending: SessionRecord["pending"],
  kind: "original" | "result",
  revision: number,
  payload: PayloadMetadata,
  operationId?: string
): boolean {
  return pending?.kind === kind
    && pending.revision === revision
    && pending.bytes === payload.bytes
    && pending.sha256 === payload.sha256
    && (operationId === undefined || pending.operationId === operationId);
}

function uploadedBytes(record: SessionRecord): number {
  return Number.isSafeInteger(record.uploadedBytes) && record.uploadedBytes >= 0
    ? record.uploadedBytes
    : 0;
}

function downloadedBytes(record: SessionRecord): number {
  return Number.isSafeInteger(record.downloadedBytes) && record.downloadedBytes >= 0
    ? record.downloadedBytes
    : 0;
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}

function unauthorized(): Response {
  return problem(401, "unauthorized", "The editor session secret is missing or invalid.");
}
