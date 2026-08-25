"use client";

// Outsourced Job detail. Mirrors WorkOrderDetailModal's own shape (header
// actor box / info grid / tasks checklist / Dispatch-Complete footer) where
// the concepts overlap, but the money section is entirely different:
// MULTIPLE workshop_payments (not a single cost figure), each tied to a
// SPECIFIC repairer, VAT-inclusive, external — rendered in its OWN card,
// never summed with any in-house/Inventory cost anywhere on this screen.
//
// ESTIMATED FINISH — soft target, DERIVED red-when-exceeded at display
// time here (isOverdue below), never a stored status. "Dispatch" is the
// button label; the RPC still writes status='in_progress'.
//
// WORKSHOP PAYMENT REPAIRER PICKER — Turki's explicit rule: only offer
// repairers ALREADY ASSIGNED to this job (jobRepairers prop), not the full
// repairers catalog — you can't bill for a shop that was never on the job.
//
// WORKSHOP PAYMENTS layout — an INPUT card (always visible while the job
// isn't completed, doubles as add/edit) sits ABOVE a live-reflecting
// TABLE card — Phase-4 fix: these are now two visually separate bordered
// cards (were merged into one box before), and the "Workshop Payments"
// heading itself sits OUTSIDE both, plain/standalone with a border-t
// separator above it, not boxed. Same form drives both add and edit —
// editingPaymentId set = edit mode. Discount + Note share one row (note
// input shrinks to make room) instead of note being its own full-width
// row. "Actual Total" is a <tfoot> row directly under the table's own
// Grand Total column — same column, one row down — with the Files/
// Actions columns left blank beside it, so it never reads as sitting
// next to the edit/delete icons.
//
// Note box sits beside Work Performed, same 2-column layout
// WorkOrderDetailModal's own Work Performed | Mechanic Notes pair already
// uses — wired to save_outsourced_job_notes (0072).

import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, CheckSquare, Square, Play, Check, Pencil, FileText, Trash2, Upload } from "lucide-react";
import { t, arText } from "@/lib/i18n";
import { cn, formatDate, formatSar, todayKey } from "@/lib/utils";
import { Btn } from "@/components/ui";
import MtStatusPill, { type MtPillKind } from "./MtStatusPill";
import { formatSarVat } from "@/lib/inventory-vat";
import { computeWorkshopPaymentTotals } from "@/lib/outsourced-vat";
import type {
  Truck,
  Staff,
  Repairer,
  RepairerType,
  OutsourcedJob,
  OutsourcedJobTask,
  WorkshopPayment,
  WorkshopPaymentFile,
} from "@/lib/db-types";
import {
  dispatchOutsourcedJob,
  completeOutsourcedJob,
  deleteOutsourcedJob,
  toggleOutsourcedJobTask,
  saveOutsourcedJobNotes,
  addWorkshopPayment,
  updateWorkshopPayment,
  deleteWorkshopPayment,
  uploadWorkshopPaymentFile,
  removeWorkshopPaymentFile,
  getWorkshopPaymentFileSignedUrls,
} from "./osActions";
import ScrollLock from "@/components/ScrollLock";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

function ModalOverlay({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <ScrollLock />
      {children}
    </div>,
    document.body,
  );
}

function isOverdue(job: OutsourcedJob): boolean {
  return job.status !== "completed" && job.estimated_finish < todayKey();
}

function osKind(status: OutsourcedJob["status"]): MtPillKind {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "scheduled";
}

const emptyPaymentForm = {
  repairerId: "",
  invoiceNumber: "",
  invoiceDate: todayKey(),
  subtotal: 0,
  discount: 0,
  note: "",
};

export default function OutsourcedJobDetailModal({
  lang,
  job,
  tasks,
  jobRepairers,
  repairerTypes,
  payments,
  paymentFiles,
  truck,
  mechanic,
  mechanicOnLeave,
  onClose,
  onEdit,
}: {
  lang: "en" | "ar";
  job: OutsourcedJob;
  tasks: OutsourcedJobTask[];
  jobRepairers: Repairer[];
  repairerTypes: RepairerType[];
  payments: WorkshopPayment[];
  paymentFiles: WorkshopPaymentFile[];
  truck: Truck | null;
  mechanic: Staff | null;
  // Polish item 3 (on-leave-today, UI display only) — whether `mechanic`
  // above is on leave today (lib/leave.ts, resolved by the caller).
  mechanicOnLeave: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const editable = job.status !== "completed";
  // Task checkboxes: checkable ONLY while in_progress (0072's own RPC
  // guard blocks both 'scheduled' and 'completed') — found a real gap
  // while building in-house's parity for this same rule (0078): this UI
  // was only ever disabling on `editable` (completed-only), never actually
  // greying out while scheduled, even though the RPC already rejected it.
  // Fixed alongside — separate from `editable`, which still gates notes/
  // payments/edit.
  const tasksEditable = job.status === "in_progress";
  const overdue = isOverdue(job);
  const allTasksDone = tasks.length === 0 || tasks.every((tk) => tk.done);
  const doneCount = tasks.filter((tk) => tk.done).length;
  const repairerTypesById = new Map(repairerTypes.map((rt) => [rt.id, rt]));
  const jobRepairersById = new Map(jobRepairers.map((r) => [r.id, r]));

  // Actual cost — DERIVED, summed at display time, NEVER stored on the job.
  const actualCost = payments.reduce((s, p) => s + p.grand_total_sar, 0);

  const [error, setError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  // Polish P2 item 1 — delete-block message (workshop payments exist),
  // rendered at the bottom of the Workshop Payments section, separate
  // from the generic `error` banner above.
  const [deleteBlockMessage, setDeleteBlockMessage] = useState<string | null>(null);

  async function onToggleTask(task: OutsourcedJobTask) {
    if (!tasksEditable || busyTaskId) return;
    setBusyTaskId(task.id);
    setError(null);
    const res = await toggleOutsourcedJobTask(task.id, !task.done);
    setBusyTaskId(null);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  async function onDispatch() {
    setLifecycleBusy(true);
    setError(null);
    const res = await dispatchOutsourcedJob(job.id);
    setLifecycleBusy(false);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  async function onComplete() {
    setLifecycleBusy(true);
    setError(null);
    const res = await completeOutsourcedJob(job.id);
    setLifecycleBusy(false);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  // Polish P2 item 1 — permanent delete. Server-side gate
  // (delete_outsourced_job, 0081) is the real enforcement: status must be
  // 'scheduled' AND zero workshop_payments. `deletable` mirrors the status
  // half so the button never shows once that's no longer true; the
  // payments-count half can only be discovered by actually calling the
  // RPC, so its block message renders separately, at the bottom of the
  // Workshop Payments section (Turki's exact placement ask) — not the
  // generic top-of-modal `error` banner every other lifecycle error uses.
  const deletable = job.status === "scheduled";
  async function onDelete() {
    if (!confirm(lang === "en"
      ? "Permanently delete this outsourced job? This cannot be undone."
      : "حذف هذا العمل الخارجي نهائياً؟ لا يمكن التراجع عن هذا الإجراء.")) return;
    setLifecycleBusy(true);
    setDeleteBlockMessage(null);
    const res = await deleteOutsourcedJob(job.id);
    setLifecycleBusy(false);
    if (res.error) {
      setDeleteBlockMessage(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  // ---- Notes (beside Work Performed) ----
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState(job.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  function startEditingNotes() {
    setDraftNotes(job.notes ?? "");
    setEditingNotes(true);
  }

  async function onSaveNotes() {
    setSavingNotes(true);
    setError(null);
    const res = await saveOutsourcedJobNotes(job.id, draftNotes);
    setSavingNotes(false);
    if (res.error) { setError(res.error); return; }
    setEditingNotes(false);
    router.refresh();
  }

  // ---- Payment form (add + edit share this) ----
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({ ...emptyPaymentForm, repairerId: jobRepairers[0]?.id ?? "" }));
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const preview = computeWorkshopPaymentTotals(form.subtotal || 0, form.discount || 0);
  const isPaymentEdit = !!editingPaymentId;

  function resetPaymentForm() {
    setEditingPaymentId(null);
    setForm({ ...emptyPaymentForm, repairerId: jobRepairers[0]?.id ?? "" });
    setPendingFile(null);
  }

  function startEditPayment(p: WorkshopPayment) {
    setEditingPaymentId(p.id);
    setForm({
      repairerId: p.repairer_id,
      invoiceNumber: p.invoice_number ?? "",
      invoiceDate: p.invoice_date ?? todayKey(),
      subtotal: p.subtotal_sar,
      discount: p.discount_sar,
      note: p.note ?? "",
    });
    setPendingFile(null);
  }

  async function savePayment() {
    if (!form.repairerId || !(form.subtotal > 0) || savingPayment) return;
    setSavingPayment(true);
    setError(null);

    const input = {
      outsourced_job_id: job.id,
      repairer_id: form.repairerId,
      invoice_number: form.invoiceNumber || null,
      invoice_date: form.invoiceDate || null,
      subtotal_sar: form.subtotal,
      discount_sar: form.discount,
      note: form.note || null,
    };

    const res = isPaymentEdit
      ? await updateWorkshopPayment(editingPaymentId!, input)
      : await addWorkshopPayment(input);

    if (res.error || !res.payment) {
      setSavingPayment(false);
      setError(res.error ?? "Could not save payment.");
      return;
    }
    if (pendingFile) {
      const fd = new FormData();
      fd.set("paymentId", res.payment.id);
      fd.set("file", pendingFile);
      const fileRes = await uploadWorkshopPaymentFile(fd);
      if (fileRes.error) {
        setSavingPayment(false);
        setError(fileRes.error);
        return;
      }
    }
    setSavingPayment(false);
    resetPaymentForm();
    router.refresh();
  }

  async function confirmDeletePayment(paymentId: string) {
    if (!window.confirm(t("mt.confirmDeletePayment", lang))) return;
    setDeletingPaymentId(paymentId);
    setError(null);
    const res = await deleteWorkshopPayment(paymentId);
    setDeletingPaymentId(null);
    if (res.error) { setError(res.error); return; }
    if (editingPaymentId === paymentId) resetPaymentForm();
    router.refresh();
  }

  async function openInvoiceFile(path: string) {
    const res = await getWorkshopPaymentFileSignedUrls([path]);
    const url = res.urls?.[path];
    if (url) window.open(url, "_blank");
  }

  async function onRemoveFile(fileId: string) {
    const res = await removeWorkshopPaymentFile(fileId);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  return (
    <ModalOverlay onClick={onClose}>
      <div className="card w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">{arText(job.title, job.title_ar, lang)}</h2>
            <div className="text-xs muted font-mono">{job.os_number}</div>
            {(job.created_by || job.started_by || job.completed_by) && (
              <div className="text-[11px] muted mt-0.5 flex flex-wrap gap-x-3">
                {job.created_by && <span>{t("mt.createdBy", lang)}: {job.created_by}</span>}
                {job.started_by && <span>{t("mt.startedBy", lang)}: {job.started_by}</span>}
                {job.completed_by && <span>{t("mt.completedBy", lang)}: {job.completed_by}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {editable && (
              <button onClick={onEdit} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5" title={t("mt.editOutsourcedJob", lang)}>
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {deletable && (
              <button
                onClick={onDelete}
                disabled={lifecycleBusy}
                className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                title={t("mt.delete", lang)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="muted mb-0.5">{t("common.truck", lang)}</div>
              <div className="font-medium">{truck ? `${truck.plate} · ${truck.model ?? ""}` : "—"}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.status", lang)}</div>
              <div>
                {overdue ? (
                  <MtStatusPill kind="overdue" label={t("mt.osOverdue", lang)} />
                ) : (
                  <MtStatusPill kind={osKind(job.status)} label={t(`status.${job.status}`, lang)} />
                )}
              </div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.type", lang)}</div>
              <div>{t(`status.${job.type}`, lang)}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.responsibleMechanic", lang)}</div>
              <div className={cn("flex flex-col items-start gap-0.5", mechanicOnLeave && "muted")}>
                <span>{mechanic ? arText(mechanic.name, mechanic.name_ar, lang) : "—"}</span>
                {mechanicOnLeave && <MtStatusPill kind="on_leave" label={t("status.leave", lang)} />}
              </div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.startDate", lang)}</div>
              <div>{formatDate(job.start_date)}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.estimatedFinish", lang)}</div>
              <div className={overdue ? "text-rose-600 font-semibold" : ""}>{formatDate(job.estimated_finish)}</div>
            </div>
          </div>

          <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
            <h3 className="text-sm font-semibold mb-2">{t("mt.repairers", lang)}</h3>
            {jobRepairers.length === 0 ? (
              <p className="text-xs muted">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {jobRepairers.map((r) => {
                  const rt = r.type ? repairerTypesById.get(r.type) : null;
                  return (
                    <span key={r.id} className="text-xs rounded-full px-2.5 py-1 border" style={INPUT_STYLE}>
                      {arText(r.name, r.name_ar, lang)}
                      {rt && <span className="muted"> · {arText(rt.label_en, rt.label_ar, lang)}</span>}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t("mt.workPerformed", lang)}</h3>
                <span className="text-xs muted">{doneCount} / {tasks.length}</span>
              </div>
              {tasks.length === 0 ? (
                <p className="text-xs muted">—</p>
              ) : (
                <div className="space-y-1.5">
                  {tasks.map((tk) => (
                    <button
                      key={tk.id}
                      type="button"
                      onClick={() => onToggleTask(tk)}
                      disabled={!tasksEditable || busyTaskId === tk.id}
                      title={!tasksEditable && editable ? "Dispatch this job before checking off tasks" : undefined}
                      className="flex items-center gap-2 text-sm w-full text-start disabled:cursor-default"
                    >
                      {tk.done ? <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" /> : <Square className="h-4 w-4 muted shrink-0" />}
                      <span className={cn(tk.done ? "line-through muted" : "")}>{arText(tk.description_en, tk.description_ar, lang)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t("mt.note", lang)}</h3>
                {editable && !editingNotes && (
                  <button onClick={startEditingNotes} className="text-xs text-brand-600 hover:underline">{t("mt.editNotes", lang)}</button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    rows={3}
                    className={cn(INPUT, "resize-none")}
                    style={INPUT_STYLE}
                  />
                  <div className="flex justify-end gap-2">
                    <Btn variant="outline" onClick={() => setEditingNotes(false)} disabled={savingNotes}>{t("common.cancel", lang)}</Btn>
                    <Btn variant="primary" onClick={onSaveNotes} disabled={savingNotes}>{savingNotes ? "…" : t("mt.saveNotes", lang)}</Btn>
                  </div>
                </div>
              ) : (
                <p className="text-sm muted">{job.notes || "—"}</p>
              )}
            </div>
          </div>

          {/* MONEY — own section, own total, never mixed with in-house/
              Inventory cost. Turki's Phase-4 fix: title is a plain
              standalone heading (not boxed) with a separator line above
              it; the input area and the payments table are now two
              visually SEPARATE cards, not one merged box. */}
          <div className="pt-2 border-t" style={{ borderColor: "rgb(var(--border))" }}>
            <h3 className="text-sm font-semibold pt-3">{t("mt.workshopPayments", lang)}</h3>
          </div>

          {/* Polish P2 item 1 — delete-block message, just below the
              Workshop Payments title (moved here from the section's
              bottom per Turki's follow-up), not the generic top-of-modal
              error banner. */}
          {deleteBlockMessage && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
              {deleteBlockMessage}
            </div>
          )}

          {editable && (
            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium muted">{isPaymentEdit ? t("mt.edit", lang) : t("mt.addPayment", lang)}</span>
                {isPaymentEdit && (
                  <button onClick={resetPaymentForm} className="text-xs text-brand-600 hover:underline">{t("common.cancel", lang)}</button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.billedBy", lang)} *</label>
                  <select value={form.repairerId} onChange={(e) => setForm((f) => ({ ...f, repairerId: e.target.value }))} className={INPUT} style={INPUT_STYLE}>
                    {jobRepairers.map((r) => (
                      <option key={r.id} value={r.id}>{arText(r.name, r.name_ar, lang)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.invoiceNumber", lang)}</label>
                  <input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} className={INPUT} style={INPUT_STYLE} />
                </div>
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.invoiceDate", lang)}</label>
                  <input type="date" value={form.invoiceDate} onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} className={INPUT} style={INPUT_STYLE} />
                </div>
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.subtotal", lang)} *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.subtotal}
                    onChange={(e) => setForm((f) => ({ ...f, subtotal: Number(e.target.value) || 0 }))}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
              {/* Discount + Note share a row — Turki: note sits beside
                  discount so the note box shrinks, instead of its own
                  full-width row. */}
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.discount", lang)}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.discount}
                    onChange={(e) => setForm((f) => ({ ...f, discount: Number(e.target.value) || 0 }))}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </div>
                <div>
                  <label className="text-xs muted block mb-1">{lang === "en" ? "Note (optional)" : "ملاحظة (اختياري)"}</label>
                  <input
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs muted flex-wrap">
                <span>{t("mt.vat", lang)}: {formatSarVat(preview.vat_sar)}</span>
                {form.discount > 0 && <span>{t("mt.discount", lang)}: -{formatSarVat(preview.discount_sar)}</span>}
                <span className="font-medium text-[rgb(var(--fg))]">{t("mt.grandTotal", lang)}: {formatSarVat(preview.grand_total_sar)}</span>
              </div>
              <div>
                <label className="text-xs muted block mb-1">{isPaymentEdit ? t("mt.changeInvoice", lang) : t("mt.uploadInvoice", lang)}</label>
                <label className="upload-btn">
                  <Upload className="h-3.5 w-3.5" />
                  {pendingFile ? pendingFile.name : t("mt.uploadInvoice", lang)}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                {isPaymentEdit && <Btn variant="outline" onClick={resetPaymentForm} disabled={savingPayment}>{t("common.cancel", lang)}</Btn>}
                <Btn variant="primary" onClick={savePayment} disabled={savingPayment || !form.repairerId || !(form.subtotal > 0)}>
                  {savingPayment ? "…" : t("common.save", lang)}
                </Btn>
              </div>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "rgb(var(--border))" }}>
            {payments.length === 0 ? (
              <>
                <p className="text-xs muted p-3">{t("mt.noPayments", lang)}</p>
                <div className="px-3 py-2.5 border-t flex items-center justify-between" style={{ borderColor: "rgb(var(--border))" }}>
                  <span className="text-sm font-semibold">{t("mt.actualCost", lang)}</span>
                  <span className="text-base font-semibold tabular-nums">{formatSar(actualCost)}</span>
                </div>
              </>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.billedBy", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.invoiceNumber", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.invoiceDate", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.subtotal", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.vat", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.discount", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.grandTotal", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase"></th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase"></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const r = jobRepairersById.get(p.repairer_id);
                    const files = paymentFiles.filter((f) => f.payment_id === p.id);
                    return (
                      <tr key={p.id} className={cn(editingPaymentId === p.id ? "bg-brand-500/5" : "")}>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{r ? arText(r.name, r.name_ar, lang) : "—"}</td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{p.invoice_number || "—"}</td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{p.invoice_date ? formatDate(p.invoice_date) : "—"}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSarVat(p.subtotal_sar)}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSarVat(p.vat_sar)}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{p.discount_sar > 0 ? `-${formatSarVat(p.discount_sar)}` : "—"}</td>
                        <td className="py-2 px-3 border-t tabular-nums font-medium" style={{ borderColor: "rgb(var(--border))" }}>{formatSarVat(p.grand_total_sar)}</td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          {files.map((f) => (
                            <span key={f.id} className="inline-flex items-center gap-1 me-2">
                              <button onClick={() => openInvoiceFile(f.storage_path)} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                                <FileText className="h-3 w-3" />{f.file_name}
                              </button>
                              {editable && (
                                <button onClick={() => onRemoveFile(f.id)} className="text-rose-600 hover:text-rose-700" title={t("mt.removePhoto", lang)}>
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          ))}
                        </td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          {editable && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => startEditPayment(p)} className="h-6 w-6 rounded grid place-items-center hover:bg-black/10 dark:hover:bg-white/10" title={t("mt.edit", lang)}>
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => confirmDeletePayment(p.id)}
                                disabled={deletingPaymentId === p.id}
                                className="h-6 w-6 rounded grid place-items-center hover:bg-rose-500/10 text-rose-600"
                                title={t("mt.delete", lang)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Actual Total — sits directly below the Grand Total
                    column specifically (same column, one row down), with
                    the Files/Actions columns left blank beside it so it
                    never reads as sitting next to the edit/delete icons
                    (Turki's exact ask). */}
                <tfoot>
                  <tr>
                    <td colSpan={6} className="py-2.5 px-3 border-t text-end text-sm font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                      {t("mt.actualCost", lang)}
                    </td>
                    <td className="py-2.5 px-3 border-t tabular-nums text-base font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                      {formatSar(actualCost)}
                    </td>
                    <td className="border-t" style={{ borderColor: "rgb(var(--border))" }}></td>
                    <td className="border-t" style={{ borderColor: "rgb(var(--border))" }}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <div className="flex items-center gap-2">
            {job.status === "scheduled" && (
              <Btn variant="primary" onClick={onDispatch} disabled={lifecycleBusy}>
                <Play className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.dispatch", lang)}
              </Btn>
            )}
            {job.status === "in_progress" && (
              <span title={!allTasksDone ? t("mt.allTasksRequired", lang) : undefined}>
                <Btn variant="primary" onClick={onComplete} disabled={lifecycleBusy || !allTasksDone}>
                  <Check className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.markComplete", lang)}
                </Btn>
              </span>
            )}
            {!allTasksDone && job.status === "in_progress" && (
              <span className="text-xs muted">{t("mt.allTasksRequired", lang)}</span>
            )}
          </div>
          <Btn variant="outline" onClick={onClose}>{lang === "en" ? "Close" : "إغلاق"}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
