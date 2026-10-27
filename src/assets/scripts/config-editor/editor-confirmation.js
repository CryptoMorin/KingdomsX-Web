import { appendDescriptionText } from "./description-links.js";

export function confirmEditorAction({
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  eyebrow = "Please confirm",
  confirmIcon = "fa-check",
  dismissible = true,
  focusConfirm = false
}) {
  const dialog = document.querySelector("[data-editor-confirmation-dialog]");

  if (dialog.open) {
    return Promise.resolve(false);
  }

  const confirm = dialog.querySelector("[data-editor-confirmation-confirm]");
  const cancel = dialog.querySelector("[data-editor-confirmation-cancel]");
  dialog.querySelector("[data-editor-confirmation-title]").textContent = title;
  const description = dialog.querySelector("[data-editor-confirmation-message]");
  description.replaceChildren();
  appendDescriptionText(description, message);
  dialog.querySelector("[data-editor-confirmation-eyebrow]").textContent = eyebrow;
  confirm.querySelector("i").className = `fa-solid ${confirmIcon} me-2`;
  confirm.querySelector("span").textContent = confirmLabel;
  cancel.hidden = cancelLabel === null;
  cancel.textContent = cancelLabel ?? "";
  dialog.returnValue = "";

  return new Promise((resolve) => {
    const handleCancel = (event) => {
      if (!dismissible) {
        event.preventDefault();
      }
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", () => {
      dialog.removeEventListener("cancel", handleCancel);
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
    (focusConfirm || cancel.hidden ? confirm : cancel).focus();
  });
}
