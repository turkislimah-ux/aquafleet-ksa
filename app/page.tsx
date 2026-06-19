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
    supabase.from("trips").select("id, stage, trip_date, rate_sar, delivered_at"),
    supabase.from("drivers").select("id, status"),
  ]);

  const trucks = trucksRes.data ?? [];
  const trips = tripsRes.data ?? [];
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

  const error = trucksRes.error || tripsRes.error || driversRes.error;

  return (
    <DashboardClient
      fleet={{ total, active, idle, maint, oos, avgHealth }}
      bottom={{ todayTrips, onDuty, driversTotal: drivers.length, revenue30d }}
      errorMsg={error?.message ?? null}
    />
  );
}
