// Projects / Cost composition / Drivers Ops — migration 0106.
//
// Depends on the throwaway /dash-0106-check route, deleted at the end of this
// pass (same convention as every prior phase). Documents what was verified;
// not a standing suite.
//
// The fixture carries the LIVE figures pulled from v_project_trip_stages,
// v_cost_composition_monthly and v_drivers_ops_now, plus two rows real data
// does not have today — a zero-cost month and an expired licence — because a
// branch that never renders is a branch that ships unchecked.

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3002";
const CHECK = BASE + "/dash-0106-check";

test.describe("the two charts that replaced Operating margin", () => {
  test("Operating margin is gone; Projects and Cost composition took its place", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // Replaced, not merely moved.
    await expect(main.getByText(/Operating margin/i)).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(main.getByText("Cost composition")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("one compact card per active project, each bar stage-split and self-consistent", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    for (const name of [
      "Airport facilities", "King Salman Park", "King Saud University",
      "RRR T", "The Royal Court of Saudi", "VVV Test 2",
    ]) {
      await expect(main.getByText(name, { exact: true })).toBeVisible();
    }

    // THE RECONCILIATION, on screen: the four stage segments of a bar must
    // account for the trip total printed beside the project name. Read off
    // the bar's own aria-label, which is where the segment values exist as
    // text (the bar itself is coloured divs).
    const label = await main
      .getByRole("img", { name: /Scheduled: \d+/ }).first().getAttribute("aria-label");
    const sum = [...(label ?? "").matchAll(/: (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(sum).toBe(69); // Airport facilities, live: 5 + 0 + 1 + 63

    // Stage colours are the Kanban's own, so a stage reads the same on both
    // screens. Four names, one legend for all six cards.
    for (const stage of ["Scheduled", "Loading", "In transit", "Delivered"]) {
      await expect(main.getByText(stage, { exact: true }).first()).toBeVisible();
    }
  });

  test("a month with no cost renders EMPTY, never five 0% slices", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // THE BUG THIS GUARDS. v_cost_composition_monthly returns NULL shares for
    // a month with no cost. Coercing those to 0 would claim a composition the
    // month does not have — "no cost recorded" and "0% of the cost" are
    // different claims and only one is true.
    await expect(main.getByText(/No cost recorded/i)).toBeVisible();

    // Populated months still read off the P&L's own shares.
    await expect(main.getByRole("img", { name: /Payroll 98\.9%/ })).toBeVisible();
    await expect(main.getByRole("img", { name: /Payroll 54\.7%.*Other expenses 18\.8%/ })).toBeVisible();
    // Every month names its own total beside the bar.
    await expect(main.getByText("69,159 SAR")).toBeVisible();
  });
});

test.describe("Drivers Ops", () => {
  test("Receivables aging is gone; every driver has a row", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    await expect(main.getByText(/Receivables aging/i)).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Drivers Ops" })).toBeVisible();

    // All 12 fixture drivers, none dropped for being awkward.
    for (const n of ["Fahad", "Fahad 2", "Fahad 3", "Khalid 1", "Khalid 2", "Khalid 3",
                     "Khan", "mohammed 1", "mohammed 2", "mohammed 3", "Turki"]) {
      await expect(main.getByText(n, { exact: true })).toBeVisible();
    }
  });

  test("risk first: expired, then expiring, then not recorded, then valid", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    const y = async (name: string) =>
      (await main.getByText(name, { exact: true }).boundingBox())!.y;

    // The fixture deliberately arrives unsorted, so this tests the ordering
    // rather than the input order.
    expect(await y("Expired Licence Test")).toBeLessThan(await y("Fahad 2"));   // expired < expiring
    expect(await y("Fahad 2")).toBeLessThan(await y("Khalid 2"));               // expiring < not_recorded
    expect(await y("Khalid 2")).toBeLessThan(await y("Fahad"));                 // not_recorded < ok
  });

  test("not_recorded is its own status, never dressed up as valid", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // Five of eleven live drivers have no iqama expiry. A missing date is not
    // a passing check.
    // exact: true throughout — "Expired" also matches the driver NAMED
    // "Expired Licence Test", and the pill is the thing under test.
    await expect(main.getByText("Not recorded", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Expired", { exact: true })).toBeVisible();
    await expect(main.getByText("Expiring", { exact: true })).toBeVisible();
    await expect(main.getByText("Valid", { exact: true }).first()).toBeVisible();

    // It must not be coloured like a pass. Slate, not emerald.
    const pill = main.getByText("Not recorded", { exact: true }).first();
    await expect(pill).toHaveClass(/text-slate-600/);
    await expect(pill).not.toHaveClass(/emerald/);
  });

  test("state and trip stage are shown as they are, and the contradiction is named", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // `active` means ASSIGNED, not driving. Three live drivers hold in-flight
    // trips with no truck, so their canonical state is off_duty while work is
    // in progress. Both columns stay honest and the PAIRING is flagged —
    // forcing them to agree would print a falsehood in one of them.
    await expect(main.getByText(/state and trips disagree/i)).toHaveCount(3);

    // A driver with no truck still says so rather than blanking.
    await expect(main.getByText("No truck").first()).toBeVisible();
    // Multi-trip drivers show the count beside the stage.
    await expect(main.getByText("×21")).toBeVisible();
  });
});

test("the drift guard is silent while the two definitions agree", async ({ page }) => {
  await page.goto(CHECK);
  await page.waitForTimeout(2500);
  // Permanent, but costs the reader nothing when healthy — which is what
  // makes it affordable to leave running, and why the last guard (behind a
  // throwaway route) did not survive its own teardown.
  // Scoped to main: Next's dev-mode overlay mounts its own empty role=alert
  // root outside the page tree, so an unscoped count is never 0 in dev.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/Driver state disagrees/i);
});
