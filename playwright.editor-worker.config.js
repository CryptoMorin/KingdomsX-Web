import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/config-editor-worker",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:8788",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "npm run editor:preview:production",
    url: "http://127.0.0.1:8788/healthz",
    reuseExistingServer: false,
    timeout: 180_000
  }
});
