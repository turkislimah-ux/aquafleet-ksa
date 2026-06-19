"use client";

// Dashboard client island. Mirrors the demo Dashboard (preview/pages-1.js
// dashboard()) exactly, section-for-section. Real data is computed server-side
// in page.tsx and passed in; values not yet backed by schema render "—"/"No data
// yet" and are flagged in the rebuild notes. Commit 1: header, 6 KPI tiles,
// Fleet Status pie, bottom 4 KPIs. Commit 2: Volume + Daily Trips charts,
// Operating Cost card, Critical Alerts + Live Trips sections. AI summary modal
// arrives in commit 3.

import Link from "next/link";
import { PageHeader, Stat, Btn, Section, StatusPill, Bar } from "@/components/ui";
import { PieChart, AreaChart, DualBarChart } from "@/components/Charts";
import { Activity, Plus, TrendingUp, TrendingDown, AlertTriangle, Droplets } from "lucide-react";
import { formatSar } from "@/lib/utils";
import { WATER_TYPE_LABELS, TRIP_STAGE_LABELS, type WaterType, type TripStage } from "@/lib/db-types";

type Fleet = { total: number; active: number; idle: number; maint: number; oos: number; avgHealth: number };
type Bottom = { todayTrips: number; onDuty: number; driversTotal: number; revenue30d: number };
type LiveTrip = {
  id: string;
  ref: string | null;
  stage: "loading" | "in_transit";
  truckLabel: string;
  station: string;
  waterType: WaterType;
  tankM3: number | null;
};

// Demo synthetic placeholder series (preview/pages-1.js dashboard()). These two
// charts are hardcoded in the demo too; replicated until real liters/fuel exist.
const VOLUME = Array.from({ length: 14 }, (_, i) => 90 + ((i * 7919) % 60000) / 1000);
const DAILY_TRIPS = Array.from({ length: 14 }, (_, i) => 22 + ((i * 13) % 14));
const DAILY_FUEL = Array.from({ length: 14 }, (_, i) => 18 + ((i * 7) % 9));
const last14Labels = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.now() - (13 - i) * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
});

// Operating Cost rows are hardcoded in the demo; replicated verbatim (PLACEHOLDER).
const COST_ROWS: [string, number][] = [
  ["Fuel", 142000],
  ["Maintenance", 58000],
  ["Drivers", 96000],
  ["Parts", 31000],
  ["Other", 18000],
];
const COST_MAX = 142000;

export default function DashboardClient({
  fleet,
  bottom,
  liveTrips,
  errorMsg,
}: {
  fleet: Fleet;
  bottom: Bottom;
  liveTrips: LiveTrip[];
  errorMsg: string | null;
}) {
  // Fleet Status pie — REAL (trucks.status counts).
  const pie = [
    { label: "Active", value: fleet.active, color: "#10b981" },
    { label: "Idle", value: fleet.idle, color: "#3b82f6" },
    { label: "Maintenance", value: fleet.maint, color: "#f59e0b" },
    { label: "Out of Service", value: fleet.oos, color: "#ef4444" },
  ];

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
            <Btn variant="primary">
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

      {/* 6 KPI tiles. REAL: Active Trucks, Avg Fleet Health. PLACEHOLDER ("—"):
          Utilization, On-Time, Open Work Orders, Critical Alerts. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="Active Trucks" value={`${fleet.active}/${fleet.total}`} sub={`${fleet.maint} Maintenance`} tone="ok" />
        <Stat label="Utilization" value="—" sub="30-day avg" tone="info" />
        <Stat label="Avg Fleet Health" value={fleet.avgHealth} sub="out of 100" tone={fleet.avgHealth > 75 ? "ok" : "warn"} />
        <Stat label="On-Time Delivery" value="—" sub="on schedule" tone="ok" />
        <Stat label="Open Work Orders" value="—" sub="active work orders" tone="warn" />
        <Stat label="Critical Alerts" value="—" sub="predictive AI" tone="bad" />
      </div>

      {/* Volume Delivered (2/3, PLACEHOLDER chart) + Fleet Status (1/3, REAL). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Volume Delivered (30d)</h3>
              <p className="text-xs muted">— m³ · 30 days</p>
            </div>
            <div className="text-emerald-600 text-xs flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> +12.4%
            </div>
          </div>
          <div className="h-64">
            <AreaChart labels={last14Labels} data={VOLUME} color="#0b7eea" className="h-full" />
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

      {/* Daily Trips & Fuel (2/3, PLACEHOLDER chart) + Operating Cost (1/3). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <h3 className="font-semibold mb-3">Daily Trips & Fuel</h3>
          <div className="h-56">
            <DualBarChart
              labels={last14Labels}
              d1={DAILY_TRIPS}
              d2={DAILY_FUEL}
              l1="Trips"
              l2="Fuel (L×100)"
              className="h-full"
            />
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">Operating Cost (30d)</h3>
          {/* Top value is data-driven in the demo (trips.costSar) — not in schema
              yet → PLACEHOLDER. Breakdown rows are hardcoded in the demo. */}
          <div className="text-2xl font-semibold tabular-nums">—</div>
          <p className="text-xs muted mb-4 flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-emerald-500" /> -4.8% vs last period
          </p>
          <div className="space-y-2">
            {COST_ROWS.map(([label, value]) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{label}</span>
                  <span className="font-medium tabular-nums">{formatSar(value)}</span>
                </div>
                <Bar value={value} max={COST_MAX} tone="ok" />
              </div>
            ))}
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
                      {tr.truckLabel} → {tr.station}
                    </div>
                    <div className="text-[11px] muted">
                      {tr.tankM3 != null ? `${tr.tankM3} m³` : "— m³"} · {WATER_TYPE_LABELS[tr.waterType]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Bottom 4 KPIs. REAL: Trips Today, Drivers On Duty, Revenue (30d, Σ
          rate_sar delivered). PLACEHOLDER ("—"): Fuel Cost. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Trips Today" value={bottom.todayTrips} sub="scheduled today" />
        <Stat label="Drivers On Duty" value={`${bottom.onDuty}/${bottom.driversTotal}`} tone="ok" />
        <Stat label="Fuel Cost (30d)" value="—" tone="warn" />
        <Stat label="Revenue (30d)" value={formatSar(bottom.revenue30d)} tone="ok" />
      </div>
    </div>
  );
}
