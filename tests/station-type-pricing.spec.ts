// Water-station per-type fill pricing — migration 0110, capture phase.
//
// Depends on the VERIFY_BYPASS auth bypass, reverted at the end of this pass.
// Documents what was verified; not a standing suite.
//
// SCOPE NOTE — READ BEFORE TRUSTING THE COVERAGE. This harness has NO Supabase
// session, so RLS returns zero stations and the manage-stations LIST renders
// empty. What is testable here is the FORM, which is client-side: the checkbox
// gating, the at-least-one-type rule, and the guard that refuses a ticked type
// with an empty price. The populated list, the trip-add blocking and the
// filling_cost_sar snapshot need real rows and are Turki's authenticated pass.

import { test, expect } from "@playwright/test";

const TRIPS = "http://localhost:3002/trips";

async function openAddStation(page: import("@playwright/test").Page) {
  await page.goto(TRIPS);
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Manage stations" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Add station/i }).click();
  await page.waitForTimeout(700);
}

test("a station must offer at least one water type", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAddStation(page);

  // Both types start unticked — the form asserts nothing about a new station.
  await expect(page.getByText(/A station must offer at least one water type/i)).toBeVisible();
  // Save is unreachable until a type is picked, mirroring 0110's CHECK so the
  // user gets a sentence rather than a constraint-violation string.
  await expect(page.getByRole("button", { name: /^Add station$/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("the checkbox gates its own price box, and only its own", async ({ page }) => {
  await openAddStation(page);
  const potable = page.getByLabel("Potable fill price", { exact: true });
  const nonPotable = page.getByLabel("Non-potable fill price", { exact: true });

  // Unticked = NOT OFFERED. The box is disabled and says so, rather than
  // sitting empty and inviting a 0 that would mean "fills free".
  await expect(potable).toBeDisabled();
  await expect(nonPotable).toBeDisabled();
  await expect(potable).toHaveAttribute("placeholder", "not offered");

  // A name is required too, so fill it before asserting the button — the
  // first version of this test forgot, and read a correctly-disabled Save as
  // a failure of the checkbox logic.
  await page.getByLabel("Name *", { exact: false }).first().fill("Tmp Verification Station");
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(300);

  // Ticking one type must not enable the other — they are independent offers.
  await expect(potable).toBeEnabled();
  await expect(nonPotable).toBeDisabled();
  await expect(page.getByText(/A station must offer at least one water type/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Add station$/ })).toBeEnabled();
});

test("a ticked type with an empty price is refused, never saved as free", async ({ page }) => {
  await openAddStation(page);

  await page.getByLabel("Name *", { exact: false }).first().fill("Tmp Verification Station");
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Add station$/ }).click();
  await page.waitForTimeout(600);

  // THE BUG THIS GUARDS. Number("") is 0, so a ticked-but-blank box would post
  // fill_cost_potable_sar = 0 — a REAL price meaning "this station fills free".
  // Silently booking an unknown cost as free is the same class of error as
  // rendering an unread figure as zero.
  await expect(page.getByText(/Enter a price for Potable/i)).toBeVisible();
  await expect(page.getByText(/use 0 if this station fills free/i)).toBeVisible();
});

test("0 is an accepted price — free is a real answer", async ({ page }) => {
  await openAddStation(page);
  await page.getByLabel("Name *", { exact: false }).first().fill("Tmp Verification Station");
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(200);
  await page.getByLabel("Potable fill price", { exact: true }).fill("0");
  await page.waitForTimeout(200);

  // No validation message: 0 is meaningful (company-owned stations fill free)
  // and must never be treated as "no price entered".
  await expect(page.getByText(/Enter a price for Potable/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Add station$/ })).toBeEnabled();
});
