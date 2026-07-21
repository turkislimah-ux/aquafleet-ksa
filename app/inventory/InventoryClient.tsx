"use client";

// Inventory page — rebuilt AGAIN against preview/'s Inventory page (pages-2.js
// inventoryPage/invInventoryView/openPart/openNewPart + app.css), Slices 2+3
// (warehouses/parts) + Slice 4 (stock_movements ledger, migration 0044 — LIVE).
//
// This pass is a stricter re-mirror after a re-audit of preview/'s actual
// source. Everything below with no preview/ equivalent was hard-deleted, not
// hidden:
//   - EDIT FLOW — DELETED ENTIRELY. Re-confirmed by direct source read:
//     preview/ has NO edit-part UI anywhere. Parts are only ever created
//     (INV.openNewPart, buried inside the Add-Parts/PO draft) or changed via
//     openPriceLot (adds a new FIFO price tier — a table we don't have,
//     flagged below). There is no "change a part's fields after creation"
//     concept in preview/ at all. `updatePart()` is deleted from actions.ts
//     too (dead code once the UI is gone) — not just hidden.
//   - Drawer-footer "Receive Stock" button — DELETED. Preview's own
//     openPart() footer is Close + conditional Create-PO ONLY, nothing else.
//     Receive Stock now has exactly ONE entry point: the header button
//     (closest analog of preview's header "Add Parts" action).
//   - Category chips + Add-Part category/unit — were DYNAMIC (derived from
//     live data) last pass; that was still a deviation preview doesn't do.
//     Reverted to preview's own FIXED lists, verbatim:
//       filter chips  = invInventoryView's CATS (engine/brake/tire/fluid/
//                       electrical/tank/filter/consumable + All)
//       create-form   = openNewPart's cats (adds "equipment", 9 total) +
//                       openNewPart's units (ea/L/set/kg/m) — both preview's
//                       own hardcoded option lists, not invented, not dynamic.
//   - Add Part form fields — trimmed to match openNewPart's actual field set
//     (name, name_ar, sku, category, unit, unit price, reorder level, reorder
//     qty). Two fields removed vs the previous pass:
//       - Supplier — preview's create flow has no supplier field; supplier is
//         only ever assigned later, at receipt time, via a supplier picker/
//         "+ New supplier" flow tied to a suppliers table we don't have
//         (flagged, not built). New parts start with supplier = null; the
//         drawer shows "—" until that feature is scoped.
//       - Qty on hand — preview's new-item flow does NOT set stock directly;
//         D().addPart() creates the catalog row, and physical qty only
//         arrives afterward through the receiving flow. New parts here start
//         at qty_on_hand = 0 for the same reason — use Receive Stock right
//         after creating a part to bring in its first quantity.
//     SKU now auto-generates client-side when left blank (autoSku()) instead
//     of being hard-required — mirrors openNewPart's "auto if blank" input
//     placeholder behavior (preview's real generator is server-side and
//     opaque to us; this is a reasonable, flagged stand-in).
//   - Identity grid (drawer) — was Category/Warehouse/Supplier/Lead-time;
//     preview's actual identity grid (openPart, first 4 cards) is
//     SKU/Category/Warehouse/Supplier. Fixed to match exactly — added a SKU
//     card, moved Lead-time down into the Reorder-info card (where preview
//     actually puts it), and dropped the redundant small SKU line that used
//     to sit under the part name in the header (preview's modal title bar
//     shows only the name, no SKU).
//
// What's KEPT as a flagged, reasoned deviation (not silently invented):
//   - "Create Warehouse" header button — warehouses need a creation path and
//     preview only offers one buried inside its Add-Parts/PO draft modals
//     (which we don't have). No new table involved, just no 1:1 preview spot.
//   - Adjust Stock — the ONE genuinely-new-vs-preview capability kept. Preview
//     has no manual stock-correction UI anywhere (no FIFO tiers to "recount"
//     against). Wraps 0044's already-committed, already-live adjust_stock
//     RPC. Exactly one entry point: the drawer footer. Turki: say the word
//     and this comes out too — it's the one deliberate exception here.
//   - Movement-history table (drawer) — stands in for preview's FIFO price-
//     lot batches table AND its work_orders-linked usage log, neither of
//     which exist in this schema. Shows the stock_movements ledger instead
//     (the audit trail our receive/adjust RPCs already write either way).
//
// NOT built (flagged, needs new tables/functions — confirm before drafting a
// migration, not created here): Purchase Orders, Approvals tab, Financial
// Analysis tab, AI-suggest-PO, suppliers-as-entity (+ supplier picker/inline-
// create), receipt invoice-photo upload, FIFO price-lots (+ "Add new price" +
// price-trend arrows), per-part Financial Report + AI insight, row's
// "Financial report"/"Create PO" buttons, drawer's conditional "Create PO"
// footer button.
//
// Stock-tier coloring mirrors preview/'s INV.stockCell exactly: critical
// (qty <= reorder) / low (qty <= 1.5x reorder) / ok. Parts with no
// reorder_level are never "low" — plain/neutral stock cell.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Warehouse as WarehouseIcon,
  X,
  Package,
  Search,
  Eye,
  PackagePlus,
  SlidersHorizontal,
  History,
} from "lucide-react";
import { useApp } from "@/components/AppShell";
import { PageHeader, Btn, Stat, Table, TH, TD, Card } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import type { Warehouse, Part, StockMovement, Supplier } from "@/lib/db-types";
import {
  createWarehouse,
  createSupplier,
  createPart,
  receiveStock,
  adjustStock,
  getPartMovements,
  type WarehouseInput,
  type SupplierInput,
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
const TIER_LABEL: Record<Exclude<StockTier, null>, { en: string; ar: string }> = {
  ok: { en: "Healthy", ar: "جيد" },
  low: { en: "Getting low", ar: "منخفض نسبيًا" },
  critical: { en: "Critical — reorder", ar: "حرج — أعد الطلب" },
};

const MOVEMENT_LABEL: Record<StockMovement["movement_type"], { en: string; ar: string }> = {
  receive: { en: "Received", ar: "استلام" },
  adjust: { en: "Adjusted", ar: "تعديل" },
};

// preview/'s invInventoryView's own hardcoded CATS list, verbatim (its exact
// order, "all" excluded here since the "All" chip is rendered separately).
const FILTER_CATS = ["engine", "brake", "tire", "fluid", "electrical", "tank", "filter", "consumable"];

// preview/'s openNewPart's own hardcoded cats list, verbatim (includes
// "equipment", which invInventoryView's filter list does not — that
// inconsistency is preview's own, not something introduced here).
const CREATE_CATS = ["fluid", "filter", "brake", "tire", "electrical", "tank", "engine", "consumable", "equipment"];

const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  fluid: { en: "Fluid", ar: "سوائل" },
  filter: { en: "Filter", ar: "فلتر" },
  brake: { en: "Brake", ar: "فرامل" },
  tire: { en: "Tire", ar: "إطارات" },
  electrical: { en: "Electrical", ar: "كهرباء" },
  tank: { en: "Tank", ar: "خزان" },
  engine: { en: "Engine", ar: "محرك" },
  consumable: { en: "Consumable", ar: "مستهلكات" },
  equipment: { en: "Equipment", ar: "معدات" },
};

function categoryLabel(cat: string | null, lang: "en" | "ar"): string {
  if (!cat) return "—";
  const found = CATEGORY_LABEL[cat];
  if (!found) return cat;
  return lang === "en" ? found.en : found.ar;
}

// preview/'s openNewPart's own hardcoded units list, verbatim.
const CREATE_UNITS = ["ea", "L", "set", "kg", "m"];
const UNIT_LABEL: Record<string, { en: string; ar: string }> = {
  ea: { en: "each (ea)", ar: "قطعة" },
  L: { en: "liter (L)", ar: "لتر" },
  set: { en: "set", ar: "طقم" },
  kg: { en: "kg", ar: "kg" },
  m: { en: "m", ar: "m" },
};

// Lightweight client-side stand-in for preview's server-side "auto if blank"
// SKU generator — deterministic-ish, collision handled by the existing
// unique-constraint error message (friendlyError() in actions.ts).
function autoSku(name: string): string {
  const base =
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "PART";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

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
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all"); // "all" | warehouse.id
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [addPartModalOpen, setAddPartModalOpen] = useState(false);
  const [viewPart, setViewPart] = useState<Part | null>(null);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [adjustModal, setAdjustModal] = useState<{ part: Part } | null>(null);

  const warehousesById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  const visibleParts = useMemo(() => {
    return parts.filter((p) => {
      if (warehouseFilter !== "all" && p.warehouse_id !== warehouseFilter) return false;
      if (cat !== "all" && p.category !== cat) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${p.name} ${p.sku} ${p.name_ar ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [parts, warehouseFilter, cat, q]);

  // KPIs — computed from ALL parts, not the filtered table below. Matches
  // preview's inventoryPage(): totalValue/lowStock use D().parts directly;
  // only invInventoryView's own table list is scoped by invFilters.
  const inventoryValue = parts.reduce(
    (s, p) => s + (p.unit_cost_sar != null ? p.unit_cost_sar * p.qty_on_hand : 0),
    0
  );
  const skuCount = parts.length;
  const lowStockCount = parts.filter(
    (p) => p.reorder_level != null && p.qty_on_hand <= p.reorder_level
  ).length;

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
              <Btn variant="primary" onClick={() => setAddPartModalOpen(true)}>
                <Plus className="h-4 w-4" />
                {lang === "en" ? "Add Part" : "إضافة قطعة"}
              </Btn>
            )}
            {parts.length > 0 && (
              <Btn variant="outline" onClick={() => setReceiveModalOpen(true)}>
                <PackagePlus className="h-4 w-4" />
                {lang === "en" ? "Receive Stock" : "استلام مخزون"}
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
                    cat === "all" ? "bg-brand-600 text-white border-brand-600" : ""
                  )}
                  style={cat !== "all" ? { borderColor: "rgb(var(--border))" } : undefined}
                >
                  {lang === "en" ? "All" : "الكل"}
                </button>
                {FILTER_CATS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    className={cn(
                      "h-9 px-2.5 rounded-lg text-[11px] font-medium border",
                      cat === c ? "bg-brand-600 text-white border-brand-600" : ""
                    )}
                    style={cat !== c ? { borderColor: "rgb(var(--border))" } : undefined}
                  >
                    {categoryLabel(c, lang)}
                  </button>
                ))}
              </div>
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border text-sm"
                style={INPUT_STYLE}
              >
                <option value="all">{lang === "en" ? "All warehouses" : "كل المستودعات"}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <PartsTable
            parts={visibleParts}
            warehousesById={warehousesById}
            lang={lang}
            onView={(p) => setViewPart(p)}
          />
        </>
      )}

      {warehouseModalOpen && (
        <CreateWarehouseModal lang={lang} onClose={() => setWarehouseModalOpen(false)} />
      )}

      {viewPart && (
        <ViewPartModal
          lang={lang}
          part={viewPart}
          warehousesById={warehousesById}
          onClose={() => setViewPart(null)}
          onAdjust={(p) => {
            setViewPart(null);
            setAdjustModal({ part: p });
          }}
        />
      )}

      {receiveModalOpen && (
        <ReceiveStockModal lang={lang} parts={parts} onClose={() => setReceiveModalOpen(false)} />
      )}

      {adjustModal && (
        <AdjustStockModal lang={lang} part={adjustModal.part} onClose={() => setAdjustModal(null)} />
      )}

      {addPartModalOpen && (
        <AddPartModal
          lang={lang}
          warehouses={warehouses}
          defaultWarehouseId={warehouseFilter !== "all" ? warehouseFilter : ""}
          onClose={() => setAddPartModalOpen(false)}
        />
      )}
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

// preview's parts table: SKU/Part/Category/Warehouse/Stock/CurrPrice/
// StockValue/actions. Row click AND its single actions-column button both
// open the same View drawer — preview does exactly this (openPart bound to
// both the <tr> onclick and an explicit View button). No Edit button here —
// preview has none either.
function PartsTable({
  parts,
  warehousesById,
  lang,
  onView,
}: {
  parts: Part[];
  warehousesById: Map<string, Warehouse>;
  lang: "en" | "ar";
  onView: (p: Part) => void;
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
                {lang === "en" ? "No parts match these filters." : "لا توجد قطع مطابقة لهذه الفلاتر."}
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
                onClick={() => onView(p)}
                className={cn(
                  "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
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
                <TD>{categoryLabel(p.category, lang)}</TD>
                <TD>{warehouseName}</TD>
                <TD>
                  <StockCell part={p} lang={lang} />
                </TD>
                <TD className="tabular-nums">{p.unit_cost_sar != null ? formatSar(p.unit_cost_sar) : "—"}</TD>
                <TD className="tabular-nums font-medium">{stockValue != null ? formatSar(stockValue) : "—"}</TD>
                <TD className="text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(p);
                    }}
                    title={lang === "en" ? "View" : "عرض"}
                    className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Eye className="h-4 w-4" />
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

// Reusable "New supplier" modal — Phase 1 of the full-demo build-out
// (migration 0045, LIVE). Mirrors preview/'s openNewSupplier()/
// saveNewSupplier() exactly: name/phone/email/contact person, dedupes
// case-insensitively server-side (createSupplier), and hands the resulting
// record back via onCreated so the caller can auto-select it — same as
// preview auto-selecting a freshly-created supplier in whatever draft is
// open. NOT mounted anywhere yet in this file: preview itself never gives
// suppliers a standalone entry point either — it only ever opens this modal
// from inside the PO draft or the receive/"Add Parts" draft, neither of
// which exist yet (Phase 3/4 of the plan). This component ships now as
// tested, reusable infrastructure; Phase 3/4 will mount it, unmodified,
// behind their own "+ New supplier" buttons.
function NewSupplierModal({
  lang,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactPerson, setContactPerson] = useState("");
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
      setError(lang === "en" ? "Supplier name is required." : "اسم المورّد مطلوب.");
      return;
    }
    const input: SupplierInput = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      contact_person: contactPerson.trim() || null,
    };
    setSaving(true);
    setError(null);
    const res = await createSupplier(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.supplier) onCreated(res.supplier);
    onClose();
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
              {lang === "en" ? "New supplier" : "مورّد جديد"}
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
                placeholder={lang === "en" ? "e.g. Al-Futtaim Auto Parts" : "مثال: الفطيم لقطع السيارات"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Phone" : "الهاتف"}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="+966 11 478 1100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Email" : "البريد الإلكتروني"}</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="orders@supplier.sa"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Contact person" : "الشخص المسؤول"}</span>
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
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
                : lang === "en" ? "Create supplier" : "إنشاء المورّد"}
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

// preview's openPart drawer, minus the FIFO price-lot batches table and the
// work_orders-linked maintenance usage log (neither exists in this app's
// schema — flagged, not built here). Identity grid = SKU/Category/Warehouse/
// Supplier, matching preview's own 4 cards exactly. Then a simplified stock-
// health card, the stock_movements ledger as the audit-trail analog, and a
// reorder-info card (fields we DO have, matches preview's card 1:1 — this is
// also where Lead time lives, same as preview). Footer: Close + Adjust Stock
// only — no Edit (preview has none), no Receive Stock here (single entry
// point is the header button instead).
function ViewPartModal({
  lang,
  part,
  warehousesById,
  onClose,
  onAdjust,
}: {
  lang: "en" | "ar";
  part: Part;
  warehousesById: Map<string, Warehouse>;
  onClose: () => void;
  onAdjust: (p: Part) => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingMovements(true);
    setMovementsError(null);
    getPartMovements(part.id).then((res) => {
      if (cancelled) return;
      setLoadingMovements(false);
      if (res.error) {
        setMovementsError(res.error);
        return;
      }
      setMovements(res.movements);
    });
    return () => {
      cancelled = true;
    };
  }, [part.id]);

  const tier = stockTier(part);
  const stockValue = part.unit_cost_sar != null ? part.unit_cost_sar * part.qty_on_hand : null;
  const warehouseName = warehousesById.get(part.warehouse_id)?.name ?? "—";
  const reorderValue =
    part.reorder_qty != null && part.unit_cost_sar != null ? part.reorder_qty * part.unit_cost_sar : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 muted" />
            <h2 className="text-lg font-semibold">{lang === "ar" ? part.name_ar ?? part.name : part.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "SKU" : "الرمز"}</div>
            <div className="font-mono font-medium">{part.sku}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Category" : "الفئة"}</div>
            <div className="font-medium">{categoryLabel(part.category, lang)}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Warehouse" : "المستودع"}</div>
            <div className="font-medium">{warehouseName}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Supplier" : "المورد"}</div>
            <div className="font-medium">{part.supplier ?? "—"}</div>
          </div>
        </div>

        <Card className="!p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "In stock" : "المخزون"}</div>
              <div className={cn("flex items-baseline gap-1.5", tier ? TIER_TEXT[tier] : "")}>
                {tier && <span className={cn("h-1.5 w-1.5 rounded-full self-center", TIER_DOT[tier])} />}
                <span className="text-lg font-bold tabular-nums">{part.qty_on_hand}</span>
                <span className="text-[10px] uppercase font-medium muted">{part.unit ?? ""}</span>
              </div>
              {tier && (
                <div className={cn("text-[11px] mt-0.5", TIER_TEXT[tier])}>
                  {lang === "en" ? TIER_LABEL[tier].en : TIER_LABEL[tier].ar}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Reorder at" : "إعادة الطلب عند"}</div>
              <div className="font-medium tabular-nums">{part.reorder_level ?? "—"}</div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</div>
              <div className="font-medium tabular-nums">
                {part.unit_cost_sar != null ? formatSar(part.unit_cost_sar) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Stock value" : "قيمة المخزون"}</div>
              <div className="font-medium tabular-nums">{stockValue != null ? formatSar(stockValue) : "—"}</div>
            </div>
          </div>
        </Card>

        <div className="mb-2 flex items-center gap-2">
          <History className="h-4 w-4 muted" />
          <h3 className="text-sm font-semibold">{lang === "en" ? "Movement history" : "سجل الحركات"}</h3>
        </div>
        <Card className="!p-0 overflow-hidden mb-4">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{lang === "en" ? "Type" : "النوع"}</TH>
                <TH>{lang === "en" ? "Change" : "التغيير"}</TH>
                <TH>{lang === "en" ? "After" : "بعد"}</TH>
                <TH>{lang === "en" ? "Note" : "ملاحظة"}</TH>
                <TH>{lang === "en" ? "By" : "بواسطة"}</TH>
                <TH>{lang === "en" ? "Date" : "التاريخ"}</TH>
              </tr>
            </thead>
            <tbody>
              {loadingMovements && (
                <tr>
                  <td colSpan={6} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en" ? "Loading…" : "جارٍ التحميل…"}
                  </td>
                </tr>
              )}
              {!loadingMovements && movementsError && (
                <tr>
                  <td colSpan={6} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en"
                      ? "Movement history isn't available yet (pending setup)."
                      : "سجل الحركات غير متاح بعد (بانتظار الإعداد)."}
                  </td>
                </tr>
              )}
              {!loadingMovements && !movementsError && movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en" ? "No movements yet." : "لا توجد حركات بعد."}
                  </td>
                </tr>
              )}
              {!loadingMovements &&
                !movementsError &&
                movements.map((m) => (
                  <tr key={m.id}>
                    <TD>{lang === "en" ? MOVEMENT_LABEL[m.movement_type].en : MOVEMENT_LABEL[m.movement_type].ar}</TD>
                    <TD
                      className={cn(
                        "tabular-nums font-medium",
                        m.qty_delta > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : m.qty_delta < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : ""
                      )}
                    >
                      {m.qty_delta > 0 ? "+" : ""}
                      {m.qty_delta}
                    </TD>
                    <TD className="tabular-nums">{m.qty_after}</TD>
                    <TD className="max-w-[16rem] truncate">
                      <span title={m.note ?? ""}>{m.note ?? "—"}</span>
                    </TD>
                    <TD className="text-xs muted">{m.created_by ?? "—"}</TD>
                    <TD className="text-xs muted whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}
                    </TD>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>

        <Card className="!p-4">
          <h3 className="text-sm font-semibold mb-3">{lang === "en" ? "Reorder info" : "معلومات إعادة الطلب"}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Suggested qty" : "الكمية المقترحة"}</div>
              <div className="font-medium tabular-nums">
                {part.reorder_qty ?? "—"} {part.unit ?? ""}
              </div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Supplier" : "المورد"}</div>
              <div className="font-medium">{part.supplier ?? "—"}</div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Lead time" : "مدة التوريد"}</div>
              <div className="font-medium tabular-nums">
                {part.lead_time_days != null ? `${part.lead_time_days} ${lang === "en" ? "days" : "يوم"}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Total value" : "القيمة الإجمالية"}</div>
              <div className="font-medium tabular-nums">{reorderValue != null ? formatSar(reorderValue) : "—"}</div>
            </div>
          </div>
        </Card>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
          <Btn variant="outline" onClick={() => onAdjust(part)}>
            <SlidersHorizontal className="h-4 w-4" />
            {lang === "en" ? "Adjust Stock" : "تعديل المخزون"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// Wraps receive_stock() (migration 0044 — live). ONE entry point reaches this
// modal: the header "Receive Stock" button. No fixed-part variant anymore —
// the drawer's own Receive Stock button was deleted (preview's openPart
// footer has no such button either).
function ReceiveStockModal({
  lang,
  parts,
  onClose,
}: {
  lang: "en" | "ar";
  parts: Part[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useNumField(undefined);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPart = parts.find((p) => p.id === partId) ?? null;
  const qtyNum = parseNumField(qty);
  const canSubmit = partId !== "" && qtyNum != null && qtyNum > 0;

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError(lang === "en" ? "Pick a part and a positive quantity." : "اختر قطعة وكمية موجبة.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await receiveStock(partId, qtyNum!, note.trim() || null);
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
      <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">{lang === "en" ? "Receive stock" : "استلام مخزون"}</h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Part *" : "القطعة *"}</span>
              <select
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
              >
                <option value="" disabled>
                  {lang === "en" ? "Pick a part…" : "اختر قطعة…"}
                </option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedPart && (
              <p className="text-xs muted">
                {lang === "en" ? "Current stock:" : "المخزون الحالي:"} {selectedPart.qty_on_hand} {selectedPart.unit ?? ""}
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Quantity received *" : "الكمية المستلمة *"}</span>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/-/g, ""))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
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
                placeholder={lang === "en" ? "optional — e.g. supplier ref" : "اختياري — مثال: مرجع المورد"}
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
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Receive stock" : "استلام المخزون"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Wraps adjust_stock() (migration 0044 — live). Genuinely new vs preview (no
// FIFO price-lots here, so a manual correction path is needed) — the ONE
// deliberate exception to strict preview-mirroring in this file. Single entry
// point: the View drawer's footer button only. Note is required, mirroring
// the RPC's own server-side check.
function AdjustStockModal({
  lang,
  part,
  onClose,
}: {
  lang: "en" | "ar";
  part: Part;
  onClose: () => void;
}) {
  const router = useRouter();
  const [newQty, setNewQty] = useNumField(part.qty_on_hand);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newQtyNum = parseNumField(newQty);
  const canSubmit = newQtyNum != null && newQtyNum >= 0 && note.trim() !== "";

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newQtyNum == null || newQtyNum < 0) {
      setError(lang === "en" ? "New quantity cannot be negative." : "لا يمكن أن تكون الكمية الجديدة سالبة.");
      return;
    }
    if (!note.trim()) {
      setError(
        lang === "en" ? "Adjustment requires a note explaining the reason." : "يتطلب التعديل ملاحظة توضح السبب."
      );
      return;
    }
    setSaving(true);
    setError(null);
    const res = await adjustStock(part.id, newQtyNum, note.trim());
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
      <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">{lang === "en" ? "Adjust stock" : "تعديل المخزون"}</h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Part" : "القطعة"}</span>
              <div className="px-3 py-2 rounded-lg border text-sm" style={INPUT_STYLE}>
                <span className="font-medium">{lang === "ar" ? part.name_ar ?? part.name : part.name}</span>
                <span className="muted ml-2 font-mono text-xs">{part.sku}</span>
              </div>
            </div>

            <p className="text-xs muted">
              {lang === "en" ? "Current stock:" : "المخزون الحالي:"} {part.qty_on_hand} {part.unit ?? ""}
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "New quantity *" : "الكمية الجديدة *"}</span>
              <input
                value={newQty}
                onChange={(e) => setNewQty(e.target.value.replace(/-/g, ""))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reason *" : "السبب *"}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                rows={2}
                required
                placeholder={lang === "en" ? "e.g. physical count correction" : "مثال: تصحيح بعد الجرد الفعلي"}
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
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Adjust stock" : "تعديل المخزون"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Create-only — mirrors preview's INV.openNewPart() field set exactly (name,
// name_ar, sku, category, unit, unit price, reorder level, reorder qty). No
// edit mode exists (see header comment — preview has none, this file no
// longer invents one). Two fields preview's own form has that don't apply
// here are absent by design: supplier (preview assigns it at receipt time,
// needs a suppliers table — not built) and qty on hand (starts at 0, same as
// preview — physical qty only arrives afterward via Receive Stock). Warehouse
// is the one unavoidable addition: our schema requires warehouse_id at
// creation (one SKU lives in one warehouse), a field preview's draft-based
// creation flow never needs because the draft already carries a warehouse.
function AddPartModal({
  lang,
  warehouses,
  defaultWarehouseId,
  onClose,
}: {
  lang: "en" | "ar";
  warehouses: Warehouse[];
  defaultWarehouseId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [category, setCategory] = useState(CREATE_CATS[0]);
  const [unit, setUnit] = useState(CREATE_UNITS[0]);
  const [unitCost, setUnitCost] = useNumField(undefined);
  const [reorderLevel, setReorderLevel] = useNumField(undefined);
  const [reorderQty, setReorderQty] = useNumField(undefined);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && warehouseId !== "";

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
      setError(lang === "en" ? "Name and warehouse are required." : "الاسم والمستودع مطلوبان.");
      return;
    }
    const input: PartInput = {
      sku: sku.trim() || autoSku(name),
      name: name.trim(),
      name_ar: nameAr.trim() || null,
      category,
      unit,
      unit_cost_sar: parseNumField(unitCost),
      qty_on_hand: 0,
      reorder_level: parseNumField(reorderLevel),
      reorder_qty: parseNumField(reorderQty),
      lead_time_days: null,
      supplier: null,
      warehouse_id: warehouseId,
    };
    setSaving(true);
    setError(null);
    const res = await createPart(input);
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
            <h2 className="text-lg font-semibold">{lang === "en" ? "Add part" : "إضافة قطعة"}</h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Item / Equipment name *" : "اسم الصنف / المعدة *"}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name (Arabic)" : "الاسم (عربي)"}</span>
              <input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                placeholder={lang === "en" ? "optional" : "اختياري"}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "SKU" : "رمز الصنف"}</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={lang === "en" ? "auto if blank" : "تلقائي إن تُرك فارغًا"}
              />
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
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Category" : "الفئة"}</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                {CREATE_CATS.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit" : "الوحدة"}</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                {CREATE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {lang === "en" ? UNIT_LABEL[u].en : UNIT_LABEL[u].ar}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit price (SAR)" : "سعر الوحدة (ر.س)"}</span>
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                placeholder="0.00"
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
                placeholder="0"
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
                placeholder="1"
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
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Add part" : "إضافة القطعة"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
