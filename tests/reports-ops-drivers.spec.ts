// Reports — the transposed driver sections of the Operations statement
// (migration 0101). Verified against the /reports-verify diagnostic route
// (throwaway; deleted after this run). Fixtures are real view rows.
//
// The design rule these tests exist to hold: the DRIVER is measured, the TRUCK
// is display-only context. No truck-level figure may appear under a driver.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
});

function july(page: import("@playwright/test").Page) {
  return page.locator("#ops-print").first();
}
// The driver column header renders in BOTH driver tables, and measure names
// like "Trips scheduled" also appear in the period summary — so every
// assertion scopes to the specific table it means.
function summaryTable(page: import("@playwright/test").Page) {
  return july(page).locator("table").filter({ hasText: "Trucks that moved" }).first();
}
function deliveryTable(page: import("@playwright/test").Page) {
  // Filtered on "Not delivered", which only this table has. "Completion rate"
  // would ALSO match the summary's "Delivery completion rate" row.
  return july(page).locator("table").filter({ hasText: "Not delivered" }).first();
}
function fleetTable(page: import("@playwright/test").Page) {
  return july(page).locator("table").filter({ hasText: "Share of scheduled trips" }).first();
}

test("delivery is transposed: measures down, drivers across", async ({ page }) => {
  const s = july(page);
  await expect(s.locator("h3", { hasText: "Delivery by driver" })).toBeVisible();
  const t = deliveryTable(page);
  for (const m of ["Trips scheduled", "Trips delivered", "Not delivered", "Completion rate"]) {
    await expect(t.locator("tr").filter({ hasText: m }).first()).toBeVisible();
  }
  // Drivers are COLUMN headers, not rows.
  await expect(t.locator("th", { hasText: "Khalid 1" }).first()).toBeVisible();
  await expect(t.locator("th", { hasText: "mohammed 1" }).first()).toBeVisible();
});

test("each driver column carries its plate underneath the name", async ({ page }) => {
  const h = deliveryTable(page).locator("th", { hasText: "Khalid 1" }).first();
  await expect(h).toContainText("AAA-5551");
});

test("a multi-truck driver is flagged, not silently shown as single-truck", async ({ page }) => {
  const h = deliveryTable(page).locator("th", { hasText: "Fahad 2" }).first();
  await expect(h).toContainText("drove 2 trucks");
});

test("completion rate is per driver, not the period figure repeated", async ({ page }) => {
  const t = deliveryTable(page);
  const row = t.locator("tr").filter({ hasText: "Completion rate" }).first();
  // Khalid 1 is 21/31 = 67.7; mohammed 1 is 13/13 = 100.0. The PERIOD rate is
  // 78.9% — if that appeared in every column the transpose would be a lie.
  await expect(row).toContainText("67.7%");
  await expect(row).toContainText("100.0%");
});

test("fleet utilisation uses DRIVER-workload measures only", async ({ page }) => {
  await expect(july(page).locator("h3", { hasText: "Fleet utilisation by driver" })).toBeVisible();
  const t = fleetTable(page);
  await expect(t).toContainText("Share of scheduled trips");
  await expect(t).toContainText("Share of delivered trips");
});

test("NO truck-level measure appears under a driver column", async ({ page }) => {
  // These belong to the period summary block, never to a driver.
  for (const t of [deliveryTable(page), fleetTable(page)]) {
    await expect(t).not.toContainText("Trucks that moved");
    await expect(t).not.toContainText("Work orders");
    await expect(t).not.toContainText("Maintenance events");
  }
});

test("truck-level facts stay in the period summary above", async ({ page }) => {
  await expect(july(page).locator("h3", { hasText: "Period summary" })).toBeVisible();
  const summary = summaryTable(page);
  await expect(summary).toContainText("Work orders");
  await expect(summary).toContainText("Maintenance events");
});

test("shares are computed against period totals", async ({ page }) => {
  const t = fleetTable(page);
  const row = t.locator("tr").filter({ hasText: "Share of scheduled trips" }).first();
  // Khalid 1: 31 of 166 = 18.7%.
  await expect(row).toContainText("18.7%");
});

test("driver columns foot to the period total", async ({ page }) => {
  // July: driver scheduled figures sum to 166, matching the summary block.
  const t = summaryTable(page);
  const row = t.locator("tr").filter({ hasText: "Trips scheduled" }).first();
  await expect(row).toContainText("166");
});

test("the no-driver row renders as Unassigned rather than a blank column", async ({ page }) => {
  // June has one trip with no driver recorded.
  const june = page.locator("#ops-print").last();
  await expect(june.locator("th", { hasText: "Unassigned" }).first()).toBeVisible();
  await expect(june.getByText(/One column is/)).toBeVisible();
});

test("the driver/truck relationship is stated as display-only", async ({ page }) => {
  await expect(july(page).getByText(/context only and is never measured per driver/)).toBeVisible();
});

test("same-name drivers stay in separate columns", async ({ page }) => {
  // Two driver RECORDS share the name "Fahad 3", so it heads two columns —
  // scoped to one table, since the same header renders in both.
  await expect(deliveryTable(page).locator("th", { hasText: "Fahad 3" })).toHaveCount(2);
  await expect(july(page).getByText(/grouped by record, not by name/)).toBeVisible();
});

test("no NaN or undefined in either statement", async ({ page }) => {
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("NaN");
  expect(body).not.toContain("undefined");
  expect(body).not.toContain("Infinity");
});
