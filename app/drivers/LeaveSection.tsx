"use client";

// Leave & absence — ONE reusable section rendered on BOTH the driver and staff
// detail modals. Shows the computed "on leave today" pill, lists recorded
// periods (type · range · note) with Edit/Delete, and an inline Add-leave form
// (leave-type picker with inline "add custom type", start/end dates, optional
// note). NARROW model: a manager records leave directly — no request/approve.
//
// "On leave today" is COMPUTED via lib/leave (isOnLeaveToday) — never a stored
// flag. The optional `warning` slot is for Posture-2 conflict notices the parent
// computes (e.g. driver holds a truck while on leave today); this section never
// mutates assignments.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { Btn } from "@/components/ui";
import { isOnLeaveToday, periodCoversToday, leaveDaysInYear, type LeavePeriod, type LeaveType } from "@/lib/leave";
import { formatDate } from "@/lib/utils";
import { addLeave, updateLeave, deleteLeave, addLeaveType } from "./actions";
import LookupSelect from "./LookupSelect";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// ISO date (YYYY-MM-DD) → local display, anchored at midnight so no TZ shift.
function fmtDate(iso: string): string {
  return formatDate(iso + "T00:00:00");
}
function fmtRange(start: string, end: string): string {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export default function LeaveSection({
  kind,
  personId,
  periods,
  leaveTypes,
  today,
  warning,
}: {
  kind: "driver" | "staff";
  personId: string;
  periods: LeavePeriod[];
  leaveTypes: LeaveType[];
  today: string;
  warning?: React.ReactNode;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LeavePeriod | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLeave = isOnLeaveToday(periods, kind, personId, today);
  // Current-year total (Riyadh local date, via the `today` the caller already
  // derived from todayKey() — never re-derived here with `new Date()`).
  const yearDays = leaveDaysInYear(periods, Number(today.slice(0, 4)));
  const typeLabel = (key: string) => leaveTypes.find((t) => t.key === key)?.label ?? key;
  const defaultType = leaveTypes.find((t) => t.is_default)?.key ?? leaveTypes[0]?.key ?? "";

  // Newest start first.
  const sorted = [...periods].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  function openNew() {
    setEditing(null);
    setError(null);
    setFormOpen(true);
  }
  function openEdit(p: LeavePeriod) {
    setEditing(p);
    setError(null);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Client mirror of the server validation (server is the real gate).
    const start = String(fd.get("start_date") ?? "");
    const end = String(fd.get("end_date") ?? "");
    if (!start || !end) {
      setError("Pick start and end dates.");
      return;
    }
    if (end < start) {
      setError("End date must be on or after the start date.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = editing ? await updateLeave(editing.id, fd) : await addLeave(fd);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    closeForm();
    router.refresh();
  }

  async function onDelete(p: LeavePeriod) {
    if (!confirm(`Delete this ${typeLabel(p.leave_type)} period?`)) return;
    const res = await deleteLeave(p.id);
    if (res.error) {
      alert(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-sm">Leave &amp; absence</h4>
          {onLeave ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
              On leave today
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Available
            </span>
          )}
          <span className="text-xs muted">{yearDays} day{yearDays === 1 ? "" : "s"} this year</span>
        </div>
        {!formOpen && (
          <Btn variant="outline" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add leave
          </Btn>
        )}
      </div>

      {warning && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {warning}
        </div>
      )}

      {/* Recorded periods. */}
      {sorted.length === 0 ? (
        <p className="muted text-xs py-2">No leave recorded.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((p) => {
            const covers = periodCoversToday(p, today);
            return (
              <li
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-app px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className="truncate">{typeLabel(p.leave_type)}</span>
                    {covers && (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        now
                      </span>
                    )}
                  </div>
                  <div className="text-xs muted">{fmtRange(p.start_date, p.end_date)}</div>
                  {p.note && <div className="text-xs muted truncate">{p.note}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 muted"
                    aria-label="Edit leave"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p)}
                    className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                    aria-label="Delete leave"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add / Edit inline form. */}
      {formOpen && (
        <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-app pt-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="person_id" value={personId} />
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-sm font-medium">{editing ? "Edit leave period" : "Record leave"}</span>
            <button type="button" onClick={closeForm} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted">Leave type</span>
            <LookupSelect
              name="leave_type"
              items={leaveTypes.map((t) => ({ key: t.key, label: t.label }))}
              defaultKey={editing?.leave_type ?? defaultType}
              onAdd={addLeaveType}
              addLabel="+ Add custom type…"
              newPlaceholder="New leave type"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Start date</span>
            <input name="start_date" type="date" required defaultValue={editing?.start_date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">End date</span>
            <input name="end_date" type="date" required defaultValue={editing?.end_date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted">Note (optional)</span>
            <input name="note" defaultValue={editing?.note ?? ""} placeholder="e.g. annual leave, medical" className={INPUT} style={INPUT_STYLE} />
          </label>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

          <div className="flex justify-end gap-2 sm:col-span-2">
            <Btn variant="outline" onClick={closeForm}>Cancel</Btn>
            <Btn type="submit" variant="primary">{saving ? "Saving…" : editing ? "Save" : "Add leave"}</Btn>
          </div>
        </form>
      )}
    </div>
  );
}
