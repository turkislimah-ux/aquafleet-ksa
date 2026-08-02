"use client";

// New / Edit Outsourced Job — Turki's spec is behavioral source of truth.
// One component handles create AND edit (via optional `editingJob` prop).
//
// TRUCK ROW — always shown, on create AND edit. Truck is a real picker on
// create (it's how the job gets its truck); disabled on edit (immutable
// once created — a job's truck is fixed for its lifetime).
//
// TITLE FIELD — Polish item 1 (manual title, no migration/RPC change):
// one optional input, EN or AR, shown on both create and edit, saved via
// a plain follow-up write (never touches create_outsourced_job/
// edit_outsourced_job). Blank leaves the os_number fallback (OS-YY-####,
// set by create_outsourced_job itself) standing. This is the ONLY place
// title editing lives — there is no separate inline editor on the detail
// view.
//
// REPAIRERS — many per job (checkbox list). "+ New Repairer" is a proper
// Btn (Phase-4 fix — was a text link) next to the section title, opens
// RepairerFormModal (its own clean popup, nested on top of this one) —
// replaces the old inline mini-form. Each row also gets edit/soft-delete
// icon actions wired to updateRepairer/deleteRepairer. The "select at
// least one repairer" warning sits right after the section title/button
// row, above the picker box (Phase-4 fix — was a top-of-modal banner,
// disconnected from the section it's about).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, todayKey } from "@/lib/utils";
import { Btn } from "@/components/ui";
import type { Truck, Staff, RepairerType, Repairer, OutsourcedDescription, OutsourcedJob } from "@/lib/db-types";
import {
  createOutsourcedJob,
  editOutsourcedJob,
  saveOutsourcedJobTitle,
  deleteRepairer,
  addOutsourcedDescription,
} from "./osActions";
import RepairerFormModal from "./RepairerFormModal";
import { MechanicPicker } from "./MechanicPicker";

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

export default function NewOutsourcedJobModal({
  lang,
  trucks,
  mechanics,
  onLeaveMechanicIds,
  repairerTypes,
  repairers,
  outsourcedDescriptions,
  editingJob,
  editingRepairerIds,
  editingTasks,
  onClose,
  onCreated,
  onEdited,
}: {
  lang: "en" | "ar";
  trucks: Truck[];
  mechanics: Staff[];
  // Polish item 3 (on-leave-today mechanics, UI-only) — the mechanic
  // picker below disables/grays these, it never touches
  // create_outsourced_job/edit_outsourced_job.
  onLeaveMechanicIds: Set<string>;
  repairerTypes: RepairerType[];
  repairers: Repairer[];
  outsourcedDescriptions: OutsourcedDescription[];
  editingJob?: OutsourcedJob | null;
  editingRepairerIds?: string[];
  editingTasks?: { description_en: string }[];
  onClose: () => void;
  onCreated?: (job: OutsourcedJob) => void;
  onEdited?: (job: OutsourcedJob) => void;
}) {
  const isEdit = !!editingJob;

  const [truckId, setTruckId] = useState(editingJob?.truck_id ?? trucks[0]?.id ?? "");
  // Polish item 1 (manual title) — mirrors NewWorkOrderModal's own title
  // field exactly. Prefill with the real custom title only if one was
  // actually set (create_outsourced_job snapshots title=os_number when
  // none was typed) — otherwise leave blank.
  const [title, setTitle] = useState(
    editingJob && editingJob.title !== editingJob.os_number ? editingJob.title : "",
  );
  // Polish item 3 — on CREATE, default to the first mechanic who ISN'T on
  // leave today (never silently pre-select someone the picker itself would
  // block from being newly chosen). On EDIT, keep the existing assignment
  // as-is even if that mechanic has since gone on leave — unaffected.
  const [mechanicId, setMechanicId] = useState(
    editingJob?.responsible_mechanic_id ?? (mechanics.find((m) => !onLeaveMechanicIds.has(m.id)) ?? mechanics[0])?.id ?? "",
  );
  const [type, setType] = useState<(typeof TYPES)[number]>((editingJob?.type as (typeof TYPES)[number]) ?? "corrective");
  const [startDate, setStartDate] = useState(editingJob?.start_date ?? todayKey());
  const [estimatedFinish, setEstimatedFinish] = useState(editingJob?.estimated_finish ?? todayKey());

  const [localRepairers, setLocalRepairers] = useState<Repairer[]>([]);
  const [removedRepairerIds, setRemovedRepairerIds] = useState<Set<string>>(new Set());
  const [selectedRepairerIds, setSelectedRepairerIds] = useState<string[]>(editingRepairerIds ?? []);

  const [repairerFormOpen, setRepairerFormOpen] = useState(false);
  const [repairerBeingEdited, setRepairerBeingEdited] = useState<Repairer | null>(null);
  const [deletingRepairerId, setDeletingRepairerId] = useState<string | null>(null);

  const [localDescriptions, setLocalDescriptions] = useState<OutsourcedDescription[]>([]);
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>(() => {
    if (!editingTasks || editingTasks.length === 0) return [];
    return outsourcedDescriptions
      .filter((d) => editingTasks.some((tk) => tk.description_en === d.en))
      .map((d) => d.id);
  });
  const [newChipText, setNewChipText] = useState("");
  const [addingChip, setAddingChip] = useState(false);
  // Polish P2 item 3 — filters which chips are VISIBLE in the scrollable
  // box below; never touches selection state.
  const [chipSearch, setChipSearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRepairers = useMemo(() => {
    const ids = new Set(repairers.map((r) => r.id));
    const merged = [...repairers, ...localRepairers.filter((r) => !ids.has(r.id))];
    return merged.filter((r) => !removedRepairerIds.has(r.id));
  }, [repairers, localRepairers, removedRepairerIds]);

  const repairerTypesById = useMemo(() => new Map(repairerTypes.map((rt) => [rt.id, rt])), [repairerTypes]);

  const allDescriptions = useMemo(() => {
    const ids = new Set(outsourcedDescriptions.map((d) => d.id));
    return [...outsourcedDescriptions, ...localDescriptions.filter((d) => !ids.has(d.id))];
  }, [outsourcedDescriptions, localDescriptions]);

  // Polish P2 item 3 — search filters the visible chip list only.
  const visibleDescriptions = useMemo(() => {
    const q = chipSearch.trim().toLowerCase();
    if (!q) return allDescriptions;
    return allDescriptions.filter((d) => (lang === "ar" ? d.ar : d.en).toLowerCase().includes(q));
  }, [allDescriptions, chipSearch, lang]);

  function toggleRepairer(id: string) {
    setSelectedRepairerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function onRepairerSaved(repairer: Repairer) {
    setLocalRepairers((prev) => {
      const without = prev.filter((r) => r.id !== repairer.id);
      return [...without, repairer];
    });
    setRemovedRepairerIds((prev) => {
      if (!prev.has(repairer.id)) return prev;
      const next = new Set(prev);
      next.delete(repairer.id);
      return next;
    });
    if (!repairerBeingEdited) setSelectedRepairerIds((prev) => [...prev, repairer.id]);
    setRepairerFormOpen(false);
    setRepairerBeingEdited(null);
  }

  async function confirmDeleteRepairer(id: string) {
    if (!window.confirm(t("mt.confirmDeleteRepairer", lang))) return;
    setDeletingRepairerId(id);
    const res = await deleteRepairer(id);
    setDeletingRepairerId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRemovedRepairerIds((prev) => new Set(prev).add(id));
    setSelectedRepairerIds((prev) => prev.filter((x) => x !== id));
  }

  function toggleChip(id: string) {
    setSelectedChipIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addChip() {
    const text = newChipText.trim();
    if (!text || addingChip) return;
    setAddingChip(true);
    const res = await addOutsourcedDescription(text, "");
    setAddingChip(false);
    if (res.error || !res.description) {
      setError(res.error ?? "Could not add description.");
      return;
    }
    setLocalDescriptions((prev) => [...prev, res.description!]);
    setSelectedChipIds((prev) => [...prev, res.description!.id]);
    setNewChipText("");
  }

  const canSubmit =
    (isEdit || truckId !== "") &&
    mechanicId !== "" &&
    startDate !== "" &&
    estimatedFinish !== "" &&
    selectedRepairerIds.length > 0 &&
    !saving;

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    if (isEdit && editingJob) {
      const res = await editOutsourcedJob({
        job_id: editingJob.id,
        responsible_mechanic_id: mechanicId,
        type,
        start_date: startDate,
        estimated_finish: estimatedFinish,
        repairer_ids: selectedRepairerIds,
        task_description_ids: selectedChipIds,
      });
      if (res.error || !res.job) {
        setSaving(false);
        setError(res.error ?? "Could not save changes.");
        return;
      }

      // Polish item 1 (manual title) — same plain mirrored update as
      // create, folded into the edit save. Blank field resolves to the
      // os_number fallback (saveOutsourcedJobTitle rejects a blank string).
      const resolvedTitle = title.trim() || editingJob.os_number;
      const titleRes = await saveOutsourcedJobTitle(editingJob.id, resolvedTitle);
      setSaving(false);
      if (titleRes.error) {
        setError(titleRes.error);
        return;
      }
      onEdited?.(titleRes.job ?? res.job);
      return;
    }

    const res = await createOutsourcedJob({
      truck_id: truckId,
      responsible_mechanic_id: mechanicId,
      type,
      start_date: startDate,
      estimated_finish: estimatedFinish,
      repairer_ids: selectedRepairerIds,
      task_description_ids: selectedChipIds,
      title,
    });
    setSaving(false);
    if (res.error || !res.job) {
      setError(res.error ?? "Could not create outsourced job.");
      return;
    }
    onCreated?.(res.job);
  }

  return (
    <ModalOverlay onClick={close}>
      <div className="card w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h2 className="font-semibold">{isEdit ? t("mt.editOutsourcedJob", lang) : t("mt.newOutsourcedJob", lang)}</h2>
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
              <label className="text-xs muted block mb-1">{t("common.truck", lang)} *</label>
              <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={isEdit}>
                {trucks.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.plate} · {tr.model ?? ""}</option>
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
              <label className="text-xs muted block mb-1">{t("mt.responsibleMechanic", lang)} *</label>
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
              <label className="text-xs muted block mb-1">{t("mt.startDate", lang)} *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.estimatedFinish", lang)} *</label>
              <input type="date" value={estimatedFinish} onChange={(e) => setEstimatedFinish(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs muted !mb-0">{t("mt.repairers", lang)} *</label>
              <Btn variant="outline" onClick={() => { setRepairerBeingEdited(null); setRepairerFormOpen(true); }} className="!h-7 !px-2.5 text-xs">
                <Plus className="h-3.5 w-3.5" />{t("mt.newRepairerBtn", lang)}
              </Btn>
            </div>
            {selectedRepairerIds.length === 0 && (
              <div className="rounded-lg px-3 py-2 mb-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
                {t("mt.selectAtLeastOneRepairer", lang)}
              </div>
            )}
            <div className="rounded-lg border overflow-hidden" style={INPUT_STYLE}>
              <div className="max-h-[220px] overflow-y-auto scrollbar-thin divide-y" style={{ borderColor: "rgb(var(--border))" }}>
                {allRepairers.length === 0 ? (
                  <p className="text-xs muted p-3">—</p>
                ) : (
                  allRepairers.map((r) => {
                    const on = selectedRepairerIds.includes(r.id);
                    const rt = r.type ? repairerTypesById.get(r.type) : null;
                    return (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                        <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                          <input type="checkbox" checked={on} onChange={() => toggleRepairer(r.id)} />
                          <span className="font-medium truncate">{lang === "ar" ? r.name_ar || r.name : r.name}</span>
                          {rt && <span className="text-[11px] muted shrink-0">{lang === "ar" ? rt.label_ar || rt.label_en : rt.label_en}</span>}
                          {r.location && <span className="text-[11px] muted ms-auto shrink-0">{r.location}</span>}
                        </label>
                        <button
                          type="button"
                          onClick={() => { setRepairerBeingEdited(r); setRepairerFormOpen(true); }}
                          className="h-6 w-6 rounded grid place-items-center hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
                          title={t("mt.edit", lang)}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmDeleteRepairer(r.id)}
                          disabled={deletingRepairerId === r.id}
                          className="h-6 w-6 rounded grid place-items-center hover:bg-rose-500/10 text-rose-600 shrink-0"
                          title={t("mt.delete", lang)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
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
        </div>

        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={close} disabled={saving}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={!canSubmit}>{saving ? "…" : t("common.save", lang)}</Btn>
        </div>
      </div>

      {repairerFormOpen && (
        <RepairerFormModal
          lang={lang}
          repairerTypes={repairerTypes}
          editingRepairer={repairerBeingEdited}
          onClose={() => { setRepairerFormOpen(false); setRepairerBeingEdited(null); }}
          onSaved={onRepairerSaved}
        />
      )}
    </ModalOverlay>
  );
}
