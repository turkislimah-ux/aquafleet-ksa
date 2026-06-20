"use client";

// Dashboard client island. Mirrors the demo Dashboard (preview/pages-1.js
// dashboard()) exactly, section-for-section. Real data is computed server-side
// in page.tsx and passed in; values not yet backed by schema render "—"/"No data
// yet" and are flagged in the rebuild notes. Commit 1: header, 6 KPI tiles,
// Fleet Status pie, bottom 4 KPIs. Commit 2: Volume + Daily Trips charts,
// Operating Cost card, Critical Alerts + Live Trips sections. Commit 3: AI
// summary modal + keyword-match engine (ports DASH.openAddWidget / dashInterpret
// / _widgetHtml). Datasets are precomputed server-side (page.tsx) and rendered
// here; datasets whose tables don't exist yet carry noData → "No data yet".

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader, Stat, Btn, Section, StatusPill } from "@/components/ui";
import { PieChart, AreaChart, BarChart } from "@/components/Charts";
import { Activity, Plus, TrendingUp, TrendingDown, Droplets, Zap, X } from "lucide-react";
import { formatSar, cn } from "@/lib/utils";
import { WATER_TYPE_LABELS, TRIP_STAGE_LABELS, type WaterType, type TripStage } from "@/lib/db-types";

type Fleet = { total: number; active: number; idle: number; maint: number; oos: number; avgHealth: number };
type Bottom = { onDuty: number; driversTotal: number };
type LiveTrip = {
  id: string;
  ref: string | null;
  stage: "loading" | "in_transit";
  truckLabel: string;
  station: string;
  waterType: WaterType;
  tankM3: number | null;
};

// Real chart series computed server-side (page.tsx), one PeriodSeries per window.
// Global period selector (daily=today, weekly=last 7d, monthly=last 30d) picks
// which precomputed set renders — no refetch, every number stays REAL. Each
// series buckets per-day. Volume/revenue carry hasData → honest-empty when the
// window has no source rows; fuel is always honest-empty (no schema source yet).
export type PeriodKey = "daily" | "weekly" | "monthly";
export type PeriodSeries = {
  windowDays: number;
  volume: { labels: string[]; values: number[]; total: number; pct: number | null; hasData: boolean };
  trips: { labels: string[]; counts: number[]; total: number };
  revenue: { labels: string[]; values: number[]; total: number; hasData: boolean };
  fuel: { labels: string[]; values: number[]; hasData: boolean };
};
export type DashboardCharts = Record<PeriodKey, PeriodSeries>;

// ---- AI summary widget engine types (ported from DASH/dashCompute) ----
export type Tone = "ok" | "warn" | "bad" | "info";
export type WidgetStat = { label: string; value: ReactNode; tone?: Tone };
export type WidgetItem = { label: string; value: number; color: string };
export type WidgetSpec = {
  title: string;
  defaultDisplay: Display;
  chartKind: "pie" | "bars" | "line";
  stats?: WidgetStat[];
  items?: WidgetItem[];
  line?: { labels: string[]; values: number[]; color: string };
  table?: { cols: string[]; rows: (string | number)[][] };
  noData?: boolean; // table/columns not in schema yet → render "No data yet"
};
export type DatasetKey =
  | "fleet" | "drivers" | "trips" | "fuel" | "water" | "revenue" | "cost"
  | "maintenance" | "inventory" | "alerts" | "commissions" | "depots"
  | "utilization" | "overview";
export type Datasets = Record<DatasetKey, WidgetSpec>;

type Display = "stat" | "chart" | "table";
type Widget = { id: string; request: string; display: Display; datasetKey: DatasetKey; title: string };

// dashInterpret() ported 1:1 (preview/pages-1.js:2471). Keyword → dataset key,
// then resolve display (auto/stat/chart/table). Arabic keywords kept verbatim.
const KEYWORD_MAP: { key: DatasetKey; words: string[] }[] = [
  { key: "fleet", words: ["truck", "fleet", "vehicle", "شاحن", "أسطول", "مركب"] },
  { key: "drivers", words: ["driver", "سائق"] },
  { key: "fuel", words: ["fuel", "diesel", "وقود", "ديزل"] },
  { key: "water", words: ["water", "liter", "litre", "مياه", "ماء", "لتر"] },
  { key: "trips", words: ["trip", "delivery", "deliver", "رحل", "تسليم"] },
  { key: "maintenance", words: ["maintenance", "work order", "repair", "صيان", "إصلاح", "أمر عمل"] },
  { key: "inventory", words: ["part", "inventory", "stock", "spare", "قطع", "مخزون", "مخزن"] },
  { key: "alerts", words: ["alert", "predict", "warning", "risk", "تنبيه", "تنبؤ", "خطر", "إنذار"] },
  { key: "commissions", words: ["commission", "payout", "عمول", "مستحق"] },
  { key: "revenue", words: ["revenue", "income", "sales", "إيراد", "دخل", "مبيع"] },
  { key: "cost", words: ["cost", "expense", "spend", "operating", "تكلف", "مصروف", "نفق"] },
  { key: "depots", words: ["depot", "region", "branch", "مستودع", "منطقة", "فرع"] },
  { key: "utilization", words: ["utiliz", "health", "uptime", "performance", "استخدام", "أداء", "صحة"] },
];

function interpret(req: string, pref: string, datasets: Datasets): { datasetKey: DatasetKey; display: Display; title: string } {
  const q = req.toLowerCase();
  let key: DatasetKey = "overview";
  for (const m of KEYWORD_MAP) {
    if (m.words.some((w) => q.includes(w))) {
      key = m.key;
      break;
    }
  }
  const spec = datasets[key];
  let display: Display | "auto" = (pref as Display | "auto") || "auto";
  if (!display || display === "auto") {
    if (/table|جدول/.test(q)) display = "table";
    else if (/chart|graph|plot|pie|bar|line|trend|رسم|مخطط|بياني|منحنى/.test(q)) display = "chart";
    else if (/stat|number|kpi|count|total|metric|إحصاء|رقم|عدد|إجمالي/.test(q)) display = "stat";
    else display = spec.defaultDisplay;
  }
  return { datasetKey: key, display, title: spec.title };
}

const EXAMPLES = [
  "Fuel consumption by depot as a chart",
  "Low-stock parts as a table",
  "Predictive alerts by severity",
  "Revenue over the last 14 days",
  "Drivers on duty stats",
];

// Global period selector. Windows per the approved spec: daily = today only,
// weekly = last 7 days, monthly = last 30 days. PERIOD_SUB is the human label
// used on every period-controlled tile/card so the window is always explicit.
const PERIODS: PeriodKey[] = ["daily", "weekly", "monthly"];
const PERIOD_LABEL: Record<PeriodKey, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const PERIOD_SUB: Record<PeriodKey, string> = { daily: "today", weekly: "last 7 days", monthly: "last 30 days" };

// _widgetHtml() port: renders a widget card (stat grid / table / chart). noData
// datasets show "No data yet" regardless of display, until their pages land.
function WidgetCard({ w, spec, onRemove }: { w: Widget; spec: WidgetSpec; onRemove: () => void }) {
  let body: ReactNode;
  if (spec.noData) {
    body = <p className="text-sm muted py-4 text-center">No data yet</p>;
  } else if (w.display === "stat") {
    const cards: WidgetStat[] =
      spec.stats && spec.stats.length
        ? spec.stats
        : (spec.items ?? []).slice(0, 6).map((it) => ({ label: it.label, value: it.value, tone: "info" as Tone }));
    body = (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((s, i) => (
          <Stat key={i} label={s.label} value={s.value} tone={s.tone} />
        ))}
      </div>
    );
  } else if (w.display === "table") {
    const cols = spec.table ? spec.table.cols : ["Item", "Value"];
    const rows: (string | number)[][] = spec.table ? spec.table.rows : (spec.items ?? []).map((it) => [it.label, it.value]);
    body = rows.length === 0 ? (
      <p className="muted text-sm">No data</p>
    ) : (
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className="text-start font-medium muted py-2 text-xs uppercase tracking-wide">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={cn("py-1.5 border-t", ci === 0 ? "" : "tabular-nums")} style={{ borderColor: "rgb(var(--border))" }}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    // chart — mirrors DASH._drawAll: line→AreaChart, pie→PieChart, else→BarChart.
    if (spec.chartKind === "line" && spec.line) {
      body = (
        <div className="h-64">
          <AreaChart labels={spec.line.labels} data={spec.line.values} color={spec.line.color} className="h-full" />
        </div>
      );
    } else if (spec.chartKind === "pie") {
      body = (
        <div className="h-64">
          <PieChart items={spec.items ?? []} className="h-full" />
        </div>
      );
    } else {
      const items = spec.items ?? [];
      body = (
        <div className="h-64">
          <BarChart labels={items.map((i) => i.label)} data={items.map((i) => i.value)} colors={items.map((i) => i.color)} className="h-full" />
        </div>
      );
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{w.title || spec.title}</h3>
          <p className="text-[11px] muted truncate flex items-center gap-1">
            <Zap className="h-3 w-3 shrink-0" /> {w.request}
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label="Remove summary"
          className="h-7 w-7 rounded-lg grid place-items-center shrink-0 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {body}
    </div>
  );
}

export default function DashboardClient({
  fleet,
  bottom,
  liveTrips,
  charts,
  datasets,
  errorMsg,
}: {
  fleet: Fleet;
  bottom: Bottom;
  liveTrips: LiveTrip[];
  charts: DashboardCharts;
  datasets: Datasets;
  errorMsg: string | null;
}) {
  // Fleet Status pie — REAL (trucks.status counts).
  const pie = [
    { label: "Active", value: fleet.active, color: "#10b981" },
    { label: "Idle", value: fleet.idle, color: "#3b82f6" },
    { label: "Maintenance", value: fleet.maint, color: "#f59e0b" },
    { label: "Out of Service", value: fleet.oos, color: "#ef4444" },
  ];

  // AI summary widgets — session state (demo persists in APP_STATE.dashWidgets).
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [req, setReq] = useState("");
  const [displayPref, setDisplayPref] = useState<string>("auto");

  // Global period selector. Default monthly (30 daily buckets) — the richest
  // view; daily collapses to a single bucket (today) given date-only trip data.
  const [period, setPeriod] = useState<PeriodKey>("monthly");
  const series = charts[period];
  const periodSub = PERIOD_SUB[period];

  function generate() {
    const r = req.trim();
    if (!r) return;
    const res = interpret(r, displayPref, datasets);
    setWidgets((prev) => [
      { id: "W" + Date.now().toString(36), request: r, display: res.display, datasetKey: res.datasetKey, title: res.title },
      ...prev,
    ]);
    setModalOpen(false);
    setReq("");
    setDisplayPref("auto");
  }

  function closeModal() {
    setModalOpen(false);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        // Q6 deliberate deviation: real op is Riyadh / 3 stations, live truck count.
        subtitle={`Operations overview · ${fleet.total} trucks · Riyadh · 3 stations`}
        actions={
          <>
            <Btn variant="outline">
              <Activity className="h-4 w-4" /> Live IoT
            </Btn>
            <Btn variant="primary" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> Add summary
            </Btn>
          </>
        }
      />

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          Failed to load dashboard: {errorMsg}
        </p>
      )}

      {/* Global period selector — controls every time-based tile & chart. */}
      <div className="flex items-center gap-2">
        <span className="text-xs muted">Period</span>
        <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "rgb(var(--border))" }}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition",
                period === p ? "bg-brand-600 text-white shadow-soft" : "muted hover:bg-black/5 dark:hover:bg-white/5"
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <span className="text-xs muted">· {periodSub}</span>
      </div>

      {/* AI summary widgets (DASH.renderWidgets) — render above the KPI grid. */}
      {widgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {widgets.map((w) => (
            <WidgetCard
              key={w.id}
              w={w}
              spec={datasets[w.datasetKey]}
              onRemove={() => setWidgets((prev) => prev.filter((x) => x.id !== w.id))}
            />
          ))}
        </div>
      )}

      {/* 10 KPI tiles in one 5-col grid (2 rows). REAL: Active Trucks, Avg Fleet
          Health, Trips Today, Drivers On Duty, Revenue (30d). PLACEHOLDER ("—"):
          Utilization, On-Time, Open Work Orders, Critical Alerts, Fuel Cost. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Active Trucks" value={`${fleet.active}/${fleet.total}`} sub={`${fleet.maint} Maintenance`} tone="ok" />
        <Stat label="Utilization" value="—" sub="30-day avg" tone="info" />
        <Stat label="Avg Fleet Health" value={fleet.avgHealth} sub="out of 100" tone={fleet.avgHealth > 75 ? "ok" : "warn"} />
        <Stat label="On-Time Delivery" value="—" sub="on schedule" tone="ok" />
        <Stat label="Open Work Orders" value="—" sub="active work orders" tone="warn" />
        <Stat label="Critical Alerts" value="—" sub="predictive AI" tone="bad" />
        <Stat label="Trips" value={series.trips.total} sub={periodSub} tone="info" />
        <Stat label="Drivers On Duty" value={`${bottom.onDuty}/${bottom.driversTotal}`} tone="ok" />
        <Stat label="Fuel Cost (30d)" value="—" tone="warn" />
        <Stat label="Revenue" value={formatSar(series.revenue.total)} sub={periodSub} tone="ok" />
      </div>

      {/* Volume Delivered (2/3, REAL Σ tank_size_m3/day or honest-empty) + Fleet Status (1/3, REAL). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Volume Delivered</h3>
              <p className="text-xs muted">
                {series.volume.hasData ? `${Math.round(series.volume.total).toLocaleString("en-US")} m³` : "— m³"} · {periodSub}
              </p>
            </div>
            {/* Real period-over-period %; hidden entirely when no data / prior=0. */}
            {series.volume.pct != null && (
              series.volume.pct >= 0 ? (
                <div className="text-emerald-600 text-xs flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> +{series.volume.pct}%
                </div>
              ) : (
                <div className="text-rose-600 text-xs flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> {series.volume.pct}%
                </div>
              )
            )}
          </div>
          <div className="h-64">
            {series.volume.hasData ? (
              <AreaChart labels={series.volume.labels} data={series.volume.values} color="#0b7eea" className="h-full" />
            ) : (
              <div className="h-full grid place-items-center">
                <p className="text-sm muted">No data yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">Fleet Status</h3>
          <div className="h-52">
            <PieChart items={pie} className="h-full" />
          </div>
          <div className="space-y-1.5 mt-2 text-xs">
            {pie.map((e) => (
              <div key={e.label} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                  {e.label}
                </span>
                <span className="font-medium tabular-nums">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily Trips (2/3, REAL counts; Fuel honest-empty) + Operating Cost (1/3, honest-empty). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3">
            <h3 className="font-semibold">Trips &amp; Fuel</h3>
            <p className="text-xs muted">{series.trips.total} trips · {periodSub}</p>
          </div>
          <div className="h-48">
            <BarChart labels={series.trips.labels} data={series.trips.counts} className="h-full" />
          </div>
          {/* Fuel series intentionally absent — no fuel data in schema yet. */}
          <p className="text-xs muted mt-2">Fuel — no data yet</p>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">Operating Cost (30d)</h3>
          {/* Honest-empty until cost tables land (Maintenance/Inventory phases).
              No hardcoded rows, no fake % badge. */}
          <p className="text-sm muted py-8 text-center">No data yet</p>
        </div>
      </div>

      {/* Two standalone line charts (period-aware). Revenue = REAL Σ rate_sar of
          delivered trips per bucket. Fuel = real, working chart that's honest-empty
          today (no fuel schema) and lights up automatically once fuel data lands. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Revenue</h3>
              <p className="text-xs muted">
                {series.revenue.hasData ? formatSar(series.revenue.total) : "— SAR"} · {periodSub}
              </p>
            </div>
          </div>
          <div className="h-56">
            {series.revenue.hasData ? (
              <AreaChart labels={series.revenue.labels} data={series.revenue.values} color="#10b981" className="h-full" />
            ) : (
              <div className="h-full grid place-items-center">
                <p className="text-sm muted">No data yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Fuel Consumption</h3>
              <p className="text-xs muted">
                {series.fuel.hasData ? `${series.fuel.values.reduce((s, v) => s + v, 0).toLocaleString("en-US")} L` : "— L"} · {periodSub}
              </p>
            </div>
          </div>
          <div className="h-56">
            {series.fuel.hasData ? (
              <AreaChart labels={series.fuel.labels} data={series.fuel.values} color="#f59e0b" className="h-full" />
            ) : (
              <div className="h-full grid place-items-center">
                <p className="text-sm muted">No data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Critical Predictive Alerts (PLACEHOLDER, table pending) + Live Trips (REAL). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Critical Predictive Alerts"
          action={
            <Link href="/predictive" className="text-brand-600 dark:text-brand-300 text-xs font-medium">
              View all →
            </Link>
          }
        >
          <p className="text-sm muted py-4 text-center">No data yet</p>
        </Section>

        <Section
          title="Live Trips"
          action={
            <Link href="/trips" className="text-brand-600 dark:text-brand-300 text-xs font-medium">
              View all →
            </Link>
          }
        >
          {liveTrips.length === 0 ? (
            <p className="text-sm muted py-4 text-center">No live trips</p>
          ) : (
            <div className="space-y-2">
              {liveTrips.map((tr) => (
                <div key={tr.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <Droplets className="h-5 w-5 text-brand-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{tr.ref ?? "—"}</div>
                      <StatusPill status={tr.stage} label={TRIP_STAGE_LABELS[tr.stage as TripStage]} />
                    </div>
                    <div className="text-xs muted truncate">
                      {tr.truckLabel} → {tr.station || "—"}
                    </div>
                    <div className="text-[11px] muted">
                      {tr.tankM3 != null ? `${tr.tankM3} m³` : "— m³"} · {WATER_TYPE_LABELS[tr.waterType] ?? tr.waterType}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* AI summary widget modal (DASH.openAddWidget port). */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/50" onClick={closeModal}>
          <div
            className="card w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Zap className="h-4 w-4 text-brand-500" /> AI summary widget
              </h3>
              <button
                onClick={closeModal}
                aria-label="Close"
                className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm muted">
              Describe the data you want on your dashboard. The AI picks the best reader — chart, statistics or table — and builds it live from your fleet data.
            </p>

            <div>
              <label className="text-xs font-medium muted block mb-1">What do you want to see?</label>
              <textarea
                value={req}
                onChange={(e) => setReq(e.target.value)}
                placeholder="e.g. Show fuel consumption by depot as a chart"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/30 bg-transparent"
                style={{ minHeight: 70, borderColor: "rgb(var(--border))" }}
              />
            </div>

            <div>
              <label className="text-xs font-medium muted block mb-1">Try</label>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setReq(ex)}
                    className="text-xs rounded-full border px-2.5 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium muted block mb-1">Display as</label>
              <select
                value={displayPref}
                onChange={(e) => setDisplayPref(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              >
                <option value="auto">Auto (let AI decide)</option>
                <option value="stat">Statistics</option>
                <option value="chart">Chart</option>
                <option value="table">Table</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Btn variant="outline" onClick={closeModal}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={generate}>
                <Zap className="h-4 w-4" /> Generate
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
