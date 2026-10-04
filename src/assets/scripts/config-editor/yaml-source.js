import {
  annotationsFromComments,
  classifyKingdomsEntry,
  classifySequenceItem,
  INHERITANCE_POLICIES,
  parseAliasName,
  parseAnchorName,
  parseAnchoredValue,
  parseBlockScalar
} from "./kingdoms-yaml.js";
import { MESSAGE_TITLE_STARTER_FIELDS } from "./message-entry.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();
const PATH_SEPARATOR = "\u0000";
const ANCHOR_CHANGE_PREFIX = "anchor:";
const ANNOTATION_CHANGE_PREFIX = "annotation:";
const INHERITANCE_POLICY_BY_ID = new Map(INHERITANCE_POLICIES.map((policy) => [policy.id, policy]));

export function createSourceDocument(name, bytes) {
  const originalBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hasBom = originalBytes.length >= 3 && originalBytes[0] === 0xef && originalBytes[1] === 0xbb && originalBytes[2] === 0xbf;
  const contentBytes = hasBom ? originalBytes.subarray(3) : originalBytes;
  let text;

  try {
    text = UTF8.decode(contentBytes);
  } catch {
    return {
      name,
      originalBytes,
      currentText: "",
      editable: false,
      warnings: ["This file cannot be edited because it is not valid UTF-8."],
      index: emptyIndex()
    };
  }

  if (text.includes("\u0000")) {
    return {
      name,
      originalBytes,
      currentText: text,
      editable: false,
      warnings: ["This file cannot be edited because it contains NUL characters."],
      index: emptyIndex()
    };
  }

  const lineEndings = detectLineEndings(text);
  const warnings = [];

  if (lineEndings === "mixed") {
    warnings.push("This file mixes different line endings. You can download it unchanged, but the visual editor cannot modify it.");
  }

  if (/^\t+/m.test(text)) {
    warnings.push("This file uses tabs for indentation. Replace them with spaces before editing these settings.");
  }

  const initialIndex = indexYamlSource(text);
  const document = {
    name,
    originalBytes,
    originalText: text,
    currentText: text,
    hasBom,
    lineEndings,
    finalNewline: /(?:\r\n|\n|\r)$/.test(text),
    editable: lineEndings !== "mixed",
    warnings,
    originalIndex: initialIndex,
    index: initialIndex,
    changes: new Map()
  };

  if (document.index.unsupported) {
    document.editable = false;
  }

  document.warnings.push(...document.index.warnings);
  return document;
}

export function replaceDocumentSource(document, nextText) {
  const replacement = String(nextText);

  if (replacement === document.currentText) {
    return false;
  }

  const candidate = createSourceDocument(document.name, UTF8_ENCODER.encode(replacement));

  if (!candidate.editable) {
    throw new Error(candidate.warnings[0] || "This file cannot be edited.");
  }

  document.currentText = replacement;
  document.lineEndings = candidate.lineEndings;
  document.finalNewline = candidate.finalNewline;
  document.editable = true;
  document.warnings = candidate.warnings;
  document.index = candidate.index;

  if (replacement === document.originalText) {
    document.changes.clear();
    return true;
  }

  document.changes = sourceEditChanges(document.originalText, replacement);
  return true;
}

function sourceEditChanges(originalText, currentText) {
  const original = indexYamlSource(originalText);
  const current = indexYamlSource(currentText);
  const changes = new Map();

  for (const [key, entry] of current.byPath) {
    const previous = original.byPath.get(key);

    if (!previous) {
      changes.set(key, {
        kind: "added",
        path: entry.path,
        previousSource: "",
        nextSource: entry.source
      });
      continue;
    }

    if (sourceEntryFingerprint(originalText, previous) === sourceEntryFingerprint(currentText, entry)) {
      continue;
    }

    changes.set(key, {
      kind: "changed",
      path: entry.path,
      previousSource: previous.source,
      nextSource: entry.source
    });
  }

  for (const [key, entry] of original.byPath) {
    if (current.byPath.has(key)) {
      continue;
    }

    changes.set(key, {
      kind: "removed",
      path: entry.path,
      previousSource: entry.source,
      nextSource: ""
    });
  }

  if (!changes.size) {
    changes.set("source:", {
      kind: "source-edited",
      path: [],
      previousSource: originalText,
      nextSource: currentText
    });
  }

  return changes;
}

function sourceEntryFingerprint(text, entry) {
  const comments = text.slice(entry.commentFrom ?? entry.lineFrom, entry.commentTo ?? entry.lineFrom);
  const value = entry.container
    ? text.slice(entry.valueFrom, entry.lineTo)
    : entry.source;

  return `${comments}\u0000${value}`;
}

export function indexYamlSource(text) {
  const entries = [];
  const byPath = new Map();
  const warnings = [];
  const lines = splitLines(text);
  const parents = [];
  let pendingComments = [];
  let pendingCommentFrom = null;
  let unsupported = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const content = line.text;

    if (content.trim() === "") {
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    const indentMatch = /^[ \t]*/.exec(content);
    const indentation = indentMatch?.[0] ?? "";

    if (content.trimStart().startsWith("#")) {
      if (pendingCommentFrom === null) {
        pendingCommentFrom = line.start;
      }

      pendingComments.push(cleanComment(content.trimStart()));
      continue;
    }

    if (indentation.includes("\t")) {
      warnings.push(`Line ${lineIndex + 1} uses tabs for indentation. Replace them with spaces to edit this setting.`);
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    const indent = indentation.length;
    const trimmed = content.slice(indent);

    if (trimmed === "---" || trimmed === "...") {
      warnings.push(`Line ${lineIndex + 1} uses a YAML document marker. Remove it before using this file with KingdomsX.`);
      unsupported = true;
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    if (trimmed.startsWith("%")) {
      warnings.push(`Line ${lineIndex + 1} uses a YAML directive, which KingdomsX config files do not support.`);
      unsupported = true;
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    if (trimmed.startsWith("-")) {
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    const colon = findMappingColon(trimmed);

    if (colon < 0) {
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    const rawKey = trimmed.slice(0, colon).trim();
    const key = parseMappingKey(rawKey);

    if (key === null) {
      pendingComments = [];
      pendingCommentFrom = null;
      continue;
    }

    while (parents.length && parents.at(-1).indent >= indent) {
      parents.pop();
    }

    const path = [...parents.map((parent) => parent.key), key];
    const afterColon = trimmed.slice(colon + 1);
    const leadingValueSpace = /^\s*/.exec(afterColon)?.[0].length ?? 0;
    const rawValue = afterColon.slice(leadingValueSpace);
    const valueColumn = indent + colon + 1 + leadingValueSpace;
    const commentColumn = findInlineComment(rawValue);
    const valueWithoutComment = commentColumn < 0 ? rawValue : rawValue.slice(0, commentColumn);
    const value = valueWithoutComment.trimEnd();

    if (/^![^\s]+(?:\s|$)/.test(value)) {
      warnings.push(`Line ${lineIndex + 1} uses an explicit YAML tag, which KingdomsX config files do not support.`);
      unsupported = true;
    }

    const valueStart = line.start + valueColumn;
    const valueEnd = valueStart + value.length;
    const blockIndicator = /^(?:&[A-Za-z0-9_-]+\s+)?[|>][+\-]?\d?/.test(value);
    const flowSequence = readFlowSequence(text, valueStart, lineIndex);
    const anchoredSequence = isAnchorOnly(value)
      ? readAnchoredSequence(lines, lineIndex, indent, text, valueStart)
      : null;
    const entry = {
      path,
      key,
      rawKey,
      line: lineIndex + 1,
      indent,
      keyFrom: line.start + indent,
      keyTo: line.start + indent + colon,
      lineFrom: line.start,
      lineTo: line.end,
      valueFrom: valueStart,
      valueTo: valueEnd,
      source: value,
      comments: pendingComments.filter(Boolean),
      commentFrom: pendingCommentFrom ?? line.start,
      commentTo: line.start,
      advancedOnly: false,
      container: value === "" || (isAnchorOnly(value) && !anchoredSequence),
      emptyMapping: /^\{\s*}$/.test(value),
      complexSequence: Boolean(anchoredSequence && !anchoredSequence.items)
    };

    pendingComments = [];
    pendingCommentFrom = null;

    if (blockIndicator) {
      let blockEnd = line.end;
      let next = lineIndex + 1;

      while (next < lines.length) {
        const nextText = lines[next].text;
        const nextIndent = /^ */.exec(nextText)?.[0].length ?? 0;

        if (nextText.trim() !== "" && nextIndent <= indent) {
          break;
        }

        blockEnd = lines[next].end;
        next += 1;
      }

      entry.valueTo = blockEnd;
      entry.source = text.slice(entry.valueFrom, blockEnd);
      entry.advancedOnly = true;
      lineIndex = next - 1;
    } else if (anchoredSequence) {
      entry.valueTo = anchoredSequence.valueTo;
      entry.source = text.slice(entry.valueFrom, anchoredSequence.valueTo);

      if (anchoredSequence.items) {
        entry.collectionItems = anchoredSequence.items;
        entry.sequencePrefix = value;
        entry.sequenceIndent = anchoredSequence.indent;
        entry.sequenceFinalNewline = anchoredSequence.finalNewline;
        entry.sequenceNewline = anchoredSequence.newline;
      } else {
        entry.advancedOnly = true;
      }

      lineIndex = anchoredSequence.endLine;
    } else if (flowSequence) {
      entry.valueTo = flowSequence.valueTo;
      entry.source = text.slice(entry.valueFrom, flowSequence.valueTo);
      entry.sequenceStyle = "flow";
      entry.sequencePrefix = flowSequence.prefix;
      entry.sequenceOffset = flowSequence.sequenceOffset;
      entry.collectionItems = flowSequence.items;
      entry.advancedOnly = !flowSequence.items;
      lineIndex = flowSequence.endLine;
    } else if (entry.container) {
      const sequence = readSimpleSequence(lines, lineIndex, indent, text, entry.valueFrom);

      if (sequence) {
        entry.container = false;
        entry.valueTo = sequence.valueTo;
        entry.source = text.slice(entry.valueFrom, sequence.valueTo);
        entry.collectionItems = sequence.items;
        entry.sequenceIndent = sequence.indent;
        entry.sequenceFinalNewline = sequence.finalNewline;
        entry.sequenceNewline = sequence.newline;
        lineIndex = sequence.endLine;
      }
    } else if (isAdvancedLiteral(value)) {
      entry.advancedOnly = true;
    }

    entries.push(entry);
    byPath.set(pathKey(path), entry);

    if (entry.container) {
      parents.push({ indent, key });
    }
  }

  ownContainerRanges(entries, text);
  const moduleParameters = entries
    .filter((entry) => entry.path.length === 3 && entry.path[0] === "(module)" && entry.path[1] === "parameters")
    .map((entry) => entry.key);

  for (const entry of entries) {
    entry.annotations = annotationsFromComments(entry.comments);
    const declaresModuleParameter = entry.path.length >= 2
      && entry.path[0] === "(module)"
      && entry.path[1] === "parameters";
    entry.syntax = classifyKingdomsEntry(entry, declaresModuleParameter ? [] : moduleParameters);
    entry.blockScalar = parseBlockScalar(entry.source);
    entry.collectionItems?.forEach((item) => {
      item.syntax = classifySequenceItem(item.source, entry.path);
    });
  }

  return { entries, byPath, warnings: unique(warnings), unsupported };
}

export function replaceDocumentValue(document, path, replacement) {
  if (!document.editable) {
    throw new Error("The visual editor cannot change this file without risking its formatting.");
  }

  const entry = document.index.byPath.get(pathKey(path));

  if (!entry || entry.container || entry.advancedOnly) {
    throw new Error("Edit this value using the field shown for this setting.");
  }

  const previousSource = document.currentText.slice(entry.valueFrom, entry.valueTo);
  const nextText = `${document.currentText.slice(0, entry.valueFrom)}${replacement}${document.currentText.slice(entry.valueTo)}`;
  document.currentText = nextText;
  document.index = indexYamlSource(nextText);

  const originalEntry = indexYamlSource(document.originalText).byPath.get(pathKey(path));
  recordReplacementChange(document, path, previousSource, replacement, originalEntry);

  return {
    optionPath: path,
    from: entry.valueFrom,
    to: entry.valueTo,
    replacement,
    previousSource,
    nextSource: replacement
  };
}

export function replaceDocumentLiteral(document, path, replacement) {
  if (!document.editable) {
    throw new Error("The visual editor cannot change this file without risking its formatting.");
  }

  const entry = document.index.byPath.get(pathKey(path));

  if (!entry) {
    throw new Error("This setting is no longer present in the YAML file.");
  }

  const previousSource = document.currentText.slice(entry.valueFrom, entry.valueTo);
  const nextText = `${document.currentText.slice(0, entry.valueFrom)}${replacement}${document.currentText.slice(entry.valueTo)}`;
  const originalEntry = indexYamlSource(document.originalText).byPath.get(pathKey(path));
  clearDescendantChanges(document, path);
  document.currentText = nextText;
  document.index = indexYamlSource(nextText);

  recordReplacementChange(document, path, previousSource, replacement, originalEntry);

  return document.index.byPath.get(pathKey(path));
}

export function insertDocumentValue(document, path, replacement) {
  if (!document.editable || path.length === 0 || document.index.byPath.has(pathKey(path))) {
    throw new Error("This setting could not be added without risking the file's formatting.");
  }

  let ancestor = null;
  let ancestorLength = 0;
  let convertedParentPath = null;
  let convertedParentSource = null;

  for (let length = path.length - 1; length > 0; length -= 1) {
    let candidate = document.index.byPath.get(pathKey(path.slice(0, length)));

    if (!candidate) {
      continue;
    }

    if (!candidate.container && candidate.emptyMapping) {
      convertedParentPath = path.slice(0, length);
      convertedParentSource = candidate.source;
      document.currentText = `${document.currentText.slice(0, candidate.keyTo + 1)}${document.currentText.slice(candidate.valueTo)}`;
      document.index = indexYamlSource(document.currentText);
      candidate = document.index.byPath.get(pathKey(path.slice(0, length)));
    }

    if (!candidate.container) {
      throw new Error(`${path.slice(0, length).join(".")} is a single value, so it cannot contain this setting.`);
    }

    ancestor = candidate;
    ancestorLength = length;
    break;
  }

  const newline = document.lineEndings === "crlf" ? "\r\n" : document.lineEndings === "cr" ? "\r" : "\n";
  const indentStep = ancestor ? detectIndentStep(document, ancestor) : detectRootIndentStep(document);
  const indent = ancestor ? ancestor.indent + indentStep : 0;
  const insertionAt = ancestor ? endOfMapping(document, ancestor) : document.currentText.length;
  const needsLeadingNewline = insertionAt > 0 && !/[\r\n]$/.test(document.currentText.slice(0, insertionAt));
  const missingSegments = path.slice(ancestorLength);
  const insertedLines = missingSegments.map((segment, index) => {
    const final = index === missingSegments.length - 1;
    const value = final ? `${startsOnNextLine(replacement) ? "" : " "}${replacement}` : "";

    return `${" ".repeat(indent + index * indentStep)}${formatMappingKey(segment)}:${value}`;
  });
  const insertedBody = insertedLines.join(newline);
  const insertedLine = `${needsLeadingNewline ? newline : ""}${insertedBody}${/[\r\n]$/.test(insertedBody) ? "" : newline}`;

  document.currentText = `${document.currentText.slice(0, insertionAt)}${insertedLine}${document.currentText.slice(insertionAt)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes.set(pathKey(path), {
    path,
    previousSource: "Using plugin default",
    nextSource: replacement,
    kind: "added",
    insertedRootPath: path.slice(0, ancestorLength + 1),
    convertedParentPath,
    convertedParentSource
  });

  return document.index.byPath.get(pathKey(path));
}

export function expandDocumentMessageEntry(document, path, effect) {
  if (!document.editable) {
    throw new Error("The visual editor cannot expand this message without risking its formatting.");
  }

  if (!["sound", "actionbar", "titles"].includes(effect)) {
    throw new Error("This message effect is not supported.");
  }

  const key = pathKey(path);
  const entry = document.index.byPath.get(key);

  if (!entry || entry.container || entry.collectionItems) {
    throw new Error("Only a single message can be expanded with delivery effects.");
  }

  const newline = document.lineEndings === "crlf" ? "\r\n" : document.lineEndings === "cr" ? "\r" : "\n";
  const indentStep = detectIndentStep(document, entry);
  const childIndent = " ".repeat(entry.indent + indentStep);
  const nestedIndent = " ".repeat(indentStep);
  const ownedTo = Math.max(entry.valueTo, entry.lineTo);
  const replacementTo = beforeTrailingLineEnding(document.currentText, ownedTo);
  const previousTail = document.currentText.slice(entry.keyTo + 1, replacementTo);
  const messageSource = entry.source.slice(0, beforeTrailingLineEnding(entry.source, entry.source.length));
  const messageLine = `${childIndent}message: ${messageSource.split(newline).join(`${newline}${nestedIndent}`)}`;
  const inlineSuffix = entry.valueTo <= entry.lineTo
    ? document.currentText.slice(entry.valueTo, replacementTo).trimStart()
    : "";
  const parentSuffix = inlineSuffix.startsWith("#") ? ` ${inlineSuffix}` : "";
  const effectLines = messageEffectLines(effect, childIndent, nestedIndent, newline);
  const replacement = `${parentSuffix}${newline}${messageLine}${newline}${effectLines}`;

  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${replacement}${document.currentText.slice(replacementTo)}`;
  document.index = indexYamlSource(document.currentText);
  clearDescendantChanges(document, path);
  document.changes.set(key, {
    path,
    previousSource: entry.source,
    previousTail,
    nextSource: effect,
    effect,
    kind: "expanded-message"
  });

  return document.index.byPath.get(key);
}

export function undoDocumentMessageExpansion(document, path) {
  const key = pathKey(path);
  const change = document.changes.get(key);
  const entry = document.index.byPath.get(key);

  if (change?.kind !== "expanded-message" || !entry?.container) {
    throw new Error("This message expansion can no longer be undone safely.");
  }

  const replacementTo = beforeTrailingLineEnding(document.currentText, entry.valueTo);
  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${change.previousTail}${document.currentText.slice(replacementTo)}`;
  document.index = indexYamlSource(document.currentText);
  clearDescendantChanges(document, path);
  document.changes.delete(key);
  return document.index.byPath.get(key);
}

function messageEffectLines(effect, childIndent, nestedIndent, newline) {
  if (effect === "sound") {
    return `${childIndent}sound: BLOCK_NOTE_BLOCK_BASS, 1, 1`;
  }

  if (effect === "actionbar") {
    return `${childIndent}actionbar: ""`;
  }

  return [
    `${childIndent}titles:`,
    ...MESSAGE_TITLE_STARTER_FIELDS.map(([key, value]) => `${childIndent}${nestedIndent}${key}: ${value}`)
  ].join(newline);
}

function beforeTrailingLineEnding(text, offset) {
  if (text.slice(Math.max(0, offset - 2), offset) === "\r\n") {
    return offset - 2;
  }

  return /[\r\n]/.test(text[offset - 1] ?? "") ? offset - 1 : offset;
}

function recordReplacementChange(document, path, previousSource, nextSource, originalEntry) {
  const key = pathKey(path);
  const existing = document.changes.get(key);

  if (originalEntry) {
    if (nextSource === originalEntry.source) {
      document.changes.delete(key);
    } else {
      document.changes.set(key, { path, previousSource: originalEntry.source, nextSource, kind: "changed" });
    }

    return;
  }

  if (existing?.kind === "changed-in-expanded-message" && nextSource === existing.previousSource) {
    document.changes.delete(key);
    return;
  }

  if (existing?.kind === "added") {
    document.changes.set(key, { ...existing, nextSource });
    return;
  }

  let expandedAncestor = false;

  for (let length = 1; length < path.length; length += 1) {
    if (document.changes.get(pathKey(path.slice(0, length)))?.kind === "expanded-message") {
      expandedAncestor = true;
      break;
    }
  }

  document.changes.set(key, {
    path,
    previousSource,
    nextSource,
    kind: expandedAncestor ? "changed-in-expanded-message" : "added"
  });
}

export function insertDocumentConditionalValue(document, path, replacement) {
  const inserted = insertDocumentValue(document, path, replacement);

  if (path.at(-1) === "else") {
    return inserted;
  }

  const parentPath = path.slice(0, -1);

  while (true) {
    const siblings = directMappingEntries(document.index, parentPath);
    const conditionIndex = siblings.findIndex((entry) => samePath(entry.path, path));
    const fallbackIndex = siblings.findIndex((entry) => entry.key === "else");

    if (conditionIndex < 0 || fallbackIndex < 0 || conditionIndex < fallbackIndex) {
      break;
    }

    moveDocumentMappingEntry(document, path, -1);
  }

  return document.index.byPath.get(pathKey(path));
}

export function insertDocumentMapping(document, path, fields) {
  return insertDocumentMappingTree(
    document,
    path,
    fields.map(([key, source]) => ({ key, source }))
  );
}

export function insertDocumentMappingTree(document, path, fields) {
  if (!fields.length) {
    return insertDocumentValue(document, path, "{}");
  }

  let ancestor = null;
  let ancestorLength = 0;

  for (let length = path.length - 1; length > 0; length -= 1) {
    const candidate = document.index.byPath.get(pathKey(path.slice(0, length)));

    if (!candidate) {
      continue;
    }

    ancestor = candidate;
    ancestorLength = length;
    break;
  }

  const newline = document.lineEndings === "crlf" ? "\r\n" : document.lineEndings === "cr" ? "\r" : "\n";
  const indentStep = ancestor ? detectIndentStep(document, ancestor) : detectRootIndentStep(document);
  const targetIndent = (ancestor ? ancestor.indent + indentStep : 0)
    + (path.length - ancestorLength - 1) * indentStep;
  const source = mappingTreeLines(fields, targetIndent + indentStep, indentStep)
    .join(newline);

  return insertDocumentValue(document, path, `${newline}${source}`);
}

function mappingTreeLines(fields, indent, indentStep) {
  const prefix = " ".repeat(indent);

  return fields.flatMap((field) => {
    if (field.children?.length) {
      return [
        `${prefix}${formatMappingKey(field.key)}:`,
        ...mappingTreeLines(field.children, indent + indentStep, indentStep)
      ];
    }

    return [`${prefix}${formatMappingKey(field.key)}: ${field.source}`];
  });
}

export function renameDocumentAnchor(document, path, nextName, currentNameOverride = "") {
  if (!document.editable) {
    throw new Error("The visual editor cannot rename this shared value safely.");
  }

  const entry = document.index.byPath.get(pathKey(path));
  const currentName = currentNameOverride || (entry && parseAnchorName(entry.source));
  const cleanName = String(nextName).trim();

  if (!entry || !currentName) {
    throw new Error("This shared value is no longer present in the file.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(cleanName)) {
    throw new Error("Use only letters, numbers, underscores, and hyphens in a shared value name.");
  }

  if (cleanName === currentName) {
    return entry;
  }

  const tokens = scanAnchorTokens(document.currentText);
  const definition = tokens.find((token) =>
    token.kind === "anchor"
      && token.name === currentName
      && token.from >= entry.valueFrom
      && token.from < entry.valueTo
  );

  if (!definition) {
    throw new Error("The shared value name could not be located safely.");
  }

  if (tokens.some((token) => token.kind === "anchor" && token.name === cleanName && token.from !== definition.from)) {
    throw new Error(`A shared value named “${cleanName}” already exists in this file.`);
  }

  const references = tokens.filter((token) => {
    if (token.kind !== "alias" || token.name !== currentName || token.from < definition.to) {
      return false;
    }

    const resolved = tokens
      .filter((candidate) => candidate.kind === "anchor" && candidate.name === currentName && candidate.from < token.from)
      .at(-1);

    return resolved?.from === definition.from;
  });
  const replacements = [definition, ...references].sort((left, right) => right.from - left.from);
  const changeKey = anchorChangeKey(path);
  const existingChange = document.changes.get(changeKey);
  const previousText = existingChange?.kind === "anchor-renamed" ? existingChange.previousText : document.currentText;
  const previousChanges = existingChange?.kind === "anchor-renamed"
    ? existingChange.previousChanges
    : [...document.changes];
  const originalName = existingChange?.kind === "anchor-renamed" ? existingChange.previousSource : currentName;

  if (cleanName === originalName && existingChange?.kind === "anchor-renamed") {
    restoreDocumentSnapshot(document, existingChange.previousText, existingChange.previousChanges);
    return document.index.byPath.get(pathKey(path));
  }

  let nextText = document.currentText;

  for (const token of replacements) {
    nextText = `${nextText.slice(0, token.from + 1)}${cleanName}${nextText.slice(token.to)}`;
  }

  document.currentText = nextText;
  document.index = indexYamlSource(nextText);
  document.changes.set(changeKey, {
    path,
    previousSource: originalName,
    nextSource: cleanName,
    previousText,
    previousChanges,
    kind: "anchor-renamed"
  });
  return document.index.byPath.get(pathKey(path));
}

export function canAddDocumentAnchor(entry) {
  if (!entry || parseAnchorName(entry.source)) {
    return false;
  }

  if (["function-call", "function-merge", "named-function-call"].includes(entry.syntax?.kind)) {
    return false;
  }

  return !/^\s*\*/.test(entry.source);
}

export function canReuseDocumentAnchor(entry) {
  if (!entry || parseAnchorName(entry.source)) {
    return false;
  }

  if (["function-declaration", "function-call", "function-merge", "named-function-call"].includes(entry.syntax?.kind)) {
    return false;
  }

  return canAddDocumentAnchor(entry) || Boolean(parseAliasName(entry.source));
}

export function sequenceItemAnchorDefinitions(document, path, itemIndex) {
  const owner = document.index.byPath.get(pathKey(path));
  const target = owner?.collectionItems?.[itemIndex];

  if (!owner || !target) {
    return [];
  }

  const definitions = new Map();

  for (const entry of document.index.entries) {
    if (entry.line > target.line) {
      break;
    }

    const scalar = parseAnchoredValue(entry.source);

    if (scalar && entry.line < target.line) {
      definitions.set(scalar.name, {
        name: scalar.name,
        source: scalar.value,
        path: entry.path,
        line: entry.line
      });
    }

    for (const [index, item] of (entry.collectionItems ?? []).entries()) {
      if (item.line > target.line || entry === owner && index >= itemIndex) {
        break;
      }

      const parsed = parseAnchoredValue(item.source);

      if (!parsed) {
        continue;
      }

      definitions.set(parsed.name, {
        name: parsed.name,
        source: parsed.value,
        path: entry.path,
        itemIndex: index,
        line: item.line
      });
    }
  }

  return [...definitions.values()];
}

export function addDocumentSequenceItemAnchor(document, path, itemIndex, nextName) {
  const owner = sequenceOwner(document, path, itemIndex);
  const item = owner.collectionItems[itemIndex];
  const cleanName = validAnchorName(nextName);

  if (parseAnchorName(item.source) || parseAliasName(item.source)) {
    throw new Error("This list item is already shared or linked.");
  }

  if (scanAnchorTokens(document.currentText).some((token) => token.kind === "anchor" && token.name === cleanName)) {
    throw new Error(`A shared value named “${cleanName}” already exists in this file.`);
  }

  return replaceDocumentSequenceItem(document, path, itemIndex, `&${cleanName} ${item.source}`);
}

export function reuseDocumentSequenceItemAnchor(document, path, itemIndex, name) {
  const owner = sequenceOwner(document, path, itemIndex);
  const cleanName = validAnchorName(name);
  const definition = sequenceItemAnchorDefinitions(document, path, itemIndex)
    .find((candidate) => candidate.name === cleanName);

  if (!definition) {
    throw new Error(`A shared value named “${cleanName}” was not found earlier in this file.`);
  }

  const item = owner.collectionItems[itemIndex];

  if (parseAnchorName(item.source)) {
    throw new Error("Stop sharing this list item before linking it to another value.");
  }

  return replaceDocumentSequenceItem(document, path, itemIndex, `*${cleanName}`);
}

export function detachDocumentSequenceItemAlias(document, path, itemIndex) {
  const owner = sequenceOwner(document, path, itemIndex);
  const name = parseAliasName(owner.collectionItems[itemIndex].source);

  if (!name) {
    throw new Error("This list item is not linked to a shared value.");
  }

  const definition = sequenceItemAnchorDefinitions(document, path, itemIndex)
    .find((candidate) => candidate.name === name);

  if (!definition) {
    throw new Error(`Shared value “${name}” could not be resolved earlier in this file.`);
  }

  return replaceDocumentSequenceItem(document, path, itemIndex, definition.source);
}

export function removeDocumentSequenceItemAnchor(document, path, itemIndex) {
  const owner = sequenceOwner(document, path, itemIndex);
  const parsed = parseAnchoredValue(owner.collectionItems[itemIndex].source);

  if (!parsed) {
    throw new Error("This list item is not a shared value.");
  }

  const tokens = scanAnchorTokens(document.currentText);
  const definition = tokens.find((token) =>
    token.kind === "anchor"
      && token.name === parsed.name
      && token.from >= owner.valueFrom
      && token.to <= owner.valueTo
  );

  if (!definition) {
    throw new Error("The shared list value could not be located safely.");
  }

  const references = tokens.filter((token) => {
    if (token.kind !== "alias" || token.name !== parsed.name || token.from < definition.to) {
      return false;
    }

    return tokens
      .filter((candidate) => candidate.kind === "anchor" && candidate.name === parsed.name && candidate.from < token.from)
      .at(-1)?.from === definition.from;
  });

  if (references.some((token) => !standaloneAliasToken(document, token, parsed.name))) {
    throw new Error("One linked value is embedded in custom YAML syntax and cannot be expanded safely.");
  }

  const previousText = document.currentText;
  const previousChanges = [...document.changes];
  let nextText = document.currentText;

  for (const token of references.sort((left, right) => right.from - left.from)) {
    nextText = `${nextText.slice(0, token.from)}${parsed.value}${nextText.slice(token.to)}`;
  }

  const separator = /^[ \t]/.test(nextText[definition.to] ?? "") ? 1 : 0;
  nextText = `${nextText.slice(0, definition.from)}${nextText.slice(definition.to + separator)}`;

  document.currentText = nextText;
  document.index = indexYamlSource(nextText);
  document.changes.set(pathKey(path), {
    path,
    previousSource: owner.source,
    nextSource: document.index.byPath.get(pathKey(path))?.source ?? "",
    previousText,
    previousChanges,
    referenceCount: references.length,
    reusableName: parsed.name,
    kind: "anchor-removed"
  });
  return document.index.byPath.get(pathKey(path));
}

function standaloneAliasToken(document, token, name) {
  for (const entry of document.index.entries) {
    if (token.from >= entry.valueFrom && token.to <= entry.valueTo && parseAliasName(entry.source) === name) {
      return true;
    }

    for (const item of entry.collectionItems ?? []) {
      if (parseAliasName(item.source) !== name) {
        continue;
      }

      if (entry.sequenceStyle === "flow") {
        const from = entry.valueFrom + (entry.sequenceOffset ?? 0) + item.from;
        const to = entry.valueFrom + (entry.sequenceOffset ?? 0) + item.to;

        if (token.from >= from && token.to <= to) {
          return true;
        }
      } else {
        const line = 1 + newlineCount(document.currentText, token.from);

        if (line === item.line) {
          return true;
        }
      }
    }
  }

  return false;
}

function newlineCount(source, to) {
  return (source.slice(0, to).match(/\r\n|\n|\r/g) ?? []).length;
}

function replaceDocumentSequenceItem(document, path, itemIndex, source) {
  const owner = sequenceOwner(document, path, itemIndex);
  const values = owner.collectionItems.map((item, index) => index === itemIndex ? source : item.source);
  const replacement = formatSimpleSequence(owner, values, (value) => value);

  return replaceDocumentValue(document, path, replacement);
}

function sequenceOwner(document, path, itemIndex) {
  if (!document.editable) {
    throw new Error("The visual editor cannot change shared list values safely.");
  }

  const owner = document.index.byPath.get(pathKey(path));

  if (!owner?.collectionItems?.[itemIndex]) {
    throw new Error("This list item is no longer present in the file.");
  }

  return owner;
}

function validAnchorName(name) {
  const cleanName = String(name).trim();

  if (!/^[A-Za-z0-9_-]+$/.test(cleanName)) {
    throw new Error("Use only letters, numbers, underscores, and hyphens in a shared value name.");
  }

  return cleanName;
}

export function reusableValueShape(entry, index) {
  if (!entry) {
    return "unknown";
  }

  const aliasName = parseAliasName(entry.source);

  if (aliasName && index) {
    const definition = index.entries
      .filter((candidate) => candidate.line < entry.line && parseAnchorName(candidate.source) === aliasName)
      .at(-1);

    return definition ? reusableValueShape(definition) : "unknown";
  }

  const source = entry.source.trim().replace(/^&[A-Za-z0-9_-]+(?:\s+|$)/, "");

  if (entry.collectionItems || source.startsWith("[")) {
    return "list";
  }

  if (entry.container || entry.emptyMapping || /^\{(?!\?)/.test(source)) {
    return "section";
  }

  return "value";
}

export function addDocumentAnchor(document, path, nextName) {
  if (!document.editable) {
    throw new Error("The visual editor cannot create a shared value from these settings safely.");
  }

  const entry = document.index.byPath.get(pathKey(path));
  const cleanName = String(nextName).trim();

  if (!entry || !canAddDocumentAnchor(entry)) {
    throw new Error("These settings cannot become a shared value in their current form.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(cleanName)) {
    throw new Error("Use only letters, numbers, underscores, and hyphens in a shared value name.");
  }

  if (scanAnchorTokens(document.currentText).some((token) => token.kind === "anchor" && token.name === cleanName)) {
    throw new Error(`A shared value named “${cleanName}” already exists in this file.`);
  }

  const changeKey = pathKey(path);
  const previousChange = document.changes.get(changeKey);
  const previousGap = document.currentText.slice(entry.keyTo + 1, entry.valueFrom);
  const separator = startsOnNextLine(entry.source) ? "" : " ";
  const nextValue = `${previousGap || " "}&${cleanName}${separator}${entry.source}`;
  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${nextValue}${document.currentText.slice(entry.valueTo)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes.set(changeKey, {
    path,
    previousSource: entry.source,
    nextSource: document.index.byPath.get(changeKey)?.source ?? `&${cleanName}${separator}${entry.source}`,
    previousGap,
    previousChange,
    kind: "anchor-added"
  });
  return document.index.byPath.get(changeKey);
}

export function removeDocumentAnchor(document, path) {
  if (!document.editable) {
    throw new Error("The visual editor cannot stop sharing these settings safely.");
  }

  const changeKey = pathKey(path);
  const definition = document.index.byPath.get(changeKey);
  const name = definition && parseAnchorName(definition.source);

  if (!definition || !name) {
    throw new Error("This shared value is no longer present in the file.");
  }

  const references = removableAnchorReferences(document, definition, name);
  const previousText = document.currentText;
  const previousChanges = [...document.changes];
  const definitionSource = definition.source;
  const definitionIndent = definition.indent;

  for (const reference of references.sort((left, right) => right.line - left.line)) {
    detachDocumentAliasSource(document, reference.path, definitionSource, definitionIndent);
  }

  const current = document.index.byPath.get(changeKey);
  const currentName = current && parseAnchorName(current.source);

  if (!current || currentName !== name) {
    restoreDocumentSnapshot(document, previousText, previousChanges);
    throw new Error("The shared value changed before its linked settings could be made independent.");
  }

  const previousGap = document.currentText.slice(current.keyTo + 1, current.valueFrom);
  const sourceWithoutAnchor = current.source.replace(
    new RegExp(`^\\s*&${escapeRegExp(name)}(?:[ \\t])?`),
    ""
  );
  const gap = startsOnNextLine(sourceWithoutAnchor) ? previousGap.replace(/[ \t]+$/, "") : previousGap;
  const replacement = `${gap}${sourceWithoutAnchor}`;
  document.currentText = `${document.currentText.slice(0, current.keyTo + 1)}${replacement}${document.currentText.slice(current.valueTo)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes = new Map(previousChanges);
  document.changes.set(changeKey, {
    path,
    previousSource: definitionSource,
    nextSource: sourceWithoutAnchor,
    previousText,
    previousChanges,
    referenceCount: references.length,
    reusableName: name,
    kind: "anchor-removed"
  });
  return document.index.byPath.get(changeKey);
}

export function reuseDocumentAnchor(document, path, name) {
  if (!document.editable) {
    throw new Error("The visual editor cannot reuse these settings safely.");
  }

  const changeKey = pathKey(path);
  const entry = document.index.byPath.get(changeKey);
  const cleanName = String(name).trim();

  if (!entry || !canReuseDocumentAnchor(entry)) {
    throw new Error("These settings cannot be linked to a shared value in their current form.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(cleanName)) {
    throw new Error("Choose a valid shared value name.");
  }

  const definition = document.index.entries
    .filter((candidate) => candidate.line < entry.line && parseAnchorName(candidate.source) === cleanName)
    .at(-1);

  if (!definition) {
    throw new Error(`A shared value named “${cleanName}” was not found earlier in this file.`);
  }

  const currentShape = reusableValueShape(entry, document.index);
  const definitionShape = reusableValueShape(definition, document.index);
  const unresolvedExistingAlias = currentShape === "unknown" && Boolean(parseAliasName(entry.source));

  if (definitionShape === "unknown" || !unresolvedExistingAlias && currentShape !== definitionShape) {
    throw new Error("Choose a shared value with the same kind of value or group as this option.");
  }

  const previousGap = document.currentText.slice(entry.keyTo + 1, entry.valueFrom);
  const previousChange = document.changes.get(changeKey);
  const finalNewline = /(?:\r\n|\n|\r)$/.exec(entry.source)?.[0] ?? "";
  const firstLine = entry.source.split(/\r\n|\n|\r/, 1)[0].trimStart();
  const inlineComment = entry.container && firstLine.startsWith("#") ? ` ${firstLine}` : "";
  const replacement = ` *${cleanName}${inlineComment}${finalNewline}`;
  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${replacement}${document.currentText.slice(entry.valueTo)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes.set(changeKey, {
    path,
    previousSource: entry.source,
    nextSource: `*${cleanName}`,
    previousGap,
    previousChange,
    replacedThroughLineEnd: Boolean(finalNewline),
    kind: "reused-anchor"
  });
  return document.index.byPath.get(changeKey);
}

export function detachDocumentAlias(document, aliasPath, definitionPath) {
  if (!document.editable) {
    throw new Error("The visual editor cannot unlink and copy this shared value safely.");
  }

  const alias = document.index.byPath.get(pathKey(aliasPath));
  const definition = document.index.byPath.get(pathKey(definitionPath));
  const aliasName = alias && parseAliasName(alias.source);
  const definitionName = definition && parseAnchorName(definition.source);

  if (!alias || !definition || !aliasName || aliasName !== definitionName) {
    throw new Error("The original shared value could not be matched to this option.");
  }

  return detachDocumentAliasSource(document, aliasPath, definition.source, definition.indent);
}

export function detachDocumentAliasSource(document, aliasPath, definitionSource, definitionIndent = 0) {
  if (!document.editable) {
    throw new Error("The visual editor cannot unlink and copy this shared value safely.");
  }

  const alias = document.index.byPath.get(pathKey(aliasPath));

  if (!alias || !parseAliasName(alias.source)) {
    throw new Error("This option is no longer linked to a shared value.");
  }

  const match = /^\s*&[A-Za-z0-9_-]+/.exec(definitionSource);

  if (!match) {
    throw new Error("The shared value could not be copied safely.");
  }

  let replacement = definitionSource.slice(match[0].length);

  if (/^[ \t]/.test(replacement)) {
    replacement = replacement.slice(1);
  }

  replacement = reindentCopiedValue(replacement, alias.indent - definitionIndent);
  if (!replacement.trim()) {
    throw new Error("This shared value has no content to copy.");
  }

  const previousChange = document.changes.get(pathKey(aliasPath));
  const structuredCopy = startsOnNextLine(replacement);
  const previousLineSuffix = document.currentText.slice(alias.valueTo, alias.lineTo);

  if (structuredCopy) {
    const lineSuffix = previousLineSuffix;
    const lineEnding = /(?:\r\n|\n|\r)$/.exec(lineSuffix)?.[0] ?? "";
    const inlineSuffix = lineEnding ? lineSuffix.slice(0, -lineEnding.length) : lineSuffix;
    const copiedValue = replacement.replace(/(?:\r\n|\n|\r)$/, "");
    const inserted = `${inlineSuffix}${copiedValue}${lineEnding}`;
    document.currentText = `${document.currentText.slice(0, alias.keyTo + 1)}${inserted}${document.currentText.slice(alias.lineTo)}`;
    document.index = indexYamlSource(document.currentText);
  } else {
    replaceDocumentLiteral(document, aliasPath, replacement);
  }

  document.changes.set(pathKey(aliasPath), {
    path: aliasPath,
    previousSource: alias.source,
    nextSource: replacement,
    previousChange,
    previousLineSuffix,
    structuredCopy,
    kind: "detached-alias"
  });
  return document.index.byPath.get(pathKey(aliasPath));
}

export function undoDocumentAnchorRename(document, path) {
  const change = document.changes.get(anchorChangeKey(path));

  if (change?.kind !== "anchor-renamed") {
    return false;
  }

  restoreDocumentSnapshot(document, change.previousText, change.previousChanges);
  return true;
}

export function documentAnchorChanged(document, path) {
  return document.changes.has(anchorChangeKey(path));
}

export function setDocumentAnnotation(document, path, annotationId, enabled, { track = true } = {}) {
  if (!document.editable) {
    throw new Error("The visual editor cannot change inheritance policies in this file safely.");
  }

  if (!INHERITANCE_POLICY_BY_ID.has(annotationId)) {
    throw new Error("Unknown inheritance rule.");
  }

  const entry = document.index.byPath.get(pathKey(path));

  if (!entry) {
    throw new Error("This setting is no longer present in the file.");
  }

  const current = new Set((entry.annotations ?? []).map((annotation) => annotation.id));

  if (current.has(annotationId) === enabled) {
    return entry;
  }

  if (enabled) {
    current.add(annotationId);
  } else {
    current.delete(annotationId);
  }

  applyAnnotationSet(document, path, current);

  if (!track) {
    return document.index.byPath.get(pathKey(path));
  }

  const original = indexYamlSource(document.originalText).byPath.get(pathKey(path));
  const originalIds = new Set((original?.annotations ?? []).map((annotation) => annotation.id));
  const changeKey = annotationChangeKey(path);

  if (sameStringSet(current, originalIds)) {
    restoreOriginalAnnotationBlock(document, path);
    document.changes.delete(changeKey);
  } else {
    document.changes.set(changeKey, {
      path,
      previousAnnotations: [...originalIds],
      nextAnnotations: [...current],
      kind: "annotation-changed"
    });
  }

  return document.index.byPath.get(pathKey(path));
}

export function documentAnnotationChanged(document, path) {
  return document.changes.has(annotationChangeKey(path));
}

export function undoDocumentAnnotationChange(document, path) {
  const changeKey = annotationChangeKey(path);
  const change = document.changes.get(changeKey);

  if (change?.kind !== "annotation-changed") {
    return false;
  }

  restoreOriginalAnnotationBlock(document, path);
  document.changes.delete(changeKey);
  return true;
}

export function undoDocumentAliasDetach(document, path) {
  const change = document.changes.get(pathKey(path));

  if (change?.kind !== "detached-alias") {
    return false;
  }

  const entry = document.index.byPath.get(pathKey(path));

  if (change.structuredCopy && entry?.container) {
    const restored = ` ${change.previousSource}${change.previousLineSuffix ?? ""}`;
    document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${restored}${document.currentText.slice(entry.valueTo)}`;
    document.index = indexYamlSource(document.currentText);
  } else {
    replaceDocumentLiteral(document, path, change.previousSource);
  }

  document.changes.delete(pathKey(path));

  if (change.previousChange) {
    document.changes.set(pathKey(path), change.previousChange);
  }

  return true;
}

export function undoDocumentAnchorAddition(document, path) {
  const changeKey = pathKey(path);
  const change = document.changes.get(changeKey);

  if (change?.kind !== "anchor-added") {
    return false;
  }

  const entry = document.index.byPath.get(changeKey);

  if (!entry) {
    return false;
  }

  const name = parseAnchorName(entry.source);

  if (!name) {
    return false;
  }

  const currentSource = entry.source.replace(new RegExp(`^\\s*&${escapeRegExp(name)}(?:[ \\t])?`), "");
  const restored = `${change.previousGap ?? ""}${currentSource}`;
  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${restored}${document.currentText.slice(entry.valueTo)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes.delete(changeKey);

  if (change.previousChange) {
    document.changes.set(changeKey, change.previousChange);
  }

  return true;
}

export function undoDocumentAnchorRemoval(document, path) {
  const change = document.changes.get(pathKey(path));

  if (change?.kind !== "anchor-removed") {
    return false;
  }

  restoreDocumentSnapshot(document, change.previousText, change.previousChanges);
  return true;
}

export function undoDocumentAnchorReuse(document, path) {
  const changeKey = pathKey(path);
  const change = document.changes.get(changeKey);

  if (change?.kind !== "reused-anchor") {
    return false;
  }

  const entry = document.index.byPath.get(changeKey);

  if (!entry) {
    return false;
  }

  const restored = `${change.previousGap ?? ""}${change.previousSource}`;
  const replacementTo = change.replacedThroughLineEnd ? entry.lineTo : entry.valueTo;
  document.currentText = `${document.currentText.slice(0, entry.keyTo + 1)}${restored}${document.currentText.slice(replacementTo)}`;
  document.index = indexYamlSource(document.currentText);
  document.changes.delete(changeKey);

  if (change.previousChange) {
    document.changes.set(changeKey, change.previousChange);
  }

  return true;
}

export function renameDocumentKey(document, path, nextKey, options = {}) {
  if (!document.editable || path.length === 0) {
    throw new Error("This entry name cannot be changed without risking the file's formatting.");
  }

  const entry = document.index.byPath.get(pathKey(path));
  const cleanKey = String(nextKey).trim();

  if (!entry || !cleanKey) {
    throw new Error("Enter a non-empty entry name.");
  }

  const nextPath = [...path.slice(0, -1), cleanKey];

  if (pathKey(nextPath) !== pathKey(path) && document.index.byPath.has(pathKey(nextPath))) {
    throw new Error("This mapping already contains that entry name.");
  }

  const rawKey = options.rawKey ?? formatMappingKey(cleanKey);
  const previousRawKey = document.currentText.slice(entry.keyFrom, entry.keyTo);
  document.currentText = `${document.currentText.slice(0, entry.keyFrom)}${rawKey}${document.currentText.slice(entry.keyTo)}`;
  document.index = indexYamlSource(document.currentText);

  if (options.track === false) {
    return nextPath;
  }

  const currentChange = document.changes.get(pathKey(path));
  document.changes.delete(pathKey(path));

  if (currentChange?.kind === "added") {
    const insertedRootPath = currentChange.insertedRootPath?.map((segment, index) =>
      index === path.length - 1 && currentChange.insertedRootPath.length === path.length ? cleanKey : segment
    );
    document.changes.set(pathKey(nextPath), { ...currentChange, path: nextPath, insertedRootPath });
  } else {
    const originalPath = currentChange?.kind === "renamed" ? currentChange.originalPath : path;
    const originalRawKey = currentChange?.kind === "renamed" ? currentChange.originalRawKey : previousRawKey;
    const previousChange = currentChange?.kind === "renamed" ? currentChange.previousChange : currentChange;

    if (pathKey(nextPath) === pathKey(originalPath)) {
      if (previousChange) {
        document.changes.set(pathKey(nextPath), { ...previousChange, path: nextPath });
      }
    } else {
      document.changes.set(pathKey(nextPath), {
        kind: "renamed",
        path: nextPath,
        originalPath,
        originalRawKey,
        previousChange,
        previousSource: originalPath.at(-1),
        nextSource: cleanKey
      });
    }
  }

  return nextPath;
}

function startsOnNextLine(value) {
  return value.startsWith("\n") || value.startsWith("\r");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreDocumentSnapshot(document, text, changes) {
  document.currentText = text;
  document.index = indexYamlSource(text);
  document.changes = new Map(changes);
}

function reindentCopiedValue(source, difference) {
  if (!difference || !source.includes("\n") && !source.includes("\r")) {
    return source;
  }

  return source.replace(/(\r\n|\n|\r)([ ]*)/g, (match, newline, spaces, offset) => {
    if (offset + match.length === source.length) {
      return newline;
    }

    const width = Math.max(0, spaces.length + difference);

    return `${newline}${" ".repeat(width)}`;
  });
}

function removableAnchorReferences(document, definition, name) {
  const tokens = scanAnchorTokens(document.currentText);
  const definitionToken = tokens.find((token) =>
    token.kind === "anchor"
      && token.name === name
      && token.from >= definition.valueFrom
      && token.from < definition.valueTo
  );

  if (!definitionToken) {
    throw new Error("The shared value name could not be located safely.");
  }

  const references = tokens.filter((token) => {
    if (token.kind !== "alias" || token.name !== name || token.from < definitionToken.to) {
      return false;
    }

    const resolved = tokens
      .filter((candidate) => candidate.kind === "anchor" && candidate.name === name && candidate.from < token.from)
      .at(-1);

    return resolved?.from === definitionToken.from;
  });
  const entries = [];

  for (const token of references) {
    const entry = document.index.entries
      .filter((candidate) => token.from >= candidate.valueFrom && token.to <= candidate.valueTo)
      .sort((left, right) => right.path.length - left.path.length)[0];

    if (!entry || parseAliasName(entry.source) !== name) {
      throw new Error("One of these settings is reused inside a custom YAML value and cannot be expanded safely.");
    }

    if (!entries.some((candidate) => pathKey(candidate.path) === pathKey(entry.path))) {
      entries.push(entry);
    }
  }

  return entries;
}

export function scanAnchorTokens(source) {
  const tokens = [];
  let quote = "";
  let comment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (comment) {
      if (character === "\n" || character === "\r") {
        comment = false;
      }

      continue;
    }

    if (quote) {
      if (quote === "'" && character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === quote && (quote === "'" || source[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "#" && (index === 0 || /\s/.test(source[index - 1]))) {
      comment = true;
      continue;
    }

    if (character !== "&" && character !== "*") {
      continue;
    }

    if (index > 0 && !/[\s\[{:,-]/.test(source[index - 1])) {
      continue;
    }

    const name = /^[A-Za-z0-9_-]+/.exec(source.slice(index + 1))?.[0];

    if (!name) {
      continue;
    }

    const to = index + 1 + name.length;

    if (to < source.length && !/[\s,\]}]/.test(source[to])) {
      continue;
    }

    tokens.push({ kind: character === "&" ? "anchor" : "alias", name, from: index, to });
    index = to - 1;
  }

  return tokens;
}

export function removeDocumentEntry(document, path) {
  if (!document.editable) {
    throw new Error("The visual editor cannot change this file without risking its formatting.");
  }

  const requestedChange = document.changes.get(pathKey(path));
  const removalPath = requestedChange?.kind === "added" && requestedChange.insertedRootPath
    ? requestedChange.insertedRootPath
    : path;
  const entry = document.index.byPath.get(pathKey(removalPath));

  if (!entry) {
    throw new Error("This setting is no longer present in the YAML file.");
  }

  const entryIndex = document.index.entries.indexOf(entry);
  let removalTo = entry.lineTo;

  for (let index = entryIndex + 1; index < document.index.entries.length; index += 1) {
    const candidate = document.index.entries[index];

    if (candidate.indent <= entry.indent) {
      removalTo = candidate.lineFrom;
      break;
    }

    removalTo = Math.max(removalTo, candidate.lineTo, candidate.valueTo);
  }

  if (entryIndex === document.index.entries.length - 1) {
    removalTo = document.currentText.length;
  }

  const previousSource = document.currentText.slice(entry.lineFrom, removalTo);
  const added = requestedChange?.kind === "added";
  clearDescendantChanges(document, removalPath);
  document.currentText = `${document.currentText.slice(0, entry.lineFrom)}${document.currentText.slice(removalTo)}`;
  document.index = indexYamlSource(document.currentText);
  if (added) {
    document.changes.delete(pathKey(path));
    restoreConvertedEmptyMapping(document, requestedChange.convertedParentPath, requestedChange.convertedParentSource);
  } else {
    document.changes.set(pathKey(path), {
      path,
      previousSource,
      nextSource: "Option removed",
      kind: "removed"
    });
  }
}

export function moveDocumentMappingEntry(document, path, direction) {
  if (!document.editable || ![-1, 1].includes(direction) || path.length < 1) {
    throw new Error("This entry cannot be reordered safely.");
  }

  const parentPath = path.slice(0, -1);
  const siblings = document.index.entries.filter((entry) =>
    entry.path.length === path.length
      && parentPath.every((segment, position) => entry.path[position] === segment)
  );
  const index = siblings.findIndex((entry) => samePath(entry.path, path));
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
    return path;
  }

  const firstIndex = Math.min(index, nextIndex);
  const secondIndex = Math.max(index, nextIndex);
  const first = siblings[firstIndex];
  const second = siblings[secondIndex];
  const firstStart = leadingCommentStart(document.currentText, first);
  const secondStart = leadingCommentStart(document.currentText, second);
  const followingEntry = document.index.entries.find((entry) => entry.line > second.line && entry.indent <= second.indent);
  const secondEnd = followingEntry ? leadingCommentStart(document.currentText, followingEntry) : document.currentText.length;
  const firstBlock = document.currentText.slice(firstStart, secondStart);
  const secondBlock = document.currentText.slice(secondStart, secondEnd);
  document.currentText = `${document.currentText.slice(0, firstStart)}${secondBlock}${firstBlock}${document.currentText.slice(secondEnd)}`;
  document.index = indexYamlSource(document.currentText);

  const orderKey = `order:${pathKey(parentPath)}`;
  const currentOrder = siblingOrder(document.index, parentPath);
  const originalOrder = siblingOrder(indexYamlSource(document.originalText), parentPath);

  if (currentOrder.length === originalOrder.length && currentOrder.every((key, position) => key === originalOrder[position])) {
    document.changes.delete(orderKey);
  } else {
    document.changes.set(orderKey, {
      path: parentPath,
      kind: "reordered",
      previousSource: originalOrder.join(", "),
      nextSource: currentOrder.join(", ")
    });
  }

  return path;
}

function siblingOrder(index, parentPath) {
  return directMappingEntries(index, parentPath).map((entry) => entry.key);
}

function directMappingEntries(index, parentPath) {
  return index.entries.filter((entry) =>
    entry.path.length === parentPath.length + 1
      && parentPath.every((segment, position) => entry.path[position] === segment)
  );
}

function leadingCommentStart(source, entry) {
  let start = entry.lineFrom;

  while (start > 0) {
    const previousEnd = /[\r\n]$/.test(source.slice(0, start)) ? start - 1 : start;
    const previousBreak = Math.max(source.lastIndexOf("\n", previousEnd - 1), source.lastIndexOf("\r", previousEnd - 1));
    const lineStart = previousBreak + 1;
    const line = source.slice(lineStart, previousEnd).replace(/\r$/, "");

    if (!line.trimStart().startsWith("#")) {
      break;
    }

    start = lineStart;
  }

  return start;
}

function restoreConvertedEmptyMapping(document, parentPath, originalSource = "{}") {
  if (!parentPath) {
    return;
  }

  const parent = document.index.byPath.get(pathKey(parentPath));

  if (!parent?.container) {
    return;
  }

  const hasChildren = document.index.entries.some((entry) =>
    entry.path.length > parentPath.length && parentPath.every((segment, index) => entry.path[index] === segment)
  );

  if (hasChildren) {
    return;
  }

  const newline = document.lineEndings === "crlf" ? "\r\n" : document.lineEndings === "cr" ? "\r" : "\n";
  const replacement = ` ${originalSource}${parent.source.endsWith(newline) ? newline : ""}`;
  document.currentText = `${document.currentText.slice(0, parent.valueFrom)}${replacement}${document.currentText.slice(parent.valueTo)}`;
  document.index = indexYamlSource(document.currentText);
}

export function documentBytes(document) {
  if (!document.editable || document.currentText === document.originalText) {
    return document.originalBytes;
  }

  const content = UTF8_ENCODER.encode(document.currentText);

  if (!document.hasBom) {
    return content;
  }

  const withBom = new Uint8Array(content.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(content, 3);
  return withBom;
}

export function parseSimpleLiteral(source) {
  const trimmed = source.trim();

  if (/^(?:true|false)$/i.test(trimmed)) {
    return { kind: "boolean", value: trimmed.toLowerCase() === "true" };
  }

  if (/^[+-]?\d+$/.test(trimmed)) {
    return { kind: "integer", value: Number(trimmed) };
  }

  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(trimmed)) {
    return { kind: "decimal", value: Number(trimmed) };
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return { kind: "string", value: unquoteScalar(trimmed), quote: trimmed[0] };
  }

  return { kind: "string", value: trimmed, quote: "" };
}

export function formatStringLiteral(value, originalSource = "") {
  const quote = originalSource.trim().startsWith("'") ? "'" : originalSource.trim().startsWith('"') ? '"' : "";

  if (quote === "'") {
    return `'${String(value).replaceAll("'", "''")}'`;
  }

  if (quote === '"') {
    return JSON.stringify(String(value));
  }

  const stringValue = String(value);
  const unsafe = stringValue === ""
    || /^[-?:,\[\]{}#&*!|>'\"%@`]/.test(stringValue)
    || /:\s|\s#/.test(stringValue)
    || /^(?:null|~|true|false|[-+]?\d+(?:\.\d+)?)$/i.test(stringValue);

  return unsafe ? JSON.stringify(stringValue) : stringValue;
}

export function formatSimpleSequence(entry, values, formatItem = formatStringLiteral) {
  if (!entry.collectionItems) {
    throw new Error("The visual editor cannot change this list without risking its formatting.");
  }

  if (entry.sequenceStyle === "flow") {
    if (values.length === entry.collectionItems.length
      && entry.collectionItems.every((item) => Number.isInteger(item.from) && Number.isInteger(item.to))) {
      let source = entry.source;
      const offset = entry.sequenceOffset ?? 0;

      for (let index = values.length - 1; index >= 0; index -= 1) {
        const item = entry.collectionItems[index];
        const replacement = formatItem(values[index], item.source, index);
        source = `${source.slice(0, offset + item.from)}${replacement}${source.slice(offset + item.to)}`;
      }

      return source;
    }

    return rebuildFlowSequence(entry, values, formatItem);
  }

  if (entry.collectionItems.every((item) => Number.isInteger(item.from) && Number.isInteger(item.to))) {
    return rebuildBlockSequence(entry, values, formatItem);
  }

  if (values.length === 0) {
    return entry.sequencePrefix ? `${entry.sequencePrefix} []` : " []";
  }

  const newline = entry.sequenceNewline || "\n";
  const indentation = " ".repeat(entry.sequenceIndent);
  const lines = values.map((value, index) => {
    const original = entry.collectionItems[index]?.source ?? "";

    return `${indentation}- ${formatItem(value, original, index)}`;
  });

  return `${entry.sequencePrefix ?? ""}${newline}${lines.join(newline)}${entry.sequenceFinalNewline ? newline : ""}`;
}

function rebuildBlockSequence(entry, values, formatItem) {
  const items = entry.collectionItems;
  const newline = entry.sequenceNewline || "\n";

  if (!values.length) {
    const comments = splitLines(entry.source)
      .filter((line) => line.text.trimStart().startsWith("#"))
      .map((line) => `${line.text}${line.ending || newline}`)
      .join("");

    return ` []${comments ? `${newline}${comments}` : ""}`;
  }

  let source = entry.source;
  const replacements = values.slice(0, items.length).map((value, index) => ({
    from: items[index].from,
    to: items[index].to,
    value: formatItem(value, items[index].source, index)
  }));
  const removals = items.slice(values.length).map((item) => ({
    from: item.lineFrom,
    to: item.lineTo,
    value: ""
  }));

  for (const replacement of [...replacements, ...removals].sort((left, right) => right.from - left.from)) {
    source = `${source.slice(0, replacement.from)}${replacement.value}${source.slice(replacement.to)}`;
  }

  if (values.length > items.length) {
    const indentation = " ".repeat(entry.sequenceIndent);
    const additions = values.slice(items.length).map((value, offset) =>
      `${indentation}- ${formatItem(value, "", items.length + offset)}`
    ).join(newline);
    source += `${entry.sequenceFinalNewline ? "" : newline}${additions}${entry.sequenceFinalNewline ? newline : ""}`;
  }

  return source;
}

function rebuildFlowSequence(entry, values, formatItem) {
  const source = entry.source;
  const sequenceOffset = entry.sequenceOffset ?? 0;
  const opening = source.indexOf("[", sequenceOffset);
  const closing = source.lastIndexOf("]");

  if (opening < 0 || closing <= opening) {
    throw new Error("The visual editor cannot safely rebuild this list.");
  }

  const formatted = values.map((value, index) =>
    formatItem(value, entry.collectionItems[index]?.source ?? "", index)
  );

  if (!entry.collectionItems.length) {
    const originalSpacing = source.slice(opening + 1, closing);
    const spacing = /^\s*$/.test(originalSpacing) ? originalSpacing : "";

    return `${source.slice(0, opening + 1)}${spacing}${formatted.join(", ")}${spacing}${source.slice(closing)}`;
  }

  const first = entry.collectionItems[0];
  const last = entry.collectionItems.at(-1);
  const leading = source.slice(opening + 1, sequenceOffset + first.from);
  const trailing = source.slice(sequenceOffset + last.to, closing);
  const separators = entry.collectionItems.slice(0, -1).map((item, index) =>
    source.slice(sequenceOffset + item.to, sequenceOffset + entry.collectionItems[index + 1].from)
  );
  const fallbackSeparator = separators.at(-1) || ", ";
  const body = formatted.map((value, index) =>
    index === 0 ? value : `${separators[index - 1] ?? fallbackSeparator}${value}`
  ).join("");

  return `${source.slice(0, opening + 1)}${leading}${body}${trailing}${source.slice(closing)}`;
}

function ownContainerRanges(entries, text) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (!entry.container) {
      continue;
    }

    let valueTo = entry.lineTo;

    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex += 1) {
      const candidate = entries[nextIndex];

      if (candidate.indent <= entry.indent) {
        valueTo = candidate.lineFrom;
        break;
      }

      valueTo = Math.max(valueTo, candidate.lineTo, candidate.valueTo);
    }

    if (index === entries.length - 1 || entries.slice(index + 1).every((candidate) => candidate.indent > entry.indent)) {
      valueTo = text.length;
    }

    entry.valueTo = valueTo;
    entry.source = text.slice(entry.valueFrom, valueTo);
    entry.advancedOnly = true;
  }
}

function clearDescendantChanges(document, path) {
  for (const [key, change] of document.changes) {
    const descendant = change.path.length > path.length && path.every((segment, index) => change.path[index] === segment);
    const renamedAnchorAtPath = change.kind === "anchor-renamed" && samePath(change.path, path);

    if (descendant || renamedAnchorAtPath) {
      document.changes.delete(key);
    }
  }
}

function anchorChangeKey(path) {
  return `${ANCHOR_CHANGE_PREFIX}${pathKey(path)}`;
}

function annotationChangeKey(path) {
  return `${ANNOTATION_CHANGE_PREFIX}${pathKey(path)}`;
}

function applyAnnotationSet(document, path, annotationIds) {
  const entry = document.index.byPath.get(pathKey(path));

  if (!entry) {
    throw new Error("This setting is no longer present in the file.");
  }

  const newline = document.lineEndings === "crlf" ? "\r\n" : document.lineEndings === "cr" ? "\r" : "\n";
  const originalBlock = document.currentText.slice(entry.commentFrom, entry.commentTo);
  const ordinaryComments = [];

  for (const line of splitLines(originalBlock)) {
    const match = /^([ \t]*#\s*)\[([^\]]+)](.*)$/.exec(line.text);
    const normalized = match?.[2]?.replaceAll(/[-_\s]/g, "").toLocaleLowerCase("en-US");
    const annotation = normalized && INHERITANCE_POLICIES.find((policy) =>
      policy.id.replaceAll("-", "") === normalized || policy.sourceToken.toLocaleLowerCase("en-US") === normalized
    );

    if (!annotation) {
      ordinaryComments.push(`${line.text}${line.ending}`);
      continue;
    }

    const trailingComment = match[3].trim();

    if (trailingComment) {
      ordinaryComments.push(`${match[1]}${trailingComment}${line.ending || newline}`);
    }
  }

  const indentation = " ".repeat(entry.indent);
  const annotationLines = INHERITANCE_POLICIES
    .filter((policy) => annotationIds.has(policy.id))
    .map((policy) => `${indentation}# [${policy.sourceToken}]${newline}`);
  const replacement = `${ordinaryComments.join("")}${annotationLines.join("")}`;

  document.currentText = `${document.currentText.slice(0, entry.commentFrom)}${replacement}${document.currentText.slice(entry.commentTo)}`;
  document.index = indexYamlSource(document.currentText);
}

function restoreOriginalAnnotationBlock(document, path) {
  const current = document.index.byPath.get(pathKey(path));
  const original = indexYamlSource(document.originalText).byPath.get(pathKey(path));

  if (!current) {
    throw new Error("This setting is no longer present in the file.");
  }

  if (!original) {
    applyAnnotationSet(document, path, new Set());
    return;
  }

  const originalBlock = document.originalText.slice(original.commentFrom, original.commentTo);
  document.currentText = `${document.currentText.slice(0, current.commentFrom)}${originalBlock}${document.currentText.slice(current.commentTo)}`;
  document.index = indexYamlSource(document.currentText);
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function samePath(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function pathKey(path) {
  return path.join(PATH_SEPARATOR);
}

function splitLines(text) {
  const lines = [];
  const expression = /.*?(?:\r\n|\n|\r|$)/g;
  let match;

  while ((match = expression.exec(text)) && match[0] !== "") {
    const raw = match[0];
    const ending = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : raw.endsWith("\r") ? "\r" : "";
    lines.push({ text: raw.slice(0, raw.length - ending.length), start: match.index, end: match.index + raw.length, ending });

    if (!ending) {
      break;
    }
  }

  return lines;
}

function findMappingColon(source) {
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && (quote === "'" || source[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ":" && (index === source.length - 1 || /\s/.test(source[index + 1]))) {
      return index;
    }
  }

  return -1;
}

function findInlineComment(source) {
  let quote = "";
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && (quote === "'" || source[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (character === "#" && depth === 0 && (index === 0 || /\s/.test(source[index - 1]))) {
      return index;
    }
  }

  return -1;
}

function readSimpleSequence(lines, parentLine, parentIndent, text, valueFrom) {
  const items = [];
  let lineIndex = parentLine + 1;
  let sequenceIndent = null;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const indentation = /^ */.exec(line.text)?.[0].length ?? 0;

    if (line.text.trim() === "") {
      const nextContent = lines.slice(lineIndex + 1).find((candidate) =>
        candidate.text.trim() !== "" && !candidate.text.trimStart().startsWith("#")
      );
      const nextIndent = nextContent ? /^ */.exec(nextContent.text)?.[0].length ?? 0 : 0;

      if (!nextContent || nextIndent <= parentIndent) {
        break;
      }

      lineIndex += 1;
      continue;
    }

    if (line.text.trimStart().startsWith("#")) {
      if (indentation <= parentIndent) {
        break;
      }

      lineIndex += 1;
      continue;
    }

    if (indentation <= parentIndent) {
      break;
    }

    if (sequenceIndent === null) {
      sequenceIndent = indentation;
    }

    const trimmed = line.text.slice(indentation);

    if (indentation !== sequenceIndent || !trimmed.startsWith("- ")) {
      return null;
    }

    const itemSource = trimmed.slice(2).trimEnd();
    const syntax = classifySequenceItem(itemSource);

    if (!itemSource
      || findInlineComment(itemSource) >= 0
      || (findMappingColon(itemSource) >= 0 && syntax?.kind !== "sequence-merge")
      || (isAdvancedLiteral(itemSource) && !syntax)) {
      return null;
    }

    const from = line.start + indentation + 2 - valueFrom;
    items.push({
      source: itemSource,
      line: lineIndex + 1,
      from,
      to: from + itemSource.length,
      lineFrom: line.start - valueFrom,
      lineTo: line.end - valueFrom
    });
    lineIndex += 1;
  }

  if (!items.length) {
    return null;
  }

  const lastLine = lines[lineIndex - 1];

  return {
    items,
    indent: sequenceIndent,
    endLine: lineIndex - 1,
    valueTo: lastLine.end,
    finalNewline: Boolean(lastLine.ending),
    newline: lines[parentLine].ending || lastLine.ending || detectSequenceNewline(text, valueFrom)
  };
}

function readAnchoredSequence(lines, parentLine, parentIndent, text, valueFrom) {
  const simple = readSimpleSequence(lines, parentLine, parentIndent, text, valueFrom);

  if (simple) {
    return simple;
  }

  let firstContent = parentLine + 1;

  while (firstContent < lines.length
    && (lines[firstContent].text.trim() === "" || lines[firstContent].text.trimStart().startsWith("#"))) {
    firstContent += 1;
  }

  if (firstContent >= lines.length) {
    return null;
  }

  const firstIndent = /^ */.exec(lines[firstContent].text)?.[0].length ?? 0;

  if (firstIndent <= parentIndent || !lines[firstContent].text.slice(firstIndent).startsWith("-")) {
    return null;
  }

  let endLine = firstContent;

  for (let lineIndex = firstContent + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const indentation = /^ */.exec(line.text)?.[0].length ?? 0;

    if (line.text.trim() !== "" && indentation <= parentIndent) {
      break;
    }

    endLine = lineIndex;
  }

  return { endLine, valueTo: lines[endLine].end, source: text.slice(valueFrom, lines[endLine].end) };
}

function readSimpleFlowSequence(value) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }

  const body = trimmed.slice(1, -1);

  if (!body.trim()) {
    return { items: [] };
  }

  const items = [];
  let quote = "";
  const stack = [];
  const pairs = new Map([["[", "]"], ["{", "}"], ["(", ")"]]);
  let start = 0;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (quote) {
      if (character === quote && (quote === "'" || body[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (pairs.has(character)) {
      stack.push(pairs.get(character));
    } else if (stack.at(-1) === character) {
      stack.pop();
    } else if (character === "," && stack.length === 0) {
      const item = flowSequenceItem(body, start, index);

      if (!item) {
        return null;
      }

      items.push(item);
      start = index + 1;
    }
  }

  if (quote || stack.length) {
    return null;
  }

  const item = flowSequenceItem(body, start, body.length);

  if (!item) {
    return null;
  }

  items.push(item);
  return { items };
}

function flowSequenceItem(body, start, end) {
  let from = start;
  let to = end;

  while (from < to && /\s/.test(body[from])) {
    from += 1;
  }

  while (to > from && /\s/.test(body[to - 1])) {
    to -= 1;
  }

  const source = body.slice(from, to);

  if (!source || findInlineComment(source) >= 0) {
    return null;
  }

  return { source, from: from + 1, to: to + 1 };
}

function readFlowSequence(text, valueFrom, parentLine) {
  let opening = valueFrom;

  while (text[opening] === " " || text[opening] === "\t") {
    opening += 1;
  }

  while (text[opening] === "&" || text[opening] === "!") {
    while (opening < text.length && !/\s/.test(text[opening])) {
      opening += 1;
    }

    while (text[opening] === " " || text[opening] === "\t") {
      opening += 1;
    }
  }

  if (text[opening] !== "[") {
    return null;
  }

  let quote = "";
  let depth = 0;

  for (let index = opening; index < text.length; index += 1) {
    const character = text[index];

    if (quote) {
      if (character === quote && (quote === "'" || text[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      const valueTo = index + 1;
      const parsed = readSimpleFlowSequence(text.slice(opening, valueTo));
      const linesOwned = text.slice(valueFrom, valueTo).match(/\r\n|\n|\r/g)?.length ?? 0;

      return {
        valueTo,
        endLine: parentLine + linesOwned,
        prefix: text.slice(valueFrom, opening),
        sequenceOffset: opening - valueFrom,
        items: parsed?.items ?? null
      };
    } else if (character === "#" && (index === opening || /\s/.test(text[index - 1]))) {
      return null;
    }
  }

  return null;
}

function detectSequenceNewline(text, offset) {
  const next = text.slice(offset).match(/\r\n|\n|\r/);

  return next?.[0] ?? "\n";
}

function endOfMapping(document, parent) {
  const parentIndex = document.index.entries.indexOf(parent);
  let insertionAt = parent.lineTo;

  for (let index = parentIndex + 1; index < document.index.entries.length; index += 1) {
    const entry = document.index.entries[index];

    if (entry.indent <= parent.indent) {
      return entry.lineFrom;
    }

    insertionAt = Math.max(insertionAt, entry.lineTo);
  }

  return insertionAt;
}

function detectIndentStep(document, parent) {
  const child = document.index.entries.find((entry) =>
    entry.path.length === parent.path.length + 1
      && entry.path.slice(0, -1).every((segment, index) => segment === parent.path[index])
  );

  return child ? Math.max(1, child.indent - parent.indent) : 2;
}

function detectRootIndentStep(document) {
  const nested = document.index.entries.find((entry) => entry.indent > 0);

  return nested ? nested.indent : 2;
}

function formatMappingKey(key) {
  const plainString = /^[A-Za-z_()<>][A-Za-z0-9_()<>.-]*$/.test(key)
    && !/^(?:true|false|null|~|<<)$/i.test(key);

  return plainString ? key : JSON.stringify(key);
}

function parseMappingKey(rawKey) {
  if (!rawKey || rawKey === "?") {
    return null;
  }

  if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
    return unquoteScalar(rawKey);
  }

  return rawKey;
}

function unquoteScalar(value) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value.slice(1, -1).replaceAll("''", "'");
}

function isAdvancedLiteral(value) {
  const trimmed = value.trim();

  return trimmed.startsWith("*")
    || trimmed.startsWith("&")
    || trimmed.startsWith("!")
    || trimmed.startsWith("[")
    || trimmed.startsWith("{");
}

function isAnchorOnly(value) {
  return /^&[^\s,[\]{}]+$/.test(value.trim());
}

function cleanComment(source) {
  return source.replace(/^#+\s?/, "").trim();
}

function detectLineEndings(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replaceAll("\r\n", "");
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const modes = [crlf, lf, cr].filter((count) => count > 0).length;

  if (modes > 1) {
    return "mixed";
  }

  if (crlf) {
    return "crlf";
  }

  if (cr) {
    return "cr";
  }

  return "lf";
}

function emptyIndex() {
  return { entries: [], byPath: new Map(), warnings: [], unsupported: false };
}

function unique(values) {
  return [...new Set(values)];
}
