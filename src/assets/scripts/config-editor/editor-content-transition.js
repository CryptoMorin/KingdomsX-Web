const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const EXIT_OPTIONS = { duration: 250, easing: "ease-in", fill: "both" };
const ENTER_OPTIONS = { duration: 250, easing: "ease-out", fill: "both" };

export function createEditorContentTransition({
  fileContent,
  sectionContent,
  prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches
}) {
  let activeTransition = null;

  function restore(transition) {
    transition.animation?.cancel();
    transition.animation = null;

    transition.root.inert = transition.previousInert;

    if (transition.previousBusy === null) {
      transition.root.removeAttribute("aria-busy");
    } else {
      transition.root.setAttribute("aria-busy", transition.previousBusy);
    }

    if (transition.previousOpacity) {
      transition.root.style.opacity = transition.previousOpacity;
    } else {
      transition.root.style.removeProperty("opacity");
    }
  }

  async function run(scope, commit) {
    if (activeTransition) {
      return false;
    }

    const root = scope === "file" ? fileContent : scope === "section" ? sectionContent : null;

    if (!root || typeof root.animate !== "function" || prefersReducedMotion()) {
      const settle = await commit();

      if (typeof settle === "function") {
        settle();
      }

      return true;
    }

    const transition = {
      root,
      animation: null,
      cancelled: false,
      cancelWait: null,
      previousInert: Boolean(root.inert),
      previousBusy: root.getAttribute("aria-busy"),
      previousOpacity: root.style.opacity
    };
    transition.cancelledPromise = new Promise((resolve) => {
      transition.cancelWait = resolve;
    });
    activeTransition = transition;

    try {
      transition.animation = root.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        EXIT_OPTIONS
      );
      const exitFinished = await animationFinished(transition.animation, transition.cancelledPromise);

      if (!exitFinished || transition.cancelled) {
        return false;
      }

      root.style.opacity = "0";
      transition.animation.cancel();
      transition.animation = null;

      root.inert = true;

      if (scope === "file") {
        root.setAttribute("aria-busy", "true");
      }

      const settle = await commit();

      if (scope === "file") {
        root.removeAttribute("aria-busy");
      }

      if (transition.cancelled) {
        return false;
      }

      root.inert = transition.previousInert;

      if (typeof settle === "function") {
        settle();
      }

      transition.animation = root.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        ENTER_OPTIONS
      );
      await animationFinished(transition.animation, transition.cancelledPromise);

      return true;
    } finally {
      restore(transition);

      if (activeTransition === transition) {
        activeTransition = null;
      }
    }
  }

  function cleanup() {
    if (!activeTransition) {
      return;
    }

    const transition = activeTransition;
    transition.cancelled = true;
    transition.cancelWait(false);
    restore(transition);
    activeTransition = null;
  }

  return { run, cleanup };
}

export function createEditorContentNavigation({
  transition,
  currentFile,
  currentSection,
  canNavigate,
  prepareCurrentFile,
  prepareFile,
  commitFile,
  commitSection
}) {
  return {
    async openFile(path, detail = {}) {
      if (!path || path === currentFile() || !canNavigate()) {
        return false;
      }

      if (!await prepareCurrentFile()) {
        return false;
      }

      return transition.run("file", async () => {
        const destination = await prepareFile(path, detail);

        return commitFile(destination, detail);
      });
    },

    async selectSection(sectionKey, detail = {}) {
      if (!sectionKey || sectionKey === currentSection() || !canNavigate()) {
        return false;
      }

      return transition.run("section", () => commitSection(sectionKey, detail));
    }
  };
}

async function animationFinished(animation, cancelledPromise) {
  try {
    return await Promise.race([
      animation.finished.then(() => true),
      cancelledPromise
    ]);
  } catch {
    return false;
  }
}
