import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Trip, WaterType, CommissionMode, ProjectStatus, DriverStatus, ProjectDriver } from "@/lib/db-types";
import ProjectsBoard from "./ProjectsBoard";

export const dynamic = "force-dynamic";

type JoinedTrip = Trip & {
  project: { name: string } | null;
  customer: { name: string } | null;
  truck: { plate: string } | null;
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
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

export default async function TripsPage() {
  const supabase = createClient();

  const [tripsRes, projectsRes, customersRes, trucksRes, driversRes, assignmentsRes] =
    await Promise.all([
      supabase
        .from("trips")
        .select(
          "*, project:projects(name), customer:customers(name), truck:trucks(plate), driver:drivers(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select(
          "id, name, customer_id, rate_per_trip_sar, commission_mode, commission_value, commission_bump_pct, status, water_type, default_station, location, location_lat, location_lng, description"
        )
        .order("name", { ascending: true }),
      supabase
        .from("customers")
        .select("id, name, default_station")
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
    ]);

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    driverName: t.driver?.name ?? null,
  }));

  const projects = (projectsRes.data ?? []) as ProjectHeader[];
  const customers = (customersRes.data ?? []) as {
    id: string;
    name: string;
    default_station: string | null;
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
    assignmentsRes.error;

  return (
    <div>
      <PageHeader
        title="Project Operations"
        subtitle="Each project runs its own Kanban — push trips through the board manually."
      />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load trips: {error.message}
        </p>
      )}
      <ProjectsBoard
        trips={trips}
        projects={projects}
        customers={customers}
        trucks={trucks}
        drivers={drivers}
        assignmentsByProject={assignmentsByProject}
      />
    </div>
  );
}
