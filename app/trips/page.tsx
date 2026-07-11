import { createClient } from "@/lib/supabase/server";
import type { Trip, WaterType, CommissionMode, ProjectStatus, DriverStatus, ProjectDriver, PaymentMode } from "@/lib/db-types";
import type { LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
import TripsTabs from "./TripsTabs";

export const dynamic = "force-dynamic";

type JoinedTrip = Trip & {
  project: { name: string } | null;
  customer: { name: string } | null;
  truck: { plate: string; capacity_m3: number | null } | null;
  driver: { name: string } | null;
};

// Project header fields the board needs (header + commission + location).
type ProjectHeader = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  commission_mode: CommissionMode;
  commission_value: number;
  commission_bump_pct: number;
  status: ProjectStatus;
  water_type: WaterType | null;
  // Finance (0025). NULL = unset.
  payment_mode: PaymentMode | null;
  default_station: string | null;
  default_water_station: string;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

export default async function TripsPage() {
  const supabase = createClient();

  const today = todayKey(); // local (matches trip day-math), not UTC
  const [
    tripsRes, projectsRes, customersRes, trucksRes, driversRes, assignmentsRes,
    stationsRes, allStationsRes, leavePeriodsRes, terminatedDriversRes,
  ] =
    await Promise.all([
      supabase
        .from("trips")
        .select(
          "*, project:projects(name), customer:customers(name), truck:trucks(plate, capacity_m3), driver:drivers(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select(
          "id, name, customer_id, rate_per_trip_sar, commission_mode, commission_value, commission_bump_pct, status, water_type, payment_mode, default_station, default_water_station, location, location_lat, location_lng, description"
        )
        .is("archived_at", null)
        .order("name", { ascending: true }),
      supabase
        .from("customers")
        .select(
          "id, name, default_station, delivery_site_address, customer_type, contact_name, phone, delivery_lat, delivery_lng"
        )
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // Terminated trucks are filtered out (0020) — this is also THE set that
      // resolves the no-truck blur + plate-strip rules in ProjectsBoard, so a
      // terminated truck's plate/driver-link disappear from active cards.
      supabase
        .from("trucks")
        .select("id, plate, capacity_m3, assigned_driver_id, last_service_date")
        .is("terminated_at", null)
        .order("plate", { ascending: true }),
      // Terminated drivers must never reach buildDriverStateMap or the
      // duty/roster pickers — filtered at the fetch.
      supabase
        .from("drivers")
        .select("id, name, status, active")
        .is("terminated_at", null)
        .order("name", { ascending: true }),
      supabase.from("project_drivers").select("project_id, driver_id"),
      // Pickers (Add Trip, phase picker, Manage Project, loading chip) — ACTIVE
      // stations only, so a deactivated station naturally disappears from every
      // selection surface without touching any of that UI directly.
      supabase.from("water_stations").select("key, name, is_default").eq("active", true).order("name", { ascending: true }),
      // Every station row (active + inactive), full columns — feeds the "Manage
      // stations" popup AND stationsByKey (name resolution must still work for
      // old trips pointing at a since-deactivated station's key).
      supabase
        .from("water_stations")
        .select("id, key, name, city, latitude, longitude, fill_cost, is_default, active")
        .order("name", { ascending: true }),
      // FULL leave periods (NOT today-prefiltered): the pill still resolves "today"
      // via buildDriverStateMap, but Add Trip also needs on-leave for an ARBITRARY
      // selected calendar day, so the raw periods must cover any date.
      supabase
        .from("leave_periods")
        .select("id, driver_id, staff_id, leave_type, start_date, end_date, note, created_at"),
      // Terminated drivers' termination_date — needed to hide their FUTURE trips
      // (trip_date > termination_date) from active views below, while keeping
      // past trips visible as history. Small separate fetch since the main
      // `drivers` query above is active-only (terminated_at is null).
      supabase
        .from("drivers")
        .select("id, termination_date")
        .not("terminated_at", "is", null),
    ]);

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    truckCapacityM3: t.truck?.capacity_m3 ?? null,
    driverName: t.driver?.name ?? null,
  }));

  // Water stations lookup. `stations` (active-only) feeds every SELECTION picker
  // (New Project, Add Trip, phase picker, loading chip). `allStations` (every
  // row, active + inactive, full columns) feeds the "Manage stations" popup.
  // `stationsByKey` resolves the trip card's "Fill at:" line and must cover
  // inactive stations too — an old trip pointing at a deactivated key still
  // needs to show its name.
  const stations = (stationsRes.data ?? []) as { key: string; name: string; is_default: boolean }[];
  type WaterStationRow = {
    id: string;
    key: string;
    name: string;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    fill_cost: number | null;
    is_default: boolean;
    active: boolean;
  };
  const allStations = (allStationsRes.data ?? []) as WaterStationRow[];
  const stationsByKey: Record<string, string> = {};
  for (const s of allStations) {
    stationsByKey[s.key] = s.name;
  }

  const projects = (projectsRes.data ?? []) as ProjectHeader[];

  // Hide trips whose project was archived (the projects query above is already
  // active-only). Trips with NO project (ad-hoc / customer-only) are kept — they
  // have no project lifecycle to follow.
  const activeProjectIds = new Set(projects.map((p) => p.id));
  // Terminated-driver lookup: hide a trip iff its driver is terminated AND the
  // trip is in the future relative to that driver's termination_date. Trips on
  // or before termination_date stay visible (history). Strict boundary: `>`.
  const terminationDateByDriverId = new Map(
    ((terminatedDriversRes.data ?? []) as { id: string; termination_date: string | null }[])
      .filter((d) => d.termination_date != null)
      .map((d) => [d.id, d.termination_date as string])
  );
  const visibleTrips = trips.filter((t) => {
    if (t.project_id != null && !activeProjectIds.has(t.project_id)) return false;
    if (t.driver_id) {
      const termDate = terminationDateByDriverId.get(t.driver_id);
      if (termDate && t.trip_date > termDate) return false;
    }
    return true;
  });
  const customers = (customersRes.data ?? []) as {
    id: string;
    name: string;
    default_station: string | null;
    delivery_site_address: string | null;
    customer_type: string;
    contact_name: string | null;
    phone: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
  }[];
  const trucks = (trucksRes.data ?? []) as {
    id: string;
    plate: string;
    capacity_m3: number | null;
    assigned_driver_id: string | null;
    last_service_date: string | null;
  }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string; status: DriverStatus; active: boolean }[];

  // Map project_id -> [driver_id, …] for the Manage-drivers modal + driver count.
  const assignmentsByProject: Record<string, string[]> = {};
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    (assignmentsByProject[a.project_id] ??= []).push(a.driver_id);
  }

  // ---- Derived driver state map (lib/driver-state) ----
  // hasActiveProject = a project_drivers row on a NON-archived project. `projects`
  // above is already active-only, so activeProjectIds is exactly that set.
  const truckDriverIds = new Set(
    trucks.map((t) => t.assigned_driver_id).filter((id): id is string => id != null)
  );
  const activeProjectDriverIds = new Set<string>();
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    if (activeProjectIds.has(a.project_id)) activeProjectDriverIds.add(a.driver_id);
  }
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    drivers, truckDriverIds, activeProjectDriverIds, leavePeriods, today,
  );
  // Fail-safe: if leave data failed to load, the assignment surfaces must NOT
  // fail-open (treat everyone as available). This flag blocks/flags instead.
  const leaveLoadFailed = !!leavePeriodsRes.error;

  const error =
    tripsRes.error ||
    projectsRes.error ||
    customersRes.error ||
    trucksRes.error ||
    driversRes.error ||
    assignmentsRes.error ||
    stationsRes.error ||
    allStationsRes.error ||
    leavePeriodsRes.error ||
    terminatedDriversRes.error;

  return (
    <TripsTabs
      error={error ? error.message : null}
      trips={visibleTrips}
      projects={projects}
      customers={customers}
      trucks={trucks}
      drivers={drivers}
      assignmentsByProject={assignmentsByProject}
      stationsByKey={stationsByKey}
      stations={stations}
      allStations={allStations}
      driverStateById={driverStateById}
      leavePeriods={leavePeriods}
      leaveLoadFailed={leaveLoadFailed}
    />
  );
}
