let richDialogId = 0;

export function richValueTrigger(label, content) {
  const trigger = document.createElement("button");
  trigger.className = "editor-rich-value w-100 min-w-0 p-0 border-0 bg-transparent text-start";
  trigger.type = "button";
  trigger.setAttribute("aria-label", label);
  trigger.append(content);

  return trigger;
}

export function richExpressionPreview(text, language) {
  const isCondition = language === "condition";
  const preview = element(
    "div",
    `editor-rich-value-expression d-flex align-items-center justify-content-between gap-3${isCondition ? " editor-rich-value-expression--condition fw-bold" : ""}`
  );
  const source = element("span", "editor-rich-value-expression-source flex-grow-1 min-w-0", text || "\u00a0");
  const action = element("span", "editor-rich-value-action d-inline-flex align-items-center gap-2 flex-shrink-0 fw-bold text-nowrap");
  const icon = element("i", isCondition ? "fa-solid fa-code-branch" : "fa-solid fa-calculator");
  const label = element("span", "d-none d-sm-inline", isCondition ? "Edit condition" : "Edit formula");

  action.setAttribute("aria-hidden", "true");
  action.append(icon, label);
  preview.append(source, action);

  return preview;
}

export function openRichValueDialog({
  eyebrow,
  title,
  content,
  initialFocus,
  saveLabel = "Save changes",
  onSave
}) {
  const dialog = element("dialog", "editor-dialog editor-dialog--scrollable editor-rich-dialog surface-panel site-modal-surface p-0 overflow-hidden");
  const header = element("header", "editor-dialog-header site-modal-header d-flex align-items-start justify-content-between gap-3");
  const heading = element("div", "min-w-0");
  const titleElement = element("h2", "mb-0 mt-1", title);
  titleElement.id = `editor-rich-dialog-title-${++richDialogId}`;
  dialog.setAttribute("aria-labelledby", titleElement.id);
  heading.append(
    element("span", "editor-eyebrow", eyebrow),
    titleElement
  );
  const close = iconButton("Close editor", "fa-solid fa-xmark");
  header.append(heading, close);

  const body = element("div", "editor-rich-dialog-body site-modal-body min-h-0 overflow-auto");
  body.append(content);

  const footer = element("footer", "editor-dialog-footer site-modal-footer d-flex justify-content-end gap-2");
  const cancel = element("button", "btn btn-site-secondary btn-site-sm", "Cancel");
  cancel.type = "button";
  const save = element("button", "btn btn-site btn-site-primary btn-site-sm fw-bold", saveLabel);
  save.type = "button";
  footer.append(cancel, save);
  dialog.append(header, body, footer);

  const closeDialog = () => dialog.close();
  close.addEventListener("click", closeDialog);
  cancel.addEventListener("click", closeDialog);
  save.addEventListener("click", () => {
    if (onSave?.() === false) {
      return;
    }

    dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });

  document.body.append(dialog);
  dialog.showModal();
  window.requestAnimationFrame(() => {
    (initialFocus ?? content.querySelector("input, textarea, select, button"))?.focus();
  });

  return dialog;
}

function iconButton(label, iconClass) {
  const button = element("button", "editor-icon-button editor-interactive-surface site-modal-close d-inline-grid flex-shrink-0 ms-auto");
  button.type = "button";
  button.setAttribute("aria-label", label);

  const icon = element("i", iconClass);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);

  return button;
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
