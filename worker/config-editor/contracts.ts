export const EDITOR_PROTOCOL = 1;
export const SESSION_LIFETIME_MS = 60 * 60 * 1_000;
export const TERMINAL_GRACE_MS = 5 * 60 * 1_000;
export const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024 + 43;
export const MAX_SESSION_UPLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_SESSION_DOWNLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_RESULT_REVISION = 32;
export const MAX_BROWSER_SOCKETS = 8;

export const SESSION_ID = /^[A-Za-z0-9_-]{22}$/;
export const CAPABILITY_HASH = /^[a-f0-9]{64}$/;
export const PAYLOAD_HASH = /^[a-f0-9]{64}$/;

export type SessionState =
  | "awaiting_original"
  | "ready"
  | "result_ready"
  | "applying"
  | "applied"
  | "validation_rejected"
  | "conflicted"
  | "failed"
  | "cancelled"
  | "expired";

export interface SessionRecord {
  protocol: 1;
  id: string;
  name: string;
  pluginVersion: string;
  serverTokenHash: string;
  browserTokenHash: string;
  originalBytes: number;
  originalSha256: string;
  createdAt: number;
  expiresAt: number;
  sequence: number;
  state: SessionState;
  resultRevision: number;
  uploadedBytes: number;
  downloadedBytes: number;
  resultBytes?: number;
  resultSha256?: string;
  failureCode?: string;
  cleanupAt?: number;
  pending?: {
    kind: "original" | "result";
    operationId: string;
    revision: number;
    bytes: number;
    sha256: string;
  };
}

export interface CreateSessionRequest {
  protocol: 1;
  name: string;
  pluginVersion: string;
  serverTokenHash: string;
  browserTokenHash: string;
  original: {
    bytes: number;
    sha256: string;
  };
}

export interface ApplyRequest {
  revision: number;
  outcome: "started" | "applied" | "validation_rejected" | "conflicted" | "failed";
  failureCode?: string;
}

export interface SessionSnapshot {
  type: "session";
  protocol: 1;
  sequence: number;
  state: SessionState;
  resultRevision: number;
  expiresAt: number;
  failureCode?: string;
}
