import { createClient } from "@/lib/supabase/server";
import type { Truck } from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod } from "@/lib/leave";
import { todayKey } from "@/lib/utils";
import type { TruckRow, DriverLite } from "../page";
import FleetDetailClient from "./FleetDetailClient";

export const dynamic = "force-dynamic";

type JoinedTruck = Truck & { driver: { name: string } | null };

// Fleet Detail. We fetch the full truck list (not just this row) so the
// Assign Driver modal can compute the busy-lock — a driver already on another
// truck must show as locked here exactly as it does on the list page. ~40 rows
// makes this cheap. trips30d is the same REAL 30-day count used elsewhere.
export default async function FleetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createClient();

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const today = todayKey(); // local (matches trip day-math), not UTC

  const [trucksRes, driversRes, tripsRes, leavePeriodsRes] = await Promise.all([
    supabase.from("trucks").select("*, driver:drivers(name)"),
    supabase
      .from("drivers")
      .select("id, name, status, safety_score, rating")
      .order("name", { ascending: true }),
    supabase.from("trips").select("driver_id, trip_date").gte("trip_date", since),
    // On-leave-today drivers (DB date filter — no inline range check). Feeds the
    // assigned-driver pill + assign-list lock (UI only, like the list page).
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today),
  ]);

  const trucks: TruckRow[] = ((trucksRes.data ?? []) as JoinedTruck[]).map((t) => ({
    ...t,
    driverName: t.driver?.name ?? null,
  }));
  const drivers = (driversRes.data ?? []) as DriverLite[];

  const trips30d: Record<string, number> = {};
  for (const tr of (tripsRes.data ?? []) as { driver_id: string | null }[]) {
    if (tr.driver_id) trips30d[tr.driver_id] = (trips30d[tr.driver_id] ?? 0) + 1;
  }

  // Computed on-leave-today driver ids (authoritative availability signal).
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const onLeaveDriverIds = Array.from(onLeaveTodaySet(leavePeriods, today).drivers);

  const truck = trucks.find((t) => t.id === id) ?? null;
  const errorMsg =
    trucksRes.error?.message ?? driversRes.error?.message ?? tripsRes.error?.message ?? leavePeriodsRes.error?.message ?? null;

  return (
    <FleetDetailClient
      truck={truck}
      trucks={trucks}
      drivers={drivers}
      trips30d={trips30d}
      onLeaveDriverIds={onLeaveDriverIds}
      errorMsg={errorMsg}
    />
  );
}
