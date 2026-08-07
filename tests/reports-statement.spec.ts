// Reports — P&L statement (tab 2) verification against the /reports-verify
// diagnostic route (throwaway; deleted after this run). Fixtures are the REAL
// output of v_pnl_by_period after migration 0100.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
});

test("defaults to the newest month and shows the prior period", async ({ page }) => {
  await expect(page.getByText("Aug 2026 · compared with Jul 2026")).toBeVisible();
});

test("an in-flight period is flagged", async ({ page }) => {
  await expect(page.getByText(/This period is still in progress/)).toBeVisible();
});

test("a complete period is not flagged", async ({ page }) => {
  await page.selectOption("select", "2026-07-01");
  await expect(page.getByText(/This period is still in progress/)).toHaveCount(0);
});

test("statement lines and the four cost buckets render", async ({ page }) => {
  await page.selectOption("select", "2026-07-01");
  for (const label of [
    "Revenue", "Parts consumed", "Outsourced repairs", "Payroll", "Commissions",
    "Total operating cost", "Operating profit", "Operating margin", "Net profit",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});

test("July figures are the real ones", async ({ page }) => {
  await page.selectOption("select", "2026-07-01");
  const row = page.locator("tr", { hasText: "Total operating cost" });
  await expect(row).toContainText("56,159 SAR");
  // Scoped by exact cell: the phrase also occurs in the empty-expenses note
  // ("net profit therefore equals operating profit").
  const profit = page.locator("tr").filter({ has: page.getByText("Operating profit", { exact: true }) });
  await expect(profit).toContainText("14,491 SAR");
});

test("THE SIGN-FLIP CASE: quarterly margin is recomputed, not averaged", async ({ page }) => {
  await page.getByRole("button", { name: "Quarterly" }).click();
  await expect(page.getByText("Q3 2026 · compared with Q2 2026")).toBeVisible();
  const margin = page.locator("tr", { hasText: "Operating margin" });
  // -38.7% from the period's own totals. +20.5% would mean the months were averaged.
  await expect(margin).toContainText("-38.7%");
  await expect(margin).not.toContainText("20.5%");
});

test("yearly grain rolls up and marks itself in progress", async ({ page }) => {
  await page.getByRole("button", { name: "Yearly" }).click();
  await expect(page.getByText("2026", { exact: false }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: "Operating margin" })).toContainText("-90.2%");
  await expect(page.getByText(/This period is still in progress/)).toBeVisible();
});

test("margin variance is expressed in points, not percent", async ({ page }) => {
  await page.selectOption("select", "2026-07-01");
  // Jun margin is null, so there is no point difference to show.
  await expect(page.locator("tr", { hasText: "Operating margin" })).toContainText("—");
});

test("empty expenses section explains net equals operating", async ({ page }) => {
  await page.selectOption("select", "2026-07-01");
  await expect(page.getByText(/net profit therefore equals operating profit/)).toBeVisible();
});

test("expenses list per category, as their own section", async ({ page }) => {
  await page.getByTestId("toggle-exp").click();
  await page.selectOption("select", "2026-07-01");
  await expect(page.getByText("Other expenses (recorded manually)")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Rent" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Government fees" })).toBeVisible();
  await expect(page.getByText("12,000 SAR")).toBeVisible();
});

test("controls are excluded from print, the statement is not", async ({ page }) => {
  await expect(page.locator("#pnl-print")).toBeVisible();
  const controls = page.locator(".no-print").first();
  await expect(controls).toHaveClass(/no-print/);
  // The print subtree must not contain the buttons.
  await expect(page.locator("#pnl-print").getByRole("button", { name: "Print" })).toHaveCount(0);
});

test("the footer states the money rules", async ({ page }) => {
  await expect(page.getByText(/stock purchases are not a cost here/)).toBeVisible();
  await expect(page.getByText(/never averaged from its months/)).toBeVisible();
});

test("no NaN or undefined at any grain", async ({ page }) => {
  for (const g of ["Monthly", "Quarterly", "Yearly"]) {
    await page.getByRole("button", { name: g }).click();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("NaN");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("Infinity");
  }
});
