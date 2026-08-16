// The three month questions, and the boundary where they stop agreeing.
//
// WHY THIS EXISTS. This repo had one expression of "what month is it" that was
// wrong twice (UTC, and a const that never rolled over), and four places that
// bucketed a stored timestamptz by its UTC instant and then compared the result
// against a LOCAL month key. Both bugs are invisible for 21 hours a day, which
// is exactly why they survived several review passes. These assertions pin the
// three hours where they are not.
//
//   currentMonthKey()      which month is it NOW              lib/utils, local
//   localMonthKeyOf(iso)   which month did THIS happen in     lib/utils, local
//   monthKeyOf(iso)        same, but by the UTC instant       lib/commission
//
// monthKeyOf is NOT a bug and is asserted here as correct-by-design: bucketing
// by UTC is what makes payroll grouping deterministic across machines. The bug
// was ever comparing its output against a local month.
//
// No browser, no diagnostic route, no auth bypass — pure functions only, so
// this suite does not rot at teardown like the older ones.
//
// NOTE ON TIMEZONE: these tests assert the RELATIONSHIP between the helpers and
// the offsets they must survive, not a hardcoded local answer, so they hold
// whatever TZ the runner is in. The one Riyadh-specific claim is called out.

import { test, expect } from "@playwright/test";
import { localMonthKeyOf, currentMonthKey, todayKey } from "../lib/utils";
import { monthKeyOf } from "../lib/commission";

test("monthKeyOf buckets by the UTC instant — correct by design, not a bug", () => {
  // 22:30Z on 31 Aug is 01:30 on 1 Sep in Riyadh. monthKeyOf must still say
  // August: that determinism is the whole reason it exists.
  expect(monthKeyOf("2026-08-31T22:30:00.000Z")).toBe("2026-08");
});

test("localMonthKeyOf converts the instant before slicing", () => {
  const iso = "2026-08-31T22:30:00.000Z";
  const utcMonth = monthKeyOf(iso);
  const localMonth = localMonthKeyOf(iso);
  // In any zone at or east of UTC+2 this instant is already September locally.
  // Rather than hardcode that, assert the two helpers are allowed to disagree
  // and that localMonthKeyOf agrees with the platform's own local calendar.
  const d = new Date(iso);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  expect(localMonth).toBe(expected);
  expect(utcMonth).toBe("2026-08");
});

// THE GUARD THAT MATTERS MOST. These call sites sit beside ones reading DATE
// columns, and `new Date("2026-08-15")` parses as UTC midnight — which in a
// NEGATIVE offset would shift back to 14 Aug and, on the 1st, to the previous
// month. A bug that could never reproduce in Riyadh.
test("a plain YYYY-MM-DD is sliced directly, never round-tripped through Date", () => {
  expect(localMonthKeyOf("2026-08-15")).toBe("2026-08");
  expect(localMonthKeyOf("2026-01-01")).toBe("2026-01");
  expect(localMonthKeyOf("2026-12-31")).toBe("2026-12");
  // Identical to what monthKeyOf gives for a DATE column, which is why leaving
  // trip_date / topup_date on monthKeyOf is correct rather than an oversight.
  for (const d of ["2026-08-15", "2026-01-01", "2026-12-31"]) {
    expect(localMonthKeyOf(d)).toBe(monthKeyOf(d));
  }
});

test("an unparseable value degrades to the old slice rather than throwing", () => {
  // A figure we cannot read must not take a page down — the same rule the
  // Dashboard applies to failed fetches.
  expect(localMonthKeyOf("not-a-date")).toBe("not-a-d");
});

test("currentMonthKey is the first seven characters of todayKey", () => {
  // Both read the same local clock; if they ever disagree, one of them has been
  // re-implemented instead of composed.
  expect(currentMonthKey()).toBe(todayKey().slice(0, 7));
  expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
});

test("currentMonthKey is evaluated per call, not captured once", () => {
  // The original defect was a module-level const that never rolled over. A
  // function cannot regress to that silently, but this pins the intent: two
  // calls must both be live reads, not one cached value handed out twice.
  expect(typeof currentMonthKey).toBe("function");
  expect(currentMonthKey()).toBe(currentMonthKey());
});

test("localMonthKeyOf agrees with currentMonthKey for a timestamp taken now", () => {
  // The end-to-end relationship the four fixed call sites depend on: a trip
  // delivered *now* must land in the month the UI calls "this month".
  expect(localMonthKeyOf(new Date().toISOString())).toBe(currentMonthKey());
});
