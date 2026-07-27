import { createClient } from "@/lib/supabase/server";
import type {
  Warehouse,
  Part,
  PriceLot,
  Supplier,
  Unit,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderApproval,
  StockReceipt,
  StockReceiptApproval,
  StockReceiptLine,
} from "@/lib/db-types";
import InventoryClient from "./InventoryClient";

// Slice 3 — full parts layer. Server component fetches both warehouses and
// parts (active=true only), client child renders + wires tab filtering,
// KPIs, and add/edit — same split as app/trips/page.tsx / app/fleet/page.tsx.
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();

  // Current session email — used client-side to show "your current vote"
  // context inside ApproveReceiptModal/RejectReceiptModal (Stage B vote
  // model, migration 0058) rather than preview's own dead-end "you already
  // signed off" message — under the vote model a sole voter can freely
  // change their own vote, so the form always stays active for them; this
  // is display-only, the real enforcement stays server-side inside
  // approve_stock_receipt()/reject_stock_receipt().
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserEmail = user?.email ?? null;

  const [
    warehousesRes,
    partsRes,
    priceLotsRes,
    suppliersRes,
    unitsRes,
    purchaseOrdersRes,
    purchaseOrderLinesRes,
    purchaseOrderApprovalsRes,
    stockReceiptsRes,
    stockReceiptApprovalsRes,
    stockReceiptLinesRes,
  ] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name, location, type, note, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("parts")
      .select(
        "id, sku, name, name_ar, category, unit, unit_cost_sar, qty_on_hand, reorder_level, reorder_qty, lead_time_days, supplier, warehouse_id, active, created_at"
      )
      .eq("active", true)
      .order("created_at", { ascending: true }),
    // Bulk price-lot read (display only — same rows the drawer's
    // getPriceLots() reads per-part) so the parts TABLE can show a
    // current-vs-previous price trend arrow per row, matching preview's
    // Inventory table, without an RPC/N+1 fetch per row.
    supabase
      .from("price_lots")
      .select("id, part_id, price_sar, qty_purchased, qty_remaining, received_on, note, created_at")
      .order("part_id", { ascending: true })
      .order("received_on", { ascending: true })
      .order("created_at", { ascending: true }),
    // Full-demo Phase 3 (migration 0047) — the Add Parts/receive modal's
    // supplier picker needs the structured suppliers list, not just the
    // free-text parts.supplier snapshot.
    supabase
      .from("suppliers")
      .select("id, name, name_ar, phone, email, contact_person, active, created_at")
      .eq("active", true)
      .order("name", { ascending: true }),
    // Units-of-measure lookup (migration 0049) — the New Item unit picker
    // reads from here instead of a hardcoded list; parts.unit still stores
    // the CODE as free text (soft reference, same as parts.supplier).
    supabase
      .from("units")
      .select("id, code, label_en, label_ar, active, created_at")
      .eq("active", true)
      .order("code", { ascending: true }),
    // Full-demo Phases 4-6 (migrations 0050/0051/0052) — Purchase Orders
    // core + receiving + approvals. Bulk read (display only — same "fetch
    // everything, derive client-side" pattern price_lots above already
    // uses) so the proc-strip chips / PO list / detail can all compute
    // counts and totals without an extra round-trip per PO. No stored
    // total column exists to select — every total is derived from
    // purchaseOrderLines at render.
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, supplier_id, warehouse_id, status, request_date, expected_delivery, note, requested_by, issued_at, received_by, received_date, rejected_by, rejected_at, rejection_reason, ai_generated, ai_rationale, ai_rationale_ar, created_at, subtotal_sar, vat_sar, total_sar, received_subtotal_sar, received_vat_sar, received_total_sar"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_order_lines")
      .select(
        "id, purchase_order_id, part_id, qty, unit_price_sar, received_qty, received_unit_price_sar, created_at, line_vat_sar, received_line_vat_sar"
      ),
    supabase
      .from("purchase_order_approvals")
      .select("id, purchase_order_id, approver_email, comment, approved_at")
      .order("approved_at", { ascending: true }),
    // Stage B (migration 0057) — every receipt is its own approvable
    // invoice now (Direct or PO-linked). Bulk read, same "fetch
    // everything, derive client-side" pattern as purchaseOrders/
    // priceLots above.
    supabase
      .from("stock_receipts")
      .select(
        "id, supplier_id, warehouse_id, po_id, received_on, received_by, note, total_cost_sar, created_at, vat_sar, grand_total_sar, status, receipt_type, rejected_by, rejected_at, rejection_reason, rejection_mode"
      )
      .order("created_at", { ascending: false }),
    // Stage B revision (migration 0058) — action/outcome added, vote model.
    supabase
      .from("stock_receipt_approvals")
      .select("id, stock_receipt_id, approver_email, comment, approved_at, action, outcome")
      .order("approved_at", { ascending: true }),
    // Direct-receipt detail popup (this pass) needs line items — same
    // "fetch everything, derive client-side" pattern as purchaseOrderLines.
    supabase
      .from("stock_receipt_lines")
      .select("id, receipt_id, part_id, price_lot_id, qty, unit_price_sar, created_at, line_vat_sar"),
  ]);

  const warehouses = (warehousesRes.data ?? []) as Warehouse[];
  const parts = (partsRes.data ?? []) as Part[];
  const priceLots = (priceLotsRes.data ?? []) as PriceLot[];
  const suppliers = (suppliersRes.data ?? []) as Supplier[];
  const units = (unitsRes.data ?? []) as Unit[];
  const purchaseOrders = (purchaseOrdersRes.data ?? []) as PurchaseOrder[];
  const purchaseOrderLines = (purchaseOrderLinesRes.data ?? []) as PurchaseOrderLine[];
  const purchaseOrderApprovals = (purchaseOrderApprovalsRes.data ?? []) as PurchaseOrderApproval[];
  const stockReceipts = (stockReceiptsRes.data ?? []) as StockReceipt[];
  const stockReceiptApprovals = (stockReceiptApprovalsRes.data ?? []) as StockReceiptApproval[];
  const stockReceiptLines = (stockReceiptLinesRes.data ?? []) as StockReceiptLine[];
  const error =
    warehousesRes.error?.message ??
    partsRes.error?.message ??
    priceLotsRes.error?.message ??
    suppliersRes.error?.message ??
    unitsRes.error?.message ??
    purchaseOrdersRes.error?.message ??
    purchaseOrderLinesRes.error?.message ??
    purchaseOrderApprovalsRes.error?.message ??
    stockReceiptsRes.error?.message ??
    stockReceiptApprovalsRes.error?.message ??
    stockReceiptLinesRes.error?.message ??
    null;

  return (
    <InventoryClient
      warehouses={warehouses}
      parts={parts}
      priceLots={priceLots}
      suppliers={suppliers}
      units={units}
      purchaseOrders={purchaseOrders}
      purchaseOrderLines={purchaseOrderLines}
      purchaseOrderApprovals={purchaseOrderApprovals}
      stockReceipts={stockReceipts}
      stockReceiptApprovals={stockReceiptApprovals}
      stockReceiptLines={stockReceiptLines}
      currentUserEmail={currentUserEmail}
      error={error}
    />
  );
}
