import { createClient } from "@/lib/supabase/server";
import type { Truck, OperationStation } from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { buildTruckStatusMap, type TruckOpsState } from "@/lib/truck-status";
import { todayKey } from "@/lib/utils";
import FleetClient from "./FleetClient";

export const dynamic = "force-dynamic";

// Truck row joined with the assigned driver's name (single source of truth lives
// on trucks.assigned_driver_id; the driver name is denormalised for the table).
type JoinedTruck = Truck & { driver: { name: string } | null };
export type TruckRow = Truck & { driverName: string | null };
export type DriverLite = {
  id: string;
  name: string;
  status: string;
  active: boolean;
  safety_score: number | null;
  rating: number | null;
};

export default async function FleetPage() {
  const supabase = createClient();

  // 30-day window for the per-driver trip count (Trips30d) used by the
  // Assign Driver modal + Detail driver card. UTC, consistent with the rest.
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const today = todayKey(); // local (matches trip day-math), not UTC

  const [
    trucksRes,
    driversRes,
    tripsRes,
    leavePeriodsRes,
    activeProjectsRes,
    projectDriversRes,
    operationStationsRes,
    activeWorkOrdersRes,
    activeOutsourcedJobsRes,
  ] = await Promise.all([
    // Terminated trucks vanish from the fleet list entirely (0020) — restorable
    // later from Archive. Filtering here also frees their driver: the
    // truckDriverIds set below is built from this array, so a terminated
    // truck's assigned_driver_id simply never enters it -> off_duty.
    supabase
      .from("trucks")
      .select("*, driver:drivers(name)")
      .is("terminated_at", null)
      .order("created_at", { ascending: false }),
    // Terminated drivers must never reach buildDriverStateMap or the Assign
    // Driver picker — filtered at the fetch.
    supabase
      .from("drivers")
      .select("id, name, status, active, safety_score, rating")
      .is("terminated_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("trips")
      .select("driver_id, trip_date")
      .gte("trip_date", since),
    // On-leave-today drivers (DB date filter — no inline range check). Feeds
    // lib/leave so the assign list shows + disables on-leave drivers (UI only).
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today),
    // Non-archived projects (id + name) + project↔driver membership → the
    // hasActiveProject fact for the derived driver-state pill (truck but no
    // active project = idle), AND the names feed the truck table's "Assigned
    // Project" column.
    supabase.from("projects").select("id, name").is("archived_at", null),
    supabase.from("project_drivers").select("project_id, driver_id"),
    // Operation stations (0022) — the truck/driver/staff BASE. ALL rows (active
    // + inactive): feeds the truck form's picker (must resolve an already-
    // assigned-but-deactivated station) AND the filter dropdown/table name lookup.
    supabase
      .from("operation_stations")
      .select("id, name, latitude, longitude, active, created_at")
      .order("name", { ascending: true }),
    // Auto Truck-Status Phase 2a — the two facts behind the derived status
    // (lib/truck-status.ts): any in_progress job on a truck, across BOTH
    // tracks. Minimal columns, filtered server-side to in_progress only.
    supabase.from("work_orders").select("truck_id").eq("status", "in_progress"),
    supabase.from("outsourced_jobs").select("truck_id").eq("status", "in_progress"),
  ]);

  const drivers = (driversRes.data ?? []) as DriverLite[];
  // driver:drivers(name) is an UNFILTERED SQL join — it resolves against the full
  // drivers table regardless of the active-only `drivers` fetch above. A truck
  // still pointing at a terminated driver would otherwise keep showing their
  // name. Gate display against the active-driver id set instead.
  const activeDriverIds = new Set(drivers.map((d) => d.id));
  const trucks: TruckRow[] = ((trucksRes.data ?? []) as JoinedTruck[]).map((t) => ({
    ...t,
    driverName:
      t.assigned_driver_id && activeDriverIds.has(t.assigned_driver_id)
        ? t.driver?.name ?? null
        : null,
  }));

  // Per-driver trip count over the last 30 days (REAL — derived, not stored).
  const trips30d: Record<string, number> = {};
  for (const tr of (tripsRes.data ?? []) as { driver_id: string | null }[]) {
    if (tr.driver_id) trips30d[tr.driver_id] = (trips30d[tr.driver_id] ?? 0) + 1;
  }

  // Computed on-leave-today driver ids (authoritative availability signal).
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const onLeaveDriverIds = Array.from(onLeaveTodaySet(leavePeriods, today).drivers);

  // ---- Derived driver state map (lib/driver-state) ----
  const activeProjects = (activeProjectsRes.data ?? []) as { id: string; name: string }[];
  const activeProjectIds = new Set(activeProjects.map((p) => p.id));
  const activeProjectNameById = new Map(activeProjects.map((p) => [p.id, p.name] as const));
  const truckDriverIds = new Set(
    trucks.map((t) => t.assigned_driver_id).filter((id): id is string => id != null)
  );
  const activeProjectDriverIds = new Set(
    ((projectDriversRes.data ?? []) as { project_id: string; driver_id: string }[])
      .filter((r) => activeProjectIds.has(r.project_id))
      .map((r) => r.driver_id)
  );
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    drivers, truckDriverIds, activeProjectDriverIds, leavePeriods, today,
  );

  // driver_id -> stacked {id, name} of their active projects — the truck
  // table's "Assigned Project" column resolves through a truck's assigned
  // driver. Carries the id so the pill can be colored via lib/project-colors'
  // pillColor(id), matching the same project's color on the Trips board.
  const activeProjectNamesByDriver: Record<string, { id: string; name: string }[]> = {};
  for (const r of (projectDriversRes.data ?? []) as { project_id: string; driver_id: string }[]) {
    const name = activeProjectNameById.get(r.project_id);
    if (!name) continue;
    const arr = (activeProjectNamesByDriver[r.driver_id] ??= []);
    if (!arr.some((p) => p.id === r.project_id)) arr.push({ id: r.project_id, name });
  }

  const operationStations = (operationStationsRes.data ?? []) as OperationStation[];

  const error =
    trucksRes.error || driversRes.error || tripsRes.error || leavePeriodsRes.error ||
    activeProjectsRes.error || projectDriversRes.error || operationStationsRes.error ||
    activeWorkOrdersRes.error || activeOutsourcedJobsRes.error;

  // ---- Derived truck status (lib/truck-status) — Auto Truck-Status Phase
  // 2a. REPLACES the demo's stored/health-score-based trucks.status for
  // every display below (table pills, filters, KPI counts). ----
  const activeJobTruckIds = new Set<string>([
    ...((activeWorkOrdersRes.data ?? []) as { truck_id: string }[]).map((r) => r.truck_id),
    ...((activeOutsourcedJobsRes.data ?? []) as { truck_id: string }[]).map((r) => r.truck_id),
  ]);
  const truckStatusById: Record<string, TruckOpsState> = buildTruckStatusMap(trucks, activeJobTruckIds);

  // ---- KPI strip (6) — all REAL, nulls skipped, no division-by-zero ----
  const total = trucks.length;
  const active = trucks.filter((t) => truckStatusById[t.id] === "active").length;
  const maint = trucks.filter((t) => truckStatusById[t.id] === "maintenance").length;
  const idle = trucks.filter((t) => truckStatusById[t.id] === "idle").length;

  const capVals = trucks.map((t) => t.capacity_m3).filter((v): v is number => v != null);
  const totalCap = capVals.reduce((s, v) => s + v, 0);

  const healthVals = trucks.map((t) => t.health_score).filter((v): v is number => v != null);
  const avgHealth = healthVals.length
    ? +(healthVals.reduce((s, v) => s + v, 0) / healthVals.length).toFixed(1)
    : null;

  const kpis = {
    total,
    active,
    maint,
    idle,
    totalCap,
    capHasData: capVals.length > 0,
    avgHealth,
  };

  return (
    <FleetClient
      trucks={trucks}
      drivers={drivers}
      trips30d={trips30d}
      onLeaveDriverIds={onLeaveDriverIds}
      driverStateById={driverStateById}
      truckStatusById={truckStatusById}
      activeProjectNamesByDriver={activeProjectNamesByDriver}
      operationStations={operationStations}
      kpis={kpis}
      errorMsg={error ? error.message : null}
    />
  );
}
