// Reports — the structured custom-report builder, verified against the
// /reports-verify diagnostic route (throwaway; deleted after this run).
//
// The point of these tests is the FENCE, not the pixels: a user must not be
// able to assemble a report the semantic layer cannot answer correctly.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

async function openBuilder(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Custom report" }).click();
}
function modal(page: import("@playwright/test").Page) {
  // Scoped on a builder-only string: once a report is generated, the RESULT
  // card is also titled "Custom report" and would match first.
  return page.locator(".card", { hasText: "1 · Group rows by" }).first();
}
// Column buttons expose "<label> <basis>" as their accessible name. Anchoring
// on the full name matters: a bare "Revenue" also matches "Revenue (allocated)".
function colName(label: string) {
  return new RegExp(`^${label.replace(/[()]/g, "\\$&")} (accrual|cash|operational)$`);
}
async function pickColumn(page: import("@playwright/test").Page, label: string) {
  await modal(page).getByRole("button", { name: colName(label) }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select", "2026-07-01");
});

test("builder opens with the defined vocabulary and the three steps", async ({ page }) => {
  await openBuilder(page);
  const m = modal(page);
  await expect(m.getByText("1 · Group rows by")).toBeVisible();
  await expect(m.getByText("2 · Columns")).toBeVisible();
  await expect(m.getByText("3 · Period")).toBeVisible();
  await expect(m.getByRole("button", { name: colName("Revenue") })).toBeVisible();
  await expect(m.getByRole("button", { name: colName("Operating margin") })).toBeVisible();
});

test("Generate is blocked until a column is picked", async ({ page }) => {
  await openBuilder(page);
  await expect(modal(page).getByText("Pick at least one column.")).toBeVisible();
  await expect(modal(page).getByRole("button", { name: "Generate" })).toBeDisabled();
  await pickColumn(page, "Revenue");
  await expect(modal(page).getByRole("button", { name: "Generate" })).toBeEnabled();
});

// --- THE FENCE -------------------------------------------------------------

test("a grouping the picked metrics cannot support is DISABLED, not silently empty", async ({ page }) => {
  await openBuilder(page);
  // Grouping is step 1 for a reason: a column illegal for the current grouping
  // is disabled, so the grouping is chosen first.
  await modal(page).getByRole("button", { name: "By truck" }).click();
  // Maintenance exists per truck and per period, never per customer.
  await pickColumn(page, "Maintenance parts");
  await expect(modal(page).getByRole("button", { name: "By customer" })).toBeDisabled();
  await expect(modal(page).getByRole("button", { name: "By truck" })).toBeEnabled();
});

test("columns illegal for the active grouping are disabled", async ({ page }) => {
  await openBuilder(page);
  await modal(page).getByRole("button", { name: "By truck" }).click();
  // Operating margin is period-only — it has no per-truck meaning.
  await expect(modal(page).getByRole("button", { name: colName("Operating margin") })).toBeDisabled();
  await expect(modal(page).getByRole("button", { name: colName("Total maintenance") })).toBeEnabled();
});

test("only metrics present in the dictionary are offered", async ({ page }) => {
  await openBuilder(page);
  // The fixture dictionary omits payroll_cost's siblings like purchasing_spend.
  await expect(modal(page).getByRole("button", { name: colName("Purchasing spend") })).toHaveCount(0);
  await expect(modal(page).getByRole("button", { name: colName("Collections") })).toBeVisible();
});

// --- GENERATED OUTPUT ------------------------------------------------------

test("by period: ratio columns recompute per row, never averaged", async ({ page }) => {
  await openBuilder(page);
  await pickColumn(page, "Revenue");
  await pickColumn(page, "Operating margin");
  await modal(page).getByRole("button", { name: "Generate" }).click();

  const table = page.locator("#custom-print");
  await expect(table).toBeVisible();
  // Jul has revenue -> 20.5%. Jun and Aug have none -> em dash, not 0.0%.
  await expect(table.locator("tr", { hasText: "Jul 2026" })).toContainText("20.5%");
  await expect(table.locator("tr", { hasText: "Jun 2026" })).toContainText("—");
  await expect(table.locator("tr", { hasText: "Aug 2026" })).toContainText("—");
  await expect(table).not.toContainText("0.0%");
});

test("mixed bases are shown side by side, labelled, and never totalled", async ({ page }) => {
  await openBuilder(page);
  await pickColumn(page, "Revenue");
  await pickColumn(page, "Collections");
  await expect(modal(page).getByText(/You have mixed bases selected/)).toBeVisible();
  await modal(page).getByRole("button", { name: "Generate" }).click();

  const table = page.locator("#custom-print");
  await expect(table).toContainText("accrual");
  await expect(table).toContainText("cash");
  await expect(table).toContainText(/never added together|must never be added/);
  // No total row across columns.
  await expect(table.locator("tr", { hasText: /^Total/ })).toHaveCount(0);
});

test("by customer groups invoice rows", async ({ page }) => {
  await openBuilder(page);
  await modal(page).getByRole("button", { name: "By customer" }).click();
  await pickColumn(page, "Revenue");
  await modal(page).getByRole("button", { name: "Generate" }).click();

  const table = page.locator("#custom-print");
  await expect(table.locator("tr", { hasText: "Al Rajhi Contracting" })).toContainText("40,800 SAR");
  await expect(table.locator("tr", { hasText: "Bin Laden Group" })).toContainText("22,480 SAR");
});

test("by truck keeps the three maintenance measures separate", async ({ page }) => {
  await openBuilder(page);
  await modal(page).getByRole("button", { name: "By truck" }).click();
  await pickColumn(page, "Maintenance parts");
  await pickColumn(page, "Outsourced repairs");
  await pickColumn(page, "Total maintenance");
  await modal(page).getByRole("button", { name: "Generate" }).click();

  const row = page.locator("#custom-print").locator("tr", { hasText: "AAA-5553" });
  await expect(row).toContainText("2,260 SAR");
  await expect(row).toContainText("2,848 SAR");
  await expect(row).toContainText("5,107 SAR");
});

test("the generated report becomes its own printable statement", async ({ page }) => {
  await openBuilder(page);
  await pickColumn(page, "Revenue");
  await modal(page).getByRole("button", { name: "Generate" }).click();

  // A Custom sub-tab appears and owns a print id, like every other statement.
  await expect(page.getByRole("button", { name: "Custom", exact: true })).toBeVisible();
  await expect(page.locator("#custom-print")).toHaveCount(1);
  // And only that one print subtree exists.
  for (const id of ["#pnl-print", "#revenue-print", "#ops-print"]) {
    await expect(page.locator(id)).toHaveCount(0);
  }
});

test("the result can be re-opened for editing", async ({ page }) => {
  await openBuilder(page);
  await pickColumn(page, "Revenue");
  await modal(page).getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Change selection" }).click();
  await expect(modal(page).getByText("2 · Columns")).toBeVisible();
});

// --- THE SEAM --------------------------------------------------------------

test("the natural-language box is present, marked coming soon, and inert", async ({ page }) => {
  await openBuilder(page);
  const m = modal(page);
  await expect(m.getByText("Ask in plain language")).toBeVisible();
  await expect(m.getByText("Coming soon")).toBeVisible();
  await expect(m.getByRole("button", { name: "Interpret" })).toBeDisabled();
  await expect(m.getByText(/only job will be to fill in the builder/)).toBeVisible();
});

test("no NaN or undefined in a generated report", async ({ page }) => {
  await openBuilder(page);
  await pickColumn(page, "Revenue");
  await pickColumn(page, "Operating margin");
  await pickColumn(page, "Collections");
  await modal(page).getByRole("button", { name: "Generate" }).click();
  const body = await page.locator("#custom-print").innerText();
  expect(body).not.toContain("NaN");
  expect(body).not.toContain("undefined");
  expect(body).not.toContain("Infinity");
});
