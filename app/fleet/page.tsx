import { createClient } from "@/lib/supabase/server";
import type { Truck } from "@/lib/db-types";
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
  safety_score: number | null;
  rating: number | null;
};

export default async function FleetPage() {
  const supabase = createClient();

  // 30-day window for the per-driver trip count (Trips30d) used by the
  // Assign Driver modal + Detail driver card. UTC, consistent with the rest.
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [trucksRes, driversRes, tripsRes] = await Promise.all([
    supabase
      .from("trucks")
      .select("*, driver:drivers(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("drivers")
      .select("id, name, status, safety_score, rating")
      .order("name", { ascending: true }),
    supabase
      .from("trips")
      .select("driver_id, trip_date")
      .gte("trip_date", since),
  ]);

  const trucks: TruckRow[] = ((trucksRes.data ?? []) as JoinedTruck[]).map((t) => ({
    ...t,
    driverName: t.driver?.name ?? null,
  }));
  const drivers = (driversRes.data ?? []) as DriverLite[];

  // Per-driver trip count over the last 30 days (REAL — derived, not stored).
  const trips30d: Record<string, number> = {};
  for (const tr of (tripsRes.data ?? []) as { driver_id: string | null }[]) {
    if (tr.driver_id) trips30d[tr.driver_id] = (trips30d[tr.driver_id] ?? 0) + 1;
  }

  const error = trucksRes.error || driversRes.error || tripsRes.error;

  // ---- KPI strip (6) — all REAL, nulls skipped, no division-by-zero ----
  const total = trucks.length;
  const active = trucks.filter((t) => t.status === "active").length;
  const maint = trucks.filter((t) => t.status === "maintenance").length;
  const oos = trucks.filter((t) => t.status === "out_of_service").length;

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
    oos,
    totalCap,
    capHasData: capVals.length > 0,
    avgHealth,
  };

  return (
    <FleetClient
      trucks={trucks}
      drivers={drivers}
      trips30d={trips30d}
      kpis={kpis}
      errorMsg={error ? error.message : null}
    />
  );
}
