import {
  classifySequenceItem,
  formatAnchoredValue,
  formatBlockScalar,
  parseAliasName,
  parseAnchoredValue,
  parseBlockScalar
} from "./kingdoms-yaml.js";
import { formatSimpleSequence, formatStringLiteral, parseSimpleLiteral } from "./yaml-source.js";

export function loreText(entry) {
  const anchored = parseAnchoredValue(entry.source);
  const anchoredBlock = anchored && parseBlockScalar(anchored.value);

  if (anchoredBlock) {
    return anchoredBlock.content;
  }

  if (entry.blockScalar) {
    return entry.blockScalar.content;
  }

  if (entry.collectionItems) {
    return entry.collectionItems
      .map((item) => String(parseSimpleLiteral(item.source).value))
      .join("\n");
  }

  const literal = parseSimpleLiteral(entry.source);

  if (literal.kind === "null") {
    return "";
  }

  return String(literal.value);
}

export function lorePreviewText(entry, index = null) {
  if (!entry.collectionItems) {
    return loreText(entry);
  }

  return entry.collectionItems.map((item) => {
    const anchored = parseAnchoredValue(item.source);

    if (anchored) {
      return scalarText(anchored.value);
    }

    const alias = parseAliasName(item.source);

    if (!alias || !index) {
      return scalarText(item.source);
    }

    const source = anchorSourceBefore(index, alias, item.line ?? entry.line ?? Number.POSITIVE_INFINITY);

    return source === null ? scalarText(item.source) : scalarText(source);
  }).join("\n");
}

function anchorSourceBefore(index, name, beforeLine) {
  let source = null;

  for (const entry of index.entries) {
    if ((entry.line ?? Number.POSITIVE_INFINITY) >= beforeLine) {
      break;
    }

    const scalar = parseAnchoredValue(entry.source);

    if (scalar?.name === name) {
      source = scalar.value;
    }

    for (const item of entry.collectionItems ?? []) {
      if ((item.line ?? Number.POSITIVE_INFINITY) >= beforeLine) {
        break;
      }

      const anchored = parseAnchoredValue(item.source);

      if (anchored?.name === name) {
        source = anchored.value;
      }
    }
  }

  return source;
}

function scalarText(source) {
  const literal = parseSimpleLiteral(source);

  return literal.kind === "null" ? "" : String(literal.value);
}

export function formatLoreText(entry, text) {
  if (text === loreText(entry)) {
    return entry.source;
  }

  const anchored = parseAnchoredValue(entry.source);
  const anchoredBlock = anchored && parseBlockScalar(anchored.value);

  if (anchoredBlock) {
    return formatAnchoredValue(anchored.name, formatBlockScalar(anchoredBlock, text));
  }

  if (entry.blockScalar) {
    return formatBlockScalar(entry.blockScalar, text);
  }

  const lines = text === "" ? [] : text.split(/\r\n|\n|\r/);

  if (entry.collectionItems) {
    return formatSimpleSequence(entry, lines, (value, original) =>
      classifySequenceItem(value) ? value : formatStringLiteral(value, original)
    );
  }

  if (lines.length === 0) {
    return "[]";
  }

  if (lines.length === 1) {
    if (/^\*[A-Za-z0-9_-]+$/.test(lines[0].trim())) {
      return lines[0].trim();
    }

    return formatStringLiteral(lines[0], entry.source);
  }

  return `[ ${lines.map((line) => formatStringLiteral(line)).join(", ")} ]`;
}
