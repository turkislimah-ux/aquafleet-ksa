"use client";

// Repairer add/edit — a CLEAN, SEPARATE popup (Turki's explicit ask),
// nested on top of the New/Edit Outsourced Job modal that opens it, rather
// than an inline expanding mini-form. One component handles both create
// AND edit via the optional `editingRepairer` prop — same "one modal, edit
// prop" convention every other dual-purpose modal in this app uses.
// Higher z-index than its parent so it visibly layers above it.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { X, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Btn } from "@/components/ui";
import type { RepairerType, Repairer } from "@/lib/db-types";
import { addRepairer, updateRepairer, addRepairerType } from "./osActions";
import ScrollLock from "@/components/ScrollLock";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

function ModalOverlay({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/50" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <ScrollLock />
      {children}
    </div>,
    document.body,
  );
}

export default function RepairerFormModal({
  lang,
  repairerTypes,
  editingRepairer,
  onClose,
  onSaved,
}: {
  lang: "en" | "ar";
  repairerTypes: RepairerType[];
  editingRepairer?: Repairer | null;
  onClose: () => void;
  onSaved: (repairer: Repairer, newType?: RepairerType) => void;
}) {
  const isEdit = !!editingRepairer;

  const [name, setName] = useState(editingRepairer?.name ?? "");
  const [nameAr, setNameAr] = useState(editingRepairer?.name_ar ?? "");
  const [location, setLocation] = useState(editingRepairer?.location ?? "");
  const [typeId, setTypeId] = useState(editingRepairer?.type ?? repairerTypes[0]?.id ?? "");
  const [contactName, setContactName] = useState(editingRepairer?.contact_name ?? "");
  const [contactNumber, setContactNumber] = useState(editingRepairer?.contact_number ?? "");
  const [description, setDescription] = useState(editingRepairer?.description ?? "");

  const [localTypes, setLocalTypes] = useState<RepairerType[]>([]);
  const [newTypeText, setNewTypeText] = useState("");
  const [addingType, setAddingType] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTypes = useMemo(() => {
    const ids = new Set(repairerTypes.map((rt) => rt.id));
    return [...repairerTypes, ...localTypes.filter((rt) => !ids.has(rt.id))];
  }, [repairerTypes, localTypes]);

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
    setLocalTypes((prev) => [...prev, res.type!]);
    setTypeId(res.type.id);
    setNewTypeText("");
  }

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);

    const input = {
      name: trimmedName,
      name_ar: nameAr || null,
      location: location || null,
      type: typeId || null,
      contact_name: contactName || null,
      contact_number: contactNumber || null,
      description: description || null,
    };

    const res = isEdit && editingRepairer
      ? await updateRepairer(editingRepairer.id, input)
      : await addRepairer(input);

    setSaving(false);
    if (res.error || !res.repairer) {
      setError(res.error ?? "Could not save repairer.");
      return;
    }
    onSaved(res.repairer);
  }

  return (
    <ModalOverlay onClick={close}>
      <div className="card w-full max-w-[560px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h2 className="font-semibold">{isEdit ? t("mt.editRepairer", lang) : t("mt.newRepairerBtn", lang)}</h2>
          <button onClick={close} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{lang === "en" ? "Name" : "الاسم"} *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{lang === "en" ? "Name (Arabic)" : "الاسم بالعربية"}</span>
              <input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{t("mt.location", lang)}</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{t("mt.repairerType", lang)}</span>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                {allTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>{lang === "ar" ? rt.label_ar || rt.label_en : rt.label_en}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{t("mt.contactName", lang)}</span>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
            <label className="text-sm">
              <span className="text-xs muted block mb-1">{t("mt.contactNumber", lang)}</span>
              <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
          </div>

          <label className="text-sm block">
            <span className="text-xs muted block mb-1">{lang === "en" ? "Description" : "الوصف"}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={cn(INPUT, "resize-none")} style={INPUT_STYLE} />
          </label>

          <div className="flex gap-2 items-center pt-1 border-t" style={{ borderColor: "rgb(var(--border))" }}>
            <input
              placeholder={t("mt.newRepairerType", lang)}
              value={newTypeText}
              onChange={(e) => setNewTypeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewType(); } }}
              className={cn(INPUT, "flex-1 mt-2")}
              style={INPUT_STYLE}
            />
            <Btn variant="outline" onClick={addNewType} disabled={addingType || !newTypeText.trim()} className="mt-2">
              <Plus className="h-3.5 w-3.5" />{t("common.add", lang)}
            </Btn>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={close} disabled={saving}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || !name.trim()}>{saving ? "…" : t("common.save", lang)}</Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
