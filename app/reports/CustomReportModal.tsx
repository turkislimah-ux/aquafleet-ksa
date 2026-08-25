"use client";

// Reports — the CUSTOM REPORT BUILDER, plus the natural-language seam.
//
// TWO HALVES, and the relationship between them is the point.
//
// LEFT — a working structured builder. Pick metrics from the defined
// vocabulary, pick a grouping, pick a period, Generate. No SQL, no free text,
// no way to express something the semantic layer cannot answer correctly.
//
// RIGHT — a natural-language box, clearly marked as not yet wired. When it is
// switched on, its ONLY job is to turn a sentence into the same selections the
// builder already produces. It will not write SQL and will not gain its own
// data path, so there is nothing here to rework later — the builder is the
// execution engine either way, and it is already fenced.
//
// Enforcement lives in lib/report-builder.ts, not in this file: which
// groupings a metric supports, which column holds its number, and the rule
// that ratios recompute per row. This component only renders the choices that
// module says are legal.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Check, Info } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PERIOD_TYPES, periodsOf, type MetricDictionaryRow, type PeriodType, type PnlPeriodRow } from "@/lib/reports";
import {
  availableMetrics, allowedGroupings, metricId, GROUPING_LABELS,
  type Grouping, type BuilderSelection,
} from "@/lib/report-builder";
import ScrollLock from "@/components/ScrollLock";

const BASIS_STYLE: Record<string, string> = {
  accrual: "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20",
  cash: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  operational: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
};

export default function CustomReportModal({
  open, onClose, metrics, pnlPeriods, periodType, periodStart, onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  metrics: MetricDictionaryRow[];
  pnlPeriods: PnlPeriodRow[];
  periodType: PeriodType;
  periodStart: string | null;
  onGenerate: (selection: BuilderSelection) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const catalogue = useMemo(() => availableMetrics(metrics), [metrics]);
  const [picked, setPicked] = useState<string[]>([]);
  const [grouping, setGrouping] = useState<Grouping>("period");
  const [grain, setGrain] = useState<PeriodType>(periodType);
  const [start, setStart] = useState<string | null>(periodStart);
  const [nl, setNl] = useState("");

  // Re-sync the period from the tab each time the builder OPENS. Without this
  // the local state froze at whatever the tab showed when this component first
  // mounted — which is before the user has touched the period picker — so
  // opening the builder later offered a stale period and generated an empty
  // report. Caught by the by-customer test showing August while the tab was
  // on July.
  useEffect(() => {
    if (!open) return;
    setGrain(periodType);
    setStart(periodStart);
  }, [open, periodType, periodStart]);

  const selected = useMemo(
    () => catalogue.filter((m) => picked.includes(metricId(m))),
    [catalogue, picked],
  );

  // The grouping list narrows as metrics are picked — a combination the data
  // cannot support is never offered, rather than quietly returning zeroes.
  const groupings = useMemo(() => allowedGroupings(selected), [selected]);
  const activeGrouping = groupings.includes(grouping) ? grouping : groupings[0] ?? "period";

  const periods = useMemo(() => periodsOf(pnlPeriods, grain), [pnlPeriods, grain]);
  const activeStart = start && periods.some((p) => p.period_start === start)
    ? start : periods[0]?.period_start ?? null;

  // Blocks that would be dropped by the current grouping, shown as disabled
  // rather than hidden — a control that vanishes is harder to understand than
  // one that explains why it is unavailable.
  const offerable = useMemo(
    () => catalogue.map((m) => ({
      m,
      legal: m.groupings.includes(activeGrouping),
      on: picked.includes(metricId(m)),
    })),
    [catalogue, activeGrouping, picked],
  );

  function toggle(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  if (!open || !mounted) return null;

  const legalPicked = selected.filter((m) => m.groupings.includes(activeGrouping));
  const canGenerate = legalPicked.length > 0 &&
    (activeGrouping === "period" || activeStart !== null);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}>
      <ScrollLock />
      <div className="card w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">Custom report</h2>
            <p className="text-[11px] muted">
              Combine defined metrics into a table. Everything here reads the same views
              the rest of the page does, so it cannot disagree with them.
            </p>
          </div>
          <button onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] divide-y lg:divide-y-0 lg:divide-x"
          style={{ borderColor: "rgb(var(--border))" }}>

          {/* ---- The builder ------------------------------------------- */}
          <div className="p-4 space-y-4">
            <div>
              <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
                1 · Group rows by
              </h3>
              <div className="flex items-center gap-1 flex-wrap">
                {(["period", "customer", "truck"] as Grouping[]).map((g) => {
                  const allowed = groupings.includes(g);
                  return (
                    <button
                      key={g}
                      onClick={() => allowed && setGrouping(g)}
                      disabled={!allowed}
                      title={allowed ? undefined : "The metrics you picked cannot be grouped this way"}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition",
                        activeGrouping === g
                          ? "border-brand-600 text-brand-600 dark:text-brand-300 bg-brand-500/10"
                          : allowed
                            ? "border-transparent muted hover:text-[rgb(var(--fg))]"
                            : "border-transparent muted opacity-40 cursor-not-allowed",
                      )}
                    >
                      {GROUPING_LABELS[g]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
                2 · Columns
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {offerable.map(({ m, legal, on }) => {
                  const id = metricId(m);
                  return (
                    <button
                      key={id}
                      onClick={() => legal && toggle(id)}
                      disabled={!legal}
                      title={legal ? undefined : `Not available ${GROUPING_LABELS[activeGrouping].toLowerCase()}`}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-sm transition",
                        on && legal
                          ? "border-brand-600 bg-brand-500/10"
                          : legal
                            ? "hover:bg-black/5 dark:hover:bg-white/5"
                            : "opacity-40 cursor-not-allowed",
                      )}
                      style={{ borderColor: on && legal ? undefined : "rgb(var(--border))" }}
                    >
                      <span className={cn(
                        "h-4 w-4 rounded border grid place-items-center shrink-0",
                        on && legal ? "bg-brand-600 border-brand-600" : "",
                      )} style={{ borderColor: on && legal ? undefined : "rgb(var(--border))" }}>
                        {on && legal && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{m.label}</span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset shrink-0",
                        BASIS_STYLE[m.basis],
                      )}>
                        {m.basis}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
                3 · Period
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 rounded-lg border p-1"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  {PERIOD_TYPES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => { setGrain(t.key); setStart(null); }}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium transition",
                        grain === t.key ? "bg-brand-600 text-white" : "muted hover:text-[rgb(var(--fg))]",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <select
                  value={activeStart ?? ""}
                  onChange={(e) => setStart(e.target.value)}
                  disabled={activeGrouping === "period"}
                  className="px-3 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-40"
                  style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                >
                  {periods.map((p) => (
                    <option key={p.period_start} value={p.period_start}>{p.label}</option>
                  ))}
                </select>
              </div>
              {activeGrouping === "period" && (
                <p className="text-[11px] muted mt-1.5">
                  A by-period report lists every {grain} as a row, so it is not filtered to one.
                </p>
              )}
            </div>

            {selected.length > 0 && new Set(legalPicked.map((m) => m.basis)).size > 1 && (
              <div className="flex gap-2 text-[11px] muted leading-relaxed">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                <p>
                  You have mixed bases selected. They will appear as separate columns and
                  are never added together — accrual and cash answer different questions.
                </p>
              </div>
            )}
          </div>

          {/* ---- The seam ---------------------------------------------- */}
          <div className="p-4 bg-black/[0.015] dark:bg-white/[0.015]">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-brand-600 dark:text-brand-300" />
              <h3 className="text-sm font-medium">Ask in plain language</h3>
            </div>
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset
                             bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20 mb-2">
              Coming soon
            </span>
            <textarea
              value={nl}
              onChange={(e) => setNl(e.target.value)}
              rows={5}
              placeholder="e.g. Revenue and outstanding for each customer last quarter"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 resize-y"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            />
            <span title="Natural-language reports are not wired up yet">
              <Btn variant="outline" className="w-full mt-2" disabled>
                <Sparkles className="h-4 w-4" />Interpret
              </Btn>
            </span>
            <p className="text-[11px] muted mt-2 leading-relaxed">
              Not wired up — nothing typed here is sent anywhere. When it is switched on,
              its only job will be to fill in the builder on the left. It will never write
              its own query, so a generated report can only ever say what the builder can
              already say correctly.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="text-[11px] muted">
            {legalPicked.length === 0
              ? "Pick at least one column."
              : `${legalPicked.length} column${legalPicked.length === 1 ? "" : "s"} · ${GROUPING_LABELS[activeGrouping].toLowerCase()}`}
          </span>
          <div className="flex items-center gap-2">
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={!canGenerate}
              onClick={() => onGenerate({
                metricIds: legalPicked.map(metricId),
                grouping: activeGrouping,
                periodType: grain,
                periodStart: activeStart,
              })}
            >
              Generate
            </Btn>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
