const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const getGitSha = (value: string | undefined) => {
  const sha = value?.trim() ?? "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : "";
};

const sourceRepository = "https://github.com/CryptoMorin/KingdomsX-Web";
const gitSha = getGitSha(
  import.meta.env.WORKERS_CI_COMMIT_SHA ??
    import.meta.env.CF_PAGES_COMMIT_SHA ??
    import.meta.env.PUBLIC_GIT_COMMIT_SHA ??
    import.meta.env.PUBLIC_GIT_SHA
);
const shortGitSha = gitSha.slice(0, 7);
const siteUrl = trimTrailingSlash(import.meta.env.PUBLIC_SITE_URL ?? "");
const serverDirectoryUrl = trimTrailingSlash(import.meta.env.PUBLIC_SERVERS_SITE_URL ?? "");
const isLocalBuild = !serverDirectoryUrl;
const turnstileSiteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? (isLocalBuild ? "1x00000000000000000000AA" : "");
const serverPath = (path = "") => {
  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return serverDirectoryUrl ? `${serverDirectoryUrl}${normalizedPath}` : `/servers${normalizedPath}`;
};

export const SITE = {
  name: "KingdomsX",
  url: siteUrl,
  wiki: "https://wiki.kingdomsx.com",
  discord: "https://discord.kingdomsx.com",
  download: "https://download.kingdomsx.com",
  serverDirectoryUrl,
  servers: serverPath(),
  serverSubmit: serverPath("submit"),
  serverAdmin: serverPath("admin"),
  isLocalBuild,
  turnstileSiteKey,
  discordDevBuilds: "discord://-/channels/429132410748141579/430983456932102154",
  spigot: "https://www.spigotmc.org/resources/77670/",
  modrinth: "https://modrinth.com/plugin/kingdomsx/",
  github: "https://github.com/CryptoMorin/KingdomsX",
  author: "https://github.com/CryptoMorin",
  source: {
    repository: sourceRepository,
    commit: gitSha,
    shortCommit: shortGitSha
  }
};
