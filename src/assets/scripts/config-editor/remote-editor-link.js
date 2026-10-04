import { deriveRemoteEditorSecrets } from "./remote-session-crypto.js";

export const REMOTE_EDITOR_SESSION_STORAGE_KEY = "kingdomsx.editor.remote-session.v1";
const SESSION_LINK = /^#s\/v1\/([A-Za-z0-9_-]{43})$/;

export async function takeRemoteEditorLink({
  location = window.location,
  history = window.history,
  storage = window.sessionStorage
} = {}) {
  if (location.hash.startsWith("#s/") || location.hash.startsWith("#session/")) {
    const fragment = location.hash;
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    const match = SESSION_LINK.exec(fragment);

    if (!match) {
      throw new Error("This KingdomsX editor link is invalid or incomplete.");
    }

    const seed = match[1];
    const session = { protocol: 1, ...await deriveRemoteEditorSecrets(seed) };

    try {
      storage.setItem(REMOTE_EDITOR_SESSION_STORAGE_KEY, JSON.stringify({ protocol: 1, seed }));
      return { ...session, persistenceAvailable: true };
    } catch {
      return { ...session, persistenceAvailable: false };
    }
  }

  let saved;

  try {
    saved = storage.getItem(REMOTE_EDITOR_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!saved) {
    return null;
  }

  try {
    const stored = JSON.parse(saved);

    if (stored?.protocol === 1 && /^[A-Za-z0-9_-]{43}$/.test(stored.seed)) {
      const session = { protocol: 1, ...await deriveRemoteEditorSecrets(stored.seed) };
      return { ...session, persistenceAvailable: true };
    }
  } catch {}

  try {
    storage.removeItem(REMOTE_EDITOR_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  return null;
}

export function forgetRemoteEditorLink(storage = window.sessionStorage) {
  try {
    storage.removeItem(REMOTE_EDITOR_SESSION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
