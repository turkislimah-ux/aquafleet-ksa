"use client";

// Reports — Tab 2, the management pack.
//
// TABLES, NOT CHARTS. These are statements you print, sign and file. Charts
// belong on the Overview.
//
// Eight statements plus a ninth that appears once the builder has generated
// one: P&L, Revenue, Receivables, Costs, Operations, Daily Trips, Payslips, the
// computed Narrative, and Custom. One is visible at a time, which is what makes
// "Print" mean "print THIS statement" — each owns a print id, and only the
// mounted one exists in the DOM when the print stylesheet runs.
//
// This file owns the P&L and the period controls; the rest live in
// StatementViews.tsx, a leaf module it imports one-way, except Daily Trips —
// see the note on its entry below.
//
// The P&L reads v_pnl_by_period and v_expenses_by_category_period. Both carry
// all three grains (0100), so switching between monthly, quarterly and yearly
// changes which rows are selected — it never changes how a figure is computed.
// That is the point: the margin for a quarter is recomputed in SQL from that
// quarter's own revenue, because averaging monthly margins flips the sign on
// live data (Q3 2026 is -38.7% correctly, +20.5% if averaged).
//
// TWO BLOCKS SIT UNDER IT, and neither touches a P&L figure. NEITHER HAS A
// MIGRATION NUMBER, because neither needed a migration — that is the whole
// shape of both: one is arithmetic on a figure already rendered, the other is
// a list of rows read straight from the tables that record them.
//
//   * ZAKAT — an INDICATIVE 2.5% estimate, computed HERE by indicativeZakat()
//     from the net profit this statement already displays. No view, no fetch:
//     multiplying a number already on screen is arithmetic, not a metric, and
//     there is no SQL expression of Zakat for it to disagree with. The estimate
//     is not a measurement and must never be printed without its caveat.
//     Corporate income tax is NOT modelled and must not be: it applies to
//     foreign/mixed ownership, and this company is 100% Saudi-owned.
//
//   * VAT — an ITEMISED LIST, DISPLAY ONLY. VAT is a liability collected for
//     ZATCA, never income or cost, so nothing in that panel is added to,
//     subtracted from, or netted against the statement above it.
//
//     NOTHING IN IT IS TOTALLED OR NETTED EITHER, and that is the design
//     rather than an omission. Sales VAT is money collected FROM customers and
//     the other three sources are VAT paid TO suppliers, so a sum across them
//     is not a quantity of anything; and a delivered purchase order appears on
//     both the "ordered" and the "delivered" line, the same money at two
//     stages. Listing each amount beside its source dissolves the
//     double-counting question instead of answering it — which is why there is
//     no net row, no total, and no "payable to ZATCA".
//
//     Sales VAT is summed from `invoices` (v_revenue_invoices.vat_sar), which
//     already defines it. The three supplier sources are base-table rows
//     normalised in page.tsx, because no view exposes supplier VAT — and a
//     view holding a list that performs no arithmetic would define nothing.
//
// The only arithmetic here is variance between two periods — comparing two
// figures the views produced, which is what lib/reports.ts delta() does
// everywhere else on this page.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabParam } from "@/lib/useTabParam";
import { Printer, Pencil, Info, Sparkles } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import {
  periodsOf, priorPeriodStart, isPeriodInProgress, delta, formatPct, formatShare,
  PERIOD_TYPES, monthsIn, sumOver, peakOver, buildNarrative,
  type PeriodType, type PnlPeriodRow, type ExpenseCategoryPeriodRow, type Delta,
  type RevenueInvoiceRow, type SalesReturnRow, type ReceivableRow, type AgingRow,
  type InvoiceOutstandingLiveRow,
  type MaintenancePerTruckRow, type PurchasingRow, type PayrollRow,
  type FillingMonthRow, type FillingByStationRow,
  type CommissionsRow, type CommissionsPaidRow, type OperationsRow,
  type CollectionsRow, type MetricDictionaryRow, type RevenuePerTruckRow,
  type OperationsByDriverRow,
  type PayslipBasisRow, type IssuedPayslipRow,
  type DriverCommissionByProjectRow,
  type VatSourceDocRow, indicativeZakat,
} from "@/lib/reports";
import {
  RevenueStatement, ReceivablesStatement, CostStatement,
  OperationsStatement, PayslipsStatement, NarrativeStatement, CustomStatement,
} from "./StatementViews";
// NOT from StatementViews, and not given data from page.tsx either. Every other
// statement here renders rows this page already holds; Daily Trips fetches its
// own window through a server action, because it is date-scoped over 765+
// delivered trips and shipping the whole history to the browser to filter one
// day out of it would get slower every week for no benefit. It owns its own
// date picker, its own period control and its own Print button for the same
// reason — the controls at the top of this tab cannot express a single day.
import DailyTripsTab from "./DailyTripsTab";
import { issueDriverPayslip } from "./actions";
import { buildReport, GROUPING_TKEY, type BuilderSelection } from "@/lib/report-builder";
import CustomReportModal from "./CustomReportModal";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang, type TKey } from "@/lib/i18n";

// One statement at a time. That keeps each print id the ONLY print subtree in
// the DOM, so "Print" prints the statement you are looking at rather than the
// whole pack — and it keeps a long tab from becoming a scroll marathon.
type Statement =
  | "pnl" | "revenue" | "receivables" | "cost" | "operations"
  | "daily" | "payslips" | "narrative" | "custom";

// `revenue` points at reports.metric.revenue rather than minting a ninth tab
// leaf: the statement is named after the metric it reports, so a second copy of
// the word is a second thing to keep in step. Every other tab has a name only a
// tab has.
const STATEMENTS: { key: Statement; labelKey: TKey }[] = [
  { key: "pnl", labelKey: "reports.statements.tab.pnl" },
  { key: "revenue", labelKey: "reports.metric.revenue" },
  { key: "receivables", labelKey: "reports.statements.tab.receivables" },
  { key: "cost", labelKey: "reports.statements.tab.cost" },
  { key: "operations", labelKey: "reports.statements.tab.operations" },
  // DIRECTLY AFTER OPERATIONS, and that placement is the meaning: Operations is
  // the period-level view of the same activity — trips, trucks, work orders
  // aggregated — and Daily Trips is the day-level record underneath it, one line
  // per driver per truck. Reading them adjacently is reading the same thing at
  // two grains, so the pack goes from summary to source without a jump.
  { key: "daily", labelKey: "reports.statements.tab.daily" },
  { key: "payslips", labelKey: "reports.statements.tab.payslips" },
  { key: "narrative", labelKey: "reports.statements.tab.narrative" },
];

// Every value `?statement=` accepts. "custom" is included even though it is
// not a tab in STATEMENTS above: the tab only appears once a spec has been
// generated, but the URL must still accept it so search can point at the
// builder (see the effect in the component).
const STATEMENT_KEYS = [
  "pnl", "revenue", "receivables", "cost", "operations",
  "daily", "payslips", "narrative", "custom",
] as const;

type Props = {
  pnlPeriods: PnlPeriodRow[];
  /**
   * VAT PAID TO SUPPLIERS, one array per source, document grain. Kept
   * separate rather than concatenated: each renders its own line under its own
   * label, and nothing is ever summed across two of them.
   */
  vatStockReceipts: VatSourceDocRow[];
  vatPurchaseOrders: VatSourceDocRow[];
  vatWorkshopPayments: VatSourceDocRow[];
  expenseCategories: ExpenseCategoryPeriodRow[];
  invoices: RevenueInvoiceRow[];
  /** 0137 — joined to `invoices` by invoice_id. Read by BOTH consumers below. */
  outstandingLive: InvoiceOutstandingLiveRow[];
  salesReturns: SalesReturnRow[];
  receivables: ReceivableRow[];
  aging: AgingRow[];
  maintPerTruck: MaintenancePerTruckRow[];
  filling: FillingMonthRow[];
  fillingByStation: FillingByStationRow[];
  purchasing: PurchasingRow[];
  payroll: PayrollRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
  operations: OperationsRow[];
  collections: CollectionsRow[];
  metrics: MetricDictionaryRow[];
  perTruck: RevenuePerTruckRow[];
  opsByDriver: OperationsByDriverRow[];
  payslipBasis: PayslipBasisRow[];
  issuedPayslips: IssuedPayslipRow[];
  driverCommission: DriverCommissionByProjectRow[];
  today: string;
  onManageExpenses: () => void;
};

export default function StatementsTab({
  pnlPeriods, vatStockReceipts, vatPurchaseOrders, vatWorkshopPayments,
  expenseCategories, invoices, outstandingLive, salesReturns, receivables, aging,
  maintPerTruck, purchasing, payroll, commissions, commissionsPaid, operations,
  filling, fillingByStation,
  collections, metrics, perTruck, opsByDriver, payslipBasis, issuedPayslips, driverCommission, today, onManageExpenses,
}: Props) {
  const { lang } = useApp();
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  // Which statement is showing lives in the URL, so global search can open
  // one directly ("P&L", "Receivables", "قائمة الإيرادات" are all real
  // destinations). The param is `statement`, NOT `tab` — one level up,
  // ReportsClient already owns `?tab=statements` for the pack as a whole,
  // and reusing that name here would collide.
  const [statement, setStatement] = useTabParam<Statement>(STATEMENT_KEYS, "pnl", "statement");
  const [customOpen, setCustomOpen] = useState(false);
  // Which driver's payslip document is open. Deliberately NOT in the URL: the
  // statement is deep-linkable, one driver's slip is not a destination anyone
  // searches for, and putting a person's pay in a shareable address is a worse
  // default than a click.
  const [payslipDriver, setPayslipDriver] = useState<string | null>(null);
  const [issuingPayslip, setIssuingPayslip] = useState<string | null>(null);
  const [payslipError, setPayslipError] = useState<string | null>(null);
  const router = useRouter();

  // Issue is a single action that freezes a numbered document, so the button
  // stays disabled for the whole round trip — a double click must not be able
  // to attempt two. The RPC's unique constraint is the real backstop; this
  // stops the user ever seeing it.
  async function handleIssuePayslip(driverId: string, periodStart: string) {
    setPayslipError(null);
    setIssuingPayslip(driverId);
    const res = await issueDriverPayslip(driverId, periodStart);
    setIssuingPayslip(null);
    if (!res.ok) {
      // The database's own sentence, shown as written. Every refusal here
      // (running month, no hire date, already issued) is enforced in the RPC.
      setPayslipError(res.error);
      return;
    }
    router.refresh();
  }
  // The builder's output lives here, not in the modal: the result is a
  // statement like any other, so it gets its own print id and print button.
  const [customSpec, setCustomSpec] = useState<BuilderSelection | null>(null);

  // A custom report is not a stored object, so there is nothing to deep-link
  // to — arriving at ?statement=custom means "open the builder". Once a spec
  // exists the generated statement renders normally and this does not fire,
  // so re-opening the builder over a finished report cannot happen.
  useEffect(() => {
    if (statement === "custom" && !customSpec) setCustomOpen(true);
  }, [statement, customSpec]);

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

  // ---- Which statement. Excluded from print. ------------------------------
  // Hoisted out of the return because it renders in TWO of them — the normal
  // pack below, and the Daily Trips branch that has to come before the
  // `!current` guard. Held as a value rather than a component so it does not
  // remount, and so its state stays in this scope.
  const selector = (
    <div className="flex items-center gap-1 flex-wrap no-print">
      {[...STATEMENTS, ...(customSpec
        ? [{ key: "custom" as Statement, labelKey: "reports.statements.tab.custom" as TKey }]
        : [])].map((st) => (
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
          {t(st.labelKey, lang)}
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
        {t("reports.builder.title", lang)}
      </button>
    </div>
  );

  // Hoisted for the same reason as `selector`, and it is not optional: the
  // selector carries the "Custom report" button, so any return that renders the
  // selector must also mount the modal that button opens. Rendering one without
  // the other makes the button set state that nothing reads — a dead click.
  const builder = (
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
  );

  // DAILY TRIPS RETURNS EARLY, ABOVE THE `!current` GUARD AND ABOVE THE PERIOD
  // CONTROLS, for two independent reasons.
  //
  // 1. It reads NONE of the P&L spine. `current` being null means "no period has
  //    any activity to summarise" — true of the statements below it, and no
  //    reason at all to hide a report that queries trips directly. Rendering
  //    after the guard would make an empty spine take Daily Trips down with it.
  // 2. The controls at the top of this tab (month/quarter/year plus a period
  //    select, Manage expenses, Print) are the WRONG controls here and a second
  //    Print button would be ambiguous. Daily Trips carries its own date input,
  //    its own day/week/month/quarter/year segment and its own Print, so the
  //    branch renders the statement selector and nothing else.
  if (statement === "daily") {
    return (
      <div className="space-y-4">
        {selector}
        <DailyTripsTab today={today} />
        {builder}
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm font-medium">{t("reports.statements.nothingToReport", lang)}</div>
        <p className="text-sm muted mt-1">
          {t("reports.statements.periodsAppear", lang)}
        </p>
      </div>
    );
  }

  const inProgress = isPeriodInProgress(current.period_end, today);
  const monthsCovered = monthsIn(operations, current.period_start, current.period_end);
  const multiMonth = monthsCovered.length > 1;

  // Indicative Zakat for this period and the one before it. Arithmetic
  // on a figure this component already displays — see indicativeZakat() for why
  // that does not breach the semantic-layer rule. Both sides come from the same
  // function, so the variance column compares like with like.
  const zakat = indicativeZakat(current.net_profit_sar);
  const priorZakat = prior ? indicativeZakat(prior.net_profit_sar) : null;

  // VAT for the period — FOUR INDEPENDENT PASSES, one per source, and
  // deliberately not a reconciliation. Nothing below adds one source to
  // another and there is no total: see the panel's own footnotes for why a sum
  // across these lines would not be a quantity of anything.
  //
  // Plain calls, NOT useMemo: everything from here down runs after the
  // `if (!current)` return above, so a hook here would be a conditional hook.
  // The neighbouring monthsIn()/sumOver() calls are un-memoized for the same
  // reason.
  //
  // `on` is a plain YYYY-MM-DD and so are period_start and period_end, so a
  // string comparison IS a date comparison — the same filter RevenueStatement
  // applies to `month`. Document grain rather than the monthly views: these
  // rows carry their own dates, so a quarter or a year needs no month spine.
  //
  // REJECTED IS SPLIT OUT, NOT DROPPED. A rejected purchase is real VAT on a
  // document the purchasing screens still show, so omitting it silently is how
  // a reader ends up with a figure here they cannot reconcile against those
  // screens. It gets its own line and is never subtracted from another.
  const inPeriod = (rows: VatSourceDocRow[]) =>
    rows.filter((r) => r.on >= current.period_start && r.on <= current.period_end);
  const vatLine = (rows: VatSourceDocRow[], rejected: boolean) => {
    const hit = inPeriod(rows).filter((r) => r.rejected === rejected);
    return { total: sumOver(hit, (r) => r.vat_sar), count: hit.length };
  };

  // Sales VAT sums the `invoices` rows this component already holds — the same
  // v_revenue_invoices rows the Revenue statement sums, filtered on `month`
  // exactly as it does. Sales VAT already had a definition in SQL; the fix for
  // a missing number was never to write a second one.
  const vatSalesDocs = invoices.filter(
    (i) => i.month >= current.period_start && i.month <= current.period_end,
  );
  const vatSales = { total: sumOver(vatSalesDocs, (i) => i.vat_sar), count: vatSalesDocs.length };
  const vatOrdered = vatLine(vatPurchaseOrders, false);
  const vatReceived = vatLine(vatStockReceipts, false);
  const vatRepairs = vatLine(vatWorkshopPayments, false);
  const vatOrderedRejected = vatLine(vatPurchaseOrders, true);
  const vatReceivedRejected = vatLine(vatStockReceipts, true);

  // The hint under each VAT row: the document count and the date basis. Every
  // one of the six was a template literal splicing a `count === 1` ternary into
  // an English sentence, which is the trap — Arabic has four count buckets and
  // inflects the noun, so each family stores four whole sentences instead.
  //
  // FOUR FAMILIES FOR SIX ROWS: the two rejected lines count the same document
  // kinds as the two they sit under, so they read the same family rather than
  // minting a duplicate that could drift.
  //
  // `n` stays RAW. These counts were interpolated directly and never passed
  // through formatNum, so routing them through one now would put a thousands
  // separator into a sentence that never had one.
  const vatHint = (family: "hintSales" | "hintOrders" | "hintReceipts" | "hintRepairs", n: number) =>
    fill(t(`reports.vat.${family}.${plural(n)}`, lang), { n });

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
      lang,
    });
  })();

  return (
    <div className="space-y-4">
      {/* ---- Controls. Excluded from print. ---------------------------- */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-1 rounded-lg border p-1"
          style={{ borderColor: "rgb(var(--border))" }}>
          {/* `pt`, not `t` — the translator is imported into this scope and a
              map parameter named `t` shadows it for the whole callback. */}
          {PERIOD_TYPES.map((pt) => (
            <button
              key={pt.key}
              onClick={() => { setPeriodType(pt.key); setStart(null); }}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition",
                periodType === pt.key
                  ? "bg-brand-600 text-white"
                  : "muted hover:text-[rgb(var(--fg))]",
              )}
            >
              {t(pt.labelKey, lang)}
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
            <Pencil className="h-4 w-4" />{t("reports.statements.manageExpenses", lang)}
          </Btn>
          <Btn variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />{t("reports.statements.print", lang)}
          </Btn>
        </div>
      </div>

      {selector}

      {/* ---- The statement. This subtree is what prints. ---------------

          THE P&L IS THE ONE STATEMENT THAT IS TWO BOXES: the statement itself
          and the VAT list under it. #pnl-print sits on a WRAPPER rather than on
          a card, because the wrapper is what the print stylesheet isolates and
          both boxes have to land on the same printout — an accountant filing a
          P&L wants the VAT the period touched attached to it.

          The two alternatives were both worse. A second print id under one
          statement breaks the pack's one-id-per-statement rule. A sibling
          OUTSIDE this wrapper renders on screen and silently vanishes on paper,
          which is the failure mode nobody notices until it is filed.

          So the wrapper carries no card chrome of its own — it is a flow
          container, and its two children are the boxes. */}
      {statement === "pnl" && (
      <div id="pnl-print" className="space-y-5">
        <div className="card p-6">
          <header className="mb-5">
            {/* `&amp;` was JSX escaping, not content — this has always
                rendered a literal "Profit & Loss". */}
            <h2 className="text-lg font-semibold">{t("reports.pnl.title", lang)}</h2>
            <p className="text-sm muted">
              {current.label}
              {/* The space after `<>` is on the same line as the tag, so JSX
                  keeps it — it is the separator between the two labels and it
                  is not part of the dictionary value. */}
              {prior && <> {fill(t("reports.pnl.comparedWith", lang), { p: prior.label })}</>}
            </p>
            {inProgress && (
              <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">
                {t("reports.pnl.inProgress", lang)}
              </p>
            )}
          </header>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgb(var(--border))" }}>
                <th className="text-left font-medium muted pb-2">&nbsp;</th>
                <th className="text-right font-medium muted pb-2 w-[150px]">{current.label}</th>
                <th className="text-right font-medium muted pb-2 w-[150px]">{prior?.label ?? "—"}</th>
                <th className="text-right font-medium muted pb-2 w-[130px]">{t("reports.th.variance", lang)}</th>
                {/* A bare symbol, left as one. "%" is not English. */}
                <th className="text-right font-medium muted pb-2 w-[90px]">%</th>
              </tr>
            </thead>

            <tbody>
              {/* Five of these labels come from reports.metric.* rather than a
                  pnl.* leaf of their own — Revenue, Payroll, Commissions,
                  Operating profit and Operating margin say exactly what the
                  dictionary already says they say. */}
              <Line label={t("reports.metric.revenue", lang)} cur={current.revenue_sar} pri={prior?.revenue_sar}
                higherIsBetter bold />

              <SectionHead>{t("reports.pnl.headCostOfOps", lang)}</SectionHead>
              <Line label={t("reports.pnl.lineParts", lang)} cur={current.parts_cost_sar} pri={prior?.parts_cost_sar} indent />
              <Line label={t("reports.pnl.lineOs", lang)} cur={current.os_cost_sar} pri={prior?.os_cost_sar} indent />
              <Line label={t("reports.metric.payroll", lang)} cur={current.payroll_sar} pri={prior?.payroll_sar} indent />
              <Line label={t("reports.metric.commissions", lang)} cur={current.commissions_sar} pri={prior?.commissions_sar} indent />
              {/* The FIFTH bucket (0112/0113). Without it the four above do not
                  add up to the total below — the gap was exactly this. */}
              <Line label={t("reports.pnl.lineFilling", lang)} cur={current.filling_cost_sar} pri={prior?.filling_cost_sar} indent />
              <Line label={t("reports.pnl.lineOperatingCost", lang)} cur={current.operating_cost_sar}
                pri={prior?.operating_cost_sar} bold rule />
              {current.filling_uncosted_trips > 0 && (
                <tr>
                  {/* English spliced TWO words at once — "fill has"/"fills
                      have" and "its"/"their" — off one `=== 1` test. Arabic
                      changes the noun, the verb and the possessive together and
                      has four count buckets, so the sentence is stored whole per
                      bucket rather than assembled from fragments. The count
                      stays RAW: it was never run through formatNum here, and
                      routing it through one now would insert a thousands
                      separator this sentence never had. */}
                  <td colSpan={4} className="pb-2 pl-4 text-[11px] text-amber-700 dark:text-amber-300">
                    {fill(t(`reports.pnl.uncosted.${plural(current.filling_uncosted_trips)}`, lang),
                      { n: current.filling_uncosted_trips })}
                  </td>
                </tr>
              )}

              <Line label={t("reports.metric.operatingProfit", lang)} cur={current.operating_profit_sar}
                pri={prior?.operating_profit_sar} higherIsBetter bold rule signed />
              <MarginLine cur={current.operating_margin_pct} pri={prior?.operating_margin_pct ?? null} lang={lang} />

              {/* Expenses are their OWN section, never folded into the four
                  operational buckets. That separation is a rule from 0098, not a
                  layout preference — merging them would hide which costs the app
                  actually models and which were typed in by hand. */}
              <SectionHead>{t("reports.pnl.headOtherExpenses", lang)}</SectionHead>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-2 pl-4 muted text-xs">
                    {t("reports.pnl.noExpenses", lang)}
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.category}>
                    {/* USER DATA, not chrome. Expense categories are free text
                        typed into ExpensesModal — there is no enum and no
                        `_ar` column, so this renders whatever was entered, in
                        whatever language it was entered in. */}
                    <td className="py-1.5 pl-4">{c.category}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatSar(c.expenses_sar)}</td>
                    <td className="py-1.5 text-right tabular-nums muted">—</td>
                    <td className="py-1.5 text-right tabular-nums muted">—</td>
                    <td className="py-1.5 text-right tabular-nums muted">—</td>
                  </tr>
                ))
              )}
              <Line label={t("reports.pnl.lineExpenses", lang)} cur={current.expenses_sar}
                pri={prior?.expenses_sar} bold rule />

              {/* The metric is still `net_profit` — the dictionary defines it and
                  the Narrative quotes it. The suffix is a POSITION marker, not a
                  rename: everything above this line is the P&L, everything below
                  it is an estimate. Showing "Profit before Zakat" as a second row
                  carrying the identical figure would read as a mistake. */}
              <Line label={t("reports.pnl.lineNetProfit", lang)} cur={current.net_profit_sar}
                pri={prior?.net_profit_sar} higherIsBetter bold rule signed />

              {/* ZAKAT. NO INCOME-TAX LINE BELONGS HERE OR ANYWHERE ON THIS PAGE:
                  Saudi corporate income tax applies to foreign or mixed
                  ownership, and Bin Slimah Group is 100% Saudi-owned. */}
              <SectionHead>{t("reports.pnl.headZakat", lang)}</SectionHead>
              <Line label={t("reports.pnl.lineZakat", lang)} cur={zakat.estimate}
                pri={priorZakat?.estimate} indent estimate />
              <Line label={t("reports.pnl.lineAfterZakat", lang)} cur={zakat.profitAfterZakat}
                pri={priorZakat?.profitAfterZakat} higherIsBetter rule signed estimate />
              <tr>
                {/* THE CAVEAT IS PART OF THE FIGURE (§7) — it must reach the
                    reader in whichever language they are reading, which is the
                    whole reason this paragraph is keyed rather than left. The
                    space is on the same line as `<>`, so JSX keeps it; it is
                    the sentence separator, not part of either value. */}
                <td colSpan={5} className="pt-2 pl-4 text-[11px] muted italic leading-relaxed">
                  {t("reports.pnl.zakatNote", lang)}
                  {!zakat.applies && <> {t("reports.pnl.zakatLoss", lang)}</>}
                </td>
              </tr>
            </tbody>
          </table>

          <footer className="mt-5 pt-3 border-t text-[11px] muted leading-relaxed"
            style={{ borderColor: "rgb(var(--border))" }}>
            {/* `&apos;` was JSX escaping — the rendered character is a plain
                apostrophe, and that is what the dictionary value holds. */}
            <p>
              {t("reports.pnl.footer", lang)}
            </p>
          </footer>
        </div>

        {/* ================================================================
            VAT — A TRANSPARENCY LIST, NOT A STATEMENT AND NOT A RETURN.
            ================================================================
            Nothing in this box feeds anything in the one above it. VAT is money
            collected on ZATCA's behalf and money paid to suppliers on theirs;
            it is neither income nor cost, which is why 0098 rule 2 keeps it out
            of revenue in the first place. If a figure here ever reaches the
            P&L table, the P&L is wrong.

            EVERY LINE STANDS ALONE. There is no total row, no net row and no
            subtraction anywhere in this section, by design — the four sources
            are not commensurable (one is collected, three are paid) and two of
            them describe the same purchase at different stages. A reader can
            take any single line to the screen it came from and find the
            documents behind it; that is the whole job of this panel.

            ITS OWN BOX, and that is the point rather than decoration. This was
            a bordered block at the foot of the P&L card until Turki asked for
            two boxes, and the box says what the border could not: a seam INSIDE
            a card still reads as a continuation of that card, and this list is
            not part of that statement. Two columns rather than the statement's
            five, so it reads as a different kind of thing at a glance too.

            STILL INSIDE the shared #pnl-print wrapper, so both boxes print
            together — the VAT a period touched is exactly the page an
            accountant wants attached to the P&L. A sibling OUTSIDE that wrapper
            would render on screen and vanish on paper. */}
        <section className="card p-6">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-semibold">{t("reports.vat.title", lang)}</h3>
            <span className="text-xs muted">{current.label}</span>
          </div>
          <p className="text-xs muted mt-1 mb-4">
            {t("reports.vat.intro", lang)}
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgb(var(--border))" }}>
                {/* `mt.vat` — the money vocabulary was already keyed by the
                    maintenance batch, so this heading reads it rather than
                    minting a second spelling of one word. */}
                <th className="text-left font-medium muted pb-2">{t("reports.th.source", lang)}</th>
                <th className="text-right font-medium muted pb-2 w-[170px]">{t("mt.vat", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {/* Flat and unweighted on purpose — no bold line, no indenting,
                  no sub-heading grouping sales against the rest. Any of those
                  would rank one source above another, and the point of the
                  list is that they are four separate facts, not a hierarchy
                  resolving to a figure. The hint carries the document count
                  AND the date basis, so each line is auditable without the
                  reader scrolling to the notes. */}
              <VatRow
                label={t("reports.vat.rowSales", lang)}
                hint={vatHint("hintSales", vatSales.count)}
                value={vatSales.total}
              />
              <VatRow
                label={t("reports.vat.rowOrdered", lang)}
                hint={vatHint("hintOrders", vatOrdered.count)}
                value={vatOrdered.total}
              />
              <VatRow
                label={t("reports.vat.rowReceived", lang)}
                hint={vatHint("hintReceipts", vatReceived.count)}
                value={vatReceived.total}
              />
              <VatRow
                label={t("reports.vat.rowRepairs", lang)}
                hint={vatHint("hintRepairs", vatRepairs.count)}
                value={vatRepairs.total}
              />

              {/* Rejected documents get their OWN lines under their own seam,
                  and are never subtracted from the lines above — this list
                  nets nothing, including against itself. They appear at all
                  because the purchasing screens still show them, so leaving
                  them out silently would put a gap between this page and
                  those. Hidden entirely when there are none: an empty
                  "Rejected" heading reads as a fault. */}
              {(vatOrderedRejected.count > 0 || vatReceivedRejected.count > 0) && (
                <tr>
                  <td colSpan={2} className="pt-4 pb-1 text-xs uppercase tracking-wide muted font-medium">
                    {t("reports.vat.rejectedHead", lang)}
                  </td>
                </tr>
              )}
              {vatOrderedRejected.count > 0 && (
                <VatRow
                  label={t("reports.vat.rowOrderedRejected", lang)}
                  hint={vatHint("hintOrders", vatOrderedRejected.count)}
                  value={vatOrderedRejected.total}
                  indent
                  muted
                />
              )}
              {vatReceivedRejected.count > 0 && (
                <VatRow
                  label={t("reports.vat.rowReceivedRejected", lang)}
                  hint={vatHint("hintReceipts", vatReceivedRejected.count)}
                  value={vatReceivedRejected.total}
                  indent
                  muted
                />
              )}
            </tbody>
          </table>

          <footer className="mt-5 pt-3 border-t text-[11px] muted leading-relaxed space-y-1.5"
            style={{ borderColor: "rgb(var(--border))" }}>
            {/* FOUR FOOTNOTES, THREE SHAPES OF SPLIT.
                  * The first two open with a bolded COMPLETE SENTENCE, so the
                    break between `*Bold` and the body is a sentence boundary —
                    Arabic keeps its own word order on each side of it.
                  * The third is one paragraph and one leaf.
                  * The fourth is the only `<strong>` sitting MID-sentence, so
                    it is split in three: English emphasises before the adverb
                    ("here and only here"), Arabic after it ("هنا فقط"), and
                    only three leaves let each language place its own.
                Every space around a `<strong>` is on the same line as the tag,
                which is what makes JSX keep it — none of them is in a value. */}
            <p>
              <strong>{t("reports.vat.note1Bold", lang)}</strong> {t("reports.vat.note1", lang)}
            </p>
            <p>
              <strong>{t("reports.vat.note2Bold", lang)}</strong> {t("reports.vat.note2", lang)}
            </p>
            <p>
              {t("reports.vat.note3", lang)}
            </p>
            <p>
              {t("reports.vat.note4Before", lang)} <strong>{t("reports.vat.note4Strong", lang)}</strong>{" "}
              {t("reports.vat.note4After", lang)}
            </p>
          </footer>
        </section>
      </div>
      )}

      {statement === "revenue" && (
        <RevenueStatement
          invoices={invoices} returns={salesReturns}
          outstandingLive={outstandingLive}
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
          filling={filling} fillingByStation={fillingByStation}
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

      {statement === "payslips" && (
        <>
        {/* The database's refusal, shown as written. Sits above the statement
            rather than inside it because a failed issue must be visible from
            wherever in the list the click happened. */}
        {payslipError && (
          <div className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300 no-print">
            {payslipError}
          </div>
        )}
        <PayslipsStatement
          basis={payslipBasis}
          issued={issuedPayslips}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={current.label}
          today={today}
          selectedDriverId={payslipDriver}
          onSelectDriver={setPayslipDriver}
          onIssue={handleIssuePayslip}
          issuingId={issuingPayslip}
          commission={driverCommission}
        />
        </>
      )}

      {statement === "narrative" && (
        <NarrativeStatement bullets={narrative} label={current.label} pnl={current} />
      )}

      {statement === "custom" && customSpec && (
        <CustomStatement
          report={buildReport(customSpec, {
            pnlPeriods, collections, purchasing, operations,
            invoices, outstandingLive, perTruck, maintPerTruck,
          }, metrics, lang)}
          title={customTitle(customSpec, pnlPeriods, lang)}
          onEdit={() => setCustomOpen(true)}
        />
      )}

      {statement === "pnl" && (
      <div className="flex gap-2 text-[11px] muted no-print">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        {/* RAW-ENUM TRAP, FIXED IN PLACE. English spliced `periodType` straight
            into the sentence, so it read "the immediately preceding month" only
            because the enum value happens to be an English word — an Arabic
            reader would have got `month` spelled in Latin mid-sentence. Keyed by
            GRAIN, whole sentence per grain, because Arabic inflects the noun. */}
        <p>
          {t(`reports.statements.priorNote.${periodType}`, lang)}
        </p>
      </div>
      )}

      {builder}
    </div>
  );
}

/**
 * A one-line description of what the generated report is showing.
 *
 * `.toLowerCase()` runs on the LOOKUP RESULT, never on the key, and is a
 * deliberate no-op in Arabic — the script has no case, so the same call that
 * gives English its mid-sentence form leaves "حسب العميل" untouched. Same
 * treatment as the builder modal's own footer, which prints the identical word.
 *
 * The by-period branch is keyed by GRAIN rather than filling `{p}` with the
 * enum: it spliced `spec.periodType` in raw, so "every month" was English only
 * by accident of the column's values.
 */
function customTitle(spec: BuilderSelection, periods: PnlPeriodRow[], lang: Lang): string {
  const g = t(GROUPING_TKEY[spec.grouping], lang).toLowerCase();
  if (spec.grouping === "period") {
    return fill(t(`reports.statements.customTitle.${spec.periodType}`, lang), { g });
  }
  const p = periods.find((x) => x.period_type === spec.periodType && x.period_start === spec.periodStart);
  return fill(t("reports.statements.customTitle.forPeriod", lang), { g, p: p?.label ?? "—" });
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
 *
 * `estimate` marks a row that is NOT a measured figure — today only the two
 * Zakat rows. It italicises the label and the amount and drops the bold weight,
 * so an estimate can never be mistaken for a statement line at a glance. The
 * variance columns still work, because both sides are estimates produced by the
 * same view: comparing them is comparing like with like.
 */
function Line({
  label, cur, pri, higherIsBetter = false, bold, indent, rule, signed, estimate,
}: {
  label: string; cur: number; pri?: number;
  higherIsBetter?: boolean; bold?: boolean; indent?: boolean; rule?: boolean;
  signed?: boolean; estimate?: boolean;
}) {
  const hasPrior = pri !== undefined;
  const d: Delta | null = hasPrior ? delta(cur, pri) : null;
  const tone = d && d.dir !== "flat"
    ? ((d.dir === "up") === higherIsBetter ? "ok" : "bad")
    : undefined;

  return (
    <tr className={cn(rule && "border-t")} style={rule ? { borderColor: "rgb(var(--border))" } : undefined}>
      {/* twMerge resolves the weight, so `estimate` reliably wins over `bold`
          on the two cells that carry both. */}
      <td className={cn("py-1.5", indent && "pl-4", bold && "font-semibold",
        estimate && "italic font-normal")}>{label}</td>
      <td className={cn("py-1.5 text-right tabular-nums", bold && "font-semibold",
        estimate && "italic font-normal",
        signed && cur < 0 && "text-rose-600 dark:text-rose-400")}>
        {formatSar(cur)}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums muted", estimate && "italic")}>
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

/**
 * One line of the VAT list. TWO columns, not the statement's five, and
 * deliberately no prior-period comparison: VAT is money held for someone else,
 * and a variance column invites reading it as performance.
 *
 * NO `bold` AND NO `rule`. Both existed while this panel was a reconciliation,
 * to weight a total and a net row against the lines feeding them. There are no
 * such rows now and there must not be, so the props that would let one look
 * like a conclusion are gone rather than left unused. `muted` marks the
 * rejected lines as set aside; `indent` files them under their heading.
 *
 * The `hint` carries the document count and the date basis, so any line can be
 * taken to the screen it came from and checked.
 */
function VatRow({
  label, hint, value, indent, muted: isMuted,
}: {
  label: string; hint?: string; value: number;
  indent?: boolean; muted?: boolean;
}) {
  return (
    <tr>
      <td className={cn("py-1.5", indent && "pl-4", isMuted && "muted")}>
        <span>{label}</span>
        {hint && <span className="ms-2 text-[11px] muted">{hint}</span>}
      </td>
      <td className={cn("py-1.5 text-right tabular-nums", isMuted && "muted")}>
        {formatSar(value)}
      </td>
    </tr>
  );
}

/**
 * Margin is a ratio, so its "variance" is a point difference, not a percent.
 *
 * `lang` arrives as a PROP rather than through useApp(): this is a table row,
 * and its two strings are a label the dictionary already defines and a unit
 * suffix. Same call as MetricsGlossaryModal's entry rows.
 */
function MarginLine({ cur, pri, lang }: { cur: number | null; pri: number | null; lang: Lang }) {
  const points = cur !== null && pri !== null ? cur - pri : null;
  return (
    <tr>
      <td className="py-1.5 pl-4 muted">{t("reports.metric.operatingMargin", lang)}</td>
      <td className="py-1.5 text-right tabular-nums">{formatShare(cur)}</td>
      <td className="py-1.5 text-right tabular-nums muted">{formatShare(pri)}</td>
      <td className={cn("py-1.5 text-right tabular-nums",
        points === null ? "muted" :
        points > 0 ? "text-emerald-600 dark:text-emerald-400" :
        points < 0 ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {/* The SIGN and the FIGURE stay Latin — `{v}` carries both, and only
            the unit word is translated. */}
        {points === null
          ? "—"
          : fill(t("reports.pnl.pts", lang), { v: `${points > 0 ? "+" : ""}${points.toFixed(1)}` })}
      </td>
      <td className="py-1.5 text-right muted">—</td>
    </tr>
  );
}
