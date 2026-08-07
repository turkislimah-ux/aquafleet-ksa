"use client";

// Reports — Tab 2, the management pack.
//
// TABLES, NOT CHARTS. These are statements you print, sign and file. Charts
// belong on the Overview.
//
// Six statements, one visible at a time: P&L, Revenue, Receivables, Costs,
// Operations and the computed Narrative. Showing one at a time is what makes
// "Print" mean "print THIS statement" — each statement owns a print id, and
// only the mounted one exists in the DOM when the print stylesheet runs.
//
// This file owns the P&L and the period controls; the other five live in
// StatementViews.tsx, a leaf module it imports one-way.
//
// READS v_pnl_by_period AND v_expenses_by_category_period, NOTHING ELSE. Both
// carry all three grains (0100), so switching between monthly, quarterly and
// yearly changes which rows are selected — it never changes how a figure is
// computed. That is the point: the margin for a quarter is recomputed in SQL
// from that quarter's own revenue, because averaging monthly margins flips the
// sign on live data (Q3 2026 is -38.7% correctly, +20.5% if averaged).
//
// The only arithmetic here is variance between two periods — comparing two
// figures the view produced, which is what lib/reports.ts delta() does
// everywhere else on this page.

import { useMemo, useState } from "react";
import { Printer, Pencil, Info, Sparkles } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import {
  periodsOf, priorPeriodStart, isPeriodInProgress, delta, formatPct, formatShare,
  PERIOD_TYPES, monthsIn, sumOver, peakOver, buildNarrative,
  type PeriodType, type PnlPeriodRow, type ExpenseCategoryPeriodRow, type Delta,
  type RevenueInvoiceRow, type SalesReturnRow, type ReceivableRow, type AgingRow,
  type MaintenancePerTruckRow, type PurchasingRow, type PayrollRow,
  type CommissionsRow, type CommissionsPaidRow, type OperationsRow,
  type CollectionsRow, type MetricDictionaryRow, type RevenuePerTruckRow,
  type OperationsByDriverRow,
} from "@/lib/reports";
import {
  RevenueStatement, ReceivablesStatement, CostStatement,
  OperationsStatement, NarrativeStatement, CustomStatement,
} from "./StatementViews";
import { buildReport, GROUPING_LABELS, type BuilderSelection } from "@/lib/report-builder";
import CustomReportModal from "./CustomReportModal";

// One statement at a time. That keeps each print id the ONLY print subtree in
// the DOM, so "Print" prints the statement you are looking at rather than the
// whole pack — and it keeps a long tab from becoming a scroll marathon.
type Statement = "pnl" | "revenue" | "receivables" | "cost" | "operations" | "narrative" | "custom";

const STATEMENTS: { key: Statement; label: string }[] = [
  { key: "pnl", label: "P&L" },
  { key: "revenue", label: "Revenue" },
  { key: "receivables", label: "Receivables" },
  { key: "cost", label: "Costs" },
  { key: "operations", label: "Operations" },
  { key: "narrative", label: "Narrative" },
];

type Props = {
  pnlPeriods: PnlPeriodRow[];
  expenseCategories: ExpenseCategoryPeriodRow[];
  invoices: RevenueInvoiceRow[];
  salesReturns: SalesReturnRow[];
  receivables: ReceivableRow[];
  aging: AgingRow[];
  maintPerTruck: MaintenancePerTruckRow[];
  purchasing: PurchasingRow[];
  payroll: PayrollRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
  operations: OperationsRow[];
  collections: CollectionsRow[];
  metrics: MetricDictionaryRow[];
  perTruck: RevenuePerTruckRow[];
  opsByDriver: OperationsByDriverRow[];
  today: string;
  onManageExpenses: () => void;
};

export default function StatementsTab({
  pnlPeriods, expenseCategories, invoices, salesReturns, receivables, aging,
  maintPerTruck, purchasing, payroll, commissions, commissionsPaid, operations,
  collections, metrics, perTruck, opsByDriver, today, onManageExpenses,
}: Props) {
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [statement, setStatement] = useState<Statement>("pnl");
  const [customOpen, setCustomOpen] = useState(false);
  // The builder's output lives here, not in the modal: the result is a
  // statement like any other, so it gets its own print id and print button.
  const [customSpec, setCustomSpec] = useState<BuilderSelection | null>(null);

  const periods = useMemo(() => periodsOf(pnlPeriods, periodType), [pnlPeriods, periodType]);
  const [start, setStart] = useState<string | null>(null);
  const activeStart = start && periods.some((p) => p.period_start === start)
    ? start
    : periods[0]?.period_start ?? null;

  const current = periods.find((p) => p.period_start === activeStart) ?? null;
  const priorStart = activeStart ? priorPeriodStart(pnlPeriods, periodType, activeStart) : null;
  const prior = periods.find((p) => p.period_start === priorStart) ?? null;

  const categories = useMemo(
    () => expenseCategories
      .filter((e) => e.period_type === periodType && e.period_start === activeStart)
      .sort((a, b) => b.expenses_sar - a.expenses_sar),
    [expenseCategories, periodType, activeStart],
  );

  if (!current) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm font-medium">Nothing to report yet</div>
        <p className="text-sm muted mt-1">
          Periods appear once there is activity to summarise.
        </p>
      </div>
    );
  }

  const inProgress = isPeriodInProgress(current.period_end, today);
  const monthsCovered = monthsIn(operations, current.period_start, current.period_end);
  const multiMonth = monthsCovered.length > 1;

  // Narrative inputs. Every one is a selection or an additive sum over view
  // output — no ratio and no distinct count is computed here (see the rule in
  // lib/reports.ts). The margin quoted in the narrative comes from the view.
  const narrative = (() => {
    const col = monthsIn(collections, current.period_start, current.period_end);
    const openTotal = sumOver(receivables, (r) => r.outstanding_sar);
    const oldest = receivables.length
      ? Math.max(...receivables.map((r) => r.days_outstanding))
      : null;
    const returned = sumOver(
      salesReturns.filter((r) => r.month >= current.period_start && r.month <= current.period_end),
      (r) => r.reversed_revenue_sar,
    );
    const byCustomer = new Map<string, { name: string; revenue: number }>();
    for (const i of invoices) {
      if (i.month < current.period_start || i.month > current.period_end) continue;
      const e = byCustomer.get(i.customer_id) ?? { name: i.customer_name, revenue: 0 };
      e.revenue += i.revenue_sar;
      byCustomer.set(i.customer_id, e);
    }
    const top = [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

    return buildNarrative({
      current, prior, inProgress,
      collected: sumOver(col, (r) => r.collected_gross_sar),
      outstanding: openTotal,
      oldestDays: oldest,
      trips: sumOver(monthsCovered, (r) => r.trips_total),
      delivered: sumOver(monthsCovered, (r) => r.trips_delivered),
      peakTrucks: peakOver(monthsCovered, (r) => r.trucks_active),
      workOrders: sumOver(monthsCovered, (r) => r.work_orders),
      salesReturns: returned,
      topCustomer: top,
    });
  })();

  return (
    <div className="space-y-4">
      {/* ---- Controls. Excluded from print. ---------------------------- */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-1 rounded-lg border p-1"
          style={{ borderColor: "rgb(var(--border))" }}>
          {PERIOD_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => { setPeriodType(t.key); setStart(null); }}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition",
                periodType === t.key
                  ? "bg-brand-600 text-white"
                  : "muted hover:text-[rgb(var(--fg))]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={activeStart ?? ""}
          onChange={(e) => setStart(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        >
          {periods.map((p) => (
            <option key={p.period_start} value={p.period_start}>{p.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <Btn variant="outline" onClick={onManageExpenses}>
            <Pencil className="h-4 w-4" />Manage expenses
          </Btn>
          <Btn variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />Print
          </Btn>
        </div>
      </div>

      {/* ---- Which statement. Excluded from print. --------------------- */}
      <div className="flex items-center gap-1 flex-wrap no-print">
        {[...STATEMENTS, ...(customSpec ? [{ key: "custom" as Statement, label: "Custom" }] : [])].map((st) => (
          <button
            key={st.key}
            onClick={() => setStatement(st.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition border",
              statement === st.key
                ? "border-brand-600 text-brand-600 dark:text-brand-300 bg-brand-500/10"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {st.label}
          </button>
        ))}

        {/* The seam for AI-generated reports. Sits with the statements because
            that is what it will eventually produce — one more statement. */}
        <button
          onClick={() => setCustomOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition
                     border-transparent text-brand-600 dark:text-brand-300 hover:bg-brand-500/10"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Custom report
        </button>
      </div>

      {/* ---- The statement. This subtree is what prints. --------------- */}
      {statement === "pnl" && (
      <div id="pnl-print" className="card p-6">
        <header className="mb-5">
          <h2 className="text-lg font-semibold">Profit &amp; Loss</h2>
          <p className="text-sm muted">
            {current.label}
            {prior && <> · compared with {prior.label}</>}
          </p>
          {inProgress && (
            <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">
              This period is still in progress — costs accrue daily, while revenue is
              recognised when invoices are confirmed.
            </p>
          )}
        </header>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "rgb(var(--border))" }}>
              <th className="text-left font-medium muted pb-2">&nbsp;</th>
              <th className="text-right font-medium muted pb-2 w-[150px]">{current.label}</th>
              <th className="text-right font-medium muted pb-2 w-[150px]">{prior?.label ?? "—"}</th>
              <th className="text-right font-medium muted pb-2 w-[130px]">Variance</th>
              <th className="text-right font-medium muted pb-2 w-[90px]">%</th>
            </tr>
          </thead>

          <tbody>
            <Line label="Revenue" cur={current.revenue_sar} pri={prior?.revenue_sar}
              higherIsBetter bold />

            <SectionHead>Cost of operations</SectionHead>
            <Line label="Parts consumed" cur={current.parts_cost_sar} pri={prior?.parts_cost_sar} indent />
            <Line label="Outsourced repairs" cur={current.os_cost_sar} pri={prior?.os_cost_sar} indent />
            <Line label="Payroll" cur={current.payroll_sar} pri={prior?.payroll_sar} indent />
            <Line label="Commissions" cur={current.commissions_sar} pri={prior?.commissions_sar} indent />
            <Line label="Total operating cost" cur={current.operating_cost_sar}
              pri={prior?.operating_cost_sar} bold rule />

            <Line label="Operating profit" cur={current.operating_profit_sar}
              pri={prior?.operating_profit_sar} higherIsBetter bold rule signed />
            <MarginLine cur={current.operating_margin_pct} pri={prior?.operating_margin_pct ?? null} />

            {/* Expenses are their OWN section, never folded into the four
                operational buckets. That separation is a rule from 0098, not a
                layout preference — merging them would hide which costs the app
                actually models and which were typed in by hand. */}
            <SectionHead>Other expenses (recorded manually)</SectionHead>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2 pl-4 muted text-xs">
                  None recorded for this period — net profit therefore equals operating profit.
                </td>
              </tr>
            ) : (
              categories.map((c) => (
                <tr key={c.category}>
                  <td className="py-1.5 pl-4">{c.category}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatSar(c.expenses_sar)}</td>
                  <td className="py-1.5 text-right tabular-nums muted">—</td>
                  <td className="py-1.5 text-right tabular-nums muted">—</td>
                  <td className="py-1.5 text-right tabular-nums muted">—</td>
                </tr>
              ))
            )}
            <Line label="Total other expenses" cur={current.expenses_sar}
              pri={prior?.expenses_sar} bold rule />

            <Line label="Net profit" cur={current.net_profit_sar} pri={prior?.net_profit_sar}
              higherIsBetter bold rule signed />
          </tbody>
        </table>

        <footer className="mt-5 pt-3 border-t text-[11px] muted leading-relaxed"
          style={{ borderColor: "rgb(var(--border))" }}>
          <p>
            Revenue is confirmed invoices net of VAT. Parts are costed FIFO at the moment
            they leave stock — stock purchases are not a cost here, they become one when
            consumed. Payroll applies current salaries to whoever was employed in the
            period, as salaries are not effective-dated. Margin is computed from this
            period&apos;s own revenue, never averaged from its months.
          </p>
        </footer>
      </div>
      )}

      {statement === "revenue" && (
        <RevenueStatement
          invoices={invoices} returns={salesReturns}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={current.label}
        />
      )}

      {statement === "receivables" && (
        <ReceivablesStatement receivables={receivables} aging={aging} />
      )}

      {statement === "cost" && (
        <CostStatement
          maintPerTruck={maintPerTruck} purchasing={purchasing} payroll={payroll}
          commissions={commissions} commissionsPaid={commissionsPaid}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={current.label}
        />
      )}

      {statement === "operations" && (
        <OperationsStatement
          operations={operations}
          byDriver={opsByDriver}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={current.label} multiMonth={multiMonth}
        />
      )}

      {statement === "narrative" && (
        <NarrativeStatement bullets={narrative} label={current.label} pnl={current} />
      )}

      {statement === "custom" && customSpec && (
        <CustomStatement
          report={buildReport(customSpec, {
            pnlPeriods, collections, purchasing, operations,
            invoices, perTruck, maintPerTruck,
          }, metrics)}
          title={customTitle(customSpec, pnlPeriods)}
          onEdit={() => setCustomOpen(true)}
        />
      )}

      {statement === "pnl" && (
      <div className="flex gap-2 text-[11px] muted no-print">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <p>
          Prior-period columns show the immediately preceding {periodType}. Per-category
          expenses are listed for the current period only — the comparison is made on the
          section total, since categories come and go between periods.
        </p>
      </div>
      )}

      <CustomReportModal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        metrics={metrics}
        pnlPeriods={pnlPeriods}
        periodType={periodType}
        periodStart={activeStart}
        onGenerate={(spec) => {
          setCustomSpec(spec);
          setStatement("custom");
          setCustomOpen(false);
        }}
      />
    </div>
  );
}

/** A one-line description of what the generated report is showing. */
function customTitle(spec: BuilderSelection, periods: PnlPeriodRow[]): string {
  const g = GROUPING_LABELS[spec.grouping].toLowerCase();
  if (spec.grouping === "period") return `${g} · every ${spec.periodType}`;
  const p = periods.find((x) => x.period_type === spec.periodType && x.period_start === spec.periodStart);
  return `${g} · ${p?.label ?? "—"}`;
}

// --- Rows ------------------------------------------------------------------

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={5} className="pt-4 pb-1 text-xs uppercase tracking-wide muted font-medium">
        {children}
      </td>
    </tr>
  );
}

/**
 * One statement line with its variance.
 *
 * `higherIsBetter` is per-line because direction is metric-specific: revenue
 * rising is good, payroll rising is not. Cost lines default to false.
 */
function Line({
  label, cur, pri, higherIsBetter = false, bold, indent, rule, signed,
}: {
  label: string; cur: number; pri?: number;
  higherIsBetter?: boolean; bold?: boolean; indent?: boolean; rule?: boolean; signed?: boolean;
}) {
  const hasPrior = pri !== undefined;
  const d: Delta | null = hasPrior ? delta(cur, pri) : null;
  const tone = d && d.dir !== "flat"
    ? ((d.dir === "up") === higherIsBetter ? "ok" : "bad")
    : undefined;

  return (
    <tr className={cn(rule && "border-t")} style={rule ? { borderColor: "rgb(var(--border))" } : undefined}>
      <td className={cn("py-1.5", indent && "pl-4", bold && "font-semibold")}>{label}</td>
      <td className={cn("py-1.5 text-right tabular-nums", bold && "font-semibold",
        signed && cur < 0 && "text-rose-600 dark:text-rose-400")}>
        {formatSar(cur)}
      </td>
      <td className="py-1.5 text-right tabular-nums muted">
        {hasPrior ? formatSar(pri as number) : "—"}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
        tone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {d ? `${d.abs > 0 ? "+" : ""}${formatSar(d.abs)}` : "—"}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
        tone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {/* An em dash, not a fabricated percentage, when the base is zero. */}
        {d ? formatPct(d.pct) : "—"}
      </td>
    </tr>
  );
}

/** Margin is a ratio, so its "variance" is a point difference, not a percent. */
function MarginLine({ cur, pri }: { cur: number | null; pri: number | null }) {
  const points = cur !== null && pri !== null ? cur - pri : null;
  return (
    <tr>
      <td className="py-1.5 pl-4 muted">Operating margin</td>
      <td className="py-1.5 text-right tabular-nums">{formatShare(cur)}</td>
      <td className="py-1.5 text-right tabular-nums muted">{formatShare(pri)}</td>
      <td className={cn("py-1.5 text-right tabular-nums",
        points === null ? "muted" :
        points > 0 ? "text-emerald-600 dark:text-emerald-400" :
        points < 0 ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {points === null ? "—" : `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`}
      </td>
      <td className="py-1.5 text-right muted">—</td>
    </tr>
  );
}
