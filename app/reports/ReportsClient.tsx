"use client";

// Reports — the page shell.
//
// Two tabs: Overview (KPIs and charts) and Reports (printable statements).
// The tab bar is the same underline convention as Consumption/Trips/Inventory
// — one pattern for tabs across the app, not a new one per page.
//
// The month period picker sits in the PAGE HEADER. It drives the Overview
// only — tab 2's statements carry their own grain + period control (month /
// quarter / year), which this month picker cannot express.
//
// It was moved below the tab bar in one round and moved back here in the next
// (Turki's call, both times). Recorded so the next reader does not "fix" it
// back down again: the header is the intended home.

import { useMemo, useState } from "react";
import { useTabParam } from "@/lib/useTabParam";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { PageHeader, Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  monthsDesc, monthLabel,
  type PnlRow, type CollectionsRow, type RevenueMonthRow, type ReceivableRow,
  type AgingRow, type PayrollRow, type OperationsRow, type RevenuePerTruckRow,
  type TopupsRow, type PurchasingRow, type MaintenancePerTruckRow,
  type FillingMonthRow, type FillingByStationRow,
  type PnlPeriodRow, type ExpenseCategoryPeriodRow,
  type RevenueInvoiceRow, type SalesReturnRow, type CommissionsRow,
  type CommissionsPaidRow, type MetricDictionaryRow,
  type OperationsByDriverRow, type InvoiceOutstandingLiveRow,
  type PayslipBasisRow, type IssuedPayslipRow,
  type DriverCommissionByProjectRow,
} from "@/lib/reports";
import OverviewTab from "./OverviewTab";
import StatementsTab from "./StatementsTab";
import MetricsGlossaryModal from "./MetricsGlossaryModal";
import ExpensesModal, { type ExpenseRow } from "./ExpensesModal";

const REPORT_TABS = ["overview", "statements"] as const;

type Tab = "overview" | "statements";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "statements", label: "Reports" },
];

type ReportsClientProps = {
  error: string | null;
  pnl: PnlRow[];
  collections: CollectionsRow[];
  revenue: RevenueMonthRow[];
  receivables: ReceivableRow[];
  aging: AgingRow[];
  payroll: PayrollRow[];
  operations: OperationsRow[];
  perTruck: RevenuePerTruckRow[];
  topups: TopupsRow[];
  purchasing: PurchasingRow[];
  maintPerTruck: MaintenancePerTruckRow[];
  filling: FillingMonthRow[];
  fillingByStation: FillingByStationRow[];
  /** SOURCE ROWS for the expenses editor — not a metric. See page.tsx. */
  expenses: ExpenseRow[];
  /** Riyadh-local today, computed server-side to avoid UTC skew. */
  today: string;
  pnlPeriods: PnlPeriodRow[];
  expenseCategories: ExpenseCategoryPeriodRow[];
  invoices: RevenueInvoiceRow[];
  /**
   * 0137 — live outstanding per confirmed-unpaid invoice, joined to `invoices`
   * by invoice_id. STATEMENTS TAB ONLY: the Overview's receivables KPI reads
   * `v_receivables_open`, which 0137 already rewrote to sit on the same view,
   * so that figure is live without passing through here.
   */
  outstandingLive: InvoiceOutstandingLiveRow[];
  salesReturns: SalesReturnRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
  /**
   * The metrics dictionary. TWO consumers, and they use it for opposite
   * reasons: StatementsTab FENCES the custom-report builder to these keys
   * (metric_key only), and MetricsGlossaryModal RENDERS the description
   * columns (meaning / formula / grain / source_view / basis / caveat) — the
   * only place in the app those columns are shown at all.
   *
   * The glossary is mounted HERE rather than inside OverviewTab because its
   * launcher sits in the page header beside the period picker, and because it
   * must open at any scroll position. OverviewTab no longer receives `metrics`
   * at all; the `{...props}` spread below passes only what that tab reads.
   */
  metrics: MetricDictionaryRow[];
  /** 0115 — payslip basis per driver per month, and the frozen documents. */
  payslipBasis: PayslipBasisRow[];
  issuedPayslips: IssuedPayslipRow[];
  /** 0116 — the commission review table's rows (work month, by project). */
  driverCommission: DriverCommissionByProjectRow[];
  /** Per-driver operations (0101) — the Operations statement transposes on it. */
  opsByDriver: OperationsByDriverRow[];
};

export default function ReportsClient(props: ReportsClientProps) {
  const router = useRouter();
  // Tab lives in the URL so global search can deep-link a sub-page.
  const [tab, setTab] = useTabParam<Tab>(REPORT_TABS, "overview");
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const months = useMemo(() => monthsDesc(props.pnl), [props.pnl]);
  // Default to the newest month the spine knows about. The spine always runs
  // to the current month (0098), so this is "this month" in normal use and
  // still resolves to something real if the data ever stops short.
  const [month, setMonth] = useState<string | null>(months[0] ?? null);
  const active = month && months.includes(month) ? month : months[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Revenue, cost and profit — every figure from one shared definition"
        // OVERVIEW ONLY — both controls. The dictionary defines the figures on
        // THIS tab; tab 2 carries its own grain/period control and its own use
        // of the same dictionary (as the builder's fence), so a second launcher
        // there would point at a reference the reader is already inside.
        //
        // The period picker keeps its own `months.length > 0` guard rather than
        // gating the whole block: an empty month spine is a reason not to offer
        // a period, not a reason to hide the dictionary — the dictionary is what
        // explains what the missing figures WOULD have meant.
        actions={
          tab === "overview" ? (
            <div className="flex flex-wrap items-center gap-2">
              {months.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="muted">Period</span>
                  <select
                    value={active ?? ""}
                    onChange={(e) => setMonth(e.target.value)}
                    className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                    style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>{monthLabel(m)}</option>
                    ))}
                  </select>
                </label>
              )}
              <Btn variant="outline" onClick={() => setGlossaryOpen(true)}>
                <BookOpen className="h-4 w-4" />
                Metrics dictionary
              </Btn>
            </div>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              tab === t.key
                ? "border-brand-600 text-brand-600 dark:text-brand-300"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {props.error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          {props.error}
        </div>
      )}

      {tab === "overview" ? (
        <OverviewTab
          {...props}
          months={months}
          month={active}
          onManageExpenses={() => setExpensesOpen(true)}
        />
      ) : (
        <StatementsTab
          pnlPeriods={props.pnlPeriods}
          expenseCategories={props.expenseCategories}
          invoices={props.invoices}
          outstandingLive={props.outstandingLive}
          salesReturns={props.salesReturns}
          receivables={props.receivables}
          aging={props.aging}
          maintPerTruck={props.maintPerTruck}
          filling={props.filling}
          fillingByStation={props.fillingByStation}
          purchasing={props.purchasing}
          payroll={props.payroll}
          commissions={props.commissions}
          commissionsPaid={props.commissionsPaid}
          operations={props.operations}
          collections={props.collections}
          metrics={props.metrics}
          perTruck={props.perTruck}
          opsByDriver={props.opsByDriver}
          payslipBasis={props.payslipBasis}
          issuedPayslips={props.issuedPayslips}
          driverCommission={props.driverCommission}
          today={props.today}
          onManageExpenses={() => setExpensesOpen(true)}
        />
      )}

      {/* Mounted at the PAGE level, not inside OverviewTab, so it survives a tab
          switch and opens from a header button at any scroll position. It reads
          nothing and writes nothing — a pure render of `report_metrics`. */}
      <MetricsGlossaryModal
        open={glossaryOpen}
        onClose={() => setGlossaryOpen(false)}
        metrics={props.metrics}
      />

      {/* router.refresh() rather than local state: the expense figures on this
          page come from VIEWS, so after a write the server has to recompute
          them. Mutating a local array would show an edited list beside a stale
          total — exactly the drift the semantic layer exists to prevent. */}
      <ExpensesModal
        open={expensesOpen}
        onClose={() => setExpensesOpen(false)}
        expenses={props.expenses}
        today={props.today}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
