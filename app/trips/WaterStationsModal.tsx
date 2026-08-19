"use client";

// Water station management popup (Trips page, Projects tab — next to "New
// Project"). Full CRUD over water_stations (the FILL-station concept — WHERE a
// truck loads; deliberately separate from the Fleet "depot/base" concept, see
// migration 0014). This is the ONLY place stations are created/edited/retired —
// every SELECTION surface (Add Trip, phase picker, Manage Project, loading
// chip) stays an unchanged read-only picker over the same table.
//
// key immutability: generated once on Add (slug of the name, lib/slug — same
// helper + pattern as staff_roles/leave_types), never shown, never editable.
// Edit only ever sends name/city/latitude/longitude + the two per-type fill
// prices (0110) — which is exactly the WaterStationInput shape in actions.ts.
// (The flat fill_cost this replaced was retired in 0122; the column is gone.)
//
// Soft-delete only: "Deactivate" sets active=false (no hard delete). If the
// station is an ACTIVE project's default, deactivateWaterStation refuses and
// hands back the affected project list — the manager must pick an explicit
// replacement default for EVERY one before the deactivation is applied. Nothing
// is ever auto/randomly reassigned.
//
// Fill price is cost-side only (what the station charges US per fill) — stored
// for future reporting, never read by any rate/commission/invoice calculation.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Pencil, Droplet, AlertTriangle } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { WATER_TYPE_LABELS, type WaterType } from "@/lib/db-types";
import { stationPriceFor, type WaterStationRow } from "@/lib/station-pricing";
import {
  createWaterStation,
  updateWaterStation,
  deactivateWaterStation,
  type WaterStationInput,
  type StationReassignment,
} from "./actions";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// The full water_stations row, imported rather than re-declared — see
// WaterStationRow's own note in lib/station-pricing.ts for why three copies of a
// shape carrying two PRICE columns was a liability. Kept under the local name
// this file already used, so nothing below it changes.
type StationRow = WaterStationRow;

type ProjectLite = { id: string; name: string };

type View = "list" | "form";

export default function WaterStationsModal({
  open,
  onClose,
  stations,
}: {
  open: boolean;
  onClose: () => void;
  stations: StationRow[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<StationRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Deactivate flow (per-row): confirm -> (maybe) reassign -> done.
  const [pendingDeactivate, setPendingDeactivate] = useState<StationRow | null>(null);
  const [needsReassignment, setNeedsReassignment] = useState<ProjectLite[] | null>(null);
  const [reassignMap, setReassignMap] = useState<Record<string, string>>({});
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateErr, setDeactivateErr] = useState<string | null>(null);

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const inactiveStations = useMemo(() => stations.filter((s) => !s.active), [stations]);
  // Other active stations a manager can pick as a replacement default — never
  // the one currently being deactivated.
  const replacementOptions = useMemo(
    () => activeStations.filter((s) => s.key !== pendingDeactivate?.key),
    [activeStations, pendingDeactivate],
  );

  if (!open) return null;

  function close() {
    setView("list");
    setEditing(null);
    resetDeactivate();
    onClose();
  }

  function resetDeactivate() {
    setPendingDeactivate(null);
    setNeedsReassignment(null);
    setReassignMap({});
    setDeactivateErr(null);
    setDeactivating(false);
  }

  function openAdd() {
    setEditing(null);
    setView("form");
  }
  function openEdit(s: StationRow) {
    setEditing(s);
    setView("form");
  }

  async function startDeactivate(s: StationRow) {
    resetDeactivate();
    setPendingDeactivate(s);
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return;
    setDeactivating(true);
    setDeactivateErr(null);
    const res = await deactivateWaterStation(pendingDeactivate.key);
    setDeactivating(false);
    if (res.error) {
      setDeactivateErr(res.error);
      return;
    }
    if (res.needsReassignment) {
      setNeedsReassignment(res.needsReassignment);
      return;
    }
    resetDeactivate();
    router.refresh();
  }

  async function confirmReassignAndDeactivate() {
    if (!pendingDeactivate || !needsReassignment) return;
    const missing = needsReassignment.filter((p) => !reassignMap[p.id]);
    if (missing.length > 0) {
      setDeactivateErr(`Pick a replacement default for: ${missing.map((p) => p.name).join(", ")}.`);
      return;
    }
    const reassignments: StationReassignment[] = needsReassignment.map((p) => ({
      project_id: p.id,
      new_key: reassignMap[p.id],
    }));
    setDeactivating(true);
    setDeactivateErr(null);
    const res = await deactivateWaterStation(pendingDeactivate.key, reassignments);
    setDeactivating(false);
    if (res.error) {
      setDeactivateErr(res.error);
      return;
    }
    resetDeactivate();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        // 1080px = this app's size:lg popup width (InventoryClient.tsx:130).
        // Widened from max-w-3xl: the list view's fourth column holds BOTH
        // per-type price inputs plus their labels, which is the widest cell in
        // any trips table and was being squeezed by Name/City/Coordinates.
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {view === "list" ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-1">
              <div className="flex items-center gap-2">
                <Droplet className="h-5 w-5 text-brand-600 dark:text-brand-300" />
                <h2 className="text-lg font-semibold">Water stations</h2>
              </div>
              <button onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              Where trucks fill. Renaming keeps every existing trip and project resolving correctly —
              only the display name changes.
            </p>

            <Table>
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH>City</TH>
                  <TH>Coordinates</TH>
                  <TH>Water types &amp; fill cost (internal)</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </thead>
              <tbody>
                {activeStations.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-6 px-3 border-t text-center muted text-sm"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      No active stations.
                    </td>
                  </tr>
                )}
                {activeStations.map((s) => (
                  <StationRowView
                    key={s.id}
                    s={s}
                    onEdit={() => openEdit(s)}
                    onDeactivate={() => startDeactivate(s)}
                  />
                ))}
              </tbody>
            </Table>

            {/* Deactivate confirm / reassign flow — appears under the table, scoped
                to the row that triggered it. */}
            {pendingDeactivate && (
              <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                {!needsReassignment ? (
                  <>
                    <p className="text-sm font-medium mb-1">Deactivate "{pendingDeactivate.name}"?</p>
                    <p className="text-xs muted mb-3">
                      It disappears from every station picker. Past trips still show its name.
                      This can be undone later by re-adding a station with the same name.
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
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium">
                        "{pendingDeactivate.name}" is the default station for {needsReassignment.length}{" "}
                        project{needsReassignment.length === 1 ? "" : "s"}. Pick a replacement default for
                        each before deactivating — nothing is reassigned automatically.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 mb-3">
                      {needsReassignment.map((p) => (
                        <label key={p.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">{p.name}</span>
                          <select
                            value={reassignMap[p.id] ?? ""}
                            onChange={(e) => setReassignMap((m) => ({ ...m, [p.id]: e.target.value }))}
                            className={INPUT + " max-w-[220px]"}
                            style={INPUT_STYLE}
                          >
                            <option value="" disabled>Pick replacement…</option>
                            {replacementOptions.map((r) => (
                              <option key={r.key} value={r.key}>{r.name}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    {deactivateErr && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{deactivateErr}</p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <Btn variant="outline" onClick={resetDeactivate}>Cancel</Btn>
                      <button
                        type="button"
                        disabled={deactivating}
                        onClick={confirmReassignAndDeactivate}
                        className="h-9 px-3 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                      >
                        {deactivating ? "Saving…" : "Confirm replacements & deactivate"}
                      </button>
                    </div>
                  </>
                )}
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
              router.refresh();
            }}
            onCancel={() => {
              setView("list");
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function StationRowView({
  s,
  onEdit,
  onDeactivate,
}: {
  s: StationRow;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const coords =
    s.latitude != null && s.longitude != null ? `${s.latitude}, ${s.longitude}` : "—";
  return (
    <tr>
      <TD>
        <span className="font-medium">{s.name}</span>
        {s.is_default && (
          <span className="ml-2 text-[10px] uppercase tracking-wide muted">default</span>
        )}
      </TD>
      <TD>{s.city ?? "—"}</TD>
      <TD className="tabular-nums text-xs">{coords}</TD>
      {/* One line per type. A type with no price is NOT OFFERED, which is a
          different statement from costing 0 — the row says which. */}
      <TD className="text-xs">
        <div className="flex flex-col gap-0.5">
          {(["potable", "non_potable"] as WaterType[]).map((wt) => {
            const price = stationPriceFor(s, wt);
            return (
              <span key={wt} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="muted">{WATER_TYPE_LABELS[wt]}</span>
                {price === null ? (
                  <span className="muted italic">not offered</span>
                ) : (
                  <span className="tabular-nums font-medium">{formatSar(price)}</span>
                )}
              </span>
            );
          })}
        </div>
      </TD>
      <TD className="text-right">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            title="Deactivate"
            className="p-1.5 rounded hover:bg-rose-500/10 text-rose-600 dark:text-rose-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </TD>
    </tr>
  );
}

// Shared Add/Edit form. `editing` null = Add (key generated server-side from the
// name); non-null = Edit (key is NEVER sent — only name/city/coords/cost).
function StationForm({
  editing,
  onDone,
  onCancel,
}: {
  editing: StationRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [city, setCity] = useState(editing?.city ?? "");
  const [latitude, setLatitude] = useState(editing?.latitude != null ? String(editing.latitude) : "");
  const [longitude, setLongitude] = useState(editing?.longitude != null ? String(editing.longitude) : "");
  // A checkbox per water type drives whether that type is OFFERED; the price
  // box beside it carries the amount. Checked with an empty box is not a
  // price — it is an incomplete row, and submit says so rather than silently
  // storing 0, which would mean "free" and be a different claim entirely.
  const [potableOn, setPotableOn] = useState(editing?.fill_cost_potable_sar != null);
  const [potablePrice, setPotablePrice] = useState(
    editing?.fill_cost_potable_sar != null ? String(editing.fill_cost_potable_sar) : ""
  );
  const [nonPotableOn, setNonPotableOn] = useState(editing?.fill_cost_non_potable_sar != null);
  const [nonPotablePrice, setNonPotablePrice] = useState(
    editing?.fill_cost_non_potable_sar != null ? String(editing.fill_cost_non_potable_sar) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && (potableOn || nonPotableOn);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === "") {
      setError("Station name is required.");
      return;
    }
    if (!potableOn && !nonPotableOn) {
      setError("Pick at least one water type and give it a price.");
      return;
    }
    // A ticked type with a blank or non-numeric box is incomplete. Coercing it
    // to 0 would record "this station fills free", which is a real and very
    // different claim.
    for (const [on, raw, label] of [
      [potableOn, potablePrice, WATER_TYPE_LABELS.potable],
      [nonPotableOn, nonPotablePrice, WATER_TYPE_LABELS.non_potable],
    ] as [boolean, string, string][]) {
      if (!on) continue;
      if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
        setError(`Enter a price for ${label} — use 0 if this station fills free.`);
        return;
      }
      if (Number(raw) < 0) {
        setError(`${label} price cannot be negative.`);
        return;
      }
    }
    // An unticked type sends null — NOT OFFERED. A ticked type sends its
    // number, and 0 is allowed and meaningful (company-owned, fills free).
    // Number("") is 0, so an empty ticked box would post a silent free fill;
    // that case is rejected above rather than coerced here.
    const input: WaterStationInput = {
      name: name.trim(),
      city: city.trim() || null,
      latitude: latitude.trim() === "" ? null : Number(latitude),
      longitude: longitude.trim() === "" ? null : Number(longitude),
      fill_cost_potable_sar: potableOn ? Number(potablePrice) : null,
      fill_cost_non_potable_sar: nonPotableOn ? Number(nonPotablePrice) : null,
    };
    setSaving(true);
    setError(null);
    const res = editing
      ? await updateWaterStation(editing.key, input)
      : await createWaterStation(input);
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">City</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} style={INPUT_STYLE} />
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
        {/* PER-WATER-TYPE PRICING. The types are fixed and pre-exist, so the
            user only ticks what this station sells and fills in a price. An
            unticked type is stored as NULL — not offered — and trip-add will
            block it for this station. */}
        <div className="flex flex-col gap-2 text-sm">
          <span className="muted">
            Water types and fill cost — internal, SAR per fill (cost only; never affects rates,
            commission, or invoices). Tick each type this station sells. Enter 0 if it fills free.
          </span>
          {([
            ["potable", potableOn, setPotableOn, potablePrice, setPotablePrice],
            ["non_potable", nonPotableOn, setNonPotableOn, nonPotablePrice, setNonPotablePrice],
          ] as [WaterType, boolean, (v: boolean) => void, string, (v: string) => void][]).map(
            ([wt, on, setOn, price, setPrice]) => (
              <div key={wt} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-40 shrink-0">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setOn(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  />
                  <span>{WATER_TYPE_LABELS[wt]}</span>
                </label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={!on}
                  className={INPUT}
                  style={INPUT_STYLE}
                  inputMode="decimal"
                  placeholder={on ? "e.g. 45 — or 0 if free" : "not offered"}
                  aria-label={`${WATER_TYPE_LABELS[wt]} fill price`}
                />
              </div>
            )
          )}
          {!potableOn && !nonPotableOn && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              A station must offer at least one water type.
            </p>
          )}
        </div>
        {editing && (
          <p className="text-xs muted">
            Renaming only changes the display name — every trip/project already pointing at this
            station keeps resolving correctly.
          </p>
        )}
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
