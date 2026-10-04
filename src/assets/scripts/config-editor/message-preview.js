import {
  DEFAULT_MACRO_GROUPS,
  DOCUMENTED_PLACEHOLDER_GROUPS,
  PLACEHOLDER_MODIFIERS
} from "./language-catalog.js";
import { insertionLibrary } from "./insertion-library.js";
import { resolveMessageMacros } from "./message-macros.js";
import { editorPrefersReducedMotion } from "./editor-settings.js";

const LEGACY_COLORS = {
  0: "#000000", 1: "#0000aa", 2: "#00aa00", 3: "#00aaaa",
  4: "#aa0000", 5: "#aa00aa", 6: "#ffaa00", 7: "#aaaaaa",
  8: "#555555", 9: "#5555ff", a: "#55ff55", b: "#55ffff",
  c: "#ff5555", d: "#ff55ff", e: "#ffff55", f: "#ffffff"
};

const MINECRAFT_COLORS = [
  ["Black", "0"], ["Dark blue", "1"], ["Dark green", "2"], ["Dark aqua", "3"],
  ["Dark red", "4"], ["Dark purple", "5"], ["Gold", "6"], ["Gray", "7"],
  ["Dark gray", "8"], ["Blue", "9"], ["Green", "a"], ["Aqua", "b"],
  ["Red", "c"], ["Light purple", "d"], ["Yellow", "e"], ["White", "f"]
];

const THEME_COLORS = {
  p: "#5ee6d0",
  sp: "#f4cf74",
  s: "#a8e8ff",
  e: "#ff7c8f",
  es: "#ffb0ba",
  sep: "#8b96ab",
  desc: "#c8d0de"
};

const THEME_SYMBOLS = {
  colon: ":",
  comma: ",",
  dot: "•",
  arrow: "➔",
  "info-sign": "ⓘ",
  "err-sign": "⚠",
  enabled: "Enabled",
  disabled: "Disabled",
  yes: "Yes",
  no: "No",
  cancel: "Cancel"
};

const CONDITIONAL_LABEL_START = "\uE000";
const CONDITIONAL_LABEL_END = "\uE001";
const CONDITIONAL_GROUP_START = "\uE002";
const CONDITIONAL_GROUP_END = "\uE003";
const OBFUSCATED_FRAME_DELAY = 80;
const obfuscatedSegments = new Map();
let obfuscatedTimer = 0;
let obfuscatedFrame = 0;
let obfuscatedSequence = 0;

const MESSAGE_INSERT_GROUPS = [
  ["Theme colors", [
    ["Primary color", "{$p}"],
    ["Secondary primary color", "{$sp}"],
    ["Secondary color", "{$s}"],
    ["Error color", "{$e}"],
    ["Secondary error color", "{$es}"],
    ["Separator color", "{$sep}"],
    ["Description color", "{$desc}"]
  ]],
  ["Style", [
    ["Bold", "&l"],
    ["Italic", "&o"],
    ["Underline", "&n"],
    ["Strikethrough", "&m"],
    ["Obfuscated text", "&k"],
    ["Reset formatting", "&r"]
  ]],
  ["Minecraft colors", MINECRAFT_COLORS.map(([name, code]) => [name, `&${code}`])],
  ["Theme symbols", Object.keys(THEME_SYMBOLS).map((name) => [`Theme symbol: ${name}`, `{$${name}}`])]
];
export const MESSAGE_INSERTS = MESSAGE_INSERT_GROUPS.flatMap(([, inserts]) => inserts);

export function observedMessageReferences(sources) {
  const references = new Set();

  for (const source of sources) {
    for (const match of String(source).matchAll(/\{\$\$?[^{}\s]+}|%[^%\r\n]+%/g)) {
      const value = match[0];

      if (value.startsWith("%") && !/^%[A-Za-z_][^%\r\n]*%$/.test(value)) {
        continue;
      }

      references.add(value);
    }
  }

  return [...references];
}

export function parseMessagePreview(source, { macros = null } = {}) {
  const context = {
    interactions: [],
    conditionals: [],
    conditionalGroupSequence: 0,
    themeTokens: new Set(),
    placeholders: new Set()
  };
  const normalized = resolveMessageMacros(source, macros).replace(/\\n/g, "\n");
  const previewSource = expandConditionalMessages(normalized, context);
  const lines = [];
  const conditionalLineGroups = [];
  let activeConditionalGroups = [];
  let style = defaultStyle();

  for (const line of previewSource.split(/\r\n|\n|\r/)) {
    const parsed = parseLine(line, context, null, style, activeConditionalGroups);
    lines.push(parsed.segments);
    conditionalLineGroups.push(parsed.groupsOnLine);
    activeConditionalGroups = parsed.activeConditionalGroups;
    style = parsed.style;
  }

  return {
    lines,
    conditionalLineGroups,
    interactions: context.interactions,
    conditionals: context.conditionals,
    themeTokens: [...context.themeTokens],
    placeholders: [...context.placeholders]
  };
}

export function parseStandaloneMessageColor(source, { macros = null } = {}) {
  const raw = String(source).trim();

  if (!raw) {
    return null;
  }

  const resolved = resolveMessageMacros(raw, macros).trim();
  let color = "";
  let label = "Custom color";

  const legacy = /^&([0-9a-f])$/i.exec(resolved);

  if (legacy) {
    const code = legacy[1].toLocaleLowerCase("en-US");
    color = LEGACY_COLORS[code];
    label = MINECRAFT_COLORS.find(([, candidate]) => candidate === code)?.[0] ?? "Minecraft color";
  }

  const kingdomsHex = /^\{#([0-9a-f]{3}|[0-9a-f]{6})}$/i.exec(resolved);

  if (!color && kingdomsHex) {
    const value = kingdomsHex[1];
    color = value.length === 3
      ? `#${[...value].map((character) => character.repeat(2)).join("")}`
      : `#${value}`;
    label = "Hex color";
  }

  const rgb = /^\{#\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*}$/i.exec(resolved);

  if (!color && rgb && rgb.slice(1).every((channel) => Number(channel) <= 255)) {
    color = `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
    label = "RGB color";
  }

  const legacyHex = /^&x(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))$/i.exec(resolved);

  if (!color && legacyHex) {
    color = `#${legacyHex.slice(1).join("")}`;
    label = "Hex color";
  }

  const kingdomsHexCode = /^&#([0-9a-f]{6})$/i.exec(resolved);

  if (!color && kingdomsHexCode) {
    color = `#${kingdomsHexCode[1]}`;
    label = "Hex color";
  }

  return color ? { raw, resolved, color, label } : null;
}

export function colorValuePreviewElement({ raw, color, label }, { showHeading = true } = {}) {
  const root = element("div", "editor-message-preview overflow-hidden");
  const heading = element("div", "editor-message-preview-heading");
  heading.append(element("span", "editor-subfield-label fw-bold", "Preview"));

  const body = element("div", "editor-message-preview-body editor-message-preview-body--color d-flex align-items-center gap-3");
  const swatch = element("span", "editor-message-preview-color-swatch flex-shrink-0");
  swatch.style.setProperty("--message-preview-color", color);

  const copy = element("span", "min-w-0");
  copy.append(
    element("span", "editor-message-preview-color-label d-block fw-bold", label),
    element("code", "editor-message-preview-color-code d-block", raw)
  );
  body.append(swatch, copy);

  if (showHeading) {
    root.append(heading);
  }

  root.append(body);
  return root;
}

export function messagePreviewElement(source, {
  compact = false,
  macros = null,
  showHeading = true,
  showDetails = true,
  interactive = true
} = {}) {
  const standaloneColor = parseStandaloneMessageColor(source, { macros });
  const parsed = parseMessagePreview(source, { macros });
  const root = element("div", `editor-message-preview overflow-hidden${compact ? " editor-message-preview--compact" : ""}`);
  const heading = element("div", "editor-message-preview-heading");
  heading.append(element("span", "editor-subfield-label fw-bold", "Preview"));

  if (standaloneColor) {
    return colorValuePreviewElement(standaloneColor, { showHeading });
  }

  const body = element("div", `editor-message-preview-body${compact ? " overflow-auto" : ""}`);
  renderLines(body, parsed.lines, parsed.conditionalLineGroups, { interactive });

  if (showHeading) {
    root.append(heading);
  }

  root.append(body);

  const details = [];

  for (const interaction of parsed.interactions) {
    const detail = element("div", "editor-message-preview-detail d-flex align-items-baseline gap-2");
    detail.append(
      element("span", "editor-message-preview-detail-kind flex-shrink-0 fw-bold", interaction.action ? actionLabel(interaction.action) : "Hover text"),
      document.createTextNode(interaction.hover || interaction.action || "Interactive text")
    );
    details.push(detail);
  }

  if (showDetails && details.length) {
    root.append(element("div", "editor-message-preview-details d-grid gap-1", details));
  }

  return root;
}

export function messageInsertToolbar(input, onInput, suggestedSource = "", additionalTokens = []) {
  const root = element("div", "editor-message-assist editor-expression-assist d-grid gap-2");
  const afterInsert = () => onInput();

  const context = element("div", "d-grid gap-2");
  const renderContext = () => {
    const parsed = parseMessagePreview(`${input.value}\n${suggestedSource}`);
    const sharedValues = new Set(MESSAGE_INSERTS.map(([, value]) => value));
    const tokens = [
      ...parsed.themeTokens.map((name) => `{$${name}}`),
      ...parsed.placeholders
    ].filter((value, index, all) => !sharedValues.has(value) && all.indexOf(value) === index);

    if (!tokens.length) {
      context.replaceChildren();
      context.hidden = true;
      return;
    }

    context.hidden = false;
    const row = element("div", "d-flex flex-wrap gap-1");

    for (const value of tokens) {
      row.append(insertButton(value, `Insert ${value}`, () => insertText(input, value, afterInsert)));
    }

    context.replaceChildren(
      element("span", "editor-muted-eyebrow", "In this message"),
      row
    );
  };
  input.addEventListener("input", renderContext);
  renderContext();

  const formatting = element("section", "editor-message-assist-formatting d-grid gap-3");
  formatting.append(element("span", "editor-muted-eyebrow", "Formatting"));

  for (const groupLabel of ["Theme colors", "Style"]) {
    const inserts = MESSAGE_INSERT_GROUPS.find(([label]) => label === groupLabel)?.[1] ?? [];
    const group = element("div", "d-grid gap-1");
    const ops = element("div", "d-flex flex-wrap gap-1");
    ops.setAttribute("role", "toolbar");
    ops.setAttribute("aria-label", groupLabel);

    for (const [label, value] of inserts) {
      ops.append(insertButton(
        messageButtonLabel(label, value),
        label,
        () => insertPrefix(input, value, () => {
          afterInsert();
          renderContext();
        })
      ));
    }

    group.append(element("span", "editor-muted-eyebrow", groupLabel), ops);
    formatting.append(group);
  }

  const colors = element("div", "d-grid gap-2");
  const swatches = element("div", "editor-message-colors d-grid gap-1");
  swatches.setAttribute("role", "toolbar");
  swatches.setAttribute("aria-label", "Minecraft colors");

  for (const [name, code] of MINECRAFT_COLORS) {
    const value = `&${code}`;
    const swatch = element("button", "editor-message-color", value);
    swatch.type = "button";
    swatch.title = `${name} (${value})`;
    swatch.setAttribute("aria-label", `Apply ${name.toLocaleLowerCase("en-US")} (${value})`);
    swatch.style.setProperty("--message-color", LEGACY_COLORS[code]);
    swatch.addEventListener("click", () => insertPrefix(input, value, () => {
      afterInsert();
      renderContext();
    }));
    swatches.append(swatch);
  }

  const customColor = element("div", "editor-message-custom-color d-flex align-items-center gap-2");
  const picker = element("input", "editor-message-custom-color-picker flex-shrink-0");
  picker.type = "color";
  picker.value = "#ffffff";
  picker.setAttribute("aria-label", "Custom Minecraft text color");
  const customCode = element("code", "editor-message-custom-color-code", "&#ffffff");
  const applyColor = element("button", "btn btn-sm btn-site-secondary ms-auto", "Apply color");
  applyColor.type = "button";
  const selectedHex = () => `&#${picker.value.slice(1).toLocaleLowerCase("en-US")}`;
  picker.addEventListener("input", () => {
    customCode.textContent = selectedHex();
  });
  applyColor.addEventListener("click", () => insertPrefix(input, selectedHex(), () => {
    afterInsert();
    renderContext();
  }));
  customColor.append(picker, customCode, applyColor);
  colors.append(
    element("span", "editor-muted-eyebrow", "Minecraft colors"),
    swatches,
    customColor
  );
  formatting.append(colors);

  const libraries = [];
  const themeSymbols = MESSAGE_INSERT_GROUPS.find(([label]) => label === "Theme symbols");

  if (themeSymbols) {
    libraries.push([
      "Theme symbols",
      [[
        "Symbols",
        themeSymbols[1].map(([label, value]) => [messageButtonLabel(label, value), value, label])
      ]]
    ]);
  }

  if (additionalTokens.length) {
    const references = observedMessageReferences(additionalTokens).sort();
    const availableGroups = [
      ["Macros", references.filter((value) => value.startsWith("{$"))],
      ["Placeholders", references.filter((value) => value.startsWith("%"))]
    ].filter(([, values]) => values.length)
      .map(([label, values]) => [
        label,
        values.map((value) => [value, value, `Insert ${label === "Macros" ? "macro" : "placeholder"}`])
      ]);

    if (availableGroups.length) {
      libraries.push(["Available here", availableGroups]);
    }
  }

  libraries.push(
    [
      "Macros",
      DEFAULT_MACRO_GROUPS.map(([label, items]) => [
        label,
        items.map(([value, help]) => [value, value, help])
      ])
    ],
    [
      "Kingdoms placeholders",
      DOCUMENTED_PLACEHOLDER_GROUPS.map(([label, items]) => [
        label,
        items.map(([value, help]) => [value, value, help])
      ])
    ],
    [
      "Placeholder modifiers",
      [["Modifiers", PLACEHOLDER_MODIFIERS.map(([name, help]) => [
        `%${name}@kingdoms_placeholder%`,
        `%${name}@kingdoms_placeholder%`,
        help
      ])]],
      "Replace “placeholder” with the placeholder name."
    ]
  );

  context.classList.add("editor-message-assist-context");
  root.append(context, formatting, insertionLibrary({
    libraries,
    summary: "Browse symbols & placeholders",
    searchLabel: "Search symbols and placeholders",
    onInsert: (value) => insertText(input, value, () => {
      afterInsert();
      renderContext();
    }),
    insertLabel: (help) => help.startsWith("Insert ") ? help : `Insert ${help.toLocaleLowerCase("en-US")}`
  }));
  return root;
}

function messageButtonLabel(label, value) {
  if (label === "Bold") {
    return "B";
  }

  if (label === "Italic") {
    return "I";
  }

  if (label === "Underline") {
    return "U";
  }

  if (label === "Reset formatting") {
    return "Reset";
  }

  return value;
}

function insertButton(label, help, onClick) {
  const button = element("button", "editor-expression-op", label);
  button.type = "button";
  button.title = help;
  button.setAttribute("aria-label", help.startsWith("Insert ") ? help : `Insert ${help.toLocaleLowerCase("en-US")}`);
  button.addEventListener("click", onClick);
  return button;
}

function insertText(input, value, onInput) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(value, start, end, "end");
  input.focus();
  onInput();
}

function insertPrefix(input, value, onInput) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(value, start, start, "preserve");
  const selectionStart = start + value.length;
  const selectionEnd = end + value.length;
  input.setSelectionRange(selectionStart, selectionEnd);
  input.focus();
  onInput();
}

function parseLine(
  line,
  context,
  inheritedInteraction = null,
  initialStyle = defaultStyle(),
  initialConditionalGroups = []
) {
  const segments = [];
  const activeConditionalGroups = [...initialConditionalGroups];
  const groupsOnLine = new Set(activeConditionalGroups);
  let text = "";
  let index = 0;
  let style = { ...initialStyle };

  const segmentContext = () => ({
    interaction: inheritedInteraction,
    conditionalGroups: [...activeConditionalGroups]
  });
  const flush = () => {
    if (!text) {
      return;
    }

    segments.push({ text, style: { ...style }, ...segmentContext() });
    text = "";
  };

  while (index < line.length) {
    const groupMarker = conditionalGroupMarkerAt(line, index);

    if (groupMarker) {
      flush();

      if (groupMarker.opening) {
        activeConditionalGroups.push(groupMarker.id);
        groupsOnLine.add(groupMarker.id);
      } else {
        const position = activeConditionalGroups.lastIndexOf(groupMarker.id);

        if (position !== -1) {
          activeConditionalGroups.splice(position, 1);
        }
      }

      index += groupMarker.length;
      continue;
    }

    if (line[index] === CONDITIONAL_LABEL_START) {
      const closing = line.indexOf(CONDITIONAL_LABEL_END, index + 1);

      if (closing !== -1) {
        flush();
        segments.push({
          text: line.slice(index + 1, closing),
          style: defaultStyle(),
          conditional: true,
          ...segmentContext()
        });
        index = closing + 1;
        continue;
      }
    }

    if (line.startsWith("hover:{", index)) {
      const closing = matchingBrace(line, index + 6);

      if (closing !== -1) {
        flush();
        const parts = splitTopLevel(line.slice(index + 7, closing), ";");
        const interaction = {
          visible: parts[0] ?? "",
          hover: parts[1] ?? "",
          action: parts.slice(2).join(";")
        };
        context.interactions.push(interaction);
        const visible = parseLine(
          interaction.visible,
          context,
          interaction,
          style,
          activeConditionalGroups
        );
        segments.push(...visible.segments);
        index = closing + 1;
        continue;
      }
    }

    if (line.startsWith("{?", index)) {
      const closing = matchingBrace(line, index);

      if (closing !== -1) {
        flush();
        const conditional = line.slice(index, closing + 1);
        context.conditionals.push(conditional);
        segments.push({
          text: "Conditional text",
          style: { ...style },
          conditional: true,
          ...segmentContext()
        });
        index = closing + 1;
        continue;
      }
    }

    const theme = /^\{\$([^}]+)}/.exec(line.slice(index));

    if (theme) {
      flush();
      const name = theme[1];
      context.themeTokens.add(name);

      if (THEME_COLORS[name]) {
        style = colorStyle(THEME_COLORS[name]);
      } else if (THEME_SYMBOLS[name]) {
        segments.push({ text: THEME_SYMBOLS[name], style: { ...style }, ...segmentContext() });
      } else {
        segments.push({ text: `{$${name}}`, style: { ...style }, token: true, ...segmentContext() });
      }

      index += theme[0].length;
      continue;
    }

    const placeholder = /^%[^%\r\n]+%/.exec(line.slice(index));

    if (placeholder) {
      flush();
      context.placeholders.add(placeholder[0]);
      segments.push({ text: placeholder[0], style: { ...style }, placeholder: true, ...segmentContext() });
      index += placeholder[0].length;
      continue;
    }

    const kingdomColor = /^\{#([0-9a-f]{3}|[0-9a-f]{6})}/i.exec(line.slice(index));

    if (kingdomColor) {
      flush();
      const value = kingdomColor[1];
      style = colorStyle(value.length === 3
        ? `#${[...value].map((character) => character.repeat(2)).join("")}`
        : `#${value}`);
      index += kingdomColor[0].length;
      continue;
    }

    const namedColor = /^\{#([a-z][a-z0-9_-]*)}/i.exec(line.slice(index));

    if (namedColor) {
      flush();
      segments.push({
        text: namedColor[0],
        style: { ...style },
        token: true,
        ...segmentContext()
      });
      index += namedColor[0].length;
      continue;
    }

    const rgbColor = /^\{#\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*}/.exec(line.slice(index));

    if (rgbColor && rgbColor.slice(1).every((channel) => Number(channel) <= 255)) {
      flush();
      style = colorStyle(`rgb(${rgbColor[1]}, ${rgbColor[2]}, ${rgbColor[3]})`);
      index += rgbColor[0].length;
      continue;
    }

    const legacyHex = /^&x(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))(?:&([0-9a-f]))/i.exec(line.slice(index));

    if (legacyHex) {
      flush();
      style = colorStyle(`#${legacyHex.slice(1).join("")}`);
      index += legacyHex[0].length;
      continue;
    }

    const hex = /^&#([0-9a-f]{6})/i.exec(line.slice(index));

    if (hex) {
      flush();
      style = colorStyle(`#${hex[1]}`);
      index += hex[0].length;
      continue;
    }

    const code = /^&([0-9a-fk-or])/i.exec(line.slice(index));

    if (code) {
      flush();
      style = applyLegacyCode(style, code[1].toLowerCase());
      index += code[0].length;
      continue;
    }

    text += line[index];
    index += 1;
  }

  flush();
  return {
    segments,
    style,
    groupsOnLine: [...groupsOnLine],
    activeConditionalGroups
  };
}

function expandConditionalMessages(source, context) {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const opening = source.indexOf("{?", index);

    if (opening === -1) {
      output += source.slice(index);
      break;
    }

    output += source.slice(index, opening);
    const closing = matchingBrace(source, opening);

    if (closing === -1) {
      output += source.slice(opening);
      break;
    }

    const fragment = source.slice(opening, closing + 1);
    const parsed = parseConditionalFragment(fragment);

    if (!parsed) {
      output += fragment;
    } else {
      context.conditionals.push(fragment);
      const lineStart = Math.max(output.lastIndexOf("\n"), output.lastIndexOf("\r")) + 1;
      const prefix = output.slice(lineStart);
      const suffixStart = closing + 1;
      const nextBreakOffset = source.slice(suffixStart).search(/[\r\n]/);
      const suffixEnd = nextBreakOffset === -1 ? source.length : suffixStart + nextBreakOffset;
      const suffix = source.slice(suffixStart, suffixEnd);

      if (!suffix.includes("{?")) {
        output = output.slice(0, lineStart);
        output += conditionalPreviewText(parsed, context, { prefix, suffix });
        index = suffixEnd;
        continue;
      }

      if (prefix.trim()) {
        output += "\n";
      }

      output += conditionalPreviewText(parsed, context);
    }

    index = closing + 1;
  }

  return output;
}

function parseConditionalFragment(fragment) {
  const inner = fragment.slice(2, -1);
  const clauses = splitTopLevel(inner, ";");
  const branches = [];
  let fallback = "";

  for (const clause of clauses) {
    const question = topLevelSeparator(clause, "?");

    if (question === -1) {
      continue;
    }

    const condition = clause.slice(0, question).trim();
    const choices = clause.slice(question + 1);
    const fallbackSeparator = topLevelSeparator(choices, ":");
    const output = (fallbackSeparator === -1 ? choices : choices.slice(0, fallbackSeparator)).trim();

    if (!condition || !output) {
      continue;
    }

    branches.push({
      condition,
      output: unquoteConditionalOutput(output)
    });

    if (fallbackSeparator !== -1) {
      fallback = unquoteConditionalOutput(choices.slice(fallbackSeparator + 1).trim());
    }
  }

  return branches.length ? { branches, fallback } : null;
}

function conditionalPreviewText(parsed, context, { prefix = "", suffix = "" } = {}) {
  const parts = [];

  for (const branch of parsed.branches) {
    const output = expandConditionalMessages(`${prefix}${branch.output}${suffix}`, context);
    const label = output
      ? `When ${readableCondition(branch.condition)}:`
      : `When ${readableCondition(branch.condition)}: no text`;
    parts.push(conditionalGroup(
      `${conditionalLabel(label)}${output ? `\n${output}` : ""}`,
      context
    ));
  }

  if (parsed.fallback) {
    const output = expandConditionalMessages(`${prefix}${parsed.fallback}${suffix}`, context);
    parts.push(conditionalGroup(
      `${conditionalLabel("Otherwise:")}\n${output}`,
      context
    ));
  }

  return parts.join("\n");
}

function conditionalLabel(value) {
  return `${CONDITIONAL_LABEL_START}${value}${CONDITIONAL_LABEL_END}`;
}

function conditionalGroup(value, context) {
  const id = ++context.conditionalGroupSequence;

  return `${conditionalGroupMarker(id, true)}${value}${conditionalGroupMarker(id, false)}`;
}

function conditionalGroupMarker(id, opening) {
  return `${CONDITIONAL_GROUP_START}${opening ? "+" : "-"}${id}${CONDITIONAL_GROUP_END}`;
}

function conditionalGroupMarkerAt(value, index) {
  if (value[index] !== CONDITIONAL_GROUP_START) {
    return null;
  }

  const closing = value.indexOf(CONDITIONAL_GROUP_END, index + 1);

  if (closing === -1) {
    return null;
  }

  const marker = /^([+-])(\d+)$/.exec(value.slice(index + 1, closing));

  if (!marker) {
    return null;
  }

  return {
    id: Number(marker[2]),
    opening: marker[1] === "+",
    length: closing - index + 1
  };
}

export function readableCondition(value) {
  return String(value)
    .replace(/\bkingdoms_kingdom_/gi, "kingdom_")
    .replace(/\bkingdoms_nation_/gi, "nation_")
    .replace(/\bkingdoms_/gi, "")
    .replace(/\s*!=\s*/g, " ≠ ")
    .replace(/\s*>=\s*/g, " ≥ ")
    .replace(/\s*<=\s*/g, " ≤ ")
    .replace(/\s*==\s*/g, " = ")
    .replace(/\s*&&\s*/g, " and ")
    .replace(/\s*\|\|\s*/g, " or ")
    .replace(/!(?!=)\s*/g, "not ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .replace(/\bnot can\b/gi, "can't")
    .replace(/\bnot is\b/gi, "isn't")
    .replace(/\bnot has\b/gi, "doesn't have")
    .replace(/\bnot ([a-z][a-z ]*?) is\b/gi, "$1 isn't")
    .replace(/\bnot ([a-z][a-z ]*?) can\b/gi, "$1 can't")
    .replace(/\bnot ([a-z][a-z ]*?) has\b/gi, "$1 doesn't have")
    .replace(/\bnot ([a-z][a-z ]*?) allowed\b/gi, "$1 not allowed")
    .trim();
}

function topLevelSeparator(value, separator) {
  let depth = 0;
  let quote = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{" || character === "(" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === separator && depth === 0) {
      return index;
    }
  }

  return -1;
}

function unquoteConditionalOutput(value) {
  const quote = value[0];

  if (!["'", '"'].includes(quote) || value.at(-1) !== quote) {
    return value;
  }

  return value
    .slice(1, -1)
    .replaceAll(`\\${quote}`, quote)
    .replaceAll("\\\\", "\\");
}

function renderLines(root, lines, conditionalLineGroups = [], { interactive = true } = {}) {
  const multilineGroups = new Set();
  const groupLineCounts = new Map();

  for (const groups of conditionalLineGroups) {
    for (const id of groups) {
      groupLineCounts.set(id, (groupLineCounts.get(id) ?? 0) + 1);
    }
  }

  for (const [id, count] of groupLineCounts) {
    if (count > 1) {
      multilineGroups.add(id);
    }
  }

  lines.forEach((segments, index) => {
    const line = element("div", "editor-message-preview-line");
    const group = conditionalLineGroups[index]?.find((id) => multilineGroups.has(id));

    if (group) {
      const previousGroups = conditionalLineGroups[index - 1] ?? [];
      const nextGroups = conditionalLineGroups[index + 1] ?? [];
      line.classList.add("is-conditional-group");
      line.classList.toggle("is-conditional-group-start", !previousGroups.includes(group));
      line.classList.toggle("is-conditional-group-end", !nextGroups.includes(group));
    }

    if (!segments.length) {
      line.append(document.createTextNode("\u00a0"));
    }

    for (const segment of segments) {
      const span = element("span", "", segment.text);

      if (segment.style.color) {
        span.style.color = segment.style.color;
      }

      span.style.fontWeight = segment.style.bold ? "700" : "";
      span.style.fontStyle = segment.style.italic ? "italic" : "";
      span.style.textDecoration = [segment.style.underline && "underline", segment.style.strike && "line-through"].filter(Boolean).join(" ");
      span.classList.toggle("is-placeholder", Boolean(segment.placeholder));
      span.classList.toggle("is-token", Boolean(segment.token));
      span.classList.toggle("is-conditional", Boolean(segment.conditional));

      if (segment.placeholder || segment.token || segment.conditional) {
        span.classList.add("d-inline-block");
      }

      span.classList.toggle("is-interactive", Boolean(segment.interaction) && interactive);
      span.classList.toggle("is-obfuscated", Boolean(segment.style.obfuscated));

      if (segment.style.obfuscated) {
        span.setAttribute("aria-label", segment.text);
        animateObfuscatedText(span, segment.text);
      }

      if (segment.interaction && interactive) {
        const interaction = segment.interaction;
        const description = [
          interaction.hover && `Hover: ${interaction.hover}`,
          interaction.action && `${actionLabel(interaction.action)}: ${interaction.action}`
        ].filter(Boolean).join(". ");

        if (description) {
          span.title = description;
          span.setAttribute("aria-label", `${segment.text}. ${description}`);
        }

        span.tabIndex = 0;
      }

      line.append(span);
    }

    root.append(line);

    if (index < lines.length - 1) {
      line.dataset.hasBreak = "true";
    }
  });
}

function matchingBrace(value, opening) {
  let depth = 0;
  let quote = "";

  for (let index = opening; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    } else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function defaultStyle() {
  return { color: "", bold: false, italic: false, underline: false, strike: false, obfuscated: false };
}

function colorStyle(color) {
  return { ...defaultStyle(), color };
}

function applyLegacyCode(style, code) {
  if (LEGACY_COLORS[code]) {
    return colorStyle(LEGACY_COLORS[code]);
  }

  if (code === "r") {
    return defaultStyle();
  }

  if (code === "l") {
    return { ...style, bold: true };
  }

  if (code === "o") {
    return { ...style, italic: true };
  }

  if (code === "n") {
    return { ...style, underline: true };
  }

  if (code === "m") {
    return { ...style, strike: true };
  }

  if (code === "k") {
    return { ...style, obfuscated: true };
  }

  return style;
}

function animateObfuscatedText(element, value) {
  const phase = obfuscatedSequence;
  obfuscatedSequence += 1;
  element.textContent = obfuscatedPreviewText(value, phase);
  obfuscatedSegments.set(element, { value, phase });
  scheduleObfuscatedFrame();
}

function scheduleObfuscatedFrame() {
  if (obfuscatedTimer || typeof window === "undefined") {
    return;
  }

  const delay = editorPrefersReducedMotion() ? 250 : OBFUSCATED_FRAME_DELAY;
  obfuscatedTimer = window.setTimeout(renderObfuscatedFrame, delay);
}

function renderObfuscatedFrame() {
  obfuscatedTimer = 0;
  obfuscatedFrame += 1;
  const reduceMotion = editorPrefersReducedMotion();

  for (const [element, segment] of obfuscatedSegments) {
    if (!element.isConnected) {
      obfuscatedSegments.delete(element);
      continue;
    }

    if (!reduceMotion) {
      element.textContent = obfuscatedPreviewText(segment.value, segment.phase + obfuscatedFrame);
    }
  }

  if (obfuscatedSegments.size) {
    scheduleObfuscatedFrame();
  }
}

function obfuscatedPreviewText(value, frame = 0) {
  const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let index = 0;

  return [...String(value)].map((character) => {
    if (/\s/.test(character)) {
      return character;
    }

    const glyph = glyphs[(frame + index * 7) % glyphs.length];
    index += 1;
    return glyph;
  }).join("");
}

function actionLabel(action) {
  if (action.startsWith("@")) {
    return "Open link";
  }

  if (action.startsWith("|")) {
    return "Suggest command";
  }

  return "Run command";
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (Array.isArray(text)) {
    node.append(...text);
  } else if (text) {
    node.textContent = text;
  }

  return node;
}
