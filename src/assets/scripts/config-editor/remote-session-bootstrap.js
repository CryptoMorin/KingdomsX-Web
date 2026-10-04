(() => {
  const storageKey = document.querySelector('meta[name="kingdomsx-editor-session-storage-key"]')?.content;
  let hasSavedSession = false;

  try {
    hasSavedSession = Boolean(storageKey && sessionStorage.getItem(storageKey));
  } catch {}

  if (location.hash.startsWith("#s/")
    || location.hash.startsWith("#session/")
    || hasSavedSession) {
    document.documentElement.dataset.editorSessionPending = "";
  }
})();
