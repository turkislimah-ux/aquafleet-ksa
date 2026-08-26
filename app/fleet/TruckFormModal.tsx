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
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

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
  const { lang } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = mode === "edit";
  // Renamed from `t`: that name now belongs to the translator imported
  // above, and a shadow here would silently resolve every t("…") in this
  // component to a TruckRow.
  const row = truck ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = isEdit && row ? await updateTruck(row.id, fd) : await createTruck(fd);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div
        className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{t(isEdit ? "fleet.form.editTitle" : "fleet.form.addTitle", lang)}</h2>
        <p className="text-sm muted mb-4">
          {isEdit
            ? t("fleet.form.editSubtitle", lang).replace("{plate}", () => row?.plate ?? "")
            : t("fleet.form.addSubtitle", lang)}
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PlateInput name="plate" defaultValue={row?.plate ?? null} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("fleet.cols.model", lang)}</span>
            <input
              name="model"
              defaultValue={row?.model ?? ""}
              placeholder={t("fleet.form.modelPlaceholder", lang)}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("fleet.form.year", lang)}</span>
            <input
              name="year"
              type="number"
              min="1980"
              max="2030"
              defaultValue={row?.year ?? ""}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("common.capacity", lang)}</span>
            <select
              name="capacity_m3"
              defaultValue={row?.capacity_m3 != null ? String(row.capacity_m3) : isEdit ? "" : "33"}
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
            <span className="muted">{t("fleet.form.odometerKm", lang)}</span>
            <input
              name="odometer_km"
              type="number"
              min="0"
              defaultValue={row?.odometer_km ?? 0}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <OperationStationField
            name="home_station"
            stations={operationStations}
            defaultValue={row?.home_station ?? null}
            label={t("fleet.cols.station", lang)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("fleet.form.vin", lang)}</span>
            <input name="vin" defaultValue={row?.vin ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>

          {/* LINKED IDENTITY FIELDS (0091) — editable ONLY when adding, as the
              seed. After that the ARCHIVE is the single edit point: its
              registration documents read and write these very columns, so a
              second editor here would be a second way to change one fact.
              Same treatment as the Staff page's Iqama/License fields. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("fleet.form.vehicleRegistration", lang)}</span>
            <LinkedIdField
              name="vehicle_registration"
              value={row?.vehicle_registration ?? ""}
              locked={isEdit}
              archiveHref={row?.id ? `/archive?tab=truck&trucksub=documents&truck=${row.id}` : null}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("fleet.form.registrationExpiry", lang)}</span>
            <LinkedIdField
              name="registration_expiry"
              type="date"
              value={dateInputValue(row?.registration_expiry)}
              locked={isEdit}
              archiveHref={row?.id ? `/archive?tab=truck&trucksub=documents&truck=${row.id}` : null}
            />
          </label>

          {!isEdit && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("fleet.cols.lastService", lang)}</span>
                <input
                  name="last_service_date"
                  type="date"
                  defaultValue={dateInputValue(row?.last_service_date)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("fleet.form.assignedDriver", lang)}</span>
                <select name="assigned_driver_id" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">{t("fleet.form.unassigned", lang)}</option>
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
              {t("common.cancel", lang)}
            </Btn>
            <Btn type="submit" variant="primary">
              {t(saving ? "common.saving" : "common.save", lang)}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
