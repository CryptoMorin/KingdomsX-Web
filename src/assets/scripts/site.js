import "bootstrap";
import { Offcanvas } from "bootstrap";
import "./preview.js";
import "./gallery.js";
import "./dev-builds-link.js";
import "./copy-command.js";
import "./comparison.js";
import "./hero-particles.js";

const compactNavigationQuery = window.matchMedia("(max-width: 1199.98px)");

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const link = event.target.closest(".main-navigation a");

  if (!(link instanceof HTMLAnchorElement) || !compactNavigationQuery.matches) {
    return;
  }

  const panel = link.closest(".main-navigation");

  if (!(panel instanceof HTMLElement)) {
    return;
  }

  Offcanvas.getInstance(panel)?.hide();
});
