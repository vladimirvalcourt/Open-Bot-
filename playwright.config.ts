import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
