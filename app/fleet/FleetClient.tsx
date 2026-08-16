"use client";

// Client island for the Fleet page: 6 real KPIs, filter bar (search / status
// chips / station), the truck roster table, and the modals — Add Truck, Edit
// Truck (both via the shared TruckFormModal) and Assign Driver (busy drivers are
// locked; assigning frees the driver from any other truck first).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Btn, Table, TH, TD } from "@/components/ui";
import { type OperationStation } from "@/lib/db-types";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";
import { driverAvailability } from "@/lib/driver-assignment";
import { TRUCK_OPS_STATE_LABELS, type TruckOpsState } from "@/lib/truck-status";
import type { TruckRow, DriverLite } from "./page";
import { assignDriver, unassignDriver } from "./actions";
import TruckFormModal from "./TruckFormModal";
import { cn, formatNum } from "@/lib/utils";
import { pillColor } from "@/lib/project-colors";
import {
  utilizationBand, utilizationBarWidth, formatUtilization, utilizationNaReason,
  UTILIZATION_BAND, type TruckUtilizationRow,
} from "@/lib/utilization";
import { Activity, Eye, Filter, Pencil, Plus, Truck as TruckIcon, Users, X } from "lucide-react";

type Kpis = {
  total: number;
  active: number;
  maint: number;
  idle: number;
  totalCap: number;
  capHasData: boolean;
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

/**
 * THE HEALTH BAR IS CHROME, NOT DATA — it reads nothing, on purpose.
 *
 * health_score was a demo-era column with no source: null on every truck,
 * written by nothing, and it is being dropped from the table. Rather than
 * delete the column from the list and leave a hole where fleet health belongs,
 * the bar stays as a placeholder for the IoT phase that will fill it.
 *
 * It renders a fixed EMPTY state — grey track, 0% fill — for every truck. There
 * is no prop, so it cannot accidentally start reflecting a stale or fabricated
 * figure, and no number is printed beside it: "0" would be a reading, and we
 * have no reading. The note at the bottom of the page says why it is empty.
 *
 * THE COLOUR SCALE IS BUILT AND DORMANT, so the day sensors land the only
 * change is passing a value in:
 *     <= 40   critical    rose
 *     <= 70   attention   amber
 *      > 70   healthy     emerald
 * With no data none of those thresholds fire — grey is not on the scale, it is
 * the absence of one. Track geometry matches preview/app.css's .bar-track
 * (6px, fully rounded) and the w-28 column width the demo uses.
 */
function healthScaleClass(pct: number): string {
  if (pct <= 40) return "bg-rose-500";
  if (pct <= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

/** "2026-08-01" -> "August 2026". Local formatting only; no date math. */
function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-");
  const name = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ][Number(m) - 1];
  return name ? `${name} ${y}` : monthStart;
}

/**
 * One truck's utilization for the current month.
 *
 * READS THE VIEW, COMPUTES NOTHING. The percentage, the day counts and the NULL
 * all arrive from v_truck_utilization_monthly (0130); this decides only how they
 * are worn, via lib/utilization.ts.
 *
 * THREE DISTINCT STATES, and collapsing any two of them would lie:
 *   · no row at all      -> "—". The view has nothing for this truck this month.
 *   · row, pct is NULL   -> "N/A" + why. Zero available days, so the question
 *                           has no answer. NEVER 0%.
 *   · row, pct is 0.00   -> "0.0%" in the under-used band. The truck COULD have
 *                           worked and did not — the alarm this metric exists
 *                           to raise. Live right now: seven trucks.
 * Live, both middle and last cases are on screen at once (1112/1113 BBB read
 * N/A while seven others read 0.0%), so the difference is visible rather than
 * theoretical.
 */
function UtilizationCell({ row }: { row: TruckUtilizationRow | undefined }) {
  if (!row) return <span className="muted">—</span>;

  const band = utilizationBand(row.utilization_pct);
  const tone = UTILIZATION_BAND[band];
  const isNa = row.utilization_pct == null;
  const title = isNa
    ? utilizationNaReason(row)
    : `${row.worked_days} of ${row.available_days} available days worked` +
      (row.maintenance_days > 0 ? ` · ${row.maintenance_days} in maintenance` : "") +
      (row.out_of_service_days > 0 ? ` · ${row.out_of_service_days} out of service` : "");

  return (
    <div className="min-w-[7.5rem]" title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("text-xs font-medium tabular-nums", isNa ? "muted" : tone.text)}>
          {formatUtilization(row.utilization_pct)}
        </span>
        {!isNa && (
          <span className="text-[10px] muted tabular-nums">
            {row.worked_days}/{row.available_days}d
          </span>
        )}
      </div>
      {/* No bar at all for N/A — an empty track at zero width reads as 0%,
          which is the one thing this cell must never say. */}
      {isNa ? (
        <div className="mt-1 text-[10px] muted">no available days</div>
      ) : (
        <div className="mt-1 h-1.5 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div
            className={cn("h-full rounded-full", tone.bar)}
            style={{ width: `${utilizationBarWidth(row.utilization_pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function HealthBar({ pct }: { pct?: number }) {
  const hasReading = typeof pct === "number";
  const width = hasReading ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div className="w-28">
      <div
        className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden"
        role="img"
        aria-label={hasReading ? `Health ${width}%` : "Health monitoring not active yet"}
        title={hasReading ? undefined : "Awaiting IoT sensors"}
      >
        <div
          className={cn("h-full transition-[width] duration-300", hasReading ? healthScaleClass(width) : "bg-transparent")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
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
  utilizationByTruck,
  utilizationMonth,
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
  // Current-month utilization per truck, keyed by truck id (0130). A truck
  // absent from this map has no row in the view for this month at all, which
  // is a different thing from a row whose percentage is null — see
  // UtilizationCell.
  utilizationByTruck: Record<string, TruckUtilizationRow | undefined>;
  utilizationMonth: string;
  errorMsg: string | null;
}) {
  const router = useRouter();

  /**
   * WHOLE-ROW NAVIGATION to the truck's detail page — the same destination the
   * row's own "View" link points at.
   *
   * THE GUARD IS A DESCENDANT CHECK, NOT stopPropagation ON EVERY CONTROL.
   * Each approach stops a button click from also navigating, but
   * stopPropagation has to be remembered on every interactive element added to
   * a row from now on, and the failure is silent: someone adds a fifth button,
   * clicking it also navigates away, and the row looks haunted. Asking "did
   * this click start inside something interactive?" cannot be forgotten,
   * because it lives in one place and covers controls that do not exist yet.
   *
   * Covers the four controls live today (assign-driver button, Assign Driver
   * Btn, edit button, View link) plus anything focusable a future row gains.
   *
   * KEYBOARD DELIBERATELY GOES THROUGH THE "View" LINK, not the row. Making the
   * row focusable would add a tab stop per truck that duplicates a link already
   * in that row - four stops instead of three on every one of fifteen rows,
   * with the extra one going where the last already goes. Mouse and touch get
   * the bigger target; keyboard keeps the shorter path.
   */
  function openDetail(e: React.MouseEvent<HTMLTableRowElement>, truckId: string) {
    const el = e.target as HTMLElement;
    if (el.closest("a, button, input, select, textarea, [role='button']")) return;
    router.push(`/fleet/${truckId}`);
  }
  // Computed on-leave-today set (authoritative). Feeds the pill and the assign
  // modal's availability verdict. The row lock is a COURTESY — assignDriver
  // re-checks the same rule (lib/driver-assignment.ts) and refuses the write
  // itself, so a stale tab cannot assign a driver this list has greyed out.
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Total Trucks" value={kpis.total} tone="info" />
        <Stat label="Active" value={kpis.active} tone="ok" />
        <Stat label="In Maintenance" value={kpis.maint} tone={kpis.maint > 6 ? "warn" : "info"} />
        <Stat label="Idle" value={kpis.idle} tone="info" />
        <Stat
          label="Total Capacity"
          value={kpis.capHasData ? `${formatNum(kpis.totalCap)} m³` : "—"}
          tone="info"
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
              {/* Vehicle ID = trucks.vehicle_registration (0091). Sits beside
                  Model because both answer "which vehicle is this". */}
              <TH>Vehicle ID</TH>
              <TH>Station</TH>
              <TH>Status</TH>
              <TH>Driver</TH>
              <TH>Assigned Project</TH>
              {/* Utilization sits with the operational story (status -> driver
                  -> project -> how much the truck is actually used) and before
                  Health, which is still an inert placeholder. */}
              <TH>Utilization</TH>
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
                  colSpan={13}
                  className="py-6 px-3 border-t text-center muted text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  No trucks{trucks.length > 0 ? " match the filters" : " yet"}.
                </td>
              </tr>
            )}
            {list.map((tr) => (
              <tr
                key={tr.id}
                onClick={(e) => openDetail(e, tr.id)}
                className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              >
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
                <TD className="font-mono text-xs">{tr.vehicle_registration || "—"}</TD>
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
                  <UtilizationCell row={utilizationByTruck[tr.id]} />
                </TD>
                <TD>
                  <HealthBar />
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

      {/* Names the window the Utilization column covers. A percentage with no
          period is not a fact, and this one is CURRENT-MONTH-TO-DATE: early in
          a month a low figure means "few days have happened", not "this truck
          is idle", so the reader needs the month on screen to judge it. */}
      <p className="flex items-start gap-2 text-[11px] muted leading-relaxed">
        <TruckIcon className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        <span>
          <b>Utilization is {monthLabel(utilizationMonth)}, month to date.</b>{" "}
          Days the truck ran at least one delivered trip, over the days it was
          available — calendar days minus any time terminated, in maintenance or
          out of service. A truck with no available days shows <b>N/A</b> rather
          than 0%, because there is nothing to measure against.
        </span>
      </p>

      {/* Says why the Health column is empty. Sits under the table rather than
          in the column header because it explains a state, not a heading — and
          without it an empty bar on every row reads as a bug rather than as a
          feature that has not arrived. */}
      <p className="flex items-start gap-2 text-[11px] muted leading-relaxed">
        <Activity className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        <span>
          <b>Health monitoring is not active yet.</b> The health bar is a placeholder —
          it activates once IoT sensors are fitted to the fleet and integrated, at which
          point each truck reports its own condition.
        </span>
      </p>

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
                  // THE ROW LOCK AND THE SERVER GATE ARE ONE RULE. This calls
                  // the same driverAvailability() assignDriver calls before it
                  // writes, so a row can never look clickable and then be
                  // refused, or look locked while the action would have allowed
                  // it. `terminated` is always false here because the picker's
                  // fetch already filters terminated drivers out — the server
                  // still checks it, since a filter is not a gate.
                  const availability = driverAvailability({
                    driverName: d.name,
                    isCurrentDriver: isCurrent,
                    terminated: false,
                    assignedToOtherTruckPlate: busyElsewhere ? busyTruck!.plate : null,
                    onLeaveToday: onLeave.has(d.id),
                  });
                  const locked = availability.blockedReason !== null;
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
                      {/* Label comes from the same verdict as the lock, but is
                          NOT exempted for the current driver — a driver already
                          on this truck who is on leave today reads "On leave
                          today" while their row stays clickable, because both
                          statements are true. */}
                      <TD className={cn("text-xs", availability.label === "Available" ? "text-emerald-600 dark:text-emerald-400 font-medium" : "muted")}>
                        {availability.label}
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
