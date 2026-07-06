"use client";

// Operation-station management popup — nested inside OperationStationField's
// "Manage stations" trigger. Full CRUD over operation_stations (the truck/
// driver/staff BASE — deliberately separate from water_stations, see
// migration 0022 + lib/actions/operation-stations.ts). No key, no fill_cost,
// no "default" concept — just name + coordinates, and soft-delete with no
// reassignment prompt (nothing here can be "the default" of anything).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Pencil, MapPin } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import type { OperationStation } from "@/lib/db-types";
import {
  createOperationStation,
  updateOperationStation,
  deactivateOperationStation,
  type OperationStationInput,
} from "@/lib/actions/operation-stations";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

type View = "list" | "form";

export default function OperationStationsModal({
  open,
  stations,
  onClose,
  onChanged,
}: {
  open: boolean;
  stations: OperationStation[]; // ALL rows (active + inactive)
  onClose: () => void;
  onChanged: () => void; // parent calls router.refresh()
}) {
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<OperationStation | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState<OperationStation | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateErr, setDeactivateErr] = useState<string | null>(null);
  // Portal target only exists client-side — mount-gate avoids an SSR/hydration
  // mismatch (same pattern as app/trips/BreakdownReport.tsx).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const inactiveStations = useMemo(() => stations.filter((s) => !s.active), [stations]);

  if (!open || !mounted) return null;

  function resetDeactivate() {
    setPendingDeactivate(null);
    setDeactivateErr(null);
    setDeactivating(false);
  }
  function close() {
    setView("list");
    setEditing(null);
    resetDeactivate();
    onClose();
  }
  function openAdd() {
    setEditing(null);
    setView("form");
  }
  function openEdit(s: OperationStation) {
    setEditing(s);
    setView("form");
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return;
    setDeactivating(true);
    setDeactivateErr(null);
    const res = await deactivateOperationStation(pendingDeactivate.id);
    setDeactivating(false);
    if (res.error) {
      setDeactivateErr(res.error);
      return;
    }
    resetDeactivate();
    onChanged();
  }

  // Portal to document.body: this modal is triggered from OperationStationField,
  // which is deliberately rendered INSIDE the driver/truck/staff entity's own
  // <form> (so its hidden input submits with that form). StationForm below is
  // ALSO a <form> — rendering it in-place would nest a <form> inside a <form>,
  // which is invalid HTML5 and makes the submit button's click unreliably route
  // (this was the actual root cause of stations never saving — confirmed via
  // zero insert requests ever reaching Supabase, vs a working PATCH for the
  // structurally-identical water_stations, which is never form-nested). The
  // portal breaks the nesting entirely by detaching this subtree from the DOM
  // position it's rendered at.
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {view === "list" ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-1">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-brand-600 dark:text-brand-300" />
                <h2 className="text-lg font-semibold">Operation stations</h2>
              </div>
              <button onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              Where a driver, truck, or staff member is based. Separate from water/fill stations.
            </p>

            <Table>
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH>Coordinates</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </thead>
              <tbody>
                {activeStations.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-6 px-3 border-t text-center muted text-sm"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      No active stations.
                    </td>
                  </tr>
                )}
                {activeStations.map((s) => (
                  <tr key={s.id}>
                    <TD>
                      <span className="font-medium">{s.name}</span>
                    </TD>
                    <TD className="tabular-nums text-xs">
                      {s.latitude != null && s.longitude != null ? `${s.latitude}, ${s.longitude}` : "—"}
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          title="Edit"
                          className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeactivate(s)}
                          title="Deactivate"
                          className="p-1.5 rounded hover:bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>

            {pendingDeactivate && (
              <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                <p className="text-sm font-medium mb-1">Deactivate "{pendingDeactivate.name}"?</p>
                <p className="text-xs muted mb-3">
                  It disappears from every station picker. A driver, truck, or staff member already
                  based here keeps showing it (marked "deactivated") until changed — nothing breaks.
                </p>
                {deactivateErr && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{deactivateErr}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Btn variant="outline" onClick={resetDeactivate}>Cancel</Btn>
                  <button
                    type="button"
                    disabled={deactivating}
                    onClick={confirmDeactivate}
                    className="h-9 px-3 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                  >
                    {deactivating ? "Deactivating…" : "Deactivate"}
                  </button>
                </div>
              </div>
            )}

            {inactiveStations.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowInactive((v) => !v)}
                  className="text-xs muted underline underline-offset-2"
                >
                  {showInactive ? "Hide" : "Show"} deactivated stations ({inactiveStations.length})
                </button>
                {showInactive && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {inactiveStations.map((s) => (
                      <li key={s.id} className="text-xs muted flex items-center gap-2">
                        <span className="line-through">{s.name}</span>
                        <span className="text-[10px] uppercase tracking-wide">deactivated</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-between">
              <Btn variant="primary" onClick={openAdd}><Plus className="h-4 w-4" /> Add station</Btn>
              <Btn variant="outline" onClick={close}>Close</Btn>
            </div>
          </>
        ) : (
          <StationForm
            editing={editing}
            onDone={() => {
              setView("list");
              setEditing(null);
              onChanged();
            }}
            onCancel={() => {
              setView("list");
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function StationForm({
  editing,
  onDone,
  onCancel,
}: {
  editing: OperationStation | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [latitude, setLatitude] = useState(editing?.latitude != null ? String(editing.latitude) : "");
  const [longitude, setLongitude] = useState(editing?.longitude != null ? String(editing.longitude) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // belt-and-suspenders: never let this bubble to an ancestor form
    if (!canSubmit) {
      setError("Station name is required.");
      return;
    }
    const input: OperationStationInput = {
      name: name.trim(),
      latitude: latitude.trim() === "" ? null : Number(latitude),
      longitude: longitude.trim() === "" ? null : Number(longitude),
    };
    setSaving(true);
    setError(null);
    const res = editing
      ? await updateOperationStation(editing.id, input)
      : await createOperationStation(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold">{editing ? "Edit station" : "Add station"}</h2>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">Name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Latitude</span>
            <input
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              inputMode="decimal"
              placeholder="e.g. 24.7136"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Longitude</span>
            <input
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              inputMode="decimal"
              placeholder="e.g. 46.6753"
            />
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Add station"}
        </button>
      </div>
    </form>
  );
}
