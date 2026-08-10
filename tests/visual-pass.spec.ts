// Polish Batch 1 — visual pass. Verifies the presentation changes did not
// disturb the mechanics underneath them, and that the theming/focus work
// actually lands in the computed styles (not merely in the class list —
// that mistake is on the record: an earlier polish round asserted
// toHaveClass and passed while the rule was being overridden, see
// CLAUDE.md §7's .card background trap).
//
// Depends on the throwaway /vis-verify route + VERIFY_BYPASS=1.

import { test, expect, type Page } from "@playwright/test";

const U = "http://localhost:3002/vis-verify";

async function boot(page: Page, theme: "light" | "dark", lang: "en" | "ar") {
  await page.goto(U);
  await page.waitForSelector('input[role="combobox"]');
  await page.waitForTimeout(900); // let the shell hydrate before writing prefs
  await page.evaluate(([t, l]) => {
    localStorage.setItem("theme", t as string);
    localStorage.setItem("lang", l as string);
  }, [theme, lang]);
  await page.reload();
  await page.waitForSelector('input[role="combobox"]');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(theme === "dark");
  await page.waitForTimeout(400);
}

test("color-scheme follows the theme, so native controls theme too", async ({ page }) => {
  await boot(page, "dark", "en");
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  ).toBe("dark");

  await boot(page, "light", "en");
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  ).toBe("light");
});

test("results list contains its own scroll (cannot drive the dock)", async ({ page }) => {
  await boot(page, "light", "en");
  const input = page.locator('input[role="combobox"]');
  await input.click();
  await input.fill("re");
  await page.waitForTimeout(400);
  const list = page.locator('[id] >> css=.overflow-y-auto').first();
  await expect(list).toHaveCSS("overscroll-behavior-y", "contain");
});

test("keyboard focus paints a visible ring; a mouse click does not", async ({ page }) => {
  await boot(page, "light", "en");
  const bell = page.getByRole("button", { name: "Notifications" });

  await bell.click();
  const afterClick = await bell.evaluate((e) => getComputedStyle(e).outlineStyle);
  await page.keyboard.press("Escape");

  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await bell.focus();
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    el.matches(":focus-visible"); // force style resolution
  });
  const afterFocus = await bell.evaluate((e) => getComputedStyle(e).outlineStyle);

  expect(afterFocus).toBe("solid");
  expect(afterClick).not.toBe("solid");
});

test("the dock still moves 1:1 after the visual changes", async ({ page }) => {
  await boot(page, "light", "en");
  const y = () =>
    page.evaluate(() => {
      const el = document
        .querySelector('input[role="combobox"]')!
        .closest('div[style*="translateX"]') as HTMLElement;
      return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    });

  const start = await y();
  expect(start).toBeGreaterThan(120);
  await page.evaluate(() => window.scrollTo(0, 140));
  await page.waitForTimeout(160);
  expect(Math.abs(start - (await y()) - 140)).toBeLessThan(3);
});

test("the hero glow is present at rest and gone once docked", async ({ page }) => {
  await boot(page, "light", "en");
  const glow = page.locator('div[style*="radial-gradient"]').first();
  const op = async () => parseFloat(await glow.evaluate((e) => getComputedStyle(e).opacity));

  expect(await op()).toBeGreaterThan(0.5);
  await page.evaluate(() => window.scrollTo(0, 5000));
  await page.waitForTimeout(300);
  expect(await op()).toBeLessThan(0.05);
});

test("header keeps h-14 (Reports print isolation depends on it)", async ({ page }) => {
  await boot(page, "light", "en");
  await expect(page.locator("header.h-14")).toHaveCount(1);
});

test("the shortcut hint reads left-to-right under RTL", async ({ page }) => {
  await boot(page, "light", "ar");
  const kbd = page.locator("kbd").first();
  await expect(kbd).toHaveAttribute("dir", "ltr");
  // A non-breaking space, not a plain one — the combo must never wrap.
  expect(await kbd.innerText()).toMatch(/ /);
});

test("the shortcut hint yields once the panel is open", async ({ page }) => {
  await boot(page, "light", "en");
  const kbd = page.locator("kbd").first();
  expect(parseFloat(await kbd.evaluate((e) => getComputedStyle(e).opacity))).toBe(1);
  await page.locator('input[role="combobox"]').click();
  await page.waitForTimeout(250);
  expect(parseFloat(await kbd.evaluate((e) => getComputedStyle(e).opacity))).toBe(0);
});

test("results are announced to assistive tech", async ({ page }) => {
  await boot(page, "light", "en");
  await page.locator('input[role="combobox"]').click();
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
});
