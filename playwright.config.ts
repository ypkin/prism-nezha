import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests", testMatch: "**/*.spec.ts", fullyParallel: true, workers: 2,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium", colorScheme: "light", trace: "retain-on-failure" },
})
