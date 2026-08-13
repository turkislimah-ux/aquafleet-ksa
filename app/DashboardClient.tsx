"use client";

// The Dashboard — the CATCH-UP page, second pass.
//
// LAYOUT, in Turki's order:
//   title + "Add summary" button
//   [ hero space the header search bar docks out of ]
//   KPI row              — headline figures, always above the content
//   Charts               — revenue vs direct cost (2/3) beside cost mix (1/3),
//                          then Delivery Output and operating margin full width
//   Active Trips + aging — the two "right now" snapshots, side by side
//   Live trips           — what is on the road right now
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
import { AreaChart, BarChart, ComboChart, PieChart } from "@/components/Charts";
import { cn, formatSar } from "@/lib/utils";
import {
  actionHint, actionHref, actionLabel, dayTick, feedLabel, feedTone,
  monthTitle, relativeTime, sortActionItems,
  type ActionItemRow, type DailyOps, type DashCharts, type DeliveryDay,
  type FeedRow, type FleetStateNow, type Headline, type LiveTrip,
  type MonthlyOnlyCost,
} from "@/lib/dashboard";
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

        <ChartCard
          title={ar ? "هامش التشغيل" : "Operating margin"}
          sub={ar ? "٪ شهرياً — يُحتسب لكل فترة" : "% per month, recomputed per period"}
          href="/reports?tab=statements&statement=pnl"
          empty={!charts.hasPnl} failed={failed} ar={ar}>
          <AreaChart labels={charts.months} data={charts.marginPct} color="#8b5cf6" className="h-56" />
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

        {/* Deliberately NOT a ChartCard here. Every other section on this page
            is an h2 above a bare Card, and a ChartCard would have put a second
            "Receivables aging" title inside the card under the first one. */}
        <section aria-labelledby="dash-aging" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="dash-aging" className="text-sm font-semibold">
              {ar ? "أعمار الذمم" : "Receivables aging"}
            </h2>
            <Link href="/reports?tab=statements&statement=receivables"
              className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {ar ? "المستحق حسب المدة ←" : "Outstanding by age →"}
            </Link>
          </div>
          <Card>
            {!charts.hasAging ? (
              <div className="grid h-56 place-items-center text-sm muted">
                {failed
                  ? (ar ? "تعذّرت قراءة هذا الرسم." : "Could not read this chart.")
                  : (ar ? "لا توجد بيانات بعد." : "No data yet.")}
              </div>
            ) : (
              <BarChart labels={charts.agingLabels} data={charts.agingValues}
                colors={["#10b981", "#3b82f6", "#f59e0b", "#e11d48"]} className="h-56"
                // Bucket names are painted onto the canvas, so this is the
                // only place they exist as text.
                ariaLabel={`${ar ? "المستحق حسب المدة" : "Outstanding by age"}: ${charts.agingLabels.join(", ")}`} />
            )}
          </Card>
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
function PhasePill({ stage, ar }: { stage: "loading" | "in_transit"; ar: boolean }) {
  const inTransit = stage === "in_transit";
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
      inTransit
        ? "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300"
        : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300"
    )}>
      {inTransit ? (ar ? "في الطريق" : "In transit") : (ar ? "تحميل" : "Loading")}
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
