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
import type { Truck, Staff, Part, RepairDescription, WorkOrder, WorkOrderTask, WorkOrderPart, CompanySettings, Warehouse } from "@/lib/db-types";
import { createWorkOrder, editWorkOrder, saveWorkOrderTitle, addRepairDescription } from "./actions";
import { hourlyLaborCost } from "./laborCost";
import { MechanicPicker } from "./MechanicPicker";
import ScrollLock from "@/components/ScrollLock";

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
      <ScrollLock />
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
  onLeaveMechanicIds,
  parts,
  warehouses,
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
  // Polish item 3 (on-leave-today mechanics, UI-only) — the mechanic
  // picker below disables/grays these, it never touches create_work_order/
  // edit_work_order.
  onLeaveMechanicIds: Set<string>;
  parts: Part[];
  /**
   * Labels ONLY, for the parts picker's display filter below. `Pick<...>`
   * rather than the full row because page.tsx selects two columns — typing it
   * as `Warehouse[]` would be a lie tsc could not catch. Every part already
   * carries its own `warehouse_id`, so this never gates or joins anything;
   * it just turns an id into something a human can read.
   */
  warehouses: Pick<Warehouse, "id" | "name">[];
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
  // Polish item 3 — on CREATE, default to the first mechanic who ISN'T on
  // leave today (never silently pre-select someone the picker itself would
  // block from being newly chosen). On EDIT, keep the existing assignment
  // as-is even if that mechanic has since gone on leave — unaffected.
  const [mechanicId, setMechanicId] = useState(
    editingWorkOrder?.assigned_mechanic_id ?? (mechanics.find((m) => !onLeaveMechanicIds.has(m.id)) ?? mechanics[0])?.id ?? "",
  );
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
  // Polish P2 item 3 — filters which chips are VISIBLE in the scrollable
  // box below; never touches selection state (a filtered-out chip stays
  // selected/toggled, it's just not shown while the search doesn't match).
  const [chipSearch, setChipSearch] = useState("");

  // WAREHOUSE FILTER on the parts picker — DISPLAY ONLY, exactly the same
  // contract as chipSearch above: it changes which rows are VISIBLE and
  // nothing else. Selection lives in `qtyByPart` (keyed by part id) and
  // `lines` derives from that, never from the visible list, so a filtered-out
  // part stays reserved, keeps its qty, and still prices into estimatedCost.
  // Nothing about a saved work-order line changes.
  //
  // "all" is the default and it means ALL — nothing is hidden until the user
  // chooses to hide it.
  //
  // NO RESET EFFECT NEEDED: both call sites in MaintenanceClient render this
  // modal conditionally ({newWOOpen && …} / {editingWo && …}), so closing
  // unmounts it and reopening runs this initialiser again. An effect keyed on
  // `open` would be dead code here.
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");

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

  // Polish P2 item 3 — search filters the visible chip list only.
  const visibleDescriptions = useMemo(() => {
    const q = chipSearch.trim().toLowerCase();
    if (!q) return allDescriptions;
    return allDescriptions.filter((d) => (lang === "ar" ? d.ar : d.en).toLowerCase().includes(q));
  }, [allDescriptions, chipSearch, lang]);

  const selectedMechanic = mechanics.find((m) => m.id === mechanicId) ?? null;
  const previewLaborCost = hourlyLaborCost(selectedMechanic, companySettings);

  // id -> name, so a row can say "Manfuha Station" instead of a UUID.
  // Warehouse names are English-only by type design (db-types.ts: "no name_ar
  // — internal-only, never customer-facing"), so this is NOT lang-dependent
  // and deliberately has no Arabic branch to fall back through.
  const warehouseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses) m.set(w.id, w.name);
    return m;
  }, [warehouses]);

  // Counts shown on the filter pills, computed off ALL parts (not off the
  // visible list) so each pill states a fixed fact about the catalog rather
  // than a number that changes depending on which pill is currently active.
  const partCountByWarehouse = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of parts) m.set(p.warehouse_id, (m.get(p.warehouse_id) ?? 0) + 1);
    return m;
  }, [parts]);

  // THE display filter. One line, and it is the only place `warehouseFilter`
  // is read for data purposes — everything downstream that matters to a SAVE
  // (`lines`, `partsById`, `partsCost`) keeps reading the full `parts` array.
  const visibleParts = useMemo(
    () => (warehouseFilter === "all" ? parts : parts.filter((p) => p.warehouse_id === warehouseFilter)),
    [parts, warehouseFilter],
  );

  const partsByCategory = useMemo(() => {
    const sorted = [...visibleParts].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
    const groups = new Map<string, Part[]>();
    for (const p of sorted) {
      const cat = p.category || (lang === "en" ? "Uncategorized" : "غير مصنف");
      const arr = groups.get(cat) ?? [];
      arr.push(p);
      groups.set(cat, arr);
    }
    return Array.from(groups.entries());
  }, [visibleParts, lang]);

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

  // How many RESERVED parts the active filter is currently hiding. This is
  // the honesty line: the filter deliberately does not drop a selection, so
  // without this the total below could exceed the visible rows with no
  // explanation. Declared AFTER `lines`/`partsById` on purpose — a useMemo
  // reading a `const` declared further down throws at runtime (TDZ), which
  // this repo has already been bitten by once.
  const hiddenSelectedCount = useMemo(() => {
    if (warehouseFilter === "all") return 0;
    return lines.filter((l) => partsById.get(l.part_id)?.warehouse_id !== warehouseFilter).length;
  }, [lines, partsById, warehouseFilter]);

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
              <MechanicPicker
                value={mechanicId}
                onChange={setMechanicId}
                mechanics={mechanics}
                onLeaveMechanicIds={onLeaveMechanicIds}
                lang={lang}
                disabled={mechanics.length === 0}
                inputClassName={INPUT}
                inputStyle={INPUT_STYLE}
              />
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
            {/* Polish P2 item 3 — bordered, scrollable chip box (mirrors
                preview's own .chip-strip max-height:9rem/overflow-y:auto,
                which this app never actually carried over) plus a search
                bar + the add-description control side by side at the top
                (both new beyond preview, per Turki's explicit ask). */}
            <div className="rounded-lg border p-2" style={INPUT_STYLE}>
              <div className="flex gap-2 mb-2 flex-wrap">
                <input
                  value={chipSearch}
                  onChange={(e) => setChipSearch(e.target.value)}
                  placeholder={t("common.search", lang)}
                  className={cn(INPUT, "flex-1 min-w-[140px]")}
                  style={INPUT_STYLE}
                />
                <input
                  value={newChipText}
                  onChange={(e) => setNewChipText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(); } }}
                  placeholder={t("mt.addDescription", lang)}
                  className={cn(INPUT, "flex-1 min-w-[140px]")}
                  style={INPUT_STYLE}
                />
                <Btn variant="outline" onClick={addChip} disabled={addingChip || !newChipText.trim()}>
                  <Plus className="h-4 w-4" />{t("common.add", lang)}
                </Btn>
              </div>
              <div className="max-h-36 overflow-y-auto scrollbar-thin">
                <div className="flex flex-wrap gap-1.5">
                  {visibleDescriptions.length === 0 ? (
                    <p className="muted text-xs py-2">{lang === "en" ? "No matches" : "لا توجد نتائج"}</p>
                  ) : (
                    visibleDescriptions.map((d) => {
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
                    })
                  )}
                </div>
              </div>
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
              {/* WAREHOUSE FILTER — segmented pills, not a <select>, because
                  there are two warehouses plus "All": a dropdown would hide
                  a three-item list behind a click and give no count. Sits
                  INSIDE the bordered box, above the scroll area, so it reads
                  as a control belonging to this table rather than a form
                  field of the work order — it saves nothing.

                  Hidden entirely at <= 1 warehouse: a filter offering only
                  "All" is a control that cannot do anything. */}
              {warehouses.length > 1 && (
                <div
                  className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {/* Inline, not an i18n key — same convention as "No parts
                      reserved yet" above; `common.warehouse` does not exist
                      and one label does not justify widening that namespace. */}
                  <span className="text-[11px] muted me-1">{lang === "en" ? "Warehouse" : "المستودع"}</span>
                  {[
                    { id: "all", label: lang === "en" ? "All warehouses" : "كل المستودعات", count: parts.length },
                    // Warehouse names are English-only by design — see
                    // warehouseNameById above.
                    ...warehouses.map((w) => ({ id: w.id, label: w.name, count: partCountByWarehouse.get(w.id) ?? 0 })),
                  ].map((opt) => {
                    const on = warehouseFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setWarehouseFilter(opt.id)}
                        className={cn(
                          "inline-flex items-center text-xs rounded-full px-2.5 py-1 border transition",
                          on ? "bg-brand-600 text-white border-brand-600" : "hover:bg-black/5 dark:hover:bg-white/5",
                        )}
                        style={on ? undefined : INPUT_STYLE}
                      >
                        {opt.label}
                        <span
                          className={cn(
                            "ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                            on ? "bg-white/20" : "bg-black/[0.06] dark:bg-white/[0.08]",
                          )}
                        >
                          {opt.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
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
                    {/* Only reachable via the filter — the unfiltered catalog
                        is never empty in practice, but a warehouse with no
                        parts must say so rather than render a bare header. */}
                    {partsByCategory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center muted text-xs border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          {lang === "en" ? "No parts in this warehouse" : "لا توجد قطع في هذا المستودع"}
                        </td>
                      </tr>
                    )}
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
                                <div className="text-[11px] muted font-mono">
                                  {p.sku}
                                  {/* Location, shown ONLY while unfiltered —
                                      once a warehouse pill is active every
                                      visible row is in it and repeating the
                                      name on each line is noise. Suppressed
                                      at <= 1 warehouse for the same reason. */}
                                  {warehouseFilter === "all" && warehouses.length > 1 && warehouseNameById.has(p.warehouse_id) && (
                                    <span className="font-sans"> · {warehouseNameById.get(p.warehouse_id)}</span>
                                  )}
                                </div>
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
            {/* The filter hides ROWS, not RESERVATIONS. Without this line the
                estimate above could exceed everything on screen with no
                explanation, which would read as a bug. */}
            {hiddenSelectedCount > 0 && (
              <p className="text-[11px] muted mt-1.5">
                {lang === "en"
                  ? `${hiddenSelectedCount} reserved ${hiddenSelectedCount === 1 ? "part is" : "parts are"} in another warehouse — still reserved, still in the estimate above.`
                  : `${hiddenSelectedCount} من القطع المحجوزة في مستودع آخر — لا تزال محجوزة ومحتسبة في التقدير أعلاه.`}
              </p>
            )}
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
