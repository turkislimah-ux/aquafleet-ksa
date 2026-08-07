// Reports Phase 3 — the remaining tab-2 statements + the narrative, verified
// against the /reports-verify diagnostic route (throwaway; deleted after this
// run). Fixtures mirror real view output.
//
// NOTE: like every prior phase's spec in this repo, this file documents what
// was verified at the time — it needs its own diagnostic route AND its own
// fixture set to run. A later round that changes either (the Phase 3
// adjustments narrowed the fixtures and dropped the yearly period) will show
// failures here that are not product regressions. tests/reports-phase3-fixes
// .spec.ts is the current one.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

async function open(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
  // The picker defaults to the NEWEST period (Aug 2026), which is correct
  // behaviour but empty in these fixtures. July is the month with data.
  await page.selectOption("select", "2026-07-01");
});

test("all six statements are reachable", async ({ page }) => {
  for (const s of ["P&L", "Revenue", "Receivables", "Costs", "Operations", "Narrative"]) {
    await expect(page.getByRole("button", { name: s, exact: true })).toBeVisible();
  }
});

test("only ONE print subtree exists at a time", async ({ page }) => {
  const ids = ["#pnl-print", "#revenue-print", "#receivables-print", "#cost-print",
    "#ops-print", "#narrative-print"];
  for (const [i, name] of ["P&L", "Revenue", "Receivables", "Costs", "Operations", "Narrative"].entries()) {
    await open(page, name);
    for (const [j, id] of ids.entries()) {
      await expect(page.locator(id)).toHaveCount(i === j ? 1 : 0);
    }
  }
});

// --- Revenue ---------------------------------------------------------------

test("revenue groups by customer with paid and outstanding split", async ({ page }) => {
  await open(page, "Revenue");
  const row = page.locator("tr", { hasText: "Al Rajhi Contracting" });
  await expect(row).toContainText("40,800 SAR");
  await expect(row).toContainText("4,244 SAR");     // outstanding
  await expect(page.locator("tr", { hasText: "Bin Laden Group" })).toContainText("22,480 SAR");
});

test("sales returns are their OWN line, never netted into revenue", async ({ page }) => {
  await open(page, "Revenue");
  await expect(page.getByText("Sales returns (reversed invoicing)")).toBeVisible();
  const ret = page.locator("tr", { hasText: "126-000009" });
  await expect(ret).toContainText("Duplicate billing");
  await expect(ret).toContainText("28,960 SAR");
  // Revenue total must EXCLUDE the reversal: 40,800+22,480+7,370 = 70,650.
  await expect(page.locator("tr", { hasText: "Total" }).first()).toContainText("70,650 SAR");
});

// --- Receivables -----------------------------------------------------------

test("receivables show bands and open invoices oldest first", async ({ page }) => {
  await open(page, "Receivables");
  // Scoped to the header: the closing note also contains "as of today".
  await expect(page.locator("#receivables-print header")).toContainText("As of today");
  const rows = page.locator("#receivables-print tbody tr");
  // Aging table first; the open-invoice table lists the 127-day one before the 18-day one.
  await expect(page.locator("tr", { hasText: "Nesma Trading" })).toContainText("127");
  const openRows = page.locator("tr", { hasText: /126-0000(04|12)/ });
  await expect(openRows.first()).toContainText("Nesma Trading");
  await expect(rows.first()).toBeVisible();
});

test("day colouring matches the Overview convention", async ({ page }) => {
  await open(page, "Receivables");
  // 127 days -> rose (>90); 18 days -> no colour class.
  const old = page.locator("tr", { hasText: "Nesma Trading" }).locator("span", { hasText: "127" });
  await expect(old).toHaveClass(/rose/);
});

// --- Costs -----------------------------------------------------------------

test("per-truck maintenance keeps all THREE measures separate", async ({ page }) => {
  await open(page, "Costs");
  const row = page.locator("tr", { hasText: "AAA-5553" });
  await expect(row).toContainText("2,260 SAR");   // parts
  await expect(row).toContainText("2,848 SAR");   // outsourced
  await expect(row).toContainText("5,107 SAR");   // total
  // The parts-free truck shows a dash, not a fake zero.
  await expect(page.locator("tr", { hasText: "BBB-1118" })).toContainText("—");
});

test("purchasing is labelled NOT a P&L cost", async ({ page }) => {
  await open(page, "Costs");
  await expect(page.getByText(/Purchasing — procurement and cash, NOT a P&L cost/)).toBeVisible();
  await expect(page.getByText(/a purchase is inventory until it is consumed/)).toBeVisible();
});

test("payroll carries both disclosures", async ({ page }) => {
  await open(page, "Costs");
  await expect(page.getByText(/not effective-dated/)).toBeVisible();
  await expect(page.getByText(/3 employed people have no salary recorded/)).toBeVisible();
  // A per-month state must be reported as the peak, not summed.
  await expect(page.getByText(/highest month rather than added up/)).toBeVisible();
});

test("commissions earned and paid sit side by side and are never summed", async ({ page }) => {
  await open(page, "Costs");
  await expect(page.getByText("Earned (accrual)")).toBeVisible();
  await expect(page.getByText("Paid (cash)")).toBeVisible();
  await expect(page.getByText(/never added together/)).toBeVisible();
  // Earned = 2226.02 + 20 - 100 + 0 = 2146.02; paid = 1840. No 3,986 anywhere.
  await expect(page.locator("tr", { hasText: "Total earned" })).toContainText("2,146 SAR");
  await expect(page.locator("tr", { hasText: "Total paid" })).toContainText("1,840 SAR");
  await expect(page.locator("#cost-print")).not.toContainText("3,986");
});

// --- Operations ------------------------------------------------------------

test("operational counts add, trucks active does not", async ({ page }) => {
  await open(page, "Operations");
  // Month grain by default -> July only: 166 trips, 131 delivered, 10 trucks.
  await expect(page.locator("tr", { hasText: "Trips scheduled" })).toContainText("166");
  await expect(page.locator("tr", { hasText: "Trips delivered" })).toContainText("131");
  // Row relabelled "Trucks that moved" when the statement gained its
  // utilisation section — the non-additivity warning is unchanged in substance.
  await expect(page.getByText(/Trucks that moved does not add/)).toBeVisible();
});

test("a multi-month period reports peak trucks, not a sum", async ({ page }) => {
  await page.getByRole("button", { name: "Quarterly" }).click();
  await open(page, "Operations");
  // Jul(10) + Aug(1): trips SUM to 170, trucks must show 10 — never 11.
  await expect(page.locator("tr", { hasText: "Trips scheduled" })).toContainText("170");
  const trucks = page.locator("tr", { hasText: "Trucks that moved" });
  await expect(trucks).toContainText("10");
  await expect(trucks).toContainText("most in any one month");
  await expect(trucks).not.toContainText("11");
});

// --- Narrative -------------------------------------------------------------

test("narrative is computed from the period's own figures", async ({ page }) => {
  await open(page, "Narrative");
  // The title renders twice: the print-only band (first in DOM, hidden on
  // screen) and the screen header. Target the header explicitly.
  await expect(page.locator("#narrative-print header")).toContainText("Jul 2026 in review");
  await expect(page.getByText(/Revenue was 70,650 SAR/)).toBeVisible();
  await expect(page.getByText(/Operating profit was 14,491 SAR/)).toBeVisible();
  await expect(page.getByText(/20.5% margin/)).toBeVisible();
});

test("narrative names the largest cost and the sales returns", async ({ page }) => {
  await open(page, "Narrative");
  await expect(page.getByText(/largest cost was payroll/)).toBeVisible();
  await expect(page.getByText(/reversed as sales returns/)).toBeVisible();
});

test("narrative flags a loss-making quarter honestly", async ({ page }) => {
  await page.getByRole("button", { name: "Quarterly" }).click();
  await open(page, "Narrative");
  await expect(page.getByText(/ran at a loss of 27,321 SAR/)).toBeVisible();
});

test("narrative reports receivables as a position, not a period figure", async ({ page }) => {
  await open(page, "Narrative");
  await expect(page.getByText(/position as of today, not a figure for the period/)).toBeVisible();
});

// --- Global ----------------------------------------------------------------

test("no NaN or undefined across every statement and grain", async ({ page }) => {
  for (const grain of ["Monthly", "Quarterly"]) {
    await page.getByRole("button", { name: grain }).click();
    for (const s of ["P&L", "Revenue", "Receivables", "Costs", "Operations", "Narrative"]) {
      await open(page, s);
      const body = await page.locator("body").innerText();
      expect(body, `${grain}/${s}`).not.toContain("NaN");
      expect(body, `${grain}/${s}`).not.toContain("undefined");
      expect(body, `${grain}/${s}`).not.toContain("Infinity");
      expect(body, `${grain}/${s}`).not.toContain("[object Object]");
    }
  }
});
