"use client";

// Generic lookup dropdown with an inline "+ Add custom …" row — the generalized
// form of StaffTab's RoleSelect. Fed by lookup items ({key,label}); choosing the
// add row reveals an inline input that calls `onAdd(label)`, then selects the
// returned key. A hidden input carries the chosen key into the surrounding form.
//
// Used by StaffTab (roles), LeaveSection (leave types) and
// MechanicCommissionsSection (commission types).
//
// ONE NAME FIELD, ALWAYS. The optional second Arabic input this carried between
// 0168 and this batch is gone, along with the `withArabicName` prop that gated
// it — `staff_roles` and `leave_types` each store one `label` shown as typed
// (0169, 0170), so there is no second column for a second box to fill.
// MechanicCommissionsSection is NOT an exception to that: `commission_types` is
// a genuinely two-column table (`label_en`/`label_ar`, both NOT NULL per 0080)
// and it composes its own display with `arText` BEFORE passing `items` in, so
// this component never sees the split. It never passed `withArabicName` either.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function LookupSelect({
  name,
  items,
  defaultKey,
  onAdd,
  addLabel,
  newPlaceholder,
}: {
  name: string;
  items: { key: string; label: string }[];
  defaultKey: string;
  // ONE NAME, TAKEN AS TYPED. The optional second `labelAr` argument and the
  // `withArabicName` prop that gated it are both GONE: 0169 and 0170 gave the
  // built-in roles and leave types a bilingual `label`, which is what removed
  // the need for a second column and therefore for a second input. Both lookup
  // tables now store one name and show it verbatim in either app language.
  onAdd: (label: string) => Promise<{ error: string | null; key?: string }>;
  addLabel?: string;
  newPlaceholder?: string;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [extra, setExtra] = useState<{ key: string; label: string }[]>([]);
  const [value, setValue] = useState(defaultKey);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Merge fetched items + locally-added + the current value (covers a value the
  // fetch omitted, e.g. an inactive key on edit). Dedup by key.
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) map.set(it.key, it.label);
    // A row added in THIS session, still absent from `items` until the refresh
    // lands. Shown as typed, exactly as the refreshed row will be — so `lang` is
    // no longer a dependency here: there is nothing left to re-compose when the
    // language flips, because the stored name does not change with it.
    for (const e of extra) if (!map.has(e.key)) map.set(e.key, e.label);
    if (value && !map.has(value)) map.set(value, value);
    return Array.from(map, ([key, lbl]) => ({ key, label: lbl }));
  }, [items, extra, value]);

  // Live slug preview/gate (mirrors the DB CHECK via lib/slug). Empty label →
  // no preview, submit disabled. Invalid slug (starts with digit/_) → loud error.
  const slug = slugifyKey(label);
  const validSlug = isValidSlug(slug);
  const canAdd = slug !== "" && validSlug;

  async function add() {
    const clean = label.trim();
    if (!clean) {
      setErr(t("drivers.lookup.nameRequired", lang));
      return;
    }
    if (!canAdd) {
      setErr(t("drivers.lookup.mustStartWithLetter", lang));
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await onAdd(clean);
    setBusy(false);
    if (res.error || !res.key) {
      setErr(res.error ?? t("drivers.lookup.couldNotAdd", lang));
      return;
    }
    setExtra((x) => [...x, { key: res.key!, label: clean }]);
    setValue(res.key);
    setLabel("");
    setAdding(false);
    router.refresh();
  }
  function cancelAdd() {
    setAdding(false);
    setLabel("");
    setErr(null);
  }

  // The one name field. Not `dir`-locked and not `lang`-driven: it accepts
  // English or Arabic and stores whichever was typed, so the browser's own
  // bidi handling is what should decide direction here.
  const nameInput = (
    <input
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      placeholder={newPlaceholder ?? t("drivers.lookup.newName", lang)}
      className={INPUT}
      style={INPUT_STYLE}
      autoFocus
    />
  );
  const addButtons = (
    <>
      <Btn
        type="button"
        variant="primary"
        onClick={add}
        className={cn(!canAdd && "opacity-50 pointer-events-none")}
      >
        {busy ? "…" : t("common.add", lang)}
      </Btn>
      <Btn type="button" variant="outline" onClick={cancelAdd}>{t("common.cancel", lang)}</Btn>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {!adding ? (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === "__add__") {
              setAdding(true);
              setErr(null);
            } else {
              setValue(e.target.value);
            }
          }}
          className={INPUT}
          style={INPUT_STYLE}
        >
          {options.length === 0 && <option value="">—</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
          <option value="__add__">{addLabel ?? t("drivers.lookup.addCustom", lang)}</option>
        </select>
      ) : (
        <div className="flex gap-2">
          {nameInput}
          {addButtons}
        </div>
      )}
      {adding && label.trim() !== "" && slug !== "" && (
        validSlug
          ? <p className="text-xs muted">{t("drivers.lookup.savedAs", lang)} <span dir="ltr">{slug}</span></p>
          : <p className="text-xs text-rose-600 dark:text-rose-400">{t("drivers.lookup.mustStartWithLetter", lang)}</p>
      )}
      {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
