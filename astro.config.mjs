import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const trimTrailingSlash = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
};

const siteUrl = trimTrailingSlash(process.env.PUBLIC_SITE_URL);
const assetsPrefix = trimTrailingSlash(process.env.PUBLIC_ASSETS_BASE);

export default defineConfig({
  ...(siteUrl ? { site: siteUrl } : {}),
  output: "static",
  build: {
    format: "file",
    assets: "build",
    ...(assetsPrefix ? { assetsPrefix } : {})
  },
  integrations: [
    ...(siteUrl
      ? [
          sitemap({
            filter: (page) => !["/403.html", "/404.html"].some((path) => new URL(page).pathname === path)
          })
        ]
      : [])
  ]
});
