import { createClient } from "@/lib/supabase/server";
import { formatSar } from "@/lib/utils";
import { availableWidgets, type WidgetDef } from "@/lib/dashboard-widgets";
import { COST_TYPE } from "@/lib/dashboard";
import type { FleetUtilizationRow } from "@/lib/utilization";
import type {
  ActionItemRow, FeedRow, FleetStateNow, Headline, DashCharts, LiveTrip,
  DailyOps, DeliveredRevenueDay, DeliveryDay, MonthlyOnlyCost, ProjectStages, CostComposition,
  CostSliceKey, DriverOps, DriverOpsState, ComplianceStatus,
} from "@/lib/dashboard";
import { checkDriverStateDrift } from "@/lib/actions/driver-state-drift";
import { fetchTruckStateCounts } from "@/lib/actions/truck-state";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

// Dashboard route (/). THE CATCH-UP PAGE.
//
// EVERY NUMBER COMES FROM A VIEW. Nothing is re-derived here. That rule is
// why the rebuild happened: the previous page summed trips.rate_sar in
// TypeScript for "Revenue (30d)" and showed 0 while Reports showed 70,650,
// because rate_sar is NULL on all 203 rows.
//
// Sources: v_dashboard_action_items / v_activity_feed / v_fleet_state_now
// (0103) + the 0098 semantic layer (v_pnl_monthly, v_operations_monthly,
// v_revenue_monthly, v_collections_monthly, v_receivables_open/_aging)
// + the 0104 day grain (v_daily_operations, v_monthly_only_costs).
//
// The ONE base-table read is the live-trips list, and it is a LIST OF
// RECORDS, not a figure — no aggregate, no arithmetic. Charting it would
// have needed a view; naming five trucks currently on the road does not.

const FEED_LIMIT = 40;   // the panel shows 6; the rest open in a popup
const CHART_MONTHS = 12;
// Days pulled for the daily charts. ~6 months of history, so the month
// stepper on the daily chart has somewhere to step back to. A bound on how
// many ROWS are fetched, not arithmetic on any figure.
const DAILY_DAYS = 190;

/**
 * Postgres `numeric` arrives over PostgREST as a STRING; `a - b` yields NaN
 * and `a + b` concatenates, both rendering as plausible garbage. Coerced once
 * at the boundary, as the Reports page does (CLAUDE.md §7).
 */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function DashboardPage() {
  const supabase = createClient();

  const [
    actionsRes, feedRes, stateRes, pnlRes, opsRes, revenueRes,
    collectionsRes, receivablesRes, liveTripsRes, dictRes,
    dailyRes, monthlyOnlyRes, deliveryRes,
    projectsRes, fleetUtilRes, costCompRes, driverOpsRes, deliveredRevRes, drift,
  ] = await Promise.all([
    supabase.from("v_dashboard_action_items").select("*"),
    supabase.from("v_activity_feed").select("*").order("occurred_at", { ascending: false }).limit(FEED_LIMIT),
    supabase.from("v_fleet_state_now").select("*").maybeSingle(),
    supabase.from("v_pnl_monthly").select("*").order("month", { ascending: false }).limit(CHART_MONTHS),
    supabase.from("v_operations_monthly").select("*").order("month", { ascending: false }).limit(CHART_MONTHS),
    supabase.from("v_revenue_monthly").select("*").order("month", { ascending: false }).limit(1),
    supabase.from("v_collections_monthly").select("*").order("month", { ascending: false }).limit(1),
    supabase.from("v_receivables_open").select("outstanding_sar"),
    // Records, not a metric — the only base-table read on this page.
    supabase
      .from("trips")
      .select("id, ref, stage, trip_date, truck:trucks(plate), project:projects(name)")
      .in("stage", ["loading", "in_transit"])
      .order("trip_date", { ascending: false })
      .limit(6),
    supabase.from("report_metrics").select("metric_key"),
    // 0104 — the day grain. Newest-first for the limit; reversed below.
    supabase.from("v_daily_operations").select("*")
      .order("day", { ascending: false }).limit(DAILY_DAYS),
    supabase.from("v_monthly_only_costs").select("*")
      .order("month", { ascending: false }).limit(CHART_MONTHS),
    // 0105 — Delivery Output. Same spine and same DAILY_DAYS window as
    // v_daily_operations so both charts step through identical months.
    supabase.from("v_delivery_output_daily").select("*")
      .order("day", { ascending: false }).limit(DAILY_DAYS),
    // 0106 — projects by stage, cost composition, and the drivers board.
    supabase.from("v_project_trip_stages").select("*").order("project_name"),
    // Fleet-wide utilization per month (0130). THE PRE-BLENDED FIGURE — the
    // page reads v_fleet_utilization_monthly rather than averaging the
    // per-truck view, because averaging percentages weights a truck available
    // 2 days the same as one available 31 (live August: 45.86 blended vs 38.40
    // averaged). 0130 ships this view so the rule is enforced by which view
    // exists, not by a comment someone has to remember.
    supabase.from("v_fleet_utilization_monthly").select("*"),
    supabase.from("v_cost_composition_monthly").select("*")
      .order("month", { ascending: false }).limit(CHART_MONTHS),
    supabase.from("v_drivers_ops_now").select("*"),
    // 0108 — earned (delivered) revenue. Same spine as v_daily_operations by
    // construction, so the two zip by day without inventing or dropping one.
    supabase.from("v_delivered_revenue_daily").select("*")
      .order("day", { ascending: false }).limit(DAILY_DAYS),
    // The drift guard runs with the rest rather than after, so a page that
    // already makes a dozen round trips does not grow a serial one.
    checkDriverStateDrift(),
  ]);

  const actionItems = (actionsRes.data ?? []) as ActionItemRow[];
  const feed = (feedRes.data ?? []) as FeedRow[];
  const state = (stateRes.data ?? null) as FleetStateNow | null;

  // TRUCK STATUS IS MIRRORED, NOT DERIVED HERE. Same helpers the Fleet page
  // acts on, so the donut below and /fleet cannot disagree; the view's own
  // truck_state CTE is no longer read.
  const truckState = await fetchTruckStateCounts(supabase);

  // Views come back newest-first for the `limit`; charts read oldest-first.
  const pnl = [...((pnlRes.data ?? []) as Record<string, unknown>[])].reverse();
  const ops = [...((opsRes.data ?? []) as Record<string, unknown>[])].reverse();

  const latestPnl = pnl[pnl.length - 1];
  const revenueRow = (revenueRes.data ?? [])[0] as Record<string, unknown> | undefined;
  const collectionsRow = (collectionsRes.data ?? [])[0] as Record<string, unknown> | undefined;
  const opsRow = ops[ops.length - 1];
  const outstanding = ((receivablesRes.data ?? []) as { outstanding_sar: unknown }[])
    .reduce((s, r) => s + num(r.outstanding_sar), 0);

  const liveTrips: LiveTrip[] = (
    (liveTripsRes.data ?? []) as unknown as {
      id: string; ref: string | null; stage: string; trip_date: string;
      truck: { plate: string } | null; project: { name: string } | null;
    }[]
  ).map((t) => ({
    id: t.id,
    ref: t.ref,
    stage: t.stage === "in_transit" ? "in_transit" : "loading",
    truckLabel: t.truck?.plate ?? "—",
    // Null is a real state: an ad-hoc trip has no project (0101 hit the same
    // thing and labels it "Unassigned"). The UI says so rather than blanking.
    project: t.project?.name ?? null,
    tripDate: t.trip_date,
  }));

  // ---- the day grain (0104) ---------------------------------------------
  // `month` comes from the view, not from parsing `day` here — the view's own
  // bucket is what v_pnl_monthly reconciles against, and re-deriving it in TS
  // is exactly how a chart drifts from the statement it links to.
  const dailyOps: DailyOps[] = [
    ...((dailyRes.data ?? []) as Record<string, unknown>[]),
  ].reverse().map((r) => ({
    day: String(r.day ?? ""),
    month: String(r.month ?? ""),
    // revenue_sar is intentionally not mapped — see DailyOps.
    directCost: num(r.direct_cost_sar),
    filling: num(r.filling_cost_sar),
    fillingUncosted: num(r.filling_uncosted_trips),
  }));

  const delivery: DeliveryDay[] = [
    ...((deliveryRes.data ?? []) as Record<string, unknown>[]),
  ].reverse().map((r) => ({
    day: String(r.day ?? ""),
    month: String(r.month ?? ""),
    capacityM3: num(r.capacity_m3),
    tripsDelivered: num(r.trips_delivered),
    tripsNoTruck: num(r.trips_delivered_no_truck),
  }));

  const deliveredRevenue: DeliveredRevenueDay[] = [
    ...((deliveredRevRes.data ?? []) as Record<string, unknown>[]),
  ].reverse().map((r) => ({
    day: String(r.day ?? ""),
    month: String(r.month ?? ""),
    revenue: num(r.delivered_revenue_sar),
    pricedTrips: num(r.delivered_trips_priced),
    unpricedTrips: num(r.delivered_trips_unpriced),
  }));

  const monthlyOnly: MonthlyOnlyCost[] = (
    (monthlyOnlyRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    month: String(r.month ?? ""),
    payroll: num(r.payroll_sar),
    commissionNonTrip: num(r.commission_non_trip_sar),
    total: num(r.monthly_only_cost_sar),
  }));

  // ---- 0106: projects, cost composition, drivers ------------------------
  const projectStages: ProjectStages[] = (
    (projectsRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    projectId: String(r.project_id ?? ""),
    projectName: String(r.project_name ?? ""),
    scheduled: num(r.scheduled),
    loading: num(r.loading),
    inTransit: num(r.in_transit),
    delivered: num(r.delivered),
    total: num(r.total_trips),
    inFlight: num(r.in_flight_trips),
  }));

  // `pct` stays NULL when the view returns NULL — a month with no cost at all.
  // Coercing it to 0 here would turn "no cost recorded" into "0% of the cost",
  // which is a different and false claim.
  const pct = (v: unknown): number | null =>
    v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

  const costComposition: CostComposition[] = [
    ...((costCompRes.data ?? []) as Record<string, unknown>[]),
  ].reverse().map((r) => ({
    month: String(r.month ?? ""),
    total: num(r.total_cost_sar),
    parts:       { sar: num(r.parts_sar),          pct: pct(r.parts_pct) },
    outsourced:  { sar: num(r.outsourced_sar),     pct: pct(r.outsourced_pct) },
    payroll:     { sar: num(r.payroll_sar),        pct: pct(r.payroll_pct) },
    commissions: { sar: num(r.commissions_sar),    pct: pct(r.commissions_pct) },
    filling:     { sar: num(r.filling_sar),        pct: pct(r.filling_pct) },
    other:       { sar: num(r.other_expenses_sar), pct: pct(r.other_expenses_pct) },
    fillingUncosted: num(r.filling_uncosted_trips),
  }));

  // Fleet utilization by month (0130). numeric arrives as a STRING over
  // PostgREST, so coerce at the boundary; NULL stays null and never becomes 0.
  const fleetUtilization: FleetUtilizationRow[] = (
    (fleetUtilRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    month: String(r.month ?? ""),
    trucks_with_availability: Number(r.trucks_with_availability ?? 0),
    worked_days: Number(r.worked_days ?? 0),
    available_days: Number(r.available_days ?? 0),
    maintenance_days: Number(r.maintenance_days ?? 0),
    utilization_pct: r.utilization_pct == null ? null : Number(r.utilization_pct),
  }));

  const driverOps: DriverOps[] = (
    (driverOpsRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    driverId: String(r.driver_id ?? ""),
    name: String(r.name ?? ""),
    state: String(r.state ?? "off_duty") as DriverOpsState,
    truckPlate: r.truck_plate == null ? null : String(r.truck_plate),
    truckSource: r.truck_source == null
      ? null
      : (String(r.truck_source) as "assigned" | "trip"),
    truckInMaintenance: r.truck_in_maintenance === true,
    tripStage: r.trip_stage == null
      ? null
      : (String(r.trip_stage) as "scheduled" | "loading" | "in_transit"),
    inFlightTrips: num(r.in_flight_trips),
    compliance: String(r.compliance_status ?? "not_recorded") as ComplianceStatus,
    licenseStatus: String(r.license_status ?? "not_recorded") as ComplianceStatus,
    iqamaStatus: String(r.iqama_status ?? "not_recorded") as ComplianceStatus,
    conflicts: r.state_conflicts_with_trips === true,
  }));

  // ---- charts: every series is a column read straight off a view --------
  //
  // THE FIVE OPERATIONAL COST BUCKETS, current month. Station fill (0112) is
  // one of them: operating_cost_sar has INCLUDED it since that migration, so a
  // four-slice doughnut no longer added up to the total it claimed to break
  // down — live August, it was short by the whole 4,390.
  //
  // Manual expenses are still deliberately NOT folded in — 0098 keeps them a
  // separate P&L section, and this card's subtitle says "operating cost".
  //
  // Label and colour come from COST_TYPE, the SAME source the monthly Cost
  // composition bar reads, so a bucket cannot be cyan on one card and some
  // other colour on the one beside it. (The four pre-existing hexes were
  // identical to COST_TYPE's already — this changes no existing slice.)
  const slice = (key: CostSliceKey, value: number) => {
    const t = COST_TYPE.find((c) => c.key === key);
    return { label: t?.en ?? key, value, color: t?.color ?? "#64748b" };
  };
  const charts: DashCharts = {
    costMix: latestPnl
      ? [
          slice("parts", num(latestPnl.parts_cost_sar)),
          slice("outsourced", num(latestPnl.os_cost_sar)),
          slice("payroll", num(latestPnl.payroll_sar)),
          slice("commissions", num(latestPnl.commissions_sar)),
          slice("filling", num(latestPnl.filling_cost_sar)),
        ]
      : [],
    costMixUncosted: num(latestPnl?.filling_uncosted_trips),
    hasPnl: pnl.length > 0,
  };

  // ---- KPI row: headline figures, all dictionary-backed -----------------
  const openActions = actionItems.reduce((s, r) => s + (r.item_count ?? 0), 0);

  // Tone thresholds. DISPLAY ONLY — each reads a figure that already came
  // from a view and picks a CSS class; none of this changes a number, and
  // none of it is a metric definition. Figures with no good/bad direction
  // stay neutral rather than being forced into a colour they do not earn.
  const marginPct = num(latestPnl?.operating_margin_pct);
  const netProfit = num(latestPnl?.net_profit_sar);
  const highSeverityOpen = actionItems.some(
    (r) => r.severity === "high" && (r.item_count ?? 0) > 0
  );

  const headlines: Headline[] = [
    // THIS TILE IS THE REPORTS ANCHOR FOR REVENUE, and that is load-bearing.
    // It shows BILLED revenue — confirmed, non-voided invoices, net of VAT —
    // read from v_revenue_monthly, the same view the P&L reads. Invoices are
    // bucketed by the day they were CONFIRMED, in UTC, so daily figures sum to
    // the month exactly and this figure can never disagree with Reports.
    //
    // It is deliberately NOT the number on the revenue CHART below, which
    // plots DELIVERED (earned) revenue by trip_date — a different measure on a
    // different calendar (0108/0109). The two are not reconcilable and are
    // never added; this tile is where anyone checking against the P&L should
    // land, which is why its href goes straight to the Revenue statement.
    { key: "revenue", en: "Revenue", ar: "الإيرادات",
      value: formatSar(num(revenueRow?.revenue_sar)),
      subEn: "this month, net of VAT", subAr: "هذا الشهر، بدون الضريبة",
      href: "/reports?tab=statements&statement=revenue",
      hasData: !!revenueRow,
      // Revenue existing at all is the good reading. Zero is not "bad" — it
      // is nothing yet — so it stays neutral rather than alarming.
      tone: num(revenueRow?.revenue_sar) > 0 ? "good" : "neutral" },

    { key: "operating_margin", en: "Operating margin", ar: "هامش التشغيل",
      value: `${marginPct.toFixed(1)}%`,
      subEn: "this month", subAr: "هذا الشهر",
      href: "/reports?tab=statements&statement=pnl",
      hasData: !!latestPnl,
      // The most critical figure on the page: a negative margin means the
      // month is losing money. Thin (<10%) is worth attention, not alarm.
      tone: !latestPnl ? "neutral" : marginPct < 0 ? "bad" : marginPct < 10 ? "warn" : "good" },

    { key: "net_profit", en: "Net profit", ar: "صافي الربح",
      value: formatSar(netProfit),
      subEn: "after manual expenses", subAr: "بعد المصروفات اليدوية",
      href: "/reports?tab=statements&statement=pnl",
      hasData: !!latestPnl,
      tone: !latestPnl ? "neutral" : netProfit < 0 ? "bad" : "good" },

    { key: "collections", en: "Collected", ar: "المحصّل",
      value: formatSar(num(collectionsRow?.collected_gross_sar)),
      subEn: "cash in, this month", subAr: "نقد وارد هذا الشهر",
      href: "/reports?tab=statements&statement=receivables",
      hasData: !!collectionsRow,
      tone: num(collectionsRow?.collected_gross_sar) > 0 ? "good" : "neutral" },

    { key: "receivables_outstanding", en: "Outstanding", ar: "مستحقات",
      value: formatSar(outstanding),
      subEn: "owed right now", subAr: "مستحق الآن",
      href: "/reports?tab=statements&statement=receivables",
      hasData: !receivablesRes.error,
      // Money owed always deserves attention; nothing owed is genuinely good.
      tone: outstanding > 0 ? "warn" : "good" },

    { key: "operations", en: "Trips delivered", ar: "الرحلات المسلَّمة",
      value: String(num(opsRow?.trips_delivered)),
      subEn: "this month", subAr: "هذا الشهر",
      href: "/reports?tab=statements&statement=operations",
      hasData: !!opsRow,
      // A throughput count with no good/bad direction — an active reading.
      tone: "neutral" },

    { key: "trips_in_flight", en: "Trips in flight", ar: "رحلات جارية",
      value: String(state?.trips_in_flight ?? 0),
      subEn: "right now", subAr: "الآن",
      href: "/trips?tab=projects",
      hasData: !!state,
      tone: "neutral" },

    { key: "open_actions", en: "Needs action", ar: "يحتاج إجراء",
      value: String(openActions),
      subEn: "items waiting", subAr: "عنصر بالانتظار",
      href: "#dash-actions",
      hasData: !actionsRes.error,
      // Red ONLY when something high-severity is actually waiting. A queue of
      // low-priority items is amber; an empty queue is green.
      tone: openActions === 0 ? "good" : highSeverityOpen ? "bad" : "warn" },
  ];

  const widgetOptions: WidgetDef[] = availableWidgets(
    (dictRes.data ?? []) as { metric_key: string }[]
  );

  const error =
    actionsRes.error?.message ?? feedRes.error?.message ?? stateRes.error?.message ??
    pnlRes.error?.message ?? opsRes.error?.message ?? revenueRes.error?.message ??
    receivablesRes.error?.message ?? dailyRes.error?.message ??
    monthlyOnlyRes.error?.message ?? deliveryRes.error?.message ??
    projectsRes.error?.message ?? costCompRes.error?.message ??
    driverOpsRes.error?.message ?? deliveredRevRes.error?.message ??
    fleetUtilRes.error?.message ?? null;

  return (
    <DashboardClient
      actionItems={actionItems}
      feed={feed}
      state={state}
      truckState={truckState}
      headlines={headlines}
      charts={charts}
      dailyOps={dailyOps}
      deliveredRevenue={deliveredRevenue}
      delivery={delivery}
      monthlyOnly={monthlyOnly}
      projectStages={projectStages}
      costComposition={costComposition}
      fleetUtilization={fleetUtilization}
      driverOps={driverOps}
      drift={drift}
      liveTrips={liveTrips}
      widgetOptions={widgetOptions}
      errorMsg={error}
    />
  );
}
