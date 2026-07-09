import { Modal } from "bootstrap";
import { fillManageModal, fillReasonModal } from "./admin-modals.js";
import {
  createOwnerStat,
  createPaginationControl,
  createReviewDateStat,
  createReviewStatus,
  createServerCardShell,
  createServerLink,
  createServerStat,
  createServerStatus,
  formatDate,
  formatNumber,
  playerCountLabel,
  renderServerCards,
  renderServerCardSkeletons,
  renderPagination,
  renderServerState,
  titleCase,
  versionLabel,
} from "./ui.js";

const ADMIN_PAGE_SIZE = 8;
const ADMIN_REFRESH_CONCURRENCY = 3;
const DEFAULT_SORT = "newest";
const ADMIN_STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
  hidden_offline: "Hidden Offline",
};
const ADMIN_MESSAGES = {
  localUnlock: {
    title: "Local admin token required.",
    message: "Enter LOCAL_ADMIN_TOKEN from your .dev.vars file to unlock the local moderation UI.",
    required: "Local admin token is required.",
  },
  states: {
    noSubmissions: (status) => `No ${status.replace("_", " ")} submissions.`,
    noSubmissionsMessage: "Choose another status or refresh after new submissions arrive.",
    unavailableTitle: "Admin data is unavailable.",
    unavailableMessage: "Please try again.",
  },
  status: {
    refreshingVisible: "Refreshing visible server statuses...",
    refreshedVisible: (count) => `${formatNumber(count)} visible server status${count === 1 ? "" : "es"} refreshed.`,
    runningAction: (action) =>
      action === "discord-sync" ? "Queueing Discord embed update..." : `Running ${action.replace("-", " ")}...`,
    completedAction: (action) =>
      action === "discord-sync" ? "Discord embed update queued." : `${action.replace("-", " ")} completed.`,
  },
  errors: {
    statusRefreshFailed: "Status refresh failed.",
    loadFailed: "Unable to load submissions.",
    chooseFeedback: "Choose a feedback reason before continuing.",
    moderationFailed: "Moderation action failed.",
  },
  confirmations: {
    deleteServer: (name) => `Are you sure you want to permanently delete ${name}? This removes the listing, submissions, status history, Discord embed, and review data.`,
  },
  feedbackReasons: {
    reject: [
      {
        code: "server_unreachable",
        title: "Server could not be reached",
        text: "Staff could not connect to this server. Make sure the address is correct, the server is online, and the port is open before resubmitting.",
      },
      {
        code: "kingdomsx_not_verified",
        title: "KingdomsX not verified",
        text: 'Staff could not verify that your server is running KingdomsX. Generate a new verification code and then run "/k admin verify <code>" on your server before resubmitting.',
      },
      {
        code: "public_details_incomplete",
        title: "Public details incomplete",
        text: "The server name, description, website, or social links need more complete and accurate public details before this listing can be approved.",
      },
      {
        code: "inappropriate_or_unsafe",
        title: "Inappropriate or unsafe listing",
        text: "This listing contains inappropriate, misleading, unsafe, or policy-violating content. Remove the problematic content before resubmitting.",
      },
    ],
    suspend: [
      {
        title: "Policy violation",
        text: "This listing is suspended because staff found content or behavior that violates the server listing rules. Contact staff after correcting the issue.",
      },
      {
        title: "Security or abuse concern",
        text: "This listing is suspended while staff reviews a security, abuse, impersonation, or player-safety concern related to the server.",
      },
      {
        title: "Misleading listing",
        text: "This listing is suspended because the public details appear misleading or no longer match the actual server. Update the details and contact staff for a new review.",
      },
      {
        title: "Repeated downtime",
        text: "This listing is suspended after repeated downtime or failed checks. Bring the server back online and contact staff for a new review.",
      },
      {
        title: "Owner or staff request",
        text: "This listing is suspended while an owner or staff request is being resolved. Contact staff when the issue is ready for review.",
      },
    ],
  }
};

let localAdminToken = "";

const setAdminState = (container, title, message = "", kind = "", icon = "fa-shield-halved") =>
  renderServerState(container, title, message, kind, icon);
const setAdminLoadingSkeleton = (container, count = ADMIN_PAGE_SIZE) =>
  renderServerCardSkeletons(container, count);

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

const createOnlineStatus = (server) => createServerStatus(server.status);

const createAdminCard = (server) => {
  const chips = document.createElement("div");
  chips.className = "server-card-tags d-flex flex-wrap align-items-start justify-content-end gap-2 flex-shrink-0";
  chips.append(createOnlineStatus(server), createReviewStatus(server));

  const stats = document.createElement("div");
  stats.className = "server-stats row row-cols-1 row-cols-sm-2 g-2";
  stats.append(
    createOwnerStat(server.owner, "col-12 w-100"),
    createServerStat("Players", playerCountLabel(server.status), "fa-solid fa-user-group"),
    createServerStat("Version", versionLabel(server.status), "fa-solid fa-code-branch"),
    createServerStat(
      "Submitted",
      formatDate(server.submission?.createdAt ?? server.createdAt),
      "fa-solid fa-clock",
    ),
    createReviewDateStat(server)
  );

  const footer = document.createElement("div");
  footer.className = "server-card-bottom d-flex flex-wrap align-items-center justify-content-between gap-2 mt-auto min-w-0";

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2";
  const website = createServerLink(server.websiteUrl, "Website", "website");

  if (website) {
    links.append(website);
  }

  (server.socialLinks ?? []).forEach((item) => {
    const link = createServerLink(
      item.url,
      item.host ? `${item.label}: ${item.host}` : item.label,
      item.key,
      item.label
    );

    if (link) {
      links.append(link);
    }
  });

  const manage = document.createElement("button");
  manage.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2";
  manage.type = "button";
  manage.dataset.adminAction = "open-manage";
  manage.dataset.adminManage = server.id;
  manage.innerHTML = '<i class="fa-solid fa-sliders" aria-hidden="true"></i> Manage';

  footer.append(links, manage);

  return createServerCardShell({
    server,
    cardClassName:
      "server-card surface-panel surface-lift d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3",
    dataset: { serverId: server.id },
    chips,
    description: server.description,
    afterDescription: [stats],
    footer,
  });
};

const renderCards = (container, items) => renderServerCards(container, items, createAdminCard);

// Local admin token only applies on the dev servers host
const isLocalAdminOrigin = () =>
  document.querySelector("[data-server-admin]")?.dataset.localBuild === "true";

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

const renderAdminPagination = (pagination, currentPage, totalPages) => {
  renderPagination(pagination, currentPage, totalPages, (control) => {
    const button = createPaginationControl(document.createElement("button"), control);

    button.type = "button";
    button.dataset.adminPage = String(control.page);

    if (control.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }

    return button;
  });
};

const mapWithConcurrency = async (items, limit, worker) => {
  let index = 0;
  const count = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: count }, async () => {
      while (index < items.length) {
        const currentIndex = index;

        index += 1;
        await worker(items[currentIndex], currentIndex);
      }
    })
  );
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
    renderAdminPagination(pagination, 1, 1);
    list.removeAttribute("aria-busy");
    list.replaceChildren(
      createLocalAdminUnlock(message, (token) => {
        if (!token) {
          setMessage(ADMIN_MESSAGES.localUnlock.required, "is-error");

          return;
        }

        saveLocalAdminToken(token);
        load();
      })
    );
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

      filter.textContent = `${label} (${formatNumber(count)})`;
    });

    if (statusSelect instanceof HTMLSelectElement) {
      Array.from(statusSelect.options).forEach((option) => {
        const key = option.value;
        const label = ADMIN_STATUS_LABELS[key] ?? titleCase(key);
        const count = Number(counts[key] ?? 0);

        option.textContent = `${label} (${formatNumber(count)})`;
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
    const response = await fetch(
      `/api/admin/servers/${encodeURIComponent(server.id)}/refresh-status`,
      {
        method: "POST",
        headers: {
          ...adminHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ notes }),
      }
    );
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
      renderAdminPagination(pagination, page, totalPages);
      updateFilterCounts(data.counts);

      if (!items.length) {
        setAdminState(
          list,
          ADMIN_MESSAGES.states.noSubmissions(status),
          ADMIN_MESSAGES.states.noSubmissionsMessage,
          "",
          "fa-inbox"
        );

        return;
      }

      renderCards(list, items);

      if (refreshStatuses) {
        refreshVisibleStatuses(items, version, announceRefresh);
      }
    } catch (error) {
      renderAdminPagination(pagination, 1, 1);
      setAdminState(
        list,
        ADMIN_MESSAGES.states.unavailableTitle,
        error instanceof Error ? error.message : ADMIN_MESSAGES.states.unavailableMessage,
        "servers-state-error",
        "fa-triangle-exclamation"
      );
      setMessage(
        error instanceof Error ? error.message : ADMIN_MESSAGES.states.unavailableTitle,
        "is-error"
      );
    }
  };

  const refreshServerCard = (server) => {
    servers.set(server.id, server);
    const current = list.querySelector(`[data-server-id="${CSS.escape(server.id)}"]`);
    const replacement = createAdminCard(server);

    current?.replaceWith(replacement);

    if (modal instanceof HTMLElement && modal.dataset.serverId === server.id) {
      fillManageModal(modal, server, ADMIN_MESSAGES);
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

    fillManageModal(modal, server, ADMIN_MESSAGES);
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
      const data =
        action === "refresh-status"
          ? { item: await refreshServerStatus({ id }) }
          : await fetch(
            action === "delete"
              ? `/api/admin/servers/${encodeURIComponent(id)}`
              : action.startsWith("discord-")
                ? `/api/admin/servers/${encodeURIComponent(id)}/discord/${action.replace("discord-", "")}`
                : `/api/admin/servers/${encodeURIComponent(id)}/${action}`,
            {
              method: action === "delete" ? "DELETE" : "POST",
              headers: {
                ...adminHeaders(),
                "content-type": "application/json",
              },
              ...(action === "delete" ? {} : { body: JSON.stringify({ notes, reasonCode }) }),
            }
          ).then(async (response) => {
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
      setMessage(
        error instanceof Error ? error.message : ADMIN_MESSAGES.errors.moderationFailed,
        "is-error"
      );
    } finally {
      button.disabled = false;
    }
  };

  modal?.addEventListener("click", async (event) => {
    const back = event.target instanceof Element ? event.target.closest("[data-admin-reason-back]") : null;

    if (back instanceof HTMLButtonElement && modal instanceof HTMLElement) {
      const server = servers.get(modal.dataset.serverId ?? "");

      if (server) {
        fillManageModal(modal, server, ADMIN_MESSAGES);
      }

      return;
    }

    const confirm = event.target instanceof Element ? event.target.closest("[data-admin-action-confirm]") : null;

    if (confirm instanceof HTMLButtonElement && modal instanceof HTMLElement) {
      const id = modal.dataset.serverId ?? "";
      const action = confirm.dataset.adminActionConfirm ?? "";
      const checked = modal.querySelector('input[name="server-admin-moderation-reason"]:checked');
      const notes = checked instanceof HTMLInputElement ? checked.value.trim() : "";
      const reasonCode = checked instanceof HTMLInputElement ? (checked.dataset.reasonCode ?? "") : "";

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
        fillReasonModal(modal, server, action, ADMIN_MESSAGES);
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
