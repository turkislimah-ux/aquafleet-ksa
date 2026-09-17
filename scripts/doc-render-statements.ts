// FIXTURE CORPUS for the SEVEN migrated statements — batch 3's four, batch 4's
// Cost and Operations, and batch 5's P&L. It renders every sheet in BOTH
// languages to a directory, and the tools that judge them read that directory:
//
//   npm run doc:render     # this file AND doc-render-records.ts
//   npm run test:bidi      # render, then the bidi structure check
//   npm run test:pages     # render, then the page-count diff
//
// THIS FILE IS HALF THE CORPUS. scripts/doc-render-records.ts writes the payout
// voucher and the part record into the SAME directory, and both checks read the
// directory rather than either file — so rendering only this half leaves the
// other half stale on disk, which the page-count diff will report as MOVED
// against a baseline that covers all of it. Use `npm run doc:render`.
//
// Output goes to $DOC_SHEETS, default /tmp/atlas-sheets — outside the repo on
// purpose, because these are the artefacts of a check and not sources.
//
// IT IS A STANDING CHECK, NOT A ONE-OFF. The seven sheets are committed and
// approved, so re-rendering them is the regression proof for any change
// underneath them: a kit spacing edit, an i18n key, a shared helper. The bidi
// findings and the page counts off a clean tree are the baseline, and anything
// that moves afterwards moved because of the change.
//
// WHY IT EXISTS RATHER THAN "OPEN THE TAB AND HIT PRINT". Four of the things
// these sheets have to survive are things the live database cannot show:
//
//   1. BOTH LANGUAGES SIDE BY SIDE. The app renders one at a time.
//
//   2. PAGINATION. The longest open-invoice list in the database is TWO rows,
//      the widest custom report the live months can produce is FOUR, the fullest
//      per-truck maintenance table is TWELVE and the fullest driver table is
//      FOURTEEN (all measured 2026-09-13). None fills a sheet, so none can
//      demonstrate that a table FLOWS to page two with its column heads
//      repeated. The synthetic cases below are long on purpose. They are
//      FIXTURES; nothing here writes to the database.
//
//   3. THE RECEIVABLES SEVERITY WORDS. `flagFor()` marks a row past 60 days and
//      again past 90. NO LIVE OPEN INVOICE IS OLDER THAN FOUR DAYS, so on real
//      rows the gutter column does not exist at all — which is correct, and also
//      means the live case proves nothing about the device. One synthetic sheet
//      exists solely to make both words appear.
//
//   4. THE EMPTY STATES. Receivables-with-nothing-outstanding,
//      revenue-with-no-invoices and cost-with-no-maintenance are all reachable
//      on live data (June 2026 has no invoice and no work order at all), but the
//      custom builder's two DIFFERENT nothings — a selection with no metrics,
//      and metrics that matched no row — need two selections nobody would make
//      by accident, and OPERATIONS has no empty month at all: every month the
//      view holds has both trips and drivers, so the sheet's own nothing needs a
//      period the view does not cover.
//
// The REAL cases are real: every figure below was read out of the live database
// on 2026-09-13 and pasted in, so what renders is what the screen holds. They
// are what proves CONTENT; the synthetic ones prove GEOMETRY, and only geometry.
//
// WHAT IS RESTATED HERE, and why each one had to be. Everything not on this list
// goes through the real buildXVm / buildXHtml pair.
//
//   * The period label (`periodLabel(current, lang)`) and the custom report's
//     title (`customTitle()` in StatementsTab). Both are ARGUMENTS the
//     components receive rather than compute, so a harness standing in for the
//     component has to supply them.
//
//   * Operations' period scalars and its `multiMonth` flag. These are
//     `monthsIn` / `sumOver` / `peakOver` over the live rows — the component's
//     OWN library helpers, called with the component's own arguments — plus the
//     two one-liners beside them (`workOrders + osJobs`, and the completion rate
//     from period totals). Restating a call to a shared helper is not a second
//     expression of the figure; re-implementing the helper would be.
//
//   * The P&L's SIX VAT FIGURES — `vatLine()`'s date-range filter, its
//     rejected/not split, and `sumOver(hit, r => r.vat_sar)`. This one goes the
//     OPPOSITE way from the cost rollups below, and the reason is what the
//     fixture has to SHOW rather than how much of it there is. Six pre-summed
//     pairs per period would render the right sheet and demonstrate nothing:
//     the branches worth looking at are that July has rejected documents and
//     June has none (so the "Rejected" sub-head appears on one sheet and not the
//     other), and that ELEVEN of July's fifteen supplier documents carry 0.00
//     VAT — a count of eleven beside a figure of 1,021.20 looks like a bug until
//     you can see the rows. Carrying the 47 raw rows makes both readable; the
//     filter restated over them is `r.on >= start && r.on <= end`, which this
//     file already restates twice (the narrative's top-customer scan and the
//     revenue period cut) and which is checkable by eye against the data below.


//
// THE COST FIXTURES SIT AT VM-INPUT GRAIN, MEASURED BY SQL — not re-rolled here.
// CostStatement derives four things the harness would otherwise have to rebuild:
// the per-truck maintenance rollup, the two fill groupings, and the payroll and
// commission slices. Four restatements are four chances to drift silently, and a
// drifted harness is worse than no harness because it renders a sheet that looks
// verified. So each period's rollup below was read out of the database AS the
// component's memo would leave it and pasted whole. The two column totals ARE
// summed here, off `trucks`, because that is literally the component's own line
// (`sumOver(trucks, (tr) => tr.parts)`).

import { mkdirSync, writeFileSync } from "node:fs";
import type {
  DeferredRow, ReportAssignment, ReportDriver, ReportProject, ReportTrip, ReportTruck,
} from "../lib/daily-trips";
import { buildCostHtml } from "../lib/docs/cost";
import { buildCustomHtml } from "../lib/docs/custom";
import { buildDailyTripsHtml } from "../lib/docs/daily-trips";
import { buildNarrativeHtml } from "../lib/docs/narrative";
import { buildOpsHtml } from "../lib/docs/operations";
import { buildPayslipHtml } from "../lib/docs/payslip";
import { buildPnlHtml } from "../lib/docs/pnl";
import { buildReceivablesHtml } from "../lib/docs/receivables";
import { buildRevenueHtml } from "../lib/docs/revenue";
import { buildCostVm, type CostDocInput, type CostDocTruck } from "../lib/docvm/cost";
import { buildCustomVm, type CustomDocInput } from "../lib/docvm/custom";
import { buildDailyDocVm, type DailyDocInput } from "../lib/docvm/daily-trips";
import { buildNarrativeVm, type NarrativeDocInput } from "../lib/docvm/narrative";
import { buildOpsVm, type OpsDocDriver, type OpsDocInput } from "../lib/docvm/operations";
import { buildPayslipVm, resolvePayslipBank, type PayslipDocInput } from "../lib/docvm/payslip";
import { buildPnlVm, type PnlDocInput } from "../lib/docvm/pnl";
import { buildReceivablesVm, type ReceivablesDocInput } from "../lib/docvm/receivables";
import { buildRevenueVm, type RevenueDocInput } from "../lib/docvm/revenue";
import { fill, t, type Lang } from "../lib/i18n";
import {
  AGING_ORDER, buildNarrative, isPeriodInProgress, monthsIn, periodLabel, peakOver,
  priorPeriodStart, sumOver,
  type CollectionsRow, type ExpenseCategoryPeriodRow, type IssuedPayslipRow,
  type MetricDictionaryRow, type OperationsRow, type PayslipBasisRow,
  type PnlPeriodRow, type RevenueInvoiceRow, type VatSourceDocRow,
} from "../lib/reports";
import type { DriverViolationView, ViolationType } from "../lib/violations";
import { buildReport, GROUPING_TKEY, type BuilderSelection } from "../lib/report-builder";
import { formatDayKeyLang } from "../lib/utils";

const OUT = process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const AT = new Date("2026-09-13T09:00:00+03:00");

// ---------------------------------------------------------------------------
// LIVE ROWS — v_pnl_by_period, v_operations_monthly, v_collections_monthly,
// v_revenue_invoices, v_revenue_sales_returns, v_invoice_outstanding_live,
// v_receivables_open, v_receivables_aging. Read 2026-09-13.
// ---------------------------------------------------------------------------

const PNL: PnlPeriodRow[] = [
  { period_type: "month", period_start: "2026-06-01", period_end: "2026-06-30", label: "Jun 2026",
    revenue_sar: 0, parts_cost_sar: 0, os_cost_sar: 0, payroll_sar: 25000, commissions_sar: 488,
    operating_cost_sar: 25698, operating_profit_sar: -25698, expenses_sar: 0, net_profit_sar: -25698,
    operating_margin_pct: null, filling_cost_sar: 210, filling_uncosted_trips: 10 },
  { period_type: "month", period_start: "2026-07-01", period_end: "2026-07-31", label: "Jul 2026",
    revenue_sar: 70650, parts_cost_sar: 4873.95, os_cost_sar: 9830, payroll_sar: 37800,
    commissions_sar: 2445.72, operating_cost_sar: 56234.67, operating_profit_sar: 14415.33,
    expenses_sar: 13000, net_profit_sar: 1415.33, operating_margin_pct: 20.4,
    filling_cost_sar: 1285, filling_uncosted_trips: 3 },
  // RE-READ 2026-09-14, after 0197. This is the only month the exit-permit
  // recognition rule moved: 190.00 SAR of returnable stock left operating cost,
  // so parts, operating cost, both profit lines and the margin all shifted.
  // Jun, Jul and Sep are byte-identical to the 2026-09-13 read.
  { period_type: "month", period_start: "2026-08-01", period_end: "2026-08-31", label: "Aug 2026",
    revenue_sar: 50700, parts_cost_sar: 3589, os_cost_sar: 7200, payroll_sar: 31300,
    commissions_sar: 14104.93, operating_cost_sar: 61558.93, operating_profit_sar: -10858.93,
    expenses_sar: 0, net_profit_sar: -10858.93, operating_margin_pct: -21.4,
    filling_cost_sar: 5365, filling_uncosted_trips: 0 },
  { period_type: "month", period_start: "2026-09-01", period_end: "2026-09-30", label: "Sep 2026",
    revenue_sar: 20290, parts_cost_sar: 0, os_cost_sar: 0, payroll_sar: 31300,
    commissions_sar: 1984.19, operating_cost_sar: 33584.19, operating_profit_sar: -13294.19,
    expenses_sar: 0, net_profit_sar: -13294.19, operating_margin_pct: -65.5,
    filling_cost_sar: 300, filling_uncosted_trips: 0 },
];

// The one live QUARTER row, and the only period in the book that spans months.
// Both batch-4 sheets need it: operations cannot show a by-month table or the
// dual-axis chart without more than one month, and the cost sheet's maintenance
// table only reaches twelve trucks over a quarter.
//
// RE-READ 2026-09-14 alongside the Aug row above: Q3 contains August, so 0197's
// 190.00 SAR moves through this row by exactly the same amount.
const Q3: PnlPeriodRow = {
  period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30",
  label: "Q3 2026", revenue_sar: 141640, parts_cost_sar: 8462.95, os_cost_sar: 17030,
  payroll_sar: 100400, commissions_sar: 18534.84, operating_cost_sar: 151377.79,
  operating_profit_sar: -9737.79, expenses_sar: 13000, net_profit_sar: -22737.79,
  operating_margin_pct: -6.9, filling_cost_sar: 6950, filling_uncosted_trips: 3,
};

// RE-READ 2026-09-13 for batch 4. The previous copy of this fixture carried
// outsourced_jobs and exit_permits as ZERO in all four months, and all six of
// those figures were wrong — the narrative never touched either column, so
// nothing here was reading them. The operations sheet reads both.
const OPS: OperationsRow[] = [
  { month: "2026-06-01", trips_total: 33, trips_delivered: 22, trucks_active: 2, work_orders: 0,
    outsourced_jobs: 0, exit_permits: 0 },
  { month: "2026-07-01", trips_total: 166, trips_delivered: 131, trucks_active: 10, work_orders: 3,
    outsourced_jobs: 1, exit_permits: 0 },
  { month: "2026-08-01", trips_total: 658, trips_delivered: 627, trucks_active: 8, work_orders: 14,
    outsourced_jobs: 5, exit_permits: 5 },
  { month: "2026-09-01", trips_total: 124, trips_delivered: 124, trucks_active: 8, work_orders: 0,
    outsourced_jobs: 0, exit_permits: 1 },
];

const COLLECTIONS: CollectionsRow[] = [
  { month: "2026-06-01", collected_gross_sar: 0, invoices_paid: 0 },
  { month: "2026-07-01", collected_gross_sar: 30532.5, invoices_paid: 0 },
  { month: "2026-08-01", collected_gross_sar: 109020, invoices_paid: 0 },
  { month: "2026-09-01", collected_gross_sar: 9740.5, invoices_paid: 0 },
];

// One customer line as the RevenueStatement's own `useMemo` produced it —
// grouped by customer_id, sorted revenue-descending. Restated as rows rather
// than re-grouped here for the reason lib/docvm/revenue.ts gives: the grouping
// is the component's, and a second expression of it would be free to drift.
type CustRow = { name: string; count: number; revenue: number; paid: number; outstanding: number };

// July 2026 — the fullest real month. Sixteen invoices over five customers,
// EVERY ONE PAID, so the outstanding column is five em dashes and the split bar
// has one visible part with a zero-width hatched twin. Four sales returns.
const JUL_ROWS: CustRow[] = [
  { name: "MMM construction Co.", count: 8, revenue: 55000, paid: 55000, outstanding: 0 },
  { name: "Seder Facility mang. Co.", count: 2, revenue: 8040, paid: 8040, outstanding: 0 },
  { name: "Turki Contraction Co.", count: 1, revenue: 3300, paid: 3300, outstanding: 0 },
  { name: "TEST 111 Co.", count: 2, revenue: 3080, paid: 3080, outstanding: 0 },
  { name: "Seder Facility Mang. Co.", count: 3, revenue: 1230, paid: 1230, outstanding: 0 },
];

// September 2026 — the mixed month. Two customers owe and two do not, so the
// paid column carries em dashes AND figures, and the bar has two real parts.
// No sales return in the period: the returns table takes its empty state.
const SEP_ROWS: CustRow[] = [
  { name: "MMM construction Co.", count: 1, revenue: 6900, paid: 0, outstanding: 7935 },
  { name: "Seder Facility Mang. Co.", count: 1, revenue: 6560, paid: 6560, outstanding: 0 },
  { name: "VVV CO.", count: 1, revenue: 4920, paid: 0, outstanding: 5658 },
  { name: "Al Futam Trading Co.", count: 2, revenue: 1910, paid: 1910, outstanding: 0 },
];

// v_revenue_sales_returns, July 2026 — all four live returns fall in this month.
// Order is the page's: voided_at descending.
const JUL_RETURNS = [
  { invoiceNumber: "7", reason: "Test", reversed: 6900 },
  { invoiceNumber: "6", reason: "test", reversed: 1260 },
  { invoiceNumber: "5", reason: "test", reversed: 8700 },
  { invoiceNumber: "1", reason: "wrong price for special charges", reversed: 12100 },
];

// v_revenue_invoices, the whole live set the narrative's top-customer scan reads.
//
// `vat_sar` RE-READ 2026-09-13 for batch 5, and every one of the 23 was WRONG —
// the column was a hard-coded 0 because the two sheets that held this fixture
// (narrative, custom) read revenue and never VAT. The P&L's sales-VAT line sums
// exactly these rows, so a zeroed column here is a zeroed line on the sheet.
// Same class of error as batch 4's outsourced_jobs/exit_permits, found the same
// way: a new reader arrived for a column nothing had ever read.
//
// They come to 15% of revenue on every row, which is the ZATCA rate and is NOT
// why they are written out. A fixture that computed `revenue * 0.15` would be a
// second expression of lib/vat.ts and would keep agreeing with the screen after
// the screen stopped being right.
const INVOICES: RevenueInvoiceRow[] = (
  [
    ["8f119304", "MMM construction Co.", "2026-07-01", 40800, 6120, true],
    ["d59b9bfe", "Seder Facility mang. Co.", "2026-07-01", 4940, 741, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 4000, 600, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 3600, 540, true],
    ["e958b840", "Turki Contraction Co.", "2026-07-01", 3300, 495, true],
    ["d59b9bfe", "Seder Facility mang. Co.", "2026-07-01", 3100, 465, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 2800, 420, true],
    ["104e158e", "TEST 111 Co.", "2026-07-01", 2440, 366, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 2200, 330, true],
    ["de4b1ffc", "Seder Facility Mang. Co.", "2026-07-01", 1230, 184.5, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 800, 120, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 800, 120, true],
    ["104e158e", "TEST 111 Co.", "2026-07-01", 640, 96, true],
    ["8f119304", "MMM construction Co.", "2026-07-01", 0, 0, false],
    ["de4b1ffc", "Seder Facility Mang. Co.", "2026-07-01", 0, 0, false],
    ["de4b1ffc", "Seder Facility Mang. Co.", "2026-07-01", 0, 0, false],
    ["de4b1ffc", "Seder Facility Mang. Co.", "2026-08-01", 29700, 4455, true],
    ["d59b9bfe", "Seder Facility mang. Co.", "2026-08-01", 21000, 3150, true],
    ["8f119304", "MMM construction Co.", "2026-09-01", 6900, 1035, false],
    ["de4b1ffc", "Seder Facility Mang. Co.", "2026-09-01", 6560, 984, true],
    ["863c9309", "VVV CO.", "2026-09-01", 4920, 738, false],
    ["c53a9807", "Al Futam Trading Co.", "2026-09-01", 1440, 216, true],
    ["c53a9807", "Al Futam Trading Co.", "2026-09-01", 470, 70.5, true],
  ] as const
).map(([customer_id, customer_name, month, revenue_sar, vat_sar, is_paid], i) => ({
  invoice_id: `inv-${i}`,
  invoice_number: null,
  customer_id,
  customer_name,
  month,
  confirmed_at: `${month}T00:00:00Z`,
  paid_at: null,
  period_start: null,
  period_end: null,
  status: is_paid ? "paid" : "confirmed",
  revenue_sar,
  vat_sar,
  gross_sar: revenue_sar + vat_sar,
  amount_due_sar: 0,
  is_paid,
})) as RevenueInvoiceRow[];

// v_receivables_open — the whole live list. Two invoices, both four days old.
const OPEN_LIVE = [
  { invoiceNumber: "026-000018", customer: "MMM construction Co.",
    confirmed: "2026-09-09", days: 4, outstanding: 7935 },
  { invoiceNumber: "026-000019", customer: "VVV CO.",
    confirmed: "2026-09-09", days: 4, outstanding: 5658 },
];

// v_receivables_aging — three of the four bands are empty, which is the point of
// rendering it: the strip prints three em dashes and the bar has ONE part.
const AGING_LIVE = [
  { bucket: "0-30", outstanding: 13593, count: 2 },
  { bucket: "31-60", outstanding: 0, count: 0 },
  { bucket: "61-90", outstanding: 0, count: 0 },
  { bucket: "90+", outstanding: 0, count: 0 },
];

// ---------------------------------------------------------------------------
// SCREEN-SIDE COMPOSITIONS, restated — see the header
// ---------------------------------------------------------------------------

const monthRow = (start: string) => PNL.find((p) => p.period_start === start)!;
const monthLabel = (start: string, lang: Lang) => periodLabel(monthRow(start), lang);

/** StatementsTab's customTitle(), verbatim in behaviour. */
function customTitle(spec: BuilderSelection, lang: Lang): string {
  const g = t(GROUPING_TKEY[spec.grouping], lang).toLowerCase();
  if (spec.grouping === "period") {
    return fill(t(`reports.statements.customTitle.${spec.periodType}`, lang), { g });
  }
  const p = PNL.find((x) => x.period_type === spec.periodType && x.period_start === spec.periodStart);
  return fill(t("reports.statements.customTitle.forPeriod", lang), {
    g,
    p: p ? periodLabel(p, lang) : "—",
  });
}

// ---------------------------------------------------------------------------
// REVENUE
// ---------------------------------------------------------------------------

const revenueInput = (
  lang: Lang,
  start: string,
  rows: CustRow[],
  returns: RevenueDocInput["returns"],
): RevenueDocInput => ({
  lang,
  generatedAt: AT,
  label: monthLabel(start, lang),
  rows,
  totals: {
    revenue: rows.reduce((n, r) => n + r.revenue, 0),
    paid: rows.reduce((n, r) => n + r.paid, 0),
    outstanding: rows.reduce((n, r) => n + r.outstanding, 0),
  },
  invoiceCount: rows.reduce((n, r) => n + r.count, 0),
  returns,
  returnedTotal: returns.reduce((n, r) => n + r.reversed, 0),
});

// SYNTHETIC — 44 customers, which the live book does not have. GEOMETRY ONLY:
// the by-customer table must flow onto a second sheet with its heads repeated,
// and the chart below it must not be orphaned from its own caption.
const REV_LONG_ROWS: CustRow[] = Array.from({ length: 44 }, (_, i) => {
  const revenue = 48000 - i * 940;
  const paid = i % 3 === 0 ? 0 : Math.round(revenue * 0.6);
  return {
    name: `${["Al Futam", "Seder Facility", "MMM construction", "VVV", "Turki Contraction"][i % 5]} ` +
      `Co. ${String(i + 1).padStart(2, "0")}`,
    count: 1 + (i % 7),
    revenue,
    paid,
    outstanding: i % 4 === 0 ? 0 : revenue - paid,
  };
});

// ---------------------------------------------------------------------------
// RECEIVABLES
// ---------------------------------------------------------------------------

/** The component's own band memo: AGING_ORDER, missing bucket = zero. */
const bandsOf = (rows: { bucket: string; outstanding: number; count: number }[]) =>
  AGING_ORDER.map((b) => {
    const row = rows.find((r) => r.bucket === b);
    return { bucket: b as string, outstanding: row?.outstanding ?? 0, count: row?.count ?? 0 };
  });

const receivablesInput = (
  lang: Lang,
  bandRows: { bucket: string; outstanding: number; count: number }[],
  rows: ReceivablesDocInput["rows"],
): ReceivablesDocInput => {
  const bands = bandsOf(bandRows);
  return {
    lang,
    generatedAt: AT,
    bands,
    total: bands.reduce((n, b) => n + b.outstanding, 0),
    rows,
  };
};

// SYNTHETIC — the only sheet on which the severity words can appear. Four rows,
// one per band, two of them past the thresholds: 118 days earns OVERDUE, 74 days
// earns AGEING, and the two young ones earn nothing, so the gutter column has to
// carry a word and a blank in the same table. All four bands are non-zero, which
// is also the only way to see the split bar with four parts.
const AGED_ROWS = [
  { invoiceNumber: "026-000004", customer: "Seder Facility Mang. Co.",
    confirmed: "2026-05-18", days: 118, outstanding: 22400 },
  { invoiceNumber: "026-000009", customer: "Turki Contraction Co.",
    confirmed: "2026-07-01", days: 74, outstanding: 9860 },
  { invoiceNumber: "026-000014", customer: "MMM construction Co.",
    confirmed: "2026-08-02", days: 42, outstanding: 15075 },
  { invoiceNumber: "026-000018", customer: "VVV CO.",
    confirmed: "2026-09-09", days: 4, outstanding: 7935 },
];
const AGED_BANDS = [
  { bucket: "0-30", outstanding: 7935, count: 1 },
  { bucket: "31-60", outstanding: 15075, count: 1 },
  { bucket: "61-90", outstanding: 9860, count: 1 },
  { bucket: "90+", outstanding: 22400, count: 1 },
];

// SYNTHETIC — 52 open invoices. GEOMETRY ONLY, and the case the gutter layout
// has to survive: the severity words sit in a 104px column beside a table that
// breaks across sheets, so the words must travel with their own rows.
const OPEN_LONG = Array.from({ length: 52 }, (_, i) => {
  const days = 3 + i * 3;
  return {
    invoiceNumber: `026-${String(100 + i).padStart(6, "0")}`,
    customer: `${["MMM construction", "Seder Facility", "VVV", "Al Futam", "Turki Contraction"][i % 5]} Co.`,
    confirmed: "2026-06-01",
    days,
    outstanding: 1200 + i * 415,
  };
});
const OPEN_LONG_BANDS = (() => {
  const acc = new Map<string, { outstanding: number; count: number }>();
  for (const r of OPEN_LONG) {
    const b = r.days <= 30 ? "0-30" : r.days <= 60 ? "31-60" : r.days <= 90 ? "61-90" : "90+";
    const e = acc.get(b) ?? { outstanding: 0, count: 0 };
    e.outstanding += r.outstanding;
    e.count += 1;
    acc.set(b, e);
  }
  return [...acc].map(([bucket, v]) => ({ bucket, ...v }));
})();

// ---------------------------------------------------------------------------
// NARRATIVE — the bullets arrive WRITTEN, so the harness calls the real
// buildNarrative() with the same arguments StatementsTab assembles.
// ---------------------------------------------------------------------------

const narrativeInput = (lang: Lang, start: string): NarrativeDocInput => {
  const current = monthRow(start);
  const priorStart = PNL.map((p) => p.period_start).filter((s) => s < start).sort().at(-1) ?? null;
  const prior = priorStart ? monthRow(priorStart) : null;
  const months = monthsIn(OPS, current.period_start, current.period_end);
  // The live open list, unfiltered by period — the screen reads `receivables`
  // whole here, because outstanding is a position and not a period figure.
  const openTotal = OPEN_LIVE.reduce((n, r) => n + r.outstanding, 0);
  const inPeriodInvoices = INVOICES.filter(
    (i) => i.month >= current.period_start && i.month <= current.period_end);
  const byCustomer = new Map<string, { name: string; revenue: number }>();
  for (const i of inPeriodInvoices) {
    const e = byCustomer.get(i.customer_id) ?? { name: i.customer_name, revenue: 0 };
    e.revenue += i.revenue_sar;
    byCustomer.set(i.customer_id, e);
  }
  const top = [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  return {
    lang,
    generatedAt: AT,
    label: periodLabel(current, lang),
    bullets: buildNarrative({
      current,
      prior,
      // isPeriodInProgress(period_end, today) with today = 2026-09-13.
      inProgress: current.period_end >= "2026-09-13",
      collected: sumOver(monthsIn(COLLECTIONS, current.period_start, current.period_end),
        (r) => r.collected_gross_sar),
      outstanding: openTotal,
      oldestDays: OPEN_LIVE.length ? Math.max(...OPEN_LIVE.map((r) => r.days)) : null,
      trips: sumOver(months, (r) => r.trips_total),
      delivered: sumOver(months, (r) => r.trips_delivered),
      peakTrucks: peakOver(months, (r) => r.trucks_active),
      workOrders: sumOver(months, (r) => r.work_orders),
      salesReturns: start === "2026-07-01" ? 28960 : 0,
      topCustomer: top,
      lang,
    }),
    pnl: {
      revenue: current.revenue_sar,
      operatingCost: current.operating_cost_sar,
      operatingProfit: current.operating_profit_sar,
      operatingMarginPct: current.operating_margin_pct,
    },
  };
};

// ---------------------------------------------------------------------------
// CUSTOM — the real buildReport(), not a hand-written BuiltReport. The NOTES are
// prose the builder writes beside the branch that earns each one, so a fixture
// that supplied its own would be inventing the sheet's most opinionated content.
// ---------------------------------------------------------------------------

// Only `metric_key` is read — availableMetrics() fences the catalogue on it and
// nothing else on the row reaches this far. The remaining columns are filled to
// satisfy the type, not to be rendered.
const dictRow = (metric_key: string): MetricDictionaryRow => ({
  metric_key, label: metric_key, meaning: "", formula: "", unit: "", grain: "",
  source_view: "", basis: "", caveat: null,
} as MetricDictionaryRow);

const DICTIONARY = [
  "revenue", "operating_cost", "operating_profit", "operating_margin", "operations",
  "payroll_cost", "parts_cost_at_consumption", "os_cost", "commissions_cost",
  "filling_cost", "net_profit", "expenses", "collections", "purchasing_spend",
].map(dictRow);

const DATA = {
  pnlPeriods: PNL,
  collections: COLLECTIONS,
  purchasing: [],
  operations: OPS,
  invoices: INVOICES,
  outstandingLive: [
    { invoice_id: "inv-18", outstanding_sar: 7935 },
    { invoice_id: "inv-20", outstanding_sar: 5658 },
  ],
  perTruck: [],
  maintPerTruck: [],
};

const customInput = (lang: Lang, spec: BuilderSelection, data = DATA): CustomDocInput => ({
  lang,
  generatedAt: AT,
  title: customTitle(spec, lang),
  report: buildReport(spec, data, DICTIONARY, lang),
});

// Five metrics over the four live months — the ordinary shape, and the one that
// carries both the mixed-bases note (accrual beside operational) and the ratios
// note (operating margin is recomputed per row).
const SPEC_PERIOD: BuilderSelection = {
  metricIds: [
    "revenue::revenue", "operating_cost::operatingCost", "operating_profit::operatingProfit",
    "operating_margin::operatingProfit/revenue", "operations::tripsDelivered",
  ],
  grouping: "period", periodType: "month", periodStart: null,
};

// THIRTEEN metrics, which is what the dynamic column grid exists for: the label
// column keeps 28% and the rest split 72% between them, so each head lands under
// 6% of the measure and has to WRAP while its figures stay on one line. That is
// the whole claim of lib/docs/custom.ts's extra CSS rule.
const SPEC_WIDE: BuilderSelection = {
  metricIds: [
    "revenue::revenue", "parts_cost_at_consumption::parts", "os_cost::os",
    "payroll_cost::payroll", "commissions_cost::commissions", "filling_cost::filling",
    "operating_cost::operatingCost", "operating_profit::operatingProfit",
    "expenses::expenses", "net_profit::netProfit",
    "operating_margin::operatingProfit/revenue", "collections::collections",
    "operations::tripsDelivered",
  ],
  grouping: "period", periodType: "month", periodStart: null,
};

// By customer over July — a different grouping, a count column beside two money
// columns, and the two outstanding notes the builder adds when that field is
// selected.
const SPEC_CUSTOMER: BuilderSelection = {
  metricIds: ["revenue::revenue", "revenue::invoices", "revenue::outstanding"],
  grouping: "customer", periodType: "month", periodStart: "2026-07-01",
};

// THE FIRST NOTHING — a selection with no metrics in it. Columns AND rows are
// empty, so `empty` resolves to reports.custom.noColumns.
const SPEC_NO_COLUMNS: BuilderSelection = {
  metricIds: [], grouping: "period", periodType: "month", periodStart: null,
};

// THE SECOND NOTHING — real columns over a real period that holds no invoice.
// June 2026 exists in the P&L and has no customer row anywhere, so the builder
// returns columns with no rows and `empty` resolves to reports.custom.noMatch.
// The two sentences are different claims and this is the pair that proves it.
const SPEC_NO_MATCH: BuilderSelection = {
  metricIds: ["revenue::revenue", "revenue::invoices"],
  grouping: "customer", periodType: "month", periodStart: "2026-06-01",
};

// SYNTHETIC — 39 months. GEOMETRY ONLY: the custom table is the one table in the
// pack whose column count is chosen by the reader, so it has to paginate at any
// width. Six metrics keeps the heads legible while the rows run past the fold.
const LONG_PNL: PnlPeriodRow[] = Array.from({ length: 39 }, (_, i) => {
  const m = ((i % 12) + 1).toString().padStart(2, "0");
  const y = 2024 + Math.floor(i / 12);
  const revenue = 42000 + (i % 7) * 5300;
  const cost = 38000 + (i % 5) * 4100;
  return {
    period_type: "month" as const,
    period_start: `${y}-${m}-01`,
    period_end: `${y}-${m}-28`,
    label: `${y}-${m}`,
    revenue_sar: revenue,
    parts_cost_sar: 3100 + i * 40,
    os_cost_sar: 7200,
    payroll_sar: 31300,
    commissions_sar: 2044.19,
    operating_cost_sar: cost,
    operating_profit_sar: revenue - cost,
    expenses_sar: 0,
    net_profit_sar: revenue - cost,
    operating_margin_pct: ((revenue - cost) / revenue) * 100,
    filling_cost_sar: 300,
    filling_uncosted_trips: 0,
  };
});
const SPEC_LONG: BuilderSelection = {
  metricIds: [
    "revenue::revenue", "operating_cost::operatingCost", "operating_profit::operatingProfit",
    "operating_margin::operatingProfit/revenue", "payroll_cost::payroll", "net_profit::netProfit",
  ],
  grouping: "period", periodType: "month", periodStart: null,
};

// ---------------------------------------------------------------------------
// COST — rollups at VM-input grain, read out of the live database. See header.
// ---------------------------------------------------------------------------

/**
 * One period's cost rollup: everything the sheet needs except the period's own
 * identity and its P&L row, both of which `costInput` takes from `PNL`.
 *
 * `trucks` replaces the whole `maintenance` object because the two column
 * totals beside it are the component's own `sumOver(trucks, …)` lines — summing
 * them here is restating a call, not restating a figure, and carrying them as
 * fixture data would let a typo put a maintenance table beside a foot that
 * disagrees with it.
 */
type CostRollup =
  Omit<CostDocInput, "lang" | "generatedAt" | "label" | "pnl" | "maintenance">
  & { trucks: CostDocTruck[] };

/** A `trucks` row. `total` is the memo's own `parts + os`. */
const truck = (plate: string, parts: number, os: number): CostDocTruck =>
  ({ plate, parts, os, total: parts + os });

const costInput = (lang: Lang, period: PnlPeriodRow, roll: CostRollup): CostDocInput => {
  const { trucks, ...rest } = roll;
  return {
    lang,
    generatedAt: AT,
    label: periodLabel(period, lang),
    pnl: {
      operatingCost: period.operating_cost_sar,
      parts: period.parts_cost_sar,
      os: period.os_cost_sar,
      payroll: period.payroll_sar,
      commissions: period.commissions_sar,
      filling: period.filling_cost_sar,
    },
    maintenance: {
      trucks,
      parts: sumOver(trucks, (tr) => tr.parts),
      os: sumOver(trucks, (tr) => tr.os),
    },
    ...rest,
  };
};

// JUNE 2026 — the thin month, and the one that carries THREE of this sheet's
// branches at once. No work order exists in it, so the maintenance table takes
// its empty state; ten fills went out uncosted against eighteen costed, which is
// the only live period where the amber severity word appears; and the
// commissions panel carries a NEGATIVE adjustment.
const COST_JUN: CostRollup = {
  fills: { total: 210, costed: 18, uncosted: 10 },
  byType: [
    { waterType: "non_potable", sar: 120, costed: 12, uncosted: 0 },
    { waterType: "potable", sar: 90, costed: 6, uncosted: 10 },
  ],
  byStation: [
    { key: "umm_al_hamam_station", name: "Umm Al Hamam Station", sar: 120, costed: 12, uncosted: 10 },
    { key: "manfuhah_station", name: "Manfuhah Station 2", sar: 90, costed: 6, uncosted: 0 },
  ],
  trucks: [],
  payroll: { staff: 10600, driver: 14400, total: 25000, missingSalary: 4 },
  commissions: {
    trip: 428, specials: 420, adjustments: -360, bonuses: 0, earned: 488,
    payoutCount: 2, paid: 160,
  },
  purchasing: { stockReceived: 0, receipts: 0 },
};

// AUGUST 2026 — the heaviest single month. Nine trucks, four stations, no
// uncosted fill (so the severity word is ABSENT and the gutter column with it),
// and the largest purchasing figure in the book at 414,241.50.
const COST_AUG: CostRollup = {
  fills: { total: 5365, costed: 639, uncosted: 0 },
  byType: [
    { waterType: "non_potable", sar: 4120, costed: 427, uncosted: 0 },
    { waterType: "potable", sar: 1245, costed: 212, uncosted: 0 },
  ],
  byStation: [
    { key: "manfuhah_station", name: "Manfuhah Station 2", sar: 2925, costed: 267, uncosted: 0 },
    { key: "umm_al_hamam_station", name: "Umm Al Hamam Station", sar: 2270, costed: 235, uncosted: 0 },
    { key: "shas_water_station", name: "Shas Water Station", sar: 160, costed: 2, uncosted: 0 },
    { key: "furaian_station", name: "Furaian Station", sar: 10, costed: 135, uncosted: 0 },
  ],
  trucks: [
    truck("AAA-5552", 0, 3000), truck("AAA-5556", 265, 2150), truck("BBB-1114", 785, 1150),
    truck("BBB-1115", 1240, 0), truck("KKK-7772", 0, 900), truck("TTT-4441", 824, 0),
    truck("KKK-7773", 210, 0), truck("AAA-5551", 165, 0), truck("AAA-5553", 50, 0),
  ],
  payroll: { staff: 16900, driver: 14400, total: 31300, missingSalary: 3 },
  commissions: {
    trip: 13734.93, specials: 250, adjustments: -50, bonuses: 170, earned: 14104.93,
    payoutCount: 7, paid: 7099.06,
  },
  purchasing: { stockReceived: 414241.5, receipts: 4 },
};

// Q3 2026 — twelve trucks, the fullest maintenance table the book holds, and
// the case that shows the chart's documented divergence on real data: the P&L
// prices parts at CONSUMPTION (8,652.95) while the table sums parts
// ATTRIBUTABLE TO A TRUCK (8,412.95), so the two differ by exactly 240.00 while
// the OS column reconciles to the halala. The five ranked buckets still sum to
// the masthead figure exactly, which is the only claim the chart makes.
const COST_Q3: CostRollup = {
  fills: { total: 6950, costed: 906, uncosted: 3 },
  byType: [
    { waterType: "non_potable", sar: 5160, costed: 591, uncosted: 0 },
    { waterType: "potable", sar: 1790, costed: 315, uncosted: 3 },
  ],
  byStation: [
    { key: "manfuhah_station", name: "Manfuhah Station 2", sar: 3970, costed: 415, uncosted: 0 },
    { key: "umm_al_hamam_station", name: "Umm Al Hamam Station", sar: 2810, costed: 289, uncosted: 3 },
    { key: "shas_water_station", name: "Shas Water Station", sar: 160, costed: 2, uncosted: 0 },
    { key: "furaian_station", name: "Furaian Station", sar: 10, costed: 200, uncosted: 0 },
  ],
  trucks: [
    truck("BBB-1118", 0, 6450), truck("AAA-5553", 2309.95, 2450), truck("AAA-5552", 42, 3930),
    truck("AAA-5556", 265, 2150), truck("BBB-1114", 785, 1150), truck("AAA-5551", 1405, 0),
    truck("BBB-1115", 1240, 0), truck("BBB-1111", 1240, 0), truck("KKK-7772", 42, 900),
    truck("TTT-4441", 824, 0), truck("KKK-7773", 210, 0), truck("BBB-1116", 50, 0),
  ],
  payroll: { staff: 50700, driver: 49700, total: 100400, missingSalary: 3 },
  commissions: {
    trip: 17894.84, specials: 670, adjustments: -350, bonuses: 320, earned: 18534.84,
    payoutCount: 14, paid: 13676.91,
  },
  purchasing: { stockReceived: 468763, receipts: 25 },
};

// SYNTHETIC — 41 trucks, which no live period reaches (twelve is the most, over
// Q3). GEOMETRY ONLY: the maintenance table is the tallest on this sheet, so it
// is the one that has to flow onto a second page with its heads repeated and its
// totals row intact at the end. Everything above it is Q3's, unchanged.
const COST_LONG: CostRollup = {
  ...COST_Q3,
  trucks: Array.from({ length: 41 }, (_, i) =>
    truck(
      `${["AAA", "BBB", "KKK", "TTT"][i % 4]}-${5000 + i * 3}`,
      i % 5 === 0 ? 0 : Math.round((4200 - i * 71) * 100) / 100,
      i % 3 === 0 ? 0 : 3600 - i * 58,
    ),
  ).sort((a, b) => b.total - a.total),
};

// ---------------------------------------------------------------------------
// OPERATIONS — the period scalars are the component's own helpers, see header
// ---------------------------------------------------------------------------

/**
 * One `drivers` row as the memo leaves it.
 *
 * `completion` is the memo's own line — recomputed from THIS driver's totals,
 * never averaged from the view's monthly rates — and `unassigned` is false on
 * every row below because no live month has a trip without a driver.
 */
const driver = (
  name: string, plate: string | null, trucksUsed: number,
  scheduled: number, delivered: number, notDelivered: number,
): OpsDocDriver => ({
  name, unassigned: false, plate, trucksUsed, scheduled, delivered, notDelivered,
  completion: scheduled > 0 ? (delivered / scheduled) * 100 : null,
});

const opsInput = (
  lang: Lang,
  period: PnlPeriodRow,
  drivers: OpsDocDriver[],
  ops: OperationsRow[] = OPS,
): OpsDocInput => {
  const months = monthsIn(ops, period.period_start, period.period_end);
  const trips = sumOver(months, (r) => r.trips_total);
  const delivered = sumOver(months, (r) => r.trips_delivered);
  const workOrders = sumOver(months, (r) => r.work_orders);
  const osJobs = sumOver(months, (r) => r.outsourced_jobs);
  return {
    lang,
    generatedAt: AT,
    label: periodLabel(period, lang),
    // StatementsTab's own `monthsIn(operations, …).length > 1`.
    multiMonth: months.length > 1,
    totals: {
      trips,
      delivered,
      workOrders,
      osJobs,
      maintenanceEvents: workOrders + osJobs,
      permits: sumOver(months, (r) => r.exit_permits),
      peakTrucks: peakOver(months, (r) => r.trucks_active),
      // Over zero trips this is NULL, not 0% — see the component.
      completion: trips > 0 ? (delivered / trips) * 100 : null,
    },
    months: months.map((r) => ({
      month: r.month,
      trips: r.trips_total,
      delivered: r.trips_delivered,
      trucks: r.trucks_active,
      workOrders: r.work_orders,
      osJobs: r.outsourced_jobs,
      permits: r.exit_permits,
    })),
    drivers,
    driverScheduled: sumOver(drivers, (d) => d.scheduled),
    driverDelivered: sumOver(drivers, (d) => d.delivered),
  };
};

// AUGUST 2026 — seven drivers, scheduled-descending, one of whom (Khalid 2) drove
// TWO trucks and so earns the third line in the lead cell.
const DRIVERS_AUG: OpsDocDriver[] = [
  driver("mohammed 1", "KKK-7771", 1, 143, 137, 6),
  driver("mohammed 3", "KKK-7773", 1, 121, 115, 6),
  driver("Khalid 2", "AAA-5552", 2, 118, 113, 5),
  driver("Khalid 1", "AAA-5551", 1, 117, 108, 9),
  driver("Fahad", "BBB-1111", 1, 77, 75, 2),
  driver("Fahad 3", "BBB-1115", 1, 72, 72, 0),
  driver("Khalid 3", "AAA-5553", 1, 10, 7, 3),
];

// Q3 2026 — fourteen drivers, and the live case that proves TWO things the memo
// is built for. It holds DUPLICATE NAMES on distinct driver_ids (Fahad 3 twice,
// Fahad 2 twice, Turki twice), which is exactly why the memo groups by id and
// not by name — merged, these rows would state a driver's performance wrong. And
// two plates are in the other live format, `1113 BBB` rather than `BBB-1113`,
// which is the pair worth looking at hardest in Arabic: a Latin identifier whose
// digits lead has to stay left-to-right inside an RTL cell.
const DRIVERS_Q3: OpsDocDriver[] = [
  driver("mohammed 1", "KKK-7771", 1, 197, 191, 6),
  driver("Khalid 1", "AAA-5551", 1, 173, 154, 19),
  driver("Khalid 2", "AAA-5552", 2, 154, 146, 8),
  driver("mohammed 3", "KKK-7773", 1, 134, 128, 6),
  driver("Fahad", "BBB-1111", 1, 96, 91, 5),
  driver("Fahad 3", "BBB-1115", 1, 91, 88, 3),
  driver("Khalid 3", "AAA-5553", 1, 56, 50, 6),
  driver("mohammed 2", "KKK-7772", 1, 18, 16, 2),
  driver("Fahad 2", "BBB-1114", 2, 13, 11, 2),
  driver("Turki", "1113 BBB", 1, 8, 2, 6),
  driver("Fahad 4", "1113 BBB", 1, 4, 4, 0),
  driver("Fahad 3", "1112 BBB", 1, 2, 0, 2),
  driver("Fahad 2", "1112 BBB", 1, 1, 0, 1),
  driver("Turki", "AAA-5556", 1, 1, 1, 0),
];

// SYNTHETIC — 40 drivers over the same quarter. GEOMETRY ONLY, and the hardest
// pagination case in the pack: BOTH driver tables are long at once, each row is
// three lines deep in its lead cell, and they are stacked rather than paired, so
// the second table's heads have to survive a break the first table caused.
// Row 40 is the no-driver bucket — the footnote's own row, which must sort LAST
// however large it is, and which is the only row whose name is resolved by the
// view-model rather than carried in the data.
const DRIVERS_LONG: OpsDocDriver[] = [
  ...Array.from({ length: 39 }, (_, i) =>
    driver(
      `${["mohammed", "Khalid", "Fahad", "Turki", "Abdullah"][i % 5]} ${i + 1}`,
      i % 7 === 0 ? `${1100 + i} BBB` : `${["AAA", "BBB", "KKK", "TTT"][i % 4]}-${5500 + i}`,
      1 + (i % 3),
      200 - i * 4,
      200 - i * 4 - (i % 11),
      i % 11,
    ),
  ),
  { ...driver("__ignored__", null, 0, 17, 12, 5), name: null, unassigned: true },
];

// SYNTHETIC PERIOD — May 2026, which the operations view does not cover at all.
// The ONLY way to reach this sheet's nothing: no month row, no driver row, so
// the completion rate is NULL rather than 0% and the masthead has to say so.
const MAY: PnlPeriodRow = {
  ...monthRow("2026-06-01"),
  period_start: "2026-05-01", period_end: "2026-05-31", label: "May 2026",
};

// ---------------------------------------------------------------------------
// P&L — ONE SHEET, TWO DOCUMENTS. The statement above, the VAT list below.
// ---------------------------------------------------------------------------

// v_expenses_by_category_period, ALL THREE live rows — read 2026-09-13. One
// category in the whole book, and it is the reason the "Other expenses" section
// has two branches worth rendering: it lands in July, in Q3 and in the year, so
// June, August and September reach the section's EMPTY sentence while July and
// Q3 reach the row.
const EXPENSE_CATEGORIES: ExpenseCategoryPeriodRow[] = [
  { period_type: "month", period_start: "2026-07-01", period_end: "2026-07-31",
    label: "Jul 2026", category: "SWA Permit", expenses_sar: 13000, entry_count: 1 },
  { period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30",
    label: "Q3 2026", category: "SWA Permit", expenses_sar: 13000, entry_count: 1 },
  { period_type: "year", period_start: "2026-01-01", period_end: "2026-12-31",
    label: "2026", category: "SWA Permit", expenses_sar: 13000, entry_count: 1 },
];

// THE THREE SUPPLIER VAT SOURCES, as page.tsx normalises them — `on` already
// resolved per table (received_on / request_date / coalesce(invoice_date,
// created_at::date)), so nothing below needs to know which table a row is from.
// All 47 live rows, read 2026-09-13.
//
// ELEVEN OF THE FIFTEEN ORDERS AND TEN OF THE TWENTY-SIX RECEIPTS CARRY 0.00,
// which is the fixture's most useful property and the reason these are raw rows
// rather than pre-summed pairs. A zero-VAT document is still a document, so it
// still counts: July's "VAT on purchases ordered" prints 1,021.20 under a hint
// saying ELEVEN documents. That pairing looks wrong and is right, and it is only
// checkable against rows.
const vatDoc = (on: string, vat_sar: number, rejected = false): VatSourceDocRow =>
  ({ on, vat_sar, rejected });

const VAT_ORDERS: VatSourceDocRow[] = [
  vatDoc("2026-07-23", 0), vatDoc("2026-07-23", 0),
  vatDoc("2026-07-24", 0), vatDoc("2026-07-24", 0),
  vatDoc("2026-07-25", 0), vatDoc("2026-07-25", 0), vatDoc("2026-07-25", 0),
  vatDoc("2026-07-26", 180), vatDoc("2026-07-26", 690),
  vatDoc("2026-07-27", 25.2),
  vatDoc("2026-07-27", 123.75, true), vatDoc("2026-07-27", 2542.5, true),
  vatDoc("2026-07-29", 126),
  vatDoc("2026-08-05", 10500),
  vatDoc("2026-08-29", 31.5, true),
];

const VAT_RECEIPTS: VatSourceDocRow[] = [
  vatDoc("2026-07-22", 0), vatDoc("2026-07-22", 0),
  vatDoc("2026-07-23", 0), vatDoc("2026-07-23", 0), vatDoc("2026-07-23", 0),
  vatDoc("2026-07-24", 0),
  vatDoc("2026-07-25", 0), vatDoc("2026-07-25", 0), vatDoc("2026-07-25", 0),
  vatDoc("2026-07-25", 0), vatDoc("2026-07-25", 0),
  vatDoc("2026-07-26", 123.75), vatDoc("2026-07-26", 210), vatDoc("2026-07-26", 465),
  vatDoc("2026-07-26", 810), vatDoc("2026-07-26", 3000),
  vatDoc("2026-07-27", 31.5),
  vatDoc("2026-07-27", 31.5, true), vatDoc("2026-07-27", 123.75, true),
  vatDoc("2026-07-27", 2190, true),
  vatDoc("2026-07-29", 126),
  vatDoc("2026-08-05", 9000), vatDoc("2026-08-05", 10500),
  vatDoc("2026-08-24", 34500),
  vatDoc("2026-08-29", 31.5, true),
];

// `rejected` is false on every row by construction — workshop_payments has no
// status column at all, so this source can never reach the Rejected sub-head.
const VAT_REPAIRS: VatSourceDocRow[] = [
  vatDoc("2026-07-31", 144), vatDoc("2026-07-31", 397.5), vatDoc("2026-07-31", 967.5),
  vatDoc("2026-08-01", 172.5), vatDoc("2026-08-01", 360),
  vatDoc("2026-08-02", 150), vatDoc("2026-08-02", 450),
];

/**
 * The component's own `inPeriod` / `vatLine` pair, over the rows above.
 *
 * `r.on`, period_start and period_end are all plain YYYY-MM-DD, so the string
 * comparison IS the date comparison — the component says so where it defines
 * this, and the same shape appears twice more in this file.
 */
const pnlVat = (period: PnlPeriodRow) => {
  const line = (rows: VatSourceDocRow[], rejected: boolean) => {
    const hit = rows.filter(
      (r) => r.on >= period.period_start && r.on <= period.period_end && r.rejected === rejected,
    );
    return { total: sumOver(hit, (r) => r.vat_sar), count: hit.length };
  };
  // Sales VAT sums `invoices` on `month`, exactly as the component does, and
  // deliberately NOT from the three arrays above: v_revenue_invoices already
  // defines sales VAT, and the supplier sources are base tables only because no
  // view exposes them.
  const salesDocs = INVOICES.filter(
    (i) => i.month >= period.period_start && i.month <= period.period_end,
  );
  return {
    sales: { total: sumOver(salesDocs, (i) => i.vat_sar), count: salesDocs.length },
    ordered: line(VAT_ORDERS, false),
    received: line(VAT_RECEIPTS, false),
    repairs: line(VAT_REPAIRS, false),
    orderedRejected: line(VAT_ORDERS, true),
    receivedRejected: line(VAT_RECEIPTS, true),
  };
};

const pnlInput = (lang: Lang, period: PnlPeriodRow): PnlDocInput => {
  // The screen's own two lines: priorPeriodStart() within the same grain, then
  // a lookup. Q3 returns null here — the book holds no Q2 — which is how the
  // quarter sheet reaches the no-prior branch on real data.
  const priorStart = priorPeriodStart([...PNL, Q3], period.period_type, period.period_start);
  const prior = [...PNL, Q3].find(
    (p) => p.period_type === period.period_type && p.period_start === priorStart,
  ) ?? null;
  return {
    lang,
    generatedAt: AT,
    label: periodLabel(period, lang),
    priorLabel: prior ? periodLabel(prior, lang) : null,
    // The component's call, with today = 2026-09-13 to match AT.
    inProgress: isPeriodInProgress(period.period_end, "2026-09-13"),
    current: period,
    prior,
    categories: EXPENSE_CATEGORIES.filter(
      (c) => c.period_type === period.period_type && c.period_start === period.period_start,
    ),
    vat: pnlVat(period),
  };
};

// ---------------------------------------------------------------------------
// DAILY TRIPS — read 2026-09-13 from `projects`, `project_drivers`, `drivers`,
// `trucks`, `trips` and `deferred_deliveries`, through the SAME filters
// fetchDailyTrips applies (lib/actions/daily-trips.ts:104-116): projects active
// and unarchived, drivers and trucks NOT terminated, assignments unfiltered,
// trips at `stage = 'delivered'` inside the window.
//
// THOSE FILTERS DISAGREE WITH EACH OTHER, AND THAT IS THE MOST INTERESTING PART
// OF THIS FIXTURE. `project_drivers` is read whole while `drivers` is filtered,
// so a TERMINATED driver still on a roster survives as an assignment with no
// name: R TTT carries four, and each prints a group headed by an em dash with
// "(no trips)" beside it. The same thing happens one column over — BBB-1115 is
// terminated, so every trip Fahad 3 drove for The Royal Court shows a dash for
// its plate. Both are LIVE today, and both render on the SCREEN exactly as they
// render here, which is the only thing that makes them a faithful mirror rather
// than a defect this harness would be laundering.
// ---------------------------------------------------------------------------

const DT_PROJECTS: ReportProject[] = [
  { id: "70dcb451", name: "AAA Test 6" },
  { id: "42941279", name: "Airport facilities" },
  { id: "7a94e22e", name: "King Salman Park" },
  { id: "dfab388f", name: "King Saud University" },
  { id: "fd408e6e", name: "R TTT" },
  { id: "b65e292f", name: "Rushin Project" },
  { id: "03a24ed6", name: "The Avenues" },
  { id: "00243565", name: "The Royal Court of Saudi" },
];

// Ids are the real uuids' first eight characters — shortened for legibility,
// but kept as IDS for one substantive reason: two DISTINCT drivers are both
// named "Fahad 2" (one terminated) and two more names repeat across rosters, so
// a fixture keyed on names would silently merge people the report separates.
const DT_DRIVERS: ReportDriver[] = [
  { id: "a9157ee2", name: "Fahad" },
  { id: "8e46a311", name: "Fahad 2" },
  { id: "cc2eff9e", name: "Fahad 3" },
  { id: "d4f3fed1", name: "Khalid 1" },
  { id: "e3352262", name: "Khalid 2" },
  { id: "2326d261", name: "Khalid 3" },
  { id: "4215eb40", name: "Khan" },
  { id: "9f0a2bb3", name: "mohammed 1" },
  { id: "13823f47", name: "mohammed 2" },
  { id: "98fdb0bb", name: "mohammed 3" },
  { id: "234baa37", name: "Turki" },
];

// Thirteen live plates. BBB-1115 (302bcce5) is DELIBERATELY ABSENT — it is
// terminated, so the action never fetches it, and the trips driven on it below
// resolve to a dash. Deleting it from the trips instead would hide the case.
// All thirteen are WATER TRUCKS, and no operation vehicle is added beside
// them (0201). The class is on the row because the picker groups by it, but
// this sheet renders the PROJECT TABLES, which reach these rows only through
// a plate lookup — an operation vehicle here would have no trip to appear in
// and would change no pixel, which makes it decoration rather than a case.
const DT_TRUCKS: ReportTruck[] = [
  { id: "6375dd63", plate: "AAA-5551", vehicle_class: "truck", vehicle_type_id: null },
  { id: "0f1acd56", plate: "AAA-5552", vehicle_class: "truck", vehicle_type_id: null },
  { id: "b076e19f", plate: "AAA-5553", vehicle_class: "truck", vehicle_type_id: null },
  { id: "873e01c4", plate: "AAA-5556", vehicle_class: "truck", vehicle_type_id: null },
  { id: "17e64222", plate: "BBB-1111", vehicle_class: "truck", vehicle_type_id: null },
  { id: "07237241", plate: "BBB-1114", vehicle_class: "truck", vehicle_type_id: null },
  { id: "c180b5a4", plate: "BBB-1116", vehicle_class: "truck", vehicle_type_id: null },
  { id: "63186cf1", plate: "BBB-1118", vehicle_class: "truck", vehicle_type_id: null },
  { id: "eb665862", plate: "DDD-6661", vehicle_class: "truck", vehicle_type_id: null },
  { id: "83a4f195", plate: "KKK-7771", vehicle_class: "truck", vehicle_type_id: null },
  { id: "ef6dace5", plate: "KKK-7772", vehicle_class: "truck", vehicle_type_id: null },
  { id: "46cb9f69", plate: "KKK-7773", vehicle_class: "truck", vehicle_type_id: null },
  { id: "9254b877", plate: "TTT-4441", vehicle_class: "truck", vehicle_type_id: null },
];

// All 26 roster rows on the eight active projects. The four on R TTT marked
// below are terminated drivers — see the header; they are what produces the
// dash-headed groups, and removing them would remove the case.
const DT_ASSIGN: ReportAssignment[] = (
  [
    ["70dcb451", "d4f3fed1"], ["70dcb451", "9f0a2bb3"],
    ["42941279", "2326d261"], ["42941279", "9f0a2bb3"],
    ["7a94e22e", "a9157ee2"], ["7a94e22e", "2326d261"], ["7a94e22e", "13823f47"],
    ["dfab388f", "8e46a311"], ["dfab388f", "e3352262"], ["dfab388f", "98fdb0bb"],
    ["fd408e6e", "8e46a311"],
    ["fd408e6e", "5023281b"], // Fahad 2, terminated — a SECOND driver of that name
    ["fd408e6e", "d23b068e"], // Fahad 3, terminated
    ["fd408e6e", "d08f7b45"], // Fahad 4, terminated
    ["fd408e6e", "e3352262"], ["fd408e6e", "98fdb0bb"],
    ["fd408e6e", "b6b77e34"], // Turki, terminated
    ["b65e292f", "a9157ee2"], ["b65e292f", "4215eb40"], ["b65e292f", "234baa37"],
    ["03a24ed6", "cc2eff9e"], ["03a24ed6", "4215eb40"], ["03a24ed6", "234baa37"],
    ["00243565", "cc2eff9e"], ["00243565", "d4f3fed1"], ["00243565", "13823f47"],
  ] as const
).map(([project_id, driver_id]) => ({ project_id, driver_id }));

/**
 * PER-TRIP rows, pasted whole. One tuple is one (project, driver, truck) group
 * with its rate — uniform inside a group, because the rate is the project's —
 * and one commission PER TRIP, because that figure follows the driver's terms
 * and moves trip by trip. `rate_sar: null` is an UNPRICED trip.
 */
const dtTrips = (
  groups: readonly (readonly [string, string, string, number | null, readonly number[]])[],
): ReportTrip[] =>
  groups.flatMap(([project_id, driver_id, truck_id, rate_sar, comms]) =>
    comms.map((commission_sar) => ({ project_id, driver_id, truck_id, rate_sar, commission_sar })),
  );

/** Six trips at 20.00, written as six trips at 20.00 rather than six 20s. */
const dtRep = (n: number, v: number): number[] => Array.from({ length: n }, () => v);

/**
 * GROUP-GRAIN rows, expanded. August holds 627 delivered trips and the sheet
 * prints THIRTEEN lines from them — a count, a commission and a revenue per
 * (project, driver, truck). Those three ARE the measurement; pasting 627
 * per-trip splits would assert a distribution the document never shows and
 * that nobody could check against it.
 *
 * The expansion puts the whole commission and the whole revenue on the first of
 * n rows and zero on the rest, so the count and both sums land exactly. It says
 * nothing about trip #2 — neither does the sheet. `rate_sar` is 0 rather than
 * null on those rows DELIBERATELY: null means unpriced and would invent a flag,
 * and every August group measured `unpriced = 0`.
 */
const dtAgg = (
  groups: readonly (readonly [string, string, string, number, number, number])[],
): ReportTrip[] =>
  groups.flatMap(([project_id, driver_id, truck_id, n, commission, revenue]) =>
    Array.from({ length: n }, (_, i) => ({
      project_id,
      driver_id,
      truck_id,
      rate_sar: i === 0 ? revenue : 0,
      commission_sar: i === 0 ? commission : 0,
    })),
  );

/** 2026-08-04 — 64 delivered trips across six of the eight active projects. */
const DT_AUG04: ReportTrip[] = dtTrips([
  ["70dcb451", "d4f3fed1", "6375dd63", 260, [10, 11, 12, 13, 14]],
  ["70dcb451", "9f0a2bb3", "83a4f195", 260, [10, 11, 12, 13, 14, 15, 16]],
  ["42941279", "9f0a2bb3", "83a4f195", 410, [12, 12.24, 12.48, 12.72, 12.96, 13.2, 13.44, 13.68]],
  ["7a94e22e", "a9157ee2", "17e64222", 300, [10, 10.3, 10.6, 10.9, 11.2, 11.5, 11.8, 12.1]],
  ["dfab388f", "e3352262", "0f1acd56", 400, dtRep(6, 20)],
  ["dfab388f", "98fdb0bb", "46cb9f69", 400, dtRep(7, 20)],
  ["fd408e6e", "e3352262", "0f1acd56", 160, dtRep(4, 60)],
  ["fd408e6e", "98fdb0bb", "46cb9f69", 160, dtRep(7, 60)],
  ["00243565", "cc2eff9e", "302bcce5", 420, [10, 11, 12, 13, 14, 15]],
  ["00243565", "d4f3fed1", "6375dd63", 420, [10, 11, 12, 13, 14, 15]],
]);

/** 2026-08-01 .. 2026-08-31 — 627 delivered trips, thirteen printed lines. */
const DT_AUG: ReportTrip[] = dtAgg([
  ["70dcb451", "d4f3fed1", "6375dd63", 62, 761.5, 16120],
  ["70dcb451", "9f0a2bb3", "83a4f195", 67, 827.5, 17420],
  ["42941279", "2326d261", "b076e19f", 5, 61.44, 2050],
  ["42941279", "9f0a2bb3", "83a4f195", 70, 878.64, 28700],
  ["7a94e22e", "a9157ee2", "17e64222", 75, 824.6, 22500],
  ["7a94e22e", "2326d261", "b076e19f", 2, 41.25, 600],
  ["dfab388f", "e3352262", "0f1acd56", 54, 1080, 21600],
  ["dfab388f", "98fdb0bb", "46cb9f69", 60, 1200, 24000],
  // THE ROWSPAN, and the only place in the book a real window reaches it:
  // Khalid 2 drove AAA-5552 for R TTT until the 15th and BBB-1114 on the 22nd,
  // so his name spans two lines. No SINGLE DAY has ever had a driver on two
  // trucks in one project — measured across the whole table — which is why the
  // day fixture above cannot show this and the month fixture must.
  ["fd408e6e", "e3352262", "0f1acd56", 55, 3300, 8800],
  ["fd408e6e", "e3352262", "07237241", 4, 60, 700],
  ["fd408e6e", "98fdb0bb", "46cb9f69", 55, 3220, 8840],
  ["00243565", "cc2eff9e", "302bcce5", 72, 940, 30240],
  ["00243565", "d4f3fed1", "6375dd63", 46, 540, 19320],
]);

/**
 * Both live side-log rows, in the action's order (delivery_date DESC).
 *
 * They fall on DIFFERENT DAYS — the 11th and the 1st — so no single-day sheet
 * can hold both, and one is described in English and the other in Arabic. That
 * pair is the whole reason the month fixture exists as well as the day one.
 */
const DT_DEFERRED: DeferredRow[] = [
  { id: "dd-aug11", driver_id: "234baa37", truck_id: "9254b877",
    delivery_date: "2026-08-11", description: "test 111",
    trip_count: 1, commission_sar: 50, revenue_sar: 50, created_by: null },
  { id: "dd-aug01", driver_id: "4215eb40", truck_id: "9254b877",
    delivery_date: "2026-08-01", description: "توريد ديزل من ارامكو محطة الجنوب",
    trip_count: 1, commission_sar: 50, revenue_sar: 0, created_by: null },
];

/**
 * NO LIVE TRIP IS UNPRICED. Measured 2026-09-13: ZERO rows in `trips` at stage
 * 'delivered' carry a null `rate_sar`, on any day, in any project. So the amber
 * chip, the count inside it and the gutter word that replaces its colour appear
 * on no real sheet, and this fixture is the only place any of the three can be
 * looked at.
 *
 * GEOMETRY ONLY — every figure below is invented and the day it claims never
 * happened. It is here because a severity device has to be legible in grayscale
 * BEFORE it is needed, which is the same reason the receivables fixtures carry
 * an aged synthetic case the live book cannot produce.
 */
const DT_UNPRICED: ReportTrip[] = dtTrips([
  // Five trips, two never priced. They merge into ONE row — same driver, same
  // truck — showing 5 with "2 unpriced" beneath it, UNPRICED in the gutter, and
  // a revenue covering the three priced trips only.
  ["70dcb451", "d4f3fed1", "6375dd63", 260, [10, 11, 12]],
  ["70dcb451", "d4f3fed1", "6375dd63", null, [13, 14]],
  // A clean row in the same table, so the flag reads as a mark on ONE row
  // rather than a decoration belonging to the table.
  ["70dcb451", "9f0a2bb3", "83a4f195", 260, [10, 11, 12, 13]],
]);

const dailyInput = (
  lang: Lang,
  from: string,
  to: string,
  trips: ReportTrip[],
  deferred: DeferredRow[],
  over: Partial<DailyDocInput["data"]> = {},
): DailyDocInput => ({
  lang,
  generatedAt: AT,
  // The component's own two lines (DailyTripsTab.tsx:189-192), restated here
  // because they are a DISPLAY decision the action does not make: one key for a
  // single day, both ends around an em dash for anything wider.
  periodLabel:
    from === to
      ? formatDayKeyLang(from, lang)
      : `${formatDayKeyLang(from, lang)} — ${formatDayKeyLang(to, lang)}`,
  widened: from !== to,
  data: {
    projects: DT_PROJECTS,
    assignments: DT_ASSIGN,
    drivers: DT_DRIVERS,
    trucks: DT_TRUCKS,
    trips,
    deferred,
    ...over,
  },
});

// ---------------------------------------------------------------------------
// PAYSLIP — the one sheet that is handed to the person it is about (0202).
// ---------------------------------------------------------------------------
// SYNTHETIC, and named so: unlike the statement fixtures above these were not
// lifted out of the database — the four cases exist to pin four branches, and
// no live month holds all four at once. The arithmetic is honest everywhere
// (net = base + commission + specials + adjustments + bonus − deductions),
// because a sheet whose ledger does not add up proves only that nobody read it.
//
// The BANK LINE is why the sheet enters the corpus now: 0202 put a routing
// pair on the masthead, so the print change must sit under the A4 proof like
// every other sheet. The bank is resolved through resolvePayslipBank — the
// same call the app makes — so the corpus also pins the PAIR RULE (half a
// pair renders as NOTHING) and the 0201 lookup rule (a retired bank keeps
// its name for the driver still on it).

const PS_BANKS = [
  { id: "bk-rjhi", key: "RJHI", label: "Al Rajhi Bank", label_ar: "مصرف الراجحي" },
  // RETIRED in bank_codes (active=false there). The resolver takes ALL rows,
  // so the driver still pointing here keeps the bank's name on his slip.
  { id: "bk-samb", key: "SAMB", label: "Saudi American Bank", label_ar: "البنك السعودي الأمريكي" },
];

const PS_DRIVERS = [
  { id: "ps-d1", bank_code_id: "bk-samb", iban: "SA4420000001234567891234" },
  { id: "ps-d2", bank_code_id: "bk-rjhi", iban: "SA0380000000608010167519" },
  // HALF A PAIR — an IBAN with no bank. The resolver's rule: nothing renders,
  // not a dash, not a lone account number someone would hand to a teller.
  { id: "ps-d3", bank_code_id: null, iban: "SA9160000000987654321098" },
  { id: "ps-d4", bank_code_id: "bk-rjhi", iban: "SA7710000011223344556677" },
];
const psBank = (driverId: string) =>
  resolvePayslipBank(PS_DRIVERS.find((d) => d.id === driverId), PS_BANKS);

// Every basis row in full — the vm reads identity and flags off it even when
// a frozen document owns the money figures.
const psRow = (over: Partial<PayslipBasisRow>): PayslipBasisRow => ({
  period_start: "2026-08-01",
  driver_id: "ps-d1",
  driver_name: "Omar Al-Harbi",
  base_salary_sar: 4000,
  salary_missing: false,
  hire_date_missing: false,
  commission_basis: "none",
  commission_settled: false,
  payout_count: 0,
  commission_sar: 0,
  specials_sar: 0,
  adjustments_sar: 0,
  bonus_sar: 0,
  issued_payslip_id: null,
  issued_payslip_number: null,
  terminated: false,
  termination_date: null,
  net_sar: 4000,
  violation_deduction_sar: 0,
  deductions_sar: 0,
  unabsorbed_sar: 0,
  ...over,
});

const PS_VTYPES: ViolationType[] = [
  { id: "vt-speed", key: "speeding", label: "Speeding", label_ar: "تجاوز السرعة", is_default: true, active: true },
  // Retired type — the live branch must still print its name (typeById holds
  // every type, active or not, same as the app's fetch).
  { id: "vt-park", key: "parking", label: "Illegal Parking", label_ar: "وقوف خاطئ", is_default: false, active: false },
];

const psFine = (over: Partial<DriverViolationView>): DriverViolationView => ({
  id: "v-0",
  driver_id: "ps-d2",
  violation_type_id: "vt-speed",
  ref_no: "TRF-0000",
  amount_sar: 0,
  violation_date: "2026-09-05",
  payment_status: "not_paid",
  note: null,
  voided_at: null,
  created_by: null,
  created_at: "2026-09-05T08:00:00+03:00",
  image_path: null,
  settlement: { state: "unsettled", locked: false, payslipId: null },
  ...over,
});

// ISSUED August — the frozen branch with everything on it: a settled payout
// (chip ON), covered trips, two frozen fines fully absorbed, and a bank line
// resolved through a RETIRED bank. 4000+850+150+200+300−250 = 5250.
const PS_DOC_ISSUED: IssuedPayslipRow = {
  id: "ps-doc-1",
  payslip_number: "PS-2026-0007",
  driver_id: "ps-d1",
  period_start: "2026-08-01",
  issued_at: "2026-09-02T10:00:00+03:00",
  issued_by: "turkislimah@gmail.com",
  commission_basis: "paid",
  commission_settled: true,
  base_salary_sar: 4000,
  commission_sar: 850,
  specials_sar: 150,
  adjustments_sar: 200,
  bonus_sar: 300,
  violation_deduction_sar: 250,
  deductions_sar: 250,
  unabsorbed_sar: 0,
  net_sar: 5250,
  snapshot: {
    driver_name: "Omar Al-Harbi",
    salary_at_issue: 4000,
    commission_basis: "paid",
    payout_count: 1,
    payouts: [{
      id: "po-1", period_label: "Aug 1 – Aug 31", paid_at: "2026-09-02",
      base_sar: 700, specials_sar: 150, adjustments_sar: 0, bonus_sar: 0, total_sar: 850,
    }],
    covered_trips: { count: 38, first_trip: "2026-08-01", last_trip: "2026-08-31" },
    violations: {
      month_total_sar: 250,
      absorbed_sar: 250,
      unabsorbed_sar: 0,
      // Labels FROZEN at issue — the sheet prints these, not the live types.
      items: [
        { id: "v-f1", ref_no: "TRF-88214", type_key: "speeding", type_label: "Speeding", type_label_ar: "تجاوز السرعة", amount_sar: 150, violation_date: "2026-08-09", payment_status: "paid" },
        { id: "v-f2", ref_no: "TRF-88790", type_key: "parking", type_label: "Illegal Parking", type_label_ar: "وقوف خاطئ", amount_sar: 100, violation_date: "2026-08-21", payment_status: "not_paid" },
      ],
    },
  },
};

// ISSUED August, EMPTY EVERYTHING — no commission, no fines (the section still
// prints, with its "none" sentence), no payouts, and NO BANK LINE: ps-d3
// carries an IBAN but no bank, and half a pair renders as nothing.
const PS_DOC_NOBANK: IssuedPayslipRow = {
  id: "ps-doc-2",
  payslip_number: "PS-2026-0011",
  driver_id: "ps-d3",
  period_start: "2026-08-01",
  issued_at: "2026-09-02T10:05:00+03:00",
  issued_by: "turkislimah@gmail.com",
  commission_basis: "none",
  commission_settled: false,
  base_salary_sar: 3200,
  commission_sar: 0,
  specials_sar: 0,
  adjustments_sar: 0,
  bonus_sar: 0,
  violation_deduction_sar: 0,
  deductions_sar: 0,
  unabsorbed_sar: 0,
  net_sar: 3200,
  snapshot: { driver_name: "Tariq Al-Dossari", salary_at_issue: 3200, commission_basis: "none", payout_count: 0 },
};

const psInput = (lang: Lang, over: Partial<PayslipDocInput>): PayslipDocInput => ({
  lang,
  generatedAt: AT,
  row: psRow({}),
  doc: null,
  violations: [],
  violationTypes: PS_VTYPES,
  running: false,
  bank: null,
  ...over,
});

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const written: string[] = [];
const write = (name: string, lang: Lang, html: string) => {
  const f = `${OUT}/${name}.${lang}.html`;
  writeFileSync(f, html);
  written.push(f);
};

for (const lang of ["en", "ar"] as const) {
  // --- Revenue -------------------------------------------------------------
  const revenue: [string, RevenueDocInput][] = [
    ["revenue-jul-live", revenueInput(lang, "2026-07-01", JUL_ROWS, JUL_RETURNS)],
    ["revenue-sep-live", revenueInput(lang, "2026-09-01", SEP_ROWS, [])],
    // June 2026 holds no invoice at all: the by-customer table, the chart and
    // the returns table each take their own empty state on one sheet.
    ["revenue-jun-empty", revenueInput(lang, "2026-06-01", [], [])],
    ["revenue-LONG-synthetic", revenueInput(lang, "2026-08-01", REV_LONG_ROWS, JUL_RETURNS)],
  ];
  for (const [name, input] of revenue) write(name, lang, buildRevenueHtml(buildRevenueVm(input)));

  // --- Receivables ---------------------------------------------------------
  const receivables: [string, ReceivablesDocInput][] = [
    ["receivables-live", receivablesInput(lang, AGING_LIVE, OPEN_LIVE)],
    ["receivables-aged-synthetic", receivablesInput(lang, AGED_BANDS, AGED_ROWS)],
    ["receivables-LONG-synthetic", receivablesInput(lang, OPEN_LONG_BANDS, OPEN_LONG)],
    ["receivables-empty", receivablesInput(lang, [], [])],
  ];
  for (const [name, input] of receivables) {
    write(name, lang, buildReceivablesHtml(buildReceivablesVm(input)));
  }

  // --- Narrative -----------------------------------------------------------
  const narrative: [string, NarrativeDocInput][] = [
    // September is the CURRENT month on 2026-09-13, so it carries the
    // in-progress bullet and a negative headline figure with no severity mark.
    ["narrative-sep-live", narrativeInput(lang, "2026-09-01")],
    // July is closed, profitable, and the only month with a positive margin.
    ["narrative-jul-live", narrativeInput(lang, "2026-07-01")],
    // June has NO revenue, so its margin is null — the em-dash stat — and no
    // prior period exists, which is a second branch in the same sheet.
    ["narrative-jun-live", narrativeInput(lang, "2026-06-01")],
  ];
  for (const [name, input] of narrative) {
    write(name, lang, buildNarrativeHtml(buildNarrativeVm(input)));
  }

  // --- Custom --------------------------------------------------------------
  const custom: [string, CustomDocInput][] = [
    ["custom-period-live", customInput(lang, SPEC_PERIOD)],
    ["custom-wide-live", customInput(lang, SPEC_WIDE)],
    ["custom-customer-live", customInput(lang, SPEC_CUSTOMER)],
    ["custom-empty-noColumns", customInput(lang, SPEC_NO_COLUMNS)],
    ["custom-empty-noMatch", customInput(lang, SPEC_NO_MATCH)],
    ["custom-LONG-synthetic", customInput(lang, SPEC_LONG, { ...DATA, pnlPeriods: LONG_PNL })],
  ];
  for (const [name, input] of custom) write(name, lang, buildCustomHtml(buildCustomVm(input)));

  // --- Cost ----------------------------------------------------------------
  const cost: [string, CostDocInput][] = [
    ["cost-aug-live", costInput(lang, monthRow("2026-08-01"), COST_AUG)],
    // June is the only live period with an uncosted fill, so it is the only one
    // on which the amber gutter word exists at all — and its maintenance table
    // is empty in the same sheet.
    ["cost-jun-live", costInput(lang, monthRow("2026-06-01"), COST_JUN)],
    ["cost-q3-live", costInput(lang, Q3, COST_Q3)],
    ["cost-LONG-synthetic", costInput(lang, Q3, COST_LONG)],
  ];
  for (const [name, input] of cost) write(name, lang, buildCostHtml(buildCostVm(input)));

  // --- Operations ----------------------------------------------------------
  const ops: [string, OpsDocInput][] = [
    // One month: no by-month table, no chart, and the truck count carries no
    // multi-month qualifier. The single-month branch of all three gates.
    ["ops-aug-live", opsInput(lang, monthRow("2026-08-01"), DRIVERS_AUG)],
    // Three months, all of them with trips — the chart's honesty gate open.
    ["ops-q3-live", opsInput(lang, Q3, DRIVERS_Q3)],
    ["ops-LONG-synthetic", opsInput(lang, Q3, DRIVERS_LONG)],
    ["ops-empty-synthetic", opsInput(lang, MAY, [])],
  ];
  for (const [name, input] of ops) write(name, lang, buildOpsHtml(buildOpsVm(input)));

  // --- P&L -----------------------------------------------------------------
  const pnl: [string, PnlDocInput][] = [
    // JULY — the sheet with everything on it. A prior period exists, so all
    // five columns are populated; it is the only profitable month, so the
    // margin line carries a positive point move; it has the book's one expense
    // category; three fills went out uncosted, so the amber gutter word is
    // there; and it is the only month with REJECTED supplier documents, which
    // is the conditional sub-head in the VAT list.
    ["pnl-jul-live", pnlInput(lang, monthRow("2026-07-01"))],
    // SEPTEMBER — IN PROGRESS on 2026-09-13, so the caveat sits under the
    // masthead qualifying every figure below it. Negative net profit (a signed
    // masthead figure with no severity mark), no expense category, and the
    // Zakat section takes its loss branch: 2.5% of a loss is not a liability,
    // so the note gains a second sentence.
    ["pnl-sep-live", pnlInput(lang, monthRow("2026-09-01"))],
    // JUNE — NO PRIOR PERIOD. Three of the five columns are em dashes on every
    // row, the margin is null on both sides so its point cell is a dash too,
    // and revenue is 0.00 against a real cost base. Ten uncosted fills, the
    // most in the book. The VAT list is entirely EMPTY here — no invoice, no
    // supplier document falls in June — so all four rows print 0.00 against a
    // count of zero, and the Rejected sub-head is absent.
    ["pnl-jun-live", pnlInput(lang, monthRow("2026-06-01"))],
    // Q3 — the quarter, and the second no-prior case (the book holds no Q2).
    // Proves the sheet is grain-agnostic: the label, the expense category and
    // the VAT window all follow period_type, and the margin is the quarter's
    // own -7% rather than an average of its three months.
    ["pnl-q3-live", pnlInput(lang, Q3)],
  ];
  for (const [name, input] of pnl) write(name, lang, buildPnlHtml(buildPnlVm(input)));

  // --- Daily trips ---------------------------------------------------------
  const daily: [string, DailyDocInput][] = [
    // ONE DAY — 2026-08-04, the book's widest: six of the eight active projects
    // worked it, so the sheet carries six populated tables and two in which
    // every assigned driver is idle. Nothing was entered in the side-log on
    // that date, which puts the manual half's EMPTY state on the same sheet as
    // the busiest project half. Per-trip figures, pasted.
    ["daily-aug04-live", dailyInput(lang, "2026-08-04", "2026-08-04", DT_AUG04, [])],
    // AUGUST — the month grain, and the only REAL window that reaches the
    // rowSpan (see DT_AUG). Both side-log rows fall inside it, one described in
    // Arabic and one in English, and a widened period is what turns their date
    // line on. Group-grain figures, expanded.
    ["daily-aug-live", dailyInput(lang, "2026-08-01", "2026-08-31", DT_AUG, DT_DEFERRED)],
    // The gutter word and the chip that counts it — unreachable on live data.
    ["daily-unpriced-synthetic", dailyInput(lang, "2026-08-04", "2026-08-04", DT_UNPRICED, [], {
      projects: DT_PROJECTS.slice(0, 1),
      assignments: DT_ASSIGN.filter((a) => a.project_id === "70dcb451"),
    })],
    // A project created before anyone is assigned to it. The kit refuses to
    // print a totals foot under an empty body, so this is the one place the
    // sheet says something its screen does not — the app's own "No drivers
    // assigned." in place of a row of zeroes. Real project, roster emptied.
    ["daily-empty-noDrivers-synthetic", dailyInput(lang, "2026-09-13", "2026-09-13", [], [], {
      projects: [DT_PROJECTS[5]!],
      assignments: [],
    })],
    // No active project at all: the whole project half collapses to one note,
    // and the side-log still prints its own heading, rule and empty state.
    ["daily-empty-noProjects-synthetic", dailyInput(lang, "2026-09-13", "2026-09-13", [], [], {
      projects: [],
      assignments: [],
    })],
  ];
  for (const [name, input] of daily) write(name, lang, buildDailyTripsHtml(buildDailyDocVm(input)));

  // --- Payslip -------------------------------------------------------------
  const payslip: [string, PayslipDocInput][] = [
    // The frozen branch with everything on it: settled payout, covered trips,
    // two frozen fines fully absorbed, retired-bank line via the resolver.
    ["payslip-issued-synthetic", psInput(lang, {
      row: psRow({
        commission_basis: "paid", commission_settled: true, payout_count: 1,
        commission_sar: 850, specials_sar: 150, adjustments_sar: 200, bonus_sar: 300,
        issued_payslip_id: "ps-doc-1", issued_payslip_number: "PS-2026-0007",
        net_sar: 5250, violation_deduction_sar: 250, deductions_sar: 250,
      }),
      doc: PS_DOC_ISSUED,
      bank: psBank("ps-d1"),
    })],
    // The RUNNING month, unissued: marks on the masthead, the standfirst
    // saying why, LIVE fines (one against a retired type), earned-basis note.
    // 3500+400−300 = 3600.
    ["payslip-unissued-synthetic", psInput(lang, {
      row: psRow({
        period_start: "2026-09-01", driver_id: "ps-d2", driver_name: "Fahd Al-Qahtani",
        base_salary_sar: 3500, commission_basis: "earned", commission_sar: 400,
        net_sar: 3600, violation_deduction_sar: 300, deductions_sar: 300,
      }),
      violations: [
        psFine({ id: "v-l1", ref_no: "TRF-90311", amount_sar: 120, violation_date: "2026-09-04", payment_status: "paid" }),
        psFine({ id: "v-l2", ref_no: "TRF-90557", violation_type_id: "vt-park", amount_sar: 180, violation_date: "2026-09-08" }),
      ],
      running: true,
      bank: psBank("ps-d2"),
    })],
    // Issued with NOTHING on it — zero commission, no fines (the section still
    // prints its "none" sentence), and NO bank line: ps-d3 is half a pair.
    ["payslip-nobank-synthetic", psInput(lang, {
      row: psRow({
        driver_id: "ps-d3", driver_name: "Tariq Al-Dossari", base_salary_sar: 3200,
        issued_payslip_id: "ps-doc-2", issued_payslip_number: "PS-2026-0011", net_sar: 3200,
      }),
      doc: PS_DOC_NOBANK,
      bank: psBank("ps-d3"),
    })],
    // The clamp's worst month: fines outran the pay, so Deductions shows what
    // was TAKEN (800), the caveat says what was not (400), and net is zero.
    // Closed month, unissued — issue is allowed, which is its own standfirst.
    ["payslip-unabsorbed-synthetic", psInput(lang, {
      row: psRow({
        driver_id: "ps-d4", driver_name: "Nasser Al-Shammari", base_salary_sar: 800,
        net_sar: 0, violation_deduction_sar: 1200, deductions_sar: 800, unabsorbed_sar: 400,
      }),
      violations: [
        psFine({ id: "v-l3", driver_id: "ps-d4", ref_no: "TRF-87102", amount_sar: 1200, violation_date: "2026-08-15" }),
      ],
      bank: psBank("ps-d4"),
    })],
  ];
  for (const [name, input] of payslip) write(name, lang, buildPayslipHtml(buildPayslipVm(input)));
}

for (const f of written) console.log(f);
console.log(`\n${written.length} sheets written to ${OUT}`);
