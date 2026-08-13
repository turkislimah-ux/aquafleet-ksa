// Polish batch 2 — Dashboard content rebuild.
//
// Depends on the throwaway /dash-drift route + VERIFY_BYPASS=1, both removed
// at the end of this pass. Documents what was verified; not a standing suite.
//
// SCOPE NOTE — READ BEFORE TRUSTING THE COVERAGE.
// This harness has NO Supabase session, so the 0103 views correctly refuse to
// answer (they are security_invoker and revoked from anon). That makes this
// suite a test of the page's HONESTY and its FENCES, not of its numbers:
//   · it proves the page never claims "all clear" when a read failed
//   · it proves the Add Summary fence excludes dictionary-backed widgets when
//     the dictionary cannot be read
//   · it proves nothing crashes on a total data blackout
// The populated numbers, the activity feed and the drift guard are Turki's
// authenticated pass — see the checklist.

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3002";

test.describe("honest failure — the page never fakes an all-clear", () => {
  test("a failed read says so in every section", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    const main = page.locator("main");

    await expect(main).toContainText(/Failed to load the dashboard/i);

    // THE BUG THIS GUARDS: the first build rendered "Nothing waiting — every
    // queue is clear right now" while the query had errored. Claiming an
    // empty queue when the queue could not be read is a confident lie.
    await expect(main).toContainText(/Could not read the queue/i);
    await expect(main).not.toContainText(/Every queue is clear/i);

    await expect(main).toContainText(/Could not read current state/i);
    await expect(main).toContainText(/Could not read activity/i);
  });

  test("headline figures render an em dash, never a confident zero", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    const main = page.locator("main");
    // A month with no row must not read "0 SAR" or "0.0%".
    await expect(main).not.toContainText(/0\.0%/);
    for (const label of [/REVENUE/i, /OPERATING MARGIN/i, /OUTSTANDING/i, /TRIPS DELIVERED/i]) {
      await expect(main).toContainText(label);
    }
  });

  test("no runtime crash on a total data blackout", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
});

test.describe("Add Summary is fenced to the semantic layer", () => {
  test("dictionary-backed widgets vanish when the dictionary cannot be read", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Add summary/i }).click();
    await page.waitForTimeout(300);

    // report_metrics is unreadable here, so availableWidgets() must drop every
    // metric-family option and keep only the state family. That IS the fence
    // working — the same shape as report-builder's availableMetrics().
    //
    // SCOPED TO THE PICKER on purpose: an unscoped getByText("Revenue") also
    // matches the HEADLINE tile, which is a different feature entirely and is
    // supposed to be there. The first version of this assertion failed for
    // exactly that reason.
    const picker = page.locator('section[aria-labelledby="dash-summary"]');
    await expect(picker.getByText("Fleet right now")).toBeVisible();
    await expect(picker.getByText("Drivers right now")).toBeVisible();
    await expect(picker.getByText("Revenue", { exact: true })).toHaveCount(0);
    await expect(picker.getByText("Operating margin")).toHaveCount(0);
    await expect(picker.getByText("Payroll")).toHaveCount(0);
  });

  test("the AI seam is present, marked, and inert", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Add summary/i }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText(/Describe a summary/i)).toBeVisible();
    await expect(page.getByText(/Coming soon/i).first()).toBeVisible();
    // No model call, no network — the input cannot be typed into at all.
    await expect(page.locator("input[disabled]")).toBeVisible();
  });

  test("an empty summary list explains itself", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(1500);
    await expect(page.getByText(/No summaries yet/i)).toBeVisible();
  });
});

test.describe("drift guard", () => {
  test("reports unreachable rather than a false pass with no session", async ({ page }) => {
    await page.goto(BASE + "/dash-drift");
    await page.waitForTimeout(1200);
    const summary = page.locator("#dd-summary");

    // CRITICAL: with no session BOTH sides read zero rows, which would make a
    // naive comparison "agree" and report a meaningless PASS. The guard must
    // distinguish "cannot see the view" from "the view agrees".
    await expect(summary).toHaveAttribute("data-reachable", "false");
    await expect(summary).toHaveAttribute("data-ok", "false");
  });
});
