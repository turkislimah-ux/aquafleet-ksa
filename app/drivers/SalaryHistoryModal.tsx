"use client";

// Salary history — view the effective-dated rows for one person, and record a
// change with its own effective date.
//
// ===========================================================================
// WHAT THIS SCREEN IS FOR, AND WHAT IT DELIBERATELY IS NOT
// ===========================================================================
// The triggers on drivers/staff already record a raise entered TODAY, so the
// everyday case needs no UI at all. What they cannot do is BACK-DATE — "he has
// been on 5,000 since March" is a statement about the past, and the only way to
// record it is a row carrying its own effective_from.
//
// So this screen has two jobs: SHOW the timeline every payroll figure now
// resolves through, and record a DATED change. It is not a salary editor — the
// current salary stays on the person's own form, which is the single writer of
// drivers.salary_sar / staff.monthly_salary_sar.
//
// ===========================================================================
// THE HONESTY REQUIREMENT: A BACK-DATED CHANGE RE-COSTS REPORTED MONTHS
// ===========================================================================
// Effective-dated salary means a row dated in the past legitimately changes
// what past months cost — that is the entire point of recording it. But it also
// means previously REPORTED payroll and profit move, and that must never be a
// surprise discovered afterwards.
//
// So the form computes the impact from the date as it is typed and states it
// in plain words BEFORE the save: which month the re-costing starts from, and
// whether that reaches months already reported. The warning is not a
// confirmation dialog to click past — it is the sentence that makes the
// decision an informed one.
//
// ===========================================================================
// BASELINES ARE READ-ONLY, AND THAT IS ENFORCED SERVER-SIDE TOO
// ===========================================================================
// 0126 dates each person's opening row at their employment floor precisely so
// nothing can rewrite what pre-history months resolve to — that WAS the 0125
// defect. Here a baseline renders with a badge and no delete control, and
// removeSalaryChange refuses it on the server as well. The UI is the courtesy;
// the action is the guard.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Trash2, Lock, TriangleAlert } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, type Lang } from "@/lib/i18n";
import { formatSar, todayKey } from "@/lib/utils";
import {
  fetchSalaryHistory,
  addSalaryChange,
  removeSalaryChange,
  type SalaryHistoryRow,
  type SalarySubject,
} from "./actions";
import ScrollLock from "@/components/ScrollLock";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Indexing a const tuple types the element as the union of its twelve members,
// so `common.monthShort.${key}` is twelve real TKeys rather than `string`. Same
// device as app/fleet/FleetClient.tsx's own monthLabel.
//
// The leaves moved from `drivers.months` to `common.monthShort` in Phase 3
// Batch 9 (unchanged values) once app/trips turned out to hold three more
// hardcoded copies of the same array.
const MONTH_KEYS = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;

function monthName(m: string, lang: Lang): string | null {
  const key = MONTH_KEYS[Number(m) - 1];
  return key ? t(`common.monthShort.${key}`, lang) : null;
}

/** "2026-03-14" → "Mar 2026". Pure string work — no Date, no timezone. */
function monthLabel(iso: string, lang: Lang): string {
  const [y, m] = iso.split("-");
  return `${monthName(m, lang) ?? m} ${y}`;
}
function dateLabel(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-");
  return `${d} ${monthName(m, lang) ?? m} ${y}`;
}

export default function SalaryHistoryModal({
  open,
  onClose,
  subject,
  personName,
  currentSalary,
}: {
  open: boolean;
  onClose: () => void;
  subject: SalarySubject | null;
  personName: string;
  /** The person's current salary — what the edit form owns. Shown for contrast. */
  currentSalary: number | null;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<SalaryHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey());
  const [note, setNote] = useState("");

  const subjectKey = subject ? ("driverId" in subject ? subject.driverId : subject.staffId) : null;

  useEffect(() => {
    if (!open || !subject) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSalaryHistory(subject).then((res) => {
      if (cancelled) return;
      // A FAILED READ MUST NOT RENDER AS "no history" — an empty timeline here
      // would read as "this person has never had a salary recorded", which is a
      // very different claim from "we could not load it" (CLAUDE.md section 7).
      if (res.error) setError(res.error);
      else setRows(res.rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectKey]);

  function resetForm() {
    setAmount("");
    setEffectiveFrom(todayKey());
    setNote("");
    setAdding(false);
  }

  /**
   * What a change dated `effectiveFrom` actually does to reported figures.
   *
   * Deliberately computed from the DATE ALONE rather than by asking the server
   * what would move: the point is to state the rule the reader can check, not to
   * preview a number they would have to trust.
   *
   * Carries the ISO month, NOT its label: a display string composed inside a
   * memo keyed on data alone would keep the old language after a lang flip.
   * The label is built at render, where `lang` is in scope.
   */
  const impact = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return null;
    const today = todayKey();
    const startsThisMonthOrLater = effectiveFrom.slice(0, 7) >= today.slice(0, 7);
    return {
      backdated: effectiveFrom < today,
      startsThisMonthOrLater,
      fromMonthIso: effectiveFrom,
    };
  }, [effectiveFrom]);

  async function submit() {
    if (!subject) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError(t("drivers.salary.errSalary", lang));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await addSalaryChange(subject, effectiveFrom, value, note);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    const refreshed = await fetchSalaryHistory(subject);
    if (!refreshed.error) setRows(refreshed.rows);
    resetForm();
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm(t("drivers.salary.confirmRemove", lang))) return;
    setSaving(true);
    setError(null);
    const res = await removeSalaryChange(id);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (subject) {
      const refreshed = await fetchSalaryHistory(subject);
      if (!refreshed.error) setRows(refreshed.rows);
    }
    router.refresh();
  }

  if (!open || !subject) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,.45)" }}>
      <ScrollLock />
      <div className="card w-full max-w-[760px] max-h-[88vh] overflow-auto p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="text-lg font-semibold">{t("drivers.salary.title", lang)}</h3>
            <p className="text-sm muted">{personName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label={t("drivers.close", lang)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs muted mb-4">
          {t("drivers.salary.introBefore", lang)}
          {currentSalary != null ? <> — <span className="font-medium" dir="ltr">{formatSar(currentSalary)}</span> — </> : " "}
          {t("drivers.salary.introMid", lang)} <em>{t("drivers.salary.introWhen", lang)}</em>{" "}
          {t("drivers.salary.introAfter", lang)}
        </p>

        {error && (
          <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">{error}</p>
        )}

        {loading ? (
          <p className="text-sm muted py-6 text-center">{t("common.loading", lang)}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>{t("drivers.salary.thEffective", lang)}</TH>
                <TH>{t("drivers.salary.thSalary", lang)}</TH>
                <TH>{t("common.note", lang)}</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {t("drivers.salary.none", lang)}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <TD className="tabular-nums">{dateLabel(r.effective_from, lang)}</TD>
                  {/* Money is `en-US`-formatted in both languages, so it is
                      direction-isolated on an inner span — never on the cell,
                      where `text-align: start` would resolve against it. */}
                  <TD className="tabular-nums font-medium"><span dir="ltr">{formatSar(r.salary_sar)}</span></TD>
                  <TD className="text-xs muted">
                    {r.is_baseline ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="h-3 w-3" /> {t("drivers.salary.baseline", lang)}
                      </span>
                    ) : (
                      r.note ?? "—"
                    )}
                  </TD>
                  <TD className="text-end">
                    {/* No control at all on a baseline, rather than a disabled
                        one: there is no circumstance in which removing it is
                        the right action, so offering it greyed out would only
                        invite the question. */}
                    {!r.is_baseline && (
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        disabled={saving}
                        className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50"
                        title={t("drivers.salary.removeChange", lang)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {!adding ? (
          <div className="mt-4">
            <Btn variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("drivers.salary.recordChange", lang)}
            </Btn>
          </div>
        ) : (
          <div className="mt-4 card p-3">
            <h4 className="font-semibold text-sm mb-3">{t("drivers.salary.recordChange", lang)}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("drivers.salary.fMonthly", lang)}</span>
                <input
                  type="number" step="0.01" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={INPUT} style={INPUT_STYLE} placeholder="0.00"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("drivers.salary.fEffective", lang)}</span>
                <input
                  type="date" value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className={INPUT} style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("common.note", lang)}</span>
                <input
                  value={note} onChange={(e) => setNote(e.target.value)}
                  className={INPUT} style={INPUT_STYLE} placeholder={t("drivers.salary.phOptional", lang)}
                />
              </label>
            </div>

            {/* THE HONESTY BLOCK. Stated before the save, from the date alone,
                so a back-dated entry can never quietly move a reported month. */}
            {impact && (
              <div
                className={`mt-3 rounded-lg p-3 text-sm flex gap-2 ${
                  impact.backdated
                    ? "text-amber-700 dark:text-amber-300"
                    : "muted"
                }`}
                style={
                  impact.backdated
                    ? { background: "rgba(245,158,11,.10)" }
                    : { background: "rgba(0,0,0,.03)" }
                }
              >
                {impact.backdated && <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>
                  {impact.backdated ? (
                    <>
                      <strong>{t("drivers.salary.backdatedStrong", lang)}</strong>{" "}
                      {t("drivers.salary.backdatedBefore", lang)}{" "}
                      <strong>{monthLabel(impact.fromMonthIso, lang)}</strong>{" "}
                      {t("drivers.salary.backdatedAfter", lang)}
                    </>
                  ) : (
                    <>
                      {t("drivers.salary.forwardBefore", lang)}{" "}
                      <strong>{monthLabel(impact.fromMonthIso, lang)}</strong>{" "}
                      {t("drivers.salary.forwardAfter", lang)}
                    </>
                  )}
                </span>
              </div>
            )}

            <p className="text-xs muted mt-2">
              {t("drivers.salary.payslipsNote", lang)}
            </p>

            <div className="flex justify-end gap-2 mt-3">
              <Btn variant="outline" onClick={resetForm}>{t("common.cancel", lang)}</Btn>
              <Btn onClick={submit} disabled={saving || amount === ""}>
                {saving ? t("common.saving", lang) : t("drivers.salary.saveChange", lang)}
              </Btn>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Btn variant="outline" onClick={onClose}>{t("drivers.close", lang)}</Btn>
        </div>
      </div>
    </div>
  );
}
