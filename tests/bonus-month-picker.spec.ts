import { test, expect, type Page } from "@playwright/test";

// Verifies the bonus month picker inside CommissionsTab's Specials / Bonuses
// popup against the throwaway /bonus-month-check diagnostic route (hand-built
// fixture, no Supabase, no auth) — same convention as every prior phase in this
// repo. That route is deleted before the commit, so this spec is documentation
// of what was verified, not a standing regression suite.
//
// WHAT IS UNDER TEST: the review checklist for the staff batch claimed the
// picker "refuses save without a month". It could not — bonusMonth was seeded
// from the tab's month lens and re-synced by an effect, so it was never empty
// and the refusal could never fire. That refusal is now real, and these tests
// are the shape of it.
//
// WHAT IS NOT UNDER TEST: the save itself. setCommissionBonus is an auth-gated
// server action and this route has no session, so a write would fail for a
// reason that has nothing to do with the gate.
//
// Fixture (today = 2026-08-18): one driver with an unpaid delivered trip in
// 2026-08 and one in 2026-07, so the month lens defaults to Aug 2026 and the
// bonus picker offers exactly Aug 2026 and Jul 2026.

const ROUTE = "/bonus-month-check";

async function openSpecials(page: Page) {
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Specials \/ Bonuses/ }).click();
  await expect(page.getByText("Manager Bonus")).toBeVisible();
}

function bonusMonthSelect(page: Page) {
  return page.getByLabel("Bonus month");
}

function amountInput(page: Page) {
  // The bonus amount box sits beside the Set button, inside the bonus row —
  // the only step-50 number input on the screen.
  return page.locator('input[type="number"][step="50"]');
}

test.describe("bonus month picker", () => {
  test("starts empty — placeholder selected, not the tab's month lens", async ({ page }) => {
    await openSpecials(page);

    await expect(bonusMonthSelect(page)).toHaveValue("");

    // Scoped to the bonus select on purpose — the tab's own month lens carries
    // the same two option labels, so an unscoped option locator resolves to
    // both selects and proves nothing about this one.
    const options = bonusMonthSelect(page).locator("option");
    await expect(options).toHaveText(["Select month…", "Aug 2026", "Jul 2026"]);
  });

  test("with no month picked: amount and Set are disabled, and the caption says why", async ({ page }) => {
    await openSpecials(page);

    await expect(amountInput(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Set$/ })).toBeDisabled();

    await expect(
      page.getByText("No month selected — a bonus cannot be saved until you pick the month it belongs to."),
    ).toBeVisible();
    await expect(page.getByText("Discretionary bonus — pick the month it is filed against.")).toBeVisible();
  });

  test("picking the lens month enables both controls and shows no cross-month warning", async ({ page }) => {
    await openSpecials(page);
    await bonusMonthSelect(page).selectOption("2026-08");

    await expect(amountInput(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Set$/ })).toBeEnabled();
    await expect(page.getByText("No month selected")).toHaveCount(0);
    await expect(page.getByText(/Discretionary bonus for Aug 2026/)).toBeVisible();
    await expect(page.getByText(/Filing against/)).toHaveCount(0);
  });

  test("picking a month other than the lens warns that the amount lands out of view", async ({ page }) => {
    await openSpecials(page);
    await bonusMonthSelect(page).selectOption("2026-07");

    await expect(amountInput(page)).toBeEnabled();
    await expect(page.getByText(/Filing against Jul 2026, not Aug 2026/)).toBeVisible();
    // The warning names where to go to review it, not just that it is different.
    await expect(page.getByText(/Switch the tab's month lens to Jul 2026/)).toBeVisible();
  });

  test("moving the month lens re-seeds the picker to EMPTY, never to the new lens", async ({ page }) => {
    await page.goto(ROUTE);

    // Pick a bonus month under the Aug lens, close, move the lens to Jul, reopen.
    await page.getByRole("button", { name: /Specials \/ Bonuses/ }).click();
    await bonusMonthSelect(page).selectOption("2026-07");
    await expect(bonusMonthSelect(page)).toHaveValue("2026-07");

    // The lens control is the tab's own Month select, outside the popup.
    await page.locator("select").first().selectOption("2026-07");

    await expect(bonusMonthSelect(page)).toHaveValue("");
    await expect(page.getByRole("button", { name: /^Set$/ })).toBeDisabled();
  });
});
