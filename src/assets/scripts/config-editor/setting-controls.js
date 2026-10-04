import Sortable from "sortablejs";
import { describeType, unwrapNullable } from "./schema-types.js";
import {
  canAddDocumentAnchor,
  canReuseDocumentAnchor,
  formatSimpleSequence,
  formatStringLiteral,
  indexYamlSource,
  parseSimpleLiteral
} from "./yaml-source.js";
import { labelForKey, optionHelp, optionFamilyHelp } from "./schema-options.js";
import { DURATION_UNITS, formatDuration, parseDurationLiteral } from "./value-controls.js";
import {
  classifySequenceItem,
  expressionProblem,
  formatAnchoredValue,
  formatBlockScalar,
  formatCommandSpec,
  formatFunctionCall,
  formatImportedAnchor,
  formatPotionSpec,
  formatSequenceMerge,
  formatSoundSpec,
  formatStringMatcher,
  parseAliasName,
  parseAnchorName,
  parseAnchoredValue,
  parseBlockScalar,
  parseCommandSpec,
  parseFunctionCall,
  parseImportedAnchor,
  parsePotionSpec,
  parseSequenceMerge,
  parseSoundSpec,
  parseStringMatcher
} from "./kingdoms-yaml.js";
import { attachRegistry, registryContains, registryForType } from "./spigot-registry.js";
import { createMappingKeyControl, mappingValueLabelForKey } from "./mapping-key-control.js";
import { optionPathMarker } from "./navigation.js";
import { formatLoreText, loreText } from "./lore-value.js";
import { colorValuePreviewElement, messageInsertToolbar, messagePreviewElement, readableCondition } from "./message-preview.js";
import { conditionCalculator, expressionAssist, expressionCalculator } from "./expression-assist.js";
import { materialIconElement, updateMaterialIcon } from "./material-icon.js";
import {
  loadMinecraftSounds,
  minecraftSoundPlayback,
  resolveMinecraftSound
} from "./minecraft-sounds.js";
import { resolveMessageMacros } from "./message-macros.js";
import { openRichValueDialog, richExpressionPreview, richValueTrigger } from "./rich-value-dialog.js";
import { appendDescriptionText } from "./description-links.js";

let labeledControlId = 0;
let settingLabelId = 0;
let activeSoundPreview = null;

export function renderOptionField({
  field,
  schemaId = "",
  changed,
  editable = true,
  onChange,
  onUndo,
  onResetDefault,
  onRemove,
  onRename,
  onMoveUp,
  onMoveDown,
  onRevealAnchor,
  onResolveAnchor,
  onRenameAnchor,
  onRemoveAnchor,
  onDetachAnchor,
  onDetachListAnchor,
  onRemoveListAnchor,
  onRevealListAnchor,
  onResolveListAnchor,
  onListAnchorNames,
  onCreateAnchor,
  onUseAnchor,
  onAddMessageEffect,
  onEditAnnotations,
  onNavigateTemplate,
  templateContext = null,
  templateDefinitions = [],
  anchorNames = [],
  defaultOption = null,
  defaultSource = "",
  originalSource = "",
  availableGuiSlots = [],
  messageTokens = [],
  messageMacros = null
}) {
  const { path, type, entry, removal, keyEditable, keyType } = field;
  const resolvedType = type ?? inferType(entry, schemaId);
  const conditionMapping = keyType?.kind === "expression" && keyType.language === "condition";
  const dynamicValueLabel = keyEditable && !conditionMapping
    ? mappingValueLabelForKey(keyType, resolvedType) || mappingValueLabel(resolvedType)
    : "";
  const row = element("article", "editor-setting surface-panel position-relative d-block d-md-grid rounded-3");
  const description = element("div", "min-w-0");
  const heading = element("div", "editor-setting-heading d-flex align-items-start justify-content-between gap-3");
  const titleBlock = element("div", "min-w-0");
  const optionLabel = field.presentationLabel ?? labelForKey(String(entry.key ?? ""));
  let titleId = "";

  if (keyEditable) {
    titleBlock.classList.add("w-100");
    titleBlock.append(createMappingKeyControl({ path, keyType, value: entry.key, onRename }));
  } else {
    const titleRow = element("div", "editor-setting-title-row d-flex flex-wrap align-items-center gap-2 min-w-0");
    const title = element("h3", "editor-setting-title editor-item-title mb-0", optionLabel);
    titleId = `editor-setting-label-${++settingLabelId}`;
    title.id = titleId;
    titleRow.append(
      title,
      element("code", "editor-setting-key d-block", String(entry.key ?? ""))
    );
    titleBlock.append(titleRow);
  }

  const badges = element("div", "d-flex flex-wrap justify-content-end gap-2");

  if (entry.syntax && entry.syntax.showBadge !== false) {
    badges.append(badge(entry.syntax.label, "syntax"));
  }

  for (const annotation of entry.annotations ?? []) {
    const annotationBadge = badge(annotation.label, "annotation");
    annotationBadge.title = annotation.description;
    badges.append(annotationBadge);
  }

  heading.append(titleBlock);

  if (badges.childElementCount) {
    heading.append(badges);
  }

  if (!editable && keyEditable) {
    disableControls(titleBlock);
  }

  let help = optionHelp(entry, resolvedType);

  if (dynamicValueLabel && equivalentLabels(help, dynamicValueLabel)) {
    help = "";
  }

  const nullLabel = nullOptionLabel(help);
  const familyHelp = optionFamilyHelp(entry, resolvedType, path, schemaId);

  description.append(heading);

  if (help) {
    description.append(descriptionParagraph("editor-setting-help text-break mb-0", help));
  } else if (familyHelp) {
    description.append(descriptionParagraph("editor-setting-help text-break mb-0", familyHelp.body));
  }

  if (defaultOption) {
    description.append(defaultValueNotice(defaultOption, resolvedType, optionLabel));
  }

  if (entry.annotations?.length) {
    description.append(inheritancePolicySummary(entry.annotations));
  }

  if (templateContext?.kind === "module-template") {
    const names = templateContext.parameters.map((parameter) => parameter.label).join(", ");
    const behavior = templateContext.wholeNode
      ? "replaces the whole value"
      : templateContext.inKey
        ? "is substituted into the setting name"
        : templateContext.inList
          ? "can insert one or more list items"
          : "is substituted inside this value";
    description.append(element("p", "editor-template-usage mb-0 mt-2", `Template input: ${names} · ${behavior}.`));
  }

  if (templateContext?.kind === "imported-anchor-template") {
    description.append(element("p", "editor-template-usage mb-0 mt-2", `Imported ${templateContext.references.length === 1 ? "value" : "values"}: ${templateContext.references.join(", ")}.`));
  }

  if (templateContext?.kind === "import-parameter" && templateContext.parameter) {
    const parameter = templateContext.parameter;
    description.append(element("p", "editor-template-usage mb-0 mt-2", `Parent-template input · ${parameter.type}${parameter.required ? " · required" : ` · parent default: ${parameter.defaultValue}`}.`));
  }

  const value = element("div", "editor-setting-value min-w-0 mt-3 mt-md-0");
  const anchorActions = {
    reveal: onRevealAnchor,
    resolve: onResolveAnchor,
    rename: onRenameAnchor,
    remove: onRemoveAnchor,
    detach: onDetachAnchor,
    detachList: onDetachListAnchor,
    removeList: onRemoveListAnchor,
    revealList: onRevealListAnchor,
    create: onCreateAnchor,
    use: onUseAnchor,
    resolveList: onResolveListAnchor,
    listNames: onListAnchorNames,
    names: anchorNames
  };
  let rendered = createControl(resolvedType, {
    ...entry,
    nullLabel,
    defaultSource,
    originalSource,
    availableGuiSlots,
    messageTokens,
    messageMacros,
    templateContext,
    templateDefinitions,
    onNavigateTemplate,
    anchorNames
  }, onChange, anchorActions);

  if (templateContext?.kind === "imported-anchor-template" && templateContext.resolved?.length && onNavigateTemplate) {
    const reference = element("div", "d-flex flex-wrap gap-2");

    for (const resolved of templateContext.resolved) {
      if (!resolved.declarationPath) {
        continue;
      }

      const reveal = button(
        resolved.parentPath ? `Open imported value ${resolved.name}` : `Show import for ${resolved.name}`,
        "fa-solid fa-arrow-up-right-from-square",
        "btn btn-sm btn-site-secondary"
      );
      reveal.addEventListener("click", () => onNavigateTemplate(resolved.parentPath
        ? { fileName: resolved.parentFileName, path: resolved.parentPath }
        : { path: resolved.declarationPath }));
      reference.append(reveal);
    }

    if (reference.childElementCount) {
      const wrapper = element("div", "d-grid gap-2");
      wrapper.append(rendered, reference);
      rendered = wrapper;
    }
  }

  if (entry.syntax?.kind === "anchor" && entry.collectionItems) {
    rendered = reusableRelationshipFlow(
      rendered,
      reusableValueNotice(entry, anchorActions.rename, anchorActions.remove)
    );
  }

  if (!editable) {
    disableControls(rendered);
  }

  if (conditionMapping) {
    const label = keyType.allowFallback && entry.key === "else"
      ? "Fallback output"
      : "Output when this condition matches";
    rendered.matches("input, select, textarea")
      ? rendered.setAttribute("aria-label", label)
      : rendered.querySelector("input, select, textarea")?.setAttribute("aria-label", label);
    if (supportsFloatingLabel(rendered)) {
      rendered = labeledControl(label, rendered);
    } else {
      value.classList.add("d-grid", "gap-2");
      value.append(element("span", "editor-subfield-label fw-bold", label));
    }
  } else if (dynamicValueLabel) {
    rendered = labeledControl(dynamicValueLabel, rendered);
  }

  if (titleId) {
    labelOptionControls(rendered, optionLabel, titleId);
  }

  value.append(rendered);

  const actions = element("div", "editor-setting-actions d-flex align-items-center justify-content-end align-self-start gap-1");

  if (editable && onMoveUp) {
    const moveUp = iconButton("Move this condition up", "fa-solid fa-arrow-up", "editor-icon-button editor-interactive-surface d-inline-grid");
    moveUp.addEventListener("click", onMoveUp);
    actions.append(moveUp);
  }

  if (editable && onMoveDown) {
    const moveDown = iconButton(
      entry.key === "else" ? "Move fallback toward the end" : "Move this condition down",
      "fa-solid fa-arrow-down",
      "editor-icon-button editor-interactive-surface d-inline-grid"
    );
    moveDown.addEventListener("click", onMoveDown);
    actions.append(moveDown);
  }

  const undo = iconButton("Undo this change", "fa-solid fa-rotate-left", "editor-icon-button editor-interactive-surface d-inline-grid");
  undo.classList.toggle("invisible", !changed);
  undo.disabled = !changed;
  if (changed) {
    undo.removeAttribute("aria-hidden");
  } else {
    undo.setAttribute("aria-hidden", "true");
  }

  undo.dataset.undoPath = path.join("\u0000");
  undo.addEventListener("click", () => onUndo(path));
  actions.append(undo);

  const moreActions = [];
  const currentType = unwrapNullable(resolvedType);

  if (editable && defaultOption && onResetDefault) {
    moreActions.push({
      label: "Reset to default value",
      description: "Replace this setting with its default value.",
      icon: "fa-solid fa-rotate-left",
      action: () => onResetDefault(path, defaultOption)
    });
  }

  if (editable && onAddMessageEffect && currentType?.messageEntry === true && !entry.container) {
    moreActions.push(
      {
        label: "Add sound",
        description: "Play a sound when this message is sent.",
        icon: "fa-solid fa-volume-high",
        action: () => onAddMessageEffect(path, "sound")
      },
      {
        label: "Add action bar",
        description: "Show an additional short message above the player's hotbar.",
        icon: "fa-solid fa-minus",
        action: () => onAddMessageEffect(path, "actionbar")
      },
      {
        label: "Add title",
        description: "Show a title and subtitle in the center of the player's screen.",
        icon: "fa-solid fa-heading",
        action: () => onAddMessageEffect(path, "titles")
      }
    );
  }

  if (
    editable && (onCreateAnchor || onUseAnchor || onDetachAnchor)
    && (canAddDocumentAnchor(entry) || canReuseDocumentAnchor(entry) || parseAliasName(entry.source))
  ) {
    const aliasName = parseAliasName(entry.source);

    if (onCreateAnchor && canAddDocumentAnchor(entry)) {
      moreActions.push({
        label: "Create shared value",
        description: "Name this value so compatible settings later in the file can link to it.",
        icon: "fa-solid fa-link",
        action: () => onCreateAnchor(path, labelForKey(entry.key))
      });
    }

    if (onUseAnchor && canReuseDocumentAnchor(entry)) {
      moreActions.push({
        label: "Link to shared value",
        description: aliasName
          ? "Switch this setting to another compatible shared value defined earlier in this file."
          : "Link this setting to a compatible shared value defined earlier in this file.",
        icon: "fa-solid fa-share",
        action: () => onUseAnchor(path, labelForKey(entry.key))
      });
    }

    if (onDetachAnchor && aliasName && entry.syntax?.kind === "alias") {
      moreActions.push({
        label: "Unlink and edit separately",
        description: "Keep the current values here as an independent copy you can edit separately.",
        icon: "fa-solid fa-link-slash",
        action: () => onDetachAnchor(entry, aliasName)
      });
    }
  }

  if (editable && onEditAnnotations) {
    moreActions.push({
      label: "Inheritance rules",
      description: "Control parent-template replacement and GUI synchronization for this setting.",
      icon: "fa-solid fa-shield-halved",
      action: () => onEditAnnotations(path, labelForKey(entry.key))
    });
  }

  if (editable && removal.allowed) {
    moreActions.push({
      label: "Remove option",
      description: `Remove “${labelForKey(entry.key)}” from this file.`,
      icon: "fa-solid fa-trash",
      danger: true,
      action: () => onRemove(path)
    });
  }

  if (moreActions.length) {
    actions.append(moreActionsMenu(moreActions, `More actions for ${labelForKey(entry.key)}`));
  }

  row.classList.toggle("is-changed", changed);
  row.classList.toggle("is-readonly", !editable);
  row.append(description, value, actions);
  row.dataset.optionPath = optionPathMarker(path);
  return row;
}

function descriptionParagraph(className, text) {
  return appendDescriptionText(element("p", className), text);
}

function defaultValuePresentation(option, type = null) {
  if (!option || option.container) {
    return null;
  }

  if (Array.isArray(option.collectionItems)) {
    const items = option.collectionItems.map(readableDefaultValue);

    if (!items.length) {
      return { kind: "inline", value: "[]", meaning: "No items" };
    }

    const inlineValue = items.join(", ");

    if (items.length <= 3 && inlineValue.length <= 72) {
      return { kind: "inline", value: inlineValue };
    }

    return {
      kind: "collection",
      summary: `${items.length} ${items.length === 1 ? "item" : "items"}`,
      items
    };
  }

  const source = normalizedDefaultSource(option.source);

  if (isNullDefaultSource(source)) {
    return { kind: "inline", value: source || "~", meaning: "No value" };
  }

  const literal = parseSimpleLiteral(source).value;

  if (typeof literal === "boolean") {
    return { kind: "inline", value: String(literal), meaning: literal ? "On" : "Off" };
  }

  const value = defaultScalarValue(source);

  if (!value) {
    return { kind: "inline", value: JSON.stringify(value), meaning: "Empty text" };
  }

  if (!value.trim()) {
    const spaces = [...value].filter((character) => character === " ").length;
    const tabs = [...value].filter((character) => character === "\t").length;
    const parts = [];

    if (spaces) {
      parts.push(`${spaces} ${spaces === 1 ? "space" : "spaces"}`);
    }

    if (tabs) {
      parts.push(`${tabs} ${tabs === 1 ? "tab" : "tabs"}`);
    }

    const amount = parts.join(" and ");

    return {
      kind: "inline",
      value: JSON.stringify(value),
      meaning: amount ? `Blank: ${amount}` : "Blank"
    };
  }

  const multiline = /\r|\n/.test(value);
  const formatted = isFormattedDefault(value, type);

  if (multiline || formatted || value.length > 96) {
    return {
      kind: "source",
      summary: defaultSourceSummary({ formatted, multiline, type }),
      source: value
    };
  }

  return { kind: "inline", value };
}

function defaultValueNotice(option, type, optionLabel) {
  const presentation = defaultValuePresentation(option, type);

  if (!presentation) {
    return document.createDocumentFragment();
  }

  if (presentation.kind === "inline") {
    const content = element("p", "mb-0 min-w-0");
    content.append(document.createTextNode("Default: "), element("code", "", presentation.value));

    if (presentation.meaning) {
      content.append(document.createTextNode(` (${presentation.meaning})`));
    }

    return defaultValueWithCopy(content, option, optionLabel);
  }

  const details = element("details", "min-w-0");
  const summary = element("summary");
  summary.append(document.createTextNode("Default: "), element("span", "", presentation.summary));
  details.append(summary);

  if (presentation.kind === "collection") {
    const values = element("ul", "editor-setting-default-values list-unstyled mb-0 mt-2 p-2 rounded-3 overflow-auto d-grid gap-1");

    for (const item of presentation.items) {
      const value = element("li");
      value.append(element("code", "", item));
      values.append(value);
    }

    details.append(values);
  } else {
    const source = element("pre", "editor-setting-default-source mb-0 mt-2 p-2 rounded-3 overflow-auto");
    source.append(element("code", "", presentation.source));
    details.append(source);
  }

  return defaultValueWithCopy(details, option, optionLabel);
}

function defaultValueWithCopy(content, option, optionLabel) {
  const notice = element("div", "editor-setting-default d-flex align-items-center gap-1 mb-0 mt-2");
  notice.append(content, defaultValueCopyButton(defaultCopyValue(option), optionLabel));
  return notice;
}

function defaultValueCopyButton(value, optionLabel) {
  const copy = element("button", "editor-setting-default-copy border-0 bg-transparent p-0 d-inline-grid flex-shrink-0");
  const icon = element("i", "fa-solid fa-copy");
  const resetLabel = `Copy default value for ${optionLabel}`;
  let resetTimer = 0;
  copy.type = "button";
  copy.title = resetLabel;
  copy.setAttribute("aria-label", resetLabel);
  copy.append(icon);
  copy.addEventListener("click", async () => {
    window.clearTimeout(resetTimer);
    copy.disabled = true;
    const copied = await copyText(value).catch(() => false);
    copy.disabled = false;

    const resultLabel = copied
      ? `Copied default value for ${optionLabel}`
      : `Could not copy default value for ${optionLabel}`;
    copy.classList.toggle("is-copied", copied);
    copy.classList.toggle("is-copy-error", !copied);
    icon.className = copied ? "fa-solid fa-check" : "fa-solid fa-triangle-exclamation";
    copy.title = resultLabel;
    copy.setAttribute("aria-label", resultLabel);

    resetTimer = window.setTimeout(() => {
      copy.classList.remove("is-copied", "is-copy-error");
      icon.className = "fa-solid fa-copy";
      copy.title = resetLabel;
      copy.setAttribute("aria-label", resetLabel);
    }, 1800);
  });
  return copy;
}

function defaultCopyValue(option) {
  const source = normalizedDefaultSource(option.source);

  if (Array.isArray(option.collectionItems)) {
    return source;
  }

  if (isNullDefaultSource(source)) {
    return source || "~";
  }

  return defaultScalarValue(source);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }

  const input = element("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.opacity = "0";
  document.body.append(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    input.remove();
  }
}

function readableDefaultValue(source) {
  return defaultScalarValue(normalizedDefaultSource(source));
}

function defaultScalarValue(source) {
  const block = parseBlockScalar(source);

  if (block) {
    return block.content.replace(/(?:\r\n|\n|\r)+$/, "");
  }

  return String(parseSimpleLiteral(source).value);
}

function isNullDefaultSource(source) {
  return !source || /^(?:~|null)$/i.test(source.trim());
}

function isFormattedDefault(value, type) {
  if (/\{\$\$?[^{}\s]+}|%[A-Za-z_][^%\r\n]*%|(?:hover|click|show_text):\{/.test(value)) {
    return true;
  }

  return unwrapNullable(type)?.typeName === "Message"
    && /&(?:[0-9a-fk-or]|#[0-9a-f]{6})/i.test(value);
}

function defaultSourceSummary({ formatted, multiline, type }) {
  if (formatted) {
    return multiline ? "multiline formatted text" : "formatted text";
  }

  const current = unwrapNullable(type);

  if (current?.kind === "expression") {
    if (current.language === "condition") {
      return "condition";
    }

    if (current.language === "math") {
      return "formula";
    }

    return "expression";
  }

  return multiline ? "multiline text" : "long text";
}

function normalizedDefaultSource(source) {
  const lines = String(source ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length && !lines.at(-1).trim()) {
    lines.pop();
  }

  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const indentation = indents.length ? Math.min(...indents) : 0;

  return lines.map((line) => line.slice(indentation)).join("\n");
}

function moreActionsMenu(items, label) {
  const menu = element("div", "editor-more-actions dropdown");
  const toggle = element("button", "editor-icon-button editor-interactive-surface d-grid");
  toggle.type = "button";
  toggle.title = label;
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("aria-expanded", "false");
  toggle.dataset.bsToggle = "dropdown";
  toggle.dataset.bsAutoClose = "true";
  toggle.append(element("i", "fa-solid fa-ellipsis-vertical"));
  const list = element("div", "dropdown-menu dropdown-menu-end editor-more-actions-menu");
  let previousDanger = false;

  for (const item of items) {
    const { label: itemLabel, icon: iconClass, action, description, danger = false } = item;

    if (danger && list.childElementCount && !previousDanger) {
      const divider = element("div", "editor-more-actions-divider");
      divider.setAttribute("role", "separator");
      list.append(divider);
    }

    const button = element("button", "dropdown-item editor-more-actions-item d-grid w-100 border-0 text-start");
    button.classList.toggle("editor-more-actions-item--danger", danger);
    button.type = "button";
    const icon = element("span", "editor-more-actions-icon d-inline-grid flex-shrink-0");
    icon.append(element("i", iconClass));
    const copy = element("span", "editor-more-actions-copy d-grid min-w-0");
    copy.append(element("span", "editor-more-actions-title fw-semibold", itemLabel));
    if (description) {
      copy.append(element("span", "editor-more-actions-help", description));
    }

    button.append(icon, copy);
    button.addEventListener("click", action);
    list.append(button);
    previousDanger = danger;
  }

  menu.append(toggle, list);
  return menu;
}

function inheritancePolicySummary(annotations) {
  const panel = element("div", "editor-policy-summary d-flex align-items-start gap-2 mt-2");
  panel.append(element("i", "fa-solid fa-shield-halved flex-shrink-0"));
  const copy = element("span");
  copy.append(element("strong", "", "Inheritance rules: "));
  copy.append(document.createTextNode(annotations.map((annotation) => annotation.label).join(", ")));
  const descriptions = annotations.map((annotation) => annotation.description).filter(Boolean);

  if (descriptions.length) {
    copy.title = descriptions.join(" ");
  }

  panel.append(copy);
  return panel;
}

export function initialValueForType(type) {
  const current = unwrapNullable(type);

  if (current?.typeName === "GuiSlots") {
    return "0";
  }

  if (current?.typeName === "Sound") {
    return "BLOCK_NOTE_BLOCK_BASS, 1, 1";
  }

  if (current?.kind === "null") {
    return "null";
  }

  if (current?.kind === "literal") {
    return formatLiteralValue(current.value);
  }

  if (current?.kind === "boolean") {
    return "false";
  }

  if (current?.kind === "integer" || current?.kind === "decimal") {
    return String(current.minimum ?? 0);
  }

  if (current?.kind === "enum") {
    return formatStringLiteral(current.values[0] ?? "");
  }

  if (current?.kind === "duration") {
    return "1min";
  }

  if (current?.kind === "list" || current?.kind === "set") {
    return "[]";
  }

  if (current?.kind === "mapping" || current?.kind === "object") {
    return "{}";
  }

  return '""';
}

function createControl(type, entry, onChange, anchorActions = {}) {
  if (isLoreValue(entry, type)) {
    const listType = loreListType(type);
    const hasStructuredMerge = entry.collectionItems?.some((item) => item.syntax?.kind === "sequence-merge");

    if (hasStructuredMerge && listType) {
      return simpleSequenceControl(listType, entry, onChange, anchorActions);
    }

    return loreControl(entry, onChange);
  }

  if (type.typeName === "GuiSlots") {
    return guiSlotsControl(type, entry, onChange, anchorActions);
  }

  const current = unwrapNullable(type);

  const importedAnchor = entry.syntax?.kind === "imported-anchor" ? parseImportedAnchor(entry.source) : null;

  if (importedAnchor) {
    return importedAnchorControl(entry, importedAnchor, onChange, anchorActions.rename);
  }

  if (["alias", "mapping-merge"].includes(entry.syntax?.kind)) {
    return reusableSettingsControl(entry, onChange, anchorActions, type.linkedType ?? type);
  }

  if (entry.syntax?.kind === "named-function-call") {
    return aliasControl(entry, onChange);
  }

  const anchoredValue = entry.syntax?.kind === "anchor" && !entry.collectionItems
    ? parseAnchoredValue(entry.source)
    : null;

  if (anchoredValue) {
    return anchoredValueControl(entry, anchoredValue, onChange, anchorActions.rename, anchorActions.remove, type);
  }

  if (type.kind === "nullable") {
    return nullableControl(type, entry, onChange, anchorActions);
  }

  if (type.kind === "union") {
    return unionControl(type, entry, onChange, anchorActions);
  }

  const literal = parseSimpleLiteral(entry.source);
  const suggestedRegistry = registryForType(current, entry.key);

  if (entry.blockScalar && usesMessageEditor(current, entry)) {
    return messageControl(entry, literal, onChange);
  }

  if (entry.blockScalar) {
    return blockScalarControl(entry, onChange);
  }

  const functionCall = parseFunctionCall(entry.source);

  if (functionCall) {
    return functionCallControl(entry, functionCall, onChange);
  }

  if ((current.kind === "list" || current.kind === "set") && entry.collectionItems && isSimpleSequenceType(current.elements)) {
    return simpleSequenceControl(current, entry, onChange, anchorActions);
  }

  if (current.typeName === "Potion") {
    return potionControl(entry, literal, onChange);
  }

  if (["Color", "RgbColor"].includes(current.typeName)) {
    return colorValueControl(entry, literal, onChange);
  }

  if (current.typeName === "SkullTexture") {
    return skullTextureControl(entry, literal, onChange);
  }

  if (current.typeName === "Regex") {
    return regexControl(entry, literal, onChange);
  }

  if (["StringMatcher", "StringMatcher<Material>"].includes(current.typeName)) {
    return stringMatcherControl(entry, literal, onChange, current.typeName === "StringMatcher<Material>");
  }

  if (usesMessageEditor(current, entry)) {
    return messageControl(entry, literal, onChange);
  }

  if (current.kind === "string" && (isCommandKey(entry.key) || /^(?:CONSOLE|PLAYER|OP):/.test(String(literal.value)))) {
    return commandControl(entry, literal, onChange);
  }

  if (entry.advancedOnly || ["advanced", "list", "mapping", "object", "set", "union"].includes(current.kind)) {
    return customValueControl(entry, onChange);
  }

  if (current.kind === "boolean") {
    if (literal.kind !== "boolean") {
      return customValueControl(entry, onChange);
    }

    return booleanControl(entry, literal.value, onChange);
  }

  if (current.kind === "enum") {
    return enumControl(current, entry, literal, onChange);
  }

  if (current.kind === "integer" || current.kind === "decimal") {
    const validLiteral = current.kind === "integer" ? literal.kind === "integer" : ["integer", "decimal"].includes(literal.kind);

    if (!validLiteral) {
      return customValueControl(entry, onChange);
    }

    return numberControl(current, entry, literal.value, onChange);
  }

  if (current.kind === "duration") {
    const parsed = parseDurationLiteral(String(literal.value));

    return parsed ? durationControl(entry, parsed, onChange) : customValueControl(entry, onChange);
  }

  if (current.kind === "expression") {
    return expressionControl(current, entry, literal, onChange);
  }

  if (current.typeName === "Sound" || suggestedRegistry?.id === "sound") {
    return soundControl(entry, literal, onChange);
  }

  if (current.kind === "suggestion" || suggestedRegistry) {
    return suggestionControl(current, entry, literal, onChange);
  }

  return textControl(current, entry, literal, onChange);
}

function unionControl(type, entry, onChange, anchorActions) {
  const choices = type.choices.map(unwrapNullable);

  if (!usesCompactUnionControl(choices)) {
    const selected = unionChoiceForEntry(choices, entry);

    return selected
      ? typedUnionControl(type, selected, entry, onChange, anchorActions)
      : customValueControl(entry, onChange);
  }

  const hasNull = choices.some((choice) => choice.kind === "null");
  const hasBoolean = choices.some((choice) => choice.kind === "boolean");
  const collection = choices.find((choice) =>
    (choice.kind === "list" || choice.kind === "set") && isSimpleSequenceType(choice.elements)
  );
  const literal = parseSimpleLiteral(entry.source);
  const currentMode = collection && entry.collectionItems
    ? "collection"
    : hasNull && /^(?:null|~)$/i.test(entry.source.trim())
      ? "null"
      : hasBoolean && literal.kind === "boolean"
        ? String(literal.value)
        : "custom";

  if (currentMode === "custom") {
    return customValueControl(entry, onChange);
  }

  const wrapper = element("div", "d-grid gap-3");
  const mode = element("select", "form-select editor-input");
  mode.dataset.editorControlPart = "Value type";
  if (hasNull) {
    mode.append(option(entry.nullLabel || "Not set (~)", "null", currentMode === "null"));
  }

  if (hasBoolean) {
    mode.append(option("True", "true", currentMode === "true"));
    mode.append(option("False", "false", currentMode === "false"));
  }

  if (collection) {
    mode.append(option(collection.kind === "set" ? "Value set" : "Value list", "collection", currentMode === "collection"));
  }

  mode.addEventListener("change", () => {
    let replacement = mode.value;

    if (mode.value === "null") {
      replacement = nullSourceForEntry(entry);
    }

    if (mode.value === "collection") {
      replacement = "[]";
    }

    onChange(entry.path, replacement, { literal: false });
  });
  wrapper.append(mode);

  if (currentMode === "collection") {
    wrapper.append(simpleSequenceControl(collection, entry, onChange));
  }

  return wrapper;
}

function typedUnionControl(type, selectedType, entry, onChange, anchorActions) {
  const choices = type.choices.map(unwrapNullable).filter((choice) =>
    choice && ["advanced", "boolean", "decimal", "duration", "enum", "expression", "integer", "list", "literal", "mapping", "null", "object", "set", "string", "suggestion"].includes(choice.kind)
  );

  if (choices.length < 2) {
    return createControl(selectedType, entry, onChange, anchorActions);
  }

  const wrapper = element("div", "editor-typed-value d-grid gap-2");
  const mode = element("select", "form-select editor-input");
  mode.dataset.editorControlPart = "Value type";
  const modes = unionModesForEntry(choices, entry);
  modes.forEach((choiceMode, index) => mode.append(option(choiceMode.label, String(index), choiceMode.selected)));
  const control = element("div", "editor-typed-value-control position-relative");
  const render = (choiceMode, source = entry.source) => {
    wrapper.classList.toggle("is-connected", !choiceMode.fixed);
    if (choiceMode.fixed) {
      control.replaceChildren();
      return;
    }

    const value = createControl(choiceMode.choice, { ...entry, source }, onChange, anchorActions);
    markControlPart(value, "Value");
    control.replaceChildren(value);
  };
  mode.addEventListener("change", () => {
    const choiceMode = modes[Number(mode.value)];
    const source = choiceMode.source ?? initialValueForType(choiceMode.choice);
    onChange(entry.path, source, { literal: false });
    if (!["list", "mapping", "object", "set"].includes(choiceMode.choice.kind)) {
      render(choiceMode, source);
    }
  });
  render(modes.find((choiceMode) => choiceMode.selected) ?? {
    choice: selectedType,
    fixed: ["boolean", "literal", "null"].includes(selectedType.kind)
  });
  wrapper.append(mode, control);
  return wrapper;
}

export function unionModesForEntry(choices, entry) {
  const selectedChoice = unionChoiceForEntry(choices, entry);
  const literal = parseSimpleLiteral(entry.source);

  return choices.flatMap((choice) => {
    if (choice.kind === "boolean") {
      return [
        {
          choice,
          fixed: true,
          label: choice.trueLabel || "On",
          selected: choice === selectedChoice && literal.kind === "boolean" && literal.value,
          source: "true"
        },
        {
          choice,
          fixed: true,
          label: choice.falseLabel || "Off",
          selected: choice === selectedChoice && literal.kind === "boolean" && !literal.value,
          source: "false"
        }
      ];
    }

    const fixed = choice.kind === "literal" || choice.kind === "null";
    let source = null;

    if (choice.kind === "null") {
      source = nullSourceForEntry(entry);
    } else if (fixed) {
      source = initialValueForType(choice);
    }

    return [{
      choice,
      fixed,
      label: unionChoiceLabel(choice, entry),
      selected: choice === selectedChoice,
      source
    }];
  });
}

function primitiveUnionChoice(choices, literal) {
  if (literal.kind === "null") {
    return choices.find((choice) => choice?.kind === "null");
  }

  const exactLiteral = choices.find((choice) =>
    choice?.kind === "literal" && choice.value === literal.value
  );

  if (exactLiteral) {
    return exactLiteral;
  }

  if (literal.kind === "boolean") {
    return choices.find((choice) => choice?.kind === "boolean");
  }

  if (literal.kind === "integer") {
    return choices.find((choice) => choice?.kind === "integer")
      ?? choices.find((choice) => choice?.kind === "decimal");
  }

  if (literal.kind === "decimal") {
    return choices.find((choice) => choice?.kind === "decimal");
  }

  if (parseDurationLiteral(String(literal.value))) {
    const duration = choices.find((choice) => choice?.kind === "duration");

    if (duration) {
      return duration;
    }
  }

  const exactEnum = choices.find((choice) => choice?.kind === "enum" && choice.values.includes(String(literal.value)));

  if (exactEnum) {
    return exactEnum;
  }

  return choices.find((choice) => choice?.kind === "string" || choice?.kind === "suggestion" || choice?.typeName === "Color")
    ?? choices.find((choice) => choice?.kind === "expression");
}

export function usesCompactUnionControl(choices) {
  return choices.length > 0 && choices.every((choice) => {
    if (choice?.kind === "null" || choice?.kind === "boolean") {
      return true;
    }

    return (choice?.kind === "list" || choice?.kind === "set") && isSimpleSequenceType(choice.elements);
  });
}

export function unionChoiceForEntry(choices, entry) {
  if (/^(?:null|~)$/i.test(entry.source.trim())) {
    const none = choices.find((choice) => choice?.kind === "null");

    if (none) {
      return none;
    }
  }

  const collection = choices.find((choice) =>
    (choice?.kind === "list" || choice?.kind === "set") && entry.collectionItems
  );

  if (collection) {
    return collection;
  }

  if (entry.container) {
    const container = choices.find((choice) => choice?.kind === "object" || choice?.kind === "mapping");

    if (container) {
      return container;
    }
  }

  return primitiveUnionChoice(choices, parseSimpleLiteral(entry.source));
}

function unionChoiceLabel(choice, entry) {
  if (choice.kind === "null") {
    return choice.label || entry.nullLabel || "Not set (~)";
  }

  return choice.label || describeType(choice);
}

function nullOptionLabel(help = "") {
  if (/\bdisabl(?:e|ed)\b/i.test(help)) {
    return "Disabled (~)";
  }

  if (/\bautomatic(?:ally)?\b/i.test(help)) {
    return "Automatic (~)";
  }

  return "Not set (~)";
}

function formatLiteralValue(value) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return formatStringLiteral(value);
  }

  return String(value);
}

function nullableControl(type, entry, onChange, anchorActions) {
  const wrapper = element("div", "editor-typed-value d-grid gap-2");
  const mode = element("select", "form-select editor-input");
  mode.dataset.editorControlPart = "Value type";
  const isNull = /^(?:null|~)$/i.test(entry.source.trim());
  mode.append(
    option(entry.nullLabel || "Not set (~)", "null", isNull),
    option("Configured value", "value", !isNull)
  );

  const valueSource = isNull ? initialValueForType(type.value) : entry.source;
  const valueControl = createControl(type.value, { ...entry, source: valueSource }, onChange, anchorActions);
  markControlPart(valueControl, "Value");
  const control = element("div", "editor-typed-value-control position-relative");
  control.append(valueControl);
  control.hidden = isNull;
  wrapper.classList.toggle("is-connected", !isNull);
  mode.addEventListener("change", () => {
    const useValue = mode.value === "value";
    control.hidden = !useValue;
    wrapper.classList.toggle("is-connected", useValue);
    onChange(entry.path, useValue ? valueSource : nullSourceForEntry(entry), { literal: false });
  });
  wrapper.append(mode, control);
  return wrapper;
}

function nullSourceForEntry(entry) {
  if (entry.source.trim() === "~") {
    return "~";
  }

  if (entry.source.trim().toLocaleLowerCase("en-US") === "null") {
    return "null";
  }

  const originalSource = String(entry.originalSource ?? "").trim();

  if (originalSource === "~") {
    return "~";
  }

  if (originalSource.toLocaleLowerCase("en-US") === "null") {
    return "null";
  }

  return /\bDisabled\b/.test(entry.nullLabel) ? "~" : "null";
}

function booleanControl(entry, enabled, onChange) {
  const wrapper = element("label", "editor-switch d-inline-flex align-items-center gap-2 mb-0");
  const input = element("input", "visually-hidden");
  input.type = "checkbox";
  input.role = "switch";
  input.checked = enabled;
  input.setAttribute("aria-label", `${labelForKey(entry.key)}: ${enabled ? "On" : "Off"}`);
  const track = element("span", "editor-switch-track position-relative flex-shrink-0");
  track.setAttribute("aria-hidden", "true");
  const state = element("span", "editor-switch-state fw-bold", enabled ? "On" : "Off");
  input.addEventListener("change", () => {
    const nextEnabled = input.checked;
    state.textContent = nextEnabled ? "On" : "Off";
    input.setAttribute("aria-label", `${labelForKey(entry.key)}: ${nextEnabled ? "On" : "Off"}`);
    const applied = onChange(entry.path, nextEnabled ? "true" : "false", {
      literal: false,
      renderDelay: switchTransitionDuration(track)
    });

    if (applied !== false) {
      return;
    }

    input.checked = !nextEnabled;
    state.textContent = input.checked ? "On" : "Off";
    input.setAttribute("aria-label", `${labelForKey(entry.key)}: ${input.checked ? "On" : "Off"}`);
  });
  wrapper.append(input, track, state);
  return wrapper;
}

function switchTransitionDuration(track) {
  const styles = [getComputedStyle(track), getComputedStyle(track, "::after")];

  return Math.ceil(Math.max(0, ...styles.flatMap((style) => {
    const durations = style.transitionDuration.split(",").map(cssTimeMilliseconds);
    const delays = style.transitionDelay.split(",").map(cssTimeMilliseconds);

    return durations.map((duration, index) => duration + (delays[index] ?? delays.at(-1) ?? 0));
  })));
}

function cssTimeMilliseconds(value) {
  const time = Number.parseFloat(value) || 0;

  return value.trim().endsWith("ms") ? time : time * 1000;
}

function regexControl(entry, literal, onChange) {
  const wrapper = element("div", "d-grid gap-2");
  const input = element("input", "form-control editor-input editor-input--code");
  const hint = element("small", "editor-control-hint", "Use Java regular-expression syntax.");
  input.type = "text";
  input.value = String(literal.value);
  input.spellcheck = false;
  input.addEventListener("change", () => {
    onChange(entry.path, formatStringLiteral(input.value, entry.source), { literal: false });
  });
  wrapper.append(input, hint);
  return wrapper;
}

function enumControl(type, entry, literal, onChange) {
  const select = element("select", "form-select editor-input");
  const current = String(literal.value ?? "");
  const values = [...(type.values ?? [])];

  if (current && !values.some((value) => value === current)) {
    values.unshift(current);
  }

  values.forEach((value) => select.append(option(enumOptionLabel(type, value), value, current === value)));
  select.addEventListener("change", () => onChange(entry.path, formatStringLiteral(select.value, entry.source), { literal: false }));
  return select;
}

function enumOptionLabel(type, value) {
  return type.valueLabels?.[value] ?? value;
}

function numberControl(type, entry, value, onChange) {
  const input = element("input", "form-control editor-input");
  input.type = "number";
  input.step = type.kind === "integer" ? "1" : "any";
  input.value = String(value);
  if (type.minimum !== undefined) {
    input.min = String(type.minimum);
  }

  if (type.maximum !== undefined) {
    input.max = String(type.maximum);
  }

  input.addEventListener("change", () => {
    input.setCustomValidity("");
    const next = input.value.trim();

    if (type.kind === "integer" && !/^[+-]?\d+$/.test(next)) {
      input.setCustomValidity("Enter a whole number.");
    } else if (next === "" || !Number.isFinite(Number(next))) {
      input.setCustomValidity("Enter a valid number.");
    }

    if (!input.reportValidity()) {
      return;
    }

    onChange(entry.path, next, { literal: false });
  });
  if (!type.suffix) {
    return input;
  }

  const group = element("div", "input-group editor-number");
  const suffix = element("span", "input-group-text editor-input-suffix", type.suffix);
  suffix.setAttribute("aria-hidden", "true");
  group.append(input, suffix);
  return group;
}

function durationControl(entry, parsed, onChange) {
  const group = element("div", "editor-duration d-grid gap-2");
  const amount = element("input", "form-control editor-input");
  amount.type = "number";
  amount.min = "0";
  amount.step = "1";
  amount.value = String(parsed.amount);
  amount.dataset.editorControlPart = "Amount";
  const unit = element("select", "form-select editor-input");
  unit.dataset.editorControlPart = "Unit";
  DURATION_UNITS.forEach((candidate) => unit.append(option(candidate.label, candidate.value, candidate.value === parsed.unit)));

  const update = () => {
    amount.setCustomValidity(/^[0-9]+$/.test(amount.value) ? "" : "Enter a non-negative whole number.");
    if (!amount.reportValidity()) {
      return;
    }

    onChange(entry.path, formatStringLiteral(formatDuration(Number(amount.value), unit.value), entry.source), { literal: false });
  };
  amount.addEventListener("change", update);
  unit.addEventListener("change", update);
  group.append(amount, unit);
  return group;
}

function expressionControl(type, entry, literal, onChange) {
  const isCondition = type.language === "condition";
  const source = String(literal.value);
  const previewText = expressionPreviewText(type, source);
  const preview = richExpressionPreview(previewText, type.language);
  const trigger = richValueTrigger(
    `Edit ${isCondition ? "condition" : "formula"} for ${labelForKey(entry.key)}`,
    preview
  );
  trigger.addEventListener("click", () => {
    const content = element("div", "editor-rich-dialog-layout d-grid gap-3");
    const editor = element("div", "editor-rich-dialog-primary d-grid gap-2 min-w-0");
    const input = element("textarea", "form-control editor-input editor-input--expression");
    input.rows = 4;
    input.value = source;
    input.spellcheck = false;
    input.setAttribute("aria-label", isCondition ? "Condition" : "Formula");
    input.placeholder = isCondition
      ? "Example: kingdoms_members >= 5 && !pacifist"
      : "Example: base + (lvl * 10)";
    const hint = element("small", "editor-control-hint");
    const validate = () => validateExpression(input, hint, type.language);
    input.addEventListener("input", validate);
    editor.append(input, hint);
    const tools = element("aside", "editor-rich-dialog-tools d-grid align-content-start gap-3 min-w-0");
    tools.append(expressionAssist(input, type.language, validate, entry.defaultSource));
    if (type.language === "math") {
      tools.append(expressionCalculator(input));
    }

    if (type.language === "condition") {
      tools.append(conditionCalculator(input));
    }

    content.append(editor, tools);
    validate();

    openRichValueDialog({
      eyebrow: isCondition ? "Condition" : "Formula",
      title: `Edit ${labelForKey(entry.key)}`,
      content,
      initialFocus: input,
      onSave: () => {
        if (!validate()) {
          input.reportValidity();
          return false;
        }

        onChange(entry.path, formatStringLiteral(input.value, entry.source), { literal: false });
        return true;
      }
    });
  });
  return trigger;
}

function expressionPreviewText(type, source) {
  const value = String(source).trim();

  if (!value) {
    return type.language === "condition" ? "No condition configured" : "No formula configured";
  }

  return type.language === "condition" ? `When ${readableCondition(value)}` : value;
}

function suggestionControl(type, entry, literal, onChange) {
  const input = element("input", "form-control editor-input");
  const registry = registryForType(type, entry.key);
  input.type = "text";
  input.value = String(literal.value);
  const inputControl = registry ? attachRegistry(input, registry) : input;
  input.placeholder = registry ? `Search ${registry.typeName} values` : type.typeName;

  let icon = null;

  if (registry?.id === "material") {
    icon = materialIconElement(input.value, {
      className: "editor-material-control-icon flex-shrink-0"
    });
  }

  input.addEventListener("input", () => {
    if (icon) {
      updateMaterialIcon(icon, input.value);
    }
  });
  input.addEventListener("change", () => onChange(entry.path, formatStringLiteral(input.value, entry.source), { literal: false }));
  if (icon) {
    const controlRow = element("div", "editor-material-control d-flex align-items-center gap-2 min-w-0");
    inputControl.classList.add("editor-grow-control");
    controlRow.append(icon, inputControl);
    return controlRow;
  }

  return inputControl;
}

function soundControl(entry, literal, onChange) {
  const parsed = parseSoundSpec(String(literal.value));

  if (!parsed) {
    return suggestionControl({ kind: "suggestion", typeName: "Sound", allowCustom: true }, entry, literal, onChange);
  }

  const wrapper = element("div", "editor-compound d-grid gap-2");
  const primary = labeledInput("Sound", parsed.sound);
  const soundRegistry = registryForType({ typeName: "Sound" });
  attachRegistry(primary.input, soundRegistry);
  const category = labeledInput("Category", parsed.category);
  attachRegistry(category.input, registryForType({ typeName: "SoundCategory" }));
  const volume = labeledInput("Volume", parsed.volume, "number");
  volume.input.step = "any";
  const pitch = labeledInput("Pitch", parsed.pitch, "number");
  pitch.input.step = "any";
  const seed = labeledInput("Seed", parsed.seed, "number");
  seed.input.step = "1";
  const relative = toggleControl("Play at the player's location", parsed.relative);
  const preview = soundPreviewButton(() => ({
    sound: primary.input.value,
    volume: volume.input.value,
    pitch: pitch.input.value
  }));
  const primaryRow = element("div", "editor-sound-control d-flex align-items-center gap-2 min-w-0");
  primary.root.classList.add("editor-grow-control");
  primaryRow.append(primary.root, preview);
  const advanced = element("div", "editor-compound-grid d-grid gap-2");
  advanced.append(category.root, volume.root, pitch.root, seed.root);

  const commit = () => {
    stopSoundPreview(preview);
    if (!primary.input.value.trim()) {
      primary.input.setCustomValidity("Choose a sound or enter a resource-pack sound.");
      primary.input.reportValidity();
      return;
    }

    primary.input.setCustomValidity("");
    const replacement = formatSoundSpec({
      sound: primary.input.value,
      category: category.input.value,
      volume: volume.input.value,
      pitch: pitch.input.value,
      seed: seed.input.value,
      relative: relative.input.checked,
      partCount: parsed.partCount
    });
    onChange(entry.path, formatStringLiteral(replacement, entry.source), { literal: false });
  };

  for (const input of [primary.input, category.input, volume.input, pitch.input, seed.input, relative.input]) {
    input.addEventListener("change", commit);
  }

  primary.input.addEventListener("input", () => {
    stopSoundPreview(preview);
    setSoundPreviewState(preview, "ready");
  });

  wrapper.append(primaryRow, advanced, relative.root);
  return wrapper;
}

function soundPreviewButton(currentSound) {
  const preview = iconButton(
    "Play sound preview",
    "fa-solid fa-play",
    "editor-icon-button editor-interactive-surface editor-sound-control-preview d-inline-grid flex-shrink-0"
  );
  const preload = () => loadMinecraftSounds().catch(() => {});
  preview.addEventListener("pointerenter", preload, { once: true });
  preview.addEventListener("focus", preload, { once: true });
  preview.addEventListener("click", async () => {
    if (activeSoundPreview?.button === preview) {
      stopSoundPreview(preview);
      return;
    }

    stopSoundPreview();
    setSoundPreviewState(preview, "loading");

    try {
      const values = currentSound();
      const catalog = await loadMinecraftSounds();
      const selection = resolveMinecraftSound(catalog, values.sound);
      const playback = minecraftSoundPlayback(selection, values);

      if (!playback) {
        setSoundPreviewState(preview, "unavailable", "Preview unavailable for this custom sound");
        return;
      }

      const audio = new Audio(playback.url);
      audio.preload = "auto";
      audio.volume = playback.volume;
      audio.playbackRate = playback.playbackRate;
      audio.preservesPitch = false;
      audio.mozPreservesPitch = false;
      audio.webkitPreservesPitch = false;
      const timeout = window.setTimeout(() => stopSoundPreview(preview), 10000);
      activeSoundPreview = { audio, button: preview, timeout };
      setSoundPreviewState(preview, "playing");
      audio.addEventListener("ended", () => stopSoundPreview(preview), { once: true });
      audio.addEventListener("error", () => {
        if (activeSoundPreview?.audio === audio) {
          failSoundPreview(preview);
        }
      }, { once: true });
      await audio.play();
    } catch {
      failSoundPreview(preview);
    }
  });
  return preview;
}

function stopSoundPreview(button = null) {
  if (!activeSoundPreview || (button && activeSoundPreview.button !== button)) {
    return;
  }

  const { audio, button: activeButton, timeout } = activeSoundPreview;
  activeSoundPreview = null;
  window.clearTimeout(timeout);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (activeButton.isConnected) {
    setSoundPreviewState(activeButton, "ready");
  }
}

function failSoundPreview(button) {
  if (activeSoundPreview?.button === button) {
    stopSoundPreview(button);
  }

  setSoundPreviewState(button, "unavailable", "Sound preview could not be played");
}

function setSoundPreviewState(button, state, label = "") {
  const labels = {
    loading: "Loading sound preview",
    playing: "Stop sound preview",
    ready: "Play sound preview",
    unavailable: label || "Sound preview unavailable"
  };
  const icons = {
    loading: "fa-solid fa-spinner fa-spin",
    playing: "fa-solid fa-stop",
    ready: "fa-solid fa-play",
    unavailable: "fa-solid fa-volume-xmark"
  };
  button.disabled = state === "loading";
  button.title = labels[state];
  button.setAttribute("aria-label", labels[state]);
  button.firstElementChild.className = icons[state];
}

function potionControl(entry, literal, onChange) {
  const editor = potionEditor(String(literal.value), (value) => {
    onChange(entry.path, formatStringLiteral(value, entry.source), { literal: false });
  });

  return editor.root;
}

function stringMatcherControl(entry, literal, onChange, material = false) {
  const editor = matcherEditor(String(literal.value), material, (value) => {
    onChange(entry.path, formatStringLiteral(value, entry.source), { literal: false });
  });

  return editor.root;
}

function commandControl(entry, literal, onChange) {
  return commandEditor(String(literal.value), (value) => {
    onChange(entry.path, formatStringLiteral(value, entry.source), { literal: false });
  }).root;
}

function messageControl(entry, literal, onChange) {
  const source = entry.blockScalar?.content ?? String(literal.value);
  const trigger = richValueTrigger(
    `Edit formatted message for ${labelForKey(entry.key)}`,
    messagePreviewElement(source, {
      macros: entry.messageMacros,
      showHeading: false,
      showDetails: false,
      interactive: false
    })
  );
  trigger.addEventListener("click", () => openMessageEditor({
    entry,
    source,
    title: `Edit ${labelForKey(entry.key)}`,
    eyebrow: "Formatted message",
    onSave: (value) => onChange(
      entry.path,
      entry.blockScalar ? formatBlockScalar(entry.blockScalar, value) : formatStringLiteral(value, entry.source),
      { literal: Boolean(entry.blockScalar) }
    )
  }));
  return trigger;
}

export function usesMessageEditor(type, entry = {}) {
  const current = unwrapNullable(type);

  return ["Message", "MessageEntry"].includes(current?.typeName)
    || ["conditional-message", "interactive-message"].includes(entry.syntax?.kind);
}

function loreControl(entry, onChange) {
  const source = loreText(entry);
  const previewSource = entry.lorePreview ?? source;
  const trigger = richValueTrigger(
    `Edit item lore for ${labelForKey(entry.key)}`,
    messagePreviewElement(previewSource, {
      macros: entry.messageMacros,
      showHeading: false,
      showDetails: false,
      interactive: false
    })
  );
  trigger.addEventListener("click", () => openMessageEditor({
    entry,
    source,
    title: `Edit ${labelForKey(entry.key)}`,
    eyebrow: "Item lore",
    lore: true,
    onSave: (value) => onChange(entry.path, formatLoreText(entry, value), { literal: true })
  }));
  return trigger;
}

function openMessageEditor({ entry, source, title, eyebrow, lore = false, onSave }) {
  const content = element("div", "editor-rich-dialog-layout d-grid gap-3");
  const editor = element("div", "editor-rich-dialog-primary editor-rich-dialog-primary--message d-grid gap-2 min-w-0");
  const input = element("textarea", `form-control editor-input editor-input--message${lore ? " editor-input--lore" : ""}`);
  input.rows = Math.min(lore ? 14 : 10, Math.max(lore ? 5 : 4, source.split(/\\n|\r\n|\n|\r/).length + 1));
  input.value = source;
  input.spellcheck = false;
  input.setAttribute("aria-label", lore ? "Item lore" : "Formatted message");
  if (lore) {
    input.placeholder = "Enter one lore line per line";
  }

  const hint = element("small", "editor-control-hint");
  const preview = element("div");
  const updatePreview = () => {
    validateExpression(input, hint, "message");
    preview.replaceChildren(messagePreviewElement(input.value, { macros: entry.messageMacros }));
  };
  input.addEventListener("input", updatePreview);
  editor.append(input, hint);
  if (lore) {
    editor.append(element("small", "editor-control-hint", "Each line becomes a separate lore line."));
  }

  preview.className = "editor-rich-dialog-preview min-w-0 mt-2";
  editor.append(preview);
  const tools = element("aside", "editor-rich-dialog-tools d-grid align-content-start gap-3 min-w-0");
  tools.append(messageInsertToolbar(input, updatePreview, entry.defaultSource, entry.messageTokens));
  content.append(editor, tools);
  updatePreview();

  openRichValueDialog({
    eyebrow,
    title,
    content,
    initialFocus: input,
    onSave: () => {
      if (!validateExpression(input, hint, "message")) {
        input.reportValidity();
        return false;
      }

      onSave(input.value);
      return true;
    }
  });
}

function colorValueControl(entry, literal, onChange) {
  const parsed = parseColorValue(literal.value);

  if (!parsed) {
    return textControl({ kind: "string" }, entry, literal, onChange);
  }

  const group = element("div", "editor-color-value-control position-relative");
  const picker = element("input", "editor-color-value-control-picker position-absolute");
  picker.type = "color";
  picker.value = parsed.hex;
  picker.title = "Choose color";
  picker.tabIndex = -1;
  picker.setAttribute("aria-hidden", "true");

  const rawValue = String(literal.value).trim();
  const preview = colorValuePreviewElement({
    raw: rawValue,
    color: picker.value,
    label: parsed.label
  }, { showHeading: false });
  preview.classList.add("editor-color-value-control-preview");
  preview.role = "button";
  preview.tabIndex = 0;
  preview.title = "Choose color";
  preview.setAttribute("aria-label", `${rawValue}. Open color picker`);

  const openPicker = () => {
    try {
      if (picker.showPicker) {
        picker.showPicker();
      } else {
        picker.click();
      }
    } catch {
      picker.click();
    }
  };
  preview.addEventListener("click", openPicker);
  preview.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) {
      return;
    }

    event.preventDefault();
    openPicker();
  });
  const updatePreview = () => {
    const raw = formatPickedColor(parsed, picker.value);
    preview.querySelector(".editor-message-preview-color-swatch")
      ?.style.setProperty("--message-preview-color", picker.value);
    const code = preview.querySelector(".editor-message-preview-color-code");

    if (code) {
      code.textContent = raw;
    }

    preview.setAttribute("aria-label", `${raw}. Open color picker`);
    return raw;
  };
  picker.addEventListener("input", updatePreview);
  picker.addEventListener("change", () => {
    const raw = updatePreview();
    onChange(entry.path, formatStringLiteral(raw, entry.source), { literal: false });
  });

  group.append(picker, preview);
  return group;
}

export function parseColorValue(value) {
  const source = String(value).trim();
  const hex = /^(#?)([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(source);

  if (hex) {
    const expanded = hex[2].length === 3
      ? [...hex[2]].map((character) => character.repeat(2)).join("")
      : hex[2];

    return {
      format: hex[1] ? "hex" : "bare-hex",
      hex: `#${expanded}`,
      label: "Hex color",
      alpha: null
    };
  }

  const rgb = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d{1,3}))?$/.exec(source);

  if (!rgb) {
    return null;
  }

  const channels = rgb.slice(1, 4).map(Number);
  const alpha = rgb[4] === undefined ? null : Number(rgb[4]);
  const allChannels = alpha === null ? channels : [...channels, alpha];

  if (!allChannels.every((channel) => channel <= 255)) {
    return null;
  }

  return {
    format: alpha === null ? "rgb" : "rgba",
    hex: rgbToHex(...channels),
    label: alpha === null ? "RGB color" : "RGBA color",
    alpha
  };
}

function formatPickedColor(parsed, hex) {
  if (parsed.format === "hex") {
    return hex;
  }

  if (parsed.format === "bare-hex") {
    return hex.slice(1);
  }

  const channels = hexToRgb(hex);

  if (parsed.alpha !== null) {
    channels.push(parsed.alpha);
  }

  return channels.join(", ");
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((channel) => Math.round(Math.max(0, Math.min(255, Number(channel) || 0))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value));

  if (!match) {
    return [0, 0, 0];
  }

  return match.slice(1).map((channel) => Number.parseInt(channel, 16));
}

function skullTextureControl(entry, literal, onChange) {
  const source = String(literal.value);
  const trigger = richValueTrigger(
    `Edit player head texture for ${labelForKey(entry.key)}`,
    skullTexturePreview(source, entry.messageMacros)
  );
  trigger.addEventListener("click", () => {
    const editor = element("div", "editor-rich-dialog-primary d-grid gap-2 min-w-0");
    const input = element("textarea", "form-control editor-input editor-input--code");
    input.rows = source.length > 120 ? 8 : 4;
    input.value = source;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Player head texture");
    input.placeholder = "Player name, UUID, texture URL, hash, Base64, or shared value";
    const hint = element("small", "editor-control-hint", skullTextureHint(source, entry.messageMacros));
    input.addEventListener("input", () => {
      hint.textContent = skullTextureHint(input.value, entry.messageMacros);
    });
    editor.append(input, hint);

    openRichValueDialog({
      eyebrow: "Player head texture",
      title: `Edit ${labelForKey(entry.key)}`,
      content: editor,
      initialFocus: input,
      onSave: () => {
        onChange(entry.path, formatStringLiteral(input.value, entry.source), { literal: false });
        return true;
      }
    });
  });
  return trigger;
}

export function skullTextureKind(value) {
  const source = String(value).trim();

  if (/^\{\$[^{}]+}$/.test(source)) {
    return "Shared texture value";
  }

  if (/^https?:\/\//i.test(source)) {
    return "Textures URL";
  }

  if (/^[0-9a-f]{64}$/i.test(source)) {
    return "Texture hash";
  }

  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(source)) {
    return "Player UUID";
  }

  if (source.length > 80) {
    return "Base64 texture";
  }

  return "Player name or custom texture value";
}

export function resolveSkullTexture(value, macros = null) {
  const source = String(value).trim();
  const match = /^\{\$([^{}]+)}$/.exec(source);
  const name = match?.[1].trim().toLocaleLowerCase("en-US") ?? "";
  const definition = name ? macros?.definitions?.get(name) ?? null : null;
  const resolved = definition ? resolveMessageMacros(source, macros) : source;

  return {
    source,
    resolved,
    definition,
    kind: skullTextureKind(resolved)
  };
}

function skullTexturePreview(value, macros) {
  const texture = resolveSkullTexture(value, macros);
  const preview = element("div", "editor-rich-value-expression editor-skull-texture-preview d-flex align-items-center gap-3");
  preview.append(materialIconElement("PLAYER_HEAD", {
    className: "editor-skull-texture-preview-icon flex-shrink-0",
    skull: texture.resolved
  }));

  const copy = element("span", "min-w-0");
  copy.append(element("strong", "d-block", texture.kind));
  if (texture.source) {
    copy.append(element(
      "span",
      "editor-skull-texture-preview-source d-block text-truncate",
      texture.definition ? texture.source : texture.kind === "Base64 texture" ? "Custom texture data" : texture.source
    ));
  }

  if (texture.definition) {
    copy.append(element(
      "span",
      "editor-skull-texture-preview-origin d-block text-truncate",
      `${texture.definition.fileName} → ${texture.definition.path.join(" → ")}`
    ));
  }

  preview.append(copy);
  return preview;
}

function skullTextureHint(value, macros) {
  const texture = resolveSkullTexture(value, macros);

  if (!texture.definition) {
    return skullTextureKind(value);
  }

  return `${texture.kind} from ${texture.definition.fileName} → ${texture.definition.path.join(" → ")}`;
}

function blockScalarControl(entry, onChange) {
  const wrapper = element("div", "d-grid gap-2");
  const input = element("textarea", "form-control editor-input editor-input--message");
  input.rows = Math.min(12, Math.max(4, entry.blockScalar.content.split(/\r\n|\n|\r/).length + 1));
  input.value = entry.blockScalar.content;
  input.spellcheck = false;
  const style = entry.blockScalar.header.startsWith(">") ? "folded" : "literal";
  const hint = element("small", "editor-control-hint", style === "folded"
    ? "The game displays these lines as continuous text."
    : "The game keeps these line breaks.");
  input.addEventListener("change", () => onChange(entry.path, formatBlockScalar(entry.blockScalar, input.value), { literal: true }));
  wrapper.append(input, hint);
  return wrapper;
}

function aliasControl(entry, onChange) {
  const wrapper = element("div", "d-grid gap-2");
  const input = element("input", "form-control editor-input editor-input--code");
  input.value = entry.source.trim().replace(/^\*/, "");
  input.pattern = "[A-Za-z0-9_\-]+";
  const hint = element("small", "editor-control-hint", "Entry template name");
  input.addEventListener("change", () => {
    if (!input.reportValidity()) {
      return;
    }

    onChange(entry.path, `*${input.value}`, { literal: true });
  });
  wrapper.append(input, hint);
  return wrapper;
}

function reusableSettingsControl(entry, onChange, anchorActions, type = null) {
  const name = parseAliasName(entry.source) ?? "";
  const names = [...new Set([name, ...(anchorActions.names ?? [])].filter(Boolean))];
  const control = element("select", "form-select editor-input editor-input--code");
  names.forEach((candidate) => control.append(option(candidate, candidate, candidate === name)));
  control.addEventListener("change", () => {
    if (!control.reportValidity()) {
      return;
    }

    onChange(entry.path, `*${control.value}`, { literal: true });
  });

  const actions = element("div", "d-flex flex-wrap gap-2");

  if (anchorActions.reveal) {
    const show = button("Go to shared value", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary editor-reusable-action d-inline-flex align-items-center gap-2 justify-self-start");
    show.addEventListener("click", () => anchorActions.reveal(entry, control.value.trim()));
    actions.append(show);
  }

  if (entry.syntax?.kind === "alias" && anchorActions.detach) {
    const detach = button("Unlink and edit separately", "fa-solid fa-link-slash", "btn btn-sm btn-site-secondary editor-reusable-action d-inline-flex align-items-center gap-2 justify-self-start");
    detach.title = "Keep the current values here as an independent copy you can edit separately.";
    detach.addEventListener("click", () => anchorActions.detach(entry, control.value.trim()));
    actions.append(detach);
  }

  const relationship = reusableRelationshipCard({
    eyebrow: "Linked value",
    relationLabel: "Linked to",
    control,
    help: "This setting follows the shared value. Edit the original once to update every linked setting.",
    actions
  });
  const resolvedSource = anchorActions.resolve?.(entry, name) ?? "";

  return reusableRelationshipFlow(resolvedValueControl(resolvedSource, {
    type,
    messageMacros: entry.messageMacros
  }), relationship);
}

function reusableValueNotice(entry, onRenameAnchor, onRemoveAnchor) {
  const name = parseAnchorName(entry.source) ?? "shared-value";
  const input = element("input", "form-control editor-input editor-input--code");
  input.value = name;
  input.pattern = "[A-Za-z0-9_\-]+";
  input.readOnly = !onRenameAnchor;
  input.addEventListener("change", () => {
    if (!input.reportValidity() || input.value.trim() === name) {
      return;
    }

    onRenameAnchor?.(entry.path, input.value);
  });
  const actions = element("div", "d-flex flex-wrap gap-2");

  if (onRemoveAnchor) {
    actions.append(stopSharingButton(entry, name, onRemoveAnchor));
  }

  return reusableRelationshipCard({
    eyebrow: "Shared list",
    relationLabel: "Shared as",
    control: input,
    help: "Compatible lists later in this file can link to this one and stay in sync.",
    actions
  });
}

function importedAnchorControl(entry, parsed, onChange, onRenameAnchor) {
  const context = entry.templateContext;
  const wrapper = element("div", "editor-compound d-grid gap-2");
  const summary = element("div", "editor-ghost-card rounded-3 p-3 d-flex flex-wrap align-items-start justify-content-between gap-2");
  const copy = element("div", "min-w-0");
  copy.append(
    element("span", "editor-eyebrow", "Imported parent value"),
    element("strong", "d-block mt-1", context?.resolved
      ? `Available from ${context.parentFileName || context.importName}`
      : `“${parsed.parentName}” could not be found in the parent`)
  );
  summary.append(copy);
  if (context?.resolved && entry.onNavigateTemplate) {
    const reveal = button("Open parent value", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary");
    reveal.addEventListener("click", () => entry.onNavigateTemplate({
      fileName: context.parentFileName,
      path: context.resolved.path
    }));
    summary.append(reveal);
  }

  const fields = element("div", "editor-compound-grid editor-compound-grid--two d-grid gap-2");
  const local = labeledInput("Shared value name in this file", parsed.localName);
  const parentInput = context?.available?.length
    ? element("select", "form-select editor-input editor-input--code")
    : element("input", "form-control editor-input editor-input--code");

  if (parentInput.tagName === "SELECT") {
    const names = [...new Set([...context.available.map((candidate) => candidate.name), parsed.parentName])];
    names.forEach((name) => parentInput.append(option(name, name, name === parsed.parentName)));
  } else {
    parentInput.value = parsed.parentName;
    parentInput.pattern = "[A-Za-z0-9_\\-]+";
  }

  const parent = labeledControl("Value from the parent template", parentInput);
  local.input.pattern = "[A-Za-z0-9_\-]+";
  local.input.addEventListener("change", () => {
    if (!local.input.reportValidity() || local.input.value.trim() === parsed.localName) {
      return;
    }

    if (onRenameAnchor) {
      onRenameAnchor(entry.path, local.input.value, parsed.localName);
    } else {
      onChange(entry.path, formatImportedAnchor(local.input.value, parentInput.value), { literal: true });
    }
  });
  parentInput.addEventListener("change", () => {
    if (parentInput.reportValidity()) {
      onChange(entry.path, formatImportedAnchor(parsed.localName, parentInput.value), { literal: true });
    }
  });
  fields.append(local.root, parent);
  wrapper.append(summary, fields, element("small", "editor-control-hint", "This brings one shared value in from the parent template and gives it a local name."));
  return wrapper;
}

function anchoredValueControl(entry, parsed, onChange, onRenameAnchor, onRemoveAnchor, type) {
  const anchor = labeledInput("Shared value name", parsed.name);
  anchor.input.pattern = "[A-Za-z0-9_\-]+";
  anchor.input.readOnly = !onRenameAnchor;
  anchor.input.addEventListener("change", () => {
    if (!anchor.input.reportValidity() || anchor.input.value.trim() === parsed.name) {
      return;
    }

    onRenameAnchor?.(entry.path, anchor.input.value);
  });
  const valueEntry = anchoredValueEntry(entry, parsed);
  const value = createControl(type, valueEntry, (_path, replacement) => {
    onChange(entry.path, formatAnchoredValue(parsed.name, replacement), { literal: true });
  });

  const actions = element("div", "d-flex flex-wrap gap-2");

  if (onRemoveAnchor) {
    actions.append(stopSharingButton(entry, parsed.name, onRemoveAnchor));
  }

  const relationship = reusableRelationshipCard({
    eyebrow: "Shared value",
    relationLabel: "Shared as",
    control: anchor.input,
    help: "Compatible settings later in this file can link to this value and stay in sync.",
    actions
  });

  return reusableRelationshipFlow(value, relationship);
}

export function anchoredValueEntry(entry, parsed = parseAnchoredValue(entry.source)) {
  if (!parsed) {
    return entry;
  }

  return {
    ...entry,
    source: parsed.value,
    syntax: null,
    advancedOnly: false
  };
}

function stopSharingButton(entry, name, onRemoveAnchor) {
  const stop = button("Stop sharing", "fa-solid fa-link-slash", "btn btn-sm btn-site-secondary d-inline-flex align-items-center gap-2");
  stop.type = "button";
  stop.addEventListener("click", () => onRemoveAnchor(entry.path, name));
  return stop;
}

function functionCallControl(entry, parsed, onChange) {
  const context = entry.templateContext;
  const wrapper = element("div", "editor-function editor-template-card rounded-3 p-3 d-grid gap-3");
  const header = element("div", "d-flex flex-wrap align-items-start justify-content-between gap-2");
  const copy = element("div", "min-w-0");
  copy.append(
    element("span", "editor-eyebrow", context?.kind === "function-merge" ? "Included generated settings" : "Generated entry"),
    element("strong", "d-block mt-1", context?.definition ? `Uses ${context.definition.name}` : `Unresolved template ${parsed.name}`)
  );
  header.append(copy);
  if (context?.definition && entry.onNavigateTemplate) {
    const reveal = button("Show entry template", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary");
    reveal.addEventListener("click", () => entry.onNavigateTemplate({ path: context.definition.entry.path }));
    header.append(reveal);
  }

  const templateNames = [...new Set([
    ...(context?.definitions ?? []).map((definition) => definition.name),
    parsed.name
  ])];
  const template = templateNames.length > 1
    ? element("select", "form-select editor-input editor-input--code")
    : element("input", "form-control editor-input editor-input--code");

  if (template.tagName === "SELECT") {
    templateNames.forEach((name) => template.append(option(name, name, name === parsed.name)));
  } else {
    template.value = parsed.name;
    template.pattern = "[A-Za-z0-9_\\-]+";
  }

  const parameterNames = context?.definition?.parameters ?? [];
  const values = [...parsed.args];

  while (values.length < parameterNames.length) {
    values.push('""');
  }

  const rows = element("div", "d-grid gap-2");
  values.forEach((value, index) => {
    const input = element("input", "form-control editor-input editor-input--code");
    input.value = value;
    input.setAttribute("aria-label", parameterNames[index] || `Extra input ${index - parameterNames.length + 1}`);
    input.addEventListener("change", () => {
      values[index] = input.value;
      commit();
    });
    const label = parameterNames[index]
      ? parameterNames[index].replace(/^<|>$/g, "").replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : `Extra input ${index - parameterNames.length + 1}`;
    const control = labeledControl(label, input);

    if (index >= parameterNames.length && parameterNames.length) {
      control.classList.add("is-invalid");
    }

    rows.append(control);
  });

  const commit = () => {
    if (!template.reportValidity()) {
      return;
    }

    onChange(entry.path, formatFunctionCall(template.value, values), { literal: true });
  };
  template.addEventListener("change", commit);

  wrapper.append(header, labeledControl("Entry template", template), rows);
  if (context?.missing?.length) {
    wrapper.append(element("small", "editor-validation--warning", `Missing ${context.missing.length === 1 ? "input" : "inputs"}: ${context.missing.join(", ")}. Blank inputs are shown so you can complete the call.`));
  }

  if (context?.inputs?.some((input) => input.extra)) {
    wrapper.append(element("small", "editor-validation--warning", "This call supplies more inputs than the entry template declares."));
  }

  if (context?.generated?.length) {
    wrapper.append(generatedPreview(context.generated));
  }

  return wrapper;
}

function generatedPreview(entries) {
  const details = element("details", "editor-template-result");
  const summary = element("summary", "", `Generated result · ${entries.length} ${entries.length === 1 ? "setting" : "settings"}`);
  const list = element("dl", "editor-template-result-list d-grid gap-2 mt-2 mb-0");

  for (const entry of entries.slice(0, 12)) {
    list.append(
      element("dt", "", entry.path.map((part) => String(part).replace(/^<|>$/g, "")).join(" → ")),
      element("dd", "mb-0", String(parseSimpleLiteral(entry.source).value ?? entry.source))
    );
  }

  if (entries.length > 12) {
    list.append(element("dt", "", "More"), element("dd", "mb-0", `${entries.length - 12} additional generated settings`));
  }

  details.append(summary, list);
  return details;
}

function textControl(type, entry, literal, onChange) {
  const input = element("input", "form-control editor-input");
  input.type = "text";
  input.value = String(literal.value);
  if (type.kind === "suggestion") {
    input.placeholder = type.typeName;
  }

  input.addEventListener("change", () => onChange(entry.path, formatStringLiteral(input.value, entry.source), { literal: false }));
  return input;
}

function customValueControl(entry, onChange) {
  const input = element("textarea", "form-control editor-input editor-input--custom");
  input.rows = Math.min(8, Math.max(3, entry.source.split(/\r\n|\n|\r/).length));
  input.value = entry.source;
  input.spellcheck = false;
  input.addEventListener("change", () => onChange(entry.path, input.value, { literal: true }));
  return input;
}

function guiSlotsControl(type, entry, onChange, anchorActions) {
  if (entry.syntax?.kind === "alias") {
    return reusableSettingsControl(entry, onChange, anchorActions, type);
  }

  const anchoredValue = entry.syntax?.kind === "anchor" && !entry.collectionItems
    ? parseAnchoredValue(entry.source)
    : null;

  if (anchoredValue) {
    return anchoredValueControl(
      entry,
      anchoredValue,
      onChange,
      anchorActions.rename,
      anchorActions.remove,
      type
    );
  }

  const listType = type.choices.find((choice) => choice.kind === "list");
  const collectionItems = entry.collectionItems ?? [{ source: entry.source }];

  return simpleSequenceControl(listType, entry, onChange, {}, {
    collectionItems,
    formatValues: (values) => formatGuiSlots(entry, values),
    itemName: "slot",
    nextValue: (values) => nextAvailableGuiSlot(entry.availableGuiSlots, values),
    commitOnAdd: true,
    unavailableTitle: "No empty inventory slots are available.",
    hint: "Add every inventory slot that should use this button. A single slot stays a single number in YAML."
  });
}

export function nextAvailableGuiSlot(availableSlots, values) {
  const selected = new Set(values.map(Number));

  return availableSlots.find((slot) => !selected.has(slot)) ?? null;
}

export function formatGuiSlots(entry, values) {
  if (values.length === 1) {
    const prefix = entry.sequencePrefix?.trimEnd();

    return prefix ? `${prefix} ${values[0]}` : String(values[0]);
  }

  if (!entry.collectionItems) {
    return values.length ? `[ ${values.join(", ")} ]` : "[]";
  }

  return formatSimpleSequence(entry, values, (value) => String(value));
}

function simpleSequenceControl(type, entry, onChange, anchorActions, options = {}) {
  const wrapper = element("div", "editor-list d-grid gap-2");
  const rows = element("div", "d-grid gap-2");
  const collectionItems = options.collectionItems ?? entry.collectionItems;
  const itemName = options.itemName ?? "item";
  const items = collectionItems.map((item) => ({
    value: String(parseSimpleLiteral(item.source).value),
    original: item
  }));
  let editors = [];
  let sortable;
  const nextValue = options.nextValue ?? ((currentValues) => nextListValue(type, currentValues));
  const commitOnAdd = options.commitOnAdd || isFixedChoiceSet(type);
  const refreshChoiceAvailability = () => {
    if (!isFixedChoiceSet(type)) {
      return;
    }

    editors.forEach((editor, index) => editor.setUnavailable?.(
      items.filter((_, itemIndex) => itemIndex !== index).map((item) => item.value)
    ));
  };

  const commit = () => {
    editors.forEach((editor) => editor.setDuplicate(false));

    if (type.kind === "set") {
      const seen = new Set();
      items.forEach((item, index) => {
        const normalized = item.value.trim().toLocaleLowerCase("en-US");

        if (seen.has(normalized)) {
          editors[index].setDuplicate(true);
        }

        seen.add(normalized);
      });
    }

    if (editors.some((editor) => !editor.reportValidity())) {
      return;
    }

    const nextValues = items.map((item) => item.value);
    const replacement = options.formatValues
      ? options.formatValues(nextValues)
      : formatSimpleSequence(
        entry,
        nextValues,
        (value, original, index) => formatListItem(type.elements, value, items[index]?.original?.source ?? original)
      );
    sortable?.destroy();
    onChange(entry.path, replacement, { literal: false });
  };

  const moveItem = (from, to, { focus = false } = {}) => {
    moveListItem(items, from, to);
    renderRows();
    commit();
    if (focus) {
      focusListHandle(entry.path, to);
    }
  };

  const renderRows = () => {
    rows.replaceChildren();
    editors = [];
    items.forEach((item, index) => {
      const row = element("div", "editor-list-row d-grid gap-2 align-items-center rounded-3");
      const handle = dragHandle(`${itemName} ${index + 1}`, index, items.length, moveItem);
      const editor = listItemEditor(type.elements, item.value, item.original, entry.key, (nextValue) => {
        items[index].value = nextValue;
        refreshChoiceAvailability();
        commit();
      }, anchorActions, entry.path, entry, index);
      labelControl(editor.root, `${labelForKey(entry.key)}: ${itemName} ${index + 1}`);
      editors.push(editor);
      const sharingMenu = listItemSharingMenu(item, index, entry, anchorActions);
      const remove = iconButton(`Remove ${itemName} ${index + 1}`, "fa-solid fa-xmark", "editor-icon-button editor-interactive-surface editor-icon-button--danger d-inline-grid");
      remove.addEventListener("click", () => {
        items.splice(index, 1);
        renderRows();
        commit();
      });
      const value = element("div", "editor-list-value d-grid gap-2");
      value.append(editor.root);
      row.append(handle, value);
      if (sharingMenu) {
        row.append(sharingMenu);
      }

      row.append(remove);
      rows.append(row);
    });
    refreshChoiceAvailability();
  };

  const add = button(`Add ${itemName}`, "fa-solid fa-plus", "btn btn-sm btn-site-secondary align-self-start");
  add.addEventListener("click", () => {
    const currentValues = items.map((item) => item.value);
    const value = nextValue(currentValues);

    if (value === null || value === undefined) {
      return;
    }

    items.push({ value: String(value), original: null });
    renderRows();
    if (commitOnAdd) {
      commit();
      return;
    }

    editors.at(-1)?.focus();
  });

  const updateAddState = () => {
    const value = nextValue(items.map((item) => item.value));
    add.disabled = value === null || value === undefined;
    add.title = add.disabled ? options.unavailableTitle ?? "No more values are available." : "";
  };

  renderRows();
  updateAddState();
  sortable = makeSortable(rows, moveItem);
  wrapper.append(rows, add, element(
    "small",
    "editor-control-hint",
    options.hint ?? "Drag the grip to change the order."
  ));
  return wrapper;
}

function listItemSharingMenu(item, itemIndex, entry, anchorActions) {
  const syntax = item.original?.syntax;
  const target = { path: entry.path, itemIndex };
  const actions = [];

  if (!syntax && anchorActions.create) {
    actions.push({
      label: "Create shared value",
      description: "Name this line so later list items can link to it.",
      icon: "fa-solid fa-link",
      action: () => anchorActions.create(target, `item ${itemIndex + 1} in ${labelForKey(entry.key)}`)
    });
  }

  if (syntax?.kind !== "anchor" && anchorActions.use) {
    actions.push({
      label: syntax?.kind === "alias" ? "Link to another shared value" : "Link to shared value",
      description: "Use a compatible line defined earlier in this file.",
      icon: "fa-solid fa-share",
      action: () => anchorActions.use(target, `item ${itemIndex + 1} in ${labelForKey(entry.key)}`)
    });
  }

  if (syntax?.kind === "alias" && anchorActions.detachList) {
    const name = parseAliasName(item.value);
    actions.push({
      label: "Unlink and edit separately",
      description: `Copy the current value from “${name}” into this list item.`,
      icon: "fa-solid fa-link-slash",
      action: () => anchorActions.detachList(target, name)
    });
  }

  if (syntax?.kind === "alias" && anchorActions.revealList) {
    const name = parseAliasName(item.value);
    actions.unshift({
      label: "Go to shared value",
      description: `Show where “${name}” is defined.`,
      icon: "fa-solid fa-arrow-up-right-from-square",
      action: () => anchorActions.revealList(target, name)
    });
  }

  if (syntax?.kind === "anchor" && anchorActions.removeList) {
    const name = parseAnchorName(item.value);
    actions.push({
      label: "Stop sharing",
      description: `Keep “${name}” and every linked item as independent values.`,
      icon: "fa-solid fa-link-slash",
      action: () => anchorActions.removeList(target, name)
    });
  }

  if (!actions.length) {
    return null;
  }

  return moreActionsMenu(actions, `Shared value actions for item ${itemIndex + 1}`);
}

function makeSortable(rows, onMove) {
  return Sortable.create(rows, {
    animation: 160,
    draggable: ".editor-list-row",
    handle: ".editor-drag-handle",
    chosenClass: "is-sorting",
    ghostClass: "is-sortable-ghost",
    onEnd(event) {
      if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) {
        return;
      }

      onMove(event.oldIndex, event.newIndex);
    }
  });
}

function dragHandle(label, index, itemCount, onMove) {
  const handle = iconButton(
    `Drag to reorder ${label}. Use the arrow keys to move it.`,
    "fa-solid fa-grip-vertical",
    "editor-icon-button editor-interactive-surface editor-drag-handle editor-drag-surface d-inline-grid align-self-start"
  );
  handle.addEventListener("keydown", (event) => {
    const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const nextIndex = index + offset;

    if (!offset || nextIndex < 0 || nextIndex >= itemCount) {
      return;
    }

    event.preventDefault();
    onMove(index, nextIndex, { focus: true });
  });
  return handle;
}

function focusListHandle(path, index) {
  window.requestAnimationFrame(() => {
    const marker = optionPathMarker(path);
    const field = [...document.querySelectorAll("[data-option-path]")]
      .find((candidate) => candidate.dataset.optionPath === marker);
    field?.querySelectorAll(".editor-drag-handle")[index]?.focus();
  });
}

function moveListItem(items, from, to) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return;
  }

  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

function listItemEditor(type, value, item, parentKey, onUpdate, anchorActions, parentPath, parentEntry, itemIndex = -1) {
  const current = unwrapNullable(type);

  if (item?.syntax?.kind === "function-call") {
    return functionListEditor(value, onUpdate, parentEntry, item);
  }

  if (item?.syntax?.kind === "imported-anchor") {
    return importedAnchorListEditor(value, onUpdate, anchorActions?.rename, parentPath, parentEntry);
  }

  if (item?.syntax?.kind === "anchor") {
    return anchoredListEditor(value, current, parentKey, onUpdate, anchorActions?.rename, parentPath, parentEntry);
  }

  if (item?.syntax?.kind === "sequence-merge") {
    return sequenceMergeEditor(value, onUpdate, anchorActions?.names);
  }

  if (item?.syntax?.kind === "alias") {
    const target = { path: parentPath, itemIndex };

    return reusableAliasListEditor(value, onUpdate, {
      type: current,
      parentKey,
      parentEntry,
      names: anchorActions?.listNames?.(target) ?? [],
      resolvedSource: anchorActions?.resolveList?.(target, parseAliasName(value) ?? "") ?? ""
    });
  }

  if (current.typeName === "Potion") {
    return potionEditor(value, onUpdate);
  }

  if (["StringMatcher", "StringMatcher<Material>"].includes(current.typeName)) {
    return matcherEditor(value, current.typeName === "StringMatcher<Material>", onUpdate);
  }

  if (isCommandKey(parentKey) || /^(?:CONSOLE|PLAYER|OP):/.test(value)) {
    return commandEditor(value, onUpdate);
  }

  if (current.typeName === "Message") {
    return messageListEditor(value, parentKey, parentEntry, onUpdate);
  }

  if (current.kind === "enum") {
    const select = element("select", "form-select editor-input");
    const values = [...current.values];

    if (value && !values.includes(value)) {
      values.unshift(value);
    }

    values.forEach((candidate) => select.append(option(enumOptionLabel(current, candidate), candidate, candidate === value)));
    select.addEventListener("change", () => onUpdate(select.value));
    const editor = inputEditor(select);
    editor.setUnavailable = (otherValues) => {
      for (const candidate of select.options) {
        candidate.disabled = listChoiceUnavailable(candidate.value, select.value, otherValues);
      }
    };
    return editor;
  }

  if (current.kind === "boolean") {
    const select = element("select", "form-select editor-input");
    select.append(option("Enabled", "true", value.toLocaleLowerCase("en-US") === "true"));
    select.append(option("Disabled", "false", value.toLocaleLowerCase("en-US") === "false"));
    select.addEventListener("change", () => onUpdate(select.value));
    return inputEditor(select);
  }

  const input = element("input", "form-control editor-input");
  input.type = current.kind === "integer" || current.kind === "decimal" ? "number" : "text";
  if (current.kind === "integer") {
    input.step = "1";
  }

  if (current.kind === "decimal") {
    input.step = "any";
  }

  input.value = value;
  if (current.minimum !== undefined) {
    input.min = String(current.minimum);
  }

  if (current.maximum !== undefined) {
    input.max = String(current.maximum);
  }

  const registry = registryForType(current);
  const inputControl = registry ? attachRegistry(input, registry) : input;
  input.addEventListener("change", () => {
    if (registry && current.allowCustom === false) {
      const original = String(parseSimpleLiteral(item?.source ?? "").value ?? "");
      const unchangedUnknown = input.value === original && !registryContains(registry, original);
      input.setCustomValidity(registryContains(registry, input.value) || unchangedUnknown
        ? ""
        : `Choose a ${registry.typeName} value from the list.`);
    }

    if (input.reportValidity()) {
      onUpdate(input.value);
    }
  });
  const editor = inputEditor(input);
  editor.root = inputControl;
  return editor;
}

function messageListEditor(value, parentKey, parentEntry, onUpdate) {
  const trigger = richValueTrigger(
    `Edit formatted ${labelForKey(parentKey).toLocaleLowerCase("en-US")} line`,
    messagePreviewElement(value, {
      macros: parentEntry.messageMacros,
      showHeading: false,
      showDetails: false,
      interactive: false
    })
  );
  let duplicate = false;
  trigger.addEventListener("click", () => openMessageEditor({
    entry: parentEntry,
    source: value,
    title: `Edit ${labelForKey(parentKey)} line`,
    eyebrow: "Formatted message",
    onSave: onUpdate
  }));
  return {
    root: trigger,
    value: () => value,
    reportValidity: () => !duplicate,
    setDuplicate: (next) => {
      duplicate = next;
      trigger.classList.toggle("is-invalid", next);
      trigger.setAttribute("aria-invalid", String(next));
    },
    focus: () => trigger.focus()
  };
}

function formatListItem(type, value, original) {
  const current = unwrapNullable(type);

  if (classifySequenceItem(value)) {
    return value;
  }

  if (current.kind === "boolean") {
    return value === "true" ? "true" : "false";
  }

  if (current.kind === "integer" || current.kind === "decimal") {
    return value;
  }

  return formatStringLiteral(value, original);
}

function initialListValue(type) {
  const current = unwrapNullable(type);

  if (current.typeName === "Potion") {
    return "SPEED, 60, 1";
  }

  if (current.kind === "boolean") {
    return "false";
  }

  if (current.kind === "integer" || current.kind === "decimal") {
    return String(current.minimum ?? 0);
  }

  if (current.kind === "enum") {
    return current.values[0] ?? "";
  }

  return "";
}

export function nextListValue(type, currentValues = []) {
  const current = unwrapNullable(type);
  const elements = unwrapNullable(current.elements);

  if (current.kind !== "set" || elements?.kind !== "enum") {
    return initialListValue(current.elements);
  }

  const used = new Set(currentValues.map((value) => String(value).toLocaleLowerCase("en-US")));

  return elements.values.find((value) => !used.has(String(value).toLocaleLowerCase("en-US"))) ?? null;
}

export function listChoiceUnavailable(candidate, currentValue, otherValues = []) {
  const normalizedCandidate = String(candidate).toLocaleLowerCase("en-US");

  if (normalizedCandidate === String(currentValue).toLocaleLowerCase("en-US")) {
    return false;
  }

  return otherValues.some((value) => String(value).toLocaleLowerCase("en-US") === normalizedCandidate);
}

function isFixedChoiceSet(type) {
  const current = unwrapNullable(type);

  return current.kind === "set" && unwrapNullable(current.elements)?.kind === "enum";
}

function potionEditor(value, onUpdate) {
  const parsed = parsePotionSpec(value);

  if (!parsed) {
    const input = element("input", "form-control editor-input editor-input--code");
    input.value = value;
    input.placeholder = "SPEED, 60, 1 %100";
    input.addEventListener("change", () => onUpdate(input.value));
    const editor = inputEditor(input);
    editor.root = controlWithHint(input, "Potion format: effect, duration in seconds, level, and optional %chance.");
    return editor;
  }

  const root = element("div", "editor-compound d-grid gap-2");
  const grid = element("div", "editor-compound-grid editor-potion-grid d-grid gap-2");
  const effect = labeledInput("Effect", parsed.effect);
  attachRegistry(effect.input, registryForType({ typeName: "PotionEffectType" }));
  const duration = labeledInput("Seconds", parsed.duration, "number");
  duration.input.min = "0";
  duration.input.step = "any";
  const level = labeledInput("Level", parsed.level, "number");
  level.input.min = "1";
  level.input.step = "1";
  const chance = labeledInput("Chance %", parsed.chance, "number");
  chance.input.min = "0";
  chance.input.max = "100";
  chance.input.step = "any";
  const inputs = [effect.input, duration.input, level.input, chance.input];
  const getValue = () => formatPotionSpec({
    effect: effect.input.value,
    duration: duration.input.value,
    level: level.input.value,
    chance: chance.input.value
  });
  inputs.forEach((input) => input.addEventListener("change", () => {
    if (inputs.every((candidate) => candidate.reportValidity())) {
      onUpdate(getValue());
    }
  }));
  grid.append(effect.root, duration.root, level.root, chance.root);
  root.append(grid, element("small", "editor-control-hint", "Potion effect, duration in seconds, level (starting at 1), and optional chance."));
  return compoundEditor(root, inputs, getValue, effect.input);
}

function matcherEditor(value, material, onUpdate) {
  const parsed = parseStringMatcher(value);
  const root = element("div", "editor-compound d-grid gap-2");
  const grid = element("div", "editor-compound-grid editor-compound-grid--two d-grid gap-2");
  const mode = element("select", "form-select editor-input");
  ["EXACT", "CI", "CONTAINS", "STARTS", "ENDS", "REGEX", "REGEX@CI"].forEach((candidate) => {
    mode.append(option(labelForKey(candidate.replace("@", " ")), candidate, candidate === parsed.mode));
  });
  const modeField = labeledControl("Match", mode);
  const pattern = labeledInput(material ? "Material or pattern" : "Value or pattern", parsed.value);

  if (material) {
    attachRegistry(pattern.input, registryForType({ typeName: "Material" }));
  }

  const inputs = [mode, pattern.input];
  const getValue = () => formatStringMatcher(mode.value, pattern.input.value);
  const commit = () => {
    pattern.input.setCustomValidity("");
    if (mode.value.startsWith("REGEX")) {
      try {
        new RegExp(pattern.input.value);
      } catch (error) {
        pattern.input.setCustomValidity(error.message);
      }
    }

    if (pattern.input.reportValidity()) {
      onUpdate(getValue());
    }
  };
  mode.addEventListener("change", commit);
  pattern.input.addEventListener("change", commit);
  grid.append(modeField, pattern.root);
  root.append(grid, element("small", "editor-control-hint", "Choose exact, case-insensitive, contains, starts/ends with, or regular-expression matching."));
  return compoundEditor(root, inputs, getValue, pattern.input);
}

function commandEditor(value, onUpdate) {
  const parsed = parseCommandSpec(value);
  const root = element("div", "editor-compound d-grid gap-2");
  const grid = element("div", "editor-compound-grid editor-compound-grid--two d-grid gap-2");
  const executor = element("select", "form-select editor-input");
  [
    ["Default player", "DEFAULT"],
    ["Console", "CONSOLE"],
    ["Player", "PLAYER"],
    ["Temporary operator", "OP"]
  ].forEach(([label, candidate]) => executor.append(option(label, candidate, candidate === parsed.executor)));
  const executorField = labeledControl("Run as", executor);
  const command = labeledInput("Command", parsed.command);
  const inputs = [executor, command.input];
  const getValue = () => formatCommandSpec(executor.value, command.input.value);
  inputs.forEach((input) => input.addEventListener("change", () => onUpdate(getValue())));
  grid.append(executorField, command.root);
  root.append(grid, element("small", "editor-control-hint", "The leading slash is optional. Choose who should run this command."));
  return compoundEditor(root, inputs, getValue, command.input);
}

function functionListEditor(value, onUpdate, parentEntry, item) {
  const parsed = parseFunctionCall(value);

  if (!parsed) {
    return basicTextEditor(value, onUpdate);
  }

  const definitions = parentEntry?.templateDefinitions ?? [];
  const callLine = item?.line ?? parentEntry?.line ?? Infinity;
  const definition = definitions
    .filter((candidate) => candidate.name === parsed.name && candidate.entry.line <= callLine)
    .at(-1);
  const root = element("div", "editor-ghost-card rounded-3 p-2 d-grid gap-2");
  const names = [...new Set([
    ...definitions.filter((candidate) => candidate.entry.line <= callLine).map((candidate) => candidate.name),
    parsed.name
  ])];
  const name = names.length > 1
    ? element("select", "form-select editor-input editor-input--code")
    : element("input", "form-control editor-input editor-input--code");

  if (name.tagName === "SELECT") {
    names.forEach((candidate) => name.append(option(candidate, candidate, candidate === parsed.name)));
  } else {
    name.value = parsed.name;
    name.pattern = "[A-Za-z0-9_\\-]+";
  }

  const values = [...parsed.args];
  const parameterNames = definition?.parameters ?? [];

  while (values.length < parameterNames.length) {
    values.push('""');
  }

  const controls = element("div", "editor-compound-grid editor-compound-grid--two d-grid gap-2");
  const inputs = [name];
  values.forEach((argument, index) => {
    const input = element("input", "form-control editor-input editor-input--code");
    input.value = argument;
    inputs.push(input);
    const label = parameterNames[index]
      ? parameterNames[index].replace(/^<|>$/g, "").replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : `Extra input ${index - parameterNames.length + 1}`;
    controls.append(labeledControl(label, input));
  });
  const getValue = () => formatFunctionCall(name.value, inputs.slice(1).map((input) => input.value));
  const commit = () => {
    if (inputs.every((input) => input.reportValidity())) {
      onUpdate(getValue());
    }
  };
  inputs.forEach((input) => input.addEventListener("change", commit));
  root.append(
    labeledControl("Entry template", name),
    controls,
    element("small", "editor-control-hint", definition
      ? "This list item is generated from the entry template above."
      : "The referenced entry template could not be resolved earlier in this file.")
  );
  if (definition && parsed.args.length !== parameterNames.length) {
    root.append(element("small", "editor-validation--warning", `This call supplies ${parsed.args.length} ${parsed.args.length === 1 ? "input" : "inputs"}. The template declares ${parameterNames.length}.`));
  }

  if (definition && parentEntry?.onNavigateTemplate) {
    const reveal = button("Show entry template", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary justify-self-start");
    reveal.addEventListener("click", () => parentEntry.onNavigateTemplate({ path: definition.entry.path }));
    root.append(reveal);
  }

  return compoundEditor(root, inputs, getValue, name);
}

function importedAnchorListEditor(value, onUpdate, onRenameAnchor, parentPath, parentEntry) {
  const parsed = parseImportedAnchor(value);

  if (!parsed) {
    return basicTextEditor(value, onUpdate);
  }

  const imported = parentEntry?.templateContext?.imported;
  const root = element("div", "editor-ghost-card rounded-3 p-2 d-grid gap-2");
  const fields = element("div", "editor-compound-grid editor-compound-grid--two d-grid gap-2");
  const local = labeledInput("Shared value name in this file", parsed.localName);
  const parentInput = imported?.anchors?.length
    ? element("select", "form-select editor-input editor-input--code")
    : element("input", "form-control editor-input editor-input--code");

  if (parentInput.tagName === "SELECT") {
    const names = [...new Set([parsed.parentName, ...imported.anchors.map((candidate) => candidate.name)])];
    names.forEach((name) => parentInput.append(option(name, name, name === parsed.parentName)));
  } else {
    parentInput.value = parsed.parentName;
    parentInput.pattern = "[A-Za-z0-9_\\-]+";
  }

  const parent = labeledControl("Value from the parent template", parentInput);
  const inputs = [local.input, parentInput];
  local.input.pattern = "[A-Za-z0-9_\-]+";
  const getValue = () => formatImportedAnchor(local.input.value, parentInput.value);
  local.input.addEventListener("change", () => {
    if (!inputs.every((candidate) => candidate.reportValidity())) {
      return;
    }

    if (onRenameAnchor) {
      onRenameAnchor(parentPath, local.input.value, parsed.localName);
    } else {
      onUpdate(getValue());
    }
  });
  parentInput.addEventListener("change", () => {
    if (inputs.every((candidate) => candidate.reportValidity())) {
      onUpdate(getValue());
    }
  });
  fields.append(local.root, parent);
  root.append(fields, element("small", "editor-control-hint", imported?.resolved
    ? `Imports a named value from ${imported.parentFileName}.`
    : "The parent template is not among the open files, so its available values cannot be listed."));
  if (imported?.resolved && parentEntry?.onNavigateTemplate) {
    const reveal = button("Open parent value", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary justify-self-start");
    reveal.addEventListener("click", () => {
      const target = imported.anchors.find((candidate) => candidate.name === parentInput.value);

      if (target) {
        parentEntry.onNavigateTemplate({ fileName: imported.parentFileName, path: target.path });
      }
    });
    root.append(reveal);
  }

  return compoundEditor(root, inputs, getValue, local.input);
}

function anchoredListEditor(value, type, parentKey, onUpdate, onRenameAnchor, parentPath, parentEntry) {
  const parsed = parseAnchoredValue(value);

  if (!parsed) {
    return basicTextEditor(value, onUpdate);
  }

  const name = element("input", "form-control editor-input editor-input--code editor-list-anchor-name");
  name.value = parsed.name;
  name.pattern = "[A-Za-z0-9_\-]+";
  name.setAttribute("aria-label", "Shared value name");
  const literal = parseSimpleLiteral(parsed.value);
  const current = unwrapNullable(type);
  let sharedValue = String(literal.value);
  const getValue = () => formatAnchoredValue(
    name.value,
    formatListItem(current, sharedValue, parsed.value)
  );
  const shared = listItemEditor(
    current,
    sharedValue,
    null,
    parentKey,
    (nextValue) => {
      sharedValue = nextValue;
      onUpdate(getValue());
    },
    {},
    parentPath,
    parentEntry
  );
  name.addEventListener("change", () => {
    if (!name.reportValidity() || name.value.trim() === parsed.name) {
      return;
    }

    if (onRenameAnchor) {
      onRenameAnchor(parentPath, name.value, parsed.name);
    } else {
      onUpdate(getValue());
    }
  });
  const relationship = reusableListItemFrame({
    eyebrow: "Shared value",
    relationLabel: "Shared as",
    help: "Later compatible list items can link to this value.",
    control: name
  });
  const root = reusableRelationshipFlow(shared.root, relationship);

  return {
    root,
    value: getValue,
    reportValidity: () => name.reportValidity() && shared.reportValidity(),
    setDuplicate: (duplicate) => shared.setDuplicate(duplicate),
    focus: () => shared.focus()
  };
}

function sequenceMergeEditor(value, onUpdate, anchorNames = []) {
  const parsed = parseSequenceMerge(value) ?? { operator: "<<", anchor: "shared" };
  const root = element("div", "editor-ghost-card rounded-3 p-2 d-grid gap-2");
  const primary = element("div", "d-grid gap-2");
  const names = [...new Set([parsed.anchor, ...anchorNames].filter(Boolean))];
  const input = names.length > 1
    ? element("select", "form-select editor-input editor-input--code")
    : element("input", "form-control editor-input editor-input--code");

  if (input.tagName === "SELECT") {
    names.forEach((name) => input.append(option(name, name, name === parsed.anchor)));
  } else {
    input.value = parsed.anchor;
    input.pattern = "[A-Za-z0-9_\\-]+";
  }

  primary.append(labeledControl("Include lore lines from shared list", input));
  const advanced = element("details", "editor-advanced-syntax");
  const advancedSummary = element("summary", "", "Advanced merge behavior");
  const operator = element("select", "form-select editor-input editor-input--code");
  operator.append(
    option("Insert one shared list", "<", parsed.operator === "<"),
    option("Splice all list items", "<<", parsed.operator === "<<")
  );
  const getValue = () => formatSequenceMerge(operator.value, input.value);

  for (const control of [operator, input]) {
    control.addEventListener("change", () => {
      if (input.reportValidity()) {
        onUpdate(getValue());
      }
    });
  }

  advanced.append(advancedSummary, labeledControl("How to include it", operator));
  root.append(primary, advanced);
  const editor = compoundEditor(root, [operator, input], getValue, input);
  editor.root = controlWithHint(root, "This is a structural include. It is not rendered as literal lore text.");
  return editor;
}

function reusableAliasListEditor(value, onUpdate, context = {}) {
  const name = parseAliasName(value) ?? "";
  const input = element("select", "form-select editor-input editor-input--code");
  const names = [...new Set([name, ...(context.names ?? [])].filter(Boolean))];
  names.forEach((candidate) => input.append(option(candidate, candidate, candidate === name)));
  input.setAttribute("aria-label", "Shared value");
  const getValue = () => `*${input.value}`;
  input.addEventListener("change", () => {
    if (input.reportValidity()) {
      onUpdate(getValue());
    }
  });
  const editor = inputEditor(input, getValue);
  const resolved = parseAnchoredValue(context.resolvedSource)?.value || context.resolvedSource;
  const valuePresentation = resolvedValueControl(resolved, {
    type: context.type,
    messageMacros: context.parentEntry?.messageMacros
  });
  const relationship = reusableListItemFrame({
    eyebrow: "Linked value",
    relationLabel: "Linked to",
    help: "This list item follows the shared value.",
    control: input
  });
  editor.root = reusableRelationshipFlow(valuePresentation, relationship);
  return editor;
}

function reusableListItemFrame({ eyebrow, relationLabel, help, control }) {
  return reusableRelationshipCard({ eyebrow, relationLabel, help, control, compact: true });
}

function reusableRelationshipCard({ eyebrow, relationLabel, help, control, actions = null, compact = false }) {
  const classes = compact
    ? "editor-reusable editor-reusable--list editor-surface-card rounded-3 p-2 d-grid gap-2"
    : "editor-reusable editor-surface-card rounded-3 p-3 d-grid gap-3";
  const root = element("aside", classes);
  const summary = element("div", "editor-reusable-summary d-flex align-items-start gap-2 min-w-0");
  const icon = element("span", "editor-reusable-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", "fa-solid fa-link"));
  const copy = element("div", "editor-reusable-copy d-grid gap-1 min-w-0");
  copy.append(element("span", "editor-eyebrow", eyebrow));
  const controlRow = element("div", "editor-reusable-relation d-flex flex-wrap align-items-center gap-2 min-w-0");
  const controlId = control.id || `editor-setting-control-${++labeledControlId}`;
  control.id = controlId;
  const label = element("label", "editor-reusable-name fw-bold", `${relationLabel}:`);
  label.htmlFor = controlId;
  controlRow.append(label, control);
  copy.append(controlRow);
  copy.append(element("span", `editor-reusable-help${compact ? " text-truncate" : ""}`, help));
  summary.append(icon, copy);
  root.append(summary);
  if (actions?.childElementCount) {
    root.append(actions);
  }

  return root;
}

function reusableRelationshipFlow(value, relationship) {
  const root = element("div", "editor-reusable-flow d-grid min-w-0");
  const valueWrapper = element("div", "editor-reusable-flow-value d-grid gap-2 min-w-0");
  valueWrapper.append(value);
  root.append(valueWrapper, reusableTreeConnector(), relationship);
  return root;
}

function reusableTreeConnector() {
  const connector = element("span", "editor-reusable-flow-connector");
  connector.setAttribute("aria-hidden", "true");
  return connector;
}

function resolvedValueControl(source, { type = null, messageMacros = null } = {}) {
  const resolved = String(parseSimpleLiteral(source).value ?? "");
  let resolvedType = unwrapNullable(type);

  if (resolvedType?.kind === "union") {
    resolvedType = unwrapNullable(unionChoiceForEntry(resolvedType.choices, { source }));
  }

  if (["Message", "MessageEntry"].includes(resolvedType?.typeName)) {
    const preview = messagePreviewElement(resolved, {
      macros: messageMacros,
      showHeading: false,
      showDetails: false,
      interactive: false
    });
    preview.classList.add("editor-reusable-flow-resolved-preview");
    preview.setAttribute("aria-disabled", "true");
    return preview;
  }

  if (["list", "set"].includes(resolvedType?.kind)) {
    const summary = resolvedSequenceSummary(source);

    if (summary) {
      const preview = element(
        "div",
        "form-control editor-input editor-input--code editor-reusable-flow-resolved editor-reusable-flow-resolved-list is-disabled"
      );

      if (!summary.items.length) {
        preview.textContent = "No values";
      }

      summary.items.forEach((item, index) => {
        if (index) {
          preview.append(document.createTextNode(", "));
        }

        preview.append(element("span", "editor-reusable-flow-resolved-list-item text-nowrap", item));
      });
      preview.title = `${summary.count} shared ${summary.count === 1 ? "value" : "values"}`;
      preview.setAttribute("aria-disabled", "true");
      preview.setAttribute("aria-label", `Resolved shared list with ${summary.count} ${summary.count === 1 ? "value" : "values"}`);
      return preview;
    }
  }

  if (["mapping", "object"].includes(resolvedType?.kind)) {
    const summary = resolvedMappingSummary(source);

    if (summary) {
      const preview = element(
        "div",
        "editor-reusable-flow-resolved-group is-disabled d-grid overflow-hidden"
      );
      const conditionKeys = resolvedType.kind === "mapping"
        && unwrapNullable(resolvedType.keys)?.language === "condition";
      const mappingValueType = resolvedType.kind === "mapping" ? resolvedType.values : null;

      for (const item of summary.items) {
        const row = element("div", "editor-reusable-flow-resolved-group-row d-grid align-items-center gap-2");
        const key = element(
          "span",
          "editor-reusable-flow-resolved-group-key",
          conditionKeys ? `When ${readableCondition(item.key)}` : item.key
        );
        const itemType = unwrapNullable(
          resolvedType.kind === "object"
            ? resolvedType.fields?.find((candidate) => candidate.key === item.key)?.type ?? resolvedType.additionalProperties
            : resolvedType.fields?.find((candidate) => candidate.key === item.key)?.type ?? mappingValueType
        );
        const value = ["Message", "MessageEntry"].includes(itemType?.typeName)
          ? messagePreviewElement(item.value, {
            macros: messageMacros,
            showHeading: false,
            showDetails: false,
            interactive: false
          })
          : element("span", "editor-reusable-flow-resolved-group-value", item.value);
        value.classList.add("editor-reusable-flow-resolved-group-message");
        row.append(key, value);
        preview.append(row);
      }

      if (!summary.items.length) {
        preview.append(element("span", "editor-reusable-flow-resolved-group-empty", "No settings"));
      }

      preview.title = `${summary.count} shared ${summary.count === 1 ? "setting" : "settings"}`;
      preview.setAttribute("aria-disabled", "true");
      preview.setAttribute("aria-label", `Resolved shared group with ${summary.count} ${summary.count === 1 ? "setting" : "settings"}`);
      return preview;
    }
  }

  const multiline = /\r\n|\n|\r/.test(resolved) || resolved.length > 120;
  const control = element(
    multiline ? "textarea" : "input",
    `form-control editor-input editor-input--code editor-reusable-flow-resolved${multiline ? " editor-input--custom" : ""}`
  );

  if (multiline) {
    control.rows = Math.min(8, Math.max(2, resolved.split(/\r\n|\n|\r/).length));
  } else {
    control.type = "text";
  }

  control.value = resolved;
  control.disabled = true;
  control.spellcheck = false;
  control.placeholder = "Shared value could not be resolved";
  control.setAttribute("aria-label", "Resolved shared value");
  return control;
}

function resolvedSequenceSummary(source) {
  const index = indexYamlSource(`value: ${String(source)}${/(?:\r\n|\n|\r)$/.test(String(source)) ? "" : "\n"}`);
  const items = index.byPath.get("value")?.collectionItems;

  if (!items) {
    return null;
  }

  const values = items.map((item) => String(parseSimpleLiteral(item.source).value ?? item.source));

  return {
    count: items.length,
    items: values
  };
}

function resolvedMappingSummary(source) {
  const raw = String(source);
  const wrapped = /^(?:\r\n|\n|\r)/.test(raw)
    ? `value:${raw}`
    : `value:\n${raw.split(/\r\n|\n|\r/).map((line) => `  ${line}`).join("\n")}\n`;
  const index = indexYamlSource(wrapped);
  const owner = index.byPath.get("value");

  if (!owner?.container) {
    return null;
  }

  const items = index.entries
    .filter((entry) => entry.path.length === 2 && entry.path[0] === "value")
    .map((entry) => ({
      key: String(entry.key),
      value: entry.container ? "Nested settings" : String(parseSimpleLiteral(entry.source).value ?? entry.source)
    }));

  return { count: items.length, items };
}

function basicTextEditor(value, onUpdate) {
  const input = element("input", "form-control editor-input editor-input--code");
  input.value = value;
  input.addEventListener("change", () => onUpdate(input.value));
  return inputEditor(input);
}

function inputEditor(input, getValue = () => input.value) {
  return {
    root: input,
    value: getValue,
    reportValidity: () => input.reportValidity(),
    setDuplicate: (duplicate) => input.setCustomValidity(duplicate ? "Set values must be unique." : ""),
    focus: () => input.focus()
  };
}

function compoundEditor(root, inputs, getValue, primary) {
  return {
    root,
    value: getValue,
    reportValidity: () => inputs.every((input) => input.reportValidity()),
    setDuplicate: (duplicate) => primary.setCustomValidity(duplicate ? "Set values must be unique." : ""),
    focus: () => primary.focus()
  };
}

function labeledInput(label, value, type = "text") {
  const input = element("input", "form-control editor-input");
  input.type = type;
  input.value = value;
  input.setAttribute("aria-label", label);
  return { root: labeledControl(label, input), input };
}

function mappingValueLabel(type) {
  const current = unwrapNullable(type);
  const explicit = conciseControlLabel(type?.valueLabel ?? current?.valueLabel);

  if (explicit) {
    return explicit;
  }

  const description = conciseControlLabel(current?.description ?? type?.description);

  if (description) {
    return description;
  }

  if (current?.kind === "advanced" && current.typeName === "any") {
    return "Value";
  }

  return describeType(current ?? type);
}

function labeledControl(label, control) {
  const floatingField = floatingLabelField(control);

  if (!floatingField) {
    const accessibleField = control.matches("input, textarea, select")
      ? control
      : control.querySelector("input, textarea, select");

    if (accessibleField && !accessibleField.getAttribute("aria-label")) {
      accessibleField.setAttribute("aria-label", label);
    }

    const root = element("div", "d-grid gap-1");
    root.append(element("span", "editor-subfield-label fw-bold", label), control);
    return root;
  }

  if (!floatingField.getAttribute("aria-label")) {
    floatingField.setAttribute("aria-label", label);
  }

  const root = element("div", "form-floating editor-floating");
  const id = floatingField.id || `editor-setting-control-${++labeledControlId}`;
  floatingField.id = id;
  if (floatingField.matches("input, textarea") && !floatingField.placeholder) {
    floatingField.placeholder = label;
  }

  const fieldLabel = element("label", "", label);
  fieldLabel.htmlFor = id;
  root.append(control, fieldLabel);
  return root;
}

function labelOptionControls(root, optionLabel, titleId) {
  const controls = controlFields(root).filter((control) =>
    control.getAttribute("aria-hidden") !== "true"
    && !control.getAttribute("aria-label")
    && !control.getAttribute("aria-labelledby")
    && !control.closest("label")
  );

  for (const [index, control] of controls.entries()) {
    const part = control.dataset.editorControlPart;

    if (part || controls.length > 1) {
      control.setAttribute("aria-label", `${optionLabel}: ${part || `Value ${index + 1}`}`);
    } else {
      control.setAttribute("aria-labelledby", titleId);
    }
  }
}

function labelControl(root, label) {
  const controls = controlFields(root).filter((control) =>
    control.getAttribute("aria-hidden") !== "true"
    && !control.getAttribute("aria-label")
    && !control.getAttribute("aria-labelledby")
    && !control.closest("label")
  );
  controls.forEach((control, index) => {
    control.setAttribute("aria-label", controls.length === 1 ? label : `${label}, value ${index + 1}`);
  });
}

function markControlPart(root, label) {
  const control = controlFields(root).find((candidate) =>
    candidate.getAttribute("aria-hidden") !== "true"
    && !candidate.getAttribute("aria-label")
    && !candidate.getAttribute("aria-labelledby")
    && !candidate.closest("label")
  );

  if (control) {
    control.dataset.editorControlPart = label;
  }
}

function controlFields(root) {
  const controls = root.matches("input, textarea, select") ? [root] : [];
  controls.push(...root.querySelectorAll("input, textarea, select"));
  return controls;
}

function supportsFloatingLabel(control) {
  return Boolean(floatingLabelField(control));
}

function floatingLabelField(control) {
  if (control.matches("textarea.editor-input--custom")) {
    return null;
  }

  if (control.matches("input.form-control, textarea.form-control, select.form-select")) {
    return control;
  }

  if (control.matches(".editor-search-select")) {
    return control.querySelector("input.form-control");
  }

  return null;
}

function conciseControlLabel(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");

  if (!text || text.length > 48 || /[\n\r]/.test(text)) {
    return "";
  }

  return text.replace(/[.!?:;]+$/, "");
}

function equivalentLabels(left, right) {
  const normalize = (value) => String(value ?? "")
    .trim()
    .replace(/[.!?:;]+$/, "")
    .toLocaleLowerCase("en-US");

  return normalize(left) === normalize(right);
}

function toggleControl(label, checked) {
  const root = element("label", "editor-switch editor-switch--small d-inline-flex align-items-center gap-2 mb-0");
  const input = element("input", "visually-hidden");
  input.type = "checkbox";
  input.role = "switch";
  input.checked = checked;
  const track = element("span", "editor-switch-track position-relative flex-shrink-0");
  track.setAttribute("aria-hidden", "true");
  root.append(input, track, element("span", "editor-switch-state", label));
  return { root, input };
}

function controlWithHint(control, text) {
  const root = element("div", "d-grid gap-2");
  root.append(control, element("small", "editor-control-hint", text));
  return root;
}

function validateExpression(input, hint, language) {
  const problem = expressionProblem(input.value, language);
  input.setCustomValidity(problem);
  hint.classList.toggle("is-error", Boolean(problem));
  hint.textContent = problem;
  hint.hidden = !problem;
  return !problem;
}

function inferType(entry, schemaId = "") {
  if (entry.collectionItems) {
    return { kind: "list", elements: { kind: "string" } };
  }

  const literal = parseSimpleLiteral(entry.source);

  if (literal.kind === "boolean") {
    return { kind: "boolean" };
  }

  if (literal.kind === "integer") {
    return { kind: "integer" };
  }

  if (literal.kind === "decimal") {
    return { kind: "decimal" };
  }

  if (schemaId === "language") {
    return { kind: "string", typeName: "Message", messageEntry: true };
  }

  return { kind: "string" };
}

function isCommandKey(key) {
  return /^(?:command|commands|smart-command)$/i.test(String(key));
}

function isLoreValue(entry, type) {
  if (entry.key !== "lore") {
    return false;
  }

  if (entry.blockScalar || entry.collectionItems) {
    return true;
  }

  const current = unwrapNullable(type);

  if (current?.kind !== "union") {
    return current?.typeName === "Message";
  }

  return current.choices.some((choice) => {
    const candidate = unwrapNullable(choice);

    return candidate?.kind === "list" || candidate?.typeName === "Message";
  });
}

function loreListType(type) {
  const current = unwrapNullable(type);

  if (current?.kind === "list" || current?.kind === "set") {
    return current;
  }

  if (current?.kind !== "union") {
    return null;
  }

  return current.choices.map(unwrapNullable).find((choice) => choice?.kind === "list" || choice?.kind === "set") ?? null;
}

function isSimpleSequenceType(type) {
  const current = unwrapNullable(type);

  return ["advanced", "boolean", "decimal", "duration", "enum", "integer", "string", "suggestion"].includes(current.kind);
}

function badge(text, kind) {
  const featureClass = kind === "type" ? "" : ` editor-badge--${kind}`;

  return element("span", `editor-pill fw-bold text-nowrap editor-badge${featureClass} d-inline-flex align-items-center`, text);
}

function option(label, value, selected) {
  const node = element("option", "", label);
  node.value = value;
  node.selected = selected;
  return node;
}

function button(label, iconClass, className) {
  const node = element("button", className);
  node.type = "button";
  node.append(element("i", iconClass), document.createTextNode(label));
  return node;
}

function iconButton(label, iconClass, className) {
  const node = element("button", className);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.append(element("i", iconClass));
  return node;
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}

function disableControls(root) {
  if (root.matches("button, input, select, textarea")) {
    root.disabled = true;
  }

  root.querySelectorAll("button, input, select, textarea").forEach((control) => control.disabled = true);
}
