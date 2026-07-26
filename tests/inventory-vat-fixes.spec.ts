import { test, expect } from "@playwright/test";

// Verifies the 4 VAT DISPLAY fixes (presentation/arrangement only — the
// stored VAT data itself is untouched, no RPC/migration/lib changes) against
// the throwaway /inv-vat-fix-test diagnostic route. See that route's header
// comment and CLAUDE.md's entry for this follow-up.
//
// formatSarVat() (lib/inventory-vat.ts) uses formatNum(x, 2) — NOT padded to
// 2 decimals (37.5, not "37.50") — assertions below match that exactly.

test.describe("Inventory VAT display fixes", () => {
  test("item 1 — Add Part shows a visible VAT + Total readout, not just a faint caption", async ({ page }) => {
    await page.goto("/inv-vat-fix-test");
    await page.click("#open-add-part");

    const priceInput = page.getByLabel(/Unit price \(SAR\)/);
    await priceInput.fill("100");

    // 100 SAR unit price -> VAT 15, Total (incl. VAT) 115.
    await expect(page.getByText("VAT (15%):")).toBeVisible();
    await expect(page.getByText("Total (incl. VAT):")).toBeVisible();
    await expect(page.getByText("15 SAR", { exact: true })).toBeVisible();
    await expect(page.getByText("115 SAR", { exact: true })).toBeVisible();
  });

  test("item 2a — Stock batches: Subtotal renamed Total, VAT-inclusive", async ({ page }) => {
    await page.goto("/inv-vat-fix-test");
    await page.locator("tr", { hasText: "ACD - 2002" }).first().click();

    await expect(page.getByText("Stock batches")).toBeVisible();
    const batchesTable = page.locator("table", { has: page.getByText("Qty purchased") });
    // Old "Subtotal" label is gone; renamed "Total (incl. VAT)".
    await expect(batchesTable).toContainText("Total (incl. VAT)");
    await expect(batchesTable.locator("thead")).not.toContainText("Subtotal");
  });

  test("item 2b — Financial summary Purchases: Total leads, subtotal+VAT breakdown below", async ({ page }) => {
    await page.goto("/inv-vat-fix-test");
    await page.locator("tr", { hasText: "ACD - 2002" }).first().click();
    await expect(page.getByText("Financial summary")).toBeVisible();

    const modal = page.locator("div.card.p-6").filter({ has: page.getByText("Financial summary") });
    const purchasesStat = modal.getByText("Purchases", { exact: true }).locator("..");

    // totalPurchased (250+80=330) + VAT (37.5+0=37.5) = 367.5 total.
    // The bold headline figure must be the TOTAL (367.5), not the subtotal
    // (330) — checked via the bold/font-semibold element specifically.
    await expect(purchasesStat.locator(".font-semibold")).toHaveText("367.5 SAR");
    // The breakdown line underneath still carries both source figures.
    await expect(purchasesStat).toContainText("330 SAR");
    await expect(purchasesStat).toContainText("37.5 SAR");
  });

  test("item 3 — Purchase history: one Total column, total-first with breakdown below", async ({ page }) => {
    await page.goto("/inv-vat-fix-test");
    await page.locator("tr", { hasText: "ACD - 2002" }).first().getByTitle("Financial report").click();
    await expect(page.getByText("Purchase history")).toBeVisible();

    const historyTable = page.locator("table", { has: page.getByText("PO #") });
    // Separate VAT/Cost columns are gone; merged into one "Total (incl. VAT)".
    await expect(historyTable.locator("thead")).toContainText("Total (incl. VAT)");
    await expect(historyTable.locator("thead")).not.toContainText("Cost");

    // po1 row: cost 250 + vat 37.5 = 287.5 total, bold; breakdown below it.
    const row1 = historyTable.locator("tr", { hasText: "PO-0001" });
    await expect(row1.locator(".font-medium")).toHaveText("287.5 SAR");
    await expect(row1).toContainText("250 SAR");
    await expect(row1).toContainText("37.5 SAR");

    // po2 (legacy, 0 VAT) row: total = subtotal, honestly.
    const row2 = historyTable.locator("tr", { hasText: "PO-0002" });
    await expect(row2.locator(".font-medium")).toHaveText("80 SAR");
  });

  test("item 4 — Open PO list total is VAT-inclusive (stored header figure)", async ({ page }) => {
    await page.goto("/inv-vat-fix-test");
    await page.getByRole("button", { name: /Open POs/ }).click();

    await expect(page.getByRole("heading", { name: "Open Purchase Orders" })).toBeVisible();
    await expect(page.getByText("PO Total (incl. VAT)")).toBeVisible();

    // po3 (draft): stored subtotal_sar 500 + vat_sar 75 = total_sar 575 —
    // read directly, not recomputed from lines (5 x 100 = 500 pre-VAT).
    const row = page.locator("tr", { hasText: "PO-0003" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("575 SAR");
    await expect(row).not.toContainText("500 SAR");
  });
});
