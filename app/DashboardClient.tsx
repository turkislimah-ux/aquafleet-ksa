"use client";

// The Dashboard — the CATCH-UP page, second pass.
//
// LAYOUT, in Turki's order:
//   title + "Add summary" button
//   [ hero space the header search bar docks out of ]
//   KPI row              — headline figures, always above the content
//   Charts               — revenue vs direct cost (2/3) beside cost mix (1/3),
//                          then Delivery Output, the per-project stage cards,
//                          and monthly cost composition
//   Active Trips +
//     Drivers Ops        — the two "right now" boards, side by side
//   Needs action         — 6, with the rest in a popup
//   Right now + Activity — 6 events, with the rest in a popup
//   My summaries         — anything added via the header button
//
// THE HERO SPACER IS LOAD-BEARING, NOT DECORATION. The header's search bar
// translates down INTO this page's empty top region and rises back as you
// scroll (components/SearchDock.tsx). The first version of this rebuild
// dropped `useHeroDock` and the spacer, which silently killed the whole
// batch-1 intro — with no hero to measure, dock-distance stayed 0 and the
// bar never left the header. Removing the spacer removes the feature.
//
// EVERY NUMBER ARRIVES FROM A VIEW. No arithmetic on figures in this file.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Plus, X, Truck as TruckIcon, Users, Route,
  Wrench, CheckCircle2, Sparkles, ChevronLeft, ChevronRight, Info,
} from "lucide-react";
import { Card, Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { useHeroDock, useSearchDock } from "@/components/SearchDock";
import { ComboChart, PieChart } from "@/components/Charts";
import { cn, formatSar } from "@/lib/utils";
import type { TripStage } from "@/lib/db-types";
import {
  actionHint, actionHref, actionLabel, dayTick, feedLabel, feedTone,
  monthTitle, relativeTime, sortActionItems,
  sortDriverOps, COST_TYPE, STAGE_BAR,
  type ActionItemRow, type CostComposition, type ComplianceStatus,
  type DailyOps, type DashCharts, type DeliveryDay, type DriverOps,
  type DriverOpsState, type FeedRow, type FleetStateNow, type Headline,
  type LiveTrip, type MonthlyOnlyCost, type ProjectStages,
} from "@/lib/dashboard";
import type { DriverStateDrift } from "@/lib/actions/driver-state-drift";
import {
  parseStoredWidgets, widgetDef, WIDGETS_MAX, WIDGETS_STORAGE_KEY,
  type PlacedWidget, type WidgetDef, type WidgetDisplay,
} from "@/lib/dashboard-widgets";
import { getWidgetValue, type WidgetValue } from "@/lib/actions/dashboard-widgets";

const PREVIEW_COUNT = 6;

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-rose-500", medium: "bg-amber-500", low: "bg-slate-400",
};
/**
 * KPI colour scheme (Turki's spec):
 *   red   = critical            amber = needs awareness
 *   green = good indicator      blue  = an active/normal reading
 *
 * `neutral` maps to blue on purpose — a throughput count is a live reading,
 * not a verdict, and dressing it green would imply an approval the number
 * has not earned.
 */
const KPI_TEXT: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-brand-600 dark:text-brand-300",
};
const KPI_EDGE: Record<string, string> = {
  good: "border-s-2 border-s-emerald-500",
  warn: "border-s-2 border-s-amber-500",
  bad: "border-s-2 border-s-rose-500",
  neutral: "border-s-2 border-s-brand-500",
};

const TONE_TEXT: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  info: "text-brand-600 dark:text-brand-300",
};

export default function DashboardClient({
  actionItems, feed, state, headlines, charts, dailyOps, delivery, monthlyOnly,
  projectStages, costComposition, driverOps, drift,
  liveTrips, widgetOptions, errorMsg,
}: {
  actionItems: ActionItemRow[];
  feed: FeedRow[];
  state: FleetStateNow | null;
  headlines: Headline[];
  charts: DashCharts;
  dailyOps: DailyOps[];
  delivery: DeliveryDay[];
  monthlyOnly: MonthlyOnlyCost[];
  projectStages: ProjectStages[];
  costComposition: CostComposition[];
  driverOps: DriverOps[];
  drift: DriverStateDrift;
  liveTrips: LiveTrip[];
  widgetOptions: WidgetDef[];
  errorMsg: string | null;
}) {
  const { lang } = useApp();
  const ar = lang === "ar";
  // A failed read means we do not KNOW the state of anything, so no section
  // may claim to be empty. "Every queue is clear" after an error is a lie.
  const failed = !!errorMsg;

  // ---- batch-1 search-bar intro: RESTORED ------------------------------
  const heroRef = useRef<HTMLDivElement>(null);
  const { reducedMotion } = useSearchDock();
  useHeroDock(heroRef);

  const openItems = useMemo(
    () => sortActionItems(actionItems).filter((r) => r.item_count > 0),
    [actionItems]
  );
  const [allActions, setAllActions] = useState(false);
  const [allFeed, setAllFeed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ---- daily revenue vs direct cost (0104) ------------------------------
  // The months available to step through come from the DATA, in the order the
  // view returned them. Not generated from today's date: the view's spine
  // ends at Riyadh today, so its own last month IS the current month, and
  // deriving that in TS would reintroduce the UTC/Riyadh skew 0104 avoids.
  const dailyMonths = useMemo(() => {
    const seen: string[] = [];
    for (const d of dailyOps) if (d.month && !seen.includes(d.month)) seen.push(d.month);
    return seen;
  }, [dailyOps]);

  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  // Defaults to the LAST month present — the current one — and re-clamps if
  // the data shape changes underneath it.
  const activeMonthIdx =
    dailyMonths.length === 0
      ? -1
      : Math.min(monthIdx ?? dailyMonths.length - 1, dailyMonths.length - 1);
  const activeMonth = activeMonthIdx >= 0 ? dailyMonths[activeMonthIdx] : null;

  const monthDays = useMemo(
    () => (activeMonth ? dailyOps.filter((d) => d.month === activeMonth) : []),
    [dailyOps, activeMonth]
  );
  // The excluded cost for THIS month, read from its own view row. Null means
  // the row could not be read — the UI says so rather than printing 0, which
  // would read as "nothing is missing" and be the opposite of the truth.
  const monthExcluded = useMemo(
    () => monthlyOnly.find((m) => m.month === activeMonth) ?? null,
    [monthlyOnly, activeMonth]
  );

  // ---- Delivery Output (0105) — SAME month as the chart above ------------
  // Both daily charts read `activeMonth`, so the stepper on either card moves
  // both. Two charts on one screen showing different months would be worse
  // than either alone; 0105 was drafted on the full spine for exactly this.
  const deliveryDays = useMemo(
    () => (activeMonth ? delivery.filter((d) => d.month === activeMonth) : []),
    [delivery, activeMonth]
  );
  // The reconciliation the card has to state out loud: trips WITHOUT a truck
  // count on the line and contribute nothing to the bars.
  //
  // ON THE "no arithmetic in this file" RULE: these two totals ARE sums, and
  // they are allowed, because they add up days of ONE view into the month that
  // same view already buckets by — the roll-up 0104/0105 prove reconciles to
  // v_operations_monthly. That is not re-deriving a metric from base tables,
  // which is the thing the rule exists to stop. Nothing here defines a
  // measure; both figures exist only to write one honest sentence.
  const noTruckTrips = useMemo(
    () => deliveryDays.reduce((s, d) => s + d.tripsNoTruck, 0),
    [deliveryDays]
  );
  const deliveredTrips = useMemo(
    () => deliveryDays.reduce((s, d) => s + d.tripsDelivered, 0),
    [deliveryDays]
  );

  return (
    <div className="space-y-6">
      {/* title + the ONLY Add-summary entry point */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {ar ? "لوحة التحكم" : "Dashboard"}
            </h1>
            <p className="muted text-sm mt-1">
              {ar
                ? "ما يحتاج إلى إجراء، وما استجدّ، والوضع الآن"
                : "What needs action, what changed, where things stand"}
            </p>
          </div>
          <Btn variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {ar ? "إضافة ملخص" : "Add summary"}
          </Btn>
        </div>
        <div className="h-px w-full" style={{ background: "rgb(var(--border))", opacity: "var(--dock-progress, 1)" }} />
      </div>

      {/* THE HERO. Empty by design — the header's search bar occupies it.
          See the file header for why deleting this deletes the feature. */}
      <div ref={heroRef} className={cn("relative", reducedMotion ? "h-0" : "h-[34vh]")} aria-hidden>
        {!reducedMotion && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[26rem] w-[46rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2"
            style={{
              opacity: "calc((1 - var(--dock-progress, 1)) * 0.9)",
              background:
                "radial-gradient(ellipse at center, rgb(var(--accent) / 0.10), rgb(var(--accent) / 0.04) 45%, transparent 70%)",
            }}
          />
        )}
      </div>

      {/* Bottom fade — content dissolves at the edge until the bar docks. */}
      {!reducedMotion && (
        <div
          aria-hidden
          className="pointer-events-none fixed bottom-0 start-0 end-0 md:start-64 z-10 h-44"
          style={{
            opacity: "calc(1 - var(--dock-progress, 1))",
            background:
              "linear-gradient(to top, rgb(var(--bg)) 12%, rgb(var(--bg) / 0.82) 45%, rgb(var(--bg) / 0) 100%)",
          }}
        />
      )}

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {ar ? "تعذّر تحميل اللوحة: " : "Failed to load the dashboard: "}{errorMsg}
        </p>
      )}

      {/* Renders NOTHING unless the two definitions of driver state disagree. */}
      <DriftBanner ar={ar} drift={drift} />

      {/* ---- KPI ROW — always above the charts ------------------------- */}
      <section aria-labelledby="dash-kpi">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="dash-kpi" className="text-sm font-semibold">{ar ? "المؤشرات" : "Key figures"}</h2>
          <Link href="/reports" className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
            {ar ? "التحليل الكامل في التقارير ←" : "Full analysis in Reports →"}
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {headlines.map((h) => (
            <Link key={h.key} href={h.href}
              className={cn(
                "focus-ring card p-3 transition-colors [touch-action:manipulation]",
                "hover:border-brand-500/40",
                // A tinted left edge carries the reading as well as the text
                // colour, so the meaning survives for anyone who cannot
                // separate the hues — colour is never the only signal.
                h.hasData && KPI_EDGE[h.tone]
              )}>
              <div className="text-[11px] muted uppercase tracking-wide truncate">{ar ? h.ar : h.en}</div>
              {/* An absent period must never render a confident zero — and a
                  figure we do not have must not be coloured as if we did. */}
              <div className={cn("mt-1 text-xl font-semibold tabular-nums",
                h.hasData ? KPI_TEXT[h.tone] : "")}>
                {h.hasData ? h.value : "—"}
              </div>
              <div className="mt-0.5 text-[11px] muted truncate">{ar ? h.subAr : h.subEn}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- CHARTS ----------------------------------------------------
          Rearranged for width: three charts across a 1440px page left each
          one ~380px, too narrow for 12 monthly labels without collisions.

          Grouped by what they are, not by how many fit a row. The daily and
          monthly TIME SERIES get the width, because two of them plot ~31 daily
          points and the third plots 12 monthly ones. Cost mix takes the
          remaining third beside the money chart it breaks down — a doughnut
          has no axis to crowd, and the space it gives up buys a written
          legend. Receivables aging left this block entirely; it is a snapshot
          of what is owed and now sits with Active Trips. */}
      <section aria-labelledby="dash-charts" className="space-y-4">
        <h2 id="dash-charts" className="text-sm font-semibold">{ar ? "نظرة عامة" : "Overview"}</h2>

        {/* DAILY revenue vs DIRECT cost, one month at a time (0104).
            Two labelling rules are non-negotiable and come from the metrics
            dictionary, not from taste: the cost series is "Direct cost", never
            "cost", and the gap between it and real cost is stated as a NUMBER
            underneath. Nothing on this card computes a margin — a figure
            measured before payroll is not profit and must not look like it. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          className="lg:col-span-2"
          title={ar ? "الإيرادات مقابل التكلفة المباشرة" : "Revenue vs direct cost"}
          sub={activeMonth
            ? `${ar ? "يومياً — " : "daily — "}${monthTitle(activeMonth, ar)}`
            : (ar ? "يومياً" : "daily")}
          href="/reports?tab=statements&statement=pnl"
          empty={monthDays.length === 0} failed={failed} ar={ar}
          action={
            dailyMonths.length > 1 ? (
              <MonthStepper
                ar={ar}
                canPrev={activeMonthIdx > 0}
                canNext={activeMonthIdx < dailyMonths.length - 1}
                onPrev={() => setMonthIdx(Math.max(0, activeMonthIdx - 1))}
                onNext={() => setMonthIdx(Math.min(dailyMonths.length - 1, activeMonthIdx + 1))}
              />
            ) : null
          }>
          <ComboChart
            labels={monthDays.map((d) => dayTick(d.day))}
            bar={{
              label: ar ? "الإيرادات" : "Revenue",
              data: monthDays.map((d) => d.revenue),
              color: "#10b981",
            }}
            line={{
              label: ar ? "التكلفة المباشرة" : "Direct cost",
              data: monthDays.map((d) => d.directCost),
              color: "#f59e0b",
            }}
            className="h-72"
          />
          <DailyCostDisclosure ar={ar} excluded={monthExcluded} failed={failed} />
        </ChartCard>

        {/* COST MIX rides alongside the money chart it explains: the bars
            above say how much cost there was, this says what it was made of.
            A third of the row, so the doughnut shrinks and a written legend
            takes the space — which is the better trade anyway, since the
            doughnut alone never said which slice was which. */}
        <ChartCard
          title={ar ? "مزيج التكلفة" : "Cost mix"}
          sub={ar ? "هذا الشهر — تكلفة التشغيل" : "this month — operating cost"}
          href="/reports?tab=statements&statement=cost"
          empty={!charts.hasPnl || charts.costMix.every((c) => c.value === 0)}
          failed={failed} ar={ar}>
          <PieChart className="h-48"
            items={charts.costMix.map((c) => ({ label: c.label, value: c.value, color: c.color }))} />
          <CostMixLegend ar={ar} items={charts.costMix} />
        </ChartCard>
        </div>

        {/* DELIVERY OUTPUT (0105) — replaces the monthly Trips-delivered
            area chart entirely.

            THE BAR IS A PROXY AND THE CARD SAYS SO. capacity_m3 is the full
            tank of every truck that ran, whether or not it ran full, because
            trips.tank_size_m3 — the column that would hold measured volume —
            is empty on all 203 trips. Drawing that column instead would be a
            flat zero line pretending to be a measurement.

            TWO AXES, deliberately: m3 and a trip count are different units,
            and sharing one scale would flatten the trip line into the axis
            and misreport it. Contrast with the revenue-vs-cost card above,
            where BOTH series are SAR and therefore must share a scale. */}
        <ChartCard
          title={ar ? "ناتج التوصيل" : "Delivery Output"}
          sub={activeMonth
            ? `${ar ? "يومياً — " : "daily — "}${monthTitle(activeMonth, ar)}`
            : (ar ? "يومياً" : "daily")}
          href="/reports?tab=statements&statement=operations"
          empty={deliveryDays.length === 0} failed={failed} ar={ar}
          action={
            dailyMonths.length > 1 ? (
              <MonthStepper
                ar={ar}
                canPrev={activeMonthIdx > 0}
                canNext={activeMonthIdx < dailyMonths.length - 1}
                onPrev={() => setMonthIdx(Math.max(0, activeMonthIdx - 1))}
                onNext={() => setMonthIdx(Math.min(dailyMonths.length - 1, activeMonthIdx + 1))}
              />
            ) : null
          }>
          <ComboChart
            labels={deliveryDays.map((d) => dayTick(d.day))}
            bar={{
              label: ar ? "السعة المُشغَّلة (م٣)" : "Capacity dispatched (m³)",
              data: deliveryDays.map((d) => d.capacityM3),
              color: "#0b7eea",
            }}
            line={{
              label: ar ? "الرحلات المسلَّمة" : "Trips delivered",
              data: deliveryDays.map((d) => d.tripsDelivered),
              color: "#8b5cf6",
            }}
            lineAxis="y1"
            y1Label={ar ? "رحلات" : "trips"}
            className="h-64"
          />
          <DeliveryOutputNote
            ar={ar} noTruckTrips={noTruckTrips} deliveredTrips={deliveredTrips} />
        </ChartCard>

        {/* PROJECTS — one compact card per active project, each a single
            stacked bar across the four stages.

            The project set and the counts are the Kanban's own
            (v_project_trip_stages, 0106), so the two cannot disagree. One
            difference is deliberate and is said on the card: the Kanban is
            DAY-SCOPED and this is the project's whole history, because a
            per-project bar limited to one day would be nearly empty.

            Delivered dominates every bar. That is the intended full picture,
            not a scaling bug — a project that has run for months SHOULD read
            as mostly delivered. */}
        <section aria-labelledby="dash-projects" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 id="dash-projects" className="text-sm font-semibold">
                {ar ? "المشاريع" : "Projects"}
              </h3>
              <p className="text-[11px] muted">
                {ar
                  ? "كل الرحلات لكل مشروع نشط، حسب المرحلة — لا يقتصر على يوم واحد كلوحة كانبان"
                  : "every trip per active project, by stage — not one day like the Kanban board"}
              </p>
            </div>
            <Link href="/trips?tab=projects"
              className="focus-ring shrink-0 rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {ar ? "لوحة الرحلات ←" : "Trips board →"}
            </Link>
          </div>

          <StageLegend ar={ar} />

          {projectStages.length === 0 ? (
            <Card>
              <p className="text-sm muted">
                {failed
                  ? (ar ? "تعذّرت قراءة المشاريع." : "Could not read projects.")
                  : (ar ? "لا توجد مشاريع نشطة." : "No active projects.")}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {projectStages.map((p) => (
                <ProjectStageCard key={p.projectId} ar={ar} project={p} />
              ))}
            </div>
          )}
        </section>

        {/* COST COMPOSITION — which cost type dominates each month.
            MONTHLY by necessity: payroll and non-trip commission have no daily
            source at all (0104), so only this grain can show true composition.
            Shares come from v_cost_composition_monthly, computed per month off
            the P&L's own published figures. */}
        <ChartCard
          title={ar ? "تركيبة التكلفة" : "Cost composition"}
          sub={ar ? "حصة كل نوع من تكلفة الشهر" : "each type's share of the month's cost"}
          href="/reports?tab=statements&statement=cost"
          empty={costComposition.length === 0} failed={failed} ar={ar}>
          <CostCompositionChart ar={ar} months={costComposition} />
        </ChartCard>

      </section>

      {/* ---- ACTIVE TRIPS + RECEIVABLES AGING, side by side -------------
          Aging moved out of the charts block to sit here. Both are SNAPSHOTS
          of right now — what is on the road, and what is owed — so they read
          as one row rather than as a leftover chart and an unrelated list.
          Neither needs a wide axis: aging has four buckets and the trips list
          is text. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <section aria-labelledby="dash-live" className="space-y-3">
          <h2 id="dash-live" className="text-sm font-semibold">
            {ar ? "الرحلات النشطة" : "Active Trips"}
          </h2>
          <Card className="p-0">
            {liveTrips.length === 0 ? (
              <p className="p-4 text-sm muted">
                {failed
                  ? (ar ? "تعذّر القراءة." : "Could not read.")
                  : (ar ? "لا توجد رحلات نشطة." : "No active trips.")}
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "rgb(var(--border))" }}>
                {liveTrips.map((t) => (
                  // TWO LINES PER TRIP, not four fixed columns. At half width
                  // the old single row had to truncate the project name to
                  // almost nothing; stacking keeps every field readable and
                  // drops nothing. Ref and phase lead, because those are what
                  // you scan for.
                  <li key={t.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {t.ref ?? "—"}
                      </span>
                      <PhasePill stage={t.stage} ar={ar} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs muted">
                      <TruckIcon className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="shrink-0 truncate">{t.truckLabel}</span>
                      <span aria-hidden>·</span>
                      {/* The PROJECT it serves — who the trip is for. It used
                          to show the water station, which is where it filled
                          up rather than who it is for. */}
                      <span className="min-w-0 flex-1 truncate">
                        {t.project ?? (ar ? "غير مُسند" : "Unassigned")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* DRIVERS OPS — the live board, replacing Receivables aging.
            Reads v_drivers_ops_now (0106). See the DriversOpsTable comment for
            why state and stage are allowed to contradict each other. */}
        <section aria-labelledby="dash-drivers" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="dash-drivers" className="text-sm font-semibold">
              {ar ? "حالة السائقين" : "Drivers Ops"}
            </h2>
            <Link href="/drivers"
              className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {ar ? "كل السائقين ←" : "All drivers →"}
            </Link>
          </div>
          <DriversOpsTable ar={ar} rows={driverOps} failed={failed} />
        </section>
      </div>

      {/* ---- NEEDS ACTION (below the charts, 6 + popup) ---------------- */}
      <section aria-labelledby="dash-actions">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="dash-actions" className="text-sm font-semibold">
            {ar ? "يحتاج إلى إجراء" : "Needs action"}
          </h2>
          {openItems.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setAllActions(true)}
              className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {ar ? `عرض الكل (${openItems.length})` : `View all (${openItems.length})`}
            </button>
          )}
        </div>

        {failed ? (
          <Card className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" aria-hidden />
            <div className="text-sm muted">{ar ? "تعذّر قراءة قائمة المهام." : "Could not read the queue."}</div>
          </Card>
        ) : openItems.length === 0 ? (
          <Card className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden />
            <div>
              <div className="text-sm font-medium">{ar ? "لا شيء معلّق" : "Nothing waiting"}</div>
              <div className="text-xs muted">
                {ar ? "كل قوائم الموافقات والمهام فارغة." : "Every queue is clear right now."}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openItems.slice(0, PREVIEW_COUNT).map((row) => (
              <ActionCard key={row.kind} row={row} lang={lang} ar={ar} />
            ))}
          </div>
        )}
      </section>

      {/* ---- RIGHT NOW | ACTIVITY -------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section aria-labelledby="dash-now" className="lg:col-span-2 space-y-3">
          <h2 id="dash-now" className="text-sm font-semibold">{ar ? "الوضع الآن" : "Right now"}</h2>
          {!state ? (
            <Card>
              <p className="text-sm muted">
                {failed
                  ? (ar ? "تعذّر قراءة الوضع الحالي." : "Could not read current state.")
                  : (ar ? "لا توجد بيانات." : "No data.")}
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <TruckIcon className="h-4 w-4 muted" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wider muted">{ar ? "الأسطول" : "Fleet"}</span>
                  <span className="ms-auto text-xs muted tabular-nums">{state.trucks_total}</span>
                </div>
                <MixBar parts={[
                  { label: ar ? "نشطة" : "Active", value: state.trucks_active, color: "#10b981" },
                  { label: ar ? "متوقفة" : "Idle", value: state.trucks_idle, color: "#3b82f6" },
                  { label: ar ? "صيانة" : "Maintenance", value: state.trucks_maintenance, color: "#f59e0b" },
                ]} />
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 muted" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wider muted">{ar ? "السائقون" : "Drivers"}</span>
                  <span className="ms-auto text-xs muted tabular-nums">{state.drivers_total}</span>
                </div>
                <MixBar parts={[
                  { label: ar ? "في الخدمة" : "Active", value: state.drivers_active, color: "#10b981" },
                  { label: ar ? "متاح" : "Idle", value: state.drivers_idle, color: "#3b82f6" },
                  { label: ar ? "خارج الخدمة" : "Off duty", value: state.drivers_off_duty, color: "#94a3b8" },
                  { label: ar ? "إجازة" : "On leave", value: state.drivers_on_leave, color: "#f59e0b" },
                ]} />
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat icon={Route} label={ar ? "رحلات جارية" : "Trips in flight"}
                  value={state.trips_in_flight} href="/trips?tab=projects" />
                <MiniStat icon={Wrench} label={ar ? "أعمال جارية" : "Jobs running"}
                  value={state.work_orders_running + state.outsourced_running} href="/maintenance" />
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="dash-activity" className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="dash-activity" className="text-sm font-semibold">
              {ar ? "آخر النشاطات" : "Latest activity"}
            </h2>
            {feed.length > PREVIEW_COUNT && (
              <button type="button" onClick={() => setAllFeed(true)}
                className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
                {ar ? "عرض الكل" : "View all"}
              </button>
            )}
          </div>
          <Card className="p-0">
            {feed.length === 0 ? (
              <p className="p-4 text-sm muted">
                {failed
                  ? (ar ? "تعذّر قراءة النشاط." : "Could not read activity.")
                  : (ar ? "لا يوجد نشاط مسجّل بعد." : "No recorded activity yet.")}
              </p>
            ) : (
              <FeedList rows={feed.slice(0, PREVIEW_COUNT)} lang={lang} />
            )}
          </Card>
        </section>
      </div>

      {/* ---- MY SUMMARIES — appended at the bottom --------------------- */}
      <Summaries options={widgetOptions} ar={ar} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} />

      {/* ---- popups ---------------------------------------------------- */}
      {allActions && (
        <Modal title={ar ? "كل ما يحتاج إجراء" : "Everything that needs action"} onClose={() => setAllActions(false)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {openItems.map((row) => <ActionCard key={row.kind} row={row} lang={lang} ar={ar} />)}
          </div>
        </Modal>
      )}
      {allFeed && (
        <Modal title={ar ? "كل النشاطات" : "All activity"} onClose={() => setAllFeed(false)}>
          <div className="card p-0"><FeedList rows={feed} lang={lang} /></div>
        </Modal>
      )}
    </div>
  );
}

/** A chart card that shows an honest empty state instead of empty axes. */
function ChartCard({
  title, sub, href, empty, failed, ar, className, action, children,
}: {
  title: string; sub: string; href: string; empty: boolean; ar: boolean;
  /**
   * A read FAILED, so we do not know whether there is data. Without this the
   * card renders "No data yet." over a permission error — the same confident
   * lie the action queue and activity feed already guard against, just in a
   * chart. An unread chart must say it is unread.
   */
  failed?: boolean;
  className?: string;
  /** Optional control in the card header, beside the deep link. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
          <div className="text-[11px] muted truncate">{sub}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <Link href={href} aria-label={title}
            className="focus-ring rounded p-1 muted transition-colors hover:text-brand-600">
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
      {empty ? (
        <div className="grid h-44 place-items-center text-sm muted">
          {failed
            ? (ar ? "تعذّرت قراءة هذا الرسم." : "Could not read this chart.")
            : (ar ? "لا توجد بيانات بعد." : "No data yet.")}
        </div>
      ) : children}
    </Card>
  );
}

/** Steps the daily charts back and forth one month at a time. */
function MonthStepper({
  ar, canPrev, canNext, onPrev, onNext,
}: {
  ar: boolean; canPrev: boolean; canNext: boolean;
  onPrev: () => void; onNext: () => void;
}) {
  // Older is always on the LEFT and newer on the RIGHT in both directions —
  // the chart's own x axis runs that way regardless of text direction, so
  // flipping these in RTL would point them away from the data they move.
  const btn =
    "focus-ring rounded p-1 muted transition-colors hover:text-brand-600 " +
    "disabled:opacity-30 disabled:hover:text-inherit";
  return (
    <div className="flex items-center" dir="ltr">
      <button type="button" onClick={onPrev} disabled={!canPrev} className={btn}
        aria-label={ar ? "الشهر السابق" : "Previous month"}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={onNext} disabled={!canNext} className={btn}
        aria-label={ar ? "الشهر التالي" : "Next month"}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * States, as a figure, what the daily cost line CANNOT see.
 *
 * This is not decoration. `direct_cost_sar` excludes payroll and non-trip
 * commission because neither has a daily source, and live that is 67-99% of
 * real cost. Without this line a reader compares a full revenue bar against a
 * fraction of cost and concludes the month is hugely profitable. The
 * `daily_direct_cost` dictionary caveat requires this disclosure.
 */
function DailyCostDisclosure({
  ar, excluded, failed,
}: {
  ar: boolean; excluded: MonthlyOnlyCost | null; failed: boolean;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="muted">
        {excluded ? (
          ar ? (
            <>
              <span className="font-medium">التكلفة المباشرة ليست التكلفة الكاملة.</span>{" "}
              تستثني {formatSar(excluded.total)} هذا الشهر (رواتب {formatSar(excluded.payroll)}
              {excluded.commissionNonTrip !== 0
                ? `، وعمولات خاصة وتسويات ومكافآت ${formatSar(excluded.commissionNonTrip)}`
                : ""}
              ) — لا يوجد لأيٍّ منها مصدر يومي، فكلاهما رقم شهري. والإيرادات مُسجَّلة بتاريخ
              اعتماد الفاتورة، لا بتواريخ رحلاتها.
            </>
          ) : (
            <>
              <span className="font-medium">Direct cost is not full cost.</span>{" "}
              It excludes {formatSar(excluded.total)} this month (
              {formatSar(excluded.payroll)} payroll
              {excluded.commissionNonTrip !== 0
                ? `, ${formatSar(excluded.commissionNonTrip)} commission specials, adjustments and bonus`
                : ""}
              ) — neither has a daily source; both are monthly figures. Revenue lands on the day
              an invoice was confirmed, not the days its trips ran.
            </>
          )
        ) : failed ? (
          ar ? "تعذّرت قراءة التكلفة الشهرية المستثناة." : "Could not read the excluded monthly cost."
        ) : (
          ar
            ? "التكلفة المباشرة تستثني الرواتب والعمولات غير المرتبطة برحلة — لا يوجد لها مصدر يومي."
            : "Direct cost excludes payroll and non-trip commission — neither has a daily source."
        )}
      </p>
    </div>
  );
}

/**
 * The driver-state drift guard, on screen.
 *
 * SILENT WHEN HEALTHY — returns null, so a working system costs the reader
 * nothing. That is what makes it affordable to run permanently, and permanent
 * is the point: the previous guard lived behind a throwaway route, became
 * unreachable when the route was deleted, and existed for exactly as long as
 * nobody needed it.
 *
 * It also stays silent when UNREACHABLE. With no session RLS returns zero rows
 * on both sides, and shouting "drift" at a reader who is merely logged out
 * would train everyone to dismiss this banner — which costs more than the bug
 * it watches for.
 */
function DriftBanner({ ar, drift }: { ar: boolean; drift: DriverStateDrift }) {
  if (drift.ok || !drift.reachable) return null;
  return (
    <div role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
      <p className="flex items-start gap-2 font-medium text-rose-700 dark:text-rose-300">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {ar
          ? `تعارض في حالة السائقين: ${drift.mismatches.length} من ${drift.checked} لا تتطابق بين قاعدة البيانات وحساب التطبيق.`
          : `Driver state disagrees: ${drift.mismatches.length} of ${drift.checked} differ between the database view and the app's own rule.`}
      </p>
      <ul className="mt-1 space-y-0.5 ps-5 muted">
        {drift.mismatches.map((m) => (
          <li key={m.driverId}>
            <span className="font-medium">{m.name}</span>
            {" — "}
            {ar ? "العرض" : "view"}: {m.sql} · {ar ? "التطبيق" : "app"}: {m.ts}
          </li>
        ))}
      </ul>
      <p className="mt-1 muted">
        {ar
          ? "v_driver_state_now و lib/driver-state.ts يجب أن يتطابقا — أصلح القاعدة في الاثنين معاً."
          : "v_driver_state_now and lib/driver-state.ts must match — fix the rule in both."}
      </p>
    </div>
  );
}

/** One legend for all six project cards — repeating it per card would be six
 *  copies of the same four words in a grid meant to read compactly. */
function StageLegend({ ar }: { ar: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {STAGE_BAR.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] muted">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
            style={{ background: s.color }} />
          {ar ? s.ar : s.en}
        </li>
      ))}
    </ul>
  );
}

/**
 * One project, one horizontal stacked bar across the four stages.
 *
 * WIDTHS ARE PROPORTIONS OF THAT PROJECT'S OWN TOTAL, so every bar fills its
 * card and projects are compared by SHAPE. A shared scale would squeeze the
 * smallest project into a sliver and make its composition unreadable, which is
 * the one thing this card exists to show. The absolute total sits beside the
 * name so size is never lost.
 *
 * Delivered dominates every bar by design — a project running for months
 * SHOULD read as mostly delivered. The in-flight count is called out
 * separately because it is the part that can still be acted on.
 */
function ProjectStageCard({ ar, project }: { ar: boolean; project: ProjectStages }) {
  const segments = STAGE_BAR
    .map((s) => ({ ...s, value: project[s.key] }))
    .filter((s) => s.value > 0);

  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{project.projectName}</span>
        <span className="shrink-0 text-xs tabular-nums muted">
          {project.total} {ar ? "رحلة" : project.total === 1 ? "trip" : "trips"}
        </span>
      </div>

      {project.total === 0 ? (
        <p className="mt-2 text-[11px] muted">{ar ? "لا توجد رحلات بعد." : "No trips yet."}</p>
      ) : (
        <>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={segments.map((s) => `${ar ? s.ar : s.en}: ${s.value}`).join(", ")}>
            {segments.map((s) => (
              <span key={s.key} title={`${ar ? s.ar : s.en}: ${s.value}`}
                style={{ width: `${(s.value / project.total) * 100}%`, background: s.color }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
            {STAGE_BAR.map((s) => (
              <span key={s.key}
                className={cn("flex items-center gap-1", project[s.key] === 0 && "opacity-40")}>
                <span className="h-1.5 w-1.5 rounded-full" aria-hidden style={{ background: s.color }} />
                {project[s.key]}
              </span>
            ))}
            {project.inFlight > 0 && (
              <span className="ms-auto text-brand-600 dark:text-brand-300">
                {project.inFlight} {ar ? "قيد التنفيذ" : "in flight"}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Cost composition — one 100%-wide stacked bar per month, newest last.
 *
 * Not a Chart.js chart: five stacked shares with readable labels is what CSS
 * flex does natively, and it keeps every figure as real TEXT rather than
 * pixels on a canvas (the same reason ComboChart carries an aria-label).
 *
 * A NULL share renders as EMPTY, never 0%. `pct == null` means the month had
 * no cost at all — "no cost recorded" and "0% of the cost" are different
 * claims, and printing the second when the first is true is the class of lie
 * this whole layer exists to prevent.
 */
function CostCompositionChart({ ar, months }: { ar: boolean; months: CostComposition[] }) {
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {COST_TYPE.map((t) => (
          <li key={t.key} className="flex items-center gap-1.5 text-[11px] muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
              style={{ background: t.color }} />
            {ar ? t.ar : t.en}
          </li>
        ))}
      </ul>

      <div className="space-y-2.5">
        {months.map((m) => {
          const parts = COST_TYPE
            .map((t) => ({ ...t, ...m[t.key] }))
            .filter((t) => t.pct != null && t.pct > 0);
          const noCost = m.total === 0 || parts.length === 0;
          return (
            <div key={m.month}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-medium">{monthTitle(m.month, ar)}</span>
                <span className="tabular-nums muted">{formatSar(m.total)}</span>
              </div>
              {noCost ? (
                <div className="flex h-4 items-center rounded-md border border-dashed px-2 text-[10px] muted"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  {ar ? "لا تكلفة مسجَّلة" : "No cost recorded"}
                </div>
              ) : (
                <div className="flex h-4 w-full overflow-hidden rounded-md"
                  role="img"
                  aria-label={parts.map((t) => `${ar ? t.ar : t.en} ${t.pct}%`).join(", ")}>
                  {parts.map((t) => (
                    <span key={t.key}
                      className="flex items-center justify-center overflow-hidden text-[9px] font-medium text-white"
                      title={`${ar ? t.ar : t.en}: ${t.pct}% · ${formatSar(t.sar)}`}
                      style={{ width: `${t.pct}%`, background: t.color }}>
                      {/* Only label a slice wide enough to hold the text — a
                          clipped "1%" is noise, and the title carries it. */}
                      {(t.pct ?? 0) >= 12 ? `${t.pct}%` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const COMPLIANCE_PILL: Record<ComplianceStatus, string> = {
  expired: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  expiring_soon: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  // Slate, not green: an unknown expiry is a gap to close, and colouring it
  // like a pass is exactly the fabricated all-clear 0106 refuses to emit.
  not_recorded: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300",
  ok: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
};
const COMPLIANCE_LABEL: Record<ComplianceStatus, { en: string; ar: string }> = {
  expired: { en: "Expired", ar: "منتهية" },
  expiring_soon: { en: "Expiring", ar: "تنتهي قريباً" },
  not_recorded: { en: "Not recorded", ar: "غير مسجَّلة" },
  ok: { en: "Valid", ar: "سارية" },
};
const DRIVER_STATE_LABEL: Record<DriverOpsState, { en: string; ar: string; dot: string }> = {
  active:   { en: "Active",   ar: "نشط",         dot: "bg-emerald-500" },
  idle:     { en: "Idle",     ar: "خامل",        dot: "bg-brand-500" },
  off_duty: { en: "Off duty", ar: "خارج الدوام", dot: "bg-slate-400" },
  on_leave: { en: "On leave", ar: "في إجازة",    dot: "bg-amber-500" },
};

/**
 * The live drivers board.
 *
 * STATE AND STAGE ARE ALLOWED TO CONTRADICT EACH OTHER — that is the whole
 * point of the row. `active` means ASSIGNED (a truck and a live project), not
 * currently driving. A driver with no truck is `off_duty` by the canonical
 * rule (lib/driver-state.ts, mirrored by v_driver_state_now) yet can still
 * hold in-flight trips; live, three do. Forcing the two columns to agree would
 * mean printing a falsehood in one of them, so both are shown as they are and
 * the PAIRING is flagged — the same signal the Kanban already gives by
 * blurring those cards.
 */
function DriversOpsTable({
  ar, rows, failed,
}: {
  ar: boolean; rows: DriverOps[]; failed: boolean;
}) {
  const sorted = useMemo(() => sortDriverOps(rows), [rows]);

  if (sorted.length === 0) {
    return (
      <Card>
        <p className="text-sm muted">
          {failed
            ? (ar ? "تعذّرت قراءة السائقين." : "Could not read drivers.")
            : (ar ? "لا يوجد سائقون." : "No drivers.")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <ul className="divide-y" style={{ borderColor: "rgb(var(--border))" }}>
        {sorted.map((d) => {
          const st = DRIVER_STATE_LABEL[d.state];
          return (
            <li key={d.driverId} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  COMPLIANCE_PILL[d.compliance]
                )}>
                  {ar ? COMPLIANCE_LABEL[d.compliance].ar : COMPLIANCE_LABEL[d.compliance].en}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs muted">
                <span>{ar ? st.ar : st.en}</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <TruckIcon className="h-3 w-3 shrink-0" aria-hidden />
                  {d.truckPlate ?? (ar ? "بلا شاحنة" : "No truck")}
                </span>
                {d.tripStage && (
                  <>
                    <span aria-hidden>·</span>
                    <PhasePill stage={d.tripStage} ar={ar} />
                    {d.inFlightTrips > 1 && <span className="tabular-nums">×{d.inFlightTrips}</span>}
                  </>
                )}
              </div>
              {d.conflicts && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  {ar
                    ? "بلا شاحنة مُسندة رغم وجود رحلات جارية — الحالة والرحلات لا تتفقان."
                    : "Holds in-flight trips with no assigned truck — state and trips disagree."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Names the doughnut's slices, with the figure each one is.
 *
 * The chart had no legend at all before — Chart.js paints one onto the canvas
 * and this app's PieChart switches it off, so the wedges were unlabelled
 * colour. Written out here instead of enabling the canvas legend for the same
 * reason ComboChart carries an aria-label: canvas text is pixels, invisible to
 * a screen reader and to any test.
 *
 * VALUES, NOT PERCENTAGES. Each figure is a column read off v_pnl_monthly; a
 * share would be arithmetic this file does not do, and the doughnut already
 * carries the proportion visually.
 */
function CostMixLegend({
  ar, items,
}: {
  ar: boolean; items: { label: string; value: number; color: string }[];
}) {
  const LABEL_AR: Record<string, string> = {
    Parts: "قطع الغيار", Outsourced: "أعمال خارجية",
    Payroll: "الرواتب", Commissions: "العمولات",
  };
  return (
    <ul className="mt-3 space-y-1.5">
      {items.map((c) => (
        <li key={c.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
            style={{ background: c.color }} />
          <span className="min-w-0 flex-1 truncate">{ar ? (LABEL_AR[c.label] ?? c.label) : c.label}</span>
          <span className="shrink-0 tabular-nums muted">{formatSar(c.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Says, on the card, that the bars are a PROXY — and reconciles the line
 * against them when they cannot agree.
 *
 * Two separate disclosures, both required by the `delivery_output` dictionary
 * caveat:
 *
 *  1. capacity_m3 is capacity DISPATCHED, not litres delivered. It is the full
 *     tank of every truck that ran, full or not. trips.tank_size_m3 — the
 *     column for real volume — is empty on all 203 trips, which is why a proxy
 *     is on screen at all.
 *
 *  2. a delivered trip with NO truck contributes to the line and nothing to
 *     the bars. Left unsaid, the two series silently disagree and the bar
 *     understates the day. Said out loud, they reconcile.
 */
function DeliveryOutputNote({
  ar, noTruckTrips, deliveredTrips,
}: {
  ar: boolean; noTruckTrips: number; deliveredTrips: number;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
      <p className="muted">
        {ar ? (
          <>
            <span className="font-medium">السعة المُشغَّلة، لا الكمية المقاسة.</span>{" "}
            تجمع الأعمدة السعة الكاملة لكل شاحنة نفّذت توصيلاً، سواء خرجت ممتلئة أم لا —
            فحقل حجم الخزان لكل رحلة غير مُعبَّأ في أي رحلة، فلا توجد كمية مقاسة تُعرض.
            {noTruckTrips > 0 && (
              <>
                {" "}
                <span className="font-medium">
                  {noTruckTrips} من {deliveredTrips} رحلة مسلَّمة هذا الشهر بلا شاحنة مُسندة،
                </span>{" "}
                فسعتها غير محسوبة ضمن الأعمدة رغم احتسابها ضمن خط الرحلات.
              </>
            )}
          </>
        ) : (
          <>
            <span className="font-medium">Capacity dispatched, not measured volume.</span>{" "}
            The bars add up the full capacity of every truck that made a delivery, whether
            or not it ran full — per-trip tank size is unrecorded on every trip, so there is
            no measured volume to show.
            {noTruckTrips > 0 && (
              <>
                {" "}
                <span className="font-medium">
                  {noTruckTrips} of {deliveredTrips} delivered trips this month have no truck
                  assigned,
                </span>{" "}
                so their capacity is missing from the bars even though they count on the
                trips line.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/** The trip's phase, as a pill. Colours match the Kanban's own phase
 *  mapping (loading = amber, in_transit = orange) so the two agree. */
// All four stages, because Drivers Ops can report a driver whose most-advanced
// in-flight trip is still `scheduled` — Active Trips only ever sees the middle
// two. One pill for both, so a stage cannot end up two colours on one page.
const PHASE_PILL: Record<TripStage, { en: string; ar: string; cls: string }> = {
  scheduled:  { en: "Scheduled",  ar: "مجدولة",
    cls: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300" },
  loading:    { en: "Loading",    ar: "تحميل",
    cls: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300" },
  in_transit: { en: "In transit", ar: "في الطريق",
    cls: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300" },
  delivered:  { en: "Delivered",  ar: "مسلَّمة",
    cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" },
};

function PhasePill({ stage, ar }: { stage: TripStage; ar: boolean }) {
  const p = PHASE_PILL[stage];
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", p.cls
    )}>
      {ar ? p.ar : p.en}
    </span>
  );
}

function ActionCard({ row, lang, ar }: { row: ActionItemRow; lang: "en" | "ar"; ar: boolean }) {
  return (
    <Link href={actionHref(row.kind)}
      className="focus-ring card p-4 flex items-start gap-3 transition-colors hover:border-brand-500/40 [touch-action:manipulation]">
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[row.severity] ?? "bg-slate-400")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{row.item_count}</span>
          <span className="min-w-0 truncate text-sm">{actionLabel(row.kind, lang)}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs muted">
          {actionHint(row.kind, lang)}
          {row.oldest_at && <> · {ar ? "الأقدم " : "oldest "}{relativeTime(row.oldest_at, lang)}</>}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 muted" aria-hidden />
    </Link>
  );
}

function FeedList({ rows, lang }: { rows: FeedRow[]; lang: "en" | "ar" }) {
  return (
    <ul className="divide-y" style={{ borderColor: "rgb(var(--border))" }}>
      {rows.map((row, i) => (
        <li key={`${row.kind}-${row.entity_id}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
          <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            feedTone(row.kind) === "ok" ? "bg-emerald-500"
            : feedTone(row.kind) === "warn" ? "bg-amber-500"
            : feedTone(row.kind) === "bad" ? "bg-rose-500" : "bg-brand-500")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-sm font-medium", TONE_TEXT[feedTone(row.kind)])}>
                {feedLabel(row.kind, lang)}
              </span>
              {row.title && <span className="text-sm truncate">{row.title}</span>}
            </div>
            <div className="text-xs muted truncate">
              {relativeTime(row.occurred_at, lang)}
              {row.subtitle && <> · {row.subtitle}</>}
              {/* Only when the row recorded one — never a guess. */}
              {row.actor && <> · {row.actor}</>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Portal modal. Portaled so a `fixed` backdrop anchors to the true viewport
 * and stacked popups are DOM siblings rather than nested — the exact trap
 * already documented for the Inventory modals (CLAUDE.md §7).
 */
function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card w-full max-w-[1080px] max-h-[85vh] overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="focus-ring grid h-8 w-8 place-items-center rounded-lg muted transition-colors hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[calc(85vh-3.5rem)] overflow-y-auto scrollbar-thin p-4"
          style={{ overscrollBehavior: "contain" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function MixBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        {total > 0 && parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-xs">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate muted">{p.label}</span>
            <span className="tabular-nums font-medium">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, href }: {
  icon: typeof Route; label: string; value: number; href: string;
}) {
  return (
    <Link href={href} className="focus-ring card p-3 transition-colors hover:border-brand-500/40">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 muted" aria-hidden />
        <span className="text-[11px] muted truncate">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// My summaries — tiles added from the HEADER button. The picker is a popup;
// the tiles land at the bottom of the page as an addition, per Turki.
//
// Fenced exactly like the Reports custom builder: the catalogue is private in
// lib/dashboard-widgets.ts, options come only from availableWidgets()
// intersected with the live report_metrics dictionary, and the server action
// re-checks the key before querying. The NL box is a marked, inert seam.
// ---------------------------------------------------------------------------
function Summaries({ options, ar, pickerOpen, setPickerOpen }: {
  options: WidgetDef[]; ar: boolean; pickerOpen: boolean; setPickerOpen: (v: boolean) => void;
}) {
  const [widgets, setWidgets] = useState<PlacedWidget[]>([]);
  const [values, setValues] = useState<Record<string, WidgetValue | null>>({});

  useEffect(() => {
    setWidgets(parseStoredWidgets(localStorage.getItem(WIDGETS_STORAGE_KEY), options));
  }, [options]);

  const persist = useCallback((next: PlacedWidget[]) => {
    setWidgets(next);
    try { localStorage.setItem(WIDGETS_STORAGE_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    for (const w of widgets) {
      if (values[w.id] !== undefined) continue;
      getWidgetValue(w.key)
        .then((v) => { if (!cancelled) setValues((p) => ({ ...p, [w.id]: v })); })
        .catch(() => { if (!cancelled) setValues((p) => ({ ...p, [w.id]: null })); });
    }
    return () => { cancelled = true; };
  }, [widgets, values]);

  const add = (key: string, display: WidgetDisplay) => {
    if (widgets.length >= WIDGETS_MAX) return;
    persist([...widgets, { id: `w${Date.now().toString(36)}`, key, display }]);
    setPickerOpen(false);
  };

  return (
    <>
      {widgets.length > 0 && (
        <section aria-labelledby="dash-summary" className="space-y-3">
          <h2 id="dash-summary" className="text-sm font-semibold">{ar ? "ملخصاتي" : "My summaries"}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {widgets.map((w) => {
              const def = widgetDef(w.key);
              const val = values[w.id];
              if (!def) return null;
              return (
                <Card key={w.id} className="relative">
                  <button type="button" onClick={() => persist(widgets.filter((x) => x.id !== w.id))}
                    aria-label={ar ? "إزالة" : "Remove"}
                    className="focus-ring absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-md muted transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <Link href={def.href} className="focus-ring block rounded">
                    <div className="text-xs muted uppercase tracking-wide pe-7">{ar ? def.ar : def.en}</div>
                  </Link>
                  {val === undefined ? (
                    <div className="mt-2 text-sm muted">…</div>
                  ) : !val || !val.hasData ? (
                    <div className="mt-2 text-sm muted">{ar ? "لا توجد بيانات." : "No data yet."}</div>
                  ) : w.display === "stat" || val.parts.length === 0 ? (
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {def.unit === "sar" ? formatSar(val.value)
                        : def.unit === "pct" ? `${val.value.toFixed(1)}%` : val.value}
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {val.parts.map((p) => {
                        const max = Math.max(...val.parts.map((x) => Math.abs(x.value)), 1);
                        return (
                          <li key={p.label} className="flex items-center gap-2 text-xs">
                            <span className="w-14 shrink-0 truncate muted">{p.label}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                              <span className="block h-full rounded-full bg-brand-500"
                                style={{ width: `${(Math.abs(p.value) / max) * 100}%` }} />
                            </span>
                            <span className="shrink-0 tabular-nums font-medium">
                              {def.unit === "sar" ? formatSar(p.value) : p.value}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {pickerOpen && (
        <Modal title={ar ? "إضافة ملخص" : "Add summary"} onClose={() => setPickerOpen(false)}>
          <p className="mb-3 text-xs muted">
            {ar
              ? "كل خيار هنا يقرأ من الطبقة الدلالية نفسها التي تقرأ منها التقارير — لا أرقام مستقلة."
              : "Every option here reads the same semantic layer Reports reads — no independent numbers."}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((o) => (
              <div key={o.key} className="flex items-center gap-2 rounded-lg border p-2"
                style={{ borderColor: "rgb(var(--border))" }}>
                <span className="min-w-0 flex-1 truncate text-sm">{ar ? o.ar : o.en}</span>
                {o.displays.map((d) => (
                  <button key={d} type="button" onClick={() => add(o.key, d)}
                    className="focus-ring rounded-md border px-2 py-0.5 text-[11px] muted transition-colors hover:border-brand-500/40 hover:text-[rgb(var(--fg))]"
                    style={{ borderColor: "rgb(var(--border))" }}>
                    {d === "stat" ? (ar ? "رقم" : "number") : (ar ? "أعمدة" : "bars")}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md text-white"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="text-xs font-medium">{ar ? "اطلب ملخصاً بالكلمات" : "Describe a summary"}</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[9px] uppercase tracking-wide muted dark:bg-white/10">
                {ar ? "قريباً" : "Coming soon"}
              </span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed muted">
              {ar
                ? "سيملأ هذا نفس المنشئ أعلاه انطلاقاً من وصفك. لم يُبنَ بعد — لا يُرسل ما تكتبه إلى أي مكان."
                : "This will fill in the same builder above from a description. Not built yet — nothing you type is sent anywhere."}
            </p>
            <input disabled placeholder={ar ? "غير متاح بعد" : "Not available yet"}
              className="w-full cursor-not-allowed rounded-lg border px-3 py-2 text-sm opacity-60"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }} />
          </div>
        </Modal>
      )}
    </>
  );
}
