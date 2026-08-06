"use client";

// Inventory — shared inline-create modals + small helpers, extracted from
// InventoryClient.tsx to break a circular import.
//
// ROOT CAUSE (Phase 4 postmortem): PurchaseOrders.tsx needed to reuse
// NewSupplierModal/CreateWarehouseModal/AddPartModal (they were exported
// FROM InventoryClient.tsx), while InventoryClient.tsx needed ProcStrip/
// NewPOModal/POListModal/PODetailModal FROM PurchaseOrders.tsx — a genuine
// two-file import cycle (InventoryClient.tsx <-> PurchaseOrders.tsx).
// `tsc`/`next build` do NOT catch this (module graphs with cycles still
// type-check and bundle "successfully" as long as nothing is used at
// TOP-LEVEL module-evaluation time) — but Next's dev-mode module system
// resolves whichever module started evaluating SECOND against the FIRST
// module's still-in-progress exports object, which can come back with some
// bindings genuinely undefined depending on evaluation order, crashing the
// render (blank page) even though the build succeeded. (In this repo's
// concrete incident, the visible symptom was actually a STALE `.next`
// cache from running a production build alongside a live dev server —
// fixed separately by clearing `.next` and restarting — but the cycle
// itself was real and is removed here regardless, since it's a structural
// risk independent of what actually triggered the blank page this time.)
//
// FIX: this file is a leaf module — it imports ONLY from "./actions" and
// "@/lib/db-types"/"@/lib/utils"/"@/components/ui", never from
// "./InventoryClient" or "./PurchaseOrders". Both of those now import FROM
// here instead of from each other. No cycle: InventoryClient.tsx ->
// SharedCreateModals.tsx <- PurchaseOrders.tsx, and
// InventoryClient.tsx -> PurchaseOrders.tsx (one-way only).
//
// Moved here verbatim (unchanged behavior): CreateWarehouseModal,
// NewSupplierModal, AddPartModal (+ its private NewUnitModal), the
// ComboInput control, and the small helpers those four depend on
// (categoryLabel/CREATE_CATS/CATEGORY_LABEL, autoSku, useNumField/
// parseNumField). categoryLabel/useNumField/parseNumField are ALSO used by
// components still in InventoryClient.tsx (PartsTable, ViewPartModal,
// AdjustStockModal) — exported here, imported back there. That back-import
// is safe: it's a one-way edge, not a cycle. (AddPriceLotModal — the
// drawer's old standalone "Add new price" quick-action — was removed
// entirely post-launch, Turki's test-6 feedback on e9a03d5; see
// InventoryClient.tsx's own header comment.)

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { X, Save, ChevronDown } from "lucide-react";
import { Btn, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Warehouse, Part, Supplier, Unit } from "@/lib/db-types";
// VAT (migration 0056) — fixed 15%, per-line rounding summed. Deliberately
// NOT lib/vat.ts (see lib/inventory-vat.ts's own header).
import { calculateInventoryVatDocument, formatSarVat } from "@/lib/inventory-vat";
import {
  createWarehouse,
  createSupplier,
  createPart,
  createUnit,
  updatePart,
  type WarehouseInput,
  type SupplierInput,
  type PartInput,
  type UnitInput,
  type PartUpdateInput,
} from "./actions";

// Shared modal backdrop — "risky batch" Stage 3, items 1 + 7. Every
// Inventory modal used to render its own `fixed inset-0` backdrop INLINE
// in the component tree (a plain div, not portaled) — PODetailModal was
// the one exception, already using createPortal(..., document.body). Two
// real bugs traced to that inline pattern:
//
//   1. Backdrop clipped at the top — an inline `fixed` element is only
//      guaranteed to anchor to the true viewport when NOTHING in its
//      ancestor chain establishes a new containing block (transform,
//      filter, perspective, contain, etc). Portaling straight to
//      document.body removes that ambiguity entirely — same fix as
//      PODetailModal already uses, just applied everywhere.
//   2. Stacked popups (e.g. "+ New Item" opened from "Add Part") — a
//      child modal's own backdrop div, rendered inline, is a DOM CHILD of
//      the parent modal's backdrop div. Clicking the child's dimmed
//      backdrop to dismiss it closes the child (correct) but the click
//      then bubbles up through the DOM tree into the PARENT's backdrop
//      onClick too (nothing stopped it), closing the parent and losing
//      everything typed into it. Portaling each modal separately to
//      document.body makes them DOM SIBLINGS, not nested — a child's
//      backdrop click has no parent-modal ancestor left to bubble into.
//      stopPropagation() on this component's own backdrop onClick is
//      belt-and-suspenders on top of that, not the primary fix.
//
// mounted-guard: same pattern PODetailModal already established — a
// portal can't render before the client has mounted (no `document` during
// SSR), so this renders null on the first pass and the real content one
// tick later. Expected, not a bug — every modal built after this point
// behaves exactly like PODetailModal always has.
export function ModalOverlay({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </div>,
    document.body
  );
}

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

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

export function categoryLabel(cat: string | null, lang: "en" | "ar"): string {
  if (!cat) return "—";
  const found = CATEGORY_LABEL[cat];
  if (!found) return cat;
  return lang === "en" ? found.en : found.ar;
}

// Item 3 (follow-up polish) — "Supplier contact" card, blank "—" until a
// supplier is picked, then shows name/name_ar/contact/phone/email. Was
// NewPOModal's own inline JSX only (PurchaseOrders.tsx) — extracted here
// so AddPartModal (this file) can show supplier info "the same way New PO
// shows it" (Turki's own wording) without hand-duplicating the markup.
// PODetailModal has its own similar-looking card too, but that one is
// read-only for an ALREADY-committed PO (supplier always present, no
// blank state) — a genuinely different behavior, deliberately left as its
// own inline JSX, not folded into this component.
export function SupplierContactCard({ lang, supplier }: { lang: "en" | "ar"; supplier: Supplier | null }) {
  return (
    <Card className="!p-3 !bg-[rgba(11,126,234,.06)] dark:!bg-[rgba(96,196,255,.06)]">
      <div className="text-[11px] muted uppercase tracking-wide mb-1">
        {lang === "en" ? "Supplier contact" : "بيانات المورّد"}
      </div>
      {!supplier ? (
        <div className="text-sm muted">—</div>
      ) : (
        <>
          <div className="font-semibold text-sm">{supplier.name}</div>
          {supplier.name_ar && <div className="text-xs muted mb-1">{supplier.name_ar}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mt-1">
            <div>
              <span className="muted">{lang === "en" ? "Contact person" : "الشخص المسؤول"}:</span>{" "}
              {supplier.contact_person ?? "—"}
            </div>
            <div>
              <span className="muted">{lang === "en" ? "Phone" : "الهاتف"}:</span>{" "}
              <span className="font-mono">{supplier.phone ?? "—"}</span>
            </div>
            <div>
              <span className="muted">{lang === "en" ? "Email" : "البريد الإلكتروني"}:</span>{" "}
              <span className="font-mono">{supplier.email ?? "—"}</span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// Stock tier — MOVED here from InventoryClient.tsx (polish-round item 1)
// so the new PartPicker below (used by ReceivePartsModal AND NewPOModal/
// ReceivePOModal, i.e. both InventoryClient.tsx AND PurchaseOrders.tsx) can
// read it without creating an import cycle (this file is the established
// neutral leaf module — see this file's own header postmortem). Exported
// here, imported BACK into InventoryClient.tsx — same one-way-edge pattern
// categoryLabel/useNumField/parseNumField already use.
export type StockTier = "ok" | "low" | "critical" | null;

export function stockTier(part: Part): StockTier {
  if (part.reorder_level == null) return null;
  if (part.qty_on_hand <= part.reorder_level) return "critical";
  if (part.qty_on_hand <= part.reorder_level * 1.5) return "low";
  return "ok";
}

export const TIER_TEXT: Record<Exclude<StockTier, null>, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  low: "text-amber-700 dark:text-amber-400",
  critical: "text-rose-700 dark:text-rose-400",
};
export const TIER_DOT: Record<Exclude<StockTier, null>, string> = {
  ok: "bg-emerald-500",
  low: "bg-amber-500",
  critical: "bg-rose-500",
};
export const TIER_LABEL: Record<Exclude<StockTier, null>, { en: string; ar: string }> = {
  ok: { en: "Healthy", ar: "جيد" },
  low: { en: "Getting low", ar: "منخفض نسبيًا" },
  critical: { en: "Critical — reorder", ar: "حرج — أعد الطلب" },
};

// Item 1 (polish round) — PartPicker: a "pick a part to add" custom
// listbox replacing the plain <select>. Native <option> elements can't
// reliably carry per-row colored dots/badges across browsers, so this is a
// real (small) custom component, not a <select> restyle. Shows each part's
// available qty + a stock-state color (Current/Low stock/Depleted — same
// 3-tier thresholds as stockTier()/the parts table's own stock cell,
// re-labeled for this "picking a part to receive/order" context rather
// than the drawer's "Healthy/Getting low/Critical — reorder" wording).
const PICKER_TIER_LABEL: Record<Exclude<StockTier, null>, { en: string; ar: string }> = {
  ok: { en: "Current", ar: "متوفر" },
  low: { en: "Low stock", ar: "مخزون منخفض" },
  critical: { en: "Depleted", ar: "منتهي" },
};

export function PartPicker({
  value,
  onChange,
  parts,
  lang,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  parts: Part[];
  lang: "en" | "ar";
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = parts.find((p) => p.id === value) ?? null;

  return (
    <div className="relative flex-1 min-w-0" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          INPUT,
          "flex items-center justify-between gap-2 text-start disabled:opacity-50 disabled:pointer-events-none"
        )}
        style={INPUT_STYLE}
      >
        {/* Item 2 (follow-up polish) — font cleanup: SKU + name now use the
            SAME "sku · name" separator this app already uses everywhere
            else a SKU/name pair sits on one line (was a bare space,
            reading as visually cramped/unstyled once widened). */}
        <span className={cn("truncate", !selected && "muted")}>
          {selected ? (
            <>
              <span className="font-mono text-[11px] muted">{selected.sku}</span>
              <span className="muted mx-1">·</span>
              <span className="font-medium">{lang === "ar" && selected.name_ar ? selected.name_ar : selected.name}</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown className="h-4 w-4 muted shrink-0" />
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border shadow-lg scrollbar-thin"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        >
          {parts.length === 0 ? (
            <div className="px-3 py-2 text-sm muted">
              {lang === "en" ? "No parts available" : "لا توجد قطع متاحة"}
            </div>
          ) : (
            parts.map((p) => {
              const tier = stockTier(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className="w-full text-start px-3 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between gap-3"
                >
                  <span className="truncate">
                    <span className="font-mono text-[11px] muted">{p.sku}</span>
                    <span className="muted mx-1">·</span>
                    <span className="font-medium">{lang === "ar" && p.name_ar ? p.name_ar : p.name}</span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium shrink-0 tabular-nums",
                      tier ? TIER_TEXT[tier] : "muted"
                    )}
                    title={tier ? (lang === "en" ? PICKER_TIER_LABEL[tier].en : PICKER_TIER_LABEL[tier].ar) : undefined}
                  >
                    {tier && <span className={cn("h-1.5 w-1.5 rounded-full", TIER_DOT[tier])} />}
                    {p.qty_on_hand} {p.unit ?? ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// Auto-SKU (item 4, follow-up batch) — NOT name-based (corrected per
// Turki's own review; an earlier version derived the SKU from the typed
// name, wrong). Default is "SKU-" + any number not already used by an
// existing SKU in the parts table — doesn't have to follow the highest,
// just unused. parts.sku is globally unique already (0043's own `unique`
// constraint) — this only avoids suggesting a value that would fail that
// constraint, it doesn't add a new one. Stays editable either way.
export function computeAutoSku(existingSkus: Set<string>): string {
  let n = Math.floor(Math.random() * 9000) + 1000;
  while (existingSkus.has(`SKU-${n}`)) n = Math.floor(Math.random() * 9000) + 1000;
  return `SKU-${n}`;
}

// Numeric field helper — text input backed by a string (so an empty field is
// distinguishable from 0), parsed to number|null on submit. Blocks minus-sign
// entry so negatives can never even be typed.
export function useNumField(initial: number | null | undefined) {
  return useState(initial != null ? String(initial) : "");
}

export function parseNumField(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Proper combo control (Turki's extension, not from preview) — a VISIBLE
// dropdown list of existing options, plus free typing in the same field. A
// native <input list>+<datalist> reads as plain free-text in practice (no
// visible affordance that options exist, browser-inconsistent) — this is a
// real listbox: a chevron toggles a panel of options; clicking one selects
// it; typing at any time still works and is saved as-is (the option isn't
// enforced — matches the free-text columns underneath). Options filter live
// against whatever's typed so far; the raw typed value is always what gets
// saved, whether or not it matches a suggestion.
function ComboInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // BUG FIX: filtering used to run against `value` directly — the
  // committed field value (e.g. the "fluid" default) — so opening the
  // list with a value already in it filtered EVERYTHING down to just that
  // one exact match ("only shows fluid"). `query` is a separate, typing-only
  // signal: cleared whenever the list is opened via focus/chevron (so the
  // FULL option set shows), and only starts narrowing once the user
  // actually types a character.
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;
  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className={cn(INPUT, "pe-8")}
          style={INPUT_STYLE}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setQuery("");
            setOpen((o) => !o);
          }}
          className="absolute inset-y-0 end-0 px-2 flex items-center muted"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div
          className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border shadow-lg"
          // The opaque background stays — the dropdown had none, so the page
          // showed through it. That is a separate legibility fix from the
          // add-new row that was removed here as a duplicate.
          style={{ ...INPUT_STYLE, background: "rgb(var(--card))" }}
        >
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                "w-full text-start px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5",
                o.value === value ? "text-brand-600 font-medium" : ""
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreateWarehouseModal({
  lang,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  onClose: () => void;
  // Optional. The header's own "Create Warehouse" button (the ONLY place a
  // warehouse can be created now — the inline "+ Warehouse" triggers inside
  // NewPOModal/ReceivePartsModal were removed, per-warehouse tabs on the
  // Inventory page) passes this to auto-switch the page's active warehouse
  // tab to the freshly created one, same immediate-select-no-wait-for-
  // refresh pattern onCreated on NewSupplierModal/AddPartModal already uses.
  onCreated?: (warehouse: Warehouse) => void;
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
    if (res.error || !res.warehouse) {
      setError(res.error ?? (lang === "en" ? "Could not create warehouse." : "تعذّر إنشاء المستودع."));
      return;
    }
    onCreated?.(res.warehouse);
    onClose();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
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
    </ModalOverlay>
  );
}

// Reusable "New supplier" modal — Phase 1 of the full-demo build-out
// (migration 0045, LIVE). Mirrors preview/'s openNewSupplier()/
// saveNewSupplier() exactly: title/button label both read "Add a new
// supplier" (preview reuses inv.newSupplierTitle for both — not a typo,
// matched verbatim), intro paragraph, 2-col field grid, field labels
// (Supplier name/Phone/Email/Contact person).
//
// FLAGGED, NOT BUILT: Turki asked for an Arabic name field here as a
// deliberate extension beyond preview (which has none). `suppliers` (0045)
// has no `name_ar` column today — adding this field needs a new column,
// which is a migration-review decision, not something to add unilaterally
// here. Stopped short of this one piece; everything else in this modal is
// preview-matched below.
export function NewSupplierModal({
  lang,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
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
      name_ar: nameAr.trim() || null,
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
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "Add a new supplier" : "إضافة مورّد جديد"}
            </h2>
            <button
              type="button"
              onClick={close}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-4">
            {lang === "en"
              ? "Quickly add a supplier. They'll be available in every Add Parts dropdown."
              : "إضافة مورّد بسرعة. سيظهر فوراً في جميع القوائم."}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Supplier name *" : "اسم المورّد *"}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder={lang === "en" ? "e.g. Al-Khaleej Heavy Trucks" : "مثال: الخليج للشاحنات الثقيلة"}
              />
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
              <span className="muted">{lang === "en" ? "Phone" : "الهاتف"}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="+966 11 ..."
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Email" : "البريد الإلكتروني"}</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="orders@..."
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Contact person" : "جهة الاتصال"}</span>
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={lang === "en" ? "Contact person" : "جهة الاتصال"}
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
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? null : <Save className="h-4 w-4" />}
              {saving
                ? lang === "en" ? "Saving…" : "جارٍ الحفظ…"
                : lang === "en" ? "Add a new supplier" : "إضافة مورّد جديد"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// Create-only — mirrors preview's INV.openNewPart() field set exactly (name,
// name_ar, sku, category, unit, unit price, reorder level, reorder qty). No
// edit mode exists (preview has none). Single entry point: bound next to
// "Add line" inside the Add Parts draft (ReceivePartsModal), never a
// standalone page-header action (preview's header has no such button
// either). Two fields preview's form has that don't apply are still absent
// by design: supplier (assigned at receipt time) and qty on hand (starts at
// 0 — physical qty only arrives via the receipt this item's being added to).
// Warehouse is fixed to the CALLING draft's own warehouse (read-only, not a
// picker) rather than a free choice — preview's draft-based creation never
// shows a warehouse field at all because the draft already carries one;
// letting it be freely re-picked here would risk creating a part in a
// different warehouse than the receipt it's about to be received into.
// onCreated hands the fresh row back so the caller can merge it into the
// draft's part list AND drop it in as a line — same as onCreated on
// NewSupplierModal above.
export function AddPartModal({
  lang,
  warehouses,
  parts,
  units,
  defaultWarehouseId,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  warehouses: Warehouse[];
  // Turki's own addition, not from preview — powers the Category combo
  // input's "existing options" list (CREATE_CATS unioned with whatever's
  // already in live use on real parts, so a typed-in new value shows up as
  // selectable for the next item too, no migration needed: parts.category
  // is free text, 0043). Units used to work the same way — now a lookup
  // table (0049) instead; see the Unit picker below.
  parts: Part[];
  // Units-of-measure lookup (migration 0049, LIVE) — the Unit picker below
  // reads from this instead of a hardcoded/free-text list. parts.unit still
  // stores the selected unit's CODE (soft reference, no FK — see 0049).
  units: Unit[];
  defaultWarehouseId: string;
  onClose: () => void;
  onCreated: (part: Part) => void;
}) {
  const router = useRouter();
  // Full parts list (not just this warehouse's) — parts.sku is globally
  // unique (0043), so the suggestion has to check against everything, not
  // just what's in view here. Computed once, at mount, to seed the default
  // below — not name-based, so nothing needs to re-run this as the user types.
  const [sku, setSku] = useState(() => computeAutoSku(new Set(parts.map((p) => p.sku.toUpperCase()))));
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [category, setCategory] = useState(CREATE_CATS[0]);
  const [unitCost, setUnitCost] = useNumField(undefined);
  const [reorderLevel, setReorderLevel] = useNumField(undefined);
  const [reorderQty, setReorderQty] = useNumField(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unit is no longer free text — picked from the units table (+ an inline
  // "add unit" affordance, same pattern as +Supplier/+Warehouse). Freshly
  // added units (via that affordance) merge in locally, same "merge in,
  // auto-select" pattern used throughout this file.
  const [localUnits, setLocalUnits] = useState<Unit[]>([]);
  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const allUnits = useMemo(() => {
    const ids = new Set(units.map((u) => u.id));
    return [...units, ...localUnits.filter((u) => !ids.has(u.id))];
  }, [units, localUnits]);
  const [unitCode, setUnitCode] = useState(allUnits[0]?.code ?? "");

  // Combo-input option list (extension #1) — hardcoded CREATE_CATS ∪
  // distinct values already used by real parts, so a typed-in free value
  // reappears as selectable next time. Category-only now — units moved to
  // the lookup table above.
  const categoryOptions = useMemo(() => {
    const extra = parts.map((p) => p.category).filter((c): c is string => !!c);
    return Array.from(new Set([...CREATE_CATS, ...extra]));
  }, [parts]);

  const warehouseName = warehouses.find((w) => w.id === defaultWarehouseId)?.name ?? "—";
  // Turki's explicit call ("risky batch" Stage 3, item 4): every field on
  // this form is now required before it can be saved — a real behavior
  // change from before, where SKU auto-generated on blank (via a client-
  // side autoSku() helper, now removed entirely — dead code the moment
  // "required" replaced "auto-fill if blank", the two are contradictory)
  // and name_ar/unit price/reorder level/reorder qty were all optional.
  const canSubmit =
    name.trim() !== "" &&
    nameAr.trim() !== "" &&
    sku.trim() !== "" &&
    category.trim() !== "" &&
    unitCode !== "" &&
    parseNumField(unitCost) !== null &&
    parseNumField(reorderLevel) !== null &&
    parseNumField(reorderQty) !== null &&
    defaultWarehouseId !== "";

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
      setError(lang === "en" ? "Every field is required." : "جميع الحقول مطلوبة.");
      return;
    }
    const input: PartInput = {
      sku: sku.trim(),
      name: name.trim(),
      name_ar: nameAr.trim(),
      category,
      unit: unitCode,
      unit_cost_sar: parseNumField(unitCost),
      qty_on_hand: 0,
      reorder_level: parseNumField(reorderLevel),
      reorder_qty: parseNumField(reorderQty),
      lead_time_days: null,
      supplier: null,
      warehouse_id: defaultWarehouseId,
    };
    setSaving(true);
    setError(null);
    const res = await createPart(input);
    setSaving(false);
    if (res.error || !res.part) {
      setError(res.error ?? (lang === "en" ? "Could not create item." : "تعذّر إنشاء الصنف."));
      return;
    }
    onCreated(res.part);
    onClose();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-[880px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "New item / equipment" : "صنف / معدة جديدة"}
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-4">
            {lang === "en"
              ? "Create a brand-new item or equipment type. It's added to the catalog and dropped straight into your current list."
              : "أنشئ صنفًا أو معدة جديدة. تُضاف للكتالوج وتُدرج مباشرة في قائمتك الحالية."}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Item / Equipment name *" : "اسم الصنف / المعدة *"}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name (Arabic) *" : "الاسم (عربي) *"}</span>
              <input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "SKU *" : "رمز الصنف *"}</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Warehouse" : "المستودع"}</span>
              <div className="px-3 py-2 rounded-lg border text-sm" style={INPUT_STYLE}>
                {warehouseName}
              </div>
            </label>

            {/* Category combo (Turki's extension #1, not from preview) — a
                VISIBLE dropdown list of existing options AND free typing in
                the same control (ComboInput, above). Pick a suggestion or
                type a brand-new value, which is saved as-is (category is
                free text on parts, 0043 — no migration needed) and becomes
                a selectable suggestion here again next time. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Category *" : "الفئة *"}</span>
              <ComboInput
                value={category}
                onChange={setCategory}
                options={categoryOptions.map((c) => ({ value: c, label: categoryLabel(c, lang) }))}
                placeholder={lang === "en" ? "Pick or type a category…" : "اختر أو اكتب فئة…"}
              />
            </label>
            {/* Unit picker — units table (migration 0049), NOT free text
                anymore. Same inline-create pattern as +Supplier/+Warehouse
                inside Add Parts: a select of existing units (code + its
                meaning, both visible) plus a "+ Unit" trigger to define a
                new one. The stored value is the CODE. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit *" : "الوحدة *"}</span>
              <div className="flex gap-2">
                <select
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  className={cn(INPUT, "flex-1")}
                  style={INPUT_STYLE}
                  required
                >
                  <option value="" disabled>
                    {lang === "en" ? "Pick a unit…" : "اختر وحدة…"}
                  </option>
                  {allUnits.map((u) => (
                    <option key={u.id} value={u.code}>
                      {u.code} — {lang === "ar" && u.label_ar ? u.label_ar : u.label_en}
                    </option>
                  ))}
                </select>
                <Btn type="button" variant="outline" onClick={() => setNewUnitOpen(true)}>
                  {lang === "en" ? "+ Unit" : "+ وحدة"}
                </Btn>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit price (SAR) *" : "سعر الوحدة (ر.س) *"}</span>
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
              {/* VAT — display-only readout, entered price is VAT-EXCLUSIVE.
                  parts.unit_cost_sar itself stores this price UNCHANGED
                  (it's the pricing snapshot — must stay VAT-free, see
                  0056's own header). Shown the same way New PO shows a
                  line's VAT/Total (calculateInventoryVatDocument, same
                  helper, same rate/rounding). Parses unitCost ONCE into
                  `price` instead of the previous version's two separate
                  parseNumField() calls — cosmetic hardening, not a fix for
                  a reproduced bug: the prior nested version was verified
                  live to render correctly through BOTH real entry points
                  (New PO's "+ New Item" and Add Parts' "+ New Item"),
                  typing a price into this exact field. Kept nested inside
                  this <label> (not hoisted into its own grid cell) — this
                  form is `grid grid-cols-2`, and a standalone sibling node
                  here would shift every field after it into the wrong
                  column. */}
              {(() => {
                const price = parseNumField(unitCost);
                if (price === null) return null;
                const doc = calculateInventoryVatDocument([{ qty: 1, unitPriceSar: price }]);
                return (
                  <div className="flex items-center gap-3 text-xs mt-1">
                    <span>
                      <span className="muted">{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}:</span>{" "}
                      <span className="font-medium tabular-nums">{formatSarVat(doc.vat)}</span>
                    </span>
                    <span>
                      <span className="muted">{lang === "en" ? "Total (incl. VAT)" : "الإجمالي (شامل الضريبة)"}:</span>{" "}
                      <span className="font-medium tabular-nums">{formatSarVat(doc.total)}</span>
                    </span>
                  </div>
                );
              })()}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder level *" : "حد إعادة الطلب *"}</span>
              <input
                value={reorderLevel}
                onChange={(e) => setReorderLevel(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder qty *" : "كمية إعادة الطلب *"}</span>
              <input
                value={reorderQty}
                onChange={(e) => setReorderQty(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
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
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? null : <Save className="h-4 w-4" />}
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Create item" : "إنشاء الصنف"}
            </button>
          </div>
        </form>
      </div>

      {newUnitOpen && (
        <NewUnitModal
          lang={lang}
          onClose={() => setNewUnitOpen(false)}
          onCreated={(u) => {
            setLocalUnits((prev) => [...prev, u]);
            setUnitCode(u.code);
          }}
        />
      )}
    </ModalOverlay>
  );
}

// Item 7 (polish round) — "Adjust Item": edit an EXISTING part's
// descriptive info from the part drawer. No preview equivalent (preview
// has NO edit-part UI at all — see this file's own AddPartModal-adjacent
// history/InventoryClient.tsx's header comment on why the edit flow was
// deleted entirely in an earlier pass) — this reverses that call, per
// Turki's own explicit ask now. GUARDRAILS, both enforced structurally,
// not just by omission from this form:
//   - SKU is shown read-only (same disabled-box pattern AddPartModal
//     already uses for its own read-only Warehouse field) — never
//     editable, matches updatePart()'s own PartUpdateInput type, which
//     doesn't even HAVE a sku field to set.
//   - Warehouse is ALSO shown read-only (not asked for explicitly, but the
//     same reasoning as SKU: every purchase_order_lines/price_lots row
//     already assumes this part's warehouse is stable — see actions.ts's
//     own updatePart() header for the full reasoning).
//   - No qty-on-hand field anywhere on this form, at all. Quantity only
//     ever moves through Adjust Stock / receive flows — never this one.
// Adds two fields AddPartModal's own create form never had — Supplier
// (free text, matches parts.supplier's own free-text convention — preview
// only ever assigns supplier later at receipt time, so create-time never
// asked for it) and Lead time (days) — because Turki's own field list for
// THIS form explicitly names supplier, and lead time is the one other
// descriptive field parts already carries that had no edit path anywhere.
export function AdjustItemModal({
  lang,
  part,
  warehouses,
  parts,
  units,
  onClose,
  onUpdated,
}: {
  lang: "en" | "ar";
  part: Part;
  warehouses: Warehouse[];
  parts: Part[];
  units: Unit[];
  onClose: () => void;
  onUpdated: (part: Part) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(part.name);
  const [nameAr, setNameAr] = useState(part.name_ar ?? "");
  const [category, setCategory] = useState(part.category ?? "");
  const [unitCost, setUnitCost] = useNumField(part.unit_cost_sar);
  const [reorderLevel, setReorderLevel] = useNumField(part.reorder_level);
  const [reorderQty, setReorderQty] = useNumField(part.reorder_qty);
  const [leadTimeDays, setLeadTimeDays] = useNumField(part.lead_time_days);
  const [supplier, setSupplier] = useState(part.supplier ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [localUnits, setLocalUnits] = useState<Unit[]>([]);
  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const allUnits = useMemo(() => {
    const ids = new Set(units.map((u) => u.id));
    return [...units, ...localUnits.filter((u) => !ids.has(u.id))];
  }, [units, localUnits]);
  const [unitCode, setUnitCode] = useState(part.unit ?? allUnits[0]?.code ?? "");

  const categoryOptions = useMemo(() => {
    const extra = parts.map((p) => p.category).filter((c): c is string => !!c);
    return Array.from(new Set([...CREATE_CATS, ...extra]));
  }, [parts]);

  const warehouseName = warehouses.find((w) => w.id === part.warehouse_id)?.name ?? "—";

  const canSubmit =
    name.trim() !== "" &&
    nameAr.trim() !== "" &&
    category.trim() !== "" &&
    unitCode !== "" &&
    parseNumField(unitCost) !== null &&
    parseNumField(reorderLevel) !== null &&
    parseNumField(reorderQty) !== null;

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
      setError(lang === "en" ? "Every required field must be filled." : "يجب تعبئة كل الحقول المطلوبة.");
      return;
    }
    const input: PartUpdateInput = {
      name: name.trim(),
      name_ar: nameAr.trim(),
      category,
      unit: unitCode,
      unit_cost_sar: parseNumField(unitCost),
      reorder_level: parseNumField(reorderLevel),
      reorder_qty: parseNumField(reorderQty),
      lead_time_days: parseNumField(leadTimeDays),
      supplier: supplier.trim() || null,
    };
    setSaving(true);
    setError(null);
    const res = await updatePart(part.id, input);
    setSaving(false);
    if (res.error || !res.part) {
      setError(res.error ?? (lang === "en" ? "Could not save changes." : "تعذّر حفظ التغييرات."));
      return;
    }
    onUpdated(res.part);
    onClose();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-[880px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold">{lang === "en" ? "Adjust Item" : "تعديل الصنف"}</h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-4">
            {lang === "en"
              ? "Edit this item's descriptive info. SKU and quantity on hand can't be changed here — quantity only ever moves through Adjust Stock or receiving."
              : "عدّل معلومات هذا الصنف. لا يمكن تغيير رمز الصنف أو الكمية المتوفرة من هنا — الكمية تتغيّر فقط عبر تعديل المخزون أو الاستلام."}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Item / Equipment name *" : "اسم الصنف / المعدة *"}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={INPUT_STYLE} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Name (Arabic) *" : "الاسم (عربي) *"}</span>
              <input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                required
              />
            </label>

            {/* Locked — read-only, same disabled-box pattern AddPartModal's
                own Warehouse field already uses. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "SKU" : "رمز الصنف"}</span>
              <div className="px-3 py-2 rounded-lg border text-sm font-mono" style={INPUT_STYLE}>
                {part.sku}
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Warehouse" : "المستودع"}</span>
              <div className="px-3 py-2 rounded-lg border text-sm" style={INPUT_STYLE}>
                {warehouseName}
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Category *" : "الفئة *"}</span>
              <ComboInput
                value={category}
                onChange={setCategory}
                options={categoryOptions.map((c) => ({ value: c, label: categoryLabel(c, lang) }))}
                placeholder={lang === "en" ? "Pick or type a category…" : "اختر أو اكتب فئة…"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit *" : "الوحدة *"}</span>
              <div className="flex gap-2">
                <select
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  className={cn(INPUT, "flex-1")}
                  style={INPUT_STYLE}
                  required
                >
                  <option value="" disabled>
                    {lang === "en" ? "Pick a unit…" : "اختر وحدة…"}
                  </option>
                  {allUnits.map((u) => (
                    <option key={u.id} value={u.code}>
                      {u.code} — {lang === "ar" && u.label_ar ? u.label_ar : u.label_en}
                    </option>
                  ))}
                </select>
                <Btn type="button" variant="outline" onClick={() => setNewUnitOpen(true)}>
                  {lang === "en" ? "+ Unit" : "+ وحدة"}
                </Btn>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Unit price (SAR) *" : "سعر الوحدة (ر.س) *"}</span>
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
              {(() => {
                const price = parseNumField(unitCost);
                if (price === null) return null;
                const doc = calculateInventoryVatDocument([{ qty: 1, unitPriceSar: price }]);
                return (
                  <div className="flex items-center gap-3 text-xs mt-1">
                    <span>
                      <span className="muted">{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}:</span>{" "}
                      <span className="font-medium tabular-nums">{formatSarVat(doc.vat)}</span>
                    </span>
                    <span>
                      <span className="muted">{lang === "en" ? "Total (incl. VAT)" : "الإجمالي (شامل الضريبة)"}:</span>{" "}
                      <span className="font-medium tabular-nums">{formatSarVat(doc.total)}</span>
                    </span>
                  </div>
                );
              })()}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder level *" : "حد إعادة الطلب *"}</span>
              <input
                value={reorderLevel}
                onChange={(e) => setReorderLevel(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Reorder qty *" : "كمية إعادة الطلب *"}</span>
              <input
                value={reorderQty}
                onChange={(e) => setReorderQty(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Lead time (days)" : "مدة التوريد (أيام)"}</span>
              <input
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(blockNegative(e.target.value))}
                className={INPUT}
                style={INPUT_STYLE}
                inputMode="decimal"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Supplier" : "المورّد"}</span>
              <input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={lang === "en" ? "Free text — set at receipt time otherwise" : "نص حر — يُحدد وقت الاستلام غير ذلك"}
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
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? null : <Save className="h-4 w-4" />}
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Save changes" : "حفظ التغييرات"}
            </button>
          </div>
        </form>
      </div>

      {newUnitOpen && (
        <NewUnitModal
          lang={lang}
          onClose={() => setNewUnitOpen(false)}
          onCreated={(u) => {
            setLocalUnits((prev) => [...prev, u]);
            setUnitCode(u.code);
          }}
        />
      )}
    </ModalOverlay>
  );
}

// "+ Unit" inline-create modal — units table (migration 0049, LIVE). Same
// shape/role as NewSupplierModal/CreateWarehouseModal's onCreated pattern:
// captures code + English label + Arabic label, inserts via createUnit(),
// hands the fresh row back so AddPartModal can merge it into the picker and
// auto-select it. Duplicate codes are rejected cleanly server-side (units
// .code unique constraint, 0049) — createUnit() already turns that into a
// plain message, surfaced here like any other validation error.
function NewUnitModal({
  lang,
  onClose,
  onCreated,
}: {
  lang: "en" | "ar";
  onClose: () => void;
  onCreated: (unit: Unit) => void;
}) {
  const [code, setCode] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.trim() !== "" && labelEn.trim() !== "";

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError(
        lang === "en" ? "Code and English label are required." : "الرمز والاسم بالإنجليزية مطلوبان."
      );
      return;
    }
    const input: UnitInput = {
      code: code.trim(),
      label_en: labelEn.trim(),
      label_ar: labelAr.trim() || null,
    };
    setSaving(true);
    setError(null);
    const res = await createUnit(input);
    setSaving(false);
    if (res.error || !res.unit) {
      setError(res.error ?? (lang === "en" ? "Could not create unit." : "تعذّر إنشاء الوحدة."));
      return;
    }
    onCreated(res.unit);
    onClose();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "Add a new unit" : "إضافة وحدة جديدة"}
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
              <span className="muted">{lang === "en" ? "Code *" : "الرمز *"}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder={lang === "en" ? "e.g. box" : "مثال: box"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "English label *" : "التسمية بالإنجليزية *"}</span>
              <input
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder={lang === "en" ? "e.g. Box" : "مثال: Box"}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Arabic label" : "التسمية بالعربية"}</span>
              <input
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                placeholder={lang === "en" ? "optional" : "اختياري"}
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
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? null : <Save className="h-4 w-4" />}
              {saving
                ? lang === "en" ? "Saving…" : "جارٍ الحفظ…"
                : lang === "en" ? "Add a new unit" : "إضافة وحدة جديدة"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// Local (not-yet-uploaded) invoice file preview — image thumbnail or a "PDF"
// badge + filename, mirrors preview's invoice-tile gallery. Object URL is
// created/revoked per file via effect cleanup, same lifecycle rule as any
// other client-only blob preview in this app. Shared by ReceivePartsModal
// (InventoryClient.tsx) and ReceivePOModal (PurchaseOrders.tsx, Phase 5) —
// lives here, a leaf module, so neither of those two needs to import it
// from the other (see this file's own header for the import-cycle it
// avoids).
export function InvoiceFileTile({
  file,
  lang,
  onRemove,
}: {
  file: File;
  lang: "en" | "ar";
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  // Structure mirrors preview's .invoice-tile exactly (app.css ~570-578):
  // fixed-height image/PDF-badge block on top, filename row below it (not
  // an overlay banner on the image), hover-reveal remove button (opacity 0
  // -> 1 on hover, not always-visible), hover border turns brand-blue with
  // a soft shadow.
  return (
    <div
      className="group relative rounded-lg border overflow-hidden flex flex-col transition-all hover:border-brand-500 hover:shadow-md"
      style={INPUT_STYLE}
    >
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="w-full h-[70px] object-cover block" />
      ) : (
        <div className="flex flex-col items-center justify-center h-[70px] gap-1 bg-rose-500/[0.06]">
          <span className="bg-rose-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide">
            PDF
          </span>
        </div>
      )}
      <span className="text-[11px] muted px-1.5 py-1 truncate">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        title={lang === "en" ? "Remove" : "حذف"}
        className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-rose-700 text-white text-[11px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  );
}
