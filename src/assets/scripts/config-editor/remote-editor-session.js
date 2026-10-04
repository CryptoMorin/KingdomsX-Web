import {
  decryptRemotePayload,
  encryptRemotePayload,
  REMOTE_PAYLOAD_KIND,
  sha256Hex
} from "./remote-session-crypto.js";

const SOCKET_WATCHDOG_MS = 30_000;
const POLL_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const BACKOFF_JITTER = 0.2;
const REQUEST_TIMEOUT_MS = 30_000;
const PAYLOAD_REQUEST_TIMEOUT_MS = 120_000;
const SOCKET_OPEN = 1;
const NON_RECONNECTING_STATES = new Set(["conflicted", "cancelled", "expired"]);
const UPLOADABLE_STATES = new Set(["ready", "result_ready", "applied", "validation_rejected", "failed"]);

export class RemoteEditorSession {
  constructor(link, {
    origin = window.location.origin,
    fetcher = window.fetch.bind(window),
    WebSocketClass = window.WebSocket,
    onSnapshot = () => {},
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    payloadRequestTimeoutMs = PAYLOAD_REQUEST_TIMEOUT_MS,
    AbortControllerClass = globalThis.AbortController
  } = {}) {
    this.link = link;
    this.origin = origin;
    this.fetcher = fetcher;
    this.WebSocketClass = WebSocketClass;
    this.onSnapshot = onSnapshot;
    this.snapshot = null;
    this.socket = null;
    this.closed = false;
    this.waiters = new Set();
    this.reconnectAttempt = 0;
    this.reconnectTimer = 0;
    this.pendingNotificationSequence = 0;
    this.notificationRefresh = null;
    this.requestTimeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : REQUEST_TIMEOUT_MS;
    this.payloadRequestTimeoutMs = Number.isFinite(payloadRequestTimeoutMs) && payloadRequestTimeoutMs > 0
      ? payloadRequestTimeoutMs
      : PAYLOAD_REQUEST_TIMEOUT_MS;
    this.AbortControllerClass = AbortControllerClass;
    this.activeRequests = new Set();
    this.baseRevision = null;
  }

  async open() {
    const snapshot = await this.getStatus();

    if (!["ready", "result_ready", "applying", "applied", "validation_rejected", "failed"].includes(snapshot.state)) {
      throw new Error(snapshot.state === "awaiting_original"
        ? "The server has not finished uploading these configs yet."
        : "This editor session is no longer available.");
    }

    this.connect();

    const revision = snapshot.resultRevision;
    const originalResponse = await this.request("payloads/original", {}, this.payloadRequestTimeoutMs);
    const encryptedOriginal = new Uint8Array(await originalResponse.arrayBuffer());
    const originalBytes = await decryptRemotePayload(encryptedOriginal, {
      sessionId: this.link.id,
      key: this.link.key,
      kind: REMOTE_PAYLOAD_KIND.original,
      revision: 0
    });
    let bytes = originalBytes;

    if (revision) {
      const resultResponse = await this.request(`payloads/result/${revision}`, {}, this.payloadRequestTimeoutMs);
      const encryptedResult = new Uint8Array(await resultResponse.arrayBuffer());
      bytes = await decryptRemotePayload(encryptedResult, {
        sessionId: this.link.id,
        key: this.link.key,
        kind: REMOTE_PAYLOAD_KIND.result,
        revision
      });
    }

    this.baseRevision = revision;

    return {
      name: "kingdomsx-server-configs.zip",
      bytes,
      originalBytes,
      remoteProtocol: this.link.protocol,
      remoteRevision: revision
    };
  }

  async save(bytes, baseRevision = this.baseRevision) {
    validateRevision(baseRevision, "A remote base revision is required before saving.");

    const status = await this.getStatus();

    if (status.state === "applying") {
      throw new Error("The server is still applying the previous upload.");
    }

    if (status.resultRevision !== baseRevision) {
      throw new Error("The server revision changed while this editor was open. Reload the editor before saving.");
    }

    if (!UPLOADABLE_STATES.has(status.state)) {
      throw new Error("This editor session is not ready to accept a config save.");
    }

    const revision = baseRevision + 1;
    validateRevision(revision, "The next remote result revision is invalid.");

    const encrypted = await encryptRemotePayload(bytes, {
      sessionId: this.link.id,
      key: this.link.key,
      kind: REMOTE_PAYLOAD_KIND.result,
      revision
    });
    const digest = await sha256Hex(encrypted);

    const response = await this.request(`payloads/result/${revision}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-KingdomsX-Payload-Bytes": String(encrypted.byteLength),
        "X-KingdomsX-Payload-Sha256": digest
      },
      body: encrypted
    }, this.payloadRequestTimeoutMs);

    const responseSnapshot = await response.json();
    this.receive(responseSnapshot);

    if (responseSnapshot?.resultRevision === revision) {
      this.baseRevision = revision;
    }

    await this.waitForApply(revision);

    return revision;
  }

  close() {
    this.closed = true;
    globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    this.socket?.close(1000, "Editor closed");
    this.socket = null;

    for (const request of this.activeRequests) {
      request.controller.abort();
    }

    for (const waiter of this.waiters) {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(new Error("The remote editor session was closed."));
    }

    this.waiters.clear();
  }

  async getStatus() {
    const response = await this.request("");
    const snapshot = await response.json();
    this.receive(snapshot);
    return snapshot;
  }

  connect() {
    if (this.closed || !this.WebSocketClass || this.socket || !this.canReconnect()) {
      return;
    }

    const url = new URL(`/socket/editor/v1/sessions/${this.link.id}`, this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let socket;

    try {
      socket = new this.WebSocketClass(url, [
        "kingdomsx-editor-v1",
        `kingdomsx-editor-cap.browser.${this.link.browserToken}`
      ]);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
      this.rescheduleWaiters();
    });
    socket.addEventListener("message", (event) => {
      try {
        this.receiveNotification(JSON.parse(event.data));
      } catch {}
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.rescheduleWaiters(true);
      this.scheduleReconnect();
    });
  }

  async waitForApply(revision) {
    const current = this.applyOutcome(revision);

    if (current === "applied") {
      return current;
    }

    if (current) {
      throw applyError(current, this.snapshot?.failureCode);
    }

    return new Promise((resolve, reject) => {
      const waiter = { revision, resolve, reject, timer: 0, pollAttempt: 0 };
      this.waiters.add(waiter);
      this.scheduleWaiterPoll(waiter);
    });
  }

  receive(snapshot) {
    if (snapshot?.type !== "session" || snapshot.protocol !== 1) {
      return;
    }

    if (this.snapshot && snapshot.sequence < this.snapshot.sequence) {
      return;
    }

    this.snapshot = snapshot;
    this.onSnapshot(snapshot);

    for (const waiter of [...this.waiters]) {
      const outcome = this.applyOutcome(waiter.revision);

      if (!outcome) {
        continue;
      }

      this.waiters.delete(waiter);
      globalThis.clearTimeout(waiter.timer);
      outcome === "applied"
        ? waiter.resolve(outcome)
        : waiter.reject(applyError(outcome, snapshot.failureCode));
    }

    if (NON_RECONNECTING_STATES.has(snapshot.state)) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
      this.socket?.close(1000, "Session closed");
    }
  }

  receiveNotification(snapshot) {
    if (snapshot?.type !== "session" || snapshot.protocol !== 1) {
      return;
    }

    if (this.snapshot && snapshot.sequence <= this.snapshot.sequence) {
      return;
    }

    this.pendingNotificationSequence = Math.max(this.pendingNotificationSequence, snapshot.sequence);
    this.startNotificationRefresh();
  }

  startNotificationRefresh() {
    if (this.notificationRefresh) {
      return;
    }

    this.notificationRefresh = this.confirmNotification()
      .finally(() => {
        this.notificationRefresh = null;

        if (this.pendingNotificationSequence > (this.snapshot?.sequence ?? 0)) {
          this.startNotificationRefresh();
        }
      });
  }

  async confirmNotification() {
    const targetSequence = this.pendingNotificationSequence;
    this.pendingNotificationSequence = 0;

    try {
      await this.getStatus();
    } catch (error) {
      if (this.failWaitersForTerminalError(error)) {
        return;
      }

      this.rescheduleWaiters(true);
      return;
    }

    if ((this.snapshot?.sequence ?? 0) < targetSequence) {
      this.rescheduleWaiters(true);
    }
  }

  scheduleWaiterPoll(waiter, forceFallback = false) {
    if (!this.waiters.has(waiter)) {
      return;
    }

    globalThis.clearTimeout(waiter.timer);

    const socketAvailable = !forceFallback && this.socket?.readyState === SOCKET_OPEN;
    const baseDelay = socketAvailable
      ? SOCKET_WATCHDOG_MS
      : POLL_BACKOFF_MS[Math.min(waiter.pollAttempt, POLL_BACKOFF_MS.length - 1)];

    if (!socketAvailable) {
      waiter.pollAttempt += 1;
    }

    waiter.timer = globalThis.setTimeout(() => void this.pollWaiter(waiter), jitteredDelay(baseDelay));
  }

  async pollWaiter(waiter) {
    if (!this.waiters.has(waiter)) {
      return;
    }

    try {
      const previousSequence = this.snapshot?.sequence ?? 0;
      await this.getStatus();

      if ((this.snapshot?.sequence ?? 0) > previousSequence) {
        waiter.pollAttempt = 0;
      }
    } catch (error) {
      if (this.failWaitersForTerminalError(error)) {
        return;
      }
    }

    this.scheduleWaiterPoll(waiter);
  }

  rescheduleWaiters(forceFallback = false) {
    for (const waiter of this.waiters) {
      if (forceFallback) {
        waiter.pollAttempt = 0;
      }

      this.scheduleWaiterPoll(waiter, forceFallback);
    }
  }

  failWaitersForTerminalError(error) {
    const terminalHttpError = [401, 404, 410].includes(error?.status);
    const expired = this.snapshot?.expiresAt && Date.now() >= this.snapshot.expiresAt;

    if (!this.closed && !terminalHttpError && !expired) {
      return false;
    }

    for (const waiter of this.waiters) {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(expired ? new Error("This editor session has expired.") : error);
    }

    this.waiters.clear();
    return true;
  }

  scheduleReconnect() {
    if (this.closed || !this.WebSocketClass || this.reconnectTimer || !this.canReconnect()) {
      return;
    }

    const baseDelay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, jitteredDelay(baseDelay));
  }

  canReconnect() {
    return !this.snapshot || !NON_RECONNECTING_STATES.has(this.snapshot.state);
  }

  applyOutcome(revision) {
    if (!this.snapshot || this.snapshot.resultRevision !== revision) {
      return null;
    }

    if (this.snapshot.state === "applied") {
      return "applied";
    }

    if (["validation_rejected", "conflicted", "failed", "expired", "cancelled"].includes(this.snapshot.state)) {
      return this.snapshot.state;
    }

    return null;
  }

  async request(path, init = {}, timeoutMs = this.requestTimeoutMs) {
    const request = this.AbortControllerClass ? {
      controller: new this.AbortControllerClass(),
      timedOut: false,
      timer: 0
    } : null;

    if (request) {
      request.timer = globalThis.setTimeout(() => {
        request.timedOut = true;
        request.controller.abort();
      }, timeoutMs);
      this.activeRequests.add(request);
    }

    let responseReturned = false;

    try {
      const response = await this.fetcher(
        `${this.origin}/api/editor/v1/sessions/${this.link.id}${path ? `/${path}` : ""}`,
        {
          ...init,
          ...(request ? { signal: request.controller.signal } : {}),
          headers: {
            Authorization: `KingdomsX-Editor ${this.link.browserToken}`,
            ...init.headers
          }
        }
      );

      if (response.ok) {
        responseReturned = true;
        return this.trackResponse(response, request);
      }

      let body = null;

      try {
        body = await response.json();
      } catch {}

      if (response.status === 410 && isSessionSnapshot(body)) {
        this.receive(body);
      }

      const message = body?.message
        ?? (response.status === 410 ? "This editor session has expired." : `The editor service returned HTTP ${response.status}.`);
      throw new RemoteSessionError(message, response.status);
    } catch (error) {
      if (request?.timedOut) {
        throw new RemoteSessionError("The editor service request timed out.", 408);
      }

      if (this.closed && request?.controller.signal.aborted) {
        throw new Error("The remote editor session was closed.");
      }

      throw error;
    } finally {
      if (request && !responseReturned) {
        this.finishRequest(request);
      }
    }
  }

  trackResponse(response, request) {
    if (!request) {
      return response;
    }

    const tracked = Object.create(response);
    tracked.arrayBuffer = () => this.consumeResponse(response.arrayBuffer.bind(response), request);
    tracked.json = () => this.consumeResponse(response.json.bind(response), request);
    return tracked;
  }

  async consumeResponse(consume, request) {
    try {
      return await consume();
    } catch (error) {
      if (request.timedOut) {
        throw new RemoteSessionError("The editor service request timed out.", 408);
      }

      if (this.closed && request.controller.signal.aborted) {
        throw new Error("The remote editor session was closed.");
      }

      throw error;
    } finally {
      this.finishRequest(request);
    }
  }

  finishRequest(request) {
    globalThis.clearTimeout(request.timer);
    this.activeRequests.delete(request);
  }
}

function isSessionSnapshot(value) {
  return value?.type === "session"
    && value.protocol === 1
    && Number.isSafeInteger(value.sequence)
    && Number.isSafeInteger(value.resultRevision)
    && typeof value.state === "string"
    && Number.isSafeInteger(value.expiresAt);
}

function validateRevision(revision, message) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 0xffffffff) {
    throw new Error(message);
  }
}

function jitteredDelay(delay) {
  const spread = delay * BACKOFF_JITTER;

  return Math.round(delay - spread + Math.random() * spread * 2);
}

class RemoteSessionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function applyError(outcome, failureCode) {
  if (outcome === "validation_rejected") {
    return new Error("The server rejected the edited configs during validation.");
  }

  if (outcome === "conflicted") {
    return new Error("The server configs changed while this editor was open. Start a new editor session.");
  }

  if (outcome === "expired" || outcome === "cancelled") {
    return new Error("This editor session is no longer available.");
  }

  const detail = failureCode ? ` (${failureCode})` : "";

  return new Error(`The server could not apply the edited configs${detail}. You can retry this save.`);
}
