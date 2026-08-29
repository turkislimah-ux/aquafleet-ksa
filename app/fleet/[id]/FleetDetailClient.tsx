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
import { type TruckOpsState } from "@/lib/truck-status";
import type { TruckRow, DriverLite } from "../page";
import { type DriverState } from "@/lib/driver-state";
import { assignDriver, unassignDriver, terminateTruck } from "../actions";
import TruckFormModal from "../TruckFormModal";
import { cn, formatDate, formatNum, formatSar, todayKey } from "@/lib/utils";
import { ArrowLeft, Users, X, Activity, Pencil, Eye, Wrench, Package } from "lucide-react";
import MtStatusPill, { type MtPillKind } from "@/app/maintenance/MtStatusPill";
import {
  utilizationBand, formatUtilization, utilizationNaReason,
  UTILIZATION_NA_KEY, type TruckUtilizationRolling30Row,
} from "@/lib/utilization";
// TRUCK_OPS_STATE_LABELS / DRIVER_STATE_LABELS are NOT imported anymore — see
// FleetClient's own note. Those maps stay English for the routes that still
// read them; this page keys off the SAME enums into fleet.truckState /
// fleet.driverState.
import { useApp } from "@/components/AppShell";
import { t, type Lang, type TKey } from "@/lib/i18n";
import ScrollLock from "@/components/ScrollLock";

// Maintenance work TYPE -> dictionary key. Keyed off the stored type string,
// never off the rendered word, and still `Record<string, …>` because
// work_orders.type is a free column — an unknown type falls through to the raw
// value below exactly as it did before.
const TYPE_KEY: Record<string, TKey> = {
  preventive: "status.preventive",
  // status.corrective reads "Repair" in English, not "Corrective", so this one
  // cannot come from the shared status namespace.
  corrective: "fleet.mt.corrective",
  inspection: "status.inspection",
  predictive: "status.predictive",
};

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}
function woKind(status: WorkOrder["status"]): MtPillKind {
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "in_progress" || status === "awaiting_parts") return "in_progress";
  return "scheduled";
}
// Returns the KEY, not the words — same shape as before, one level of
// indirection later. The pill's `kind` already came off the same data.
function woLabelKey(w: WorkOrder): TKey {
  if (isWoDelayed(w)) return "fleet.mt.delayed";
  return ({ open: "status.scheduled", in_progress: "status.in_progress", awaiting_parts: "status.awaiting_parts", completed: "status.completed", cancelled: "status.cancelled" } as const)[w.status];
}
function isOsOverdue(j: OutsourcedJob): boolean {
  return j.status !== "completed" && j.estimated_finish < todayKey();
}
function osKind(status: OutsourcedJob["status"]): MtPillKind {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "scheduled";
}
function osLabelKey(j: OutsourcedJob): TKey {
  if (isOsOverdue(j)) return "fleet.mt.overdue";
  return ({ scheduled: "status.scheduled", in_progress: "status.in_progress", completed: "status.completed" } as const)[j.status];
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
function UtilizationStat({ row, lang }: { row: TruckUtilizationRolling30Row | null; lang: Lang }) {
  if (!row) return <Stat label={t("fleet.util.stat30d", lang)} value="—" />;

  const band = utilizationBand(row.utilization_pct);
  const isNa = row.utilization_pct == null;
  return (
    <Stat
      label={t("fleet.util.stat30d", lang)}
      value={formatUtilization(row.utilization_pct, lang)}
      // No tone for N/A — a figure we do not have earns no colour, the same
      // rule the Dashboard's compliance pills follow.
      tone={isNa ? undefined : band === "optimal" ? "ok" : band === "under" ? "bad" : band === "below" ? "warn" : "info"}
      sub={isNa
        ? t(UTILIZATION_NA_KEY[utilizationNaReason({ out_of_service_days: 0, maintenance_days: row.maintenance_days })], lang)
        : t("fleet.util.rolling", lang)
            .replace("{worked}", () => String(row.worked_days))
            .replace("{available}", () => String(row.available_days))
            .replace("{from}", () => row.from_day)
            .replace("{to}", () => row.to_day)}
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
  return formatDate(iso + "T00:00:00");
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
  const { lang } = useApp();

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
        <p className="text-sm muted">
          {errorMsg
            ? t("fleet.detail.loadFailed", lang).replace("{msg}", () => errorMsg)
            : t("fleet.detail.notFound", lang)}
        </p>
        <Link
          href="/fleet"
          className="mt-3 inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("fleet.detail.backToFleet", lang)}
        </Link>
      </div>
    );
  }

  // Captured once so the `{plate}` replacers below close over a plain string.
  // `truck` is a parameter, and TypeScript does not carry the non-null
  // narrowing from the early return above into a callback body.
  const plate = truck.plate;

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
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("fleet.detail.back", lang)}
      </Link>

      <PageHeader
        title={truck.plate}
        subtitle={subParts.join(" · ") || "—"}
        actions={
          <>
            {truckStatus && <StatusPill status={truckStatus} label={t(`fleet.truckState.${truckStatus}`, lang)} />}
            <Btn variant="outline" onClick={openAssign}>
              <Users className="h-4 w-4" /> {t(truck.driverName ? "fleet.assign.changeDriver" : "fleet.assign.assignDriver", lang)}
            </Btn>
            <Btn variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> {t("fleet.form.editTitle", lang)}
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
        <Stat label={t("common.capacity", lang)} value={truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : "—"} tone="info" />
        <Stat label={t("common.odometer", lang)} value={truck.odometer_km != null ? `${formatNum(truck.odometer_km)} km` : "—"} />
        <Stat label={t("fleet.cols.lastService", lang)} value={lastServiceLabel(truck.last_service_date)} tone="ok" />
        <UtilizationStat row={utilization} lang={lang} />
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
          <h3 className="font-semibold text-sm">{t("fleet.detail.generalInfo", lang)}</h3>
        </div>
        {/* Station: NO arText — operation_stations has no name_ar column, so
            the name is shown as entered, the same way the list page does. */}
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <InfoField label={t("common.plate", lang)} value={truck.plate} mono />
          <InfoField label={t("fleet.cols.model", lang)} value={truck.model ?? "—"} />
          <InfoField label={t("fleet.form.year", lang)} value={truck.year != null ? String(truck.year) : "—"} />
          <InfoField
            label={t("common.capacity", lang)}
            value={truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : "—"}
          />
          <InfoField
            label={t("fleet.cols.station", lang)}
            value={truck.home_station ? stationNameById.get(truck.home_station) ?? "—" : "—"}
          />
          <InfoField
            label={t("common.odometer", lang)}
            value={truck.odometer_km != null ? `${formatNum(truck.odometer_km)} km` : "—"}
          />
          <InfoField label={t("fleet.form.vin", lang)} value={truck.vin || "—"} mono />
          <InfoField
            label={t("fleet.form.vehicleRegistration", lang)}
            value={truck.vehicle_registration || "—"}
            mono
            href={`/archive?tab=truck&trucksub=documents&truck=${truck.id}`}
          />
          <InfoField label={t("fleet.form.registrationExpiry", lang)} value={fmtDateOnly(truck.registration_expiry)} />
          <InfoField label={t("fleet.cols.lastService", lang)} value={lastServiceLabel(truck.last_service_date)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Engine Component Health — honest-empty until IoT lands */}
        <div className="lg:col-span-2 card p-4">
          <div className="mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 muted" />
              {t("fleet.detail.engineHealth", lang)}
            </h3>
            <p className="text-[11px] muted mt-0.5">
              {t("fleet.detail.engineHealthSub", lang)}
            </p>
          </div>
          <div className="py-10 text-center">
            <p className="text-sm muted">{t("fleet.detail.noTelemetry", lang)}</p>
            <p className="text-[11px] muted mt-1">{t("fleet.detail.noTelemetrySub", lang)}</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Driver — REAL */}
          <Section
            title={t("common.driver", lang)}
            action={
              <Btn variant="outline" onClick={openAssign}>
                {t(truck.driverName ? "fleet.assign.changeDriver" : "fleet.assign.assignDriver", lang)}
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
                      return <StatusPill status={state} label={t(`fleet.driverState.${state}`, lang)} />;
                    })()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div>
                    <span className="muted">{t("fleet.detail.safetyScore", lang)}</span>{" "}
                    <span className="font-medium">{driver.safety_score ?? "—"}</span>
                  </div>
                  <div>
                    <span className="muted">{t("fleet.detail.trips30d", lang)}</span>{" "}
                    <span className="font-medium">{trips30d[driver.id] ?? 0}</span>
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
                      return <StatusPill status={state} label={t(`fleet.driverState.${state}`, lang)} />;
                    })()}
                    <div className="text-xs muted mt-1">
                      {t("fleet.detail.waitingLead", lang)} {truck.plate} {t("fleet.detail.waitingTail", lang)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm muted">{t("fleet.detail.noDriverAssigned", lang)}</p>
            )}
          </Section>

          {/* Predictive AI — honest-empty until Predictive lands */}
          <Section title={t("fleet.detail.predictiveAi", lang)}>
            <p className="text-sm muted">{t("fleet.detail.noAlerts", lang)}</p>
          </Section>
        </div>
      </div>

      {/* Maintenance History — REAL, both tracks (Phase 5) */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 muted" />
            {t("fleet.mt.historyTitle", lang)}
          </h3>
          <span className="muted text-xs">
            {t("fleet.mt.allJobs", lang).replace("{n}", () => String(historyRows.length))}
          </span>
        </div>
        {historyRows.length === 0 ? (
          <p className="text-sm muted p-6 text-center">{t("fleet.mt.noHistory", lang)}</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("fleet.cols.date", lang)}</TH>
                  <TH>{t("fleet.cols.id", lang)}</TH>
                  <TH>{t("common.title", lang)}</TH>
                  <TH>{t("common.type", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
                  <TH>{t("fleet.cols.assignedTo", lang)}</TH>
                  <TH>{t("fleet.cols.parts", lang)}</TH>
                  <TH>{t("common.cost", lang)}</TH>
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
                        <TD className="text-xs">{formatDate(w.opened_at)}</TD>
                        <TD className="font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <Wrench className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                            {w.wo_number}
                          </span>
                        </TD>
                        <TD className="font-medium">{w.title}</TD>
                        <TD>{TYPE_KEY[w.type] ? t(TYPE_KEY[w.type], lang) : w.type}</TD>
                        <TD><MtStatusPill kind={isWoDelayed(w) ? "overdue" : woKind(w.status)} label={t(woLabelKey(w), lang)} /></TD>
                        <TD className="text-xs">{mechName}</TD>
                        <TD className="text-xs tabular-nums">{partsChanged}</TD>
                        <TD className="tabular-nums">{formatSar(cost)}<div className="text-[10px] muted">{t("fleet.mt.costInternal", lang)}</div></TD>
                        <TD>
                          <Link
                            href={`/maintenance?wo=${w.id}`}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                            style={{ borderColor: "rgb(var(--border))" }}
                          >
                            <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
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
                      <TD className="text-xs">{formatDate(j.start_date)}</TD>
                      <TD className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                          {j.os_number}
                        </span>
                      </TD>
                      <TD className="font-medium">{j.title}</TD>
                      <TD>{TYPE_KEY[j.type] ? t(TYPE_KEY[j.type], lang) : j.type}</TD>
                      <TD><MtStatusPill kind={isOsOverdue(j) ? "overdue" : osKind(j.status)} label={t(osLabelKey(j), lang)} /></TD>
                      <TD className="text-xs">{jRepairers.length === 0 ? "—" : jRepairers.join(", ")}</TD>
                      <TD className="text-xs muted">—</TD>
                      <TD className="tabular-nums">{formatSar(cost)}<div className="text-[10px] muted">{t("fleet.mt.costExternal", lang)}</div></TD>
                      <TD>
                        <Link
                          href={`/maintenance?os=${j.id}`}
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                          style={{ borderColor: "rgb(var(--border))" }}
                        >
                          <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
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
            {t("fleet.term.dangerZone", lang)}
          </h3>
          {!termReason ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">{t("fleet.term.terminateTruck", lang)}</div>
                <div className="muted text-[11px]">
                  {t("fleet.term.removes", lang).replace("{plate}", () => plate)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openTerm("sold")}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  {t("fleet.term.deactivateSold", lang)}
                </button>
                <button
                  type="button"
                  onClick={() => openTerm("total_loss")}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  {t("fleet.term.totalLoss", lang)}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
              {/* Three clauses around the two bolded runs. Every space between
                  them is supplied HERE, by the JSX, so no dictionary value
                  carries an invisible edge space. */}
              <p className="text-sm text-rose-700 dark:text-rose-300">
                {t("fleet.term.confirmLead", lang)} <b>{truck.plate}</b> {t("fleet.term.confirmMid", lang)}{" "}
                <b>{t(termReason === "sold" ? "fleet.term.reasonSold" : "fleet.term.reasonTotalLoss", lang)}</b>{" "}
                {t("fleet.term.confirmTail", lang)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">{t("fleet.term.priceSar", lang)}</span>
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
                  <span className="muted">{t("fleet.term.releasedDate", lang)}</span>
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
                <span className="muted">
                  {t("fleet.term.typeToConfirm", lang).replace("{plate}", () => plate)}
                </span>
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
                  {t("common.cancel", lang)}
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
                  {t(
                    terminating
                      ? "fleet.term.terminating"
                      : termReason === "sold"
                        ? "fleet.term.confirmSale"
                        : "fleet.term.confirmTotalLoss",
                    lang,
                  )}
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
          <ScrollLock />
          <div
            className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold">
                {t("fleet.assign.title", lang).replace("{plate}", () => plate)}
              </h2>
              <button
                onClick={() => setAssignOpen(false)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              {t("fleet.assign.subtitle", lang).replace("{plate}", () => plate)}
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
                  const isCurrent = truck.assigned_driver_id === d.id;
                  const busyElsewhere = !!busyTruck && busyTruck.id !== truck.id;
                  const onLeaveToday = onLeave.has(d.id);
                  const locked = (busyElsewhere || onLeaveToday) && !isCurrent;
                  const state = driverStateById[d.id] ?? "off_duty";
                  // ONE value drives both the words and the colour of the
                  // Availability cell, so the two cannot drift apart — the
                  // same arrangement the list page's cell uses. (There is no
                  // "terminated" arm here: `drivers` is already filtered.)
                  const availKind = busyElsewhere
                    ? "assignedElsewhere"
                    : onLeaveToday
                      ? "onLeave"
                      : "available";
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
                      <TD className={cn("text-xs", availKind === "available" ? "text-emerald-600 dark:text-emerald-400 font-medium" : "muted")}>
                        {t(`fleet.availability.${availKind}`, lang)
                          .replace("{plate}", () => busyTruck!.plate)}
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

            {assignError && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{assignError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              {truck.assigned_driver_id && (
                <Btn variant="outline" onClick={doUnassign}>
                  {assignSaving ? "…" : t("fleet.assign.unassign", lang)}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setAssignOpen(false)}>
                {t("fleet.assign.close", lang)}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
