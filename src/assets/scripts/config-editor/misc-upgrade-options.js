export function miscUpgradeIds(workspace, defaultOptions = []) {
  const uploaded = miscUpgradeSession(workspace);
  const candidates = uploaded
    ? uploaded.document.index.entries
      .filter((entry) => entry.path.length === 1)
      .map((entry) => entry.key)
    : defaultOptions
      .filter((option) => option.path.length === 1)
      .map((option) => option.path[0]);

  return [...new Set(candidates.filter(isUpgradeId))];
}

function miscUpgradeSession(workspace) {
  return (workspace?.files ?? [])
    .filter((session) => basename(session.fileName).toLocaleLowerCase("en-US") === "misc-upgrades.yml")
    .filter((session) => !normalizePath(session.fileName).includes("/guis/"))
    .sort((left, right) => pathDepth(left.fileName) - pathDepth(right.fileName))[0] ?? null;
}

function isUpgradeId(value) {
  const key = String(value).trim();

  return Boolean(key) && !/^[[(]/.test(key);
}

function normalizePath(value) {
  return `/${String(value).replaceAll("\\", "/").toLocaleLowerCase("en-US")}`;
}

function basename(value) {
  return normalizePath(value).split("/").at(-1) ?? "";
}

function pathDepth(value) {
  return normalizePath(value).split("/").filter(Boolean).length;
}
