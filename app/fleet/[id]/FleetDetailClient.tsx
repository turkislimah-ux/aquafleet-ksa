"use client";

// Client island for Fleet Detail. Stats are REAL where the column has data and
// honest-empty ("—") otherwise. The Driver card is REAL. The three rich panels
// — Engine Component Health, Predictive AI, Maintenance History — are
// honest-empty placeholders until their owning subsystems (IoT, Predictive,
// Maintenance) are built; they render the real layout with an empty state so the
// page never shows fabricated telemetry. Change/Assign Driver reuses the same
// busy-locked modal as the list page.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Section, Btn, Table, TH, TD } from "@/components/ui";
import { TRUCK_STATUS_LABELS, type OperationStation } from "@/lib/db-types";
import type { TruckRow, DriverLite } from "../page";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";
import { assignDriver, unassignDriver, terminateTruck } from "../actions";
import TruckFormModal from "../TruckFormModal";
import { cn, formatNum, todayKey } from "@/lib/utils";
import { ArrowLeft, Users, X, Activity, Pencil } from "lucide-react";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

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

function healthTone(v: number | null): "ok" | "warn" | "bad" {
  if (v == null) return "warn";
  return v > 75 ? "ok" : v > 55 ? "warn" : "bad";
}

export default function FleetDetailClient({
  truck,
  trucks,
  drivers,
  trips30d,
  onLeaveDriverIds,
  driverStateById,
  operationStations,
  errorMsg,
}: {
  truck: TruckRow | null;
  trucks: TruckRow[];
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  onLeaveDriverIds: string[];
  driverStateById: Record<string, DriverState>;
  operationStations: OperationStation[];
  errorMsg: string | null;
}) {
  const router = useRouter();

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
            <StatusPill status={truck.status} label={TRUCK_STATUS_LABELS[truck.status]} />
            <Btn variant="outline" onClick={openAssign}>
              <Users className="h-4 w-4" /> {truck.driverName ? "Change Driver" : "Assign Driver"}
            </Btn>
            <Btn variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit Truck
            </Btn>
          </>
        }
      />

      {/* 6 stats — REAL where present, honest-empty otherwise */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="Health" value={truck.health_score ?? "—"} tone={healthTone(truck.health_score)} />
        <Stat
          label="Utilization"
          value={truck.utilization_pct != null ? `${truck.utilization_pct}%` : "—"}
          tone="info"
        />
        <Stat label="Capacity" value={truck.capacity_m3 != null ? `${truck.capacity_m3} m³` : "—"} tone="info" />
        <Stat
          label="Fuel Eff."
          value={truck.fuel_efficiency_km_per_l != null ? `${truck.fuel_efficiency_km_per_l} km/L` : "—"}
        />
        <Stat label="Odometer" value={truck.odometer_km != null ? `${formatNum(truck.odometer_km)} km` : "—"} />
        <Stat label="Last Service" value={lastServiceLabel(truck.last_service_date)} tone="ok" />
      </div>

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

      {/* Maintenance History — honest-empty until Maintenance lands */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="font-semibold">Maintenance History</h3>
          <span className="muted text-xs">0 All jobs</span>
        </div>
        <p className="text-sm muted p-6 text-center">No maintenance history</p>
      </Card>

      {/* Danger zone — soft-delete termination. Terminated trucks vanish from
          every active surface; trip history keeps resolving. Restorable later
          from Archive. */}
      {!truck.terminated_at && (
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
      )}

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
