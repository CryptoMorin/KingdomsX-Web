import { Toast } from "bootstrap";

const TOAST_ICONS = {
  "is-success": "fa-solid fa-circle-check",
  "is-error": "fa-solid fa-triangle-exclamation",
  "is-warning": "fa-solid fa-clock"
};

export function showSiteToast({
  container,
  title,
  message,
  kind = "",
  autohide = true,
  delay = 6000,
  replace = false
}) {
  if (replace) {
    clearSiteToasts(container);
  }

  const toastNode = document.createElement("div");
  toastNode.className = `toast site-toast ${kind}`.trim();
  toastNode.style.setProperty("--site-toast-delay", `${delay}ms`);
  toastNode.setAttribute("role", kind === "is-error" ? "alert" : "status");
  toastNode.setAttribute("aria-live", kind === "is-error" ? "assertive" : "polite");
  toastNode.setAttribute("aria-atomic", "true");

  if (autohide) {
    toastNode.classList.add("is-autohide");
  }

  const header = document.createElement("div");
  header.className = "toast-header site-toast-header";

  const icon = document.createElement("i");
  icon.className = `${TOAST_ICONS[kind] || "fa-solid fa-circle-info"} me-2`;
  icon.setAttribute("aria-hidden", "true");

  const heading = document.createElement("strong");
  heading.className = "me-auto";
  heading.textContent = title;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn-close btn-close-white";
  close.dataset.bsDismiss = "toast";
  close.setAttribute("aria-label", "Close");

  const body = document.createElement("div");
  body.className = "toast-body";
  body.textContent = message;

  const progress = document.createElement("div");
  progress.className = "site-toast-progress";
  progress.setAttribute("aria-hidden", "true");

  for (const edge of ["top", "right", "bottom", "left"]) {
    const segment = document.createElement("span");
    segment.className = `site-toast-progress-edge is-${edge}`;
    progress.append(segment);
  }

  header.append(icon, heading, close);
  toastNode.append(header, body, progress);
  container.append(toastNode);

  const toast = Toast.getOrCreateInstance(toastNode, { autohide, delay });

  if (autohide) {
    pauseToastProgressWithInteraction(toastNode);
  }

  toastNode.addEventListener("hidden.bs.toast", () => {
    toast.dispose();
    toastNode.remove();
  }, { once: true });

  toast.show();

  return { node: toastNode, toast };
}

export function dismissSiteToast(handle) {
  if (handle?.node?.isConnected) {
    handle.toast.hide();
  }
}

function clearSiteToasts(container) {
  for (const toastNode of container.querySelectorAll(".site-toast")) {
    const toast = Toast.getInstance(toastNode);

    if (toastNode.classList.contains("showing")) {
      toastNode.addEventListener("shown.bs.toast", () => queueMicrotask(() => toast?.dispose()), { once: true });
    } else {
      toast?.dispose();
    }

    toastNode.remove();
  }
}

function pauseToastProgressWithInteraction(toastNode) {
  const pause = () => toastNode.classList.add("is-progress-paused");
  const resume = () => toastNode.classList.remove("is-progress-paused");

  toastNode.addEventListener("mouseover", pause);
  toastNode.addEventListener("mouseout", resume);
  toastNode.addEventListener("focusin", pause);
  toastNode.addEventListener("focusout", resume);
}
