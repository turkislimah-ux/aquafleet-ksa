"use client";

// Inventory page — Slice 2 (warehouses layer). Tab strip mirrors preview/'s
// pill style (preview/app.css .inv-tabs/.inv-tab, preview/pages-2.js
// ~3043-3048) via this app's own brand-600 token (no preview/ CSS import —
// preview/ is read-only spec, not a stylesheet dependency). KPI + parts areas
// are placeholders — Slice 3+ wires real numbers/rows once parts exist.
//
// Create-warehouse flow mirrors WaterStationsModal.tsx's StationForm: local
// INPUT/INPUT_STYLE consts, server action + router.refresh() (no optimistic
// state, no client re-fetch) — new tab appears because the server component
// re-fetches warehouses on refresh.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Warehouse as WarehouseIcon, X, Boxes } from "lucide-react";
import { useApp } from "@/components/AppShell";
import { PageHeader, Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Warehouse } from "@/lib/db-types";
import { createWarehouse, type WarehouseInput } from "./actions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function InventoryClient({
  warehouses,
  error,
}: {
  warehouses: Warehouse[];
  error: string | null;
}) {
  const { lang } = useApp();
  const [activeTab, setActiveTab] = useState<string>("all"); // "all" | warehouse.id — filtering wired in Slice 3
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "en" ? "Inventory" : "المخزون"}
        subtitle={
          lang === "en"
            ? "Warehouses, parts & stock levels"
            : "المستودعات وقطع الغيار ومستويات المخزون"
        }
        actions={
          <Btn variant="primary" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {lang === "en" ? "Create Warehouse" : "إنشاء مستودع"}
          </Btn>
        }
      />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {warehouses.length === 0 ? (
        <EmptyState lang={lang} onCreate={() => setModalOpen(true)} />
      ) : (
        <>
          <WarehouseTabs
            warehouses={warehouses}
            active={activeTab}
            onSelect={setActiveTab}
            lang={lang}
          />

          {/* KPI area — placeholder until parts land (Slice 3+). */}
          <div
            className="rounded-xl border p-6 text-center text-sm muted"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            {lang === "en"
              ? "Inventory KPIs (SKUs, value, low stock) arrive with parts."
              : "مؤشرات المخزون (الأصناف، القيمة، النقص) تظهر مع إضافة القطع."}
          </div>

          {/* Parts area — placeholder until parts land (Slice 3+). */}
          <div
            className="rounded-xl border p-10 flex flex-col items-center justify-center gap-2 text-center"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <Boxes className="h-6 w-6 muted" />
            <p className="text-sm muted">
              {lang === "en"
                ? "No parts yet — the parts list arrives in a later slice."
                : "لا توجد قطع بعد — قائمة القطع تصل في مرحلة لاحقة."}
            </p>
          </div>
        </>
      )}

      {modalOpen && (
        <CreateWarehouseModal lang={lang} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}

function WarehouseTabs({
  warehouses,
  active,
  onSelect,
  lang,
}: {
  warehouses: Warehouse[];
  active: string;
  onSelect: (id: string) => void;
  lang: "en" | "ar";
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 p-1 rounded-xl border"
      style={{ background: "rgb(var(--card))", borderColor: "rgb(var(--border))" }}
    >
      <button
        type="button"
        onClick={() => onSelect("all")}
        className={cn(
          "px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors",
          active === "all" ? "bg-brand-600 text-white shadow-sm" : "muted hover:text-[rgb(var(--fg))]"
        )}
      >
        {lang === "en" ? "All" : "الكل"}
      </button>
      {warehouses.map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => onSelect(w.id)}
          className={cn(
            "px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors",
            active === w.id ? "bg-brand-600 text-white shadow-sm" : "muted hover:text-[rgb(var(--fg))]"
          )}
        >
          {w.name}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ lang, onCreate }: { lang: "en" | "ar"; onCreate: () => void }) {
  return (
    <div
      className="rounded-xl border p-12 flex flex-col items-center justify-center gap-3 text-center"
      style={{ borderColor: "rgb(var(--border))" }}
    >
      <WarehouseIcon className="h-8 w-8 muted" />
      <div>
        <p className="font-medium">
          {lang === "en" ? "No warehouses yet" : "لا توجد مستودعات بعد"}
        </p>
        <p className="text-sm muted mt-1">
          {lang === "en"
            ? "Create your first warehouse to start tracking parts and stock."
            : "أنشئ أول مستودع لبدء تتبع القطع والمخزون."}
        </p>
      </div>
      <Btn variant="primary" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {lang === "en" ? "Create your first warehouse" : "إنشاء أول مستودع"}
      </Btn>
    </div>
  );
}

function CreateWarehouseModal({
  lang,
  onClose,
}: {
  lang: "en" | "ar";
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== "";

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError(lang === "en" ? "Warehouse name is required." : "اسم المستودع مطلوب.");
      return;
    }
    const input: WarehouseInput = {
      name: name.trim(),
      location: location.trim() || null,
      type: type.trim() || null,
      note: note.trim() || null,
    };
    setSaving(true);
    setError(null);
    const res = await createWarehouse(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "Create warehouse" : "إنشاء مستودع"}
            </h2>
            <button
              type="button"
              onClick={close}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name *" : "الاسم *"}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder={lang === "en" ? "e.g. Riyadh Depot" : "مثال: مستودع الرياض"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Location" : "الموقع"}</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={lang === "en" ? "e.g. Riyadh" : "مثال: الرياض"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Type" : "النوع"}</span>
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={lang === "en" ? "e.g. Main depot" : "مثال: مستودع رئيسي"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Note" : "ملاحظة"}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                rows={2}
              />
            </label>
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={close}>
              {lang === "en" ? "Cancel" : "إلغاء"}
            </Btn>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            >
              {saving
                ? lang === "en" ? "Saving…" : "جارٍ الحفظ…"
                : lang === "en" ? "Create warehouse" : "إنشاء المستودع"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
