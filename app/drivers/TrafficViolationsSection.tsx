"use client";

// TRAFFIC VIOLATIONS — the driver-detail section (0175 tables, 0177 payroll).
//
// SIBLING OF IncidentsSection, deliberately: same card shell, same inline
// edit-in-place, same "the list lives here, mutations happen here" shape. It
// diverges in the two places the subject genuinely differs.
//
//   1. THIS IS MONEY, so it leads with a figure. An incident list answers "what
//      happened"; this one answers "what is still owed", and that number is not
//      reconstructible from the rows below it — payroll has already recovered
//      part of it. So the outstanding balance is the loudest thing in the
//      header, and the list is the evidence underneath.
//
//   2. ROWS GO READ-ONLY. Once a fine is frozen onto an issued payslip it is
//      part of a document that has been handed to a person, and the controls
//      are gone rather than merely disabled — a greyed-out Void button invites
//      a second click and a support question. The server refuses it too
//      (actions.ts); this is the explanation, not the lock.
//
// ADD is inline-expanding rather than a modal. The driver detail is ALREADY a
// modal, and a modal over a modal is where scroll containment and Escape
// handling start fighting each other.
//
// NO MONEY MATH HERE. Nothing in this file multiplies, clamps or nets anything.
// The outstanding figure arrives computed (lib/violations.ts, server-side) and
// a violation reaches payroll only through v_driver_payslip_basis.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Lock, Pencil, ShieldAlert } from "lucide-react";
import { Btn, Table, TD, TH } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural } from "@/lib/i18n";
import { cn, formatSar, formatSarExact } from "@/lib/utils";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import {
  monthStartKey,
  violationTypeLabel,
  type DriverViolationView,
  type OutstandingCell,
  type ViolationType,
} from "@/lib/violations";
import {
  addDriverViolation,
  addViolationType,
  updateDriverViolation,
  voidDriverViolation,
} from "./actions";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// How many rows the list shows. The spec is the three most recent; anything
// older is history and belongs on the payslip statement, which is scoped to a
// month and can show the month's full set.
const SHOW = 3;

type Draft = {
  typeId: string;
  ref: string;
  amount: string;
  date: string;
  status: "paid" | "not_paid";
  note: string;
};

function emptyDraft(typeId: string, date: string): Draft {
  return { typeId, ref: "", amount: "", date, status: "not_paid", note: "" };
}

function draftToForm(driverId: string, d: Draft): FormData {
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

export default function TrafficViolationsSection({
  driverId,
  violations,
  types,
  outstanding,
  today,
}: {
  driverId: string;
  /** Live rows only, newest first, settlement already resolved server-side. */
  violations: DriverViolationView[];
  /**
   * EVERY type, active and retired. Two different jobs need two different sets
   * and only one of them is the picker: the rows below resolve their label from
   * this list, and the row likeliest to point at a retired type is a locked
   * historical one that nobody can fix. Filtering here would print an em-dash
   * where a fine's description belongs. The picker does its own filtering.
   */
  types: ViolationType[];
  /** null when the driver owes nothing — an absent key, not a computed zero. */
  outstanding: OutstandingCell | null;
  today: string;
}) {
  const { lang } = useApp();
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(types.find((vt) => vt.active)?.id ?? "", today),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeById = useMemo(() => {
    const m = new Map<string, ViolationType>();
    for (const vt of types) m.set(vt.id, vt);
    return m;
  }, [types]);

  // What a NEW violation may be filed under. Retired types stay readable above
  // and stay unpickable here — that is the whole difference between
  // deactivating a type and deleting one.
  const activeTypes = useMemo(() => types.filter((vt) => vt.active), [types]);

  // THE FLOOR, computed from the same `today` the rest of the detail uses.
  // Also the `min` on the date input, so the browser refuses it before the
  // round trip — but the server owns the rule (actions.ts) and this is only
  // the courteous half of it.
  const floor = monthStartKey(today);
  const sar = outstanding?.sar ?? 0;
  const count = outstanding?.count ?? 0;
  const shown = violations.slice(0, SHOW);

  function resetForms() {
    setAdding(false);
    setEditingId(null);
    setVoidingId(null);
    setVoidReason("");
    setError(null);
  }

  function openAdd() {
    resetForms();
    setDraft(emptyDraft(activeTypes[0]?.id ?? "", today));
    setAdding(true);
  }

  function openEdit(v: DriverViolationView) {
    resetForms();
    setDraft({
      typeId: v.violation_type_id,
      ref: v.ref_no,
      amount: String(v.amount_sar),
      date: v.violation_date,
      status: v.payment_status,
      note: v.note ?? "",
    });
    setEditingId(v.id);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const fd = draftToForm(driverId, draft);
    const res = editingId
      ? await updateDriverViolation(editingId, fd)
      : await addDriverViolation(fd);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    resetForms();
    router.refresh();
  }

  async function confirmVoid() {
    if (!voidingId || busy) return;
    setBusy(true);
    setError(null);
    const res = await voidDriverViolation(voidingId, voidReason);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    resetForms();
    router.refresh();
  }

  const formOpen = adding || editingId !== null;

  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> {t("drivers.viol.title", lang)}
        </h4>
        <Btn variant="outline" onClick={formOpen || voidingId ? resetForms : openAdd}>
          {formOpen || voidingId ? t("common.cancel", lang) : `+ ${t("drivers.viol.add", lang)}`}
        </Btn>
      </div>

      {/* THE HEADLINE. Amber when money is owed, muted when it is not — a
          driver at zero should read as unremarkable, because he is. The money
          and the count are one sentence rather than two chips: separated, "2"
          and "900 SAR" invite the reading that each fine is 450. */}
      <div
        className={cn(
          "mb-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed",
          sar > 0
            ? "border border-amber-500/25 bg-amber-500/5"
            : "border border-app muted",
        )}
        title={t("drivers.viol.outstandingHelp", lang)}
      >
        {sar > 0 ? (
          <span className="font-medium">
            {fill(t(`drivers.viol.outstanding.${plural(count)}`, lang), {
              // The money keeps its own direction; `{n}` is a bare count that
              // the sentence carries inline, as the payout line does.
              sar: formatSar(sar),
              n: count,
            })}
          </span>
        ) : (
          t("drivers.viol.noOutstanding", lang)
        )}
        <div className="muted mt-0.5">{t("drivers.viol.outstandingHelp", lang)}</div>
      </div>

      {formOpen && (
        <ViolationForm
          draft={draft}
          setDraft={setDraft}
          types={types}
          floor={editingId ? undefined : floor}
          busy={busy}
          error={error}
          onCancel={resetForms}
          onSubmit={submit}
          heading={t(editingId ? "drivers.viol.editTitle" : "drivers.viol.addTitle", lang)}
        />
      )}

      {violations.length === 0 ? (
        <p className="muted text-sm">{t("drivers.viol.none", lang)}</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <TH>{t("common.type", lang)}</TH>
                <TH>{t("drivers.viol.fRef", lang)}</TH>
                <TH>{t("common.amount", lang)}</TH>
                <TH>{t("common.date", lang)}</TH>
                <TH>{t("common.status", lang)}</TH>
                <TH className="text-end" />
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const locked = v.settlement.locked;
                return (
                  <tr key={v.id}>
                    <TD className="whitespace-normal">
                      <div className="font-medium">{violationTypeLabel(typeById.get(v.violation_type_id), lang)}</div>
                      {v.note && <div className="text-[11px] muted">{v.note}</div>}
                    </TD>
                    {/* A government reference number is a Latin token in both
                        languages — and font-mono because it is read digit by
                        digit against a paper notice. */}
                    <TD><span dir="ltr" className="font-mono text-xs">{v.ref_no}</span></TD>
                    <TD className="tabular-nums">
                      <span dir="ltr">{formatSarExact(v.amount_sar)}</span>
                    </TD>
                    <TD><span dir="ltr">{v.violation_date}</span></TD>
                    <TD className="whitespace-normal">
                      {/* TWO DIFFERENT QUESTIONS, both answered. "Paid" is
                          whether the FINE was settled with the authority;
                          "Deducted" is whether PAYROLL has taken it out of
                          this driver's pay. Neither implies the other, and
                          collapsing them into one badge has to guess which
                          one the reader meant. */}
                      <div className="flex flex-wrap items-center gap-1">
                        <Chip tone={v.payment_status === "paid" ? "ok" : "warn"}>
                          {t(v.payment_status === "paid" ? "drivers.viol.paid" : "drivers.viol.notPaid", lang)}
                        </Chip>
                        <Chip
                          tone={
                            v.settlement.state === "deducted" ? "ok"
                              : v.settlement.state === "partial" ? "warn"
                                : "neutral"
                          }
                        >
                          {t(`drivers.viol.st${v.settlement.state === "deducted" ? "Deducted" : v.settlement.state === "partial" ? "Partial" : "Unsettled"}`, lang)}
                        </Chip>
                      </div>
                    </TD>
                    <TD className="text-end">
                      {locked ? (
                        <span
                          className="inline-flex items-center gap-1 muted text-[11px]"
                          title={t("drivers.viol.lockedNote", lang)}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          {t("drivers.viol.lockedNote", lang)}
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(v)}
                            className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 muted"
                            aria-label={t("drivers.viol.editTitle", lang)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetForms();
                              setVoidingId(v.id);
                            }}
                            className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                            aria-label={t("drivers.viol.voidTitle", lang)}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          {violations.length > SHOW && (
            <p className="muted text-[11px] mt-2">
              {fill(t("drivers.viol.showingOf", lang), { n: violations.length })}
            </p>
          )}
        </>
      )}

      {voidingId && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
          <div className="text-sm font-medium text-rose-700 dark:text-rose-300">
            {t("drivers.viol.voidTitle", lang)}
          </div>
          <p className="text-[12px] muted leading-relaxed">{t("drivers.viol.voidHint", lang)}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("drivers.viol.voidReason", lang)}</span>
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t("drivers.viol.voidReasonPh", lang)}
              className={INPUT}
              style={INPUT_STYLE}
              autoFocus
            />
          </label>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Btn variant="outline" onClick={resetForms}>{t("common.cancel", lang)}</Btn>
            <button
              type="button"
              onClick={confirmVoid}
              disabled={busy || voidReason.trim() === ""}
              className="h-9 px-3 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              {busy ? t("drivers.viol.voiding", lang) : t("drivers.viol.voidBtn", lang)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Chip({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap",
        tone === "ok" && "text-emerald-700 dark:text-emerald-300 ring-emerald-500/30 bg-emerald-500/10",
        tone === "warn" && "text-amber-700 dark:text-amber-300 ring-amber-500/30 bg-amber-500/10",
        tone === "neutral" && "muted ring-[rgb(var(--border))]",
      )}
    >
      {children}
    </span>
  );
}

function ViolationForm({
  draft, setDraft, types, floor, busy, error, onCancel, onSubmit, heading,
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
