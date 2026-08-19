"use client";

// Deliveries report band — the Today / Last 7 / Last 30 / Last 90 strip that
// sits on top of every project Kanban card (ProjectsBoard's "block B") and,
// since this extraction, below the Operational KPIs in BreakdownReport.
//
// LEAF MODULE ON PURPOSE. It imports nothing from either caller — only
// lib/utils and lucide-react — so ProjectsBoard and BreakdownReport both import
// it one way and no cycle can form. (Inventory Phase 4's lesson: tsc does NOT
// catch a sibling cycle, but Next's dev module system resolves it to `undefined`
// at request time and blanks the page. SharedCreateModals.tsx / lib/cost-colors.ts
// are the same shape.)
//
// DATE BASIS — trip_date, with delivered_at as a PREDICATE, NOT a bucket.
// A trip counts as delivered when delivered_at is set, but it lands in the
// window of its trip_date. This CHANGES the Kanban band, which used to bucket on
// delivered_at's own date. delivered_at records when the stage button was
// PRESSED, and this fleet advances trips on the Kanban in bulk — all-time, 22
// distinct days by delivered_at against 35 by trip_date, one afternoon holding
// 310 trips. Migration 0109 re-based the Dashboard's delivered-revenue view onto
// trip_date for exactly that reason, and BreakdownReport's own header states the
// same reversal for every figure in that report. A band bucketed on delivered_at
// would sit directly under Operational KPIs bucketed on trip_date and contradict
// them. Sharing one basis is the point of extracting this; a `basis` parameter
// would just put the drift back behind a flag.
//
// PRICE BASIS — trips.rate_sar, falling back to the project's current rate.
// This band prices DELIVERED work, so it joins the four-surface invariant
// (prepaid consumption, invoice lines, v_delivered_revenue_daily, CustomersTab's
// Revenue KPI): anything reaching for projects.rate_per_trip_sar to price work
// already done has reintroduced the defect the frozen rate exists to prevent.
// The fallback is the project rate and NEVER 0 — if a trip somehow arrives
// unstamped, the figure degrades to the OLD basis rather than to billing nothing
// (commit d0813b9's rule). Landing it now is a provable no-op: 0128 verified no
// rate has ever moved and backfilled 816/817 trips.

import { History } from "lucide-react";
import { addDaysToKey, formatSar } from "@/lib/utils";

// The subset of a trip row this band reads. Both callers pass full trip rows,
// so this stays a structural subset rather than a shared row type.
export type DeliveriesReportTrip = {
  trip_date: string | null;
  delivered_at: string | null;
  rate_sar: number | null;
};

export type DeliveriesReportWindow = { label: string; count: number; sar: number };

// days = the window's total length INCLUDING today, so "Today" is 1.
const WINDOWS: readonly { label: string; days: number }[] = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

export const EMPTY_DELIVERIES_REPORT: DeliveriesReportWindow[] = WINDOWS.map((w) => ({
  label: w.label,
  count: 0,
  sar: 0,
}));

/**
 * Count + price the delivered trips falling in each window.
 *
 * `todayKey` anchors every window — the caller passes the CURRENT day, never a
 * selected day or month, so the band reads the same on both surfaces.
 * `fallbackRateSar` is the project's current rate; see the PRICE BASIS note.
 *
 * Window bounds are YYYY-MM-DD keys, so a lexicographic compare IS a
 * chronological one.
 */
export function buildDeliveriesReport(
  trips: readonly DeliveriesReportTrip[],
  todayKey: string,
  fallbackRateSar: number,
): DeliveriesReportWindow[] {
  const bounds = WINDOWS.map((w) => addDaysToKey(todayKey, -(w.days - 1)));
  const out = WINDOWS.map((w) => ({ label: w.label, count: 0, sar: 0 }));
  for (const t of trips) {
    // delivered_at is the PREDICATE; trip_date is the bucket. A trip missing
    // either is not placeable and is skipped rather than guessed at.
    if (!t.delivered_at || !t.trip_date) continue;
    const dk = t.trip_date;
    if (dk > todayKey) continue; // future-dated trip — outside every window
    const sar = t.rate_sar ?? fallbackRateSar;
    for (let i = 0; i < out.length; i++) {
      if (dk >= bounds[i]) {
        out[i].count += 1;
        out[i].sar += sar;
      }
    }
  }
  return out;
}

export default function DeliveriesReportBand({
  windows,
  className = "",
  hint,
}: {
  windows: DeliveriesReportWindow[];
  /** Spacing/print classes from the host — the band owns its own border/fill. */
  className?: string;
  /**
   * Optional second line under the label. BreakdownReport uses it to say the
   * band is anchored to today, since it sits under a month-scoped heading there.
   */
  hint?: string;
}) {
  return (
    <div
      className={`rounded-lg border grid grid-cols-2 md:grid-cols-[auto_repeat(4,minmax(0,1fr))] items-center gap-y-2 px-3 py-2 ${className}`}
      style={{ borderColor: "rgb(var(--border))", background: "rgba(11,126,234,0.03)" }}
    >
      <div className="col-span-2 md:col-span-1 pe-3">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold muted">
          <History className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
          Deliveries report
        </div>
        {hint && <div className="text-[10px] muted mt-0.5 ms-[22px]">{hint}</div>}
      </div>
      {windows.map((w) => (
        <div
          key={w.label}
          className="flex flex-col items-start gap-0.5 px-3 border-s"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <span className="text-[10px] uppercase tracking-wide font-semibold muted">{w.label}</span>
          <span className="text-lg font-bold tabular-nums leading-none">{w.count}</span>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatSar(w.sar)}
          </span>
        </div>
      ))}
    </div>
  );
}
