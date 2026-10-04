const MAGIC = new TextEncoder().encode("KINGDOMSX");
const VERSION_OFFSET = MAGIC.byteLength;
const KIND_OFFSET = VERSION_OFFSET + 1;
const REVISION_OFFSET = KIND_OFFSET + 1;
const NONCE_OFFSET = REVISION_OFFSET + 4;
const HEADER_BYTES = NONCE_OFFSET + 12;
const TAG_BYTES = 16;
const LINK_SEED_BYTES = 32;
const LINK_DERIVATION_SALT = new TextEncoder().encode("KingdomsX-Editor-Link-v1");
const LINK_DERIVATION_INFO = Object.freeze({
  sessionId: new TextEncoder().encode("KingdomsX-Editor/v1/session-id"),
  aesKey: new TextEncoder().encode("KingdomsX-Editor/v1/aes-256-gcm-key"),
  browserCapability: new TextEncoder().encode("KingdomsX-Editor/v1/browser-capability")
});

export const REMOTE_PAYLOAD_KIND = Object.freeze({
  original: 1,
  result: 2
});

export async function deriveRemoteEditorSecrets(seed, cryptoImpl = globalThis.crypto) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(seed)) {
    throw new Error("The editor link seed is invalid.");
  }

  const seedBytes = decodeBase64Url(seed, LINK_SEED_BYTES);

  if (encodeBase64Url(seedBytes) !== seed) {
    throw new Error("The editor link seed is invalid.");
  }

  if (!cryptoImpl?.subtle) {
    throw new Error("This browser cannot open encrypted editor links.");
  }

  const key = await cryptoImpl.subtle.importKey("raw", seedBytes, "HKDF", false, ["deriveBits"]);
  const derive = async (info, bytes) => new Uint8Array(await cryptoImpl.subtle.deriveBits({
    name: "HKDF",
    hash: "SHA-256",
    salt: LINK_DERIVATION_SALT,
    info
  }, key, bytes * 8));
  const [sessionId, aesKey, browserCapability] = await Promise.all([
    derive(LINK_DERIVATION_INFO.sessionId, 16),
    derive(LINK_DERIVATION_INFO.aesKey, 32),
    derive(LINK_DERIVATION_INFO.browserCapability, 32)
  ]);

  return {
    id: encodeBase64Url(sessionId),
    key: encodeBase64Url(aesKey),
    browserToken: encodeBase64Url(browserCapability)
  };
}

export async function encryptRemotePayload(plaintext, {
  sessionId,
  key,
  kind,
  revision,
  random = crypto
}) {
  const source = asBytes(plaintext);
  const keyBytes = decodeBase64Url(key, 32);
  const header = envelopeHeader(kind, revision);
  random.getRandomValues(header.subarray(NONCE_OFFSET, HEADER_BYTES));

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: header.subarray(NONCE_OFFSET),
    additionalData: additionalData(header, sessionId),
    tagLength: 128
  }, cryptoKey, source);

  const envelope = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
  envelope.set(header);
  envelope.set(new Uint8Array(ciphertext), HEADER_BYTES);

  return envelope;
}

export async function decryptRemotePayload(envelope, {
  sessionId,
  key,
  kind,
  revision
}) {
  const bytes = asBytes(envelope);

  if (bytes.byteLength < HEADER_BYTES + TAG_BYTES) {
    throw new Error("The encrypted editor file is incomplete.");
  }

  if (!MAGIC.every((value, index) => bytes[index] === value) || bytes[VERSION_OFFSET] !== 1) {
    throw new Error("The encrypted editor file uses an unsupported format.");
  }

  if (bytes[KIND_OFFSET] !== kind || readRevision(bytes) !== revision) {
    throw new Error("The encrypted editor file has the wrong type or revision.");
  }

  const cryptoKey = await crypto.subtle.importKey("raw", decodeBase64Url(key, 32), "AES-GCM", false, ["decrypt"]);

  try {
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: bytes.subarray(NONCE_OFFSET, HEADER_BYTES),
      additionalData: additionalData(bytes.subarray(0, HEADER_BYTES), sessionId),
      tagLength: 128
    }, cryptoKey, bytes.subarray(HEADER_BYTES));

    return new Uint8Array(plaintext);
  } catch {
    throw new Error("The encrypted editor file appears damaged or changed.");
  }
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asBytes(value)));

  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeBase64Url(value, expectedBytes) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The editor session secret is invalid.");
  }

  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary;

  try {
    binary = atob(padded);
  } catch {
    throw new Error("The editor session secret is invalid.");
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  if (expectedBytes && bytes.byteLength !== expectedBytes) {
    throw new Error("The editor session secret has an invalid length.");
  }

  return bytes;
}

export function encodeBase64Url(value) {
  const bytes = asBytes(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function envelopeHeader(kind, revision) {
  if (![REMOTE_PAYLOAD_KIND.original, REMOTE_PAYLOAD_KIND.result].includes(kind)) {
    throw new Error("The encrypted editor file type is invalid.");
  }

  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 0xffffffff) {
    throw new Error("The encrypted editor file revision is invalid.");
  }

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[VERSION_OFFSET] = 1;
  header[KIND_OFFSET] = kind;
  new DataView(header.buffer).setUint32(REVISION_OFFSET, revision);
  return header;
}

function readRevision(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(REVISION_OFFSET);
}

function additionalData(header, sessionId) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(sessionId)) {
    throw new Error("The editor session identifier is invalid.");
  }

  const id = new TextEncoder().encode(sessionId);
  const data = new Uint8Array(NONCE_OFFSET + id.byteLength);
  data.set(header.subarray(0, NONCE_OFFSET));
  data.set(id, NONCE_OFFSET);
  return data;
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
