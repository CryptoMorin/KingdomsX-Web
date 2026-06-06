(() => {
  const preview = document.querySelector("#preview");

  if (!preview) {
    return;
  }

  const mapFrames = [...preview.querySelectorAll(".map-frame")];
  const terminalEntries = [...preview.querySelectorAll(".terminal-entry")];
  const terminalHistory = preview.querySelector("[data-terminal-history]");
  const progressTrack = preview.querySelector(".preview-progress");
  const progressPills = [...preview.querySelectorAll(".preview-progress button")];
  const mobilePreview = window.matchMedia("(max-width: 640px)");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frameDuration = 2000;
  const finalFrameDuration = frameDuration * 2;
  let activeStep = 0;
  let previousFrameCleanup;
  let frameTimer;
  let stepStartedAt = 0;
  let remainingFrameTime = frameDuration;
  let currentFrameDuration = frameDuration;
  let isPaused = false;
  let isPreviewVisible = false;
  let isProgressHovered = false;
  const preloadedFrames = new Set();

  if (mapFrames.length === 0) {
    return;
  }

  const normalizeStep = (step) => ((step % mapFrames.length) + mapFrames.length) % mapFrames.length;

  const preloadFrame = (step) => {
    const normalizedStep = normalizeStep(step);

    if (preloadedFrames.has(normalizedStep)) {
      return;
    }

    const frame = mapFrames[normalizedStep];
    if (!frame) {
      return;
    }

    const image = new Image();
    image.src = frame.currentSrc || frame.src;
    preloadedFrames.add(normalizedStep);
  };

  preloadFrame(activeStep);

  const scrollToNewestEntry = (step) => {
    if (!terminalHistory || mobilePreview.matches || !isPreviewVisible) {
      return;
    }

    const newestEntry = terminalEntries[step];
    const behavior = prefersReducedMotion ? "auto" : "smooth";
    const scrollToBottom = (scrollBehavior = behavior) => {
      const entryBottom = newestEntry ? newestEntry.offsetTop + newestEntry.offsetHeight : terminalHistory.scrollHeight;
      const targetTop = Math.max(0, entryBottom - terminalHistory.clientHeight);

      terminalHistory.scrollTo({
        top: targetTop,
        behavior: scrollBehavior
      });
    };

    window.requestAnimationFrame(() => {
      scrollToBottom();
      window.setTimeout(() => scrollToBottom("auto"), 560);
    });
  };

  const clearFrameTimer = () => {
    window.clearTimeout(frameTimer);
    frameTimer = undefined;
    stepStartedAt = 0;
  };

  const getFrameDuration = (step) => {
    const normalizedStep = normalizeStep(step);
    return normalizedStep === mapFrames.length - 1 ? finalFrameDuration : frameDuration;
  };

  const getRemainingFrameTime = () => {
    if (!frameTimer || stepStartedAt === 0) {
      return getFrameDuration(activeStep);
    }

    return Math.max(currentFrameDuration - (Date.now() - stepStartedAt), 250);
  };

  const scheduleNextFrame = (delay = getFrameDuration(activeStep)) => {
    if (prefersReducedMotion || mapFrames.length === 0 || isPaused || !isPreviewVisible) {
      return;
    }

    clearFrameTimer();
    remainingFrameTime = delay;
    currentFrameDuration = delay;
    stepStartedAt = Date.now();
    frameTimer = window.setTimeout(() => {
      showStep((activeStep + 1) % mapFrames.length);
    }, delay);
  };

  const pausePreview = () => {
    if (prefersReducedMotion || isPaused) {
      return;
    }

    isPaused = true;
    preview.classList.add("is-paused");
    remainingFrameTime = getRemainingFrameTime();
    clearFrameTimer();
  };

  const resumePreview = () => {
    if (prefersReducedMotion || !isPaused || !isPreviewVisible) {
      return;
    }

    isPaused = false;
    preview.classList.remove("is-paused");
    scheduleNextFrame(remainingFrameTime);
  };

  const stopAutoAdvance = () => {
    remainingFrameTime = getRemainingFrameTime();
    clearFrameTimer();
  };

  const setPreviewVisibility = (isVisible) => {
    isPreviewVisible = isVisible;

    if (!isPreviewVisible) {
      stopAutoAdvance();
      preview.classList.add("is-paused");
      return;
    }

    showStep(activeStep, { skipSchedule: true });

    if (!isPaused) {
      preview.classList.remove("is-paused");
      scheduleNextFrame(remainingFrameTime);
    }
  };

  const pausePreviewOnHover = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    isProgressHovered = true;
    syncPreviewPauseState();
  };

  const resumePreviewOnHover = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    isProgressHovered = false;
    syncPreviewPauseState();
  };

  const syncPreviewPauseState = () => {
    if (isProgressHovered) {
      pausePreview();
      return;
    }

    resumePreview();
  };

  function showStep(step, options = {}) {
    const normalizedStep = normalizeStep(step);
    const previousStep = activeStep;
    activeStep = normalizedStep;
    const nextDelay = getFrameDuration(normalizedStep);
    remainingFrameTime = nextDelay;
    currentFrameDuration = nextDelay;
    preview.style.setProperty("--preview-frame-duration", `${nextDelay}ms`);

    window.clearTimeout(previousFrameCleanup);
    mapFrames.forEach((frame, index) => {
      const isPreviousFrame = index === previousStep && previousStep !== normalizedStep && !prefersReducedMotion;
      frame.classList.toggle("is-active", index === normalizedStep);
      frame.classList.toggle("is-previous", isPreviousFrame);
    });

    terminalEntries.forEach((entry, index) => {
      entry.classList.toggle("is-current", index === normalizedStep);
      entry.classList.toggle("is-visible", mobilePreview.matches ? index === normalizedStep : index <= normalizedStep);
    });

    progressPills.forEach((pill) => {
      pill.classList.remove("is-active");
    });

    progressPills.forEach((pill, index) => {
      const isActive = index === normalizedStep;
      pill.classList.toggle("is-active", isActive);
      pill.setAttribute("aria-current", isActive ? "true" : "false");
    });

    if (previousStep !== normalizedStep && !prefersReducedMotion) {
      previousFrameCleanup = window.setTimeout(() => {
        mapFrames[previousStep]?.classList.remove("is-previous");
      }, 950);
    }

    scrollToNewestEntry(normalizedStep);
    preloadFrame(normalizedStep + 1);

    if (!options.skipSchedule) {
      scheduleNextFrame(nextDelay);
    }
  }

  progressPills.forEach((pill, index) => {
    pill.addEventListener("click", () => {
      showStep(index);
    });
  });

  if (window.PointerEvent) {
    progressTrack?.addEventListener("pointerenter", pausePreviewOnHover);
    progressTrack?.addEventListener("pointerleave", resumePreviewOnHover);
  } else {
    progressTrack?.addEventListener("mouseenter", pausePreview);
    progressTrack?.addEventListener("mouseleave", resumePreview);
  }

  const syncPreviewLayout = () => {
    showStep(activeStep, { skipSchedule: true });
  };

  mobilePreview.addEventListener?.("change", syncPreviewLayout);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoAdvance();
      preview.classList.add("is-paused");
      return;
    }

    if (isPreviewVisible && !isPaused) {
      preview.classList.remove("is-paused");
      scheduleNextFrame(remainingFrameTime);
    }
  });
  showStep(0, { skipSchedule: true });

  if ("IntersectionObserver" in window) {
    const previewObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setPreviewVisibility(entry.isIntersecting && entry.intersectionRatio >= 0.2);
    }, {
      threshold: [0, 0.2]
    });

    previewObserver.observe(preview);
    return;
  }

  setPreviewVisibility(true);
})();
