// Polish Batch 1 follow-up — ARIA 1.2 combobox/listbox semantics.
//
// Depends on the throwaway /aria-verify route + VERIFY_BYPASS=1, removed at
// the end of this pass.
//
// These assert the ACCESSIBILITY TREE, not the pixels. Before this change the
// input claimed role="combobox" while controlling a <div> containing no
// options, and rows carried aria-selected on a role that has no such state —
// keyboard navigation was visible on screen and invisible to assistive tech.

import { test, expect, type Page } from "@playwright/test";

const URL = "http://localhost:3002/aria-verify";
const input = (p: Page) => p.locator("#av-host input[role='combobox']");

async function openResults(page: Page) {
  await page.goto(URL);
  const el = input(page);
  await el.click();
  await el.fill("a"); // below the 2-char floor on purpose, then extend
  await el.fill("BBB");
  await page.waitForTimeout(400);
  return el;
}

test.describe("combobox contract", () => {
  test("controls a real listbox and points at a real option", async ({ page }) => {
    const el = await openResults(page);

    const listboxId = await el.getAttribute("aria-controls");
    expect(listboxId).toBeTruthy();

    const listbox = page.locator(`#${listboxId}`);
    await expect(listbox).toHaveAttribute("role", "listbox");

    const activeId = await el.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    const activeEl = page.locator(`#${activeId}`);
    await expect(activeEl).toHaveAttribute("role", "option");
    await expect(activeEl).toHaveAttribute("aria-selected", "true");
  });

  test("declares list autocomplete", async ({ page }) => {
    const el = await openResults(page);
    await expect(el).toHaveAttribute("aria-autocomplete", "list");
  });

  test("aria-activedescendant follows the arrow keys", async ({ page }) => {
    const el = await openResults(page);
    const first = await el.getAttribute("aria-activedescendant");
    await el.press("ArrowDown");
    const second = await el.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    await expect(page.locator(`#${second}`)).toHaveAttribute("aria-selected", "true");
    // Exactly one option may be selected at a time.
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  });

  test("Home and End jump to the ends of the list", async ({ page }) => {
    const el = await openResults(page);
    await el.press("End");
    const lastId = await el.getAttribute("aria-activedescendant");
    const options = page.locator('[role="option"]');
    const n = await options.count();
    await expect(options.nth(n - 1)).toHaveAttribute("id", lastId!);

    await el.press("Home");
    const firstId = await el.getAttribute("aria-activedescendant");
    await expect(options.nth(0)).toHaveAttribute("id", firstId!);
  });

  test("options are not in the tab order (focus stays on the input)", async ({ page }) => {
    const el = await openResults(page);
    const tabIndexes = await page
      .locator('[role="option"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex));
    expect(tabIndexes.every((t) => t === -1)).toBe(true);
    await expect(el).toBeFocused();
  });

  test("every listbox child is an option or a group", async ({ page }) => {
    const el = await openResults(page);
    const listboxId = await el.getAttribute("aria-controls");
    const roles = await page
      .locator(`#${listboxId} > *`)
      .evaluateAll((els) => els.map((e) => e.getAttribute("role")));
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) expect(["option", "group"]).toContain(r);
  });

  test("entity groups are labelled by their heading", async ({ page }) => {
    await openResults(page);
    const group = page.locator('[role="group"]').first();
    const labelledBy = await group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveText(/Trucks/i);
  });
});

test.describe("recent searches are part of the same listbox", () => {
  test("recents are options and are arrow-reachable", async ({ page }) => {
    // Seed a recent by selecting a result.
    const el = await openResults(page);
    await el.press("ArrowDown");
    await el.press("Enter");
    await page.waitForURL(/\/fleet\//);

    await page.goto(URL);
    const el2 = input(page);
    await el2.click();
    await page.waitForTimeout(300);

    const listboxId = await el2.getAttribute("aria-controls");
    await expect(page.locator(`#${listboxId}`)).toHaveAttribute("role", "listbox");
    await expect(page.locator('[role="option"]').first()).toBeVisible();

    // Before this change recents were clickable but the arrow keys skipped
    // them entirely — visible rows the keyboard could not reach.
    const before = await el2.getAttribute("aria-activedescendant");
    expect(before).toBeTruthy();
    await el2.press("Enter");
    await expect(el2).toHaveValue(/BBB/);
  });

  test("the Clear control is NOT inside the listbox", async ({ page }) => {
    const el = await openResults(page);
    await el.press("ArrowDown");
    await el.press("Enter");
    await page.waitForURL(/\/fleet\//);
    await page.goto(URL);
    await input(page).click();
    await page.waitForTimeout(300);

    const listboxId = await input(page).getAttribute("aria-controls");
    // A listbox whose children include a plain button is invalid, and AT
    // counts the stray as an item.
    await expect(page.locator(`#${listboxId} button:not([role="option"])`)).toHaveCount(0);
  });
});

test.describe("Ask mode has no listbox to expand into", () => {
  test("aria-expanded is false and aria-controls is dropped", async ({ page }) => {
    const el = await openResults(page);
    await expect(el).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: /Ask/i }).click();
    await page.waitForTimeout(200);

    await expect(el).toHaveAttribute("aria-expanded", "false");
    expect(await el.getAttribute("aria-controls")).toBeNull();
    expect(await el.getAttribute("aria-activedescendant")).toBeNull();
  });
});

test("closing the panel drops the active descendant", async ({ page }) => {
  const el = await openResults(page);
  expect(await el.getAttribute("aria-activedescendant")).toBeTruthy();
  await el.press("Escape");
  await page.waitForTimeout(200);
  expect(await el.getAttribute("aria-activedescendant")).toBeNull();
  await expect(el).toHaveAttribute("aria-expanded", "false");
});

test("selection still works by mouse", async ({ page }) => {
  await openResults(page);
  await page.getByRole("option", { name: /KKK-7772/ }).click();
  await page.waitForURL(/\/fleet\/t2$/);
});
