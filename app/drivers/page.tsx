import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Driver } from "@/lib/db-types";
import DriverForm from "./DriverForm";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const supabase = createClient();

  const [driversRes, trucksRes] = await Promise.all([
    supabase.from("drivers").select("*").order("created_at", { ascending: false }),
    supabase.from("trucks").select("id, plate, assigned_driver_id").order("plate", { ascending: true }),
  ]);

  const drivers = (driversRes.data ?? []) as Driver[];
  const trucks = (trucksRes.data ?? []) as { id: string; plate: string; assigned_driver_id: string | null }[];
  const error = driversRes.error || trucksRes.error;

  return (
    <div>
      <PageHeader title="Drivers" subtitle="Driver roster. Truck assignment is stored on the truck." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load drivers: {error.message}
        </p>
      )}
      <DriverForm drivers={drivers} trucks={trucks} />
    </div>
  );
}
