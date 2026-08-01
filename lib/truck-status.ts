// Derived truck status — single source of truth for the 3-state OPERATIONAL
// model that REPLACES the demo's stored/health-score-based trucks.status for
// display. Same "derived, never a stored manual choice" shape as
// lib/driver-state.ts. PURE: callers resolve the two facts (any in_progress
// job on this truck, any driver assigned) and pass booleans; this file never
// fetches.
//
// Precedence (first match wins):
//   hasActiveJob            -> 'maintenance'
//   !hasActiveJob && hasDriver -> 'active'
//   !hasActiveJob && !hasDriver -> 'idle'
//
// Fact resolution lives at the call site:
//   hasActiveJob = some work_orders row (status='in_progress') OR some
//                  outsourced_jobs row (status='in_progress') has this
//                  truck_id — BOTH tracks, checked together.
//   hasDriver    = trucks.assigned_driver_id is not null.
//
// Auto Truck-Status Phase 1 (migrations 0076/0077) already built the DB-side
// driver free/reassign engine (trucks.driver_before_maintenance,
// FIRST-IN/LAST-OUT logic inside start_work_order/dispatch_outsourced_job/
// complete_work_order/complete_outsourced_job). This is Phase 2a: the
// DISPLAY layer reading the same two facts, computed fresh at render time —
// never stored, never drifts from the truck's real current state. Phase 2b
// (driver display / "waiting" note) is separate, not built here.
//
// The stored trucks.status column (TruckStatus: active/idle/maintenance/
// out_of_service) is now DORMANT for display purposes — every screen reads
// this derived value instead. Column stays (dormant-not-deleted, same
// precedent as every other unused-but-not-dropped column in this app);
// out_of_service specifically has no derived equivalent — this 3-state model
// has no manual override path left to produce it anymore.

export type TruckOpsState = "maintenance" | "active" | "idle";

export type TruckFacts = {
  hasActiveJob: boolean;
  hasDriver: boolean;
};

export function truckOpsStatus(facts: TruckFacts): TruckOpsState {
  if (facts.hasActiveJob) return "maintenance";
  if (facts.hasDriver) return "active";
  return "idle";
}

export const TRUCK_OPS_STATE_LABELS: Record<TruckOpsState, string> = {
  maintenance: "Maintenance",
  active: "Active",
  idle: "Idle",
};

// Build a truck_id -> TruckOpsState map. Callers pass the truck rows
// (id + assigned_driver_id) and the pre-built set of truck ids with any
// in_progress job across BOTH tracks — resolved once per page, same
// "resolution lives in exactly one place" rule lib/driver-state.ts follows.
export function buildTruckStatusMap(
  trucks: { id: string; assigned_driver_id: string | null }[],
  activeJobTruckIds: Set<string>,
): Record<string, TruckOpsState> {
  const out: Record<string, TruckOpsState> = {};
  for (const t of trucks) {
    out[t.id] = truckOpsStatus({
      hasActiveJob: activeJobTruckIds.has(t.id),
      hasDriver: t.assigned_driver_id != null,
    });
  }
  return out;
}
