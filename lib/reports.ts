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
// collectionRate below); recomputing either side of that ratio is not.

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

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

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

export type CostBucket = { key: string; label: string; value: number; color: string };

/**
 * The four operational buckets, in a fixed order with fixed colours.
 *
 * Manual expenses are NOT here: 0098 rule 8 keeps them a separate section, and
 * folding them into this list would undo that at the display layer.
 */
export function costBuckets(row: PnlRow): CostBucket[] {
  return [
    { key: "parts", label: "Parts", value: row.parts_cost_sar, color: "#0b7eea" },
    { key: "os", label: "Outsourced", value: row.os_cost_sar, color: "#8b5cf6" },
    { key: "payroll", label: "Payroll", value: row.payroll_sar, color: "#f59e0b" },
    { key: "commissions", label: "Commissions", value: row.commissions_sar, color: "#10b981" },
  ];
}
