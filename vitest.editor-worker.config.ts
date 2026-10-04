import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/config-editor/wrangler.test.jsonc" }
    })
  ],
  test: {
    include: ["worker/config-editor/tests/**/*.test.ts"],
    unstubGlobals: true
  }
});
