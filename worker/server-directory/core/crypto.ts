export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(secret: string, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return new Uint8Array(signature);
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function base64UrlDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return base64Url(new Uint8Array(digest));
}

export function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);

  crypto.getRandomValues(bytes);

  return base64Url(bytes);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function secureCompareString(expected: string, actual: string): Promise<boolean> {
  if (!expected || !actual) {
    return false;
  }

  // Hash both values first to keep the comparison at a fixed lnegth
  return constantTimeEqual(await sha256(expected), await sha256(actual));
}

function constantTimeEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

export function jitterDelay(): number {
  const bytes = new Uint8Array(1);

  crypto.getRandomValues(bytes);

  return bytes[0] % 25;
}
