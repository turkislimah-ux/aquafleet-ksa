"use client";

// Client island for the Fleet page: 6 real KPIs, filter bar (search / status
// chips / station), and the truck roster table. Add Truck + Assign Driver modals
// are added in the next commit; this commit is the read-only list + filters.

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader, Card, Stat, StatusPill, Bar, Table, TH, TD } from "@/components/ui";
import {
  type TruckStatus,
  TRUCK_STATUS_LABELS,
  STATION_OPTIONS,
} from "@/lib/db-types";
import type { TruckRow, DriverLite } from "./page";
import { cn, formatNum } from "@/lib/utils";
import { Filter, Truck as TruckIcon, Eye } from "lucide-react";

type Kpis = {
  total: number;
  active: number;
  maint: number;
  oos: number;
  totalCap: number;
  capHasData: boolean;
  avgHealth: number | null;
};

// Status filter chips — our 4 statuses (Idle kept), plus "all".
const STATUS_CHIPS: Array<"all" | TruckStatus> = [
  "all",
  "active",
  "idle",
  "maintenance",
  "out_of_service",
];

function lastServiceLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function FleetClient({
  trucks,
  kpis,
  errorMsg,
}: {
  trucks: TruckRow[];
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  kpis: Kpis;
  errorMsg: string | null;
}) {
  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>("all");
  const [station, setStation] = useState<string>("all");
  const [q, setQ] = useState("");

  const list = useMemo(
    () =>
      trucks.filter((tr) => {
        if (status !== "all" && tr.status !== status) return false;
        if (station !== "all" && tr.home_station !== station) return false;
        if (q) {
          const s = q.toLowerCase();
          const hay = `${tr.plate} ${tr.model ?? ""}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      }),
    [trucks, status, station, q],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet"
        subtitle={`${kpis.total} trucks · Riyadh · 3 stations`}
      />

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          Failed to load fleet: {errorMsg}
        </p>
      )}

      {/* KPI strip (6) — all REAL */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Total Trucks" value={kpis.total} tone="info" />
        <Stat label="Active" value={kpis.active} tone="ok" />
        <Stat label="In Maintenance" value={kpis.maint} tone={kpis.maint > 6 ? "warn" : "info"} />
        <Stat label="Out of Service" value={kpis.oos} tone={kpis.oos > 0 ? "bad" : "ok"} />
        <Stat
          label="Total Capacity"
          value={kpis.capHasData ? `${formatNum(kpis.totalCap)} m³` : "—"}
          tone="info"
        />
        <Stat
          label="Avg Fleet Health"
          value={kpis.avgHealth ?? "—"}
          tone={kpis.avgHealth != null && kpis.avgHealth > 75 ? "ok" : "warn"}
        />
      </div>

      {/* Filter bar */}
      <Card className="!p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 muted ms-1" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search plate, model…"
            className="h-9 px-3 rounded-lg border text-sm flex-1 min-w-[200px]"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          />
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_CHIPS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "h-9 px-3 rounded-lg text-xs font-medium border",
                  status === s ? "bg-brand-600 text-white border-brand-600" : "",
                )}
                style={status !== s ? { borderColor: "rgb(var(--border))" } : undefined}
              >
                {s === "all" ? "All" : TRUCK_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="h-9 px-3 rounded-lg border text-sm"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          >
            <option value="all">All Stations</option>
            {STATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="muted text-xs ms-auto">{list.length} results</span>
        </div>
      </Card>

      {/* Table */}
      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>Plate</TH>
              <TH>Model</TH>
              <TH>Station</TH>
              <TH>Status</TH>
              <TH>Driver</TH>
              <TH>Health</TH>
              <TH>Capacity</TH>
              <TH>Odometer</TH>
              <TH>Last Service</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="py-6 px-3 border-t text-center muted text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  No trucks{trucks.length > 0 ? " match the filters" : " yet"}.
                </td>
              </tr>
            )}
            {list.map((tr) => (
              <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600 grid place-items-center">
                      <TruckIcon className="h-4 w-4" />
                    </div>
                    <div className="font-mono text-xs font-medium">{tr.plate}</div>
                  </div>
                </TD>
                <TD>
                  {tr.model ?? "—"}
                  {tr.year ? <span className="muted"> · {tr.year}</span> : null}
                </TD>
                <TD>{tr.home_station ?? "—"}</TD>
                <TD>
                  <StatusPill status={tr.status} label={TRUCK_STATUS_LABELS[tr.status]} />
                </TD>
                <TD>{tr.driverName ?? <span className="muted">—</span>}</TD>
                <TD>
                  {tr.health_score != null ? (
                    <div className="w-28">
                      <div className="text-[11px] tabular-nums mb-0.5">{tr.health_score}</div>
                      <Bar value={tr.health_score} />
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </TD>
                <TD className="tabular-nums font-medium">
                  {tr.capacity_m3 != null ? `${tr.capacity_m3} m³` : "—"}
                </TD>
                <TD className="tabular-nums">
                  {tr.odometer_km != null ? `${formatNum(tr.odometer_km)} km` : "—"}
                </TD>
                <TD className="text-xs">{lastServiceLabel(tr.last_service_date)}</TD>
                <TD>
                  <Link
                    href={`/fleet/${tr.id}`}
                    className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </Link>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
