import { createClient } from "@/lib/supabase/server";
import type { Truck } from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
import type { TruckRow, DriverLite } from "../page";
import FleetDetailClient from "./FleetDetailClient";

export const dynamic = "force-dynamic";

type JoinedTruck = Truck & { driver: { name: string } | null };

// Fleet Detail. We fetch the full truck list (not just this row) so the
// Assign Driver modal can compute the busy-lock — a driver already on another
// truck must show as locked here exactly as it does on the list page. ~40 rows
// makes this cheap. trips30d is the same REAL 30-day count used elsewhere.
export default async function FleetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createClient();

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const today = todayKey(); // local (matches trip day-math), not UTC

  const [trucksRes, driversRes, tripsRes, leavePeriodsRes, activeProjectsRes, projectDriversRes] = await Promise.all([
    supabase.from("trucks").select("*, driver:drivers(name)"),
    // Terminated drivers must never reach buildDriverStateMap or the Assign
    // Driver picker — filtered at the fetch.
    supabase
      .from("drivers")
      .select("id, name, status, active, safety_score, rating")
      .is("terminated_at", null)
      .order("name", { ascending: true }),
    supabase.from("trips").select("driver_id, trip_date").gte("trip_date", since),
    // On-leave-today drivers (DB date filter — no inline range check). Feeds the
    // assigned-driver pill + assign-list lock (UI only, like the list page).
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today),
    // Non-archived projects + membership → hasActiveProject fact for derived state.
    supabase.from("projects").select("id").is("archived_at", null),
    supabase.from("project_drivers").select("project_id, driver_id"),
  ]);

  const drivers = (driversRes.data ?? []) as DriverLite[];
  // driver:drivers(name) is an UNFILTERED SQL join — see app/fleet/page.tsx for
  // the same fix + rationale. Gate display against the active-driver id set.
  const activeDriverIds = new Set(drivers.map((d) => d.id));
  const trucks: TruckRow[] = ((trucksRes.data ?? []) as JoinedTruck[]).map((t) => ({
    ...t,
    driverName:
      t.assigned_driver_id && activeDriverIds.has(t.assigned_driver_id)
        ? t.driver?.name ?? null
        : null,
  }));

  const trips30d: Record<string, number> = {};
  for (const tr of (tripsRes.data ?? []) as { driver_id: string | null }[]) {
    if (tr.driver_id) trips30d[tr.driver_id] = (trips30d[tr.driver_id] ?? 0) + 1;
  }

  // Computed on-leave-today driver ids (authoritative availability signal).
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const onLeaveDriverIds = Array.from(onLeaveTodaySet(leavePeriods, today).drivers);

  // ---- Derived driver state map (lib/driver-state) ----
  const activeProjectIds = new Set(
    ((activeProjectsRes.data ?? []) as { id: string }[]).map((p) => p.id)
  );
  const truckDriverIds = new Set(
    trucks.map((t) => t.assigned_driver_id).filter((did): did is string => did != null)
  );
  const activeProjectDriverIds = new Set(
    ((projectDriversRes.data ?? []) as { project_id: string; driver_id: string }[])
      .filter((r) => activeProjectIds.has(r.project_id))
      .map((r) => r.driver_id)
  );
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    drivers, truckDriverIds, activeProjectDriverIds, leavePeriods, today,
  );

  const truck = trucks.find((t) => t.id === id) ?? null;
  const errorMsg =
    trucksRes.error?.message ?? driversRes.error?.message ?? tripsRes.error?.message ??
    leavePeriodsRes.error?.message ?? activeProjectsRes.error?.message ?? projectDriversRes.error?.message ?? null;

  return (
    <FleetDetailClient
      truck={truck}
      trucks={trucks}
      drivers={drivers}
      trips30d={trips30d}
      onLeaveDriverIds={onLeaveDriverIds}
      driverStateById={driverStateById}
      errorMsg={errorMsg}
    />
  );
}
