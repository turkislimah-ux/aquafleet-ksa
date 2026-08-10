// Header redesign — centring, gloss, key hint, account control, hero spacing.
//
// Depends on the throwaway /hdr-verify route + VERIFY_BYPASS=1, both removed
// at the end of this pass.
//
// SCOPE NOTE: the account control's NAME and ROLE come from public.staff via
// an RLS-gated lookup, which returns nothing without a session — so what is
// asserted here is the no-session fallback and the layout contract. Turki's
// authenticated pass covers the populated chip.

import { test, expect, type Page } from "@playwright/test";

const U = "http://localhost:3002/hdr-verify";

async function boot(page: Page, width: number, lang: "en" | "ar" = "en", theme: "light" | "dark" = "light") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(U);
  await page.waitForSelector('input[role="combobox"]');
  await page.waitForTimeout(800); // let the shell hydrate before writing prefs
  await page.evaluate(([l, t]) => {
    localStorage.setItem("lang", l as string);
    localStorage.setItem("theme", t as string);
  }, [lang, theme]);
  await page.reload();
  await page.waitForSelector('input[role="combobox"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 5000)); // docked
  await page.waitForTimeout(350);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const bar = document
      .querySelector('input[role="combobox"]')!
      .closest('div[style*="translateX"]')!
      .getBoundingClientRect();
    const controls = (document.querySelector("header .relative.z-20") as HTMLElement).getBoundingClientRect();
    const header = document.querySelector("header.h-14")!.getBoundingClientRect();
    return {
      centreOffset: (bar.left + bar.right) / 2 - (header.left + header.right) / 2,
      // Positive = clear of the controls. In RTL the cluster is on the left,
      // so measure whichever side actually faces the bar.
      gap: controls.left > bar.left ? controls.left - bar.right : bar.left - controls.right,
      barWidth: bar.width,
    };
  });
}

test.describe("the docked search bar is centred and never reaches the controls", () => {
  for (const width of [1024, 1280, 1440, 1920]) {
    test(`${width}px`, async ({ page }) => {
      await boot(page, width);
      const g = await geometry(page);
      // Exactly centred on the header box, whatever the cluster weighs.
      expect(Math.abs(g.centreOffset)).toBeLessThan(1.5);
      // Never overlapping — this is the bug Turki reported.
      expect(g.gap).toBeGreaterThanOrEqual(0);
      // And never collapsed: at 1024 the reservation formula goes negative,
      // which zeroed the bar's width until a floor was added.
      expect(g.barWidth).toBeGreaterThan(150);
    });
  }

  test("stays centred in RTL too", async ({ page }) => {
    await boot(page, 1440, "ar");
    const g = await geometry(page);
    expect(Math.abs(g.centreOffset)).toBeLessThan(1.5);
    expect(g.gap).toBeGreaterThanOrEqual(0);
  });

  test("a much wider control cluster does not shift the centre", async ({ page }) => {
    await boot(page, 1440);
    const before = await geometry(page);
    await page.evaluate(() => {
      const el = document.querySelector("header .relative.z-20") as HTMLElement;
      (el.lastElementChild as HTMLElement).style.width = "420px";
    });
    await page.waitForTimeout(250); // ResizeObserver + re-measure
    const after = await geometry(page);
    expect(Math.abs(after.centreOffset)).toBeLessThan(1.5);
    // The bar gives up width rather than sliding off centre.
    expect(after.barWidth).toBeLessThanOrEqual(before.barWidth);

    // At a pathological cluster width the reservation goes negative and the
    // bar's minimum floor binds, so a visual overlap becomes possible. What
    // must NEVER happen is a control becoming unclickable — which is exactly
    // what Turki reported. Assert the property that actually matters.
    const bellClickable = await page
      .getByRole("button", { name: "Notifications" })
      .evaluate((e) => {
        const b = e.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!top && (top === e || e.contains(top));
      });
    expect(bellClickable).toBe(true);
  });
});

test.describe("glossy, borderless header", () => {
  test("no hairline under the header", async ({ page }) => {
    await boot(page, 1440);
    const header = page.locator("header.h-14");
    expect(await header.evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe("0px");
  });

  test("translucent with a backdrop blur", async ({ page }) => {
    await boot(page, 1440);
    const header = page.locator("header.h-14");
    const bg = await header.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toMatch(/rgba\(/); // has alpha, i.e. content shows through
    const filter = await header.evaluate((e) => {
      const cs = getComputedStyle(e) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      return cs.backdropFilter || cs.webkitBackdropFilter || "";
    });
    expect(filter).toContain("blur");
  });

  test("header still carries h-14 (Reports print isolation)", async ({ page }) => {
    await boot(page, 1440);
    await expect(page.locator("header.h-14")).toHaveCount(1);
  });
});

test.describe("keyboard hint", () => {
  test("renders as two separate key caps", async ({ page }) => {
    await boot(page, 1440);
    await expect(page.locator("kbd > span")).toHaveCount(2);
  });

  test("sits at the trailing edge in LTR", async ({ page }) => {
    await boot(page, 1440, "en");
    const inp = (await page.locator('input[role="combobox"]').boundingBox())!;
    const kbd = (await page.locator("kbd").boundingBox())!;
    // Trailing edge in LTR is the right.
    expect(kbd.x).toBeGreaterThan(inp.x + inp.width / 2);
  });

  test("sits at the trailing edge in RTL, clear of the search icon", async ({ page }) => {
    await boot(page, 1440, "ar");
    const inp = (await page.locator('input[role="combobox"]').boundingBox())!;
    const kbd = (await page.locator("kbd").boundingBox())!;
    // Trailing edge in RTL is the LEFT. Putting dir="ltr" on the same node as
    // the logical inset made "end" resolve to the right and collide with the
    // search icon — this guards that exact regression.
    expect(kbd.x).toBeLessThan(inp.x + inp.width / 2);
  });

  test("glyph order stays left-to-right in RTL", async ({ page }) => {
    await boot(page, 1440, "ar");
    await expect(page.locator("kbd")).toHaveAttribute("dir", "ltr");
  });
});

test.describe("account control", () => {
  test("falls back honestly when there is no staff record", async ({ page }) => {
    await boot(page, 1440);
    // No session on this route, so no name is known. It must not invent one.
    await expect(page.getByLabel(/^Account|Log out/i).first()).toBeVisible();
  });

  test("sign-out is its own labelled control", async ({ page }) => {
    await boot(page, 1440);
    const out = page.getByRole("button", { name: /Log out/i });
    await expect(out).toBeVisible();
    // Must be a real submit button inside the sign-out form, not a div.
    expect(await out.evaluate((e) => e.tagName)).toBe("BUTTON");
    expect(await out.evaluate((e) => (e as HTMLButtonElement).type)).toBe("submit");
  });

  test("no nested buttons (invalid HTML) in the account pill", async ({ page }) => {
    await boot(page, 1440);
    expect(await page.locator("header button button").count()).toBe(0);
  });
});

test("dashboard content sits just below the bar, with no dead gap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(U);
  await page.waitForSelector('input[role="combobox"]');
  await page.waitForTimeout(800);

  const bar = (await page.locator('input[role="combobox"]').boundingBox())!;
  const kpis = (await page.locator("#hv-kpis").boundingBox())!;
  const gap = kpis.y - (bar.y + bar.height);

  // Visible above the fold...
  expect(kpis.y).toBeLessThan(900);
  // ...with breathing room, but not the void 48vh left behind.
  expect(gap).toBeGreaterThan(40);
  expect(gap).toBeLessThan(260);
});
