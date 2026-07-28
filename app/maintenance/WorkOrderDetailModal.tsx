"use client";

// Work Order detail — READ-ONLY in Phase 1. Mirrors preview/'s pages-2.js
// MT.openJob() layout (header strip / Work Performed / Mechanic Notes /
// Parts Replaced / cost breakdown) minus everything that needs a Phase-2
// RPC that doesn't exist yet: no task-toggle (toggle_work_order_task), no
// notes editing (save_work_order_notes), no Start/Complete buttons
// (start_work_order/complete_work_order), no photo gallery (Phase 3). Those
// land on this same shell in later phases rather than a second modal —
// flagged explicitly in the footer instead of silently omitted.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckSquare, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, formatSar } from "@/lib/utils";
import { Btn, StatusPill } from "@/components/ui";
import type { Truck, Staff, Part, WorkOrder, WorkOrderTask, WorkOrderPart } from "@/lib/db-types";

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
}: {
  lang: "en" | "ar";
  workOrder: WorkOrder;
  tasks: WorkOrderTask[];
  lines: WorkOrderPart[];
  truck: Truck | null;
  mechanic: Staff | null;
  parts: Part[];
  onClose: () => void;
}) {
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const delayed = isWoDelayed(workOrder);

  const partsCost = lines.reduce((s, l) => s + l.unit_price_sar * l.qty, 0);
  const laborCost = workOrder.labor_hours * workOrder.labor_rate_sar;
  const total = workOrder.actual_cost_sar ?? partsCost + laborCost;
  const doneCount = tasks.filter((tk) => tk.done).length;

  return (
    <ModalOverlay onClick={onClose}>
      <div className="card w-full max-w-[900px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">{lang === "ar" ? workOrder.title_ar : workOrder.title}</h2>
            <div className="text-xs muted font-mono">{workOrder.wo_number}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
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
                  <div key={tk.id} className="flex items-center gap-2 text-sm">
                    {tk.done ? <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" /> : <Square className="h-4 w-4 muted shrink-0" />}
                    <span className={cn(tk.done ? "line-through muted" : "")}>{lang === "ar" ? tk.description_ar : tk.description_en}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
            <h3 className="text-sm font-semibold mb-2">{t("mt.mechanicNotes", lang)}</h3>
            <p className="text-sm muted">{workOrder.mechanic_notes || "—"}</p>
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
          <span className="text-xs muted">{t("mt.phase2Note", lang)}</span>
          <Btn variant="outline" onClick={onClose}>{lang === "en" ? "Close" : "إغلاق"}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
