// Reports — row types for the semantic layer, plus PRESENTATION helpers only.
//
// THE CONTRACT (migration 0098): every metric is defined ONCE, in SQL. This
// file must never re-derive one. What lives here is strictly:
//   * TypeScript shapes mirroring the view columns, so the UI is type-safe.
//   * Period SELECTION (which month is "current", which is "prior").
//   * Period-over-period COMPARISON of two numbers the views already computed.
//   * Formatting.
//
// The test for anything added here: if the number could disagree with what the
// same view returns, it does not belong in this file — it belongs in a
// migration. Composing two defined metrics into a ratio is allowed (see
// cashCoverage below); recomputing either side of that ratio is not.

import { COST_COLOR } from "@/lib/cost-colors";
import { t, fill, plural, type Lang, type TKey } from "@/lib/i18n";

// --- View row shapes -------------------------------------------------------
// One type per view, columns verbatim. Names match the SQL exactly so a
// mismatch is a compile error rather than a silent undefined.

export type PnlRow = {
  month: string;
  revenue_sar: number;
  parts_cost_sar: number;
  os_cost_sar: number;
  payroll_sar: number;
  commissions_sar: number;
  operating_cost_sar: number;
  operating_profit_sar: number;
  expenses_sar: number;
  net_profit_sar: number;
  /** Null in a month with no revenue — a margin on nothing is not a number. */
  operating_margin_pct: number | null;
  /** Station fill cost (0112). The FIFTH operating-cost bucket. */
  filling_cost_sar: number;
  /**
   * Filled trips whose station has no price for their water type. Their cost
   * is UNKNOWN, not zero — sum() skipped them, so filling_cost_sar is short by
   * an unknown amount. Must be shown wherever the money is.
   */
  filling_uncosted_trips: number;
};

export type CollectionsRow = {
  month: string;
  collected_gross_sar: number;
  invoices_paid: number;
};

export type RevenueMonthRow = {
  month: string;
  revenue_sar: number;
  vat_sar: number;
  invoice_count: number;
  customer_count: number;
};

export type ReceivableRow = {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  customer_name: string;
  confirmed_at: string;
  period_end: string | null;
  outstanding_sar: number;
  days_outstanding: number;
  aging_bucket: AgingBucket;
};

export type AgingRow = {
  aging_bucket: AgingBucket;
  outstanding_sar: number;
  invoice_count: number;
};

type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

/** Fixed order — the view returns these grouped, not sorted meaningfully. */
export const AGING_ORDER: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

export type PayrollRow = {
  month: string;
  staff_salary_sar: number;
  driver_salary_sar: number;
  /** People employed in the month with no salary recorded — they contribute 0. */
  people_missing_salary: number;
  /** Always true today: salaries have no history, see 0098 limitation A. */
  salary_is_current_snapshot: boolean;
};

export type OperationsRow = {
  month: string;
  trips_total: number;
  trips_delivered: number;
  trucks_active: number;
  work_orders: number;
  outsourced_jobs: number;
  exit_permits: number;
};

export type RevenuePerTruckRow = {
  month: string;
  truck_id: string;
  plate: string;
  allocated_revenue_sar: number;
  trips: number;
};

/**
 * Per-truck maintenance (migration 0099). THREE separately named measures, on
 * purpose — "maintenance cost per truck" used to mean two different things.
 *
 *   maintenance_parts_sar  parts only. The narrower measure, and what the
 *                          Consumption page's top-costly-trucks still shows.
 *   os_payments_sar        outsourced vendor spend for that truck.
 *   total_maintenance_sar  the two added — the real cost of keeping it running.
 *
 * Never collapse these into one number in the UI without saying which it is.
 * Live, outsourced spend is roughly 2.8x parts, so the parts-only figure is
 * the SMALLER half and reads as a wild understatement if presented alone.
 */
export type MaintenancePerTruckRow = {
  month: string;
  truck_id: string;
  plate: string;
  maintenance_parts_sar: number;
  distinct_parts: number;
  os_payments_sar: number;
  os_payment_count: number;
  total_maintenance_sar: number;
};

// --- Period grains (migration 0100) ----------------------------------------

export type PeriodType = "month" | "quarter" | "year";

export const PERIOD_TYPES: { key: PeriodType; labelKey: TKey }[] = [
  { key: "month", labelKey: "reports.grain.month" },
  { key: "quarter", labelKey: "reports.grain.quarter" },
  { key: "year", labelKey: "reports.grain.year" },
];

export type PnlPeriodRow = {
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  label: string;
  revenue_sar: number;
  parts_cost_sar: number;
  os_cost_sar: number;
  payroll_sar: number;
  commissions_sar: number;
  operating_cost_sar: number;
  operating_profit_sar: number;
  expenses_sar: number;
  net_profit_sar: number;
  /** Recomputed from the period's own revenue — never an average of months. */
  operating_margin_pct: number | null;
  /** Station fill cost (0113). Summed across the period's months. */
  filling_cost_sar: number;
  /**
   * Uncosted fills in the period. A trip COUNT, so it is genuinely additive
   * across months — unlike people_missing_salary and trucks_active, which are
   * per-month states and must never be summed (0098).
   */
  filling_uncosted_trips: number;
};

export type ExpenseCategoryPeriodRow = {
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  label: string;
  category: string;
  expenses_sar: number;
  entry_count: number;
};

/** Indicative Zakat rate. An ESTIMATING convention, not a ZATCA assessment. */
const ZAKAT_RATE = 0.025;

export type IndicativeZakat = {
  /** Echo of the input — the P&L's own net profit, under its Zakat name. */
  profitBeforeZakat: number;
  /** Clamped to 0 in a loss period: a negative Zakat credit does not exist. */
  estimate: number;
  profitAfterZakat: number;
  /** False in a loss period, where the estimate is 0 rather than negative. */
  applies: boolean;
};

/**
 * Indicative Zakat — 2.5 % of profit before Zakat.
 *
 * THIS IS NOT A BREACH OF THE RULE AT THE TOP OF THIS FILE, and it is worth
 * saying why, because it looks like one. That rule forbids RE-deriving a figure
 * SQL already defines, and its test is "could this disagree with what the same
 * view returns". No view returns Zakat. There is no second expression to
 * disagree with — this function is the only one, which is the property the rule
 * exists to protect.
 *
 * It is also not a measurement. Real Zakat is charged on a ZATCA balance-sheet
 * base (capital, reserves and long-term liabilities, less deductible long-term
 * assets) that this schema does not hold. Promoting an estimate into the
 * semantic layer would dress it as a definition of the company's Zakat, which
 * it is not. It belongs beside the number it annotates.
 *
 * Input is PnlPeriodRow.net_profit_sar at whatever grain is on screen, so this
 * works for month, quarter and year without knowing which it was given.
 *
 * Callers MUST label the result as an estimate. See StatementsTab.
 */
export function indicativeZakat(profitBeforeZakat: number): IndicativeZakat {
  // Round BEFORE subtracting so the printed figures foot exactly: at the 2dp
  // the statement shows, after === before - estimate with no drifting cent.
  const estimate = Math.round(Math.max(profitBeforeZakat, 0) * ZAKAT_RATE * 100) / 100;
  return {
    profitBeforeZakat,
    estimate,
    profitAfterZakat: profitBeforeZakat - estimate,
    applies: profitBeforeZakat > 0,
  };
}

/** Periods of one grain, newest first. */
export function periodsOf<T extends { period_type: PeriodType; period_start: string }>(
  rows: T[], type: PeriodType,
): T[] {
  return rows
    .filter((r) => r.period_type === type)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

/** The period immediately before `start` within the same grain. */
export function priorPeriodStart(rows: PnlPeriodRow[], type: PeriodType, start: string): string | null {
  const asc = periodsOf(rows, type).map((r) => r.period_start).reverse();
  const i = asc.indexOf(start);
  return i > 0 ? asc[i - 1] : null;
}

/**
 * Is this period still running?
 *
 * Derived from dates, not from a stored column. The applied 0100 dropped the
 * months_in_period count the draft carried, and this recovers the same fact
 * honestly: a period whose end date has not passed cannot be complete. It
 * matters because costs accrue daily while revenue is recognised at invoice
 * confirmation, so an in-flight period always looks cost-heavy.
 */
export function isPeriodInProgress(periodEnd: string, today: string): boolean {
  return periodEnd >= today;
}

// --- Statement sources -----------------------------------------------------

export type RevenueInvoiceRow = {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  customer_name: string;
  month: string;
  confirmed_at: string;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  revenue_sar: number;
  vat_sar: number;
  gross_sar: number;
  amount_due_sar: number;
  is_paid: boolean;
};

/**
 * 0137 — what is STILL outstanding on a confirmed invoice, right now.
 *
 * `RevenueInvoiceRow.amount_due_sar` above is the DOCUMENT'S OWN figure, frozen
 * at confirm. For a PREPAID customer that figure goes stale the moment the
 * balance moves: a top-up after confirmation covers work the invoice still
 * shows as due. This view applies the live balance and caps the result at the
 * frozen figure, so it can only ever REDUCE a receivable, never invent one.
 *
 * THE CAP IS SQL'S JOB, NOT TYPESCRIPT'S. Every consumer joins on invoice_id
 * and adds outstanding_sar. Restating the rule here would be a second
 * expression of it, which is exactly the drift 0098's semantic layer exists to
 * prevent — and this rule reads a customer's whole invoice set in date order,
 * so a per-row TS reimplementation could not even be correct.
 *
 * DELIBERATELY NARROW. The view publishes eleven columns (the payment mode it
 * resolved, the balance, the shortfall, the basis it used); only the two below
 * are read by anything, so only those two cross the boundary. Carrying a figure
 * nothing renders is how two versions of one number start to drift — the same
 * reason DailyOps.revenue stopped being threaded. Widen this when a consumer
 * actually needs a column, not in advance.
 */
export type InvoiceOutstandingLiveRow = {
  invoice_id: string;
  outstanding_sar: number;
};

/**
 * invoice_id -> outstanding_sar, built once per consumer.
 *
 * ABSENT MEANS ZERO, and that is a property of the view rather than an
 * assumption made here: it emits a row for EVERY confirmed, unpaid, non-void
 * invoice, including the ones whose outstanding is 0.00. So a miss means the
 * invoice is paid, void or unconfirmed — all of which owe nothing — and the
 * `?? 0` at each call site is a fact, not a fallback.
 */
export function outstandingLiveIndex(rows: InvoiceOutstandingLiveRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.invoice_id, r.outstanding_sar]));
}

/**
 * Voided-after-confirmation invoices — "Sales Returns" in the UI.
 *
 * Note this view carries customer_id but NOT customer_name, and a voided
 * invoice is by definition absent from v_revenue_invoices, so there is no
 * reliable name to join to. The statement shows what the view actually has
 * rather than guessing at a name.
 */
export type SalesReturnRow = {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  month: string;
  voided_at: string;
  void_reason: string | null;
  reversed_revenue_sar: number;
};

export type CommissionsRow = {
  month: string;
  trip_commission_sar: number;
  specials_sar: number;
  adjustments_sar: number;
  bonus_sar: number;
};

export type CommissionsPaidRow = {
  month: string;
  commissions_paid_sar: number;
  payout_count: number;
};

// --- Period aggregation: what TypeScript may and may not do ----------------
//
// Several views are month-grained only (per-truck maintenance, purchasing,
// payroll, commissions, operations). The statements are period-based, so those
// rows have to be combined when the reader picks a quarter or a year.
//
// THE RULE, and it is not a style preference:
//
//   ALLOWED  — selecting, filtering and SUMMING rows a view produced, when the
//              measure is additive. Money adds. Counts of events add.
//
//   FORBIDDEN — recomputing a metric's formula, any RATIO, and any DISTINCT
//              count. Ratios come from SQL (that is what 0100 exists for:
//              averaging monthly margins turns -38.7% into +20.5%).
//
// Two live measures fail the additivity test and are handled explicitly rather
// than summed, because summing them produces a number that looks plausible:
//
//   people_missing_salary — summing Jul+Aug gives 6; the truth is 3. It is a
//     per-month state, not an event count.
//
//   trucks_active — a DISTINCT count. Summing double-counts any truck active
//     in two months. Today Jul(10)+Aug(1) happens to equal the true distinct
//     11, which is worse than a visible error: a test would pass on a
//     coincidence. A true period-level distinct count cannot be recovered from
//     monthly rows at all, so it is NOT faked — the statement reports the
//     highest month and says so.

/** Month-grain rows falling inside a period. */
export function monthsIn<T extends { month: string }>(
  rows: T[], periodStart: string, periodEnd: string,
): T[] {
  return rows.filter((r) => r.month >= periodStart && r.month <= periodEnd);
}

/** Sum one additive column across a period. See the rule above. */
export function sumOver<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((n, r) => n + pick(r), 0);
}

/** Highest monthly value — for measures that must never be summed. */
export function peakOver<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((n, r) => Math.max(n, pick(r)), 0);
}

/**
 * A row of the METRICS DICTIONARY (report_metrics, migration 0098).
 *
 * This is the vocabulary half of the semantic layer — the part a human or an
 * agent READS to learn what a metric means before using it. It is what makes a
 * future custom-report generator safe: constrained to these keys and the views
 * they name, it can only produce numbers that already agree with this page.
 */
export type MetricDictionaryRow = {
  metric_key: string;
  label: string;
  meaning: string;
  formula: string;
  unit: string;
  grain: string;
  source_view: string;
  basis: string;
  caveat: string | null;
};

/**
 * The `basis` enum in words — ONE expression, read by all three surfaces that
 * print it: the dictionary popup's group headings, the builder's metric picker,
 * and the generated report's column sub-heading. Each of those rendered the raw
 * column value before, so three copies of this map was the alternative.
 *
 * A MISS FALLS THROUGH TO THE RAW STRING rather than rendering nothing. Every
 * one of those surfaces promises that an unrecognised basis still appears, so a
 * fifth one added by a future migration shows up untranslated instead of
 * vanishing. `basis` is typed `string` here for exactly that reason — it is a
 * database column, not a closed TS union.
 */
const BASIS_TKEY: Record<string, TKey> = {
  accrual: "reports.basis.accrual",
  cash: "reports.basis.cash",
  state: "reports.basis.state",
  operational: "reports.basis.operational",
};

export const basisLabel = (basis: string, lang: Lang): string =>
  BASIS_TKEY[basis] ? t(BASIS_TKEY[basis], lang) : basis;

/**
 * Per-driver operations (migration 0101).
 *
 * THE DRIVER IS THE UNIT MEASURED. The truck is context for reading the
 * column, never a measure under it — `primary_plate` is that driver's
 * most-used truck and `trucks_used` says when there was more than one.
 *
 * `driver_id` and `driver_name` are NULL for trips with no driver recorded.
 * That row is kept deliberately (the view groups before joining drivers) so
 * the driver figures always sum to the period total — the UI labels it
 * "Unassigned" rather than dropping it.
 *
 * `completion_rate_pct` is recomputed by the VIEW from that driver's own
 * scheduled/delivered counts. Never average it across drivers.
 */
export type OperationsByDriverRow = {
  month: string;
  driver_id: string | null;
  driver_name: string | null;
  primary_truck_id: string | null;
  primary_plate: string | null;
  trucks_used: number;
  trips_scheduled: number;
  trips_delivered: number;
  trips_not_delivered: number;
  completion_rate_pct: number | null;
};

export type TopupsRow = { month: string; topups_sar: number; topup_count: number };

export type PurchasingRow = {
  month: string;
  received_stock_value_sar: number;
  receipt_count: number;
};

/**
 * ONE DOCUMENT THAT CARRIES VAT, normalised from a base table. Three arrays of
 * this shape — stock receipts, purchase orders, workshop payments — back the
 * ITEMISED VAT LIST printed under the P&L. page.tsx does the normalising.
 *
 * DISPLAY ONLY. VAT is a liability collected for ZATCA, not income and not
 * cost, so no figure derived from these rows may ever be added to, subtracted
 * from, or netted against a P&L figure. 0098 rule 2 already excludes VAT from
 * revenue for the same reason.
 *
 * BASE TABLES, AND THAT IS NOT A HOLE IN THE CONTRACT AT THE TOP OF THIS FILE.
 * The rule forbids RE-DERIVING a metric SQL already owns, and its test is
 * "could this number disagree with what the same view returns". No view returns
 * supplier VAT, so there is nothing to disagree with — and the panel does not
 * aggregate across sources at all. It LISTS each source's own vat_sar beside a
 * label saying where it came from. No total, no net, no netting anywhere, so
 * there is no derived figure that could drift.
 *
 * SALES VAT IS NOT ONE OF THESE ARRAYS. v_revenue_invoices.vat_sar already
 * defines it and the page already fetches those rows, so the panel sums the
 * ones it holds rather than opening a second path to a number SQL owns.
 */
export type VatSourceDocRow = {
  /**
   * The date this document is reported under, a plain YYYY-MM-DD so a period
   * filter is a string comparison. The BASIS differs per source, and each one
   * matches the statement that already reports those documents — page.tsx
   * resolves all three in one place and names them.
   */
  on: string;
  vat_sar: number;
  /**
   * Rejected documents are listed on their OWN line, never inside a source's
   * figure and never subtracted from one.
   *
   * A boolean, not the raw status: `rejected` is the only distinction the panel
   * draws, and workshop_payments has no status column at all, so a status field
   * would force every consumer to know which sources have one.
   */
  rejected: boolean;
};

// --- Period selection ------------------------------------------------------

/**
 * The month spine, newest first, for the period picker.
 *
 * Derived from the P&L rows rather than a separate fetch: v_pnl_monthly joins
 * v_report_months, so it already carries every month including empty ones.
 */
export function monthsDesc(pnl: PnlRow[]): string[] {
  return [...pnl.map((r) => r.month)].sort().reverse();
}

/** Label a YYYY-MM-DD month key as "Aug 2026". */
export function monthLabel(month: string): string {
  const d = new Date(month + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

/** Short axis label — "Aug", with the year only when January makes it useful. */
export function monthTick(month: string): string {
  const d = new Date(month + "T00:00:00");
  return d.getMonth() === 0
    ? d.toLocaleString("en-US", { month: "short", year: "2-digit" })
    : d.toLocaleString("en-US", { month: "short" });
}

/**
 * Is this the month we are currently living in?
 *
 * Matters because the current month is always PARTIAL in a way that is easy to
 * misread as a collapse: operating cost accrues daily (payroll, parts, vendor
 * payments) while revenue only lands when invoices are confirmed, typically at
 * period end. Live today that produces a month with real costs and zero
 * revenue — a true figure that looks like a broken page unless it is labelled.
 */
export function isCurrentMonth(month: string): boolean {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return month === key;
}

/** The month immediately before `month` in the spine, or null at the start. */
export function priorMonth(months: string[], month: string): string | null {
  const asc = [...months].sort();
  const i = asc.indexOf(month);
  return i > 0 ? asc[i - 1] : null;
}

/** Pick one row out of a keyed-by-month list. */
export function rowFor<T extends { month: string }>(rows: T[], month: string | null): T | null {
  if (!month) return null;
  return rows.find((r) => r.month === month) ?? null;
}

// --- Comparison ------------------------------------------------------------

export type Delta = {
  /** Percent change, or null when the prior figure is 0 or missing. */
  pct: number | null;
  abs: number;
  dir: "up" | "down" | "flat";
};

/**
 * Period-over-period change between two figures the VIEWS produced.
 *
 * pct is null when the base is 0 — a jump from nothing is not a percentage,
 * and rendering "+∞%" or a fake "+100%" would be worse than showing the
 * absolute move alone.
 */
export function delta(current: number, prior: number | null | undefined): Delta {
  const prev = prior ?? 0;
  const abs = current - prev;
  const dir = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { pct: prev === 0 ? null : (abs / Math.abs(prev)) * 100, abs, dir };
}

/**
 * Whether a movement is good news, which is metric-specific: revenue rising is
 * good, cost rising is not. Callers pass the metric's own polarity rather than
 * this file guessing from the name.
 */
export function deltaTone(d: Delta, higherIsBetter: boolean): "ok" | "bad" | undefined {
  if (d.dir === "flat") return undefined;
  const good = d.dir === "up" ? higherIsBetter : !higherIsBetter;
  return good ? "ok" : "bad";
}

/**
 * Collections as a share of revenue for the same month.
 *
 * COMPOSITION of two defined metrics, not a redefinition of either — neither
 * side is recomputed here. Note the two are on different bases by design
 * (collections are VAT-inclusive cash, revenue is net-of-VAT accrual), so this
 * is a cash-coverage indicator, NOT a "percent of invoices collected". It is
 * deliberately not called a collection rate in the UI for that reason.
 *
 * Worth promoting into the semantic layer as its own metric if it becomes
 * load-bearing — flagged rather than left as an undocumented TS-only number.
 */
export function cashCoverage(collected: number, revenue: number): number | null {
  return revenue > 0 ? (collected / revenue) * 100 : null;
}

// --- Formatting ------------------------------------------------------------

/** Signed percent, one decimal, or an em dash when incomputable. */
export function formatPct(pct: number | null, digits = 1): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const s = pct.toFixed(digits);
  return `${pct > 0 ? "+" : ""}${s}%`;
}

/** Unsigned percent for shares and margins. */
export function formatShare(pct: number | null, digits = 1): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(digits)}%`;
}

/** Compact SAR for chart axes — 12.4k rather than 12,400. */
export function compactSar(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

// --- Cost buckets ----------------------------------------------------------

// --- The narrative ---------------------------------------------------------

export type NarrativeBullet = {
  tone: "up" | "down" | "flat" | "info" | "warn";
  text: string;
};

/** The four buckets the "largest cost" bullet can name — data, not a label. */
type NarrativeBucketKey = "payroll" | "os" | "parts" | "commissions";

const sar = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SAR";

/**
 * The period in plain language — COMPUTED, never templated prose with numbers
 * dropped in. Every line below is a comparison the reader could redo by hand
 * from the statements on this page, which is the same standard the Parts Usage
 * weekly review holds itself to.
 *
 * Where a figure cannot honestly be stated, the bullet says so instead of
 * being omitted — a silent gap reads as "nothing happened".
 *
 * WHY EVERY BRANCH IS ITS OWN DICTIONARY LEAF. English built these lines by
 * splicing into the middle of a sentence: a bare "up"/"down"/"level", an
 * optional " — a 12.4% margin" clause, an "s" on trucks and work orders.
 * None of those survive translation — Arabic changes the verb, the case and
 * the word order around each of them — so a branch that produced a different
 * English sentence now looks up a different key, and each key holds the WHOLE
 * sentence. `plural()` picks the count bucket, and the English values under
 * `two`/`few`/`many` are written identically wherever English does not
 * inflect, so whichever bucket fires the English is byte-for-byte what this
 * function printed before.
 *
 * Every FIGURE still comes in through `sar()` / `formatPct()` / `formatShare()`
 * — Latin digits, en-US, unchanged. Nothing here computes a number.
 */
export function buildNarrative(args: {
  current: PnlPeriodRow;
  prior: PnlPeriodRow | null;
  inProgress: boolean;
  collected: number;
  outstanding: number;
  oldestDays: number | null;
  trips: number;
  delivered: number;
  peakTrucks: number;
  workOrders: number;
  salesReturns: number;
  topCustomer: { name: string; revenue: number } | null;
  lang: Lang;
}): NarrativeBullet[] {
  const {
    current: c, prior: p, inProgress, collected, outstanding, oldestDays,
    trips, delivered, peakTrucks, workOrders, salesReturns, topCustomer, lang,
  } = args;
  const out: NarrativeBullet[] = [];
  const say = (key: TKey, vals: Record<string, string | number> = {}) =>
    fill(t(key, lang), vals);

  if (inProgress) {
    out.push({
      tone: "info",
      text: say("reports.narrative.inProgress", { p: c.label }),
    });
  }

  // Revenue
  if (c.revenue_sar === 0) {
    out.push({
      tone: "warn",
      text: say("reports.narrative.noRevenue", {
        p: c.label, c: sar(c.operating_cost_sar),
      }),
    });
  } else {
    const d = p ? delta(c.revenue_sar, p.revenue_sar) : null;
    out.push({
      tone: d ? d.dir : "info",
      text: d && d.pct !== null
        ? say(
            d.dir === "up" ? "reports.narrative.revenueUp"
              : d.dir === "down" ? "reports.narrative.revenueDown"
              : "reports.narrative.revenueFlat",
            { v: sar(c.revenue_sar), d: formatPct(d.pct), p: p!.label },
          )
        : p
          ? say("reports.narrative.revenueVsNothing", { v: sar(c.revenue_sar), p: p.label })
          : say("reports.narrative.revenueBare", { v: sar(c.revenue_sar) }),
    });
  }

  // Profit and margin — margin quoted from the view, never recomputed.
  const profitable = c.operating_profit_sar >= 0;
  out.push({
    tone: profitable ? "up" : "down",
    text: profitable
      ? c.operating_margin_pct !== null
        ? say("reports.narrative.profitWithMargin", {
            v: sar(c.operating_profit_sar),
            m: formatShare(c.operating_margin_pct),
            c: sar(c.operating_cost_sar),
          })
        : say("reports.narrative.profitNoMargin", {
            v: sar(c.operating_profit_sar), c: sar(c.operating_cost_sar),
          })
      : say("reports.narrative.loss", {
          l: sar(Math.abs(c.operating_profit_sar)),
          c: sar(c.operating_cost_sar),
          r: sar(c.revenue_sar),
        }),
  });

  // Largest cost bucket — a fact about composition, not a judgement.
  //
  // Sorted on `v`, then named through `key`. The bucket used to carry its
  // English name and be identified by it; the name is now a lookup off data, so
  // the winner is the same row in either language.
  const buckets: { key: NarrativeBucketKey; v: number }[] = [
    { key: "payroll", v: c.payroll_sar },
    { key: "os", v: c.os_cost_sar },
    { key: "parts", v: c.parts_cost_sar },
    { key: "commissions", v: c.commissions_sar },
  ];
  buckets.sort((a, b) => b.v - a.v);
  if (buckets[0].v > 0) {
    const share = c.operating_cost_sar > 0 ? (buckets[0].v / c.operating_cost_sar) * 100 : null;
    const b = t(`reports.narrative.bucket.${buckets[0].key}`, lang);
    out.push({
      tone: "info",
      text: share !== null
        ? say("reports.narrative.largestCostWithShare", {
            b, v: sar(buckets[0].v), s: formatShare(share),
          })
        : say("reports.narrative.largestCost", { b, v: sar(buckets[0].v) }),
    });
  }

  // Expenses — only worth a line when they exist, since their absence is
  // already stated on the P&L itself.
  if (c.expenses_sar > 0) {
    out.push({
      tone: "info",
      text: say("reports.narrative.expenses", {
        e: sar(c.expenses_sar), n: sar(c.net_profit_sar),
      }),
    });
  }

  // Cash
  if (collected > 0) {
    out.push({
      tone: "info",
      text: say("reports.narrative.collected", { v: sar(collected) }),
    });
  } else {
    out.push({ tone: "warn", text: say("reports.narrative.noCash") });
  }

  if (outstanding > 0) {
    out.push({
      tone: oldestDays !== null && oldestDays > 60 ? "warn" : "info",
      text: oldestDays !== null
        ? say(`reports.narrative.outstandingAged.${plural(oldestDays)}`, {
            v: sar(outstanding), d: oldestDays,
          })
        : say("reports.narrative.outstanding", { v: sar(outstanding) }),
    });
  }

  if (salesReturns > 0) {
    out.push({
      tone: "warn",
      text: say("reports.narrative.salesReturns", { v: sar(salesReturns) }),
    });
  }

  // Operations — TWO counted nouns in one sentence, so the work-order variant
  // is a nested family: trucks outside, work orders inside.
  if (trips > 0) {
    out.push({
      tone: "info",
      text: workOrders > 0
        ? say(`reports.narrative.opsWo.${plural(peakTrucks)}.${plural(workOrders)}`, {
            d: delivered, t: trips, k: peakTrucks, w: workOrders,
          })
        : say(`reports.narrative.ops.${plural(peakTrucks)}`, {
            d: delivered, t: trips, k: peakTrucks,
          }),
    });
  }

  if (topCustomer && topCustomer.revenue > 0) {
    const share = c.revenue_sar > 0 ? (topCustomer.revenue / c.revenue_sar) * 100 : null;
    out.push({
      tone: share !== null && share > 50 ? "warn" : "info",
      text: share !== null
        ? say("reports.narrative.topCustomerWithShare", {
            n: topCustomer.name, v: sar(topCustomer.revenue), s: formatShare(share),
          })
        : say("reports.narrative.topCustomer", {
            n: topCustomer.name, v: sar(topCustomer.revenue),
          }),
    });
  }

  return out;
}

type CostBucket = { key: string; labelKey: TKey; value: number; color: string };

/**
 * The four operational buckets, in a fixed order with fixed colours.
 *
 * Manual expenses are NOT here: 0098 rule 8 keeps them a separate section, and
 * folding them into this list would undo that at the display layer.
 */
/**
 * Station fill cost per month (v_filling_cost_monthly, 0112).
 *
 * uncosted_trips travels WITH the money on purpose: sum() skips NULLs, so
 * filling_cost_sar is the total of what is KNOWN and is short by an unknown
 * amount whenever uncosted_trips > 0. Showing the money without the count
 * shows a total that is quietly wrong.
 */
export type FillingMonthRow = {
  month: string;
  filling_cost_sar: number;
  costed_trips: number;
  uncosted_trips: number;
};

/** The same figure at station x water-type grain (0112). */
export type FillingByStationRow = {
  month: string;
  station_key: string;
  /** NULL when the station key no longer exists; the cost still counts. */
  station_name: string | null;
  water_type: string;
  filling_cost_sar: number;
  costed_trips: number;
  uncosted_trips: number;
};

// ---------------------------------------------------------------------------
// DRIVER PAYSLIPS (0115)
//
// v_driver_payslip_basis is the ONE definition of what a payslip would carry.
// The page reads it and re-derives none of its figures — issue_driver_payslip
// freezes from the same view, so a preview and the document it becomes cannot
// disagree.
// ---------------------------------------------------------------------------

/** One driver's payslip basis for one month, straight off the view. */
export type PayslipBasisRow = {
  period_start: string;
  driver_id: string;
  driver_name: string;
  base_salary_sar: number;
  /** No salary recorded. Does NOT block issue — a zero-salary slip is honest. */
  salary_missing: boolean;
  /**
   * No hire date, so the employment window cannot be established. This DOES
   * block issue, and the database enforces it (23514) — the flag exists so the
   * UI can say why before the user clicks, not so the UI can be the rule.
   */
  hire_date_missing: boolean;
  /**
   * 'paid'   — a commission payout was SETTLED in this month; the block IS that
   *            payout (or the sum of several), referenced by id.
   * 'earned' — nothing settled yet; the block is the accrual for work not yet
   *            locked to any payout. It will reappear as 'paid' in the month it
   *            is settled, which is why the document says so out loud.
   */
  commission_basis: "paid" | "earned" | "none";
  commission_settled: boolean;
  payout_count: number;
  commission_sar: number;
  specials_sar: number;
  adjustments_sar: number;
  bonus_sar: number;
  /** Set once a payslip exists for this driver+month — the frozen document. */
  issued_payslip_id: string | null;
  issued_payslip_number: string | null;
  /**
   * Employment status (0116). A LABEL rule, not a gate: terminated outranks
   * hire_date_missing in the Status column because leaving the company is the
   * more important fact, but termination does NOT block issuing — a driver's
   * final month is a legitimate payslip.
   */
  terminated: boolean;
  termination_date: string | null;
  /**
   * NET PAY, NET OF VIOLATION DEDUCTIONS — the ONE definition, computed in the
   * view. REDEFINED BY 0177: this column used to be gross, and the RPC froze
   * `net_sar - deductions_sar` off it. It no longer does. The view now subtracts
   * the deduction itself and issue_driver_payslip freezes this column ALONE, so
   * a preview and the document it becomes cannot disagree.
   *
   * The old note here said deductions were "a property of the DOCUMENT, not of
   * the basis" and "0 today (no data source)". Both stopped being true at 0177.
   * Deductions ARE a property of the basis now, because they are a pure function
   * of (driver, month) — which is exactly what makes the preview trustworthy.
   */
  net_sar: number;
  /**
   * The month's live violations BEFORE the clamp — the gross claim against this
   * payslip. Fines dated in this month with voided_at IS NULL, all of them,
   * whatever payment_status says: settling a ticket with the authority is a
   * different question from charging the driver for it.
   */
  violation_deduction_sar: number;
  /**
   * What the pay could actually absorb: LEAST(violation_deduction_sar, gross).
   * Already subtracted from net_sar above — do NOT subtract it again.
   */
  deductions_sar: number;
  /**
   * The part this month's pay could not cover. A RECORD, NOT A CARRY: no later
   * month reads it, and recovering it is a human decision made outside this
   * system. Non-zero only when the fines exceeded the pay.
   */
  unabsorbed_sar: number;
};

/**
 * One driver's earnings for one project in the month he DROVE the trips
 * (v_driver_commission_by_project_monthly, 0116).
 *
 * WORK MONTH, NOT SETTLEMENT MONTH — deliberately the opposite basis from
 * PayslipBasisRow above, and deliberately including commission already paid
 * out. The payslip answers "what was settled this month"; this answers "what
 * did he earn from the trips he drove this month". Same money, two questions,
 * and the surface has to say which is which or a manager will read one as the
 * other.
 *
 * Delivered trips only — commission exists on no other stage, and
 * v_commissions_monthly (which the P&L reads) filters the same way.
 */
export type DriverCommissionByProjectRow = {
  month: string;
  driver_id: string;
  driver_name: string;
  /** NULL for a direct-customer trip. Real work, kept, named by the UI. */
  project_id: string | null;
  project_name: string | null;
  trips_delivered: number;
  commission_sar: number;
};

/** An issued, frozen payslip. Every money column is what it was at issue. */
export type IssuedPayslipRow = {
  id: string;
  payslip_number: string;
  driver_id: string;
  period_start: string;
  issued_at: string;
  issued_by: string;
  commission_basis: "paid" | "earned" | "none";
  commission_settled: boolean;
  base_salary_sar: number;
  commission_sar: number;
  specials_sar: number;
  adjustments_sar: number;
  bonus_sar: number;
  /** The month's fines before the clamp, frozen at issue (0177). */
  violation_deduction_sar: number;
  /** What this payslip actually took off the driver, frozen at issue. */
  deductions_sar: number;
  /** Fines the pay could not cover, frozen at issue. A record, not a carry. */
  unabsorbed_sar: number;
  /** ALREADY net of deductions_sar. Never subtract it a second time. */
  net_sar: number;
  /** Driver name, salary at issue, the payouts settled, the trips covered. */
  snapshot: PayslipSnapshot | null;
};

export type PayslipSnapshot = {
  driver_name?: string;
  salary_at_issue?: number;
  commission_basis?: string;
  payout_count?: number;
  payouts?: {
    id: string; period_label: string | null; paid_at: string | null;
    base_sar: number; specials_sar: number; adjustments_sar: number;
    bonus_sar: number; total_sar: number;
  }[];
  covered_trips?: { count: number; first_trip?: string | null; last_trip?: string | null };
  /**
   * The fines this document charged for, itemised at issue (0177). Read this
   * rather than re-querying driver_violations: a violation can be voided,
   * re-labelled or re-priced after the fact, and the document must keep saying
   * what it said the day it was handed over.
   */
  violations?: {
    month_total_sar?: number;
    absorbed_sar?: number;
    unabsorbed_sar?: number;
    items?: {
      id: string;
      ref_no: string;
      type_key: string | null;
      type_label: string | null;
      type_label_ar: string | null;
      amount_sar: number;
      violation_date: string;
      payment_status: string | null;
    }[];
  };
};

/**
 * COLOURS COME FROM lib/cost-colors.ts, the same record the Dashboard's Cost
 * mix reads. They were hardcoded here and had drifted into something worse than
 * a mismatch — Payroll and Outsourced were SWAPPED against the Dashboard, so
 * the amber wedge meant payroll on this page and outsourced work on that one.
 * Both now read one source; that file's header carries the full note.
 *
 * `key` is deliberately left as it was — "os", not "outsourced". It is this
 * list's own identity and the Overview bars use it as a React key; renaming it
 * would be churn no reader benefits from. The colour lookup maps it across.
 *
 * The NAMES point at dashboard.costType.* rather than at a reports-only copy:
 * the same five buckets are already keyed there for the Dashboard's cost mix,
 * with the same English, and two dictionary entries for one bucket is exactly
 * how the colours drifted apart before lib/cost-colors.ts existed.
 */
export function costBuckets(row: PnlRow): CostBucket[] {
  return [
    { key: "parts", labelKey: "dashboard.costType.parts", value: row.parts_cost_sar, color: COST_COLOR.parts },
    { key: "os", labelKey: "dashboard.costType.outsourced", value: row.os_cost_sar, color: COST_COLOR.outsourced },
    { key: "payroll", labelKey: "dashboard.costType.payroll", value: row.payroll_sar, color: COST_COLOR.payroll },
    { key: "commissions", labelKey: "dashboard.costType.commissions", value: row.commissions_sar, color: COST_COLOR.commissions },
    { key: "filling", labelKey: "dashboard.costType.filling", value: row.filling_cost_sar, color: COST_COLOR.filling },
  ];
}
