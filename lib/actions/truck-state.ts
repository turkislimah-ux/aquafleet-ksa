// The Dashboard's read of TRUCK STATUS — fetch only, no rule.
//
// ===========================================================================
// THE FLEET PAGE IS THE TRUTH. THE DASHBOARD IS A MIRROR.
// ===========================================================================
// Truck status is what Maintenance, Staff and Fleet all act on, so it has ONE
// definition: `truckOpsStatus` in lib/truck-status.ts. This module does not
// re-implement it, extend it, or hold a second opinion about it — it fetches
// the two facts that rule needs and calls it, exactly as app/fleet/page.tsx
// and app/drivers/page.tsx already do.
//
// It exists because the Dashboard previously read truck counts from
// `v_fleet_state_now`, whose `truck_state` CTE derives the SAME precedence in
// SQL. Two derivations, no guard, and the Dashboard is the surface most likely
// to be believed at a glance — so a divergence would show as two screens
// disagreeing about which trucks are in the workshop. The view's truck output
// is now UNREAD; this is what replaced it.
//
// WHY A SHARED MODULE RATHER THAN INLINE IN EACH CALLER: there are two
// Dashboard consumers (the page's "Fleet right now" donut and the fleet_mix
// Add-Summary widget). Inlining would put the FETCH in two places, and the
// fetch is where the subtle mistake lives — see the terminated filter below.
// The rule was already shared; this makes its input shared too, the same
// lesson buildActiveJobTruckIds recorded.
//
// NOT in lib/truck-status.ts on purpose: that module is PURE and never
// fetches, and its own header says so. This is the I/O half.

import type { createClient } from "@/lib/supabase/server";
import { buildActiveJobTruckIds, buildTruckStatusMap } from "@/lib/truck-status";

export type TruckStateCounts = {
  total: number;
  active: number;
  idle: number;
  maintenance: number;
  /** False when a read failed — the caller must not render 0 as a real count. */
  ok: boolean;
};

/**
 * Current truck-state counts, derived the one truthful way.
 *
 * THE `terminated_at is null` FILTER IS LOAD-BEARING. The SQL CTE this
 * replaced filtered terminated trucks, and Fleet's own list filters them too.
 * Omitting it here would make the Dashboard's total disagree with Fleet's for
 * every terminated truck — 2 of 15 live — which is precisely the "two screens,
 * two answers" failure this change exists to remove. Live today: 13 trucks.
 *
 * BOTH MAINTENANCE TRACKS, as always. A truck is in maintenance if it has an
 * in_progress work order OR an in_progress outsourced job; checking one reads
 * as idle while it sits in a workshop.
 */
export async function fetchTruckStateCounts(
  supabase: ReturnType<typeof createClient>,
): Promise<TruckStateCounts> {
  const [trucksRes, workOrdersRes, outsourcedRes] = await Promise.all([
    supabase.from("trucks").select("id, assigned_driver_id").is("terminated_at", null),
    supabase.from("work_orders").select("truck_id").eq("status", "in_progress"),
    supabase.from("outsourced_jobs").select("truck_id").eq("status", "in_progress"),
  ]);

  // A FAILED READ MUST NOT LOOK LIKE AN EMPTY FLEET. The Dashboard's standing
  // rule (CLAUDE.md section 7) is that a figure we could not read renders as
  // unknown, never as a confident zero.
  if (trucksRes.error || workOrdersRes.error || outsourcedRes.error) {
    return { total: 0, active: 0, idle: 0, maintenance: 0, ok: false };
  }

  const trucks = (trucksRes.data ?? []) as { id: string; assigned_driver_id: string | null }[];
  const activeJobTruckIds = buildActiveJobTruckIds(
    workOrdersRes.data as { truck_id: string }[] | null,
    outsourcedRes.data as { truck_id: string }[] | null,
  );
  const byId = buildTruckStatusMap(trucks, activeJobTruckIds);
  const states = Object.values(byId);

  return {
    total: trucks.length,
    active: states.filter((s) => s === "active").length,
    idle: states.filter((s) => s === "idle").length,
    maintenance: states.filter((s) => s === "maintenance").length,
    ok: true,
  };
}
