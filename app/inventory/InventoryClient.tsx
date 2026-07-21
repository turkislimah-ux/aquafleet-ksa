"use client";

// Inventory page — Slice 2 (warehouses layer) + Slice 3 (parts layer).
// Tab strip mirrors preview/'s pill style (preview/app.css .inv-tabs/.inv-tab,
// preview/pages-2.js's invInventoryView) via this app's own brand-600 token
// (no preview/ CSS import — preview/ is read-only spec, not a stylesheet
// dependency). KPI row + parts table + filters mirror invInventoryView, minus
// the PO-phase KPIs (Open POs / Pending Approvals — dropped, out of scope).
//
// Stock-tier coloring mirrors preview/'s INV.stockCell: critical (qty <=
// reorder) / mid (qty <= 1.5x reorder) / ok, using this app's existing
// emerald/amber/rose token convention (see lib/db-types.ts's STAGE_STYLES for
// the same 3-tone pattern elsewhere in the app). Parts with no reorder_level
// are never "low" — plain/neutral stock cell.
//
// Create/edit flows mirror WaterStationsModal.tsx's StationForm: local
// INPUT/INPUT_STYLE consts, server action + router.refresh() (no optimistic
// state, no client re-fetch).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Warehouse as WarehouseIcon,
  X,
  Package,
  Pencil,
  Search,
} from "lucide-react";
import { useApp } from "@/components/AppShell";
import { PageHeader, Btn, Stat, Table, TH, TD, Card } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import type { Warehouse, Part } from "@/lib/db-types";
import {
  createWarehouse,
  createPart,
  updatePart,
  type WarehouseInput,
  type PartInput,
} from "./actions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

type StockTier = "ok" | "low" | "critical" | null;

function stockTier(part: Part): StockTier {
  if (part.reorder_level == null) return null;
  if (part.qty_on_hand <= part.reorder_level) return "critical";
  if (part.qty_on_hand <= part.reorder_level * 1.5) return "low";
  return "ok";
}

const TIER_TEXT: Record<Exclude<StockTier, null>, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  low: "text-amber-700 dark:text-amber-400",
  critical: "text-rose-700 dark:text-rose-400",
};
const TIER_DOT: Record<Exclude<StockTier, null>, string> = {
  ok: "bg-emerald-500",
  low: "bg-amber-500",
  critical: "bg-rose-500",
};

export default function InventoryClient({
  warehouses,
  parts,
  error,
}: {
  warehouses: Warehouse[];
  parts: Part[];
  error: string | null;
}) {
  const { lang } = useApp();
  const [activeTab, setActiveTab] = useState<string>("all"); // "all" | warehouse.id
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [partModal, setPartModal] = useState<{ editing: Part | null } | null>(null);

  const warehousesById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  // Tab-scoped set — feeds KPIs, category chips, AND the table (further cut
  // by search/category below). "All" = every active part.
  const tabParts = useMemo(
    () => (activeTab === "all" ? parts : parts.filter((p) => p.warehouse_id === activeTab)),
    [parts, activeTab]
  );

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of tabParts) if (p.category) s.add(p.category);
    return Array.from(s).sort();
  }, [tabParts]);

  // Reset a stale category filter when switching tabs makes it disappear.
  const effectiveCat = categories.includes(cat) ? cat : "all";

  const visibleParts = useMemo(() => {
    return tabParts.filter((p) => {
      if (effectiveCat !== "all" && p.category !== effectiveCat) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${p.name} ${p.sku} ${p.name_ar ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [tabParts, effectiveCat, q]);

  // KPIs — scoped to the active tab, NOT the search/category filters (same
  // as preview/'s KPI row, which doesn't react to invFilters either).
  const inventoryValue = tabParts.reduce(
    (s, p) => s + (p.unit_cost_sar != null ? p.unit_cost_sar * p.qty_on_hand : 0),
    0
  );
  const skuCount = tabParts.length;
  const lowStockCount = tabParts.filter(
    (p) => p.reorder_level != null && p.qty_on_hand <= p.reorder_level
  ).length;

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    for (const p of parts) if (p.category) s.add(p.category);
    return Array.from(s).sort();
  }, [parts]);

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
          <>
            <Btn variant="outline" onClick={() => setWarehouseModalOpen(true)}>
              <Plus className="h-4 w-4" />
              {lang === "en" ? "Create Warehouse" : "إنشاء مستودع"}
            </Btn>
            {warehouses.length > 0 && (
              <Btn variant="primary" onClick={() => setPartModal({ editing: null })}>
                <Plus className="h-4 w-4" />
                {lang === "en" ? "Add Part" : "إضافة قطعة"}
              </Btn>
            )}
          </>
        }
      />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {warehouses.length === 0 ? (
        <EmptyWarehouseState lang={lang} onCreate={() => setWarehouseModalOpen(true)} />
      ) : (
        <>
          <WarehouseTabs
            warehouses={warehouses}
            active={activeTab}
            onSelect={setActiveTab}
            lang={lang}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label={lang === "en" ? "Inventory Value" : "قيمة المخزون"}
              value={formatSar(inventoryValue)}
              tone="info"
            />
            <Stat label={lang === "en" ? "SKUs" : "أصناف"} value={skuCount} />
            <Stat
              label={lang === "en" ? "Low Stock" : "مخزون منخفض"}
              value={lowStockCount}
              tone={lowStockCount > 0 ? "bad" : "ok"}
            />
          </div>

          <Card className="!p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-4 w-4 muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={lang === "en" ? "Search part name, SKU…" : "بحث بالاسم أو الرمز…"}
                  className="h-9 pl-8 pr-3 rounded-lg border text-sm w-full"
                  style={INPUT_STYLE}
                />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => setCat("all")}
                  className={cn(
                    "h-9 px-2.5 rounded-lg text-[11px] font-medium border",
                    effectiveCat === "all" ? "bg-brand-600 text-white border-brand-600" : ""
                  )}
                  style={effectiveCat !== "all" ? { borderColor: "rgb(var(--border))" } : undefined}
                >
                  {lang === "en" ? "All" : "الكل"}
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    className={cn(
                      "h-9 px-2.5 rounded-lg text-[11px] font-medium border capitalize",
                      effectiveCat === c ? "bg-brand-600 text-white border-brand-600" : ""
                    )}
                    style={effectiveCat !== c ? { borderColor: "rgb(var(--border))" } : undefined}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <PartsTable
            parts={visibleParts}
            warehousesById={warehousesById}
            lang={lang}
            onEdit={(p) => setPartModal({ editing: p })}
          />
        </>
      )}

      {warehouseModalOpen && (
        <CreateWarehouseModal lang={lang} onClose={() => setWarehouseModalOpen(false)} />
      )}

      {partModal && (
        <PartFormModal
          lang={lang}
          editing={partModal.editing}
          warehouses={warehouses}
          defaultWarehouseId={activeTab !== "all" ? activeTab : ""}
          categorySuggestions={allCategories}
          onClose={() => setPartModal(null)}
        />
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

function EmptyWarehouseState({ lang, onCreate }: { lang: "en" | "ar"; onCreate: () => void }) {
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

function StockCell({ part, lang }: { part: Part; lang: "en" | "ar" }) {
  const tier = stockTier(part);
  return (
    <div className="flex flex-col gap-0.5 min-w-[6rem]">
      <div className={cn("flex items-baseline gap-1.5", tier ? TIER_TEXT[tier] : "")}>
        {tier && <span className={cn("h-1.5 w-1.5 rounded-full self-center", TIER_DOT[tier])} />}
        <span className="text-[15px] font-bold tabular-nums">{part.qty_on_hand}</span>
        <span className="text-[10px] uppercase font-medium muted">{part.unit ?? ""}</span>
      </div>
      {part.reorder_level != null && (
        <span className="text-[10px] muted">
          {lang === "en" ? "reorder at" : "إعادة الطلب عند"} {part.reorder_level}
        </span>
      )}
    </div>
  );
}

function PartsTable({
  parts,
  warehousesById,
  lang,
  onEdit,
}: {
  parts: Part[];
  warehousesById: Map<string, Warehouse>;
  lang: "en" | "ar";
  onEdit: (p: Part) => void;
}) {
  return (
    <Card className="!p-0 overflow-hidden">
      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr>
            <TH>{lang === "en" ? "SKU" : "الرمز"}</TH>
            <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
            <TH>{lang === "en" ? "Category" : "الفئة"}</TH>
            <TH>{lang === "en" ? "Warehouse" : "المستودع"}</TH>
            <TH>{lang === "en" ? "Stock" : "المخزون"}</TH>
            <TH>{lang === "en" ? "Unit Cost" : "تكلفة الوحدة"}</TH>
            <TH>{lang === "en" ? "Stock Value" : "قيمة المخزون"}</TH>
            <TH></TH>
          </tr>
        </thead>
        <tbody>
          {parts.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                {lang === "en" ? "No parts in this warehouse yet." : "لا توجد قطع في هذا المستودع بعد."}
              </td>
            </tr>
          )}
          {parts.map((p) => {
            const tier = stockTier(p);
            const stockValue = p.unit_cost_sar != null ? p.unit_cost_sar * p.qty_on_hand : null;
            const warehouseName = warehousesById.get(p.warehouse_id)?.name ?? "—";
            const secondaryName = lang === "ar" ? p.name : p.name_ar;
            return (
              <tr
                key={p.id}
                className={cn(
                  "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
                  tier === "critical" ? "bg-rose-500/[0.04]" : ""
                )}
              >
                <TD className="font-mono text-xs">{p.sku}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 muted" />
                    <div>
                      <div className="font-medium">{lang === "ar" ? p.name_ar ?? p.name : p.name}</div>
                      {secondaryName && <div className="text-[11px] muted">{secondaryName}</div>}
                    </div>
                  </div>
                </TD>
                <TD className="capitalize">{p.category ?? "—"}</TD>
                <TD>{warehouseName}</TD>
                <TD>
                  <StockCell part={p} lang={lang} />
                </TD>
                <TD className="tabular-nums">{p.unit_cost_sar != null ? formatSar(p.unit_cost_sar) : "—"}</TD>
                <TD className="tabular-nums font-medium">{stockValue != null ? formatSar(stockValue) : "—"}</TD>
                <TD className="text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(p)}
                    title={lang === "en" ? "Edit" : "تعديل"}
                    className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
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

// Numeric field helper — text input backed by a string (so an empty field is
// distinguishable from 0), parsed to number|null on submit. Blocks minus-sign
// entry so negatives can never even be typed.
function useNumField(initial: number | null | undefined) {
  return useState(initial != null ? String(initial) : "");
}

function parseNumField(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function PartFormModal({
  lang,
  editing,
  warehouses,
  defaultWarehouseId,
  categorySuggestions,
  onClose,
}: {
  lang: "en" | "ar";
  editing: Part | null;
  warehouses: Warehouse[];
  defaultWarehouseId: string;
  categorySuggestions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [sku, setSku] = useState(editing?.sku ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [nameAr, setNameAr] = useState(editing?.name_ar ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [unitCost, setUnitCost] = useNumField(editing?.unit_cost_sar);
  const [qtyOnHand, setQtyOnHand] = useNumField(editing?.qty_on_hand ?? 0);
  const [reorderLevel, setReorderLevel] = useNumField(editing?.reorder_level);
  const [reorderQty, setReorderQty] = useNumField(editing?.reorder_qty);
  const [leadTime, setLeadTime] = useNumField(editing?.lead_time_days);
  const [supplier, setSupplier] = useState(editing?.supplier ?? "");
  const [warehouseId, setWarehouseId] = useState(editing?.warehouse_id ?? defaultWarehouseId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = sku.trim() !== "" && name.trim() !== "" && warehouseId !== "";

  function close() {
    if (saving) return;
    onClose();
  }

  function blockNegative(raw: string) {
    return raw.replace(/-/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError(
        lang === "en" ? "SKU, name, and warehouse are required." : "الرمز والاسم والمستودع مطلوبة."
      );
      return;
    }
    const input: PartInput = {
      sku: sku.trim(),
      name: name.trim(),
      name_ar: nameAr.trim() || null,
      category: category.trim() || null,
      unit: unit.trim() || null,
      unit_cost_sar: parseNumField(unitCost),
      qty_on_hand: parseNumField(qtyOnHand) ?? 0,
      reorder_level: parseNumField(reorderLevel),
      reorder_qty: parseNumField(reorderQty),
      lead_time_days: parseNumField(leadTime),
      supplier: supplier.trim() || null,
      warehouse_id: warehouseId,
    };
    setSaving(true);
    setError(null);
    const res = editing ? await updatePart(editing.id, input) : await createPart(input);
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
        className="card p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">
              {editing
                ? lang === "en" ? "Edit part" : "تعديل القطعة"
                : lang === "en" ? "Add part" : "إضافة قطعة"}
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "SKU *" : "الرمز *"}</span>
              <input value={sku} onChange={(e) => setSku(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Warehouse *" : "المستودع *"}</span>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
              >
                <option value="" disabled>
                  {lang === "en" ? "Pick a warehouse…" : "اختر مستودعًا…"}
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name *" : "الاسم *"}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name (Arabic)" : "الاسم (عربي)"}</span>
              <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={INPUT} style={INPUT_STYLE} dir="rtl" />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Category" : "الفئة"}</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                list="part-category-suggestions"
                placeholder={lang === "en" ? "e.g. filter" : "مثال: فلتر"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit" : "الوحدة"}</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder="e.g. ea, L, set" />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit Cost (SAR)" : "تكلفة الوحدة (ر.س)"}</span>
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Qty on hand" : "الكمية المتوفرة"}</span>
              <input
                value={qtyOnHand}
                onChange={(e) => setQtyOnHand(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder level" : "حد إعادة الطلب"}</span>
              <input
                value={reorderLevel}
                onChange={(e) => setReorderLevel(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder qty" : "كمية إعادة الطلب"}</span>
              <input
                value={reorderQty}
                onChange={(e) => setReorderQty(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Lead time (days)" : "وقت التوريد (أيام)"}</span>
              <input
                value={leadTime}
                onChange={(e) => setLeadTime(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Supplier" : "المورد"}</span>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </label>
          </div>

          <datalist id="part-category-suggestions">
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

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
                : editing
                ? lang === "en" ? "Save changes" : "حفظ التغييرات"
                : lang === "en" ? "Add part" : "إضافة القطعة"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
