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
import { type DriverState } from "@/lib/driver-state";
import { driverAvailability, AVAILABILITY_KEY } from "@/lib/driver-assignment";
import { type TruckOpsState } from "@/lib/truck-status";
import type { TruckRow, DriverLite } from "./page";
import { assignDriver, unassignDriver } from "./actions";
import TruckFormModal from "./TruckFormModal";
import { cn, formatNum } from "@/lib/utils";
import { pillColor } from "@/lib/project-colors";
import {
  utilizationBand, utilizationBarWidth, formatUtilization, utilizationNaReason,
  UTILIZATION_BAND, UTILIZATION_NA_KEY, type TruckUtilizationRow,
} from "@/lib/utilization";
// TRUCK_OPS_STATE_LABELS / DRIVER_STATE_LABELS are NOT imported anymore. Those
// maps are plain English and the drivers and trips routes still read them, so
// they stay exactly as they are; this page keys off the SAME enums into
// fleet.truckState / fleet.driverState instead. No other route is affected.
import { useApp } from "@/components/AppShell";
import { t, type Lang } from "@/lib/i18n";
import { Eye, Filter, Pencil, Plus, Truck as TruckIcon, Users, X } from "lucide-react";
import ScrollLock from "@/components/ScrollLock";

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
 * "2026-08-01" -> "August 2026" / "أغسطس 2026". Local formatting only; no date
 * math. The YEAR is an app-formatted figure and stays Latin in both languages,
 * as every other number on this page does.
 */
const MONTH_KEYS = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;

function monthLabel(monthStart: string, lang: Lang): string {
  const [y, m] = monthStart.split("-");
  // Indexing a const tuple types `key` as the union of its twelve members, so
  // `fleet.months.${key}` is twelve real TKeys rather than `string`.
  const key = MONTH_KEYS[Number(m) - 1];
  if (!key) return monthStart;
  return `${t(`fleet.months.${key}`, lang)} ${y}`;
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
function UtilizationCell({ row, lang }: { row: TruckUtilizationRow | undefined; lang: Lang }) {
  if (!row) return <span className="muted">—</span>;

  const band = utilizationBand(row.utilization_pct);
  const tone = UTILIZATION_BAND[band];
  const isNa = row.utilization_pct == null;
  const title = isNa
    ? t(UTILIZATION_NA_KEY[utilizationNaReason(row)], lang)
    : t("fleet.util.workedTitle", lang)
        .replace("{worked}", () => String(row.worked_days))
        .replace("{available}", () => String(row.available_days)) +
      (row.maintenance_days > 0
        ? ` · ${t("fleet.util.inMaintenance", lang).replace("{n}", () => String(row.maintenance_days))}`
        : "") +
      (row.out_of_service_days > 0
        ? ` · ${t("fleet.util.outOfService", lang).replace("{n}", () => String(row.out_of_service_days))}`
        : "");

  return (
    <div className="min-w-[7.5rem]" title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("text-xs font-medium tabular-nums", isNa ? "muted" : tone.text)}>
          {formatUtilization(row.utilization_pct, lang)}
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
        <div className="mt-1 text-[10px] muted">{t("fleet.util.noAvailableDays", lang)}</div>
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
  const { lang } = useApp();

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
   * KEYBOARD REACHES THE ROW ITSELF (tabIndex + Enter/Space), overruling an
   * earlier call to route keyboard users through the inner "View" link only.
   * The inner controls stay individually reachable, so tabbing through a row
   * goes: row -> driver -> edit -> View.
   *
   * THE KEY HANDLER FIRES ONLY WHEN THE ROW ITSELF HAS FOCUS. A keydown on an
   * inner control BUBBLES to the row, so without `e.target !== e.currentTarget`
   * a keyboard user pressing Enter on "View" would fire that link AND the row's
   * navigation - the same double-fire the click guard prevents, arriving by the
   * other route. Click is guarded by where the event started (closest), keys by
   * whether the row is the focused element; each is the right question for its
   * own event.
   *
   * NO role OVERRIDE ON THE <tr>, deliberately. role="link"/"button" on a table
   * row removes it from the table's accessibility tree - its thirteen <td>s
   * stop being cells of a row, so a screen-reader user loses column context on
   * every truck. The row keeps its native row semantics and carries an
   * aria-label naming the action instead, and the real <a> is still in the row
   * for anyone who wants a link.
   */
  function openDetail(e: React.MouseEvent<HTMLTableRowElement>, truckId: string) {
    const el = e.target as HTMLElement;
    if (el.closest("a, button, input, select, textarea, [role='button']")) return;
    router.push(`/fleet/${truckId}`);
  }

  function openDetailKey(e: React.KeyboardEvent<HTMLTableRowElement>, truckId: string) {
    // Focus is on an inner control - let that control handle its own key.
    if (e.target !== e.currentTarget) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space scrolls the page by default; Enter on a focused row does nothing
    // natively. Both are claimed here.
    e.preventDefault();
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
        title={t("nav.fleet", lang)}
        subtitle={t("fleet.subtitle", lang).replace("{n}", () => String(kpis.total))}
        actions={
          <Btn variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> {t("fleet.addTruck", lang)}
          </Btn>
        }
      />

      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{t("fleet.loadFailed", lang)} {errorMsg}</p>
      )}

      {/* KPI strip (6) — all REAL */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label={t("fleet.kpi.totalTrucks", lang)} value={kpis.total} tone="info" />
        <Stat label={t("fleet.kpi.active", lang)} value={kpis.active} tone="ok" />
        <Stat label={t("fleet.kpi.inMaintenance", lang)} value={kpis.maint} tone={kpis.maint > 6 ? "warn" : "info"} />
        <Stat label={t("fleet.kpi.idle", lang)} value={kpis.idle} tone="info" />
        <Stat
          label={t("fleet.kpi.totalCapacity", lang)}
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
            placeholder={t("fleet.filters.searchPlaceholder", lang)}
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
                {s === "all" ? t("common.all", lang) : t(`fleet.truckState.${s}`, lang)}
              </button>
            ))}
          </div>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="h-9 px-3 rounded-lg border text-sm"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          >
            <option value="all">{t("fleet.filters.allStations", lang)}</option>
            {stationFilterOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {/* No arText — operation_stations has no name_ar column, and
                    OperationStationField renders the same bare name. */}
                {s.name}{!s.active ? ` ${t("shared.stations.deactivatedParen", lang)}` : ""}
              </option>
            ))}
          </select>
          <span className="muted text-xs ms-auto">
            {t("fleet.filters.results", lang).replace("{n}", () => String(list.length))}
          </span>
        </div>
      </Card>

      {/* Table */}
      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.plate", lang)}</TH>
              <TH>{t("fleet.cols.model", lang)}</TH>
              {/* Vehicle ID = trucks.vehicle_registration (0091). Sits beside
                  Model because both answer "which vehicle is this". */}
              <TH>{t("fleet.cols.vehicleId", lang)}</TH>
              <TH>{t("fleet.cols.station", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{t("common.driver", lang)}</TH>
              <TH>{t("fleet.cols.assignedProject", lang)}</TH>
              {/* Utilization closes the operational story: status -> driver ->
                  project -> how much the truck is actually used. */}
              <TH>{t("kpi.utilization", lang)}</TH>
              <TH>{t("common.capacity", lang)}</TH>
              <TH>{t("common.odometer", lang)}</TH>
              <TH>{t("fleet.cols.lastService", lang)}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="py-6 px-3 border-t text-center muted text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {/* Two whole sentences, not a stem plus a swapped tail:
                      Arabic does not take the English split. */}
                  {t(trucks.length > 0 ? "fleet.noTrucksFiltered" : "fleet.noTrucksYet", lang)}
                </td>
              </tr>
            )}
            {list.map((tr) => (
              <tr
                key={tr.id}
                onClick={(e) => openDetail(e, tr.id)}
                onKeyDown={(e) => openDetailKey(e, tr.id)}
                tabIndex={0}
                aria-label={t("fleet.openDetailAria", lang).replace("{plate}", () => tr.plate)}
                className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
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
                  {/* The PILL'S COLOUR keys off `status`, the enum — the label
                      beside it is now translated, and nothing styles off it. */}
                  <StatusPill status={truckStatusById[tr.id] ?? "idle"} label={t(`fleet.truckState.${truckStatusById[tr.id] ?? "idle"}`, lang)} />
                </TD>
                <TD>
                  {tr.driverName ? (
                    <button
                      type="button"
                      title={t("fleet.assign.changeDriverTitle", lang)}
                      onClick={() => openAssign(tr)}
                      className="inline-flex items-center gap-1.5 -mx-2 rounded-md px-2 py-1 text-start hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Users className="h-3.5 w-3.5 muted shrink-0" />
                      <span>{tr.driverName}</span>
                    </button>
                  ) : (
                    <Btn variant="outline" onClick={() => openAssign(tr)}>
                      <Plus className="h-3.5 w-3.5" /> {t("fleet.assign.assignDriver", lang)}
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
                  <UtilizationCell row={utilizationByTruck[tr.id]} lang={lang} />
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
                      title={t("fleet.form.editTruckTitle", lang)}
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
                      <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
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
        {/* Split at the two <b> runs and NOWHERE else. No dictionary value
            carries an edge space — every single space here is supplied by the
            JSX, so the English renders byte-for-byte as it did before. The N/A
            run reads `common.na`, the SAME key formatUtilization() prints, so
            this sentence cannot end up naming a token the cell does not show. */}
        <span>
          <b>{t("fleet.utilNoteBold", lang).replace("{month}", () => monthLabel(utilizationMonth, lang))}</b>{" "}
          {t("fleet.utilNoteBody1", lang)} <b>{t("common.na", lang)}</b>{" "}
          {t("fleet.utilNoteBody2", lang)}
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
          <ScrollLock />
          <div
            className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold">
                {t("fleet.assign.title", lang).replace("{plate}", () => assignTruck.plate)}
              </h2>
              <button
                onClick={() => setAssignTruck(null)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              {t("fleet.assign.subtitle", lang).replace("{plate}", () => assignTruck.plate)}
            </p>

            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("common.driver", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
                  <TH>{t("fleet.cols.availability", lang)}</TH>
                  <TH>{t("fleet.cols.safety", lang)}</TH>
                  <TH>{t("fleet.cols.trips30d", lang)}</TH>
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
                      {t("fleet.noDriversYet", lang)}
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
                        <StatusPill status={state} label={t(`fleet.driverState.${state}`, lang)} />
                      </TD>
                      {/* Label comes from the same verdict as the lock, but is
                          NOT exempted for the current driver — a driver already
                          on this truck who is on leave today reads "On leave
                          today" while their row stays clickable, because both
                          statements are true.

                          THE GREEN KEYS OFF `labelKind`, THE ENUM — never off
                          the rendered sentence. It used to read
                          `availability.label === "Available"`, which silently
                          stops matching the moment the cell speaks Arabic, and
                          every driver would have gone grey. `labelKind` is
                          also the right datum rather than `blockedReason ===
                          null`: the exemption clears the reason for a CURRENT
                          driver who is on leave, whose cell still says "On
                          leave today" and must stay muted. */}
                      <TD className={cn("text-xs", availability.labelKind === "available" ? "text-emerald-600 dark:text-emerald-400 font-medium" : "muted")}>
                        {t(AVAILABILITY_KEY[availability.labelKind], lang)
                          .replace("{plate}", () => availability.labelPlate ?? "")}
                      </TD>
                      <TD className="tabular-nums text-xs">{d.safety_score ?? "—"}</TD>
                      <TD className="tabular-nums text-xs">{trips30d[d.id] ?? 0}</TD>
                      <TD>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("fleet.assign.current", lang)}
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
                  {assignSaving ? "…" : t("fleet.assign.unassign", lang)}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setAssignTruck(null)}>
                {t("fleet.assign.close", lang)}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
