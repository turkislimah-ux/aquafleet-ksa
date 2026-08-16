// The Fleet assign gate — who may be put on a truck, and who may not.
//
// WHY THIS TEST EXISTS. `assignDriver` had NO server-side availability check:
// the only thing stopping an unavailable driver being assigned was a greyed-out
// row in the Assign Driver modal. A stale tab, a second window, or a direct
// action call went straight through. The rule now lives in
// lib/driver-assignment.ts and BOTH the modal and the server action call it.
//
// WHAT THIS TEST CAN AND CANNOT PROVE — stated up front, because a test that
// quietly proves less than it looks like it does is worse than none (the
// lesson tests/trip-station-gate.spec.ts already recorded for the station
// gate). `driverAvailability` IS the whole decision, so driving it directly
// covers the rule completely. What it does NOT cover is the server action's
// four reads — whether they resolve the right rows. Those cannot be exercised
// here: without a Supabase session RLS returns zero rows, the gate would then
// refuse for the WRONG reason, and the test would still go green. That half was
// proven against real rows through the MCP, with a temporary leave_periods row
// that was inserted and deleted inside the same verification.
//
// No browser, no diagnostic route, no auth bypass — so unlike the older suites
// this one does not rot at teardown.

import { test, expect } from "@playwright/test";
import { driverAvailability, resolveOnLeaveToday, type DriverAvailabilityFacts } from "../lib/driver-assignment";
import type { LeavePeriod } from "../lib/leave";

// An otherwise-assignable driver. Each test flips exactly one fact, so a
// failure names the branch that broke rather than "something is off".
function available(over: Partial<DriverAvailabilityFacts> = {}): DriverAvailabilityFacts {
  return {
    driverName: "Khan",
    isCurrentDriver: false,
    terminated: false,
    assignedToOtherTruckPlate: null,
    onLeaveToday: false,
    ...over,
  };
}

test("an available driver is assignable", () => {
  const v = driverAvailability(available());
  expect(v.blockedReason).toBeNull();
  expect(v.error).toBeNull();
  expect(v.label).toBe("Available");
});

test("on leave today blocks the assignment", () => {
  const v = driverAvailability(available({ onLeaveToday: true }));
  expect(v.blockedReason).toBe("on_leave");
  expect(v.label).toBe("On leave today");
  // The message must name the driver and say why — this is the sentence the
  // modal shows, so a bare "not allowed" would be a regression in itself.
  expect(v.error).toContain("Khan");
  expect(v.error).toContain("on leave");
});

test("already assigned to another truck blocks, and names the plate", () => {
  const v = driverAvailability(available({ assignedToOtherTruckPlate: "BBB-1111" }));
  expect(v.blockedReason).toBe("assigned_elsewhere");
  expect(v.label).toBe("Already assigned · BBB-1111");
  expect(v.error).toContain("BBB-1111");
});

test("a terminated driver blocks — the picker's filter is not the gate", () => {
  const v = driverAvailability(available({ terminated: true }));
  expect(v.blockedReason).toBe("terminated");
  expect(v.label).toBe("Terminated");
});

test("terminated outranks every other reason", () => {
  const v = driverAvailability(
    available({ terminated: true, onLeaveToday: true, assignedToOtherTruckPlate: "BBB-1111" }),
  );
  expect(v.blockedReason).toBe("terminated");
});

test("assigned-elsewhere outranks on-leave in the label — the plate is actionable", () => {
  const v = driverAvailability(available({ assignedToOtherTruckPlate: "BBB-1111", onLeaveToday: true }));
  expect(v.blockedReason).toBe("assigned_elsewhere");
  expect(v.label).toBe("Already assigned · BBB-1111");
});

// THE EXEMPTION. Re-selecting the driver already on this truck is a no-op and
// must never start erroring — including the day they go on leave, which is
// precisely when a naive gate would break a screen that used to work.
test("the current driver is never blocked, even while on leave", () => {
  const v = driverAvailability(available({ isCurrentDriver: true, onLeaveToday: true }));
  expect(v.blockedReason).toBeNull();
  expect(v.error).toBeNull();
});

test("the label ignores the exemption — an on-leave current driver still reads as on leave", () => {
  const v = driverAvailability(available({ isCurrentDriver: true, onLeaveToday: true }));
  // Both statements are true at once: the row stays clickable AND the cell
  // tells the truth. Collapsing label into blockedReason would have to lie
  // about one of them.
  expect(v.label).toBe("On leave today");
  expect(v.blockedReason).toBeNull();
});

// The on-leave FACT must come from lib/leave's date rule, not a fresh
// comparison. These pin the boundaries the server gate depends on.
test("on-leave resolution is inclusive at both ends and ignores other drivers", () => {
  const periods = [
    { driver_id: "khan", staff_id: null, start_date: "2026-08-10", end_date: "2026-08-16" },
    { driver_id: "other", staff_id: null, start_date: "2026-08-01", end_date: "2026-12-31" },
  ] as unknown as LeavePeriod[];

  expect(resolveOnLeaveToday(periods, "khan", "2026-08-10")).toBe(true); // first day
  expect(resolveOnLeaveToday(periods, "khan", "2026-08-16")).toBe(true); // last day
  expect(resolveOnLeaveToday(periods, "khan", "2026-08-09")).toBe(false); // day before
  expect(resolveOnLeaveToday(periods, "khan", "2026-08-17")).toBe(false); // day after
  // A leave period belonging to someone else must never block this driver.
  expect(resolveOnLeaveToday(periods, "khan", "2026-09-01")).toBe(false);
});

// A staff leave row shares the table with driver rows. Reading it as a driver's
// leave would block an available driver for no visible reason.
test("a staff leave row never blocks a driver", () => {
  const periods = [
    { driver_id: null, staff_id: "khan", start_date: "2026-08-01", end_date: "2026-08-31" },
  ] as unknown as LeavePeriod[];
  expect(resolveOnLeaveToday(periods, "khan", "2026-08-16")).toBe(false);
});
