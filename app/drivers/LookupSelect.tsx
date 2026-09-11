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
import { lookupKey } from "@/lib/slug";
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

  // THE GATE IS "did you type a name", NOTHING MORE.
  //
  // It used to be `slugifyKey(label) !== "" && isValidSlug(slug)`, and that is
  // BUG 3: `slugifyKey` keeps only [a-z0-9], so ANY pure-Arabic name collapsed
  // to "" and the Add button went `pointer-events-none`. The field accepted the
  // Arabic characters fine — nothing scrambled them, nothing rejected them —
  // the SUBMIT was simply dead, which reads to the user as "it will not take
  // Arabic". The label was never the problem; deriving the KEY from it was.
  //
  // WHY IT REGRESSED. 0168 (d368293) added a second `dir="rtl"` Arabic box plus
  // a `withArabicName` prop that routed around this gate, so the gate stopped
  // being reachable and stopped being visible. 524539f then removed that second
  // box — correctly, per the ONE NAME FIELD note at the top of this file — but
  // removed only the BYPASS, not the gate it was bypassing. The gate had been
  // wrong since before 0168; the bypass is what hid it in between.
  //
  // `lookupKey` now returns a stable hashed handle for a label with no Latin
  // run, so there is nothing left for this gate to protect. See lib/slug.ts.
  const { key: previewKey, readable: readableKey } = lookupKey(label);
  const canAdd = previewKey !== "";

  async function add() {
    const clean = label.trim();
    if (!clean) {
      setErr(t("drivers.lookup.nameRequired", lang));
      return;
    }
    // No second check. The `!canAdd -> "must start with a letter"` branch that
    // stood here is gone with the gate it enforced — see the note on `canAdd`.
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

  // The one name field. Not `lang`-driven: it accepts English or Arabic and
  // stores whichever was typed.
  //
  // `dir="auto"` is EXPLICIT, and the comment that used to sit here — "the
  // browser's own bidi handling is what should decide direction" — was the
  // second half of BUG 3. With no `dir` at all the input inherits the
  // PARAGRAPH direction, which in English mode is LTR; Arabic typed into an
  // LTR-base field has its trailing punctuation and any Latin/digit run
  // reordered around it, which is the "scrambled" rendering. `dir="auto"` asks
  // the browser to pick per-VALUE from its first strong character, so the same
  // field renders Arabic RTL and English LTR without either language having to
  // be declared up front.
  const nameInput = (
    <input
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      placeholder={newPlaceholder ?? t("drivers.lookup.newName", lang)}
      dir="auto"
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
          // Same reasoning as the name input's: an option label may be Arabic
          // or English row by row, so direction is decided per VALUE rather
          // than from the app language. Set on the option too — a <select>'s
          // closed state renders the selected <option>, and several browsers
          // read the direction off that element, not the list.
          dir="auto"
          className={INPUT}
          style={INPUT_STYLE}
        >
          {options.length === 0 && <option value="">—</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key} dir="auto">{o.label}</option>
          ))}
          <option value="__add__">{addLabel ?? t("drivers.lookup.addCustom", lang)}</option>
        </select>
      ) : (
        <div className="flex gap-2">
          {nameInput}
          {addButtons}
        </div>
      )}
      {/* SHOWN ONLY WHEN THE KEY IS WORTH READING. A Latin name produces
          "night_shift", which tells someone something. An Arabic one now
          produces `k`+16 hex, which tells them nothing and looks like a fault —
          so that branch prints nothing at all rather than a scarier version of
          success. The old `else` here was an ERROR line; there is no longer a
          name this component refuses. */}
      {adding && readableKey && (
        <p className="text-xs muted">
          {t("drivers.lookup.savedAs", lang)} <span dir="ltr">{previewKey}</span>
        </p>
      )}
      {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
