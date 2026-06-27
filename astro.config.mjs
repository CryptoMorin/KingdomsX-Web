import { defineConfig, fontProviders } from "astro/config";
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
            filter: (page) => {
              const pathname = new URL(page).pathname;
              return !["/403", "/403.html", "/404", "/404.html"].includes(pathname) && !pathname.startsWith("/servers");
            }
          })
        ]
      : [])
  ]
});
