"use client";

// Dashboard client island. Mirrors the demo Dashboard (preview/pages-1.js
// dashboard()) exactly, section-for-section. Real data is computed server-side
// in page.tsx and passed in; values not yet backed by schema render "—" and are
// flagged in the rebuild notes (Utilization, On-Time, Open WOs, Critical Alerts,
// Fuel Cost). Commit 1 scope: header, 6 KPI tiles, Fleet Status pie, bottom 4
// KPIs. Volume/Daily-Trips charts + Operating Cost + Alerts/Live-Trips arrive in
// commit 2; the AI summary modal in commit 3.

import { PageHeader, Stat, Btn } from "@/components/ui";
import { PieChart } from "@/components/Charts";
import { Activity, Plus } from "lucide-react";
import { formatSar } from "@/lib/utils";

type Fleet = {
  total: number;
  active: number;
  idle: number;
  maint: number;
  oos: number;
  avgHealth: number;
};
type Bottom = {
  todayTrips: number;
  onDuty: number;
  driversTotal: number;
  revenue30d: number;
};

export default function DashboardClient({
  fleet,
  bottom,
  errorMsg,
}: {
  fleet: Fleet;
  bottom: Bottom;
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

      {/* Fleet Status pie — REAL. (Volume Delivered 2/3 card lands in commit 2.) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
