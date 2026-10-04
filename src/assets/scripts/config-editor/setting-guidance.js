import { editorOverrides } from "./editor-overrides.js";

const guidance = editorOverrides.settingGuidance.map((entry) => ({
  ...entry,
  pathPattern: compile(entry.pathPattern),
  keyPattern: compile(entry.keyPattern),
  typePattern: compile(entry.typePattern),
  commentsPattern: compile(entry.commentsPattern)
}));

export function helpForSetting(field = {}) {
  const context = {
    schemaId: field.schemaId ?? "",
    path: field.path ?? [],
    key: field.key ?? field.path?.at(-1) ?? "",
    typeNames: field.typeNames ?? [field.typeName ?? field.type?.typeName ?? ""],
    syntax: field.syntax?.kind ?? field.syntax ?? "",
    comments: Array.isArray(field.comments) ? field.comments.join(" ") : String(field.comments ?? "")
  };
  const match = guidance.find((entry) => matches(entry, context));

  return match ? { id: match.id, title: match.title, body: match.body } : null;
}

function matches(rule, context) {
  const constraints = [
    rule.schemaId && context.schemaId === rule.schemaId,
    rule.root && context.path[0] === rule.root,
    rule.syntax && context.syntax === rule.syntax,
    rule.pathPattern?.test([...context.path, context.key].filter(Boolean).join(".")),
    rule.keyPattern?.test(context.key),
    rule.typePattern && context.typeNames.some((typeName) => rule.typePattern.test(typeName)),
    rule.commentsPattern?.test(context.comments)
  ].filter((value) => value !== undefined);

  return constraints.length > 0 && constraints.every(Boolean);
}

function compile(pattern) {
  return pattern ? new RegExp(pattern, "i") : undefined;
}
