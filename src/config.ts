const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

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
  author: "https://github.com/CryptoMorin"
};
