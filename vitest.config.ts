import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.local.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("worker/migrations")),
          RATE_LIMIT_SALT: "verification-test-rate-limit-salt",
          VERIFICATION_CODE_SECRET: "verification-test-code-secret",
          SESSION_SECRET: "verification-test-session-secret",
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA"
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./worker/test-setup.ts"],
    include: ["worker/**/*.test.ts"]
  }
});
