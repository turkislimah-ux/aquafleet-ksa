import { test, expect, type Page } from "@playwright/test";
const URL = "http://localhost:3002/pu-verify";

async function pick(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("global period picker drives the readings and shows the comparison", async ({ page }) => {
  await page.goto(URL);
  // Default is month-to-month.
  await expect(page.getByText(/Showing .* against /)).toBeVisible();

  await pick(page, "Year to year");
  const all = page.locator("div.card.p-4", { hasText: "Consumed this period" });
  await expect(all).toContainText("4,505 SAR"); // whole 2026
  await expect(all).toContainText("57 units");

  await pick(page, "Week to week");
  await expect(all).not.toContainText("4,505 SAR"); // narrowed
});

test("KPIs show value AND quantity with a change against the previous period", async ({ page }) => {
  await page.goto(URL);
  await pick(page, "Month to month");
  const all = page.locator("div.card.p-4", { hasText: "Consumed this period" });
  await expect(all).toContainText("units");
  await expect(all).toContainText("in value");   // the delta line
});

test("combined chart: bars AND an overlaid trend line, with its own toggle", async ({ page }) => {
  await page.goto(URL);
  const card = page.locator(".card", { hasText: "Total consumption over time" });
  // Bars are HTML (see ComboChart's own note); the overlay carries the line.
  const bars = card.locator("div.bg-brand-500\\/70");
  await expect(bars).toHaveCount(12); // fixed 12-month window, gaps included
  await expect(card.locator("svg polyline")).toHaveCount(1);
  await expect(card.getByText("Trend (3-point average)")).toBeVisible();
  // axes
  await expect(card.getByText("SAR", { exact: true })).toBeVisible();

  // its own toggle, independent of the global picker
  await card.getByRole("button", { name: "Yearly" }).click();
  await expect(bars).toHaveCount(5); // fixed 5-year window
});

test("weekly summary is bullets and stays weekly", async ({ page }) => {
  await page.goto(URL);
  const card = page.locator(".card", { hasText: "This week in review" });
  await expect(card).toContainText("rolls over on its own every week");
  expect(await card.locator("li").count()).toBeGreaterThan(1);

  // changing the global picker must NOT change the weekly card's window label
  const before = await card.locator("p").first().innerText();
  await pick(page, "Year to year");
  await expect(card.locator("p").first()).toHaveText(before);
});

test("top 5 costly trucks with plate, visits and value, and a View all", async ({ page }) => {
  await page.goto(URL);
  await pick(page, "Year to year");
  const card = page.locator(".card", { hasText: "Top 5 costly trucks" });
  await expect(card.getByText("Times to maintenance")).toBeVisible();
  await expect(card.getByText("Total maintenance value")).toBeVisible();
  await expect(card).toContainText("AAA-5551");

  await card.getByRole("button", { name: "View all trucks" }).click();
  await expect(page.getByText("All trucks by maintenance parts")).toBeVisible();
  // the never-deducted truck must not appear
  const modalText = await page.locator(".card", { hasText: "All trucks by maintenance parts" }).innerText();
  expect(modalText).not.toContain("CCC-9999");
  await page.getByRole("button", { name: "Close" }).click();
});

test("two parts lists side by side, each with its own full list", async ({ page }) => {
  await page.goto(URL);
  await pick(page, "Year to year");
  const v = await page.getByText("Top 5 parts by value").boundingBox();
  const q = await page.getByText("Top 5 parts by quantity").boundingBox();
  expect(Math.abs(v!.y - q!.y)).toBeLessThan(10);
  expect(q!.x).toBeGreaterThan(v!.x);
});

test("layout: every new display sits ABOVE the work-order records table", async ({ page }) => {
  await page.goto(URL);
  const records = (await page.locator(".card", { hasText: "In-house maintenance consumption history" }).boundingBox())!.y;
  for (const t of ["Total consumption over time", "Monthly trend — value and quantity",
                   "This week in review", "Top 5 costly trucks", "Top 5 parts by value"]) {
    const y = (await page.locator(".card", { hasText: t }).first().boundingBox())!.y;
    expect(y).toBeLessThan(records);
  }
});

test("outstanding stays current-state, not period-scoped", async ({ page }) => {
  await page.goto(URL);
  // Anchored on the note, which only the KPI carries — the section card's own
  // hint says "as of now", and `Card` applies p-4 itself so a class-based
  // locator matches both.
  const kpi = page.locator("div.card", { hasText: "Right now — not period-scoped" });
  await expect(kpi).toHaveCount(1);
  await expect(kpi).toContainText("190 SAR");
  await expect(kpi).toContainText("2 units");

  await pick(page, "Week to week");
  await expect(kpi).toContainText("190 SAR");
  await pick(page, "Year to year");
  await expect(kpi).toContainText("190 SAR"); // unchanged by the picker
});

test("monthly trend chart: paired bars, dual axes, fixed 12-month window", async ({ page }) => {
  await page.goto(URL);
  const card = page.locator(".card", { hasText: "Monthly trend — value and quantity" });
  await expect(card.locator("div.bg-brand-500\\/70")).toHaveCount(12);   // value bars
  await expect(card.locator("div.bg-emerald-500\\/70")).toHaveCount(12); // quantity bars
  await expect(card.getByText("SAR", { exact: true })).toBeVisible();    // left axis
  await expect(card.getByText("units", { exact: true })).toBeVisible();  // right axis
  // an empty month is still on the axis
  await expect(card.getByText("Jan 26")).toBeVisible();
});

test("weekly summary covers maintenance, exit permits and what is still out", async ({ page }) => {
  await page.goto(URL);
  const card = page.locator(".card", { hasText: "This week in review" });
  await expect(card).toContainText("work order");
  await expect(card).toContainText("exit permit");
  await expect(card).toContainText("returnable stock is still out");
  await expect(card).toContainText("rolls over on its own every week");
});
