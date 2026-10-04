const DEFAULT_STUCK_HEADER_HEIGHT = 40;
const DEFAULT_MOBILE_STUCK_HEADER_HEIGHT = 52;
const STUCK_THRESHOLD_EPSILON = 0.5;
const PIN_CLEARANCE = 1;
const MOBILE_STICKY_QUERY = "(max-width: 767.98px)";

export function createStickyGroupHeaders({
  shell,
  scroll,
  header,
  tools,
  content,
  form,
  mobile,
  prefersReducedMotion
}) {
  let entries = [];
  let activeMobileEntry = null;
  let usesSelfScroll = true;
  let headerHeight = 0;
  let toolsHeight = 0;
  let stuckHeight = DEFAULT_STUCK_HEADER_HEIGHT;
  let mobileStuckHeight = DEFAULT_MOBILE_STUCK_HEADER_HEIGHT;
  let geometryDirty = true;
  let frame = 0;
  const mobileQuery = window.matchMedia(MOBILE_STICKY_QUERY);
  const mobileSummary = mobile.details.querySelector(":scope > summary");

  const resizeObserver = new ResizeObserver(invalidate);

  for (const element of [header, tools, content, form]) {
    if (element) {
      resizeObserver.observe(element);
    }
  }

  scroll.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", invalidate, { passive: true });
  mobileQuery.addEventListener("change", invalidate);
  mobile.pin.addEventListener("click", () => {
    if (activeMobileEntry) {
      scrollToGroup(activeMobileEntry.group);
    }
  });
  mobile.details.addEventListener("toggle", () => {
    if (mobile.details.open && !activeMobileEntry?.ancestors.length) {
      mobile.details.open = false;
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (mobile.details.open && !mobile.details.contains(event.target)) {
      mobile.details.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobile.details.open) {
      mobile.details.open = false;
      mobileSummary.focus();
    }
  });

  function refresh() {
    entries = [...form.querySelectorAll(".editor-group")]
      .map((group) => {
        const sentinel = group.querySelector(":scope > .editor-group-sticky-sentinel");
        const sticky = group.querySelector(":scope > .editor-group-sticky");

        if (!sentinel || !sticky) {
          return null;
        }

        return {
          group,
          sentinel,
          sticky,
          pin: sticky.querySelector(".editor-group-pin"),
          header: group.querySelector(":scope > .editor-group-header"),
          title: group.querySelector(":scope > .editor-group-header .editor-group-title")?.textContent ?? "",
          key: group.querySelector(":scope > .editor-group-header .editor-group-key")?.textContent ?? "",
          depth: Number(group.style.getPropertyValue("--editor-group-depth") || 1),
          ancestors: [],
          start: 0,
          end: 0,
          stuck: sticky.classList.contains("is-stuck")
        };
      })
      .filter(Boolean);

    const entriesByGroup = new Map(entries.map((entry) => [entry.group, entry]));

    for (const entry of entries) {
      let parent = entry.group.parentElement?.closest(".editor-group");

      while (parent) {
        const parentEntry = entriesByGroup.get(parent);

        if (parentEntry) {
          entry.ancestors.unshift(parentEntry);
        }

        parent = parent.parentElement?.closest(".editor-group");
      }
    }

    clearMobileHeader();
    invalidate();
  }

  function invalidate() {
    geometryDirty = true;
    schedule();
  }

  function schedule() {
    if (frame) {
      return;
    }

    frame = window.requestAnimationFrame(update);
  }

  function update() {
    frame = 0;

    if (geometryDirty && !measureGeometry()) {
      return;
    }

    updateStuckStates();
  }

  function measureGeometry() {
    const nextUsesSelfScroll = scroll.scrollHeight > scroll.clientHeight + 1;
    const headerStyle = getComputedStyle(header);
    const toolsStyle = getComputedStyle(tools);
    const shellStyle = getComputedStyle(shell);
    const scrollStyle = getComputedStyle(scroll);
    const nextHeaderHeight = ["absolute", "fixed"].includes(headerStyle.position)
      ? header.getBoundingClientRect().height
      : 0;
    const nextToolsHeight = toolsStyle.position === "sticky"
      ? tools.getBoundingClientRect().height
      : 0;
    const nextStuckHeight = Number.parseFloat(
      scrollStyle.getPropertyValue("--editor-stuck-header-height")
    ) || DEFAULT_STUCK_HEADER_HEIGHT;
    const nextMobileStuckHeight = mobileQuery.matches
      ? mobile.root.querySelector(".editor-mobile-group-sticky-header").getBoundingClientRect().height
        || DEFAULT_MOBILE_STUCK_HEADER_HEIGHT
      : DEFAULT_MOBILE_STUCK_HEADER_HEIGHT;
    const currentHeaderOffset = Number.parseFloat(
      shellStyle.getPropertyValue("--editor-header-offset")
    ) || 0;
    const currentToolsOffset = Number.parseFloat(
      scrollStyle.getPropertyValue("--editor-tools-offset")
    ) || 0;

    const headerOffsetChanged = Math.abs(currentHeaderOffset - nextHeaderHeight) > STUCK_THRESHOLD_EPSILON;
    const toolsOffsetChanged = Math.abs(currentToolsOffset - nextToolsHeight) > STUCK_THRESHOLD_EPSILON;

    if (headerOffsetChanged) {
      shell.style.setProperty("--editor-header-offset", `${nextHeaderHeight}px`);
    }

    if (toolsOffsetChanged) {
      scroll.style.setProperty("--editor-tools-offset", `${nextToolsHeight}px`);
    }

    if (headerOffsetChanged || toolsOffsetChanged) {
      schedule();
      return false;
    }

    const scrollBounds = nextUsesSelfScroll ? scroll.getBoundingClientRect() : null;
    const scrollPosition = nextUsesSelfScroll ? scroll.scrollTop : window.scrollY;
    const measuredEntries = entries.map((entry) => {
      const sentinelBounds = entry.sentinel.getBoundingClientRect();
      const groupBounds = entry.group.getBoundingClientRect();
      const origin = nextUsesSelfScroll ? scrollBounds.top : 0;

      return {
        entry,
        start: sentinelBounds.top - origin + scrollPosition,
        end: groupBounds.bottom - origin + scrollPosition
      };
    });

    usesSelfScroll = nextUsesSelfScroll;
    headerHeight = nextHeaderHeight;
    toolsHeight = nextToolsHeight;
    stuckHeight = nextStuckHeight;
    mobileStuckHeight = nextMobileStuckHeight;

    for (const measurement of measuredEntries) {
      measurement.entry.start = measurement.start;
      measurement.entry.end = measurement.end;
    }

    geometryDirty = false;

    return true;
  }

  function updateStuckStates() {
    const scrollPosition = usesSelfScroll ? scroll.scrollTop : window.scrollY;

    if (mobileQuery.matches) {
      updateMobileState(scrollPosition);
      return;
    }

    clearMobileHeader();
    const states = entries.map((entry) => {
      const stickyTop = stickyOffset(entry.depth);

      return entry.start < scrollPosition + stickyTop - STUCK_THRESHOLD_EPSILON
        && entry.end > scrollPosition + stickyTop + stuckHeight;
    });

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const stuck = states[index];

      if (entry.stuck === stuck) {
        continue;
      }

      entry.stuck = stuck;
      entry.sticky.classList.toggle("is-stuck", stuck);

      if (entry.pin) {
        entry.pin.tabIndex = stuck ? 0 : -1;
      }
    }
  }

  function updateMobileState(scrollPosition) {
    const stickyTop = headerHeight + toolsHeight;
    let active = null;

    for (const entry of entries) {
      const withinGroup = entry.start < scrollPosition + stickyTop - STUCK_THRESHOLD_EPSILON
        && entry.end > scrollPosition + stickyTop + mobileStuckHeight;

      if (withinGroup && (!active
        || entry.depth > active.depth
        || (entry.depth === active.depth && entry.start > active.start))) {
        active = entry;
      }
    }

    for (const entry of entries) {
      if (!entry.stuck) {
        continue;
      }

      entry.stuck = false;
      entry.sticky.classList.remove("is-stuck");

      if (entry.pin) {
        entry.pin.tabIndex = -1;
      }
    }

    if (activeMobileEntry !== active) {
      renderMobileHeader(active);
    }

    const stuck = Boolean(active);
    mobile.root.classList.toggle("is-stuck", stuck);
    mobile.root.setAttribute("aria-hidden", stuck ? "false" : "true");
    mobile.root.inert = !stuck;
    mobile.pin.tabIndex = stuck ? 0 : -1;
  }

  function clearMobileHeader() {
    if (!activeMobileEntry && !mobile.root.classList.contains("is-stuck")) {
      return;
    }

    renderMobileHeader(null);
    mobile.root.classList.remove("is-stuck");
    mobile.root.setAttribute("aria-hidden", "true");
    mobile.root.inert = true;
    mobile.pin.tabIndex = -1;
  }

  function renderMobileHeader(entry) {
    activeMobileEntry = entry;
    mobile.details.open = false;
    mobile.title.textContent = entry?.title ?? "";
    mobile.key.textContent = entry?.key ?? "";
    mobile.key.hidden = !entry?.key;
    mobile.context.textContent = entry ? compactAncestorPath(entry.ancestors) : "";
    mobile.pin.setAttribute("aria-label", entry ? `Jump to top of ${entry.title}` : "Jump to group");
    const hasAncestors = Boolean(entry?.ancestors.length);
    mobile.details.classList.toggle("has-ancestors", hasAncestors);
    mobileSummary.tabIndex = hasAncestors ? 0 : -1;

    if (hasAncestors) {
      mobileSummary.setAttribute("aria-label", `Show parent groups for ${entry.title}`);
    } else {
      mobileSummary.removeAttribute("aria-label");
    }

    const tree = document.createElement("ul");
    tree.className = "editor-tree editor-mobile-group-tree list-unstyled m-0 p-0";
    tree.setAttribute("aria-label", "Parent groups");
    let branch = tree;

    for (const [index, ancestor] of (entry?.ancestors ?? []).entries()) {
      const item = document.createElement("li");
      item.className = "editor-tree-item editor-mobile-group-tree-item is-last min-w-0";

      if (index) {
        item.dataset.depthTone = String(((index - 1) % 8) + 1);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-mobile-group-ancestor d-flex align-items-center gap-2 w-100 border-0 text-start";
      button.setAttribute("aria-label", `Jump to ${ancestor.title}`);

      const title = document.createElement("span");
      title.className = "d-block min-w-0 flex-grow-1 text-truncate";
      title.textContent = ancestor.title;
      button.append(title);

      if (ancestor.key) {
        const key = document.createElement("code");
        key.className = "d-block text-truncate";
        key.textContent = ancestor.key;
        button.append(key);
      }

      button.addEventListener("click", () => {
        mobile.details.open = false;
        scrollToGroup(ancestor.group);
      });
      item.append(button);
      branch.append(item);

      if (index < entry.ancestors.length - 1) {
        const children = document.createElement("ul");
        children.className = "editor-tree editor-mobile-group-tree list-unstyled m-0 p-0";
        item.append(children);
        branch = children;
      }
    }

    mobile.ancestors.replaceChildren(...(hasAncestors ? [tree] : []));
  }

  function stickyOffset(depth) {
    const depthOffset = mobileQuery.matches ? 0 : Math.max(0, depth - 1) * stuckHeight;

    return headerHeight + toolsHeight + depthOffset;
  }

  function scrollToGroup(group) {
    const entry = entries.find((candidate) => candidate.group === group);

    if (!entry) {
      return;
    }

    focusOriginalHeader(entry.header);
    const target = Math.max(0, entry.start - stickyOffset(entry.depth) - PIN_CLEARANCE);
    const behavior = prefersReducedMotion() ? "auto" : "smooth";

    if (usesSelfScroll) {
      scroll.scrollTo({ top: target, behavior });
    } else {
      window.scrollTo({ top: target, behavior });
    }

    schedule();
  }

  return {
    invalidate,
    refresh,
    schedule,
    scrollToGroup
  };
}

function compactAncestorPath(ancestors) {
  const labels = ancestors.map((entry) => entry.title);

  if (!labels.length) {
    return "";
  }

  if (labels.length <= 4) {
    return labels.join(" / ");
  }

  return `${labels.slice(0, 3).join(" / ")} / … / ${labels.at(-1)}`;
}

function focusOriginalHeader(header) {
  if (!header) {
    return;
  }

  const originalTabIndex = header.getAttribute("tabindex");
  header.tabIndex = -1;
  header.focus({ preventScroll: true });
  header.addEventListener("blur", () => {
    if (originalTabIndex === null) {
      header.removeAttribute("tabindex");
    } else {
      header.setAttribute("tabindex", originalTabIndex);
    }
  }, { once: true });
}
