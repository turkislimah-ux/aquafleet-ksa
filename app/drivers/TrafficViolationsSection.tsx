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
//
// THE NOTICE PHOTO (0178) IS SUBORDINATE, AND THE LAYOUT SAYS SO. It is the
// last field in the form and a small chip on the row — never a column of its
// own. A photo column would be empty on most rows and would sit at the same
// visual weight as the amount, which is the one thing on this card that
// actually decides money. The photo is evidence a human occasionally opens; it
// is not a fact about the fine.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ImageIcon, Lock, Pencil, ShieldAlert, X } from "lucide-react";
import { Btn, Table, TD, TH } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural } from "@/lib/i18n";
import { cn, formatSar, formatSarExact } from "@/lib/utils";
import {
  monthStartKey,
  violationTypeLabel,
  type DriverViolationView,
  type OutstandingCell,
  type ViolationType,
} from "@/lib/violations";
// THE EDITOR MOVED OUT when the payslip preview needed to edit a fine too.
// This screen keeps the list, the photo viewer and the void flow; the form,
// its type picker and its photo control are shared from one place so the two
// surfaces cannot drift apart. See app/drivers/ViolationForm.tsx.
import {
  INPUT,
  INPUT_STYLE,
  ViolationForm,
  applyPhotoChanges,
  draftToForm,
  emptyDraft,
  usePhotoDraft,
  type Draft,
  type PhotoState,
} from "./ViolationForm";
// The two image actions are NOT imported here any more — applyPhotoChanges is
// the only caller of either, on both surfaces.
import {
  addDriverViolation,
  getDriverViolationImageUrl,
  updateDriverViolation,
  voidDriverViolation,
} from "./actions";

// How many rows the list shows. The spec is the three most recent; anything
// older is history and belongs on the payslip statement, which is scoped to a
// month and can show the month's full set.
const SHOW = 3;

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

  // ---- THE NOTICE PHOTO ---------------------------------------------------
  // Held apart from `draft` on purpose: a Draft is the row's typed fields and
  // goes to the server as FormData in one call. The photo is a second,
  // best-effort call that must not be able to fail the first one, and modelling
  // it as another Draft key would invite exactly that coupling.
  //
  // The state machine itself is shared with the payslip surface — see
  // usePhotoDraft in ViolationForm.tsx. `photo.error` is the FILE-VALIDATION
  // message, and it is the only photo message that belongs under the control.
  const photo = usePhotoDraft();

  // THREE MESSAGES, THREE MEANINGS, AND THEY MUST NOT SHARE A CHANNEL.
  //
  //   error      (rose)  — nothing was saved. The form is still open.
  //   photoError (rose)  — a photo would not OPEN. Nothing was being saved.
  //   notice     (amber) — the fine SAVED and only its attachment did not.
  //
  // The read failure used to land in `notice`, so failing to open a photo
  // printed an amber box whose entire idiom says a save half-succeeded. Same
  // names and same tones as the payslip surface now.
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The open viewer: one at a time, holding a signed URL minted seconds ago.
  const [viewing, setViewing] = useState<{ id: string; url: string } | null>(null);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);

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
    // Clears the picked file, the pending removal and the validation message,
    // and remounts the file input. Closing a form cancels a photo change too.
    photo.reset();
    setPhotoError(null);
  }

  function openAdd() {
    resetForms();
    setNotice(null);
    setDraft(emptyDraft(activeTypes[0]?.id ?? "", today));
    setAdding(true);
  }

  function openEdit(v: DriverViolationView) {
    resetForms();
    setNotice(null);
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

  /** The row open in the form, when editing — the photo control needs it. */
  const editingRow = editingId ? violations.find((v) => v.id === editingId) ?? null : null;

  // THE HOOK'S HALF PLUS THIS SCREEN'S HALF. usePhotoDraft owns the draft state
  // machine because it is identical on both surfaces; `hasExisting`, `onView`
  // and `viewBusy` are NOT in it because they are not — this screen opens the
  // photo into a panel below, the payslip opens it into a tab. Annotated rather
  // than inferred so a missing key is an error here, not inside the form.
  const photoProp: PhotoState = {
    file: photo.file,
    cleared: photo.cleared,
    error: photo.error,
    inputKey: photo.inputKey,
    onPick: photo.pick,
    onClear: photo.clear,
    onUndoClear: photo.undoClear,
    hasExisting: editingRow?.image_path != null,
    onView: () => { if (editingId) void viewPhoto(editingId); },
    viewBusy: photoBusyId !== null && photoBusyId === editingId,
  };

  /**
   * SAVE ORDER: the violation first, its photo second, and the photo can never
   * fail the violation.
   *
   * On ADD the order is forced — the storage key embeds the violation's id
   * (0178), so the row must exist before its photo can be named. On EDIT it is
   * a choice, and the same one: an operator who fixed an amount and also
   * swapped the photo must not lose the amount because Storage hiccuped. A
   * photo failure comes back as a NOTICE next to a saved row, with the sentence
   * saying "saved" first.
   *
   * THE ADD BRANCH IS THIS SCREEN'S ALONE — the payslip edits existing fines
   * only. Everything after the fine is written is not: applyPhotoChanges is the
   * shared tail, so both surfaces order the photo work identically.
   */
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const fd = draftToForm(driverId, draft);
    let violationId: string | null = editingId;

    if (editingId) {
      const res = await updateDriverViolation(editingId, fd);
      if (res.error) {
        setBusy(false);
        setError(res.error);
        return;
      }
    } else {
      const res = await addDriverViolation(fd);
      if (res.error || !res.id) {
        setBusy(false);
        setError(res.error ?? t("drivers.viol.addNoId", lang));
        return;
      }
      violationId = res.id;
    }

    // ---- past this line the violation IS saved; nothing below may undo it ---
    // `cleared` only means anything on an EDIT: a row created a moment ago has
    // no stored photo to drop, and asking the server to remove one would be a
    // call whose only possible answer is "there was none".
    const warn = violationId
      ? await applyPhotoChanges(
        driverId,
        violationId,
        { file: photo.file, cleared: photo.cleared && editingId != null },
        lang,
      )
      : null;

    setBusy(false);
    resetForms();
    setNotice(warn);
    setViewing(null);
    router.refresh();
  }

  /**
   * Mint a signed URL and show it. Fetched per click rather than signed at page
   * load: a 300s URL on a card that stays open behind a modal is a broken image
   * by the time anybody clicks it.
   *
   * A FAILURE HERE IS ROSE, NOT AMBER. Nothing was being saved, so the amber
   * "the fine saved and the photo did not" panel would be describing an event
   * that did not happen.
   */
  async function viewPhoto(id: string) {
    if (photoBusyId) return;
    if (viewing?.id === id) {
      setViewing(null);
      return;
    }
    setPhotoBusyId(id);
    setPhotoError(null);
    const r = await getDriverViolationImageUrl(id);
    setPhotoBusyId(null);
    if (r.error || !r.url) {
      setPhotoError(r.error ?? t("drivers.viol.photoUnavailable", lang));
      return;
    }
    setViewing({ id, url: r.url });
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
          photo={photoProp}
        />
      )}

      {/* A PHOTO WOULD NOT OPEN. Rose, and deliberately NOT the amber panel
          below it: nothing was being saved, so "the fine saved and the photo
          did not" would be narrating an event that never happened. Same
          two-panel split, same two tones, as the payslip surface. */}
      {photoError && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[12px] leading-relaxed text-rose-700 dark:text-rose-300">
          <span className="flex-1">{photoError}</span>
          <button
            type="button"
            onClick={() => setPhotoError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-rose-500/10"
            aria-label={t("common.close", lang)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* THE VIOLATION SAVED AND THE PHOTO DID NOT. Amber, not rose: nothing
          was lost and nothing needs redoing except the attachment. This panel
          is for SAVE warnings only — read failures land in the rose one above. */}
      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/10"
            aria-label={t("common.close", lang)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* THE VIEWER. Inline in the card rather than a window: the operator is
          comparing this photo against the row two lines below it, and a new tab
          puts the thing being compared on a different screen. The full-size
          link is a real anchor on an already-fetched URL, so it survives a
          popup blocker that would have eaten a post-await window.open. */}
      {viewing && (
        <div className="mb-3 rounded-lg border border-app p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] muted">{t("drivers.viol.fPhoto", lang)}</span>
            <div className="flex items-center gap-2">
              <a
                href={viewing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] underline muted hover:text-[rgb(var(--fg))]"
              >
                {t("drivers.viol.photoOpenFull", lang)}
              </a>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="rounded p-1 muted hover:bg-black/5 dark:hover:bg-white/5"
                aria-label={t("common.close", lang)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL
              from a private bucket, expiring in 300s; next/image would want a
              configured remote pattern for a host that changes per project and
              would cache a URL built to expire. */}
          <img
            src={viewing.url}
            alt={t("drivers.viol.fPhoto", lang)}
            className="max-h-64 w-full rounded-md object-contain"
            style={{ background: "rgb(var(--bg))" }}
          />
        </div>
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
                      {/* PRESENT ONLY WHEN THERE IS ONE. An "add a photo"
                          affordance on every row would advertise an optional
                          field on the screen whose job is what is owed; adding
                          one happens in the form, where the operator is already
                          looking at the fine. Locked rows keep this — reading
                          the evidence is never the half that gets restricted. */}
                      {v.image_path && (
                        <button
                          type="button"
                          onClick={() => void viewPhoto(v.id)}
                          disabled={photoBusyId === v.id}
                          title={t("drivers.viol.photoView", lang)}
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-colors",
                            "ring-[rgb(var(--border))] muted hover:text-[rgb(var(--fg))] hover:bg-black/5 dark:hover:bg-white/5",
                            viewing?.id === v.id && "text-[rgb(var(--fg))] bg-black/5 dark:bg-white/5",
                            photoBusyId === v.id && "opacity-60 pointer-events-none",
                          )}
                        >
                          <ImageIcon className="h-3 w-3" />
                          {photoBusyId === v.id ? t("drivers.viol.photoLoading", lang) : t("drivers.viol.photoChip", lang)}
                        </button>
                      )}
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
          <p className="text-[12px] muted leading-relaxed">
            {t("drivers.viol.voidHint", lang)}
            {/* SAID ONLY WHEN THERE IS A PHOTO. The photo surviving a void is
                deliberate (0178) and matches invoice and exit-permit proofs —
                but it is a surprise worth naming, and naming it on rows with no
                photo would just be noise. */}
            {violations.find((v) => v.id === voidingId)?.image_path && (
              <> {t("drivers.viol.photoKeptOnVoid", lang)}</>
            )}
          </p>
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

