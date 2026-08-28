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
import { t, type Lang } from "@/lib/i18n";
import {
  utilizationBand, utilizationBarWidth, formatUtilization,
  UTILIZATION_BAND, type FleetUtilizationRow,
} from "@/lib/utilization";
// Reused, not re-derived — the same helper the Reports Overview uses to warn
// that a period is still running.
import { isCurrentMonth } from "@/lib/reports";
import type { TruckStateCounts } from "@/lib/actions/truck-state";
import type { TripStage } from "@/lib/db-types";
import {
  actionHint, actionHref, actionLabel, dayTick, feedLabel, feedTone,
  monthTitle, relativeTime, sortActionItems,
  sortDriverOps, COST_TYPE, STAGE_BAR,
  type ActionItemRow, type CostComposition, type ComplianceStatus,
  type CostSliceKey, type DailyOps, type DashCharts, type DeliveredRevenueDay,
  type DeliveryDay, type DriverOps,
  type DriverOpsState, type FeedRow, type FleetStateNow, type Headline,
  type LiveTrip, type MonthlyOnlyCost, type ProjectStages,
} from "@/lib/dashboard";
import type { DriverStateDrift } from "@/lib/actions/driver-state-drift";
import {
  parseStoredWidgets, widgetDef, WIDGETS_MAX, WIDGETS_STORAGE_KEY,
  type PlacedWidget, type WidgetDef, type WidgetDisplay,
} from "@/lib/dashboard-widgets";
import { getWidgetValue, type WidgetValue } from "@/lib/actions/dashboard-widgets";
import ScrollLock from "@/components/ScrollLock";

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

/**
 * Substitutes `{name}` placeholders in a dictionary string.
 *
 * The replacement is a FUNCTION, not a string: `String.prototype.replace`
 * re-expands `$&` and `$1` in a string replacement, and an entity name or a
 * formatted figure is user data that may contain either.
 */
function fill(s: string, tokens: Record<string, string | number>): string {
  let out = s;
  for (const [k, v] of Object.entries(tokens)) out = out.replace(`{${k}}`, () => String(v));
  return out;
}

export default function DashboardClient({
  actionItems, feed, state, truckState, headlines, charts, dailyOps, deliveredRevenue,
  delivery, monthlyOnly,
  projectStages, costComposition, driverOps, drift, fleetUtilization,
  liveTrips, widgetOptions, errorMsg,
}: {
  actionItems: ActionItemRow[];
  feed: FeedRow[];
  state: FleetStateNow | null;
  truckState: TruckStateCounts;
  headlines: Headline[];
  charts: DashCharts;
  dailyOps: DailyOps[];
  deliveredRevenue: DeliveredRevenueDay[];
  delivery: DeliveryDay[];
  monthlyOnly: MonthlyOnlyCost[];
  projectStages: ProjectStages[];
  costComposition: CostComposition[];
  // Fleet-wide utilization per month (0130). PRE-BLENDED by the view —
  // sum(worked)/sum(available) — so this page never averages per-truck
  // percentages. It follows the same month stepper as the daily charts.
  fleetUtilization: FleetUtilizationRow[];
  driverOps: DriverOps[];
  drift: DriverStateDrift;
  liveTrips: LiveTrip[];
  widgetOptions: WidgetDef[];
  errorMsg: string | null;
}) {
  const { lang } = useApp();
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

  // ---- earned revenue (0108) — zipped onto the SAME days ----------------
  // The view shares v_daily_operations' spine by construction, so a lookup by
  // day is exact: no invented days, no dropped ones. Keyed rather than
  // index-matched, because relying on two arrays staying in the same order is
  // how an off-by-one silently misdates a whole series.
  const deliveredByDay = useMemo(() => {
    const m = new Map<string, DeliveredRevenueDay>();
    for (const d of deliveredRevenue) m.set(d.day, d);
    return m;
  }, [deliveredRevenue]);

  // Unpriced DELIVERED trips in the month on screen. A delivered trip with no
  // project has no rate, so it contributes 0 to the delivered figure — the
  // count is surfaced to qualify that figure rather than let it run silently
  // short. Summed across days of one view, which is the roll-up that view
  // already buckets by; no metric is defined here.
  // Fills in the month on screen whose station has no price for their water
  // type. Their cost is UNKNOWN, so direct cost is short by an unknown amount
  // and the chart must say so — sum() skipped them in the view.
  const uncostedFillsInMonth = useMemo(
    () => monthDays.reduce((s, d) => s + d.fillingUncosted, 0),
    [monthDays]
  );

  const unpricedInMonth = useMemo(
    () => monthDays.reduce((s, d) => s + (deliveredByDay.get(d.day)?.unpricedTrips ?? 0), 0),
    [monthDays, deliveredByDay]
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
              {t("dashboard.title", lang)}
            </h1>
            <p className="muted text-sm mt-1">
              {t("dashboard.subtitle", lang)}
            </p>
          </div>
          <Btn variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("dashboard.addSummary", lang)}
          </Btn>
        </div>
        <div className="h-px w-full" style={{ background: "rgb(var(--border))", opacity: "var(--dock-progress, 1)" }} />
      </div>

      {/* THE HERO. Empty by design — the header's search bar occupies it.
          See the file header for why deleting this deletes the feature. */}
      <div ref={heroRef} className={cn("relative", reducedMotion ? "h-0" : "h-[34vh]")} aria-hidden>
        {!reducedMotion && (
          <div
            // Centred on the hero, which is where the bar rests — the bar is
            // centred in this same content column at progress 0 and only
            // travels to the header's start as you scroll, by which point the
            // glow has faded out entirely.
            //
            // `max-w-full` and not `92vw`: the cap is this column, and vw
            // ignores the sidebar.
            className="pointer-events-none absolute left-1/2 top-1/2 h-[26rem] w-[46rem] max-w-full -translate-x-1/2 -translate-y-1/2"
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
          // The inset clears the sidebar off AppShell's --app-sidebar-w rather
          // than restating its width here. That variable tracks the sidebar's
          // FOOTPRINT — the rail — not how wide the panel currently looks: the
          // panel is `fixed` and overlays the page when hovered, so this fade
          // must not chase it or it would slide sideways under the cursor.
          // The fallback matches the rail for the same reason.
          className="pointer-events-none fixed bottom-0 start-0 end-0 md:start-[var(--app-sidebar-w,3.5rem)] z-10 h-44"
          style={{
            opacity: "calc(1 - var(--dock-progress, 1))",
            background:
              "linear-gradient(to top, rgb(var(--bg)) 12%, rgb(var(--bg) / 0.82) 45%, rgb(var(--bg) / 0) 100%)",
          }}
        />
      )}

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {t("dashboard.loadFailed", lang)}{errorMsg}
        </p>
      )}

      {/* Renders NOTHING unless the two definitions of driver state disagree. */}
      <DriftBanner lang={lang} drift={drift} />

      {/* ---- KPI ROW — always above the charts ------------------------- */}
      <section aria-labelledby="dash-kpi">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="dash-kpi" className="text-sm font-semibold">{t("dashboard.kpiHeading", lang)}</h2>
          <Link href="/reports" className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
            {t("dashboard.fullAnalysis", lang)}
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
              <div className="text-[11px] muted uppercase tracking-wide truncate">{t(`dashboard.headline.${h.key}.label`, lang)}</div>
              {/* An absent period must never render a confident zero — and a
                  figure we do not have must not be coloured as if we did. */}
              <div className={cn("mt-1 text-xl font-semibold tabular-nums",
                h.hasData ? KPI_TEXT[h.tone] : "")}>
                {h.hasData ? h.value : "—"}
              </div>
              <div className="mt-0.5 text-[11px] muted truncate">{t(`dashboard.headline.${h.key}.sub`, lang)}</div>
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
        <h2 id="dash-charts" className="text-sm font-semibold">{t("dashboard.overview", lang)}</h2>

        {/* DAILY revenue vs DIRECT cost, one month at a time (0104).
            Two labelling rules are non-negotiable and come from the metrics
            dictionary, not from taste: the cost series is "Direct cost", never
            "cost", and the gap between it and real cost is stated as a NUMBER
            underneath. Nothing on this card computes a margin — a figure
            measured before payroll is not profit and must not look like it. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          className="lg:col-span-2"
          title={t("dashboard.revVsCost.title", lang)}
          sub={activeMonth
            ? `${t("dashboard.dailyPrefix", lang)}${monthTitle(activeMonth, lang)}`
            : t("dashboard.daily", lang)}
          href="/reports?tab=statements&statement=pnl"
          empty={monthDays.length === 0} failed={failed} lang={lang}
          action={
            dailyMonths.length > 1 ? (
              <MonthStepper
                lang={lang}
                canPrev={activeMonthIdx > 0}
                canNext={activeMonthIdx < dailyMonths.length - 1}
                onPrev={() => setMonthIdx(Math.max(0, activeMonthIdx - 1))}
                onNext={() => setMonthIdx(Math.min(dailyMonths.length - 1, activeMonthIdx + 1))}
              />
            ) : null
          }>
          {/* TWO series. The invoiced line was dropped at Turki's call — he
              does not need it here, and the KPI "Revenue" tile remains the
              Reports anchor for billed revenue.

              THE LABEL IS NEVER PLAIN "REVENUE". What is plotted is EARNED
              work (delivered trips at their project's rate), which does not
              match Reports and is not supposed to. Calling it "Revenue" would
              invite exactly the comparison it fails. */}
          <ComboChart
            labels={monthDays.map((d) => dayTick(d.day))}
            line={{
              label: t("dashboard.series.deliveredRevenue", lang),
              data: monthDays.map((d) => deliveredByDay.get(d.day)?.revenue ?? 0),
              color: "#10b981",
            }}
            extraLine={{
              label: t("dashboard.series.directCost", lang),
              data: monthDays.map((d) => d.directCost),
              color: "#f59e0b",
            }}
            className="h-72"
          />
          <DeliveredRevenueNote lang={lang} unpricedTrips={unpricedInMonth} />
          <UncostedFillsNote lang={lang} uncosted={uncostedFillsInMonth} />
          <DailyCostDisclosure lang={lang} excluded={monthExcluded} failed={failed} />
        </ChartCard>

        {/* COST MIX rides alongside the money chart it explains: the bars
            above say how much cost there was, this says what it was made of.
            A third of the row, so the doughnut shrinks and a written legend
            takes the space — which is the better trade anyway, since the
            doughnut alone never said which slice was which. */}
        <ChartCard
          title={t("dashboard.costMix.title", lang)}
          sub={t("dashboard.costMix.sub", lang)}
          href="/reports?tab=statements&statement=cost"
          empty={!charts.hasPnl || charts.costMix.every((c) => c.value === 0)}
          failed={failed} lang={lang}>
          <PieChart className="h-48"
            items={charts.costMix.map((c) => ({
              label: t(`dashboard.costType.${c.key}`, lang), value: c.value, color: c.color,
            }))} />
          <CostMixLegend lang={lang} items={charts.costMix} />
          {/* Station fill is one of the slices, so its unknown-cost count
              belongs on this card too — a wedge summed with sum() over a column
              that can be NULL is short by an unknown amount, and the doughnut
              cannot show that by itself. */}
          <UncostedFillsNote lang={lang} uncosted={charts.costMixUncosted} shortOf="fillSlice" />
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
          title={t("dashboard.deliveryOutput.title", lang)}
          sub={activeMonth
            ? `${t("dashboard.dailyPrefix", lang)}${monthTitle(activeMonth, lang)}`
            : t("dashboard.daily", lang)}
          href="/reports?tab=statements&statement=operations"
          empty={deliveryDays.length === 0} failed={failed} lang={lang}
          action={
            dailyMonths.length > 1 ? (
              <MonthStepper
                lang={lang}
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
              label: t("dashboard.series.capacityM3", lang),
              data: deliveryDays.map((d) => d.capacityM3),
              color: "#0b7eea",
            }}
            line={{
              label: t("dashboard.series.tripsDelivered", lang),
              data: deliveryDays.map((d) => d.tripsDelivered),
              color: "#8b5cf6",
            }}
            lineAxis="y1"
            y1Label={t("dashboard.series.tripsAxis", lang)}
            className="h-64"
          />
          <DeliveryOutputNote
            lang={lang} noTruckTrips={noTruckTrips} deliveredTrips={deliveredTrips} />
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
                {t("dashboard.projects.heading", lang)}
              </h3>
              {/* The window is the view's (0107), not this file's — it moves
                  to the new month on the 1st with nothing to update here. Said
                  out loud because the same cards used to mean all-time, and a
                  reader has no way to tell the two apart from the bars. */}
              <p className="text-[11px] muted">
                {t("dashboard.projects.window", lang)}
              </p>
            </div>
            <Link href="/trips?tab=projects"
              className="focus-ring shrink-0 rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {t("dashboard.projects.boardLink", lang)}
            </Link>
          </div>

          <StageLegend lang={lang} />

          {projectStages.length === 0 ? (
            <Card>
              <p className="text-sm muted">
                {t(failed ? "dashboard.projects.readFailed" : "dashboard.projects.empty", lang)}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {projectStages.map((p) => (
                <ProjectStageCard key={p.projectId} lang={lang} project={p} />
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
          title={t("dashboard.costComposition.title", lang)}
          sub={t("dashboard.costComposition.sub", lang)}
          href="/reports?tab=statements&statement=cost"
          empty={costComposition.length === 0} failed={failed} lang={lang}>
          <CostCompositionChart lang={lang} months={costComposition} />
        </ChartCard>

        {/* FLEET UTILIZATION (0130) — placed directly BELOW Cost composition:
            both answer "how did this month go", and the two month-grained cards
            now read as a pair rather than being separated by the projects and
            drivers sections.

            IT FOLLOWS THE SAME MONTH STEPPER as the daily charts above, so
            stepping back moves this figure with them rather than leaving a
            "now" number stranded beside a historical chart.

            THE FIGURE IS READ, NEVER ASSEMBLED. v_fleet_utilization_monthly
            publishes sum(worked)/sum(available); averaging the per-truck
            percentages here would weight a truck available 2 days the same as
            one available 31 (live August: 45.86 blended, 38.40 averaged). */}
        <FleetUtilizationCard
          lang={lang}
          row={fleetUtilization.find((f) => f.month === activeMonth) ?? null}
          month={activeMonth}
          failed={failed}
        />

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
            {t("dashboard.liveTrips.heading", lang)}
          </h2>
          <Card className="p-0">
            {liveTrips.length === 0 ? (
              <p className="p-4 text-sm muted">
                {t(failed ? "dashboard.liveTrips.readFailed" : "dashboard.liveTrips.empty", lang)}
              </p>
            ) : (
              <ul className="divide-y divide-[rgb(var(--border))]">
                {liveTrips.map((trip) => (
                  // TWO LINES PER TRIP, not four fixed columns. At half width
                  // the old single row had to truncate the project name to
                  // almost nothing; stacking keeps every field readable and
                  // drops nothing. Ref and phase lead, because those are what
                  // you scan for.
                  <li key={trip.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {trip.ref ?? "—"}
                      </span>
                      <PhasePill stage={trip.stage} lang={lang} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs muted">
                      <TruckIcon className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="shrink-0 truncate">{trip.truckLabel}</span>
                      <span aria-hidden>·</span>
                      {/* The PROJECT it serves — who the trip is for. It used
                          to show the water station, which is where it filled
                          up rather than who it is for. */}
                      <span className="min-w-0 flex-1 truncate">
                        {trip.project ?? t("dashboard.liveTrips.unassigned", lang)}
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
              {t("dashboard.driversOps.heading", lang)}
            </h2>
            <Link href="/drivers"
              className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {t("dashboard.driversOps.allLink", lang)}
            </Link>
          </div>
          <DriversOpsTable lang={lang} rows={driverOps} failed={failed} />
        </section>
      </div>

      {/* ---- NEEDS ACTION (below the charts, 6 + popup) ---------------- */}
      <section aria-labelledby="dash-actions">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="dash-actions" className="text-sm font-semibold">
            {t("dashboard.actions.heading", lang)}
          </h2>
          {openItems.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setAllActions(true)}
              className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
              {fill(t("dashboard.actions.viewAllCount", lang), { n: openItems.length })}
            </button>
          )}
        </div>

        {failed ? (
          <Card className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" aria-hidden />
            <div className="text-sm muted">{t("dashboard.actions.readFailed", lang)}</div>
          </Card>
        ) : openItems.length === 0 ? (
          <Card className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden />
            <div>
              <div className="text-sm font-medium">{t("dashboard.actions.emptyTitle", lang)}</div>
              <div className="text-xs muted">
                {t("dashboard.actions.emptyBody", lang)}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openItems.slice(0, PREVIEW_COUNT).map((row) => (
              <ActionCard key={row.kind} row={row} lang={lang} />
            ))}
          </div>
        )}
      </section>

      {/* ---- RIGHT NOW | ACTIVITY -------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section aria-labelledby="dash-now" className="lg:col-span-2 space-y-3">
          <h2 id="dash-now" className="text-sm font-semibold">{t("dashboard.now.heading", lang)}</h2>
          {!state ? (
            <Card>
              <p className="text-sm muted">
                {t(failed ? "dashboard.now.readFailed" : "dashboard.now.empty", lang)}
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <TruckIcon className="h-4 w-4 muted" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wider muted">{t("dashboard.now.fleet", lang)}</span>
                  {/* TRUCK COUNTS COME FROM THE FLEET PAGE'S OWN RULE, not from
                      v_fleet_state_now. The view still derives them in SQL but
                      nothing reads that any more — this mirrors what /fleet
                      acts on, so the two screens cannot disagree about which
                      trucks are in the workshop. A failed read shows an em
                      dash, never a confident zero. */}
                  <span className="ms-auto text-xs muted tabular-nums">
                    {truckState.ok ? truckState.total : "—"}
                  </span>
                </div>
                {truckState.ok ? (
                  <MixBar parts={[
                    { label: t("dashboard.fleetState.active", lang), value: truckState.active, color: "#10b981" },
                    { label: t("dashboard.fleetState.idle", lang), value: truckState.idle, color: "#3b82f6" },
                    { label: t("dashboard.fleetState.maintenance", lang), value: truckState.maintenance, color: "#f59e0b" },
                  ]} />
                ) : (
                  <p className="text-xs muted">{t("dashboard.now.fleetReadFailed", lang)}</p>
                )}
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 muted" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wider muted">{t("dashboard.now.drivers", lang)}</span>
                  <span className="ms-auto text-xs muted tabular-nums">{state.drivers_total}</span>
                </div>
                <MixBar parts={[
                  { label: t("dashboard.driverMix.active", lang), value: state.drivers_active, color: "#10b981" },
                  { label: t("dashboard.driverMix.idle", lang), value: state.drivers_idle, color: "#3b82f6" },
                  { label: t("dashboard.driverMix.offDuty", lang), value: state.drivers_off_duty, color: "#94a3b8" },
                  { label: t("dashboard.driverMix.onLeave", lang), value: state.drivers_on_leave, color: "#f59e0b" },
                ]} />
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat icon={Route} label={t("dashboard.now.tripsInFlight", lang)}
                  value={state.trips_in_flight} href="/trips?tab=projects" />
                <MiniStat icon={Wrench} label={t("dashboard.now.jobsRunning", lang)}
                  value={state.work_orders_running + state.outsourced_running} href="/maintenance" />
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="dash-activity" className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="dash-activity" className="text-sm font-semibold">
              {t("dashboard.activity.heading", lang)}
            </h2>
            {feed.length > PREVIEW_COUNT && (
              <button type="button" onClick={() => setAllFeed(true)}
                className="focus-ring rounded text-xs text-brand-600 hover:underline dark:text-brand-300">
                {t("dashboard.activity.viewAll", lang)}
              </button>
            )}
          </div>
          <Card className="p-0">
            {feed.length === 0 ? (
              <p className="p-4 text-sm muted">
                {t(failed ? "dashboard.activity.readFailed" : "dashboard.activity.empty", lang)}
              </p>
            ) : (
              <FeedList rows={feed.slice(0, PREVIEW_COUNT)} lang={lang} />
            )}
          </Card>
        </section>
      </div>

      {/* ---- MY SUMMARIES — appended at the bottom --------------------- */}
      <Summaries options={widgetOptions} lang={lang} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} />

      {/* ---- popups ---------------------------------------------------- */}
      {allActions && (
        <Modal title={t("dashboard.actions.modalTitle", lang)} onClose={() => setAllActions(false)} lang={lang}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {openItems.map((row) => <ActionCard key={row.kind} row={row} lang={lang} />)}
          </div>
        </Modal>
      )}
      {allFeed && (
        <Modal title={t("dashboard.activity.modalTitle", lang)} onClose={() => setAllFeed(false)} lang={lang}>
          <div className="card p-0"><FeedList rows={feed} lang={lang} /></div>
        </Modal>
      )}
    </div>
  );
}

/** A chart card that shows an honest empty state instead of empty axes. */
function ChartCard({
  title, sub, href, empty, failed, lang, className, action, children,
}: {
  title: string; sub: string; href: string; empty: boolean; lang: Lang;
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
          {t(failed ? "dashboard.chart.readFailed" : "dashboard.chart.empty", lang)}
        </div>
      ) : children}
    </Card>
  );
}

/** Steps the daily charts back and forth one month at a time. */
function MonthStepper({
  lang, canPrev, canNext, onPrev, onNext,
}: {
  lang: Lang; canPrev: boolean; canNext: boolean;
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
        aria-label={t("dashboard.monthStepper.prev", lang)}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={onNext} disabled={!canNext} className={btn}
        aria-label={t("dashboard.monthStepper.next", lang)}>
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
 *
 * IT ALSO NAMES WHAT THE LINE DOES INCLUDE. Station fill (0112) is a direct
 * cost with a real per-day source, and it is inside `direct_cost_sar` — live
 * August, 4,390 of 26,085.42. A disclosure that only ever lists exclusions
 * invites the reader to assume anything unmentioned is out, which would make
 * this line look smaller than it is rather than larger.
 */
function DailyCostDisclosure({
  lang, excluded, failed,
}: {
  lang: Lang; excluded: MonthlyOnlyCost | null; failed: boolean;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="muted">
        {excluded ? (
          <>
            <span className="font-medium">{t("dashboard.dailyCost.lead", lang)}</span>{" "}
            {/* TWO WHOLE SENTENCES, not a translated fragment spliced into a
                shared frame. The commission clause sits inside a parenthesis
                in both languages but takes a different separator in each, so
                assembling it from pieces would put the punctuation in the
                wrong place in one of them. Each variant is written out in the
                dictionary and chosen whole. */}
            {fill(
              t(
                excluded.commissionNonTrip !== 0
                  ? "dashboard.dailyCost.bodyWithCommission"
                  : "dashboard.dailyCost.body",
                lang
              ),
              {
                total: formatSar(excluded.total),
                payroll: formatSar(excluded.payroll),
                commission: formatSar(excluded.commissionNonTrip),
              }
            )}
          </>
        ) : failed ? (
          t("dashboard.dailyCost.readFailed", lang)
        ) : (
          // Same two claims as the branch above, minus the figure it could not
          // read. What direct cost DOES include is not conditional on that read
          // succeeding, so it is stated here as well rather than silently
          // disappearing in the month with nothing excluded.
          t("dashboard.dailyCost.noneExcluded", lang)
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
function DriftBanner({ lang, drift }: { lang: Lang; drift: DriverStateDrift }) {
  if (drift.ok || !drift.reachable) return null;
  return (
    <div role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
      <p className="flex items-start gap-2 font-medium text-rose-700 dark:text-rose-300">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {fill(t("dashboard.drift.headline", lang), {
          n: drift.mismatches.length, checked: drift.checked,
        })}
      </p>
      <ul className="mt-1 space-y-0.5 ps-5 muted">
        {drift.mismatches.map((m) => (
          <li key={m.driverId}>
            <span className="font-medium">{m.name}</span>
            {" — "}
            {t("dashboard.drift.view", lang)}: {m.sql} · {t("dashboard.drift.app", lang)}: {m.ts}
          </li>
        ))}
      </ul>
      <p className="mt-1 muted">
        {t("dashboard.drift.fix", lang)}
      </p>
    </div>
  );
}

/**
 * The truck cell on a Drivers Ops row (0107).
 *
 * Resolves in the view, not here: assigned truck first, else the truck of the
 * driver's latest in-flight trip, with `truckSource` saying which. The UI's
 * only job is to not pass an inference off as an assignment, and to say WHY a
 * driver has no truck available when the reason is knowable.
 *
 * THE MAINTENANCE FLAG IS NOT KEYED OFF THE STATE, deliberately. Khalid 2 has
 * an ASSIGNED truck that is in the workshop and is `active`, because
 * assignment is what the state rule reads. Anything that only showed this for
 * off_duty rows would get that row wrong.
 *
 * "No truck" now means genuinely none — not "none, and we did not look".
 */
function DriverTruckCell({ lang, driver }: { lang: Lang; driver: DriverOps }) {
  if (!driver.truckPlate) {
    return (
      <span className="flex items-center gap-1">
        <TruckIcon className="h-3 w-3 shrink-0" aria-hidden />
        {t("dashboard.driverTruck.none", lang)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {driver.truckInMaintenance
        ? <Wrench className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        : <TruckIcon className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{driver.truckPlate}</span>
      {driver.truckInMaintenance && (
        <span className="shrink-0 text-amber-700 dark:text-amber-300">
          {t("dashboard.driverTruck.inMaintenance", lang)}
        </span>
      )}
      {/* An inferred plate is labelled as such. Without this the row would
          read as an assignment the driver does not have. */}
      {driver.truckSource === "trip" && (
        <span className="shrink-0 opacity-70">
          {t("dashboard.driverTruck.fromTrip", lang)}
        </span>
      )}
    </span>
  );
}

/** One legend for all six project cards — repeating it per card would be six
 *  copies of the same four words in a grid meant to read compactly. */
function StageLegend({ lang }: { lang: Lang }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {STAGE_BAR.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] muted">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
            style={{ background: s.color }} />
          {t(`dashboard.stage.${s.key}`, lang)}
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
function ProjectStageCard({ lang, project }: { lang: Lang; project: ProjectStages }) {
  const segments = STAGE_BAR
    .map((s) => ({ ...s, value: project[s.key] }))
    .filter((s) => s.value > 0);

  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{project.projectName}</span>
        <span className="shrink-0 text-xs tabular-nums muted">
          {project.total} {t(project.total === 1 ? "dashboard.projects.tripOne" : "dashboard.projects.tripMany", lang)}
        </span>
      </div>

      {project.total === 0 ? (
        <p className="mt-2 text-[11px] muted">{t("dashboard.projects.noTrips", lang)}</p>
      ) : (
        <>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={segments
              .map((s) => `${t(`dashboard.stage.${s.key}`, lang)}: ${s.value}`)
              .join(", ")}>
            {segments.map((s) => (
              <span key={s.key} title={`${t(`dashboard.stage.${s.key}`, lang)}: ${s.value}`}
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
                {project.inFlight} {t("dashboard.projects.inFlight", lang)}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Fleet-wide utilization for the month on screen.
 *
 * THE PERCENTAGE IS READ, NOT ASSEMBLED. v_fleet_utilization_monthly (0130)
 * publishes sum(worked_days)/sum(available_days) across the fleet. This card
 * never touches the per-truck view, because averaging per-truck percentages
 * weights a truck available 2 days identically to one available 31 — live
 * August, that is 45.86% blended against 38.40% averaged, and the second
 * number is simply wrong. The rule is enforced by which view is read.
 *
 * IT FOLLOWS THE MONTH STEPPER. Stepping back moves this figure with the two
 * charts above it; a "right now" number sitting beside a historical chart is
 * how two things on one screen come to disagree.
 *
 * THE CURRENT MONTH IS PARTIAL AND THE CARD SAYS SO. August is still running,
 * so its available days grow every day and the percentage moves — that is not
 * a defect, and labelling it "month to date" is the difference between a
 * reader trusting the number and reporting it as a bug.
 */
function FleetUtilizationCard({
  lang, row, month, failed,
}: {
  lang: Lang;
  row: FleetUtilizationRow | null;
  month: string | null;
  failed: boolean;
}) {
  const band = utilizationBand(row?.utilization_pct ?? null);
  const tone = UTILIZATION_BAND[band];
  // A failed read and an empty month are DIFFERENT and must not share a
  // rendering — the dashboard's own rule after it once printed "every queue is
  // clear" over an errored fetch.
  const unreadable = failed && !row;

  return (
    <ChartCard
      title={t("dashboard.utilization.title", lang)}
      sub={month
        ? `${monthTitle(month, lang)}${isCurrentMonth(month) ? t("dashboard.utilization.monthToDate", lang) : ""}`
        : t("dashboard.utilization.monthly", lang)}
      href="/fleet"
      empty={!row && !failed}
      failed={unreadable}
      lang={lang}
    >
      {row && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-semibold tabular-nums", tone.text)}>
              {formatUtilization(row.utilization_pct, lang)}
            </span>
            <span className={cn("text-xs font-medium", tone.text)}>
              {/* UTILIZATION_BAND is lib/utilization.ts — out of this batch's
                  scope, so its own pair is read here rather than moved. */}
              {lang === "ar" ? tone.ar : tone.en}
            </span>
          </div>

          {/* The band track. 60-80% is marked so the figure is read against the
              target rather than in isolation — a bare 45.9% says nothing about
              whether that is good. */}
          <div className="relative h-2 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
            <div
              className="absolute inset-y-0 bg-emerald-500/15"
              style={{ left: "60%", width: "20%" }}
              aria-hidden
            />
            <div
              className={cn("relative h-full rounded-full", tone.bar)}
              style={{ width: `${utilizationBarWidth(row.utilization_pct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] muted tabular-nums" aria-hidden>
            <span>0%</span><span>{t("dashboard.utilization.targetBand", lang)}</span><span>100%</span>
          </div>

          <dl className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div>
              <dt className="text-[10px] muted uppercase tracking-wide">{t("dashboard.utilization.worked", lang)}</dt>
              <dd className="text-sm font-medium tabular-nums">{row.worked_days}</dd>
            </div>
            <div>
              <dt className="text-[10px] muted uppercase tracking-wide">{t("dashboard.utilization.available", lang)}</dt>
              <dd className="text-sm font-medium tabular-nums">{row.available_days}</dd>
            </div>
            <div>
              <dt className="text-[10px] muted uppercase tracking-wide">{t("dashboard.utilization.trucks", lang)}</dt>
              <dd className="text-sm font-medium tabular-nums">{row.trucks_with_availability}</dd>
            </div>
          </dl>

          <p className="text-[11px] muted leading-relaxed">
            {t("dashboard.utilization.note", lang)}
          </p>
        </div>
      )}
    </ChartCard>
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
function CostCompositionChart({ lang, months }: { lang: Lang; months: CostComposition[] }) {
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {COST_TYPE.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5 text-[11px] muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
              style={{ background: c.color }} />
            {t(`dashboard.costType.${c.key}`, lang)}
          </li>
        ))}
      </ul>

      <div className="space-y-2.5">
        {months.map((m) => {
          const parts = COST_TYPE
            .map((c) => ({ ...c, ...m[c.key] }))
            .filter((c) => c.pct != null && c.pct > 0);
          const noCost = m.total === 0 || parts.length === 0;
          return (
            <div key={m.month}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-medium">{monthTitle(m.month, lang)}</span>
                <span className="flex items-baseline gap-2">
                  {/* The filling slice is money, so its unknown-cost count has
                      to be reachable here too, not only on the daily chart. */}
                  {m.fillingUncosted > 0 && (
                    <span className="text-amber-700 dark:text-amber-300"
                      title={fill(
                        t(m.fillingUncosted === 1
                          ? "dashboard.costComposition.uncostedTitleOne"
                          : "dashboard.costComposition.uncostedTitleMany", lang),
                        { n: m.fillingUncosted }
                      )}>
                      {fill(t("dashboard.costComposition.unpriced", lang), { n: m.fillingUncosted })}
                    </span>
                  )}
                  <span className="tabular-nums muted">{formatSar(m.total)}</span>
                </span>
              </div>
              {noCost ? (
                <div className="flex h-4 items-center rounded-md border border-dashed px-2 text-[10px] muted"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  {t("dashboard.costComposition.noCost", lang)}
                </div>
              ) : (
                <div className="flex h-4 w-full overflow-hidden rounded-md"
                  role="img"
                  aria-label={parts
                    .map((c) => `${t(`dashboard.costType.${c.key}`, lang)} ${c.pct}%`)
                    .join(", ")}>
                  {parts.map((c) => (
                    <span key={c.key}
                      className="flex items-center justify-center overflow-hidden text-[9px] font-medium text-white"
                      title={`${t(`dashboard.costType.${c.key}`, lang)}: ${c.pct}% · ${formatSar(c.sar)}`}
                      style={{ width: `${c.pct}%`, background: c.color }}>
                      {/* Only label a slice wide enough to hold the text — a
                          clipped "1%" is noise, and the title carries it. */}
                      {(c.pct ?? 0) >= 12 ? `${c.pct}%` : ""}
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
// The pill's WORDS are in the dictionary at `dashboard.compliance.<status>`,
// keyed by the same status this map is keyed by; only the colour is here.
// Likewise the driver's state name, at `dashboard.driverState.<state>`.
const DRIVER_STATE_DOT: Record<DriverOpsState, string> = {
  active:   "bg-emerald-500",
  idle:     "bg-brand-500",
  off_duty: "bg-slate-400",
  on_leave: "bg-amber-500",
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
  lang, rows, failed,
}: {
  lang: Lang; rows: DriverOps[]; failed: boolean;
}) {
  const sorted = useMemo(() => sortDriverOps(rows), [rows]);

  if (sorted.length === 0) {
    return (
      <Card>
        <p className="text-sm muted">
          {t(failed ? "dashboard.driversOps.readFailed" : "dashboard.driversOps.empty", lang)}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <ul className="divide-y divide-[rgb(var(--border))]">
        {sorted.map((d) => {
          return (
            <li key={d.driverId} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", DRIVER_STATE_DOT[d.state])} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  COMPLIANCE_PILL[d.compliance]
                )}>
                  {t(`dashboard.compliance.${d.compliance}`, lang)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs muted">
                <span>{t(`dashboard.driverState.${d.state}`, lang)}</span>
                <span aria-hidden>·</span>
                <DriverTruckCell lang={lang} driver={d} />
                {d.tripStage && (
                  <>
                    <span aria-hidden>·</span>
                    <PhasePill stage={d.tripStage} lang={lang} />
                    {d.inFlightTrips > 1 && <span className="tabular-nums">×{d.inFlightTrips}</span>}
                  </>
                )}
              </div>
              {d.conflicts && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  {t("dashboard.driversOps.conflict", lang)}
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
  lang, items,
}: {
  lang: Lang; items: { key: CostSliceKey; value: number; color: string }[];
}) {
  // THE SLICE TRAVELS AS A KEY, NOT AS A LABEL. app/page.tsx builds these rows
  // on the server, which has no language, so the name is looked up here at
  // render time from the same `dashboard.costType.<key>` the doughnut, the
  // Cost composition legend and its tooltips read. Adding a bucket therefore
  // cannot leave it showing its English name inside the Arabic legend — the
  // exact drift the previous English-keyed lookup produced for the Station
  // fill slice (0112).
  return (
    <ul className="mt-3 space-y-1.5">
      {items.map((c) => (
        <li key={c.key} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden
            style={{ background: c.color }} />
          <span className="min-w-0 flex-1 truncate">{t(`dashboard.costType.${c.key}`, lang)}</span>
          <span className="shrink-0 tabular-nums muted">{formatSar(c.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Says that some fills in the month on screen have no price, so direct cost is
 * short by an unknown amount.
 *
 * CONDITIONAL, like every other disclosure here — it appears only in a month
 * that actually has one. Live that is June (10) and July (3); August has none.
 * An unconditional warning is noise that trains the reader to skip it.
 *
 * The count is not decoration. sum() skips NULLs in the view, so the filling
 * figure inside direct cost is the total of what is KNOWN. Showing the money
 * without the count would show a total that is quietly wrong — the same
 * failure as rendering an unread figure as zero.
 */
function UncostedFillsNote({
  lang, uncosted, shortOf = "directCost",
}: {
  lang: Lang;
  uncosted: number;
  /**
   * WHICH FIGURE ON THIS CARD IS SHORT. The count is the same fact either way,
   * but naming the wrong figure would be a false statement about which number
   * the reader should distrust — so the caller says, rather than the note
   * assuming it is always the daily chart.
   */
  shortOf?: "directCost" | "fillSlice";
}) {
  if (uncosted <= 0) return null;
  const where = t(
    shortOf === "directCost"
      ? "dashboard.uncostedFills.fromDirectCost"
      : "dashboard.uncostedFills.fromFillSlice",
    lang
  );
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="muted">
        {/* WHOLE SENTENCES, one per plural case — not fragments spliced around
            the count. English inflects four times in this one sentence
            (fill/fills, has/have, its/their twice); Arabic inflects none of
            them and orders the clause differently. The AR/EN branch that used
            to wrap this block is gone with it: both languages now render the
            same two nodes, and the dictionary carries the difference. */}
        <span className="font-medium">
          {fill(t(uncosted === 1
            ? "dashboard.uncostedFills.boldOne"
            : "dashboard.uncostedFills.boldMany", lang), { n: uncosted })}
        </span>{" "}
        {fill(t(uncosted === 1
          ? "dashboard.uncostedFills.tailOne"
          : "dashboard.uncostedFills.tailMany", lang), { where })}
      </p>
    </div>
  );
}

/**
 * Says what this line IS, and qualifies it when some of the day's work could
 * not be priced.
 *
 * WHY IT STAYS NOW THAT THERE IS ONLY ONE REVENUE SERIES. The chart no longer
 * has two lines to tell apart, but it still plots a number that deliberately
 * does NOT match Reports — earned work, on the day the trip ran, invoiced or
 * not. Unlabelled, that is a figure someone will one day compare against the
 * P&L and file as a bug. The note names it as earned-not-billed, points at
 * where billed revenue actually lives, and states that it feeds no margin.
 *
 * THE UNPRICED NOTE IS CONDITIONAL on purpose. An unconditional disclaimer is
 * noise that trains the reader to skip it, so it appears only when a delivered
 * trip in the month on screen genuinely had no project and therefore no rate.
 * That trip contributes 0 rather than a guessed price, which is why the figure
 * needs qualifying rather than correcting.
 */
function DeliveredRevenueNote({ lang, unpricedTrips }: { lang: Lang; unpricedTrips: number }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <p className="muted">
        {/* The body was written across four source lines with `&apos;` and
            `&quot;` entities; JSX collapses that to one sentence with real
            apostrophes and quotes, which is exactly what the dictionary now
            holds. The unpriced clause below is again two whole sentences per
            language, never a spliced plural. */}
        <span className="font-medium">{t("dashboard.deliveredRevenue.lead", lang)}</span>{" "}
        {t("dashboard.deliveredRevenue.body", lang)}
        {unpricedTrips > 0 && (
          <>
            {" "}
            <span className="font-medium">
              {fill(t(unpricedTrips === 1
                ? "dashboard.deliveredRevenue.unpricedBoldOne"
                : "dashboard.deliveredRevenue.unpricedBoldMany", lang), { n: unpricedTrips })}
            </span>{" "}
            {t(unpricedTrips === 1
              ? "dashboard.deliveredRevenue.unpricedTailOne"
              : "dashboard.deliveredRevenue.unpricedTailMany", lang)}
          </>
        )}
      </p>
    </div>
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
  lang, noTruckTrips, deliveredTrips,
}: {
  lang: Lang; noTruckTrips: number; deliveredTrips: number;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[11px] leading-relaxed">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
      <p className="muted">
        {/* The only one of the four with a single plural case: the author wrote
            the no-truck clause in the many form and it renders only above zero,
            so there is no singular sentence to lift. It is still stored whole,
            for the same reason as its three siblings. */}
        <span className="font-medium">{t("dashboard.dispatchedCapacity.lead", lang)}</span>{" "}
        {t("dashboard.dispatchedCapacity.body", lang)}
        {noTruckTrips > 0 && (
          <>
            {" "}
            <span className="font-medium">
              {fill(t("dashboard.dispatchedCapacity.noTruckBold", lang), {
                n: noTruckTrips, total: deliveredTrips,
              })}
            </span>{" "}
            {t("dashboard.dispatchedCapacity.noTruckTail", lang)}
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
//
// The WORDS are the project bars' own, at `dashboard.stage.<key>`, so a stage
// cannot be named two different things on one page either. `TripStage` is
// snake_case and the dictionary key is camelCase, which is why each row
// carries its key rather than the lookup deriving one.
const PHASE_PILL: Record<TripStage, {
  key: "scheduled" | "loading" | "inTransit" | "delivered"; cls: string;
}> = {
  scheduled:  { key: "scheduled",
    cls: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300" },
  loading:    { key: "loading",
    cls: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300" },
  in_transit: { key: "inTransit",
    cls: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300" },
  delivered:  { key: "delivered",
    cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" },
};

function PhasePill({ stage, lang }: { stage: TripStage; lang: Lang }) {
  const p = PHASE_PILL[stage];
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", p.cls
    )}>
      {t(`dashboard.stage.${p.key}`, lang)}
    </span>
  );
}

function ActionCard({ row, lang }: { row: ActionItemRow; lang: Lang }) {
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
          {row.oldest_at && <> · {t("dashboard.actions.oldestPrefix", lang)}{relativeTime(row.oldest_at, lang)}</>}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 muted" aria-hidden />
    </Link>
  );
}

function FeedList({ rows, lang }: { rows: FeedRow[]; lang: "en" | "ar" }) {
  return (
    <ul className="divide-y divide-[rgb(var(--border))]">
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
function Modal({ title, onClose, lang, children }: {
  title: string; onClose: () => void; lang: Lang; children: React.ReactNode;
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
      <ScrollLock />
      <div className="card w-full max-w-[1080px] max-h-[85vh] overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close", lang)}
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
function Summaries({ options, lang, pickerOpen, setPickerOpen }: {
  options: WidgetDef[]; lang: Lang; pickerOpen: boolean; setPickerOpen: (v: boolean) => void;
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
          <h2 id="dash-summary" className="text-sm font-semibold">{t("dashboard.summaries.heading", lang)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {widgets.map((w) => {
              const def = widgetDef(w.key);
              const val = values[w.id];
              if (!def) return null;
              return (
                <Card key={w.id} className="relative">
                  <button type="button" onClick={() => persist(widgets.filter((x) => x.id !== w.id))}
                    aria-label={t("dashboard.summaries.remove", lang)}
                    className="focus-ring absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-md muted transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <Link href={def.href} className="focus-ring block rounded">
                    {/* The widget catalogue stays bilingual DATA in
                        lib/dashboard-widgets.ts, fenced beside the
                        report_metrics keys it names — out of this batch's
                        scope, so its pair is read here rather than moved. */}
                    <div className="text-xs muted uppercase tracking-wide pe-7">{lang === "ar" ? def.ar : def.en}</div>
                  </Link>
                  {val === undefined ? (
                    <div className="mt-2 text-sm muted">…</div>
                  ) : !val || !val.hasData ? (
                    <div className="mt-2 text-sm muted">{t("dashboard.summaries.noData", lang)}</div>
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
        <Modal title={t("dashboard.addSummary", lang)} onClose={() => setPickerOpen(false)} lang={lang}>
          <p className="mb-3 text-xs muted">
            {t("dashboard.summaries.pickerNote", lang)}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((o) => (
              <div key={o.key} className="flex items-center gap-2 rounded-lg border p-2"
                style={{ borderColor: "rgb(var(--border))" }}>
                <span className="min-w-0 flex-1 truncate text-sm">{lang === "ar" ? o.ar : o.en}</span>
                {o.displays.map((d) => (
                  <button key={d} type="button" onClick={() => add(o.key, d)}
                    className="focus-ring rounded-md border px-2 py-0.5 text-[11px] muted transition-colors hover:border-brand-500/40 hover:text-[rgb(var(--fg))]"
                    style={{ borderColor: "rgb(var(--border))" }}>
                    {t(d === "stat" ? "dashboard.summaries.displayStat" : "dashboard.summaries.displayBars", lang)}
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
              <span className="text-xs font-medium">{t("dashboard.summaries.nlTitle", lang)}</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[9px] uppercase tracking-wide muted dark:bg-white/10">
                {t("dashboard.summaries.comingSoon", lang)}
              </span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed muted">
              {t("dashboard.summaries.nlBody", lang)}
            </p>
            <input disabled placeholder={t("dashboard.summaries.nlPlaceholder", lang)}
              className="w-full cursor-not-allowed rounded-lg border px-3 py-2 text-sm opacity-60"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }} />
          </div>
        </Modal>
      )}
    </>
  );
}
