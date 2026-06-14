"use client";

// Client island for the Drivers page: roster table plus New/Edit modal wired
// to createDriver / updateDriver. The modal includes a "Current truck"
// dropdown — selecting writes to trucks.assigned_driver_id only (single
// source of truth); the driver row never stores a truck reference.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill } from "@/components/ui";
import { type Driver, DRIVER_STATUS_LABELS } from "@/lib/db-types";
import { createDriver, updateDriver } from "./actions";

type TruckOption = { id: string; plate: string; assigned_driver_id: string | null };

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

function pillStatus(s: Driver["status"]) {
  return s === "active" ? "active" : s === "on_leave" ? "warning" : "inactive";
}

export default function DriverForm({
  drivers,
  trucks,
}: {
  drivers: Driver[];
  trucks: TruckOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Driver | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // driverId -> the truck currently assigned to them (derived, one source).
  const truckByDriver = new Map<string, TruckOption>();
  for (const tr of trucks) {
    if (tr.assigned_driver_id) truckByDriver.set(tr.assigned_driver_id, tr);
  }
  const driverNameById = new Map(drivers.map((d) => [d.id, d.name]));

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(d: Driver) {
    setEditing(d);
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
    const truckId = String(formData.get("truck_id") ?? "");

    // Warn if the chosen truck already carries a different driver — picking it
    // will move that driver off (truck holds one driver). Cheap footgun guard.
    if (truckId) {
      const target = trucks.find((tr) => tr.id === truckId);
      const occupant = target?.assigned_driver_id;
      if (occupant && occupant !== editing?.id) {
        const who = driverNameById.get(occupant) ?? "another driver";
        if (!confirm(`That truck is currently assigned to ${who}. Reassign it?`)) return;
      }
    }

    setSaving(true);
    setError(null);
    const res = editing
      ? await updateDriver(editing.id, formData)
      : await createDriver(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  const currentTruckId = editing ? truckByDriver.get(editing.id)?.id ?? "" : "";

  return (
    <>
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew}>
          <Plus className="h-4 w-4" /> New driver
        </Btn>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>Driver</TH>
              <TH>Iqama</TH>
              <TH>License expiry</TH>
              <TH>Status</TH>
              <TH>Current truck</TH>
              <TH>Safety</TH>
              <TH>Rating</TH>
              <TH className="text-end">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  No drivers yet.
                </td>
              </tr>
            )}
            {drivers.map((d) => {
              const truck = truckByDriver.get(d.id);
              return (
                <tr key={d.id}>
                  <TD className="font-medium">{d.name}{d.name_ar ? <span className="muted font-normal"> · {d.name_ar}</span> : null}</TD>
                  <TD className="font-mono text-xs">{d.iqama_number ?? "—"}</TD>
                  <TD>{d.license_expiry ?? "—"}</TD>
                  <TD><StatusPill status={pillStatus(d.status)} label={DRIVER_STATUS_LABELS[d.status]} /></TD>
                  <TD>{truck ? <span className="font-mono text-xs">{truck.plate}</span> : <span className="muted">—</span>}</TD>
                  <TD className="tabular-nums">{d.safety_score ?? "—"}</TD>
                  <TD className="tabular-nums">{d.rating ?? "—"}</TD>
                  <TD className="text-end">
                    <Btn variant="outline" onClick={() => openEdit(d)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Btn>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit driver" : "New driver"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Name *</span>
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Name (Arabic)</span>
                <input name="name_ar" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Iqama number</span>
                <input name="iqama_number" defaultValue={editing?.iqama_number ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">License expiry</span>
                <input name="license_expiry" type="date" defaultValue={editing?.license_expiry ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Status</span>
                <select name="status" defaultValue={editing?.status ?? "active"} className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(DRIVER_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Current truck</span>
                <select name="truck_id" defaultValue={currentTruckId} className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.plate}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Safety score</span>
                <input name="safety_score" type="number" step="1" min="0" max="100" defaultValue={editing?.safety_score ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Rating</span>
                <input name="rating" type="number" step="0.1" min="0" max="5" defaultValue={editing?.rating ?? ""} className={INPUT} style={INPUT_STYLE} />
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
