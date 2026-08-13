import { createClient } from "@/lib/supabase/server";
import { formatSar } from "@/lib/utils";
import { availableWidgets, type WidgetDef } from "@/lib/dashboard-widgets";
import type {
  ActionItemRow, FeedRow, FleetStateNow, Headline, DashCharts, LiveTrip,
  DailyOps, DeliveryDay, MonthlyOnlyCost, ProjectStages, CostComposition,
  DriverOps, DriverOpsState, ComplianceStatus,
} from "@/lib/dashboard";
import { checkDriverStateDrift } from "@/lib/actions/driver-state-drift";
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
    projectsRes, costCompRes, driverOpsRes, drift,
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
    supabase.from("v_cost_composition_monthly").select("*")
      .order("month", { ascending: false }).limit(CHART_MONTHS),
    supabase.from("v_drivers_ops_now").select("*"),
    // The drift guard runs with the rest rather than after, so a page that
    // already makes a dozen round trips does not grow a serial one.
    checkDriverStateDrift(),
  ]);

  const actionItems = (actionsRes.data ?? []) as ActionItemRow[];
  const feed = (feedRes.data ?? []) as FeedRow[];
  const state = (stateRes.data ?? null) as FleetStateNow | null;

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
    revenue: num(r.revenue_sar),
    directCost: num(r.direct_cost_sar),
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
    other:       { sar: num(r.other_expenses_sar), pct: pct(r.other_expenses_pct) },
  }));

  const driverOps: DriverOps[] = (
    (driverOpsRes.data ?? []) as Record<string, unknown>[]
  ).map((r) => ({
    driverId: String(r.driver_id ?? ""),
    name: String(r.name ?? ""),
    state: String(r.state ?? "off_duty") as DriverOpsState,
    truckPlate: r.truck_plate == null ? null : String(r.truck_plate),
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
  const charts: DashCharts = {
    // The four operational cost buckets, current month. Manual expenses are
    // deliberately NOT folded in — 0098 keeps them a separate P&L section.
    costMix: latestPnl
      ? [
          { label: "Parts", value: num(latestPnl.parts_cost_sar), color: "#0b7eea" },
          { label: "Outsourced", value: num(latestPnl.os_cost_sar), color: "#f59e0b" },
          { label: "Payroll", value: num(latestPnl.payroll_sar), color: "#8b5cf6" },
          { label: "Commissions", value: num(latestPnl.commissions_sar), color: "#10b981" },
        ]
      : [],
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
    driverOpsRes.error?.message ?? null;

  return (
    <DashboardClient
      actionItems={actionItems}
      feed={feed}
      state={state}
      headlines={headlines}
      charts={charts}
      dailyOps={dailyOps}
      delivery={delivery}
      monthlyOnly={monthlyOnly}
      projectStages={projectStages}
      costComposition={costComposition}
      driverOps={driverOps}
      drift={drift}
      liveTrips={liveTrips}
      widgetOptions={widgetOptions}
      errorMsg={error}
    />
  );
}
