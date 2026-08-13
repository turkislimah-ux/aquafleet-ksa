// Daily revenue vs DIRECT cost (migration 0104).
//
// Depends on VERIFY_BYPASS=1 and the throwaway /dash-daily-check route, both
// removed at the end of this pass — same convention as every prior phase.
// Documents what was verified; not a standing regression suite.
//
// WHAT THESE TWO TESTS ARE FOR:
//   1. the honesty path — with no session the 0104 views correctly refuse to
//      answer, and the card must say it could not READ, never "No data yet"
//   2. the populated path — the labelling rules the metrics dictionary
//      imposes (the cost series is "Direct cost", never "cost"; no margin or
//      profit is derived on this card) plus the excluded-cost disclosure,
//      which is the condition under which a daily cost line is honest at all
//
// The fixture behind /dash-daily-check uses figures pulled LIVE from the two
// views, including July's NEGATIVE non-trip commission (-80 SAR — a real
// deduction, 0098 rule 6), so the disclosure is exercised against a sign it
// would be easy to render wrongly.

import { test, expect } from "@playwright/test";
const BASE = "http://localhost:3002";

test("honest empty: an unread chart says so, never 'No data yet'", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/");
  await page.waitForTimeout(2500);
  const main = page.locator("main");
  await expect(main).toContainText(/Revenue vs direct cost/i);
  await expect(main).toContainText(/Could not read this chart/i);
  await expect(main).not.toContainText(/No data yet/i);
  expect(await main.getByText(/^Revenue vs cost$/).count()).toBe(0);
  expect(errors).toEqual([]);
});

test("populated: labelling rules + disclosure + month stepper", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // Defaults to the LAST month in the data = the current one (August).
  await expect(main).toContainText(/daily — August 2026/i);

  // THE DISCLOSURE. Without it the chart compares full revenue against a
  // fraction of cost. August's excluded figure is 31,300 SAR of payroll.
  await expect(main).toContainText(/Direct cost is not full cost/i);
  await expect(main).toContainText(/31,300 SAR/);
  await expect(main).toContainText(/31,300 SAR payroll/);
  // Zero commission component must not print a pointless ", 0 SAR" clause.
  await expect(main).not.toContainText(/0 SAR commission specials/);

  // LABELLING RULE from the `daily_direct_cost` caveat: the cost series is
  // "Direct cost", never bare "cost" and never "Operating cost".
  //
  // Asserted on the canvas aria-label, which is where those names exist as
  // TEXT. The first version of this check filtered <div> by text and took
  // .first(), which silently resolved to the whole page wrapper — so it
  // passed for the wrong reason until "operating cost" appeared elsewhere on
  // the page and exposed it. A negative assertion on an unscoped locator
  // proves nothing.
  await expect(main.getByRole("img", { name: "Revenue — Direct cost" })).toBeVisible();

  // No margin or profit figure on this card. Enforced upstream, not here:
  // DailyOps carries no margin field at all, so direct_margin_sar is never
  // fetched and there is nothing to mislabel.

  // Step back a month: July, and its own excluded figure, including the
  // NEGATIVE commission adjustment rendered as a negative.
  await page.getByRole("button", { name: /Previous month/i }).first().click();
  await page.waitForTimeout(400);
  await expect(main).toContainText(/daily — July 2026/i);
  await expect(main).toContainText(/37,720 SAR/);
  await expect(main).toContainText(/-80 SAR commission specials, adjustments and bonus/);

  // Forward again, and the stepper disables at the newest month.
  await page.getByRole("button", { name: /Next month/i }).first().click();
  await page.waitForTimeout(400);
  await expect(main).toContainText(/daily — August 2026/i);
  await expect(page.getByRole("button", { name: /Next month/i }).first()).toBeDisabled();

  console.log("ERRORS:", JSON.stringify(errors));
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Delivery Output (migration 0105). Replaces the monthly Trips-delivered
// area chart. Same two paths: honest-empty with no session, and populated
// against the throwaway route.
// ---------------------------------------------------------------------------

test("Delivery Output replaces Trips delivered and states its proxy caveat", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  await expect(main).toContainText(/Delivery Output/i);
  // The chart it replaces must be GONE, not merely moved.
  expect(await main.getByText(/^Trips delivered$/).count()).toBe(0);

  // THE PROXY CAVEAT. Without it the bars read as measured litres.
  await expect(main).toContainText(/Capacity dispatched, not measured volume/i);
  await expect(main).toContainText(/whether or not it ran full/i);
  await expect(main).toContainText(/no measured volume to show/i);

  // SERIES LABELS. Chart.js paints its legend onto the canvas, so these
  // names are pixels there and text only in the canvas's aria-label — which
  // is also the sole thing a screen reader gets from this chart.
  await expect(
    main.getByRole("img", { name: /Capacity dispatched \(m³\) — Trips delivered/ })
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test("the no-truck shortfall is reconciled on screen, per month", async ({ page }) => {
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // August (the default month) has no truckless delivered trip, so the
  // sentence must NOT appear — an unconditional disclaimer is noise and
  // trains the reader to ignore it when it matters.
  await expect(main).toContainText(/daily — August 2026/i);
  await expect(main).not.toContainText(/have no truck assigned/i);

  // The fixture puts the two truckless trips in July so one step reaches
  // them. IN THE LIVE DATA THEY ARE IN JUNE (29th and 30th) — July has none.
  // What is under test is the sentence, not which month owns the gap.
  await page.getByRole("button", { name: /Previous month/i }).first().click();
  await page.waitForTimeout(400);
  await expect(main).toContainText(/daily — July 2026/i);
  await expect(main).toContainText(/2 of 87 delivered trips this month have no truck assigned/i);
  await expect(main).toContainText(/capacity is missing from the bars/i);
});

test("both daily charts step together — one month, never two", async ({ page }) => {
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // Two cards, two steppers, ONE month. Stepping either moves both; showing
  // different months side by side would be worse than either choice alone.
  const subs = () => main.locator("text=/daily — (July|August) 2026/");
  await expect(subs()).toHaveCount(2);
  await expect(main.locator("text=/daily — August 2026/")).toHaveCount(2);

  // Drive it from the SECOND stepper (Delivery Output's own).
  await page.getByRole("button", { name: /Previous month/i }).nth(1).click();
  await page.waitForTimeout(400);
  await expect(main.locator("text=/daily — July 2026/")).toHaveCount(2);
  await expect(main.locator("text=/daily — August 2026/")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Layout, third pass (Turki): cost mix moved beside the money chart and gained
// a legend; Active Trips halved with Receivables aging beside it.
// ---------------------------------------------------------------------------

test("cost mix sits beside revenue vs direct cost, with a written legend", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // SIDE BY SIDE, not stacked: same row means overlapping vertical extents.
  const money = await main.getByText("Revenue vs direct cost").boundingBox();
  const mix = await main.getByText("Cost mix").boundingBox();
  expect(money && mix).toBeTruthy();
  expect(Math.abs(money!.y - mix!.y)).toBeLessThan(24);
  expect(mix!.x).toBeGreaterThan(money!.x);

  // THE LEGEND. The doughnut had none — Chart.js paints one on the canvas and
  // this app switches it off, so the wedges were unlabelled colour.
  for (const [label, value] of [
    ["Parts", "2,170 SAR"], ["Outsourced", "8,333 SAR"],
    ["Payroll", "31,300 SAR"], ["Commissions", "10 SAR"],
  ]) {
    await expect(main.getByText(label, { exact: true })).toBeVisible();
    await expect(main.getByText(value, { exact: true })).toBeVisible();
  }
});

test("Active Trips is half width, beside aging, with nothing truncated away", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(BASE + "/dash-daily-check");
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  const trips = await main.getByRole("heading", { name: "Active Trips" }).boundingBox();
  const aging = await main.getByRole("heading", { name: "Receivables aging" }).boundingBox();
  expect(Math.abs(trips!.y - aging!.y)).toBeLessThan(24);
  expect(aging!.x).toBeGreaterThan(trips!.x);

  // EVERY FIELD SURVIVED THE HALVING. The long project name is the test —
  // the old single-line row would have truncated it to nothing at this width.
  await expect(main.getByText("BS-226-0041")).toBeVisible();
  // Truck and project are separate spans, so assert them separately.
  await expect(main.getByText("4512 ABC")).toBeVisible();
  await expect(main.getByText("Riyadh North Compound — Phase 2")).toBeVisible();
  await expect(main.getByText("1203 QWE")).toBeVisible();
  await expect(main.getByText("Unassigned")).toBeVisible();
  await expect(main.getByText("In transit").first()).toBeVisible();
  await expect(main.getByText("Loading")).toBeVisible();

  // Aging keeps all four buckets rather than dropping one to fit. Checked on
  // the canvas aria-label — bucket names are painted pixels otherwise.
  await expect(
    main.getByRole("img", { name: "Outstanding by age: 0-30, 31-60, 61-90, 90+" })
  ).toBeVisible();
});
