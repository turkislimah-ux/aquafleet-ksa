// Polish Batch 1 phase C — the ?focus=<entity>:<id> record-deep-link layer.
//
// Depends on the throwaway /focus-verify route + VERIFY_BYPASS=1, both
// removed at the end of this pass. Documents what was verified.
//
// SCOPE NOTE: this proves the MECHANISM (parse, dispatch-once, strip, ignore
// what is not ours) and the href/precision table. It does NOT prove that
// each page's opener pops its modal, because those pages need a real session
// — with no session RLS returns zero rows and every opener correctly finds
// nothing to open. Each opener is a five-line call into a setter that page
// already had (setDetail / setViewPart / setViewPO / setDetailDocId /
// setWarehouseTab / row expansion); Turki's authenticated pass covers them.

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3002/focus-verify";

test("focus param opens the record exactly once", async ({ page }) => {
  await page.goto(`${BASE}?focus=driver%3Aabc-123`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "driver|abc-123");
});

test("the param is stripped so refresh and Back do not re-open", async ({ page }) => {
  await page.goto(`${BASE}?focus=part%3Ap-9`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "part|p-9");
  await expect.poll(() => new URL(page.url()).searchParams.get("focus")).toBeNull();
});

test("other query params survive the strip", async ({ page }) => {
  await page.goto(`${BASE}?tab=staff&focus=part%3Ap-9`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "part|p-9");
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("staff");
});

test("an entity this page does not handle is ignored, not swallowed", async ({ page }) => {
  await page.goto(`${BASE}?focus=invoice%3Ai-1`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "");
  // Left in the URL for whichever page DOES handle it.
  expect(new URL(page.url()).searchParams.get("focus")).toBe("invoice:i-1");
});

test("a malformed focus value does nothing", async ({ page }) => {
  await page.goto(`${BASE}?focus=garbage`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "");
});

test("an id containing a colon is not truncated", async ({ page }) => {
  // parseFocus splits on the FIRST colon only.
  await page.goto(`${BASE}?focus=driver%3Aa%3Ab%3Ac`);
  await expect(page.locator("#fv-log")).toHaveAttribute("data-log", "driver|a:b:c");
});

test.describe("href + precision table", () => {
  test("record-precise entities carry a target, page-precise ones do not", async ({ page }) => {
    await page.goto(BASE);
    const rows = page.locator("#fv-hrefs li");
    const n = await rows.count();
    expect(n).toBe(17);

    for (let i = 0; i < n; i++) {
      const li = rows.nth(i);
      const entity = await li.getAttribute("data-entity");
      const href = (await li.getAttribute("data-href"))!;
      const precision = await li.getAttribute("data-precision");

      if (precision === "record") {
        // Either a real detail route / existing opener, or the shared focus param.
        expect(
          href.includes("focus=") ||
            /\/fleet\/ID1$/.test(href) ||
            /[?&](wo|os|highlightTrip)=ID1/.test(href),
          `${entity} claims record precision but its href targets nothing: ${href}`
        ).toBe(true);
      } else {
        // A weaker landing must NOT emit a focus param nobody consumes.
        expect(href, `${entity} is ${precision} but emits focus=`).not.toContain("focus=");
      }
    }
  });

  test("the four pre-existing openers are reused, not replaced", async ({ page }) => {
    await page.goto(BASE);
    const href = (e: string) =>
      page.locator(`#fv-hrefs li[data-entity="${e}"]`).getAttribute("data-href");
    expect(await href("truck")).toBe("/fleet/ID1");
    expect(await href("work_order")).toBe("/maintenance?wo=ID1");
    expect(await href("outsourced_job")).toBe("/maintenance?os=ID1");
    expect(await href("trip")).toBe("/trips?tab=projects&highlightTrip=ID1");
  });

  test("focus rides alongside an existing tab param rather than replacing it", async ({ page }) => {
    await page.goto(BASE);
    const staff = await page
      .locator('#fv-hrefs li[data-entity="staff"]')
      .getAttribute("data-href");
    expect(staff).toBe("/drivers?tab=staff&focus=staff%3AID1");
  });
});
