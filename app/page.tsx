import { createClient } from "@/lib/supabase/server";
import { formatSar } from "@/lib/utils";
import { TRIP_STAGE_LABELS } from "@/lib/db-types";
import { onLeaveTodaySet, effectiveDriverStatus, type LeavePeriod } from "@/lib/leave";
import DashboardClient, { type Datasets, type DashboardCharts } from "./DashboardClient";

export const dynamic = "force-dynamic";

// Dashboard route (/). Server component: fetches the tables that exist today
// (trucks, trips, drivers), computes the KPIs the demo derives from real data,
// and hands them to the client island. KPIs whose source columns/tables don't
// exist yet (utilization, on-time, work orders, predictive alerts, fuel cost)
// are rendered as placeholders in DashboardClient and wired when their pages land.

export default async function DashboardPage() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [trucksRes, tripsRes, driversRes, leavePeriodsRes, archivedProjectsRes] = await Promise.all([
    supabase.from("trucks").select("id, status, health_score"),
    supabase
      .from("trips")
      .select(
        "id, ref, stage, trip_date, rate_sar, delivered_at, truck_id, project_id, water_station, water_type, tank_size_m3, truck:trucks(plate)"
      )
      .order("created_at", { ascending: false }),
    supabase.from("drivers").select("id, status"),
    // On-leave-today only (DB does the date filter — no inline range check). Feeds
    // lib/leave so the donut/on-duty reflect computed availability, not stored status.
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today),
    // Archived project ids — live KPIs exclude their trips (trips with no project
    // are kept). History/fleet views are unaffected; this is dashboard-only.
    supabase.from("projects").select("id").not("archived_at", "is", null),
  ]);

  type JoinedTrip = {
    id: string;
    ref: string | null;
    stage: string;
    trip_date: string;
    rate_sar: number | null;
    delivered_at: string | null;
    truck_id: string | null;
    project_id: string | null;
    water_station: string;
    water_type: "potable" | "non_potable";
    tank_size_m3: number | null;
    truck: { plate: string } | null;
  };

  const trucks = trucksRes.data ?? [];
  // Live KPIs exclude trips of archived projects; ad-hoc trips (no project) stay.
  const archivedProjectIds = new Set(
    ((archivedProjectsRes.data ?? []) as { id: string }[]).map((p) => p.id)
  );
  const trips = ((tripsRes.data ?? []) as unknown as JoinedTrip[]).filter(
    (t) => t.project_id == null || !archivedProjectIds.has(t.project_id)
  );
  const drivers = driversRes.data ?? [];
  // Computed on-leave-today (authoritative). stored drivers.status='on_leave' is no
  // longer read directly — effectiveDriverStatus reconciles it with this set.
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const onLeaveDrivers = onLeaveTodaySet(leavePeriods, today).drivers;

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

  // ---- Snapshot KPI: drivers on duty. REAL. ----
  // Q2: "on duty" maps to effective status === "active" (no on_duty enum). A driver
  // on leave today is NOT on duty — computed status excludes them.
  const onDuty = drivers.filter((d) => effectiveDriverStatus(d.status, onLeaveDrivers.has(d.id)) === "active").length;

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

  // ---- Period data (REAL) for the global selector ----
  // KPI TILES follow the window TOTAL: daily = today, weekly = last 7d, monthly =
  // last 30d. CHARTS use GRANULARITY for a readable trend span: daily mode = last
  // 30 days (per-day), weekly = last 12 weeks (per-week), monthly = last 12 months
  // (per-month). Volume = Σ tank_size_m3 by trip_date; trips = count by trip_date;
  // revenue = Σ rate_sar for delivered trips by delivered_at; fuel honest-empty (no
  // schema source). hasData drives empty states; changing period never invents data.
  const isoDay = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const dayLabel = (iso: string) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
  const MONTH_LBL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Monday-anchored ISO week start (UTC), consistent with the rest of the file.
  const weekStart = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  // KPI tile totals over the last `windowDays` (trip count, revenue Σ).
  function tileTotals(windowDays: number) {
    const keySet = new Set<string>();
    for (let i = windowDays - 1; i >= 0; i--) keySet.add(isoDay(i));
    let tripCount = 0, revenue = 0, revHas = false;
    trips.forEach((t) => {
      const td = (t.trip_date ?? "").slice(0, 10);
      if (keySet.has(td)) tripCount += 1;
      if (t.stage === "delivered") {
        const dd = (t.delivered_at ?? "").slice(0, 10);
        if (keySet.has(dd)) { revenue += t.rate_sar ?? 0; revHas = true; }
      }
    });
    return { trips: tripCount, revenue: Math.round(revenue), revenueHasData: revHas };
  }

  // Chart trend over `labels`/`bucketOf` buckets. Volume Σ tank & trip count keyed
  // on trip_date; revenue Σ rate keyed on delivered_at; fuel honest-empty. Volume
  // badge = most-recent bucket vs the previous one (real point-over-point change).
  function chartTrend(labels: string[], bucketOf: (iso: string) => number) {
    const n = labels.length;
    const vol = new Array<number>(n).fill(0); let volHas = false;
    const cnt = new Array<number>(n).fill(0);
    const rev = new Array<number>(n).fill(0); let revHas = false;
    trips.forEach((t) => {
      const td = (t.trip_date ?? "").slice(0, 10);
      const bi = td ? bucketOf(td) : -1;
      if (bi >= 0) {
        cnt[bi] += 1;
        if (t.tank_size_m3 != null) { vol[bi] += t.tank_size_m3; volHas = true; }
      }
      if (t.stage === "delivered") {
        const dd = (t.delivered_at ?? "").slice(0, 10);
        const ri = dd ? bucketOf(dd) : -1;
        if (ri >= 0) { rev[ri] += t.rate_sar ?? 0; revHas = true; }
      }
    });
    const last = vol[n - 1] ?? 0, prev = vol[n - 2] ?? 0;
    const volPct = volHas && prev > 0 ? +(((last - prev) / prev) * 100).toFixed(1) : null;
    return {
      volume: { labels, values: vol.map((v) => +v.toFixed(2)), hasData: volHas, pct: volPct },
      trips: { labels, counts: cnt },
      revenue: { labels, values: rev.map((v) => Math.round(v)), hasData: revHas },
      fuel: { labels, values: labels.map(() => 0), hasData: false },
    };
  }

  // daily mode → last 30 days, per day
  const dDays: string[] = [];
  for (let i = 29; i >= 0; i--) dDays.push(isoDay(i));
  const dIndex = new Map(dDays.map((k, i) => [k, i] as const));
  const dailyTrend = chartTrend(dDays.map(dayLabel), (iso) => dIndex.get(iso) ?? -1);

  // weekly mode → last 12 weeks, per Monday-anchored week
  const wStarts: string[] = [];
  const curWeek = weekStart(isoDay(0));
  for (let i = 11; i >= 0; i--) {
    const d = new Date(curWeek + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i * 7);
    wStarts.push(d.toISOString().slice(0, 10));
  }
  const wIndex = new Map(wStarts.map((k, i) => [k, i] as const));
  const weeklyTrend = chartTrend(wStarts.map(dayLabel), (iso) => wIndex.get(weekStart(iso)) ?? -1);

  // monthly mode → last 12 months, per calendar month
  const mKeys: string[] = [];
  const nowM = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() - i, 1));
    mKeys.push(d.toISOString().slice(0, 7));
  }
  const mIndex = new Map(mKeys.map((k, i) => [k, i] as const));
  const monthlyTrend = chartTrend(mKeys.map((m) => MONTH_LBL[+m.slice(5, 7) - 1]), (iso) => mIndex.get(iso.slice(0, 7)) ?? -1);

  const charts: DashboardCharts = {
    daily: { windowDays: 1, tile: tileTotals(1), ...dailyTrend },
    weekly: { windowDays: 7, tile: tileTotals(7), ...weeklyTrend },
    monthly: { windowDays: 30, tile: tileTotals(30), ...monthlyTrend },
  };

  // ---- AI summary widget datasets (mirrors demo dashCompute, preview/pages-1.js:2240) ----
  // REAL datasets are computed from live tables. Datasets whose tables/columns
  // don't exist yet (fuel, water, cost, maintenance, inventory, alerts,
  // commissions, depots) carry noData → the widget renders "No data yet".
  // NOTE: demo's "cost" dataset is REAL there but its source columns (op cost,
  // fuel cost) aren't in our schema (Q4 keeps them placeholders) → noData here.
  // "drivers" is grouped by status (the real dimension we have) rather than the
  // demo's homeDepot, which our schema doesn't carry.

  // trips by stage
  const stageColors: Record<string, string> = { scheduled: "#3b82f6", loading: "#f59e0b", in_transit: "#0b7eea", delivered: "#10b981" };
  const stageOrder = ["scheduled", "loading", "in_transit", "delivered"] as const;
  const tripBy: Record<string, number> = {};
  trips.forEach((t) => { tripBy[t.stage] = (tripBy[t.stage] ?? 0) + 1; });

  // drivers by status — COMPUTED. On-leave-today drivers count as on_leave ONLY
  // (removed from active), so slices stay mutually exclusive and sum to total.
  const driverStatusLabel: Record<string, string> = { active: "Active", on_leave: "On Leave", inactive: "Inactive" };
  const driverStatusColor: Record<string, string> = { active: "#10b981", on_leave: "#f59e0b", inactive: "#94a3b8" };
  const driverBy: Record<string, number> = {};
  drivers.forEach((d) => {
    const s = effectiveDriverStatus(d.status, onLeaveDrivers.has(d.id));
    driverBy[s] = (driverBy[s] ?? 0) + 1;
  });

  // revenue daily series (14d) — Σ rate_sar by trip_date
  const revMap: Record<string, number> = {};
  trips.forEach((t) => { const kk = (t.trip_date ?? "").slice(0, 10); if (kk) revMap[kk] = (revMap[kk] ?? 0) + (t.rate_sar ?? 0); });
  const revLabels: string[] = [];
  const revValues: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    revLabels.push(key.slice(5));
    revValues.push(Math.round(revMap[key] ?? 0));
  }

  const datasets: Datasets = {
    fleet: {
      title: "Fleet status", defaultDisplay: "chart", chartKind: "pie",
      stats: [
        { label: "Active Trucks", value: `${active}/${total}`, tone: "ok" },
        { label: "Maintenance", value: maint, tone: "warn" },
        { label: "Out of Service", value: oos, tone: "bad" },
      ],
      items: [
        { label: "Active", value: active, color: "#10b981" },
        { label: "Idle", value: idle, color: "#3b82f6" },
        { label: "Maintenance", value: maint, color: "#f59e0b" },
        { label: "Out of Service", value: oos, color: "#ef4444" },
      ],
    },
    drivers: {
      title: "Drivers by status", defaultDisplay: "chart", chartKind: "bars",
      stats: [
        { label: "Drivers On Duty", value: `${onDuty}/${drivers.length}`, tone: "ok" },
        { label: "Drivers", value: drivers.length, tone: "info" },
      ],
      items: Object.keys(driverBy).map((s) => ({ label: driverStatusLabel[s] ?? s, value: driverBy[s], color: driverStatusColor[s] ?? "#94a3b8" })),
    },
    trips: {
      title: "Trips by status", defaultDisplay: "chart", chartKind: "pie",
      stats: [
        { label: "Trips", value: trips.length, tone: "info" },
        { label: "In Transit", value: tripBy.in_transit ?? 0, tone: "ok" },
        { label: "Delivered", value: tripBy.delivered ?? 0, tone: "ok" },
      ],
      items: stageOrder.filter((s) => tripBy[s]).map((s) => ({ label: TRIP_STAGE_LABELS[s], value: tripBy[s], color: stageColors[s] })),
    },
    revenue: {
      title: "Revenue · 14 days", defaultDisplay: "chart", chartKind: "line",
      line: { labels: revLabels, values: revValues, color: "#10b981" },
      stats: [{ label: "Revenue (30d)", value: formatSar(revenue30d), tone: "ok" }],
      items: revLabels.map((l, i) => ({ label: l, value: revValues[i], color: "#10b981" })),
    },
    utilization: {
      title: "Utilization & health", defaultDisplay: "stat", chartKind: "bars",
      stats: [
        { label: "Utilization", value: "—", tone: "info" },
        { label: "Avg Fleet Health", value: avgHealth, tone: avgHealth > 75 ? "ok" : "warn" },
        { label: "On-Time Delivery", value: "—", tone: "ok" },
      ],
      items: [{ label: "Avg Fleet Health", value: avgHealth, color: "#10b981" }],
    },
    overview: {
      title: "Operations overview", defaultDisplay: "stat", chartKind: "bars",
      stats: [
        { label: "Active Trucks", value: `${active}/${total}`, tone: "ok" },
        { label: "Utilization", value: "—", tone: "info" },
        { label: "Open Work Orders", value: "—", tone: "warn" },
        { label: "Critical Alerts", value: "—", tone: "bad" },
        { label: "Revenue (30d)", value: formatSar(revenue30d), tone: "ok" },
        { label: "Fuel Cost (30d)", value: "—", tone: "warn" },
      ],
      items: [
        { label: "Active", value: active, color: "#10b981" },
        { label: "Maintenance", value: maint, color: "#f59e0b" },
        { label: "Out of Service", value: oos, color: "#ef4444" },
      ],
    },
    // schema not present yet → "No data yet" (wired when their pages land)
    fuel: { title: "Fuel consumption by depot", defaultDisplay: "chart", chartKind: "bars", noData: true },
    water: { title: "Water delivered (m³) · 14 days", defaultDisplay: "chart", chartKind: "line", noData: true },
    cost: { title: "Revenue vs cost · 30 days", defaultDisplay: "chart", chartKind: "bars", noData: true },
    maintenance: { title: "Work orders by status", defaultDisplay: "chart", chartKind: "bars", noData: true },
    inventory: { title: "Low-stock parts", defaultDisplay: "table", chartKind: "bars", noData: true },
    alerts: { title: "Predictive alerts by severity", defaultDisplay: "chart", chartKind: "pie", noData: true },
    commissions: { title: "Commissions this month", defaultDisplay: "stat", chartKind: "bars", noData: true },
    depots: { title: "Trucks by depot", defaultDisplay: "chart", chartKind: "bars", noData: true },
  };

  const error =
    trucksRes.error || tripsRes.error || driversRes.error || leavePeriodsRes.error || archivedProjectsRes.error;

  return (
    <DashboardClient
      fleet={{ total, active, idle, maint, oos, avgHealth }}
      bottom={{ onDuty, driversTotal: drivers.length }}
      liveTrips={liveTrips}
      charts={charts}
      datasets={datasets}
      errorMsg={error?.message ?? null}
    />
  );
}
