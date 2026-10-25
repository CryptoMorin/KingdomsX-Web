import {
  createPaginationControl,
  renderPagination,
  renderServerCardSkeletons,
  renderServerState,
} from "./ui.js";
import { publicServerCardsHtml } from "./listing-html.ts";
import { DIRECTORY_UNAVAILABLE, emptyDirectoryState, FALLBACK_SERVER_ICON, playerCountLabel, publicDirectoryPath } from "./listing-presentation.ts";

const PAGE_SIZE_DEFAULT = 8;
const STATUS_FILTERS = new Set(["all", "online", "offline"]);
const SORT_OPTIONS = new Set(["newest", "players", "name"]);
const DEFAULT_SORT = "newest";

const enhanceServerCards = (container) => {
  // Server-rendered counts use the browser's locale without refetching the listings
  container.querySelectorAll("[data-server-player-count]").forEach((value) => {
    const label = playerCountLabel(JSON.parse(value.dataset.serverPlayerCount));
    value.textContent = label;
    value.title = label;
  });

  container.querySelectorAll("img.server-icon").forEach((icon) => {
    const useFallback = () => {
      if (icon.src !== new URL(FALLBACK_SERVER_ICON, window.location.origin).href) {
        icon.src = FALLBACK_SERVER_ICON;
      }
    };

    icon.addEventListener("error", useFallback, { once: true });

    if (icon.complete && icon.naturalWidth === 0) {
      useFallback();
    }
  });
};

const renderServers = (container, items, context = {}) => {
  if (items.length) {
    container.innerHTML = publicServerCardsHtml(items);
    container.removeAttribute("aria-busy");
    enhanceServerCards(container);

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

const directoryPath = (status, page, sort = DEFAULT_SORT) =>
  publicDirectoryPath(status, page, sort, directoryBasePath());

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
          DIRECTORY_UNAVAILABLE.title,
          DIRECTORY_UNAVAILABLE.message,
          "servers-state-error",
          "fa-exclamation",
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

    if (container.dataset.serverRendered === "true") {
      enhanceServerCards(container);

      return;
    }

    load();
  });
};

initServerLists();
