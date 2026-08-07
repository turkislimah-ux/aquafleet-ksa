// Reports — Phase 3 adjustments: print fidelity, enriched Operations, period
// picker placement, and the custom-report seam. Verified against the
// /reports-verify (statements) and /reports-verify2 (full shell) diagnostic
// routes — both throwaway, deleted after this run.
//
// The statements route deliberately MIRRORS AppShell's real structure
// (aside.w-64 + header.h-14 + main), because the print fix works by removing
// those elements from FLOW. Without them present the rules are not exercised
// and the test would pass on a page that never had the bug.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";
const SHELL = "http://localhost:3002/reports-verify2";

const IDS: Record<string, string> = {
  "P&L": "pnl", Revenue: "revenue", Receivables: "receivables",
  Costs: "cost", Operations: "ops", Narrative: "narrative",
};

async function open(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

// --- 1. PRINT --------------------------------------------------------------

test("every statement prints full-width, not indented by the sidebar", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select", "2026-07-01");

  for (const [name, id] of Object.entries(IDS)) {
    await open(page, name);
    await page.emulateMedia({ media: "print" });
    const box = await page.locator(`#${id}-print`).boundingBox();
    // Was ~256px before: visibility:hidden kept the sidebar's layout, so the
    // right-hand column ran off the sheet.
    expect(box!.x, `${name} left offset`).toBeLessThan(20);
    expect(box!.width, `${name} width`).toBeGreaterThan(700);
    await page.emulateMedia({ media: "screen" });
  }
});

test("the print band is paper-only, and carries company, title, period and date", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select", "2026-07-01");
  await open(page, "Revenue");

  // Scoped to the statement: the app shell also carries the company name.
  const band = page.locator("#revenue-print .print-only");

  // Hidden on screen.
  await expect(band).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(band).toBeVisible();
  await expect(band).toContainText("Bin Slimah Group");
  await expect(page.locator("#revenue-print")).toContainText("Revenue statement");
  await expect(page.locator("#revenue-print")).toContainText("Jul 2026");
  await expect(page.locator("#revenue-print")).toContainText("Generated");
});

test("controls do not print", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Quarterly" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Custom report" })).toBeHidden();
});

test("a real PDF is produced for every statement", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select", "2026-07-01");
  for (const name of Object.keys(IDS)) {
    await open(page, name);
    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.length, `${name} pdf`).toBeGreaterThan(1000);
  }
});

// --- 2. OPERATIONS ---------------------------------------------------------

test("operations reports rates computed from period totals", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.selectOption("select", "2026-07-01");
  await open(page, "Operations");

  // Jul: 131 of 166 delivered -> 78.9%.
  await expect(page.locator("tr", { hasText: "Delivery completion rate" })).toContainText("78.9%");
  await expect(page.locator("tr", { hasText: "Not delivered" })).toContainText("35");
  // 131 delivered over 10 trucks -> 13.1
  await expect(page.locator("tr", { hasText: "Delivered trips per truck" })).toContainText("13.1");
  // 4 WOs + 1 OS = 5 events; 5/10 = 0.50
  await expect(page.locator("tr", { hasText: "Maintenance events" }).first()).toContainText("5");
  await expect(page.locator("tr", { hasText: "Maintenance events per truck" })).toContainText("0.50");
});

test("a multi-month rate uses period totals, never an average of months", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Quarterly" }).click();
  await open(page, "Operations");
  // Jul 131/166 + Aug 1/4 -> 132/170 = 77.6%. Averaging the two months
  // (78.9% and 25.0%) would give 52.0% — the wrong answer.
  await expect(page.locator("tr", { hasText: "Delivery completion rate" })).toContainText("77.6%");
  await expect(page.locator("#ops-print")).not.toContainText("52.0%");
});

test("the by-month table shows each month's own exact completion rate", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Quarterly" }).click();
  await open(page, "Operations");
  await expect(page.locator("tr", { hasText: "2026-07" })).toContainText("78.9%");
  await expect(page.locator("tr", { hasText: "2026-08" })).toContainText("25.0%");
});

test("the two unsupported metrics are named as absent, not estimated", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await open(page, "Operations");
  await expect(page.getByText(/idle trucks/)).toBeVisible();
  await expect(page.getByText(/fleet availability/)).toBeVisible();
  await expect(page.getByText(/neither is estimated here/)).toBeVisible();
});

// --- 4. CUSTOM REPORT SEAM -------------------------------------------------

test("custom report opens, states it is not generating, and cannot generate", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Custom report" }).click();
  await expect(page.getByText("Not generating yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
});

test("the seam shows the metric vocabulary it will be bounded to", async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Custom report" }).click();
  await expect(page.getByText(/only from these 3 defined metrics/)).toBeVisible();
  // Scoped to the modal: "Operating margin" is also a P&L row behind it.
  const modal = page.locator(".card", { hasText: "Custom report" }).first();
  await expect(modal.getByText("Operating margin")).toBeVisible();
  await expect(modal.getByText("v_collections_monthly")).toBeVisible();
  // Filtering the vocabulary works.
  await page.getByPlaceholder("Filter metrics").fill("collect");
  await expect(modal.getByText("Operating margin")).toHaveCount(0);
  // .first(): the label and the mono metric_key both read "collections".
  await expect(modal.getByText("Collections", { exact: true }).first()).toBeVisible();
});

// --- 3. PERIOD PICKER ------------------------------------------------------

test("period picker sits below the tabs and only on Overview", async ({ page }) => {
  await page.goto(SHELL);
  await page.waitForLoadState("networkidle");

  const picker = page.locator("label", { hasText: "Period" });
  await expect(picker).toBeVisible();

  // Below the tab bar, not in the page header.
  const tabs = page.getByRole("button", { name: "Overview", exact: true });
  const tabBox = await tabs.boundingBox();
  const pickBox = await picker.boundingBox();
  expect(pickBox!.y).toBeGreaterThan(tabBox!.y);

  // Right-aligned: its right edge sits in the right half of the page.
  const vw = page.viewportSize()!.width;
  expect(pickBox!.x + pickBox!.width).toBeGreaterThan(vw * 0.6);

  // Gone on tab 2, which carries its own period control.
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.locator("label", { hasText: "Period" })).toHaveCount(0);
});
