export const INHERITANCE_POLICIES = Object.freeze([
  { id: "final", sourceToken: "Final", label: "Final", description: "An imported parent config cannot replace this value." },
  { id: "ignore-if-set", sourceToken: "IgnoreIfSet", label: "Ignore if set", description: "Keep this value when the imported parent also provides one." },
  { id: "no-sync", sourceToken: "NoSync", label: "No sync", description: "Keep this value unchanged when GUI settings are synchronized." }
]);

const annotationsByToken = new Map(INHERITANCE_POLICIES.map((annotation) => [
  annotation.sourceToken.replaceAll(/[-_\s]/g, "").toLocaleLowerCase("en-US"),
  annotation
]));

export function annotationsFromComments(comments = []) {
  const annotations = [];

  for (const comment of comments) {
    for (const match of comment.matchAll(/^\[([^\]]+)](?:\s|$)/g)) {
      const annotation = annotationsByToken.get(match[1].replaceAll(/[-_\s]/g, "").toLocaleLowerCase("en-US"));

      if (annotation && !annotations.some((candidate) => candidate.id === annotation.id)) {
        annotations.push(annotation);
      }
    }
  }

  return annotations;
}

export function classifyKingdomsEntry(entry, moduleParameters = []) {
  const key = entry.key;
  const source = entry.source.trim();

  if (key === "(module)") {
    return syntax("module", "Parent template contract");
  }

  if (key === "(import)") {
    return syntax("import", "Inherits parent templates");
  }

  if (/^&fn-[^\s]+/.test(source)) {
    return syntax("function-declaration", "Entry template");
  }

  if (key === "[fn]" && /^\*fn-[A-Za-z0-9_-]+$/.test(source)) {
    return syntax("named-function-call", "Generated entry");
  }

  if (key === "<<" && parseFunctionCall(source)) {
    return syntax("function-merge", "Includes generated settings");
  }

  if (key === "<<" && /^\*[A-Za-z0-9_-]+$/.test(source)) {
    return syntax("mapping-merge", "Adds shared settings");
  }

  if (parseFunctionCall(source)) {
    return syntax("function-call", "Generated entry");
  }

  if (entry.path.includes("anchors") && parseImportedAnchor(source)) {
    return syntax("imported-anchor", "Imports parent value");
  }

  if (parseAliasName(source)) {
    return syntax("alias", "Linked to shared value");
  }

  if (parseAnchorName(source)) {
    return syntax("anchor", "Shared value");
  }

  if (/^[|>][+\-]?\d?/.test(source)) {
    return syntax("block-scalar", "Multiline text");
  }

  if (/\{\?/.test(source)) {
    return syntax("conditional-message", "Conditional message", false);
  }

  if (/hover:\{/.test(source)) {
    return syntax("interactive-message", "Interactive message", false);
  }

  if (moduleParameters.some((parameter) => parameter && (entry.key.includes(parameter) || source.includes(parameter)))) {
    return syntax("module-template", "Uses template input");
  }

  if (/\[\*[A-Za-z0-9_-]+]/.test(source)) {
    return syntax("imported-anchor-template", "Uses imported value");
  }

  if (/<[^<>\r\n]+>/.test(source)) {
    return syntax("module-template", "Uses template input");
  }

  return null;
}

export function classifySequenceItem(source, parentPath = []) {
  const trimmed = source.trim();

  if (parseSequenceMerge(trimmed)) {
    return syntax("sequence-merge", "Includes shared list items");
  }

  if (parseFunctionCall(trimmed)) {
    return syntax("function-call", "Generated entry");
  }

  if (parseImportedAnchor(trimmed)) {
    return parentPath.at(-1) === "anchors"
      ? syntax("imported-anchor", "Imported shared value")
      : syntax("anchor", "Shared value");
  }

  if (parseAnchorName(trimmed)) {
    return syntax("anchor", "Shared value");
  }

  if (/^\*[A-Za-z0-9_-]+$/.test(trimmed)) {
    return syntax("alias", "Linked to shared value");
  }

  return null;
}

export function parseSequenceMerge(source) {
  const match = /^(<{1,2}):\s*\*([A-Za-z0-9_-]+)$/.exec(String(source).trim());

  return match ? { operator: match[1], anchor: match[2] } : null;
}

export function parseFunctionCall(source) {
  const match = /^\s*\*([A-Za-z0-9_-]+)\s*(\[[\s\S]*])\s*$/.exec(source);

  if (!match) {
    return null;
  }

  const args = splitTopLevel(match[2].slice(1, -1));

  return args ? { name: match[1], args } : null;
}

export function formatFunctionCall(name, args) {
  const safeName = String(name).trim().replace(/[^A-Za-z0-9_-]/g, "");

  return `*${safeName || "fn-name"} [ ${args.map((argument) => String(argument).trim()).join(", ")} ]`;
}

export function parseImportedAnchor(source) {
  const match = /^\s*&([A-Za-z0-9_-]+)\s+([A-Za-z0-9_-]+)\s*$/.exec(source);

  return match ? { localName: match[1], parentName: match[2] } : null;
}

export function parseAnchoredValue(source) {
  const match = /^\s*&([A-Za-z0-9_-]+)\s+([\s\S]+)$/.exec(String(source));

  return match ? { name: match[1], value: match[2] } : null;
}

export function parseAnchorName(source) {
  return /^\s*&([A-Za-z0-9_-]+)(?:\s|$)/.exec(String(source))?.[1] ?? null;
}

export function parseAliasName(source) {
  return /^\s*\*([A-Za-z0-9_-]+)\s*$/.exec(String(source))?.[1] ?? null;
}

export function formatImportedAnchor(localName, parentName) {
  const clean = (value) => String(value).trim().replace(/[^A-Za-z0-9_-]/g, "");

  return `&${clean(localName) || "local-anchor"} ${clean(parentName) || "parent-anchor"}`;
}

export function formatAnchoredValue(name, value) {
  const cleanName = String(name).trim().replace(/[^A-Za-z0-9_-]/g, "");

  return `&${cleanName || "anchor"} ${String(value)}`;
}

export function formatSequenceMerge(operator, anchor) {
  const mergeOperator = operator === "<" ? "<" : "<<";
  const cleanAnchor = String(anchor).trim().replace(/[^A-Za-z0-9_-]/g, "");

  return `${mergeOperator}: *${cleanAnchor || "shared"}`;
}

export function parseBlockScalar(source) {
  const firstNewline = source.search(/\r\n|\n|\r/);

  if (firstNewline < 0 || !/^[|>][+\-]?\d?(?:\s|$)/.test(source.slice(0, firstNewline))) {
    return null;
  }

  const newline = source.slice(firstNewline).match(/^(?:\r\n|\n|\r)/)?.[0] ?? "\n";
  const header = source.slice(0, firstNewline);
  const body = source.slice(firstNewline + newline.length);
  const contentLines = body.split(/\r\n|\n|\r/);
  const indents = contentLines.filter((line) => line.trim()).map((line) => /^ */.exec(line)?.[0].length ?? 0);
  const indentation = indents.length ? Math.min(...indents) : 2;
  const content = contentLines.map((line) => line.slice(Math.min(indentation, /^ */.exec(line)?.[0].length ?? 0))).join(newline);

  return { header, newline, indentation, content };
}

export function formatBlockScalar(block, content) {
  const indentation = " ".repeat(block.indentation);
  const lines = String(content).split(/\r\n|\n|\r/);
  const body = lines.map((line) => line ? `${indentation}${line}` : "").join(block.newline);

  return `${block.header}${block.newline}${body}`;
}

export function parseSoundSpec(value) {
  const parts = splitTopLevel(String(value), ",");

  if (!parts?.length || parts.length > 4) {
    return null;
  }

  let target = parts[0].trim();
  const relative = target.startsWith("~");

  if (relative) {
    target = target.slice(1);
  }

  const at = target.indexOf("@");
  const category = at > 0 ? target.slice(0, at).trim() : "";
  const sound = (at > 0 ? target.slice(at + 1) : target).trim();

  if (!sound) {
    return null;
  }

  return {
    relative,
    category,
    sound,
    volume: parts[1]?.trim() ?? "",
    pitch: parts[2]?.trim() ?? "",
    seed: parts[3]?.trim() ?? "",
    partCount: parts.length
  };
}

export function formatSoundSpec(value) {
  const target = `${value.relative ? "~" : ""}${value.category ? `${value.category}@` : ""}${value.sound.trim()}`;
  const optional = [value.volume, value.pitch, value.seed].map((part) => String(part ?? "").trim());
  let last = Math.max((value.partCount ?? 1) - 2, optional.findLastIndex((part) => part !== ""));

  while (last >= 0 && optional[last] === "" && last >= (value.partCount ?? 1) - 1) {
    last -= 1;
  }

  return [target, ...optional.slice(0, last + 1)].join(", ");
}

export function parsePotionSpec(value) {
  const match = /^\s*([^,]+),\s*([^,]+),\s*([^,\s]+)(?:\s+%(\d+(?:\.\d+)?))?\s*$/.exec(String(value));

  if (!match) {
    return null;
  }

  return { effect: match[1].trim(), duration: match[2].trim(), level: match[3].trim(), chance: match[4] ?? "" };
}

export function formatPotionSpec(value) {
  const chance = String(value.chance ?? "").trim();

  return `${value.effect.trim()}, ${value.duration.trim()}, ${value.level.trim()}${chance ? ` %${chance}` : ""}`;
}

export function parseStringMatcher(value) {
  const match = /^(REGEX@CI|REGEX|CONTAINS|STARTS|ENDS|CI):(.*)$/s.exec(String(value));

  return match ? { mode: match[1], value: match[2] } : { mode: "EXACT", value: String(value) };
}

export function parseCommandSpec(value) {
  const match = /^(CONSOLE|PLAYER|OP):(.*)$/s.exec(String(value));

  return match ? { executor: match[1], command: match[2] } : { executor: "DEFAULT", command: String(value) };
}

export function formatCommandSpec(executor, command) {
  return executor === "DEFAULT" ? String(command) : `${executor}:${command}`;
}

export function formatStringMatcher(mode, value) {
  return mode === "EXACT" ? String(value) : `${mode}:${value}`;
}

export function expressionProblem(value, language) {
  const source = String(value);
  const pairs = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
  const closing = new Set(pairs.values());
  const stack = [];
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && (quote === "'" || source[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if ((character === "'" || character === '"') && startsQuotedSegment(source, index)) {
      quote = character;
    } else if (pairs.has(character)) {
      stack.push(pairs.get(character));
    } else if (closing.has(character) && stack.pop() !== character) {
      return `Unexpected ${character}.`;
    }
  }

  if (quote) {
    return "A quoted value is not closed.";
  }

  if (stack.length) {
    return `Missing ${stack.at(-1)}.`;
  }

  if (language === "regex") {
    try {
      new RegExp(source);
    } catch (error) {
      return error.message;
    }
  }

  return "";
}

export function splitTopLevel(source, separator = ",") {
  if (!source.trim()) {
    return [];
  }

  const values = [];
  const stack = [];
  const pairs = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
  let quote = "";
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && (quote === "'" || source[index - 1] !== "\\")) {
        quote = "";
      }

      continue;
    }

    if ((character === "'" || character === '"') && startsQuotedSegment(source, index)) {
      quote = character;
    } else if (pairs.has(character)) {
      stack.push(pairs.get(character));
    } else if (stack.at(-1) === character) {
      stack.pop();
    } else if (character === separator && stack.length === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || stack.length) {
    return null;
  }

  values.push(source.slice(start).trim());
  return values;
}

function startsQuotedSegment(source, index) {
  return index === 0 || /[\s[({,:?=]/.test(source[index - 1]);
}

function syntax(kind, label, showBadge = true) {
  return showBadge ? { kind, label } : { kind, label, showBadge: false };
}
