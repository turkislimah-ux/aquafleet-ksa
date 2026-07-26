import { test, expect } from "@playwright/test";

// Verifies the 7-item polish round (design-only) against the throwaway
// /inv-polish-test diagnostic route (mock data, no auth). See that route's
// header comment and CLAUDE.md's entry for this stage.
//
// Mock parts: FLT-001 (qty 100, reorder 10 -> "Current"/green), BRK-002
// (qty 12, reorder 10 -> "Low stock"/amber), AIR-003 (qty 5, reorder 10 ->
// "Depleted"/red, critical tier).

test.describe("Inventory polish round (design-only)", () => {
  test("item 1 — part picker shows qty + stock-state color", async ({ page }) => {
    await page.goto("/inv-polish-test");
    await page.getByRole("button", { name: /New Purchase Order/ }).click();

    const modal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    await expect(modal).toBeVisible();

    // Custom PartPicker button (not a native <select>) — click to open its
    // popover listbox.
    await modal.getByText("Pick a part to add…").click();

    const airRow = modal.locator("button", { hasText: "AIR-003" });
    await expect(airRow).toBeVisible();
    await expect(airRow.locator(".bg-rose-500")).toHaveCount(1); // Depleted/critical dot
    await expect(airRow).toContainText("5 pc");

    const brkRow = modal.locator("button", { hasText: "BRK-002" });
    await expect(brkRow.locator(".bg-amber-500")).toHaveCount(1); // Low stock dot

    const fltRow = modal.locator("button", { hasText: "FLT-001" });
    await expect(fltRow.locator(".bg-emerald-500")).toHaveCount(1); // Current/healthy dot
  });

  test("item 2 — row actions match preview: labeled View, icon-only chart, primary cart on critical rows only", async ({
    page,
  }) => {
    await page.goto("/inv-polish-test");

    const criticalRow = page.locator("tr", { hasText: "AIR-003" });
    await expect(criticalRow.getByRole("button", { name: "View" })).toBeVisible();
    await expect(criticalRow.getByTitle("Financial report")).toBeVisible();
    await expect(criticalRow.getByTitle("Quick reorder")).toBeVisible();
    await expect(criticalRow.getByTitle("Quick reorder")).toHaveClass(/bg-brand-600/);

    // A healthy-stock row gets View + chart, but NO quick-reorder button.
    const okRow = page.locator("tr", { hasText: "FLT-001" });
    await expect(okRow.getByRole("button", { name: "View" })).toBeVisible();
    await expect(okRow.getByTitle("Financial report")).toBeVisible();
    await expect(okRow.getByTitle("Quick reorder")).toHaveCount(0);
  });

  // FOLLOW-UP FIX — these now assert the ACTUAL COMPUTED background-color
  // (toHaveCSS), not just class-string presence (toHaveClass). The class
  // string was already present before the fix too — the real bug was
  // Card's own ".card" CSS (globals.css, plain CSS declared AFTER
  // `@tailwind utilities`) silently winning the cascade at equal
  // specificity, so a className-only check would have passed even while
  // the tint never rendered. toHaveCSS reads getComputedStyle, so it
  // actually proves the pixels are right this time.
  test("item 3a — supplier-info box actually RENDERS a faded baby-blue background", async ({ page }) => {
    await page.goto("/inv-polish-test");
    await page.getByRole("button", { name: /New Purchase Order/ }).click();
    const poModal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    const supplierBox = poModal.getByText("Supplier contact").locator("..");
    await expect(supplierBox).toHaveCSS("background-color", "rgba(11, 126, 234, 0.06)");
  });

  test("item 3b — pricing-snapshot (green) + financial-summary (purple) actually RENDER their tints", async ({
    page,
  }) => {
    await page.goto("/inv-polish-test");
    await page.locator("tr", { hasText: "FLT-001" }).first().click();
    const pricingCard = page.getByText("Pricing snapshot", { exact: true }).locator("../..");
    await expect(pricingCard).toHaveCSS("background-color", "rgba(16, 185, 129, 0.05)");
    const finCard = page.getByText("Financial summary", { exact: true }).locator("../..");
    await expect(finCard).toHaveCSS("background-color", "rgba(139, 92, 246, 0.05)");
  });

  test("item 4 — warehouse tabs use the underline style, not a filled-pill segmented control", async ({ page }) => {
    await page.goto("/inv-polish-test");

    const tabBar = page.locator("div.border-b", { has: page.getByText("Riyadh Main") });
    await expect(tabBar).toBeVisible();
    const activeTab = page.getByRole("button", { name: "Riyadh Main" });
    await expect(activeTab).toHaveClass(/border-b-2/);
    await expect(activeTab).toHaveClass(/border-brand-600/);
    // The old pill-segmented-control container class must be gone.
    await expect(tabBar).not.toHaveClass(/rounded-xl/);
  });

  test("item 5 — New PO button reads \"New Purchase Order\"", async ({ page }) => {
    await page.goto("/inv-polish-test");
    await expect(page.getByRole("button", { name: "New Purchase Order" })).toBeVisible();
  });

  test("item 6 — AI-Suggest header button carries the AI purple/blue gradient", async ({ page }) => {
    await page.goto("/inv-polish-test");
    const aiBtn = page.getByRole("button", { name: /AI-Suggest/ });
    await expect(aiBtn).toHaveClass(/from-\[#8b5cf6\]/);
    await expect(aiBtn).toHaveClass(/to-\[#0b7eea\]/);
  });

  test("item 7 — Adjust Item edits descriptive info, SKU locked, no quantity field", async ({ page }) => {
    await page.goto("/inv-polish-test");
    await page.locator("tr", { hasText: "FLT-001" }).first().click();
    await page.getByRole("button", { name: /Adjust Item/ }).click();

    await expect(page.getByRole("heading", { name: "Adjust Item" })).toBeVisible();

    // SKU shown read-only (plain text box, not an editable input) and
    // pre-filled with the real value.
    const skuBox = page.getByText("FLT-001").last();
    await expect(skuBox).toBeVisible();

    // Fields pre-filled from the real part.
    await expect(page.getByLabel(/Item \/ Equipment name/i)).toHaveValue("Oil Filter");
    await expect(page.getByLabel(/Name \(Arabic\)/i)).toHaveValue("فلتر زيت");

    // GUARDRAIL — no quantity-on-hand FIELD anywhere on this form (the
    // modal's own explanatory copy legitimately uses the word "quantity"
    // to describe the guardrail itself — getByLabel only matches a real
    // form label/input pairing, not prose, so it's the precise check here).
    await expect(page.getByLabel(/qty on hand/i)).toHaveCount(0);
    await expect(page.getByLabel(/^quantity$/i)).toHaveCount(0);

    // Editing name and saving is NOT exercised here — updatePart() is a
    // real, auth-gated server action; this diagnostic route has no
    // Supabase session. Turki's own in-browser check covers the real save.
  });

  // ADD 1 — widen the part picker + font cleanup, both Add Parts and New PO.
  test("addition 1 — part picker is widened and uses a sku · name separator, in Add Parts and New PO", async ({
    page,
  }) => {
    await page.goto("/inv-polish-test");

    // Add Parts (header button -> ReceivePartsModal).
    await page.getByRole("button", { name: /^Add Parts/ }).click();
    const addPartsModal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByText("Line items") });
    const addPartsPickerWrap = addPartsModal.locator("div.w-\\[380px\\]");
    await expect(addPartsPickerWrap).toBeVisible();
    await addPartsPickerWrap.getByText("Pick a part to add…").click();
    await expect(addPartsModal.locator("button", { hasText: "FLT-001" })).toContainText(/FLT-001\s*·\s*Oil Filter/);

    // New PO (header button -> NewPOModal) — same widened picker + separator.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /New Purchase Order/ }).click();
    const poModal = page
      .locator("div.card.p-6")
      .filter({ has: page.getByRole("heading", { name: "New Purchase Order" }) });
    const poPickerWrap = poModal.locator("div.w-\\[380px\\]");
    await expect(poPickerWrap).toBeVisible();
    await poPickerWrap.getByText("Pick a part to add…").click();
    await expect(poModal.locator("button", { hasText: "FLT-001" })).toContainText(/FLT-001\s*·\s*Oil Filter/);
  });

  // ADD 2 — Add Part popup shows supplier info the same way New PO does:
  // blank "—" until picked, then the SupplierContactCard.
  test("addition 2 — Add Part popup shows supplier info like New PO (both real entry points, right after picking it)", async ({
    page,
  }) => {
    await page.goto("/inv-polish-test");

    // FOLLOW-UP FIX: the card was already mounted and worked (proved via a
    // direct DOM dump) but sat at the very BOTTOM of the form, after 6
    // other fields — technically present, practically invisible without
    // scrolling. Now it's a `col-span-2` grid item directly under the
    // Supplier field, same prominence as New PO's own card. Checked via
    // BOTH real entry points this time (New PO's "+ New Item" AND Add
    // Parts' own "+ New Item") — the earlier pass only checked one.
    async function checkAddPartModal(addPartModal: ReturnType<typeof page.locator>) {
      await expect(addPartModal).toBeVisible();

      const card = addPartModal.getByText("Supplier contact", { exact: true }).locator("../..");
      await expect(card.getByText("—", { exact: true })).toBeVisible();

      // Prominence — the card sits ABOVE Category, not below every other
      // field. (Category is the field right after it now.)
      const cardBox = await card.boundingBox();
      const categoryBox = await addPartModal.getByText("Category *", { exact: true }).boundingBox();
      expect(cardBox).not.toBeNull();
      expect(categoryBox).not.toBeNull();
      expect(cardBox!.y).toBeLessThan(categoryBox!.y);

      await addPartModal.locator("select", { hasText: "None yet" }).selectOption("sup1");
      await expect(card.getByText("Acme Parts")).toBeVisible();
      await expect(card.getByText("أكمي للقطع")).toBeVisible();
    }

    await page.getByRole("button", { name: /New Purchase Order/ }).click();
    await page.getByRole("button", { name: /New Item/ }).click();
    await checkAddPartModal(
      page.locator("div.card.p-6").filter({ has: page.getByRole("heading", { name: "New item / equipment" }) })
    );

    // Fresh page for the second entry point instead of navigating back
    // through nested "Cancel" buttons (AddPartModal is nested inside
    // NewPOModal, so "Cancel" is ambiguous between the two).
    await page.goto("/inv-polish-test");
    await page.getByRole("button", { name: /^Add Parts/ }).click();
    await page.getByRole("button", { name: /New Item/ }).click();
    await checkAddPartModal(
      page.locator("div.card.p-6").filter({ has: page.getByRole("heading", { name: "New item / equipment" }) })
    );
  });
});
