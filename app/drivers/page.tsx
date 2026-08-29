// Drivers & People — server entry. Mirrors the demo's single /drivers route with
// three tabs (Drivers · Commissions · Management & Staff). This commit ships the
// shell + DRIVERS tab; Commissions/Staff arrive in later commits.
//
// Trips30d is REAL (count this driver's trips in the last 30 days); recent trips
// feed the Driver Detail modal. Both derived from one trips fetch.

import { createClient } from "@/lib/supabase/server";
import type { Driver, Staff, StaffRole, OperationStation, DriverIncident, StaffCommission, StaffCommissionType } from "@/lib/db-types";
import type { LeavePeriod, LeaveType } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { buildActiveJobTruckIds, buildTruckStatusMap } from "@/lib/truck-status";
import { daysAgoKey, todayKey } from "@/lib/utils";
import DriversClient, { type TruckLite, type RecentTrip } from "./DriversClient";
import {
  buildCurrentRows,
  type CommTripRow,
  type CommCycle,
  type CommSpecialRow,
  type CommAdjustmentRow,
  type CommPayout,
} from "@/lib/commission-rows";

export const dynamic = "force-dynamic";

// Supabase to-one joins type as object-or-array depending on inference; normalize.
type RelName = { name: string } | { name: string }[] | null;
function oneName(rel: RelName): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0]?.name ?? null : rel.name;
}

type TripJoin = {
  driver_id: string | null;
  ref: string | null;
  trip_date: string;
  stage: string;
  tank_size_m3: number | null;
  project: RelName;
  customer: RelName;
};

export default async function DriversPage() {
  const supabase = createClient();
  // 30-day window for the per-driver trip count. BOTH ENDS OF THE WINDOW ON ONE
  // CLOCK. `since` used to be UTC (toISOString) while `today` below is local, so
  // between 00:00 and 02:59 Riyadh the window started a day earlier than `today`
  // implied and a driver's "Trips 30d" silently over-counted. Same defect the
  // Fleet page carried until 22aad18; this is its twin.
  const since = daysAgoKey(30);

  const [driversRes, trucksRes, tripsRes, commTripsRes, cyclesRes, specialsRes, adjustmentsRes, projectsRes, payoutsRes, staffRes, staffRolesRes, leavePeriodsRes, leaveTypesRes, staffCommissionsRes, commissionTypesRes, projectDriversRes, operationStationsRes, driverIncidentsRes, activeWorkOrdersRes, activeOutsourcedJobsRes, openWorkOrdersRes] =
    await Promise.all([
      supabase.from("drivers").select("*").order("created_at", { ascending: false }),
      // Terminated trucks vanish from the driver-detail "Current Assignment"
      // resolution (0020) — a driver on a just-terminated truck reads unassigned.
      supabase
        .from("trucks")
        .select("id, plate, model, status, home_station, assigned_driver_id")
        .is("terminated_at", null)
        .order("plate", { ascending: true }),
      supabase
        .from("trips")
        .select("driver_id, ref, trip_date, stage, tank_size_m3, project:projects(name), customer:customers(name)")
        .order("trip_date", { ascending: false }),
      // Commissions base = UNPAID delivered trips (commission_sar stamped on
      // Delivered; payout_id IS NULL = still in the driver's current balance).
      //
      // trip_date IS THE MONTH GRAIN (migration 0131). The RPC scopes a payment
      // with `trip_date >= start and trip_date < end`, so the client's month lens
      // must bucket on the SAME column or the screen and the payment disagree.
      // NOT delivered_at — 0109 already re-bucketed the Dashboard off it because
      // this fleet advances trips on the Kanban in bulk (310 trips once landed on
      // one afternoon). delivered_at stays the "is it earned" test, nothing more.
      supabase
        .from("trips")
        .select("driver_id, project_id, commission_sar, delivered_at, trip_date, payout_id")
        .not("delivered_at", "is", null)
        .is("payout_id", null),
      // The per-driver, PER-MONTH cycle row (0131 re-grained commission_periods
      // from one-open-row-per-driver to one row per (driver_id, month_key)).
      // payout_id tags a cycle whose bonus has already been paid — the client
      // must exclude those or a paid month's bonus double-counts.
      supabase
        .from("commission_periods")
        .select("driver_id, bonus_sar, bonus_status, bonus_deny_reason, payout_status, approved_by, month_key, deny_reason, payout_id"),
      // Only UNPAID specials/adjustments are part of the current balance.
      supabase
        .from("commission_specials")
        .select("id, driver_id, month_key, label, amount_sar, date, note, is_special_trip, status, deny_reason, payout_id")
        .is("payout_id", null),
      supabase
        .from("commission_adjustments")
        .select("id, driver_id, month_key, label, amount_sar, date, note, status, deny_reason, payout_id")
        .is("payout_id", null),
      supabase.from("projects").select("id, name, archived_at"),
      // Frozen History records (newest first; client filters by driver).
      supabase
        .from("commission_payouts")
        .select("id, driver_id, paid_at, approved_by, period_label, base_sar, specials_sar, adjustments_sar, bonus_sar, total_sar, snapshot")
        .order("paid_at", { ascending: false }),
      // Management & support staff — ACTIVE only (soft-deleted hidden), newest first.
      supabase.from("staff").select("*").is("terminated_at", null).order("created_at", { ascending: false }),
      // Roles lookup for the Add/Edit dropdown — active roles, defaults first.
      // `label_ar` (0168) is selected for DISPLAY only — StaffTab resolves it
      // through `arText`, and the create form still writes `label` alone. It is
      // populated on the seeded built-ins and null on custom rows, which fall
      // back to `label`. Same for leave_types below — one model, both lookups.
      supabase
        .from("staff_roles")
        .select("id, key, label, label_ar, is_default, active, created_at")
        .eq("active", true)
        .order("is_default", { ascending: false })
        .order("label", { ascending: true }),
      // Leave & absence (0012). All periods (driver + staff); "on leave today"
      // is computed client-side from these. Leave types for the picker.
      supabase
        .from("leave_periods")
        .select("id, driver_id, staff_id, leave_type, start_date, end_date, note, created_at")
        .order("start_date", { ascending: false }),
      supabase
        .from("leave_types")
        .select("id, key, label, label_ar, is_default, active, created_at")
        .eq("active", true)
        .order("is_default", { ascending: false })
        .order("label", { ascending: true }),
      // Polish item 4 (0080) — mechanic commissions. Unfiltered fetch (same
      // "one fetch, split client-side" convention as leave_periods above);
      // StaffTab/MechanicCommissionsSection read the mechanic's own live
      // active/terminated_at to decide what to show.
      supabase
        .from("staff_commissions")
        .select("id, staff_id, commission_type, amount_sar, commission_date, note, created_by, created_at")
        .order("commission_date", { ascending: false }),
      supabase
        .from("commission_types")
        .select("id, key, label_en, label_ar, active, created_at")
        .eq("active", true)
        .order("created_at", { ascending: true }),
      // Project↔driver membership → hasActiveProject fact for the derived pill.
      supabase.from("project_drivers").select("project_id, driver_id"),
      // Operation stations (0022) — the driver/truck/staff BASE. ALL rows (active
      // + inactive): the picker needs inactive rows too, to resolve an
      // already-assigned-but-deactivated station instead of rendering blank.
      supabase
        .from("operation_stations")
        .select("id, name, latitude, longitude, active, created_at")
        .order("name", { ascending: true }),
      // Driver incidents (0024) — unfiltered by termination: a soft-deleted
      // driver's incidents persist and must still resolve if their detail is
      // ever viewed. Newest first.
      supabase
        .from("driver_incidents")
        .select("id, driver_id, incident_date, type, description, created_at")
        .order("incident_date", { ascending: false }),
      // Auto Truck-Status Phase 2a — the two facts behind the derived truck
      // status (lib/truck-status.ts), same as app/fleet/page.tsx. Feeds the
      // driver detail card's "Current Assignment" truck pill.
      supabase.from("work_orders").select("truck_id").eq("status", "in_progress"),
      supabase.from("outsourced_jobs").select("truck_id").eq("status", "in_progress"),
      // Mechanics-team KPI (Management & Staff tab) — OPEN work orders per
      // mechanic. A SEPARATE fetch rather than widening the in_progress one
      // above: that one feeds buildActiveJobTruckIds, whose whole definition of
      // "this truck is in the workshop" is status = in_progress. Widening it
      // would silently put every open-but-not-started work order's truck into
      // maintenance across the Fleet surfaces.
      //
      // "Open" is an ALLOWLIST, not `neq('completed')` — a denylist adopts every
      // future status automatically (same rule 0103's trip_overdue follows).
      supabase
        .from("work_orders")
        .select("assigned_mechanic_id")
        .in("status", ["open", "in_progress", "awaiting_parts"]),
    ]);

  // ---- Driver set split (termination) ----------------------------------
  // ONE unfiltered fetch feeds all three consumers with different visibility
  // rules; the split happens here in JS, not via extra queries.
  //   allDrivers        — every driver row, terminated included. Feeds History
  //                        name-resolution (old payouts must still resolve).
  //   activeDrivers     — terminated_at is null. Feeds the roster/KPIs and
  //                        buildDriverStateMap (a terminated driver must never
  //                        reach the state pill).
  //   commissionDrivers — activeDrivers PLUS any terminated driver whose
  //                        rolling balance ≠ 0 (owed either way). Feeds the
  //                        Commissions tab so an unsettled terminated driver
  //                        stays visible until paid to zero.
  const allDrivers = (driversRes.data ?? []) as Driver[];
  const activeDrivers = allDrivers.filter((d) => !d.terminated_at);
  const trucks = (trucksRes.data ?? []) as TruckLite[];
  // Auto Truck-Status Phase 2a — derived, single source of truth.
  const activeJobTruckIds = buildActiveJobTruckIds(
    activeWorkOrdersRes.data as { truck_id: string }[] | null,
    activeOutsourcedJobsRes.data as { truck_id: string }[] | null,
  );
  const truckStatusById = buildTruckStatusMap(trucks, activeJobTruckIds);
  const trips = (tripsRes.data ?? []) as TripJoin[];
  const commTrips = (commTripsRes.data ?? []) as CommTripRow[];
  const cycles = (cyclesRes.data ?? []) as CommCycle[];
  const specials = (specialsRes.data ?? []) as CommSpecialRow[];
  const adjustments = (adjustmentsRes.data ?? []) as CommAdjustmentRow[];
  const payouts = (payoutsRes.data ?? []) as CommPayout[];
  const staff = (staffRes.data ?? []) as Staff[];
  const staffRoles = (staffRolesRes.data ?? []) as StaffRole[];
  const leavePeriods = (leavePeriodsRes.data ?? []) as LeavePeriod[];
  const leaveTypes = (leaveTypesRes.data ?? []) as LeaveType[];
  const staffCommissions = (staffCommissionsRes.data ?? []) as StaffCommission[];
  const commissionTypes = (commissionTypesRes.data ?? []) as StaffCommissionType[];
  const operationStations = (operationStationsRes.data ?? []) as OperationStation[];
  const driverIncidents = (driverIncidentsRes.data ?? []) as DriverIncident[];
  const today = todayKey(); // local (matches trip day-math), not UTC
  const projectsById: Record<string, string> = {};
  const activeProjectIds = new Set<string>();
  for (const p of (projectsRes.data ?? []) as { id: string; name: string; archived_at: string | null }[]) {
    projectsById[p.id] = p.name;
    if (p.archived_at == null) activeProjectIds.add(p.id);
  }

  // ---- Derived driver state map (lib/driver-state) ----
  // activeDrivers only — a terminated driver must never reach this map (no
  // pill, no appearance on any active surface that reads driverStateById).
  const truckDriverIds = new Set(
    (trucks as { assigned_driver_id: string | null }[])
      .map((t) => t.assigned_driver_id)
      .filter((id): id is string => id != null)
  );
  const activeProjectDriverIds = new Set(
    ((projectDriversRes.data ?? []) as { project_id: string; driver_id: string }[])
      .filter((r) => activeProjectIds.has(r.project_id))
      .map((r) => r.driver_id)
  );
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    activeDrivers, truckDriverIds, activeProjectDriverIds, leavePeriods, today,
  );

  // driver_id -> stacked {id, name} of their active (non-archived) projects —
  // Drivers table's "Assigned Project" column. Carries the id (not just the
  // name) so the pill can be colored via lib/project-colors' pillColor(id),
  // matching the same project's color on the Trips board. Reuses the
  // already-fetched project_drivers rows + projectsById map; no new query.
  const activeProjectNamesByDriver: Record<string, { id: string; name: string }[]> = {};
  for (const r of (projectDriversRes.data ?? []) as { project_id: string; driver_id: string }[]) {
    if (!activeProjectIds.has(r.project_id)) continue;
    const name = projectsById[r.project_id];
    if (!name) continue;
    const arr = (activeProjectNamesByDriver[r.driver_id] ??= []);
    if (!arr.some((p) => p.id === r.project_id)) arr.push({ id: r.project_id, name });
  }

  // ---- Commissions driver set: activeDrivers ∪ terminated-with-balance ----
  // buildCurrentRows is driver-set-agnostic (pure); run it once over EVERY
  // driver to get each one's rolling total, then keep a terminated driver
  // only while that total is non-zero (owed either direction). Settled to
  // exactly 0 → drops off, matching the active roster.
  const balanceByDriver: Record<string, number> = {};
  for (const r of buildCurrentRows({ drivers: allDrivers, trips: commTrips, cycles, specials, adjustments, includeEmpty: true })) {
    balanceByDriver[r.driverId] = r.total;
  }
  const commissionDrivers = allDrivers.filter(
    (d) => !d.terminated_at || (balanceByDriver[d.id] ?? 0) !== 0,
  );

  // Mechanics-team KPI input: staff_id -> count of OPEN work orders assigned to
  // them. Unassigned work orders (null mechanic) are dropped — they are open
  // work, but they are nobody's load, and counting them under a mechanic would
  // be a fabrication.
  const openWoByMechanic: Record<string, number> = {};
  for (const w of (openWorkOrdersRes.data ?? []) as { assigned_mechanic_id: string | null }[]) {
    if (!w.assigned_mechanic_id) continue;
    openWoByMechanic[w.assigned_mechanic_id] = (openWoByMechanic[w.assigned_mechanic_id] ?? 0) + 1;
  }

  const error =
    driversRes.error ||
    trucksRes.error ||
    tripsRes.error ||
    commTripsRes.error ||
    cyclesRes.error ||
    specialsRes.error ||
    adjustmentsRes.error ||
    projectsRes.error ||
    payoutsRes.error ||
    staffRes.error ||
    staffRolesRes.error ||
    leavePeriodsRes.error ||
    leaveTypesRes.error ||
    staffCommissionsRes.error ||
    commissionTypesRes.error ||
    projectDriversRes.error ||
    operationStationsRes.error ||
    driverIncidentsRes.error ||
    openWorkOrdersRes.error ||
    // These two were the only fetches on this page missing from the chain, and
    // the omission was not harmless: they feed buildActiveJobTruckIds, and a
    // failed read arrives as `null`, which yields an EMPTY set — i.e. every
    // truck reads as having no active job, so a truck in the workshop shows as
    // available. That is the "a failed read must never claim an empty queue"
    // rule (see the Dashboard entry in CLAUDE.md §7) in a different costume:
    // silently reporting the all-clear is worse than reporting nothing.
    activeWorkOrdersRes.error ||
    activeOutsourcedJobsRes.error;

  // Per-driver: count of trips in the last 30 days, and up to 6 most-recent trips.
  const trips30dByDriver: Record<string, number> = {};
  const recentByDriver: Record<string, RecentTrip[]> = {};
  for (const t of trips) {
    if (!t.driver_id) continue;
    if (t.trip_date >= since) {
      trips30dByDriver[t.driver_id] = (trips30dByDriver[t.driver_id] ?? 0) + 1;
    }
    const arr = (recentByDriver[t.driver_id] ??= []);
    if (arr.length < 6) {
      arr.push({
        ref: t.ref,
        trip_date: t.trip_date,
        stage: t.stage,
        tank_size_m3: t.tank_size_m3,
        dest: oneName(t.project) ?? oneName(t.customer),
      });
    }
  }

  return (
    <DriversClient
      drivers={activeDrivers}
      allDrivers={allDrivers}
      commissionDrivers={commissionDrivers}
      trucks={trucks}
      truckStatusById={truckStatusById}
      trips30dByDriver={trips30dByDriver}
      recentByDriver={recentByDriver}
      commTrips={commTrips}
      cycles={cycles}
      specials={specials}
      adjustments={adjustments}
      payouts={payouts}
      staff={staff}
      staffRoles={staffRoles}
      leavePeriods={leavePeriods}
      leaveTypes={leaveTypes}
      staffCommissions={staffCommissions}
      commissionTypes={commissionTypes}
      operationStations={operationStations}
      driverIncidents={driverIncidents}
      today={today}
      projectsById={projectsById}
      activeProjectNamesByDriver={activeProjectNamesByDriver}
      driverStateById={driverStateById}
      // Drivers-table "Unpaid commission" column. THE SAME MAP the Commissions
      // tab and its badge are built from — buildCurrentRows() above, run ONCE
      // over every driver with no month lens, against fetches already
      // pre-filtered to payout_id IS NULL. Threaded as a value rather than
      // recomputed in the client, so the column is structurally incapable of
      // disagreeing with the tab it links to.
      balanceByDriver={balanceByDriver}
      openWoByMechanic={openWoByMechanic}
      error={error?.message ?? null}
    />
  );
}
