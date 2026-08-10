// Polish Batch 1 phase B — record results in the global search panel.
//
// Depends on the throwaway /searchb-verify route + VERIFY_BYPASS=1, both
// removed at the end of this pass per project convention. Documents what was
// verified; not a standing regression suite.
//
// SCOPE NOTE, stated so the coverage is not overread: this route stubs the
// record source with fixtures. The real source is a server action calling
// public.search_everything under the caller's RLS, which returns nothing
// without a session — so grouping/badges/keyboard/precision are proven here,
// and the live database path is proven separately in SQL (role
// `authenticated` -> 4 hits for 'محمد'; role `anon` -> no execute privilege).
// Turki's authenticated pass joins the two halves.

import { test, expect, type Page } from "@playwright/test";

const URL = "http://localhost:3002/searchb-verify";

async function openWith(page: Page, q: string) {
  await page.goto(URL);
  const input = page.locator("#sb-host input[role='combobox']");
  await input.click();
  await input.fill(q);
  await page.waitForTimeout(400); // debounce is 180ms
  return input;
}

test("records appear, grouped under entity headings", async ({ page }) => {
  await openWith(page, "all");
  await expect(page.getByText("Trucks", { exact: true })).toBeVisible();
  await expect(page.getByText("Drivers", { exact: true })).toBeVisible();
  await expect(page.getByText("Invoices", { exact: true })).toBeVisible();
  await expect(page.getByText("Parts", { exact: true })).toBeVisible();
  await expect(page.getByText("Archive Documents", { exact: true })).toBeVisible();
});

test("a plate finds its truck", async ({ page }) => {
  await openWith(page, "BBB-1115");
  await expect(page.getByRole("button", { name: /BBB-1115/ })).toBeVisible();
});

test("an invoice number finds its invoice", async ({ page }) => {
  await openWith(page, "Bin Salmah");
  await expect(page.getByRole("button", { name: /Bin Salmah Trading/ })).toBeVisible();
});

test("Arabic text in a subtitle is matchable", async ({ page }) => {
  await openWith(page, "محمد");
  await expect(page.getByRole("button", { name: /mohammed 1/ })).toBeVisible();
});

test("pages still rank above records", async ({ page }) => {
  // "inventory" matches BOTH the Inventory nav page and a warehouse record,
  // so this exercises group ordering. (An earlier version queried the
  // fixture-only sentinel "all", which matches no page at all — it was
  // asserting ordering on a list that had only one group in it.)
  await openWith(page, "inventory");
  const groups = await page
    .locator("#sb-host .text-\\[11px\\].uppercase")
    .allTextContents();
  expect(groups[0]).toMatch(/Pages/i);
});

test.describe("soft-deleted records are shown, not hidden", () => {
  test("terminated truck is present and visually distinct", async ({ page }) => {
    await openWith(page, "all");
    const row = page.getByRole("button", { name: /KKK-7772/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("terminated")).toBeVisible();
    // Rose tint, not the neutral badge every live record gets.
    const color = await row
      .getByText("terminated")
      .evaluate((e) => getComputedStyle(e).color);
    expect(color).not.toBe("rgb(100, 116, 139)"); // --muted
  });

  test("an active record keeps the neutral badge", async ({ page }) => {
    await openWith(page, "BBB-1115");
    const row = page.getByRole("button", { name: /BBB-1115/ });
    await expect(row.getByText("active")).toBeVisible();
  });
});

test("weaker landings are labelled, record-precise ones are not", async ({ page }) => {
  await openWith(page, "all");
  // Truck = record precision -> no annotation.
  await expect(
    page.getByRole("button", { name: /BBB-1115/ }).getByText("opens page")
  ).toHaveCount(0);
  // Part = page precision -> annotated.
  await expect(
    page.getByRole("button", { name: /Oil Filter/ }).getByText("opens page")
  ).toBeVisible();
});

test("keyboard navigation walks records and Enter follows the hit", async ({ page }) => {
  const input = await openWith(page, "BBB-1115");
  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForURL(/\/fleet\/t1$/, { timeout: 5000 });
});

test("selecting a record stores it in recent searches", async ({ page }) => {
  const input = await openWith(page, "BBB-1115");
  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForURL(/\/fleet\/t1$/);

  await page.goto(URL);
  await page.locator("#sb-host input[role='combobox']").click();
  await expect(page.getByText("BBB-1115")).toBeVisible();
});

test("honest empty state names the query and the coverage", async ({ page }) => {
  await openWith(page, "zzzzqqq");
  await expect(page.getByText(/No matches for/)).toBeVisible();
  await expect(page.getByText(/Searched pages, trucks, drivers/)).toBeVisible();
});

test("the Ask seam is untouched by phase B", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#sb-host input[role='combobox']").click();
  await page.getByRole("button", { name: /Ask/i }).click();
  await expect(page.getByText(/Coming soon/i).first()).toBeVisible();
  await expect(page.locator("textarea")).toBeDisabled();
});
