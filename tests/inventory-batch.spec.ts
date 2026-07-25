import { test, expect } from "@playwright/test";

// Verifies the 4-item follow-up batch against the throwaway
// /inv-batch-test diagnostic route (mock data, no auth) — see that route's
// header comment and CLAUDE.md's entry for this batch. DELETE this file
// (or leave it, per Turki's own call) once the batch is confirmed; the
// route it depends on is deleted before commit either way.

test.describe("Inventory follow-up batch (4 items)", () => {
  test("item 1 — single-part quick-reorder locks warehouse, prefills qty/supplier", async ({ page }) => {
    await page.goto("/inv-batch-test");

    // Oil Filter (FLT-001) is the critical-stock part (qty_on_hand 4 <=
    // reorder_level 10) — its row should show the quick-reorder button.
    const row = page.locator("tr", { hasText: "FLT-001" });
    await expect(row).toBeVisible();
    await row.getByTitle("Quick reorder").click();

    const modal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    await expect(modal).toBeVisible();

    // Warehouse locked to the part's own warehouse (Riyadh Main / wh1) —
    // every option still renders, but Jeddah Yard (wh2) is disabled.
    const whSelect = modal.locator("select").nth(1);
    await expect(whSelect).toHaveValue("wh1");
    await expect(modal.getByText(/Locked — this part only exists/)).toBeVisible();
    // Playwright's toBeDisabled()/toBeEnabled() don't reliably reflect an
    // <option>'s own disabled attribute (it's not a "form control" in its
    // actionability model) — assert the attribute directly instead.
    const jeddahOption = whSelect.locator('option[value="wh2"]');
    await expect(jeddahOption).toHaveJSProperty("disabled", true);
    const riyadhOption = whSelect.locator('option[value="wh1"]');
    await expect(riyadhOption).toHaveJSProperty("disabled", false);

    // Supplier prefilled from the part's last PO (po1 -> sup1, Acme Parts).
    const supplierSelect = modal.locator("select").nth(0);
    await expect(supplierSelect).toHaveValue("sup1");
    // Supplier card should already show Acme Parts + its Arabic name (item 3
    // logic reused here — the card follows supplierId regardless of how it
    // got set). Scoped to the card itself (the "Supplier contact" label's
    // own parent), not the <option> in the select above, which also
    // contains the text "Acme Parts".
    const supplierCard = modal.getByText("Supplier contact", { exact: true }).locator("..");
    await expect(supplierCard.getByText("Acme Parts")).toBeVisible();
    await expect(supplierCard.getByText("أكمي للقطع")).toBeVisible();

    // Qty prefilled to clear the reorder level: max(1, 10 - 4 + 1) = 7.
    const qtyInput = modal.locator("tbody tr", { hasText: "FLT-001" }).locator('input[type="number"]').first();
    await expect(qtyInput).toHaveValue("7");
  });

  test("item 3 — New PO supplier card has no default, updates on pick", async ({ page }) => {
    await page.goto("/inv-batch-test");
    await page.getByRole("button", { name: /New PO/ }).click();

    const modal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    await expect(modal).toBeVisible();

    // Blank "—" until a supplier is picked.
    const card = modal.getByText("Supplier contact", { exact: true }).locator("..");
    await expect(card.getByText("—", { exact: true })).toBeVisible();

    const supplierSelect = modal.locator("select").nth(0);
    await supplierSelect.selectOption("sup1");

    await expect(card.getByText("Acme Parts")).toBeVisible();
    await expect(card.getByText("أكمي للقطع")).toBeVisible();
  });

  test("item 2 — Approvals queue shows Actual Total from received qty x price", async ({ page }) => {
    await page.goto("/inv-batch-test");
    await page.getByRole("button", { name: /Approvals/ }).click();

    // received_qty 18 * received_unit_price_sar 22 = 396.00.
    const row = page.locator("tr", { hasText: "PO-0001" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("396");
  });

  test("item 4 — auto-SKU defaults to an unused SKU-#### and stays editable", async ({ page }) => {
    await page.goto("/inv-batch-test");
    await page.click("#open-add-part");

    // NOT name-based — default is "SKU-" + any number not already used by
    // an existing SKU (mock parts are FLT-001/BRK-002, so no collision risk
    // either way). Typing the name must NOT change the SKU.
    const skuInput = page.getByLabel(/^SKU/);
    const initialSku = await skuInput.inputValue();
    expect(initialSku).toMatch(/^SKU-\d+$/);

    const nameInput = page.getByLabel(/Item \/ Equipment name/i);
    await nameInput.fill("Radiator Hose");
    await expect(skuInput).toHaveValue(initialSku);

    // Stays editable.
    await skuInput.fill("MY-CUSTOM-SKU");
    await expect(skuInput).toHaveValue("MY-CUSTOM-SKU");
  });
});
