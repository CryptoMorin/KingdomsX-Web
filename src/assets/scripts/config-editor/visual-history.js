import { indexYamlSource } from "./yaml-source.js";

const MAX_HISTORY_ENTRIES = 100;

export function createVisualHistory(document) {
  return {
    entries: [snapshot(document, null)],
    index: 0
  };
}

export function ensureVisualHistory(history, document) {
  const current = history?.entries[history.index];

  return current?.currentText === document.currentText
    ? history
    : createVisualHistory(document);
}

export function recordVisualHistory(history, document, optionPath) {
  const current = history.entries[history.index];

  if (current?.currentText === document.currentText) {
    return false;
  }

  history.entries.splice(history.index + 1);
  history.entries.push(snapshot(document, optionPath));

  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries.shift();
  }

  history.index = history.entries.length - 1;
  return true;
}

export function moveVisualHistory(history, direction) {
  const nextIndex = history.index + direction;

  if (nextIndex < 0 || nextIndex >= history.entries.length) {
    return null;
  }

  const current = history.entries[history.index];
  history.index = nextIndex;
  const target = history.entries[nextIndex];

  return {
    snapshot: cloneSnapshot(target),
    optionPath: [...(direction < 0 ? current.optionPath : target.optionPath)]
  };
}

export function restoreVisualHistory(document, historySnapshot) {
  document.currentText = historySnapshot.currentText;
  document.index = indexYamlSource(historySnapshot.currentText);
  document.changes = new Map(historySnapshot.changes);
}

export function visualHistoryDirection(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return 0;
  }

  const key = String(event.key).toLocaleLowerCase("en-US");

  if (key === "y") {
    return 1;
  }

  if (key !== "z") {
    return 0;
  }

  return event.shiftKey ? 1 : -1;
}

function snapshot(document, optionPath) {
  return {
    currentText: document.currentText,
    changes: new Map(document.changes),
    optionPath: [...(optionPath ?? [])]
  };
}

function cloneSnapshot(value) {
  return {
    currentText: value.currentText,
    changes: new Map(value.changes),
    optionPath: [...value.optionPath]
  };
}
