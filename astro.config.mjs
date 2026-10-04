import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { fileURLToPath } from "node:url";

const trimTrailingSlash = (value) => {
  const trimmed = value?.trim();

  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
};

const siteUrl = trimTrailingSlash(process.env.PUBLIC_SITE_URL);
const editorStandaloneBuild = process.env.EDITOR_STANDALONE_BUILD === "true";
const serverDirectoryStandaloneBuild = process.env.SERVER_DIRECTORY_STANDALONE_BUILD === "true";
const standaloneBuild = editorStandaloneBuild || serverDirectoryStandaloneBuild;
const assetsPrefix = standaloneBuild ? undefined : trimTrailingSlash(process.env.PUBLIC_ASSETS_BASE);
const outDir = editorStandaloneBuild
  ? "./dist-editor"
  : serverDirectoryStandaloneBuild
    ? "./dist-server-directory"
    : "./dist";

export default defineConfig({
  ...(siteUrl ? { site: siteUrl } : {}),
  outDir,
  output: "static",
  devToolbar: { enabled: false },
  build: {
    format: "file",
    assets: "build",
    ...(assetsPrefix ? { assetsPrefix } : {})
  },
  vite: {
    server: {
      allowedHosts: [".kingdomsx.com"]
    },
    resolve: {
      alias: [
        {
          find: /^prismarine-nbt$/,
          replacement: fileURLToPath(new URL("./src/assets/scripts/config-editor/prismarine-nbt-browser.js", import.meta.url))
        },
        {
          find: /^minecraft-data$/,
          replacement: fileURLToPath(new URL("./src/assets/scripts/config-editor/prismarine-minecraft-data.cjs", import.meta.url))
        },
        {
          find: /^prismarine-block$/,
          replacement: fileURLToPath(new URL("./src/assets/scripts/config-editor/prismarine-block-browser.cjs", import.meta.url))
        },
        {
          find: /^zlib$/,
          replacement: fileURLToPath(new URL("./src/assets/scripts/config-editor/prismarine-zlib-browser.cjs", import.meta.url))
        }
      ]
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [
        "@codemirror/commands",
        "@codemirror/lang-yaml",
        "@codemirror/language",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/highlight",
        "bootstrap",
        "buffer",
        "codemirror",
        "fflate",
        "prismarine-nbt",
        "prismarine-schematic",
        "sortablejs",
        "three"
      ]
    }
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Lora",
      cssVariable: "--font-lora",
      weights: ["400 700"],
      styles: ["normal", "italic"],
      fallbacks: ["serif"]
    },
    {
      provider: fontProviders.local(),
      name: "Minecraft UI",
      cssVariable: "--font-minecraft-ui",
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/minecraft-ui/Minecraft.otf"],
            weight: 400,
            style: "normal"
          }
        ]
      }
    }
  ],
  integrations: [
    ...(siteUrl
      ? [
          sitemap({
            filter: (page) => {
              const pathname = new URL(page).pathname;

              return !["/403", "/403.html", "/404", "/404.html"].includes(pathname)
                && !pathname.startsWith("/servers")
                && !pathname.startsWith("/editor");
            }
          })
        ]
      : [])
  ]
});
