import { createClient } from "@/lib/supabase/server";
import type { TruckUtilizationRolling30Row } from "@/lib/utilization";
import type {
  Truck,
  OperationStation,
  WorkOrder,
  WorkOrderPart,
  OutsourcedJob,
  OutsourcedJobRepairer,
  WorkshopPayment,
} from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { truckOpsStatus, type TruckOpsState } from "@/lib/truck-status";
import { daysAgoKey, todayKey } from "@/lib/utils";
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

  // BOTH ends of the 30-day window on ONE clock. `since` used to be UTC
  // (toISOString) while `today` was local, so between 00:00 and 02:59
  // Riyadh the window started a day earlier than `today` implied.
  const since = daysAgoKey(30);
  const today = todayKey(); // local (matches trip day-math), not UTC

  const [
    trucksRes,
    driversRes,
    tripsRes,
    leavePeriodsRes,
    activeProjectsRes,
    projectDriversRes,
    operationStationsRes,
    workOrdersRes,
    outsourcedJobsRes,
    staffNamesRes,
    repairerNamesRes,
    utilizationRes,
  ] = await Promise.all([
    // Terminated trucks are filtered out here too — a direct URL to a
    // terminated truck's id resolves to `truck: null` below (FleetDetailClient
    // already renders a "Truck not found" fallback for that case; no crash).
    supabase.from("trucks").select("*, driver:drivers(name)").is("terminated_at", null),
    // Terminated drivers must never reach buildDriverStateMap or the Assign
    // Driver picker — filtered at the fetch.
    supabase
      .from("drivers")
      .select("id, name, status, active, safety_score")
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
    // Operation stations (0022) — ALL rows (active + inactive), same reasons as
    // app/fleet/page.tsx: the Edit Truck modal's picker + this truck's own
    // station-name resolution both need inactive rows too.
    supabase
      .from("operation_stations")
      .select("id, name, latitude, longitude, active, created_at")
      .order("name", { ascending: true }),
    // Maintenance History card (Phase 5, app-only) — every in-house work
    // order ever opened against THIS truck, both tracks kept structurally
    // separate all the way through (never blended into one row shape).
    supabase
      .from("work_orders")
      .select("id, wo_number, truck_id, type, status, title, title_ar, opened_at, due_by, assigned_mechanic_id, estimated_cost_sar, actual_cost_sar, start_date")
      .eq("truck_id", id)
      .order("opened_at", { ascending: false }),
    supabase
      .from("outsourced_jobs")
      .select("id, os_number, truck_id, responsible_mechanic_id, type, title, title_ar, start_date, estimated_finish, status, created_at")
      .eq("truck_id", id)
      .order("created_at", { ascending: false }),
    // Name-lookup only, UNFILTERED (active + terminated/inactive both) — this
    // is read-only history display, not a live picker, so a since-left
    // mechanic or a soft-deleted repairer should still resolve to a real
    // name instead of silently vanishing from past records.
    supabase.from("staff").select("id, name"),
    supabase.from("repairers").select("id, name"),
    // Rolling-30 utilization for THIS truck (0130). A rolling window rather
    // than the calendar month the Fleet list shows: on a detail page the
    // question is "how has this truck been doing lately", which a month-to-date
    // figure answers badly on the 2nd of a month. The view owns the window --
    // from_day/to_day come back with the row and are printed, so the reader is
    // never guessing which 30 days these are.
    supabase.from("v_truck_utilization_rolling30").select("*").eq("truck_id", id).maybeSingle(),
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
  const operationStations = (operationStationsRes.data ?? []) as OperationStation[];

  // ---- Maintenance History (Phase 5) — dependents keyed on this truck's
  // own WO/OS ids, fetched in a second round trip (tiny per-truck dataset,
  // not worth forcing into the first Promise.all). ----
  const workOrders = (workOrdersRes.data ?? []) as WorkOrder[];
  const outsourcedJobs = (outsourcedJobsRes.data ?? []) as OutsourcedJob[];

  // Auto Truck-Status Phase 2a — derived status for THIS truck. Reuses the
  // work_orders/outsourced_jobs already fetched above for the Maintenance
  // History card (every status, this truck only) — no extra query needed.
  const truckStatus: TruckOpsState | null = truck
    ? truckOpsStatus({
        hasActiveJob:
          workOrders.some((w) => w.status === "in_progress") ||
          outsourcedJobs.some((j) => j.status === "in_progress"),
        hasDriver: truck.assigned_driver_id != null,
      })
    : null;
  const woIds = workOrders.map((w) => w.id);
  const osIds = outsourcedJobs.map((j) => j.id);

  const [workOrderPartsRes, outsourcedJobRepairersRes, workshopPaymentsRes] = await Promise.all([
    woIds.length > 0
      ? supabase.from("work_order_parts").select("id, work_order_id, part_id, qty, unit_price_sar, created_at").in("work_order_id", woIds)
      : Promise.resolve({ data: [] as WorkOrderPart[], error: null }),
    osIds.length > 0
      ? supabase.from("outsourced_job_repairers").select("id, outsourced_job_id, repairer_id, created_at").in("outsourced_job_id", osIds)
      : Promise.resolve({ data: [] as OutsourcedJobRepairer[], error: null }),
    // Actual OS cost is summed client-side from this — same "never stored
    // on outsourced_jobs" rule the Maintenance page itself follows.
    osIds.length > 0
      ? supabase
          .from("workshop_payments")
          .select("id, outsourced_job_id, repairer_id, invoice_number, invoice_date, subtotal_sar, vat_sar, discount_sar, grand_total_sar, note, created_by, created_at")
          .in("outsourced_job_id", osIds)
      : Promise.resolve({ data: [] as WorkshopPayment[], error: null }),
  ]);

  const workOrderParts = (workOrderPartsRes.data ?? []) as WorkOrderPart[];
  const outsourcedJobRepairers = (outsourcedJobRepairersRes.data ?? []) as OutsourcedJobRepairer[];
  const workshopPayments = (workshopPaymentsRes.data ?? []) as WorkshopPayment[];
  const staffNames = (staffNamesRes.data ?? []) as { id: string; name: string }[];
  const repairerNames = (repairerNamesRes.data ?? []) as { id: string; name: string }[];

  const errorMsg =
    trucksRes.error?.message ?? driversRes.error?.message ?? tripsRes.error?.message ??
    leavePeriodsRes.error?.message ?? activeProjectsRes.error?.message ?? projectDriversRes.error?.message ??
    operationStationsRes.error?.message ?? workOrdersRes.error?.message ?? outsourcedJobsRes.error?.message ??
    workOrderPartsRes.error?.message ?? outsourcedJobRepairersRes.error?.message ?? workshopPaymentsRes.error?.message ??
    staffNamesRes.error?.message ?? repairerNamesRes.error?.message ??
    utilizationRes.error?.message ?? null;

  // COERCED AT THE BOUNDARY (numeric arrives as a string). NULL preserved:
  // a truck with no available days in the window has no utilization, which is
  // not the same as 0%.
  const uRaw = utilizationRes.data as Record<string, unknown> | null;
  const utilization: TruckUtilizationRolling30Row | null = uRaw
    ? {
        truck_id: String(uRaw.truck_id ?? ""),
        plate: String(uRaw.plate ?? ""),
        from_day: String(uRaw.from_day ?? ""),
        to_day: String(uRaw.to_day ?? ""),
        worked_days: Number(uRaw.worked_days ?? 0),
        available_days: Number(uRaw.available_days ?? 0),
        maintenance_days: Number(uRaw.maintenance_days ?? 0),
        utilization_pct: uRaw.utilization_pct == null ? null : Number(uRaw.utilization_pct),
      }
    : null;

  return (
    <FleetDetailClient
      truck={truck}
      truckStatus={truckStatus}
      trucks={trucks}
      drivers={drivers}
      trips30d={trips30d}
      onLeaveDriverIds={onLeaveDriverIds}
      driverStateById={driverStateById}
      operationStations={operationStations}
      workOrders={workOrders}
      workOrderParts={workOrderParts}
      outsourcedJobs={outsourcedJobs}
      outsourcedJobRepairers={outsourcedJobRepairers}
      workshopPayments={workshopPayments}
      staffNames={staffNames}
      repairerNames={repairerNames}
      utilization={utilization}
      errorMsg={errorMsg}
    />
  );
}
