import { test, expect } from "@playwright/test";
const URL = "http://localhost:3002/pu-verify";

test("KPIs carry value AND quantity, and the maths matches the ledgers", async ({ page }) => {
  await page.goto(URL);
  // 50*60 + 3*25 + 2*620 + 2*95 = 3000 + 75 + 1240 + 190 = 4,505 / 57 units
  const all = page.locator(".card", { hasText: "Consumed, all time" });
  await expect(all).toContainText("4,505 SAR");
  await expect(all).toContainText("57 units");

  const maint = page.locator(".card", { hasText: "Maintenance" }).first();
  await expect(maint).toContainText("4,315 SAR");
  await expect(maint).toContainText("55 units");

  const exits = page.locator(".card", { hasText: "Exit permits" }).first();
  await expect(exits).toContainText("190 SAR");
  await expect(exits).toContainText("2 units");
});

test("outstanding shows only what is still out", async ({ page }) => {
  await page.goto(URL);
  const card = page.locator(".card", { hasText: "Currently out and not back" });
  await expect(card).toContainText("EP-26-0004");
  await expect(card).not.toContainText("EP-26-0002"); // fully returned
  await expect(card).toContainText("190 SAR");
});

test("every view renders and carries both measures", async ({ page }) => {
  await page.goto(URL);
  for (const t of [
    "Consumption over time", "Maintenance vs exit permits", "By warehouse",
    "By destination", "Top parts by value", "Top parts by quantity",
    "In-house maintenance consumption history",
  ]) {
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  }
  // both legends present on the charts
  expect(await page.getByText("Value (SAR)").count()).toBeGreaterThan(0);
  expect(await page.getByText("Quantity (units)").count()).toBeGreaterThan(0);
});

test("undeducted work order is excluded; in-progress deducted one is counted", async ({ page }) => {
  await page.goto(URL);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("WO-26-0014"); // open, never deducted
  expect(body).toContain("Water pump");     // from the in-progress but DEDUCTED WO
});

test("records section is COMPLETED work orders only", async ({ page }) => {
  await page.goto(URL);
  const rec = page.locator(".card", { hasText: "In-house maintenance consumption history" });
  await expect(rec).toContainText("WO-26-0001");
  await expect(rec).toContainText("WO-26-0002");
  await expect(rec).not.toContainText("WO-26-0003"); // in progress
});

test("pre-ledger rows are flagged, not hidden", async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByText("pre-ledger").first()).toBeVisible();
  await expect(page.getByText(/predates? the per-lot consumption ledger/)).toBeVisible();
});

test("source filter narrows every view", async ({ page }) => {
  await page.goto(URL);
  await page.getByRole("button", { name: "Exit permits only" }).click();
  const all = page.locator(".card", { hasText: "Consumed, all time" });
  await expect(all).toContainText("190 SAR");
  await expect(all).toContainText("2 units");
});
