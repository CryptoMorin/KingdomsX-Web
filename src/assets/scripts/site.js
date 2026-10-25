import "./site-shell.js";
import "./preview.js";
import "./gallery.js";
import "./dev-builds-link.js";
import "./copy-command.js";
import "./comparison.js";

if (document.getElementById("hero-particles")) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let particlesRequested = false;

  const loadParticles = () => {
    if (reducedMotion.matches || particlesRequested) {
      return;
    }

    particlesRequested = true;
    import("./hero-particles.js").catch((error) => {
      console.error("Unable to load hero particles.", error);
    });
  };

  const scheduleParticles = () => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadParticles, { timeout: 2000 });
    } else {
      window.setTimeout(loadParticles, 200);
    }
  };

  if (document.readyState === "complete") {
    scheduleParticles();
  } else {
    window.addEventListener("load", scheduleParticles, { once: true });
  }

  reducedMotion.addEventListener("change", loadParticles);
}

if (document.querySelector("[data-server-list]")) {
  import("./server-directory/listings.js");
}
