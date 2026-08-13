// Delivered (earned) revenue on the Dashboard — migrations 0108 + 0109.
//
// Depends on the throwaway /dash-0109-check route, deleted at the end of this
// pass (same convention as every prior phase).
//
// REPLACES tests/dashboard-0108.spec.ts, which asserted a three-series chart
// including an "Invoiced revenue" series. That series was dropped at Turki's
// call, so those assertions now describe the opposite of intended behaviour —
// deleted rather than left to fail or, worse, to be "fixed" back.
//
// The fixture carries LIVE post-0109 figures: August spread across the working
// days (Friday the 7th legitimately zero), July holding the one delivered trip
// that cannot be priced.

import { test, expect } from "@playwright/test";

const CHECK = "http://localhost:3002/dash-0109-check";

test.describe("one revenue series, and it is not billed revenue", () => {
  test("the invoiced series is gone and the title says which revenue this is", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    await expect(main.getByText("Delivered revenue vs direct cost")).toBeVisible();
    // Series names live in the canvas aria-label — Chart.js paints its legend
    // as pixels. Exactly two series, and Invoiced is not one of them.
    await expect(main.getByRole("img", { name: "Delivered revenue — Direct cost" })).toBeVisible();
    await expect(main.getByRole("img", { name: /Invoiced/ })).toHaveCount(0);
    await expect(main).not.toContainText(/Invoiced revenue/i);
    expect(errors).toEqual([]);
  });

  test("the card says earned-not-billed and points at where billed revenue lives", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // A number that deliberately does not match Reports has to say so, or
    // someone eventually compares it to the P&L and files a bug.
    await expect(main).toContainText(/Earned, not billed/i);
    await expect(main).toContainText(/recorded on the day the trip ran/i);
    await expect(main).toContainText(/does not match Reports and feeds no margin/i);
    // Billed revenue still exists on the page — in the KPI tile, not the chart.
    await expect(main).toContainText(/billed revenue stays in Reports/i);
    // The tile is uppercased by CSS, so the DOM text is "Revenue".
    await expect(main.getByText("Revenue", { exact: true })).toBeVisible();
    await expect(main.getByText("70,650 SAR")).toBeVisible();
  });

  test("the direct-cost disclosure lost its invoiced-revenue sentence", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    await expect(main).toContainText(/Direct cost is not full cost/i);
    await expect(main).toContainText(/31,300 SAR/);
    // That trailing sentence explained why the INVOICED bars were lumpy. With
    // the series gone it would describe something not on screen — and it is
    // not true of what replaced it, since delivered revenue lands on trip_date,
    // not on invoice-confirm day. Reworded it would have been wrong.
    await expect(main).not.toContainText(/lands on the day an invoice was confirmed/i);
  });
});

// WHERE THE 0109 FIX IS PROVEN, and why not here. The regression 0109 fixed is
// numeric — under 0108 August rendered revenue on THREE days (one holding 310
// trips) because delivered_at records when the stage button was pressed, not
// when the work happened. Chart.js is a module import, so page.evaluate cannot
// reach Chart.getChart to read plotted values, and adding test-only data
// attributes to production code to work around that is not worth it. The
// spread is asserted in 0109's own verification block instead: 35 populated
// days, no single-day spike, and zero disagreements with
// v_delivery_output_daily. These tests cover what the UI owns.
test.describe("chart plumbing", () => {
  test("the month stepper still drives the chart", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    await expect(main).toContainText(/daily — August 2026/i);
    await page.getByRole("button", { name: /Previous month/i }).first().click();
    await page.waitForTimeout(600);
    await expect(main).toContainText(/daily — July 2026/i);
    // The disclosure follows the month, so its excluded figure changes too.
    await expect(main).toContainText(/37,720 SAR/);
  });
});

test("the unpriced-trip gap is disclosed only where it exists", async ({ page }) => {
  await page.goto(CHECK);
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // August has none — an unconditional disclaimer is noise that trains the
  // reader to skip it.
  await expect(main).not.toContainText(/has no project, so it has no rate/i);

  // July holds the one delivered trip with no project. It contributes 0 rather
  // than a guessed price, so the figure is qualified out loud.
  await page.getByRole("button", { name: /Previous month/i }).first().click();
  await page.waitForTimeout(600);
  await expect(main).toContainText(/1 delivered trip this month has no project/i);
  await expect(main).toContainText(/no price was assumed for it/i);
});
