import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
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
  test: {
    environment: "node",
    include: [
      "src/assets/scripts/config-editor/**/*.test.js",
      "scripts/**/*.test.mjs"
    ]
  }
});
