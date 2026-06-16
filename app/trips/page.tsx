import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Trip, WaterType } from "@/lib/db-types";
import CreateTripForm from "./CreateTripForm";
import TripBoard from "./TripBoard";

export const dynamic = "force-dynamic";

type JoinedTrip = Trip & {
  project: { name: string } | null;
  customer: { name: string } | null;
  truck: { plate: string } | null;
  driver: { name: string } | null;
};

export default async function TripsPage() {
  const supabase = createClient();

  const [tripsRes, projectsRes, customersRes, trucksRes, driversRes] = await Promise.all([
    supabase
      .from("trips")
      .select(
        "*, project:projects(name), customer:customers(name), truck:trucks(plate), driver:drivers(name)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name, water_type, default_station")
      .order("name", { ascending: true }),
    supabase
      .from("customers")
      .select("id, name, default_station")
      .order("name", { ascending: true }),
    supabase
      .from("trucks")
      .select("id, plate")
      .order("plate", { ascending: true }),
    supabase
      .from("drivers")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    driverName: t.driver?.name ?? null,
  }));
  const projects = (projectsRes.data ?? []) as {
    id: string;
    name: string;
    water_type: WaterType | null;
    default_station: string | null;
  }[];
  const customers = (customersRes.data ?? []) as {
    id: string;
    name: string;
    default_station: string | null;
  }[];
  const trucks = (trucksRes.data ?? []) as { id: string; plate: string }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string }[];

  const error =
    tripsRes.error || projectsRes.error || customersRes.error || trucksRes.error || driversRes.error;

  return (
    <div>
      <PageHeader title="Trips" subtitle="Water delivery runs. Riyadh operation — 3 water stations." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load trips: {error.message}
        </p>
      )}
      <CreateTripForm
        projects={projects}
        customers={customers}
        trucks={trucks}
        drivers={drivers}
      />
      <TripBoard trips={trips} />
    </div>
  );
}
