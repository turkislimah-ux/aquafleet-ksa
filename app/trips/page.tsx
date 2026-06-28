import { createClient } from "@/lib/supabase/server";
import type { Trip, WaterType, CommissionMode, ProjectStatus, DriverStatus, ProjectDriver } from "@/lib/db-types";
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
  default_station: string | null;
  default_water_station: string;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

export default async function TripsPage() {
  const supabase = createClient();

  const [tripsRes, projectsRes, customersRes, trucksRes, driversRes, assignmentsRes, stationsRes] =
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
          "id, name, customer_id, rate_per_trip_sar, commission_mode, commission_value, commission_bump_pct, status, water_type, default_station, default_water_station, location, location_lat, location_lng, description"
        )
        .order("name", { ascending: true }),
      supabase
        .from("customers")
        .select("id, name, default_station, delivery_site_address")
        .order("name", { ascending: true }),
      supabase
        .from("trucks")
        .select("id, plate, capacity_m3, assigned_driver_id")
        .order("plate", { ascending: true }),
      supabase
        .from("drivers")
        .select("id, name, status")
        .order("name", { ascending: true }),
      supabase.from("project_drivers").select("project_id, driver_id"),
      supabase.from("water_stations").select("key, name, is_default"),
    ]);

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    truckCapacityM3: t.truck?.capacity_m3 ?? null,
    driverName: t.driver?.name ?? null,
  }));

  // Water stations lookup. `stations` (full rows) feeds the New Project picker;
  // `stationsByKey` resolves the trip card's "Fill at:" line (water_station is a
  // FK key, so display needs the name).
  const stations = (stationsRes.data ?? []) as { key: string; name: string; is_default: boolean }[];
  const stationsByKey: Record<string, string> = {};
  for (const s of stations) {
    stationsByKey[s.key] = s.name;
  }

  const projects = (projectsRes.data ?? []) as ProjectHeader[];
  const customers = (customersRes.data ?? []) as {
    id: string;
    name: string;
    default_station: string | null;
    delivery_site_address: string | null;
  }[];
  const trucks = (trucksRes.data ?? []) as {
    id: string;
    plate: string;
    capacity_m3: number | null;
    assigned_driver_id: string | null;
  }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string; status: DriverStatus }[];

  // Map project_id -> [driver_id, …] for the Manage-drivers modal + driver count.
  const assignmentsByProject: Record<string, string[]> = {};
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    (assignmentsByProject[a.project_id] ??= []).push(a.driver_id);
  }

  const error =
    tripsRes.error ||
    projectsRes.error ||
    customersRes.error ||
    trucksRes.error ||
    driversRes.error ||
    assignmentsRes.error ||
    stationsRes.error;

  return (
    <TripsTabs
      error={error ? error.message : null}
      trips={trips}
      projects={projects}
      customers={customers}
      trucks={trucks}
      drivers={drivers}
      assignmentsByProject={assignmentsByProject}
      stationsByKey={stationsByKey}
      stations={stations}
    />
  );
}
