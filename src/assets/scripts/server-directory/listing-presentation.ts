interface StatusPresentation {
  online?: boolean;
  playersOnline?: number | null;
  playersMax?: number | null;
  version?: string | null;
  checkedAt?: string | null;
}

export const SERVER_DESCRIPTION_LIMIT = 240;
export const FALLBACK_SERVER_ICON = "/apple-touch-icon.png";
const numberFormatter = new Intl.NumberFormat();

// Drives submit form fields and listing link icons
export const SOCIAL_PLATFORMS = Object.freeze([
  { key: "discord", label: "Discord", icon: "fa-brands fa-discord", placeholder: "discord.gg/invite or invite-code" },
  { key: "facebook", label: "Facebook", icon: "fa-brands fa-facebook-f", placeholder: "@page or facebook.com/page" },
  { key: "instagram", label: "Instagram", icon: "fa-brands fa-instagram", placeholder: "@username" },
  { key: "x", label: "Twitter/X", icon: "fa-brands fa-x-twitter", placeholder: "@username" },
  { key: "youtube", label: "YouTube", icon: "fa-brands fa-youtube", placeholder: "@handle or youtube.com/@handle" },
  { key: "tiktok", label: "TikTok", icon: "fa-brands fa-tiktok", placeholder: "@username or tiktok.com/@username" },
  { key: "twitch", label: "Twitch", icon: "fa-brands fa-twitch", placeholder: "username or twitch.tv/username" }
]);

export const SOCIAL_ICON_CLASSES: Readonly<Record<string, string>> = Object.freeze({
  website: "fa-solid fa-globe",
  ...Object.fromEntries(SOCIAL_PLATFORMS.map(({ key, icon }) => [key, icon]))
});

export const formatNumber = (value: number) => numberFormatter.format(value);

export function truncateServerDescription(value: unknown, max = SERVER_DESCRIPTION_LIMIT): string {
  const text = String(value ?? "").trim();

  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function checkedAgoLabel(status?: StatusPresentation): string {
  const checkedTime = status?.checkedAt ? new Date(status.checkedAt).getTime() : NaN;

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

  return elapsedHours < 24 ? `(${elapsedHours}h ago)` : `(${Math.floor(elapsedHours / 24)}d ago)`;
}

export function playerCountLabel(status?: StatusPresentation): string {
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
}

export const versionLabel = (status?: StatusPresentation): string =>
  status?.online === false ? "-" : status?.version || "Version unknown";

interface PaginationControl {
  label: string;
  page: number;
  disabled?: boolean;
  current?: boolean;
  iconClass?: string;
  iconAfter?: boolean;
  ellipsis?: boolean;
}

export function paginationControls(currentPage: number, totalPages: number): PaginationControl[] {
  if (totalPages <= 1) {
    return [];
  }

  const controls: PaginationControl[] = [{
    label: "Previous",
    page: Math.max(1, currentPage - 1),
    disabled: currentPage === 1,
    iconClass: "fa-solid fa-chevron-left"
  }];

  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      controls.push({ label: String(page), page, current: page === currentPage });
    } else if (Math.abs(page - currentPage) === 2) {
      controls.push({ label: "...", page: 0, ellipsis: true });
    }
  }

  controls.push({
    label: "Next",
    page: Math.min(totalPages, currentPage + 1),
    disabled: currentPage === totalPages,
    iconClass: "fa-solid fa-chevron-right",
    iconAfter: true
  });

  return controls;
}

export function publicDirectoryPath(status: string, page: number, sort = "newest", basePath = ""): string {
  const segments = status === "online" ? [] : [status];

  if (sort !== "newest") {
    segments.push("sort", sort);
  }

  if (page > 1) {
    segments.push("page", String(page));
  }

  const path = [basePath, ...segments].filter(Boolean).join("/");

  return path ? `/${path.replace(/^\/+/, "")}` : "/";
}

export const DIRECTORY_UNAVAILABLE = {
  title: "Server listings are temporarily unavailable.",
  message: "Please try again soon."
};

export function emptyDirectoryState({ mode = "paged", status = "all", counts = {} }: {
  mode?: string;
  status?: string;
  counts?: Partial<Record<"all" | "online" | "offline", number>>;
} = {}) {
  const allCount = Number(counts.all ?? 0);

  if (mode === "recent" || allCount === 0) {
    return { title: "No approved servers yet.", message: "Check back soon or submit your KingdomsX server for review.", icon: "fa-flag" };
  }

  if (status === "online") {
    return {
      title: "No approved servers are online right now.",
      message: Number(counts.offline ?? 0) === allCount
        ? "Every approved server currently appears offline. Try the Offline or All filter."
        : "Try the Offline or All filter to browse approved servers.",
      icon: "fa-signal"
    };
  }

  if (status === "offline") {
    return {
      title: "No approved servers are offline right now.",
      message: Number(counts.online ?? 0) === allCount
        ? "Every approved server currently appears online. Try the Online or All filter."
        : "Try the Online or All filter to browse approved servers.",
      icon: "fa-check"
    };
  }

  return { title: "No servers match this filter.", message: "Try another server status filter.", icon: "fa-filter" };
}
