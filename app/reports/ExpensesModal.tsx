"use client";

// Reports — manual expenses: list, add, edit, delete.
//
// This is the ONE place on the Reports page that writes. Everything else reads
// the semantic layer. The separation is deliberate and worth keeping: this
// modal edits SOURCE ROWS, while every expense FIGURE on the page still comes
// from v_expenses_monthly / v_expenses_by_category. Editing records and
// reporting totals are different jobs and stay different code paths — if this
// file ever starts summing rows to show a total, the contract has been broken.
//
// Category is a free-text combo offering what has been used before, not a
// fixed list. Same call as parts.category: this table exists precisely for the
// costs the app does not model, so a closed vocabulary would be wrong the
// first time someone needs a category nobody predicted.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Pencil, Trash2, Check, AlertTriangle } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, type TKey } from "@/lib/i18n";
import { createExpense, updateExpense, deleteExpense, type ExpenseInput } from "./actions";
import ScrollLock from "@/components/ScrollLock";

export type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  amount_sar: number;
  note: string | null;
  entered_by: string | null;
};

type Draft = ExpenseInput & { amountText: string };

const EMPTY = (today: string): Draft => ({
  expense_date: today,
  category: "",
  amount_sar: 0,
  amountText: "",
  note: null,
});

export default function ExpensesModal({
  open, onClose, expenses, today, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  expenses: ExpenseRow[];
  /** Riyadh-local today, passed in rather than computed — avoids UTC skew. */
  today: string;
  onChanged: () => void;
}) {
  const { lang } = useApp();
  const tt = (key: TKey) => t(key, lang);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [draft, setDraft] = useState<Draft>(() => EMPTY(today));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Categories already in use, for the combo. Reading distinct values off the
  // rows we already have beats a second round trip for a datalist.
  const knownCategories = useMemo(
    () => [...new Set(expenses.map((e) => e.category))].sort((a, b) => a.localeCompare(b)),
    [expenses],
  );

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date)),
    [expenses],
  );

  function reset() {
    setDraft(EMPTY(today));
    setEditingId(null);
    setError(null);
  }

  function startEdit(row: ExpenseRow) {
    setEditingId(row.id);
    setError(null);
    setDraft({
      expense_date: row.expense_date,
      category: row.category,
      amount_sar: row.amount_sar,
      amountText: String(row.amount_sar),
      note: row.note,
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const input: ExpenseInput = {
      expense_date: draft.expense_date,
      category: draft.category,
      // Parsed here rather than held as a number in state, so a half-typed
      // "12." does not become NaN mid-keystroke and blank the field.
      amount_sar: Number(draft.amountText),
      note: draft.note,
    };
    const res = editingId
      ? await updateExpense(editingId, input)
      : await createExpense(input);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    reset();
    onChanged();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const res = await deleteExpense(id);
    setBusy(false);
    setConfirmId(null);
    if (!res.ok) { setError(res.error); return; }
    if (editingId === id) reset();
    onChanged();
  }

  if (!open || !mounted) return null;

  const canSubmit =
    !busy &&
    draft.expense_date !== "" &&
    draft.category.trim() !== "" &&
    Number(draft.amountText) > 0;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}>
      <ScrollLock />
      <div className="card w-full max-w-[860px] max-h-[88vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            {/* The same two words as the metric whose SOURCE ROWS this edits,
                so it reads that key rather than minting a second copy. */}
            <h2 className="font-semibold">{tt("reports.metric.otherExpenses")}</h2>
            <p className="text-[11px] muted">
              {tt("reports.expenses.intro")}
            </p>
          </div>
          <button onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- Entry form ---------------------------------------------- */}
        <div className="p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="text-sm">
              <span className="muted text-xs block mb-1">{tt("reports.th.date")}</span>
              <input
                type="date"
                value={draft.expense_date}
                onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              />
            </label>

            <label className="text-sm">
              <span className="muted text-xs block mb-1">{tt("reports.th.category")}</span>
              <input
                list="expense-categories"
                value={draft.category}
                placeholder={tt("reports.expenses.categoryExample")}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              />
              <datalist id="expense-categories">
                {knownCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>

            <label className="text-sm">
              <span className="muted text-xs block mb-1">{tt("reports.expenses.amountSar")}</span>
              <input
                inputMode="decimal"
                value={draft.amountText}
                placeholder="0"
                onChange={(e) => setDraft({ ...draft, amountText: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              />
            </label>

            <label className="text-sm">
              <span className="muted text-xs block mb-1">{tt("reports.expenses.noteOptional")}</span>
              <input
                value={draft.note ?? ""}
                onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              />
            </label>
          </div>

          {/* `error` is the SERVER ACTION's own message, not a dictionary
              string. Server strings are out of scope for this batch, and
              wrapping one in t() would need a key per failure the action can
              report — which is a change to actions.ts, not to this file. */}
          {error && (
            <div className="mt-3 rounded-lg px-3 py-2 text-sm flex gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Btn variant="primary" onClick={submit} disabled={!canSubmit}>
              {editingId
                ? <><Check className="h-4 w-4" />{tt("reports.expenses.saveChanges")}</>
                : <><Plus className="h-4 w-4" />{tt("reports.expenses.addExpense")}</>}
            </Btn>
            {editingId && <Btn variant="outline" onClick={reset} disabled={busy}>{tt("common.cancel")}</Btn>}
          </div>
        </div>

        {/* ---- List ---------------------------------------------------- */}
        <div className="p-4">
          {/* The `&amp;` in the empty-state sentence was JSX escaping, not
              content — it has always rendered a literal "P&L", which is what
              the dictionary value holds. */}
          {sorted.length === 0 ? (
            <div className="py-10 text-center text-sm muted">
              {tt("reports.expenses.empty")}
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>{tt("reports.th.date")}</TH>
                  <TH>{tt("reports.th.category")}</TH>
                  <TH>{tt("common.note")}</TH>
                  <TH>{tt("reports.th.enteredBy")}</TH>
                  <TH className="text-end">{tt("reports.th.amount")}</TH>
                  <TH className="text-end">{tt("common.actions")}</TH>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.id} className={cn(editingId === row.id && "bg-brand-500/5")}>
                    <TD>{row.expense_date}</TD>
                    <TD>{row.category}</TD>
                    <TD className="muted">{row.note ?? "—"}</TD>
                    <TD className="muted text-xs">{row.entered_by ?? "—"}</TD>
                    <TD className="text-end tabular-nums">{formatSar(row.amount_sar)}</TD>
                    <TD className="text-end">
                      {confirmId === row.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-xs muted">{tt("reports.expenses.confirmDelete")}</span>
                          <button onClick={() => remove(row.id)} disabled={busy}
                            className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline">
                            {tt("reports.expenses.yes")}
                          </button>
                          <button onClick={() => setConfirmId(null)}
                            className="text-xs muted hover:underline">{tt("reports.expenses.no")}</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <button onClick={() => startEdit(row)} title={tt("common.edit")}
                            className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setConfirmId(row.id)} title={tt("common.delete")}
                            className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <div className="flex justify-end p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={onClose}>{tt("reports.close")}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
