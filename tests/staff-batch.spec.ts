import { test, expect } from "@playwright/test";

// Verifies the Staff-page UI batch (items 1, 3, 4, 5, 6, 7, 8, 9) against the
// throwaway /staff-batch-check diagnostic route (hand-built fixture, no
// Supabase, no auth) — same convention as every prior phase in this repo. See
// that route's header comment; it is deleted before the commit, so this spec is
// documentation of what was verified, not a standing regression suite.
//
// Fixture (today = 2026-08-18):
//   drivers   Active Ali (active, insurance true, licence 2026-03-01)
//             Idle Ibrahim (idle, insurance false)
//             Offduty Omar (off_duty, insurance null)
//             Onleave Osama (on_leave, insurance null)
//   trucks    ABC-1234 -> Ali, XYZ-9876 -> Ibrahim, QQQ-1111 unassigned
//   balances  Ali 1250, Ibrahim 0, Omar 430, Osama 0
//   incidents 2026-07-01 + 2026-01-05 inside the 12mo window, 2024-01-05 outside
//   staff     2 mechanics (Manfuhah), 1 head_of_maintenance (Shas), 1 admin (no station)
//   open WOs  s-1: 2, s-2: 1, s-3: 5  -> the mechanics cluster must read 3, not 8

const ROUTE = "/staff-batch-check";

test.describe("Staff page UI batch", () => {
  test("item 1 — History is a Commission sub-tab, not a top-level tab", async ({ page }) => {
    await page.goto(ROUTE);

    // The top-level bar has exactly three buttons; "Historical"/"History" is
    // not one of them any more.
    const tabBar = page.locator("div.border-b").first();
    await expect(tabBar.getByRole("button", { name: /^Drivers/ })).toBeVisible();
    await expect(tabBar.getByRole("button", { name: /^Commissions/ })).toBeVisible();
    await expect(tabBar.getByRole("button", { name: /Management & Staff/ })).toBeVisible();
    await expect(tabBar.getByRole("button", { name: /^Historical/ })).toHaveCount(0);

    // Open Commissions -> both sub-tabs are present, Commissions active.
    await tabBar.getByRole("button", { name: /^Commissions/ }).click();
    await expect(page.getByRole("button", { name: /^Historical/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Commissions/ })).toHaveCount(2); // top-level + sub-tab

    // Historical sub-tab renders the payout history.
    await page.getByRole("button", { name: /^Historical/ }).click();
    await expect(page.getByText("Jul 2026")).toBeVisible();
  });

  test("item 1 — ?tab=history still deep-links into the Historical sub-tab", async ({ page }) => {
    await page.goto(`${ROUTE}?tab=history`);
    // Top-level Commissions reads active; the Historical sub-tab is the one shown.
    await expect(page.getByText("Jul 2026")).toBeVisible();
  });

  test("item 3 — Avg Safety gone; On Duty bar, Incidents (12mo), License Exp correct", async ({ page }) => {
    await page.goto(ROUTE);

    // AVG Safety KPI removed (the drivers.safety_score column itself stays).
    await expect(page.getByText(/Avg Safety/i)).toHaveCount(0);

    // Incidents (12mo) counts LIVE driver_incidents rows inside the window:
    // 2 of the 3 fixture incidents, the 2024 one excluded.
    const incidents = page.locator("div.card", { hasText: "Incidents (12mo)" }).first();
    await expect(incidents).toContainText("2");

    // License Exp (this year) — only Ali's 2026-03-01 is on/before year end.
    const licence = page.locator("div.card", { hasText: "License Exp (this year)" }).first();
    await expect(licence).toContainText("1");

    // On Duty Now = drivers with a truck (Ali + Ibrahim) out of 4.
    const onDutyNow = page.locator("div.card", { hasText: "On Duty Now" }).first();
    await expect(onDutyNow).toContainText("2/4");

    // The On Duty BAR: all four states labelled, each printing its own count
    // (1/1/1/1 here) — zeros would render too, they do not vanish.
    const bar = page.locator("div.card", { hasText: "On Duty" }).filter({ hasText: "4 drivers" }).first();
    await expect(bar).toBeVisible();
    for (const label of ["Active", "Idle", "Off duty", "On leave"]) {
      await expect(bar.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(bar.locator("div.text-xl.font-semibold")).toHaveCount(4);
    await expect(bar.locator("div.text-xl.font-semibold").nth(0)).toHaveText("1");
    await expect(bar.locator("div.text-xl.font-semibold").nth(3)).toHaveText("1");
  });

  test("item 4 — status pills: Active green, Idle amber, Off duty / On leave yellow", async ({ page }) => {
    await page.goto(ROUTE);

    const row = (name: string) => page.locator("tr", { hasText: name });

    const active = row("Active Ali").locator("span.rounded-full", { hasText: "Active" }).first();
    await expect(active).toHaveClass(/emerald/);

    const idle = row("Idle Ibrahim").locator("span.rounded-full", { hasText: "Idle" }).first();
    await expect(idle).toHaveClass(/amber/);

    const off = row("Offduty Omar").locator("span.rounded-full", { hasText: "Off duty" }).first();
    await expect(off).toHaveClass(/yellow/);

    const leave = row("Onleave Osama").locator("span.rounded-full", { hasText: "On leave" }).first();
    await expect(leave).toHaveClass(/yellow/);

    // The three tones are genuinely different classes, not one colour three times.
    const activeCls = (await active.getAttribute("class")) ?? "";
    const idleCls = (await idle.getAttribute("class")) ?? "";
    const offCls = (await off.getAttribute("class")) ?? "";
    expect(activeCls).not.toBe(idleCls);
    expect(idleCls).not.toBe(offCls);
  });

  test("item 5 — Add staff sits in the page header, staff tab only, and opens the form", async ({ page }) => {
    await page.goto(ROUTE);

    // Drivers tab: New driver is offered, Add staff is not.
    await expect(page.getByRole("button", { name: /New driver/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add staff/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Management & Staff/ }).click();

    // Staff tab: the positions swap — same header slot.
    await expect(page.getByRole("button", { name: /New driver/ })).toHaveCount(0);
    const addStaff = page.getByRole("button", { name: /Add staff/ });
    await expect(addStaff).toBeVisible();

    // It opens the form that lives inside StaffTab (nonce prop, not a boolean).
    await addStaff.click();
    await expect(page.getByRole("heading", { name: "Add Staff Member" })).toBeVisible();

    // Cancelling and pressing again still opens it — the nonce guarantee.
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(page.getByRole("heading", { name: "Add Staff Member" })).toHaveCount(0);
    await addStaff.click();
    await expect(page.getByRole("heading", { name: "Add Staff Member" })).toBeVisible();
  });

  test("item 6 — staff-only KPIs, mechanics cluster excludes head_of_maintenance", async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /Management & Staff/ }).click();

    const headcount = page.locator("div.card", { hasText: "Active staff" }).first();
    await expect(headcount).toContainText("4");

    const iqama = page.locator("div.card", { hasText: "Iqama exp (90d)" }).first();
    await expect(iqama).toContainText("1"); // s-1's 2026-09-15 falls inside 90 days of 2026-08-18

    const branches = page.locator("div.card", { hasText: "Headcount by branch" }).first();
    await expect(branches).toContainText("Manfuhah");
    await expect(branches).toContainText("Shas");
    await expect(branches).toContainText("Unassigned"); // a station-less staff member is shown, not dropped

    const mech = page.locator("div.card", { hasText: "Mechanics team" }).first();
    await expect(mech).toContainText("mechanics");
    // 2 mechanics — the head of maintenance is NOT one of them.
    await expect(mech.locator("span.text-2xl")).toHaveText("2");
    // Open work orders = 2 + 1 = 3. The head's own 5 must NOT be included.
    const woRow = mech.locator("div", { hasText: "Open work orders" }).last();
    await expect(woRow).toContainText("3");
    await expect(mech).not.toContainText("8");
    // 3 trucks / 2 mechanics.
    await expect(mech).toContainText("1.5 : 1");
    // Wording is load-bearing: duty_hours is a shift LENGTH, not a clock-in state.
    await expect(mech).toContainText("With duty hours set");
    await expect(mech).toContainText("2/2");
    await expect(mech).not.toContainText(/on duty now/i);
  });

  test("item 7 — the truck plate cell stands out", async ({ page }) => {
    await page.goto(ROUTE);
    const plate = page.locator("tr", { hasText: "Active Ali" }).getByText("ABC-1234");
    await expect(plate).toHaveClass(/font-semibold/);
    await expect(plate).toHaveClass(/font-mono/);
    await expect(plate).toHaveClass(/text-sm/);
  });

  test("item 8 — health insurance is tri-state in the detail panel and the form", async ({ page }) => {
    await page.goto(ROUTE);

    // true -> Yes (green)
    await page.locator("tr", { hasText: "Active Ali" }).click();
    const yes = page.locator("text=Health insurance").locator("xpath=..").getByText("Yes", { exact: true });
    await expect(yes).toBeVisible();
    await expect(yes).toHaveClass(/emerald/);
    // Rating is gone from the panel (dropped in 0132).
    await expect(page.getByText(/Rating/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();

    // false -> No (red)
    await page.locator("tr", { hasText: "Idle Ibrahim" }).click();
    const no = page.locator("text=Health insurance").locator("xpath=..").getByText("No", { exact: true });
    await expect(no).toBeVisible();
    await expect(no).toHaveClass(/rose/);
    await page.getByRole("button", { name: "Close" }).click();

    // null -> neutral dash, explicitly NOT red.
    await page.locator("tr", { hasText: "Offduty Omar" }).click();
    const dash = page.locator("span[title='Not recorded']");
    await expect(dash).toBeVisible();
    await expect(dash).toHaveText("—");
    await expect(dash).toHaveClass(/muted/);
    await expect(dash).not.toHaveClass(/rose/);
    await page.getByRole("button", { name: "Close" }).click();

    // The add/edit form offers all three states.
    await page.getByRole("button", { name: /New driver/ }).click();
    const select = page.locator("select[name='health_insurance']");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveCount(3);
    await expect(select.locator("option")).toHaveText(["Not recorded", "Yes", "No"]);
    await expect(select).toHaveValue(""); // a new driver starts unrecorded, not "No"
  });

  test("item 9 — Unpaid Commission column reads the shared balance map, all periods", async ({ page }) => {
    await page.goto(ROUTE);

    await expect(page.getByRole("columnheader", { name: "Unpaid Commission" })).toBeVisible();

    const cell = (name: string) => page.locator("tr", { hasText: name }).locator("td").nth(7);

    await expect(cell("Active Ali")).toHaveText("1,250 SAR");
    await expect(cell("Offduty Omar")).toHaveText("430 SAR");
    // Zero is a real answer (nothing owed) — printed as a figure, muted, never an em dash.
    await expect(cell("Idle Ibrahim")).toHaveText("0 SAR");
    await expect(cell("Onleave Osama")).toHaveText("0 SAR");
    await expect(cell("Idle Ibrahim").locator("span.muted")).toHaveCount(1);
    await expect(cell("Active Ali").locator("span.font-semibold")).toHaveCount(1);
  });
});
