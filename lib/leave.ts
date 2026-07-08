// Leave & absence — pure model + helpers (see 0012_leave.sql).
//
// CORE RULE: a person is "on leave today" iff one of their leave_periods spans
// today (start_date <= today <= end_date). FUTURE periods do NOT count. This is
// the single source of truth for availability — NO inline date-range checks live
// anywhere else; every display site calls into here.
//
// `today` is always passed in as an ISO date string (YYYY-MM-DD) so callers
// control the clock (server "now" sliced to a date) and tests stay deterministic.

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

// Inclusive day count between two ISO dates (both ends count — Mar 1 to Mar 5
// is 5 days). Date.UTC is used purely for integer day-difference arithmetic on
// already-fixed calendar dates (not "now") — this sidesteps local-timezone DST
// shifts that could otherwise off-by-one a plain `new Date(iso)` diff. It is
// NOT the "what is today" concern (callers must derive `year` from the app's
// local-date helper, e.g. todayKey(), never from a fresh `new Date()` here).
function daysBetweenInclusive(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  return Math.round((endUtc - startUtc) / 86400000) + 1;
}

/**
 * Total inclusive days on leave within `year`, summed across every period,
 * each period CLIPPED to that year's Jan 1 – Dec 31 boundary. A period that
 * doesn't overlap `year` at all contributes 0. Pure — string comparisons on
 * ISO dates are safe here (YYYY-MM-DD sorts lexically = chronologically).
 */
export function leaveDaysInYear(
  periods: { start_date: string; end_date: string }[],
  year: number,
): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  let total = 0;
  for (const p of periods) {
    const start = p.start_date > yearStart ? p.start_date : yearStart;
    const end = p.end_date < yearEnd ? p.end_date : yearEnd;
    if (start > end) continue; // no overlap with this year
    total += daysBetweenInclusive(start, end);
  }
  return total;
}
