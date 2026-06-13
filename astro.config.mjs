import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";

const trimTrailingSlash = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
};

const siteUrl = trimTrailingSlash(process.env.PUBLIC_SITE_URL);
const assetsBase = trimTrailingSlash(process.env.PUBLIC_ASSETS_BASE);
const scriptAssetsBase = trimTrailingSlash(process.env.PUBLIC_SCRIPT_ASSETS_BASE) ?? "/assets";
const assetsPrefix = assetsBase
  ? {
      fallback: assetsBase,
      js: scriptAssetsBase
    }
  : undefined;

export default defineConfig({
  ...(siteUrl ? { site: siteUrl } : {}),
  output: "static",
  build: {
    format: "file",
    assets: "build",
    ...(assetsPrefix ? { assetsPrefix } : {})
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Lora",
      cssVariable: "--font-lora",
      weights: ["400 700"],
      styles: ["normal", "italic"],
      fallbacks: ["serif"]
    }
  ],
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
