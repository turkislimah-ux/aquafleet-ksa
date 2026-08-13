// Projects → current month; Drivers Ops → maintenance-aware truck + latest-trip
// stage. Migration 0107.
//
// Depends on the throwaway /dash-0107-check route, deleted at the end of this
// pass (same convention as every prior phase). Documents what was verified.
//
// The fixture carries the LIVE post-0107 figures, plus one project real data
// does not have today — one with zero trips this month — because the
// LEFT-JOIN-not-WHERE rule only shows its teeth on exactly that row.

import { test, expect } from "@playwright/test";

const CHECK = "http://localhost:3002/dash-0107-check";

test.describe("Projects are current-month", () => {
  test("the section says which window it means", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // The same cards used to mean all-time. A reader cannot tell the two apart
    // from the bars, so the window has to be written down.
    await expect(main).toContainText(/this month only, by stage/i);
    await expect(main).toContainText(/the Kanban board shows a single day/i);
    await expect(main).not.toContainText(/every trip per active project/i);
    expect(errors).toEqual([]);
  });

  test("a project with no trips this month still gets a card", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // THE REGRESSION THIS GUARDS. 0107 puts the month filter in the LEFT JOIN;
    // in WHERE it would evaluate after the join and drop every project with no
    // trips this month. Measured on a quiet month: 6 rows vs 0. On the 1st the
    // WHERE form would blank the whole section and read as an outage.
    await expect(main.getByText("Zero This Month", { exact: true })).toBeVisible();
    await expect(main.getByText(/No trips yet/i)).toBeVisible();
    await expect(main.getByText("0 trips", { exact: true })).toBeVisible();

    // The populated cards still render their bars alongside it.
    await expect(main.getByText("Airport facilities", { exact: true })).toBeVisible();
    await expect(main.getByRole("img", { name: /Scheduled: 4.*Delivered: 49/ })).toBeVisible();
  });
});

test.describe("Drivers Ops truck cell", () => {
  test("a truck in the workshop says so — assigned or inferred", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // Three rows carry it live. Two are fallback trip trucks (off_duty), and
    // ONE is an ASSIGNED truck on an `active` driver — Khalid 2. Anything that
    // keyed the flag off the state would miss him, which is why the count is
    // asserted rather than a single row.
    await expect(main.getByText(/in maintenance/i)).toHaveCount(3);

    const khalid2 = main.locator("li").filter({ hasText: "Khalid 2" });
    await expect(khalid2).toContainText("AAA-5552");
    await expect(khalid2).toContainText(/in maintenance/i);
    await expect(khalid2).toContainText("Active");
    // His plate is a real assignment, so it must NOT be labelled as inferred.
    await expect(khalid2).not.toContainText(/from his trip/i);
  });

  test("THE CONTROL CASE: a free truck is not labelled", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // Fahad 2 has the same "off_duty holding in-flight trips" shape as the two
    // maintenance rows, but his trip's truck is free. A blanket label would
    // have been wrong on exactly this row.
    const fahad2 = main.locator("li").filter({ hasText: "Fahad 2" });
    await expect(fahad2).toContainText("1113 BBB");
    await expect(fahad2).not.toContainText(/in maintenance/i);
    // It IS inferred from his trip, though, so it says that.
    await expect(fahad2).toContainText(/from his trip/i);
  });

  test("an inferred plate is never passed off as an assignment", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // Exactly the three rows whose plate came from a trip rather than an
    // assignment: Fahad 2, Khalid 3, mohammed 2.
    await expect(main.getByText(/from his trip/i)).toHaveCount(3);

    // And "No truck" still means genuinely none — not "none, and we did not
    // look". Khan has neither an assignment nor an in-flight trip.
    const khan = main.locator("li").filter({ hasText: "Khan" });
    await expect(khan).toContainText(/No truck/i);
    await expect(khan).not.toContainText(/from his trip/i);
  });

  test("state is untouched — the truck cell got richer, the rule did not change", async ({ page }) => {
    await page.goto(CHECK);
    await page.waitForTimeout(2500);
    const main = page.locator("main");

    // A driver whose only truck is in the workshop still has none AVAILABLE,
    // so he stays off_duty by the canonical rule. The conflict flag is 0106's,
    // unchanged.
    const khalid3 = main.locator("li").filter({ hasText: "Khalid 3" });
    await expect(khalid3).toContainText("Off duty");
    await expect(khalid3).toContainText(/state and trips disagree/i);
    await expect(main.getByText(/state and trips disagree/i)).toHaveCount(3);
  });
});

test("the stage pill reads the driver's NEWEST in-flight trip", async ({ page }) => {
  await page.goto(CHECK);
  await page.waitForTimeout(2500);
  const main = page.locator("main");

  // 0106 showed the most-ADVANCED stage, which answered "what is the best this
  // driver has going" rather than "what is he doing now". Fahad 3 and Khalid 1
  // both have older in_transit trips still running, but their newest trips are
  // scheduled — under 0106 both read "In transit".
  await expect(main.locator("li").filter({ hasText: "Fahad 3" })).toContainText("Scheduled");
  await expect(main.locator("li").filter({ hasText: "Khalid 1" })).toContainText("Scheduled");

  // The workload count is still the FULL number of in-flight trips — the stage
  // describes one trip, the count describes the load.
  await expect(main.locator("li").filter({ hasText: "Khalid 1" })).toContainText("×22");
});
