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
//   - Movement-history table (drawer) — stands in for preview's work_orders-
//     linked maintenance usage log, which doesn't exist in this schema yet
//     (needs a Maintenance phase). Shows the stock_movements ledger instead
//     (the audit trail our receive/adjust/price-lot RPCs already write
//     either way).
//
// Phase 2 (FIFO price lots, migration 0046 — LIVE) added: the batches table
// (qty purchased/remaining + current/old/depleted status badge, exactly
// preview's batchesHTML) and a current/previous-price + trend + weighted-
// avg-cost strip above it (preview's pricing-snapshot card). The drawer's
// own "Add new price" button (preview's INV.openPriceLot) was REMOVED
// post-launch (Turki's test-6 feedback on e9a03d5) — it added stock with
// no invoice/receipt record, a second, weaker path alongside the real
// receiving flow. It's now "Add Parts" instead, opening ReceivePartsModal
// prefilled with this part (see ViewPartModal's onReceiveMore) — same RPC
// path (receive_loose_parts -> add_price_lot per line) every other receipt
// uses. consume_from_lots (also in 0046) has NO caller anywhere in this
// app yet — there's no consumption event to drive it until a work-order-
// parts-usage phase exists. It's live in the DB, just unused until then.
//
// NOT built (flagged, needs new tables/functions — confirm before drafting a
// migration, not created here): Purchase Orders, Approvals tab, Financial
// Analysis tab, AI-suggest-PO, receipt invoice-photo upload, per-part
// Financial Report + AI insight, row's "Financial report"/"Create PO"
// buttons, drawer's conditional "Create PO" footer button.
//
// Stock-tier coloring mirrors preview/'s INV.stockCell exactly: critical
// (qty <= reorder) / low (qty <= 1.5x reorder) / ok. Parts with no
// reorder_level are never "low" — plain/neutral stock cell.
//
// Cleanup + UI-fidelity pass (post-Phase-3, dead-code sweep + demo-size
// audit) — Turki flagged two more preview divergences by screenshot:
//   - "New item" was WRONG here — a standalone header "Add Part" button.
//     Re-confirmed by source read: preview NEVER has a header new-item
//     button (its header is New PO / Add Parts / AI-suggest only —
//     inventory()'s headerActions, pages-2.js ~3022). openNewPart() is
//     bound EXCLUSIVELY next to "Add line" inside an active draft
//     (Add-Parts or PO — pages-2.js ~2206/2682), and drops the fresh part
//     straight into that draft as a line (saveNewPart). The header
//     "Add Part" button + its addPartModalOpen state are deleted; AddPartModal
//     is now mounted ONLY inside ReceivePartsModal as "New Item" (primary/
//     blue, plus icon, same spot preview puts it), via an onCreated callback
//     that merges the new part into the draft's local part list AND adds it
//     as a line — same as picking it from the dropdown + Add line. Its
//     warehouse field became a read-only display (was a free picker) — the
//     component is now single-purpose (always opened from an in-progress
//     receipt with a fixed warehouseId already chosen), so a free re-pick
//     could silently create the part in a different warehouse than the very
//     receipt it's being received into. Also flips "Add Parts" header
//     button's visibility gate from parts.length>0 to warehouses.length>0 —
//     it's the ONLY entry point left for a brand-new catalog's first part
//     (via New Item inside it), so it can no longer be hidden by "no parts
//     exist yet" — preview's own header never gates it on parts.length
//     either.
//   - Popup sizes didn't match preview/'s modal-shell size classes
//     (app.css: default max-width 880px, .lg 1080px). View part (preview:
//     size:"lg") and Add Parts (preview: size:"lg") were both max-w-2xl
//     (672px) — bumped to max-w-4xl, this app's own existing convention for
//     a "lg" detail/draft modal elsewhere (FleetDetailClient/FleetClient's
//     view drawers, InvoiceDetailModal). New Item (preview: default, no
//     size) was also max-w-2xl — bumped to max-w-3xl, this app's existing
//     convention for a default-size form modal (ProjectModal/
//     WaterStationsModal/StatementModal). Create Warehouse/New supplier/
//     Update market price/Adjust stock sizes are untouched — not named in
//     Turki's screenshots, left as-is pending explicit sign-off.
//
// Field-by-field preview-fidelity pass (superseded the size approximation
// above with preview's literal pixel widths, plus a full re-audit of the
// Add Parts/receive modal against pages-2.js's _renderReceiveModal +
// app.css, element by element, not just the previously-named items):
//   - View/Add Parts popups: max-w-4xl -> max-w-[1080px] (preview's exact
//     .lg width); New Item: max-w-3xl -> max-w-[880px] (preview's exact
//     default width). Exact match, not an app-convention approximation.
//   - "Parts received" -> "Line items" (poLines); "Qty"/"Unit price" column
//     headers -> "Actual qty received"/"Actual unit price" (actualQty/
//     actualUnitPrice); floating "Total" div below the table -> "Actual
//     total" (actualTotal) inside a <tfoot> row under the Subtotal column,
//     matching preview's table markup exactly, not a separate element.
//   - Line-item table now wrapped in its own Card (`.card overflow-hidden`
//     in preview) — a distinct visual block, not blended into the popup.
//   - Remove-line icon: X -> Trash2 (preview's ICONS.trash()).
//   - Supplier "+ New" -> "+ Supplier" (preview's exact button text, no
//     icon glyph — the preview button has none either). Added the missing
//     inline "+ Warehouse" trigger next to the warehouse picker (preview's
//     openNewWarehouse, pages-2.js ~2656) — this app had ONLY a page-header
//     "Create Warehouse" button before, no inline one inside Add Parts.
//     (REMOVED again later — per-warehouse tabs on the Inventory page,
//     Turki's explicit call: the header button is the only entry point
//     now, in NewPOModal or here. See ReceivePartsModal's own comment.)
//   - Invoice box: border now dashed-while-missing / solid-once-met
//     (preview's .invoice-required/.is-met, was solid both states); helper
//     text restored to preview's full two-sentence copy (was truncated);
//     "Add invoice" icon Plus -> Upload (preview's ICONS.upload()); real
//     drag-and-drop wired (onDragOver/onDrop -> addFiles) since preview's
//     own copy promises it even though the static demo has no literal drop
//     handler; gallery switched to a CSS grid (auto-fill, minmax(120px,1fr))
//     matching preview's .invoice-gallery, was a fixed-width flex-wrap.
//   - InvoiceFileTile rebuilt to match preview's .invoice-tile structure:
//     fixed-height (70px) image/PDF-badge block on top, filename row below
//     it (was an overlay banner on the image), remove button now
//     hover-reveal (was always visible), hover border turns brand-blue with
//     a shadow (preview's invoice-tile:hover).
//   - NewSupplierModal: title + save-button label both -> "Add a new
//     supplier" (preview reuses inv.newSupplierTitle for both, verbatim);
//     2-col field grid (was 1-col); intro paragraph + field labels/
//     placeholders matched to preview's openNewSupplier() exactly; Save
//     icon added to the submit button (preview's ICONS.save()).
//   - Save & receive / Create item buttons gained their preview icons
//     (Check / Save respectively) — were text-only.
//   - Two DELIBERATE extensions beyond preview, per Turki's explicit ask
//     (not preview divergences to "fix", new scope):
//     1. Category/Unit on New Item are now combo inputs (native
//        input+datalist) — pick a suggestion or type a new value, which is
//        saved as-is and reappears as a suggestion next time. No migration
//        needed — both columns are already free text (0043).
//     2. New Supplier Arabic-name field — FLAGGED, NOT built. `suppliers`
//        (0045) has no `name_ar` column; adding one is a migration-review
//        decision, not made unilaterally here. Everything else in that
//        modal is preview-matched.
//   - Explicitly OUT of this pass's scope (peripheral modals only reachable
//     from inside Add Parts, not "the Add Parts popup" itself): New
//     Warehouse's own field set (Location/Type/Note here vs preview's City/
//     Address) — only wired an onCreated callback onto the existing
//     component so the new inline trigger works; its fields are untouched.

import { useEffect, useMemo, useRef, useState } from "react";
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
  Boxes,
  TrendingUp,
  TrendingDown,
  Banknote,
  Trash2,
  Upload,
  Check,
  ShoppingCart,
  Zap,
  BarChart3,
  Pencil,
} from "lucide-react";
import { useApp } from "@/components/AppShell";
import { PageHeader, Btn, Stat, Table, TH, TD, Card } from "@/components/ui";
import { cn, formatSar, formatNum, todayKey } from "@/lib/utils";
// VAT (migration 0056) — fixed 15%, per-line rounding summed. Deliberately
// NOT lib/vat.ts (see lib/inventory-vat.ts's own header).
import { lineVat, calculateInventoryVatDocument, formatSarVat } from "@/lib/inventory-vat";
import type {
  Warehouse,
  Part,
  StockMovement,
  Supplier,
  PriceLot,
  Unit,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderApproval,
} from "@/lib/db-types";
import {
  ProcStrip,
  NewPOModal,
  POListModal,
  PODetailModal,
  ReceiveListModal,
  ReceivePOModal,
  ApprovePOModal,
  RejectPOModal,
  ApprovalsTab,
  FinancialAnalysisTab,
  PartFinanceModal,
  PartFinanceSummaryCard,
  computePartFinanceStats,
  suggestAIPurchaseLines,
  type NewPOAISuggestion,
  type NewPOQuickReorder,
  type EditingPO,
} from "./PurchaseOrders";
import {
  ModalOverlay,
  CreateWarehouseModal,
  NewSupplierModal,
  AddPartModal,
  AdjustItemModal,
  InvoiceFileTile,
  categoryLabel,
  useNumField,
  parseNumField,
  PartPicker,
  stockTier,
  type StockTier,
  TIER_TEXT,
  TIER_DOT,
  TIER_LABEL,
} from "./SharedCreateModals";
import {
  adjustStock,
  getPartMovements,
  getPriceLots,
  receiveLooseParts,
  type ReceiveLine,
} from "./actions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

const MOVEMENT_LABEL: Record<StockMovement["movement_type"], { en: string; ar: string }> = {
  receive: { en: "Received", ar: "استلام" },
  adjust: { en: "Adjusted", ar: "تعديل" },
  receive_lot: { en: "Price lot", ar: "دفعة سعر" },
  consume: { en: "Consumed", ar: "استهلاك" },
};

// preview/'s invInventoryView's own hardcoded CATS list, verbatim (its exact
// order, "all" excluded here since the "All" chip is rendered separately).
const FILTER_CATS = ["engine", "brake", "tire", "fluid", "electrical", "tank", "filter", "consumable"];

// CREATE_CATS/CATEGORY_LABEL/categoryLabel/autoSku/useNumField/parseNumField
// /ComboInput/CreateWarehouseModal/NewSupplierModal/AddPartModal all moved to
// ./SharedCreateModals.tsx (imported below) to break a circular import —
// PurchaseOrders.tsx needs the three modals, and this file needs
// ProcStrip/NewPOModal/POListModal/PODetailModal from PurchaseOrders.tsx.
// See that file's own header comment for the full postmortem.

export default function InventoryClient({
  warehouses,
  parts,
  priceLots,
  suppliers,
  units,
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderApprovals,
  currentUserEmail,
  error,
}: {
  warehouses: Warehouse[];
  parts: Part[];
  priceLots: PriceLot[];
  suppliers: Supplier[];
  units: Unit[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  purchaseOrderApprovals: PurchaseOrderApproval[];
  currentUserEmail: string | null;
  error: string | null;
}) {
  const { lang } = useApp();
  // Phase 7 — top-level sub-tabs (preview: inventory()'s 3-tab structure,
  // pages-2.js ~3012-3016). Header action buttons (New PO/Add Parts) and
  // the ProcStrip/search+filter/parts table only ever show on "inventory" —
  // matches preview's own headerActions gate exactly.
  const [invTab, setInvTab] = useState<"inventory" | "approvals" | "analysis">("inventory");
  // Per-warehouse scoping (Turki's explicit call, deviates from preview —
  // preview's own per-warehouse control is a dropdown with an "All
  // warehouses" option; this app has no combined view at all, one tab per
  // warehouse, always exactly one selected). Replaces the old warehouseFilter
  // dropdown entirely — this is the ONLY thing that filters the parts/
  // inventory view now. Everything else on the page (KPI row, ProcStrip,
  // Approvals, Financial Analysis, AI-Suggest) stays fully global/unscoped,
  // unchanged — matches preview's own KPI/AI-Suggest behavior (already
  // computed from ALL parts, see below) and Turki's explicit requirement
  // that Approvals/Financial Analysis never filter by warehouse.
  const [warehouseTab, setWarehouseTab] = useState<string>(warehouses[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [viewPart, setViewPart] = useState<Part | null>(null);
  const [financePart, setFinancePart] = useState<Part | null>(null);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  // Prefill for ReceivePartsModal when opened from the part drawer's own
  // "Add Parts" button (test 6 fix — see ReceivePartsModal's own header
  // comment for the full rationale). null when opened from the header
  // button instead (blank draft, as before).
  const [receivePrefill, setReceivePrefill] = useState<{ warehouseId: string; lines: ReceiveLine[] } | null>(null);
  const [adjustModal, setAdjustModal] = useState<{ part: Part } | null>(null);
  // Item 7 (polish round) — "Adjust Item" (descriptive-info edit, distinct
  // from adjustModal/Adjust Stock above).
  const [adjustItemPart, setAdjustItemPart] = useState<Part | null>(null);
  // Phase 4 — Purchase Orders (migration 0050).
  const [newPOOpen, setNewPOOpen] = useState(false);
  const [poListOpen, setPoListOpen] = useState(false);
  const [viewPO, setViewPO] = useState<PurchaseOrder | null>(null);
  // Phase 5 — PO receiving (migration 0051).
  const [receiveListOpen, setReceiveListOpen] = useState(false);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  // Phase 6 — PO Approvals (migration 0052). Pending-review now reaches the
  // Approvals tab directly (ProcStrip's onGoToApprovals -> setInvTab), no
  // standalone list-modal in between — matches preview's own setTab, which
  // has no popup for this at all.
  const [approvePO, setApprovePO] = useState<PurchaseOrder | null>(null);
  const [rejectPO, setRejectPO] = useState<PurchaseOrder | null>(null);
  // Phase 7 — AI-Suggest-PO (migration 0053). Set right before opening
  // NewPOModal so it renders with the .ai-banner + prefilled lines; cleared
  // on close so a plain "New PO" click afterwards opens blank again.
  const [aiSuggestion, setAiSuggestion] = useState<NewPOAISuggestion | null>(null);
  // "Risky batch" Stage 3, item 6 — set right before opening NewPOModal (via
  // the SAME newPOOpen state) so it renders in edit mode instead of create
  // mode; mutually exclusive with aiSuggestion, cleared on close.
  const [editingPO, setEditingPO] = useState<EditingPO | null>(null);
  // Follow-up batch, item 1 — single-part quick-reorder. Mutually exclusive
  // with aiSuggestion/editingPO (all three share newPOOpen + NewPOModal's
  // create-mode branch), cleared on close.
  const [quickReorder, setQuickReorder] = useState<NewPOQuickReorder | null>(null);

  const warehousesById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  // Current/previous price per part, derived from priceLots (already sorted
  // received_on/created_at ascending by the page query) — same "last two
  // lots chronologically" rule ViewPartModal uses for currentLot/previousLot,
  // just precomputed once for every row instead of per-drawer-open.
  const pricesByPart = useMemo(() => {
    const m = new Map<string, { current: PriceLot; previous: PriceLot | null }>();
    for (const lot of priceLots) {
      const existing = m.get(lot.part_id);
      if (!existing) {
        m.set(lot.part_id, { current: lot, previous: null });
      } else {
        m.set(lot.part_id, { current: lot, previous: existing.current });
      }
    }
    return m;
  }, [priceLots]);

  const visibleParts = useMemo(() => {
    return parts.filter((p) => {
      if (p.warehouse_id !== warehouseTab) return false;
      if (cat !== "all" && p.category !== cat) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${p.name} ${p.sku} ${p.name_ar ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [parts, warehouseTab, cat, q]);

  // GLOBAL versions — computed from ALL parts/POs regardless of warehouse
  // tab. Matches preview's inventoryPage() (totalValue/lowStock use
  // D().parts directly) and stays this way on purpose: these feed the
  // Approvals-tab badge count (invTab strip, below) and FinancialAnalysisTab
  // — both explicitly required to stay global ("risky batch" Stage 3,
  // items 2/3's carve-out). Do NOT scope these to warehouseTab.
  const inventoryValue = parts.reduce(
    (s, p) => s + (p.unit_cost_sar != null ? p.unit_cost_sar * p.qty_on_hand : 0),
    0
  );
  const openPOsCount = purchaseOrders.filter((o) => o.status === "draft" || o.status === "issued").length;
  const pendingReviewCount = purchaseOrders.filter((o) => o.status === "pending_approval").length;

  // WAREHOUSE-SCOPED versions ("risky batch" Stage 3, items 2/3) — the KPI
  // row and the "Active procurement" (ProcStrip) strip now reflect ONLY the
  // active warehouse tab. Separate variables from the global ones above,
  // not a rename/in-place filter — reusing the same variable for both KPI
  // row and Financial Analysis would have silently scoped Financial
  // Analysis too, which Turki explicitly said must stay global.
  const kpiParts = useMemo(() => parts.filter((p) => p.warehouse_id === warehouseTab), [parts, warehouseTab]);
  const kpiPurchaseOrders = useMemo(
    () => purchaseOrders.filter((o) => o.warehouse_id === warehouseTab),
    [purchaseOrders, warehouseTab]
  );
  const kpiInventoryValue = kpiParts.reduce(
    (s, p) => s + (p.unit_cost_sar != null ? p.unit_cost_sar * p.qty_on_hand : 0),
    0
  );
  const kpiSkuCount = kpiParts.length;
  const kpiLowStockCount = kpiParts.filter(
    (p) => p.reorder_level != null && p.qty_on_hand <= p.reorder_level
  ).length;
  const kpiOpenPOsCount = kpiPurchaseOrders.filter((o) => o.status === "draft" || o.status === "issued").length;
  const kpiAwaitingReceiptCount = kpiPurchaseOrders.filter((o) => o.status === "issued").length;
  const kpiPendingReviewCount = kpiPurchaseOrders.filter((o) => o.status === "pending_approval").length;

  // AI-Suggest-PO (Phase 7, migration 0053, LIVE) — preview's INV.openAIPO()
  // (pages-2.js ~2115-2133). No toast utility exists anywhere in this app
  // (grepped — zero hits), so the "nothing to reorder" case disables the
  // button instead of toasting (see the button's disabled attr below); the
  // header button always renders (so the user can see it's there and why
  // it's disabled), but the Financial Analysis tab's CTA only renders at
  // all when lowParts.length > 0, so it never needs the disabled state.
  const aiPurchaseSuggestion = suggestAIPurchaseLines(parts, purchaseOrders, purchaseOrderLines, suppliers);
  function openAISuggest() {
    if (!aiPurchaseSuggestion) return;
    setAiSuggestion(aiPurchaseSuggestion);
    setEditingPO(null);
    setQuickReorder(null);
    setNewPOOpen(true);
  }

  // Single-part quick-reorder (item 1, follow-up batch) — preview's own
  // INV.openReorder (pages-2.js:1877). "Last supplier" = the most recent PO
  // (by request_date, any status) carrying a line for this part — richer
  // than the static parts.supplier free-text field. Falls back to matching
  // that free-text field against a real supplier's name (same heuristic
  // suggestAIPurchaseLines already uses above), then finally null, leaving
  // the field blank for the user to pick, same as any other blank New PO.
  function findLastSupplierId(part: Part): string | null {
    const posForPart = purchaseOrders
      .filter((po) => purchaseOrderLines.some((l) => l.purchase_order_id === po.id && l.part_id === part.id))
      .sort((a, b) => (a.request_date < b.request_date ? 1 : a.request_date > b.request_date ? -1 : 0));
    if (posForPart.length > 0) return posForPart[0].supplier_id;
    const match = part.supplier && suppliers.find((s) => s.name === part.supplier);
    return match ? match.id : null;
  }

  function openQuickReorder(part: Part) {
    // Same "enough to clear reorder level" formula already used for the
    // "Add Parts" drawer-button prefill (Stage 1 of the risky batch).
    const qty = part.reorder_level != null ? Math.max(1, part.reorder_level - part.qty_on_hand + 1) : 1;
    setAiSuggestion(null);
    setEditingPO(null);
    setQuickReorder({
      warehouseId: part.warehouse_id,
      supplierId: findLastSupplierId(part),
      line: { part_id: part.id, qty, unit_price_sar: part.unit_cost_sar ?? 0 },
    });
    setNewPOOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "en" ? "Inventory" : "المخزون"}
        subtitle={
          // preview's c.invSubtitle ("Parts, fluids, tires & equipment across
          // 3 warehouses", i18n.js:321) hardcodes preview's own demo data —
          // matched here on real warehouse count instead of copying "3"
          // verbatim, so the message stays correct as warehouses are added.
          lang === "en"
            ? `Parts, fluids, tires & equipment across ${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}`
            : `قطع وسوائل وإطارات ومعدات في ${warehouses.length} ${warehouses.length === 1 ? "مستودع" : "مستودعات"}`
        }
        actions={
          <>
            <Btn variant="outline" onClick={() => setWarehouseModalOpen(true)}>
              <Plus className="h-4 w-4" />
              {lang === "en" ? "Create Warehouse" : "إنشاء مستودع"}
            </Btn>
            {/* Phase 4 — preview's header order is New PO (primary) / Add
                Parts (outline) / AI-suggest-PO (outline). Same warehouse-
                required gate as Add Parts — a PO always needs a warehouse
                picked; New Item/New Supplier are still available inline
                inside the New PO modal for the chicken-and-egg case.
                preview gates its ENTIRE header action row to the Inventory
                Levels sub-tab (headerActions, pages-2.js ~3022) — matched
                here too. */}
            {invTab === "inventory" && warehouses.length > 0 && (
              <Btn
                variant="primary"
                onClick={() => {
                  setAiSuggestion(null);
                  setEditingPO(null);
                  setQuickReorder(null);
                  setNewPOOpen(true);
                }}
              >
                <ShoppingCart className="h-4 w-4" />
                {/* Item 5 (polish round) — preview's own i18n.js:569
                    ("newPO": "New Purchase Order" / "أمر شراء جديد" — only
                    the English string was ever shortened here; Arabic
                    already matched). */}
                {lang === "en" ? "New Purchase Order" : "أمر شراء جديد"}
              </Btn>
            )}
            {/* preview/'s header has no standalone "new part" button — new-
                item creation lives ONLY inside the Add Parts draft (INV.
                openNewPart, bound next to "Add line"). Matches exactly: Add
                Parts is the one header entry point, not gated by parts.length
                (a brand-new catalog reaches its first part through "New
                Item" inside this very modal — same chicken-and-egg fix
                preview's own header already has, since it never gates on
                parts.length either). */}
            {invTab === "inventory" && warehouses.length > 0 && (
              <Btn
                variant="outline"
                onClick={() => {
                  setReceivePrefill(null);
                  setReceiveModalOpen(true);
                }}
              >
                <PackagePlus className="h-4 w-4" />
                {lang === "en" ? "Add Parts" : "إضافة قطع"}
              </Btn>
            )}
            {/* AI-Suggest-PO (Phase 7, migration 0053) — preview's own
                header AI-suggest button, always visible on this sub-tab
                (not gated on lowParts.length, matching preview) but
                disabled when there's genuinely nothing to reorder — no
                toast utility exists in this app (grepped, zero hits), so
                preview's toast message ("Nothing to reorder — all parts
                above threshold.", pages-2.js:2119-2122) is shown as a
                tooltip instead of a popup. BUG FIX: a `title` attribute on
                the <button> itself never fires on hover once `disabled` is
                set (Chrome/most browsers suppress hover events on disabled
                controls entirely — confirmed by Turki testing it) — the
                title has to live on a wrapping element that ISN'T disabled;
                the inner Btn's own `disabled:pointer-events-none` then lets
                hover fall through to this wrapper. */}
            {invTab === "inventory" && warehouses.length > 0 && (
              <span
                title={
                  aiPurchaseSuggestion
                    ? undefined
                    : lang === "en"
                    ? "Nothing to reorder — all parts above threshold."
                    : "لا شيء للطلب — كل القطع فوق الحد."
                }
              >
                {/* Item 6 (polish round) — purple/blue gradient, this app's
                    own established "AI" visual language (the ★ AI / AiPill
                    badge shown on ai_generated POs elsewhere already uses
                    this exact gradient — same source as preview's own
                    .ai-chip/.ai-pill, app.css ~731-739:
                    linear-gradient(135deg,#8b5cf6,#0b7eea)). Was plain
                    outline, indistinguishable from New PO/Add Parts. */}
                <Btn
                  variant="primary"
                  className="!bg-gradient-to-br !from-[#8b5cf6] !to-[#0b7eea] hover:!opacity-90"
                  onClick={openAISuggest}
                  disabled={!aiPurchaseSuggestion}
                >
                  <Zap className="h-4 w-4" />
                  {lang === "en" ? "AI-Suggest" : "اقتراح ذكي"}
                </Btn>
              </span>
            )}
          </>
        }
      />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {warehouses.length === 0 ? (
        <EmptyWarehouseState lang={lang} onCreate={() => setWarehouseModalOpen(true)} />
      ) : (
        <>
          {/* Per-warehouse tabs — Turki's explicit call, no preview
              equivalent (preview uses an "All warehouses" + per-warehouse
              dropdown; this app has no combined view at all). Sits right
              below the page title/header, above everything else. Filters
              ONLY the parts/inventory view (visibleParts -> PartsTable,
              below) — the KPI row, ProcStrip, Approvals, Financial
              Analysis, and AI-Suggest are all unaffected, unchanged, still
              fully global (see their own comments).
              Item 4 (polish round) — restyled from a filled-pill segmented
              control to this app's own underline-tab convention (matches
              TripsTabs.tsx's Projects/Customers/Finance tabs and the
              Drivers & People sub-tabs exactly: border-b container +
              border-b-2 -mb-px active indicator), so the warehouse tabs
              read as the SAME kind of tab bar as every sister page,
              instead of a bespoke pill-segmented control unique to this
              one. The border-b IS the divider line under the title, same
              as TripsTabs — no separate <hr>/divider element needed. */}
          <div
            className="flex items-center gap-1 border-b flex-wrap"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            {warehouses.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWarehouseTab(w.id)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition whitespace-nowrap",
                  warehouseTab === w.id
                    ? "border-brand-600 text-brand-600 dark:text-brand-300"
                    : "border-transparent muted hover:text-[rgb(var(--fg))]"
                )}
              >
                {w.name}
              </button>
            ))}
          </div>

          {/* Top-level KPI row — preview's own inventory()'s 5-stat row
              (pages-2.js ~3035-3041), ALWAYS visible above the tabs
              regardless of which sub-tab is active (unlike the ProcStrip,
              which is Inventory-Levels-tab-scoped, see below). "Risky
              batch" Stage 3, item 2 — now reflects the ACTIVE WAREHOUSE
              TAB only (kpi* variables above), not all warehouses combined —
              a deliberate departure from preview's own always-global KPIs,
              Turki's explicit call. */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat
              label={lang === "en" ? "Inventory Value" : "قيمة المخزون"}
              value={formatSar(kpiInventoryValue)}
              tone="info"
            />
            <Stat label={lang === "en" ? "SKUs" : "أصناف"} value={kpiSkuCount} />
            {/* preview's c.lowStock ("Low Stock Items"/"أصناف منخفضة", i18n.js:234) */}
            <Stat
              label={lang === "en" ? "Low Stock Items" : "أصناف منخفضة"}
              value={kpiLowStockCount}
              tone={kpiLowStockCount > 0 ? "bad" : "ok"}
            />
            <Stat
              label={lang === "en" ? "Open POs" : "أوامر مفتوحة"}
              value={kpiOpenPOsCount}
              tone={kpiOpenPOsCount > 0 ? "info" : "ok"}
            />
            <Stat
              label={lang === "en" ? "Pending Approval" : "بانتظار الاعتماد"}
              value={kpiPendingReviewCount}
              tone={kpiPendingReviewCount > 0 ? "warn" : "ok"}
            />
          </div>

          {/* Sub-tab nav — preview's .inv-tabs (pages-2.js ~3012-3016,
              app.css ~651-665): Inventory Levels / Approvals / Financial
              Analysis. Turki: both Approvals and Financial Analysis were
              missing from this app entirely before this pass — preview has
              had them since the Purchase Orders phases began. */}
          <div
            className="inline-flex p-1 gap-1 rounded-xl border flex-wrap"
            style={{ background: "rgb(var(--card))", borderColor: "rgb(var(--border))" }}
          >
            {(
              [
                ["inventory", lang === "en" ? "Inventory Levels" : "مستويات المخزون", null],
                ["approvals", lang === "en" ? "Approvals" : "الموافقات", pendingReviewCount],
                ["analysis", lang === "en" ? "Financial Analysis" : "التحليل المالي", null],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setInvTab(key)}
                className={cn(
                  "px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap",
                  invTab === key ? "bg-brand-600 text-white shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                {label}
                {count != null && (
                  <span className={cn("ms-1", invTab === key ? "text-white/85" : "muted")}>({count})</span>
                )}
              </button>
            ))}
          </div>

          {invTab === "inventory" && (
            <>
              {/* "Risky batch" Stage 3, item 3 — scoped to the active
                  warehouse tab (kpi* variables), not global. Approvals/
                  Financial Analysis stay unaffected — see this component's
                  own onGoToApprovals, which switches to the (global)
                  Approvals tab, not a warehouse-scoped view of it. */}
              <ProcStrip
                lang={lang}
                openCount={kpiOpenPOsCount}
                awaitingReceiptCount={kpiAwaitingReceiptCount}
                pendingReviewCount={kpiPendingReviewCount}
                onOpenList={() => setPoListOpen(true)}
                onOpenReceiveList={() => setReceiveListOpen(true)}
                onGoToApprovals={() => setInvTab("approvals")}
              />

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
                </div>
              </Card>

              <PartsTable
                parts={visibleParts}
                warehousesById={warehousesById}
                pricesByPart={pricesByPart}
                lang={lang}
                onView={(p) => setViewPart(p)}
                onFinance={(p) => setFinancePart(p)}
                onQuickReorder={openQuickReorder}
              />
            </>
          )}

          {invTab === "approvals" && (
            <ApprovalsTab
              lang={lang}
              purchaseOrders={purchaseOrders}
              purchaseOrderLines={purchaseOrderLines}
              purchaseOrderApprovals={purchaseOrderApprovals}
              suppliers={suppliers}
              onView={(po) => setViewPO(po)}
              onApprove={(po) => setApprovePO(po)}
            />
          )}

          {invTab === "analysis" && (
            <FinancialAnalysisTab
              lang={lang}
              parts={parts}
              priceLots={priceLots}
              purchaseOrders={purchaseOrders}
              purchaseOrderLines={purchaseOrderLines}
              suppliers={suppliers}
              inventoryValue={inventoryValue}
              openPOsCount={openPOsCount}
              onOpenAISuggest={openAISuggest}
            />
          )}
        </>
      )}

      {warehouseModalOpen && (
        <CreateWarehouseModal
          lang={lang}
          onClose={() => setWarehouseModalOpen(false)}
          onCreated={(w) => setWarehouseTab(w.id)}
        />
      )}

      {viewPart && (
        <ViewPartModal
          lang={lang}
          part={viewPart}
          warehousesById={warehousesById}
          purchaseOrders={purchaseOrders}
          purchaseOrderLines={purchaseOrderLines}
          onClose={() => setViewPart(null)}
          onAdjust={(p) => {
            setViewPart(null);
            setAdjustModal({ part: p });
          }}
          onAdjustItem={(p) => {
            setViewPart(null);
            setAdjustItemPart(p);
          }}
          onReceiveMore={(prefill) => {
            setViewPart(null);
            setReceivePrefill(prefill);
            setReceiveModalOpen(true);
          }}
          onQuickReorder={(p) => {
            setViewPart(null);
            openQuickReorder(p);
          }}
        />
      )}

      {financePart && (
        <PartFinanceModal
          lang={lang}
          part={financePart}
          warehouses={warehouses}
          priceLots={priceLots}
          purchaseOrders={purchaseOrders}
          purchaseOrderLines={purchaseOrderLines}
          onClose={() => setFinancePart(null)}
          onViewPO={(po) => setViewPO(po)}
          onViewPart={(p) => setViewPart(p)}
        />
      )}

      {receiveModalOpen && (
        <ReceivePartsModal
          lang={lang}
          parts={parts}
          warehouses={warehouses}
          suppliers={suppliers}
          units={units}
          prefill={receivePrefill ?? undefined}
          defaultWarehouseId={warehouseTab}
          onClose={() => {
            setReceiveModalOpen(false);
            setReceivePrefill(null);
          }}
        />
      )}

      {adjustModal && (
        <AdjustStockModal lang={lang} part={adjustModal.part} onClose={() => setAdjustModal(null)} />
      )}

      {adjustItemPart && (
        <AdjustItemModal
          lang={lang}
          part={adjustItemPart}
          warehouses={warehouses}
          parts={parts}
          units={units}
          onClose={() => setAdjustItemPart(null)}
          onUpdated={() => setAdjustItemPart(null)}
        />
      )}

      {newPOOpen && (
        <NewPOModal
          lang={lang}
          suppliers={suppliers}
          warehouses={warehouses}
          parts={parts}
          units={units}
          aiSuggestion={aiSuggestion ?? undefined}
          editingPO={editingPO ?? undefined}
          quickReorder={quickReorder ?? undefined}
          defaultWarehouseId={warehouseTab}
          onClose={() => {
            setNewPOOpen(false);
            setAiSuggestion(null);
            setEditingPO(null);
            setQuickReorder(null);
          }}
          onSaved={() => setPoListOpen(false)}
        />
      )}

      {poListOpen && (
        <POListModal
          lang={lang}
          purchaseOrders={kpiPurchaseOrders}
          purchaseOrderLines={purchaseOrderLines}
          suppliers={suppliers}
          onClose={() => setPoListOpen(false)}
          onView={(po) => {
            setPoListOpen(false);
            setViewPO(po);
          }}
          onNewPO={() => {
            setPoListOpen(false);
            setQuickReorder(null);
            setNewPOOpen(true);
          }}
        />
      )}

      {viewPO && (
        <PODetailModal
          lang={lang}
          po={viewPO}
          lines={purchaseOrderLines}
          approvals={purchaseOrderApprovals.filter((a) => a.purchase_order_id === viewPO.id)}
          suppliers={suppliers}
          warehouses={warehouses}
          parts={parts}
          onClose={() => setViewPO(null)}
          onIssued={() => setViewPO(null)}
          onReceive={(po) => {
            setViewPO(null);
            setReceivePO(po);
          }}
          onApprove={(po) => {
            setViewPO(null);
            setApprovePO(po);
          }}
          onReject={(po) => {
            setViewPO(null);
            setRejectPO(po);
          }}
          onEdit={(po) => {
            setViewPO(null);
            setEditingPO({
              po,
              lines: purchaseOrderLines.filter((l) => l.purchase_order_id === po.id),
            });
            setAiSuggestion(null);
            setQuickReorder(null);
            setNewPOOpen(true);
          }}
        />
      )}

      {receiveListOpen && (
        <ReceiveListModal
          lang={lang}
          purchaseOrders={kpiPurchaseOrders}
          suppliers={suppliers}
          onClose={() => setReceiveListOpen(false)}
          onReceive={(po) => {
            setReceiveListOpen(false);
            setReceivePO(po);
          }}
        />
      )}

      {receivePO && (
        <ReceivePOModal
          lang={lang}
          po={receivePO}
          lines={purchaseOrderLines.filter((l) => l.purchase_order_id === receivePO.id)}
          parts={parts}
          onClose={() => setReceivePO(null)}
          onReceived={() => setReceivePO(null)}
        />
      )}

      {approvePO && (
        <ApprovePOModal
          lang={lang}
          po={approvePO}
          approvalCount={purchaseOrderApprovals.filter((a) => a.purchase_order_id === approvePO.id).length}
          alreadyApproved={purchaseOrderApprovals.some(
            (a) => a.purchase_order_id === approvePO.id && a.approver_email === currentUserEmail
          )}
          onClose={() => setApprovePO(null)}
          onApproved={() => setApprovePO(null)}
        />
      )}

      {rejectPO && (
        <RejectPOModal
          lang={lang}
          po={rejectPO}
          onClose={() => setRejectPO(null)}
          onRejected={() => setRejectPO(null)}
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
    <div
      className="flex flex-col gap-0.5 min-w-[6rem]"
      title={tier ? (lang === "en" ? TIER_LABEL[tier].en : TIER_LABEL[tier].ar) : undefined}
    >
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
  pricesByPart,
  lang,
  onView,
  onFinance,
  onQuickReorder,
}: {
  parts: Part[];
  warehousesById: Map<string, Warehouse>;
  pricesByPart: Map<string, { current: PriceLot; previous: PriceLot | null }>;
  lang: "en" | "ar";
  onView: (p: Part) => void;
  onFinance: (p: Part) => void;
  // Item 1, follow-up batch — preview's own INV.openReorder (pages-2.js:1877),
  // gated on stockTier === "critical" (== preview's own qty <= reorderLevel).
  onQuickReorder: (p: Part) => void;
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
            // Unit-cost trend arrow — mirrors preview's Inventory table row
            // exactly (pages-2.js: currentPriceSar vs previousPriceSar,
            // ↑ delta-up / ↓ delta-down, inline % next to the price).
            const prices = pricesByPart.get(p.id);
            const currentPrice = prices?.current.price_sar ?? p.unit_cost_sar;
            const previousPrice = prices?.previous?.price_sar ?? null;
            const priceUp = previousPrice != null && currentPrice != null && currentPrice > previousPrice;
            const priceDeltaPct =
              previousPrice != null && currentPrice != null && previousPrice > 0
                ? Math.abs(Math.round(((currentPrice - previousPrice) / previousPrice) * 100))
                : null;
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
                <TD className="tabular-nums">
                  {p.unit_cost_sar != null ? formatSar(p.unit_cost_sar) : "—"}
                  {priceDeltaPct != null && (
                    <span
                      className={cn(
                        "text-[10px] font-semibold ms-1",
                        priceUp ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                      )}
                    >
                      {priceUp ? "↑" : "↓"}
                      {priceDeltaPct}%
                    </span>
                  )}
                </TD>
                <TD className="tabular-nums font-medium">{stockValue != null ? formatSar(stockValue) : "—"}</TD>
                {/* Item 2 (polish round) — match preview's row-actions
                    exactly (pages-2.js ~3155-3161, .btn-outline/.btn-primary/
                    .btn-icon, app.css ~244-292/643): View is a LABELED
                    outline pill (only one with text, matches preview's own
                    btn({label, icon}) call), chart-report is an outline
                    icon-only square, quick-reorder is a PRIMARY (filled
                    brand) icon-only square, low-stock-only — same order
                    preview uses (View, then chart, then cart), not the
                    reverse this row used to render. */}
                <TD className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onView(p);
                      }}
                      title={lang === "en" ? "View" : "عرض"}
                      className="h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 hover:border-brand-500/45"
                      style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {lang === "en" ? "View" : "عرض"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFinance(p);
                      }}
                      title={lang === "en" ? "Financial report" : "التقرير المالي"}
                      className="h-8 w-8 rounded-lg border inline-flex items-center justify-center hover:border-brand-500/45"
                      style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                    >
                      <BarChart3 className="h-3.5 w-3.5" />
                    </button>
                    {tier === "critical" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickReorder(p);
                        }}
                        title={lang === "en" ? "Quick reorder" : "إعادة طلب سريعة"}
                        className="h-8 w-8 rounded-lg bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center justify-center"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
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
  purchaseOrders,
  purchaseOrderLines,
  onClose,
  onAdjust,
  onAdjustItem,
  onReceiveMore,
  onQuickReorder,
}: {
  lang: "en" | "ar";
  part: Part;
  warehousesById: Map<string, Warehouse>;
  // Financial summary card (preview's inv.perPartFinance, pages-2.js
  // 1766-1809) needs this part's own purchase history — same data
  // PartFinanceModal already computes from, just threaded one level
  // deeper here since this drawer wasn't fetching it before.
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  onClose: () => void;
  onAdjust: (p: Part) => void;
  // Item 7 (polish round) — "Adjust Item" footer button, opens
  // AdjustItemModal (SharedCreateModals.tsx) — descriptive-info edit,
  // distinct from onAdjust (Adjust Stock, quantity correction) above.
  onAdjustItem: (p: Part) => void;
  // Test 6 fix (Turki, post-e9a03d5 feedback): the old "Add new price"
  // button opened a standalone AddPriceLotModal that added stock with no
  // invoice/stock_receipts row/warehouse check — a second, weaker way to
  // "add stock to a part" alongside the real receiving flow, which Turki
  // flagged as a contradiction. Now opens ReceivePartsModal (the SAME
  // "Add Parts" flow the header button uses) prefilled with this part as
  // one line, so it goes through the real invoice/receipt-record path.
  onReceiveMore: (prefill: { warehouseId: string; lines: ReceiveLine[] }) => void;
  // Item 1, follow-up batch — footer "Create PO" button, critical-tier only.
  onQuickReorder: (p: Part) => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  const [lots, setLots] = useState<PriceLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(true);
  const [lotsError, setLotsError] = useState<string | null>(null);

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

  // price_lots, oldest-first — matches getPriceLots' own ordering (received_on
  // then created_at ascending), which is exactly the FIFO order preview's
  // batchesHTML iterates p.priceTiers in (last element = current batch).
  useEffect(() => {
    let cancelled = false;
    setLoadingLots(true);
    setLotsError(null);
    getPriceLots(part.id).then((res) => {
      if (cancelled) return;
      setLoadingLots(false);
      if (res.error) {
        setLotsError(res.error);
        return;
      }
      setLots(res.lots);
    });
    return () => {
      cancelled = true;
    };
  }, [part.id]);

  // Current price = most recent lot's price_sar; previous = the lot received
  // just before that — mirrors preview's currentPriceSar/previousPriceSar
  // (set the moment savePriceLot pushes a new tier). A part with 0 or 1 lot
  // has no "previous" (preview: "Single tier").
  const currentLot = lots.length > 0 ? lots[lots.length - 1] : null;
  const previousLot = lots.length > 1 ? lots[lots.length - 2] : null;
  const priceDeltaPct =
    currentLot != null && previousLot != null && previousLot.price_sar > 0
      ? +(((currentLot.price_sar - previousLot.price_sar) / previousLot.price_sar) * 100).toFixed(1)
      : null;
  // Weighted average cost over lots still holding stock — mirrors preview's
  // partAvgCost() exactly (qty_remaining > 0 lots only).
  const activeLots = lots.filter((l) => l.qty_remaining > 0);
  const activeQty = activeLots.reduce((s, l) => s + l.qty_remaining, 0);
  const avgCost =
    activeQty > 0
      ? activeLots.reduce((s, l) => s + l.qty_remaining * l.price_sar, 0) / activeQty
      : currentLot?.price_sar ?? part.unit_cost_sar ?? null;

  // Stock value — sum(qty_remaining * price_sar) over ALL lots, matching
  // preview's totalValue exactly (p.priceTiers.reduce(t.qty*t.priceSar)).
  // Lots-derived, not unit_cost_sar*qty_on_hand — same invariant, more
  // direct source once lots exist.
  const totalValue = lots.reduce((s, l) => s + l.qty_remaining * l.price_sar, 0);
  const low = part.reorder_level != null && part.qty_on_hand <= part.reorder_level; // preview's `low`
  const warehouseName = warehousesById.get(part.warehouse_id)?.name ?? "—";
  const reorderValue =
    part.reorder_qty != null && part.unit_cost_sar != null ? part.reorder_qty * part.unit_cost_sar : null;

  // "Financial summary" card (preview's inv.perPartFinance, pages-2.js
  // 1766-1809) — reuses this drawer's OWN already-fetched `lots`/`movements`
  // (both scoped to this part.id already), same computePartFinanceStats
  // PartFinanceModal uses, so the two never drift out of sync.
  const financeStats = computePartFinanceStats(part, lots, purchaseOrders, purchaseOrderLines, movements);

  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
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

        {/* Pricing snapshot — ONE card, preview's exact structure (pages-2.js
            openPart, "Pricing snapshot + Stock health" comment): current
            price / previous price+trend / avg cost+stock value / stock
            qty+reorder status, plus the FIFO footer note. Not split boxes.
            Item 3 (polish round) — faded light-green tint, Turki's own
            call (own rgba, no preview equivalent to match). */}
        <Card className="!p-4 mb-4 !bg-[rgba(16,185,129,.05)] dark:!bg-[rgba(16,185,129,.06)]">
          <div className="flex items-center gap-2 mb-3">
            <Banknote className="h-4 w-4 muted" />
            <h4 className="font-semibold text-sm">{lang === "en" ? "Pricing snapshot" : "ملخص السعر"}</h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Current price" : "السعر الحالي"}</div>
              <div className="text-lg font-semibold tabular-nums text-brand-600">
                {currentLot != null ? formatSar(currentLot.price_sar) : "—"}
              </div>
              <div className="text-[11px] muted">
                {lang === "en" ? "per" : "لكل"} {part.unit ?? ""}
              </div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Previous price" : "السعر السابق"}</div>
              <div className="text-lg font-semibold tabular-nums">
                {previousLot != null ? (
                  <span className="line-through muted">{formatSar(previousLot.price_sar)}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              {priceDeltaPct != null ? (
                <div
                  className={cn(
                    "text-[11px] font-semibold flex items-center gap-1",
                    priceDeltaPct > 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {priceDeltaPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(priceDeltaPct)}%
                </div>
              ) : (
                <div className="text-[11px] muted">{lang === "en" ? "Single tier" : "دفعة وحيدة"}</div>
              )}
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Avg Cost" : "متوسط التكلفة"}</div>
              <div className="text-lg font-semibold tabular-nums">
                {/* Deliberate deviation from preview's 0-decimal fmtSar — Turki
                    wants weighted-avg cost specifically shown to 2 decimals
                    (e.g. 26.56). Every other SAR figure stays whole-number. */}
                {avgCost != null ? `${formatNum(avgCost, 2)} SAR` : "—"}
              </div>
              <div className="text-[11px] muted">
                {lang === "en" ? "Stock value" : "قيمة المخزون"}: {formatSar(totalValue)}
              </div>
            </div>
            <div>
              <div className="text-[11px] muted uppercase">{lang === "en" ? "Stock" : "المخزون"}</div>
              <div className={cn("text-lg font-semibold tabular-nums", low ? "text-rose-600" : "")}>
                {part.qty_on_hand} {part.unit ?? ""}
              </div>
              <div className={cn("text-[11px]", low ? "text-rose-600" : "muted")}>
                {low ? (lang === "en" ? "Below reorder level" : "تحت حد إعادة الطلب") : lang === "en" ? "In stock" : "متوفّر"}
                {" · "}
                {lang === "en" ? "Reorder at" : "إعادة الطلب عند"} {part.reorder_level ?? "—"}
              </div>
            </div>
          </div>
          <p className="text-[11px] muted mt-3">
            {lang === "en"
              ? "Older stock at the previous price stays consumable until depleted."
              : "المخزون القديم بالسعر السابق يبقى قابلاً للاستهلاك حتى ينفد."}
          </p>
        </Card>

        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 muted" />
            <h3 className="text-sm font-semibold">{lang === "en" ? "Stock batches" : "دفعات المخزون"}</h3>
          </div>
          <Btn
            variant="outline"
            onClick={() => {
              // Default qty: just enough to clear reorder_level (if set),
              // otherwise 1 — Turki's exact spec. Default price: this
              // part's current price (same fallback chain the Pricing
              // snapshot card above already uses).
              const qty =
                part.reorder_level != null ? Math.max(1, part.reorder_level - part.qty_on_hand + 1) : 1;
              const price = currentLot?.price_sar ?? part.unit_cost_sar ?? 0;
              onReceiveMore({
                warehouseId: part.warehouse_id,
                lines: [{ part_id: part.id, qty, unit_price_sar: price }],
              });
            }}
          >
            <PackagePlus className="h-4 w-4" />
            {lang === "en" ? "Add Parts" : "إضافة قطع"}
          </Btn>
        </div>
        <Card className="!p-0 overflow-hidden mb-4">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{lang === "en" ? "Received on" : "تاريخ الاستلام"}</TH>
                <TH>{lang === "en" ? "Qty purchased" : "الكمية المشتراة"}</TH>
                <TH>{lang === "en" ? "Qty remaining" : "الكمية المتبقية"}</TH>
                <TH>{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</TH>
                <TH>{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}</TH>
                <TH>{lang === "en" ? "Total (incl. VAT)" : "الإجمالي (شامل الضريبة)"}</TH>
                <TH>{lang === "en" ? "Status" : "الحالة"}</TH>
              </tr>
            </thead>
            <tbody>
              {loadingLots && (
                <tr>
                  <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en" ? "Loading…" : "جارٍ التحميل…"}
                  </td>
                </tr>
              )}
              {!loadingLots && lotsError && (
                <tr>
                  <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en"
                      ? "Price batches aren't available yet (pending setup)."
                      : "دفعات الأسعار غير متاحة بعد (بانتظار الإعداد)."}
                  </td>
                </tr>
              )}
              {!loadingLots && !lotsError && lots.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                    {lang === "en" ? "No price batches yet." : "لا توجد دفعات أسعار بعد."}
                  </td>
                </tr>
              )}
              {!loadingLots &&
                !lotsError &&
                lots.map((lot, i) => {
                  const isCurrent = i === lots.length - 1;
                  const depleted = lot.qty_remaining <= 0;
                  // Follow-up fix — was pre-VAT (qty_remaining x price_sar);
                  // Turki: "should be VAT-inclusive, renamed Total." VAT
                  // column below now shares this SAME qty_remaining basis
                  // (was qty_purchased) so the row foots correctly: VAT +
                  // this = Total.
                  const subtotal = lot.qty_remaining * lot.price_sar;
                  const vat = lineVat(lot.qty_remaining, lot.price_sar);
                  const total = subtotal + vat;
                  const badge = depleted
                    ? { en: "Depleted", ar: "منتهية", cls: "muted" }
                    : isCurrent
                    ? { en: "Current batch", ar: "الدفعة الحالية", cls: "text-brand-600" }
                    : { en: "Old batch", ar: "دفعة قديمة", cls: "muted" };
                  return (
                    <tr key={lot.id} className={depleted ? "opacity-60" : ""}>
                      <TD className="text-xs">{lot.received_on}</TD>
                      <TD className="tabular-nums">
                        {lot.qty_purchased} {part.unit ?? ""}
                      </TD>
                      <TD className={cn("tabular-nums", !depleted && "font-semibold")}>
                        {lot.qty_remaining} {part.unit ?? ""}
                      </TD>
                      <TD className="tabular-nums">{formatSar(lot.price_sar)}</TD>
                      {/* VAT (0056, follow-up basis fix) — display-only,
                          computed live from price_lots' own stored
                          qty_remaining/price_sar (price_lots has no stored
                          VAT column, see 0056's own header — nothing here
                          can go stale, same two numbers already on this
                          row). Basis is qty_remaining, matching "Total"
                          right after it, so VAT + pre-VAT subtotal = Total
                          on this row. */}
                      <TD className="tabular-nums muted text-xs">{formatSarVat(vat)}</TD>
                      <TD className="tabular-nums font-medium">{formatSarVat(total)}</TD>
                      <TD>
                        <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", badge.cls)} style={{ borderColor: "rgb(var(--border))" }}>
                          {lang === "en" ? badge.en : badge.ar}
                        </span>
                      </TD>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
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

        {/* Financial summary — preview's inv.perPartFinance ("Financial
            summary"/"الملخص المالي", i18n.js:621), inline in the drawer
            itself, not just the standalone PartFinanceModal popup (both
            exist in preview, pages-2.js:1766-1809). Item 3 (polish round) —
            faded light-purple tint, Turki's own call. */}
        <Card className="!p-4 mb-4 !bg-[rgba(139,92,246,.05)] dark:!bg-[rgba(139,92,246,.07)]">
          <div className="flex items-center gap-2 mb-3">
            <Banknote className="h-4 w-4 muted" />
            <h3 className="text-sm font-semibold">{lang === "en" ? "Financial summary" : "الملخص المالي"}</h3>
          </div>
          <PartFinanceSummaryCard
            lang={lang}
            part={part}
            totalPurchased={financeStats.totalPurchased}
            purchasesVat={financeStats.purchasesVat}
            purchasesTotal={financeStats.purchasesTotal}
            purchaseCount={financeStats.purchaseCount}
            stockValue={financeStats.stockValue}
            priceTrendPct={financeStats.priceTrendPct}
            totalConsumed={financeStats.totalConsumed}
            spentByConsumption={financeStats.spentByConsumption}
          />
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
          {/* Item 7 (polish round) — "Adjust Item": edit descriptive info,
              distinct from "Adjust Stock" right after it (that one is the
              existing quantity-correction path — this one never touches
              qty_on_hand at all, see AdjustItemModal's own header). */}
          <Btn variant="outline" onClick={() => onAdjustItem(part)}>
            <Pencil className="h-4 w-4" />
            {lang === "en" ? "Adjust Item" : "تعديل الصنف"}
          </Btn>
          <Btn variant="outline" onClick={() => onAdjust(part)}>
            <SlidersHorizontal className="h-4 w-4" />
            {lang === "en" ? "Adjust Stock" : "تعديل المخزون"}
          </Btn>
          {/* Item 1, follow-up batch — preview's own conditional Create-PO
              footer button (see this file's header comment, line ~17-18),
              never wired to a real handler before AI-Suggest/quick-reorder
              existed. Same gate as PartsTable's row button: critical tier
              only, i.e. preview's own qty <= reorderLevel. */}
          {stockTier(part) === "critical" && (
            <Btn variant="primary" onClick={() => onQuickReorder(part)}>
              <ShoppingCart className="h-4 w-4" />
              {lang === "en" ? "Create PO" : "إنشاء أمر شراء"}
            </Btn>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// Phase 3 (full-demo build-out) — the full loose "Add Parts" / receive flow
// (migration 0047, LIVE). REPLACES the old single-part ReceiveStockModal
// entirely. Mirrors preview/'s INV.openReceive / INV._renderReceiveModal /
// INV.confirmReceipt manual-mode path (pages-2.js ~2461-2765) — PO lookup/PO
// mode is a separate, later phase (Purchase Orders aren't built), so this is
// manual-mode only: supplier picker (+ inline New-Supplier modal, the
// existing NewSupplierModal above, mounted here for the first time),
// warehouse picker, a multi-line part/qty/price builder, and a MANDATORY
// multi-file invoice upload — all funneled through receive_loose_parts()
// (0047), which itself calls add_price_lot() (0046) once per line. This
// component never writes to price_lots/parts/stock_receipts* directly.
//
// Duplicate-part-add MERGES qty into the existing line (bumps qty, doesn't
// push a second row) — same behavior as preview's own rcvAddLine
// (`if (existing) existing.qty += p.reorderQty || 1`). This is also the
// resolution to receive_loose_parts' own flagged nuance (a part appearing
// twice in one receipt can ambiguously stamp price_lot_id's trace lookup) —
// merging keeps each part_id to at most one line per receipt from this UI.
// ReceiveLine (part_id/qty/unit_price_sar) is imported from ./actions —
// receiveLooseParts' own line-item type, not redeclared here (was an exact
// duplicate before this cleanup pass).

function ReceivePartsModal({
  lang,
  parts,
  warehouses,
  suppliers,
  units,
  prefill,
  defaultWarehouseId,
  onClose,
}: {
  lang: "en" | "ar";
  parts: Part[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  units: Unit[];
  // Set when opened from a part drawer's "Add Parts" button (test 6 fix) —
  // seeds warehouseId + one line for that part. undefined when opened from
  // the header button instead (blank draft, unchanged from before).
  prefill?: { warehouseId: string; lines: ReceiveLine[] };
  // The page's currently active warehouse tab — used as the initial
  // warehouseId when there's no prefill (i.e. opened from the header "Add
  // Parts" button), so the draft starts on whichever warehouse you're
  // already looking at instead of always the first one. Warehouses can no
  // longer be created inline here — the header's "Create Warehouse" button
  // is the only entry point now (per-warehouse tabs on the Inventory page).
  defaultWarehouseId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>([]);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [localParts, setLocalParts] = useState<Part[]>([]);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    prefill?.warehouseId ?? defaultWarehouseId ?? warehouses[0]?.id ?? ""
  );
  const [lines, setLines] = useState<ReceiveLine[]>(prefill?.lines ?? []);
  const [addPartId, setAddPartId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Freshly-created suppliers (via the inline modal below) aren't in the
  // page-level `suppliers` prop until the next server refresh — same
  // "merge in locally, auto-select" pattern NewSupplierModal's own
  // onCreated callback is built for.
  const allSuppliers = useMemo(() => {
    const ids = new Set(suppliers.map((s) => s.id));
    return [...suppliers, ...localSuppliers.filter((s) => !ids.has(s.id))];
  }, [suppliers, localSuppliers]);

  // Same merge-in pattern for parts freshly created via "New Item" (below) —
  // preview's own openNewPart/saveNewPart drops the new record straight into
  // the active draft's part list, no server round-trip needed first.
  const allParts = useMemo(() => {
    const ids = new Set(parts.map((p) => p.id));
    return [...parts, ...localParts.filter((p) => !ids.has(p.id))];
  }, [parts, localParts]);

  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of allParts) m.set(p.id, p);
    return m;
  }, [allParts]);

  // "Risky batch" Stage 3, item 5 — the "pick a part to add" dropdown used
  // to list every part system-wide, regardless of which warehouse this
  // draft is for. Same one-SKU-one-warehouse rule NewPOModal's own
  // partsInWarehouse already enforces, just missing here until now.
  const partsInWarehouse = useMemo(
    () => allParts.filter((p) => p.warehouse_id === warehouseId),
    [allParts, warehouseId]
  );

  const total = lines.reduce((s, l) => s + l.qty * l.unit_price_sar, 0);
  // VAT — this is the loose "Add Parts" receiving flow (header "Add Parts"
  // button; ReceivePOModal is its PO-linked sibling, already VAT-treated).
  // Client-side preview only, per-line-then-summed (never lib/vat.ts's
  // document-level rounding — see lib/inventory-vat.ts's own header);
  // receive_loose_parts (0056) recomputes and stores the real per-line/
  // document figures server-side at submit time.
  const vatDoc = calculateInventoryVatDocument(lines.map((l) => ({ qty: l.qty, unitPriceSar: l.unit_price_sar })));
  const linesValid = lines.length > 0 && lines.every((l) => l.qty > 0 && l.unit_price_sar >= 0);
  const canSubmit = supplierId !== "" && warehouseId !== "" && linesValid && files.length > 0;

  function close() {
    if (saving) return;
    onClose();
  }

  function addLine() {
    if (!addPartId) return;
    const part = partsById.get(addPartId);
    if (!part) return;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.part_id === addPartId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + (part.reorder_qty || 1) };
        return next;
      }
      return [...prev, { part_id: addPartId, qty: part.reorder_qty || 1, unit_price_sar: part.unit_cost_sar ?? 0 }];
    });
    setAddPartId("");
  }

  // "New Item" (below, next to Add line) — mirrors preview's saveNewPart:
  // the fresh part is merged into this draft's part list AND dropped
  // straight in as a line (qty = its reorder qty or 1, price = its unit
  // cost), same as picking it from the dropdown and clicking Add line.
  function addNewPartAsLine(part: Part) {
    setLocalParts((prev) => [...prev, part]);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.part_id === part.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + (part.reorder_qty || 1) };
        return next;
      }
      return [...prev, { part_id: part.id, qty: part.reorder_qty || 1, unit_price_sar: part.unit_cost_sar ?? 0 }];
    });
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<ReceiveLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      setError(lang === "en" ? "Supplier is required." : "المورد مطلوب.");
      return;
    }
    if (!warehouseId) {
      setError(lang === "en" ? "Warehouse is required." : "المستودع مطلوب.");
      return;
    }
    if (!linesValid) {
      setError(
        lang === "en"
          ? "Add at least one line with a positive quantity."
          : "أضف بنداً واحداً على الأقل بكمية موجبة."
      );
      return;
    }
    if (files.length === 0) {
      setError(lang === "en" ? "An invoice must be uploaded before saving." : "يجب رفع فاتورة قبل الحفظ.");
      return;
    }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("warehouseId", warehouseId);
    formData.set("note", note.trim());
    formData.set("linesJson", JSON.stringify(lines));
    for (const file of files) formData.append("invoiceFiles", file);

    setSaving(true);
    setError(null);
    const res = await receiveLooseParts(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {lang === "en" ? "Add Parts to Inventory" : "إضافة قطع للمخزون"}
              </h2>
              <p className="text-xs muted mt-0.5">
                {lang === "en"
                  ? "Receive new stock from a supplier. Invoice upload is required."
                  : "استلام مخزون جديد من مورّد. رفع الفاتورة إلزامي."}
              </p>
            </div>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Supplier *" : "المورد *"}</span>
              <div className="flex gap-2">
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className={cn(INPUT, "flex-1")}
                  style={INPUT_STYLE}
                  required
                >
                  <option value="" disabled>
                    {lang === "en" ? "Pick a supplier…" : "اختر مورّداً…"}
                  </option>
                  {allSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {/* preview's own trigger is plain text, no icon glyph — the
                    "+" lives in the label itself (pages-2.js ~2647). */}
                <Btn type="button" variant="outline" onClick={() => setNewSupplierOpen(true)}>
                  {lang === "en" ? "+ Supplier" : "+ مورّد"}
                </Btn>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Warehouse *" : "المستودع *"}</span>
              {/* No inline "+ Warehouse" here anymore — Create Warehouse is
                  the page header's job only (per-warehouse tabs). */}
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <span className="text-[11px] muted uppercase">
                {lang === "en" ? "Line items" : "بنود الأمر"}
              </span>
              <div className="flex items-center gap-2">
                {/* Item 2 (follow-up polish) — widened (260px -> 380px);
                    was cramped for a sku+name+qty+status row. */}
                <div className="w-[380px]">
                  <PartPicker
                    value={addPartId}
                    onChange={setAddPartId}
                    parts={partsInWarehouse}
                    lang={lang}
                    placeholder={lang === "en" ? "Pick a part to add…" : "اختر قطعة للإضافة…"}
                  />
                </div>
                <Btn type="button" variant="outline" onClick={addLine}>
                  <Plus className="h-4 w-4" />
                  {lang === "en" ? "Add line" : "إضافة بند"}
                </Btn>
                {/* preview's INV.openNewPart trigger — bound right next to
                    Add line (pages-2.js ~2682), the ONLY place a brand-new
                    catalog item gets created. */}
                <Btn type="button" variant="primary" onClick={() => setNewItemOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {lang === "en" ? "New Item" : "صنف جديد"}
                </Btn>
              </div>
            </div>

            {/* preview wraps the line-item table in its own `.card
                overflow-hidden` block (pages-2.js ~2685) — a clear visual
                boundary, not blended into the popup body. Matches how
                ViewPartModal's own tables are wrapped elsewhere in this
                file. */}
            <Card className="!p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                    <TH>{lang === "en" ? "Actual qty received" : "الكمية الفعلية"}</TH>
                    <TH>{lang === "en" ? "Actual unit price" : "سعر الوحدة الفعلي"}</TH>
                    <TH>{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}</TH>
                    <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
                    <TH></TH>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-6 px-3 border-t text-center muted text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {lang === "en"
                          ? "No lines yet — pick a part above to add one."
                          : "لا توجد بنود — اختر قطعة أعلاه لإضافتها."}
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => {
                      const part = partsById.get(l.part_id);
                      return (
                        <tr key={l.part_id}>
                          <TD>
                            <div className="font-mono text-[11px] muted">{part?.sku ?? ""}</div>
                            <div className="text-sm font-medium">
                              {part ? (lang === "ar" && part.name_ar ? part.name_ar : part.name) : "—"}
                            </div>
                          </TD>
                          <TD>
                            <input
                              value={l.qty}
                              onChange={(e) =>
                                updateLine(idx, { qty: Math.max(0, Number(e.target.value.replace(/-/g, "")) || 0) })
                              }
                              type="number"
                              min={0}
                              className="h-8 w-20 px-2 rounded-lg border text-sm"
                              style={INPUT_STYLE}
                            />
                          </TD>
                          <TD>
                            <input
                              value={l.unit_price_sar}
                              onChange={(e) =>
                                updateLine(idx, {
                                  unit_price_sar: Math.max(0, Number(e.target.value.replace(/-/g, "")) || 0),
                                })
                              }
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 w-24 px-2 rounded-lg border text-sm"
                              style={INPUT_STYLE}
                            />
                          </TD>
                          <TD className="tabular muted text-xs">{formatSarVat(lineVat(l.qty, l.unit_price_sar))}</TD>
                          <TD className="tabular font-semibold">{formatSar(l.qty * l.unit_price_sar)}</TD>
                          <TD>
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-rose-600"
                              title={lang === "en" ? "Delete" : "حذف"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </TD>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {/* preview's own tfoot total row (pages-2.js ~2695-2699) —
                    "Actual total" under the Subtotal column, inside the
                    table, not a floating div below it. Actual-total block
                    convention — subtotal (pre-VAT), then VAT (sum of line
                    VATs), then bold total. */}
                {lines.length > 0 && (
                  <tfoot>
                    <tr>
                      <td
                        colSpan={4}
                        className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {lang === "en" ? "Actual total" : "الإجمالي الفعلي"}
                      </td>
                      <td
                        className="py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        <div className="text-[11px] muted tabular-nums">{formatSarVat(vatDoc.subtotal)}</div>
                        <div className="text-[11px] muted tabular-nums">
                          + {formatSarVat(vatDoc.vat)} {lang === "en" ? "VAT" : "ض.ق.م"}
                        </div>
                        <div className="tabular font-bold text-brand-600">{formatSarVat(vatDoc.total)}</div>
                      </td>
                      <td className="border-t" style={{ borderColor: "rgb(var(--border))" }} />
                    </tr>
                  </tfoot>
                )}
              </Table>
            </Card>
          </div>

          {/* preview's `.invoice-required`/`.is-met` — DASHED border while
              missing, solid once met (pages-2.js ~2705, app.css ~1731) —
              was solid both states here before this pass. Drag-and-drop is
              wired for real (onDragOver/onDrop below) — preview's own copy
              ("Drag a file or click to browse") promises it even though the
              static demo never wires a literal drop handler. */}
          <div
            className={cn(
              "rounded-lg p-3 transition-colors",
              files.length === 0
                ? "border-[1.5px] border-dashed border-rose-300 dark:border-rose-900/50"
                : "border border-emerald-300 dark:border-emerald-900/50"
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-sm font-medium flex items-center gap-1.5">
                {lang === "en" ? "Invoice (required)" : "الفاتورة (إلزامية)"}
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: files.length === 0 ? "#f43f5e" : "#10b981" }}
                />
              </span>
              <Btn type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {lang === "en" ? "Add invoice" : "إضافة فاتورة"}
              </Btn>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {files.length === 0 ? (
              <div className="flex items-center justify-center text-center h-14 rounded-md">
                <p className="text-xs muted px-3">
                  {lang === "en"
                    ? "Upload at least one invoice image or PDF. Drag a file or click to browse."
                    : "ارفع صورة فاتورة أو PDF واحداً على الأقل. اسحب ملفاً أو اضغط للاستعراض."}
                </p>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                {files.map((file, idx) => (
                  <InvoiceFileTile
                    key={`${file.name}-${idx}`}
                    file={file}
                    lang={lang}
                    onRemove={() => removeFile(idx)}
                  />
                ))}
              </div>
            )}
            {files.length > 0 && (
              <p className="text-[11px] muted mt-1.5">
                {files.length} {lang === "en" ? "invoices attached" : "فاتورة مرفقة"}
              </p>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{lang === "en" ? "Note" : "ملاحظة"}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              rows={2}
              placeholder={lang === "en" ? "optional" : "اختياري"}
            />
          </label>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Btn type="button" variant="outline" onClick={close}>
              {lang === "en" ? "Cancel" : "إلغاء"}
            </Btn>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? null : <Check className="h-4 w-4" />}
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Save & receive" : "حفظ واستلام"}
            </button>
          </div>
        </form>
      </div>

      {newSupplierOpen && (
        <NewSupplierModal
          lang={lang}
          onClose={() => setNewSupplierOpen(false)}
          onCreated={(supplier) => {
            setLocalSuppliers((prev) => [...prev, supplier]);
            setSupplierId(supplier.id);
          }}
        />
      )}

      {newItemOpen && (
        <AddPartModal
          lang={lang}
          warehouses={warehouses}
          parts={allParts}
          units={units}
          suppliers={allSuppliers}
          defaultWarehouseId={warehouseId}
          onClose={() => setNewItemOpen(false)}
          onCreated={(part) => addNewPartAsLine(part)}
        />
      )}
    </ModalOverlay>
  );
}

// InvoiceFileTile moved to ./SharedCreateModals.tsx (imported above) —
// ReceivePOModal (PurchaseOrders.tsx, Phase 5) needs it too, and that file
// cannot import from InventoryClient.tsx without recreating the same
// import-cycle risk fixed in Phase 4 (see this file's own header note).

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
    <ModalOverlay onClick={close}>
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
    </ModalOverlay>
  );
}

