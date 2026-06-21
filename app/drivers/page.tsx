// Drivers & People — server entry. Mirrors the demo's single /drivers route with
// three tabs (Drivers · Commissions · Management & Staff). This commit ships the
// shell + DRIVERS tab; Commissions/Staff arrive in later commits.
//
// Trips30d is REAL (count this driver's trips in the last 30 days); recent trips
// feed the Driver Detail modal. Both derived from one trips fetch.

import { createClient } from "@/lib/supabase/server";
import type { Driver } from "@/lib/db-types";
import DriversClient, { type TruckLite, type RecentTrip } from "./DriversClient";

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

  const [driversRes, trucksRes, tripsRes] = await Promise.all([
    supabase.from("drivers").select("*").order("created_at", { ascending: false }),
    supabase.from("trucks").select("id, plate, model, status, home_station, assigned_driver_id").order("plate", { ascending: true }),
    supabase
      .from("trips")
      .select("driver_id, ref, trip_date, stage, tank_size_m3, project:projects(name), customer:customers(name)")
      .order("trip_date", { ascending: false }),
  ]);

  const drivers = (driversRes.data ?? []) as Driver[];
  const trucks = (trucksRes.data ?? []) as TruckLite[];
  const trips = (tripsRes.data ?? []) as TripJoin[];
  const error = driversRes.error || trucksRes.error || tripsRes.error;

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
      drivers={drivers}
      trucks={trucks}
      trips30dByDriver={trips30dByDriver}
      recentByDriver={recentByDriver}
      error={error?.message ?? null}
    />
  );
}
