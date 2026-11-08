import type { PublicServer, PublicServerCollection } from "../../../../worker/server-directory/public-directory/listings";
import { publicServerPermalink } from "../../../server-listing-permalink";
import {
  checkedAgoLabel,
  emptyDirectoryState,
  FALLBACK_SERVER_ICON,
  paginationControls,
  playerCountLabel,
  publicDirectoryPath,
  serverMetadataSummaries,
  SOCIAL_ICON_CLASSES,
  versionLabel
} from "./listing-presentation";

// Both initial Worker HTML and browser-loaded public lists use this escaped markup
export function publicServerCardsHtml(items: PublicServer[], directoryOrigin?: string, highlightedId?: number): string {
  return `<div class="row row-cols-1 row-cols-md-2 g-3">${items.map((server) => serverCardHtml(server, directoryOrigin, highlightedId !== undefined && server.publicId === highlightedId)).join("")}</div>`;
}

export function publicDirectoryHtml(data: PublicServerCollection, status: string, directoryOrigin: string, highlightedId?: number): string {
  return data.items.length
    ? publicServerCardsHtml(data.items, directoryOrigin, highlightedId)
    : publicDirectoryStateHtml(emptyDirectoryState({ status, counts: data.counts, region: data.region }));
}

export function publicDirectoryStateHtml(state: { title: string; message: string; icon?: string }, isError = false): string {
  return `<div class="servers-state d-flex flex-column align-items-center justify-content-center text-center gap-2 p-4 rounded-2${isError ? " servers-state-error" : ""}">
    <i class="servers-state-icon site-feedback-icon d-inline-flex align-items-center justify-content-center flex-shrink-0 fa-solid ${state.icon ?? "fa-exclamation"}" aria-hidden="true"></i>
    <strong>${escapeHtml(state.title)}</strong>
    <span>${escapeHtml(state.message)}</span>
  </div>`;
}

export function publicPaginationHtml(data: PublicServerCollection, status: string): string {
  return paginationControls(data.page, data.totalPages).map((control) => {
    if (control.ellipsis) {
      return '<span class="servers-pagination-ellipsis">...</span>';
    }

    const classes = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2";
    const icon = control.iconClass ? `<i class="${control.iconClass}" aria-hidden="true"></i>` : "";
    const content = control.iconAfter ? `${control.label}${icon}` : `${icon}${control.label}`;

    return control.disabled
      ? `<span class="${classes} disabled" aria-disabled="true">${content}</span>`
      : `<a class="${classes}" href="${publicDirectoryPath(status, control.page, data.sort, "", data.region)}"${control.current ? ' aria-current="page"' : ""}>${content}</a>`;
  }).join("");
}

function serverCardHtml(server: PublicServer, directoryOrigin: string | undefined, highlighted: boolean): string {
  const owner = server.owner;
  const playerCountData = JSON.stringify({
    online: server.status.online,
    playersOnline: server.status.playersOnline,
    playersMax: server.status.playersMax
  });
  const links = [
    ...(server.websiteUrl ? [{ url: server.websiteUrl, label: "Website", key: "website" }] : []),
    ...server.socialLinks
  ].map((link) => {
    const key = link.key ?? "";
    const icon = Object.hasOwn(SOCIAL_ICON_CLASSES, key) ? SOCIAL_ICON_CLASSES[key] : "fa-solid fa-link";
    const label = escapeHtml(key === "x" ? "Twitter/X" : link.label);

    return `<a class="server-link server-social-link d-inline-flex align-items-center justify-content-center overflow-hidden text-nowrap text-decoration-none px-2" href="${escapeHtml(link.url)}" target="_blank" rel="ugc nofollow noopener noreferrer" aria-label="${escapeHtml(link.label)}" title="${escapeHtml(link.label)}">
      <i class="${icon} flex-shrink-0" aria-hidden="true"></i>
      <span class="server-social-label d-inline-grid overflow-hidden text-nowrap"><span class="fw-bolder">${label}</span></span>
    </a>`;
  }).join("");

  // An older browser-cached listing response may predate public IDs
  const copyLink = server.publicId
    ? `<button class="server-link server-social-link d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden text-nowrap px-2 ms-auto" type="button" data-copy-server-link="${escapeHtml(publicServerPermalink(server.name, server.publicId, directoryOrigin))}" aria-label="Copy link" title="Copy link">
        <i class="fa-solid fa-link flex-shrink-0" aria-hidden="true"></i>
        <span class="server-social-label d-inline-grid overflow-hidden text-nowrap"><span class="fw-bolder">Copy link</span></span>
      </button>`
    : "";

  return `<div class="col d-flex">
  <article class="server-card surface-panel surface-lift d-flex flex-column gap-3 w-100 h-100 p-3 overflow-hidden rounded-3"${highlighted ? ' data-server-highlighted tabindex="-1" aria-labelledby="linked-server-title"' : ""}>
    <div class="server-card-top d-flex align-items-center gap-3">
      <div class="server-icon-frame d-inline-flex align-items-center justify-content-center flex-shrink-0 overflow-hidden rounded-2">
        <img class="server-icon w-100 h-100" src="${escapeHtml(server.status.icon || FALLBACK_SERVER_ICON)}" alt="" loading="lazy" decoding="async">
      </div>
      <div class="server-card-main d-flex flex-column justify-content-center flex-grow-1 gap-2 min-w-0">
        <div class="server-title-row d-flex align-items-start justify-content-between gap-2">
          <div class="server-card-identity d-flex flex-column gap-2 flex-grow-1 min-w-0">
            <h3 class="server-card-title mb-0 text-truncate"${highlighted ? ' id="linked-server-title"' : ""}>${escapeHtml(server.name)}</h3>
            <button class="btn btn-site copy-action server-address d-inline-flex align-items-center gap-2 overflow-hidden text-start text-nowrap" type="button" data-copy-server-address="${escapeHtml(server.address)}" data-copy-success-label="Copied!" aria-label="Copy server address ${escapeHtml(server.address || "unavailable")}">
              <span class="server-address-label flex-shrink-0">IP:</span>
              <span class="server-address-value text-truncate">${escapeHtml(server.address || "Address unavailable")}</span>
              <i class="copy-action-icon fa-regular fa-copy" aria-hidden="true"></i>
            </button>
          </div>
          <span class="server-status-stack d-inline-flex flex-column align-items-center flex-shrink-0 gap-1">
            <span class="server-status d-inline-flex align-items-center gap-1 px-2 py-1 rounded-2 server-status-${server.status.online ? "online" : "offline"}">${server.status.online ? "Online" : "Offline"}</span>
            <small class="server-status-checked text-lowercase">${escapeHtml(checkedAgoLabel(server.status))}</small>
          </span>
        </div>
      </div>
    </div>
    <p class="server-description flex-grow-1 mb-0">${escapeHtml(server.description)}</p>
    <div class="server-card-bottom mt-auto min-w-0">
      <div class="server-stats row row-cols-1 row-cols-sm-2 g-2">
        ${statHtml("Owner", owner?.displayName || owner?.username || "Not available", "fa-brands fa-discord", {
          column: "col-12 w-100",
          secondary: owner?.username ? `@${owner.username}` : ""
        })}
        ${statHtml("Players", playerCountLabel(server.status), "fa-solid fa-user-group", { playerCountData })}
        ${statHtml("Version", versionLabel(server.status), "fa-solid fa-code-branch")}
        ${serverMetadataSummaries(server).map((summary) => statHtml(summary.label, summary.value, summary.iconClass, { wrap: true, more: summary.more })).join("")}
      </div>
      ${links || copyLink ? `<div class="d-flex align-items-end gap-2 mt-3">
        ${links ? `<div class="server-links d-flex flex-wrap gap-2">${links}</div>` : ""}
        ${copyLink}
      </div>` : ""}
    </div>
  </article>
  </div>`;
}

function statHtml(label: string, value: string, icon: string, {
  column = "col",
  secondary = "",
  wrap = false,
  more = null,
  playerCountData
}: { column?: string; secondary?: string; wrap?: boolean; more?: { text: string; title: string; label: string } | null; playerCountData?: string } = {}): string {
  const title = escapeHtml(secondary ? `${value} · ${secondary}` : value);
  const content = `${escapeHtml(value)}${secondary ? ` · <small class="text-body-secondary fw-bold">${escapeHtml(secondary)}</small>` : ""}`;
  const moreButton = more ? ` <button type="button" class="border-0 bg-transparent p-0 small fw-normal text-body-secondary text-nowrap" data-server-metadata-more data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${escapeHtml(more.title)}" title="${escapeHtml(more.title)}" aria-label="${escapeHtml(more.label)}">${escapeHtml(more.text)}</button>` : "";

  return `<div class="${column}">
    <div class="server-stat d-flex align-items-center gap-2 min-w-0 h-100 p-2 rounded-2">
      <span class="server-stat-icon d-inline-flex align-items-center justify-content-center flex-shrink-0 rounded-2"><i class="${icon}" aria-hidden="true"></i></span>
      <span class="server-stat-text d-grid gap-1 min-w-0">
        <span class="server-stat-label">${label}</span>
        <strong class="server-stat-value ${wrap ? "text-break" : "text-truncate"}"${more ? "" : ` title="${title}"`}${playerCountData ? ` data-server-player-count="${escapeHtml(playerCountData)}"` : ""}>${content}${moreButton}</strong>
      </span>
    </div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
