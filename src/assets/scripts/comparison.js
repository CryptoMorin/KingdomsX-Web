import { Tooltip } from "bootstrap";

(() => {
  const section = document.getElementById("comparison");
  if (!section) return;

  const tooltipTriggers = Array.from(section.querySelectorAll('[data-bs-toggle="tooltip"]'));

  if (Tooltip) {
    tooltipTriggers.forEach((element) => {
      new Tooltip(element, {
        container: "body",
        customClass: "comparison-tooltip",
        trigger: "hover focus",
      });
    });
  } else {
    let activeTooltip = null;

    const hideTooltip = () => {
      activeTooltip?.remove();
      activeTooltip = null;
    };

    const showTooltip = (element) => {
      hideTooltip();

      const text = element.getAttribute("data-bs-title") || element.getAttribute("title");
      if (!text) return;

      const tooltip = document.createElement("div");
      tooltip.className = "tooltip bs-tooltip-top show comparison-tooltip comparison-tooltip-fallback";
      tooltip.setAttribute("role", "tooltip");
      tooltip.innerHTML = '<div class="tooltip-arrow"></div><div class="tooltip-inner"></div>';
      tooltip.querySelector(".tooltip-inner").textContent = text;
      document.body.appendChild(tooltip);

      const triggerRect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
      const top = triggerRect.top - tooltipRect.height - 8;

      tooltip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8))}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
      activeTooltip = tooltip;
    };

    tooltipTriggers.forEach((element) => {
      element.addEventListener("mouseenter", () => showTooltip(element));
      element.addEventListener("mouseleave", hideTooltip);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        showTooltip(element);
      });
      element.addEventListener("focus", () => showTooltip(element));
      element.addEventListener("blur", hideTooltip);
    });

    document.addEventListener("click", hideTooltip);
  }

  // Horizontal scroll shadows (for overflow tables on mobile)
  section.querySelectorAll(".comparison-shell").forEach((shell) => {
    const updateScrollState = () => {
      const maxScroll = shell.scrollWidth - shell.clientWidth;
      if (maxScroll <= 4) {
        shell.classList.remove("is-scrollable", "is-scrolled-start", "is-scrolled-end");
        return;
      }

      shell.classList.add("is-scrollable");
      shell.classList.toggle("is-scrolled-start", shell.scrollLeft > 4);
      shell.classList.toggle("is-scrolled-end", shell.scrollLeft < maxScroll - 4);
    };

    shell.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState, { passive: true });
    updateScrollState();
  });
})();
