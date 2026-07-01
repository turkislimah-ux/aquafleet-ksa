// Derived driver status — single source of truth for the 4-state OPERATIONAL
// model that replaces stored drivers.status for display (see recon). PURE:
// callers resolve the three facts (truck, active project, leave-for-a-date) and
// pass booleans; this file never fetches.
//
// Precedence (first match wins):
//   onLeave                          -> 'on_leave'
//   !hasTruck                        -> 'off_duty'
//   hasTruck && !hasActiveProject    -> 'idle'
//   hasTruck &&  hasActiveProject    -> 'active'
//
// Fact resolution lives at the call site:
//   hasTruck         = some trucks row has assigned_driver_id === driver.id
//   hasActiveProject = project_drivers joined to a NON-archived project
//   onLeave          = resolveOnLeave(periods, driverId, date) — reuses lib/leave

import { periodCoversToday, type LeavePeriod } from "./leave";
import { DRIVER_STATUS_LABELS, type DriverStatus } from "./db-types";

export type DriverState = "active" | "idle" | "off_duty" | "on_leave";

export type DriverFacts = {
  hasTruck: boolean;
  hasActiveProject: boolean;
  onLeave: boolean;
};

// `date` (YYYY-MM-DD) is accepted for call-site symmetry with the leave model —
// the onLeave fact is already resolved FOR that date. The function itself is
// date-agnostic once the facts are booleans; the param documents intent and
// keeps the signature stable as later commits thread contextual dates.
export function driverStatusOn(date: string, facts: DriverFacts): DriverState {
  void date;
  if (facts.onLeave) return "on_leave";
  if (!facts.hasTruck) return "off_duty";
  if (!facts.hasActiveProject) return "idle";
  return "active";
}

export const DRIVER_STATE_LABELS: Record<DriverState, string> = {
  active: "Active",
  idle: "Idle",
  off_duty: "Off duty",
  on_leave: "On leave",
};

// Resolve the on-leave fact for one driver on an arbitrary date, reusing the
// canonical range check (periodCoversToday) — NO new date logic here.
export function resolveOnLeave(
  periods: LeavePeriod[],
  driverId: string,
  date: string,
): boolean {
  for (const p of periods) {
    if (p.driver_id === driverId && periodCoversToday(p, date)) return true;
  }
  return false;
}

// Fold-in of the coercion the recon found duplicated 3x (FleetClient,
// FleetDetailClient x2). Normalizes an unknown stored drivers.status string to a
// valid DriverStatus, defaulting unrecognized values to 'inactive'. This is
// output-preserving — kept so the existing effectiveDriverStatus pills stay
// byte-identical until Commit 2 migrates them to the 4-state model above.
export function coerceStoredStatus(status: string): DriverStatus {
  return (status in DRIVER_STATUS_LABELS ? status : "inactive") as DriverStatus;
}
