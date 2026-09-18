"use client";

// Reports — Tab 2, the management pack.
//
// TABLES, NOT CHARTS. These are statements you print, sign and file. Charts
// belong on the Overview.
//
// Eight statements plus a ninth that appears once the builder has generated
// one: P&L, Revenue, Receivables, Costs, Operations, Daily Trips, Payslips, the
// computed Narrative, and Custom. One is visible at a time, which is what makes
// "Print" mean "print THIS statement".
//
// AND IT NOW MEANS ONE THING ON ALL NINE. Every statement builds a standalone
// document through lib/docvm/* + lib/docs/* and hands it to printHtml(). None
// of them prints the screen, so there is no longer a list of the ones that do:
// `MIGRATED` and the `window.print()` fallback both left with Payslips, the
// last holdout, and handlePrint() below is now a single unbranched path.
//
// Daily Trips keeps its OWN Print button and still registers a source here,
// which is not a contradiction — the registration is what arms the Cmd/Ctrl+P
// intercept, a window listener that cannot see which button is on screen.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabParam } from "@/lib/useTabParam";
import { Printer, Pencil, Info, Sparkles } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import {
  periodsOf, priorPeriodStart, isPeriodInProgress, delta, formatPct, formatShare,
  PERIOD_TYPES, monthsIn, sumOver, peakOver, buildNarrative, periodLabel,
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
  type VatSourceDocRow, type PayslipDriverRow, indicativeZakat,
} from "@/lib/reports";
import type { DriverViolationView, ViolationType } from "@/lib/violations";
import type { BankCode } from "@/lib/db-types";
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
import type { CsvValue } from "@/lib/csv";
import { useCsvSource, type RegisterCsv } from "./exportSource";
import { usePrintSource, type PrintSource, type RegisterPrint } from "./printSource";
import { printHtml } from "@/lib/printHtml";
import { buildPnlVm } from "@/lib/docvm/pnl";
import { buildPnlHtml } from "@/lib/docs/pnl";

// One statement at a time, so "Print" prints the statement you are looking at
// rather than the whole pack — and a long tab does not become a scroll marathon.
//
// That used to be a statement about PRINT IDS: one mounted subtree meant one
// whitelisted id in the DOM. It is a statement about REGISTRATION now — one
// mounted statement means one print source registered (./printSource) — and the
// invariant it buys is the same one.
type Statement =
  | "pnl" | "revenue" | "receivables" | "cost" | "operations"
  | "daily" | "payslips" | "narrative" | "custom";

/*
 * THERE USED TO BE A `MIGRATED` SET HERE, and it is worth saying what it was
 * for, because the shape it guarded is still a live hazard elsewhere.
 *
 * It named the statements that print a DOCUMENT rather than the screen, and
 * the one Print button branched on it. The branch existed for a failure mode,
 * not for tidiness: globals.css hides the whole page under @media print and
 * un-hides by whitelist, so once a statement's print id leaves that whitelist,
 * a stray window.print() on it emits a BLANK SHEET — a failure that reads like
 * a printer problem rather than a code one. The set made that case print
 * nothing at all instead, which is visibly nothing happening.
 *
 * It shrank with every batch and is now empty, because every statement
 * registers a builder. The set, the branch and the window.print() fallback all
 * went together — a set that contains everything decides nothing.
 *
 * THE HAZARD IT GUARDED IS STILL REAL, just no longer here: any surface that
 * removes a print id from globals.css must register a source, or intercept
 * Cmd/Ctrl+P, IN THE SAME COMMIT. That is why the intercept below no longer
 * gates on anything.
 *
 * `no-print` WENT WITH IT, here and in StatementViews.tsx. The class is
 * `display: none` under @media print and nothing at all on screen, so with no
 * whitelist entry to un-hide this page it decides nothing — and a class that
 * decides nothing still CLAIMS something: that the element wearing it is part of
 * a printable subtree. There is none. The period controls and the statement
 * selector are screen-only because no view-model was ever handed them, which is
 * a stronger guarantee than a stylesheet rule and cannot silently stop matching.
 */

/**
 * VAT for the period — FOUR INDEPENDENT PASSES, one per source, and deliberately
 * not a reconciliation. Nothing here adds one source to another and there is no
 * total: see the panel's own footnotes for why a sum across these lines would
 * not be a quantity of anything.
 *
 * `on` is a plain YYYY-MM-DD and so are period_start and period_end, so a string
 * comparison IS a date comparison — the same filter RevenueStatement applies to
 * `month`. Document grain rather than the monthly views: these rows carry their
 * own dates, so a quarter or a year needs no month spine.
 *
 * REJECTED IS SPLIT OUT, NOT DROPPED. A rejected purchase is real VAT on a
 * document the purchasing screens still show, so omitting it silently is how a
 * reader ends up with a figure here they cannot reconcile against those screens.
 * It gets its own line and is never subtracted from another.
 *
 * Sales VAT sums the `invoices` rows the component already holds — the same
 * v_revenue_invoices rows the Revenue statement sums, filtered on `month`
 * exactly as it does. Sales VAT already had a definition in SQL; the fix for a
 * missing number was never to write a second one.
 *
 * AT MODULE SCOPE, WHICH IS THE PART THAT MOVED. These were plain consts in the
 * component body, below the `if (!current)` return, because a hook there would
 * be conditional. The printed sheet needs the same six figures and registers
 * from a hook, which cannot sit below that return — so the RULE moves up here
 * where both callers reach it and the two evaluations cannot drift. A stable
 * module identity also keeps it out of the print builder's dependency list.
 */
function pnlVatLines(
  cur: PnlPeriodRow,
  invoices: readonly RevenueInvoiceRow[],
  orders: readonly VatSourceDocRow[],
  receipts: readonly VatSourceDocRow[],
  repairs: readonly VatSourceDocRow[],
) {
  const line = (rows: readonly VatSourceDocRow[], rejected: boolean) => {
    const hit = rows.filter(
      (r) => r.on >= cur.period_start && r.on <= cur.period_end && r.rejected === rejected,
    );
    return { total: sumOver(hit, (r) => r.vat_sar), count: hit.length };
  };
  const salesDocs = invoices.filter(
    (i) => i.month >= cur.period_start && i.month <= cur.period_end,
  );
  return {
    sales: { total: sumOver(salesDocs, (i) => i.vat_sar), count: salesDocs.length },
    ordered: line(orders, false),
    received: line(receipts, false),
    repairs: line(repairs, false),
    orderedRejected: line(orders, true),
    receivedRejected: line(receipts, true),
  };
}

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
  /** 0175-0177 — live fines per driver + every type, for the payslip document. */
  violationsByDriver: Record<string, DriverViolationView[]>;
  violationTypes: ViolationType[];
  /** 0202 — bank routing, LIVE from drivers. See PayslipDriverRow's note. */
  payslipDrivers: PayslipDriverRow[];
  bankCodes: BankCode[];
  today: string;
  /** Optional so this tab still renders standalone; see ./exportSource. */
  registerCsv?: RegisterCsv;
  onManageExpenses: () => void;
};

export default function StatementsTab({
  pnlPeriods, vatStockReceipts, vatPurchaseOrders, vatWorkshopPayments,
  expenseCategories, invoices, outstandingLive, salesReturns, receivables, aging,
  maintPerTruck, purchasing, payroll, commissions, commissionsPaid, operations,
  filling, fillingByStation,
  collections, metrics, perTruck, opsByDriver, payslipBasis, issuedPayslips, driverCommission,
  violationsByDriver, violationTypes, payslipDrivers, bankCodes, today,
  registerCsv, onManageExpenses,
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

  // The generated custom report. MEMOIZED FOR IDENTITY, not for cost: it was
  // built inline in the JSX below, so every render produced a fresh object.
  // CustomStatement now closes over it to build its CSV, and an unstable object
  // there re-registers the export on every render — which sets state one level
  // up and renders again. Same call, same arguments, same result.
  const customReport = useMemo(
    () => customSpec
      ? buildReport(customSpec, {
          pnlPeriods, collections, purchasing, operations,
          invoices, outstandingLive, perTruck, maintPerTruck,
        }, metrics, lang)
      : null,
    [customSpec, pnlPeriods, collections, purchasing, operations,
     invoices, outstandingLive, perTruck, maintPerTruck, metrics, lang],
  );

  // ---- Which statement. Screen-only, and no longer says so with a class. ---
  // Hoisted out of the return because it renders in TWO of them — the normal
  // pack below, and the Daily Trips branch that has to come before the
  // `!current` guard. Held as a value rather than a component so it does not
  // remount, and so its state stays in this scope.
  const selector = (
    <div className="flex items-center gap-1 flex-wrap">
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
        className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition
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
  // ---- CSV export: the P&L ledger -----------------------------------------
  // THIS COMPONENT OWNS ONLY THE P&L. Every other statement is a child in
  // StatementViews and registers its own source; the dispatch below hands
  // `registerCsv` down to each of them, and passes it to this hook only when
  // the P&L is the statement showing. Without that guard the parent and the
  // mounted child would both register and the last effect to run would win.
  //
  // MUST SIT ABOVE the two early returns below (`daily`, `!current`) —
  // a hook after either is called on some renders and not others.
  //
  // NO VAT LIST. It is on screen directly under this table, and it is
  // deliberately absent here: CLAUDE.md §7 says VAT is never netted into and
  // never subtracted from a profit figure, and a spreadsheet column shared with
  // the profit lines is an invitation to do exactly that with one =SUM. The VAT
  // panel's own footnotes say why its lines do not add up to a quantity either.
  const buildPnl = useCallback(() => {
    if (!current) return null;
    const SAR = t("reports.export.unitSar", lang);
    const PCT = t("reports.export.unitPct", lang);
    // Same single expression the render uses — §7's "indicative" figure has
    // exactly one definition and this is not a second one.
    const z = indicativeZakat(current.net_profit_sar);
    const zPrior = prior ? indicativeZakat(prior.net_profit_sar) : null;

    // Mirrors <Line>: variance and percent come from `delta`, the same helper
    // the table cells call, so the file cannot disagree with the screen.
    const money = (label: string, cur: number, pri?: number): CsvValue[] => {
      const d = pri !== undefined ? delta(cur, pri) : null;
      return [label, SAR, cur, pri ?? null, d ? d.abs : null, d ? d.pct : null];
    };
    // A heading row: label only, every numeric cell empty. Empty, NOT zero —
    // "Cost of operations" is not a figure of nothing.
    const head = (label: string): CsvValue[] => [label, null, null, null, null, null];

    const rows: CsvValue[][] = [
      money(t("reports.metric.revenue", lang), current.revenue_sar, prior?.revenue_sar),

      head(t("reports.pnl.headCostOfOps", lang)),
      money(t("reports.pnl.lineParts", lang), current.parts_cost_sar, prior?.parts_cost_sar),
      money(t("reports.pnl.lineOs", lang), current.os_cost_sar, prior?.os_cost_sar),
      money(t("reports.metric.payroll", lang), current.payroll_sar, prior?.payroll_sar),
      money(t("reports.metric.commissions", lang), current.commissions_sar, prior?.commissions_sar),
      money(t("reports.pnl.lineFilling", lang), current.filling_cost_sar, prior?.filling_cost_sar),
      money(t("reports.pnl.lineOperatingCost", lang), current.operating_cost_sar, prior?.operating_cost_sar),

      money(t("reports.metric.operatingProfit", lang), current.operating_profit_sar, prior?.operating_profit_sar),
      // MARGIN IS THE ONE NON-SAR LINE, and its variance is POINTS, not a
      // percentage of a percentage — `cur - pri`, exactly what <MarginLine>
      // computes. The last cell is empty for the same reason it is an em dash
      // on screen: a percent change on a percentage would not mean anything.
      [
        t("reports.metric.operatingMargin", lang), PCT,
        current.operating_margin_pct,
        prior?.operating_margin_pct ?? null,
        current.operating_margin_pct !== null && prior?.operating_margin_pct != null
          ? current.operating_margin_pct - prior.operating_margin_pct
          : null,
        null,
      ],

      head(t("reports.pnl.headOtherExpenses", lang)),
      // USER DATA — free text typed into ExpensesModal, no `_ar` column, so it
      // exports in whatever language it was entered in, as it renders. No prior
      // column: the screen shows an em dash there because the category
      // breakdown is only ever fetched for the selected period.
      ...categories.map((c): CsvValue[] => [c.category, SAR, c.expenses_sar, null, null, null]),
      money(t("reports.pnl.lineExpenses", lang), current.expenses_sar, prior?.expenses_sar),

      money(t("reports.pnl.lineNetProfit", lang), current.net_profit_sar, prior?.net_profit_sar),

      // ZAKAT — INDICATIVE, AND THE CAVEAT TRAVELS WITH THE FIGURE (§7). The
      // two line labels already carry "indicative" and "Estimated"; the full
      // note follows as its own label-only row, which is what it is on screen.
      // A CSV has no footnote area, and a caveat left behind in the browser is
      // a caveat that never reaches whoever opens the file.
      head(t("reports.pnl.headZakat", lang)),
      money(t("reports.pnl.lineZakat", lang), z.estimate, zPrior?.estimate),
      money(t("reports.pnl.lineAfterZakat", lang), z.profitAfterZakat, zPrior?.profitAfterZakat),
      head(t("reports.pnl.zakatNote", lang)),
      ...(z.applies ? [] : [head(t("reports.pnl.zakatLoss", lang))]),
    ];

    return {
      slug: "pnl",
      title: t("reports.pnl.title", lang),
      period: periodLabel(current, lang),
      columns: [
        t("reports.export.line", lang),
        t("reports.export.unit", lang),
        periodLabel(current, lang),
        // The em dash the <th> renders when there is no prior period, kept
        // rather than blanked: an empty heading over three empty columns reads
        // as a broken file, an em dash reads as "there was nothing to compare".
        prior ? periodLabel(prior, lang) : "—",
        t("reports.th.variance", lang),
        t("reports.export.changePct", lang),
      ],
      rows,
    };
  }, [lang, current, prior, categories]);

  // Registered ONLY while the P&L is the statement on screen. `undefined`
  // means "do not register", which is what leaves the field clear for whichever
  // child statement is mounted instead.
  useCsvSource(statement === "pnl" ? registerCsv : undefined, buildPnl);

  // ---- The print source -----------------------------------------------------
  // A REF, NOT STATE, and that is the one place this differs from the CSV source
  // one level up (ReportsClient holds that one in useState). The difference is
  // what the value is FOR: the export button is DISABLED when nothing is
  // registered, so its registration has to cause a render. Nothing renders off
  // this one — the Print button looks the same either way — so state here would
  // buy a render per mount and per language change and pay for nothing.
  //
  // A ref also removes the updater-form trap that comment warns about: storing a
  // function in state calls it if you pass it bare.
  const printSource = useRef<PrintSource | null>(null);
  // Stable identity. The children register from an effect keyed on this, so a
  // new function every render would re-register on every render.
  const registerPrint = useCallback<RegisterPrint>((src) => {
    printSource.current = src;
  }, []);

  // ---- The P&L's own document ----------------------------------------------
  // THE ONE STATEMENT THAT REGISTERS WITH ITSELF. Every other sheet in the pack
  // is a child in StatementViews and registers from there; the P&L renders in
  // this file, so the builder and the registration are both here. The mechanism
  // is the same one either way — see ./printSource for why registration beats a
  // switch in the button.
  //
  // ABOVE THE TWO EARLY RETURNS, which is a hard constraint and the reason
  // pnlVatLines() was hoisted to module scope: a hook cannot sit below a return.
  //
  // EVERY FIGURE IS PASSED, NOT RECOMPUTED. `current` and `prior` are view rows,
  // the categories are a fetched list, the six VAT lines come from the same
  // module function the panel below calls, and Zakat is the view-model's — one
  // expression of `indicativeZakat`, reached through lib/docvm/pnl.ts rather
  // than spelled a second time here.
  const buildPnlDoc = useCallback(() => {
    // Unreachable: the registration below is gated on `current` as well as on
    // the statement, so nothing is registered when there is no period. A
    // document of nothing is still better than a throw on a print button.
    if (!current) return "";
    return buildPnlHtml(buildPnlVm({
      lang,
      // Stamped when the sheet is PRODUCED, which for a printout is now.
      generatedAt: new Date(),
      label: periodLabel(current, lang),
      priorLabel: prior ? periodLabel(prior, lang) : null,
      inProgress: isPeriodInProgress(current.period_end, today),
      current,
      prior,
      categories,
      vat: pnlVatLines(
        current, invoices, vatPurchaseOrders, vatStockReceipts, vatWorkshopPayments,
      ),
    }));
  }, [
    lang, today, current, prior, categories,
    invoices, vatPurchaseOrders, vatStockReceipts, vatWorkshopPayments,
  ]);

  // Gated on the PERIOD as well as the statement. With no period this component
  // renders the nothing-to-report card, which has no Print button — but the
  // Cmd/Ctrl+P intercept below is a window listener and does not know that, so
  // leaving a builder registered would print a sheet for a period that has none.
  usePrintSource(statement === "pnl" && current ? registerPrint : undefined, buildPnlDoc);

  // THE ONE BUTTON, ONE MEANING: build the mounted statement's document and
  // print that. No fallback — see the note where MIGRATED used to be. A missing
  // source is now a bug in the statement, and the right response to it is to do
  // nothing rather than to print the hidden page underneath.
  const handlePrint = useCallback(() => {
    const build = printSource.current;
    if (build) printHtml(build());
  }, []);

  // CTRL/CMD+P PRINTS THE DOCUMENT TOO — the same intercept BreakdownReport,
  // StatementModal and InvoiceDetailModal carry, for the same reason: without it
  // the shortcut prints a BLANK SHEET, because globals.css un-hides by whitelist
  // and every statement's whitelist entry went with its print CSS.
  //
  // UNCONDITIONAL NOW. It used to arm only while a migrated statement was
  // mounted, because Payslips still printed through the stylesheet and there was
  // nothing to improve on what the browser would do anyway. Payslips has moved,
  // so there is no statement left for which the browser's own behaviour is the
  // right one.
  //
  // THIS IS DAILY TRIPS' ONLY ROUTE THROUGH HERE. Its Print button is inside the
  // report and never touches handlePrint(); the shortcut has no button, so
  // without this it would take the blank-sheet path the moment its whitelist
  // entry left globals.css. Same commit, both halves.
  //
  // Capture phase, so it runs before anything else can swallow the key. No data
  // in the deps: `handlePrint` reads the ref at FIRE time, so the sheet is built
  // from whatever is registered when the key is pressed, never from a snapshot.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P") return;
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      handlePrint();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handlePrint]);

  if (statement === "daily") {
    return (
      <div className="space-y-4">
        {selector}
        {/* `registerPrint` goes down even though Daily Trips prints from its
            OWN button. The registration is what the Cmd/Ctrl+P intercept above
            reads — that listener has no button to consult. */}
        <DailyTripsTab today={today} registerCsv={registerCsv} registerPrint={registerPrint} />
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

  // The six VAT lines. The rule is pnlVatLines() at module scope, which the
  // printed sheet reads too — see its own comment for why it lives up there.
  //
  // A plain call, NOT useMemo: everything from here down runs after the
  // `if (!current)` return above, so a hook here would be a conditional hook.
  // The neighbouring monthsIn()/sumOver() calls are un-memoized for the same
  // reason.
  const vat = pnlVatLines(
    current, invoices, vatPurchaseOrders, vatStockReceipts, vatWorkshopPayments,
  );

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
      {/* ---- Controls. Screen-only by construction, not by class. ------- */}
      <div className="flex flex-wrap items-center gap-3">
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
          {/* periodLabel() rather than the view's own `label` column — that
              string is baked by SQL to_char() and has one value for every
              reader, so it cannot follow the language toggle. Same swap at
              every other site that used to read `.label`. */}
          {periods.map((p) => (
            <option key={p.period_start} value={p.period_start}>{periodLabel(p, lang)}</option>
          ))}
        </select>

        <div className="ms-auto flex items-center gap-2">
          <Btn variant="outline" onClick={onManageExpenses}>
            <Pencil className="h-4 w-4" />{t("reports.statements.manageExpenses", lang)}
          </Btn>
          <Btn variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />{t("reports.statements.print", lang)}
          </Btn>
        </div>
      </div>

      {selector}

      {/* ---- The statement. SCREEN ONLY. -------------------------------

          THE P&L IS THE ONE STATEMENT THAT IS TWO BOXES: the statement itself
          and the VAT list under it. That used to be a print problem — the two
          had to land on one sheet, so `#pnl-print` sat on this WRAPPER rather
          than on either card and globals.css isolated the pair.

          THAT ID IS GONE, and so is the constraint it existed to satisfy. The
          printed P&L is built by lib/docvm/pnl.ts + lib/docs/pnl.ts, where the
          VAT list is a section of one document and cannot be separated from the
          statement by any amount of page furniture. What is left here is a
          screen layout: a flow container with two cards in it. */}
      {statement === "pnl" && (
      <div className="space-y-5">
        <div className="card p-6">
          <header className="mb-5">
            {/* `&amp;` was JSX escaping, not content — this has always
                rendered a literal "Profit & Loss". */}
            <h2 className="text-lg font-semibold">{t("reports.pnl.title", lang)}</h2>
            <p className="text-sm muted">
              {periodLabel(current, lang)}
              {/* The space after `<>` is on the same line as the tag, so JSX
                  keeps it — it is the separator between the two labels and it
                  is not part of the dictionary value. */}
              {prior && <> {fill(t("reports.pnl.comparedWith", lang), { p: periodLabel(prior, lang) })}</>}
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
                <th className="text-start font-medium muted pb-2">&nbsp;</th>
                <th className="text-end font-medium muted pb-2 w-[150px]">{periodLabel(current, lang)}</th>
                <th className="text-end font-medium muted pb-2 w-[150px]">{prior ? periodLabel(prior, lang) : "—"}</th>
                <th className="text-end font-medium muted pb-2 w-[130px]">{t("reports.th.variance", lang)}</th>
                {/* A bare symbol, left as one. "%" is not English. */}
                <th className="text-end font-medium muted pb-2 w-[90px]">%</th>
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
                  <td colSpan={4} className="pb-2 ps-4 text-[11px] text-amber-700 dark:text-amber-300">
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
                  <td colSpan={5} className="py-2 ps-4 muted text-xs">
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
                    <td className="py-1.5 ps-4">{c.category}</td>
                    <td className="py-1.5 text-end tabular-nums">{formatSar(c.expenses_sar)}</td>
                    <td className="py-1.5 text-end tabular-nums muted">—</td>
                    <td className="py-1.5 text-end tabular-nums muted">—</td>
                    <td className="py-1.5 text-end tabular-nums muted">—</td>
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
                <td colSpan={5} className="pt-2 ps-4 text-[11px] muted italic leading-relaxed">
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

            ON PAPER IT IS A SECTION, NOT A BOX. The printed sheet carries it
            as the last section of one document, under the same masthead, which
            is a stronger attachment than two cards sharing a print id ever was
            — the VAT a period touched is exactly the page an accountant wants
            with the P&L. See lib/docs/pnl.ts. */}
        <section className="card p-6">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-semibold">{t("reports.vat.title", lang)}</h3>
            <span className="text-xs muted">{periodLabel(current, lang)}</span>
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
                <th className="text-start font-medium muted pb-2">{t("reports.th.source", lang)}</th>
                <th className="text-end font-medium muted pb-2 w-[170px]">{t("mt.vat", lang)}</th>
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
                hint={vatHint("hintSales", vat.sales.count)}
                value={vat.sales.total}
              />
              <VatRow
                label={t("reports.vat.rowOrdered", lang)}
                hint={vatHint("hintOrders", vat.ordered.count)}
                value={vat.ordered.total}
              />
              <VatRow
                label={t("reports.vat.rowReceived", lang)}
                hint={vatHint("hintReceipts", vat.received.count)}
                value={vat.received.total}
              />
              <VatRow
                label={t("reports.vat.rowRepairs", lang)}
                hint={vatHint("hintRepairs", vat.repairs.count)}
                value={vat.repairs.total}
              />

              {/* Rejected documents get their OWN lines under their own seam,
                  and are never subtracted from the lines above — this list
                  nets nothing, including against itself. They appear at all
                  because the purchasing screens still show them, so leaving
                  them out silently would put a gap between this page and
                  those. Hidden entirely when there are none: an empty
                  "Rejected" heading reads as a fault. */}
              {(vat.orderedRejected.count > 0 || vat.receivedRejected.count > 0) && (
                <tr>
                  <td colSpan={2} className="pt-4 pb-1 text-xs uppercase tracking-wide muted font-medium">
                    {t("reports.vat.rejectedHead", lang)}
                  </td>
                </tr>
              )}
              {vat.orderedRejected.count > 0 && (
                <VatRow
                  label={t("reports.vat.rowOrderedRejected", lang)}
                  hint={vatHint("hintOrders", vat.orderedRejected.count)}
                  value={vat.orderedRejected.total}
                  indent
                  muted
                />
              )}
              {vat.receivedRejected.count > 0 && (
                <VatRow
                  label={t("reports.vat.rowReceivedRejected", lang)}
                  hint={vatHint("hintReceipts", vat.receivedRejected.count)}
                  value={vat.receivedRejected.total}
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
          label={periodLabel(current, lang)}
          registerCsv={registerCsv}
          registerPrint={registerPrint}
        />
      )}

      {statement === "receivables" && (
        <ReceivablesStatement
          receivables={receivables} aging={aging}
          registerCsv={registerCsv} registerPrint={registerPrint}
        />
      )}

      {statement === "cost" && (
        <CostStatement
          maintPerTruck={maintPerTruck} purchasing={purchasing} payroll={payroll}
          commissions={commissions} commissionsPaid={commissionsPaid}
          filling={filling} fillingByStation={fillingByStation}
          // `current` is the P&L row this tab already renders above — the same
          // row, not a second selection of it. The printed cost sheet takes its
          // masthead figure and its chart off it; the screen below states no
          // total and draws nothing, which is unchanged.
          pnl={current}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={periodLabel(current, lang)}
          registerCsv={registerCsv} registerPrint={registerPrint}
        />
      )}

      {statement === "operations" && (
        <OperationsStatement
          operations={operations}
          byDriver={opsByDriver}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={periodLabel(current, lang)} multiMonth={multiMonth}
          // Same page-level drivers rows the payslips statement reads — the
          // screen's driver cells localize through them (group b).
          driverNames={payslipDrivers}
          registerCsv={registerCsv} registerPrint={registerPrint}
        />
      )}

      {statement === "payslips" && (
        <>
        {/* The database's refusal, shown as written. Sits above the statement
            rather than inside it because a failed issue must be visible from
            wherever in the list the click happened. */}
        {payslipError && (
          <div className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {payslipError}
          </div>
        )}
        {/* ONE REGISTRATION, TWO DOCUMENTS. `registerPrint` goes down once and
            the builder behind it branches the way this component's JSX does: a
            selected driver prints THAT DRIVER'S PAYSLIP, otherwise the register.
            Unlike `registerCsv` — which bails on a selected driver, because a
            one-row file is a trap — it never returns nothing: a single payslip
            IS a document, and the header button is the only way to ask for one.
            This is also what preserves the old behaviour without the old
            mechanism; `body:not(.printing-review)` used to mean "the shared
            button prints the register", and now the closure says so. */}
        <PayslipsStatement
          basis={payslipBasis}
          issued={issuedPayslips}
          periodStart={current.period_start} periodEnd={current.period_end}
          label={periodLabel(current, lang)}
          today={today}
          selectedDriverId={payslipDriver}
          onSelectDriver={setPayslipDriver}
          onIssue={handleIssuePayslip}
          issuingId={issuingPayslip}
          commission={driverCommission}
          violationsByDriver={violationsByDriver}
          violationTypes={violationTypes}
          drivers={payslipDrivers}
          bankCodes={bankCodes}
          registerCsv={registerCsv}
          registerPrint={registerPrint}
        />
        </>
      )}

      {statement === "narrative" && (
        <NarrativeStatement
          bullets={narrative} label={periodLabel(current, lang)} pnl={current}
          registerPrint={registerPrint}
        />
      )}

      {statement === "custom" && customSpec && customReport && (
        <CustomStatement
          report={customReport}
          title={customTitle(customSpec, pnlPeriods, lang)}
          onEdit={() => setCustomOpen(true)}
          registerCsv={registerCsv}
          registerPrint={registerPrint}
          // The heading over the row-label column. Resolved HERE because
          // GROUPING_TKEY is already imported for the title, and CustomStatement
          // otherwise has no reason to know what a BuilderSelection is.
          groupingLabel={t(GROUPING_TKEY[customSpec.grouping], lang)}
        />
      )}

      {statement === "pnl" && (
      <div className="flex gap-2 text-[11px] muted">
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
  return fill(t("reports.statements.customTitle.forPeriod", lang), {
    g,
    p: p ? periodLabel(p, lang) : "—",
  });
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
      <td className={cn("py-1.5", indent && "ps-4", bold && "font-semibold",
        estimate && "italic font-normal")}>{label}</td>
      <td className={cn("py-1.5 text-end tabular-nums", bold && "font-semibold",
        estimate && "italic font-normal",
        signed && cur < 0 && "text-rose-600 dark:text-rose-400")}>
        {formatSar(cur)}
      </td>
      <td className={cn("py-1.5 text-end tabular-nums muted", estimate && "italic")}>
        {hasPrior ? formatSar(pri as number) : "—"}
      </td>
      <td className={cn("py-1.5 text-end tabular-nums",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
        tone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {d ? `${d.abs > 0 ? "+" : ""}${formatSar(d.abs)}` : "—"}
      </td>
      <td className={cn("py-1.5 text-end tabular-nums",
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
      <td className={cn("py-1.5", indent && "ps-4", isMuted && "muted")}>
        <span>{label}</span>
        {hint && <span className="ms-2 text-[11px] muted">{hint}</span>}
      </td>
      <td className={cn("py-1.5 text-end tabular-nums", isMuted && "muted")}>
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
      <td className="py-1.5 ps-4 muted">{t("reports.metric.operatingMargin", lang)}</td>
      <td className="py-1.5 text-end tabular-nums">{formatShare(cur)}</td>
      <td className="py-1.5 text-end tabular-nums muted">{formatShare(pri)}</td>
      <td className={cn("py-1.5 text-end tabular-nums",
        points === null ? "muted" :
        points > 0 ? "text-emerald-600 dark:text-emerald-400" :
        points < 0 ? "text-rose-600 dark:text-rose-400" : "muted")}>
        {/* The SIGN and the FIGURE stay Latin — `{v}` carries both, and only
            the unit word is translated. */}
        {points === null
          ? "—"
          : fill(t("reports.pnl.pts", lang), { v: `${points > 0 ? "+" : ""}${points.toFixed(1)}` })}
      </td>
      <td className="py-1.5 text-end muted">—</td>
    </tr>
  );
}
