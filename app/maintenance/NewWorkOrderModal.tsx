"use client";

// New / Edit Work Order — mirrors preview/'s pages-2.js MT.openNewJob/
// saveNewJob field-for-field: Truck / Type / Priority / Due date / Mechanic
// / Labor hours, a description chip picker (repair_descriptions catalog,
// inline "+ add"), and a parts picker grouped by category with a qty
// stepper. One component handles both create AND edit (via the optional
// `editingWorkOrder` prop) — same "one modal, edit prop" convention
// Inventory's own NewPOModal already established for editable drafts.
//
// TITLE FIELD — Polish item 1 (manual title, no migration/RPC change):
// one optional input, EN or AR, shown on both create and edit, saved via
// a plain follow-up write (never touches create_work_order/edit_work_order).
// Blank leaves the wo_number fallback (WO-YY-####, set by create_work_order
// itself) standing. This is the ONLY place title editing lives — there is
// no separate inline editor on the detail view.
//
// *** OUT-OF-STOCK HARD BLOCK (Turki, explicit) ***
// create_work_order/edit_work_order reject any line whose qty exceeds that
// part's CURRENT qty_on_hand — server-side, authoritative. Mirrored here at
// the point of selection:
//   - A part with zero EFFECTIVE headroom renders disabled (greyed, no
//     stepper, "Out of stock" badge).
//   - Every other part's stepper is hard-capped at its effective headroom.
// EFFECTIVE HEADROOM, when editing an in-progress/awaiting_parts WO's
// EXISTING line: qty_on_hand (live) + that line's OWN currently-held qty —
// because that qty already left the ledger for this line specifically, so
// reducing it gives stock back and increasing it draws only the delta from
// the live pool, exactly matching edit_work_order's own delta-based
// consume/return logic. For a brand-new line, or any line on a still-'open'
// WO, effective headroom is just plain live qty_on_hand (nothing held yet).
//
// LABOR COST: hourlyLaborCost() (./laborCost.ts) mirrors create_work_order/
// edit_work_order's salary-based snapshot formula for a DISPLAY-ONLY
// preview — shows "Labor cost: X SAR" for the chosen hour count, never the
// bare hourly rate (Turki: salary stays off the Maintenance UI; a total
// job-cost figure is fine, a per-hour rate is one division away from
// reconstructing a salary).

import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Plus, Minus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, formatSar, todayKey } from "@/lib/utils";
import { Btn } from "@/components/ui";
import type { Truck, Staff, Part, RepairDescription, WorkOrder, WorkOrderTask, WorkOrderPart, CompanySettings } from "@/lib/db-types";
import { createWorkOrder, editWorkOrder, saveWorkOrderTitle, addRepairDescription } from "./actions";
import { hourlyLaborCost } from "./laborCost";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;
// Polish item 2 — faded yellow tint on the Labor Hours / Labor Cost boxes,
// so they read as visually distinct from the parts-only cost total.
// `!` (important) needed — plain-CSS `.card`/input rules elsewhere in this
// app have silently overridden a same-specificity bg-* utility before
// (see globals.css's own documented .trip-highlight/.card precedent).
const LABOR_TINT = "!bg-yellow-400/10";

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

const TYPES = ["preventive", "corrective", "inspection", "predictive"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export default function NewWorkOrderModal({
  lang,
  trucks,
  mechanics,
  parts,
  repairDescriptions,
  companySettings,
  editingWorkOrder,
  editingTasks,
  editingLines,
  onClose,
  onCreated,
  onEdited,
}: {
  lang: "en" | "ar";
  trucks: Truck[];
  mechanics: Staff[];
  parts: Part[];
  repairDescriptions: RepairDescription[];
  companySettings: CompanySettings | null;
  // When set, the modal opens in EDIT mode for this WO instead of create.
  editingWorkOrder?: WorkOrder | null;
  editingTasks?: WorkOrderTask[];
  editingLines?: WorkOrderPart[];
  onClose: () => void;
  onCreated?: (wo: WorkOrder) => void;
  onEdited?: (wo: WorkOrder) => void;
}) {
  const isEdit = !!editingWorkOrder;
  const editableStatus = editingWorkOrder?.status ?? "open";

  const [truckId, setTruckId] = useState(editingWorkOrder?.truck_id ?? trucks[0]?.id ?? "");
  // Polish item 1 (manual title) — one optional field, EN or AR, shown on
  // BOTH create and edit (moved out of a separate detail-view inline
  // editor per Turki's correction — this IS the only place title editing
  // lives now). On edit, prefill with the real custom title only if one
  // was actually set (create_work_order snapshots title=wo_number when
  // none was typed) — otherwise leave blank, symmetric with "blank on
  // save leaves the number fallback standing."
  const [title, setTitle] = useState(
    editingWorkOrder && editingWorkOrder.title !== editingWorkOrder.wo_number ? editingWorkOrder.title : "",
  );
  const [type, setType] = useState<(typeof TYPES)[number]>((editingWorkOrder?.type as (typeof TYPES)[number]) ?? "preventive");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>((editingWorkOrder?.priority as (typeof PRIORITIES)[number]) ?? "medium");
  const [dueBy, setDueBy] = useState(editingWorkOrder ? editingWorkOrder.due_by.slice(0, 10) : todayKey());
  const [startDate, setStartDate] = useState(editingWorkOrder?.start_date ?? todayKey());
  const [mechanicId, setMechanicId] = useState(editingWorkOrder?.assigned_mechanic_id ?? mechanics[0]?.id ?? "");
  const [laborHours, setLaborHours] = useState(editingWorkOrder?.labor_hours ?? 4);

  const [localDescriptions, setLocalDescriptions] = useState<RepairDescription[]>([]);
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>(() => {
    if (!editingTasks || editingTasks.length === 0) return [];
    // Text-match against the current catalog — same reconciliation
    // convention edit_work_order itself uses server-side (tasks are a
    // snapshot, no live FK back to repair_descriptions).
    return repairDescriptions
      .filter((d) => editingTasks.some((tk) => tk.description_en === d.en))
      .map((d) => d.id);
  });
  const [newChipText, setNewChipText] = useState("");
  const [addingChip, setAddingChip] = useState(false);

  const [qtyByPart, setQtyByPart] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const l of editingLines ?? []) seed[l.part_id] = l.qty;
    return seed;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allDescriptions = useMemo(() => {
    const ids = new Set(repairDescriptions.map((d) => d.id));
    return [...repairDescriptions, ...localDescriptions.filter((d) => !ids.has(d.id))];
  }, [repairDescriptions, localDescriptions]);

  const selectedMechanic = mechanics.find((m) => m.id === mechanicId) ?? null;
  const previewLaborCost = hourlyLaborCost(selectedMechanic, companySettings);

  const partsByCategory = useMemo(() => {
    const sorted = [...parts].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
    const groups = new Map<string, Part[]>();
    for (const p of sorted) {
      const cat = p.category || (lang === "en" ? "Uncategorized" : "غير مصنف");
      const arr = groups.get(cat) ?? [];
      arr.push(p);
      groups.set(cat, arr);
    }
    return Array.from(groups.entries());
  }, [parts, lang]);

  // Existing (pre-edit) qty per part, for the "already-held stock counts
  // toward headroom" rule — only meaningful once the WO has left 'open'.
  const existingLineQtyByPart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of editingLines ?? []) m.set(l.part_id, l.qty);
    return m;
  }, [editingLines]);

  function effectiveMax(part: Part): number {
    if (isEdit && editableStatus !== "open") {
      const held = existingLineQtyByPart.get(part.id) ?? 0;
      return part.qty_on_hand + held;
    }
    return part.qty_on_hand;
  }

  function toggleChip(id: string) {
    setSelectedChipIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addChip() {
    const text = newChipText.trim();
    if (!text || addingChip) return;
    setAddingChip(true);
    const res = await addRepairDescription(text, "");
    setAddingChip(false);
    if (res.error || !res.description) {
      setError(res.error ?? "Could not add description.");
      return;
    }
    setLocalDescriptions((prev) => [...prev, res.description!]);
    setSelectedChipIds((prev) => [...prev, res.description!.id]);
    setNewChipText("");
  }

  function setQty(part: Part, raw: number) {
    const max = effectiveMax(part);
    const clamped = Math.max(0, Math.min(raw, max));
    setQtyByPart((prev) => {
      const next = { ...prev };
      if (clamped <= 0) delete next[part.id];
      else next[part.id] = clamped;
      return next;
    });
  }

  function bumpQty(part: Part, delta: number) {
    const current = qtyByPart[part.id] ?? 0;
    setQty(part, current + delta);
  }

  const lines = useMemo(
    () => Object.entries(qtyByPart).filter(([, qty]) => qty > 0).map(([part_id, qty]) => ({ part_id, qty })),
    [qtyByPart],
  );

  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of parts) m.set(p.id, p);
    return m;
  }, [parts]);

  const partsCost = lines.reduce((s, l) => s + (partsById.get(l.part_id)?.unit_cost_sar ?? 0) * l.qty, 0);
  // Polish item 2 — parts-only total (labor is its own separate figure,
  // shown in the Labor Cost box below, never added in here). Mirrors
  // create_work_order/edit_work_order's own estimated_cost_sar exactly.
  const estimatedCost = Math.round(partsCost);

  const canSubmit = truckId !== "" && mechanicId !== "" && dueBy !== "" && startDate !== "" && laborHours > 0 && !saving;

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    if (isEdit && editingWorkOrder) {
      const res = await editWorkOrder({
        wo_id: editingWorkOrder.id,
        type,
        priority,
        due_by: dueBy,
        start_date: startDate,
        mechanic_staff_id: mechanicId,
        task_description_ids: selectedChipIds,
        lines,
        labor_hours: laborHours,
      });
      if (res.error || !res.workOrder) {
        setSaving(false);
        setError(res.error ?? "Could not save changes.");
        return;
      }

      // Polish item 1 (manual title) — same plain mirrored update as
      // create, folded into the edit save. Blank field resolves to the
      // wo_number fallback (saveWorkOrderTitle rejects a blank string).
      const resolvedTitle = title.trim() || editingWorkOrder.wo_number;
      const titleRes = await saveWorkOrderTitle(editingWorkOrder.id, resolvedTitle);
      setSaving(false);
      if (titleRes.error) {
        setError(titleRes.error);
        return;
      }
      onEdited?.(titleRes.workOrder ?? res.workOrder);
      return;
    }

    const res = await createWorkOrder({
      truck_id: truckId,
      type,
      priority,
      due_by: dueBy,
      start_date: startDate,
      mechanic_staff_id: mechanicId,
      task_description_ids: selectedChipIds,
      lines,
      labor_hours: laborHours,
      title,
    });
    setSaving(false);
    if (res.error || !res.workOrder) {
      setError(res.error ?? "Could not create work order.");
      return;
    }
    onCreated?.(res.workOrder);
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h2 className="font-semibold">{isEdit ? t("mt.editJob", lang) : t("mt.addJob", lang)}</h2>
          <button onClick={close} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {mechanics.length === 0 && (
            <div className="rounded-lg px-3 py-2 text-sm bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {lang === "en"
                ? "No active mechanic staff found — add one via the People page before scheduling a job."
                : "لا يوجد فني نشط — أضف فنياً من صفحة الموظفين قبل جدولة عمل."}
            </div>
          )}
          {isEdit && editableStatus !== "open" && (
            <div className="rounded-lg px-3 py-2 text-sm bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {t("mt.editInProgressNote", lang)}
            </div>
          )}
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs muted block mb-1">{t("common.truck", lang)} *</label>
              <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={isEdit}>
                {trucks.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.plate} · {tr.model ?? ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.title", lang)}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("mt.titleOptionalHint", lang)}
                className={INPUT}
                style={INPUT_STYLE}
              />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.type", lang)} *</label>
              <select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className={INPUT} style={INPUT_STYLE}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>{t(`status.${ty}`, lang)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.priority", lang)} *</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])} className={INPUT} style={INPUT_STYLE}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{t(`status.${p}`, lang)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.startDate", lang)} *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.due", lang)} *</label>
              <input type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.mechanic", lang)} *</label>
              <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={mechanics.length === 0}>
                {mechanics.map((m) => (
                  <option key={m.id} value={m.id}>{lang === "ar" ? m.name_ar || m.name : m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.laborHours", lang)}</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={laborHours}
                onChange={(e) => setLaborHours(Number(e.target.value) || 0)}
                className={cn(INPUT, LABOR_TINT)}
                style={INPUT_STYLE}
              />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.laborCostPreview", lang)}</label>
              <input
                readOnly
                value={previewLaborCost != null ? formatSar(Math.round(laborHours * previewLaborCost)) : "—"}
                className={cn(INPUT, "opacity-70", LABOR_TINT)}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div>
            <label className="text-xs muted block mb-1">
              {t("mt.description", lang)} <span className="muted text-[10px]">{t("mt.chipsHelp", lang)}</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allDescriptions.map((d) => {
                const on = selectedChipIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleChip(d.id)}
                    className={cn(
                      "text-xs rounded-full px-2.5 py-1 border transition",
                      on ? "bg-brand-600 text-white border-brand-600" : "hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                    style={on ? undefined : INPUT_STYLE}
                  >
                    {lang === "ar" ? d.ar : d.en}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                value={newChipText}
                onChange={(e) => setNewChipText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(); } }}
                placeholder={t("mt.addDescription", lang)}
                className={cn(INPUT, "flex-1")}
                style={INPUT_STYLE}
              />
              <Btn variant="outline" onClick={addChip} disabled={addingChip || !newChipText.trim()}>
                <Plus className="h-4 w-4" />{t("common.add", lang)}
              </Btn>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs muted !mb-0">{t("mt.partsAndEquipment", lang)}</label>
              <span className="text-xs">
                {lines.length === 0 ? (
                  <span className="muted">{lang === "en" ? "No parts reserved yet" : "لم تُحجز قطع بعد"}</span>
                ) : (
                  <span className="font-medium">{formatSar(estimatedCost)} {lang === "en" ? "estimated" : "تقديري"}</span>
                )}
              </span>
            </div>
            <p className="text-[11px] muted mb-2">{t("mt.partsHelp", lang)}</p>
            <div className="rounded-lg border overflow-hidden" style={INPUT_STYLE}>
              <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="sticky top-0" style={{ background: "rgb(var(--card))" }}>
                    <tr>
                      <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.part", lang)}</th>
                      <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("mt.onHand", lang)}</th>
                      <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.unitPrice", lang)}</th>
                      <th className="text-start font-medium muted py-2 px-3 text-xs uppercase">{t("common.qty", lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partsByCategory.map(([cat, items]) => (
                      <Fragment key={cat}>
                        <tr>
                          <td colSpan={4} className="px-3 py-1 text-[11px] font-semibold muted uppercase" style={{ background: "rgba(0,0,0,0.02)" }}>
                            {cat}
                          </td>
                        </tr>
                        {items.map((p) => {
                          const max = effectiveMax(p);
                          const outOfStock = max <= 0;
                          const qty = qtyByPart[p.id] ?? 0;
                          return (
                            <tr key={p.id} className={cn(outOfStock ? "opacity-50" : "")}>
                              <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                                <div className="font-medium text-sm">{lang === "ar" ? p.name_ar || p.name : p.name}</div>
                                <div className="text-[11px] muted font-mono">{p.sku}</div>
                              </td>
                              <td className="py-2 px-3 border-t tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>
                                <span className={outOfStock ? "text-rose-600 font-semibold" : (p.reorder_level != null && p.qty_on_hand <= p.reorder_level) ? "text-amber-600 font-semibold" : ""}>
                                  {p.qty_on_hand}
                                </span>
                                <span className="muted text-[11px]"> {p.unit ?? ""}</span>
                              </td>
                              <td className="py-2 px-3 border-t tabular-nums text-xs" style={{ borderColor: "rgb(var(--border))" }}>
                                {formatSar(p.unit_cost_sar ?? 0)}
                              </td>
                              <td className="py-2 px-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                                {outOfStock ? (
                                  <span className="text-[11px] text-rose-600 font-medium">{t("mt.outOfStock", lang)}</span>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => bumpQty(p, -1)}
                                      disabled={qty <= 0}
                                      className="h-7 w-7 rounded-md border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
                                      style={INPUT_STYLE}
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      max={max}
                                      value={qty}
                                      onChange={(e) => setQty(p, Number(e.target.value) || 0)}
                                      className="w-14 text-center px-1 py-1 rounded-md border text-sm tabular-nums"
                                      style={INPUT_STYLE}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => bumpQty(p, 1)}
                                      disabled={qty >= max}
                                      className="h-7 w-7 rounded-md border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
                                      style={INPUT_STYLE}
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={close} disabled={saving}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={!canSubmit}>{saving ? "…" : t("common.save", lang)}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
