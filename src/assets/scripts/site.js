import "bootstrap";
import { Offcanvas } from "bootstrap";
import { gsap } from "gsap";
import "./preview.js";
import "./gallery.js";
import "./dev-builds-link.js";
import "./copy-command.js";
import "./comparison.js";
import "./hero-particles.js";
import "./servers.js";
import "./server-admin.js";

const compactNavigationQuery = window.matchMedia("(max-width: 1199.98px)");
const ambientPointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

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

const initAmbientPointer = () => {
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
      page.style.setProperty("--page-glow-x", `${glow.x}%`);
      page.style.setProperty("--page-glow-y", `${glow.y}%`);
      page.style.setProperty("--page-glow-alt-x", `${glow.altX}%`);
      page.style.setProperty("--page-glow-alt-y", `${glow.altY}%`);
      page.style.setProperty("--page-glow-spread", `${glow.spread}rem`);
    });
  };

  const controllers = {
    x: gsap.quickTo(glow, "x", { duration: 0.55, ease: "power3.out", onUpdate: applyGlow }),
    y: gsap.quickTo(glow, "y", { duration: 0.55, ease: "power3.out", onUpdate: applyGlow }),
    altX: gsap.quickTo(glow, "altX", { duration: 0.7, ease: "power3.out", onUpdate: applyGlow }),
    altY: gsap.quickTo(glow, "altY", { duration: 0.7, ease: "power3.out", onUpdate: applyGlow }),
    spread: gsap.quickTo(glow, "spread", { duration: 0.65, ease: "power3.out", onUpdate: applyGlow }),
  };

  const reset = () => {
    controllers.x(0);
    controllers.y(0);
    controllers.altX(0);
    controllers.altY(0);
    controllers.spread(0);
  };

  const update = (event) => {
    const pointerX = clamp((event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2, -1, 1);
    const pointerY = clamp((event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2, -1, 1);
    const spread = Math.abs(pointerX) * 1.2 + Math.abs(pointerY) * 0.8;

    controllers.x(pointerX * 3.5);
    controllers.y(pointerY * 2.5);
    controllers.altX(pointerX * 2);
    controllers.altY(pointerY * 1.5);
    controllers.spread(spread);
  };

  window.addEventListener("pointermove", update, { passive: true });
  document.addEventListener("mouseleave", reset);
};

const initCursorTilt = () => {
  const tiltElements = [...document.querySelectorAll("[data-cursor-tilt]")].filter((element) => element instanceof HTMLElement);

  if (!tiltElements.length || !ambientPointerQuery.matches || reducedMotionQuery.matches) {
    return;
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const controllers = tiltElements.map((element) => {
    gsap.set(element, {
      transformPerspective: 900,
      transformOrigin: "50% 50%",
      transformStyle: "preserve-3d",
      force3D: true,
    });

    return {
      element,
      rotateX: gsap.quickTo(element, "rotationX", { duration: 0.28, ease: "power3.out" }),
      rotateY: gsap.quickTo(element, "rotationY", { duration: 0.28, ease: "power3.out" }),
    };
  });

  const reset = () => {
    controllers.forEach((controller) => {
      controller.rotateX(0);
      controller.rotateY(0);
    });
  };

  const update = (event) => {
    controllers.forEach((controller) => {
      const rect = controller.element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const maxX = Math.max(centerX, window.innerWidth - centerX, 1);
      const maxY = Math.max(centerY, window.innerHeight - centerY, 1);
      const x = clamp((event.clientX - centerX) / maxX, -1, 1);
      const y = clamp((event.clientY - centerY) / maxY, -1, 1);

      controller.rotateX(clamp(y * -12, -12, 12));
      controller.rotateY(clamp(x * 16, -16, 16));
    });
  };

  window.addEventListener("pointermove", update, { passive: true });
  document.addEventListener("mouseleave", reset);
};

initAmbientPointer();
initCursorTilt();
