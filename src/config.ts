const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const getGitSha = (value: string | undefined) => {
  const sha = value?.trim() ?? "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : "";
};

const sourceRepository = "https://github.com/AfkF24/KingdomsX-Web";
const gitSha = getGitSha(import.meta.env.PUBLIC_GIT_COMMIT_SHA ?? import.meta.env.PUBLIC_GIT_SHA);

export const SITE = {
  name: "KingdomsX",
  url: trimTrailingSlash(import.meta.env.PUBLIC_SITE_URL ?? "https://kingdomsx.com"),
  assets: trimTrailingSlash(import.meta.env.PUBLIC_ASSETS_BASE ?? "/assets"),
  wiki: "https://wiki.kingdomsx.com",
  discord: "https://discord.kingdomsx.com",
  discordDevBuilds: "discord://-/channels/429132410748141579/430983456932102154",
  spigot: "https://www.spigotmc.org/resources/77670/",
  modrinth: "https://modrinth.com/plugin/kingdomsx/",
  github: "https://github.com/CryptoMorin/KingdomsX",
  author: "https://github.com/CryptoMorin",
  source: {
    repository: sourceRepository,
    commit: gitSha,
    shortCommit: gitSha.slice(0, 7)
  }
};
