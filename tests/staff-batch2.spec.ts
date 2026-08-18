import { test, expect } from "@playwright/test";

// Verifies the Staff-page batch 2 (items 1-5) against the throwaway
// /staff-batch2-check diagnostic route (hand-built fixture, no Supabase, no
// auth) — same convention as every prior phase in this repo. See that route's
// header comment; it is deleted before the commit, so this spec is
// documentation of what was verified, not a standing regression suite.
//
// Fixture (today = 2026-08-18):
//   drivers   Active Ali (active, licence 2026-03-01)
//             Idle Ibrahim (idle, licence 2026-11-30)
//             Offduty Omar (off_duty, licence 2027-05-01 — NOT this year)
//             محمد الثاني (on_leave, no licence date)
//   incidents Ali x2 + Ibrahim x1 inside the 12mo window, one 2024 row outside
//   staff     Leave Layla (14 leave days this year), Nada Noleave (0)

const ROUTE = "/staff-batch2-check";

test.describe("Staff page batch 2", () => {
  test("item 1 — Export CSV downloads an Excel-friendly file: BOM, sep= directive, CRLF", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /^Commissions/ }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export CSV/ }).click(),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(path!);

    // THE BOM IS THE WHOLE REASON THIS EXPORT WAS UNUSABLE FOR AN ARABIC
    // ROSTER — asserted on the raw BYTES, because reading the file as a string
    // can silently strip U+FEFF and the test would pass with it missing.
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const text = buf.toString("utf8");
    // Excel's own locale override, ahead of the header row.
    expect(text.slice(1).startsWith("sep=,\r\n")).toBe(true);
    // CRLF terminators, and a trailing one so the last row is complete.
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text).toContain("Driver,Driver ID,Month");
    // The Arabic name survives the round trip rather than arriving mojibake.
    expect(text).toContain("محمد الثاني");
    expect(download.suggestedFilename()).toMatch(/^commissions-\d{4}-\d{2}\.csv$/);
  });

  test("item 2 — month lens and Export CSV sit beside the sub-tabs, and the lens still owns its own state", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /^Commissions/ }).first().click();

    // The controls are portalled into the SUB-TAB ROW, not the card header.
    // Scoped by CONTENT (the row that holds the Historical sub-tab) rather than
    // by class alone — the page header carries the same flex classes, so a
    // class-only locator resolves to it and proves nothing.
    const subTabRow = page
      .locator("div.flex.items-start.justify-between")
      .filter({ has: page.getByRole("button", { name: /^Historical/ }) })
      .first();
    await expect(subTabRow).toBeVisible();
    await expect(subTabRow.getByRole("button", { name: /Export CSV/ })).toBeVisible();
    const lens = subTabRow.locator("select");
    await expect(lens).toBeVisible();
    await expect(subTabRow.getByText("Month", { exact: true })).toBeVisible();

    // Exactly ONE month lens on the screen — a portal moves WHERE a control
    // renders, not WHO owns it, so a second copy would mean the state was
    // lifted and the shown/paid guarantee broken.
    await expect(page.locator("label", { hasText: "Month" })).toHaveCount(1);

    // The lens still drives the card below it: switching months re-labels the
    // period the card reports on.
    const options = await lens.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await lens.selectOption({ index: 1 });
    await expect(lens).not.toHaveValue("");

    // Historical sub-tab carries its own filters — the portal host is empty there.
    await page.getByRole("button", { name: /^Historical/ }).click();
    await expect(page.getByRole("button", { name: /Export CSV/ })).toHaveCount(0);
  });

  test("item 3 — On Duty is FOUR separate bars, each with its own count, sharing the roster denominator", async ({
    page,
  }) => {
    await page.goto(ROUTE);

    const bar = page.locator("div.card", { hasText: "On Duty" }).filter({ hasText: "4 drivers" }).first();
    await expect(bar).toBeVisible();

    // Four labelled tracks — not one combined proportional bar.
    for (const label of ["Active", "Idle", "Off duty", "On leave"]) {
      await expect(bar.getByText(label, { exact: true })).toBeVisible();
    }
    const tracks = bar.locator("div.h-2.rounded-full.overflow-hidden");
    await expect(tracks).toHaveCount(4);

    // Each track prints its own figure beside it. Fixture is 1/1/1/1.
    const figures = bar.locator("div.text-base.font-semibold");
    await expect(figures).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(figures.nth(i)).toHaveText("1");

    // ONE denominator — every fill is 25% of the roster, not of its neighbours.
    const fills = bar.locator("div.h-2.rounded-full.overflow-hidden > div");
    await expect(fills).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(fills.nth(i)).toHaveAttribute("style", /width:\s*25%/);
    }

    // Avg Safety stays gone (batch 1's item 3, re-asserted here because this
    // batch rewrote the card it sat beside).
    await expect(page.getByText(/Avg Safety/i)).toHaveCount(0);
  });

  test("item 4 — the leave tally is INSIDE the staff card, states its basis, and renders nothing at zero", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /Management & Staff/ }).click();

    const layla = page.locator("button", { hasText: "Leave Layla" }).first();
    const chip = layla.locator("span", { hasText: "since Jan 1" }).first();
    await expect(chip).toBeVisible();
    // 10 + 4 days inside 2026; the 2025 period is NOT counted.
    await expect(chip).toContainText("14d");

    // THE BASIS IS ON SCREEN, not only in the tooltip — "since Jan 1" is the
    // whole meaning of the number.
    await expect(chip).toContainText("since Jan 1");
    await expect(chip).toHaveAttribute("title", /taken since 1 January 2026/);

    // INSIDE the card: the chip is a descendant of the card's own button, and
    // the old absolutely-positioned corner badge is gone.
    await expect(layla.locator("span.absolute")).toHaveCount(0);
    await expect(page.getByText(/\d+d leave/)).toHaveCount(0);

    // Zero renders nothing at all.
    const nada = page.locator("button", { hasText: "Nada Noleave" }).first();
    await expect(nada).toBeVisible();
    await expect(nada.locator("span", { hasText: "since Jan 1" })).toHaveCount(0);
    await expect(nada).not.toContainText("0d");
  });

  test("item 5 — Incidents and License KPIs name the drivers behind the figure", async ({ page }) => {
    await page.goto(ROUTE);

    // Incidents (12mo) = 3 live driver_incidents rows inside the window (the
    // 2024 row is outside it). The KPI counts ROWS, so a driver with two of
    // them carries a "(2)" — that suffix is what keeps the list addable back
    // up to the figure above it.
    const incidents = page.locator("div.card", { hasText: "Incidents (12mo)" }).first();
    await expect(incidents).toContainText("3");
    await expect(incidents).toContainText("Active Ali (2)");
    await expect(incidents).toContainText("Idle Ibrahim");
    // Grouped by driver and ordered by count — Ali's two lead.
    const incidentNames = await incidents.locator("span.block.truncate").first().innerText();
    expect(incidentNames.indexOf("Active Ali")).toBeLessThan(incidentNames.indexOf("Idle Ibrahim"));

    // Licences expiring this year = Ali (2026-03-01) and Ibrahim (2026-11-30).
    // Omar's 2027 licence and the driver with no date are NOT named.
    const licence = page.locator("div.card", { hasText: "License Exp (this year)" }).first();
    await expect(licence).toContainText("2");
    const licenceNames = await licence.locator("span.block.truncate").first().innerText();
    // SOONEST FIRST — the order the list is acted on.
    expect(licenceNames.indexOf("Active Ali")).toBeLessThan(licenceNames.indexOf("Idle Ibrahim"));
    expect(licenceNames).not.toContain("Offduty Omar");

    // The full list stays reachable on hover even when truncated.
    await expect(licence.locator("span.block.truncate").first()).toHaveAttribute(
      "title",
      /Active Ali/,
    );
  });

  test("item 5 — a KPI with nothing behind it renders no name list at all", async ({ page }) => {
    await page.goto(ROUTE);
    // On Duty Now takes no `sub` — proves the name element is the KPI's own
    // slot and not something every card renders.
    const onDuty = page.locator("div.card", { hasText: "On Duty Now" }).first();
    await expect(onDuty.locator("span.block.truncate")).toHaveCount(0);
  });
});
