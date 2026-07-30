"use client";

// New / Edit Outsourced Job — Turki's spec is the behavioral source of
// truth (create/scheduled/in-progress/historical/table points), preview/'s
// own outsourced-job code is the source for anything he didn't respecify
// (type enum reuse, etc.). One component handles both create AND edit (via
// the optional `editingJob` prop) — same "one modal, edit prop" convention
// NewWorkOrderModal (in-house) and Inventory's NewPOModal already
// established.
//
// TRUCK IS IMMUTABLE ON EDIT — a job's truck is fixed once created (Turki's
// call, migration 0069's edit_outsourced_job doesn't accept it at all).
// The truck picker is disabled once editingJob is set, same UX as
// NewWorkOrderModal's own truck-locked-on-edit pattern.
//
// REPAIRERS — MANY per job (checkbox list, not a single picker), each with
// an inline "+ New repairer" mini-form (which itself has an inline
// "+ New type" for the managed repairer_types lookup) — mirrors the
// description-chip catalog's own inline-add pattern already established
// for repair_descriptions/outsourced_descriptions.

import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Plus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, todayKey } from "@/lib/utils";
import { Btn } from "@/components/ui";
import type { Truck, Staff, RepairerType, Repairer, OutsourcedDescription, OutsourcedJob } from "@/lib/db-types";
import {
  createOutsourcedJob,
  editOutsourcedJob,
  addRepairer,
  addRepairerType,
  addOutsourcedDescription,
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

const TYPES = ["preventive", "corrective", "inspection", "predictive"] as const;

export default function NewOutsourcedJobModal({
  lang,
  trucks,
  mechanics,
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
  const [mechanicId, setMechanicId] = useState(editingJob?.responsible_mechanic_id ?? mechanics[0]?.id ?? "");
  const [type, setType] = useState<(typeof TYPES)[number]>((editingJob?.type as (typeof TYPES)[number]) ?? "corrective");
  const [startDate, setStartDate] = useState(editingJob?.start_date ?? todayKey());
  const [estimatedFinish, setEstimatedFinish] = useState(editingJob?.estimated_finish ?? todayKey());

  const [localRepairers, setLocalRepairers] = useState<Repairer[]>([]);
  const [selectedRepairerIds, setSelectedRepairerIds] = useState<string[]>(editingRepairerIds ?? []);
  const [addingRepairer, setAddingRepairer] = useState(false);
  const [newRepairerName, setNewRepairerName] = useState("");
  const [newRepairerNameAr, setNewRepairerNameAr] = useState("");
  const [newRepairerLocation, setNewRepairerLocation] = useState("");
  const [newRepairerTypeId, setNewRepairerTypeId] = useState(repairerTypes[0]?.id ?? "");
  const [newRepairerContactName, setNewRepairerContactName] = useState("");
  const [newRepairerContactNumber, setNewRepairerContactNumber] = useState("");
  const [localRepairerTypes, setLocalRepairerTypes] = useState<RepairerType[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [newTypeText, setNewTypeText] = useState("");
  const [savingRepairer, setSavingRepairer] = useState(false);

  const [localDescriptions, setLocalDescriptions] = useState<OutsourcedDescription[]>([]);
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>(() => {
    if (!editingTasks || editingTasks.length === 0) return [];
    return outsourcedDescriptions
      .filter((d) => editingTasks.some((tk) => tk.description_en === d.en))
      .map((d) => d.id);
  });
  const [newChipText, setNewChipText] = useState("");
  const [addingChip, setAddingChip] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRepairerTypes = useMemo(() => {
    const ids = new Set(repairerTypes.map((rt) => rt.id));
    return [...repairerTypes, ...localRepairerTypes.filter((rt) => !ids.has(rt.id))];
  }, [repairerTypes, localRepairerTypes]);

  const allRepairers = useMemo(() => {
    const ids = new Set(repairers.map((r) => r.id));
    return [...repairers, ...localRepairers.filter((r) => !ids.has(r.id))];
  }, [repairers, localRepairers]);

  const repairerTypesById = useMemo(() => new Map(allRepairerTypes.map((rt) => [rt.id, rt])), [allRepairerTypes]);

  const allDescriptions = useMemo(() => {
    const ids = new Set(outsourcedDescriptions.map((d) => d.id));
    return [...outsourcedDescriptions, ...localDescriptions.filter((d) => !ids.has(d.id))];
  }, [outsourcedDescriptions, localDescriptions]);

  const selectedTruck = trucks.find((tr) => tr.id === truckId) ?? null;

  function toggleRepairer(id: string) {
    setSelectedRepairerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addNewType() {
    const text = newTypeText.trim();
    if (!text || addingType) return;
    setAddingType(true);
    const res = await addRepairerType(text, "");
    setAddingType(false);
    if (res.error || !res.type) {
      setError(res.error ?? "Could not add type.");
      return;
    }
    setLocalRepairerTypes((prev) => [...prev, res.type!]);
    setNewRepairerTypeId(res.type.id);
    setNewTypeText("");
  }

  async function saveNewRepairer() {
    const name = newRepairerName.trim();
    if (!name || savingRepairer) return;
    setSavingRepairer(true);
    setError(null);
    const res = await addRepairer({
      name,
      name_ar: newRepairerNameAr || null,
      location: newRepairerLocation || null,
      type: newRepairerTypeId || null,
      contact_name: newRepairerContactName || null,
      contact_number: newRepairerContactNumber || null,
      description: null,
    });
    setSavingRepairer(false);
    if (res.error || !res.repairer) {
      setError(res.error ?? "Could not add repairer.");
      return;
    }
    setLocalRepairers((prev) => [...prev, res.repairer!]);
    setSelectedRepairerIds((prev) => [...prev, res.repairer!.id]);
    setNewRepairerName("");
    setNewRepairerNameAr("");
    setNewRepairerLocation("");
    setNewRepairerContactName("");
    setNewRepairerContactNumber("");
    setAddingRepairer(false);
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
      setSaving(false);
      if (res.error || !res.job) {
        setError(res.error ?? "Could not save changes.");
        return;
      }
      onEdited?.(res.job);
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
      <div className="card w-full max-w-[900px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
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
              <label className="text-xs muted block mb-1">{t("common.truck", lang)}</label>
              <select value={truckId} onChange={(e) => setTruckId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={isEdit}>
                {trucks.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.plate} · {tr.model ?? ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">
                {t("common.title", lang)} <span className="muted text-[10px]">({t("mt.titleAuto", lang)})</span>
              </label>
              <input readOnly value={selectedTruck ? `Outsource — ${selectedTruck.plate}` : ""} className={cn(INPUT, "opacity-70")} style={INPUT_STYLE} />
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
              <label className="text-xs muted block mb-1">{t("mt.responsibleMechanic", lang)}</label>
              <select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={mechanics.length === 0}>
                {mechanics.map((m) => (
                  <option key={m.id} value={m.id}>{lang === "ar" ? m.name_ar || m.name : m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.startDate", lang)}</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="text-xs muted block mb-1">{t("mt.estimatedFinish", lang)}</label>
              <input type="date" value={estimatedFinish} onChange={(e) => setEstimatedFinish(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs muted !mb-0">{t("mt.repairers", lang)}</label>
              {selectedRepairerIds.length === 0 && (
                <span className="text-[11px] text-rose-600">{t("mt.selectAtLeastOneRepairer", lang)}</span>
              )}
            </div>
            <div className="rounded-lg border overflow-hidden" style={INPUT_STYLE}>
              <div className="max-h-[180px] overflow-y-auto scrollbar-thin divide-y" style={{ borderColor: "rgb(var(--border))" }}>
                {allRepairers.length === 0 ? (
                  <p className="text-xs muted p-3">—</p>
                ) : (
                  allRepairers.map((r) => {
                    const on = selectedRepairerIds.includes(r.id);
                    const rt = r.type ? repairerTypesById.get(r.type) : null;
                    return (
                      <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
                        <input type="checkbox" checked={on} onChange={() => toggleRepairer(r.id)} />
                        <span className="font-medium">{lang === "ar" ? r.name_ar || r.name : r.name}</span>
                        {rt && <span className="text-[11px] muted">{lang === "ar" ? rt.label_ar || rt.label_en : rt.label_en}</span>}
                        {r.location && <span className="text-[11px] muted ms-auto">{r.location}</span>}
                      </label>
                    );
                  })
                )}
              </div>
              <div className="border-t p-2" style={{ borderColor: "rgb(var(--border))" }}>
                {!addingRepairer ? (
                  <button type="button" onClick={() => setAddingRepairer(true)} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                    <Plus className="h-3 w-3" />{t("mt.newRepairer", lang)}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder={lang === "en" ? "Name *" : "الاسم *"} value={newRepairerName} onChange={(e) => setNewRepairerName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                      <input placeholder={lang === "en" ? "Name (Arabic)" : "الاسم بالعربية"} dir="rtl" value={newRepairerNameAr} onChange={(e) => setNewRepairerNameAr(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                      <input placeholder={t("mt.location", lang)} value={newRepairerLocation} onChange={(e) => setNewRepairerLocation(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                      <div className="flex gap-1">
                        <select value={newRepairerTypeId} onChange={(e) => setNewRepairerTypeId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                          {allRepairerTypes.map((rt) => (
                            <option key={rt.id} value={rt.id}>{lang === "ar" ? rt.label_ar || rt.label_en : rt.label_en}</option>
                          ))}
                        </select>
                      </div>
                      <input placeholder={t("mt.contactName", lang)} value={newRepairerContactName} onChange={(e) => setNewRepairerContactName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                      <input placeholder={t("mt.contactNumber", lang)} value={newRepairerContactNumber} onChange={(e) => setNewRepairerContactNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        placeholder={t("mt.newRepairerType", lang)}
                        value={newTypeText}
                        onChange={(e) => setNewTypeText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewType(); } }}
                        className={cn(INPUT, "flex-1")}
                        style={INPUT_STYLE}
                      />
                      <Btn variant="outline" onClick={addNewType} disabled={addingType || !newTypeText.trim()}>{t("common.add", lang)}</Btn>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Btn variant="outline" onClick={() => setAddingRepairer(false)} disabled={savingRepairer}>{t("common.cancel", lang)}</Btn>
                      <Btn variant="primary" onClick={saveNewRepairer} disabled={savingRepairer || !newRepairerName.trim()}>{savingRepairer ? "…" : t("common.save", lang)}</Btn>
                    </div>
                  </div>
                )}
              </div>
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
        </div>

        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={close} disabled={saving}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={!canSubmit}>{saving ? "…" : t("common.save", lang)}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
