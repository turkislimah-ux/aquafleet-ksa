"use client";

// Work Order detail — Phase 2: now interactive. Mirrors preview/'s
// pages-2.js MT.openJob() layout (header strip / Work Performed / Mechanic
// Notes / Parts Replaced / cost breakdown / Start-Complete footer).
//
// No local optimistic state for workOrder/tasks/lines — same convention as
// InventoryClient's own modals (e.g. createPurchaseOrder): call the action,
// router.refresh() on success, let the server component's fresh props flow
// back down. This modal isn't unmounted across a refresh (still keyed by
// viewingWoId in the parent), so it picks up the new status/tasks/line
// prices (deduct_work_order_parts overwrites unit_price_sar on start)
// automatically once the refresh resolves — no manual merging needed.
//
// Photos (Phase 3) still not built — Parts Replaced has no photo column yet.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, CheckSquare, Square, Play, Check, Pencil, AlertTriangle } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, formatSar } from "@/lib/utils";
import { Btn, StatusPill } from "@/components/ui";
import type { Truck, Staff, Part, WorkOrder, WorkOrderTask, WorkOrderPart } from "@/lib/db-types";
import { startWorkOrder, completeWorkOrder, toggleWorkOrderTask, saveWorkOrderNotes } from "./actions";

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

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}

export default function WorkOrderDetailModal({
  lang,
  workOrder,
  tasks,
  lines,
  truck,
  mechanic,
  parts,
  onClose,
  onEdit,
}: {
  lang: "en" | "ar";
  workOrder: WorkOrder;
  tasks: WorkOrderTask[];
  lines: WorkOrderPart[];
  truck: Truck | null;
  mechanic: Staff | null;
  parts: Part[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const delayed = isWoDelayed(workOrder);
  const editable = workOrder.status !== "completed" && workOrder.status !== "cancelled";

  const partsCost = lines.reduce((s, l) => s + l.unit_price_sar * l.qty, 0);
  const laborCost = workOrder.labor_hours * workOrder.labor_rate_sar;
  const total = workOrder.actual_cost_sar ?? partsCost + laborCost;
  const doneCount = tasks.filter((tk) => tk.done).length;
  const allTasksDone = tasks.length === 0 || tasks.every((tk) => tk.done);

  // Out-of-part — DERIVED, not stored: only meaningful for a still-'open'
  // WO (nothing consumed yet, so live qty_on_hand is a real threat). A
  // started WO already holds its parts via the consume-on-start deduction,
  // so this check doesn't apply to it — the authoritative gate for THAT
  // case is start_work_order -> consume_from_lots itself. This is purely
  // the pre-emptive display + Start-block so the user sees it before
  // clicking, per Turki's spec.
  const outOfPartLines = workOrder.status === "open"
    ? lines.filter((l) => (partsById.get(l.part_id)?.qty_on_hand ?? 0) < l.qty)
    : [];
  const isOutOfPart = outOfPartLines.length > 0;

  const [error, setError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState(workOrder.mechanic_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  async function onToggleTask(task: WorkOrderTask) {
    if (!editable || busyTaskId) return;
    setBusyTaskId(task.id);
    setError(null);
    const res = await toggleWorkOrderTask(task.id, !task.done);
    setBusyTaskId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  function startEditingNotes() {
    setDraftNotes(workOrder.mechanic_notes ?? "");
    setEditingNotes(true);
  }

  async function onSaveNotes() {
    setSavingNotes(true);
    setError(null);
    const res = await saveWorkOrderNotes(workOrder.id, draftNotes);
    setSavingNotes(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEditingNotes(false);
    router.refresh();
  }

  async function onStart() {
    setLifecycleBusy(true);
    setError(null);
    const res = await startWorkOrder(workOrder.id);
    setLifecycleBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function onComplete() {
    setLifecycleBusy(true);
    setError(null);
    const res = await completeWorkOrder(workOrder.id);
    setLifecycleBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <ModalOverlay onClick={onClose}>
      <div className="card w-full max-w-[900px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">{lang === "ar" ? workOrder.title_ar : workOrder.title}</h2>
            <div className="text-xs muted font-mono">{workOrder.wo_number}</div>
            {(workOrder.created_by || workOrder.started_by || workOrder.completed_by) && (
              <div className="text-[11px] muted mt-0.5 flex flex-wrap gap-x-3">
                {workOrder.created_by && <span>{t("mt.createdBy", lang)}: {workOrder.created_by}</span>}
                {workOrder.started_by && <span>{t("mt.startedBy", lang)}: {workOrder.started_by}</span>}
                {workOrder.completed_by && <span>{t("mt.completedBy", lang)}: {workOrder.completed_by}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {editable && (
              <button onClick={onEdit} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5" title={t("mt.editJob", lang)}>
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
          {isOutOfPart && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{t("mt.outOfPartBlockStart", lang)}</span>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="muted mb-0.5">{t("common.truck", lang)}</div>
              <div className="font-medium">{truck ? `${truck.plate} · ${truck.model ?? ""}` : "—"}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.status", lang)}</div>
              <div>{delayed ? <StatusPill status="critical" label={t("mt.delayed", lang)} /> : <StatusPill status={workOrder.status} label={t(`status.${workOrder.status}`, lang)} />}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.type", lang)}</div>
              <div>{t(`status.${workOrder.type}`, lang)}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.priority", lang)}</div>
              <div className="font-medium">{t(`status.${workOrder.priority}`, lang)}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.mechanic", lang)}</div>
              <div>{mechanic ? (lang === "ar" ? mechanic.name_ar || mechanic.name : mechanic.name) : "—"}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.opened", lang)}</div>
              <div>{new Date(workOrder.opened_at).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{t("common.due", lang)}</div>
              <div className={delayed ? "text-rose-600 font-semibold" : ""}>{new Date(workOrder.due_by).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="muted mb-0.5">{lang === "en" ? "Odometer at service" : "العداد عند الصيانة"}</div>
              <div className="tabular-nums">{workOrder.odometer_at_service != null ? `${workOrder.odometer_at_service} km` : "—"}</div>
            </div>
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

            <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t("mt.mechanicNotes", lang)}</h3>
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
                <p className="text-sm muted">{workOrder.mechanic_notes || "—"}</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "rgb(var(--border))" }}>
            <div className="px-3 py-2 border-b text-sm font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
              {t("mt.partsReplacedTitle", lang)}
            </div>
            {lines.length === 0 ? (
              <p className="text-xs muted p-3">—</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.part", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.qty", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.unitPrice", lang)}</th>
                    <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{lang === "en" ? "Subtotal" : "المجموع"}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = partsById.get(l.part_id);
                    return (
                      <tr key={l.id}>
                        <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          <div className="font-medium">{p ? (lang === "ar" ? p.name_ar || p.name : p.name) : l.part_id}</div>
                          <div className="text-[11px] muted font-mono">{p?.sku ?? ""}</div>
                        </td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{l.qty}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSar(l.unit_price_sar)}</td>
                        <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>{formatSar(l.unit_price_sar * l.qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {workOrder.inventory_deducted_at && (
              <div className="px-3 py-2 text-[11px] muted border-t" style={{ borderColor: "rgb(var(--border))" }}>
                {lang === "en"
                  ? "Inventory is automatically reduced when the maintenance team consumes parts."
                  : "ينخفض المخزون تلقائياً عند استهلاك فريق الصيانة للقطع."}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-3">
              <div className="text-xs muted uppercase">{t("mt.laborHours", lang)}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{workOrder.labor_hours}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs muted uppercase">{t("mt.laborCost", lang)}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatSar(laborCost)}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs muted uppercase">{t("mt.partsCost", lang)}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatSar(partsCost)}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs muted uppercase">{t("mt.totalCost", lang)}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatSar(total)}</div>
              {workOrder.actual_cost_sar == null && (
                <div className="text-[11px] muted mt-0.5">{lang === "en" ? "Estimated" : "تقديري"}: {formatSar(workOrder.estimated_cost_sar)}</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <div className="flex items-center gap-2">
            {workOrder.status === "open" && (
              <span title={isOutOfPart ? t("mt.outOfPartBlockStart", lang) : undefined}>
                <Btn variant="primary" onClick={onStart} disabled={lifecycleBusy || isOutOfPart}>
                  <Play className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.markInProg", lang)}
                </Btn>
              </span>
            )}
            {(workOrder.status === "in_progress" || workOrder.status === "awaiting_parts") && (
              <span title={!allTasksDone ? t("mt.allTasksRequired", lang) : undefined}>
                <Btn variant="primary" onClick={onComplete} disabled={lifecycleBusy || !allTasksDone}>
                  <Check className="h-4 w-4" />{lifecycleBusy ? "…" : t("mt.markComplete", lang)}
                </Btn>
              </span>
            )}
            {!allTasksDone && (workOrder.status === "in_progress" || workOrder.status === "awaiting_parts") && (
              <span className="text-xs muted">{t("mt.allTasksRequired", lang)}</span>
            )}
          </div>
          <Btn variant="outline" onClick={onClose}>{lang === "en" ? "Close" : "إغلاق"}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
