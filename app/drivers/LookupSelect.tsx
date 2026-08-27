"use client";

// Generic lookup dropdown with an inline "+ Add custom …" row — the generalized
// form of StaffTab's RoleSelect. Fed by lookup items ({key,label}); choosing the
// add row reveals an inline input that calls `onAdd(label)`, then selects the
// returned key. A hidden input carries the chosen key into the surrounding form.
//
// Used by LeaveSection for the leave-type picker (and shareable with roles).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, arText } from "@/lib/i18n";
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
  withArabicName = false,
}: {
  name: string;
  items: { key: string; label: string }[];
  defaultKey: string;
  // 0168: the second argument is the OPTIONAL Arabic name, and it is only ever
  // passed when `withArabicName` is on. A one-parameter action is still
  // assignable here — TypeScript allows a callback to ignore trailing
  // arguments — so a caller that has no Arabic column needs no adapter.
  onAdd: (label: string, labelAr?: string) => Promise<{ error: string | null; key?: string }>;
  addLabel?: string;
  newPlaceholder?: string;
  // Opt-in, because the column only exists on the lookup tables that have it.
  // Off by default so a caller cannot collect Arabic that its action drops.
  withArabicName?: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [extra, setExtra] = useState<{ key: string; label: string; label_ar: string | null }[]>([]);
  const [value, setValue] = useState(defaultKey);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Merge fetched items + locally-added + the current value (covers a value the
  // fetch omitted, e.g. an inactive key on edit). Dedup by key.
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) map.set(it.key, it.label);
    // A row added in THIS session, still absent from `items` until the refresh
    // lands. Its display is composed HERE, with `lang` in the dep list, instead
    // of being frozen into state when it was added — a string built at add-time
    // keeps the language it was added in and survives a language flip unchanged.
    for (const e of extra) if (!map.has(e.key)) map.set(e.key, arText(e.label, e.label_ar, lang));
    if (value && !map.has(value)) map.set(value, value);
    return Array.from(map, ([key, lbl]) => ({ key, label: lbl }));
  }, [items, extra, value, lang]);

  // Live slug preview/gate (mirrors the DB CHECK via lib/slug). Empty label →
  // no preview, submit disabled. Invalid slug (starts with digit/_) → loud error.
  const slug = slugifyKey(label);
  const validSlug = isValidSlug(slug);
  const canAdd = slug !== "" && validSlug;

  async function add() {
    const clean = label.trim();
    // Optional by design: blank stays blank all the way to the action, which
    // stores NULL. Only the ENGLISH name is required, exactly as before.
    const cleanAr = withArabicName ? labelAr.trim() : "";
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
    const res = await onAdd(clean, cleanAr || undefined);
    setBusy(false);
    if (res.error || !res.key) {
      setErr(res.error ?? t("drivers.lookup.couldNotAdd", lang));
      return;
    }
    setExtra((x) => [...x, { key: res.key!, label: clean, label_ar: cleanAr || null }]);
    setValue(res.key);
    setLabel("");
    setLabelAr("");
    setAdding(false);
    router.refresh();
  }
  // Clears BOTH names, not just the Arabic one. The two inputs are one form: if
  // cancel left the English name filled and blanked the Arabic, reopening would
  // show a half-populated pair and a new Arabic name could be saved against the
  // previous English one.
  function cancelAdd() {
    setAdding(false);
    setLabel("");
    setLabelAr("");
    setErr(null);
  }

  // Both add layouts share these, so the one-field and two-field forms cannot
  // drift apart in copy or behaviour.
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
      ) : withArabicName ? (
        // Two names side by side, buttons on their own row — three controls plus
        // a second field in one line leaves neither name readable.
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {nameInput}
            {/* dir on the INPUT, and hardcoded rtl rather than driven by `lang`:
                this box holds Arabic whichever language the UI is in, so its
                direction follows the CONTENT. Same treatment as the `name_ar`
                inputs on the staff and driver forms. */}
            <input
              value={labelAr}
              onChange={(e) => setLabelAr(e.target.value)}
              dir="rtl"
              placeholder={t("drivers.lookup.phArName", lang)}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </div>
          <div className="flex gap-2 justify-end">{addButtons}</div>
        </div>
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
