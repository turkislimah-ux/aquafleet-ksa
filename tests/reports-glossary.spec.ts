import { test, expect, type Page, type Locator } from "@playwright/test";

// Metrics glossary — Reports → Overview, the "Metrics dictionary" POPUP.
//
// It shipped as a section at the bottom of the Overview tab and was moved into
// a modal launched from the page header (Turki's call). This spec was rewritten
// with it: it now opens the popup through the real button rather than finding a
// section already on the page, so the launcher is under test too.
//
// Drives the THROWAWAY `/reports-glossary-check` route, which mounts the REAL
// ReportsClient against a hardcoded copy of all 30 live `report_metrics` rows.
// The fixture is hardcoded rather than fetched because `report_metrics` is
// RLS'd to `authenticated` and this route has no session — a real fetch there
// returns zero rows and the glossary would render its "could not be read"
// branch, proving nothing.
//
// Same convention as every prior phase: this spec documents what was verified.
// It stops running the moment the diagnostic route is deleted at teardown.

const URL = "/reports-glossary-check";

// The live basis distribution, counted from `report_metrics` itself, in the
// order the glossary groups them: money first (accrual then cash), then
// position, then activity.
const BASES: [string, number][] = [
  ["accrual", 21],
  ["cash", 4],
  ["state", 2],
  ["operational", 3],
];
const TOTAL = 30;

// The three rows with a NULL caveat. The brief for this build asserted all 30
// rows had content in every column; they do not, and these render NO caveat
// block rather than an "N/A" or an em dash that would read as missing data.
const NO_CAVEAT = ["operating_profit", "operations", "os_cost"];

// The longest source_view in the dictionary — 0123's two-source pointer, 169
// chars with no break opportunity in `v_commissions_paid_monthly`. This is the
// string the layout had to survive, and the popup's `xl:grid-cols-2` entry grid
// gives it HALF the width the old full-width section did.
const LONG_SOURCE = "v_commissions_monthly (month; trip commission, specials, adjustments and bonus split out)";

function glossary(page: Page): Locator {
  return page.getByRole("dialog", { name: "Metrics dictionary" });
}

function entryFor(page: Page, key: string): Locator {
  return glossary(page)
    .locator("div.py-3.border-t")
    .filter({ has: page.getByText(key, { exact: true }) });
}

async function openGlossary(page: Page) {
  await page.getByRole("button", { name: "Metrics dictionary" }).click();
  await expect(glossary(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
});

test("the launcher sits beside the period picker, and only on Overview", async ({ page }) => {
  const button = page.getByRole("button", { name: "Metrics dictionary" });
  const period = page.getByText("Period", { exact: true });

  // Both in the header, side by side — same row, button to the right.
  await expect(button).toBeVisible();
  await expect(period).toBeVisible();
  const bBox = await button.boundingBox();
  const pBox = await period.boundingBox();
  expect(bBox).not.toBeNull();
  expect(pBox).not.toBeNull();
  expect(Math.abs(bBox!.y - pBox!.y)).toBeLessThan(24);
  expect(bBox!.x).toBeGreaterThan(pBox!.x);

  // Nothing is open until it is clicked.
  await expect(glossary(page)).toHaveCount(0);

  // Tab 2 carries its own period control and its own use of the dictionary
  // (as the builder's fence) — no second launcher there.
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(button).toHaveCount(0);
  await expect(period).toHaveCount(0);
});

test("all 30 metrics render in the popup, grouped by basis", async ({ page }) => {
  await openGlossary(page);
  const g = glossary(page);

  // One <dl> per metric entry (Formula / Grain / Source view).
  await expect(g.locator("dl")).toHaveCount(TOTAL);
  await expect(g.getByText("30 metrics.")).toBeVisible();

  // Group containers are the direct children of the list wrapper, so indexing
  // them asserts the READING ORDER as well as the membership.
  const groups = g.locator("div.space-y-6 > div");
  await expect(groups).toHaveCount(BASES.length);

  for (const [i, [basis, count]] of BASES.entries()) {
    const group = groups.nth(i);
    await expect(group.getByRole("heading", { level: 4 })).toHaveText(basis);
    await expect(group.locator("dl")).toHaveCount(count);
  }
});

test("every entry shows meaning, formula, grain and source view", async ({ page }) => {
  await openGlossary(page);
  const g = glossary(page);
  await expect(g.getByText("Formula", { exact: true })).toHaveCount(TOTAL);
  await expect(g.getByText("Grain", { exact: true })).toHaveCount(TOTAL);
  await expect(g.getByText("Source view", { exact: true })).toHaveCount(TOTAL);

  // Spot-check one row end to end.
  const entry = entryFor(page, "collections");
  await expect(entry.getByText("Collections", { exact: true })).toBeVisible();
  await expect(entry.getByText("Cash actually received against invoices in the month.")).toBeVisible();
  await expect(entry.getByText("v_collections_monthly", { exact: true })).toBeVisible();
});

test("the long two-source pointers wrap inside their cell", async ({ page }) => {
  await openGlossary(page);
  const cell = glossary(page).locator("dd").filter({ hasText: LONG_SOURCE }).first();
  await expect(cell).toBeVisible();

  // Wrapped, not clipped: the cell's content does not extend past its own box.
  const overflow = await cell.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // And the cell itself stays inside the dialog — a cell that overflowed its
  // container would still report scrollWidth === clientWidth.
  const cellBox = await cell.boundingBox();
  const cardBox = await glossary(page).boundingBox();
  expect(cellBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cellBox!.x + cellBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

  // It really did wrap: more than one line tall for an 11px font.
  expect(cellBox!.height).toBeGreaterThan(20);
});

test("nothing overflows its box at either column count", async ({ page }) => {
  // The entry grid is two columns from `xl` up and one below it, so the text
  // cells are NARROWEST at a wide viewport — the opposite of the usual
  // assumption, and the reason both widths are checked rather than just the
  // small one.
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    await openGlossary(page);

    const overflowing = await glossary(page).evaluate((root) => {
      const bad: string[] = [];
      for (const el of Array.from(root.querySelectorAll("dd, code, p, h4"))) {
        if (el.scrollWidth - el.clientWidth > 1) bad.push(el.textContent?.slice(0, 40) ?? "");
      }
      return bad;
    });
    expect(overflowing, `overflowing at ${width}px`).toEqual([]);
  }
});

test("a NULL caveat renders nothing at all", async ({ page }) => {
  await openGlossary(page);
  for (const key of NO_CAVEAT) {
    const entry = entryFor(page, key);
    await expect(entry).toHaveCount(1);
    // Meaning is the only <p>; a caveat would add a second one.
    await expect(entry.locator("p")).toHaveCount(1);
    await expect(entry.getByText("N/A")).toHaveCount(0);
  }

  // A row that HAS a caveat shows two paragraphs — proves the check above is
  // measuring something real rather than a selector that never matches.
  await expect(entryFor(page, "collections").locator("p")).toHaveCount(2);
});

test("the filter narrows the list and says so when nothing matches", async ({ page }) => {
  await openGlossary(page);
  const g = glossary(page);
  const search = g.getByLabel("Filter metrics");

  await search.fill("payroll");
  const shown = await g.locator("dl").count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(TOTAL);
  await expect(g.getByText(`${shown} of 30 shown.`)).toBeVisible();

  await search.fill("zzzzz");
  await expect(g.locator("dl")).toHaveCount(0);
  await expect(g.getByText("No metric matches")).toBeVisible();

  await search.fill("");
  await expect(g.locator("dl")).toHaveCount(TOTAL);
});

test("Esc, the close button and the backdrop all dismiss it", async ({ page }) => {
  await openGlossary(page);
  await page.keyboard.press("Escape");
  await expect(glossary(page)).toHaveCount(0);

  await openGlossary(page);
  await glossary(page).getByRole("button", { name: "Close" }).click();
  await expect(glossary(page)).toHaveCount(0);

  await openGlossary(page);
  // Top-left of the viewport is backdrop — the panel is centred.
  await page.mouse.click(4, 4);
  await expect(glossary(page)).toHaveCount(0);
});
