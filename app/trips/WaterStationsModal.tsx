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
import { type WaterType } from "@/lib/db-types";
import { stationPriceFor, type WaterStationRow } from "@/lib/station-pricing";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang } from "@/lib/i18n";
// Water-type names come off the ENUM VALUE, the same `potable` / `non_potable`
// this file already maps over. db-types' WATER_TYPE_LABELS is untouched.
import { waterTypeLabel } from "@/lib/enum-labels";
import {
  createWaterStation,
  updateWaterStation,
  deactivateWaterStation,
  type WaterStationInput,
  type StationReassignment,
} from "./actions";
import ScrollLock from "@/components/ScrollLock";

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
  const { lang } = useApp();
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
      // The joined list is PROJECT NAMES — user data, printed as stored.
      setDeactivateErr(
        fill(t("trips.stations.errPickReplacement", lang), { names: missing.map((p) => p.name).join(", ") }),
      );
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
      <ScrollLock />
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
                <h2 className="text-lg font-semibold">{t("trips.stations.title", lang)}</h2>
              </div>
              <button onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              {t("trips.stations.subtitle", lang)}
            </p>

            <Table>
              <thead>
                <tr>
                  <TH>{t("trips.stations.colName", lang)}</TH>
                  <TH>{t("trips.stations.colCity", lang)}</TH>
                  <TH>{t("trips.stations.colCoordinates", lang)}</TH>
                  <TH>{t("trips.stations.colTypesCost", lang)}</TH>
                  <TH className="text-end">{t("common.actions", lang)}</TH>
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
                      {t("trips.stations.emptyActive", lang)}
                    </td>
                  </tr>
                )}
                {activeStations.map((s) => (
                  <StationRowView
                    key={s.id}
                    s={s}
                    lang={lang}
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
                    {/* The station name is USER DATA and prints as stored. */}
                    <p className="text-sm font-medium mb-1">{fill(t("trips.stations.confirmTitle", lang), { name: pendingDeactivate.name })}</p>
                    <p className="text-xs muted mb-3">
                      {t("trips.stations.confirmBody", lang)}
                    </p>
                    {deactivateErr && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{deactivateErr}</p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <Btn variant="outline" onClick={resetDeactivate}>{t("common.cancel", lang)}</Btn>
                      <button
                        type="button"
                        disabled={deactivating}
                        onClick={confirmDeactivate}
                        className="h-9 px-3 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                      >
                        {t(deactivating ? "trips.stations.deactivating" : "trips.stations.deactivate", lang)}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      {/* Was `project{n === 1 ? "" : "s"}` spliced mid-sentence.
                          Arabic pluralises on {n}%100 across four buckets and its
                          one/two forms drop the numeral, so the whole sentence
                          has to be the leaf — not the suffix. */}
                      <p className="text-sm font-medium">
                        {fill(t(`trips.stations.reassignWarn.${plural(needsReassignment.length)}`, lang), {
                          name: pendingDeactivate.name,
                          n: needsReassignment.length,
                        })}
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
                            <option value="" disabled>{t("trips.stations.pickReplacement", lang)}</option>
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
                      <Btn variant="outline" onClick={resetDeactivate}>{t("common.cancel", lang)}</Btn>
                      <button
                        type="button"
                        disabled={deactivating}
                        onClick={confirmReassignAndDeactivate}
                        className="h-9 px-3 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                      >
                        {t(deactivating ? "common.saving" : "trips.stations.confirmReplacements", lang)}
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
                  {fill(
                    t(showInactive ? "trips.stations.hideDeactivated" : "trips.stations.showDeactivated", lang),
                    { n: inactiveStations.length },
                  )}
                </button>
                {showInactive && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {inactiveStations.map((s) => (
                      <li key={s.id} className="text-xs muted flex items-center gap-2">
                        <span className="line-through">{s.name}</span>
                        <span className="text-[10px] uppercase tracking-wide">{t("trips.stations.deactivatedTag", lang)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-between">
              <Btn variant="primary" onClick={openAdd}><Plus className="h-4 w-4" /> {t("trips.stations.addStation", lang)}</Btn>
              <Btn variant="outline" onClick={close}>{t("common.close", lang)}</Btn>
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

// `lang` arrives as a PROP, not from useApp() — this is a pure row renderer with
// no state of its own, the same treatment the already-converted badge/row
// components in this route got.
function StationRowView({
  s,
  lang,
  onEdit,
  onDeactivate,
}: {
  s: StationRow;
  lang: Lang;
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
          <span className="ms-2 text-[10px] uppercase tracking-wide muted">{t("trips.stations.defaultTag", lang)}</span>
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
                <span className="muted">{waterTypeLabel(wt, lang)}</span>
                {price === null ? (
                  <span className="muted italic">{t("trips.stations.notOffered", lang)}</span>
                ) : (
                  <span className="tabular-nums font-medium">{formatSar(price)}</span>
                )}
              </span>
            );
          })}
        </div>
      </TD>
      <TD className="text-end">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            title={t("common.edit", lang)}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            title={t("trips.stations.deactivate", lang)}
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
  const { lang } = useApp();
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
      setError(t("trips.stations.errName", lang));
      return;
    }
    if (!potableOn && !nonPotableOn) {
      setError(t("trips.stations.errNoType", lang));
      return;
    }
    // A ticked type with a blank or non-numeric box is incomplete. Coercing it
    // to 0 would record "this station fills free", which is a real and very
    // different claim.
    for (const [on, raw, label] of [
      [potableOn, potablePrice, waterTypeLabel("potable", lang)],
      [nonPotableOn, nonPotablePrice, waterTypeLabel("non_potable", lang)],
    ] as [boolean, string, string][]) {
      if (!on) continue;
      if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
        setError(fill(t("trips.stations.errPrice", lang), { type: label }));
        return;
      }
      if (Number(raw) < 0) {
        setError(fill(t("trips.stations.errNegative", lang), { type: label }));
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
        <h2 className="text-lg font-semibold">{t(editing ? "trips.stations.editStation" : "trips.stations.addStation", lang)}</h2>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {/* The form reuses the table's `colName` / `colCity` — one word, one
              leaf, whichever surface spells it. */}
          <span className="muted">{t("trips.stations.colName", lang)} *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("trips.stations.colCity", lang)}</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("trips.stations.fLatitude", lang)}</span>
            <input
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              inputMode="decimal"
              placeholder={t("trips.stations.latPlaceholder", lang)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("trips.stations.fLongitude", lang)}</span>
            <input
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              inputMode="decimal"
              placeholder={t("trips.stations.lngPlaceholder", lang)}
            />
          </label>
        </div>
        {/* PER-WATER-TYPE PRICING. The types are fixed and pre-exist, so the
            user only ticks what this station sells and fills in a price. An
            unticked type is stored as NULL — not offered — and trip-add will
            block it for this station. */}
        <div className="flex flex-col gap-2 text-sm">
          <span className="muted">
            {t("trips.stations.pricingHelp", lang)}
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
                  <span>{waterTypeLabel(wt, lang)}</span>
                </label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={!on}
                  className={INPUT}
                  style={INPUT_STYLE}
                  inputMode="decimal"
                  placeholder={t(on ? "trips.stations.pricePlaceholder" : "trips.stations.notOffered", lang)}
                  aria-label={fill(t("trips.stations.priceAria", lang), { type: waterTypeLabel(wt, lang) })}
                />
              </div>
            )
          )}
          {!potableOn && !nonPotableOn && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t("trips.stations.warnNoType", lang)}
            </p>
          )}
        </div>
        {editing && (
          <p className="text-xs muted">
            {t("trips.stations.renameNote", lang)}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="outline" onClick={onCancel}>{t("common.cancel", lang)}</Btn>
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
        >
          {t(saving ? "common.saving" : editing ? "trips.stations.saveChanges" : "trips.stations.addStation", lang)}
        </button>
      </div>
    </form>
  );
}
