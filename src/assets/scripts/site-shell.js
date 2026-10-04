import { Offcanvas } from "bootstrap";
import { gsap } from "gsap";
import { initAmbientPointer } from "./ambient-pointer.js";
import { initServerAddressCopy } from "./server-directory/ui.js";

const compactNavigationQuery = window.matchMedia("(max-width: 1399.98px)");
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
initServerAddressCopy();
