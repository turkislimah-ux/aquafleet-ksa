// Polish Batch 1 — dashboard-intro dock geometry, header centring, and the
// sub-page tab deep links.
//
// Depends on the throwaway /dock-verify route + VERIFY_BYPASS=1 on the dev
// server, both removed at the end of this pass per project convention.
// Documents what was verified; not a standing regression suite.

import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3002";
const URL = `${BASE}/dock-verify`;

async function dockProgress(page: Page): Promise<number> {
  return page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--dock-progress") || "1"
    )
  );
}

/** The transform-bearing element is GlobalSearch's own root. */
function searchRoot(page: Page) {
  return page.locator('div[style*="translateX"]').filter({ has: page.locator("input") }).first();
}

async function searchTranslateY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document
      .querySelector('input[role="combobox"]')!
      .closest('div[style*="translateX"]') as HTMLElement;
    return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
  });
}

test.describe("header centring", () => {
  test("search bar is centred on the content area, not pushed off by the controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(URL);
    await page.waitForSelector('input[role="combobox"]');
    await page.evaluate(() => window.scrollTo(0, 5000)); // docked
    await page.waitForTimeout(250);

    const header = await page.locator("header.h-14").boundingBox();
    const bar = await searchRoot(page).boundingBox();
    expect(header && bar).toBeTruthy();

    const headerCentre = header!.x + header!.width / 2;
    const barCentre = bar!.x + bar!.width / 2;

    // Was ~190px off with the old grid-cols-[1fr_auto_1fr].
    expect(Math.abs(headerCentre - barCentre)).toBeLessThan(2);
  });

  test("centring holds when the right cluster is much wider (long email)", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(URL);
    await page.waitForSelector('input[role="combobox"]');
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(250);

    const before = (await searchRoot(page).boundingBox())!;

    // Widen the account pill dramatically; the bar must not move.
    await page.evaluate(() => {
      const btn = document.querySelector("header .relative.z-10")!.lastElementChild!
        .querySelector("button") as HTMLElement;
      btn.style.width = "420px";
    });
    await page.waitForTimeout(150);

    const after = (await searchRoot(page).boundingBox())!;
    expect(Math.abs(before.x - after.x)).toBeLessThan(2);
  });
});

test.describe("keyboard hint is platform-correct", () => {
  test("shows Ctrl K on Windows", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "userAgentData", {
        get: () => ({ platform: "Windows" }),
      });
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator("kbd")).toHaveText("Ctrl K");
    await ctx.close();
  });

  test("shows the command glyph on macOS", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      Object.defineProperty(navigator, "userAgentData", {
        get: () => ({ platform: "macOS" }),
      });
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator("kbd")).toHaveText("⌘K");
    await ctx.close();
  });

  test("Ctrl-K opens the panel (not just Cmd-K)", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector('input[role="combobox"]');
    // The shortcut listener is registered in an effect — pressing the key
    // the instant the input exists races hydration and silently no-ops.
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+k");
    await expect(page.getByText("Recent searches", { exact: true })).toBeVisible();
  });
});

test.describe("content peek + bottom fade", () => {
  test("real dashboard content is visible under the bar at rest", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await page.waitForSelector('input[role="combobox"]');
    await page.waitForTimeout(250);

    const kpis = await page.locator("#dv-band-2").boundingBox();
    // The KPI row must start above the fold, not below it.
    expect(kpis!.y).toBeLessThan(900);
    // And a useful amount of it should be on screen.
    expect(900 - kpis!.y).toBeGreaterThan(80);
  });

  test("fade is fully on at rest and gone once docked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await page.waitForSelector("#dv-fade");
    await page.waitForTimeout(250);

    const atRest = parseFloat(
      await page.locator("#dv-fade").evaluate((e) => getComputedStyle(e).opacity)
    );
    expect(atRest).toBeGreaterThan(0.9);

    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(250);
    const docked = parseFloat(
      await page.locator("#dv-fade").evaluate((e) => getComputedStyle(e).opacity)
    );
    expect(docked).toBeLessThan(0.05);
  });

  test("fade never eats clicks", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator("#dv-fade")).toHaveCSS("pointer-events", "none");
  });
});

test.describe("dock geometry", () => {
  test("bar rises 1:1 with the scroll and docks", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector('input[role="combobox"]');
    await page.waitForTimeout(250);

    const startY = await searchTranslateY(page);
    expect(startY).toBeGreaterThan(120);

    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForTimeout(150);
    expect(Math.abs(startY - (await searchTranslateY(page)) - 120)).toBeLessThan(3);

    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(250);
    expect(await dockProgress(page)).toBeCloseTo(1, 2);
    expect(Math.abs(await searchTranslateY(page))).toBeLessThan(2);
  });

  test("reversible, and focus/text survive the travel", async ({ page }) => {
    await page.goto(URL);
    const input = page.locator('input[role="combobox"]');
    await page.waitForTimeout(250);
    const startY = await searchTranslateY(page);

    await input.click();
    await input.fill("fleet");
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(250);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("fleet");

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    expect(Math.abs((await searchTranslateY(page)) - startY)).toBeLessThan(3);
  });

  test("header keeps h-14 (print isolation depends on it)", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator("header.h-14")).toHaveCount(1);
  });
});

// Every sub-page destination search offers must ACTUALLY land on that tab.
// This is the regression guard for the bug caught in review: links that
// navigate but arrive on the page's default tab.
const DESTINATIONS: { href: string; expect: RegExp }[] = [
  { href: "/trips?tab=finance", expect: /Finance\/Invoice/i },
  { href: "/drivers?tab=staff", expect: /Staff/i },
  { href: "/drivers?tab=commissions", expect: /Commission/i },
  { href: "/consumption?tab=usage", expect: /Consumption|Usage/i },
  { href: "/consumption?tab=approvals", expect: /Approvals/i },
  { href: "/reports?tab=statements", expect: /Statements|Reports/i },
  { href: "/archive?tab=truck", expect: /Truck/i },
  { href: "/archive?tab=ledger", expect: /Ledger/i },
];

/**
 * Inventory's two destinations are NOT machine-checkable here, and that is an
 * environment limit rather than a gap in the feature.
 *
 * This harness runs with no Supabase session, so RLS returns zero rows for
 * everything. InventoryClient branches on `warehouses.length === 0` and
 * renders EmptyWarehouseState INSTEAD OF the whole page body — the sub-tab
 * strip never mounts, so there is no active tab to assert against, whatever
 * the URL says. Same limitation recorded for every prior stage's diagnostic
 * route in CLAUDE.md §7.
 *
 * What IS verified below: the routes load and the shell renders. The tab
 * itself reads through the identical useTabParam hook as the eight
 * destinations above, all of which pass. Turki's authenticated pass covers
 * the populated case.
 */
const DATA_GATED = ["/inventory?tab=approvals", "/inventory?tab=analysis"];

test.describe("sub-page deep links land on the right tab", () => {
  for (const d of DESTINATIONS) {
    test(`${d.href}`, async ({ page }) => {
      await page.goto(BASE + d.href);
      await page.waitForLoadState("domcontentloaded");
      // This app has TWO active-tab treatments, both legitimate: the
      // underline convention (TripsTabs, Drivers, Archive) and the filled
      // pill (Inventory's preview-matched .inv-tabs). Match either.
      const active = page.locator(
        '[aria-pressed="true"], .border-brand-600, .text-brand-600, .bg-brand-600'
      );
      await expect(active.filter({ hasText: d.expect }).first()).toBeVisible({ timeout: 15000 });
    });
  }

  for (const href of DATA_GATED) {
    test(`${href} (loads; tab state needs a real session — see note)`, async ({ page }) => {
      const res = await page.goto(BASE + href);
      expect(res?.status()).toBe(200);
      await expect(page.locator("header.h-14")).toBeVisible();
    });
  }
});
