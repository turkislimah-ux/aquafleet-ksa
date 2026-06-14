"use client";

// Client island for the Trucks page: fleet table plus New/Edit modal wired to
// createTruck / updateTruck. The modal includes an "Assigned driver" dropdown
// writing to trucks.assigned_driver_id (single source of truth).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill } from "@/components/ui";
import { type Truck, TRUCK_STATUS_LABELS, STATION_OPTIONS } from "@/lib/db-types";
import { createTruck, updateTruck } from "./actions";

type DriverOption = { id: string; name: string };
type TruckRow = Truck & { driverName: string | null };

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function TruckForm({
  trucks,
  drivers,
}: {
  trucks: TruckRow[];
  drivers: DriverOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TruckRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // driverId -> the truck currently holding them, to warn on reassignment.
  const truckByDriver = new Map<string, TruckRow>();
  for (const tr of trucks) {
    if (tr.assigned_driver_id) truckByDriver.set(tr.assigned_driver_id, tr);
  }

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(t: TruckRow) {
    setEditing(t);
    setError(null);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const driverId = String(formData.get("assigned_driver_id") ?? "");

    // Warn if the chosen driver is already on a different truck — picking them
    // moves them here (driver can only be on one truck).
    if (driverId) {
      const heldBy = truckByDriver.get(driverId);
      if (heldBy && heldBy.id !== editing?.id) {
        if (!confirm(`That driver is currently on truck ${heldBy.plate}. Reassign them here?`)) return;
      }
    }

    setSaving(true);
    setError(null);
    const res = editing
      ? await updateTruck(editing.id, formData)
      : await createTruck(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew}>
          <Plus className="h-4 w-4" /> New truck
        </Btn>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>Plate</TH>
              <TH>Model / year</TH>
              <TH>Capacity</TH>
              <TH>Status</TH>
              <TH>Home station</TH>
              <TH>Assigned driver</TH>
              <TH className="text-end">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {trucks.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  No trucks yet.
                </td>
              </tr>
            )}
            {trucks.map((t) => (
              <tr key={t.id}>
                <TD className="font-mono text-xs font-medium">{t.plate}</TD>
                <TD>{t.model ?? "—"}{t.year ? ` · ${t.year}` : ""}</TD>
                <TD className="tabular-nums">{t.capacity_m3 != null ? `${t.capacity_m3} m³` : "—"}</TD>
                <TD><StatusPill status={t.status} label={TRUCK_STATUS_LABELS[t.status]} /></TD>
                <TD>{t.home_station ?? "—"}</TD>
                <TD>{t.driverName ?? <span className="muted">—</span>}</TD>
                <TD className="text-end">
                  <Btn variant="outline" onClick={() => openEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Btn>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit truck" : "New truck"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Plate *</span>
                <input name="plate" required defaultValue={editing?.plate ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Model</span>
                <input name="model" defaultValue={editing?.model ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Year</span>
                <input name="year" type="number" step="1" min="1980" defaultValue={editing?.year ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Capacity (m³)</span>
                <input name="capacity_m3" type="number" step="any" min="0" defaultValue={editing?.capacity_m3 ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Status</span>
                <select name="status" defaultValue={editing?.status ?? "idle"} className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(TRUCK_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Home station</span>
                <select name="home_station" defaultValue={editing?.home_station ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Assigned driver</span>
                <select name="assigned_driver_id" defaultValue={editing?.assigned_driver_id ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Odometer (km)</span>
                <input name="odometer_km" type="number" step="1" min="0" defaultValue={editing?.odometer_km ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Engine hours</span>
                <input name="engine_hours" type="number" step="1" min="0" defaultValue={editing?.engine_hours ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">VIN</span>
                <input name="vin" defaultValue={editing?.vin ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} />
                <span>Active</span>
              </label>

              {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={close}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : "Save"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
