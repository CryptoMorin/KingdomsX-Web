import {
  appendServerLink,
  createOwnerStat,
  createPaginationControl,
  createServerCardShell,
  createServerStat,
  createServerStatus,
  playerCountLabel,
  renderPagination,
  renderServerCards,
  renderServerCardSkeletons,
  renderServerState,
  SERVER_DESCRIPTION_LIMIT,
  truncateServerDescription,
  versionLabel,
} from "./ui.js";

const PAGE_SIZE_DEFAULT = 8;
const STATUS_FILTERS = new Set(["all", "online", "offline"]);
const SORT_OPTIONS = new Set(["newest", "players", "name"]);
const DEFAULT_SORT = "newest";
const MESSAGES = {
  noApproved: {
    title: "No approved servers yet.",
    message: "Check back soon or submit your KingdomsX server for review.",
    icon: "fa-flag",
  },
  noOnline: {
    title: "No approved servers are online right now.",
    message: ({ offlineCount, allCount }) =>
      offlineCount === allCount
        ? "Every approved server currently appears offline. Try the Offline or All filter."
        : "Try the Offline or All filter to browse approved servers.",
    icon: "fa-signal",
  },
  noOffline: {
    title: "No approved servers are offline right now.",
    message: ({ onlineCount, allCount }) =>
      onlineCount === allCount
        ? "Every approved server currently appears online. Try the Online or All filter."
        : "Try the Online or All filter to browse approved servers.",
    icon: "fa-circle-check",
  },
  noFilterMatch: {
    title: "No servers match this filter.",
    message: "Try another server status filter.",
    icon: "fa-filter",
  },
  unavailable: {
    title: "Server listings are temporarily unavailable.",
    message: "Please try again soon.",
  }
};

const createServerCard = (server) => {
  const meta = document.createElement("div");
  meta.className = "server-stats row row-cols-1 row-cols-sm-2 g-2";
  meta.append(
    createOwnerStat(server.owner, "col-12 w-100"),
    createServerStat("Players", playerCountLabel(server.status), "fa-solid fa-user-group"),
    createServerStat("Version", versionLabel(server.status), "fa-solid fa-code-branch")
  );

  const links = document.createElement("div");
  links.className = "server-links d-flex flex-wrap gap-2 mt-3";
  appendServerLink(links, server.websiteUrl, "Website", "website");
  (server.socialLinks ?? []).forEach((link) =>
    appendServerLink(links, link.url, link.label, link.key)
  );

  const bottom = document.createElement("div");
  bottom.className = "server-card-bottom mt-auto min-w-0";
  bottom.append(meta);

  if (links.childElementCount > 0) {
    bottom.append(links);
  }

  const description = truncateServerDescription(server.description);

  return createServerCardShell({
    server,
    cardClassName:
      "server-card surface-panel surface-lift d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3",
    chips: createServerStatus(server.status, { shrink: true }),
    description,
    descriptionTitle:
      (server.description ?? "").length > SERVER_DESCRIPTION_LIMIT ? server.description : "",
    footer: bottom,
  });
};

const emptyDirectoryState = ({ mode = "paged", status = "all", counts = {} } = {}) => {
  if (mode === "recent") {
    return MESSAGES.noApproved;
  }

  const allCount = Number(counts.all ?? 0);
  const onlineCount = Number(counts.online ?? 0);
  const offlineCount = Number(counts.offline ?? 0);

  if (allCount === 0) {
    return MESSAGES.noApproved;
  }

  if (status === "online") {
    return {
      ...MESSAGES.noOnline,
      message: MESSAGES.noOnline.message({ offlineCount, allCount }),
    };
  }

  if (status === "offline") {
    return {
      ...MESSAGES.noOffline,
      message: MESSAGES.noOffline.message({ onlineCount, allCount }),
    };
  }

  return MESSAGES.noFilterMatch;
};

const renderServers = (container, items, context = {}) => {
  if (items.length) {
    renderServerCards(container, items, createServerCard);

    return;
  }

  const state = emptyDirectoryState(context);

  renderServerState(container, state.title, state.message, "", state.icon);
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
    headers: { accept: "application/json" },
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

const cleanStatus = (value) => (STATUS_FILTERS.has(value) ? value : "online");

const cleanSort = (value) => (SORT_OPTIONS.has(value) ? value : DEFAULT_SORT);

const directoryBasePath = () =>
  window.location.pathname === "/servers" || window.location.pathname.startsWith("/servers/")
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

const renderListPagination = (pagination, currentPage, totalPages, status, sort = DEFAULT_SORT) => {
  renderPagination(pagination, currentPage, totalPages, (control) => {
    const link = createPaginationControl(
      document.createElement(control.disabled ? "span" : "a"),
      control
    );

    if (control.disabled) {
      link.classList.add("disabled");
      link.setAttribute("aria-disabled", "true");
    } else {
      link.href = directoryPath(status, control.page, sort);
    }

    return link;
  });
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
      renderServerCardSkeletons(container, Math.max(1, Math.min(limit, 8)));

      try {
        const data = await fetchServers({ apiBase, mode, page, limit, status, sort });

        if (mode !== "recent" && page > (data.totalPages ?? 1)) {
          window.location.replace(directoryPath(status, data.totalPages ?? 1, data.sort ?? sort));

          return;
        }

        renderServers(container, data.items ?? [], {
          mode,
          status,
          counts: data.counts ?? {},
        });

        if (mode !== "recent") {
          updateSortControl(sortControl, data.sort ?? sort);
          updateFilterControls(filters, status, data.sort ?? sort);
          renderListPagination(pagination, data.page ?? page, data.totalPages ?? 1, status, data.sort ?? sort);
        }
      } catch {
        renderServerState(
          container,
          MESSAGES.unavailable.title,
          MESSAGES.unavailable.message,
          "servers-state-error",
          "fa-triangle-exclamation",
        );
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

initServerLists();
