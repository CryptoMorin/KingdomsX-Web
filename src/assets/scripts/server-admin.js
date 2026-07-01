import { Modal } from "bootstrap";

const FALLBACK_SERVER_ICON = "/apple-touch-icon.png";
const ADMIN_PAGE_SIZE = 8;
const ADMIN_REFRESH_CONCURRENCY = 3;
const DEFAULT_SORT = "newest";
const ADMIN_STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
  hidden_offline: "Hidden Offline"
};
const ADMIN_MESSAGES = {
  localUnlock: {
    title: "Local admin token required.",
    message: "Enter LOCAL_ADMIN_TOKEN from your .dev.vars file to unlock the local moderation UI.",
    required: "Local admin token is required."
  },
  states: {
    noSubmissions: (status) => `No ${status.replace("_", " ")} submissions.`,
    noSubmissionsMessage: "Choose another status or refresh after new submissions arrive.",
    unavailableTitle: "Admin data is unavailable.",
    unavailableMessage: "Please try again."
  },
  status: {
    refreshingVisible: "Refreshing visible server statuses...",
    refreshedVisible: (count) => `${numberFormatter.format(count)} visible server status${count === 1 ? "" : "es"} refreshed.`,
    runningAction: (action) => `Running ${action.replace("-", " ")}...`,
    completedAction: (action) => `${action.replace("-", " ")} completed.`
  },
  errors: {
    statusRefreshFailed: "Status refresh failed.",
    loadFailed: "Unable to load submissions.",
    chooseFeedback: "Choose a feedback reason before continuing.",
    moderationFailed: "Moderation action failed."
  },
  confirmations: {
    deleteServer: (name) => `Are you sure you want to permanently delete ${name}? This removes the listing, submissions, status history, and review data.`
  },
  feedbackReasons: {
    reject: [
      {
        code: "server_unreachable",
        title: "Server could not be reached",
        text: "Staff could not connect to this server. Make sure the address is correct, the server is online, and the port is open before resubmitting."
      },
      {
        code: "kingdomsx_not_verified",
        title: "KingdomsX not verified",
        text: 'Staff could not verify that your server is running KingdomsX. Generate a new verification code and then run "/k admin verify <code>" on your server before resubmitting.'
      },
      {
        code: "public_details_incomplete",
        title: "Public details incomplete",
        text: "The server name, description, website, or social links need more complete and accurate public details before this listing can be approved."
      },
      {
        code: "inappropriate_or_unsafe",
        title: "Inappropriate or unsafe listing",
        text: "This listing contains inappropriate, misleading, unsafe, or policy-violating content. Remove the problematic content before resubmitting."
      }
    ],
    suspend: [
      {
        title: "Policy violation",
        text: "This listing is suspended because staff found content or behavior that violates the server listing rules. Contact staff after correcting the issue."
      },
      {
        title: "Security or abuse concern",
        text: "This listing is suspended while staff reviews a security, abuse, impersonation, or player-safety concern related to the server."
      },
      {
        title: "Misleading listing",
        text: "This listing is suspended because the public details appear misleading or no longer match the actual server. Update the details and contact staff for a new review."
      },
      {
        title: "Repeated downtime",
        text: "This listing is suspended after repeated downtime or failed checks. Bring the server back online and contact staff for a new review."
      },
      {
        title: "Owner or staff request",
        text: "This listing is suspended while an owner or staff request is being resolved. Contact staff when the issue is ready for review."
      }
    ]
  }
};

const SOCIAL_ICON_CLASSES = {
  website: "fa-solid fa-globe",
  discord: "fa-brands fa-discord",
  facebook: "fa-brands fa-facebook-f",
  instagram: "fa-brands fa-instagram",
  x: "fa-brands fa-x-twitter",
  youtube: "fa-brands fa-youtube"
};

const numberFormatter = new Intl.NumberFormat();
let localAdminToken = "";
const twoDigit = (value) => String(value).padStart(2, "0");

const formatDate = (value) => {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${twoDigit(date.getDate())}/${twoDigit(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`
  ].join(", ");
};

const formatVerificationDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${twoDigit(date.getDate())}/${twoDigit(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`
  ].join(" ");
};

const formatVerificationEvidence = (value) => {
  const evidence = textOrFallback(value, "No verification evidence stored.");
  return evidence
    .split("\n")
    .map((line) => line.startsWith("Verified: ") ? `Verified: ${formatVerificationDate(line.slice(10))}` : line)
    .join("\n");
};

const titleCase = (value) => String(value ?? "unknown")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const textOrFallback = (value, fallback = "Not provided") => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
};

const playerCountLabel = (status) => {
  if (status?.online === false) {
    return "-";
  }

  if (typeof status?.playersMax === "number") {
    return `${numberFormatter.format(status.playersOnline ?? 0)} / ${numberFormatter.format(status.playersMax)}`;
  }

  if (typeof status?.playersOnline === "number") {
    return `${numberFormatter.format(status.playersOnline)} online`;
  }

  return "Players unknown";
};

const statusLabel = (server) => {
  if (typeof server.status?.online !== "boolean") {
    return "-";
  }

  const state = server.status?.online ? "Online" : "Offline";
  return server.status?.stale ? `${state} (stale)` : state;
};

const versionLabel = (status) => status?.online === false ? "-" : status?.version || "Version unknown";

const reviewDateStat = (server, columnClass = "col") => {
  const fallbackDate = server.reviewStatus === "approved"
    ? server.approvedAt
    : server.reviewStatus === "suspended"
      ? server.suspendedAt
      : server.updatedAt;

  const label = ({
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    suspended: "Suspended",
    hidden_offline: "Hidden"
  })[server.reviewStatus] ?? "Updated";

  return createStat(label, formatDate(server.review?.createdAt ?? fallbackDate), "fa-solid fa-stamp", columnClass);
};

const setAdminState = (container, title, message = "", kind = "", icon = "fa-shield-halved") => {
  container.replaceChildren();
  container.removeAttribute("aria-busy");
  const state = document.createElement("div");
  state.className = `servers-state d-flex flex-column align-items-center justify-content-center text-center gap-2 p-4 rounded-2 ${kind}`.trim();

  const stateIcon = document.createElement("i");
  stateIcon.className = `servers-state-icon d-inline-flex align-items-center justify-content-center fa-solid ${icon}`;
  stateIcon.setAttribute("aria-hidden", "true");

  const stateTitle = document.createElement("strong");
  stateTitle.textContent = title;
  state.append(stateIcon, stateTitle);

  if (message) {
    const stateMessage = document.createElement("span");
    stateMessage.textContent = message;
    state.append(stateMessage);
  }

  container.append(state);
};

const skeletonBlock = (className) => {
  const block = document.createElement("span");
  block.className = `server-skeleton ${className}`.trim();
  return block;
};

const createAdminSkeletonCard = () => {
  const column = document.createElement("div");
  column.className = "col d-flex";

  const card = document.createElement("article");
  card.className = "server-card surface-panel server-card-skeleton d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3";

  const top = document.createElement("div");
  top.className = "server-card-top d-flex align-items-center gap-3";

  const main = document.createElement("span");
  main.className = "server-skeleton-stack d-grid gap-2 flex-grow-1 min-w-0";
  main.append(skeletonBlock("server-skeleton-line server-skeleton-title"), skeletonBlock("server-skeleton-line server-skeleton-short"));
  top.append(skeletonBlock("server-skeleton-icon flex-shrink-0 rounded-2"), main);

  const description = document.createElement("span");
  description.className = "server-skeleton-stack d-grid gap-2";
  description.append(skeletonBlock("server-skeleton-line"), skeletonBlock("server-skeleton-line server-skeleton-short"));

  const footer = document.createElement("span");
  footer.className = "server-skeleton-footer d-flex gap-2 mt-auto";
  for (let index = 0; index < 2; index += 1) {
    footer.append(skeletonBlock("server-skeleton-chip"));
  }

  card.append(top, description, footer);
  column.append(card);
  return column;
};

const setAdminLoadingSkeleton = (container, count = ADMIN_PAGE_SIZE) => {
  container.replaceChildren();
  container.setAttribute("aria-busy", "true");

  const row = document.createElement("div");
  row.className = "servers-skeleton row row-cols-1 row-cols-md-2 g-3";
  row.setAttribute("aria-hidden", "true");

  for (let index = 0; index < count; index += 1) {
    row.append(createAdminSkeletonCard());
  }

  container.append(row);
};

const createLocalAdminUnlock = (message, onSubmit) => {
  const state = document.createElement("div");
  state.className = "servers-state servers-state-error d-flex flex-column align-items-center justify-content-center text-center gap-3 p-4 rounded-2";

  const icon = document.createElement("i");
  icon.className = "servers-state-icon d-inline-flex align-items-center justify-content-center fa-solid fa-lock";
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("strong");
  title.textContent = ADMIN_MESSAGES.localUnlock.title;

  const copy = document.createElement("span");
  copy.textContent = message;

  const form = document.createElement("form");
  form.className = "server-admin-token-form d-flex flex-column flex-sm-row align-items-stretch justify-content-center gap-2 w-100";
  form.autocomplete = "off";

  const input = document.createElement("input");
  input.className = "form-control";
  input.type = "password";
  input.name = "local-admin-token";
  input.placeholder = "LOCAL_ADMIN_TOKEN";
  input.autocomplete = "off";
  input.required = true;
  input.setAttribute("aria-label", "Local admin token");

  const submit = document.createElement("button");
  submit.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2";
  submit.type = "submit";
  submit.innerHTML = '<i class="fa-solid fa-unlock-keyhole" aria-hidden="true"></i> Unlock';

  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmit(input.value.trim());
  });

  state.append(icon, title, copy, form);
  queueMicrotask(() => input.focus());
  return state;
};

const createServerIcon = (server) => {
  const frame = document.createElement("div");
  frame.className = "server-icon-frame d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden rounded-2";

  const icon = document.createElement("img");
  icon.className = "server-icon w-100 h-100";
  icon.src = server.status?.icon || FALLBACK_SERVER_ICON;
  icon.alt = "";
  icon.loading = "lazy";
  icon.decoding = "async";
  icon.addEventListener("error", () => {
    if (icon.src !== new URL(FALLBACK_SERVER_ICON, window.location.origin).href) {
      icon.src = FALLBACK_SERVER_ICON;
    }
  }, { once: true });

  frame.append(icon);
  return frame;
};

const createAddressButton = (server) => {
  const address = document.createElement("button");
  address.className = "btn btn-site copy-action server-address d-inline-flex align-items-center gap-2 overflow-hidden text-start text-nowrap";
  address.type = "button";
  address.dataset.copyServerAddress = server.address ?? "";
  address.dataset.copySuccessLabel = "Copied!";
  address.setAttribute("aria-label", `Copy server address ${server.address ?? "unavailable"}`);

  const label = document.createElement("span");
  label.className = "server-address-label flex-shrink-0";
  label.textContent = "IP:";

  const value = document.createElement("span");
  value.className = "server-address-value text-truncate";
  value.textContent = server.address ?? "Address unavailable";

  const icon = document.createElement("i");
  icon.className = "copy-action-icon fa-regular fa-copy";
  icon.setAttribute("aria-hidden", "true");

  address.append(label, value, icon);
  return address;
};

const createStat = (label, value, iconClass, columnClass = "col") => {
  const column = document.createElement("div");
  column.className = columnClass;

  const stat = document.createElement("div");
  stat.className = "server-stat d-flex align-items-center gap-2 min-w-0 h-100 p-2 rounded-2";

  const iconWrap = document.createElement("span");
  iconWrap.className = "server-stat-icon d-inline-flex align-items-center justify-content-center flex-shrink-0 rounded-2";

  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  iconWrap.append(icon);

  const text = document.createElement("span");
  text.className = "server-stat-text d-grid gap-1 min-w-0";

  const labelNode = document.createElement("span");
  labelNode.className = "server-stat-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.className = "server-stat-value text-truncate";
  valueNode.textContent = value;
  valueNode.title = value;

  text.append(labelNode, valueNode);
  stat.append(iconWrap, text);
  column.append(stat);
  return column;
};

const createAdminLink = (url, label, key = "") => {
  if (!url) {
    return null;
  }

  const link = document.createElement("a");
  link.className = "server-link server-social-link d-inline-flex align-items-center justify-content-center text-decoration-none";
  link.href = url;
  link.target = "_blank";
  link.rel = "ugc nofollow noopener noreferrer";
  link.setAttribute("aria-label", label);
  link.title = label;

  const icon = document.createElement("i");
  icon.className = SOCIAL_ICON_CLASSES[key] ?? "fa-solid fa-link";
  icon.setAttribute("aria-hidden", "true");
  link.append(icon);
  return link;
};

const createActionButton = (action, label, icon, variant = "") => {
  const button = document.createElement("button");
  button.className = `btn btn-site d-inline-flex align-items-center justify-content-center gap-2 ${variant}`.trim();
  button.type = "button";
  button.dataset.adminAction = action;
  button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}`;
  return button;
};

const createReasonChoice = (action, reason, index) => {
  const inputId = `server-admin-${action}-reason-${index}`;
  const wrap = document.createElement("label");
  wrap.className = "server-admin-reason-option d-flex align-items-start gap-3 p-3 rounded-3";
  wrap.htmlFor = inputId;

  const input = document.createElement("input");
  input.className = "form-check-input mt-1 flex-shrink-0";
  input.type = "radio";
  input.name = "server-admin-moderation-reason";
  input.id = inputId;
  input.value = reason.text;
  input.dataset.reasonCode = reason.code ?? "";
  input.checked = index === 0;

  const content = document.createElement("span");
  content.className = "d-grid gap-1 min-w-0";

  const title = document.createElement("strong");
  title.textContent = reason.title;

  const text = document.createElement("span");
  text.textContent = reason.text;

  content.append(title, text);
  wrap.append(input, content);
  return wrap;
};

const providerName = (value) => ({
  mcsrvstat: "mcsrvstat.us",
  "mcsrvstat.us": "mcsrvstat.us",
  "mcstatus.io": "mcstatus.io",
  "mcapi.us": "mcapi.us"
})[value] ?? (value || "No provider");

const checkedAgoLabel = (status) => {
  if (!status?.checkedAt) {
    return "(not checked yet)";
  }

  const checkedTime = new Date(status.checkedAt).getTime();

  if (!Number.isFinite(checkedTime)) {
    return "(not checked yet)";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - checkedTime) / 1000));

  if (elapsedSeconds < 60) {
    return "(<1m ago)";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `(${elapsedMinutes}m ago)`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `(${elapsedHours}h ago)`;
  }

  return `(${Math.floor(elapsedHours / 24)}d ago)`;
};

const createReviewStatus = (server) => {
  const review = document.createElement("span");
  review.className = "server-admin-review-status d-inline-flex align-items-center px-2 py-1 rounded-2";
  review.textContent = titleCase(server.reviewStatus);
  return review;
};

const createOnlineStatus = (server) => {
  const wrap = document.createElement("span");
  wrap.className = "server-status-stack d-inline-flex flex-column align-items-center gap-1";

  const online = document.createElement("span");
  online.className = `server-status d-inline-flex align-items-center gap-1 px-2 py-1 rounded-2 ${server.status?.online ? "server-status-online" : "server-status-offline"}`;
  online.textContent = server.status?.online ? "Online" : "Offline";

  const checked = document.createElement("small");
  checked.className = "server-status-checked text-lowercase";
  checked.textContent = checkedAgoLabel(server.status);

  wrap.append(online, checked);
  return wrap;
};

const createAdminCard = (server) => {
  const card = document.createElement("article");
  card.className = "server-card surface-panel surface-lift d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3";
  card.dataset.serverId = server.id;

  const top = document.createElement("div");
  top.className = "server-card-top d-flex align-items-center gap-3";
  top.append(createServerIcon(server));

  const titleWrap = document.createElement("div");
  titleWrap.className = "server-card-main d-flex flex-column justify-content-center flex-grow-1 gap-2 min-w-0";

  const titleRow = document.createElement("div");
  titleRow.className = "server-title-row d-flex align-items-start justify-content-between gap-2";

  const identity = document.createElement("div");
  identity.className = "server-card-identity d-flex flex-column gap-2 flex-grow-1 min-w-0";

  const title = document.createElement("h3");
  title.className = "server-card-title mb-0 text-truncate";
  title.textContent = server.name;

  const chips = document.createElement("div");
  chips.className = "server-card-tags d-flex flex-wrap align-items-start justify-content-end gap-2 flex-shrink-0";
  chips.append(createOnlineStatus(server), createReviewStatus(server));

  identity.append(title, createAddressButton(server));
  titleRow.append(identity, chips);
  titleWrap.append(titleRow);
  top.append(titleWrap);

  const description = document.createElement("p");
  description.className = "server-description flex-grow-1 mb-0";
  description.textContent = server.description;

  const stats = document.createElement("div");
  stats.className = "server-stats row row-cols-1 row-cols-sm-2 g-2";
  stats.append(
    createStat("Players", playerCountLabel(server.status), "fa-solid fa-user-group"),
    createStat("Version", versionLabel(server.status), "fa-solid fa-code-branch"),
    createStat("Submitted", formatDate(server.submission?.createdAt ?? server.createdAt), "fa-solid fa-clock"),
    reviewDateStat(server)
  );

  const footer = document.createElement("div");
  footer.className = "server-card-bottom d-flex flex-wrap align-items-center justify-content-between gap-2 mt-auto min-w-0";

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2";
  const website = createAdminLink(server.websiteUrl, "Website", "website");
  if (website) {
    links.append(website);
  }
  (server.socialLinks ?? []).forEach((item) => {
    const link = createAdminLink(item.url, item.host ? `${item.label}: ${item.host}` : item.label, item.key);
    if (link) {
      links.append(link);
    }
  });

  const manage = createActionButton("open-manage", "Manage", "fa-sliders", "btn-site-primary btn-site-sm");
  manage.dataset.adminManage = server.id;

  footer.append(links, manage);
  card.append(top, description, stats, footer);
  return card;
};

const renderCards = (container, items) => {
  container.replaceChildren();
  container.removeAttribute("aria-busy");

  const row = document.createElement("div");
  row.className = "row row-cols-1 row-cols-md-2 g-3";
  items.forEach((server) => {
    const column = document.createElement("div");
    column.className = "col d-flex";
    column.append(createAdminCard(server));
    row.append(column);
  });
  container.append(row);
};

const isLocalAdminOrigin = () => document.querySelector("[data-server-admin]")?.dataset.localBuild === "true";

const storedLocalAdminToken = () => {
  if (!isLocalAdminOrigin()) {
    return "";
  }

  return localAdminToken;
};

const saveLocalAdminToken = (token) => {
  localAdminToken = token.trim();
};

const adminHeaders = () => {
  const headers = { accept: "application/json" };
  const token = storedLocalAdminToken();

  if (token) {
    headers["x-admin-token"] = token;
  }

  return headers;
};

const renderPagination = (pagination, currentPage, totalPages) => {
  if (!(pagination instanceof HTMLElement)) {
    return;
  }

  pagination.replaceChildren();

  if (totalPages <= 1) {
    return;
  }

  const createButton = (label, page, disabled = false, current = false, iconClass = "", iconAfter = false) => {
    const button = document.createElement("button");
    button.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2";
    button.type = "button";
    button.dataset.adminPage = String(page);

    if (current) {
      button.setAttribute("aria-current", "page");
    }

    if (disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }

    const labelNode = document.createTextNode(label);
    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.setAttribute("aria-hidden", "true");
      button.append(...(iconAfter ? [labelNode, icon] : [icon, labelNode]));
    } else {
      button.append(labelNode);
    }

    return button;
  };

  pagination.append(createButton("Previous", Math.max(1, currentPage - 1), currentPage === 1, false, "fa-solid fa-chevron-left"));

  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      pagination.append(createButton(String(page), page, false, page === currentPage));
    } else if (Math.abs(page - currentPage) === 2) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "servers-pagination-ellipsis";
      ellipsis.textContent = "...";
      pagination.append(ellipsis);
    }
  }

  pagination.append(createButton("Next", Math.min(totalPages, currentPage + 1), currentPage === totalPages, false, "fa-solid fa-chevron-right", true));
};

const mapWithConcurrency = async (items, limit, worker) => {
  let index = 0;
  const count = Math.min(limit, items.length);

  await Promise.all(Array.from({ length: count }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }));
};

const createModalSection = (title, content) => {
  const section = document.createElement("section");
  section.className = "server-admin-section d-flex flex-column gap-2 p-3 rounded-3";

  const heading = document.createElement("h3");
  heading.className = "server-admin-section-title mb-0";
  heading.textContent = title;

  section.append(heading, content);
  return section;
};

const createTextBlock = (text, className = "mb-0") => {
  const block = document.createElement("p");
  block.className = className;
  block.textContent = text;
  return block;
};

const createOverview = (server) => {
  const overview = document.createElement("div");
  overview.className = "server-admin-overview d-flex align-items-center gap-3";
  overview.append(createServerIcon(server));

  const content = document.createElement("div");
  content.className = "server-card-main d-flex flex-column justify-content-center gap-2 flex-grow-1 min-w-0";

  const titleRow = document.createElement("div");
  titleRow.className = "server-title-row d-flex align-items-center gap-2";

  const name = document.createElement("h3");
  name.className = "server-card-title mb-0 text-truncate";
  name.textContent = server.name;

  titleRow.append(name, createReviewStatus(server));
  content.append(titleRow, createAddressButton(server));
  overview.append(content);

  return overview;
};

const createCurrentModerationReason = (server) => {
  if (server.reviewStatus !== "rejected" && server.reviewStatus !== "suspended") {
    return null;
  }

  const action = server.reviewStatus === "rejected" ? "reject" : "suspend";
  const reasonText = textOrFallback(server.submission?.moderationNotes, "No moderation reason was stored.");
  const preset = (ADMIN_MESSAGES.feedbackReasons[action] ?? []).find((reason) => (
    (reason.code && server.review?.reasonCode && reason.code === server.review.reasonCode)
      || reason.text === reasonText
  ));
  const notice = document.createElement("div");
  notice.className = "server-submit-notice is-error d-flex align-items-center gap-3 p-3 rounded-3";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-circle-exclamation d-inline-flex align-items-center justify-content-center flex-shrink-0";
  icon.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "d-grid gap-1";

  const reasonTitle = document.createElement("strong");
  reasonTitle.textContent = `Current ${server.reviewStatus === "rejected" ? "rejection" : "suspension"} reason${preset?.title ? `: ${preset.title}` : ""}`;

  content.append(reasonTitle, createTextBlock(reasonText));
  notice.append(icon, content);
  return notice;
};

const fillManageModal = (modal, server) => {
  const title = modal.querySelector("[data-admin-modal-title]");
  const body = modal.querySelector("[data-admin-modal-body]");
  const footer = modal.querySelector("[data-admin-modal-footer]");

  if (!(body instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
    return null;
  }

  if (title) {
    title.textContent = server.name;
  }

  body.replaceChildren();
  footer.replaceChildren();
  modal.dataset.serverId = server.id;

  const description = createTextBlock(server.description, "server-admin-description mb-0");

  const stats = document.createElement("div");
  stats.className = "server-stats row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-2";
  stats.append(
    createStat("Status", statusLabel(server), server.status?.online ? "fa-solid fa-signal" : "fa-solid fa-triangle-exclamation"),
    createStat("Players", playerCountLabel(server.status), "fa-solid fa-user-group"),
    createStat("Version", versionLabel(server.status), "fa-solid fa-code-branch"),
    createStat("Last Checked", server.status?.online === false && !server.status?.checkedAt ? "-" : formatDate(server.status?.checkedAt), "fa-solid fa-rotate")
  );

  if (!server.status?.online) {
    stats.append(createStat("Check Attempts", String(server.failureCount ?? 0), "fa-solid fa-triangle-exclamation"));
  }

  const submissionStats = document.createElement("div");
  submissionStats.className = "server-stats row row-cols-1 row-cols-md-2 g-2";
  submissionStats.append(
    createStat("Owner", textOrFallback(server.submission?.contact), "fa-solid fa-user"),
    createStat("Submitted", formatDate(server.submission?.createdAt ?? server.createdAt), "fa-solid fa-clock")
  );

  const evidence = document.createElement("pre");
  evidence.className = "mb-0";
  evidence.textContent = formatVerificationEvidence(server.submission?.verificationEvidence);

  const submissionContent = document.createElement("div");
  submissionContent.className = "d-flex flex-column gap-3";
  submissionContent.append(submissionStats, evidence);

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2";
  const website = createAdminLink(server.websiteUrl, "Website", "website");
  if (website) {
    links.append(website);
  }
  (server.socialLinks ?? []).forEach((item) => {
    const link = createAdminLink(item.url, item.host ? `${item.label}: ${item.host}` : item.label, item.key);
    if (link) {
      links.append(link);
    }
  });

  const socialsContent = document.createElement("div");
  socialsContent.className = "d-flex flex-column gap-2";
  socialsContent.append(
    links.childElementCount > 0
      ? links
      : createTextBlock("No public website or social links were submitted.")
  );

  const sections = [
    createCurrentModerationReason(server),
    createModalSection("Overview", createOverview(server)),
    createModalSection("Description", description),
    createModalSection(`Server Status (${providerName(server.provider)})`, stats),
    createModalSection("Website & Socials", socialsContent),
    createModalSection("Submission", submissionContent)
  ].filter(Boolean);
  body.append(...sections);

  const refreshGroup = document.createElement("div");
  refreshGroup.className = "server-admin-footer-group d-flex flex-wrap gap-2";
  refreshGroup.append(createActionButton("refresh-status", "Refresh Status", "fa-rotate", "btn-site-sm"));

  const moderationGroup = document.createElement("div");
  moderationGroup.className = "server-admin-footer-group d-flex flex-wrap gap-2";
  moderationGroup.append(
    createActionButton("approve", "Approve", "fa-check", "btn-site-sm"),
    createActionButton("suspend", "Suspend", "fa-ban", "btn-site-sm"),
    createActionButton("reject", "Reject", "fa-xmark", "btn-site-sm"),
    createActionButton("delete", "Delete", "fa-trash", "btn-site-sm action-danger")
  );

  footer.append(refreshGroup, moderationGroup);

  return null;
};

const fillReasonModal = (modal, server, action) => {
  const title = modal.querySelector("[data-admin-modal-title]");
  const body = modal.querySelector("[data-admin-modal-body]");
  const footer = modal.querySelector("[data-admin-modal-footer]");
  const reasons = ADMIN_MESSAGES.feedbackReasons[action] ?? [];

  if (!(body instanceof HTMLElement) || !(footer instanceof HTMLElement) || reasons.length === 0) {
    return;
  }

  if (title) {
    title.textContent = `${action === "suspend" ? "Suspend" : "Reject"} ${server.name}`;
  }

  body.replaceChildren();
  footer.replaceChildren();
  modal.dataset.serverId = server.id;
  modal.dataset.adminReasonAction = action;

  const intro = createTextBlock(
    action === "suspend"
      ? "Choose the standardized suspension reason that best explains this action. The selected message is shown to the server owner."
      : "Choose the standardized rejection reason that best explains what the server owner must fix before resubmitting.",
    "mb-0"
  );

  const choices = document.createElement("div");
  choices.className = "server-admin-reason-list d-flex flex-column gap-2";
  reasons.forEach((reason, index) => choices.append(createReasonChoice(action, reason, index)));

  body.append(createModalSection("Feedback reason", intro), choices);

  const back = document.createElement("button");
  back.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 btn-site-sm";
  back.type = "button";
  back.dataset.adminReasonBack = "";
  back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back';

  const confirm = document.createElement("button");
  confirm.className = `btn btn-site d-inline-flex align-items-center justify-content-center gap-2 btn-site-sm ${action === "reject" ? "action-danger" : ""}`.trim();
  confirm.type = "button";
  confirm.dataset.adminActionConfirm = action;
  confirm.innerHTML = `<i class="fa-solid ${action === "suspend" ? "fa-ban" : "fa-xmark"}" aria-hidden="true"></i> ${action === "suspend" ? "Suspend" : "Reject"}`;

  footer.append(back, confirm);
};

const initServerAdmin = () => {
  const root = document.querySelector("[data-server-admin]");

  if (!(root instanceof HTMLElement)) {
    return;
  }

  const list = root.querySelector("[data-admin-list]");
  const filters = root.querySelector("[data-admin-status-filters]");
  const statusSelect = root.querySelector("[data-admin-status-select]");
  const refresh = root.querySelector("[data-admin-refresh]");
  const sortControl = root.querySelector("[data-admin-sort]");
  const pagination = root.querySelector("[data-admin-pagination]");
  const statusMessage = root.querySelector("[data-admin-status-message]");
  const modal = document.querySelector("[data-admin-modal]");
  let status = "pending";
  let page = 1;
  let sort = DEFAULT_SORT;
  let totalPages = 1;
  let loadVersion = 0;
  const servers = new Map();

  if (!(list instanceof HTMLElement)) {
    return;
  }

  const modalController = modal instanceof HTMLElement ? Modal.getOrCreateInstance(modal) : null;

  const setMessage = (message, kind = "") => {
    if (!statusMessage) {
      return;
    }

    statusMessage.textContent = message;
    statusMessage.className = `server-admin-status mb-0 ${kind}`.trim();
  };

  const showLocalAdminUnlock = (message = ADMIN_MESSAGES.localUnlock.message) => {
    renderPagination(pagination, 1, 1);
    list.removeAttribute("aria-busy");
    list.replaceChildren(createLocalAdminUnlock(message, (token) => {
      if (!token) {
        setMessage(ADMIN_MESSAGES.localUnlock.required, "is-error");
        return;
      }

      saveLocalAdminToken(token);
      load();
    }));
    setMessage(ADMIN_MESSAGES.localUnlock.required, "is-error");
  };

  const updateFilterCounts = (counts = {}) => {
    filters?.querySelectorAll("[data-admin-status]").forEach((filter) => {
      if (!(filter instanceof HTMLButtonElement)) {
        return;
      }

      const key = filter.dataset.adminStatus ?? "";
      const label = filter.dataset.adminStatusLabel ?? ADMIN_STATUS_LABELS[key] ?? titleCase(key);
      const count = Number(counts[key] ?? 0);
      filter.textContent = `${label} (${numberFormatter.format(count)})`;
    });

    if (statusSelect instanceof HTMLSelectElement) {
      Array.from(statusSelect.options).forEach((option) => {
        const key = option.value;
        const label = ADMIN_STATUS_LABELS[key] ?? titleCase(key);
        const count = Number(counts[key] ?? 0);
        option.textContent = `${label} (${numberFormatter.format(count)})`;
      });
    }
  };

  const syncStatusControls = () => {
    filters?.querySelectorAll("[data-admin-status]").forEach((filter) => {
      if (!(filter instanceof HTMLButtonElement)) {
        return;
      }

      const active = (filter.dataset.adminStatus ?? "pending") === status;
      filter.classList.toggle("is-active", active);
      filter.setAttribute("aria-pressed", String(active));
    });

    if (statusSelect instanceof HTMLSelectElement) {
      statusSelect.value = status;
    }
  };

  const refreshServerStatus = async (server, notes = "") => {
    const response = await fetch(`/api/admin/servers/${encodeURIComponent(server.id)}/refresh-status`, {
      method: "POST",
      headers: {
        ...adminHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ notes })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || ADMIN_MESSAGES.errors.statusRefreshFailed);
    }

    return data.item;
  };

  const refreshVisibleStatuses = async (items, version, announce = false) => {
    if (!items.length) {
      return;
    }

    if (announce) {
      setMessage(ADMIN_MESSAGES.status.refreshingVisible);
    }

    let refreshedCount = 0;
    await mapWithConcurrency(items, ADMIN_REFRESH_CONCURRENCY, async (server) => {
      const refreshed = await refreshServerStatus(server).catch(() => null);
      if (version !== loadVersion || !refreshed) {
        return;
      }

      refreshedCount += 1;
      refreshServerCard(refreshed);
    });

    if (announce && version === loadVersion) {
      setMessage(ADMIN_MESSAGES.status.refreshedVisible(refreshedCount), "is-success");
    }
  };

  const load = async ({ refreshStatuses = false, announceRefresh = false } = {}) => {
    loadVersion += 1;
    const version = loadVersion;
    setAdminLoadingSkeleton(list);
    setMessage("");

    try {
      const url = new URL("/api/admin/servers", window.location.origin);
      url.searchParams.set("status", status);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(ADMIN_PAGE_SIZE));
      url.searchParams.set("sort", sort);
      const response = await fetch(url, { headers: adminHeaders() });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 403 && isLocalAdminOrigin()) {
          saveLocalAdminToken("");
          showLocalAdminUnlock(data.error || ADMIN_MESSAGES.localUnlock.message);
          return;
        }

        throw new Error(data.error || ADMIN_MESSAGES.errors.loadFailed);
      }

      const items = data.items ?? [];
      totalPages = data.totalPages ?? 1;
      page = data.page ?? page;
      servers.clear();
      items.forEach((item) => servers.set(item.id, item));
      renderPagination(pagination, page, totalPages);
      updateFilterCounts(data.counts);

      if (!items.length) {
        setAdminState(list, ADMIN_MESSAGES.states.noSubmissions(status), ADMIN_MESSAGES.states.noSubmissionsMessage, "", "fa-inbox");
        return;
      }

      renderCards(list, items);
      if (refreshStatuses) {
        refreshVisibleStatuses(items, version, announceRefresh);
      }
    } catch (error) {
      renderPagination(pagination, 1, 1);
      setAdminState(list, ADMIN_MESSAGES.states.unavailableTitle, error instanceof Error ? error.message : ADMIN_MESSAGES.states.unavailableMessage, "servers-state-error", "fa-triangle-exclamation");
      setMessage(error instanceof Error ? error.message : ADMIN_MESSAGES.states.unavailableTitle, "is-error");
    }
  };

  const refreshServerCard = (server) => {
    servers.set(server.id, server);
    const current = list.querySelector(`[data-server-id="${CSS.escape(server.id)}"]`);
    const replacement = createAdminCard(server);
    current?.replaceWith(replacement);

    if (modal instanceof HTMLElement && modal.dataset.serverId === server.id) {
      fillManageModal(modal, server);
    }
  };

  filters?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-admin-status]") : null;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    status = button.dataset.adminStatus ?? "pending";
    page = 1;
    syncStatusControls();
    load();
  });

  statusSelect?.addEventListener("change", () => {
    status = statusSelect instanceof HTMLSelectElement ? statusSelect.value || "pending" : "pending";
    page = 1;
    syncStatusControls();
    load();
  });

  sortControl?.addEventListener("change", () => {
    sort = sortControl instanceof HTMLSelectElement ? sortControl.value || DEFAULT_SORT : DEFAULT_SORT;
    page = 1;
    load();
  });

  pagination?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-admin-page]") : null;

    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const nextPage = Number(button.dataset.adminPage ?? "1");
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page) {
      return;
    }

    page = nextPage;
    load();
  });

  refresh?.addEventListener("click", () => load({ refreshStatuses: true, announceRefresh: true }));

  list.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-admin-manage]") : null;

    if (!(button instanceof HTMLButtonElement) || !(modal instanceof HTMLElement)) {
      return;
    }

    const server = servers.get(button.dataset.adminManage ?? "");
    if (!server) {
      return;
    }

    fillManageModal(modal, server);
    modalController?.show();
  });

  const runAdminAction = async (button, id, action, notes = "", reasonCode = "") => {
    if (action === "delete") {
      const server = servers.get(id);
      const name = server?.name || "this server";
      if (!window.confirm(ADMIN_MESSAGES.confirmations.deleteServer(name))) {
        return;
      }
    }

    button.disabled = true;
    setMessage(ADMIN_MESSAGES.status.runningAction(action));

    try {
      const data = action === "refresh-status"
        ? { item: await refreshServerStatus({ id }) }
        : await fetch(action === "delete" ? `/api/admin/servers/${encodeURIComponent(id)}` : `/api/admin/servers/${encodeURIComponent(id)}/${action}`, {
          method: action === "delete" ? "DELETE" : "POST",
          headers: {
            ...adminHeaders(),
            "content-type": "application/json"
          },
          ...(action === "delete" ? {} : { body: JSON.stringify({ notes, reasonCode }) })
        }).then(async (response) => {
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(payload.error || ADMIN_MESSAGES.errors.moderationFailed);
          }

          return payload;
        });

      setMessage(ADMIN_MESSAGES.status.completedAction(action), "is-success");

      if (action === "refresh-status" && data.item) {
        refreshServerCard(data.item);
        return;
      }

      modalController?.hide();
      load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ADMIN_MESSAGES.errors.moderationFailed, "is-error");
    } finally {
      button.disabled = false;
    }
  };

  modal?.addEventListener("click", async (event) => {
    const back = event.target instanceof Element ? event.target.closest("[data-admin-reason-back]") : null;
    if (back instanceof HTMLButtonElement && modal instanceof HTMLElement) {
      const server = servers.get(modal.dataset.serverId ?? "");
      if (server) {
        fillManageModal(modal, server);
      }
      return;
    }

    const confirm = event.target instanceof Element ? event.target.closest("[data-admin-action-confirm]") : null;
    if (confirm instanceof HTMLButtonElement && modal instanceof HTMLElement) {
      const id = modal.dataset.serverId ?? "";
      const action = confirm.dataset.adminActionConfirm ?? "";
      const checked = modal.querySelector('input[name="server-admin-moderation-reason"]:checked');
      const notes = checked instanceof HTMLInputElement ? checked.value.trim() : "";
      const reasonCode = checked instanceof HTMLInputElement ? checked.dataset.reasonCode ?? "" : "";

      if (!id || !action || notes.length < 3) {
        setMessage(ADMIN_MESSAGES.errors.chooseFeedback, "is-error");
        return;
      }

      await runAdminAction(confirm, id, action, notes, reasonCode);
      return;
    }

    const button = event.target instanceof Element ? event.target.closest("[data-admin-action]") : null;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const id = modal instanceof HTMLElement ? modal.dataset.serverId : "";
    const action = button.dataset.adminAction;

    if (!id || !action) {
      return;
    }

    if ((action === "reject" || action === "suspend") && modal instanceof HTMLElement) {
      const server = servers.get(id);
      if (server) {
        fillReasonModal(modal, server, action);
      }
      return;
    }

    await runAdminAction(button, id, action);
  });

  syncStatusControls();
  if (isLocalAdminOrigin() && !storedLocalAdminToken()) {
    showLocalAdminUnlock();
    return;
  }

  load();
};

initServerAdmin();
