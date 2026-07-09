export const SERVER_DESCRIPTION_LIMIT = 240;

const FALLBACK_SERVER_ICON = "/apple-touch-icon.png";
const numberFormatter = new Intl.NumberFormat();
const copyResetTimers = new WeakMap();

// Drives submit form fields and listing link icons
export const SOCIAL_PLATFORMS = Object.freeze([
  {
    key: "discord",
    label: "Discord",
    icon: "fa-brands fa-discord",
    placeholder: "discord.gg/invite or invite-code",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: "fa-brands fa-facebook-f",
    placeholder: "@page or facebook.com/page",
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: "fa-brands fa-instagram",
    placeholder: "@username",
  },
  { key: "x", label: "Twitter/X", icon: "fa-brands fa-x-twitter", placeholder: "@username" },
  {
    key: "youtube",
    label: "YouTube",
    icon: "fa-brands fa-youtube",
    placeholder: "@handle or youtube.com/@handle",
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: "fa-brands fa-tiktok",
    placeholder: "@username or tiktok.com/@username",
  },
  {
    key: "twitch",
    label: "Twitch",
    icon: "fa-brands fa-twitch",
    placeholder: "username or twitch.tv/username",
  },
]);

const SOCIAL_ICON_CLASSES = Object.freeze({
  website: "fa-solid fa-globe",
  ...Object.fromEntries(SOCIAL_PLATFORMS.map(({ key, icon }) => [key, icon])),
});

const twoDigit = (value) => String(value).padStart(2, "0");

export const truncateServerDescription = (value, max = SERVER_DESCRIPTION_LIMIT) => {
  const text = String(value ?? "").trim();

  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

export const formatDate = (value, { timeSeparator = ", " } = {}) => {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${twoDigit(date.getDate())}/${twoDigit(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`,
  ].join(timeSeparator);
};

export const formatNumber = (value) => numberFormatter.format(value);

export const titleCase = (value) =>
  String(value ?? "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const checkedAgoLabel = (status) => {
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

export const playerCountLabel = (status) => {
  if (status?.online === false) {
    return "-";
  }

  if (typeof status?.playersMax === "number") {
    return `${formatNumber(status.playersOnline ?? 0)} / ${formatNumber(status.playersMax)}`;
  }

  if (typeof status?.playersOnline === "number") {
    return `${formatNumber(status.playersOnline)} online`;
  }

  return "Players unknown";
};

export const versionLabel = (status) =>
  status?.online === false ? "-" : status?.version || "Version unknown";

export const reviewStatusLabel = (server) =>
  ({
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    suspended: "Suspended",
    hidden_offline: "Hidden",
  })[server.reviewStatus] ?? "Updated";

export const createServerIcon = (server) => {
  const frame = document.createElement("div");
  frame.className = "server-icon-frame d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden rounded-2";

  const icon = document.createElement("img");
  icon.className = "server-icon w-100 h-100";
  icon.src = server.status?.icon || FALLBACK_SERVER_ICON;
  icon.alt = "";
  icon.loading = "lazy";
  icon.decoding = "async";
  icon.addEventListener(
    "error",
    () => {
      if (icon.src !== new URL(FALLBACK_SERVER_ICON, window.location.origin).href) {
        icon.src = FALLBACK_SERVER_ICON;
      }
    },
    { once: true }
  );

  frame.append(icon);

  return frame;
};

export const createAddressButton = (server) => {
  const value = server.address ?? "";
  const button = document.createElement("button");
  button.className = "btn btn-site copy-action server-address d-inline-flex align-items-center gap-2 overflow-hidden text-start text-nowrap";
  button.type = "button";
  button.dataset.copyServerAddress = value;
  button.dataset.copySuccessLabel = "Copied!";
  button.setAttribute("aria-label", `Copy server address ${value || "unavailable"}`);

  const label = document.createElement("span");
  label.className = "server-address-label flex-shrink-0";
  label.textContent = "IP:";

  const address = document.createElement("span");
  address.className = "server-address-value text-truncate";
  address.textContent = value || "Address unavailable";

  const icon = document.createElement("i");
  icon.className = "copy-action-icon fa-regular fa-copy";
  icon.setAttribute("aria-hidden", "true");

  button.append(label, address, icon);

  return button;
};

export const createServerStat = (
  label,
  value,
  iconClass,
  columnClass = "col",
  secondaryValue = "",
) => {
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

  if (secondaryValue) {
    valueNode.textContent = `${value} \u00B7 `;
    valueNode.title = `${value} \u00B7 ${secondaryValue}`;
    const secondaryNode = document.createElement("small");
    secondaryNode.className = "text-body-secondary fw-bold";
    secondaryNode.textContent = secondaryValue;
    valueNode.append(secondaryNode);
  }

  text.append(labelNode, valueNode);
  stat.append(iconWrap, text);
  column.append(stat);

  return column;
};

export const createOwnerStat = (owner, columnClass = "col") => {
  if (!owner?.username) {
    return createServerStat("Owner", "Not available", "fa-brands fa-discord", columnClass);
  }

  const username = String(owner.username);

  return createServerStat(
    "Owner",
    owner.displayName || username,
    "fa-brands fa-discord",
    columnClass,
    `@${username}`
  );
};

export const createServerLink = (url, label, key = "", visibleLabel = label) => {
  if (!url) {
    return null;
  }

  const link = document.createElement("a");
  link.className = "server-link server-social-link d-inline-flex align-items-center justify-content-center overflow-hidden text-nowrap text-decoration-none px-2";
  link.href = url;
  link.target = "_blank";
  link.rel = "ugc nofollow noopener noreferrer";
  link.setAttribute("aria-label", label);
  link.title = label;

  const icon = document.createElement("i");
  icon.className = `${SOCIAL_ICON_CLASSES[key] ?? "fa-solid fa-link"} flex-shrink-0`;
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "server-social-label d-inline-grid overflow-hidden text-nowrap";

  const textValue = document.createElement("span");
  textValue.className = "fw-bolder";
  textValue.textContent = key === "x" ? "Twitter/X" : visibleLabel;
  text.append(textValue);

  link.append(icon, text);

  return link;
};

export const appendServerLink = (container, ...linkArguments) => {
  const link = createServerLink(...linkArguments);

  if (link) {
    container.append(link);
  }
};

export const createServerCardShell = ({
  server,
  headingTag = "h3",
  cardClassName = "server-card surface-panel surface-lift d-flex flex-column gap-3 w-100 p-3 overflow-hidden rounded-3",
  dataset = {},
  chips = null,
  description = "",
  descriptionClassName = "server-description flex-grow-1 mb-0",
  descriptionTitle = "",
  afterDescription = [],
  footer = null,
}) => {
  const card = document.createElement("article");
  card.className = cardClassName;

  Object.entries(dataset).forEach(([key, value]) => {
    if (value != null && value !== "") {
      card.dataset[key] = String(value);
    }
  });

  const top = document.createElement("div");
  top.className = "server-card-top d-flex align-items-center gap-3";

  const titleWrap = document.createElement("div");
  titleWrap.className = "server-card-main d-flex flex-column justify-content-center flex-grow-1 gap-2 min-w-0";

  const titleRow = document.createElement("div");
  titleRow.className = "server-title-row d-flex align-items-start justify-content-between gap-2";

  const identity = document.createElement("div");
  identity.className = "server-card-identity d-flex flex-column gap-2 flex-grow-1 min-w-0";

  const title = document.createElement(headingTag);
  title.className = "server-card-title mb-0 text-truncate";
  title.textContent = server.name;

  identity.append(title, createAddressButton(server));
  titleRow.append(identity);

  if (chips) {
    titleRow.append(chips);
  }

  titleWrap.append(titleRow);
  top.append(createServerIcon(server), titleWrap);

  const descriptionNode = document.createElement("p");
  descriptionNode.className = descriptionClassName;
  descriptionNode.textContent = description;

  if (descriptionTitle) {
    descriptionNode.title = descriptionTitle;
  }

  const sections = [top, descriptionNode, ...afterDescription];

  if (footer) {
    sections.push(footer);
  }

  card.append(...sections);

  return card;
};

export const createSkeletonBlock = (className) => {
  const block = document.createElement("span");
  block.className = `server-skeleton ${className}`.trim();

  return block;
};

export const createServerCardSkeleton = () => {
  const column = document.createElement("div");
  column.className = "col d-flex";

  const card = document.createElement("article");
  card.className = "server-card surface-panel server-card-skeleton d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3";

  const top = document.createElement("div");
  top.className = "server-card-top d-flex align-items-center gap-3";

  const main = document.createElement("span");
  main.className = "server-skeleton-stack d-grid gap-2 flex-grow-1 min-w-0";
  main.append(
    createSkeletonBlock("server-skeleton-line server-skeleton-title"),
    createSkeletonBlock("server-skeleton-line server-skeleton-short")
  );
  top.append(createSkeletonBlock("server-skeleton-icon flex-shrink-0 rounded-2"), main);

  const description = document.createElement("span");
  description.className = "server-skeleton-stack d-grid gap-2";
  description.append(
    createSkeletonBlock("server-skeleton-line"),
    createSkeletonBlock("server-skeleton-line server-skeleton-short")
  );

  const footer = document.createElement("span");
  footer.className = "server-skeleton-footer d-flex gap-2 mt-auto";
  footer.append(
    createSkeletonBlock("server-skeleton-chip"),
    createSkeletonBlock("server-skeleton-chip")
  );

  card.append(top, description, footer);
  column.append(card);

  return column;
};

export const renderServerCardSkeletons = (container, count) => {
  container.replaceChildren();
  container.setAttribute("aria-busy", "true");

  const row = document.createElement("div");
  row.className = "servers-skeleton row row-cols-1 row-cols-md-2 g-3";
  row.setAttribute("aria-hidden", "true");

  for (let index = 0; index < count; index += 1) {
    row.append(createServerCardSkeleton());
  }

  container.append(row);
};

export const renderServerCards = (container, items, createCard) => {
  container.replaceChildren();
  container.removeAttribute("aria-busy");

  const row = document.createElement("div");
  row.className = "row row-cols-1 row-cols-md-2 g-3";
  items.forEach((server) => {
    const column = document.createElement("div");
    column.className = "col d-flex";
    column.append(createCard(server));
    row.append(column);
  });
  container.append(row);
};

export const renderServerState = (
  container,
  title,
  message = "",
  kind = "",
  icon = "fa-server",
) => {
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

export const createPaginationControl = (
  element,
  { label, current = false, iconClass = "", iconAfter = false },
) => {
  element.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2";

  if (current) {
    element.setAttribute("aria-current", "page");
  }

  const labelNode = document.createTextNode(label);

  if (!iconClass) {
    element.append(labelNode);

    return element;
  }

  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  element.append(...(iconAfter ? [labelNode, icon] : [icon, labelNode]));

  return element;
};

export const renderPagination = (container, currentPage, totalPages, createControl) => {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.replaceChildren();

  if (totalPages <= 1) {
    return;
  }

  const controls = [
    {
      label: "Previous",
      page: Math.max(1, currentPage - 1),
      disabled: currentPage === 1,
      iconClass: "fa-solid fa-chevron-left",
    }
  ];

  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      controls.push({ label: String(page), page, current: page === currentPage });
    } else if (Math.abs(page - currentPage) === 2) {
      controls.push({ ellipsis: true });
    }
  }

  controls.push({
    label: "Next",
    page: Math.min(totalPages, currentPage + 1),
    disabled: currentPage === totalPages,
    iconClass: "fa-solid fa-chevron-right",
    iconAfter: true,
  });

  controls.forEach((control) => {
    if (control.ellipsis) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "servers-pagination-ellipsis";
      ellipsis.textContent = "...";
      container.append(ellipsis);

      return;
    }

    container.append(createControl(control));
  });
};

export const createServerStatus = (status, { shrink = false } = {}) => {
  const wrap = document.createElement("span");
  wrap.className = `server-status-stack d-inline-flex flex-column align-items-center${shrink ? " flex-shrink-0" : ""} gap-1`;

  const pill = document.createElement("span");
  pill.className = `server-status d-inline-flex align-items-center gap-1 px-2 py-1 rounded-2 ${status?.online ? "server-status-online" : "server-status-offline"}`;
  pill.textContent = status?.online ? "Online" : "Offline";

  const checked = document.createElement("small");
  checked.className = "server-status-checked text-lowercase";
  checked.textContent = checkedAgoLabel(status);

  wrap.append(pill, checked);

  return wrap;
};

export const createReviewStatus = (server) => {
  const review = document.createElement("span");
  review.className = "server-admin-review-status d-inline-flex align-items-center px-2 py-1 rounded-2";
  review.textContent = titleCase(server.reviewStatus);

  return review;
};

export const createReviewDateStat = (server, columnClass = "col") => {
  const fallbackDate =
    server.reviewStatus === "approved"
      ? server.approvedAt
      : server.reviewStatus === "suspended"
        ? server.suspendedAt
        : server.updatedAt;

  return createServerStat(
    reviewStatusLabel(server),
    formatDate(server.review?.createdAt ?? fallbackDate),
    "fa-solid fa-stamp",
    columnClass
  );
};

export const readSocialValues = (item) =>
  Object.fromEntries(
    SOCIAL_PLATFORMS.map(({ key }) => [
      key,
      item?.socialLinks?.find((link) => link.key === key)?.url ?? "",
    ])
  );

export const readSocialFormValues = (formData, transform = (value) => String(value ?? "")) =>
  Object.fromEntries(SOCIAL_PLATFORMS.map(({ key }) => [key, transform(formData.get(key))]));

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);

      return true;
    } catch {
      // Fall through to the selection-based copy path
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

export const initServerAddressCopy = () => {
  document.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-copy-server-address]") : null;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const value = button.dataset.copyServerAddress ?? "";

    window.clearTimeout(copyResetTimers.get(button));

    const copied = await copyText(value).catch(() => false);

    if (!copied) {
      resetCopiedAddress(button, value);

      return;
    }

    button.classList.add("is-copied");
    button.setAttribute("aria-label", `Copied server address ${value}`);
    copyResetTimers.set(
      button,
      window.setTimeout(() => resetCopiedAddress(button, value), 1800)
    );
  });
};
