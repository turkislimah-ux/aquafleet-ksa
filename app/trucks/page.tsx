import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Truck } from "@/lib/db-types";
import TruckForm from "./TruckForm";

export const dynamic = "force-dynamic";

type JoinedTruck = Truck & { driver: { name: string } | null };

export default async function TrucksPage() {
  const supabase = createClient();

  const [trucksRes, driversRes] = await Promise.all([
    supabase
      .from("trucks")
      .select("*, driver:drivers(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("drivers")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  const trucks = ((trucksRes.data ?? []) as JoinedTruck[]).map((t) => ({
    ...t,
    driverName: t.driver?.name ?? null,
  }));
  const drivers = (driversRes.data ?? []) as { id: string; name: string }[];
  const error = trucksRes.error || driversRes.error;

  return (
    <div>
      <PageHeader title="Trucks" subtitle="Fleet roster. Riyadh operation — 3 water stations." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load trucks: {error.message}
        </p>
      )}
      <TruckForm trucks={trucks} drivers={drivers} />
    </div>
  );
}
