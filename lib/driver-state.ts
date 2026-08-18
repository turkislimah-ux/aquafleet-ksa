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
//
// The reversible "deactivated" state is gone — termination (0020,
// terminated_at) supersedes it and removes a driver from these surfaces
// entirely rather than flipping a flag.

import { periodCoversToday, type LeavePeriod } from "./leave";

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

// Colour mapping for the 4 derived states — Turki's call: Active=green,
// Idle=amber, Off duty=yellow, On leave=yellow. Lives HERE, beside the labels,
// so the pill and the "On duty" KPI bar read one map instead of two.
//
// The token names match components/ui.tsx's PillTone STRUCTURALLY but the type
// is declared locally ON PURPOSE: importing PillTone would add a lib -> components
// import edge (this file is a pure leaf that never touches React). Structural
// compatibility is all the call site needs.
//
// NOT COVERED HERE: `terminated` is not a DriverState (termination is a
// pre-filter, never a state — see CLAUDE.md §6). Its red is applied by whatever
// surface renders a terminated row, outside this map.
export type DriverStateTone = "ok" | "warn" | "yellow";

export const DRIVER_STATE_TONE: Record<DriverState, DriverStateTone> = {
  active: "ok",
  idle: "warn",
  off_duty: "yellow",
  on_leave: "yellow",
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

// Build a driver_id -> DriverState map for a set of drivers on `date`. Callers
// pass pre-built membership sets (truck / active-project) and the raw leave
// periods; onLeave is resolved per driver via resolveOnLeave. Used by every
// server surface that renders a derived driver pill, so the resolution lives in
// exactly one place.
export function buildDriverStateMap(
  drivers: { id: string }[],
  truckDriverIds: Set<string>,
  activeProjectDriverIds: Set<string>,
  periods: LeavePeriod[],
  date: string,
): Record<string, DriverState> {
  const out: Record<string, DriverState> = {};
  for (const d of drivers) {
    out[d.id] = driverStatusOn(date, {
      hasTruck: truckDriverIds.has(d.id),
      hasActiveProject: activeProjectDriverIds.has(d.id),
      onLeave: resolveOnLeave(periods, d.id, date),
    });
  }
  return out;
}
