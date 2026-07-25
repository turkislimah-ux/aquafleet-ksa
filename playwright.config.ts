import { defineConfig } from "@playwright/test";

// Throwaway config for the follow-up-batch browser test — targets the
// already-running dev server on :3002 (started manually, same as every
// other verification pass this session), no webServer auto-start here.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
  },
});
