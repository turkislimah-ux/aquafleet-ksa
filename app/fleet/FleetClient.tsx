"use client";

// Client island for the Fleet page: 6 real KPIs, filter bar (search / status
// chips / station), the truck roster table, and the modals — Add Truck, Edit
// Truck (both via the shared TruckFormModal) and Assign Driver (busy drivers are
// locked; assigning frees the driver from any other truck first).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Bar, Btn, Table, TH, TD } from "@/components/ui";
import { type OperationStation } from "@/lib/db-types";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";
import { TRUCK_OPS_STATE_LABELS, type TruckOpsState } from "@/lib/truck-status";
import type { TruckRow, DriverLite } from "./page";
import { assignDriver, unassignDriver } from "./actions";
import TruckFormModal from "./TruckFormModal";
import { cn, formatNum } from "@/lib/utils";
import { pillColor } from "@/lib/project-colors";
import { Filter, Truck as TruckIcon, Eye, Plus, Pencil, Users, X } from "lucide-react";

type Kpis = {
  total: number;
  active: number;
  maint: number;
  idle: number;
  totalCap: number;
  capHasData: boolean;
  avgHealth: number | null;
};

// Status filter chips — Auto Truck-Status's 3-state derived model, plus
// "all". Precedence order (maintenance > active > idle) matches
// lib/truck-status.ts's own. "out_of_service" is gone — no manual-override
// path produces it anymore (see lib/truck-status.ts's own header).
const STATUS_CHIPS: Array<"all" | TruckOpsState> = [
  "all",
  "maintenance",
  "active",
  "idle",
];

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
  onLeaveDriverIds,
  driverStateById,
  truckStatusById,
  activeProjectNamesByDriver,
  operationStations,
  kpis,
  errorMsg,
}: {
  trucks: TruckRow[];
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  onLeaveDriverIds: string[];
  driverStateById: Record<string, DriverState>;
  // Auto Truck-Status Phase 2a — derived, single source of truth (lib/
  // truck-status.ts). REPLACES trucks.status for every display here.
  truckStatusById: Record<string, TruckOpsState>;
  // driver_id -> stacked {id, name} of their active projects — resolved per
  // truck via its assigned driver. id feeds pillColor() so a project's pill
  // color matches the Trips board.
  activeProjectNamesByDriver: Record<string, { id: string; name: string }[]>;
  operationStations: OperationStation[];
  kpis: Kpis;
  errorMsg: string | null;
}) {
  const router = useRouter();
  // Computed on-leave-today set (authoritative). Drives the pill + disables the
  // assign row (UI only — assignDriver has no server-side availability rejection).
  const onLeave = useMemo(() => new Set(onLeaveDriverIds), [onLeaveDriverIds]);

  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>("all");
  const [station, setStation] = useState<string>("all");
  const [q, setQ] = useState("");

  // Add / Edit Truck modals (shared TruckFormModal).
  const [addOpen, setAddOpen] = useState(false);
  const [editTruck, setEditTruck] = useState<TruckRow | null>(null);

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

  // uuid -> name, built from ALL operation_stations rows (active + inactive) so
  // a truck based at a since-deactivated station still resolves here.
  const stationNameById = useMemo(
    () => new Map(operationStations.map((s) => [s.id, s.name])),
    [operationStations],
  );
  // Filter dropdown options: active stations, PLUS any inactive station a truck
  // in this list is still currently based at (so the filter can still find it,
  // and its name still resolves — matches OperationStationField's same rule).
  const stationFilterOptions = useMemo(() => {
    const assignedIds = new Set(
      trucks.map((t) => t.home_station).filter((id): id is string => id != null),
    );
    return operationStations.filter((s) => s.active || assignedIds.has(s.id));
  }, [operationStations, trucks]);

  const list = useMemo(
    () =>
      trucks.filter((tr) => {
        if (status !== "all" && truckStatusById[tr.id] !== status) return false;
        if (station !== "all" && tr.home_station !== station) return false;
        if (q) {
          const s = q.toLowerCase();
          const hay = `${tr.plate} ${tr.model ?? ""}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      }),
    [trucks, status, station, q, truckStatusById],
  );

  function openAssign(tr: TruckRow) {
    setAssignError(null);
    setAssignTruck(tr);
  }

  function onTruckSaved() {
    setAddOpen(false);
    setEditTruck(null);
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
          <Btn variant="primary" onClick={() => setAddOpen(true)}>
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
        <Stat label="Idle" value={kpis.idle} tone="info" />
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
                {s === "all" ? "All" : TRUCK_OPS_STATE_LABELS[s]}
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
            {stationFilterOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{!s.active ? " (deactivated)" : ""}
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
              <TH>Assigned Project</TH>
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
                  colSpan={11}
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
                <TD>{tr.home_station ? stationNameById.get(tr.home_station) ?? "—" : "—"}</TD>
                <TD>
                  <StatusPill status={truckStatusById[tr.id] ?? "idle"} label={TRUCK_OPS_STATE_LABELS[truckStatusById[tr.id] ?? "idle"]} />
                </TD>
                <TD>
                  {tr.driverName ? (
                    <button
                      type="button"
                      title="Change driver"
                      onClick={() => openAssign(tr)}
                      className="inline-flex items-center gap-1.5 -mx-2 rounded-md px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Users className="h-3.5 w-3.5 muted shrink-0" />
                      <span>{tr.driverName}</span>
                    </button>
                  ) : (
                    <Btn variant="outline" onClick={() => openAssign(tr)}>
                      <Plus className="h-3.5 w-3.5" /> Assign Driver
                    </Btn>
                  )}
                </TD>
                <TD>
                  {(() => {
                    const projs = tr.assigned_driver_id ? activeProjectNamesByDriver[tr.assigned_driver_id] : undefined;
                    return projs && projs.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {projs.map((p) => (
                          <span
                            key={p.id}
                            title={p.name}
                            className={cn(
                              "inline-block w-fit max-w-[10rem] rounded px-1.5 py-0.5 text-[11px] font-medium truncate",
                              pillColor(p.id)
                            )}
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    );
                  })()}
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
                  <div className="flex items-center gap-1.5">
                    <button
                      title="Edit truck"
                      onClick={() => setEditTruck(tr)}
                      className="h-9 w-9 grid place-items-center rounded-lg border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <Link
                      href={`/fleet/${tr.id}`}
                      className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Eye className="h-3.5 w-3.5" /> View
                    </Link>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ---- Add Truck modal ---- */}
      {addOpen && (
        <TruckFormModal
          mode="add"
          drivers={drivers}
          operationStations={operationStations}
          onClose={() => setAddOpen(false)}
          onSaved={onTruckSaved}
        />
      )}

      {/* ---- Edit Truck modal ---- */}
      {editTruck && (
        <TruckFormModal
          mode="edit"
          truck={editTruck}
          drivers={drivers}
          operationStations={operationStations}
          onClose={() => setEditTruck(null)}
          onSaved={onTruckSaved}
        />
      )}

      {/* ---- Assign Driver modal ---- */}
      {assignTruck && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={() => setAssignTruck(null)}
        >
          <div
            className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
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
                  const onLeaveToday = onLeave.has(d.id);
                  // UI-only lock: busy elsewhere OR on leave today (never the current driver).
                  const locked = (busyElsewhere || onLeaveToday) && !isCurrent;
                  const state = driverStateById[d.id] ?? "off_duty";
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
                        <StatusPill status={state} label={DRIVER_STATE_LABELS[state]} />
                      </TD>
                      <TD className={cn("text-xs", busyElsewhere || onLeaveToday ? "muted" : "text-emerald-600 dark:text-emerald-400 font-medium")}>
                        {busyElsewhere ? `Already assigned · ${busyTruck!.plate}` : onLeaveToday ? "On leave today" : "Available"}
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
