"use client";

// Inventory — Phases 4-7 of the full-demo build-out: Purchase Orders core
// (migration 0050 — create_purchase_order/issue_purchase_order), PO
// receiving (0051 — receive_purchase_order), PO Approvals (0052 —
// approve_purchase_order/reject_purchase_order + purchase_order_approvals),
// and AI-Suggest-PO + per-part finance (0053 — ai_generated/ai_rationale(_ar)
// on purchase_orders). Mirrors preview/'s INV.openNewPO/_renderPOModal/
// savePO (new/draft/issue), INV.openPOList (list modal), INV.openPO
// (read-only detail + print), INV.openReceiveList (awaiting-receipt card
// grid), INV.openApprove/doApprove/openReject/doReject, invApprovalsView,
// INV.openAIPO/D().suggestAIPurchaseLines, INV.openPartFinance/
// D().partFinance, and the "Active procurement" proc-strip's chips
// (pages-2.js ~3080-3098).
//
// ALL writes go through create_purchase_order()/issue_purchase_order()/
// receive_purchase_order()/approve_purchase_order()/reject_purchase_order()
// (app/inventory/actions.ts) — nothing here inserts into purchase_orders/
// purchase_order_lines/purchase_order_approvals/stock_receipts directly.
// The PO total is NEVER stored — every total in this file (list rows,
// detail footer, receive form) is derived from lines at render, per the
// RPCs' own contract.
//
// WAREHOUSE/PART CONSISTENCY — the RPC rejects a line whose part doesn't
// belong to the PO's warehouse (0050's guard). Surfaced cleanly, not as a
// raw Postgres error: NewPOModal's "pick a part to add" dropdown is
// filtered to parts already in the selected warehouse, and switching the
// warehouse mid-draft drops any line that's now inconsistent (with an
// inline notice) instead of letting it reach the RPC and fail. The
// server-side friendlyPoError() fallback (actions.ts) is defense in depth
// only, for the rare case a stale line still slips through.
//
// Reuses NewSupplierModal / AddPartModal from ./SharedCreateModals.tsx —
// same inline-create modals ReceivePartsModal (InventoryClient.tsx) already
// uses, not reimplemented here. (CreateWarehouseModal used to be reused here
// too, for NewPOModal's inline "+ Warehouse" trigger — removed; the header's
// own "Create Warehouse" button is the only entry point now, per-warehouse
// tabs on the Inventory page.) Deliberately NOT imported from
// InventoryClient.tsx directly: this file needs those two, while
// InventoryClient.tsx needs ProcStrip/NewPOModal/POListModal/
// PODetailModal from THIS file — importing the modals straight from
// InventoryClient.tsx would make that a two-file cycle. Both sides import
// the shared modals from the same third, leaf module instead. See
// SharedCreateModals.tsx's header for the full postmortem (this was a
// real bug, caught after the first version shipped a blank-page crash).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Plus,
  X,
  ShoppingCart,
  Save,
  Eye,
  Printer,
  Check,
  AlertTriangle,
  PackagePlus,
  Upload,
  Zap,
  Trash2,
  Unlink,
  Pencil,
} from "lucide-react";
import { Btn, Table, TH, TD, Card, Stat } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
// VAT (migration 0056) — fixed 15%, per-line rounding summed. Deliberately
// NOT lib/vat.ts (document-level rounding, a different convention for a
// different document — see lib/inventory-vat.ts's own header).
import { lineVat, calculateInventoryVatDocument, formatSarVat } from "@/lib/inventory-vat";
import type {
  Warehouse,
  Part,
  Supplier,
  Unit,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderApproval,
  PriceLot,
  StockMovement,
  StockReceipt,
  StockReceiptApproval,
  StockReceiptLine,
} from "@/lib/db-types";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  issuePurchaseOrder,
  receivePurchaseOrder,
  receiveLooseParts,
  approveReceipt,
  rejectReceipt,
  getReceiptStatus,
  getPartMovements,
  type PurchaseOrderLineInput,
  type ReceivePoLineInput,
  type ReceiveLine,
  type RejectionMode,
} from "./actions";
import {
  ModalOverlay,
  NewSupplierModal,
  AddPartModal,
  InvoiceFileTile,
  categoryLabel,
  PartPicker,
} from "./SharedCreateModals";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

const STATUS_LABEL: Record<PurchaseOrder["status"], { en: string; ar: string }> = {
  draft: { en: "Draft", ar: "مسوّدة" },
  issued: { en: "Issued", ar: "صادر" },
  received: { en: "Received", ar: "مستلم" },
  pending_approval: { en: "Pending Approval", ar: "بانتظار الاعتماد" },
  approved: { en: "Approved", ar: "معتمد" },
  rejected: { en: "Rejected", ar: "مرفوض" },
};

// preview's .po-pill colors (app.css ~708-719) — full lifecycle set even
// though only draft/issued are reachable through this phase's RPCs.
const STATUS_STYLE: Record<PurchaseOrder["status"], { bg: string; fg: string; dot: string }> = {
  draft: { bg: "rgba(100,116,139,.12)", fg: "#475569", dot: "#64748b" },
  issued: { bg: "rgba(11,126,234,.12)", fg: "#0c66bf", dot: "#0b7eea" },
  received: { bg: "rgba(139,92,246,.12)", fg: "#6d28d9", dot: "#8b5cf6" },
  pending_approval: { bg: "rgba(245,158,11,.14)", fg: "#b45309", dot: "#f59e0b" },
  approved: { bg: "rgba(16,185,129,.14)", fg: "#047857", dot: "#10b981" },
  rejected: { bg: "rgba(244,63,94,.14)", fg: "#be123c", dot: "#f43f5e" },
};

function poTotal(poId: string, lines: PurchaseOrderLine[]): number {
  return lines.reduce((s, l) => (l.purchase_order_id === poId ? s + l.qty * l.unit_price_sar : s), 0);
}

// Stage B variance rule (locked with Turki, migration 0057's approval
// batch): a received QUANTITY that differs from ordered is ALWAYS a
// variance — quantity has no tolerance band. A received UNIT PRICE is only
// a variance if it differs by MORE THAN 15% from the ordered price — small
// price drift is normal and shouldn't flag every receipt. Replaces the
// prior exact-match-only comparison in ReceivePOModal's Match/Variance
// pill (Stage 4/0055 — was `received !== ordered` for both fields, no
// tolerance at all).
export function isReceiptVariance(
  orderedQty: number | null,
  receivedQty: number,
  orderedPrice: number | null,
  receivedPrice: number
): boolean {
  if (orderedQty != null && receivedQty !== orderedQty) return true;
  if (orderedPrice != null) {
    if (orderedPrice === 0) {
      // Can't express "more than 15% of zero" — any nonzero received price
      // against a zero ordered price is a real variance.
      if (receivedPrice !== 0) return true;
    } else if (Math.abs(receivedPrice - orderedPrice) / orderedPrice > 0.15) {
      return true;
    }
  }
  return false;
}

// Type badge — Direct (loose Add-Parts receive) vs PO (receive_purchase_
// order). Stage B (0057): every receipt now carries this so it's
// distinguishable everywhere an invoice/receipt is shown. No preview
// equivalent — preview never had a Direct-invoice-approval concept at all
// (confirmed against preview/archive.js and pages-2.js's invApprovalsView
// before this stage's plan — Turki's own explicit addition).
export function ReceiptTypeBadge({ type, lang }: { type: "direct" | "po"; lang: "en" | "ar" }) {
  const isDirect = type === "direct";
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
      style={
        isDirect
          ? { background: "rgba(20,184,166,.12)", color: "#0f766e" }
          : { background: "rgba(11,126,234,.12)", color: "#0c66bf" }
      }
    >
      {isDirect ? (lang === "en" ? "Direct" : "مباشر") : "PO"}
    </span>
  );
}

export function PoStatusPill({ status, lang }: { status: PurchaseOrder["status"]; lang: "en" | "ar" }) {
  const style = STATUS_STYLE[status];
  const label = STATUS_LABEL[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      {lang === "en" ? label.en : label.ar}
    </span>
  );
}

// preview's .ai-pill (app.css ~736-740) — "★ AI" badge on any PO row where
// ai_generated is true.
export function AiPill({ lang }: { lang: "en" | "ar" }) {
  return (
    <span
      className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded text-white tracking-wide"
      style={{ background: "#8b5cf6" }}
      title={lang === "en" ? "Generated by AI" : "أنشأه الذكاء"}
    >
      ★ AI
    </span>
  );
}

// "Active procurement" strip (preview: pages-2.js ~3083-3098, app.css
// ~611-646) — ONLY the "Open POs" chip this phase (draft+issued count).
// "Awaiting receipt"/"Pending review" chips need Phase 5/6 data and aren't
// built here — not silently dropped, just not reachable yet.
// Chip num background — brand blue by default, amber for "warn" (matches
// preview's .proc-chip / .proc-chip-warn distinction, app.css ~623-640).
// Not used yet (both chips built so far are the plain/blue kind) but kept
// so the "Pending review" chip (Phase 6) can reuse this component as-is.
function ProcChip({
  count,
  label,
  onClick,
  warn,
}: {
  count: number;
  label: string;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] hover:border-brand-500/50 hover:bg-brand-500/[0.05] transition-colors"
      style={INPUT_STYLE}
    >
      <span
        className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md text-white font-bold text-[13px] tabular-nums"
        style={{ background: warn ? "#f59e0b" : "#0b7eea" }}
      >
        {count}
      </span>
      <span className="muted">{label}</span>
    </button>
  );
}

// "Active procurement" strip (preview: pages-2.js ~3083-3098, app.css
// ~611-646) — Open POs (Phase 4) + Awaiting receipt (Phase 5) + Pending
// review (Phase 6, pending_approval count — now meaningful since the
// approve/reject UI exists to click through to, unlike before).
export function ProcStrip({
  lang,
  openCount,
  awaitingReceiptCount,
  pendingReviewCount,
  onOpenList,
  onOpenReceiveList,
  onGoToApprovals,
}: {
  lang: "en" | "ar";
  openCount: number;
  awaitingReceiptCount: number;
  pendingReviewCount: number;
  onOpenList: () => void;
  onOpenReceiveList: () => void;
  // preview's third chip calls INV.setTab('approvals') — a tab switch, not
  // a popup (pages-2.js:3094-3097). This used to open a standalone
  // ApprovalsListModal (now removed — it had no other entry point and
  // preview has no such popup at all).
  onGoToApprovals: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 rounded-xl border"
      style={{
        borderColor: "rgb(var(--border))",
        background: "linear-gradient(90deg, rgba(11,126,234,.05), rgba(11,126,234,0))",
      }}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide muted me-1">
        <ShoppingCart className="h-3.5 w-3.5 text-brand-600" />
        {lang === "en" ? "Active procurement" : "العمليات النشطة"}
      </span>
      <ProcChip count={openCount} label={lang === "en" ? "Open POs" : "أوامر مفتوحة"} onClick={onOpenList} />
      <ProcChip
        count={awaitingReceiptCount}
        label={lang === "en" ? "Awaiting receipt" : "بانتظار الاستلام"}
        onClick={onOpenReceiveList}
      />
      <ProcChip
        count={pendingReviewCount}
        label={lang === "en" ? "Pending review" : "بانتظار المراجعة"}
        onClick={onGoToApprovals}
        warn
      />
    </div>
  );
}

type NewPOLine = PurchaseOrderLineInput;

// New Purchase Order — mirrors preview's openNewPO/_renderPOModal/savePO
// in shape: supplier + inline "+ Supplier", warehouse picker (defaults to
// the page's active warehouse tab — no inline "+ Warehouse" anymore, see
// this file's own header comment on why), expected delivery date, line-item
// builder + inline "New Item", note. Two save actions (Save draft / Issue
// now) instead of preview's single savePO(status) — this app's backend is two RPCs
// (create_purchase_order always drafts; issue_purchase_order is a separate
// transition), so "Issue now" chains both calls instead of one insert with
// a status argument.
// AI-Suggest-PO (Phase 7, migration 0053) — mirrors preview's
// AI_RATIONALES (data.js ~1494-1503, 4 canned {en,ar} pairs) and
// suggestAIPurchaseLines (data.js ~1663-1672). Not a real model call in
// preview and not one here either — a client-side heuristic (parts at/below
// reorder level, excluding parts already on an open draft/issued PO) paired
// with one of these canned strings, picked at click time.
export const AI_RATIONALES: { en: string; ar: string }[] = [
  {
    en: "Stock at 18% of reorder level; 7-day burn rate suggests stock-out within 4 days.",
    ar: "المخزون عند 18% من حد إعادة الطلب؛ معدل الاستهلاك يشير إلى نفاد خلال 4 أيام.",
  },
  {
    en: "Consumption +24% vs trailing 30-day average; preventive maintenance peak expected next week.",
    ar: "الاستهلاك +24% مقابل متوسط آخر 30 يومًا؛ يُتوقع ذروة صيانة وقائية الأسبوع القادم.",
  },
  {
    en: "Below reorder threshold; supplier lead time exceeds remaining stock cover.",
    ar: "أقل من حد إعادة الطلب؛ وقت توريد المورّد يتجاوز تغطية المخزون المتبقي.",
  },
  {
    en: "5 active work orders require this part; current stock covers only 2.",
    ar: "5 أوامر عمل نشطة تتطلب هذه القطعة؛ المخزون الحالي يغطي 2 فقط.",
  },
];

// Seed shape for "AI-Suggest" (preview's openAIPO, pages-2.js ~2115-2133) —
// prefills supplier/warehouse/lines and shows the AI banner. Grouping is
// stricter here than preview's (a PO is single-supplier+single-warehouse in
// this app's RPC, not preview's looser model) — see suggestAIPurchaseLines
// below for how the group is chosen.
export type NewPOAISuggestion = {
  warehouseId: string;
  supplierId: string | null;
  lines: NewPOLine[];
  rationale: { en: string; ar: string };
  noteEn: string;
  noteAr: string;
};

// Single-part quick-reorder (preview's INV.openReorder, pages-2.js:1877 —
// previously excluded as a data-risk item, now built). Unlike aiSuggestion,
// the warehouse here isn't just a default — it's LOCKED (see NewPOModal's
// own lockWarehouseId prop): the part only exists in one warehouse, so
// there is exactly one correct destination, not a suggestion to override.
export type NewPOQuickReorder = {
  warehouseId: string;
  supplierId: string | null;
  line: NewPOLine;
};

// preview groups AI candidates by supplier and opens one PO per group
// (pages-2.js ~2118-2133). This app's create_purchase_order enforces ONE
// supplier + ONE warehouse per PO (0050's guard), so warehouse is the hard
// grouping key here instead: candidates are grouped by warehouse_id, and
// the largest group (most impactful single PO) is returned. Supplier is
// only prefilled if every part in that group shares the same parts.supplier
// free-text value AND it matches a real suppliers.name — otherwise left
// unset for the user to pick, rather than guessing wrong.
export function suggestAIPurchaseLines(
  parts: Part[],
  purchaseOrders: PurchaseOrder[],
  purchaseOrderLines: PurchaseOrderLine[],
  suppliers: Supplier[]
): NewPOAISuggestion | null {
  const inOpenPO = new Set<string>();
  for (const po of purchaseOrders) {
    if (po.status !== "draft" && po.status !== "issued") continue;
    for (const l of purchaseOrderLines) {
      if (l.purchase_order_id === po.id) inOpenPO.add(l.part_id);
    }
  }

  const candidates = parts.filter(
    (p) => p.active && p.qty_on_hand <= (p.reorder_level ?? 0) && !inOpenPO.has(p.id)
  );
  if (candidates.length === 0) return null;

  const byWarehouse = new Map<string, Part[]>();
  for (const p of candidates) {
    const list = byWarehouse.get(p.warehouse_id) ?? [];
    list.push(p);
    byWarehouse.set(p.warehouse_id, list);
  }
  let bestWarehouseId = "";
  let bestGroup: Part[] = [];
  for (const [wid, list] of byWarehouse) {
    if (list.length > bestGroup.length) {
      bestWarehouseId = wid;
      bestGroup = list;
    }
  }

  // preview's own cap (data.js ~1671: .slice(0, 5)).
  const group = bestGroup.slice(0, 5);

  const supplierNames = new Set(group.map((p) => p.supplier ?? ""));
  let supplierId: string | null = null;
  if (supplierNames.size === 1) {
    const [name] = supplierNames;
    const match = name && suppliers.find((s) => s.name === name);
    if (match) supplierId = match.id;
  }

  const rationale = AI_RATIONALES[Math.floor(Math.random() * AI_RATIONALES.length)];
  const lines: NewPOLine[] = group.map((p) => ({
    part_id: p.id,
    qty: p.reorder_qty || 1,
    unit_price_sar: p.unit_cost_sar ?? 0,
  }));

  return {
    warehouseId: bestWarehouseId,
    supplierId,
    lines,
    rationale,
    noteEn: `AI suggestion · ${group.length} part${group.length === 1 ? "" : "s"} at/below reorder level.`,
    noteAr: `اقتراح ذكي · ${group.length} قطعة عند/تحت حد الطلب.`,
  };
}

// "Risky batch" Stage 3, item 6 — editingPO's shape. Mutually exclusive
// with aiSuggestion (a caller only ever passes one): editing an EXISTING
// draft, prefilling every field from it, submitting through
// updatePurchaseOrder() instead of createPurchaseOrder(). See
// updatePurchaseOrder's own header comment (actions.ts) for why this is the
// one PO mutation in the app not backed by an RPC.
export type EditingPO = { po: PurchaseOrder; lines: PurchaseOrderLine[] };

export function NewPOModal({
  lang,
  suppliers,
  warehouses,
  parts,
  units,
  aiSuggestion,
  editingPO,
  quickReorder,
  defaultWarehouseId,
  onClose,
  onSaved,
}: {
  lang: "en" | "ar";
  suppliers: Supplier[];
  warehouses: Warehouse[];
  parts: Part[];
  units: Unit[];
  aiSuggestion?: NewPOAISuggestion;
  editingPO?: EditingPO;
  // Mutually exclusive with aiSuggestion/editingPO (a caller passes at most
  // one). See NewPOQuickReorder's own comment for why the warehouse it
  // carries is LOCKED, not just a default.
  quickReorder?: NewPOQuickReorder;
  // The page's currently active warehouse tab — used as the initial
  // warehouseId when there's no aiSuggestion/editingPO/quickReorder (all
  // three already pick their own warehouse), so a brand-new draft starts on
  // whichever warehouse you're already looking at instead of always the
  // first one. Warehouses can no longer be created inline here — the
  // header's "Create Warehouse" button is the only entry point now
  // (per-warehouse tabs on the Inventory page).
  defaultWarehouseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();

  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>([]);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [localParts, setLocalParts] = useState<Part[]>([]);
  const [newItemOpen, setNewItemOpen] = useState(false);

  const [supplierId, setSupplierId] = useState(
    editingPO?.po.supplier_id ?? aiSuggestion?.supplierId ?? quickReorder?.supplierId ?? ""
  );
  const [warehouseId, setWarehouseId] = useState(
    editingPO?.po.warehouse_id ??
      aiSuggestion?.warehouseId ??
      quickReorder?.warehouseId ??
      defaultWarehouseId ??
      warehouses[0]?.id ??
      ""
  );
  // Single-part quick-reorder locks the warehouse — the part only exists
  // in one, so the dropdown below disables every OTHER option rather than
  // just defaulting to this one (still visible, not selectable).
  const lockWarehouseId = quickReorder?.warehouseId;
  // preview's openNewPO defaults expectedDelivery to today+7 (pages-2.js:2107)
  // unless the caller overrides it — matched here as the initial value only
  // (still freely editable, same as preview's own date input). Editing an
  // existing draft keeps its own expected_delivery instead (may be null —
  // stays blank, not re-defaulted to today+7).
  const [expectedDelivery, setExpectedDelivery] = useState(() => {
    if (editingPO) return editingPO.po.expected_delivery ?? "";
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [lines, setLines] = useState<NewPOLine[]>(
    editingPO
      ? editingPO.lines.map((l) => ({ part_id: l.part_id, qty: l.qty, unit_price_sar: l.unit_price_sar }))
      : quickReorder
      ? [quickReorder.line]
      : aiSuggestion?.lines ?? []
  );
  const [addPartId, setAddPartId] = useState("");
  const [note, setNote] = useState(
    editingPO ? editingPO.po.note ?? "" : aiSuggestion ? (lang === "en" ? aiSuggestion.noteEn : aiSuggestion.noteAr) : ""
  );
  const [droppedNotice, setDroppedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "issued" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSuppliers = useMemo(() => {
    const ids = new Set(suppliers.map((s) => s.id));
    return [...suppliers, ...localSuppliers.filter((s) => !ids.has(s.id))];
  }, [suppliers, localSuppliers]);

  // Supplier info card (item 3) — preview's own _supplierCardHtml/
  // #poSupplierCard (pages-2.js:2241-2255), never built here before. Blank
  // "—" until a supplier is picked; once picked, name_ar shown beneath the
  // English name — this app's own bilingual-pair convention (preview has
  // no supplier name_ar at all, migration 0048's own addition).
  const selectedSupplier = allSuppliers.find((s) => s.id === supplierId) ?? null;

  const allParts = useMemo(() => {
    const ids = new Set(parts.map((p) => p.id));
    return [...parts, ...localParts.filter((p) => !ids.has(p.id))];
  }, [parts, localParts]);

  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of allParts) m.set(p.id, p);
    return m;
  }, [allParts]);

  // Warehouse/part consistency (0050's RPC guard) — the ONLY parts offered
  // to add a line for are parts that actually live in the selected
  // warehouse. Prevents the mismatch at the source instead of catching it
  // after a failed submit.
  const partsInWarehouse = useMemo(
    () => allParts.filter((p) => p.warehouse_id === warehouseId),
    [allParts, warehouseId]
  );

  // VAT (0056) — client-side preview only, per-line-then-summed (never
  // lib/vat.ts's document-level rounding — see lib/inventory-vat.ts's own
  // header). create_purchase_order/updatePurchaseOrder recompute and store
  // the real figures server-side at save time; this is what the user sees
  // while still composing the draft.
  const vatDoc = calculateInventoryVatDocument(
    lines.map((l) => ({ qty: l.qty, unitPriceSar: l.unit_price_sar }))
  );
  const linesValid = lines.length > 0 && lines.every((l) => l.qty > 0 && l.unit_price_sar >= 0);
  const canSubmit = supplierId !== "" && warehouseId !== "" && linesValid;

  function close() {
    if (saving) return;
    onClose();
  }

  function changeWarehouse(newWarehouseId: string) {
    setWarehouseId(newWarehouseId);
    // Switching warehouse mid-draft can orphan existing lines (0050's own
    // consistency guard would reject them at submit) — drop them here
    // instead, with a visible notice, rather than letting a bad line ride
    // along to the RPC.
    setLines((prev) => {
      const kept = prev.filter((l) => partsById.get(l.part_id)?.warehouse_id === newWarehouseId);
      if (kept.length !== prev.length) {
        setDroppedNotice(
          lang === "en"
            ? "Some lines were removed — they don't belong to the newly selected warehouse."
            : "أُزيلت بعض البنود — لا تنتمي إلى المستودع المختار حديثًا."
        );
      }
      return kept;
    });
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

  function addNewPartAsLine(part: Part) {
    // AddPartModal below is opened with defaultWarehouseId={warehouseId},
    // so the fresh part is guaranteed to already match this PO's warehouse.
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

  function updateLine(idx: number, patch: Partial<NewPOLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function submit(status: "draft" | "issued") {
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

    setSaving(status);
    setError(null);

    // "Risky batch" Stage 3, item 6 — editing an existing draft goes
    // through updatePurchaseOrder() (no RPC, see its own header comment)
    // instead of createPurchaseOrder(). Everything after this point
    // (Issue now, error handling) is identical either way — both return
    // the same { error, po } shape.
    const saveRes = editingPO
      ? await updatePurchaseOrder(editingPO.po.id, {
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          lines,
          expected_delivery: expectedDelivery || null,
          note: note.trim() || null,
        })
      : await createPurchaseOrder({
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          lines,
          expected_delivery: expectedDelivery || null,
          note: note.trim() || null,
          ai_generated: !!aiSuggestion,
          ai_rationale: aiSuggestion?.rationale.en ?? null,
          ai_rationale_ar: aiSuggestion?.rationale.ar ?? null,
        });
    if (saveRes.error || !saveRes.po) {
      setSaving(null);
      setError(saveRes.error ?? (lang === "en" ? "Could not save purchase order." : "تعذّر حفظ أمر الشراء."));
      return;
    }

    if (status === "draft") {
      setSaving(null);
      onSaved();
      onClose();
      router.refresh();
      return;
    }

    const issueRes = await issuePurchaseOrder(saveRes.po.id);
    setSaving(null);
    if (issueRes.error) {
      // The PO already exists as a draft at this point — don't lose it.
      // Refresh so it shows up in the list, but keep the modal open so
      // Turki sees exactly why "Issue now" didn't finish.
      router.refresh();
      setError(
        (lang === "en"
          ? `Saved as draft (${saveRes.po.po_number}), but issuing failed: `
          : `حُفظ كمسوّدة (${saveRes.po.po_number})، لكن تعذّر الإصدار: `) + issueRes.error
      );
      return;
    }

    onSaved();
    onClose();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {editingPO
                  ? `${lang === "en" ? "Edit Purchase Order" : "تعديل أمر الشراء"} — ${editingPO.po.po_number}`
                  : lang === "en" ? "New Purchase Order" : "أمر شراء جديد"}
              </h2>
              <p className="text-xs muted mt-0.5">
                {lang === "en"
                  ? "A Purchase Order is an internal request to procure parts. Issuing moves no stock — receiving is a separate step."
                  : "أمر الشراء طلب داخلي لاقتناء القطع. الإصدار لا يحرّك أي مخزون — الاستلام خطوة منفصلة."}
              </p>
            </div>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          {aiSuggestion && (
            <div
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border"
              style={{
                background: "linear-gradient(135deg, rgba(139,92,246,.08), rgba(11,126,234,.08))",
                borderColor: "rgba(139,92,246,.2)",
              }}
            >
              <span
                className="inline-flex items-center gap-1 shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full text-white tracking-wide"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
              >
                <Zap className="h-3 w-3" />
                {lang === "en" ? "Generated by AI" : "أنشأه الذكاء"}
              </span>
              <span className="text-xs leading-snug">
                {lang === "en" ? aiSuggestion.rationale.en : aiSuggestion.rationale.ar}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <Btn type="button" variant="outline" onClick={() => setNewSupplierOpen(true)}>
                  {lang === "en" ? "+ Supplier" : "+ مورّد"}
                </Btn>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Warehouse *" : "المستودع *"}</span>
              {/* No inline "+ Warehouse" here anymore — Create Warehouse is
                  the page header's job only (per-warehouse tabs). Quick-
                  reorder LOCKS this to the part's own warehouse — every
                  option still renders (so it's visible this isn't a
                  short list, just a restriction) but every OTHER one is
                  disabled; a part only lives in one warehouse, so there is
                  exactly one correct destination for this PO. */}
              <select
                value={warehouseId}
                onChange={(e) => {
                  setDroppedNotice(null);
                  changeWarehouse(e.target.value);
                }}
                className={INPUT}
                style={INPUT_STYLE}
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id} disabled={lockWarehouseId != null && w.id !== lockWarehouseId}>
                    {w.name}
                  </option>
                ))}
              </select>
              {lockWarehouseId && (
                <p className="text-[11px] muted mt-0.5">
                  {lang === "en"
                    ? "Locked — this part only exists in this warehouse."
                    : "مقفل — هذه القطعة موجودة في هذا المستودع فقط."}
                </p>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{lang === "en" ? "Expected delivery" : "تاريخ التسليم المتوقع"}</span>
              <input
                type="date"
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
              />
            </label>
          </div>

          {/* Item 3 (polish round) — faded baby-blue tint on every
              supplier-info box, Turki's own call (preview's own
              .supplier-card is a neutral black/white .015-.025 tint, not
              blue — this is a deliberate departure, not a preview match).
              Same brand-blue rgba this app already uses at similar low
              opacity elsewhere (e.g. the AI-Insights gradient card).
              FOLLOW-UP FIX: the bg-[...] utility never rendered — Card's
              own ".card" CSS class (globals.css) sets `background-color`
              as PLAIN CSS declared AFTER `@tailwind utilities`, so Tailwind
              never reorders it into the utilities layer; at equal
              specificity the LATER rule in the compiled stylesheet wins,
              and .card's own background always came after any Tailwind
              bg-* utility in source order — same "same-specificity,
              later-rule-wins" trap globals.css's own .trip-highlight
              comment already documents for box-shadow/ring. `!bg-[...]`
              (important) forces the override, same technique already used
              for the AI-Suggest button's gradient just above. */}
          <Card className="!p-3 !bg-[rgba(11,126,234,.06)] dark:!bg-[rgba(96,196,255,.06)]">
            <div className="text-[11px] muted uppercase tracking-wide mb-1">
              {lang === "en" ? "Supplier contact" : "بيانات المورّد"}
            </div>
            {!selectedSupplier ? (
              <div className="text-sm muted">—</div>
            ) : (
              <>
                <div className="font-semibold text-sm">{selectedSupplier.name}</div>
                {selectedSupplier.name_ar && (
                  <div className="text-xs muted mb-1">{selectedSupplier.name_ar}</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mt-1">
                  <div>
                    <span className="muted">{lang === "en" ? "Contact person" : "الشخص المسؤول"}:</span>{" "}
                    {selectedSupplier.contact_person ?? "—"}
                  </div>
                  <div>
                    <span className="muted">{lang === "en" ? "Phone" : "الهاتف"}:</span>{" "}
                    <span className="font-mono">{selectedSupplier.phone ?? "—"}</span>
                  </div>
                  <div>
                    <span className="muted">{lang === "en" ? "Email" : "البريد الإلكتروني"}:</span>{" "}
                    <span className="font-mono">{selectedSupplier.email ?? "—"}</span>
                  </div>
                </div>
              </>
            )}
          </Card>

          {droppedNotice && (
            <p className="text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {droppedNotice}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <span className="text-[11px] muted uppercase">
                {lang === "en" ? "Line items" : "بنود الأمر"}
              </span>
              <div className="flex items-center gap-2">
                {/* Item 2 (follow-up polish) — widened (280px -> 380px),
                    same reason as ReceivePartsModal's own picker. */}
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
                <Btn type="button" variant="primary" onClick={() => setNewItemOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {lang === "en" ? "New Item" : "صنف جديد"}
                </Btn>
              </div>
            </div>

            <Card className="!p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                    <TH>{lang === "en" ? "Qty" : "الكمية"}</TH>
                    <TH>{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</TH>
                    <TH>{lang === "en" ? "VAT (15%)" : "ضريبة القيمة المضافة (15%)"}</TH>
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
                        {lang === "en" ? "No line items yet." : "لا توجد بنود بعد."}
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
                              title={lang === "en" ? "Remove" : "إزالة"}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </TD>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr>
                      <td
                        colSpan={4}
                        className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {lang === "en" ? "Estimated total" : "الإجمالي التقديري"}
                      </td>
                      <td
                        className="py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {/* Actual-total block convention (0056) — subtotal
                            (pre-VAT), then VAT (sum of line VATs), then the
                            bold grand total. Same 3-line stack everywhere a
                            document total appears in this feature now. */}
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
              type="button"
              disabled={!canSubmit || saving !== null}
              onClick={() => submit("draft")}
              className="h-9 px-3 rounded-lg text-sm font-medium border inline-flex items-center gap-2 disabled:opacity-50"
              style={INPUT_STYLE}
            >
              <Save className="h-4 w-4" />
              {saving === "draft"
                ? lang === "en" ? "Saving…" : "جارٍ الحفظ…"
                : editingPO
                ? lang === "en" ? "Save changes" : "حفظ التغييرات"
                : lang === "en" ? "Save draft" : "حفظ مسوّدة"}
            </button>
            <button
              type="button"
              disabled={!canSubmit || saving !== null}
              onClick={() => submit("issued")}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <ShoppingCart className="h-4 w-4" />
              {saving === "issued"
                ? lang === "en" ? "Issuing…" : "جارٍ الإصدار…"
                : editingPO
                ? lang === "en" ? "Save & Issue" : "حفظ وإصدار"
                : lang === "en" ? "Issue now" : "إصدار الآن"}
            </button>
          </div>
        </div>
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
          defaultWarehouseId={warehouseId}
          onClose={() => setNewItemOpen(false)}
          onCreated={(part) => addNewPartAsLine(part)}
        />
      )}
    </ModalOverlay>
  );
}

// Open POs list (draft + issued only) — preview's openPOList (pages-2.js
// ~1894-1936). Opens from the ProcStrip's "Open POs" chip.
export function POListModal({
  lang,
  purchaseOrders,
  purchaseOrderLines,
  suppliers,
  onClose,
  onView,
  onNewPO,
}: {
  lang: "en" | "ar";
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  suppliers: Supplier[];
  onClose: () => void;
  onView: (po: PurchaseOrder) => void;
  onNewPO: () => void;
}) {
  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const open = purchaseOrders
    .filter((o) => o.status === "draft" || o.status === "issued")
    .slice()
    .sort((a, b) => (a.request_date < b.request_date ? 1 : a.request_date > b.request_date ? -1 : 0));

  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold">{lang === "en" ? "Open Purchase Orders" : "أوامر الشراء المفتوحة"}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {open.length === 0 ? (
          <p className="muted text-sm py-10 text-center">
            {lang === "en" ? "No open purchase orders." : "لا توجد أوامر شراء مفتوحة."}
          </p>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>{lang === "en" ? "PO Number" : "رقم الأمر"}</TH>
                  <TH>{lang === "en" ? "Status" : "الحالة"}</TH>
                  <TH>{lang === "en" ? "Supplier" : "المورد"}</TH>
                  <TH>{lang === "en" ? "Issued on" : "تاريخ الإصدار"}</TH>
                  <TH>{lang === "en" ? "Expected delivery" : "تاريخ التسليم المتوقع"}</TH>
                  <TH>{lang === "en" ? "PO Total (incl. VAT)" : "إجمالي الأمر (شامل الضريبة)"}</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {open.map((po) => {
                  const supplier = suppliersById.get(po.supplier_id);
                  return (
                    <tr key={po.id} className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" onClick={() => onView(po)}>
                      <TD className="font-mono text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {po.po_number}
                          {po.ai_generated && <AiPill lang={lang} />}
                        </span>
                      </TD>
                      <TD>
                        <PoStatusPill status={po.status} lang={lang} />
                      </TD>
                      <TD>
                        <div className="text-sm font-medium">{supplier?.name ?? "—"}</div>
                        {supplier?.phone && <div className="text-[11px] muted">{supplier.phone}</div>}
                      </TD>
                      <TD className="text-xs">{po.request_date}</TD>
                      <TD className="text-xs">{po.expected_delivery ?? "—"}</TD>
                      {/* Follow-up fix — was poTotal() (ordered qty x
                          unit_price_sar, pre-VAT). These POs are always
                          draft/issued (never received), so the stored
                          ORDERED-side header total (po.total_sar, written
                          by create_purchase_order/updatePurchaseOrder) is
                          already VAT-inclusive — use it directly, no
                          recompute. Falls back to the old derived total
                          only for a pre-0056 PO (total_sar reads 0 there,
                          honestly — not back-computed). */}
                      <TD className="tabular font-medium">
                        {formatSarVat(po.total_sar || poTotal(po.id, purchaseOrderLines))}
                      </TD>
                      <TD className="text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onView(po);
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
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
          <Btn variant="primary" onClick={onNewPO}>
            <ShoppingCart className="h-4 w-4" />
            {lang === "en" ? "New Purchase Order" : "أمر شراء جديد"}
          </Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}

// Read-only PO detail — preview's openPO (pages-2.js ~2318-2433), trimmed
// to what this phase actually has: no approvals/rejection/received-vs-
// ordered variance (Phases 5/6). Print reuses the app's existing
// createPortal + body-class pattern (StatementModal/InvoiceDetailModal) —
// #po-print / .po-print-portal / body.printing-po, app/globals.css.
export function PODetailModal({
  lang,
  po,
  lines,
  approvals,
  suppliers,
  warehouses,
  parts,
  onClose,
  onIssued,
  onReceive,
  onApprove,
  onReject,
  onEdit,
}: {
  lang: "en" | "ar";
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  // Phase 6 (migration 0052) — this PO's approvals only (caller filters).
  approvals: PurchaseOrderApproval[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  parts: Part[];
  onClose: () => void;
  onIssued: () => void;
  // Phase 5 (migration 0051) — "Receive Stock" action, issued POs only.
  // Mirrors preview's own openPO footer, which shows the SAME Receive
  // action for issued/draft (this app: issued-only, see 0051's deliberate
  // deviation note).
  onReceive: (po: PurchaseOrder) => void;
  // Phase 6 — Approve/Reject actions, pending_approval POs only. Mirrors
  // preview's own openPO footer showing Approve for pending_approval.
  onApprove: (po: PurchaseOrder) => void;
  onReject: (po: PurchaseOrder) => void;
  // "Risky batch" Stage 3, item 6 — Edit action, draft POs only. No preview
  // equivalent (preview never lets you edit an already-saved PO either).
  onEdit: (po: PurchaseOrder) => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplier = suppliers.find((s) => s.id === po.supplier_id);
  const warehouse = warehouses.find((w) => w.id === po.warehouse_id);
  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of parts) m.set(p.id, p);
    return m;
  }, [parts]);
  const poLines = lines.filter((l) => l.purchase_order_id === po.id);
  // Actual (received) figures take priority over ordered ones once a line
  // has been received — mirrors preview's own openPO
  // (`l.receivedQty || l.qty`, `l.receivedUnitPriceSar != null ? ... :
  // l.unitPriceSar`). Total label follows suit: "Actual total" once
  // anything's been received, "Estimated total" while still just ordered
  // amounts (same condition preview's own footer label switches on).
  const hasReceivedFigures = poLines.some((l) => l.received_qty != null);
  const total = poLines.reduce((s, l) => {
    const qty = l.received_qty ?? l.qty;
    const price = l.received_unit_price_sar ?? l.unit_price_sar;
    return s + qty * price;
  }, 0);
  // VAT (0056) — prefer the STORED, booked header figures (set at write
  // time by create_purchase_order/receive_purchase_order) over recomputing
  // client-side; fall back to the derived `total` above only for a
  // pre-0056 PO (subtotal_sar/received_subtotal_sar read 0/null there,
  // honestly — not back-computed, see 0056's own header) so a real
  // historical PO doesn't render a confusing "0" total.
  const docSubtotal = hasReceivedFigures ? po.received_subtotal_sar ?? total : po.subtotal_sar || total;
  const docVat = hasReceivedFigures ? po.received_vat_sar ?? 0 : po.vat_sar;
  const docTotal = docSubtotal + docVat;
  // Visible on any PO that's reached pending_approval or beyond — mirrors
  // preview's own approvalsHtml condition exactly.
  const showApprovals = po.status === "pending_approval" || po.status === "approved" || po.status === "rejected";

  if (!mounted) return null;

  function handlePrint() {
    document.body.classList.add("printing-po");
    const cleanup = () => {
      document.body.classList.remove("printing-po");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  async function handleIssue() {
    setIssuing(true);
    setError(null);
    const res = await issuePurchaseOrder(po.id);
    setIssuing(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onIssued();
    router.refresh();
  }

  return createPortal(
    <div className="po-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        id="po-print"
        className="card p-6 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold font-mono inline-flex items-center gap-2">
              {po.po_number}
              {po.ai_generated && <AiPill lang={lang} />}
            </h2>
            <p className="text-sm muted mt-0.5">{supplier?.name ?? "—"}</p>
          </div>
          <div className="no-print flex items-center gap-2">
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              {/* preview's inv.printInvoice ("Print as Invoice", i18n.js:636) */}
              {lang === "en" ? "Print as Invoice" : "طباعة كفاتورة"}
            </Btn>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {po.ai_generated && (po.ai_rationale || po.ai_rationale_ar) && (
          <div
            className="no-print flex items-start gap-2.5 px-3 py-2.5 mb-4 rounded-lg border"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,.08), rgba(11,126,234,.08))",
              borderColor: "rgba(139,92,246,.2)",
            }}
          >
            <span
              className="inline-flex items-center gap-1 shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full text-white tracking-wide"
              style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
            >
              <Zap className="h-3 w-3" />
              {lang === "en" ? "Generated by AI" : "أنشأه الذكاء"}
            </span>
            <span className="text-xs leading-snug">
              {lang === "en" ? po.ai_rationale : po.ai_rationale_ar}
            </span>
          </div>
        )}

        {/* preview's own grid (pages-2.js:2383-2391) — 8 fields, this exact
            order, ALL unconditional with a muted "—" fallback for anything
            not yet set (receivedBy/receivedDate especially — preview never
            hides them, it always shows "—" until they're populated). PO
            Number used to be shown only in the h2 title above; adding it
            here too matches preview, which does the same (its modal's own
            title bar duplicates the PO id, then the printable grid content
            repeats it — the grid is what actually prints). Received
            by/on used to be a conditional block (hidden entirely pre-
            receipt) — now always rendered, matching preview. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "PO Number" : "رقم الأمر"}</div>
            <div className="font-mono font-medium">{po.po_number}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Status" : "الحالة"}</div>
            <div className="mt-0.5">
              <PoStatusPill status={po.status} lang={lang} />
            </div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Issued on" : "تاريخ الإصدار"}</div>
            <div className="font-medium">{po.request_date}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Expected delivery" : "تاريخ التسليم المتوقع"}</div>
            <div className="font-medium">{po.expected_delivery ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Requested by" : "طلب بواسطة"}</div>
            <div className="font-medium">{po.requested_by ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Received by" : "استُلم بواسطة"}</div>
            <div className="font-medium">{po.received_by ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Received on" : "تاريخ الاستلام"}</div>
            <div className="font-medium">{po.received_date ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Warehouse" : "المستودع"}</div>
            <div className="font-medium">{warehouse?.name ?? "—"}</div>
          </div>
        </div>

        {supplier && (
          <Card className="!p-3 mb-4 !bg-[rgba(11,126,234,.06)] dark:!bg-[rgba(96,196,255,.06)]">
            <div className="text-[11px] muted uppercase mb-1">
              {lang === "en" ? "Supplier contact" : "بيانات المورّد"}
            </div>
            <div className="font-semibold text-sm mb-1">{supplier.name}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
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
          </Card>
        )}

        <Card className="!p-0 overflow-hidden mb-4">
          <Table>
            <thead>
              <tr>
                <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                <TH>{lang === "en" ? "Qty" : "الكمية"}</TH>
                <TH>{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</TH>
                <TH>{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}</TH>
                <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
              </tr>
            </thead>
            <tbody>
              {poLines.map((l) => {
                const part = partsById.get(l.part_id);
                const qty = l.received_qty ?? l.qty;
                const price = l.received_unit_price_sar ?? l.unit_price_sar;
                // VAT (0056) — the STORED per-line figure (received-side if
                // received, else ordered-side), never recomputed. A
                // pre-0056 line reads 0 here, honestly.
                const vat = l.received_line_vat_sar ?? l.line_vat_sar;
                return (
                <tr key={l.id}>
                  <TD>
                    <div className="font-mono text-[11px] muted">{part?.sku ?? ""}</div>
                    <div className="text-sm font-medium">
                      {part ? (lang === "ar" && part.name_ar ? part.name_ar : part.name) : "—"}
                    </div>
                  </TD>
                  <TD className="tabular">
                    {qty}
                    {l.received_qty != null && l.received_qty !== l.qty && (
                      <span className="muted text-[11px] ms-1">
                        ({lang === "en" ? "ordered" : "مطلوب"}: {l.qty})
                      </span>
                    )}
                  </TD>
                  <TD className="tabular">
                    {formatSar(price)}
                    {l.received_unit_price_sar != null && l.received_unit_price_sar !== l.unit_price_sar && (
                      <span className="muted text-[11px] ms-1">
                        ({lang === "en" ? "ordered" : "مطلوب"}: {formatSar(l.unit_price_sar)})
                      </span>
                    )}
                  </TD>
                  <TD className="tabular muted text-xs">{formatSarVat(vat)}</TD>
                  <TD className="tabular font-medium">{formatSar(qty * price)}</TD>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {hasReceivedFigures
                    ? lang === "en" ? "Actual total" : "الإجمالي الفعلي"
                    : lang === "en" ? "Estimated total" : "الإجمالي التقديري"}
                </td>
                <td
                  className="py-2.5 px-3 border-t text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {/* Actual-total block convention (0056) — subtotal
                      (pre-VAT), then VAT (sum of line VATs), then the bold
                      total. */}
                  <div className="text-[11px] muted tabular-nums">{formatSarVat(docSubtotal)}</div>
                  <div className="text-[11px] muted tabular-nums">
                    + {formatSarVat(docVat)} {lang === "en" ? "VAT" : "ض.ق.م"}
                  </div>
                  <div className="tabular font-bold text-brand-600">{formatSarVat(docTotal)}</div>
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>

        {po.note && (
          <Card className="!p-3 mb-4">
            <div className="text-[11px] muted uppercase mb-1">{lang === "en" ? "Note" : "ملاحظة"}</div>
            <p className="text-sm whitespace-pre-wrap">{po.note}</p>
          </Card>
        )}

        {/* Approvals section — preview's approvalsHtml (pages-2.js
            ~2357-2377), visible from pending_approval onward. Rejection is
            a single terminal event (0052), not a list — shown as its own
            block when present. */}
        {showApprovals && (
          <Card className="!p-3 mb-4">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600" />
              {lang === "en" ? "Approved by" : "تم الاعتماد من"}{" "}
              <span className="muted text-xs font-normal">({approvals.length}/2)</span>
            </h4>
            {approvals.length === 0 ? (
              <p className="muted text-sm">{lang === "en" ? "Awaiting approval" : "بانتظار الاعتماد"}</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium">{a.approver_email}</div>
                      <div className="text-[11px] muted">
                        {new Date(a.approved_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}
                        {a.comment ? ` · "${a.comment}"` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {po.status === "rejected" && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="font-semibold text-sm text-rose-600">
                  {lang === "en" ? "Rejected by" : "رُفض من"}: {po.rejected_by ?? "—"}
                </div>
                <div className="text-xs muted mt-1">
                  {po.rejected_at ? new Date(po.rejected_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US") : "—"}
                </div>
                {po.rejection_reason && <div className="text-sm mt-1">&quot;{po.rejection_reason}&quot;</div>}
              </div>
            )}
          </Card>
        )}

        {error && <p className="text-sm text-rose-600 dark:text-rose-400 mb-2 no-print">{error}</p>}

        <div className="no-print flex flex-wrap justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
          {po.status === "draft" && (
            <>
              <Btn variant="outline" onClick={() => onEdit(po)}>
                <Pencil className="h-4 w-4" />
                {lang === "en" ? "Edit" : "تعديل"}
              </Btn>
              <button
                type="button"
                disabled={issuing}
                onClick={handleIssue}
                className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                {issuing ? (lang === "en" ? "Issuing…" : "جارٍ الإصدار…") : lang === "en" ? "Issue" : "إصدار"}
              </button>
            </>
          )}
          {po.status === "issued" && (
            <button
              type="button"
              onClick={() => onReceive(po)}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-2"
            >
              <PackagePlus className="h-4 w-4" />
              {lang === "en" ? "Receive Stock" : "استلام المخزون"}
            </button>
          )}
          {po.status === "pending_approval" && (
            <>
              <button
                type="button"
                onClick={() => onReject(po)}
                className="h-9 px-3 rounded-lg text-sm font-medium border inline-flex items-center gap-2"
                style={{ ...INPUT_STYLE, color: "#be123c", borderColor: "rgba(190,18,60,.4)" }}
              >
                <X className="h-4 w-4" />
                {lang === "en" ? "Reject" : "رفض"}
              </button>
              <button
                type="button"
                onClick={() => onApprove(po)}
                className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                {lang === "en" ? "Approve" : "اعتماد"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// "Awaiting receipt" list — issued POs only, sorted by expected delivery
// ascending (preview: openReceiveList, pages-2.js ~1939-1963). Card grid,
// not a table — matches preview's own layout for this specific list
// (unlike the Open POs list, which IS a table there). Click a card to jump
// straight into receiving that PO (preview: `INV.openReceive('${o.id}')`).
export function ReceiveListModal({
  lang,
  purchaseOrders,
  suppliers,
  onClose,
  onReceive,
}: {
  lang: "en" | "ar";
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  onClose: () => void;
  onReceive: (po: PurchaseOrder) => void;
}) {
  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const issued = purchaseOrders
    .filter((o) => o.status === "issued")
    .slice()
    .sort((a, b) => {
      const ad = a.expected_delivery ?? "";
      const bd = b.expected_delivery ?? "";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold">
            {lang === "en" ? "Purchase Orders Awaiting Receipt" : "أوامر الشراء بانتظار الاستلام"}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {issued.length === 0 ? (
          <p className="muted text-sm py-10 text-center">
            {lang === "en" ? "No POs awaiting receipt." : "لا أوامر بانتظار الاستلام."}
          </p>
        ) : (
          <>
            <p className="text-sm muted mb-3">
              {lang === "en"
                ? "Pick an issued PO to record what physically arrived. Step 2 of purchasing."
                : "اختر أمرًا صادرًا لتسجيل ما وصل فعلاً. الخطوة الثانية من الشراء."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {issued.map((po) => {
                const supplier = suppliersById.get(po.supplier_id);
                return (
                  <button
                    key={po.id}
                    type="button"
                    onClick={() => onReceive(po)}
                    className="text-start rounded-lg border p-3 hover:shadow-md hover:border-brand-500/50 transition-all"
                    style={INPUT_STYLE}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-semibold inline-flex items-center gap-1.5">
                        {po.po_number}
                        {po.ai_generated && <AiPill lang={lang} />}
                      </span>
                      <PoStatusPill status={po.status} lang={lang} />
                    </div>
                    <div className="font-medium text-sm">{supplier?.name ?? "—"}</div>
                    <div className="text-[11px] muted mb-2">
                      {lang === "en" ? "Expected delivery" : "تاريخ التسليم المتوقع"}: {po.expected_delivery ?? "—"}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}

// key is a stable client-side React key only — never sent to the RPC.
// line_id null = an extra/ad-hoc line (0055), not on the original PO;
// ordered_qty/ordered_unit_price_sar are null for the same reason (there is
// no "ordered" figure for something that was never ordered).
type ReceiveLineState = {
  key: string;
  line_id: string | null;
  part_id: string;
  ordered_qty: number | null;
  ordered_unit_price_sar: number | null;
  received_qty: string; // text-backed, same "empty distinguishable from 0" convention as useNumField
  received_unit_price_sar: string;
};

let extraLineSeq = 0;
function nextExtraLineKey(): string {
  extraLineSeq += 1;
  return `extra-${Date.now()}-${extraLineSeq}`;
}

// Receive a Purchase Order — preview's openReceive(prefillPOId)/rcvAddLine,
// reworked (migration 0055) to allow extra ad-hoc lines the supplier
// delivered that weren't on the original PO, and a "detach from PO" escape
// hatch preview has no equivalent of at all (Turki's own explicit ask,
// worked out from the RPC's own design — see 0055's header comment).
//
// PO-derived lines (line_id set) show their ordered qty/price as a muted
// sub-line plus a Match/Variance pill (preview's own pill-ok/pill-warn,
// pages-2.js ~2586-2590, exact hex colors) — no remove button UNLESS the
// receipt has been detached from the PO (every existing PO line must
// still be included when NOT detached, same completeness rule 0051/0055
// enforce; once detached there is no more PO to reconcile against, so
// removing one is safe — this receipt becomes a plain loose receipt).
// Extra lines (line_id null, added via the "pick a part to add" picker
// below, restricted to the PO's own warehouse — same one-SKU-one-warehouse
// rule the RPC itself enforces, surfaced here instead of relying only on
// the RPC's own rejection) always have a remove button, no pill (there's
// nothing to compare against).
//
// Detaching flips which action gets called on submit: receiveLooseParts()
// (0047, the exact same RPC the "Add Parts" header flow already uses)
// instead of receivePurchaseOrder() (0051/0055) — using this draft's own
// supplier_id/warehouse_id (still the PO's, unchanged — detaching doesn't
// make them editable, it only changes whether the PO gets reconciled) and
// whatever lines/files/note are currently in the draft. The PO itself is
// never touched: no po_id stamped on the resulting receipt, no status
// change, no line updates — exactly as if this receiving event never
// mentioned the PO at all.
export function ReceivePOModal({
  lang,
  po,
  lines,
  parts,
  onClose,
  onReceived,
}: {
  lang: "en" | "ar";
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  parts: Part[];
  onClose: () => void;
  onReceived: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of parts) m.set(p.id, p);
    return m;
  }, [parts]);

  const [receiveLines, setReceiveLines] = useState<ReceiveLineState[]>(() =>
    lines.map((l) => ({
      key: l.id,
      line_id: l.id,
      part_id: l.part_id,
      ordered_qty: l.qty,
      ordered_unit_price_sar: l.unit_price_sar,
      received_qty: String(l.qty),
      received_unit_price_sar: String(l.unit_price_sar),
    }))
  );
  const [addPartId, setAddPartId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  // Detach from PO (0055) — flips submit() to call receiveLooseParts()
  // instead of receivePurchaseOrder(); see this component's own header
  // comment for the full design.
  const [detached, setDetached] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extra lines can only add parts that (a) belong to the PO's own
  // warehouse — same rule the RPC itself enforces, checked here too so the
  // picker never even offers a part that would be rejected — and (b)
  // aren't already a line on this draft (existing or extra), matching the
  // RPC's own "already a line" / duplicate-extra-part rejections.
  const usedPartIds = useMemo(() => new Set(receiveLines.map((l) => l.part_id)), [receiveLines]);
  const availableExtraParts = useMemo(
    () => parts.filter((p) => p.warehouse_id === po.warehouse_id && !usedPartIds.has(p.id)),
    [parts, po.warehouse_id, usedPartIds]
  );

  const linesValid = receiveLines.every((l) => {
    const q = Number(l.received_qty);
    const p = Number(l.received_unit_price_sar);
    return l.received_qty.trim() !== "" && q > 0 && l.received_unit_price_sar.trim() !== "" && p >= 0;
  });
  const canSubmit = linesValid && receiveLines.length > 0 && files.length > 0;

  // VAT (0056) — client-side preview only (receive_purchase_order/
  // receive_loose_parts recompute and store the real per-line/document
  // figures server-side at submit time — same per-line-then-summed rule).
  const vatDoc = calculateInventoryVatDocument(
    receiveLines.map((l) => ({
      qty: Number(l.received_qty) || 0,
      unitPriceSar: Number(l.received_unit_price_sar) || 0,
    }))
  );

  function updateLine(idx: number, patch: Partial<ReceiveLineState>) {
    setReceiveLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  // A PO-derived line can only be removed once detached (every line still
  // on the PO must be included otherwise — the completeness rule 0051/0055
  // enforce). An extra line can always be removed — it was never required.
  function canRemoveLine(l: ReceiveLineState): boolean {
    return l.line_id === null || detached;
  }

  function removeLine(idx: number) {
    setReceiveLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function addExtraLine() {
    if (!addPartId) return;
    const part = partsById.get(addPartId);
    if (!part) return;
    setReceiveLines((prev) => [
      ...prev,
      {
        key: nextExtraLineKey(),
        line_id: null,
        part_id: part.id,
        ordered_qty: null,
        ordered_unit_price_sar: null,
        received_qty: String(part.reorder_qty || 1),
        received_unit_price_sar: String(part.unit_cost_sar ?? 0),
      },
    ]);
    setAddPartId("");
  }

  function close() {
    if (saving) return;
    onClose();
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
    if (!linesValid || receiveLines.length === 0) {
      setError(
        lang === "en"
          ? "Every line needs a positive received quantity and a non-negative price."
          : "كل بند يحتاج كمية مستلمة موجبة وسعراً غير سالب."
      );
      return;
    }
    if (files.length === 0) {
      setError(lang === "en" ? "An invoice must be uploaded before saving." : "يجب رفع فاتورة قبل الحفظ.");
      return;
    }

    setSaving(true);
    setError(null);

    let res: { error: string | null };
    if (detached) {
      // Plain loose receipt (0047) — same RPC the header's "Add Parts" flow
      // already uses. Uses the PO's own supplier_id/warehouse_id (not
      // editable here — detaching doesn't change WHAT was received, only
      // whether it gets reconciled against the PO). No po_id, no PO status
      // change, no PO line writes — the PO stays exactly as it was.
      const looseLines: ReceiveLine[] = receiveLines.map((l) => ({
        part_id: l.part_id,
        qty: Number(l.received_qty),
        unit_price_sar: Number(l.received_unit_price_sar),
      }));
      const formData = new FormData();
      formData.set("supplierId", po.supplier_id);
      formData.set("warehouseId", po.warehouse_id);
      formData.set("note", note.trim());
      formData.set("linesJson", JSON.stringify(looseLines));
      for (const file of files) formData.append("invoiceFiles", file);
      res = await receiveLooseParts(formData);
    } else {
      const payload: ReceivePoLineInput[] = receiveLines.map((l) =>
        l.line_id !== null
          ? { line_id: l.line_id, received_qty: Number(l.received_qty), received_unit_price_sar: Number(l.received_unit_price_sar) }
          : { part_id: l.part_id, received_qty: Number(l.received_qty), received_unit_price_sar: Number(l.received_unit_price_sar) }
      );
      const formData = new FormData();
      formData.set("poId", po.id);
      formData.set("note", note.trim());
      formData.set("linesJson", JSON.stringify(payload));
      for (const file of files) formData.append("invoiceFiles", file);
      res = await receivePurchaseOrder(formData);
    }
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onReceived();
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
                {lang === "en" ? "Receive Purchase Order" : "استلام أمر الشراء"} — {po.po_number}
              </h2>
              <p className="text-xs muted mt-0.5">
                {lang === "en"
                  ? "Confirm what actually arrived. Invoice upload is required — this moves stock into inventory."
                  : "أكّد ما وصل فعلاً. رفع الفاتورة إلزامي — هذا يُدخل المخزون فعليًا."}
              </p>
            </div>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Detach from PO (0055) — no preview equivalent, Turki's own
              requirement. A plain checkbox-style toggle rather than a
              separate popup: flipping it changes what happens on submit
              (which RPC, whether the PO gets touched) without changing the
              form itself. */}
          <div
            className="rounded-lg border p-3 flex items-start gap-2.5"
            style={detached ? { background: "rgba(244,63,94,.06)", borderColor: "rgba(244,63,94,.3)" } : INPUT_STYLE}
          >
            <button
              type="button"
              onClick={() => setDetached((v) => !v)}
              className="mt-0.5 shrink-0 h-5 w-5 rounded border flex items-center justify-center"
              style={{
                borderColor: detached ? "#f43f5e" : "rgb(var(--border))",
                background: detached ? "#f43f5e" : "transparent",
              }}
              aria-pressed={detached}
            >
              {detached && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
            <div className="text-sm">
              <button
                type="button"
                onClick={() => setDetached((v) => !v)}
                className="font-medium inline-flex items-center gap-1.5"
              >
                <Unlink className="h-3.5 w-3.5" />
                {lang === "en" ? "Detach from this purchase order" : "فصل عن أمر الشراء هذا"}
              </button>
              <p className="text-xs muted mt-0.5">
                {detached
                  ? lang === "en"
                    ? `This will be saved as a plain loose receipt — ${po.po_number} stays issued, unreceived, and none of its lines change. Every line below can now be removed.`
                    : `سيُحفظ هذا كاستلام مباشر عادي — يبقى ${po.po_number} صادراً وغير مستلم، ولن تتغيّر أي من بنوده. يمكن الآن إزالة أي بند أدناه.`
                  : lang === "en"
                  ? "Leave unchecked to receive against this PO — it will move to Pending Approval and include any extra parts you add below."
                  : "اتركه دون تحديد للاستلام مقابل أمر الشراء هذا — سينتقل إلى بانتظار الاعتماد ويشمل أي قطع إضافية تضيفها أدناه."}
              </p>
            </div>
          </div>

          <Card className="!p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                  <TH>{lang === "en" ? "Ordered qty" : "الكمية المطلوبة"}</TH>
                  <TH>{lang === "en" ? "Ordered unit price" : "سعر الوحدة المطلوب"}</TH>
                  <TH>{lang === "en" ? "Actual qty received" : "الكمية الفعلية"}</TH>
                  <TH>{lang === "en" ? "Actual unit price" : "سعر الوحدة الفعلي"}</TH>
                  <TH>{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}</TH>
                  <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {receiveLines.map((l, idx) => {
                  const part = partsById.get(l.part_id);
                  // preview's own Match/Variance pill (pages-2.js
                  // ~2586-2590, pill-ok/pill-warn, exact hex from
                  // app.css:148/150) — only meaningful for a PO-derived
                  // line, which has an ordered figure to compare against.
                  // Stage B (0057): qty mismatch always flags; price only
                  // flags past a 15% band — see isReceiptVariance's header.
                  const variance =
                    l.line_id !== null &&
                    isReceiptVariance(
                      l.ordered_qty,
                      Number(l.received_qty) || 0,
                      l.ordered_unit_price_sar,
                      Number(l.received_unit_price_sar) || 0
                    );
                  return (
                    <tr key={l.key}>
                      <TD>
                        <div className="font-mono text-[11px] muted">{part?.sku ?? ""}</div>
                        <div className="text-sm font-medium">
                          {part ? (lang === "ar" && part.name_ar ? part.name_ar : part.name) : "—"}
                        </div>
                        {l.line_id === null && (
                          <span
                            className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(100,116,139,.10)", color: "#475569" }}
                          >
                            {lang === "en" ? "Extra — not on PO" : "إضافي — ليس في الأمر"}
                          </span>
                        )}
                      </TD>
                      <TD className="tabular muted">{l.ordered_qty ?? "—"}</TD>
                      <TD className="tabular muted">{l.ordered_unit_price_sar != null ? formatSar(l.ordered_unit_price_sar) : "—"}</TD>
                      <TD>
                        <input
                          value={l.received_qty}
                          onChange={(e) => updateLine(idx, { received_qty: e.target.value.replace(/-/g, "") })}
                          type="number"
                          min={0}
                          className="h-8 w-20 px-2 rounded-lg border text-sm"
                          style={INPUT_STYLE}
                        />
                      </TD>
                      <TD>
                        <input
                          value={l.received_unit_price_sar}
                          onChange={(e) =>
                            updateLine(idx, { received_unit_price_sar: e.target.value.replace(/-/g, "") })
                          }
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 w-24 px-2 rounded-lg border text-sm"
                          style={INPUT_STYLE}
                        />
                      </TD>
                      <TD className="tabular muted text-xs">
                        {formatSarVat(lineVat(Number(l.received_qty) || 0, Number(l.received_unit_price_sar) || 0))}
                      </TD>
                      <TD className="tabular font-semibold">
                        {formatSar((Number(l.received_qty) || 0) * (Number(l.received_unit_price_sar) || 0))}
                      </TD>
                      <TD className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {l.line_id !== null && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={
                                variance
                                  ? { background: "rgba(245,158,11,.12)", color: "#b45309" }
                                  : { background: "rgba(16,185,129,.10)", color: "#047857" }
                              }
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: variance ? "#f59e0b" : "#10b981" }}
                              />
                              {variance
                                ? lang === "en" ? "Variance" : "فرق"
                                : lang === "en" ? "Match" : "مطابق"}
                            </span>
                          )}
                          {canRemoveLine(l) && (
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-rose-600"
                              title={lang === "en" ? "Remove" : "إزالة"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    colSpan={5}
                    className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    {lang === "en" ? "Actual total" : "الإجمالي الفعلي"}
                  </td>
                  <td
                    className="py-2.5 px-3 border-t text-sm"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    {/* Actual-total block convention (0056) — subtotal
                        (pre-VAT), then VAT (sum of line VATs), then bold
                        total. */}
                    <div className="text-[11px] muted tabular-nums">{formatSarVat(vatDoc.subtotal)}</div>
                    <div className="text-[11px] muted tabular-nums">
                      + {formatSarVat(vatDoc.vat)} {lang === "en" ? "VAT" : "ض.ق.م"}
                    </div>
                    <div className="tabular font-bold text-brand-600">{formatSarVat(vatDoc.total)}</div>
                  </td>
                  <td className="border-t" style={{ borderColor: "rgb(var(--border))" }} />
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Extra / ad-hoc lines (0055) — preview's own rcvAddLine, "and in
              PO mode if extra parts are received alongside the PO"
              (pages-2.js ~2500-2502). Restricted to this PO's own
              warehouse, same one-SKU-one-warehouse rule the RPC enforces —
              only ever offers a part that would actually be accepted. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="max-w-[280px] flex-1">
              <PartPicker
                value={addPartId}
                onChange={setAddPartId}
                parts={availableExtraParts}
                lang={lang}
                disabled={availableExtraParts.length === 0}
                placeholder={
                  availableExtraParts.length === 0
                    ? lang === "en"
                      ? "No other parts in this warehouse"
                      : "لا توجد قطع أخرى في هذا المستودع"
                    : lang === "en"
                    ? "Pick a part to add…"
                    : "اختر قطعة للإضافة…"
                }
              />
            </div>
            <Btn type="button" variant="outline" onClick={addExtraLine} disabled={!addPartId}>
              <Plus className="h-4 w-4" />
              {lang === "en" ? "Add extra part" : "إضافة قطعة إضافية"}
            </Btn>
          </div>

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
                  <InvoiceFileTile key={`${file.name}-${idx}`} file={file} lang={lang} onRemove={() => removeFile(idx)} />
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
              {detached ? <Unlink className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
              {saving
                ? lang === "en" ? "Saving…" : "جارٍ الحفظ…"
                : detached
                ? lang === "en" ? "Save as loose receipt" : "حفظ كاستلام مباشر"
                : lang === "en" ? "Confirm receipt" : "تأكيد الاستلام"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// Unified approval-queue row — Stage B (0057). A "PO" row is a
// pending_approval purchase order (its own stock_receipts row resolved via
// po_id, since approve/reject now always act on the RECEIPT, keeping
// purchase_orders.status in lockstep — see actions.ts's approveReceipt()/
// rejectReceipt() header). A "direct" row is a loose Add-Parts receive with
// no PO at all — approvable in its own right, per Turki's Stage B ask.
export type ApprovalRow =
  | { kind: "po"; po: PurchaseOrder; receipt: StockReceipt | null }
  | { kind: "direct"; receipt: StockReceipt };

function approvalRowId(row: ApprovalRow): string | null {
  return row.kind === "po" ? row.receipt?.id ?? null : row.receipt.id;
}

function approvalRowTitle(row: ApprovalRow, lang: "en" | "ar"): string {
  if (row.kind === "po") return row.po.po_number;
  return `${lang === "en" ? "Direct Receipt" : "استلام مباشر"} — ${row.receipt.id.slice(0, 8).toUpperCase()}`;
}

const OUTCOME_LABEL: Record<RejectionMode, { en: string; ar: string }> = {
  void_cost: { en: "void-cost", ar: "إلغاء التكلفة" },
  remove_stock: { en: "remove-stock", ar: "إزالة المخزون" },
};

// Vote-state display — Stage B vote model (0058). While a receipt is
// pending_approval, at most ONE vote row can exist (a matching second
// vote always finalizes in the same transaction, flipping status away
// from pending_approval) — so this only ever needs to render 0 or 1 row
// in practice, but handles more defensively (e.g. if ever shown for an
// already-resolved receipt via a future Archive view).
function VoteSummary({ approvals, lang }: { approvals: StockReceiptApproval[]; lang: "en" | "ar" }) {
  if (approvals.length === 0) {
    return <span className="muted text-xs">{lang === "en" ? "No votes yet" : "لا توجد أصوات بعد"}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {approvals.map((a) => (
        <div key={a.id} className="text-[11px]">
          <span
            className={
              a.action === "approve"
                ? "text-emerald-600 dark:text-emerald-400 font-medium"
                : "text-rose-600 dark:text-rose-400 font-medium"
            }
          >
            {a.action === "approve" ? (lang === "en" ? "Approve" : "اعتماد") : (lang === "en" ? "Reject" : "رفض")}
          </span>
          {a.outcome && (
            <span className="muted"> · {lang === "en" ? OUTCOME_LABEL[a.outcome].en : OUTCOME_LABEL[a.outcome].ar}</span>
          )}
          <span className="muted"> — {a.approver_email}</span>
        </div>
      ))}
      {approvals.length === 1 && (
        <span className="text-[10px] muted italic">
          {lang === "en" ? "awaiting a matching second vote" : "بانتظار صوت ثانٍ مطابق"}
        </span>
      )}
    </div>
  );
}

// Approve a receipt (Direct or PO) — Stage B vote model (0058): both
// approvers must cast the SAME action. The first vote records only, no
// stock/status change — a mismatched second vote is blocked server-side
// with a clear message (surfaced below as plain res.error). A sole voter
// can freely change their own vote by submitting again — no dead-end
// "already voted" state anymore (that was the pre-vote-model design;
// under voting, resubmitting is either a harmless reaffirm or a real,
// allowed change). Reused for the Approvals queue, PODetailModal's own
// Approve button, and the new Direct ReceiptDetailModal.
export function ApproveReceiptModal({
  lang,
  row,
  approvals,
  currentUserEmail,
  onClose,
  onApproved,
}: {
  lang: "en" | "ar";
  row: ApprovalRow;
  approvals: StockReceiptApproval[];
  currentUserEmail: string | null;
  onClose: () => void;
  onApproved: () => void;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptId = approvalRowId(row);
  const myVote = approvals.find((a) => a.approver_email === currentUserEmail);

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!receiptId) {
      setError(lang === "en" ? "No receipt is linked to this record yet." : "لا يوجد إيصال مرتبط بهذا السجل بعد.");
      return;
    }
    setSaving(true);
    setError(null);

    // Re-check live status right before submitting — a second approver
    // may have finalized this receipt since the modal opened.
    const live = await getReceiptStatus(receiptId);
    if (live.confirmedNotPending) {
      setSaving(false);
      setError(
        lang === "en"
          ? "This has already been resolved — closing this form. Refresh to see its final state."
          : "تم حسم هذا بالفعل — سيُغلق هذا النموذج. حدّث الصفحة لرؤية حالته النهائية."
      );
      return;
    }

    const res = await approveReceipt(receiptId, comment.trim() || null);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onApproved();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold inline-flex items-center gap-2 flex-wrap">
              {lang === "en" ? "Approve" : "اعتماد"} — {approvalRowTitle(row, lang)}
              <ReceiptTypeBadge type={row.kind === "po" ? "po" : "direct"} lang={lang} />
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-2">
            {lang === "en"
              ? "Both approvers must cast the SAME action — two approves, or two matching rejects."
              : "يجب أن يتخذ المعتمِدان نفس الإجراء — اعتمادان، أو رفضان متطابقان."}
          </p>
          <div className="mb-3">
            <VoteSummary approvals={approvals} lang={lang} />
          </div>

          {myVote && (
            <p className="text-xs muted mb-3 italic">
              {lang === "en"
                ? myVote.action === "approve"
                  ? "You've already voted Approve — submitting again just reaffirms it."
                  : "You previously voted Reject — submitting this will change your vote to Approve."
                : myVote.action === "approve"
                ? "لقد صوّتَّ بالاعتماد مسبقًا — الإرسال مرة أخرى يؤكد ذلك فقط."
                : "صوّتَّ سابقًا بالرفض — الإرسال هنا سيغيّر صوتك إلى اعتماد."}
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{lang === "en" ? "Optional comment" : "تعليق اختياري"}</span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              placeholder={lang === "en" ? "Optional comment" : "تعليق اختياري"}
            />
          </label>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={close}>
              {lang === "en" ? "Cancel" : "إلغاء"}
            </Btn>
            <button
              type="submit"
              disabled={saving || !receiptId}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Approve" : "اعتماد"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// Reject a receipt (Direct or PO) — Stage B vote model (0058): both
// approvers must pick the SAME outcome (reason may differ, never
// compared). The first reject vote touches NO stock at all — the stock
// effect (void-cost repricing / remove-stock reversal, plus the
// untraceable-line and already-consumed blocks) only runs on the
// completing, matching second vote. A mismatched action or outcome from
// the second voter is blocked server-side with a clear message. Terminal
// once approved (approved-is-final, enforced inside the RPC, not just
// hidden here) — surfaced as a plain RPC error like every other guard.
export function RejectReceiptModal({
  lang,
  row,
  approvals,
  currentUserEmail,
  onClose,
  onRejected,
}: {
  lang: "en" | "ar";
  row: ApprovalRow;
  approvals: StockReceiptApproval[];
  currentUserEmail: string | null;
  onClose: () => void;
  onRejected: () => void;
}) {
  const router = useRouter();
  const myVote = approvals.find((a) => a.approver_email === currentUserEmail);
  const otherVote = approvals.find((a) => a.approver_email !== currentUserEmail);
  // Default the outcome radio to whichever reject outcome is already
  // pending (mine first, else the other voter's) — reduces the chance of
  // an easily-avoidable outcome mismatch; the server still blocks a real
  // mismatch regardless, this is just a friendlier starting point.
  const [mode, setMode] = useState<RejectionMode>(
    myVote?.action === "reject" && myVote.outcome
      ? myVote.outcome
      : otherVote?.action === "reject" && otherVote.outcome
      ? otherVote.outcome
      : "void_cost"
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptId = approvalRowId(row);

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!receiptId) {
      setError(lang === "en" ? "No receipt is linked to this record yet." : "لا يوجد إيصال مرتبط بهذا السجل بعد.");
      return;
    }
    setSaving(true);
    setError(null);

    // Re-check live status right before submitting — a second approver
    // may have finalized this receipt since the modal opened.
    const live = await getReceiptStatus(receiptId);
    if (live.confirmedNotPending) {
      setSaving(false);
      setError(
        lang === "en"
          ? "This has already been resolved — closing this form. Refresh to see its final state."
          : "تم حسم هذا بالفعل — سيُغلق هذا النموذج. حدّث الصفحة لرؤية حالته النهائية."
      );
      return;
    }

    const res = await rejectReceipt(receiptId, mode, reason.trim() || null);
    setSaving(false);
    if (res.error) {
      // Surfaces reject_stock_receipt's own guard messages verbatim —
      // the "already consumed" block ("Cannot remove this receipt's
      // stock — some of it has already been consumed. Use void-cost
      // instead."), the untraceable-line block ("Part % on this receipt
      // has no traceable price lot — cannot safely reject (either
      // outcome)..."), and the outcome-mismatch block — no client-side
      // re-derivation of any of these, the RPC's own guard is the only
      // source of truth.
      setError(res.error);
      return;
    }
    onRejected();
    router.refresh();
  }

  return (
    <ModalOverlay onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold inline-flex items-center gap-2 flex-wrap">
              {lang === "en" ? "Reject" : "رفض"} — {approvalRowTitle(row, lang)}
              <ReceiptTypeBadge type={row.kind === "po" ? "po" : "direct"} lang={lang} />
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-sm muted mb-2">
            {lang === "en"
              ? "Both approvers must pick the SAME outcome — reason may differ."
              : "يجب أن يختار المعتمِدان نفس النتيجة — يمكن أن يختلف السبب."}
          </p>
          <div className="mb-3">
            <VoteSummary approvals={approvals} lang={lang} />
          </div>

          {myVote && (
            <p className="text-xs muted mb-3 italic">
              {lang === "en"
                ? myVote.action === "reject"
                  ? `You've already voted Reject (${myVote.outcome ? OUTCOME_LABEL[myVote.outcome].en : ""}) — submitting again updates it.`
                  : "You previously voted Approve — submitting this will change your vote to Reject."
                : myVote.action === "reject"
                ? `صوّتَّ بالرفض مسبقًا (${myVote.outcome ? OUTCOME_LABEL[myVote.outcome].ar : ""}) — الإرسال يحدّثه.`
                : "صوّتَّ بالاعتماد سابقًا — الإرسال هنا سيغيّر صوتك إلى رفض."}
            </p>
          )}

          <div className="flex flex-col gap-2 text-sm mb-4">
            <span className="muted">{lang === "en" ? "Rejection outcome" : "نتيجة الرفض"}</span>

            <label
              className="flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer"
              style={{ borderColor: mode === "void_cost" ? "#0b7eea" : "rgb(var(--border))" }}
            >
              <input
                type="radio"
                name="rejection-mode"
                checked={mode === "void_cost"}
                onChange={() => setMode("void_cost")}
                className="mt-1"
              />
              <span>
                <span className="font-medium block">
                  {lang === "en" ? "Keep parts, void cost" : "الاحتفاظ بالقطع، إلغاء التكلفة"}
                </span>
                <span className="text-xs muted">
                  {lang === "en"
                    ? "Stock stays on hand — this receipt's cost lots are repriced to 0."
                    : "يبقى المخزون كما هو — تُعاد تسعير دفعات هذا الإيصال إلى صفر."}
                </span>
              </span>
            </label>

            <label
              className="flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer"
              style={{ borderColor: mode === "remove_stock" ? "#0b7eea" : "rgb(var(--border))" }}
            >
              <input
                type="radio"
                name="rejection-mode"
                checked={mode === "remove_stock"}
                onChange={() => setMode("remove_stock")}
                className="mt-1"
              />
              <span>
                <span className="font-medium block">
                  {lang === "en" ? "Remove stock entirely" : "إزالة المخزون بالكامل"}
                </span>
                <span className="text-xs muted">
                  {lang === "en"
                    ? "Reverses the stock this receipt added. Blocked if any of it has already been consumed."
                    : "يعكس المخزون الذي أضافه هذا الإيصال. يُمنع إذا استُهلك جزء منه بالفعل."}
                </span>
              </span>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{lang === "en" ? "Rejection reason" : "سبب الرفض"}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              rows={3}
              placeholder={lang === "en" ? "optional" : "اختياري"}
            />
          </label>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={close}>
              {lang === "en" ? "Cancel" : "إلغاء"}
            </Btn>
            <button
              type="submit"
              disabled={saving || !receiptId}
              className="h-9 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-2"
              style={{ background: "#be123c" }}
            >
              <X className="h-4 w-4" />
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Reject" : "رفض"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// Approvals TAB — preview's invApprovalsView (pages-2.js ~3277-3329),
// inline on the Inventory page's own "Approvals" tab. Stage B (0057):
// merges the existing PO queue with a new Direct-receipt queue into one
// list, each row typed (PO/Direct badge). Every row is clickable now
// (opens PODetailModal for a PO row, ReceiptDetailModal for a Direct row —
// Direct rows used to have no detail view at all, fixed this pass) with
// Approve/Reject quick actions inline too. Both actions re-check the
// receipt's LIVE status right before opening their modal (0058's vote
// model + two real approvers acting close together means cached page
// props can go stale between load and click) — if it's already resolved,
// this shows an inline notice and refreshes instead of opening a form for
// something no longer actionable.
export function ApprovalsTab({
  lang,
  purchaseOrders,
  purchaseOrderLines,
  stockReceipts,
  stockReceiptApprovals,
  suppliers,
  onViewRow,
  onApprove,
  onReject,
}: {
  lang: "en" | "ar";
  purchaseOrders: PurchaseOrder[];
  // Item 2 ("risky batch" follow-up) — Actual Total column. Every PO in
  // this queue is pending_approval or later, meaning receive_purchase_order
  // has already stamped received_qty/received_unit_price_sar on EVERY line
  // (its own contract, 0051/0055) — no ordered-value fallback needed here,
  // unlike PODetailModal's line table, which also has to handle a PO that
  // hasn't been received yet.
  purchaseOrderLines: PurchaseOrderLine[];
  // purchase_order_approvals is intentionally NOT read here anymore — vote
  // state (action/outcome) only exists on stock_receipt_approvals; a PO
  // row reads its own linked receipt's votes from there instead (see
  // rowVotes below).
  stockReceipts: StockReceipt[];
  stockReceiptApprovals: StockReceiptApproval[];
  suppliers: Supplier[];
  onViewRow: (row: ApprovalRow) => void;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const queue: ApprovalRow[] = useMemo(() => {
    const poRows: ApprovalRow[] = purchaseOrders
      .filter((o) => o.status === "pending_approval")
      .map((po) => ({ kind: "po", po, receipt: stockReceipts.find((r) => r.po_id === po.id) ?? null }));
    const directRows: ApprovalRow[] = stockReceipts
      .filter((r) => r.receipt_type === "direct" && r.status === "pending_approval")
      .map((receipt) => ({ kind: "direct", receipt }));
    return [...poRows, ...directRows].sort((a, b) => {
      const ad = a.kind === "po" ? a.po.received_date ?? "" : a.receipt.received_on;
      const bd = b.kind === "po" ? b.po.received_date ?? "" : b.receipt.received_on;
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }, [purchaseOrders, stockReceipts]);

  // Shared re-check — used by both the quick Approve and Reject buttons.
  // Returns true (proceed) if still pending_approval; otherwise shows an
  // inline notice + refreshes, and returns false (caller must not open a
  // modal for a receipt that's no longer actionable).
  async function stillPending(row: ApprovalRow): Promise<boolean> {
    const id = row.kind === "po" ? row.receipt?.id ?? null : row.receipt.id;
    if (!id) return true; // defensive fallback — modal itself also guards on a missing id
    const live = await getReceiptStatus(id);
    if (live.confirmedNotPending) {
      setNotice(
        lang === "en"
          ? "That was already resolved by someone else — refreshing…"
          : "تم حسم هذا بالفعل من قبل شخص آخر — يتم التحديث…"
      );
      router.refresh();
      return false;
    }
    return true;
  }

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
        <h3 className="font-semibold">{lang === "en" ? "Approvals Queue" : "قائمة الاعتمادات"}</h3>
        <p className="text-sm muted">
          {lang === "en"
            ? "Both approvers must cast the same action to finalize"
            : "يجب أن يتخذ المعتمِدان نفس الإجراء لحسم الأمر"}
        </p>
        {notice && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{notice}</p>}
      </div>
      {queue.length === 0 ? (
        <p className="muted text-sm py-6 text-center">
          {lang === "en" ? "Nothing awaiting approval." : "لا شيء بانتظار الاعتماد."}
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{lang === "en" ? "Reference" : "المرجع"}</TH>
              <TH>{lang === "en" ? "Supplier" : "المورد"}</TH>
              <TH>{lang === "en" ? "Received on" : "تاريخ الاستلام"}</TH>
              <TH>{lang === "en" ? "Actual Total (incl. VAT)" : "الإجمالي الفعلي (شامل الضريبة)"}</TH>
              <TH>{lang === "en" ? "Votes" : "الأصوات"}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const supplierId = row.kind === "po" ? row.po.supplier_id : row.receipt.supplier_id;
              const supplier = suppliersById.get(supplierId);
              const receivedOn = row.kind === "po" ? row.po.received_date ?? "—" : row.receipt.received_on;

              // Votes always live on stock_receipt_approvals (the vote
              // model's action/outcome columns only exist there) — a PO
              // row reads its OWN linked receipt's votes, not
              // purchase_order_approvals (that table stays the old
              // immediate/count-based ledger, mirrored only once the
              // receipt-side vote actually finalizes — see actions.ts).
              const rowVotes =
                row.kind === "po"
                  ? stockReceiptApprovals.filter((a) => a.stock_receipt_id === row.receipt?.id)
                  : stockReceiptApprovals.filter((a) => a.stock_receipt_id === row.receipt.id);

              // VAT (0056/0057) — PO rows prefer the STORED received-side
              // header figures (fallback to summing lines for a pre-0056
              // receipt); Direct rows read stock_receipts' own stored
              // total_cost_sar/vat_sar directly — always populated, no
              // fallback needed (0047/0056 both required them).
              const actualSubtotal =
                row.kind === "po"
                  ? row.po.received_subtotal_sar ??
                    purchaseOrderLines
                      .filter((l) => l.purchase_order_id === row.po.id)
                      .reduce((s, l) => s + (l.received_qty ?? 0) * (l.received_unit_price_sar ?? 0), 0)
                  : row.receipt.total_cost_sar;
              const actualVat = row.kind === "po" ? row.po.received_vat_sar ?? 0 : row.receipt.vat_sar;
              const actualTotal = actualSubtotal + actualVat;
              const key = row.kind === "po" ? `po-${row.po.id}` : `direct-${row.receipt.id}`;

              return (
                <tr
                  key={key}
                  className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  onClick={() => onViewRow(row)}
                >
                  <TD className="font-mono text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <ReceiptTypeBadge type={row.kind === "po" ? "po" : "direct"} lang={lang} />
                      {row.kind === "po" ? (
                        <>
                          {row.po.po_number}
                          {row.po.ai_generated && <AiPill lang={lang} />}
                        </>
                      ) : (
                        row.receipt.id.slice(0, 8).toUpperCase()
                      )}
                    </span>
                  </TD>
                  <TD>
                    <div className="text-sm">{supplier?.name ?? "—"}</div>
                  </TD>
                  <TD className="text-xs">{receivedOn}</TD>
                  <TD className="tabular-nums text-xs">
                    {/* Actual-total block convention (0056) — subtotal
                        (pre-VAT), then VAT, then bold Actual Total. */}
                    <div className="muted">{formatSarVat(actualSubtotal)}</div>
                    <div className="muted">
                      + {formatSarVat(actualVat)} {lang === "en" ? "VAT" : "ض.ق.م"}
                    </div>
                    <div className="font-medium">{formatSarVat(actualTotal)}</div>
                  </TD>
                  <TD className="text-xs">
                    {/* Prior dot-indicator style, restored (was replaced
                        with VoteSummary's text-list in the vote-model
                        pass — reverted per Turki's explicit ask, "Votes"
                        label kept, "Approved by" not brought back). Each
                        name now also shows its reject outcome (void-cost/
                        remove-stock) when applicable — the vote model
                        adds that info, the dot display didn't lose it. */}
                    <div className="inline-flex items-center gap-1">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <span
                          key={i}
                          className="h-2 w-2 rounded-full inline-block"
                          style={{
                            background: i < rowVotes.length ? "#10b981" : "rgb(var(--border))",
                            boxShadow: i < rowVotes.length ? "0 0 0 1px rgba(16,185,129,.4)" : undefined,
                          }}
                        />
                      ))}
                      <span className="muted ms-1">{rowVotes.length}/2</span>
                    </div>
                    {rowVotes.length > 0 && (
                      <div className="text-[11px] muted">
                        {rowVotes
                          .map((a) =>
                            a.action === "reject" && a.outcome
                              ? `${a.approver_email} (${OUTCOME_LABEL[a.outcome][lang]})`
                              : a.approver_email
                          )
                          .join(", ")}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await stillPending(row)) onApprove(row);
                        }}
                        className="h-7 px-2.5 rounded-md text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {lang === "en" ? "Approve" : "اعتماد"}
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await stillPending(row)) onReject(row);
                        }}
                        className="h-7 px-2.5 rounded-md text-xs font-medium text-white inline-flex items-center gap-1.5"
                        style={{ background: "#be123c" }}
                      >
                        <X className="h-3.5 w-3.5" />
                        {lang === "en" ? "Reject" : "رفض"}
                      </button>
                    </div>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

const RECEIPT_STATUS_STYLE: Record<StockReceipt["status"], { bg: string; fg: string; dot: string }> = {
  pending_approval: { bg: "rgba(245,158,11,.14)", fg: "#b45309", dot: "#f59e0b" },
  approved: { bg: "rgba(16,185,129,.14)", fg: "#047857", dot: "#10b981" },
  rejected: { bg: "rgba(244,63,94,.14)", fg: "#be123c", dot: "#f43f5e" },
};

function ReceiptStatusPill({ status, lang }: { status: StockReceipt["status"]; lang: "en" | "ar" }) {
  const style = RECEIPT_STATUS_STYLE[status];
  const label =
    status === "pending_approval"
      ? { en: "Pending Approval", ar: "بانتظار الاعتماد" }
      : status === "approved"
      ? { en: "Approved", ar: "معتمد" }
      : { en: "Rejected", ar: "مرفوض" };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      {lang === "en" ? label.en : label.ar}
    </span>
  );
}

// Direct-receipt detail popup — Stage B fix (this pass). Previously a
// Direct row in the Approvals queue had NO click target at all (no detail
// view existed); it now opens this, mirroring PODetailModal's shape
// (header info grid, line items, votes, Approve/Reject actions) for the
// one entity type that never had an equivalent. Also works for a
// PO-linked receipt if ever opened directly (defensive — today only
// Direct rows dispatch here, PO rows still open PODetailModal, see
// InventoryClient's onViewRow).
export function ReceiptDetailModal({
  lang,
  receipt,
  lines,
  approvals,
  parts,
  suppliers,
  warehouses,
  onClose,
  onApprove,
  onReject,
}: {
  lang: "en" | "ar";
  receipt: StockReceipt;
  lines: StockReceiptLine[];
  approvals: StockReceiptApproval[];
  parts: Part[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  onClose: () => void;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
}) {
  const supplier = suppliers.find((s) => s.id === receipt.supplier_id);
  const warehouse = warehouses.find((w) => w.id === receipt.warehouse_id);
  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of parts) m.set(p.id, p);
    return m;
  }, [parts]);
  const ownLines = lines.filter((l) => l.receipt_id === receipt.id);
  const row: ApprovalRow = { kind: "direct", receipt };
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  // Same live re-check as the Approvals queue's own buttons (see
  // ApprovalsTab's stillPending) — this modal can sit open a while after
  // being opened from a stale row.
  async function stillPending(): Promise<boolean> {
    const live = await getReceiptStatus(receipt.id);
    if (live.confirmedNotPending) {
      setNotice(
        lang === "en"
          ? "This has already been resolved — refreshing…"
          : "تم حسم هذا بالفعل — يتم التحديث…"
      );
      router.refresh();
      return false;
    }
    return true;
  }

  const receiptTotal = receipt.total_cost_sar + receipt.vat_sar;

  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — mirrors PODetailModal exactly: mono title + type badge,
            supplier name as the subtitle (not duplicated in the grid
            below), close only (no print — a receipt has no printable
            invoice document the way a PO does). */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold font-mono inline-flex items-center gap-2">
              {receipt.id.slice(0, 8).toUpperCase()}
              <ReceiptTypeBadge type={receipt.receipt_type} lang={lang} />
            </h2>
            <p className="text-sm muted mt-0.5">{supplier?.name ?? "—"}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Info grid — same container class/shape as PODetailModal's own
            8-field grid; a receipt has no issued/expected-delivery/
            requested-by equivalents (those are PO-lifecycle-specific), so
            this one's shorter, but the fields it does share (Status,
            Received by, Received on, Warehouse) use the exact same
            layout/order convention. Rejection details live in the Votes
            card below now, matching where PODetailModal puts them — not
            up here. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Reference" : "المرجع"}</div>
            <div className="font-mono font-medium">{receipt.id.slice(0, 8).toUpperCase()}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Status" : "الحالة"}</div>
            <div className="mt-0.5">
              <ReceiptStatusPill status={receipt.status} lang={lang} />
            </div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Received on" : "تاريخ الاستلام"}</div>
            <div className="font-medium">{receipt.received_on}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Received by" : "استُلم بواسطة"}</div>
            <div className="font-medium">{receipt.received_by ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Warehouse" : "المستودع"}</div>
            <div className="font-medium">{warehouse?.name ?? "—"}</div>
          </div>
        </div>

        {/* Supplier contact card — byte-for-byte the same markup as
            PODetailModal's own (same tint, same fields, same position:
            right after the info grid, before the line items). */}
        {supplier && (
          <Card className="!p-3 mb-4 !bg-[rgba(11,126,234,.06)] dark:!bg-[rgba(96,196,255,.06)]">
            <div className="text-[11px] muted uppercase mb-1">
              {lang === "en" ? "Supplier contact" : "بيانات المورّد"}
            </div>
            <div className="font-semibold text-sm mb-1">{supplier.name}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
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
          </Card>
        )}

        <Card className="!p-0 overflow-hidden mb-4">
          <Table>
            <thead>
              <tr>
                <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                <TH>{lang === "en" ? "Qty" : "الكمية"}</TH>
                <TH>{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</TH>
                <TH>{lang === "en" ? "VAT (15%)" : "ض.ق.م (15%)"}</TH>
                <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
              </tr>
            </thead>
            <tbody>
              {ownLines.map((l) => {
                const part = partsById.get(l.part_id);
                return (
                  <tr key={l.id}>
                    <TD>
                      <div className="font-mono text-[11px] muted">{part?.sku ?? ""}</div>
                      <div className="text-sm font-medium">
                        {part ? (lang === "ar" && part.name_ar ? part.name_ar : part.name) : "—"}
                      </div>
                      {l.price_lot_id === null && (
                        <span
                          className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(244,63,94,.10)", color: "#be123c" }}
                          title={
                            lang === "en"
                              ? "No traceable price lot — this line cannot be rejected (either outcome)."
                              : "لا توجد دفعة سعر يمكن تتبعها — لا يمكن رفض هذا البند (أي نتيجة)."
                          }
                        >
                          {lang === "en" ? "Not traceable" : "غير قابل للتتبع"}
                        </span>
                      )}
                    </TD>
                    <TD className="tabular">{l.qty}</TD>
                    <TD className="tabular">{formatSar(l.unit_price_sar)}</TD>
                    <TD className="tabular muted text-xs">{formatSarVat(l.line_vat_sar)}</TD>
                    <TD className="tabular font-medium">{formatSar(l.qty * l.unit_price_sar)}</TD>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {lang === "en" ? "Total" : "الإجمالي"}
                </td>
                <td className="py-2.5 px-3 border-t text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  <div className="text-[11px] muted tabular-nums">{formatSarVat(receipt.total_cost_sar)}</div>
                  <div className="text-[11px] muted tabular-nums">
                    + {formatSarVat(receipt.vat_sar)} {lang === "en" ? "VAT" : "ض.ق.م"}
                  </div>
                  <div className="tabular font-bold text-brand-600">{formatSarVat(receiptTotal)}</div>
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>

        {/* Note — its own Card, positioned AFTER the line items table,
            same as PODetailModal's own po.note card (not folded into the
            info grid above it, which is where this used to sit). */}
        {receipt.note && (
          <Card className="!p-3 mb-4">
            <div className="text-[11px] muted uppercase mb-1">{lang === "en" ? "Note" : "ملاحظة"}</div>
            <p className="text-sm whitespace-pre-wrap">{receipt.note}</p>
          </Card>
        )}

        {/* Votes card — same shape/position as PODetailModal's own
            "Approved by" card (icon + heading + count, list of voters,
            rejected-by block at the bottom when terminal) — labeled
            "Votes" (not "Approved by"), and each vote shows its outcome
            type (void-cost/remove-stock) right next to a reject, not just
            the fact that it was a reject. */}
        <Card className="!p-3 mb-4">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            {lang === "en" ? "Votes" : "الأصوات"}{" "}
            <span className="muted text-xs font-normal">({approvals.length}/2)</span>
          </h4>
          {approvals.length === 0 ? (
            <p className="muted text-sm">{lang === "en" ? "Awaiting approval" : "بانتظار الاعتماد"}</p>
          ) : (
            <ul className="space-y-2">
              {approvals.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  {a.action === "approve" ? (
                    <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <X className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="font-medium">
                      {a.approver_email}
                      {a.action === "reject" && a.outcome && (
                        <span className="muted font-normal"> — {OUTCOME_LABEL[a.outcome][lang]}</span>
                      )}
                    </div>
                    <div className="text-[11px] muted">
                      {new Date(a.approved_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}
                      {a.comment ? ` · "${a.comment}"` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {receipt.status === "rejected" && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="font-semibold text-sm text-rose-600">
                {lang === "en" ? "Rejected by" : "رُفض من"}: {receipt.rejected_by ?? "—"}
                {receipt.rejection_mode && (
                  <span className="muted font-normal"> — {OUTCOME_LABEL[receipt.rejection_mode][lang]}</span>
                )}
              </div>
              <div className="text-xs muted mt-1">
                {receipt.rejected_at ? new Date(receipt.rejected_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US") : "—"}
              </div>
              {receipt.rejection_reason && <div className="text-sm mt-1">&quot;{receipt.rejection_reason}&quot;</div>}
            </div>
          )}
          {notice && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{notice}</p>}
        </Card>

        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
          {receipt.status === "pending_approval" && (
            <>
              <button
                type="button"
                onClick={async () => {
                  if (await stillPending()) onReject(row);
                }}
                className="h-9 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-2"
                style={{ background: "#be123c" }}
              >
                <X className="h-4 w-4" />
                {lang === "en" ? "Reject" : "رفض"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await stillPending()) onApprove(row);
                }}
                className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                {lang === "en" ? "Approve" : "اعتماد"}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

function SpendBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 70 ? "#10b981" : clamped >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,.06)" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

// Financial Analysis TAB — preview's invReportsView (pages-2.js
// ~3331-3439): spend KPIs, top spend categories + spend-by-supplier bar
// charts (from real purchase_order_lines/purchase_orders, actual received
// figures where available), and an AI Insights card (low-stock items,
// price-up items, supplier-consolidation suggestion). Uses real dates
// (todayKey-based cutoffs), not preview's hardcoded demo "today".
//
// The AI Insights card's low-stock recommendation carries an "AI-Suggest ->"
// button (preview's INV.openAIPO(), pages-2.js ~3420) wired to the same
// onOpenAISuggest callback the header button uses (InventoryClient.tsx) —
// both land on suggestAIPurchaseLines() + NewPOModal's aiSuggestion prop.
export function FinancialAnalysisTab({
  lang,
  parts,
  priceLots,
  purchaseOrders,
  purchaseOrderLines,
  suppliers,
  inventoryValue,
  openPOsCount,
  onOpenAISuggest,
}: {
  lang: "en" | "ar";
  parts: Part[];
  priceLots: { part_id: string; price_sar: number; received_on: string; created_at: string }[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  suppliers: Supplier[];
  inventoryValue: number;
  openPOsCount: number;
  onOpenAISuggest: () => void;
}) {
  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  function daysAgoKey(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function poActualOrEstimated(po: PurchaseOrder): number {
    return purchaseOrderLines
      .filter((l) => l.purchase_order_id === po.id)
      .reduce((s, l) => s + (l.received_qty ?? l.qty) * (l.received_unit_price_sar ?? l.unit_price_sar), 0);
  }

  const cutoff30 = daysAgoKey(30);
  const cutoff90 = daysAgoKey(90);
  const spend30 = purchaseOrders
    .filter((po) => po.received_date && po.received_date >= cutoff30 && po.status === "approved")
    .reduce((s, po) => s + poActualOrEstimated(po), 0);
  const spend90 = purchaseOrders
    .filter(
      (po) =>
        po.received_date && po.received_date >= cutoff90 && (po.status === "approved" || po.status === "pending_approval")
    )
    .reduce((s, po) => s + poActualOrEstimated(po), 0);

  const partsById = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of parts) m.set(p.id, p);
    return m;
  }, [parts]);

  // Top spend categories — same PO filter as spend90 (approved + pending
  // approval), grouped by part.category.
  const spendByCat = new Map<string, number>();
  for (const po of purchaseOrders) {
    if (po.status !== "approved" && po.status !== "pending_approval") continue;
    for (const l of purchaseOrderLines.filter((x) => x.purchase_order_id === po.id)) {
      const part = partsById.get(l.part_id);
      if (!part || !part.category) continue;
      const cost = (l.received_qty ?? l.qty) * (l.received_unit_price_sar ?? l.unit_price_sar);
      spendByCat.set(part.category, (spendByCat.get(part.category) ?? 0) + cost);
    }
  }
  const catRows = Array.from(spendByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const catMax = catRows[0]?.[1] ?? 1;

  // Spend by supplier — same PO filter.
  const spendBySup = new Map<string, number>();
  for (const po of purchaseOrders) {
    if (po.status !== "approved" && po.status !== "pending_approval") continue;
    const name = suppliersById.get(po.supplier_id)?.name ?? "—";
    spendBySup.set(name, (spendBySup.get(name) ?? 0) + poActualOrEstimated(po));
  }
  const supRows = Array.from(spendBySup.entries()).sort((a, b) => b[1] - a[1]);
  const supMax = supRows[0]?.[1] ?? 1;

  // AI insights — pure recommendations, no PO creation wired yet (see this
  // component's own header comment).
  const lowParts = parts.filter((p) => p.reorder_level != null && p.qty_on_hand <= p.reorder_level);
  const pricesByPart = useMemo(() => {
    const m = new Map<string, { current: number; previous: number | null }>();
    for (const lot of priceLots) {
      const existing = m.get(lot.part_id);
      if (!existing) m.set(lot.part_id, { current: lot.price_sar, previous: null });
      else m.set(lot.part_id, { current: lot.price_sar, previous: existing.current });
    }
    return m;
  }, [priceLots]);
  const pricedUp = parts.filter((p) => {
    const prices = pricesByPart.get(p.id);
    if (!prices || prices.previous == null || prices.previous <= 0) return false;
    return (prices.current - prices.previous) / prices.previous > 0.1;
  });
  const supplierPOCount = new Map<string, number>();
  for (const po of purchaseOrders) {
    const name = suppliersById.get(po.supplier_id)?.name ?? "—";
    supplierPOCount.set(name, (supplierPOCount.get(name) ?? 0) + 1);
  }
  const consolidate = Array.from(supplierPOCount.entries()).filter(([, n]) => n >= 3);
  const noInsights = lowParts.length === 0 && pricedUp.length === 0 && consolidate.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "Spend (30d)" : "الإنفاق (30 يوم)"} value={formatSar(spend30)} tone="info" />
        <Stat label={lang === "en" ? "Spend (90d)" : "الإنفاق (90 يوم)"} value={formatSar(spend90)} tone="info" />
        <Stat label={lang === "en" ? "Inventory Value" : "قيمة المخزون"} value={formatSar(inventoryValue)} tone="ok" />
        <Stat label={lang === "en" ? "Open POs" : "أوامر مفتوحة"} value={openPOsCount} tone="warn" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Top spend categories (90d)" : "أعلى فئات الإنفاق (90 يوم)"}</h3>
          {catRows.length === 0 ? (
            <p className="muted text-sm">{lang === "en" ? "No approved spend yet" : "لا يوجد إنفاق معتمد بعد"}</p>
          ) : (
            <div className="space-y-2">
              {catRows.map(([cat, val]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{categoryLabel(cat, lang)}</span>
                    <span className="font-medium tabular-nums">{formatSar(val)}</span>
                  </div>
                  <SpendBar pct={(val / catMax) * 100} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="!p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Spend by supplier" : "الإنفاق حسب المورّد"}</h3>
          {supRows.length === 0 ? (
            <p className="muted text-sm">{lang === "en" ? "No approved spend yet" : "لا يوجد إنفاق معتمد بعد"}</p>
          ) : (
            <div className="space-y-2">
              {supRows.map(([sup, val]) => (
                <div key={sup}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{sup}</span>
                    <span className="font-medium tabular-nums">{formatSar(val)}</span>
                  </div>
                  <SpendBar pct={(val / supMax) * 100} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div
        className="card p-4"
        style={{ background: "linear-gradient(180deg, rgba(139,92,246,.04) 0%, transparent 100%)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full text-white tracking-wide"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
          >
            <Zap className="h-3 w-3" />
            {lang === "en" ? "AI Insights & Recommendations" : "رؤى وتوصيات الذكاء"}
          </span>
        </div>
        <div className="space-y-3">
          {lowParts.length > 0 && (
            <div className="rounded-lg border p-3" style={{ background: "rgba(245,158,11,.06)", borderColor: "rgba(245,158,11,.3)" }}>
              <div className="font-medium text-sm flex items-center">
                {lang === "en" ? "Items below reorder level — consider issuing POs now" : "أصناف تحت حد إعادة الطلب — اعتبر إصدار أوامر شراء"}
                <span className="inline-block min-w-[1.25rem] px-1.5 rounded-full bg-violet-500 text-white text-[11px] font-bold text-center ms-2">
                  {lowParts.length}
                </span>
              </div>
              <div className="text-xs muted mt-1">
                {lowParts.slice(0, 4).map((p) => p.sku).join(", ")}
                {lowParts.length > 4 ? "…" : ""}
              </div>
              <button
                type="button"
                onClick={onOpenAISuggest}
                className="h-7 px-2.5 mt-2 rounded-md text-xs font-medium border inline-flex items-center gap-1.5"
                style={INPUT_STYLE}
              >
                {lang === "en" ? "AI-Suggest" : "اقتراح ذكي"} →
              </button>
            </div>
          )}
          {pricedUp.length > 0 && (
            <div className="rounded-lg border p-3" style={{ background: "rgba(11,126,234,.05)", borderColor: "rgba(11,126,234,.25)" }}>
              <div className="font-medium text-sm flex items-center">
                {lang === "en"
                  ? "Parts whose latest price increased >10% — review supplier alternatives"
                  : "قطع ارتفع آخر سعر لها أكثر من 10% — راجع البدائل"}
                <span className="inline-block min-w-[1.25rem] px-1.5 rounded-full bg-violet-500 text-white text-[11px] font-bold text-center ms-2">
                  {pricedUp.length}
                </span>
              </div>
              <div className="text-xs muted mt-1">
                {pricedUp
                  .slice(0, 4)
                  .map((p) => {
                    const prices = pricesByPart.get(p.id)!;
                    const pct = Math.round(((prices.current - (prices.previous ?? 0)) / (prices.previous ?? 1)) * 100);
                    return `${p.sku} (${pct}%)`;
                  })
                  .join(", ")}
              </div>
            </div>
          )}
          {consolidate.length > 0 && (
            <div className="rounded-lg border p-3" style={{ background: "rgba(11,126,234,.05)", borderColor: "rgba(11,126,234,.25)" }}>
              <div className="font-medium text-sm">
                {lang === "en"
                  ? "Suppliers with multiple small POs — consolidating can unlock volume discounts"
                  : "موردون بأوامر صغيرة متعددة — التوحيد قد يحقق خصومات الكمية"}
              </div>
              <div className="text-xs muted mt-1">{consolidate.map(([s, n]) => `${s} (${n})`).join(", ")}</div>
            </div>
          )}
          {noInsights && (
            <p className="muted text-sm">
              {lang === "en" ? "No recommendations at this time — inventory looks healthy." : "لا توصيات حالياً — المخزون في حالة جيدة."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Per-part financial report — preview's INV.openPartFinance/D().partFinance
// (pages-2.js ~1969-2050, data.js ~1898-1919), opened from the chart-icon
// button next to "View" on the parts table (InventoryClient.tsx's
// PartsTable). Purchases come from real purchase_order_lines (approved/
// pending_approval POs only, actual received qty/price where available —
// same received_qty ?? qty / received_unit_price_sar ?? unit_price_sar
// convention PODetailModal already uses). Price trend compares the latest
// price_lots entry against the average of every earlier one for this part.
//
// CONSUMPTION IS REAL, JUST CURRENTLY ALWAYS ZERO: preview's partFinance
// also reports consumption (spentByConsumption/totalConsumed) from a
// partUsage log — in preview that's static seed data, not something any
// button in preview's own UI actually writes either. This app derives the
// same numbers from stock_movements where movement_type = 'consume' (CHECK
// constraint added by migration 0046) — a real column, just nothing writes
// to it yet (no Maintenance/work-order consumption flow exists). So
// totalConsumed reads 0 for every part today, honestly, not faked — it
// starts reflecting real numbers the moment that flow ships. spentByConsumption
// stays 0 specifically because stock_movements has no per-movement cost
// column to derive it from (qty_delta/qty_after only) — whichever feature
// eventually writes 'consume' rows will need to decide how cost gets
// attributed (most likely via consume_from_lots, which does know per-lot
// cost) at that time.
//
// Pure calc, shared between PartFinanceModal and ViewPartModal's own
// "Financial summary" card (InventoryClient.tsx) so both stay in sync on
// exactly one definition of each number, instead of two hand-copied
// implementations drifting apart later. PartFinanceModal additionally
// needs the per-PO purchase rows for its own history table — that stays
// caller-side (different shape), this only returns the 6 aggregate
// primitives PartFinanceSummaryCard renders.
export function computePartFinanceStats(
  part: Part,
  priceLots: PriceLot[],
  purchaseOrders: PurchaseOrder[],
  purchaseOrderLines: PurchaseOrderLine[],
  movements: StockMovement[]
): {
  totalPurchased: number;
  // VAT (0056) — "Purchases" is the one stat in this card that's a real
  // purchasing-money figure (a booked cost of parts bought), so it's the
  // one place here VAT applies. stockValue/priceTrendPct/totalConsumed/
  // spentByConsumption stay VAT-free (see this function's own callers'
  // header comments + 0056's "must NOT appear" list) — untouched below.
  // Sourced from each qualifying line's STORED line_vat_sar/
  // received_line_vat_sar, never recomputed — a pre-0056 line honestly
  // reads 0 here, not back-computed.
  purchasesVat: number;
  purchasesTotal: number; // totalPurchased + purchasesVat
  purchaseCount: number;
  stockValue: number;
  priceTrendPct: number;
  totalConsumed: number;
  spentByConsumption: number;
} {
  const lots = priceLots
    .filter((l) => l.part_id === part.id)
    .sort((a, b) => (a.received_on !== b.received_on ? (a.received_on < b.received_on ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
  const currentPrice = lots.length > 0 ? lots[lots.length - 1].price_sar : part.unit_cost_sar;
  let priceTrendPct = 0;
  if (lots.length >= 2 && currentPrice != null) {
    const hist = lots.slice(0, -1);
    const avgOld = hist.reduce((s, l) => s + l.price_sar, 0) / hist.length;
    if (avgOld > 0) priceTrendPct = Math.round(((currentPrice - avgOld) / avgOld) * 1000) / 10;
  }
  const stockValue = part.unit_cost_sar != null ? part.unit_cost_sar * part.qty_on_hand : 0;

  let totalPurchased = 0;
  let purchasesVat = 0;
  let purchaseCount = 0;
  for (const po of purchaseOrders) {
    if (po.status !== "approved" && po.status !== "pending_approval") continue;
    const line = purchaseOrderLines.find((l) => l.purchase_order_id === po.id && l.part_id === part.id);
    if (!line) continue;
    const qty = line.received_qty ?? line.qty;
    const unit = line.received_unit_price_sar ?? line.unit_price_sar;
    totalPurchased += qty * unit;
    purchasesVat += line.received_line_vat_sar ?? line.line_vat_sar;
    purchaseCount += 1;
  }
  const purchasesTotal = totalPurchased + purchasesVat;

  // See this file's own header comment above (CONSUMPTION IS REAL...) —
  // always 0 today, not faked, just nothing writes movement_type='consume'
  // rows yet.
  const totalConsumed = movements
    .filter((m) => m.part_id === part.id && m.movement_type === "consume")
    .reduce((s, m) => s + Math.abs(m.qty_delta), 0);
  const spentByConsumption = 0;

  return {
    totalPurchased,
    purchasesVat,
    purchasesTotal,
    purchaseCount,
    stockValue,
    priceTrendPct,
    totalConsumed,
    spentByConsumption,
  };
}

export function PartFinanceSummaryCard({
  lang,
  part,
  totalPurchased,
  purchasesVat,
  purchasesTotal,
  purchaseCount,
  stockValue,
  priceTrendPct,
  totalConsumed,
  spentByConsumption,
}: {
  lang: "en" | "ar";
  part: Part;
  totalPurchased: number;
  purchasesVat: number;
  purchasesTotal: number;
  purchaseCount: number;
  stockValue: number;
  priceTrendPct: number;
  totalConsumed: number;
  spentByConsumption: number;
}) {
  const trendCls =
    priceTrendPct > 0 ? "text-rose-600 dark:text-rose-400" : priceTrendPct < 0 ? "text-emerald-700 dark:text-emerald-400" : "muted";
  const trendArrow = priceTrendPct > 0 ? "↑" : priceTrendPct < 0 ? "↓" : "→";

  // Same 4 branches + healthy fallback preview's own per-part AI tip uses
  // (pages-2.js:1772-1792) — "purchased but not consumed" is back now that
  // consumption is real data (see header comment above); it'll fire for
  // most parts with purchase history until a real consumption flow exists,
  // which is an accurate reflection of today's app state, not a bug.
  const aiTip: { tone: "warn" | "info" | "ok"; text: string } = (() => {
    if (part.reorder_level != null && part.qty_on_hand <= part.reorder_level * 0.5) {
      return {
        tone: "warn",
        text:
          lang === "en"
            ? `Stock critical — only ${part.qty_on_hand} ${part.unit ?? ""} left vs reorder level of ${part.reorder_level}. Recommend issuing a PO of ${part.reorder_qty ?? "?"} ${part.unit ?? ""} immediately.`
            : `المخزون حرج — يتبقى ${part.qty_on_hand} ${part.unit ?? ""} مقابل حد إعادة طلب ${part.reorder_level}. يُوصى بإصدار أمر شراء بكمية ${part.reorder_qty ?? "?"} ${part.unit ?? ""} فورًا.`,
      };
    }
    if (priceTrendPct >= 10) {
      return {
        tone: "warn",
        text:
          lang === "en"
            ? `Price up ${priceTrendPct}% over historical batches. Compare quotes from alternative suppliers before the next PO.`
            : `ارتفع السعر ${priceTrendPct}% مقارنة بالدفعات السابقة. قارن العروض من موردين بدلاء قبل أمر الشراء التالي.`,
      };
    }
    if (totalConsumed === 0 && purchaseCount > 0) {
      return {
        tone: "warn",
        text:
          lang === "en"
            ? "Purchased but not yet consumed — review storage and assignment."
            : "تم الشراء ولم يُستهلك بعد — راجع التخزين والإسناد.",
      };
    }
    if (part.reorder_level != null && part.reorder_level > 0 && part.qty_on_hand > part.reorder_level * 3) {
      return {
        tone: "info",
        text:
          lang === "en"
            ? `Overstocked at ${part.qty_on_hand} ${part.unit ?? ""} (>3× reorder level). Consider postponing the next PO.`
            : `مخزون زائد عند ${part.qty_on_hand} ${part.unit ?? ""} (>3× حد الطلب). فكّر في تأجيل أمر الشراء التالي.`,
      };
    }
    return {
      tone: "ok",
      text: lang === "en" ? "Stock and pricing look healthy. No action recommended." : "المخزون والسعر في حالة جيدة. لا حاجة لإجراء.",
    };
  })();
  const tipStyle =
    aiTip.tone === "warn"
      ? { background: "rgba(245,158,11,.06)", borderColor: "rgba(245,158,11,.3)" }
      : aiTip.tone === "info"
      ? { background: "rgba(11,126,234,.05)", borderColor: "rgba(11,126,234,.25)" }
      : { background: "rgba(16,185,129,.05)", borderColor: "rgba(16,185,129,.25)" };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
        <div className="rounded-lg border p-3" style={INPUT_STYLE}>
          <div className="text-[11px] muted uppercase">{lang === "en" ? "Purchases" : "المشتريات"}</div>
          {/* Follow-up fix — re-perspectived total-first (Turki: "same
              figures, just re-perspectived"): the bold headline figure is
              now the VAT-INCLUSIVE total, with the pre-VAT subtotal + VAT
              breakdown faded below it — same two stored figures as before,
              just swapped which one leads. The one stat on this card that's
              a real purchasing figure; Stock Value/Consumption/Price Trend
              stay VAT-free. */}
          <div className="text-lg font-semibold tabular-nums">{formatSarVat(purchasesTotal)}</div>
          <div className="text-[11px] muted tabular-nums">
            {formatSarVat(totalPurchased)} + {formatSarVat(purchasesVat)} {lang === "en" ? "VAT" : "ض.ق.م"}
          </div>
          <div className="text-[11px] muted">
            {purchaseCount} {lang === "en" ? "PO lines" : "بنود أوامر"}
          </div>
        </div>
        <div className="rounded-lg border p-3" style={INPUT_STYLE}>
          <div className="text-[11px] muted uppercase">
            {lang === "en" ? "Consumption" : "الاستهلاك"} ({lang === "en" ? "all time" : "الإجمالي"})
          </div>
          <div className="text-lg font-semibold tabular-nums">{formatSar(spentByConsumption)}</div>
          <div className="text-[11px] muted">
            {totalConsumed} {part.unit ?? ""}
          </div>
        </div>
        <div className="rounded-lg border p-3" style={INPUT_STYLE}>
          <div className="text-[11px] muted uppercase">{lang === "en" ? "Stock Value" : "قيمة المخزون"}</div>
          <div className="text-lg font-semibold tabular-nums text-brand-600">{formatSar(stockValue)}</div>
          <div className="text-[11px] muted">
            {part.qty_on_hand} {part.unit ?? ""} {lang === "en" ? "in stock" : "في المخزون"}
          </div>
        </div>
        <div className="rounded-lg border p-3" style={INPUT_STYLE}>
          <div className="text-[11px] muted uppercase">{lang === "en" ? "Price Trend" : "اتجاه السعر"}</div>
          <div className={cn("text-lg font-semibold tabular-nums", trendCls)}>
            {trendArrow} {Math.abs(priceTrendPct)}%
          </div>
          <div className="text-[11px] muted">{lang === "en" ? "vs historical batches" : "مقابل الدفعات السابقة"}</div>
        </div>
      </div>

      <div className="rounded-lg border p-3" style={tipStyle}>
        <div className="flex items-start gap-2">
          <span
            className="inline-flex items-center gap-1 shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full text-white tracking-wide"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
          >
            <Zap className="h-3 w-3" />
            AI
          </span>
          <div className="text-sm">{aiTip.text}</div>
        </div>
      </div>
    </div>
  );
}

export function PartFinanceModal({
  lang,
  part,
  warehouses,
  priceLots,
  purchaseOrders,
  purchaseOrderLines,
  onClose,
  onViewPO,
  onViewPart,
}: {
  lang: "en" | "ar";
  part: Part;
  warehouses: Warehouse[];
  priceLots: PriceLot[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  onClose: () => void;
  onViewPO: (po: PurchaseOrder) => void;
  // preview's openPartFinance footer has Close + "View Part" (jumps to the
  // full drawer, pages-2.js:2067-2069) — this modal had no footer at all
  // before, only the header's X-to-close.
  onViewPart: (p: Part) => void;
}) {
  const warehouseName = warehouses.find((w) => w.id === part.warehouse_id)?.name ?? "—";

  // Consumption — fetched the same way ViewPartModal already fetches this
  // part's full movement history (getPartMovements). Currently always
  // empty (see computePartFinanceStats's own header comment) — fetched
  // anyway so the numbers are honest and will start moving the moment a
  // real consumption flow exists.
  const [movements, setMovements] = useState<StockMovement[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPartMovements(part.id).then((res) => {
      if (!cancelled && !res.error) setMovements(res.movements);
    });
    return () => {
      cancelled = true;
    };
  }, [part.id]);

  const stats = useMemo(
    () => computePartFinanceStats(part, priceLots, purchaseOrders, purchaseOrderLines, movements),
    [part, priceLots, purchaseOrders, purchaseOrderLines, movements]
  );

  // Per-PO breakdown for the table below — computePartFinanceStats only
  // returns the aggregate totalPurchased/purchaseCount, this modal alone
  // needs the row-level detail (date/PO/qty/price/cost).
  const allPurchases = useMemo(() => {
    return purchaseOrders
      .filter((po) => po.status === "approved" || po.status === "pending_approval")
      .flatMap((po) => {
        const line = purchaseOrderLines.find((l) => l.purchase_order_id === po.id && l.part_id === part.id);
        if (!line) return [];
        const qty = line.received_qty ?? line.qty;
        const unit = line.received_unit_price_sar ?? line.unit_price_sar;
        // VAT (0056) — the STORED figure (received-side if received, else
        // ordered-side), never recomputed — a pre-0056 line legitimately
        // reads 0 here (booked before VAT existed, not back-computed).
        const vat = line.received_line_vat_sar ?? line.line_vat_sar;
        return [{ po, date: po.received_date ?? po.request_date, qty, unit, vat, cost: qty * unit }];
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [purchaseOrders, purchaseOrderLines, part.id]);
  const purchaseRows = allPurchases.slice(0, 8);

  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h2 className="text-lg font-semibold">{lang === "ar" && part.name_ar ? part.name_ar : part.name}</h2>
            <p className="text-xs muted mt-0.5">
              <span className="font-mono">{part.sku}</span> · {categoryLabel(part.category, lang)} · {warehouseName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Item 3 (polish round) — same faded light-purple tint as
            ViewPartModal's own inline "Financial summary" card, so this
            standalone popup's version of the SAME card (see this
            component's own header comment) reads consistently. */}
        <div className="my-4 rounded-xl p-4 !bg-[rgba(139,92,246,.05)] dark:!bg-[rgba(139,92,246,.07)]">
          <PartFinanceSummaryCard
            lang={lang}
            part={part}
            totalPurchased={stats.totalPurchased}
            purchasesVat={stats.purchasesVat}
            purchasesTotal={stats.purchasesTotal}
            purchaseCount={stats.purchaseCount}
            stockValue={stats.stockValue}
            priceTrendPct={stats.priceTrendPct}
            totalConsumed={stats.totalConsumed}
            spentByConsumption={stats.spentByConsumption}
          />
        </div>

        <div>
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            {lang === "en" ? "Purchase history" : "سجل المشتريات"}
          </h4>
          <Card className="!p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>{lang === "en" ? "Date" : "التاريخ"}</TH>
                  <TH>{lang === "en" ? "PO #" : "رقم الأمر"}</TH>
                  <TH>{lang === "en" ? "Qty" : "الكمية"}</TH>
                  <TH>{lang === "en" ? "Unit cost" : "تكلفة الوحدة"}</TH>
                  <TH>{lang === "en" ? "Total (incl. VAT)" : "الإجمالي (شامل الضريبة)"}</TH>
                </tr>
              </thead>
              <tbody>
                {purchaseRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                      {lang === "en" ? "No purchases yet" : "لا توجد مشتريات بعد"}
                    </td>
                  </tr>
                ) : (
                  purchaseRows.map(({ po, date, qty, unit, vat, cost }) => (
                    <tr key={po.id}>
                      <TD className="text-xs">{date}</TD>
                      <TD className="font-mono text-xs">
                        <button
                          type="button"
                          className="text-brand-600 hover:underline inline-flex items-center gap-1.5"
                          onClick={() => {
                            onClose();
                            onViewPO(po);
                          }}
                        >
                          {po.po_number}
                          {po.ai_generated && <AiPill lang={lang} />}
                        </button>
                      </TD>
                      <TD className="tabular-nums">
                        {qty} {part.unit ?? ""}
                      </TD>
                      <TD className="tabular-nums">{formatSar(unit)}</TD>
                      {/* Follow-up fix — was two separate columns (VAT, then
                          pre-VAT Cost); "same issue as Financial summary
                          Purchases" — now one column, total-first (bold),
                          pre-VAT + VAT breakdown faded below it. Same two
                          stored figures (cost/vat), just re-perspectived. */}
                      <TD className="tabular-nums">
                        <div className="font-medium">{formatSarVat(cost + vat)}</div>
                        <div className="muted text-[11px]">
                          {formatSarVat(cost)} + {formatSarVat(vat)} {lang === "en" ? "VAT" : "ض.ق.م"}
                        </div>
                      </TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
          <Btn
            variant="primary"
            onClick={() => {
              onClose();
              onViewPart(part);
            }}
          >
            <Eye className="h-4 w-4" />
            {lang === "en" ? "View Part" : "عرض القطعة"}
          </Btn>
        </div>
      </div>
    </ModalOverlay>
  );
}
