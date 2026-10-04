export const DEFAULT_EDITOR_SETTINGS = Object.freeze({
  inputFont: "minecraft",
  textSize: "standard",
  reduceMotion: false
});

const STORAGE_KEY = "kingdomsx-editor-settings-v1";

export function normalizeEditorSettings(value) {
  return {
    inputFont: value?.inputFont === "console" ? "console" : "minecraft",
    textSize: value?.textSize === "large" ? "large" : "standard",
    reduceMotion: value?.reduceMotion === true
  };
}

export function loadEditorSettings(storage) {
  try {
    if (storage === undefined) {
      storage = browserStorage();
    }

    if (!storage) {
      return normalizeEditorSettings();
    }

    return normalizeEditorSettings(JSON.parse(storage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeEditorSettings();
  }
}

export function saveEditorSettings(value, storage) {
  const settings = normalizeEditorSettings(value);

  try {
    if (storage === undefined) {
      storage = browserStorage();
    }

    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}

  return settings;
}

export function applyEditorSettings(settings, root = document.documentElement) {
  const normalized = normalizeEditorSettings(settings);
  root.dataset.editorInputFont = normalized.inputFont;
  root.dataset.editorTextSize = normalized.textSize;
  root.dataset.editorReduceMotion = String(normalized.reduceMotion);
  return normalized;
}

export function editorPrefersReducedMotion(root = document.documentElement) {
  return root.dataset.editorReduceMotion === "true"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function browserStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}
