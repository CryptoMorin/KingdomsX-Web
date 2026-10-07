import { indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";

import { customYamlWarnings } from "./kingdoms-yaml-validation.js";
import { indexYamlSource, replaceDocumentSource } from "./yaml-source.js";

const editorFoundationTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontFamily: "var(--editor-mono)",
    fontSize: "0.85rem"
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.6"
  },
  ".cm-content": {
    padding: "0.75rem 0",
    caretColor: "#fff"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    paddingInline: "0.75rem"
  },
  "&.cm-focused": {
    outline: "none"
  }
});

const kingdomsDarkTheme = EditorView.theme({
  "&": { backgroundColor: "#08131c", color: "var(--text)" },
  ".cm-content": { caretColor: "#ffffff" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffffff" },
  ".cm-content::selection, .cm-content ::selection": {
    backgroundColor: "rgba(251, 176, 59, 0.425)",
    color: "#ffffff"
  },
  "&.cm-editor .cm-selectionBackground": {
    backgroundColor: "rgba(251, 176, 59, 0.25) !important"
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "rgba(251, 176, 59, 0.375) !important"
  },
  ".cm-gutters": {
    borderRight: "0.0625rem solid #243747",
    backgroundColor: "#08131c",
    color: "var(--dim)"
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#102331" },
  "&:has(.cm-selectionBackground) .cm-activeLine": {
    backgroundColor: "transparent"
  },
  ".cm-reviewChangedLine": {
    backgroundColor: "rgba(251, 176, 59, 0.1)",
    boxShadow: "inset 0.1875rem 0 #fbb03b"
  },
  ".cm-panels": {
    borderColor: "rgba(115, 144, 169, 0.3)",
    backgroundColor: "rgba(7, 16, 25, 0.975)",
    color: "var(--text)",
    fontFamily: "var(--kingdomsx-font-body)",
    boxShadow: "0 -0.75rem 2rem rgba(0, 0, 0, 0.2)"
  },
  ".cm-panels-bottom": {
    borderTop: "0.0625rem solid rgba(251, 176, 59, 0.3)"
  },
  ".cm-panel.cm-search": {
    display: "grid",
    gridTemplateColumns: "minmax(8rem, 1fr) repeat(3, max-content) repeat(3, max-content)",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 2.8rem 0.65rem 0.75rem"
  },
  ".cm-panel.cm-search br": {
    display: "none"
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    margin: "0"
  },
  ".cm-panel.cm-search .cm-textfield": {
    width: "100%",
    minWidth: "0",
    minHeight: "2.15rem",
    padding: "0.4rem 0.65rem",
    border: "0.0625rem solid rgba(115, 144, 169, 0.4)",
    borderRadius: "var(--kingdomsx-radius-compact)",
    outline: "none",
    backgroundColor: "rgba(12, 30, 42, 0.95)",
    color: "var(--text)",
    fontFamily: "var(--editor-mono)",
    fontSize: "0.75rem"
  },
  ".cm-panel.cm-search [name=search]": { gridColumn: "1", gridRow: "1" },
  ".cm-panel.cm-search .cm-button[name=next]": { gridColumn: "2", gridRow: "1" },
  ".cm-panel.cm-search .cm-button[name=prev]": { gridColumn: "3", gridRow: "1" },
  ".cm-panel.cm-search .cm-button[name=select]": { gridColumn: "4", gridRow: "1" },
  ".cm-panel.cm-search label:nth-of-type(1)": { gridColumn: "5", gridRow: "1" },
  ".cm-panel.cm-search label:nth-of-type(2)": { gridColumn: "6", gridRow: "1" },
  ".cm-panel.cm-search label:nth-of-type(3)": { gridColumn: "7", gridRow: "1" },
  ".cm-panel.cm-search input[name=replace]": { gridColumn: "1", gridRow: "2" },
  ".cm-panel.cm-search .cm-button[name=replace]": { gridColumn: "2", gridRow: "2" },
  ".cm-panel.cm-search .cm-button[name=replaceAll]": {
    gridColumn: "3 / span 2",
    gridRow: "2",
    justifySelf: "start"
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    borderColor: "rgba(251, 176, 59, 0.85)",
    boxShadow: "0 0 0 0.1875rem rgba(251, 176, 59, 0.15)"
  },
  ".cm-panel.cm-search .cm-textfield::placeholder": {
    color: "var(--dim)"
  },
  ".cm-panel.cm-search .cm-button": {
    minHeight: "2.15rem",
    padding: "0.4rem 0.7rem",
    border: "0.0625rem solid rgba(115, 144, 169, 0.35)",
    borderRadius: "var(--kingdomsx-radius-compact)",
    backgroundColor: "rgba(16, 29, 41, 0.95)",
    backgroundImage: "none",
    color: "var(--text)",
    fontFamily: "var(--kingdomsx-font-body)",
    fontSize: "0.7rem",
    fontWeight: "700",
    textTransform: "capitalize",
    cursor: "pointer"
  },
  ".cm-panel.cm-search .cm-button:hover, .cm-panel.cm-search .cm-button:focus-visible": {
    borderColor: "var(--amber)",
    outline: "none",
    backgroundColor: "var(--kingdomsx-control-hover-background)",
    color: "var(--text)",
    boxShadow: "var(--kingdomsx-control-hover-shadow)"
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    color: "var(--muted)",
    fontFamily: "var(--kingdomsx-font-body)",
    fontSize: "0.7rem",
    whiteSpace: "nowrap",
    cursor: "pointer"
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    width: "0.95rem",
    height: "0.95rem",
    margin: "0",
    accentColor: "var(--amber)",
    cursor: "pointer"
  },
  ".cm-panel.cm-search [name=close]": {
    top: "0.65rem",
    right: "0.7rem",
    display: "grid",
    width: "1.75rem",
    height: "1.75rem",
    padding: "0",
    placeItems: "center",
    border: "0.0625rem solid rgba(115, 144, 169, 0.35)",
    borderRadius: "var(--kingdomsx-radius-compact)",
    backgroundColor: "rgba(16, 29, 41, 0.95)",
    color: "var(--muted)",
    fontFamily: "var(--kingdomsx-font-body)",
    fontSize: "1rem",
    lineHeight: "1",
    cursor: "pointer"
  },
  ".cm-panel.cm-search [name=close]:hover, .cm-panel.cm-search [name=close]:focus-visible": {
    borderColor: "var(--amber)",
    outline: "none",
    color: "var(--amber)",
    boxShadow: "var(--kingdomsx-control-hover-shadow)"
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(251, 176, 59, 0.225)",
    outline: "0.0625rem solid rgba(251, 176, 59, 0.75)"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(255, 116, 23, 0.375)",
    outlineColor: "#ff9a55"
  },
  ".cm-selectionMatch": { backgroundColor: "rgba(88, 199, 243, 0.175)" },
  "@media (max-width: 700px)": {
    ".cm-panel.cm-search": {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))"
    },
    ".cm-panel.cm-search [name=search]": { gridColumn: "1 / -1", gridRow: "1" },
    ".cm-panel.cm-search .cm-button[name=next]": { gridColumn: "1", gridRow: "2" },
    ".cm-panel.cm-search .cm-button[name=prev]": { gridColumn: "2", gridRow: "2" },
    ".cm-panel.cm-search .cm-button[name=select]": { gridColumn: "3", gridRow: "2" },
    ".cm-panel.cm-search input[name=replace]": { gridColumn: "1 / -1", gridRow: "3" },
    ".cm-panel.cm-search .cm-button[name=replace]": { gridColumn: "1", gridRow: "4" },
    ".cm-panel.cm-search .cm-button[name=replaceAll]": {
      gridColumn: "2 / -1",
      gridRow: "4",
      justifySelf: "stretch"
    },
    ".cm-panel.cm-search label:nth-of-type(1)": { gridColumn: "1", gridRow: "5" },
    ".cm-panel.cm-search label:nth-of-type(2)": { gridColumn: "2", gridRow: "5" },
    ".cm-panel.cm-search label:nth-of-type(3)": { gridColumn: "3", gridRow: "5" },
    ".cm-panel.cm-search .cm-button": { width: "100%" }
  }
}, { dark: true });

const kingdomsYamlHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.bool, tags.null], color: "#fbbf24", fontWeight: "600" },
  { tag: [tags.propertyName, tags.attributeName], color: "#7dd3fc" },
  { tag: [tags.string, tags.inserted], color: "#a7f3d0" },
  { tag: [tags.number, tags.atom], color: "#f9a8d4" },
  { tag: [tags.comment, tags.meta], color: "#8292a2", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "#b8c7d3" },
  { tag: [tags.variableName, tags.labelName], color: "#fdba74" },
  { tag: tags.typeName, color: "#c4b5fd" },
  { tag: tags.invalid, color: "#fb7185", textDecoration: "underline wavy" }
]);

export function createAdvancedSourceEditor({
  form,
  fileName,
  host,
  undoButton,
  redoButton,
  warningsPanel,
  warningList,
  status,
  announce,
  onSave,
  onDraftChange = () => {}
}) {
  let session = null;
  let view;
  let readOnly = false;
  const sourceAccess = new Compartment();
  const applyButtons = form.querySelectorAll("button[type=submit]");

  const extensions = [
    basicSetup,
    yaml(),
    ...yamlEditorExtensions({
      ariaLabel: "Complete YAML source",
      onUpdate(update) {
        if (!update.docChanged) {
          return;
        }

        renderWarnings();
        renderStatus();
        updateHistoryButtons();
        onDraftChange();
      }
    }),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run() {
          if (!readOnly) {
            form.requestSubmit();
          }

          return true;
        }
      },
      indentWithTab
    ])
  ];

  view = new EditorView({
    state: editorState(""),
    parent: host
  });

  form.addEventListener("submit", save);
  undoButton.addEventListener("pointerdown", keepEditorFocus);
  redoButton.addEventListener("pointerdown", keepEditorFocus);
  undoButton.addEventListener("click", () => moveThroughHistory(undo));
  redoButton.addEventListener("click", () => moveThroughHistory(redo));

  function open(nextSession, { focus = false } = {}) {
    if (!nextSession?.document.editable) {
      announce(nextSession?.document.warnings[0] || "This file cannot be edited safely.", true);
      return false;
    }

    if (session !== nextSession) {
      sync(nextSession);
    } else {
      fileName.textContent = session.fileName;
      renderWarnings();
      renderStatus();
      updateHistoryButtons();
    }

    window.requestAnimationFrame(() => {
      view.requestMeasure();

      if (focus) {
        view.contentDOM.focus({ preventScroll: true });
      }
    });

    return true;
  }

  function sync(nextSession) {
    if (!nextSession) {
      return;
    }

    session = nextSession;
    fileName.textContent = session.fileName;
    setSource(session.document.currentText);
    renderWarnings();
    renderStatus();
  }

  function hasDraftChanges() {
    return Boolean(session && currentSource() !== session.document.currentText);
  }

  function confirmDiscard() {
    return !hasDraftChanges()
      || window.confirm("Discard the code changes that have not been applied?");
  }

  function discardDraft() {
    if (!session || readOnly) {
      return;
    }

    setSource(session.document.currentText);
    renderWarnings();
    renderStatus();
    onDraftChange();
  }

  function draftForRecovery() {
    return hasDraftChanges()
      ? { fileName: session.fileName, source: currentSource() }
      : null;
  }

  function restoreDraft(nextSession, source) {
    if (!nextSession?.document.editable || typeof source !== "string") {
      return false;
    }

    if (session === nextSession && currentSource() === source) {
      return true;
    }

    session = nextSession;
    fileName.textContent = session.fileName;
    setSource(source);
    renderWarnings();
    renderStatus();
    onDraftChange();
    return true;
  }

  function currentSource() {
    return sourceWithLineEndings(view.state.doc.toString(), session?.document.lineEndings);
  }

  function setSource(source) {
    view.setState(editorState(sourceForCodeEditor(source)));
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
    updateHistoryButtons();
  }

  function editorState(source) {
    return EditorState.create({
      doc: source,
      extensions: [sourceAccess.of(sourceAccessExtensions()), ...extensions]
    });
  }

  function sourceAccessExtensions() {
    return [
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({
        "aria-readonly": String(readOnly),
        tabindex: "0"
      })
    ];
  }

  function setReadOnly(nextReadOnly) {
    const requested = Boolean(nextReadOnly);

    if (readOnly === requested) {
      return;
    }

    readOnly = requested;
    view.dispatch({ effects: sourceAccess.reconfigure(sourceAccessExtensions()) });

    for (const button of applyButtons) {
      button.disabled = readOnly;
    }

    updateHistoryButtons();
    renderStatus();
  }

  function keepEditorFocus(event) {
    event.preventDefault();
  }

  function moveThroughHistory(command) {
    if (readOnly) {
      return;
    }

    command(view);
    view.focus();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoButton.disabled = readOnly || undoDepth(view.state) === 0;
    redoButton.disabled = readOnly || redoDepth(view.state) === 0;
  }

  function renderStatus() {
    if (readOnly) {
      status.textContent = hasDraftChanges()
        ? "This source is read-only. Your pending code changes are included in Download unsaved work."
        : "This source is read-only. You can still select and copy it.";
      status.classList.toggle("has-changes", hasDraftChanges());
      return;
    }

    status.textContent = hasDraftChanges()
      ? "These changes apply when you switch to Visual or choose Apply YAML changes."
      : "No code changes.";
    status.classList.toggle("has-changes", hasDraftChanges());
  }

  function renderWarnings() {
    const index = indexYamlSource(view.state.doc.toString());
    const warnings = [...new Set([...index.warnings, ...customYamlWarnings(index)])];

    warningsPanel.hidden = warnings.length === 0;
    warningList.replaceChildren(...warnings.map((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      return item;
    }));

    return { index, warnings };
  }

  async function save(event) {
    event.preventDefault();
    await applyDraft();
  }

  async function applyDraft({ announceUnchanged = true } = {}) {
    if (!session || readOnly) {
      return false;
    }

    const validation = renderWarnings();

    if (validation.index.unsupported) {
      announce("This source uses YAML features that KingdomsX does not support.", true);
      return false;
    }

    if (validation.warnings.length
      && !window.confirm(`${pluralize(validation.warnings.length, "warning")} remain in this source. Save it anyway?`)) {
      return false;
    }

    try {
      if (!replaceDocumentSource(session.document, currentSource())) {
        if (announceUnchanged) {
          announce("The source is unchanged.");
        }

        renderStatus();
        return true;
      }

      const savedSession = session;
      await onSave(savedSession);
      renderStatus();
      return true;
    } catch (error) {
      announce(error.message, true);
      return false;
    }
  }

  return {
    applyDraft,
    confirmDiscard,
    discardDraft,
    draftForRecovery,
    hasDraftChanges,
    open,
    restoreDraft,
    setReadOnly,
    sync
  };
}

export function createReadonlySourceEditor({ host, ariaLabel = "Exact YAML source" }) {
  let view = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: yamlEditorExtensions({ ariaLabel, readOnly: true })
    }),
    parent: host
  });
  view.contentDOM.dataset.previewSource = "";

  function setSource(source, { highlightedLines = [] } = {}) {
    const normalizedSource = sourceForCodeEditor(source);
    view.setState(EditorState.create({
      doc: normalizedSource,
      extensions: [
        ...yamlEditorExtensions({ ariaLabel, readOnly: true }),
        changedLineDecorations(normalizedSource, highlightedLines)
      ]
    }));

    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
  }

  return {
    content: view.contentDOM,
    requestMeasure: () => view.requestMeasure(),
    setSource
  };
}

function changedLineDecorations(source, lineNumbers) {
  const requestedLines = new Set(lineNumbers);
  const decorations = [];
  const changedLine = Decoration.line({ class: "cm-reviewChangedLine" });
  let line = 1;
  let from = 0;

  while (from <= source.length) {
    if (requestedLines.has(line)) {
      decorations.push(changedLine.range(from));
    }

    const next = source.indexOf("\n", from);

    if (next < 0) {
      break;
    }

    from = next + 1;
    line += 1;
  }

  return EditorView.decorations.of(Decoration.set(decorations, true));
}

function yamlEditorExtensions({ ariaLabel, onUpdate = null, readOnly = false }) {
  const extensions = [
    basicSetup,
    yaml(),
    editorFoundationTheme,
    kingdomsDarkTheme,
    syntaxHighlighting(kingdomsYamlHighlightStyle),
    EditorView.contentAttributes.of({
      "aria-label": ariaLabel,
      "aria-multiline": "true",
      autocapitalize: "off",
      spellcheck: "false"
    })
  ];

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  }

  if (onUpdate) {
    extensions.push(EditorView.updateListener.of(onUpdate));
  }

  return extensions;
}

export function sourceForCodeEditor(source) {
  return String(source).replace(/\r\n|\r/g, "\n");
}

export function sourceWithLineEndings(source, lineEndings = "lf") {
  const normalized = sourceForCodeEditor(source);

  if (lineEndings === "crlf") {
    return normalized.replaceAll("\n", "\r\n");
  }

  if (lineEndings === "cr") {
    return normalized.replaceAll("\n", "\r");
  }

  return normalized;
}

function pluralize(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}
