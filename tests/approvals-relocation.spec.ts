import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/approvals-verify";

test("1 vote: stays in ACTIVE tab, dots 1/2, awaiting-second, NOT in ledger", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-one").click();

  const active = page.getByTestId("active-tab");
  await expect(active.getByText("WO-26-0007")).toBeVisible();
  await expect(active.getByText("1/2")).toBeVisible();
  await expect(active.getByText("awaiting a matching second vote")).toBeVisible();

  const ledger = page.getByTestId("ledger-tab");
  await expect(ledger.getByText("WO-26-0007")).toHaveCount(0);
  await expect(ledger.getByText("No completed approvals yet.")).toBeVisible();
});

test("2 matching votes: LEAVES active tab, APPEARS in ledger as Approved", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-two").click();

  const active = page.getByTestId("active-tab");
  await expect(active.getByText("WO-26-0007")).toHaveCount(0);
  await expect(active.getByText("Everything has been decided.")).toBeVisible();
  await expect(active.getByText(/Decided events live in Archive/)).toBeVisible();

  const ledger = page.getByTestId("ledger-tab");
  await expect(ledger.getByText("WO-26-0007")).toBeVisible();
  await expect(ledger.getByText("Approved").first()).toBeVisible();
  await expect(ledger.getByText(/\d+d left/)).toBeVisible();
});

test("no disagree-limbo wording anywhere", async ({ page }) => {
  await page.goto(URL);
  for (const s of ["zero", "one", "two"] as const) {
    await page.getByTestId(`btn-${s}`).click();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("disagree");
    expect(body).not.toContain("withdraw");
  }
});

test("dots render filled/unfilled per vote count", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-one").click();
  const dots = page.getByTestId("active-tab").locator("span.h-2.w-2.rounded-full");
  await expect(dots).toHaveCount(2);
  await expect(dots.nth(0)).toHaveCSS("background-color", "rgb(16, 185, 129)");
  await expect(dots.nth(1)).not.toHaveCSS("background-color", "rgb(16, 185, 129)");
});
