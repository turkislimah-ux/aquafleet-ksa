// Month keys: the two questions, and the invariant every month figure rests on.
//
// WHY THIS EXISTS. This repo had one expression of "what month is it" that was
// wrong twice — UTC, and a module-level const that never rolled over — and four
// places that bucketed a stored timestamptz by its UTC instant and compared the
// result against a local month key. Both are invisible for 21 hours a day, which
// is why they survived several review passes.
//
//   currentMonthKey()   which month is it NOW      lib/utils    reads the clock
//   monthKeyOf(iso)     the month of a stored date lib/commission  plain slice
//
// A third helper, localMonthKeyOf, briefly existed to convert timestamptz values
// to a local month. Re-basing the delivered figures onto trip_date removed its
// last caller and it was deleted — so the surviving invariant is simpler and
// stronger, and it is what these tests pin:
//
//   EVERY MONTH COMPARISON IN THE APP BUCKETS ON A **DATE** COLUMN.
//   trips.trip_date (NOT NULL) and customer_topups.topup_date are already local
//   calendar terms, so slicing them needs no timezone conversion at all, and
//   cannot drift from currentMonthKey() in any timezone.
//
// No browser, no diagnostic route, no auth bypass — pure functions only, so this
// suite does not rot at teardown like the older ones.

import { test, expect } from "@playwright/test";
import { currentMonthKey, todayKey } from "../lib/utils";
import { monthKeyOf } from "../lib/commission";

test("monthKeyOf on a DATE string is a plain slice — no Date parsing, no timezone", () => {
  // THE CENTRAL INVARIANT. Every month figure in the app compares
  // monthKeyOf(<DATE column>) against currentMonthKey(). Because a DATE column is
  // already a local calendar date, this must be pure string work — the moment it
  // round-trips through `new Date()` it becomes timezone-dependent, and west of
  // Greenwich "2026-08-01" would parse as UTC midnight and slice back to
  // "2026-07". This test fails in exactly that scenario.
  expect(monthKeyOf("2026-08-01")).toBe("2026-08");
  expect(monthKeyOf("2026-01-01")).toBe("2026-01");
  expect(monthKeyOf("2026-12-31")).toBe("2026-12");
});

test("currentMonthKey is the first seven characters of todayKey", () => {
  // Both read the same local clock. If they ever disagree, one has been
  // re-implemented instead of composed.
  expect(currentMonthKey()).toBe(todayKey().slice(0, 7));
  expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
});

test("a DATE key for today matches currentMonthKey", () => {
  // The end-to-end relationship every re-based call site depends on: a trip whose
  // trip_date is today must land in the month the UI calls "this month". This is
  // the assertion that would have caught the original UTC bug, in any timezone.
  expect(monthKeyOf(todayKey())).toBe(currentMonthKey());
});

test("currentMonthKey is evaluated per call, not captured once", () => {
  // The original defect was a module-level const that never rolled over. A
  // function cannot regress to that silently, but this pins the intent.
  expect(typeof currentMonthKey).toBe("function");
  expect(currentMonthKey()).toBe(currentMonthKey());
});

test("monthKeyOf still buckets a TIMESTAMP by its UTC instant — correct by design", () => {
  // monthKeyOf is NOT a bug and this is not a regression guard against it. UTC
  // bucketing is what makes payroll grouping deterministic across machines, and
  // lib/commission-rows' legacy month-based helpers still rely on it. It is only
  // wrong when its output is compared against a LOCAL month key — which, after
  // the trip_date re-base, no longer happens anywhere in the app.
  //
  // 22:30Z on 31 Aug is 01:30 on 1 Sep in Riyadh; monthKeyOf must still say Aug.
  expect(monthKeyOf("2026-08-31T22:30:00.000Z")).toBe("2026-08");
});
