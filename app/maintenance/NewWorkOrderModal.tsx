"use client";

// New Work Order — mirrors preview/'s pages-2.js MT.openNewJob/saveNewJob
// (lines ~956-1131) field-for-field: Truck / Type / Priority / Due date /
// Mechanic, a description chip picker (repair_descriptions catalog, inline
// "+ add" same as units'/suppliers' inline-create), and a parts picker
// grouped by category with a qty stepper.
//
// *** OUT-OF-STOCK HARD BLOCK (Turki, explicit) ***
// create_work_order (migration 0060) rejects any line whose qty exceeds
// that part's CURRENT qty_on_hand — server-side, authoritative. Turki's ask
// was to prevent it at the point of SELECTION, not discover it on save:
//   - A part with qty_on_hand <= 0 renders its whole row disabled (greyed,
//     no stepper, "Out of stock" badge instead of a price/qty control).
//   - Every other part's stepper is hard-capped at qty_on_hand — the "+"
//     button stops incrementing at the ceiling, and the numeric input itself
//     has a native max= so a typed value above on-hand snaps back down.
// This is a UX affordance layered on top of the server gate, not a
// replacement for it — the RPC still re-checks qty_on_hand at save time
// (stock can move between opening this modal and submitting).

import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Plus, Minus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, formatSar, todayKey } from "@/lib/utils";
import { Btn } from "@/components/ui";
import type { Truck, Staff, Part, RepairDescription, WorkOrder } from "@/lib/db-types";
import { createWorkOrder, addRepairDescription } from "./actions";

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

const TYPES = ["preventive", "corrective", "inspection", "predictive"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const DEFAULT_LABOR_HOURS = 4;
const DEFAULT_LABOR_RATE = 145;

export default function NewWorkOrderModal({
  lang,
  trucks,
  mechanics,
  parts,
  repairDescriptions,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  trucks: Truck[];
  mechanics: Staff[];
  parts: Part[];
  repairDescriptions: RepairDescription[];
  onClose: () => void;
  onCreated: (wo: WorkOrder) => void;
}) {
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? "");
  const [type, setType] = useState<(typeof TYPES)[number]>("preventive");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("medium");
  const [dueBy, setDueBy] = useState(todayKey());
  const [mechanicId, setMechanicId] = useState(mechanics[0]?.id ?? "");

  const [localDescriptions, setLocalDescriptions] = useState<RepairDescription[]>([]);
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>([]);
  const [newChipText, setNewChipText] = useState("");
  const [addingChip, setAddingChip] = useState(false);

  const [qtyByPart, setQtyByPart] = useState<Record<string, number>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allDescriptions = useMemo(() => {
    const ids = new Set(repairDescriptions.map((d) => d.id));
    return [...repairDescriptions, ...localDescriptions.filter((d) => !ids.has(d.id))];
  }, [repairDescriptions, localDescriptions]);

  const selectedTruck = trucks.find((tr) => tr.id === truckId) ?? null;

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

  function setQty(partId: string, raw: number) {
    const part = parts.find((p) => p.id === partId);
    const onHand = part?.qty_on_hand ?? 0;
    // Hard cap at on-hand — the server-side data rule mirrored in the UI
    // (Turki's explicit ask: block at selection, not just at save).
    const clamped = Math.max(0, Math.min(raw, onHand));
    setQtyByPart((prev) => {
      const next = { ...prev };
      if (clamped <= 0) delete next[partId];
      else next[partId] = clamped;
      return next;
    });
  }

  function bumpQty(partId: string, delta: number) {
    const current = qtyByPart[partId] ?? 0;
    setQty(partId, current + delta);
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
  const estimatedCost = Math.round(partsCost + DEFAULT_LABOR_HOURS * DEFAULT_LABOR_RATE);

  const canSubmit = truckId !== "" && mechanicId !== "" && dueBy !== "" && !saving;

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const res = await createWorkOrder({
      truck_id: truckId,
      type,
      priority,
      due_by: dueBy,
      mechanic_staff_id: mechanicId,
      task_description_ids: selectedChipIds,
      lines,
    });
    setSaving(false);
    if (res.error || !res.workOrder) {
      setError(res.error ?? "Could not create work order.");
      return;
    }
    onCreated(res.workOrder);
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card w-full max-w-[900px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h2 className="font-semibold">{t("mt.addJob", lang)}</h2>
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
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs muted block mb-1">{t("common.truck", lang)}</label>
              <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                {trucks.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.plate} · {tr.model ?? ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">
                {t("common.title", lang)} <span className="muted text-[10px]">({t("mt.titleAuto", lang)})</span>
              </label>
              <input readOnly value={selectedTruck ? `${lang === "en" ? "Maintenance" : "صيانة"} — ${selectedTruck.plate}` : ""} className={cn(INPUT, "opacity-70")} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.type", lang)}</label>
              <select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className={INPUT} style={INPUT_STYLE}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>{t(`status.${ty}`, lang)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.priority", lang)}</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])} className={INPUT} style={INPUT_STYLE}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{t(`status.${p}`, lang)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.due", lang)}</label>
              <input type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("common.mechanic", lang)}</label>
              <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={mechanics.length === 0}>
                {mechanics.map((m) => (
                  <option key={m.id} value={m.id}>{lang === "ar" ? m.name_ar || m.name : m.name}</option>
                ))}
              </select>
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
                          const outOfStock = p.qty_on_hand <= 0;
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
                                      onClick={() => bumpQty(p.id, -1)}
                                      disabled={qty <= 0}
                                      className="h-7 w-7 rounded-md border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
                                      style={INPUT_STYLE}
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      max={p.qty_on_hand}
                                      value={qty}
                                      onChange={(e) => setQty(p.id, Number(e.target.value) || 0)}
                                      className="w-14 text-center px-1 py-1 rounded-md border text-sm tabular-nums"
                                      style={INPUT_STYLE}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => bumpQty(p.id, 1)}
                                      disabled={qty >= p.qty_on_hand}
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
