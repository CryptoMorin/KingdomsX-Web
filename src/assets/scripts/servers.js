import { Toast, Tooltip } from "bootstrap";

const SOCIAL_ICON_CLASSES = {
  website: "fa-solid fa-globe",
  discord: "fa-brands fa-discord",
  facebook: "fa-brands fa-facebook-f",
  instagram: "fa-brands fa-instagram",
  x: "fa-brands fa-x-twitter",
  youtube: "fa-brands fa-youtube"
};

const SUBMISSION_DESCRIPTION_LIMIT = 120;
const PAGE_SIZE_DEFAULT = 8;
const FALLBACK_SERVER_ICON = "/apple-touch-icon.png";
const STATUS_FILTERS = new Set(["all", "online", "offline"]);
const SORT_OPTIONS = new Set(["newest", "players", "name"]);
const DEFAULT_SORT = "newest";
const numberFormatter = new Intl.NumberFormat();
const copyResetTimers = new WeakMap();
const SERVER_MESSAGES = {
  directory: {
    noApproved: {
      title: "No approved servers yet.",
      message: "Check back soon or submit your KingdomsX server for review.",
      icon: "fa-flag"
    },
    noOnline: {
      title: "No approved servers are online right now.",
      message: ({ offlineCount, allCount }) => offlineCount === allCount
        ? "Every approved server currently appears offline. Try the Offline or All filter."
        : "Try the Offline or All filter to browse approved servers.",
      icon: "fa-signal"
    },
    noOffline: {
      title: "No approved servers are offline right now.",
      message: ({ onlineCount, allCount }) => onlineCount === allCount
        ? "Every approved server currently appears online. Try the Online or All filter."
        : "Try the Online or All filter to browse approved servers.",
      icon: "fa-circle-check"
    },
    noFilterMatch: {
      title: "No servers match this filter.",
      message: "Try another server status filter.",
      icon: "fa-filter"
    },
    unavailable: {
      title: "Server listings are temporarily unavailable.",
      message: "Please try again soon."
    }
  },
  submit: {
    loggedOutSteps: [
      { icon: "fa-brands fa-discord", title: "Sign in with Discord", text: "Log in with your Discord account so you can manage your submission later." },
      { icon: "fa-solid fa-list-check", title: "Add server details", text: "Enter the public address, description, website, and social links you want shown on your listing." },
      { icon: "fa-solid fa-stamp", title: "Wait for review", text: "Staff checks the listing before it appears. If it is rejected, you can update it and resubmit." }
    ],
    protectionMissing: "Submission protection is not configured for this build. Set PUBLIC_TURNSTILE_SITE_KEY before enabling production submissions.",
    proofHelp: {
      beforeCommand: "Run ",
      command: "/k about all",
      afterCommand: " from your ",
      emphasis: "console",
      afterEmphasis: " and paste the output below. Staff uses this to confirm that your server is online and really running the KingdomsX plugin before approving your server."
    },
    verificationExpired: {
      title: "Verification expired",
      message: "Since you changed your server name, address, or port, staff will need to review the listing again before it goes public. This helps confirm that your server is still running KingdomsX."
    },
    verificationComplete: {
      title: "Verification complete",
      message: "Your previous verification is still valid. Since you didn't change your server name, address, or port, you can save changes without your server listing needing to go through staff review again."
    },
    unchangedResubmit: "Please correct the issues mentioned in the staff review feedback before resubmitting for new review.",
    reviewFeedback: {
      title: "Review feedback",
      suspended: "Staff suspended this listing. It cannot be edited or resubmitted from this page.",
      hiddenOffline: "This listing was hidden after extended downtime. Update the details once the server is reachable, then resubmit for review.",
      fallback: "Staff needs changes before this listing can be approved."
    },
    status: {
      pending: "Your server is waiting for staff review.",
      approved: "Your server is approved and visible on the public server list.",
      rejected: "This listing needs changes before staff can approve it.",
      suspended: "This listing is suspended. Contact staff if you believe it should be reviewed again.",
      hidden_offline: "This approved listing is hidden because it has been offline for an extended period. You can submit corrected details for staff review.",
      fallback: "This listing is tied to your Discord account."
    },
    notifications: {
      approvedTitle: "Listing approved",
      pendingTitle: "Review pending",
      feedbackTitle: "Review feedback"
    },
    toasts: {
      noChangesMade: {
        title: "No Changes Made",
        message: "Please correct the issues mentioned in the staff review feedback before resubmitting for new review."
      },
      noChangesToSave: {
        title: "No Changes to Save",
        message: "Your server details are already up to date."
      },
      noPublicChangesToSave: {
        title: "No Changes To Save",
        message: "Your server details are already up to date."
      },
      submitting: {
        reviewTitle: "Submitting for Review",
        saveTitle: "Saving Changes",
        reviewMessage: "Sending your server listing to staff review.",
        saveMessage: "Saving your public server details."
      },
      success: {
        suspendedTitle: "Submission Suspended",
        submittedTitle: "Submitted for Review",
        savedTitle: "Changes Saved",
        suspendedMessage: "This server address is suspended and cannot be sent to staff for review.",
        submittedMessage: "Staff will review your submission before it appears on the public server list.",
        savedMessage: "Your public server details were saved."
      },
      failure: {
        submissionTitle: "Submission Failed",
        saveTitle: "Save Failed",
        submissionMessage: "Submission failed.",
        saveMessage: "Unable to save changes.",
        deleteTitle: "Delete failed",
        deleteMessage: "Unable to delete submission."
      }
    },
    disabledReasons: {
      suspended: "Suspended submissions cannot be edited or resubmitted.",
      pending: "Server details can't be edited while the submission is on staff review."
    },
    deleteConfirm: "Are you sure you want to delete your server submission? This cannot be undone.",
    dashboardUnavailableTitle: "Submission dashboard is unavailable.",
    dashboardUnavailableMessage: "Please try again soon.",
    loadStatusError: "Unable to check submission status."
  }
};

const truncateText = (value, maxLength) => {
  const text = String(value ?? "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

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

const titleCase = (value) => String(value ?? "unknown")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const reviewStatusLabel = (server) => ({
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
  hidden_offline: "Hidden"
})[server.reviewStatus] ?? "Updated";

const reviewDateStat = (server, columnClass = "col") => {
  const fallbackDate = server.reviewStatus === "approved"
    ? server.approvedAt
    : server.reviewStatus === "suspended"
      ? server.suspendedAt
      : server.updatedAt;

  return serverStatTemplate(
    reviewStatusLabel(server),
    formatDate(server.review?.createdAt ?? fallbackDate),
    "fa-solid fa-stamp",
    columnClass
  );
};

const serverStatusBlock = (status) => {
  const wrap = document.createElement("span");
  wrap.className = "server-status-stack d-inline-flex flex-column align-items-center flex-shrink-0 gap-1";

  const pill = document.createElement("span");
  pill.className = `server-status d-inline-flex align-items-center gap-1 px-2 py-1 rounded-2 ${status?.online ? "server-status-online" : "server-status-offline"}`;
  pill.textContent = status?.online ? "Online" : "Offline";

  const checked = document.createElement("small");
  checked.className = "server-status-checked text-lowercase";
  checked.textContent = checkedAgoLabel(status);

  wrap.append(pill, checked);
  return wrap;
};

const reviewStatusPill = (server) => {
  const review = document.createElement("span");
  review.className = "server-admin-review-status d-inline-flex align-items-center px-2 py-1 rounded-2";
  review.textContent = titleCase(server.reviewStatus);
  return review;
};

const serverCardTemplate = (server) => {
  const card = document.createElement("article");
  card.className = "server-card d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3";

  const top = document.createElement("div");
  top.className = "server-card-top d-flex align-items-center gap-3";

  const iconFrame = document.createElement("div");
  iconFrame.className = "server-icon-frame d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden rounded-2";

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
  iconFrame.append(icon);

  const titleWrap = document.createElement("div");
  titleWrap.className = "server-card-main d-flex flex-column justify-content-center flex-grow-1 gap-2 min-w-0";

  const titleRow = document.createElement("div");
  titleRow.className = "server-title-row d-flex align-items-start justify-content-between gap-2";

  const identity = document.createElement("div");
  identity.className = "server-card-identity d-flex flex-column gap-2 flex-grow-1 min-w-0";

  const title = document.createElement("h3");
  title.className = "server-card-title mb-0 text-truncate";
  title.textContent = server.name;

  const address = document.createElement("button");
  address.className = "btn btn-site server-address d-inline-flex align-items-center gap-2 overflow-hidden text-start text-nowrap";
  address.type = "button";
  address.dataset.copyServerAddress = server.address;
  address.setAttribute("aria-label", `Copy server address ${server.address}`);

  const addressIcon = document.createElement("i");
  addressIcon.className = "fa-regular fa-copy";
  addressIcon.setAttribute("aria-hidden", "true");

  const addressLabel = document.createElement("span");
  addressLabel.className = "server-address-label flex-shrink-0";
  addressLabel.textContent = "IP:";

  const addressText = document.createElement("span");
  addressText.className = "server-address-value text-truncate";
  addressText.textContent = server.address;

  address.append(addressLabel, addressText, addressIcon);

  identity.append(title, address);
  titleRow.append(identity, serverStatusBlock(server.status));
  titleWrap.append(titleRow);
  top.append(iconFrame, titleWrap);

  const description = document.createElement("p");
  description.className = "server-description flex-grow-1 mb-0";
  description.textContent = truncateText(server.description, SUBMISSION_DESCRIPTION_LIMIT);
  if ((server.description ?? "").length > SUBMISSION_DESCRIPTION_LIMIT) {
    description.title = server.description;
  }

  const meta = document.createElement("div");
  meta.className = "server-stats row g-2";
  const players = playerCountLabel(server.status);
  const version = versionLabel(server.status);
  meta.append(
    serverStatTemplate("Players", players, "fa-solid fa-user-group"),
    serverStatTemplate("Version", version, "fa-solid fa-code-branch")
  );

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2 mt-3";
  appendServerLink(links, server.websiteUrl, "Website", "website");
  (server.socialLinks ?? []).forEach((link) => appendServerLink(links, link.url, link.label, link.key));

  const bottom = document.createElement("div");
  bottom.className = "server-card-bottom mt-auto min-w-0";
  bottom.append(meta);

  if (links.childElementCount > 0) {
    bottom.append(links);
  }

  card.append(top, description, bottom);

  return card;
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

const versionLabel = (status) => status?.online === false ? "-" : status?.version || "Version unknown";

const serverStatTemplate = (label, value, iconClass, columnClass = "col-6") => {
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

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  const input = document.createElement("textarea");
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
    if (document.execCommand("copy")) {
      return true;
    }
  } finally {
    input.remove();
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  return false;
};

const resetCopiedAddress = (button, value) => {
  button.classList.remove("is-copied");
  button.setAttribute("aria-label", `Copy server address ${value}`);
};

const appendServerLink = (container, url, label, key = "") => {
  if (!url) {
    return;
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
  container.append(link);
};

const skeletonBlock = (className) => {
  const block = document.createElement("span");
  block.className = `server-skeleton ${className}`.trim();
  return block;
};

const serverCardSkeleton = () => {
  const column = document.createElement("div");
  column.className = "col d-flex";

  const card = document.createElement("article");
  card.className = "server-card server-card-skeleton d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3";

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

const setLoadingSkeleton = (container, count = 4) => {
  container.replaceChildren();
  container.setAttribute("aria-busy", "true");

  const row = document.createElement("div");
  row.className = "servers-skeleton row row-cols-1 row-cols-md-2 g-3";
  row.setAttribute("aria-hidden", "true");

  for (let index = 0; index < count; index += 1) {
    row.append(serverCardSkeleton());
  }

  container.append(row);
};

const setState = (container, title, message = "", kind = "", icon = "fa-server") => {
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

const emptyDirectoryState = ({ mode = "paged", status = "all", counts = {} } = {}) => {
  if (mode === "recent") {
    return SERVER_MESSAGES.directory.noApproved;
  }

  const allCount = Number(counts.all ?? 0);
  const onlineCount = Number(counts.online ?? 0);
  const offlineCount = Number(counts.offline ?? 0);

  if (allCount === 0) {
    return SERVER_MESSAGES.directory.noApproved;
  }

  if (status === "online") {
    return {
      title: SERVER_MESSAGES.directory.noOnline.title,
      message: SERVER_MESSAGES.directory.noOnline.message({ offlineCount, allCount }),
      icon: SERVER_MESSAGES.directory.noOnline.icon
    };
  }

  if (status === "offline") {
    return {
      title: SERVER_MESSAGES.directory.noOffline.title,
      message: SERVER_MESSAGES.directory.noOffline.message({ onlineCount, allCount }),
      icon: SERVER_MESSAGES.directory.noOffline.icon
    };
  }

  return SERVER_MESSAGES.directory.noFilterMatch;
};

const renderServers = (container, items, context = {}) => {
  container.replaceChildren();
  container.removeAttribute("aria-busy");

  if (!items.length) {
    const state = emptyDirectoryState(context);
    setState(container, state.title, state.message, "", state.icon);
    return;
  }

  const row = document.createElement("div");
  row.className = "row row-cols-1 row-cols-md-2 g-3";
  items.forEach((server) => {
    const column = document.createElement("div");
    column.className = "col d-flex";
    column.append(serverCardTemplate(server));
    row.append(column);
  });
  container.append(row);
};

const fetchServers = async ({ apiBase, mode, page = 1, limit = 12, status = "all", sort = DEFAULT_SORT }) => {
  const origin = apiBase || window.location.origin;
  const url = mode === "recent"
    ? new URL("/api/servers/recent", origin)
    : new URL("/api/servers", origin);

  url.searchParams.set("limit", String(limit));

  if (mode !== "recent") {
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", status);
    url.searchParams.set("sort", sort);
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error("Server listings request failed.");
  }

  return response.json();
};

const cleanPageNumber = (value) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
};

const cleanStatus = (value) => STATUS_FILTERS.has(value) ? value : "online";

const cleanSort = (value) => SORT_OPTIONS.has(value) ? value : DEFAULT_SORT;

const directoryBasePath = () => window.location.pathname === "/servers" || window.location.pathname.startsWith("/servers/")
  ? "/servers"
  : "";

const directoryPath = (status, page, sort = DEFAULT_SORT) => {
  const basePath = directoryBasePath();
  const segments = [];

  if (status !== "online") {
    segments.push(status);
  }

  if (sort !== DEFAULT_SORT) {
    segments.push("sort", sort);
  }

  if (page > 1) {
    segments.push("page", String(page));
  }

  const path = [basePath, ...segments].filter(Boolean).join("/");
  return path ? `/${path.replace(/^\/+/, "")}` : "/";
};

const readDirectoryStateFromUrl = () => {
  const segments = window.location.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);

  if (segments[0] === "servers") {
    segments.shift();
  }

  let status = "online";
  let page = 1;
  let sort = cleanSort(new URLSearchParams(window.location.search).get("sort"));

  if (segments[0] === "all" || segments[0] === "online" || segments[0] === "offline") {
    status = segments.shift() ?? "online";
  }

  if (segments[0] === "sort") {
    segments.shift();
    sort = cleanSort(segments.shift());
  }

  if (segments[0] === "page") {
    page = cleanPageNumber(segments[1]);
  }

  return { page, status, sort };
};

const updateFilterControls = (filters, status, sort = DEFAULT_SORT) => {
  filters?.querySelectorAll("[data-server-filter]").forEach((filter) => {
    const filterStatus = filter instanceof HTMLElement ? filter.dataset.serverFilter ?? "all" : "all";
    const active = filterStatus === status;
    filter.classList.toggle("is-active", active);
    if (filter instanceof HTMLAnchorElement) {
      filter.href = directoryPath(filterStatus, 1, sort);
    }
    if (active) {
      filter.setAttribute("aria-current", "page");
    } else {
      filter.removeAttribute("aria-current");
    }
  });
};

const updateSortControl = (control, sort) => {
  if (control instanceof HTMLSelectElement) {
    control.value = cleanSort(sort);
  }
};

const renderPagination = (pagination, currentPage, totalPages, status, sort = DEFAULT_SORT) => {
  if (!pagination) {
    return;
  }

  pagination.replaceChildren();

  if (totalPages <= 1) {
    return;
  }

  const createLink = (label, page, disabled = false, current = false, iconClass = "", iconAfter = false) => {
    const link = document.createElement(disabled ? "span" : "a");
    link.className = `btn btn-site d-inline-flex align-items-center justify-content-center gap-2${disabled ? " disabled" : ""}`;
    if (current) {
      link.setAttribute("aria-current", "page");
    }

    const labelNode = document.createTextNode(label);
    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.setAttribute("aria-hidden", "true");
      link.append(...(iconAfter ? [labelNode, icon] : [icon, labelNode]));
    } else {
      link.append(labelNode);
    }

    if (disabled) {
      link.setAttribute("aria-disabled", "true");
    } else {
      link.href = directoryPath(status, page, sort);
    }

    return link;
  };

  pagination.append(createLink("Previous", Math.max(1, currentPage - 1), currentPage === 1, false, "fa-solid fa-chevron-left"));

  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      pagination.append(createLink(String(page), page, false, page === currentPage));
    } else if (Math.abs(page - currentPage) === 2) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "servers-pagination-ellipsis";
      ellipsis.textContent = "...";
      pagination.append(ellipsis);
    }
  }

  pagination.append(createLink("Next", Math.min(totalPages, currentPage + 1), currentPage === totalPages, false, "fa-solid fa-chevron-right", true));
};

  const initServerLists = () => {
  document.querySelectorAll("[data-server-list]").forEach((container) => {
    const mode = container.dataset.serverMode ?? "recent";
    const initialState = mode === "recent" ? { page: 1, status: "all" } : readDirectoryStateFromUrl();
    const page = initialState.page;
    const status = initialState.status;
    const sort = cleanSort(initialState.sort ?? DEFAULT_SORT);
    const apiBase = container.dataset.serverApiBase ?? "";
    const limit = Number(container.dataset.serverLimit ?? String(PAGE_SIZE_DEFAULT));
    const pagination = document.querySelector("[data-server-pagination]");
    const filters = document.querySelector("[data-server-filters]");
    const sortControl = document.querySelector("[data-server-sort]");

    const load = async () => {
      setLoadingSkeleton(container, Math.max(1, Math.min(limit, 8)));

      try {
        const data = await fetchServers({ apiBase, mode, page, limit, status, sort });

        if (mode !== "recent" && page > (data.totalPages ?? 1)) {
          window.location.replace(directoryPath(status, data.totalPages ?? 1, data.sort ?? sort));
          return;
        }

        renderServers(container, data.items ?? [], {
          mode,
          status,
          counts: data.counts ?? {}
        });

        if (mode !== "recent") {
          updateSortControl(sortControl, data.sort ?? sort);
          updateFilterControls(filters, status, data.sort ?? sort);
          renderPagination(pagination, data.page ?? page, data.totalPages ?? 1, status, data.sort ?? sort);
        }

      } catch {
        setState(container, SERVER_MESSAGES.directory.unavailable.title, SERVER_MESSAGES.directory.unavailable.message, "servers-state-error", "fa-triangle-exclamation");
      }
    };

    if (mode !== "recent") {
      updateFilterControls(filters, status, sort);
      updateSortControl(sortControl, sort);
      sortControl?.addEventListener("change", () => {
        const nextSort = cleanSort(sortControl instanceof HTMLSelectElement ? sortControl.value : DEFAULT_SORT);
        window.location.href = directoryPath(status, 1, nextSort);
      });
    }

    load();
  });
};

const initServerSubmit = () => {
  const root = document.querySelector("[data-server-submit-dashboard]");

  if (!(root instanceof HTMLElement)) {
    return;
  }

  const apiBase = root.dataset.serverApiBase || window.location.origin;
  const turnstileSiteKey = root.dataset.turnstileSiteKey || "";
  const isLocalBuild = root.dataset.localBuild === "true";
  const serversUrl = root.dataset.serversUrl || "/servers";
  const submitSection = root.closest(".servers-submit");
  let currentState = null;

  const apiUrl = (path) => new URL(path, apiBase);
  const currentReturnPath = () => `${window.location.pathname}${window.location.search}`;

  const replaceRoot = (...nodes) => {
    root.removeAttribute("aria-busy");
    root.replaceChildren(...nodes);
  };

  const setSubmitView = (view) => {
    submitSection?.classList.toggle("is-logged-out", view === "logged-out");
  };

  const initTooltips = (container) => {
    container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
      Tooltip.getOrCreateInstance(element, {
        container: "body",
        customClass: "comparison-tooltip",
        trigger: "hover focus click"
      });
    });
  };

  const ensureToastContainer = () => {
    let container = document.querySelector("[data-server-submit-toast-container]");

    if (container instanceof HTMLElement) {
      return container;
    }

    container = document.createElement("div");
    container.className = "toast-container position-fixed bottom-0 end-0 p-3 server-submit-toast-container";
    container.dataset.serverSubmitToastContainer = "";
    document.body.append(container);
    return container;
  };

  const toastIconClass = (kind) => ({
    "is-success": "fa-solid fa-circle-check",
    "is-error": "fa-solid fa-triangle-exclamation",
    "is-warning": "fa-solid fa-clock"
  })[kind] || "fa-solid fa-circle-info";

  const showToast = ({ title, message, kind = "", autohide = true, delay = 6000 }) => {
    const container = ensureToastContainer();
    const toastNode = document.createElement("div");
    toastNode.className = `toast server-submit-toast ${kind}`.trim();
    toastNode.style.setProperty("--server-submit-toast-delay", `${delay}ms`);
    toastNode.setAttribute("role", kind === "is-error" ? "alert" : "status");
    toastNode.setAttribute("aria-live", kind === "is-error" ? "assertive" : "polite");
    toastNode.setAttribute("aria-atomic", "true");
    if (autohide) {
      toastNode.classList.add("is-autohide");
    }

    const header = document.createElement("div");
    header.className = "toast-header server-submit-toast-header";

    const icon = document.createElement("i");
    icon.className = `${toastIconClass(kind)} me-2`;
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
    progress.className = "server-submit-toast-progress";
    progress.setAttribute("aria-hidden", "true");
    ["top", "right", "bottom"].forEach((edge) => {
      const segment = document.createElement("span");
      segment.className = `server-submit-toast-progress-edge is-${edge}`;
      progress.append(segment);
    });

    header.append(icon, heading, close);
    toastNode.append(header, body, progress);
    container.append(toastNode);

    const toast = Toast.getOrCreateInstance(toastNode, { autohide, delay });
    if (autohide) {
      const pauseProgress = () => toastNode.classList.add("is-progress-paused");
      const resumeProgress = () => toastNode.classList.remove("is-progress-paused");
      toastNode.addEventListener("mouseover", pauseProgress);
      toastNode.addEventListener("mouseout", resumeProgress);
      toastNode.addEventListener("focusin", pauseProgress);
      toastNode.addEventListener("focusout", resumeProgress);
    }
    toastNode.addEventListener("hidden.bs.toast", () => {
      toast.dispose();
      toastNode.remove();
    }, { once: true });
    toast.show();
    return { node: toastNode, toast };
  };

  const dismissToast = (handle) => {
    if (handle?.node?.isConnected) {
      handle.toast.hide();
    }
  };

  const statePanel = (title, message, iconClass = "fa-brands fa-discord", kind = "") => {
    const panel = document.createElement("div");
    panel.className = `servers-state d-flex flex-column align-items-center justify-content-center text-center gap-2 p-4 rounded-2 ${kind}`.trim();

    const icon = document.createElement("i");
    icon.className = `servers-state-icon d-inline-flex align-items-center justify-content-center ${iconClass}`;
    icon.setAttribute("aria-hidden", "true");

    const heading = document.createElement("strong");
    heading.textContent = title;
    panel.append(icon, heading);

    if (message) {
      const text = document.createElement("span");
      text.textContent = message;
      panel.append(text);
    }

    return panel;
  };

  const createSubmitLoadingSkeleton = () => {
    const shell = document.createElement("div");
    shell.className = "server-submit-loading d-flex flex-column gap-4";
    shell.setAttribute("aria-hidden", "true");

    const account = document.createElement("section");
    account.className = "server-submit-account d-flex align-items-center gap-3 rounded-3";

    const accountText = document.createElement("span");
    accountText.className = "server-skeleton-stack d-grid gap-2 flex-grow-1 min-w-0";
    accountText.append(skeletonBlock("server-skeleton-line server-skeleton-title"), skeletonBlock("server-skeleton-line server-skeleton-short"));
    account.append(skeletonBlock("server-skeleton-avatar flex-shrink-0"), accountText);

    const section = document.createElement("section");
    section.className = "server-submit-section d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    section.append(
      skeletonBlock("server-skeleton-line server-skeleton-heading"),
      skeletonBlock("server-skeleton-line"),
      skeletonBlock("server-skeleton-line"),
      skeletonBlock("server-skeleton-box")
    );

    shell.append(account, section);
    return shell;
  };

  const renderSubmitLoading = () => {
    root.setAttribute("aria-busy", "true");
    root.replaceChildren(createSubmitLoadingSkeleton());
  };


  const createAccountBar = (user) => {
    const bar = document.createElement("div");
    bar.className = "server-submit-account d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-3 rounded-3";

    const identity = document.createElement("div");
    identity.className = "d-flex align-items-center gap-3 min-w-0";

    const avatar = document.createElement("span");
    avatar.className = "server-submit-avatar d-inline-flex align-items-center justify-content-center flex-shrink-0 rounded-2 overflow-hidden";

    if (user?.avatarUrl) {
      const image = document.createElement("img");
      image.src = user.avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      avatar.append(image);
    } else {
      const icon = document.createElement("i");
      icon.className = "fa-brands fa-discord";
      icon.setAttribute("aria-hidden", "true");
      avatar.append(icon);
    }

    const text = document.createElement("div");
    text.className = "d-grid gap-1 min-w-0";

    const label = document.createElement("span");
    label.className = "server-stat-label";
    label.textContent = "Signed in with Discord";

    const name = document.createElement("strong");
    name.className = "server-submit-account-name text-truncate";
    name.textContent = user?.displayName || user?.username || "Discord member";

    text.append(label, name);
    identity.append(avatar, text);

    const logout = document.createElement("button");
    logout.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    logout.type = "button";
    logout.innerHTML = '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Sign Out';
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include", headers: { accept: "application/json" } }).catch(() => null);
      load();
    });

    bar.append(identity, logout);
    return bar;
  };

  const renderLoggedOut = () => {
    setSubmitView("logged-out");
    const panel = document.createElement("div");
    panel.className = "server-submit-login text-center";

    const process = document.createElement("div");
    process.className = "server-submit-process feature-band";
    SERVER_MESSAGES.submit.loggedOutSteps.forEach((step) => {
      const column = document.createElement("article");
      column.className = "server-submit-process-column";

      const card = document.createElement("div");
      card.className = "feature server-submit-process-step text-center h-100 rounded-3";
      card.style.minHeight = "auto";

      const icon = document.createElement("i");
      icon.className = `feature-icon ${step.icon}`;
      icon.setAttribute("aria-hidden", "true");

      const title = document.createElement("h2");
      title.className = "server-submit-process-title mb-0";
      title.textContent = step.title;

      const text = document.createElement("p");
      text.textContent = step.text;

      card.append(icon, title, text);
      column.append(card);
      process.append(column);
    });

    const actions = document.createElement("div");
    actions.className = "error-actions d-flex flex-wrap justify-content-center gap-3";

    const login = document.createElement("a");
    login.className = "btn btn-site btn-discord d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    const loginUrl = apiUrl("/api/auth/discord/login");
    loginUrl.searchParams.set("returnTo", currentReturnPath());
    login.href = loginUrl.toString();
    login.innerHTML = '<i class="fa-brands fa-discord" aria-hidden="true"></i> Continue with Discord';

    const back = document.createElement("a");
    back.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    back.href = serversUrl;
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';

    actions.append(login, back);
    panel.append(process, actions);
    replaceRoot(panel);
  };

  const socialValue = (item, key) => item?.socialLinks?.find((link) => link.key === key)?.url ?? "";

  const socialValues = (item) => ({
    discord: socialValue(item, "discord"),
    facebook: socialValue(item, "facebook"),
    instagram: socialValue(item, "instagram"),
    x: socialValue(item, "x"),
    youtube: socialValue(item, "youtube")
  });

  const ownerHost = (item) => item?.host || String(item?.address || "").split(":")[0] || "";
  const ownerPort = (item) => Number(item?.port || (String(item?.address || "").includes(":") ? String(item.address).split(":").at(-1) : 25565)) || 25565;

  const comparableValue = (value) => String(value ?? "").trim();

  const publicSnapshot = (item) => ({
    description: comparableValue(item?.description),
    websiteUrl: comparableValue(item?.websiteUrl),
    ...socialValues(item)
  });

  const identitySnapshot = (item) => ({
    name: comparableValue(item?.name),
    address: comparableValue(ownerHost(item)).toLowerCase(),
    port: String(ownerPort(item) || 25565)
  });

  const field = (name, label, options = {}) => {
    const wrap = document.createElement("div");
    wrap.className = options.column || "col-md-6";

    const floating = document.createElement("div");
    floating.className = `form-floating server-submit-floating ${options.icon ? "server-submit-floating-icon" : ""} ${options.counter ? "server-submit-floating-counted" : ""}`.trim();

    if (options.icon) {
      const iconWrap = document.createElement("span");
      iconWrap.className = "server-submit-field-icon d-inline-flex align-items-center justify-content-center";
      const icon = document.createElement("i");
      icon.className = options.icon;
      icon.setAttribute("aria-hidden", "true");
      iconWrap.append(icon);
      floating.append(iconWrap);
    }

    const control = options.textarea ? document.createElement("textarea") : document.createElement("input");
    if (!options.textarea) {
      control.type = options.type || "text";
    }
    control.className = `form-control ${options.className || ""}`.trim();
    control.id = `server-${name}`;
    control.name = name;
    control.maxLength = options.maxLength || 255;
    control.required = Boolean(options.required);
    control.value = options.value || "";

    control.placeholder = options.placeholder || label;

    if (options.minLength) {
      control.minLength = options.minLength;
    }

    if (options.rows) {
      control.rows = options.rows;
    }

    if (options.inputMode) {
      control.inputMode = options.inputMode;
    }

    if (options.autocomplete) {
      control.autocomplete = options.autocomplete;
    }

    if (options.disabled) {
      control.disabled = true;
    }

    const labelNode = document.createElement("label");
    labelNode.htmlFor = `server-${name}`;
    labelNode.textContent = label;

    floating.append(control, labelNode);

    if (options.counter) {
      const counter = document.createElement("span");
      counter.className = "server-submit-counter";
      const maxLength = Number(control.maxLength || options.maxLength || 0);
      const updateCounter = () => {
        counter.textContent = `${control.value.length}/${maxLength}`;
      };
      control.addEventListener("input", updateCounter);
      updateCounter();
      floating.append(counter);
    }
    wrap.append(floating);

    if (options.help) {
      const help = document.createElement("p");
      help.className = "form-text";
      help.textContent = options.help;
      wrap.append(help);
    }

    return wrap;
  };

  const parseAddressPort = (value) => {
    const trimmed = String(value ?? "").trim();

    if (!trimmed.includes(":")) {
      return null;
    }

    try {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
        const parsed = new URL(trimmed);
        const port = Number(parsed.port || "25565");
        return parsed.hostname && Number.isInteger(port) && port >= 1 && port <= 65535
          ? { host: parsed.hostname, port: String(port) }
          : null;
      }
    } catch {
      return null;
    }

    const match = trimmed.match(/^\[?([^\]]+)\]?:([0-9]{1,5})$/);
    if (!match) {
      return null;
    }

    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }

    return { host: match[1], port: String(port) };
  };

  const createAddressPortGroup = (item = null) => {
    const wrap = document.createElement("div");
    wrap.className = "col-md-6";

    const group = document.createElement("div");
    group.className = "input-group server-submit-address-group";

    const hostFloating = document.createElement("div");
    hostFloating.className = "form-floating server-submit-floating server-submit-address-host";
    const host = document.createElement("input");
    host.className = "form-control";
    host.id = "server-address";
    host.name = "address";
    host.required = true;
    host.maxLength = 255;
    host.autocomplete = "off";
    host.placeholder = "play.example.com";
    host.value = ownerHost(item);
    const hostLabel = document.createElement("label");
    hostLabel.htmlFor = "server-address";
    hostLabel.textContent = "Server address";
    hostFloating.append(host, hostLabel);

    const separator = document.createElement("span");
    separator.className = "input-group-text server-submit-address-separator";
    separator.textContent = ":";

    const portFloating = document.createElement("div");
    portFloating.className = "form-floating server-submit-floating server-submit-address-port";
    const port = document.createElement("input");
    port.className = "form-control";
    port.id = "server-port";
    port.name = "port";
    port.type = "number";
    port.inputMode = "numeric";
    port.min = "1";
    port.max = "65535";
    port.maxLength = 5;
    port.placeholder = "25565";
    port.value = item ? String(ownerPort(item)) : "";
    const portLabel = document.createElement("label");
    portLabel.htmlFor = "server-port";
    portLabel.textContent = "Port";
    portFloating.append(port, portLabel);

    const movePort = () => {
      const parsed = parseAddressPort(host.value);
      if (!parsed) {
        return;
      }

      host.value = parsed.host;
      port.value = parsed.port;
      host.dispatchEvent(new Event("input", { bubbles: true }));
      port.dispatchEvent(new Event("input", { bubbles: true }));
    };

    host.addEventListener("paste", () => window.setTimeout(movePort, 0));
    host.addEventListener("change", movePort);

    group.append(hostFloating, separator, portFloating);
    wrap.append(group);
    return wrap;
  };

  const createSubmitSection = (title, ...children) => {
    const section = document.createElement("section");
    section.className = "server-submit-section d-flex flex-column gap-3 p-3 p-md-4 rounded-3";

    const heading = document.createElement("h2");
    heading.className = "server-submit-section-title mb-0";
    heading.textContent = title;

    const row = document.createElement("div");
    row.className = "row g-3";
    row.append(...children);

    section.append(heading, row);
    return section;
  };

  const appendPublicFields = (row, item = null) => {
    const social = socialValues(item);
    row.append(
      field("websiteUrl", "Website", { maxLength: 255, inputMode: "url", value: item?.websiteUrl, placeholder: "kingdomsx.example.com", icon: SOCIAL_ICON_CLASSES.website }),
      field("discord", "Discord", { maxLength: 255, value: social.discord, placeholder: "discord.gg/invite or invite-code", icon: SOCIAL_ICON_CLASSES.discord }),
      field("facebook", "Facebook", { maxLength: 255, value: social.facebook, placeholder: "@page or facebook.com/page", icon: SOCIAL_ICON_CLASSES.facebook }),
      field("instagram", "Instagram", { maxLength: 255, value: social.instagram, placeholder: "@username", icon: SOCIAL_ICON_CLASSES.instagram }),
      field("x", "Twitter/X", { maxLength: 255, value: social.x, placeholder: "@username", icon: SOCIAL_ICON_CLASSES.x }),
      field("youtube", "YouTube", { maxLength: 255, value: social.youtube, placeholder: "@handle or youtube.com/@handle", icon: SOCIAL_ICON_CLASSES.youtube })
    );
  };

  const publicDetailsPayload = (form) => {
    const formData = new FormData(form);

    return {
      description: String(formData.get("description") ?? ""),
      websiteUrl: String(formData.get("websiteUrl") ?? ""),
      socialLinks: {
        discord: String(formData.get("discord") ?? ""),
        facebook: String(formData.get("facebook") ?? ""),
        instagram: String(formData.get("instagram") ?? ""),
        x: String(formData.get("x") ?? ""),
        youtube: String(formData.get("youtube") ?? "")
      }
    };
  };

  const submissionPayload = (form) => {
    const formData = new FormData(form);

    return {
      name: String(formData.get("name") ?? ""),
      address: String(formData.get("address") ?? ""),
      port: String(formData.get("port") ?? ""),
      ...publicDetailsPayload(form),
      proof: String(formData.get("proof") ?? ""),
      turnstileToken: String(formData.get("cf-turnstile-response") ?? "")
    };
  };

  const renderTurnstile = (form) => {
    const widget = form.querySelector("[data-submit-turnstile]");

    if (!widget || widget.dataset.rendered === "true" || !window.turnstile?.render) {
      if (widget && widget.dataset.rendered !== "true") {
        window.setTimeout(() => renderTurnstile(form), 250);
      }
      return;
    }

    window.turnstile.render(widget, {
      sitekey: turnstileSiteKey,
      action: "server-submit",
      theme: "dark"
    });
    widget.dataset.rendered = "true";
  };

  const renderTurnstileField = () => {
    const wrap = document.createElement("div");
    wrap.className = "server-submit-verification d-flex justify-content-center";

    if (turnstileSiteKey) {
      const widget = document.createElement("div");
      widget.dataset.submitTurnstile = "";
      wrap.append(widget);
      return wrap;
    }

    const alert = document.createElement("div");
    alert.className = "w-100";
    const message = document.createElement("p");
    message.className = "servers-alert mb-0";
    message.textContent = SERVER_MESSAGES.submit.protectionMissing;
    alert.append(message);
    wrap.append(alert);
    return wrap;
  };

  const submitButtonLabel = (mode, needsReview = mode !== "edit") => {
    if (mode === "new") {
      return "Submit for Review";
    }

    if (mode === "resubmit") {
      return "Resubmit for Review";
    }

    return needsReview ? "Submit for Review" : "Save Changes";
  };

  const renderForm = (mode, item = null) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-form-shell d-flex flex-column gap-4";

    if (currentState?.user) {
      panel.append(createAccountBar(currentState.user));
    }

    if (item?.rejectionReason) {
      panel.append(createNotificationArea([notificationFromItem(item)]));
    }

    const form = document.createElement("form");
    form.className = "server-submit-form d-flex flex-column gap-4";
    form.noValidate = false;
    const baselineIdentity = item ? identitySnapshot(item) : null;
    const baselinePublic = item ? publicSnapshot(item) : null;
    const baselineProof = mode === "edit" ? "" : comparableValue(item?.submission?.proofRedacted);

    const identity = createSubmitSection(
      "Server Information",
      field("name", "Server name", { required: true, maxLength: 80, autocomplete: "organization", value: item?.name, placeholder: "KingdomsX Realm" }),
      createAddressPortGroup(item),
      field("description", "Description", {
        column: "col-12",
        textarea: true,
        rows: 4,
        required: true,
        minLength: 40,
        maxLength: SUBMISSION_DESCRIPTION_LIMIT,
        value: item?.description,
        placeholder: "Describe the server experience in 120 characters or less.",
        counter: true
      })
    );

    const publicFields = document.createElement("div");
    publicFields.className = "row g-3";
    appendPublicFields(publicFields, item);

    const publicSection = document.createElement("section");
    publicSection.className = "server-submit-section d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    const publicTitle = document.createElement("h2");
    publicTitle.className = "server-submit-section-title mb-0";
    publicTitle.textContent = "Website & Socials";
    publicSection.append(publicTitle, publicFields);

    const createProofHelp = () => {
      const proofHelp = document.createElement("p");
      proofHelp.className = "server-submit-proof-help mb-0";
      proofHelp.append(
        SERVER_MESSAGES.submit.proofHelp.beforeCommand,
        (() => {
          const code = document.createElement("code");
          code.textContent = SERVER_MESSAGES.submit.proofHelp.command;
          return code;
        })(),
        SERVER_MESSAGES.submit.proofHelp.afterCommand,
        (() => {
          const strong = document.createElement("strong");
          strong.textContent = SERVER_MESSAGES.submit.proofHelp.emphasis;
          return strong;
        })(),
        SERVER_MESSAGES.submit.proofHelp.afterEmphasis
      );
      return proofHelp;
    };

    const createIdentityChangedNotice = () => {
      const column = document.createElement("div");
      column.className = "col-12";

      const notice = document.createElement("div");
      notice.className = "server-submit-notice is-error d-flex align-items-center gap-3 p-3 rounded-3";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-triangle-exclamation d-inline-flex align-items-center justify-content-center flex-shrink-0";
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";

      const title = document.createElement("strong");
      title.textContent = SERVER_MESSAGES.submit.verificationExpired.title;

      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = SERVER_MESSAGES.submit.verificationExpired.message;

      content.append(title, message);
      notice.append(icon, content);
      column.append(notice);
      return column;
    };

    const createProofHelpColumn = () => {
      const column = document.createElement("div");
      column.className = "col-12";
      column.append(createProofHelp());
      return column;
    };

    const createProofField = () => field("proof", '"/k about all" output', {
      column: "col-12",
      textarea: true,
      rows: 9,
      required: true,
      maxLength: 12000,
      className: "server-proof",
      value: mode === "edit" ? "" : item?.submission?.proofRedacted,
      placeholder: "Paste the complete /k about all console output here."
    });

    const createVerificationComplete = () => {
      const column = document.createElement("div");
      column.className = "col-12";

      const notice = document.createElement("div");
      notice.className = "server-submit-notice is-success d-flex align-items-center gap-3 p-3 rounded-3";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-circle-check d-inline-flex align-items-center justify-content-center flex-shrink-0";
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";

      const title = document.createElement("strong");
      title.textContent = SERVER_MESSAGES.submit.verificationComplete.title;

      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = SERVER_MESSAGES.submit.verificationComplete.message;

      content.append(title, message);
      notice.append(icon, content);
      column.append(notice);
      return column;
    };

    const review = createSubmitSection("Server Verification");
    const reviewRow = review.querySelector(".row");
    const canKeepPreviousVerification = mode === "edit" && item?.reviewStatus === "approved";
    let verificationNeedsReview = !canKeepPreviousVerification;

    const renderVerification = (needsReview) => {
      if (!(reviewRow instanceof HTMLElement)) {
        return;
      }

      verificationNeedsReview = needsReview;
      reviewRow.replaceChildren();

      if (canKeepPreviousVerification && !needsReview) {
        reviewRow.append(createVerificationComplete());
        return;
      }

      reviewRow.append(...(canKeepPreviousVerification ? [createIdentityChangedNotice()] : []), createProofHelpColumn(), createProofField());
    };

    renderVerification(verificationNeedsReview);

    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row align-items-center justify-content-center gap-3";

    const submit = document.createElement("button");
    submit.className = "btn btn-site btn-site-primary d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    submit.type = "submit";
    submit.innerHTML = `<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> ${submitButtonLabel(mode)}`;

    const view = document.createElement("a");
    view.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    view.href = serversUrl;
    view.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';

    if (item) {
      const cancel = document.createElement("button");
      cancel.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      cancel.type = "button";
      cancel.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancel';
      cancel.addEventListener("click", () => renderOwnedState(item));
      actions.append(submit, cancel);
    } else {
      actions.append(submit, view);
    }

    form.append(identity, publicSection, review, renderTurnstileField(), actions);
    panel.append(form);
    replaceRoot(panel);

    if (turnstileSiteKey) {
      renderTurnstile(form);
    }

    const currentIdentitySnapshot = () => {
      const formData = new FormData(form);
      return {
        name: comparableValue(formData.get("name")),
        address: comparableValue(formData.get("address")).toLowerCase(),
        port: comparableValue(formData.get("port") || "25565") || "25565"
      };
    };

    const currentPublicSnapshot = () => {
      const formData = new FormData(form);
      return {
        description: comparableValue(formData.get("description")),
        websiteUrl: comparableValue(formData.get("websiteUrl")),
        discord: comparableValue(formData.get("discord")),
        facebook: comparableValue(formData.get("facebook")),
        instagram: comparableValue(formData.get("instagram")),
        x: comparableValue(formData.get("x")),
        youtube: comparableValue(formData.get("youtube"))
      };
    };

    const hasObjectChanges = (current, baseline) => Boolean(baseline) && Object.keys(current).some((key) => current[key] !== baseline[key]);

    const formHasChanges = () => {
      const proof = form.elements.namedItem("proof");
      const proofChanged = proof instanceof HTMLTextAreaElement && comparableValue(proof.value) !== baselineProof;
      return hasObjectChanges(currentIdentitySnapshot(), baselineIdentity) || hasObjectChanges(currentPublicSnapshot(), baselinePublic) || proofChanged;
    };

    const hasResubmitChanges = () => mode !== "resubmit" || formHasChanges();

    const updateSubmitState = () => {
      const blockedByProtection = !turnstileSiteKey && !isLocalBuild;
      const blockedByUnchangedResubmit = mode === "resubmit" && !hasResubmitChanges();
      submit.disabled = blockedByProtection;
      submit.title = blockedByUnchangedResubmit
        ? SERVER_MESSAGES.submit.unchangedResubmit
        : "";
    };

    const updateProofRequirement = () => {
      if (!baselineIdentity || !canKeepPreviousVerification) {
        return;
      }

      const currentIdentity = currentIdentitySnapshot();
      const needsReview = currentIdentity.name !== baselineIdentity.name || currentIdentity.address !== baselineIdentity.address || currentIdentity.port !== baselineIdentity.port;
      if (needsReview !== verificationNeedsReview) {
        renderVerification(needsReview);
      }

      submit.innerHTML = `<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> ${submitButtonLabel(mode, needsReview)}`;
      updateSubmitState();
    };

    ["name", "address", "port"].forEach((fieldName) => {
      const control = form.elements.namedItem(fieldName);
      if (control instanceof HTMLElement) {
        control.addEventListener("input", updateProofRequirement);
      }
    });
    updateProofRequirement();
    form.addEventListener("input", updateSubmitState);
    form.addEventListener("change", updateSubmitState);
    updateSubmitState();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      if (mode === "resubmit" && !hasResubmitChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noChangesMade.title,
          message: SERVER_MESSAGES.submit.toasts.noChangesMade.message,
          kind: "is-warning"
        });
        updateSubmitState();
        return;
      }

      if (mode === "edit" && !formHasChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noChangesToSave.title,
          message: SERVER_MESSAGES.submit.toasts.noChangesToSave.message,
          kind: "is-success"
        });
        renderOwnedState(item);
        return;
      }

      const payload = submissionPayload(form);
      const currentIdentity = currentIdentitySnapshot();
      const needsReview = mode !== "edit" || !baselineIdentity || currentIdentity.name !== baselineIdentity.name || currentIdentity.address !== baselineIdentity.address || currentIdentity.port !== baselineIdentity.port;

      submit.disabled = true;
      const progressToast = showToast({
        title: needsReview ? SERVER_MESSAGES.submit.toasts.submitting.reviewTitle : SERVER_MESSAGES.submit.toasts.submitting.saveTitle,
        message: needsReview ? SERVER_MESSAGES.submit.toasts.submitting.reviewMessage : SERVER_MESSAGES.submit.toasts.submitting.saveMessage,
        kind: "is-warning",
        autohide: false
      });

      try {
        const response = await fetch(apiUrl(needsReview ? (mode === "new" ? "/api/servers/submit" : "/api/servers/me/resubmit") : "/api/servers/me/details"), {
          method: needsReview ? "POST" : "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(needsReview ? payload : publicDetailsPayload(form))
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || SERVER_MESSAGES.submit.toasts.failure.submissionMessage);
        }

        window.turnstile?.reset?.();
        dismissToast(progressToast);
        const autoSuspended = data.status === "suspended" || data.item?.reviewStatus === "suspended";
        showToast({
          title: autoSuspended ? SERVER_MESSAGES.submit.toasts.success.suspendedTitle : needsReview ? SERVER_MESSAGES.submit.toasts.success.submittedTitle : SERVER_MESSAGES.submit.toasts.success.savedTitle,
          message: autoSuspended
            ? SERVER_MESSAGES.submit.toasts.success.suspendedMessage
            : needsReview
              ? SERVER_MESSAGES.submit.toasts.success.submittedMessage
              : SERVER_MESSAGES.submit.toasts.success.savedMessage,
          kind: autoSuspended ? "is-error" : "is-success"
        });
        load();
      } catch (error) {
        window.turnstile?.reset?.();
        dismissToast(progressToast);
        showToast({
          title: needsReview ? SERVER_MESSAGES.submit.toasts.failure.submissionTitle : SERVER_MESSAGES.submit.toasts.failure.saveTitle,
          message: error instanceof Error ? error.message : SERVER_MESSAGES.submit.toasts.failure.submissionMessage,
          kind: "is-error",
          delay: 6200
        });
      } finally {
        updateSubmitState();
      }
    });
  };

  const createReviewFeedback = (item) => {
    const reason = document.createElement("section");
    reason.className = "server-submit-reason d-flex gap-3 p-3 rounded-3";
    reason.innerHTML = '<i class="fa-solid fa-circle-exclamation flex-shrink-0" aria-hidden="true"></i>';

    const content = document.createElement("div");
    content.className = "d-grid gap-2";
    const title = document.createElement("strong");
    title.textContent = SERVER_MESSAGES.submit.reviewFeedback.title;
    const text = document.createElement("p");
    text.className = "mb-0";
    text.textContent = item?.rejectionReason || ({
      suspended: SERVER_MESSAGES.submit.reviewFeedback.suspended,
      hidden_offline: SERVER_MESSAGES.submit.reviewFeedback.hiddenOffline
    })[item?.reviewStatus] || SERVER_MESSAGES.submit.reviewFeedback.fallback;
    content.append(title, text);
    reason.append(content);
    return reason;
  };

  const notificationFromItem = (item) => ({
    kind: item.reviewStatus === "approved" ? "is-success" : item.reviewStatus === "pending" ? "is-warning" : "is-error",
    icon: item.reviewStatus === "approved" ? "fa-solid fa-circle-check" : item.reviewStatus === "pending" ? "fa-solid fa-clock" : "fa-solid fa-circle-exclamation",
    title: item.reviewStatus === "approved" ? SERVER_MESSAGES.submit.notifications.approvedTitle : item.reviewStatus === "pending" ? SERVER_MESSAGES.submit.notifications.pendingTitle : SERVER_MESSAGES.submit.notifications.feedbackTitle,
    message: item.rejectionReason || statusMessage(item)
  });

  const createNotificationArea = (items) => {
    const area = document.createElement("div");
    area.className = "server-submit-notifications d-flex flex-column gap-3";

    items.filter(Boolean).forEach((item) => {
      const notice = document.createElement("section");
      notice.className = `server-submit-notice d-flex align-items-center gap-3 p-3 rounded-3 ${item.kind || ""}`.trim();

      const icon = document.createElement("i");
      icon.className = `${item.icon || "fa-solid fa-circle-info"} d-inline-flex align-items-center justify-content-center flex-shrink-0`;
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = item.message;
      content.append(title, message);
      notice.append(icon, content);
      area.append(notice);
    });

    return area;
  };

  const createServerSummary = (item, actions = null) => {
    const summary = document.createElement("article");
    summary.className = "server-card server-submit-summary d-flex flex-column gap-3 w-100 p-3 overflow-hidden rounded-3";

    const top = document.createElement("div");
    top.className = "server-card-top d-flex align-items-center gap-3";

    const iconFrame = document.createElement("div");
    iconFrame.className = "server-icon-frame d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden rounded-2";
    const icon = document.createElement("img");
    icon.className = "server-icon w-100 h-100";
    icon.src = item.status?.icon || FALLBACK_SERVER_ICON;
    icon.alt = "";
    icon.loading = "lazy";
    icon.decoding = "async";
    icon.addEventListener("error", () => {
      icon.src = FALLBACK_SERVER_ICON;
    }, { once: true });
    iconFrame.append(icon);

    const titleWrap = document.createElement("div");
    titleWrap.className = "server-card-main d-flex flex-column justify-content-center flex-grow-1 gap-2 min-w-0";
    const titleRow = document.createElement("div");
    titleRow.className = "server-title-row d-flex align-items-start justify-content-between gap-2";
    const identity = document.createElement("div");
    identity.className = "server-card-identity d-flex flex-column gap-2 flex-grow-1 min-w-0";
    const title = document.createElement("h2");
    title.className = "server-card-title mb-0 text-truncate";
    title.textContent = item.name;

    const address = document.createElement("button");
    address.className = "btn btn-site server-address d-inline-flex align-items-center gap-2 overflow-hidden text-start text-nowrap";
    address.type = "button";
    address.dataset.copyServerAddress = item.address;
    address.setAttribute("aria-label", `Copy server address ${item.address}`);
    const addressLabel = document.createElement("span");
    addressLabel.className = "server-address-label flex-shrink-0";
    addressLabel.textContent = "IP:";
    const addressValue = document.createElement("span");
    addressValue.className = "server-address-value text-truncate";
    addressValue.textContent = item.address;
    const addressIcon = document.createElement("i");
    addressIcon.className = "fa-regular fa-copy";
    addressIcon.setAttribute("aria-hidden", "true");
    address.append(addressLabel, addressValue, addressIcon);

    const chips = document.createElement("div");
    chips.className = "server-card-tags d-flex flex-wrap align-items-start justify-content-end gap-2 flex-shrink-0";
    chips.append(serverStatusBlock(item.status), reviewStatusPill(item));

    identity.append(title, address);
    titleRow.append(identity, chips);
    titleWrap.append(titleRow);
    top.append(iconFrame, titleWrap);

    const description = document.createElement("p");
    description.className = "server-description mb-0";
    description.textContent = item.description;

    const stats = document.createElement("div");
    stats.className = "server-stats row g-2";
    stats.append(
      serverStatTemplate("Players", playerCountLabel(item.status), "fa-solid fa-user-group"),
      serverStatTemplate("Version", versionLabel(item.status), "fa-solid fa-code-branch"),
      serverStatTemplate("Submitted", formatDate(item.submission?.createdAt ?? item.createdAt), "fa-solid fa-clock"),
      reviewDateStat(item)
    );

    const links = document.createElement("div");
    links.className = "server-links d-flex flex-wrap gap-2";
    appendServerLink(links, item.websiteUrl, "Website", "website");
    (item.socialLinks ?? []).forEach((link) => {
      appendServerLink(links, link.url, link.host ? `${link.label}: ${link.host}` : link.label, link.key);
    });

    const footer = document.createElement("div");
    footer.className = "server-card-bottom d-flex flex-wrap align-items-center justify-content-between gap-2 mt-auto min-w-0";

    const hasLinks = links.childElementCount > 0;
    if (hasLinks) {
      footer.append(links);
    }

    if (actions instanceof HTMLElement && actions.childElementCount > 0) {
      footer.append(actions);
    }

    if (!hasLinks) {
      footer.classList.remove("justify-content-between");
      footer.classList.add("justify-content-end");
    }

    summary.append(top, description, stats);
    if (footer.childElementCount > 0) {
      summary.append(footer);
    }
    return summary;
  };

  const statusMessage = (item) => SERVER_MESSAGES.submit.status[item.reviewStatus] || SERVER_MESSAGES.submit.status.fallback;

  const renderPublicDetailsForm = (item) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-form-shell d-flex flex-column gap-4";
    panel.append(createAccountBar(currentState.user), createServerSummary(item));

    const form = document.createElement("form");
    form.className = "server-submit-form d-flex flex-column gap-4";
    form.noValidate = false;

    const publicFields = document.createElement("div");
    publicFields.className = "row g-3";
    appendPublicFields(publicFields, item);

    const section = document.createElement("section");
    section.className = "server-submit-section d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    const title = document.createElement("h2");
    title.className = "server-submit-section-title mb-0";
    title.textContent = "Public Details";
    section.append(title, publicFields);

    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row align-items-center gap-3";

    const save = document.createElement("button");
    save.className = "btn btn-site btn-site-primary d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    save.type = "submit";
    save.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Changes';

    const back = document.createElement("button");
    back.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    back.type = "button";
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back';
    back.addEventListener("click", () => renderOwnedState(item));

    actions.append(save, back);
    form.append(section, actions);
    panel.append(form);
    replaceRoot(panel);

    const baselinePublic = publicSnapshot(item);
    const currentPublicSnapshot = () => {
      const formData = new FormData(form);
      return {
        description: comparableValue(formData.get("description")),
        websiteUrl: comparableValue(formData.get("websiteUrl")),
        discord: comparableValue(formData.get("discord")),
        facebook: comparableValue(formData.get("facebook")),
        instagram: comparableValue(formData.get("instagram")),
        x: comparableValue(formData.get("x")),
        youtube: comparableValue(formData.get("youtube"))
      };
    };
    const hasPublicChanges = () => Object.keys(baselinePublic).some((key) => currentPublicSnapshot()[key] !== baselinePublic[key]);
    const updateSaveState = () => {
      save.title = "";
    };

    form.addEventListener("input", updateSaveState);
    form.addEventListener("change", updateSaveState);
    updateSaveState();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      if (!hasPublicChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noPublicChangesToSave.title,
          message: SERVER_MESSAGES.submit.toasts.noPublicChangesToSave.message,
          kind: "is-success"
        });
        renderOwnedState(item);
        return;
      }

      save.disabled = true;
      const progressToast = showToast({
        title: SERVER_MESSAGES.submit.toasts.submitting.saveTitle,
        message: SERVER_MESSAGES.submit.toasts.submitting.saveMessage,
        kind: "is-warning",
        autohide: false
      });

      try {
        const response = await fetch(apiUrl("/api/servers/me/details"), {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(publicDetailsPayload(form))
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || SERVER_MESSAGES.submit.toasts.failure.saveMessage);
        }

        currentState = { ...currentState, item: data.item };
        dismissToast(progressToast);
        showToast({
          title: SERVER_MESSAGES.submit.toasts.success.savedTitle,
          message: SERVER_MESSAGES.submit.toasts.success.savedMessage,
          kind: "is-success"
        });
        window.setTimeout(() => renderOwnedState(data.item), 650);
      } catch (error) {
        dismissToast(progressToast);
        showToast({
          title: SERVER_MESSAGES.submit.toasts.failure.saveTitle,
          message: error instanceof Error ? error.message : SERVER_MESSAGES.submit.toasts.failure.saveMessage,
          kind: "is-error",
          delay: 6200
        });
      } finally {
        save.disabled = false;
      }
    });
  };

  const renderOwnedState = (item) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-owned d-flex flex-column gap-4";
    panel.append(createAccountBar(currentState.user));

    panel.append(createNotificationArea([notificationFromItem(item)]));
    let summary = null;
    const cardActions = document.createElement("div");
    cardActions.className = "server-card-actions d-flex flex-wrap gap-2 ms-sm-auto";

    if (item.canEditPublicDetails) {
      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Edit Server Details';
      edit.addEventListener("click", () => renderForm("edit", item));
      cardActions.append(edit);
    } else if (item.canRequestReview) {
      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.innerHTML = `<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> ${item.reviewStatus === "rejected" ? "Update Details and Resubmit" : "Update Details"}`;
      edit.addEventListener("click", () => renderForm("resubmit", item));
      cardActions.append(edit);
    } else if (item.reviewStatus === "suspended") {
      const tooltipWrap = document.createElement("span");
      tooltipWrap.className = "server-submit-disabled-action d-inline-flex";
      tooltipWrap.tabIndex = 0;
      tooltipWrap.dataset.bsToggle = "tooltip";
      tooltipWrap.dataset.bsPlacement = "top";
      tooltipWrap.dataset.bsTitle = SERVER_MESSAGES.submit.disabledReasons.suspended;

      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.disabled = true;
      edit.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> Update Details and Resubmit';
      tooltipWrap.append(edit);
      cardActions.append(tooltipWrap);
    } else if (item.reviewStatus === "pending") {
      const tooltipWrap = document.createElement("span");
      tooltipWrap.className = "server-submit-disabled-action d-inline-flex";
      tooltipWrap.tabIndex = 0;
      tooltipWrap.dataset.bsToggle = "tooltip";
      tooltipWrap.dataset.bsPlacement = "top";
      tooltipWrap.dataset.bsTitle = SERVER_MESSAGES.submit.disabledReasons.pending;

      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.disabled = true;
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Edit Server Details';
      tooltipWrap.append(edit);
      cardActions.append(tooltipWrap);
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn btn-site btn-site-sm server-submit-delete d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    deleteButton.type = "button";
    deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete Submission';
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(SERVER_MESSAGES.submit.deleteConfirm)) {
        return;
      }

      deleteButton.disabled = true;
      try {
        const response = await fetch(apiUrl("/api/servers/me"), {
          method: "DELETE",
          credentials: "include",
          headers: { accept: "application/json" }
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || SERVER_MESSAGES.submit.toasts.failure.deleteMessage);
        }

        load();
      } catch (error) {
        panel.insertBefore(createNotificationArea([{
          kind: "is-error",
          icon: "fa-solid fa-triangle-exclamation",
          title: SERVER_MESSAGES.submit.toasts.failure.deleteTitle,
          message: error instanceof Error ? error.message : SERVER_MESSAGES.submit.toasts.failure.deleteMessage
        }]), summary);
        deleteButton.disabled = false;
      }
    });
    cardActions.append(deleteButton);

    summary = createServerSummary(item, cardActions);
    panel.append(summary);

    const view = document.createElement("a");
    view.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    view.href = serversUrl;
    view.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';
    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row justify-content-center gap-3";
    actions.append(view);
    panel.append(actions);
    replaceRoot(panel);
    initTooltips(panel);
  };

  const renderAuthenticated = (state) => {
    currentState = state;

    if (!state.item) {
      renderForm("new");
      return;
    }

    renderOwnedState(state.item);
  };

  const load = async () => {
    renderSubmitLoading();

    try {
      const response = await fetch(apiUrl("/api/servers/me"), {
        credentials: "include",
        headers: { accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || SERVER_MESSAGES.submit.loadStatusError);
      }

      if (!data.authenticated) {
        currentState = null;
        renderLoggedOut();
        return;
      }

      renderAuthenticated(data);
    } catch (error) {
      replaceRoot(statePanel(SERVER_MESSAGES.submit.dashboardUnavailableTitle, error instanceof Error ? error.message : SERVER_MESSAGES.submit.dashboardUnavailableMessage, "fa-solid fa-triangle-exclamation", "servers-state-error"));
    }
  };

  load();
};

document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-copy-server-address]") : null;

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const value = button.dataset.copyServerAddress ?? "";

  window.clearTimeout(copyResetTimers.get(button));

  const copied = await copyText(value).catch(() => false);

  if (copied) {
    button.classList.add("is-copied");
    button.setAttribute("aria-label", `Copied server address ${value}`);
    copyResetTimers.set(button, window.setTimeout(() => resetCopiedAddress(button, value), 1800));
  } else {
    resetCopiedAddress(button, value);
  }
});

initServerLists();
initServerSubmit();
