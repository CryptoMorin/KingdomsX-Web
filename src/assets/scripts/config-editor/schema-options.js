import { unwrapNullable } from "./schema-types.js";
import { helpForSetting } from "./setting-guidance.js";

export function labelForKey(key) {
  return key
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function labelForSection(schemaId, key, fallback = labelForKey(key)) {
  if (schemaId === "guis/schema") {
    if (key === "options") {
      return "Options (Buttons)";
    }

    if (key === "[permission]") {
      return "Permission Buttons";
    }

    if (key === "[type]") {
      return "Log Entry Buttons";
    }

    const dynamic = /^\[([^\]]+)]$/.exec(key);

    if (dynamic && !dynamic[1].startsWith("fn-")) {
      return `${labelForKey(dynamic[1])} Buttons`;
    }
  }

  return fallback;
}

export function optionHelp(entry, type) {
  const fromComments = entry?.comments?.length ? entry.comments.join(" ") : "";
  const fromType = type?.description ?? unwrapNullable(type)?.description ?? "";
  let help;

  if (fromComments && fromType && fromType !== fromComments && !fromComments.includes(fromType)) {
    help = `${fromComments} ${fromType}`;
  } else {
    help = fromComments || fromType || "";
  }

  return displayHelpText(help);
}

export function displayHelpText(text) {
  return String(text ?? "").replace(/"default"/gi, "default");
}

export function optionFamilyHelp(entry, type, path = [], schemaId = "") {
  return helpForSetting({
    schemaId,
    path,
    key: entry?.key,
    typeNames: guidanceTypeNames(type),
    syntax: entry?.syntax,
    comments: entry?.comments
  });
}

function guidanceTypeNames(type, seen = new Set()) {
  if (!type || seen.has(type)) {
    return [];
  }

  seen.add(type);

  if (type.kind === "nullable" || type.kind === "reference") {
    return guidanceTypeNames(type.kind === "nullable" ? type.value : type.target, seen);
  }

  if (type.kind === "union") {
    return [...new Set(type.choices.flatMap((choice) => guidanceTypeNames(choice, seen)))];
  }

  return [type.kind, type.typeName, type.language].filter(Boolean);
}
