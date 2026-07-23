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
// Reuses NewSupplierModal / CreateWarehouseModal / AddPartModal from
// ./SharedCreateModals.tsx — same inline-create modals ReceivePartsModal
// (InventoryClient.tsx) already uses, not reimplemented here. Deliberately
// NOT imported from InventoryClient.tsx directly: this file needs those
// three, while InventoryClient.tsx needs ProcStrip/NewPOModal/POListModal/
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
} from "lucide-react";
import { Btn, Table, TH, TD, Card, Stat } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import type {
  Warehouse,
  Part,
  Supplier,
  Unit,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderApproval,
  PriceLot,
} from "@/lib/db-types";
import {
  createPurchaseOrder,
  issuePurchaseOrder,
  receivePurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  type PurchaseOrderLineInput,
} from "./actions";
import { NewSupplierModal, CreateWarehouseModal, AddPartModal, InvoiceFileTile, categoryLabel } from "./SharedCreateModals";

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
  onOpenApprovalsList,
}: {
  lang: "en" | "ar";
  openCount: number;
  awaitingReceiptCount: number;
  pendingReviewCount: number;
  onOpenList: () => void;
  onOpenReceiveList: () => void;
  onOpenApprovalsList: () => void;
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
        onClick={onOpenApprovalsList}
        warn
      />
    </div>
  );
}

type NewPOLine = PurchaseOrderLineInput;

// New Purchase Order — mirrors preview's openNewPO/_renderPOModal/savePO
// exactly in shape: supplier + inline "+ Supplier", warehouse + inline
// "+ Warehouse", expected delivery date, line-item builder + inline
// "New Item", note. Two save actions (Save draft / Issue now) instead of
// preview's single savePO(status) — this app's backend is two RPCs
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

export function NewPOModal({
  lang,
  suppliers,
  warehouses,
  parts,
  units,
  aiSuggestion,
  onClose,
  onSaved,
}: {
  lang: "en" | "ar";
  suppliers: Supplier[];
  warehouses: Warehouse[];
  parts: Part[];
  units: Unit[];
  aiSuggestion?: NewPOAISuggestion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();

  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>([]);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [localWarehouses, setLocalWarehouses] = useState<Warehouse[]>([]);
  const [newWarehouseOpen, setNewWarehouseOpen] = useState(false);
  const [localParts, setLocalParts] = useState<Part[]>([]);
  const [newItemOpen, setNewItemOpen] = useState(false);

  const [supplierId, setSupplierId] = useState(aiSuggestion?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(aiSuggestion?.warehouseId ?? warehouses[0]?.id ?? "");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [lines, setLines] = useState<NewPOLine[]>(aiSuggestion?.lines ?? []);
  const [addPartId, setAddPartId] = useState("");
  const [note, setNote] = useState(
    aiSuggestion ? (lang === "en" ? aiSuggestion.noteEn : aiSuggestion.noteAr) : ""
  );
  const [droppedNotice, setDroppedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "issued" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSuppliers = useMemo(() => {
    const ids = new Set(suppliers.map((s) => s.id));
    return [...suppliers, ...localSuppliers.filter((s) => !ids.has(s.id))];
  }, [suppliers, localSuppliers]);

  const allWarehouses = useMemo(() => {
    const ids = new Set(warehouses.map((w) => w.id));
    return [...warehouses, ...localWarehouses.filter((w) => !ids.has(w.id))];
  }, [warehouses, localWarehouses]);

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

  const total = lines.reduce((s, l) => s + l.qty * l.unit_price_sar, 0);
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

    const createRes = await createPurchaseOrder({
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      lines,
      expected_delivery: expectedDelivery || null,
      note: note.trim() || null,
      ai_generated: !!aiSuggestion,
      ai_rationale: aiSuggestion?.rationale.en ?? null,
      ai_rationale_ar: aiSuggestion?.rationale.ar ?? null,
    });
    if (createRes.error || !createRes.po) {
      setSaving(null);
      setError(createRes.error ?? (lang === "en" ? "Could not create purchase order." : "تعذّر إنشاء أمر الشراء."));
      return;
    }

    if (status === "draft") {
      setSaving(null);
      onSaved();
      onClose();
      router.refresh();
      return;
    }

    const issueRes = await issuePurchaseOrder(createRes.po.id);
    setSaving(null);
    if (issueRes.error) {
      // The PO already exists as a draft at this point — don't lose it.
      // Refresh so it shows up in the list, but keep the modal open so
      // Turki sees exactly why "Issue now" didn't finish.
      router.refresh();
      setError(
        (lang === "en"
          ? `Saved as draft (${createRes.po.po_number}), but issuing failed: `
          : `حُفظ كمسوّدة (${createRes.po.po_number})، لكن تعذّر الإصدار: `) + issueRes.error
      );
      return;
    }

    onSaved();
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {lang === "en" ? "New Purchase Order" : "أمر شراء جديد"}
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
              <div className="flex gap-2">
                <select
                  value={warehouseId}
                  onChange={(e) => {
                    setDroppedNotice(null);
                    changeWarehouse(e.target.value);
                  }}
                  className={cn(INPUT, "flex-1")}
                  style={INPUT_STYLE}
                  required
                >
                  {allWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <Btn type="button" variant="outline" onClick={() => setNewWarehouseOpen(true)}>
                  {lang === "en" ? "+ Warehouse" : "+ مستودع"}
                </Btn>
              </div>
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
                <select
                  value={addPartId}
                  onChange={(e) => setAddPartId(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border text-sm max-w-[280px]"
                  style={INPUT_STYLE}
                >
                  <option value="">{lang === "en" ? "Pick a part to add…" : "اختر قطعة للإضافة…"}</option>
                  {partsInWarehouse.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                    </option>
                  ))}
                </select>
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
                    <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
                    <TH></TH>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
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
                        colSpan={3}
                        className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {lang === "en" ? "Estimated total" : "الإجمالي التقديري"}
                      </td>
                      <td
                        className="tabular font-bold text-brand-600 py-2.5 px-3 border-t text-sm"
                        style={{ borderColor: "rgb(var(--border))" }}
                      >
                        {formatSar(total)}
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

      {newWarehouseOpen && (
        <CreateWarehouseModal
          lang={lang}
          onClose={() => setNewWarehouseOpen(false)}
          onCreated={(warehouse) => {
            setLocalWarehouses((prev) => [...prev, warehouse]);
            setDroppedNotice(null);
            changeWarehouse(warehouse.id);
          }}
        />
      )}

      {newItemOpen && (
        <AddPartModal
          lang={lang}
          warehouses={allWarehouses}
          parts={allParts}
          units={units}
          defaultWarehouseId={warehouseId}
          onClose={() => setNewItemOpen(false)}
          onCreated={(part) => addNewPartAsLine(part)}
        />
      )}
    </div>
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
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
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
                  <TH>{lang === "en" ? "PO Total" : "إجمالي الأمر"}</TH>
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
                      <TD className="tabular font-medium">{formatSar(poTotal(po.id, purchaseOrderLines))}</TD>
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
    </div>
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
              {lang === "en" ? "Print" : "طباعة"}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
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
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Warehouse" : "المستودع"}</div>
            <div className="font-medium">{warehouse?.name ?? "—"}</div>
          </div>
          {po.received_by && (
            <>
              <div>
                <div className="text-[11px] muted uppercase">{lang === "en" ? "Received by" : "استُلم بواسطة"}</div>
                <div className="font-medium">{po.received_by}</div>
              </div>
              <div>
                <div className="text-[11px] muted uppercase">{lang === "en" ? "Received on" : "تاريخ الاستلام"}</div>
                <div className="font-medium">{po.received_date ?? "—"}</div>
              </div>
            </>
          )}
        </div>

        {supplier && (
          <Card className="!p-3 mb-4">
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
                <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
              </tr>
            </thead>
            <tbody>
              {poLines.map((l) => {
                const part = partsById.get(l.part_id);
                const qty = l.received_qty ?? l.qty;
                const price = l.received_unit_price_sar ?? l.unit_price_sar;
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
                  <TD className="tabular font-medium">{formatSar(qty * price)}</TD>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={3}
                  className="text-end font-semibold py-2.5 px-3 border-t text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {hasReceivedFigures
                    ? lang === "en" ? "Actual total" : "الإجمالي الفعلي"
                    : lang === "en" ? "Estimated total" : "الإجمالي التقديري"}
                </td>
                <td
                  className="tabular font-bold text-brand-600 py-2.5 px-3 border-t text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {formatSar(total)}
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
            <button
              type="button"
              disabled={issuing}
              onClick={handleIssue}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              {issuing ? (lang === "en" ? "Issuing…" : "جارٍ الإصدار…") : lang === "en" ? "Issue" : "إصدار"}
            </button>
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
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
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
    </div>
  );
}

type ReceiveLineState = {
  line_id: string;
  part_id: string;
  ordered_qty: number;
  ordered_unit_price_sar: number;
  received_qty: string; // text-backed, same "empty distinguishable from 0" convention as useNumField
  received_unit_price_sar: string;
};

// Receive a Purchase Order — preview's openReceive(prefillPOId), trimmed to
// what this phase actually needs: NOT the full loose/PO-dual-mode receive
// draft (supplier/warehouse are fixed, taken from the PO, not pickable),
// just the two things receiving actually changes — actual qty/price per
// existing line — plus the SAME mandatory invoice upload every receiving
// path in this app requires (inherited from receive_loose_parts via
// receive_purchase_order, 0051 — see actions.ts's own comment). Every line
// on the PO must be included (the RPC rejects a partial/duplicate set),
// so there's no "add/remove line" control here — only qty/price edits.
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
      line_id: l.id,
      part_id: l.part_id,
      ordered_qty: l.qty,
      ordered_unit_price_sar: l.unit_price_sar,
      received_qty: String(l.qty),
      received_unit_price_sar: String(l.unit_price_sar),
    }))
  );
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesValid = receiveLines.every((l) => {
    const q = Number(l.received_qty);
    const p = Number(l.received_unit_price_sar);
    return l.received_qty.trim() !== "" && q > 0 && l.received_unit_price_sar.trim() !== "" && p >= 0;
  });
  const canSubmit = linesValid && files.length > 0;

  const total = receiveLines.reduce(
    (s, l) => s + (Number(l.received_qty) || 0) * (Number(l.received_unit_price_sar) || 0),
    0
  );

  function updateLine(idx: number, patch: Partial<ReceiveLineState>) {
    setReceiveLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
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
    if (!linesValid) {
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

    const payload = receiveLines.map((l) => ({
      line_id: l.line_id,
      received_qty: Number(l.received_qty),
      received_unit_price_sar: Number(l.received_unit_price_sar),
    }));

    const formData = new FormData();
    formData.set("poId", po.id);
    formData.set("note", note.trim());
    formData.set("linesJson", JSON.stringify(payload));
    for (const file of files) formData.append("invoiceFiles", file);

    setSaving(true);
    setError(null);
    const res = await receivePurchaseOrder(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onReceived();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
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

          <Card className="!p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>{lang === "en" ? "Part" : "القطعة"}</TH>
                  <TH>{lang === "en" ? "Ordered qty" : "الكمية المطلوبة"}</TH>
                  <TH>{lang === "en" ? "Ordered unit price" : "سعر الوحدة المطلوب"}</TH>
                  <TH>{lang === "en" ? "Actual qty received" : "الكمية الفعلية"}</TH>
                  <TH>{lang === "en" ? "Actual unit price" : "سعر الوحدة الفعلي"}</TH>
                  <TH>{lang === "en" ? "Subtotal" : "المجموع الفرعي"}</TH>
                </tr>
              </thead>
              <tbody>
                {receiveLines.map((l, idx) => {
                  const part = partsById.get(l.part_id);
                  return (
                    <tr key={l.line_id}>
                      <TD>
                        <div className="font-mono text-[11px] muted">{part?.sku ?? ""}</div>
                        <div className="text-sm font-medium">
                          {part ? (lang === "ar" && part.name_ar ? part.name_ar : part.name) : "—"}
                        </div>
                      </TD>
                      <TD className="tabular muted">{l.ordered_qty}</TD>
                      <TD className="tabular muted">{formatSar(l.ordered_unit_price_sar)}</TD>
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
                      <TD className="tabular font-semibold">
                        {formatSar((Number(l.received_qty) || 0) * (Number(l.received_unit_price_sar) || 0))}
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
                    className="tabular font-bold text-brand-600 py-2.5 px-3 border-t text-sm"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    {formatSar(total)}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Card>

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
              <PackagePlus className="h-4 w-4" />
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Confirm receipt" : "تأكيد الاستلام"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// "Pending review" list — POs awaiting approval (preview's own Approvals
// tab list, trimmed to just this filter since this app has no separate
// tab). Table, same shape as POListModal (Open POs) — click a row to open
// the full PO detail, where Approve/Reject actually live.
export function ApprovalsListModal({
  lang,
  purchaseOrders,
  purchaseOrderApprovals,
  suppliers,
  onClose,
  onView,
}: {
  lang: "en" | "ar";
  purchaseOrders: PurchaseOrder[];
  purchaseOrderApprovals: PurchaseOrderApproval[];
  suppliers: Supplier[];
  onClose: () => void;
  onView: (po: PurchaseOrder) => void;
}) {
  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const pending = purchaseOrders
    .filter((o) => o.status === "pending_approval")
    .slice()
    .sort((a, b) => (a.request_date < b.request_date ? 1 : a.request_date > b.request_date ? -1 : 0));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold">
            {lang === "en" ? "Purchase Orders Pending Review" : "أوامر الشراء بانتظار المراجعة"}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {pending.length === 0 ? (
          <p className="muted text-sm py-10 text-center">
            {lang === "en" ? "Nothing pending review." : "لا يوجد ما ينتظر المراجعة."}
          </p>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>{lang === "en" ? "PO Number" : "رقم الأمر"}</TH>
                  <TH>{lang === "en" ? "Supplier" : "المورد"}</TH>
                  <TH>{lang === "en" ? "Received on" : "تاريخ الاستلام"}</TH>
                  <TH>{lang === "en" ? "Approved by" : "تم الاعتماد من"}</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {pending.map((po) => {
                  const supplier = suppliersById.get(po.supplier_id);
                  const count = purchaseOrderApprovals.filter((a) => a.purchase_order_id === po.id).length;
                  return (
                    <tr
                      key={po.id}
                      className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                      onClick={() => onView(po)}
                    >
                      <TD className="font-mono text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {po.po_number}
                          {po.ai_generated && <AiPill lang={lang} />}
                        </span>
                      </TD>
                      <TD>
                        <div className="text-sm font-medium">{supplier?.name ?? "—"}</div>
                      </TD>
                      <TD className="text-xs">{po.received_date ?? "—"}</TD>
                      <TD>
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: count >= 2 ? "rgba(16,185,129,.14)" : "rgba(245,158,11,.14)",
                            color: count >= 2 ? "#047857" : "#b45309",
                          }}
                        >
                          {count}/2
                        </span>
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

        <div className="mt-5 flex justify-end">
          <Btn variant="outline" onClick={onClose}>
            {lang === "en" ? "Close" : "إغلاق"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// Approve a PO — preview's openApprove (pages-2.js ~2928-2957), trimmed:
// preview has a persona picker ("Approve as") because it has no real auth;
// this app derives the approver from the authenticated session server-side
// (same substitution every other actor field in this feature already
// made), so there's nothing to pick here — just the running count and an
// optional comment. Eligibility (staff.role in the approver set) is
// checked by the RPC, not pre-filtered client-side (see actions.ts's own
// comment on why).
export function ApprovePOModal({
  lang,
  po,
  approvalCount,
  onClose,
  onApproved,
}: {
  lang: "en" | "ar";
  po: PurchaseOrder;
  approvalCount: number;
  onClose: () => void;
  onApproved: () => void;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await approvePurchaseOrder(po.id, comment.trim() || null);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onApproved();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "Approve" : "اعتماد"} — {po.po_number}
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-4">
            {lang === "en" ? "Minimum approvals required" : "الحد الأدنى من الاعتمادات"}: <b>2</b> ·{" "}
            {lang === "en" ? "Approved by" : "تم الاعتماد من"}: <b>{approvalCount}</b>
          </p>

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
              disabled={saving}
              className="h-9 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Approve" : "اعتماد"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Reject a PO — preview's openReject (pages-2.js ~2968-2986). Terminal;
// same warning copy preview uses about stock not auto-reversing (accurate
// here too — receiving already moved stock via receive_purchase_order,
// 0051, and rejecting doesn't undo it).
export function RejectPOModal({
  lang,
  po,
  onClose,
  onRejected,
}: {
  lang: "en" | "ar";
  po: PurchaseOrder;
  onClose: () => void;
  onRejected: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await rejectPurchaseOrder(po.id, reason.trim() || null);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onRejected();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-semibold">
              {lang === "en" ? "Reject" : "رفض"} — {po.po_number}
            </h2>
            <button type="button" onClick={close} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm muted mb-4">
            {lang === "en"
              ? "Rejection ends this PO. Stock changes from the receipt are not reversed automatically."
              : "الرفض ينهي هذا الأمر. التغييرات في المخزون لا تُعكس تلقائيًا."}
          </p>

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
              disabled={saving}
              className="h-9 px-3 rounded-lg text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-2"
              style={{ background: "#be123c" }}
            >
              <X className="h-4 w-4" />
              {saving ? (lang === "en" ? "Saving…" : "جارٍ الحفظ…") : lang === "en" ? "Reject" : "رفض"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Approvals TAB — preview's invApprovalsView (pages-2.js ~3277-3329),
// inline on the Inventory page's own "Approvals" tab (was previously only
// reachable via the ProcStrip's "Pending review" chip -> a modal; that
// modal still exists for quick access, this is the full tab preview has
// alongside it). Same queue (pending_approval POs, oldest received first),
// approval-dot progress + approver names, quick "Approve" action per row.
export function ApprovalsTab({
  lang,
  purchaseOrders,
  purchaseOrderApprovals,
  suppliers,
  onView,
  onApprove,
}: {
  lang: "en" | "ar";
  purchaseOrders: PurchaseOrder[];
  purchaseOrderApprovals: PurchaseOrderApproval[];
  suppliers: Supplier[];
  onView: (po: PurchaseOrder) => void;
  onApprove: (po: PurchaseOrder) => void;
}) {
  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const queue = purchaseOrders
    .filter((o) => o.status === "pending_approval")
    .slice()
    .sort((a, b) => {
      const ad = a.received_date ?? "";
      const bd = b.received_date ?? "";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
        <h3 className="font-semibold">{lang === "en" ? "Approvals Queue" : "قائمة الاعتمادات"}</h3>
        <p className="text-sm muted">
          {lang === "en" ? "Minimum approvals required" : "الحد الأدنى من الاعتمادات"}: <b>2</b>
        </p>
      </div>
      {queue.length === 0 ? (
        <p className="muted text-sm py-6 text-center">
          {lang === "en" ? "No POs awaiting approval." : "لا توجد أوامر بانتظار الاعتماد."}
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{lang === "en" ? "PO Number" : "رقم الأمر"}</TH>
              <TH>{lang === "en" ? "Supplier" : "المورد"}</TH>
              <TH>{lang === "en" ? "Received on" : "تاريخ الاستلام"}</TH>
              <TH>{lang === "en" ? "Approved by" : "تم الاعتماد من"}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {queue.map((po) => {
              const supplier = suppliersById.get(po.supplier_id);
              const approvals = purchaseOrderApprovals.filter((a) => a.purchase_order_id === po.id);
              return (
                <tr
                  key={po.id}
                  className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  onClick={() => onView(po)}
                >
                  <TD className="font-mono text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {po.po_number}
                      {po.ai_generated && <AiPill lang={lang} />}
                    </span>
                  </TD>
                  <TD>
                    <div className="text-sm">{supplier?.name ?? "—"}</div>
                  </TD>
                  <TD className="text-xs">{po.received_date ?? "—"}</TD>
                  <TD className="text-xs">
                    <div className="inline-flex items-center gap-1">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <span
                          key={i}
                          className="h-2 w-2 rounded-full inline-block"
                          style={{
                            background: i < approvals.length ? "#10b981" : "rgb(var(--border))",
                            boxShadow: i < approvals.length ? "0 0 0 1px rgba(16,185,129,.4)" : undefined,
                          }}
                        />
                      ))}
                      <span className="muted ms-1">{approvals.length}/2</span>
                    </div>
                    {approvals.length > 0 && (
                      <div className="text-[11px] muted">{approvals.map((a) => a.approver_email).join(", ")}</div>
                    )}
                  </TD>
                  <TD className="text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onApprove(po);
                      }}
                      className="h-7 px-2.5 rounded-md text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white inline-flex items-center gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {lang === "en" ? "Approve" : "اعتماد"}
                    </button>
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
// DELIBERATE DEVIATION FROM PREVIEW: preview's partFinance also reports
// consumption (spentByConsumption/totalConsumed, from a partUsage log tied
// to work orders) and an AI tip branch for "purchased but not consumed".
// This app has no consumption/usage workflow yet — stock_movements' own
// 'consume' movement_type exists in the CHECK constraint (0046) but nothing
// in this app's UI writes it (see db-types.ts's StockMovement comment). That
// stat and AI-tip branch are dropped rather than faked with data this app
// doesn't actually have; everything else here is real.
export function PartFinanceModal({
  lang,
  part,
  warehouses,
  priceLots,
  purchaseOrders,
  purchaseOrderLines,
  onClose,
  onViewPO,
}: {
  lang: "en" | "ar";
  part: Part;
  warehouses: Warehouse[];
  priceLots: PriceLot[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  onClose: () => void;
  onViewPO: (po: PurchaseOrder) => void;
}) {
  const warehouseName = warehouses.find((w) => w.id === part.warehouse_id)?.name ?? "—";

  const lots = useMemo(
    () =>
      priceLots
        .filter((l) => l.part_id === part.id)
        .sort((a, b) => (a.received_on !== b.received_on ? (a.received_on < b.received_on ? -1 : 1) : a.created_at < b.created_at ? -1 : 1)),
    [priceLots, part.id]
  );
  const currentPrice = lots.length > 0 ? lots[lots.length - 1].price_sar : part.unit_cost_sar;
  const priceTrendPct = useMemo(() => {
    if (lots.length < 2 || currentPrice == null) return 0;
    const hist = lots.slice(0, -1);
    const avgOld = hist.reduce((s, l) => s + l.price_sar, 0) / hist.length;
    if (avgOld <= 0) return 0;
    return Math.round(((currentPrice - avgOld) / avgOld) * 1000) / 10;
  }, [lots, currentPrice]);
  const stockValue = part.unit_cost_sar != null ? part.unit_cost_sar * part.qty_on_hand : 0;

  const allPurchases = useMemo(() => {
    return purchaseOrders
      .filter((po) => po.status === "approved" || po.status === "pending_approval")
      .flatMap((po) => {
        const line = purchaseOrderLines.find((l) => l.purchase_order_id === po.id && l.part_id === part.id);
        if (!line) return [];
        const qty = line.received_qty ?? line.qty;
        const unit = line.received_unit_price_sar ?? line.unit_price_sar;
        return [{ po, date: po.received_date ?? po.request_date, qty, unit, cost: qty * unit }];
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [purchaseOrders, purchaseOrderLines, part.id]);
  const totalPurchased = allPurchases.reduce((s, p) => s + p.cost, 0);
  const purchaseRows = allPurchases.slice(0, 8);

  const trendCls = priceTrendPct > 0 ? "text-rose-600 dark:text-rose-400" : priceTrendPct < 0 ? "text-emerald-700 dark:text-emerald-400" : "muted";
  const trendArrow = priceTrendPct > 0 ? "↑" : priceTrendPct < 0 ? "↓" : "→";

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
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-[720px] max-h-[85vh] overflow-y-auto scrollbar-thin"
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

        <div className="grid grid-cols-3 gap-3 text-sm my-4">
          <div className="rounded-lg border p-3" style={INPUT_STYLE}>
            <div className="text-[11px] muted uppercase">{lang === "en" ? "Purchases" : "المشتريات"}</div>
            <div className="text-lg font-semibold tabular-nums">{formatSar(totalPurchased)}</div>
            <div className="text-[11px] muted">
              {allPurchases.length} {lang === "en" ? "PO lines" : "بنود أوامر"}
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

        <div className="rounded-lg border p-3 mb-4" style={tipStyle}>
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
                  <TH>{lang === "en" ? "Cost" : "التكلفة"}</TH>
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
                  purchaseRows.map(({ po, date, qty, unit, cost }) => (
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
                      <TD className="tabular-nums font-medium">{formatSar(cost)}</TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
