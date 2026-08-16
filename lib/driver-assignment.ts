// Can this driver be put on this truck? — ONE definition, used by the Fleet
// modal's row lock AND by the assignDriver server gate.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// The rule used to live inline in FleetClient.tsx as
//
//     const locked = (busyElsewhere || onLeaveToday) && !isCurrent;
//
// and NOWHERE ELSE. `assignDriver` wrote `assigned_driver_id` with no
// availability check at all, so a stale tab, a double-click after someone
// else's edit, or a direct action call could assign a driver the UI had greyed
// out. The client check was the only enforcement, which means there was none.
//
// The fix is NOT a second copy of the rule in the server action — that is the
// exact drift three migrations were just spent removing from truck status. The
// rule moved HERE, both sides call it, and neither can hold a private opinion
// about who is assignable.
//
// PURE, and it must stay pure: it takes resolved facts and returns a verdict.
// It never fetches, so a client component and a server action can share it.
//
// ===========================================================================
// WHAT BLOCKS AN ASSIGNMENT — the enumerated list
// ===========================================================================
//   TERMINATED           — invisible in the UI, because the picker's own fetch
//                          filters `terminated_at is null`. A FILTER IS NOT A
//                          GATE: it shapes the list, it does not refuse the
//                          write, so this is reachable only by a direct action
//                          call — which is precisely the threat model.
//   ASSIGNED ELSEWHERE   — the driver holds a different, non-terminated truck.
//                          The DB has the last word here (0002's partial unique
//                          index on assigned_driver_id), but it raises 23505,
//                          not a sentence a person can read.
//   ON LEAVE TODAY       — a leave_periods row spans today. NOTHING enforced
//                          this anywhere before: no column, no constraint, no
//                          trigger. It was the real hole.
//
// EXEMPTION: the driver ALREADY on this truck is never blocked. Re-selecting
// them is a no-op, and it must not start erroring the day they go on leave.
// Note the exemption applies to the VERDICT and not to the LABEL — the modal
// still shows "On leave today" beside a current driver who is on leave, which
// is true, while the row stays clickable. Collapsing the two would either lie
// in the cell or break the no-op.
//
// ===========================================================================
// WHAT DELIBERATELY DOES NOT BLOCK
// ===========================================================================
// · `v_driver_state_now.state` / lib/driver-state.ts. THIS IS THE IMPORTANT
//   ONE. `off_duty` means "has no truck" — every genuinely assignable driver in
//   the picker is off_duty, and assigning them is exactly how they stop being
//   off_duty. A gate reading `state !== 'off_duty'` would refuse every
//   legitimate assignment on the page. Driver state is a DISPLAY model, not an
//   availability model, and the two must not be conflated because one of their
//   four values happens to be named `on_leave`.
//
//   The on-leave FACT is nonetheless the same fact the state model uses: both
//   resolve through lib/leave.ts's `periodCoversToday`, which that file's own
//   header names as the single source of truth for availability. This module
//   reuses that helper rather than re-reading the state map, so there is one
//   date-range rule, not one rule and one view of it.
//
// · `drivers.status` / `drivers.active`. The reversible "deactivated" state was
//   superseded by termination (0020) and nothing on this page reads either
//   column for the lock. Gating on them here would invent a rule the UI does
//   not have.
//
// · A truck in maintenance, or a driver with trips in flight. Maintenance is a
//   TRUCK state (lib/truck-status.ts), not a driver one, and an in-flight trip
//   does not make its driver unassignable — CLAUDE.md section 6 records that
//   state and trip stage are separate facts on purpose.

import { isOnLeaveToday, type LeavePeriod } from "./leave";

export type AssignBlockReason = "terminated" | "assigned_elsewhere" | "on_leave";

export type DriverAvailabilityFacts = {
  driverName: string;
  /** Already on THIS truck — the no-op case, never blocked. */
  isCurrentDriver: boolean;
  /** `drivers.terminated_at` is set (or the driver row is gone entirely). */
  terminated: boolean;
  /** Plate of a DIFFERENT, non-terminated truck holding them; null if none. */
  assignedToOtherTruckPlate: string | null;
  /** A leave_periods row spans today — resolved via lib/leave. */
  onLeaveToday: boolean;
};

export type DriverAvailability = {
  /** Short text for the modal's Availability cell. Ignores the exemption. */
  label: string;
  /** Non-null means the write must be refused. Null for the current driver. */
  blockedReason: AssignBlockReason | null;
  /** Friendly sentence to show the user. Null when not blocked. */
  error: string | null;
};

/**
 * The one availability verdict.
 *
 * Label precedence matches what the modal has always rendered — an
 * assigned-elsewhere driver reads "Already assigned · PLATE" even if they are
 * also on leave, because the plate is the actionable half. `terminated` leads
 * only because a terminated driver never reaches the modal at all.
 */
export function driverAvailability(facts: DriverAvailabilityFacts): DriverAvailability {
  const { driverName, isCurrentDriver, terminated, assignedToOtherTruckPlate, onLeaveToday } = facts;

  const verdict = (reason: AssignBlockReason, label: string, error: string): DriverAvailability => ({
    label,
    // The exemption is applied HERE, once, so no caller can forget it.
    blockedReason: isCurrentDriver ? null : reason,
    error: isCurrentDriver ? null : error,
  });

  if (terminated) {
    return verdict(
      "terminated",
      "Terminated",
      `${driverName} has been terminated and can no longer be assigned to a truck.`,
    );
  }
  if (assignedToOtherTruckPlate) {
    return verdict(
      "assigned_elsewhere",
      `Already assigned · ${assignedToOtherTruckPlate}`,
      `${driverName} is already assigned to ${assignedToOtherTruckPlate}. Unassign them from that truck first.`,
    );
  }
  if (onLeaveToday) {
    return verdict(
      "on_leave",
      "On leave today",
      `${driverName} is on leave today and cannot be assigned to a truck.`,
    );
  }
  return { label: "Available", blockedReason: null, error: null };
}

/**
 * Resolve the on-leave fact for the gate, from leave rows already narrowed to
 * this driver. Exists so the server action never spells out a date comparison:
 * it delegates to lib/leave's `isOnLeaveToday`, the same helper the page's own
 * `onLeaveTodaySet` is built from.
 */
export function resolveOnLeaveToday(periods: LeavePeriod[], driverId: string, today: string): boolean {
  return isOnLeaveToday(periods, "driver", driverId, today);
}
