// Leave & absence — pure model + helpers (see 0012_leave.sql).
//
// CORE RULE: a person is "on leave today" iff one of their leave_periods spans
// today (start_date <= today <= end_date). FUTURE periods do NOT count. This is
// the single source of truth for availability — NO inline date-range checks live
// anywhere else; every display site calls into here.
//
// `today` is always passed in as an ISO date string (YYYY-MM-DD) so callers
// control the clock (server "now" sliced to a date) and tests stay deterministic.

import type { DriverStatus } from "./db-types";

// One row of the leave_types lookup table (extensible; built-ins seeded).
export type LeaveType = {
  id: string;
  key: string;
  label: string;
  is_default: boolean;
  active: boolean;
  created_at: string;
};

// One recorded leave period. Exactly one of driver_id / staff_id is set
// (enforced by the DB check constraint).
export type LeavePeriod = {
  id: string;
  driver_id: string | null;
  staff_id: string | null;
  leave_type: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  note: string | null;
  created_at: string;
};

/**
 * Returns true if a leave period covers the given date (inclusive on both ends).
 * Canonical helper — any code that needs to ask "does this period span today/this date"
 * MUST go through this function rather than reimplementing start_date <= today <= end_date.
 */
export function periodCoversToday(p: LeavePeriod, today: string): boolean {
  return p.start_date <= today && today <= p.end_date;
}

// Is `ref` (a driver_id or staff_id) on leave today, given that person's
// periods? Only checks the matching id column based on `kind`.
export function isOnLeaveToday(
  periods: LeavePeriod[],
  kind: "driver" | "staff",
  refId: string,
  today: string,
): boolean {
  for (const p of periods) {
    const match = kind === "driver" ? p.driver_id === refId : p.staff_id === refId;
    if (match && periodCoversToday(p, today)) return true;
  }
  return false;
}

// Build the authoritative "on leave today" sets from ALL leave periods. Returns
// one Set of driver_ids and one Set of staff_ids currently on leave.
export function onLeaveTodaySet(
  periods: LeavePeriod[],
  today: string,
): { drivers: Set<string>; staff: Set<string> } {
  const drivers = new Set<string>();
  const staff = new Set<string>();
  for (const p of periods) {
    if (!periodCoversToday(p, today)) continue;
    if (p.driver_id) drivers.add(p.driver_id);
    if (p.staff_id) staff.add(p.staff_id);
  }
  return { drivers, staff };
}

// Effective driver status for display. Computed leave WINS: if on leave today,
// status is "on_leave" regardless of the stored value. Otherwise the stored
// "on_leave" enum is no longer authoritative — collapse it to "active" so the
// only source of on-leave truth is leave_periods. All other stored values pass
// through unchanged.
export function effectiveDriverStatus(
  stored: DriverStatus,
  onLeaveToday: boolean,
): DriverStatus {
  if (onLeaveToday) return "on_leave";
  if (stored === "on_leave") return "active";
  return stored;
}
