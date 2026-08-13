"use server";

// Resolves an "Add Summary" tile's value from the semantic layer.
//
// SERVER-SIDE FENCE, NOT JUST CLIENT-SIDE. The picker already only offers
// allowed keys, but a client can send anything — so the key is re-checked
// here against the live report_metrics dictionary before a single query
// runs. Client-side filtering is ergonomics; this is the control.
//
// Reads views only, through the request-scoped client, so RLS applies. No
// table is touched and nothing is written.

import { createClient } from "@/lib/supabase/server";
import { isAllowedWidgetKey, isStateWidget, widgetDef } from "@/lib/dashboard-widgets";

export type WidgetValue = {
  key: string;
  /** Single headline number, already coerced. */
  value: number;
  /** Bars, when the widget is a mix rather than one figure. */
  parts: { label: string; value: number }[];
  hasData: boolean;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Which view + column answers each metric key. One place, and — importantly
 * — ONE COLUMN each. Every column name below was read off the live view
 * definitions, not guessed; four of the first draft's guesses were wrong.
 *
 * TWO OF THEM DELIBERATELY READ v_pnl_monthly RATHER THAN THEIR OWN VIEW:
 *   · commissions_cost — v_commissions_monthly splits the figure across
 *     trip_commission_sar / specials_sar / adjustments_sar / bonus_sar.
 *   · payroll_cost     — v_payroll_monthly splits it across
 *     staff_salary_sar / driver_salary_sar.
 * Adding those parts up here would be re-deriving a total in TypeScript,
 * which is the one thing this page must never do. v_pnl_monthly already
 * publishes both as single aggregated columns, so the tile reads the same
 * number the P&L statement reads and cannot disagree with it.
 */
const METRIC_SOURCE: Record<string, { view: string; col: string }> = {
  revenue: { view: "v_revenue_monthly", col: "revenue_sar" },
  operating_margin: { view: "v_pnl_monthly", col: "operating_margin_pct" },
  operating_cost: { view: "v_pnl_monthly", col: "operating_cost_sar" },
  net_profit: { view: "v_pnl_monthly", col: "net_profit_sar" },
  collections: { view: "v_collections_monthly", col: "collected_gross_sar" },
  commissions_cost: { view: "v_pnl_monthly", col: "commissions_sar" },
  payroll_cost: { view: "v_pnl_monthly", col: "payroll_sar" },
  parts_cost_at_consumption: { view: "v_parts_cost_monthly", col: "parts_cost_sar" },
  os_cost: { view: "v_os_cost_monthly", col: "os_cost_sar" },
  purchasing_spend: { view: "v_purchasing_spend_monthly", col: "received_stock_value_sar" },
  topups: { view: "v_topups_monthly", col: "topups_sar" },
  expenses: { view: "v_expenses_monthly", col: "expenses_sar" },
  operations: { view: "v_operations_monthly", col: "trips_delivered" },
};

export async function getWidgetValue(key: string): Promise<WidgetValue | null> {
  const def = widgetDef(key);
  if (!def) return null;

  const supabase = createClient();

  // Re-fence server-side against the live dictionary.
  const { data: dict } = await supabase.from("report_metrics").select("metric_key");
  if (!isAllowedWidgetKey(key, (dict ?? []) as { metric_key: string }[])) {
    console.warn("[getWidgetValue] rejected key not in the live catalogue:", key);
    return null;
  }

  // ---- state family: one row, current state -----------------------------
  if (isStateWidget(key)) {
    const { data, error } = await supabase.from("v_fleet_state_now").select("*").maybeSingle();
    if (error || !data) return { key, value: 0, parts: [], hasData: false };
    const s = data as Record<string, unknown>;

    if (key === "fleet_mix") {
      return {
        key,
        value: num(s.trucks_total),
        parts: [
          { label: "Active", value: num(s.trucks_active) },
          { label: "Idle", value: num(s.trucks_idle) },
          { label: "Maintenance", value: num(s.trucks_maintenance) },
        ],
        hasData: true,
      };
    }
    if (key === "driver_mix") {
      return {
        key,
        value: num(s.drivers_total),
        parts: [
          { label: "Active", value: num(s.drivers_active) },
          { label: "Idle", value: num(s.drivers_idle) },
          { label: "Off duty", value: num(s.drivers_off_duty) },
          { label: "On leave", value: num(s.drivers_on_leave) },
        ],
        hasData: true,
      };
    }
    if (key === "trips_in_flight") {
      return { key, value: num(s.trips_in_flight), parts: [], hasData: true };
    }
    if (key === "jobs_running") {
      return {
        key,
        value: num(s.work_orders_running) + num(s.outsourced_running),
        parts: [
          { label: "In-house", value: num(s.work_orders_running) },
          { label: "Outsourced", value: num(s.outsourced_running) },
        ],
        hasData: true,
      };
    }
    return null;
  }

  // ---- metric family: latest month from the metric's own view -----------
  // receivables_outstanding is the exception: its grain is already "current
  // state", so it sums the open-receivables view rather than reading a month.
  if (key === "receivables_outstanding") {
    const { data, error } = await supabase.from("v_receivables_open").select("outstanding_sar");
    if (error) return { key, value: 0, parts: [], hasData: false };
    const total = ((data ?? []) as { outstanding_sar: unknown }[]).reduce(
      (s, r) => s + num(r.outstanding_sar),
      0
    );
    return { key, value: total, parts: [], hasData: true };
  }

  const src = METRIC_SOURCE[key];
  if (!src) return null;

  // select("*") rather than a `month, ${col}` template: supabase-js types the
  // column list at compile time and a template literal defeats that parser
  // (TS2352). These views are a handful of columns and this is capped at 6
  // rows, so the wider select costs nothing.
  const { data, error } = await supabase
    .from(src.view)
    .select("*")
    .order("month", { ascending: false })
    .limit(6);

  if (error || !data || data.length === 0) {
    return { key, value: 0, parts: [], hasData: false };
  }

  const rows = data as Record<string, unknown>[];
  return {
    key,
    value: num(rows[0]?.[src.col]),
    // Oldest-to-newest so a bar chart reads left to right.
    parts: [...rows]
      .reverse()
      .map((r) => ({ label: String(r.month ?? "").slice(0, 7), value: num(r[src.col]) })),
    hasData: true,
  };
}
