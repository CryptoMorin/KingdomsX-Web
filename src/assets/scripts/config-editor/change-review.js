import { labelForKey } from "./schema-options.js";
import { parseAnchorName, parseAliasName } from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

export function describeChanges(document) {
  return [...document.changes.values()].map((change) => describeChange(change));
}

export function changedSourceLineNumbers(document, { wholeFile = false } = {}) {
  const lines = new Set();

  if (wholeFile) {
    const source = String(document?.currentText ?? "").replace(/\r\n|\r/g, "\n");
    const count = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);

    return Array.from({ length: count }, (_, index) => index + 1);
  }

  const changes = [...(document?.changes?.values() ?? [])];

  for (const change of changes) {
    if (!change.path?.length) {
      addSourceEditLines(lines, document.originalText, document.currentText);
      continue;
    }

    if (change.kind === "removed") {
      continue;
    }

    if (change.kind === "reordered") {
      addReorderedLines(lines, document, change);
      continue;
    }

    const entry = document.index.byPath.get(pathKey(change.path));

    if (!entry) {
      continue;
    }

    if (entry.container && change.kind === "changed" && changes.some((candidate) =>
      candidate.path?.length > change.path.length
      && change.path.every((segment, index) => candidate.path[index] === segment)
    )) {
      continue;
    }

    const rangeFrom = change.kind === "annotation-changed" ? entry.commentFrom : entry.lineFrom;
    const rangeTo = change.kind === "added" || change.kind === "expanded-message" || !entry.container
      ? Math.max(entry.lineTo, entry.valueTo)
      : entry.lineTo;

    addSourceRangeLines(lines, document.currentText, rangeFrom, rangeTo);
  }

  return [...lines].sort((left, right) => left - right);
}

function describeChange(change) {
  const path = (change.path ?? []).map(labelForKey).join(" → ") || "Config";
  const previous = displayValue(change.previousSource);
  const next = displayValue(change.nextSource);

  if (change.kind === "added") {
    return { kind: "Added", path, summary: ["Added with ", inlineValue(next), "."] };
  }

  if (change.kind === "removed") {
    return { kind: "Removed", path, summary: "Removed this setting and its nested values." };
  }

  if (change.kind === "renamed") {
    return { kind: "Renamed", path, summary: ["Renamed ", inlineValue(previous), " to ", inlineValue(next), "."] };
  }

  if (change.kind === "anchor-renamed") {
    return {
      kind: "Shared",
      path,
      summary: ["Renamed shared value ", inlineValue(previous), " to ", inlineValue(next), " everywhere it is linked."]
    };
  }

  if (change.kind === "anchor-added") {
    return {
      kind: "Shared",
      path,
      summary: ["Created shared value ", inlineValue(parseAnchorName(change.nextSource) || next), "."]
    };
  }

  if (change.kind === "anchor-removed") {
    const uses = Number(change.referenceCount) || 0;
    const copied = uses ? ` and kept ${uses} ${uses === 1 ? "use" : "uses"} as independent copies` : "";

    return {
      kind: "Independent",
      path,
      summary: ["Stopped sharing ", inlineValue(change.reusableName), copied, "."]
    };
  }

  if (change.kind === "reused-anchor") {
    return {
      kind: "Linked",
      path,
      summary: ["Linked to shared value ", inlineValue(parseAliasName(change.nextSource) || next), "."]
    };
  }

  if (change.kind === "detached-alias") {
    return { kind: "Independent", path, summary: "Made an independent copy that can be edited without changing the original." };
  }

  if (change.kind === "expanded-message") {
    const effect = change.effect === "actionbar" ? "action bar" : change.effect === "titles" ? "title" : "sound";

    return { kind: "Enhanced", path, summary: `Added a ${effect} to this message.` };
  }

  if (change.kind === "reordered") {
    return {
      kind: "Reordered",
      path,
      summary: ["Changed the priority order from ", inlineValue(previous), " to ", inlineValue(next), "."]
    };
  }

  if (change.kind === "annotation-changed") {
    const policies = (change.nextAnnotations ?? []).map(policyLabel);

    return {
      kind: "Inheritance",
      path,
      summary: policies.length
        ? ["Set inheritance rules to ", inlineValue(policies.join(", ")), "."]
        : "Removed the inheritance rules."
    };
  }

  if (change.kind === "source-edited") {
    return {
      kind: "Advanced",
      path: "Config source",
      summary: "Edited the YAML directly. Review the resulting file before downloading."
    };
  }

  return {
    kind: "Changed",
    path,
    summary: ["Changed from ", inlineValue(previous), " to ", inlineValue(next), "."]
  };
}

function inlineValue(value) {
  return { value };
}

function policyLabel(id) {
  if (id === "ignore-if-set") {
    return "Ignore if set";
  }

  if (id === "no-sync") {
    return "No sync";
  }

  return "Final";
}

function displayValue(source) {
  const value = String(parseSimpleLiteral(String(source ?? "")).value ?? "").replace(/\s+/g, " ").trim();

  if (!value) {
    return "an empty value";
  }

  const visible = value.length > 70 ? `${value.slice(0, 68)}…` : value;

  return visible;
}

function addReorderedLines(lines, document, change) {
  const previousOrder = String(change.previousSource ?? "").split(", ");
  const nextOrder = String(change.nextSource ?? "").split(", ");

  for (const [index, key] of nextOrder.entries()) {
    if (previousOrder[index] === key) {
      continue;
    }

    const entry = document.index.byPath.get(pathKey([...change.path, key]));

    if (entry) {
      addSourceRangeLines(lines, document.currentText, entry.lineFrom, Math.max(entry.lineTo, entry.valueTo));
    }
  }
}

function addSourceEditLines(lines, previousSource, nextSource) {
  const previousLines = normalizedLines(previousSource);
  const nextLines = normalizedLines(nextSource);
  let start = 0;

  while (start < previousLines.length && start < nextLines.length && previousLines[start] === nextLines[start]) {
    start += 1;
  }

  let previousEnd = previousLines.length - 1;
  let nextEnd = nextLines.length - 1;

  while (previousEnd >= start && nextEnd >= start && previousLines[previousEnd] === nextLines[nextEnd]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  for (let index = start; index <= nextEnd; index += 1) {
    lines.add(index + 1);
  }
}

function addSourceRangeLines(lines, source, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) {
    return;
  }

  const start = sourceLineAt(source, from);
  const text = String(source).slice(from, to).replace(/\r\n|\r/g, "\n");
  const count = Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

  for (let line = start; line < start + count; line += 1) {
    lines.add(line);
  }
}

function sourceLineAt(source, offset) {
  return String(source).slice(0, offset).split(/\r\n|\r|\n/).length;
}

function normalizedLines(source) {
  return String(source).replace(/\r\n|\r/g, "\n").split("\n");
}
