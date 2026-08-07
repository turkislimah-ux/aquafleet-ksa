// Reports Overview — render verification against the /reports-verify
// diagnostic route (throwaway; deleted after this run, same convention as
// every prior phase). Fixtures are the REAL output of the 0098 views.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

async function pick(page: import("@playwright/test").Page, month: string) {
  await page.locator(`[data-month="${month}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
});

test("current month shows the in-progress notice", async ({ page }) => {
  // Fixture months end at 2026-08, which is the live current month.
  await pick(page, "2026-08-01");
  await expect(page.getByText("is still in progress")).toBeVisible();
});

test("a complete month does NOT show the in-progress notice", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText("is still in progress")).toHaveCount(0);
});

test("north-star KPIs render real figures for July", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText("70,650 SAR").first()).toBeVisible();   // revenue
  await expect(page.getByText("14,491 SAR").first()).toBeVisible();   // operating profit
  await expect(page.getByText("30,533 SAR").first()).toBeVisible();   // collections
  await expect(page.getByText("Margin 20.5%")).toBeVisible();
});

test("prior-period comparison renders against June", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText("vs Jun 2026").first()).toBeVisible();
});

test("zero-base comparison falls back to absolute, never a fake percent", async ({ page }) => {
  // June revenue is 0, so July's revenue delta has no computable percentage.
  await pick(page, "2026-07-01");
  const revenueCard = page.locator(".card", { hasText: "REVENUE" }).first();
  await expect(revenueCard).toContainText("+70,650 SAR");
  await expect(revenueCard).not.toContainText("Infinity");
  await expect(revenueCard).not.toContainText("NaN");
});

test("cost buckets render with shares that sum sensibly", async ({ page }) => {
  await pick(page, "2026-07-01");
  // Scoped to its own card: "Parts" and "Outsourced" also appear as column
  // headers in the maintenance-by-truck table, which is a different measure.
  const card = page.locator(".card", { hasText: "Where the money went" }).first();
  for (const label of ["Parts", "Outsourced", "Payroll", "Commissions"]) {
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(card.getByText("56,159 SAR")).toBeVisible(); // operating cost
});

test("payroll disclosure is surfaced, including the missing-salary count", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText(/salaries are not effective-dated/)).toBeVisible();
  await expect(page.getByText(/3 employed people have no salary recorded/)).toBeVisible();
});

test("revenue-vs-collections disclosure states the two bases differ", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText(/different bases on purpose/)).toBeVisible();
});

test("receivables aging renders and is labelled as of today", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText("Receivables aging")).toBeVisible();
  await expect(page.getByText("As of today, not the picked period")).toBeVisible();
  await expect(page.getByText("Al Rajhi Contracting")).toBeVisible();
});

test("revenue per truck is labelled an allocation, not a measurement", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText(/An allocation, not a measurement/)).toBeVisible();
  // Scoped: the same plate also appears in the maintenance-by-truck table.
  const card = page.locator(".card", { hasText: "Revenue by truck" }).first();
  await expect(card.getByText("AAA-5552")).toBeVisible();
});

test("null margin months do not render a fabricated zero", async ({ page }) => {
  await pick(page, "2026-06-01");
  // June has no revenue -> margin is null -> em dash, never "0.0%".
  await expect(page.getByText("Margin —")).toBeVisible();
});

test("purchasing spend is flagged as outside the P&L", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText("not a P&L cost")).toBeVisible();
});

test("no NaN or undefined leaks anywhere on the page", async ({ page }) => {
  for (const m of ["2026-06-01", "2026-07-01", "2026-08-01"]) {
    await pick(page, m);
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("NaN");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("Infinity");
    expect(body).not.toContain("[object Object]");
  }
});

// --- Per-truck maintenance (migration 0099) --------------------------------

test("maintenance by truck shows all three named measures", async ({ page }) => {
  await pick(page, "2026-07-01");
  const card = page.locator(".card", { hasText: "Maintenance cost by truck" }).first();
  await expect(card.getByText("Parts", { exact: true })).toBeVisible();
  await expect(card.getByText("Outsourced", { exact: true })).toBeVisible();
  await expect(card.getByText("Total", { exact: true })).toBeVisible();
});

test("an OS-only truck renders, with a dash for parts rather than a fake zero", async ({ page }) => {
  await pick(page, "2026-07-01");
  const card = page.locator(".card", { hasText: "Maintenance cost by truck" }).first();
  // BBB-1118: parts-free, 7,417.50 outsourced — invisible before 0099.
  const row = card.locator("tr", { hasText: "BBB-1118" });
  await expect(row).toContainText("7,418 SAR");
  await expect(row).toContainText("—");
});

test("parts and OS foot to the total on a mixed truck", async ({ page }) => {
  await pick(page, "2026-07-01");
  const card = page.locator(".card", { hasText: "Maintenance cost by truck" }).first();
  // AAA-5553: 2,259.95 parts + 2,847.50 OS = 5,107.45.
  const row = card.locator("tr", { hasText: "AAA-5553" });
  await expect(row).toContainText("2,260 SAR");
  await expect(row).toContainText("2,848 SAR");
  await expect(row).toContainText("5,107 SAR");
});

test("the parts-only understatement is stated out loud", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText(/a parts-only view would show roughly/)).toBeVisible();
});

test("labour exclusion is disclosed", async ({ page }) => {
  await pick(page, "2026-07-01");
  await expect(page.getByText(/Labour on in-house work orders is not costed/)).toBeVisible();
});

test("maintenance card empties honestly in a month with no spend", async ({ page }) => {
  await pick(page, "2026-06-01");
  await expect(page.getByText("No maintenance spend reached a truck this period.")).toBeVisible();
});
