// "Add Summary" — the Dashboard's build-your-own tile, FENCED to the
// semantic layer exactly the way lib/report-builder.ts fences the Reports
// custom builder.
//
// WHAT THIS REPLACED, AND WHY
// The old Add Summary was demo-era: a keyword matcher over 14 hardcoded
// datasets, EIGHT of which carried `noData: true` and rendered "No data yet"
// no matter what the database held. It looked like a feature and answered
// nothing. Turki's call was to keep the concept and make it real — same
// pattern as the Reports custom builder, with the AI infrastructure prepared
// but inert until its own phase.
//
// THE FENCE (mirrors report-builder.ts:184 exactly)
// `WIDGET_CATALOGUE` is module-PRIVATE. Callers get options only through
// availableWidgets(), which intersects the catalogue with what the live
// dictionary actually publishes. A widget whose metric_key leaves
// report_metrics disappears from the picker rather than rendering a broken
// tile — the fence cannot be bypassed by importing the array, because the
// array is not exported.
//
// Two widget FAMILIES, both real:
//   · "metric" — reads a report_metrics key, so the tile agrees with Reports
//                by construction.
//   · "state"  — reads the 0103 current-state view. These have no
//                report_metrics key (they are "right now", not a period), so
//                they are fenced by an explicit allowlist instead and are
//                marked so the distinction stays visible.
//
// NOTHING HERE COMPUTES. Every value arrives from a view via the server
// action; this file only decides what may be offered and how it is labelled.

type WidgetFamily = "metric" | "state";
export type WidgetDisplay = "stat" | "bars";

export type WidgetDef = {
  key: string;
  family: WidgetFamily;
  en: string;
  ar: string;
  /** Which display shapes this widget can honestly take. */
  displays: WidgetDisplay[];
  /** Money renders through formatSar; counts and percents do not. */
  unit: "sar" | "count" | "pct";
  /** Where the full analysis lives. Every metric widget links out. */
  href: string;
};

// PRIVATE. See the fence note above — do not export this.
const WIDGET_CATALOGUE: WidgetDef[] = [
  // ---- metric family: every key below is a real report_metrics key -------
  { key: "revenue", family: "metric", en: "Revenue", ar: "الإيرادات",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=revenue" },
  { key: "operating_margin", family: "metric", en: "Operating margin", ar: "هامش التشغيل",
    displays: ["stat"], unit: "pct", href: "/reports?tab=statements&statement=pnl" },
  { key: "operating_cost", family: "metric", en: "Operating cost", ar: "تكلفة التشغيل",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "net_profit", family: "metric", en: "Net profit", ar: "صافي الربح",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=pnl" },
  { key: "collections", family: "metric", en: "Collections", ar: "التحصيلات",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=receivables" },
  { key: "receivables_outstanding", family: "metric", en: "Outstanding receivables", ar: "الذمم المدينة",
    displays: ["stat"], unit: "sar", href: "/reports?tab=statements&statement=receivables" },
  { key: "commissions_cost", family: "metric", en: "Commissions earned", ar: "العمولات المستحقة",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "payroll_cost", family: "metric", en: "Payroll", ar: "الرواتب",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "parts_cost_at_consumption", family: "metric", en: "Parts consumed", ar: "تكلفة القطع المستهلكة",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "os_cost", family: "metric", en: "Outsourced repairs", ar: "الإصلاحات الخارجية",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "purchasing_spend", family: "metric", en: "Stock purchased", ar: "المشتريات",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "topups", family: "metric", en: "Balance top-ups", ar: "شحن الأرصدة",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=receivables" },
  { key: "expenses", family: "metric", en: "Manual expenses", ar: "المصروفات اليدوية",
    displays: ["stat", "bars"], unit: "sar", href: "/reports?tab=statements&statement=cost" },
  { key: "operations", family: "metric", en: "Trips delivered", ar: "الرحلات المسلَّمة",
    displays: ["stat", "bars"], unit: "count", href: "/reports?tab=statements&statement=operations" },

  // ---- state family: current-state counts from v_fleet_state_now --------
  // No report_metrics key exists for these BY DESIGN — the dictionary is
  // period-grained and these are "as of right now". They are allowlisted
  // below instead, and STATE_KEYS is the fence for this family.
  { key: "fleet_mix", family: "state", en: "Fleet right now", ar: "الأسطول الآن",
    displays: ["bars", "stat"], unit: "count", href: "/fleet" },
  { key: "driver_mix", family: "state", en: "Drivers right now", ar: "السائقون الآن",
    displays: ["bars", "stat"], unit: "count", href: "/drivers" },
  { key: "trips_in_flight", family: "state", en: "Trips in flight", ar: "رحلات جارية",
    displays: ["stat"], unit: "count", href: "/trips?tab=projects" },
  { key: "jobs_running", family: "state", en: "Jobs running", ar: "أعمال جارية",
    displays: ["stat"], unit: "count", href: "/maintenance" },
];

/** The state family's fence — nothing outside this set may be requested. */
const STATE_KEYS = new Set(
  WIDGET_CATALOGUE.filter((w) => w.family === "state").map((w) => w.key)
);

export type MetricDictionaryRow = { metric_key: string };

/**
 * The ONLY way to obtain widget options.
 *
 * Metric widgets survive only if their key is live in report_metrics; state
 * widgets are always available (their source is 0103, not the dictionary).
 * Same shape as report-builder's availableMetrics(), for the same reason: if
 * the dictionary drops a key, the option disappears instead of rendering a
 * tile with nothing behind it.
 */
export function availableWidgets(dictionary: MetricDictionaryRow[]): WidgetDef[] {
  const known = new Set(dictionary.map((d) => d.metric_key));
  return WIDGET_CATALOGUE.filter((w) => w.family === "state" || known.has(w.key));
}

/** Server-side guard: is this key one the app is allowed to resolve at all? */
export function isAllowedWidgetKey(key: string, dictionary: MetricDictionaryRow[]): boolean {
  return availableWidgets(dictionary).some((w) => w.key === key);
}

export function widgetDef(key: string): WidgetDef | null {
  return WIDGET_CATALOGUE.find((w) => w.key === key) ?? null;
}

export function isStateWidget(key: string): boolean {
  return STATE_KEYS.has(key);
}

/** A placed tile. Persisted in localStorage — decision A said no new tables. */
export type PlacedWidget = { id: string; key: string; display: WidgetDisplay };

export const WIDGETS_STORAGE_KEY = "bousla.dashboardWidgets";
export const WIDGETS_MAX = 6;

/**
 * Parse whatever localStorage held, discarding anything that is no longer a
 * legal widget. A key removed from the catalogue (or from report_metrics)
 * must not resurrect itself from a stale browser.
 */
export function parseStoredWidgets(raw: string | null, allowed: WidgetDef[]): PlacedWidget[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowedKeys = new Set(allowed.map((w) => w.key));
    return parsed
      .filter((w): w is PlacedWidget =>
        !!w && typeof w === "object" &&
        typeof (w as PlacedWidget).id === "string" &&
        typeof (w as PlacedWidget).key === "string" &&
        allowedKeys.has((w as PlacedWidget).key)
      )
      .slice(0, WIDGETS_MAX);
  } catch {
    return [];
  }
}
