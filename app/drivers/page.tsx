// Drivers & People — server entry. Mirrors the demo's single /drivers route with
// three tabs (Drivers · Commissions · Management & Staff). This commit ships the
// shell + DRIVERS tab; Commissions/Staff arrive in later commits.
//
// Trips30d is REAL (count this driver's trips in the last 30 days); recent trips
// feed the Driver Detail modal. Both derived from one trips fetch.

import { createClient } from "@/lib/supabase/server";
import type { Driver, Staff, StaffRole, OperationStation } from "@/lib/db-types";
import type { LeavePeriod, LeaveType } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
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
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [driversRes, trucksRes, tripsRes, commTripsRes, cyclesRes, specialsRes, adjustmentsRes, projectsRes, payoutsRes, staffRes, staffRolesRes, leavePeriodsRes, leaveTypesRes, projectDriversRes, operationStationsRes] =
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
      supabase
        .from("trips")
        .select("driver_id, project_id, commission_sar, delivered_at, payout_id")
        .not("delivered_at", "is", null)
        .is("payout_id", null),
      // The open per-driver cycle (rolling). Bonus is reviewable.
      supabase
        .from("commission_periods")
        .select("driver_id, bonus_sar, bonus_status, bonus_deny_reason, payout_status, approved_by, month_key, deny_reason"),
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
      supabase
        .from("staff_roles")
        .select("id, key, label, is_default, active, created_at")
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
        .select("id, key, label, is_default, active, created_at")
        .eq("active", true)
        .order("is_default", { ascending: false })
        .order("label", { ascending: true }),
      // Project↔driver membership → hasActiveProject fact for the derived pill.
      supabase.from("project_drivers").select("project_id, driver_id"),
      // Operation stations (0022) — the driver/truck/staff BASE. ALL rows (active
      // + inactive): the picker needs inactive rows too, to resolve an
      // already-assigned-but-deactivated station instead of rendering blank.
      supabase
        .from("operation_stations")
        .select("id, name, latitude, longitude, active, created_at")
        .order("name", { ascending: true }),
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
  const operationStations = (operationStationsRes.data ?? []) as OperationStation[];
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
    projectDriversRes.error ||
    operationStationsRes.error;

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
      operationStations={operationStations}
      today={today}
      projectsById={projectsById}
      activeProjectNamesByDriver={activeProjectNamesByDriver}
      driverStateById={driverStateById}
      error={error?.message ?? null}
    />
  );
}
