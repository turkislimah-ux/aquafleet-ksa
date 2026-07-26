import { test, expect } from "@playwright/test";

// Verifies VAT-on-parts-invoices (migration 0056's app-code follow-up)
// against the throwaway /inv-vat-test diagnostic route (mock data, no
// auth) — see that route's header comment and CLAUDE.md's entry for this
// stage. Mock data has TWO purchase orders: po1 (real VAT, as 0056's RPCs
// would store it: 10 x 25 SAR = 250 subtotal, 37.5 VAT, 287.5 total) and
// po2 ("legacy" — booked before 0056, VAT columns at plain default/null:
// 4 x 20 = 80, 0 VAT, 80 total) — so both the real-VAT path and the
// honest-zero-VAT-for-old-records path get covered, not just the happy path.
//
// formatSarVat() (lib/inventory-vat.ts) uses formatNum(x, 2) — NOT padded
// to 2 decimals (37.5, not "37.50") — assertions below match that exactly.

test.describe("Inventory VAT (migration 0056 UI)", () => {
  test("New PO — VAT column after unit price, stacked subtotal/VAT/total", async ({ page }) => {
    await page.goto("/inv-vat-test");
    await page.getByRole("button", { name: /New PO/ }).click();

    const modal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    await expect(modal).toBeVisible();

    // Add a line: Oil Filter, qty 10 @ 25 SAR -> subtotal 250, VAT 37.5, total 287.5.
    await modal.locator("select").filter({ hasText: "Pick a part to add" }).selectOption("58408bf7-1cea-4d24-a19a-92fdad90b549");
    await modal.getByRole("button", { name: /Add line/ }).click();

    const row = modal.locator("tbody tr", { hasText: "ACD - 2002" });
    await expect(row).toBeVisible();
    const qtyInput = row.locator('input[type="number"]').first();
    const priceInput = row.locator('input[type="number"]').nth(1);
    await qtyInput.fill("10");
    await priceInput.fill("25");

    // VAT column sits right after unit price, before Subtotal.
    await expect(modal.locator("thead")).toContainText("VAT (15%)");
    await expect(row).toContainText("37.5 SAR"); // per-line VAT
    await expect(row).toContainText("250 SAR"); // subtotal = unit price x qty

    // Actual-total block: subtotal (pre-VAT), then VAT, then bold total.
    const footer = modal.locator("tfoot");
    await expect(footer).toContainText("250 SAR");
    await expect(footer).toContainText("37.5 SAR");
    await expect(footer).toContainText("287.5 SAR");
  });

  test("Approvals — Actual Total stacks subtotal/VAT/total; legacy PO reads honest zero-VAT", async ({ page }) => {
    await page.goto("/inv-vat-test");
    await page.getByRole("button", { name: /Approvals/ }).click();

    // po1 — real VAT (stored by 0056's RPCs): 250 subtotal, 37.5 VAT, 287.5 total.
    const row1 = page.locator("tr", { hasText: "PO-0001" });
    await expect(row1).toBeVisible();
    await expect(row1).toContainText("250 SAR");
    await expect(row1).toContainText("37.5 SAR");
    await expect(row1).toContainText("287.5 SAR");

    // po2 — "legacy" (booked before 0056: vat_sar/received_vat_sar are 0/
    // null, NOT back-computed). Reads as the honest pre-VAT amount (80,
    // falling back to summing the real qty*price since received_subtotal_sar
    // is null) with 0 VAT — not fabricated, not silently dropped either.
    const row2 = page.locator("tr", { hasText: "PO-0002" });
    await expect(row2).toBeVisible();
    await expect(row2).toContainText("80 SAR");
    await expect(row2).toContainText("0 SAR");
  });

  test("Add Part — live VAT readout next to unit price, absent until a price is typed", async ({ page }) => {
    await page.goto("/inv-vat-test");
    await page.click("#open-add-part");

    const priceInput = page.getByLabel(/Unit price \(SAR\)/);
    await expect(page.getByText(/VAT \(15%\)/)).toHaveCount(0);

    await priceInput.fill("50");
    await expect(page.getByText(/VAT \(15%\)/)).toBeVisible();
    await expect(page.getByText("7.5 SAR")).toBeVisible(); // 50 x 15%
  });

  test("Part view — stock batches show VAT; Pricing snapshot stays VAT-free", async ({ page }) => {
    await page.goto("/inv-vat-test");
    await page.locator("tr", { hasText: "ACD - 2002" }).first().click();

    // Stock batches (FIFO price_lots) fetches live via a real, auth-gated
    // server action (getPriceLots) — this diagnostic route has no real
    // Supabase session, so RLS returns an empty result here rather than the
    // real DB rows (no error, just "No price batches yet.", same as a part
    // with zero lots would show for a real logged-in user). The column
    // HEADER is static markup, unaffected by that — verifying it confirms
    // the VAT column is wired in; the populated-with-real-data case is
    // Turki's own in-browser check before commit, same as every other
    // stage this session.
    await expect(page.getByText("Stock batches")).toBeVisible();
    const batchesTable = page.locator("table", { has: page.getByText("Qty purchased") });
    await expect(batchesTable).toContainText("VAT (15%)");

    // Pricing snapshot must stay VAT-free — scoped to that card only (the
    // same drawer also has a Financial summary card with real VAT text, so
    // a page-wide check here would be a false pass).
    const pricingCard = page.getByText("Pricing snapshot", { exact: true }).locator("../..");
    await expect(pricingCard).not.toContainText("VAT");
  });

  test("Financial summary — Purchases stat gets VAT; Stock Value/Consumption/Price Trend stay VAT-free", async ({
    page,
  }) => {
    await page.goto("/inv-vat-test");
    await page.locator("tr", { hasText: "ACD - 2002" }).first().click();
    await expect(page.getByText("Financial summary")).toBeVisible();

    // Scoped to the drawer itself — "Stock Value" is ALSO a PartsTable
    // column header rendered behind the (still-mounted) modal, so a
    // page-wide lookup would be ambiguous / could false-pass against the
    // wrong element.
    const modal = page.locator("div.card.p-6").filter({ has: page.getByText("Financial summary") });

    // Purchases: totalPurchased 250+80=330, VAT 37.5+0=37.5, total 367.5.
    const purchasesStat = modal.getByText("Purchases", { exact: true }).locator("..");
    await expect(purchasesStat).toContainText("37.5 SAR");
    await expect(purchasesStat).toContainText("367.5 SAR");

    // The other three stats in the same card stay VAT-free.
    const stockValueStat = modal.getByText("Stock Value", { exact: true }).locator("..");
    await expect(stockValueStat).not.toContainText("VAT");
    const consumptionStat = modal.getByText(/Consumption/).locator("..");
    await expect(consumptionStat).not.toContainText("VAT");
    const priceTrendStat = modal.getByText("Price Trend", { exact: true }).locator("..");
    await expect(priceTrendStat).not.toContainText("VAT");
  });

  test("Part-row chart (purchase history) — VAT column shows real and legacy-zero figures", async ({ page }) => {
    await page.goto("/inv-vat-test");
    // Chart-icon button opens PartFinanceModal (title="Financial report").
    await page.locator("tr", { hasText: "ACD - 2002" }).first().getByTitle("Financial report").click();
    await expect(page.getByText("Purchase history")).toBeVisible();

    const historyTable = page.locator("table", { has: page.getByText("PO #") });
    await expect(historyTable).toContainText("VAT (15%)");

    const row1 = historyTable.locator("tr", { hasText: "PO-0001" });
    await expect(row1).toContainText("37.5 SAR");
    const row2 = historyTable.locator("tr", { hasText: "PO-0002" });
    await expect(row2).toContainText("0 SAR");
  });

  test("Financial Analysis tab stays entirely VAT-free", async ({ page }) => {
    await page.goto("/inv-vat-test");
    await page.getByRole("button", { name: /Financial Analysis/ }).click();
    await expect(page.getByText("Top spend categories")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("VAT");
  });
});
