import {
  createAddressButton,
  createOwnerStat,
  createReviewStatus,
  createServerIcon,
  createServerLink,
  createServerStat,
  formatDate,
  playerCountLabel,
  versionLabel,
} from "./ui.js";

const formatVerificationEvidence = (value) => {
  const evidence = textOrFallback(value, "No verification evidence stored.");

  return evidence
    .split("\n")
    .map((line) =>
      line.startsWith("Verified: ")
        ? `Verified: ${formatDate(line.slice(10), { timeSeparator: " " })}`
        : line
    )
    .join("\n");
};

const textOrFallback = (value, fallback = "Not provided") => {
  const text = typeof value === "string" ? value.trim() : "";

  return text || fallback;
};

const statusLabel = (server) => {
  if (typeof server.status?.online !== "boolean") {
    return "-";
  }

  const state = server.status.online ? "Online" : "Offline";

  return server.status.stale ? `${state} (stale)` : state;
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

const providerName = (value) =>
  ({
    mcsrvstat: "mcsrvstat.us",
    "mcsrvstat.us": "mcsrvstat.us",
    "mcstatus.io": "mcstatus.io",
    "minecraftpinger.com": "minecraftpinger.com",
    "mcapi.us": "mcapi.us",
  })[value] ??
  (value || "No provider");

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

const createDiscordEmbed = (server) => {
  const embed = server.discordEmbed ?? {};
  const state = embed.state ?? "not_applicable";
  const stateLabels = {
    not_applicable: "Not applicable",
    pending: "Queued",
    synced: "Synced",
    deleting: "Removing",
    failed: "Failed",
  };
  const stateIcons = {
    not_applicable: "fa-solid fa-minus",
    pending: "fa-solid fa-clock",
    synced: "fa-solid fa-circle-check",
    deleting: "fa-solid fa-trash-can",
    failed: "fa-solid fa-triangle-exclamation",
  };
  const content = document.createElement("div");
  content.className = "d-flex flex-column gap-3";

  const stats = document.createElement("div");
  stats.className = "server-stats row row-cols-1 row-cols-sm-3 g-2";
  stats.append(
    createServerStat(
      "State",
      stateLabels[state] ?? String(state).replaceAll("_", " "),
      stateIcons[state] ?? "fa-solid fa-circle-info",
    ),
    createServerStat("Last Synced", formatDate(embed.syncedAt), "fa-solid fa-clock"),
    createServerStat("Attempts", String(embed.attemptCount ?? 0), "fa-solid fa-rotate")
  );
  content.append(stats);

  if (embed.lastError) {
    content.append(
      createTextBlock(
        `Last error: ${embed.lastError}`,
        "server-submit-notice is-error mb-0 p-3 rounded-3"
      )
    );
  }

  return content;
};

const createDiscordEmbedAction = (server) => {
  const state = server.discordEmbed?.state ?? "not_applicable";
  const approved = server.reviewStatus === "approved";
  let label;
  let icon = "fa-paper-plane";
  let disabled = false;

  if (state === "pending") {
    label = "Discord Embed Update Queued";
    icon = "fa-clock";
    disabled = true;
  } else if (state === "deleting") {
    label = "Discord Embed Removal Queued";
    icon = "fa-clock";
    disabled = true;
  } else if (state === "failed") {
    label = approved ? "Retry Discord Embed Update" : "Retry Discord Embed Removal";
    icon = "fa-rotate";
  } else if (approved && state === "synced") {
    label = "Update Discord Embed";
    icon = "fa-arrows-rotate";
  } else if (approved) {
    label = "Post Embed to Discord";
  } else {
    return null;
  }

  const button = createActionButton("discord-sync", label, icon, "btn-site-sm");
  button.disabled = disabled;

  if (disabled) button.setAttribute("aria-disabled", "true");

  return button;
};

const createCurrentModerationReason = (server, messages) => {
  if (server.reviewStatus !== "rejected" && server.reviewStatus !== "suspended") {
    return null;
  }

  const action = server.reviewStatus === "rejected" ? "reject" : "suspend";
  const reasonText = textOrFallback(
    server.submission?.moderationNotes,
    "No moderation reason was stored."
  );
  const preset = (messages.feedbackReasons[action] ?? []).find(
    (reason) =>
      (reason.code && server.review?.reasonCode && reason.code === server.review.reasonCode) ||
      reason.text === reasonText
  );
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

export const fillManageModal = (modal, server, messages) => {
  const title = modal.querySelector("[data-admin-modal-title]");
  const body = modal.querySelector("[data-admin-modal-body]");
  const footer = modal.querySelector("[data-admin-modal-footer]");

  if (!(body instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
    return null;
  }

  if (title) title.textContent = server.name;

  body.replaceChildren();
  footer.replaceChildren();
  modal.dataset.serverId = server.id;

  const description = createTextBlock(server.description, "server-admin-description mb-0");

  const stats = document.createElement("div");
  stats.className = "server-stats row row-cols-1 row-cols-sm-2 row-cols-xl-4 g-2";
  stats.append(
    createServerStat(
      "Status",
      statusLabel(server),
      server.status?.online ? "fa-solid fa-signal" : "fa-solid fa-triangle-exclamation",
    ),
    createServerStat("Players", playerCountLabel(server.status), "fa-solid fa-user-group"),
    createServerStat("Version", versionLabel(server.status), "fa-solid fa-code-branch"),
    createServerStat(
      "Last Checked",
      server.status?.online === false && !server.status?.checkedAt
        ? "-"
        : formatDate(server.status?.checkedAt),
      "fa-solid fa-rotate"
    )
  );

  if (!server.status?.online) {
    stats.append(
      createServerStat(
        "Check Attempts",
        String(server.failureCount ?? 0),
        "fa-solid fa-triangle-exclamation"
      )
    );
  }

  const submissionStats = document.createElement("div");
  submissionStats.className = "server-stats row row-cols-1 row-cols-md-2 g-2";
  submissionStats.append(
    createOwnerStat(server.owner),
    createServerStat(
      "Submitted",
      formatDate(server.submission?.createdAt ?? server.createdAt),
      "fa-solid fa-clock"
    )
  );

  const evidence = document.createElement("pre");
  evidence.className = "mb-0";
  evidence.textContent = formatVerificationEvidence(server.submission?.verificationEvidence);

  const submissionContent = document.createElement("div");
  submissionContent.className = "d-flex flex-column gap-3";
  submissionContent.append(submissionStats, evidence);

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2";
  const website = createServerLink(server.websiteUrl, "Website", "website");

  if (website) links.append(website);

  (server.socialLinks ?? []).forEach((item) => {
    const link = createServerLink(
      item.url,
      item.host ? `${item.label}: ${item.host}` : item.label,
      item.key,
      item.label
    );

    if (link) links.append(link);
  });

  const socialsContent = document.createElement("div");
  socialsContent.className = "d-flex flex-column gap-2";
  socialsContent.append(
    links.childElementCount > 0
      ? links
      : createTextBlock("No public website or social links were submitted.")
  );

  const sections = [
    createCurrentModerationReason(server, messages),
    createModalSection("Overview", createOverview(server)),
    createModalSection("Description", description),
    createModalSection(`Server Status (${providerName(server.provider)})`, stats),
    createModalSection("Website & Socials", socialsContent),
    createModalSection("Discord Embed", createDiscordEmbed(server)),
    createModalSection("Submission", submissionContent),
  ].filter(Boolean);

  body.append(...sections);

  const refreshGroup = document.createElement("div");
  refreshGroup.className = "server-admin-footer-group d-flex flex-wrap gap-2";
  refreshGroup.append(
    createActionButton("refresh-status", "Refresh Status", "fa-rotate", "btn-site-sm")
  );
  const discordAction = createDiscordEmbedAction(server);

  if (discordAction) refreshGroup.append(discordAction);

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

export const fillReasonModal = (modal, server, action, messages) => {
  const title = modal.querySelector("[data-admin-modal-title]");
  const body = modal.querySelector("[data-admin-modal-body]");
  const footer = modal.querySelector("[data-admin-modal-footer]");
  const reasons = messages.feedbackReasons[action] ?? [];

  if (!(body instanceof HTMLElement) || !(footer instanceof HTMLElement) || reasons.length === 0) {
    return;
  }

  if (title) title.textContent = `${action === "suspend" ? "Suspend" : "Reject"} ${server.name}`;

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
