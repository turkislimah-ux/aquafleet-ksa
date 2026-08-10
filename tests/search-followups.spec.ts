// Polish Batch 1 — the two follow-ups that close global search:
//   1. report types as destinations (?statement=)
//   2. invoice record precision via click-through resolution
//
// Depends on the throwaway /f2-verify route + VERIFY_BYPASS=1, both removed
// at the end of this pass.
//
// SCOPE NOTE: the invoice modal actually POPPING needs a real session — the
// resolver is an RLS-gated query that correctly returns null with no user.
// What is proven here is the href/precision contract, that the focus param
// reaches the invoice consumer, and that the report destinations are
// searchable and land on the right statement. Turki's authenticated pass
// covers the modal itself.

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3002";
const F2 = `${BASE}/f2-verify`;

// ---------------------------------------------------------------- report types
const REPORTS: { q: string; label: RegExp }[] = [
  { q: "P&L", label: /P&L statement/i },
  { q: "revenue statement", label: /Revenue statement/i },
  { q: "receivables", label: /Receivables statement/i },
  { q: "costs", label: /Costs statement/i },
  { q: "operations", label: /Operations statement/i },
  { q: "narrative", label: /Narrative statement/i },
  { q: "custom report", label: /Custom report builder/i },
];

test.describe("report types are search destinations", () => {
  for (const r of REPORTS) {
    test(`"${r.q}" is findable`, async ({ page }) => {
      await page.goto(F2);
      const input = page.locator("#f2-host input[role='combobox']");
      await input.click();
      await input.fill(r.q);
      await page.waitForTimeout(350);
      await expect(page.getByRole("button", { name: r.label }).first()).toBeVisible();
    });
  }

  test("Arabic labels are searchable too", async ({ page }) => {
    await page.goto(F2);
    const input = page.locator("#f2-host-ar input[role='combobox']");
    await input.click();
    await input.fill("الأرباح");
    await page.waitForTimeout(350);
    await expect(page.getByRole("button", { name: /الأرباح/ }).first()).toBeVisible();
  });

  test("Arabic query for the builder works", async ({ page }) => {
    await page.goto(F2);
    const input = page.locator("#f2-host-ar input[role='combobox']");
    await input.click();
    await input.fill("منشئ التقارير");
    await page.waitForTimeout(350);
    await expect(page.getByRole("button", { name: /منشئ التقارير/ }).first()).toBeVisible();
  });
});

test.describe("?statement= is read by the same hook StatementsTab uses", () => {
  // WHY THIS PROBES THE HOOK INSTEAD OF THE REAL PAGE:
  // /reports cannot be exercised without a session. Its views are
  // security_invoker and revoked from anon (migration 0098), so an
  // unauthenticated load returns "permission denied for view v_pnl_monthly",
  // pnlPeriods comes back empty, and StatementsTab renders its own
  // "Nothing to report yet" guard INSTEAD of the statement strip — there is
  // no strip on screen to assert against, whatever the URL says. That is the
  // security model working, not a defect.
  //
  // So the probe below calls useTabParam with StatementsTab's exact keys,
  // default and param name. It proves the reader; Turki's authenticated pass
  // proves the strip. The load-only checks after it prove the routes are
  // reachable and do not error.
  const CASES = ["pnl", "revenue", "receivables", "cost", "operations", "narrative", "custom"];

  for (const key of CASES) {
    test(`?statement=${key} resolves to ${key}`, async ({ page }) => {
      await page.goto(`${F2}?statement=${key}`);
      await expect(page.locator("#f2-statement")).toHaveAttribute("data-statement", key);
    });
  }

  test("an unknown value falls back to pnl rather than blanking", async ({ page }) => {
    await page.goto(`${F2}?statement=nonsense`);
    await expect(page.locator("#f2-statement")).toHaveAttribute("data-statement", "pnl");
  });

  test("no param at all falls back to pnl", async ({ page }) => {
    await page.goto(F2);
    await expect(page.locator("#f2-statement")).toHaveAttribute("data-statement", "pnl");
  });

  test("every report destination URL loads without error", async ({ page }) => {
    for (const key of CASES) {
      const res = await page.goto(`${BASE}/reports?tab=statements&statement=${key}`);
      expect(res?.status(), `?statement=${key}`).toBe(200);
    }
  });
});

// -------------------------------------------------------------------- invoice
test.describe("invoice is record-precise", () => {
  test("href carries the focus param and claims record precision", async ({ page }) => {
    await page.goto(F2);
    const el = page.locator("#f2-invoice");
    await expect(el).toHaveAttribute("data-precision", "record");
    await expect(el).toHaveAttribute("data-href", "/trips?tab=finance&focus=invoice%3AINV1");
  });

  test("the focus param reaches an invoice consumer and is then stripped", async ({ page }) => {
    await page.goto(`${F2}?focus=invoice%3Ainv-42`);
    await expect(page.locator("#f2-log")).toHaveAttribute("data-log", "invoice|inv-42");
    await expect.poll(() => new URL(page.url()).searchParams.get("focus")).toBeNull();
  });

  test("no result row is left claiming a landing it cannot make", async ({ page }) => {
    await page.goto(F2);
    // Invoice moved from "tab" to "record"; it must no longer be annotated.
    const el = page.locator("#f2-invoice");
    expect(await el.getAttribute("data-precision")).not.toBe("tab");
  });
});
