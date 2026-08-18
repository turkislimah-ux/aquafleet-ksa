import { defineConfig } from "@playwright/test";

// EVERY SPEC IN ./tests IS A PURE-UNIT SPEC AND NEEDS NO SERVER. It stayed
// worth having a config because this repo's verification convention is a
// throwaway diagnostic route plus a temporary auth bypass, torn down at the end
// of the pass — so a browser spec here is a passing suite for exactly as long as
// its route exists, and a permanently-red one afterwards. Thirty-one such specs
// had accumulated against twenty-four deleted routes; the Staff cleanup removed
// them (a spec that cannot pass in ANY configuration is not documentation, it is
// a broken build that everyone has learned to ignore, which is what makes a real
// failure invisible). What was verified lives in CLAUDE.md §7.
//
// `baseURL` is kept for the next pass that spins a diagnostic route back up on
// the manually-started dev server at :3002 — deliberately no `webServer`
// auto-start, since `next build`/dev-server interactions have taken this repo
// down before (see §7). If a spec you are adding needs a URL, it needs a route
// that will be deleted, so plan to delete the spec with it.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
  },
});
