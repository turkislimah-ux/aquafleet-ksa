"use client";

// Client island for Fleet Detail. Stats are REAL where the column has data and
// honest-empty ("—") otherwise. The Driver card is REAL. Engine Component
// Health and Predictive AI are honest-empty placeholders until their owning
// subsystems (IoT, Predictive) are built; they render the real layout with an
// empty state so the page never shows fabricated telemetry. Change/Assign
// Driver reuses the same busy-locked modal as the list page.
//
// Maintenance History (Phase 5) — REAL now, both tracks. In-house work
// orders and outsourced jobs for THIS truck, merged into one list/sorted by
// date, newest first (mirrors preview's own woHistory table shape — Opened/
// ID/Title/Type/Status/Assigned-to/Cost/View — extended with the OS track,
// which preview's own demo table never included). COST RULE (architect,
// explicit): in-house cost (internal) and OS cost (external, VAT-inclusive)
// are always shown as separate per-row figures — never summed into one
// combined total anywhere on this card.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Section, Btn, Table, TH, TD } from "@/components/ui";
import { type OperationStation, type WorkOrder, type WorkOrderPart, type OutsourcedJob, type OutsourcedJobRepairer, type WorkshopPayment } from "@/lib/db-types";
import { TRUCK_OPS_STATE_LABELS, type TruckOpsState } from "@/lib/truck-status";
import type { TruckRow, DriverLite } from "../page";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";
import { assignDriver, unassignDriver, terminateTruck } from "../actions";
import TruckFormModal from "../TruckFormModal";
import { cn, formatNum, formatSar, todayKey } from "@/lib/utils";
import { ArrowLeft, Users, X, Activity, Pencil, Eye, Wrench, Package } from "lucide-react";
import MtStatusPill, { type MtPillKind } from "@/app/maintenance/MtStatusPill";
import {
  utilizationBand, formatUtilization, utilizationNaReason,
  type TruckUtilizationRolling30Row,
} from "@/lib/utilization";

const TYPE_LABEL: Record<string, string> = {
  preventive: "Preventive",
  corrective: "Corrective",
  inspection: "Inspection",
  predictive: "Predictive",
};

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}
function woKind(status: WorkOrder["status"]): MtPillKind {
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "in_progress" || status === "awaiting_parts") return "in_progress";
  return "scheduled";
}
function woLabel(w: WorkOrder): string {
  if (isWoDelayed(w)) return "Delayed";
  return { open: "Scheduled", in_progress: "In Progress", awaiting_parts: "Awaiting Parts", completed: "Completed", cancelled: "Cancelled" }[w.status];
}
function isOsOverdue(j: OutsourcedJob): boolean {
  return j.status !== "completed" && j.estimated_finish < todayKey();
}
function osKind(status: OutsourcedJob["status"]): MtPillKind {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "scheduled";
}
function osLabel(j: OutsourcedJob): string {
  if (isOsOverdue(j)) return "Overdue";
  return { scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed" }[j.status];
}

type HistoryRow =
  | { track: "wo"; date: string; wo: WorkOrder }
  | { track: "os"; date: string; os: OutsourcedJob };

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Read-only field for the General Info block. `href` turns the value into a
// link — used for Vehicle Registration, whose single edit point is the
// Archive (0091), so the value stays visible here without implying it can be
// changed here.
/**
 * Rolling-30-day utilization for this truck.
 *
 * A ROLLING WINDOW, NOT THE CALENDAR MONTH the Fleet list shows. On a detail
 * page the question is "how has this truck been doing lately", and a
 * month-to-date figure answers that badly on the 2nd of a month. The two
 * surfaces therefore report different numbers for the same truck ON PURPOSE,
 * and each names its own window so the difference reads as intent.
 *
 * The window's bounds come from the view (from_day/to_day) rather than being
 * recomputed here — if 0130's definition of "30 days" ever changes, this label
 * changes with it instead of quietly disagreeing.
 *
 * N/A IS NOT 0%. No available days means the question has no answer.
 */
function UtilizationStat({ row }: { row: TruckUtilizationRolling30Row | null }) {
  if (!row) return <Stat label="Utilization · 30d" value="—" />;

  const band = utilizationBand(row.utilization_pct);
  const isNa = row.utilization_pct == null;
  return (
    <Stat
      label="Utilization · 30d"
      value={formatUtilization(row.utilization_pct)}
      // No tone for N/A — a figure we do not have earns no colour, the same
      // rule the Dashboard's compliance pills follow.
      tone={isNa ? undefined : band === "optimal" ? "ok" : band === "under" ? "bad" : band === "below" ? "warn" : "info"}
      sub={isNa
        ? utilizationNaReason({ out_of_service_days: 0, maintenance_days: row.maintenance_days })
        : `${row.worked_days} of ${row.available_days} available days · ${row.from_day} to ${row.to_day}`}
    />
  );
}

function InfoField({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  const body = (
    <span className={cn("text-sm", mono && "font-mono text-xs")}>{value}</span>
  );
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      {href && value !== "—" ? (
        <Link href={href} className="text-brand-600 dark:text-brand-300 hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

function fmtDateOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function lastServiceLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
}


export default function FleetDetailClient({
  truck,
  truckStatus,
  trucks,
  drivers,
  trips30d,
  onLeaveDriverIds,
  driverStateById,
  operationStations,
  workOrders,
  workOrderParts,
  outsourcedJobs,
  outsourcedJobRepairers,
  workshopPayments,
  staffNames,
  repairerNames,
  utilization,
  errorMsg,
}: {
  truck: TruckRow | null;
  // Auto Truck-Status Phase 2a — derived, single source of truth (lib/
  // truck-status.ts). REPLACES truck.status for display here. Null only
  // when truck itself is null (not-found fallback renders first).
  truckStatus: TruckOpsState | null;
  trucks: TruckRow[];
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  onLeaveDriverIds: string[];
  driverStateById: Record<string, DriverState>;
  operationStations: OperationStation[];
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: OutsourcedJob[];
  outsourcedJobRepairers: OutsourcedJobRepairer[];
  workshopPayments: WorkshopPayment[];
  staffNames: { id: string; name: string }[];
  repairerNames: { id: string; name: string }[];
  // Rolling-30 utilization for this truck (0130), or null when the view has no
  // row for it. The window's own bounds travel with the row.
  utilization: TruckUtilizationRolling30Row | null;
  errorMsg: string | null;
}) {
  const router = useRouter();

  // ---- Maintenance History (Phase 5) ----
  const staffNameById = useMemo(() => new Map(staffNames.map((s) => [s.id, s.name])), [staffNames]);
  const repairerNameById = useMemo(() => new Map(repairerNames.map((r) => [r.id, r.name])), [repairerNames]);

  const partsCountByWo = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of workOrderParts) m.set(l.work_order_id, (m.get(l.work_order_id) ?? 0) + l.qty);
    return m;
  }, [workOrderParts]);

  const repairerNamesByJob = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const jr of outsourcedJobRepairers) {
      const name = repairerNameById.get(jr.repairer_id);
      if (!name) continue;
      const arr = m.get(jr.outsourced_job_id) ?? [];
      arr.push(name);
      m.set(jr.outsourced_job_id, arr);
    }
    return m;
  }, [outsourcedJobRepairers, repairerNameById]);

  // OS actual cost — DERIVED, summed at display time from workshop_payments,
  // NEVER a stored figure. External/VAT-inclusive money, kept separate from
  // in-house cost everywhere on this card (architect's explicit rule).
  const actualCostByJob = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of workshopPayments) m.set(p.outsourced_job_id, (m.get(p.outsourced_job_id) ?? 0) + p.grand_total_sar);
    return m;
  }, [workshopPayments]);

  const historyRows = useMemo<HistoryRow[]>(() => {
    const woRows: HistoryRow[] = workOrders.map((w) => ({ track: "wo", date: w.opened_at, wo: w }));
    const osRows: HistoryRow[] = outsourcedJobs.map((j) => ({ track: "os", date: j.created_at, os: j }));
    return [...woRows, ...osRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [workOrders, outsourcedJobs]);

  // On-leave-today driver ids (computed availability — UI lock only, like the list page).
  const onLeave = useMemo(() => new Set(onLeaveDriverIds), [onLeaveDriverIds]);

  // Assign Driver modal — open when non-null.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  // Edit Truck modal.
  const [editOpen, setEditOpen] = useState(false);

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

  if (!truck) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm muted">{errorMsg ? `Failed to load: ${errorMsg}` : "Truck not found."}</p>
        <Link
          href="/fleet"
          className="mt-3 inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Fleet
        </Link>
      </div>
    );
  }

  const driver = truck.assigned_driver_id
    ? drivers.find((d) => d.id === truck.assigned_driver_id) ?? null
    : null;

  // Auto Truck-Status Phase 2b — while this truck is in maintenance and its
  // freed driver (trucks.driver_before_maintenance) hasn't been reassigned
  // anywhere else, keep showing them here so it's still visible who this
  // truck belongs to. NO foreign key on that column (0077 dropped it — a
  // second trucks->drivers FK broke the Fleet page's PostgREST embed), so
  // this is a plain by-id lookup against the already-fetched `drivers`
  // array, never an embed/join. Hidden the moment that driver picks up ANY
  // truck (checked across the full fleet, not just this one) or once this
  // truck itself gets a real assigned_driver_id again (the `driver` branch
  // above takes over then).
  const freedDriver =
    truckStatus === "maintenance" && !truck.assigned_driver_id && truck.driver_before_maintenance
      ? trucks.some((t) => t.assigned_driver_id === truck.driver_before_maintenance)
        ? null // already given another truck — no longer waiting on this one
        : drivers.find((d) => d.id === truck.driver_before_maintenance) ?? null
      : null;

  // Subtitle = the non-empty descriptive bits joined, honest-empty otherwise.
  const subParts = [
    truck.model,
    truck.year ? String(truck.year) : null,
    truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : null,
    truck.home_station ? stationNameById.get(truck.home_station) ?? null : null,
  ].filter(Boolean);

  function openAssign() {
    setAssignError(null);
    setAssignOpen(true);
  }

  async function doAssign(driverId: string) {
    if (!truck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await assignDriver(truck.id, driverId);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignOpen(false);
    router.refresh();
  }

  async function doUnassign() {
    if (!truck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await unassignDriver(truck.id);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignOpen(false);
    router.refresh();
  }

  // Danger zone — soft-delete termination (mirrors DriversClient's terminate
  // flow). Two entry buttons preset the reason; the confirm form is shared.
  const today = todayKey(); // local (matches trip day-math), not UTC
  const [termReason, setTermReason] = useState<"sold" | "total_loss" | null>(null);
  const [termPrice, setTermPrice] = useState("");
  const [termDate, setTermDate] = useState(today);
  const [termConfirmText, setTermConfirmText] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);

  const priceNum = termPrice.trim() === "" ? NaN : Number(termPrice);
  const priceValid = Number.isFinite(priceNum) && priceNum >= 0;
  const plateMatch = termConfirmText.trim() !== "" && termConfirmText.trim() === truck.plate.trim();
  const termCanConfirm = !!termReason && priceValid && !!termDate && plateMatch;

  function openTerm(reason: "sold" | "total_loss") {
    setTermReason(reason);
    setTermPrice("");
    setTermDate(today);
    setTermConfirmText("");
    setTermError(null);
  }

  async function onTerminateTruck() {
    if (!truck || !termReason || !termCanConfirm || terminating) return;
    setTerminating(true);
    setTermError(null);
    const res = await terminateTruck(truck.id, { reason: termReason, price: priceNum, releasedDate: termDate });
    setTerminating(false);
    if (res.error) {
      setTermError(res.error);
      return;
    }
    router.push("/fleet");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link
        href="/fleet"
        className="inline-flex items-center gap-2 text-sm font-medium muted hover:opacity-80"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <PageHeader
        title={truck.plate}
        subtitle={subParts.join(" · ") || "—"}
        actions={
          <>
            {truckStatus && <StatusPill status={truckStatus} label={TRUCK_OPS_STATE_LABELS[truckStatus]} />}
            <Btn variant="outline" onClick={openAssign}>
              <Users className="h-4 w-4" /> {truck.driverName ? "Change Driver" : "Assign Driver"}
            </Btn>
            <Btn variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit Truck
            </Btn>
          </>
        }
      />

      {/* FOUR stats, every one backed by data a person actually enters — or,
          now, computed from it.

          UTILIZATION IS BACK, AND ON THE TERMS THIS COMMENT SET. It was pulled
          because trucks.utilization_pct was a demo-era column, 0 on every row,
          "a dormant column with no live surface until it becomes a computed
          view". 0130 made it exactly that: v_truck_utilization_rolling30. The
          dormant COLUMN is still dormant and is still not read — this stat
          reads the view, and dropping the column is a separate migration.

          Health and Fuel Eff. stay out on the original reasoning: health_score,
          fuel_efficiency_km_per_l and engine_hours have no source. A stat that
          can only ever read "—" is furniture. Health returns with IoT. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Capacity" value={truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : "—"} tone="info" />
        <Stat label="Odometer" value={truck.odometer_km != null ? `${formatNum(truck.odometer_km)} km` : "—"} />
        <Stat label="Last Service" value={lastServiceLabel(truck.last_service_date)} tone="ok" />
        <UtilizationStat row={utilization} />
      </div>

      {/* GENERAL INFO — the same fields the Add-Truck form collects, shown
          read-only. The KPI row above is performance/condition; this is
          identity, and previously there was nowhere on this page to see a
          truck's VIN or its vehicle registration at all.

          Vehicle Registration is the LINKED field (0091): it lives on the
          truck and is edited only in the Archive, so it carries a link there
          rather than pretending to be editable here. */}
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="font-semibold text-sm">General Info</h3>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <InfoField label="Plate" value={truck.plate} mono />
          <InfoField label="Model" value={truck.model ?? "—"} />
          <InfoField label="Year" value={truck.year != null ? String(truck.year) : "—"} />
          <InfoField
            label="Capacity"
            value={truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : "—"}
          />
          <InfoField
            label="Station"
            value={truck.home_station ? stationNameById.get(truck.home_station) ?? "—" : "—"}
          />
          <InfoField
            label="Odometer"
            value={truck.odometer_km != null ? `${formatNum(truck.odometer_km)} km` : "—"}
          />
          <InfoField label="VIN" value={truck.vin || "—"} mono />
          <InfoField
            label="Vehicle Registration"
            value={truck.vehicle_registration || "—"}
            mono
            href={`/archive?tab=truck&trucksub=documents&truck=${truck.id}`}
          />
          <InfoField label="Registration expiry" value={fmtDateOnly(truck.registration_expiry)} />
          <InfoField label="Last Service" value={lastServiceLabel(truck.last_service_date)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Engine Component Health — honest-empty until IoT lands */}
        <div className="lg:col-span-2 card p-4">
          <div className="mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 muted" />
              Engine Component Health
            </h3>
            <p className="text-[11px] muted mt-0.5">
              Vibration + sound sensors detect failures before they happen
            </p>
          </div>
          <div className="py-10 text-center">
            <p className="text-sm muted">No telemetry yet</p>
            <p className="text-[11px] muted mt-1">Component readings appear once IoT sensors are connected.</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Driver — REAL */}
          <Section
            title="Driver"
            action={
              <Btn variant="outline" onClick={openAssign}>
                {truck.driverName ? "Change Driver" : "Assign Driver"}
              </Btn>
            }
          >
            {driver ? (
              <div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-brand-700 text-white grid place-items-center font-semibold">
                    {initials(driver.name)}
                  </div>
                  <div>
                    <div className="font-medium">{driver.name}</div>
                    {(() => {
                      const state = driverStateById[driver.id] ?? "off_duty";
                      return <StatusPill status={state} label={DRIVER_STATE_LABELS[state]} />;
                    })()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div>
                    <span className="muted">Safety Score:</span>{" "}
                    <span className="font-medium">{driver.safety_score ?? "—"}</span>
                  </div>
                  <div>
                    <span className="muted">Trips 30d:</span>{" "}
                    <span className="font-medium">{trips30d[driver.id] ?? 0}</span>
                  </div>
                  <div>
                    <span className="muted">Rating:</span>{" "}
                    <span className="font-medium">{driver.rating != null ? `${driver.rating} / 5` : "—"}</span>
                  </div>
                </div>
              </div>
            ) : freedDriver ? (
              <div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-brand-700 text-white grid place-items-center font-semibold opacity-70">
                    {initials(freedDriver.name)}
                  </div>
                  <div>
                    <div className="font-medium">{freedDriver.name}</div>
                    {(() => {
                      const state = driverStateById[freedDriver.id] ?? "off_duty";
                      return <StatusPill status={state} label={DRIVER_STATE_LABELS[state]} />;
                    })()}
                    <div className="text-xs muted mt-1">
                      Waiting for {truck.plate} to be released from maintenance
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm muted">No driver assigned</p>
            )}
          </Section>

          {/* Predictive AI — honest-empty until Predictive lands */}
          <Section title="Predictive AI">
            <p className="text-sm muted">No active alerts</p>
          </Section>
        </div>
      </div>

      {/* Maintenance History — REAL, both tracks (Phase 5) */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 muted" />
            Maintenance History
          </h3>
          <span className="muted text-xs">{historyRows.length} all jobs</span>
        </div>
        {historyRows.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No maintenance history</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Date</TH>
                  <TH>ID</TH>
                  <TH>Title</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Assigned to</TH>
                  <TH>Parts</TH>
                  <TH>Cost</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => {
                  if (row.track === "wo") {
                    const w = row.wo;
                    const mechName = staffNameById.get(w.assigned_mechanic_id) ?? "—";
                    const partsChanged = partsCountByWo.get(w.id) ?? 0;
                    const cost = w.actual_cost_sar ?? w.estimated_cost_sar;
                    return (
                      <tr key={`wo-${w.id}`}>
                        <TD className="text-xs">{new Date(w.opened_at).toLocaleDateString()}</TD>
                        <TD className="font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <Wrench className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                            {w.wo_number}
                          </span>
                        </TD>
                        <TD className="font-medium">{w.title}</TD>
                        <TD>{TYPE_LABEL[w.type] ?? w.type}</TD>
                        <TD><MtStatusPill kind={isWoDelayed(w) ? "overdue" : woKind(w.status)} label={woLabel(w)} /></TD>
                        <TD className="text-xs">{mechName}</TD>
                        <TD className="text-xs tabular-nums">{partsChanged}</TD>
                        <TD className="tabular-nums">{formatSar(cost)}<div className="text-[10px] muted">internal</div></TD>
                        <TD>
                          <Link
                            href={`/maintenance?wo=${w.id}`}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                            style={{ borderColor: "rgb(var(--border))" }}
                          >
                            <Eye className="h-3.5 w-3.5" /> View
                          </Link>
                        </TD>
                      </tr>
                    );
                  }
                  const j = row.os;
                  const jRepairers = repairerNamesByJob.get(j.id) ?? [];
                  const cost = actualCostByJob.get(j.id) ?? 0;
                  return (
                    <tr key={`os-${j.id}`}>
                      <TD className="text-xs">{new Date(j.start_date).toLocaleDateString()}</TD>
                      <TD className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                          {j.os_number}
                        </span>
                      </TD>
                      <TD className="font-medium">{j.title}</TD>
                      <TD>{TYPE_LABEL[j.type] ?? j.type}</TD>
                      <TD><MtStatusPill kind={isOsOverdue(j) ? "overdue" : osKind(j.status)} label={osLabel(j)} /></TD>
                      <TD className="text-xs">{jRepairers.length === 0 ? "—" : jRepairers.join(", ")}</TD>
                      <TD className="text-xs muted">—</TD>
                      <TD className="tabular-nums">{formatSar(cost)}<div className="text-[10px] muted">external, incl. VAT</div></TD>
                      <TD>
                        <Link
                          href={`/maintenance?os=${j.id}`}
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                          style={{ borderColor: "rgb(var(--border))" }}
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </Link>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Danger zone — soft-delete termination. Terminated trucks vanish from
          every active surface; trip history keeps resolving. Restorable later
          from Archive. */}
      {/* The page filters `terminated_at is null` at fetch, so a terminated
          truck resolves to null here and renders "Truck not found" instead.
          This section therefore only ever sees a live truck — it used to be
          wrapped in {!truck.terminated_at && …}, a condition that could never
          be false and implied terminated trucks render here. */}
      <section className="space-y-3 border-t border-rose-500/30 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            Danger zone
          </h3>
          {!termReason ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">Terminate truck</div>
                <div className="muted text-[11px]">
                  Removes {truck.plate} from all active views. Trip history is preserved.
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openTerm("sold")}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  Deactivate — Sold
                </button>
                <button
                  type="button"
                  onClick={() => openTerm("total_loss")}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  Total loss
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
              <p className="text-sm text-rose-700 dark:text-rose-300">
                This will mark <b>{truck.plate}</b> as{" "}
                <b>{termReason === "sold" ? "sold" : "total loss"}</b> and remove it from the
                active fleet. Its trip history is preserved. Restorable later from Archive.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">Price (SAR) *</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={termPrice}
                    onChange={(e) => setTermPrice(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                    placeholder="0.00"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">Released date *</span>
                  <input
                    type="date"
                    required
                    value={termDate}
                    onChange={(e) => setTermDate(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Type &quot;{truck.plate}&quot; to confirm</span>
                <input
                  value={termConfirmText}
                  onChange={(e) => setTermConfirmText(e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder={truck.plate}
                />
              </label>
              {termError && <p className="text-sm text-rose-600 dark:text-rose-400">{termError}</p>}
              <div className="flex justify-end gap-2">
                <Btn
                  variant="outline"
                  onClick={() => {
                    setTermReason(null);
                    setTermConfirmText("");
                    setTermError(null);
                  }}
                >
                  Cancel
                </Btn>
                <button
                  type="button"
                  onClick={onTerminateTruck}
                  disabled={!termCanConfirm || terminating}
                  className={
                    "rounded-lg px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 " +
                    (!termCanConfirm || terminating ? "opacity-50 pointer-events-none" : "")
                  }
                >
                  {terminating
                    ? "Terminating…"
                    : `Confirm ${termReason === "sold" ? "sale" : "total loss"}`}
                </button>
              </div>
            </div>
          )}
      </section>

      {errorMsg && <p className="text-sm text-rose-600 dark:text-rose-400">{errorMsg}</p>}

      {/* ---- Edit Truck modal ---- */}
      {editOpen && (
        <TruckFormModal
          mode="edit"
          truck={truck}
          drivers={drivers}
          operationStations={operationStations}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* ---- Assign Driver modal (same busy-lock as the list page) ---- */}
      {assignOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={() => setAssignOpen(false)}
        >
          <div
            className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold">Assign Driver — {truck.plate}</h2>
              <button
                onClick={() => setAssignOpen(false)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">Select a driver to assign · {truck.plate}</p>

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
                  const isCurrent = truck.assigned_driver_id === d.id;
                  const busyElsewhere = !!busyTruck && busyTruck.id !== truck.id;
                  const onLeaveToday = onLeave.has(d.id);
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
                        {busyElsewhere
                          ? `Already assigned · ${busyTruck!.plate}`
                          : onLeaveToday
                            ? "On leave today"
                            : "Available"}
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

            {assignError && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{assignError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              {truck.assigned_driver_id && (
                <Btn variant="outline" onClick={doUnassign}>
                  {assignSaving ? "…" : "Unassign"}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setAssignOpen(false)}>
                Close
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
