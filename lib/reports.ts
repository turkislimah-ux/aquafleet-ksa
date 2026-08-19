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

export const PERIOD_TYPES: { key: PeriodType; label: string }[] = [
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
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
}): NarrativeBullet[] {
  const {
    current: c, prior: p, inProgress, collected, outstanding, oldestDays,
    trips, delivered, peakTrucks, workOrders, salesReturns, topCustomer,
  } = args;
  const out: NarrativeBullet[] = [];

  if (inProgress) {
    out.push({
      tone: "info",
      text: `${c.label} is still running. Costs accumulate daily while revenue is only recognised when an invoice is confirmed, so the figures below understate how the period will finish.`,
    });
  }

  // Revenue
  if (c.revenue_sar === 0) {
    out.push({
      tone: "warn",
      text: `No revenue was recognised in ${c.label} — no invoice was confirmed. Costs of ${sar(c.operating_cost_sar)} still landed.`,
    });
  } else {
    const d = p ? delta(c.revenue_sar, p.revenue_sar) : null;
    out.push({
      tone: d ? d.dir : "info",
      text: d && d.pct !== null
        ? `Revenue was ${sar(c.revenue_sar)}, ${d.dir === "up" ? "up" : d.dir === "down" ? "down" : "level"} ${formatPct(d.pct)} on ${p!.label}.`
        : `Revenue was ${sar(c.revenue_sar)}${p ? `, against nothing in ${p.label}` : ""}.`,
    });
  }

  // Profit and margin — margin quoted from the view, never recomputed.
  const profitable = c.operating_profit_sar >= 0;
  out.push({
    tone: profitable ? "up" : "down",
    text: profitable
      ? `Operating profit was ${sar(c.operating_profit_sar)}${c.operating_margin_pct !== null ? ` — a ${formatShare(c.operating_margin_pct)} margin` : ""}, after ${sar(c.operating_cost_sar)} of operating cost.`
      : `The period ran at a loss of ${sar(Math.abs(c.operating_profit_sar))}: ${sar(c.operating_cost_sar)} of cost against ${sar(c.revenue_sar)} of revenue.`,
  });

  // Largest cost bucket — a fact about composition, not a judgement.
  const buckets = [
    { label: "payroll", v: c.payroll_sar },
    { label: "outsourced repairs", v: c.os_cost_sar },
    { label: "parts", v: c.parts_cost_sar },
    { label: "commissions", v: c.commissions_sar },
  ].sort((a, b) => b.v - a.v);
  if (buckets[0].v > 0) {
    const share = c.operating_cost_sar > 0 ? (buckets[0].v / c.operating_cost_sar) * 100 : null;
    out.push({
      tone: "info",
      text: `The largest cost was ${buckets[0].label} at ${sar(buckets[0].v)}${share !== null ? `, ${formatShare(share)} of operating cost` : ""}.`,
    });
  }

  // Expenses — only worth a line when they exist, since their absence is
  // already stated on the P&L itself.
  if (c.expenses_sar > 0) {
    out.push({
      tone: "info",
      text: `Manually recorded expenses of ${sar(c.expenses_sar)} bring net profit to ${sar(c.net_profit_sar)}. These are tracked separately from the four operational buckets.`,
    });
  }

  // Cash
  if (collected > 0) {
    out.push({
      tone: "info",
      text: `${sar(collected)} of cash was collected in the period. Collections are VAT-inclusive and land when an invoice is paid, so they will not equal revenue.`,
    });
  } else {
    out.push({ tone: "warn", text: "No cash was collected against invoices in this period." });
  }

  if (outstanding > 0) {
    out.push({
      tone: oldestDays !== null && oldestDays > 60 ? "warn" : "info",
      text: `${sar(outstanding)} remains outstanding across all unpaid invoices${oldestDays !== null ? `, the oldest ${oldestDays} days since confirmation` : ""}. This is a position as of today, not a figure for the period.`,
    });
  }

  if (salesReturns > 0) {
    out.push({
      tone: "warn",
      text: `${sar(salesReturns)} of previously confirmed invoicing was reversed as sales returns. Revenue above already excludes it — the two are never netted silently.`,
    });
  }

  // Operations
  if (trips > 0) {
    out.push({
      tone: "info",
      text: `${delivered} of ${trips} trips were delivered, across at most ${peakTrucks} truck${peakTrucks === 1 ? "" : "s"} in any single month${workOrders > 0 ? `, with ${workOrders} work order${workOrders === 1 ? "" : "s"} raised` : ""}.`,
    });
  }

  if (topCustomer && topCustomer.revenue > 0) {
    const share = c.revenue_sar > 0 ? (topCustomer.revenue / c.revenue_sar) * 100 : null;
    out.push({
      tone: share !== null && share > 50 ? "warn" : "info",
      text: `${topCustomer.name} was the largest customer at ${sar(topCustomer.revenue)}${share !== null ? `, ${formatShare(share)} of revenue` : ""}.`,
    });
  }

  return out;
}

type CostBucket = { key: string; label: string; value: number; color: string };

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
   * NET PAY, BEFORE DEDUCTIONS — the ONE definition (0118), computed in the
   * view. issue_driver_payslip freezes `net_sar - deductions_sar` from this
   * same column, so a preview and the document it becomes cannot disagree.
   *
   * Deductions are not here because they are a property of the DOCUMENT, not of
   * the basis: they exist only once a payslip is issued. They are 0 today (no
   * data source), which is why an unissued row's net_sar is its net pay.
   */
  net_sar: number;
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
  deductions_sar: number;
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
 */
export function costBuckets(row: PnlRow): CostBucket[] {
  return [
    { key: "parts", label: "Parts", value: row.parts_cost_sar, color: COST_COLOR.parts },
    { key: "os", label: "Outsourced", value: row.os_cost_sar, color: COST_COLOR.outsourced },
    { key: "payroll", label: "Payroll", value: row.payroll_sar, color: COST_COLOR.payroll },
    { key: "commissions", label: "Commissions", value: row.commissions_sar, color: COST_COLOR.commissions },
    { key: "filling", label: "Station fill", value: row.filling_cost_sar, color: COST_COLOR.filling },
  ];
}
