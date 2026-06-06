(() => {
  const handled = new WeakSet();

  document.querySelectorAll("[data-discord-deep-link][data-discord-fallback]").forEach((link) => {
    if (handled.has(link)) return;
    handled.add(link);

    link.addEventListener("click", (event) => {
      const deepLink = link.dataset.discordDeepLink;
      const fallback = link.dataset.discordFallback;
      if (!deepLink || !fallback) return;

      event.preventDefault();

      let fallbackTimer;

      const cancel = () => {
        clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("pagehide", cancel);
      };

      const onVisibilityChange = () => { if (document.hidden) cancel(); };

      window.addEventListener("blur", cancel, { once: true });
      window.addEventListener("pagehide", cancel, { once: true });
      document.addEventListener("visibilitychange", onVisibilityChange, { once: true });

      fallbackTimer = setTimeout(() => {
        cancel(); // clean up listeners regardless
        window.location.href = fallback;
      }, 1500);

      window.location.href = deepLink;
    });
  });
})();
