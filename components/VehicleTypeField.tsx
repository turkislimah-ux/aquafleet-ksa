"use client";

// The vehicle-type picker for an operation vehicle — AND the entire management
// surface for `vehicle_types`, inline, inside the form that needs it.
//
// WHY IT IS A SECTION AND NOT A `<label>` WITH A SELECT
// -----------------------------------------------------------------------------
// It is not one answer, it is an answer plus the ability to change what the
// answers ARE. OperationStationField made the same call for the same reason and
// this borrows its box wholesale: `sm:col-span-2 rounded-xl border p-3.5` on
// rgb(var(--bg)), a 7×7 brand-tinted icon square, a title, a hint line, then
// the control. Two picker-plus-manage fields in one form that looked different
// would read as two different KINDS of thing.
//
// PLACE IT AS A DIRECT GRID CHILD of TruckFormModal's
// `grid grid-cols-1 sm:grid-cols-2` — `sm:col-span-2` only takes effect on an
// immediate grid child, exactly as OperationStationField's header says.
//
// NO MODAL, AND THEREFORE NO PORTAL — the difference from OperationStationField
// -----------------------------------------------------------------------------
// That field opens OperationStationsModal, which contains its own `<form>`, and
// a `<form>` nested inside the truck form silently breaks saving (diagnosed
// once already: zero insert requests ever reached Supabase). This one has no
// form of its own. Add and rename are a panel that REPLACES the select in
// place, with plain inputs and `Btn`s — and `Btn` defaults to
// `type="button"` (components/ui.tsx:111), so nothing here can submit the
// truck form by accident.
//
// That is the ViolationTypeSelect shape (app/drivers/ViolationForm.tsx:502),
// which is what the brief asked for, plus a rename the violation control does
// not have. Rename is here because THESE names are on a vehicle a yard manager
// reads every day, and "Pickup" becoming "Pick-up truck" must not mean creating
// a second type and re-filing vehicles by hand.
//
// WHAT THE THREE ACTIONS MAY AND MAY NOT DO is stated in
// lib/actions/vehicle-types.ts, not restated here. The two that matter on
// screen: a rename never touches the key (`fleet.vtype.keyUnchanged` says so
// while you type it), and Retire hides rather than deletes.
//
// `types` MUST BE ALL ROWS — active and retired. lib/vehicle-types.ts decides
// which of them the picker offers; handing it a pre-filtered list would strip
// out the retired-but-currently-selected row it exists to keep.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Pencil } from "lucide-react";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import type { VehicleType } from "@/lib/db-types";
import { vehicleTypeLabel, vehicleTypeOptions } from "@/lib/vehicle-types";
import { addVehicleType, renameVehicleType, retireVehicleType } from "@/lib/actions/vehicle-types";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// The sentinel option that opens the add panel. A uuid column can never hold
// this string, so it cannot collide with a real value.
const ADD = "__add__";

export default function VehicleTypeField({
  name,
  types,
  defaultValue,
}: {
  name: string;
  types: VehicleType[]; // ALL rows (active + retired)
  defaultValue: string | null;
}) {
  const router = useRouter();
  const { lang } = useApp();

  const [value, setValue] = useState(defaultValue ?? "");
  const [mode, setMode] = useState<"idle" | "add" | "rename">("idle");
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  // Rows this control has just written, still absent (or stale) in `types`
  // until router.refresh() lands. ONE list covers all three actions because it
  // is keyed by id and overlays `types`: an add appends a row, a rename and a
  // retire replace one. The same gap ViolationTypeSelect's `extra` covers —
  // but that one can only append, so a rename there would have shown the old
  // name until the refresh arrived.
  const [local, setLocal] = useState<VehicleType[]>([]);

  const merged = useMemo(() => {
    const m = new Map<string, VehicleType>();
    for (const vt of types) m.set(vt.id, vt);
    for (const vt of local) m.set(vt.id, vt); // local wins — it is newer
    return Array.from(m.values());
  }, [types, local]);

  const options = useMemo(
    () => vehicleTypeOptions(merged, value || null, lang),
    [merged, value, lang],
  );

  const selected = value ? merged.find((vt) => vt.id === value) ?? null : null;

  const slug = slugifyKey(en);
  const namesGiven = en.trim() !== "" && ar.trim() !== "";
  const canAdd = namesGiven && isValidSlug(slug);
  const canRename = namesGiven && selected != null;

  function openAdd() {
    setMode("add");
    setEn("");
    setAr("");
    setErr(null);
    setConfirmRetire(false);
  }

  function openRename() {
    if (!selected) return;
    setMode("rename");
    // Prefilled with the CURRENT names, not blank: a rename is an edit of
    // something that exists, and half of it is usually already right.
    setEn(selected.label);
    setAr(selected.label_ar);
    setErr(null);
    setConfirmRetire(false);
  }

  function close() {
    setMode("idle");
    setErr(null);
    setConfirmRetire(false);
  }

  async function add() {
    if (!canAdd || busy) return;
    setBusy(true);
    setErr(null);
    const res = await addVehicleType(en.trim(), ar.trim());
    setBusy(false);
    if (res.error || !res.id) {
      setErr(res.error ?? t("common.lookup.couldNotAdd", lang));
      return;
    }
    // The action returns the ROW'S ID — see its comment for why a key would be
    // a bug here — so the provisional row carries the real uuid and selecting
    // it posts a value the FK accepts, refresh or no refresh.
    const maxSort = merged.reduce((n, vt) => Math.max(n, vt.sort_order), 0);
    setLocal((x) => [
      ...x,
      {
        id: res.id as string,
        // The key is shown nowhere in the resting control; the slug preview
        // above already told the operator what it would be, and this is the
        // same computation the action ran.
        key: slug,
        label: en.trim(),
        label_ar: ar.trim(),
        sort_order: maxSort + 1,
        active: true,
        created_at: new Date().toISOString(),
      },
    ]);
    setValue(res.id);
    close();
    router.refresh();
  }

  async function rename() {
    if (!canRename || !selected || busy) return;
    setBusy(true);
    setErr(null);
    const res = await renameVehicleType(selected.id, en.trim(), ar.trim());
    setBusy(false);
    if (res.error) {
      setErr(res.error ?? t("fleet.vtype.couldNotRename", lang));
      return;
    }
    // Labels only — `key` and `active` are carried over untouched, mirroring
    // exactly what the action wrote.
    setLocal((x) => [
      ...x.filter((vt) => vt.id !== selected.id),
      { ...selected, label: en.trim(), label_ar: ar.trim() },
    ]);
    close();
    router.refresh();
  }

  async function retire() {
    if (!selected || busy) return;
    setBusy(true);
    setErr(null);
    const res = await retireVehicleType(selected.id);
    setBusy(false);
    if (res.error) {
      setErr(res.error ?? t("fleet.vtype.couldNotRetire", lang));
      return;
    }
    // THE SELECTION IS NOT CLEARED. Retiring the type this very vehicle wears
    // would otherwise blank a required field mid-edit; vehicleTypeOptions keeps
    // a retired-but-selected row on purpose, and it now renders "(retired)".
    setLocal((x) => [...x.filter((vt) => vt.id !== selected.id), { ...selected, active: false }]);
    close();
    router.refresh();
  }

  const panel = mode !== "idle";

  return (
    <div
      className="sm:col-span-2 rounded-xl border p-3.5 flex flex-col gap-2.5"
      style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <Tag className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-medium">
            {t(
              mode === "add"
                ? "fleet.vtype.addHeading"
                : mode === "rename"
                  ? "fleet.vtype.renameHeading"
                  : "fleet.vtype.label",
              lang,
            )}
          </span>
          {!panel && selected && !selected.active && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
              {t("fleet.vtype.retired", lang)}
            </span>
          )}
        </div>
        {!panel && selected && (
          <Btn variant="ghost" onClick={openRename} className="h-7 px-2 text-xs shrink-0">
            {/* Space before the label on THIS line — a newline would collapse it. */}
            <Pencil className="h-3.5 w-3.5" /> {t("fleet.vtype.rename", lang)}
          </Btn>
        )}
      </div>

      <p className="text-xs muted leading-relaxed">
        {t(panel ? "fleet.vtype.bothNames" : "fleet.vtype.hint", lang)}
      </p>

      {panel ? (
        <>
          <input
            dir="ltr"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            placeholder={t("fleet.vtype.nameEn", lang)}
            className={INPUT}
            style={INPUT_STYLE}
            autoFocus
          />
          <input
            dir="rtl"
            value={ar}
            onChange={(e) => setAr(e.target.value)}
            placeholder={t("fleet.vtype.nameAr", lang)}
            className={INPUT}
            style={INPUT_STYLE}
          />

          {/* ADD shows the key it is ABOUT to mint, because afterwards it can
              never be changed. RENAME shows the key it is leaving alone, which
              is the fact most likely to be misread as "this will re-file my
              vehicles". Both read the same immutable-key rule from opposite
              sides. */}
          {mode === "add" && en.trim() !== "" && (
            isValidSlug(slug) ? (
              <p className="text-xs muted">
                {t("common.lookup.savedAs", lang)} <span dir="ltr">{slug}</span>
              </p>
            ) : (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {t("common.lookup.mustStartWithLetter", lang)}
              </p>
            )
          )}
          {mode === "rename" && selected && (
            <p className="text-xs muted">
              {t("fleet.vtype.keyUnchanged", lang)} <span dir="ltr">{selected.key}</span>
            </p>
          )}

          {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}

          {confirmRetire ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs muted leading-relaxed">{t("fleet.vtype.retireConfirm", lang)}</p>
              <div className="flex gap-2">
                <Btn
                  variant="ghost"
                  onClick={retire}
                  disabled={busy}
                  className="text-rose-600 dark:text-rose-400"
                >
                  {busy ? "…" : t("fleet.vtype.retire", lang)}
                </Btn>
                {/* autoFocus on the SAFE choice — the destructive button is the
                    one that replaced the click target, so focus must not land
                    on it. Same rule Settings → Warehouses follows. */}
                <Btn variant="outline" onClick={() => setConfirmRetire(false)} autoFocus>
                  {t("common.cancel", lang)}
                </Btn>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {mode === "add" ? (
                <Btn variant="primary" onClick={add} disabled={!canAdd || busy}>
                  {busy ? "…" : t("common.add", lang)}
                </Btn>
              ) : (
                <Btn variant="primary" onClick={rename} disabled={!canRename || busy}>
                  {busy ? "…" : t("common.save", lang)}
                </Btn>
              )}
              <Btn variant="outline" onClick={close}>
                {t("common.cancel", lang)}
              </Btn>
              {mode === "rename" && selected?.active && (
                <Btn
                  variant="ghost"
                  onClick={() => setConfirmRetire(true)}
                  className="ms-auto h-8 px-2 text-xs text-rose-600 dark:text-rose-400"
                >
                  {t("fleet.vtype.retire", lang)}
                </Btn>
              )}
            </div>
          )}
        </>
      ) : (
        <select
          value={value}
          // NO `name` HERE, DELIBERATELY — the hidden input below carries the
          // value instead, so the field still posts while the add/rename panel
          // has this select unmounted. A name-less select is still a candidate
          // for CONSTRAINT VALIDATION, so `required` below does fire; only
          // submission skips it.
          required
          // An operation vehicle must have a type (trucks_vehicle_class_shape_
          // check), and the browser's own default message names no field. This
          // one does. Cleared on change, or the control stays invalid forever.
          onInvalid={(e) => e.currentTarget.setCustomValidity(t("fleet.vtype.required", lang))}
          onChange={(e) => {
            e.currentTarget.setCustomValidity("");
            if (e.target.value === ADD) openAdd();
            else setValue(e.target.value);
          }}
          className={INPUT}
          style={INPUT_STYLE}
        >
          {/* An empty placeholder is what makes `required` mean anything: with
              no blank option the browser pre-selects the first real type and a
              vehicle gets filed as whatever happened to sort first. */}
          <option value="">{options.length === 0 ? t("fleet.vtype.none", lang) : "—"}</option>
          {options.map((vt) => (
            <option key={vt.id} value={vt.id}>
              {vehicleTypeLabel(vt, lang)}
              {!vt.active ? ` ${t("fleet.vtype.retired", lang)}` : ""}
            </option>
          ))}
          <option value={ADD}>{t("fleet.vtype.addOption", lang)}</option>
        </select>
      )}

      <input type="hidden" name={name} value={value} />
    </div>
  );
}
