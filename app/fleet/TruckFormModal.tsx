"use client";

// Shared truck form modal used in three places: Add (Fleet list header), Edit
// (Fleet list row pencil), and Edit (Fleet Detail header). Add mode exposes
// "Assigned driver" (Edit mode hides it — driver assignment lives in the
// dedicated Assign Driver modal instead) AND "Last Service" (the pre-purchase
// fix/inspection date, which has no work order behind it — a one-time
// baseline set at creation). Edit mode no longer has a Last Service field at
// all (Phase-5 iteration B): the column is now auto-advanced by
// complete_work_order/complete_outsourced_job (migration 0075) whenever a
// real job finishes for that truck, so it's no longer hand-editable after
// creation. Both modes reject a duplicate plate cleanly via the server
// action.
//
// STATUS FIELD REMOVED ENTIRELY (Auto Truck-Status Phase 2a) — status is now
// derived (lib/truck-status.ts: MAINTENANCE if any in_progress job, else
// ACTIVE if a driver is assigned, else IDLE), computed fresh at render time
// everywhere it's shown. Never hand-set again, in either mode — there's no
// manual override path left to produce a stored status at all.

import { useState } from "react";
import { Btn } from "@/components/ui";
import { type OperationStation } from "@/lib/db-types";
import type { TruckRow, DriverLite } from "./page";
import { createTruck, updateTruck } from "./actions";
import OperationStationField from "@/components/OperationStationField";
import LinkedIdField from "@/components/LinkedIdField";
import PlateInput from "@/components/PlateInput";

const CAPACITY_OPTIONS_M3 = [33, 18, 6] as const;

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// DATE column comes back as "YYYY-MM-DD" (or full ISO) — slice for <input type=date>.
function dateInputValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function TruckFormModal({
  mode,
  truck,
  drivers,
  operationStations,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  truck?: TruckRow | null;
  drivers: DriverLite[];
  operationStations: OperationStation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = mode === "edit";
  const t = truck ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = isEdit && t ? await updateTruck(t.id, fd) : await createTruck(fd);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{isEdit ? "Edit Truck" : "Add New Truck"}</h2>
        <p className="text-sm muted mb-4">
          {isEdit ? `Update truck details · ${t?.plate ?? ""}` : "Register a new water truck. Plate is required."}
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlateInput name="plate" defaultValue={t?.plate ?? null} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Model</span>
            <input
              name="model"
              defaultValue={t?.model ?? ""}
              placeholder="e.g. Mercedes-Benz Actros 3340"
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Year</span>
            <input
              name="year"
              type="number"
              min="1980"
              max="2030"
              defaultValue={t?.year ?? ""}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Capacity</span>
            <select
              name="capacity_m3"
              defaultValue={t?.capacity_m3 != null ? String(t.capacity_m3) : isEdit ? "" : "33"}
              className={INPUT}
              style={INPUT_STYLE}
            >
              <option value="">—</option>
              {CAPACITY_OPTIONS_M3.map((c) => (
                <option key={c} value={c}>
                  {c} m³
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Odometer (km)</span>
            <input
              name="odometer_km"
              type="number"
              min="0"
              defaultValue={t?.odometer_km ?? 0}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <OperationStationField
            name="home_station"
            stations={operationStations}
            defaultValue={t?.home_station ?? null}
            label="Station"
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">VIN</span>
            <input name="vin" defaultValue={t?.vin ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>

          {/* LINKED IDENTITY FIELDS (0091) — editable ONLY when adding, as the
              seed. After that the ARCHIVE is the single edit point: its
              registration documents read and write these very columns, so a
              second editor here would be a second way to change one fact.
              Same treatment as the Staff page's Iqama/License fields. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Vehicle Registration</span>
            <LinkedIdField
              name="vehicle_registration"
              value={t?.vehicle_registration ?? ""}
              locked={isEdit}
              archiveHref={t?.id ? `/archive?tab=truck&trucksub=documents&truck=${t.id}` : null}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Registration expiry</span>
            <LinkedIdField
              name="registration_expiry"
              type="date"
              value={dateInputValue(t?.registration_expiry)}
              locked={isEdit}
              archiveHref={t?.id ? `/archive?tab=truck&trucksub=documents&truck=${t.id}` : null}
            />
          </label>

          {!isEdit && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Last Service</span>
                <input
                  name="last_service_date"
                  type="date"
                  defaultValue={dateInputValue(t?.last_service_date)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
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
            </>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

          <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
            <Btn variant="outline" onClick={onClose}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary">
              {saving ? "Saving…" : "Save"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
