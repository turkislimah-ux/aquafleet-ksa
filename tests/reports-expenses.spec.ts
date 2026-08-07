// Reports — expenses editor render/validation verification against the
// /reports-verify diagnostic route (throwaway; deleted after this run).
//
// SCOPE LIMIT, stated rather than implied: this route has no Supabase session,
// so the server actions cannot be exercised here — a real save is auth-gated
// and RLS-scoped. These tests cover rendering, client-side validation gating,
// edit mode and the delete confirmation. The actual write path is Turki's
// in-browser check, same as every prior phase.
import { test, expect } from "@playwright/test";

const URL = "http://localhost:3002/reports-verify";

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
});

test("modal lists existing expenses with their entered-by", async ({ page }) => {
  await expect(page.getByText("Other expenses")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Rent" }).first()).toBeVisible();
  await expect(page.getByText("12,000 SAR").first()).toBeVisible();
  await expect(page.getByText("turki@example.com").first()).toBeVisible();
});

test("a missing note renders an em dash, not a blank cell", async ({ page }) => {
  const row = page.locator("tr", { hasText: "Government fees" });
  await expect(row).toContainText("—");
});

test("Add is disabled until date, category and a positive amount are present", async ({ page }) => {
  const add = page.getByRole("button", { name: /Add expense/ });
  await expect(add).toBeDisabled();

  await page.getByPlaceholder("e.g. Rent").fill("Fuel card");
  await expect(add).toBeDisabled();          // still no amount

  await page.getByPlaceholder("0").fill("0");
  await expect(add).toBeDisabled();          // zero is not a valid amount

  await page.getByPlaceholder("0").fill("250");
  await expect(add).toBeEnabled();
});

test("a negative amount does not enable the button", async ({ page }) => {
  await page.getByPlaceholder("e.g. Rent").fill("Fuel card");
  await page.getByPlaceholder("0").fill("-40");
  await expect(page.getByRole("button", { name: /Add expense/ })).toBeDisabled();
});

test("category combo offers the values already in use", async ({ page }) => {
  const options = page.locator("#expense-categories option");
  await expect(options).toHaveCount(2);      // Rent, Government fees — deduped
  await expect(options.nth(0)).toHaveAttribute("value", "Government fees");
});

test("edit mode prefills the row and swaps the button", async ({ page }) => {
  await page.locator("tr", { hasText: "Government fees" }).getByTitle("Edit").click();
  await expect(page.getByPlaceholder("e.g. Rent")).toHaveValue("Government fees");
  await expect(page.getByPlaceholder("0")).toHaveValue("2400");
  await expect(page.getByRole("button", { name: /Save changes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("cancel leaves edit mode and clears the form", async ({ page }) => {
  await page.locator("tr", { hasText: "Government fees" }).getByTitle("Edit").click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: /Add expense/ })).toBeVisible();
  await expect(page.getByPlaceholder("e.g. Rent")).toHaveValue("");
});

test("delete asks before acting, and can be backed out of", async ({ page }) => {
  const row = page.locator("tr", { hasText: "Government fees" });
  await row.getByTitle("Delete").click();
  await expect(row.getByText("Delete?")).toBeVisible();
  await row.getByRole("button", { name: "No" }).click();
  await expect(row.getByText("Delete?")).toHaveCount(0);
  await expect(row.getByTitle("Delete")).toBeVisible();
});

test("empty state explains why net profit equals operating profit", async ({ page }) => {
  // The modal opens by default in this harness and its overlay covers the
  // page behind it, so it has to be dismissed before the toggle is clickable.
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("open-empty").click();
  await expect(page.getByText(/net profit equals operating profit/)).toBeVisible();
});

test("no NaN leaks from a half-typed amount", async ({ page }) => {
  await page.getByPlaceholder("0").fill("12.");
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("NaN");
  await expect(page.getByPlaceholder("0")).toHaveValue("12.");
});
