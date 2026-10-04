import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.server-directory.local.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("worker/migrations")),
          RATE_LIMIT_SALT: "verification-test-rate-limit-salt",
          VERIFICATION_CODE_SECRET: "verification-test-code-secret",
          SESSION_SECRET: "verification-test-session-secret",
          LOCAL_ADMIN_TOKEN: "local-admin-token",
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA"
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./worker/test-setup.ts"],
    include: ["worker/tests/**/*.test.ts"],
    unstubGlobals: true
  }
});
