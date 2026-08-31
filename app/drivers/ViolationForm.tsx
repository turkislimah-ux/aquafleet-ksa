"use client";

/**
 * THE VIOLATION EDITOR, SHARED BY TWO SURFACES.
 *
 * It lived inside TrafficViolationsSection until the payslip preview needed to
 * edit a fine too. Both screens now import from here, which is the point: a
 * second copy of this form would be a second set of rules about what a valid
 * fine looks like, and the two would drift the first time one of them gained a
 * field. The MUTATIONS are not here — both callers invoke the same server
 * actions in app/drivers/actions.ts, where the freeze guard lives.
 *
 * WHAT EACH SURFACE DOES WITH IT:
 *   drivers screen  → add and edit, photo control included
 *   payslip preview → edit only, on an UNISSUED month, photo control included
 *
 * `photo` IS STILL OPTIONAL, because the rule is not "which screen" but "may
 * this row be changed at all". A fine that can have its amount corrected can
 * have the wrong notice swapped for the right one; a fine frozen onto an issued
 * payslip can have neither, and that surface never opens this form. Omitting
 * the prop removes the control rather than disabling it, so no caller shows an
 * upload target it would then have to explain away.
 *
 * THE STATE BEHIND THE CONTROL IS SHARED TOO — `usePhotoDraft` below, and
 * `applyPhotoChanges` for the save tail. Both callers use both.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, ImagePlus, Trash2, X } from "lucide-react";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import {
  violationTypeLabel,
  validateViolationImage,
  VIOLATION_IMAGE_ACCEPT,
  type ViolationType,
} from "@/lib/violations";
import {
  addViolationType,
  removeDriverViolationImage,
  uploadDriverViolationImage,
} from "./actions";

export const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
export const INPUT_STYLE = {
  borderColor: "rgb(var(--border))",
  background: "rgb(var(--card))",
} as const;

export type Draft = {
  typeId: string;
  ref: string;
  amount: string;
  date: string;
  status: "paid" | "not_paid";
  note: string;
};

export function emptyDraft(typeId: string, date: string): Draft {
  return { typeId, ref: "", amount: "", date, status: "not_paid", note: "" };
}

/**
 * Everything the photo field needs, as ONE prop.
 *
 * The form already takes nine props; threading eight more through it for an
 * optional attachment would bury the fields that matter. This also keeps the
 * photo's state machine — picked / cleared / already-on-file — readable in one
 * place instead of spread across the parent's useState list.
 */
export type PhotoState = {
  /** A file chosen in THIS editing session, not yet uploaded. */
  file: File | null;
  /** True when the operator asked to drop the stored photo, pending Save. */
  cleared: boolean;
  /** Does the row being edited already have one? Always false when adding. */
  hasExisting: boolean;
  /** Client-side validation message, shown under the control. */
  error: string | null;
  /** Bumped to reset the <input type="file"> — it holds its own DOM value. */
  inputKey: number;
  onPick: (f: File | null) => void;
  onClear: () => void;
  onUndoClear: () => void;
  onView: () => void;
  viewBusy: boolean;
};

/** What `usePhotoDraft` hands back: the state machine, minus the surface's half. */
export type PhotoDraft = {
  file: File | null;
  cleared: boolean;
  error: string | null;
  inputKey: number;
  pick: (f: File | null) => void;
  clear: () => void;
  undoClear: () => void;
  /** Back to "nothing picked, nothing pending" — what closing a form means. */
  reset: () => void;
};

/**
 * THE PHOTO'S STATE MACHINE, OWNED ONCE.
 *
 * Both surfaces ran a byte-identical copy of this — validate, clear-or-set,
 * bump the input key, let a pick supersede a pending removal — differing only
 * in what they had named their setters. Two copies of a four-branch rule is two
 * chances to fix a bug in one of them.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: `hasExisting`, `onView` and `viewBusy`.
 * Those are genuinely per-surface — the drivers screen opens an inline panel,
 * the payslip claims a new tab — and folding them in here would force one
 * viewer on both. The caller supplies those three and spreads the rest.
 *
 * NOTHING HERE TOUCHES STORAGE. This is what Save WILL do, so Cancel cancels.
 */
export function usePhotoDraft(): PhotoDraft {
  const [file, setFile] = useState<File | null>(null);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  return {
    file,
    cleared,
    error,
    inputKey,
    /**
     * Validated HERE for the immediate no, and again on the server, which is
     * the actual gate. Same shared allow-list on both sides — `accept` on the
     * input is a filter in the file dialog, not a check.
     */
    pick(f) {
      if (!f) {
        setFile(null);
        setError(null);
        return;
      }
      const bad = validateViolationImage(f);
      if (bad) {
        setFile(null);
        setError(bad);
        // The <input type="file"> holds its own DOM value; remounting it is the
        // only way to make a rejected pick actually go away.
        setInputKey((k) => k + 1);
        return;
      }
      setError(null);
      setFile(f);
      // Picking a replacement supersedes a pending removal.
      setCleared(false);
    },
    clear() {
      setCleared(true);
      setFile(null);
      setInputKey((k) => k + 1);
    },
    undoClear() {
      setCleared(false);
    },
    reset() {
      setFile(null);
      setCleared(false);
      setError(null);
      setInputKey((k) => k + 1);
    },
  };
}

/**
 * THE POST-SAVE TAIL, OWNED ONCE — the half of a save that must never be able
 * to undo the half above it.
 *
 * Both surfaces reach here only AFTER the fine itself is written, and both had
 * their own copy of the same three rules: remove before upload so a
 * replace-then-clear cannot resurrect the old object, wrap an upload failure in
 * the sentence that says "saved" first, and return rather than throw so the
 * caller keeps control of its busy flag.
 *
 * RETURNS THE WARNING, DOES NOT RENDER IT. Null means the photo did whatever
 * was asked. A string means the fine is saved and only its attachment is not —
 * which is why every caller shows it in amber and none of them in rose.
 *
 * `lang` IS A PARAMETER, not a hook read: this is a plain async function called
 * from an event handler, and the one message it can produce is translated.
 */
export async function applyPhotoChanges(
  driverId: string,
  violationId: string,
  change: { file: File | null; cleared: boolean },
  lang: Lang,
): Promise<string | null> {
  let warn: string | null = null;

  if (change.cleared) {
    const r = await removeDriverViolationImage(violationId);
    // Already the server's own sentence — nothing to add to it.
    if (r.error) warn = r.error;
  }

  if (change.file) {
    const form = new FormData();
    form.set("imageFile", change.file);
    const r = await uploadDriverViolationImage(driverId, violationId, form);
    if (r.error) warn = fill(t("drivers.viol.photoFailedSaved", lang), { err: r.error });
  }

  return warn;
}

/**
 * THE ONE PLACE A DRAFT BECOMES A REQUEST. Both `addDriverViolation` and
 * `updateDriverViolation` read exactly these keys, so a field renamed here is
 * renamed for both callers at once — which is the whole reason this is not
 * duplicated on the payslip side.
 */
export function draftToForm(driverId: string, d: Draft): FormData {
  const fd = new FormData();
  fd.set("driver_id", driverId);
  fd.set("violation_type_id", d.typeId);
  fd.set("ref_no", d.ref);
  fd.set("amount_sar", d.amount);
  fd.set("violation_date", d.date);
  fd.set("payment_status", d.status);
  fd.set("note", d.note);
  return fd;
}

/** A row's fields, turned back into a draft for editing. */
export function draftFromRow(v: {
  violation_type_id: string;
  ref_no: string;
  amount_sar: number;
  violation_date: string;
  payment_status: string;
  note: string | null;
}): Draft {
  return {
    typeId: v.violation_type_id,
    ref: v.ref_no,
    amount: String(v.amount_sar),
    date: v.violation_date,
    status: v.payment_status === "paid" ? "paid" : "not_paid",
    note: v.note ?? "",
  };
}

export function ViolationForm({
  draft, setDraft, types, floor, busy, error, onCancel, onSubmit, heading, photo,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  types: ViolationType[];
  /** Undefined on EDIT — see actions.ts violationDateFloor for why. */
  floor: string | undefined;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  heading: string;
  /** Omitted where photos are not managed — see this file's header. */
  photo?: PhotoState;
}) {
  const { lang } = useApp();

  // Client-side mirror of validateViolation. Not a substitute for it — the
  // server re-checks every one of these — but a disabled button beats a round
  // trip that comes back saying "enter an amount".
  const amount = Number(draft.amount);
  const ready =
    draft.typeId !== "" &&
    draft.ref.trim() !== "" &&
    draft.amount.trim() !== "" &&
    Number.isFinite(amount) && amount > 0 &&
    draft.date !== "" &&
    (floor === undefined || draft.date >= floor);

  return (
    <div className="mb-3 rounded-lg border border-app p-3 space-y-3">
      <div className="text-sm font-medium">{heading}</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="muted">{t("drivers.viol.fType", lang)}</span>
          <ViolationTypeSelect
            types={types}
            value={draft.typeId}
            onChange={(id) => setDraft({ ...draft, typeId: id })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("drivers.viol.fRef", lang)}</span>
          {/* dir="ltr" on the INPUT, not just its display: the operator is
              copying a Latin-digit number off a paper notice, and an RTL text
              field puts the caret on the wrong side while they type it. */}
          <input
            dir="ltr"
            value={draft.ref}
            onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
            placeholder={t("drivers.viol.phRef", lang)}
            className={cn(INPUT, "font-mono")}
            style={INPUT_STYLE}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("drivers.viol.fAmount", lang)}</span>
          <input
            dir="ltr"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("drivers.viol.fDate", lang)}</span>
          <input
            type="date"
            value={draft.date}
            min={floor}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            className={INPUT}
            style={INPUT_STYLE}
          />
          {floor !== undefined && (
            <span className="text-[11px] muted leading-relaxed">
              {fill(t("drivers.viol.dateFloor", lang), { month: floor })}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">{t("drivers.viol.fStatus", lang)}</span>
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value === "paid" ? "paid" : "not_paid" })}
            className={INPUT}
            style={INPUT_STYLE}
          >
            {/* NOT PAID FIRST, and it is also the default: a fine gets entered
                because it just arrived, which is the state it arrives in. */}
            <option value="not_paid">{t("drivers.viol.notPaid", lang)}</option>
            <option value="paid">{t("drivers.viol.paid", lang)}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="muted">{t("drivers.viol.fNote", lang)}</span>
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </label>

        {/* LAST, AND VISIBLY OPTIONAL. Everything above decides what is owed;
            this does not, and a field that changes no money should not compete
            with the ones that do. Absent entirely on the payslip surface. */}
        {photo && (
          <div className="sm:col-span-2">
            <PhotoField photo={photo} />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <Btn variant="outline" onClick={onCancel}>{t("common.cancel", lang)}</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={!ready || busy}>
          {busy ? t("common.saving", lang) : t("common.save", lang)}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The optional notice photo.
 *
 * FOUR STATES, and each says what pressing Save will do rather than what has
 * already happened — nothing here touches Storage. Save is the only thing that
 * uploads or deletes, so Cancel genuinely cancels, including a removal.
 *
 *   none        → a dashed "Attach a photo" target
 *   picked      → the chosen filename and size, with an X to drop it
 *   on file     → View / Replace / Remove
 *   cleared     → a struck line saying it will go, with Undo
 *
 * SIZE IS SHOWN NEXT TO THE FILENAME, not only in the error. A 5 MB cap that
 * only announces itself on rejection makes the operator guess; the number is
 * cheap to print and answers the question before it is asked.
 */
function PhotoField({ photo }: { photo: PhotoState }) {
  const { lang } = useApp();
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="muted">
        {t("drivers.viol.fPhoto", lang)}{" "}
        <span className="text-[11px]">({t("drivers.viol.photoOptional", lang)})</span>
      </span>

      {photo.file ? (
        <div className="flex items-center gap-2 rounded-lg border border-app px-3 py-2">
          <ImageIcon className="h-4 w-4 shrink-0 muted" />
          <span className="min-w-0 flex-1 truncate text-[12px]" dir="ltr">{photo.file.name}</span>
          <span className="shrink-0 text-[11px] muted tabular-nums" dir="ltr">{mb(photo.file.size)}</span>
          <button
            type="button"
            onClick={() => photo.onPick(null)}
            className="shrink-0 rounded p-1 muted hover:text-rose-600 dark:hover:text-rose-400"
            aria-label={t("drivers.viol.photoRemove", lang)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : photo.hasExisting && !photo.cleared ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-app px-3 py-2">
          <ImageIcon className="h-4 w-4 shrink-0 muted" />
          <span className="flex-1 text-[12px]">{t("drivers.viol.photoOnFile", lang)}</span>
          <button
            type="button"
            onClick={photo.onView}
            disabled={photo.viewBusy}
            className="rounded-md px-2 py-1 text-[11px] underline muted hover:text-[rgb(var(--fg))] disabled:opacity-60"
          >
            {photo.viewBusy ? t("drivers.viol.photoLoading", lang) : t("common.view", lang)}
          </button>
          <label className="cursor-pointer rounded-md px-2 py-1 text-[11px] underline muted hover:text-[rgb(var(--fg))]">
            {t("drivers.viol.photoReplace", lang)}
            <input
              key={photo.inputKey}
              type="file"
              accept={VIOLATION_IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => photo.onPick(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={photo.onClear}
            className="rounded-md p-1 muted hover:text-rose-600 dark:hover:text-rose-400"
            aria-label={t("drivers.viol.photoRemove", lang)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : photo.cleared ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <Trash2 className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="flex-1 text-[12px] line-through muted">
            {t("drivers.viol.photoOnFile", lang)}
          </span>
          <button
            type="button"
            onClick={photo.onUndoClear}
            className="rounded-md px-2 py-1 text-[11px] underline muted hover:text-[rgb(var(--fg))]"
          >
            {t("drivers.viol.photoUndoRemove", lang)}
          </button>
        </div>
      ) : (
        <label
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-[12px] muted transition-colors hover:text-[rgb(var(--fg))] hover:border-[rgb(var(--fg))]/30"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <ImagePlus className="h-4 w-4" />
          {t("drivers.viol.photoAttach", lang)}
          <input
            key={photo.inputKey}
            type="file"
            accept={VIOLATION_IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => photo.onPick(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {photo.error
        ? <span className="text-[11px] text-rose-600 dark:text-rose-400">{photo.error}</span>
        : <span className="text-[11px] muted leading-relaxed">{t("drivers.viol.photoHint", lang)}</span>}
    </div>
  );
}

/**
 * The type dropdown, with an inline "+ Add a new type…".
 *
 * NOT LookupSelect, and the difference is the data, not the taste.
 * `violation_types` stores `label` AND `label_ar`, both NOT NULL — LookupSelect
 * was deliberately reduced to ONE name field when staff_roles and leave_types
 * became single-label tables, and its remaining two-column caller
 * (commission_types) copies the English into the Arabic column to satisfy the
 * constraint. Copying is not acceptable here: these names are shown to Arabic
 * readers as the description of a fine deducted from their pay, and "Running a
 * red light" is not a description in Arabic. So this asks for both, and
 * requires both.
 *
 * It also carries no hidden input: this form submits through a server action
 * with an explicit FormData, not by DOM serialisation, so the selected id is
 * lifted into the draft instead.
 */
function ViolationTypeSelect({
  types, value, onChange,
}: {
  types: ViolationType[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A type added in THIS session, still absent from `types` until the refresh
  // lands. Same gap LookupSelect covers with its `extra` list.
  const [extra, setExtra] = useState<ViolationType[]>([]);

  // ACTIVE types, PLUS whichever one is already selected even if it has since
  // been retired. That second clause is not politeness — without it, editing an
  // old fine whose type was deactivated renders a <select> with no matching
  // option, the browser silently displays the first one, and pressing Save
  // rewrites the fine's type to something nobody chose. Retired-but-selected is
  // shown so it can be kept; it just cannot be picked fresh.
  const options = useMemo(() => {
    const m = new Map<string, ViolationType>();
    for (const vt of types) if (vt.active || vt.id === value) m.set(vt.id, vt);
    for (const vt of extra) if (!m.has(vt.id)) m.set(vt.id, vt);
    return Array.from(m.values());
  }, [types, extra, value]);

  const slug = slugifyKey(en);
  const canAdd = en.trim() !== "" && ar.trim() !== "" && slug !== "" && isValidSlug(slug);

  async function add() {
    if (!canAdd || busy) return;
    setBusy(true);
    setErr(null);
    const res = await addViolationType(en.trim(), ar.trim());
    setBusy(false);
    if (res.error || !res.key) {
      setErr(res.error ?? t("drivers.lookup.couldNotAdd", lang));
      return;
    }
    // The action returns the KEY, not the id — the id is what this form
    // submits, so the refreshed fetch is what actually selects the new type.
    // Until it lands, the select shows the row we just created, keyed by its
    // slug so it cannot collide with a uuid.
    const provisional: ViolationType = {
      id: res.key, key: res.key, label: en.trim(), label_ar: ar.trim(),
      is_default: false, active: true,
    };
    setExtra((x) => [...x, provisional]);
    onChange(provisional.id);
    setEn("");
    setAr("");
    setAdding(false);
    router.refresh();
  }

  if (adding) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] muted leading-relaxed">{t("drivers.viol.typeBoth", lang)}</p>
        <input
          dir="ltr"
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder={t("drivers.viol.typeEn", lang)}
          className={INPUT}
          style={INPUT_STYLE}
          autoFocus
        />
        <input
          dir="rtl"
          value={ar}
          onChange={(e) => setAr(e.target.value)}
          placeholder={t("drivers.viol.typeAr", lang)}
          className={INPUT}
          style={INPUT_STYLE}
        />
        {en.trim() !== "" && (
          isValidSlug(slug)
            ? <p className="text-xs muted">{t("drivers.lookup.savedAs", lang)} <span dir="ltr">{slug}</span></p>
            : <p className="text-xs text-rose-600 dark:text-rose-400">{t("drivers.lookup.mustStartWithLetter", lang)}</p>
        )}
        {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="primary" onClick={add} disabled={!canAdd || busy}>
            {busy ? "…" : t("common.add", lang)}
          </Btn>
          <Btn variant="outline" onClick={() => { setAdding(false); setErr(null); }}>
            {t("common.cancel", lang)}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "__add__") {
          setAdding(true);
          setErr(null);
        } else {
          onChange(e.target.value);
        }
      }}
      className={INPUT}
      style={INPUT_STYLE}
    >
      {options.length === 0 && <option value="">—</option>}
      {options.map((vt) => (
        <option key={vt.id} value={vt.id}>{violationTypeLabel(vt, lang)}</option>
      ))}
      <option value="__add__">{t("drivers.viol.typeAdd", lang)}</option>
    </select>
  );
}
