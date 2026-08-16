// Reports — the CUSTOM REPORT BUILDER.
//
// A pivot table fenced to the semantic layer. The user combines building
// blocks that are already defined and correct; they never write SQL and never
// type a free-text query. By construction the result cannot disagree with the
// rest of the page, because every figure it shows comes out of the same view
// rows the P&L, the Overview and the statements already read.
//
// ===========================================================================
// WHY A BINDING LAYER EXISTS AT ALL
// ===========================================================================
// report_metrics (migration 0098) is the VOCABULARY: it says what each metric
// means, its grain, its basis and its caveat — in prose, for a human or a
// model to read. What it does not carry is machine-readable CAPABILITY: which
// column holds the number, and which groupings the metric can actually
// support. That is what this file adds, and nothing more.
//
// The fence is enforced in one direction: a metric is only offered if its key
// is present in the live report_metrics table (see availableMetrics below).
// Delete a metric from the dictionary and it disappears from the builder. The
// dictionary stays the single source of what exists; this file only says where
// to find it and how it may be sliced.
//
// ===========================================================================
// THE THREE RULES THE DICTIONARY IMPLIES, ENFORCED STRUCTURALLY
// ===========================================================================
// 1) BASIS IS NEVER MIXED INTO ONE NUMBER. Every metric is its own column and
//    nothing is ever summed ACROSS metrics — there is no cross-metric total,
//    deliberately. Revenue (accrual) and collections (cash) can sit side by
//    side, because comparing them is useful, but no arithmetic joins them.
//    Each column carries its basis so the reader knows which is which.
//
// 2) A GROUPING IS ONLY OFFERED WHERE THE DATA SUPPORTS IT. Maintenance cost
//    exists per truck and per period but not per customer; revenue exists per
//    customer and per period but is only an ALLOCATION per truck. Rather than
//    letting a user pick a combination that would silently produce zeroes, the
//    grouping list is filtered to what the selected metrics can honestly do.
//
// 3) RATIOS RECOMPUTE FROM EACH ROW'S OWN TOTALS. A margin column is computed
//    from that row's profit and revenue — never averaged from sub-rows. This
//    is the same rule migration 0100 exists to enforce, applied one level up:
//    averaging monthly margins turned -38.7% into +20.5% on live data.

import type {
  PnlPeriodRow, CollectionsRow, PurchasingRow, OperationsRow,
  RevenueInvoiceRow, RevenuePerTruckRow, MaintenancePerTruckRow,
  MetricDictionaryRow, PeriodType,
} from "./reports";
import { monthsIn, periodsOf } from "./reports";

export type Grouping = "period" | "customer" | "truck";

export const GROUPING_LABELS: Record<Grouping, string> = {
  period: "By period",
  customer: "By customer",
  truck: "By truck",
};

type MetricBasis = "accrual" | "cash" | "operational";
type MetricUnit = "SAR" | "count" | "percent";

/**
 * One offerable building block.
 *
 * `key` MUST match a report_metrics.metric_key. That is the fence: a block
 * whose key is not in the live dictionary is never offered.
 */
type BuilderMetric = {
  key: string;
  label: string;
  basis: MetricBasis;
  unit: MetricUnit;
  groupings: Grouping[];
  /** Ratios are recomputed per row; sums accumulate. */
  kind: "sum" | "ratio";
  /** Which accumulator to read (sum), or which pair to divide (ratio). */
  field?: keyof Bucket;
  ratio?: { numerator: keyof Bucket; denominator: keyof Bucket };
};

/**
 * Per-row accumulators. Every one is filled from view rows, never computed.
 *
 * Module-private, and deliberately so despite the generic name: lib/parts-usage
 * exports an unrelated `Bucket` for its charts, and two exported types sharing
 * one name across the codebase is a genuine confusion waiting to happen.
 */
type Bucket = {
  revenue: number;
  parts: number;
  os: number;
  payroll: number;
  commissions: number;
  /**
   * Station fill cost (0113). The FIFTH operational cost bucket — it has been
   * inside operating_cost since 0112, but had no column of its own here, so a
   * by-period report could show the total without the line that makes it foot.
   */
  filling: number;
  operatingCost: number;
  operatingProfit: number;
  netProfit: number;
  expenses: number;
  collections: number;
  purchasing: number;
  tripsDelivered: number;
  tripsTotal: number;
  invoices: number;
  outstanding: number;
  allocatedRevenue: number;
  maintParts: number;
  maintOs: number;
  maintTotal: number;
};

const EMPTY: Bucket = {
  revenue: 0, parts: 0, os: 0, payroll: 0, commissions: 0, filling: 0,
  operatingCost: 0, operatingProfit: 0, netProfit: 0, expenses: 0,
  collections: 0, purchasing: 0,
  tripsDelivered: 0, tripsTotal: 0, invoices: 0, outstanding: 0,
  allocatedRevenue: 0, maintParts: 0, maintOs: 0, maintTotal: 0,
};

/**
 * The catalogue. Each entry names a dictionary key, where its number lives,
 * and the groupings it can honestly support.
 *
 * MODULE-PRIVATE, and that is the point: availableMetrics() is the only way to
 * reach it, and that function is what enforces the dictionary fence. Exporting
 * the raw array would let a caller bypass the fence and offer a block whose
 * metric_key is no longer in report_metrics — so keeping it unexported makes
 * the constraint structural rather than a convention someone has to remember.
 *
 * Note what is deliberately absent: receivables_outstanding is a STATE metric
 * ("as of today", per its dictionary grain) and cannot be placed in a period
 * column without lying about when it was true. Outstanding here is instead
 * measured on the period's own invoices, which is a different, honest thing —
 * and it is labelled as such.
 */
const BUILDER_METRICS: BuilderMetric[] = [
  { key: "revenue", label: "Revenue", basis: "accrual", unit: "SAR",
    groupings: ["period", "customer"], kind: "sum", field: "revenue" },
  { key: "revenue", label: "Revenue (allocated)", basis: "accrual", unit: "SAR",
    groupings: ["truck"], kind: "sum", field: "allocatedRevenue" },
  { key: "parts_cost_at_consumption", label: "Parts cost", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "parts" },
  { key: "os_cost", label: "Outsourced cost", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "os" },
  { key: "payroll_cost", label: "Payroll", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "payroll" },
  { key: "commissions_cost", label: "Commissions", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "commissions" },
  // Filling is period-only, exactly like the four buckets around it: its figure
  // comes from PnlPeriodRow, which is per-period. There is no per-customer or
  // per-truck filling view, so offering those groupings would promise a number
  // that does not exist. Requires metric_key 'filling_cost' to be live in
  // report_metrics (migration 0124) — until then availableMetrics filters this
  // row out and the block simply does not appear.
  { key: "filling_cost", label: "Water filling cost", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "filling" },
  { key: "operating_cost", label: "Operating cost", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "operatingCost" },
  { key: "operating_profit", label: "Operating profit", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "operatingProfit" },
  { key: "net_profit", label: "Net profit", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "netProfit" },
  { key: "expenses", label: "Other expenses", basis: "accrual", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "expenses" },
  { key: "operating_margin", label: "Operating margin", basis: "accrual", unit: "percent",
    groupings: ["period"], kind: "ratio",
    ratio: { numerator: "operatingProfit", denominator: "revenue" } },
  { key: "collections", label: "Collections", basis: "cash", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "collections" },
  { key: "purchasing_spend", label: "Purchasing spend", basis: "cash", unit: "SAR",
    groupings: ["period"], kind: "sum", field: "purchasing" },
  { key: "operations", label: "Trips delivered", basis: "operational", unit: "count",
    groupings: ["period", "truck"], kind: "sum", field: "tripsDelivered" },
  { key: "revenue", label: "Invoices", basis: "accrual", unit: "count",
    groupings: ["customer"], kind: "sum", field: "invoices" },
  { key: "revenue", label: "Outstanding on period invoices", basis: "accrual", unit: "SAR",
    groupings: ["customer"], kind: "sum", field: "outstanding" },
  { key: "maintenance_parts_per_truck", label: "Maintenance parts", basis: "accrual", unit: "SAR",
    groupings: ["truck"], kind: "sum", field: "maintParts" },
  { key: "os_payments_per_truck", label: "Outsourced repairs", basis: "accrual", unit: "SAR",
    groupings: ["truck"], kind: "sum", field: "maintOs" },
  { key: "total_maintenance_per_truck", label: "Total maintenance", basis: "accrual", unit: "SAR",
    groupings: ["truck"], kind: "sum", field: "maintTotal" },
];

/** Stable identity for a block — key alone is not unique (see revenue). */
export const metricId = (m: BuilderMetric) => `${m.key}::${m.label}`;

/**
 * THE FENCE. Only blocks whose dictionary key is live are offerable.
 *
 * If report_metrics loses a key, the block vanishes from the builder rather
 * than quietly continuing to read a column nobody documents any more.
 */
export function availableMetrics(dictionary: MetricDictionaryRow[]): BuilderMetric[] {
  const known = new Set(dictionary.map((d) => d.metric_key));
  return BUILDER_METRICS.filter((m) => known.has(m.key));
}

/** Groupings every selected metric can support — the intersection, not the union. */
export function allowedGroupings(selected: BuilderMetric[]): Grouping[] {
  const all: Grouping[] = ["period", "customer", "truck"];
  if (selected.length === 0) return all;
  return all.filter((g) => selected.every((m) => m.groupings.includes(g)));
}

type ReportRow = { label: string; bucket: Bucket };
type ReportColumn = { id: string; label: string; basis: MetricBasis; unit: MetricUnit };
export type BuiltReport = {
  columns: ReportColumn[];
  rows: { label: string; values: (number | null)[] }[];
  /** Honest notes about what the reader is looking at. */
  notes: string[];
};

export type BuilderSelection = {
  metricIds: string[];
  grouping: Grouping;
  periodType: PeriodType;
  periodStart: string | null;
};

type BuilderData = {
  pnlPeriods: PnlPeriodRow[];
  collections: CollectionsRow[];
  purchasing: PurchasingRow[];
  operations: OperationsRow[];
  invoices: RevenueInvoiceRow[];
  perTruck: RevenuePerTruckRow[];
  maintPerTruck: MaintenancePerTruckRow[];
};

/**
 * Assemble the report.
 *
 * Reads the same view rows every other report on the page reads. The only
 * arithmetic is accumulation of additive figures and, for ratio columns, one
 * division per row using that row's OWN totals.
 */
export function buildReport(
  selection: BuilderSelection,
  data: BuilderData,
  dictionary: MetricDictionaryRow[],
): BuiltReport {
  const catalogue = availableMetrics(dictionary);
  const selected = selection.metricIds
    .map((id) => catalogue.find((m) => metricId(m) === id))
    .filter((m): m is BuilderMetric => Boolean(m) && m!.groupings.includes(selection.grouping));

  const columns: ReportColumn[] = selected.map((m) => ({
    id: metricId(m), label: m.label, basis: m.basis, unit: m.unit,
  }));

  const rows: ReportRow[] = [];
  const notes: string[] = [];

  if (selection.grouping === "period") {
    // Every period of the chosen grain — a trend, so the single-period picker
    // does not filter here. Said out loud rather than left to be discovered.
    notes.push(`Every ${selection.periodType} is listed, newest first — the period picker does not filter a by-period report.`);
    for (const p of periodsOf(data.pnlPeriods, selection.periodType)) {
      const b: Bucket = { ...EMPTY };
      b.revenue = p.revenue_sar;
      b.parts = p.parts_cost_sar;
      b.os = p.os_cost_sar;
      b.payroll = p.payroll_sar;
      b.commissions = p.commissions_sar;
      b.filling = p.filling_cost_sar;
      b.operatingCost = p.operating_cost_sar;
      b.operatingProfit = p.operating_profit_sar;
      b.netProfit = p.net_profit_sar;
      b.expenses = p.expenses_sar;
      // Month-grain views summed across the period's months — additive only.
      b.collections = monthsIn(data.collections, p.period_start, p.period_end)
        .reduce((n, r) => n + r.collected_gross_sar, 0);
      b.purchasing = monthsIn(data.purchasing, p.period_start, p.period_end)
        .reduce((n, r) => n + r.received_stock_value_sar, 0);
      const ops = monthsIn(data.operations, p.period_start, p.period_end);
      b.tripsDelivered = ops.reduce((n, r) => n + r.trips_delivered, 0);
      b.tripsTotal = ops.reduce((n, r) => n + r.trips_total, 0);
      rows.push({ label: p.label, bucket: b });
    }
  } else {
    const period = data.pnlPeriods.find(
      (p) => p.period_type === selection.periodType && p.period_start === selection.periodStart);
    if (!period) return { columns, rows: [], notes: ["No period selected."] };
    notes.push(`Rows cover ${period.label} only.`);

    if (selection.grouping === "customer") {
      const byId = new Map<string, { label: string; b: Bucket }>();
      for (const i of data.invoices) {
        if (i.month < period.period_start || i.month > period.period_end) continue;
        const e = byId.get(i.customer_id) ?? { label: i.customer_name, b: { ...EMPTY } };
        e.b.revenue += i.revenue_sar;
        e.b.invoices += 1;
        if (!i.is_paid) e.b.outstanding += i.amount_due_sar;
        byId.set(i.customer_id, e);
      }
      for (const e of byId.values()) rows.push({ label: e.label, bucket: e.b });
      if (selected.some((m) => m.field === "outstanding")) {
        notes.push("Outstanding is measured on this period's own invoices, not the all-time receivables position.");
      }
    } else {
      const byId = new Map<string, { label: string; b: Bucket }>();
      const touch = (id: string, label: string) => {
        const e = byId.get(id) ?? { label, b: { ...EMPTY } };
        byId.set(id, e);
        return e;
      };
      for (const r of data.perTruck) {
        if (r.month < period.period_start || r.month > period.period_end) continue;
        const e = touch(r.truck_id, r.plate);
        e.b.allocatedRevenue += r.allocated_revenue_sar;
        e.b.tripsDelivered += r.trips;
      }
      for (const r of data.maintPerTruck) {
        if (r.month < period.period_start || r.month > period.period_end) continue;
        const e = touch(r.truck_id, r.plate);
        e.b.maintParts += r.maintenance_parts_sar;
        e.b.maintOs += r.os_payments_sar;
        e.b.maintTotal += r.total_maintenance_sar;
      }
      for (const e of byId.values()) rows.push({ label: e.label, bucket: e.b });
      if (selected.some((m) => m.field === "allocatedRevenue")) {
        notes.push("Revenue per truck is an allocation: each invoice's revenue is split equally across its trips.");
      }
    }
  }

  const bases = new Set(selected.map((m) => m.basis));
  if (bases.size > 1) {
    notes.push("Columns use different bases (accrual, cash, operational). They are shown side by side and are never added together — each column stands on its own.");
  }
  if (selected.some((m) => m.kind === "ratio")) {
    notes.push("Ratio columns are computed from each row's own totals, never averaged from smaller periods.");
  }

  const valueRows = rows.map((r) => ({
    label: r.label,
    values: selected.map((m) => {
      if (m.kind === "ratio" && m.ratio) {
        const num = r.bucket[m.ratio.numerator];
        const den = r.bucket[m.ratio.denominator];
        return den > 0 ? (num / den) * 100 : null;
      }
      return m.field ? r.bucket[m.field] : null;
    }),
  }));

  // Sort by the first numeric column, largest first — except a by-period
  // report, which is already in chronological order and should stay that way.
  if (selection.grouping !== "period" && columns.length > 0) {
    valueRows.sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0));
  }

  return { columns, rows: valueRows, notes };
}
