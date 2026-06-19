import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

// Dashboard route (/). Server component: fetches the tables that exist today
// (trucks, trips, drivers), computes the KPIs the demo derives from real data,
// and hands them to the client island. KPIs whose source columns/tables don't
// exist yet (utilization, on-time, work orders, predictive alerts, fuel cost)
// are rendered as placeholders in DashboardClient and wired when their pages land.

export default async function DashboardPage() {
  const supabase = createClient();

  const [trucksRes, tripsRes, driversRes] = await Promise.all([
    supabase.from("trucks").select("id, status, health_score"),
    supabase
      .from("trips")
      .select(
        "id, ref, stage, trip_date, rate_sar, delivered_at, truck_id, water_station, water_type, tank_size_m3, truck:trucks(plate)"
      )
      .order("created_at", { ascending: false }),
    supabase.from("drivers").select("id, status"),
  ]);

  type JoinedTrip = {
    id: string;
    ref: string | null;
    stage: string;
    trip_date: string;
    rate_sar: number | null;
    delivered_at: string | null;
    truck_id: string | null;
    water_station: string;
    water_type: "potable" | "non_potable";
    tank_size_m3: number | null;
    truck: { plate: string } | null;
  };

  const trucks = trucksRes.data ?? [];
  const trips = (tripsRes.data ?? []) as unknown as JoinedTrip[];
  const drivers = driversRes.data ?? [];

  // ---- Fleet KPIs (REAL: trucks.status, trucks.health_score) ----
  const total = trucks.length;
  const active = trucks.filter((t) => t.status === "active").length;
  const idle = trucks.filter((t) => t.status === "idle").length;
  const maint = trucks.filter((t) => t.status === "maintenance").length;
  const oos = trucks.filter((t) => t.status === "out_of_service").length;
  const healthVals = trucks
    .map((t) => t.health_score)
    .filter((h): h is number => h != null);
  const avgHealth = healthVals.length
    ? +(healthVals.reduce((s, h) => s + h, 0) / healthVals.length).toFixed(1)
    : 0;

  // ---- Bottom KPIs ----
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayTrips = trips.filter((t) => t.trip_date === todayISO).length; // REAL

  // Q2: "on duty" maps to driver status === "active" (no on_duty enum). REAL.
  const onDuty = drivers.filter((d) => d.status === "active").length;

  // Q4: Revenue (30d) = Σ rate_sar for delivered trips in the last 30 days. REAL.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const revenue30d = trips
    .filter((t) => t.stage === "delivered" && (t.delivered_at ?? "").slice(0, 10) >= cutoff)
    .reduce((s, t) => s + (t.rate_sar ?? 0), 0);

  // Live Trips (REAL: stage in loading/in_transit, newest first, top 5).
  // destination/liters/distance fields don't exist in schema; we surface the
  // real substitutes water_station + tank_size_m3 + water_type instead.
  const liveTrips = trips
    .filter((t) => t.stage === "loading" || t.stage === "in_transit")
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      ref: t.ref,
      stage: t.stage as "loading" | "in_transit",
      truckLabel: t.truck?.plate ?? t.truck_id ?? "—",
      station: t.water_station,
      waterType: t.water_type,
      tankM3: t.tank_size_m3,
    }));

  const error = trucksRes.error || tripsRes.error || driversRes.error;

  return (
    <DashboardClient
      fleet={{ total, active, idle, maint, oos, avgHealth }}
      bottom={{ todayTrips, onDuty, driversTotal: drivers.length, revenue30d }}
      liveTrips={liveTrips}
      errorMsg={error?.message ?? null}
    />
  );
}
