import { gsap } from "gsap";

const ambientPointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function initAmbientPointer() {
  const pages = [...document.querySelectorAll(".page")].filter((page) => page instanceof HTMLElement);

  if (!pages.length || !ambientPointerQuery.matches || reducedMotionQuery.matches) {
    return;
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const glow = {
    x: 0,
    y: 0,
    altX: 0,
    altY: 0,
    spread: 0,
  };

  const applyGlow = () => {
    pages.forEach((page) => {
      if (page.hidden) {
        return;
      }

      page.style.setProperty("--page-glow-x", `${glow.x}%`);
      page.style.setProperty("--page-glow-y", `${glow.y}%`);
      page.style.setProperty("--page-glow-alt-x", `${glow.altX}%`);
      page.style.setProperty("--page-glow-alt-y", `${glow.altY}%`);
      page.style.setProperty("--page-glow-spread", `${glow.spread}rem`);
    });
  };

  let glowFramePending = false;
  const scheduleGlow = () => {
    if (glowFramePending) {
      return;
    }

    glowFramePending = true;
    window.requestAnimationFrame(() => {
      glowFramePending = false;
      applyGlow();
    });
  };

  const controllers = {
    x: gsap.quickTo(glow, "x", { duration: 0.55, ease: "power3.out", onUpdate: scheduleGlow }),
    y: gsap.quickTo(glow, "y", { duration: 0.55, ease: "power3.out", onUpdate: scheduleGlow }),
    altX: gsap.quickTo(glow, "altX", { duration: 0.7, ease: "power3.out", onUpdate: scheduleGlow }),
    altY: gsap.quickTo(glow, "altY", { duration: 0.7, ease: "power3.out", onUpdate: scheduleGlow }),
    spread: gsap.quickTo(glow, "spread", { duration: 0.65, ease: "power3.out", onUpdate: scheduleGlow }),
  };

  const reset = () => {
    controllers.x(0);
    controllers.y(0);
    controllers.altX(0);
    controllers.altY(0);
    controllers.spread(0);
  };

  const resetImmediately = () => {
    gsap.killTweensOf(glow);
    Object.assign(glow, { x: 0, y: 0, altX: 0, altY: 0, spread: 0 });
    applyGlow();
  };

  const editorReducedMotionEnabled = () => document.documentElement.dataset.editorReduceMotion === "true";
  const update = (event) => {
    if (editorReducedMotionEnabled()) {
      return;
    }

    const pointerX = clamp((event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2, -1, 1);
    const pointerY = clamp((event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2, -1, 1);
    const spread = Math.abs(pointerX) * 1.2 + Math.abs(pointerY) * 0.8;

    controllers.x(pointerX * 3.5);
    controllers.y(pointerY * 2.5);
    controllers.altX(pointerX * 2);
    controllers.altY(pointerY * 1.5);
    controllers.spread(spread);
  };

  const editorMotionObserver = new MutationObserver(() => {
    if (!editorReducedMotionEnabled()) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (editorReducedMotionEnabled()) {
        resetImmediately();
      }
    });
  });
  editorMotionObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-editor-reduce-motion"]
  });

  window.addEventListener("pointermove", update, { passive: true });
  document.addEventListener("mouseleave", reset);
}
