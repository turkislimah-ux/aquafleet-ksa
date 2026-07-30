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

import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, CheckSquare, Square, Play, Check, Pencil, Plus, FileText } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, formatSar, todayKey } from "@/lib/utils";
import { Btn, StatusPill } from "@/components/ui";
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
  toggleOutsourcedJobTask,
  addWorkshopPayment,
  uploadWorkshopPaymentFile,
  removeWorkshopPaymentFile,
  getWorkshopPaymentFileSignedUrls,
} from "./osActions";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

function ModalOverlay({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {children}
    </div>,
    document.body,
  );
}

function isOverdue(job: OutsourcedJob): boolean {
  return job.status !== "completed" && job.estimated_finish < todayKey();
}

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
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const editable = job.status !== "completed";
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

  async function onToggleTask(task: OutsourcedJobTask) {
    if (!editable || busyTaskId) return;
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

  // ---- Add payment form ----
  const [addingPayment, setAddingPayment] = useState(false);
  const [payRepairerId, setPayRepairerId] = useState(jobRepairers[0]?.id ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayKey());
  const [subtotal, setSubtotal] = useState<number>(0);
  const [note, setNote] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  const preview = computeWorkshopPaymentTotals(subtotal || 0);

  async function saveNewPayment() {
    if (!payRepairerId || !(subtotal > 0) || savingPayment) return;
    setSavingPayment(true);
    setError(null);
    const res = await addWorkshopPayment({
      outsourced_job_id: job.id,
      repairer_id: payRepairerId,
      invoice_number: invoiceNumber || null,
      invoice_date: invoiceDate || null,
      subtotal_sar: subtotal,
      note: note || null,
    });
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
    setAddingPayment(false);
    setInvoiceNumber("");
    setInvoiceDate(todayKey());
    setSubtotal(0);
    setNote("");
    setPendingFile(null);
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
      <div className="card w-full max-w-[900px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">{lang === "ar" ? job.title_ar : job.title}</h2>
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
                  <StatusPill status="critical" label={t("mt.osOverdue", lang)} />
                ) : (
                  <StatusPill status={job.status} label={t(`status.${job.status}`, lang)} />
                )}
              </div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.type", lang)}</div>
              <div>{t(`status.${job.type}`, lang)}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.responsibleMechanic", lang)}</div>
              <div>{mechanic ? (lang === "ar" ? mechanic.name_ar || mechanic.name : mechanic.name) : "—"}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.startDate", lang)}</div>
              <div>{new Date(job.start_date).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("mt.estimatedFinish", lang)}</div>
              <div className={overdue ? "text-rose-600 font-semibold" : ""}>{new Date(job.estimated_finish).toLocaleDateString()}</div>
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
                      {lang === "ar" ? r.name_ar || r.name : r.name}
                      {rt && <span className="muted"> · {lang === "ar" ? rt.label_ar || rt.label_en : rt.label_en}</span>}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

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
                    disabled={!editable || busyTaskId === tk.id}
                    className="flex items-center gap-2 text-sm w-full text-start disabled:cursor-default"
                  >
                    {tk.done ? <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" /> : <Square className="h-4 w-4 muted shrink-0" />}
                    <span className={cn(tk.done ? "line-through muted" : "")}>{lang === "ar" ? tk.description_ar : tk.description_en}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* MONEY — own card, own total, never mixed with in-house/Inventory cost. */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "rgb(var(--border))" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgb(var(--border))" }}>
              <h3 className="text-sm font-semibold">{t("mt.workshopPayments", lang)}</h3>
              {!addingPayment && (
                <button onClick={() => setAddingPayment(true)} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" />{t("mt.addPayment", lang)}
                </button>
              )}
            </div>

            {payments.length === 0 ? (
              <p className="text-xs muted p-3">{t("mt.noPayments", lang)}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.billedBy", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.invoiceNumber", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.invoiceDate", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.subtotal", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.vat", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.grandTotal", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase"></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const r = jobRepairersById.get(p.repairer_id);
                    const files = paymentFiles.filter((f) => f.payment_id === p.id);
                    return (
                      <tr key={p.id}>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{r ? (lang === "ar" ? r.name_ar || r.name : r.name) : "—"}</td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{p.invoice_number || "—"}</td>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>{p.invoice_date ? new Date(p.invoice_date).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSarVat(p.subtotal_sar)}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSarVat(p.vat_sar)}</td>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {addingPayment && (
              <div className="p-3 border-t space-y-2" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs muted block mb-1">{t("mt.billedBy", lang)}</label>
                    <select value={payRepairerId} onChange={(e) => setPayRepairerId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                      {jobRepairers.map((r) => (
                        <option key={r.id} value={r.id}>{lang === "ar" ? r.name_ar || r.name : r.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("mt.invoiceNumber", lang)}</label>
                    <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("mt.invoiceDate", lang)}</label>
                    <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("mt.subtotal", lang)}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={subtotal}
                      onChange={(e) => setSubtotal(Number(e.target.value) || 0)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs muted">
                  <span>{t("mt.vat", lang)}: {formatSarVat(preview.vat_sar)}</span>
                  <span className="font-medium text-[rgb(var(--fg))]">{t("mt.grandTotal", lang)}: {formatSarVat(preview.grand_total_sar)}</span>
                </div>
                <input
                  placeholder={lang === "en" ? "Note (optional)" : "ملاحظة (اختياري)"}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
                <div>
                  <label className="text-xs muted block mb-1">{t("mt.uploadPhoto", lang)}</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Btn variant="outline" onClick={() => setAddingPayment(false)} disabled={savingPayment}>{t("common.cancel", lang)}</Btn>
                  <Btn variant="primary" onClick={saveNewPayment} disabled={savingPayment || !payRepairerId || !(subtotal > 0)}>
                    {savingPayment ? "…" : t("common.save", lang)}
                  </Btn>
                </div>
              </div>
            )}

            <div className="px-3 py-2 border-t flex items-center justify-between" style={{ borderColor: "rgb(var(--border))" }}>
              <span className="text-sm font-semibold">{t("mt.actualCost", lang)}</span>
              <span className="text-lg font-semibold tabular-nums">{formatSar(actualCost)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <div className="flex items-center gap-2">
            {job.status === "scheduled" && (
              <Btn variant="primary" onClick={onDispatch} disabled={lifecycleBusy}>
                <Play className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.dispatch", lang)}
              </Btn>
            )}
            {job.status !== "completed" && (
              <span title={!allTasksDone ? t("mt.allTasksRequired", lang) : undefined}>
                <Btn variant="primary" onClick={onComplete} disabled={lifecycleBusy || !allTasksDone}>
                  <Check className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.markComplete", lang)}
                </Btn>
              </span>
            )}
            {!allTasksDone && job.status !== "completed" && (
              <span className="text-xs muted">{t("mt.allTasksRequired", lang)}</span>
            )}
          </div>
          <Btn variant="outline" onClick={onClose}>{lang === "en" ? "Close" : "إغلاق"}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
