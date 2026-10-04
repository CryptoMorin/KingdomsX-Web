import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/config-editor",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "narrow-chromium",
      grep: /@responsive/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } }
    }
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4321 --ignore-lock",
    // Keep Astro attached so Playwright can stop it
    env: { ASTRO_DEV_BACKGROUND: "false" },
    url: "http://127.0.0.1:4321/editor",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
