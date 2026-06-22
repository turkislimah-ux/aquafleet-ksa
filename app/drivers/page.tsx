// Drivers & People — server entry. Mirrors the demo's single /drivers route with
// three tabs (Drivers · Commissions · Management & Staff). This commit ships the
// shell + DRIVERS tab; Commissions/Staff arrive in later commits.
//
// Trips30d is REAL (count this driver's trips in the last 30 days); recent trips
// feed the Driver Detail modal. Both derived from one trips fetch.

import { createClient } from "@/lib/supabase/server";
import type { Driver } from "@/lib/db-types";
import DriversClient, { type TruckLite, type RecentTrip } from "./DriversClient";
import type {
  CommTripRow,
  CommCycle,
  CommSpecialRow,
  CommAdjustmentRow,
  CommPayout,
} from "@/lib/commission-rows";

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

  const [driversRes, trucksRes, tripsRes, commTripsRes, cyclesRes, specialsRes, adjustmentsRes, projectsRes, payoutsRes] =
    await Promise.all([
      supabase.from("drivers").select("*").order("created_at", { ascending: false }),
      supabase.from("trucks").select("id, plate, model, status, home_station, assigned_driver_id").order("plate", { ascending: true }),
      supabase
        .from("trips")
        .select("driver_id, ref, trip_date, stage, tank_size_m3, project:projects(name), customer:customers(name)")
        .order("trip_date", { ascending: false }),
      // Commissions base = UNPAID delivered trips (commission_sar stamped on
      // Delivered; payout_id IS NULL = still in the driver's current balance).
      supabase
        .from("trips")
        .select("driver_id, project_id, commission_sar, delivered_at, payout_id")
        .not("delivered_at", "is", null)
        .is("payout_id", null),
      // The open per-driver cycle (rolling). Bonus is reviewable.
      supabase
        .from("commission_periods")
        .select("driver_id, bonus_sar, bonus_status, bonus_deny_reason, payout_status, approved_by, month_key, deny_reason"),
      // Only UNPAID specials/adjustments are part of the current balance.
      supabase
        .from("commission_specials")
        .select("id, driver_id, month_key, label, amount_sar, date, note, is_special_trip, status, deny_reason, payout_id")
        .is("payout_id", null),
      supabase
        .from("commission_adjustments")
        .select("id, driver_id, month_key, label, amount_sar, date, note, status, deny_reason, payout_id")
        .is("payout_id", null),
      supabase.from("projects").select("id, name"),
      // Frozen History records (newest first; client filters by driver).
      supabase
        .from("commission_payouts")
        .select("id, driver_id, paid_at, approved_by, period_label, base_sar, specials_sar, adjustments_sar, bonus_sar, total_sar, snapshot")
        .order("paid_at", { ascending: false }),
    ]);

  const drivers = (driversRes.data ?? []) as Driver[];
  const trucks = (trucksRes.data ?? []) as TruckLite[];
  const trips = (tripsRes.data ?? []) as TripJoin[];
  const commTrips = (commTripsRes.data ?? []) as CommTripRow[];
  const cycles = (cyclesRes.data ?? []) as CommCycle[];
  const specials = (specialsRes.data ?? []) as CommSpecialRow[];
  const adjustments = (adjustmentsRes.data ?? []) as CommAdjustmentRow[];
  const payouts = (payoutsRes.data ?? []) as CommPayout[];
  const projectsById: Record<string, string> = {};
  for (const p of (projectsRes.data ?? []) as { id: string; name: string }[]) projectsById[p.id] = p.name;
  const error =
    driversRes.error ||
    trucksRes.error ||
    tripsRes.error ||
    commTripsRes.error ||
    cyclesRes.error ||
    specialsRes.error ||
    adjustmentsRes.error ||
    projectsRes.error ||
    payoutsRes.error;

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
      commTrips={commTrips}
      cycles={cycles}
      specials={specials}
      adjustments={adjustments}
      payouts={payouts}
      projectsById={projectsById}
      error={error?.message ?? null}
    />
  );
}
