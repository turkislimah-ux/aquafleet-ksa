"use client";

// Reports — the METRICS DICTIONARY, as a popup.
//
// THE SEMANTIC LAYER, READ RATHER THAN COUNTED. Every figure on the Overview
// tab comes from a view whose meaning is defined once, in SQL (report_metrics,
// migration 0098, extended by 0123/0124). This modal renders that table — it
// computes nothing, and it is the only place in the app where the DESCRIPTION
// columns (meaning / formula / grain / source_view / basis / caveat) are shown
// at all. They were fetched and threaded through two components for a year and
// rendered nowhere, which is the exact failure mode CLAUDE.md §7 records for
// DailyOps.revenue: a column nothing displays is a column nobody can check.
//
// IT SHIPPED AS A SECTION AT THE BOTTOM OF OVERVIEW AND WAS MOVED HERE
// (Turki's call). Recorded so the next reader does not "restore" it inline:
// 30 metrics is a long read, and parking it under the charts meant scrolling
// past the whole tab to reach a reference you consult mid-thought. A popup is
// reachable from the header at any scroll position and costs the tab no space.
//
// LAYOUT IS STACKED, NOT A GRID TABLE, and that is a measurement not a taste:
// live max lengths are caveat 785 chars, formula 208, source_view 169, meaning
// 113. Six columns of that in one row would either overflow or shrink every
// cell to a sliver. Each metric is its own block; the label/value pairs use
// `minmax(0,1fr)` on the value track — a plain `1fr` refuses to shrink below
// its content, which is what lets a long unbroken pointer like
// "v_payroll_monthly (…) · v_pnl_by_period.payroll_sar (…)" push past its
// container instead of wrapping. The two-column entry grid below `xl` halves
// the available width, so that rule is load-bearing here, not belt-and-braces.
//
// A NULL caveat renders NOTHING — no dash, no "N/A". 3 of the 30 rows have no
// caveat (operating_profit, operations, os_cost); those metrics carry no
// warning, which is a different claim from a warning we failed to load. Same
// rule as the compliance pills: absent never renders as a value.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatNum } from "@/lib/utils";
import type { MetricDictionaryRow } from "@/lib/reports";
import { Disclosure, EmptyNote } from "./OverviewTab";
import ScrollLock from "@/components/ScrollLock";

/** Reading order — money first, then position, then activity. */
const BASIS_ORDER = ["accrual", "cash", "state", "operational"];

/**
 * What a basis MEANS, beside the group it labels. This is the distinction the
 * report builder is built to protect (migration 0100): accrual and cash measure
 * the same riyal at two different moments, so adding them double-counts. Saying
 * so once here beats hoping the reader knows.
 */
const BASIS_NOTE: Record<string, string> = {
  accrual: "Earned or incurred in the period — whether or not the money has moved yet.",
  cash: "Money that actually moved in the period. Never added to an accrual figure: a commission payout's base IS the trip commission the accrual side already counted.",
  state: "A position as of now, not a total for a period. A state figure does not belong in a period column.",
  operational: "Counts and activity rather than money.",
};

export default function MetricsGlossaryModal({
  open, onClose, metrics,
}: {
  open: boolean;
  onClose: () => void;
  metrics: MetricDictionaryRow[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [q, setQ] = useState("");

  // Esc closes. This modal is a reference the reader dips into and out of, so
  // the cheapest possible exit matters more here than on a form.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Grouped by basis. An unrecognised basis still renders — it sorts after the
  // four known ones rather than being dropped, so a metric added by a future
  // migration appears here without this file being touched.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? metrics.filter((m) =>
          `${m.label} ${m.metric_key} ${m.meaning} ${m.source_view}`.toLowerCase().includes(needle))
      : metrics;

    const by = new Map<string, MetricDictionaryRow[]>();
    for (const m of matched) {
      const arr = by.get(m.basis) ?? [];
      arr.push(m);
      by.set(m.basis, arr);
    }
    const rank = (b: string) => {
      const i = BASIS_ORDER.indexOf(b);
      return i === -1 ? BASIS_ORDER.length : i;
    };
    return Array.from(by.entries())
      .map(([basis, rows]) => ({
        basis,
        rows: rows.slice().sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => rank(a.basis) - rank(b.basis) || a.basis.localeCompare(b.basis));
  }, [metrics, q]);

  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}>
      <ScrollLock />
      <div className="card w-full max-w-[1200px] max-h-[92vh] flex flex-col p-0"
        role="dialog" aria-modal="true" aria-label="Metrics dictionary"
        onClick={(e) => e.stopPropagation()}>

        {/* Header stays put while the list scrolls — the filter is the control
            you reach for after you have already scrolled past something. */}
        <div className="flex items-start justify-between gap-4 p-4 border-b shrink-0"
          style={{ borderColor: "rgb(var(--border))" }}>
          <div className="min-w-0">
            <h2 className="font-semibold">Metrics dictionary</h2>
            <p className="text-[11px] muted leading-relaxed mt-0.5">
              Every number on this page is defined once, in SQL — this is that
              definition, read straight from <code className="font-mono">report_metrics</code>.
              It is also the vocabulary the custom-report builder is fenced to: a
              metric it cannot offer is a metric that is not listed here.{" "}
              <span className="tabular-nums">
                {q.trim()
                  ? `${formatNum(shown)} of ${formatNum(metrics.length)} shown.`
                  : `${formatNum(metrics.length)} metrics.`}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter metrics"
              aria-label="Filter metrics"
              className="w-40 sm:w-56 rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-brand-500/40"
              style={{ borderColor: "rgb(var(--border))" }}
            />
            <button onClick={onClose} aria-label="Close"
              className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto scrollbar-thin">
          {metrics.length === 0 ? (
            // A failed read is not an empty dictionary. Same rule as the
            // Dashboard's queues — "nothing there" and "could not read" are
            // different claims and must never share a message.
            <EmptyNote>The dictionary could not be read.</EmptyNote>
          ) : shown === 0 ? (
            <EmptyNote>No metric matches “{q.trim()}”.</EmptyNote>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <div key={g.basis}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide">{g.basis}</h4>
                    <span className="text-[11px] muted tabular-nums">
                      {formatNum(g.rows.length)}
                    </span>
                  </div>
                  {BASIS_NOTE[g.basis] && (
                    <p className="mt-0.5 text-[11px] muted leading-relaxed">{BASIS_NOTE[g.basis]}</p>
                  )}
                  <div className="mt-2 grid gap-x-8 xl:grid-cols-2">
                    {g.rows.map((m) => (
                      <MetricEntry key={m.metric_key} m={m} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MetricEntry({ m }: { m: MetricDictionaryRow }) {
  return (
    <div className="py-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{m.label}</span>
        <code className="font-mono text-[11px] muted break-all">{m.metric_key}</code>
        <span className="ml-auto text-[11px] muted uppercase tracking-wide shrink-0">{m.unit}</span>
      </div>

      <p className="mt-1 text-sm leading-relaxed">{m.meaning}</p>

      {/* `minmax(0,1fr)` on the value track — see the note above; a bare `1fr`
          is what lets a long source_view pointer overflow instead of wrap. */}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <dt className="muted uppercase tracking-wide">Formula</dt>
        <dd className="min-w-0 break-words font-mono">{m.formula}</dd>

        <dt className="muted uppercase tracking-wide">Grain</dt>
        <dd className="min-w-0 break-words">{m.grain}</dd>

        <dt className="muted uppercase tracking-wide">Source view</dt>
        <dd className="min-w-0 break-words font-mono">{m.source_view}</dd>
      </dl>

      {/* No caveat means no warning — never a dash, never "N/A". */}
      {m.caveat && <Disclosure>{m.caveat}</Disclosure>}
    </div>
  );
}
