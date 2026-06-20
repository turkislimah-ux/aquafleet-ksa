"use client";

// Client island for the Fleet page: 6 real KPIs, filter bar (search / status
// chips / station), the truck roster table, and two modals — Add Truck (rejects
// duplicate plates) and Assign Driver (busy drivers are locked; assigning frees
// the driver from any other truck first).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Bar, Btn, Table, TH, TD } from "@/components/ui";
import {
  type TruckStatus,
  TRUCK_STATUS_LABELS,
  DRIVER_STATUS_LABELS,
  type DriverStatus,
  STATION_OPTIONS,
} from "@/lib/db-types";
import type { TruckRow, DriverLite } from "./page";
import { createTruck, assignDriver, unassignDriver } from "./actions";
import { cn, formatNum } from "@/lib/utils";
import { Filter, Truck as TruckIcon, Eye, Plus, Users, X } from "lucide-react";

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

// Tank classes offered in Add Truck (mirrors the demo's m³ options).
const CAPACITY_OPTIONS_M3 = [33, 18, 6] as const;

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

function lastServiceLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function FleetClient({
  trucks,
  drivers,
  trips30d,
  kpis,
  errorMsg,
}: {
  trucks: TruckRow[];
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  kpis: Kpis;
  errorMsg: string | null;
}) {
  const router = useRouter();

  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>("all");
  const [station, setStation] = useState<string>("all");
  const [q, setQ] = useState("");

  // Add Truck modal
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Assign Driver modal — holds the truck whose driver is being changed.
  const [assignTruck, setAssignTruck] = useState<TruckRow | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  // driverId -> the truck currently holding them (busy-lock + "Current" marker).
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckRow>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);

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

  function openAdd() {
    setAddError(null);
    setAddOpen(true);
  }
  function openAssign(tr: TruckRow) {
    setAssignError(null);
    setAssignTruck(tr);
  }

  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setAddError(null);
    const res = await createTruck(new FormData(e.currentTarget));
    setSaving(false);
    if (res.error) {
      setAddError(res.error);
      return;
    }
    setAddOpen(false);
    router.refresh();
  }

  async function doAssign(driverId: string) {
    if (!assignTruck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await assignDriver(assignTruck.id, driverId);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignTruck(null);
    router.refresh();
  }

  async function doUnassign() {
    if (!assignTruck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await unassignDriver(assignTruck.id);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignTruck(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet"
        subtitle={`${kpis.total} trucks · Riyadh · 3 stations`}
        actions={
          <Btn variant="primary" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add Truck
          </Btn>
        }
      />

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">Failed to load fleet: {errorMsg}</p>
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
                <TD>
                  {tr.driverName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{tr.driverName}</span>
                      <button
                        title="Change driver"
                        onClick={() => openAssign(tr)}
                        className="h-6 w-6 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Users className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <Btn variant="outline" onClick={() => openAssign(tr)}>
                      <Plus className="h-3.5 w-3.5" /> Assign Driver
                    </Btn>
                  )}
                </TD>
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

      {/* ---- Add Truck modal ---- */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">Add New Truck</h2>
            <p className="text-sm muted mb-4">Register a new water truck. Plate is required.</p>
            <form onSubmit={submitAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Plate *</span>
                <input name="plate" required placeholder="e.g. 5041 ABJ" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Model</span>
                <input name="model" placeholder="e.g. Mercedes-Benz Actros 3340" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Year</span>
                <input name="year" type="number" min="1980" max="2030" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Capacity</span>
                <select name="capacity_m3" defaultValue="33" className={INPUT} style={INPUT_STYLE}>
                  {CAPACITY_OPTIONS_M3.map((c) => (
                    <option key={c} value={c}>
                      {c} m³
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Status</span>
                <select name="status" defaultValue="active" className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(TRUCK_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Station</span>
                <select name="home_station" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Odometer (km)</span>
                <input name="odometer_km" type="number" min="0" defaultValue="0" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Engine hours</span>
                <input name="engine_hours" type="number" min="0" defaultValue="0" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">VIN</span>
                <input name="vin" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Assigned driver</span>
                <select name="assigned_driver_id" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              {addError && (
                <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{addError}</p>
              )}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Btn>
                <Btn type="submit" variant="primary">
                  {saving ? "Saving…" : "Save"}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- Assign Driver modal ---- */}
      {assignTruck && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={() => setAssignTruck(null)}
        >
          <div
            className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold">Assign Driver — {assignTruck.plate}</h2>
              <button
                onClick={() => setAssignTruck(null)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">Select a driver to assign · {assignTruck.plate}</p>

            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Driver</TH>
                  <TH>Status</TH>
                  <TH>Availability</TH>
                  <TH>Safety</TH>
                  <TH>Trips 30d</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-6 px-3 border-t text-center muted text-sm"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      No drivers yet.
                    </td>
                  </tr>
                )}
                {drivers.map((d) => {
                  const busyTruck = truckByDriver.get(d.id);
                  const isCurrent = assignTruck.assigned_driver_id === d.id;
                  const busyElsewhere = !!busyTruck && busyTruck.id !== assignTruck.id;
                  const locked = busyElsewhere && !isCurrent;
                  const statusKey = (d.status in DRIVER_STATUS_LABELS ? d.status : "inactive") as DriverStatus;
                  return (
                    <tr
                      key={d.id}
                      onClick={locked || assignSaving ? undefined : () => doAssign(d.id)}
                      className={cn(
                        isCurrent && "bg-brand-500/5",
                        locked
                          ? "opacity-60 cursor-not-allowed"
                          : "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
                      )}
                    >
                      <TD className="font-medium">{d.name}</TD>
                      <TD>
                        <StatusPill status={d.status} label={DRIVER_STATUS_LABELS[statusKey]} />
                      </TD>
                      <TD className={cn("text-xs", busyElsewhere ? "muted" : "text-emerald-600 dark:text-emerald-400 font-medium")}>
                        {busyElsewhere ? `Already assigned · ${busyTruck!.plate}` : "Available"}
                      </TD>
                      <TD className="tabular-nums text-xs">{d.safety_score ?? "—"}</TD>
                      <TD className="tabular-nums text-xs">{trips30d[d.id] ?? 0}</TD>
                      <TD>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Current
                          </span>
                        ) : null}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            {assignError && (
              <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{assignError}</p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              {assignTruck.assigned_driver_id && (
                <Btn variant="outline" onClick={doUnassign}>
                  {assignSaving ? "…" : "Unassign"}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setAssignTruck(null)}>
                Close
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
