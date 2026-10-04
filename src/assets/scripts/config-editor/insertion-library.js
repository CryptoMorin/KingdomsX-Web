const RESULT_LIMIT = 80;

export function insertionLibrary({
  libraries,
  summary,
  searchLabel,
  onInsert,
  insertLabel = (help) => `Insert ${help.toLocaleLowerCase("en-US")}`
}) {
  const details = element("details", "editor-expression-assist-drawer editor-details-disclosure");
  details.append(element("summary", "", summary));
  details.addEventListener("toggle", () => {
    if (!details.open || details.dataset.ready) {
      return;
    }

    details.dataset.ready = "true";

    const body = element("div", "editor-expression-assist-drawer-body d-grid gap-2");
    const tabs = element("div", "d-flex flex-wrap gap-1");
    const search = element("input", "form-control editor-input editor-expression-assist-search editor-compact-search");
    search.type = "search";
    search.autocomplete = "off";
    search.placeholder = "Search to insert…";
    search.setAttribute("aria-label", searchLabel);
    const results = element("div", "editor-expression-assist-results d-grid gap-2 overflow-auto");
    const status = element("p", "editor-expression-assist-status mb-0");
    let active = 0;

    const renderTabs = () => {
      tabs.replaceChildren(...libraries.map(([label], index) => {
        const tab = element("button", `editor-pill fw-bold text-nowrap editor-expression-assist-tab d-inline-flex align-items-center${index === active ? " is-active" : ""}`, label);
        tab.type = "button";
        tab.addEventListener("click", () => {
          active = index;
          renderTabs();
          renderResults();
        });

        return tab;
      }));
    };

    const renderResults = () => {
      const [, groups, note] = libraries[active];
      const query = search.value.trim().toLocaleLowerCase("en-US");
      const rows = note ? [element("p", "editor-expression-assist-note mb-0", note)] : [];
      let matched = 0;
      let rendered = 0;

      for (const [groupLabel, items] of groups) {
        const visible = items.filter(([label, value, help]) => {
          if (query && !`${label} ${value} ${help}`.toLocaleLowerCase("en-US").includes(query)) {
            return false;
          }

          matched += 1;

          if (rendered >= RESULT_LIMIT) {
            return false;
          }

          rendered += 1;

          return true;
        });

        if (!visible.length) {
          continue;
        }

        const group = element("div", "d-grid gap-1");
        const chips = element("div", "d-flex flex-wrap gap-1");

        for (const [label, value, help] of visible) {
          const button = element("button", "editor-expression-op", label);
          button.type = "button";
          button.title = help;
          button.setAttribute("aria-label", insertLabel(help));
          button.addEventListener("click", () => onInsert(value));
          chips.append(button);
        }

        group.append(element("span", "editor-muted-eyebrow", groupLabel), chips);
        rows.push(group);
      }

      results.replaceChildren(...rows);
      status.textContent = matched > rendered
        ? `Showing ${rendered} of ${matched}. Refine your search.`
        : matched
          ? `${matched} ${matched === 1 ? "match" : "matches"}`
          : "No matches";
    };

    search.addEventListener("input", renderResults);
    renderTabs();
    renderResults();

    body.append(tabs, search, results, status);
    details.append(body);
  });

  return details;
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}
