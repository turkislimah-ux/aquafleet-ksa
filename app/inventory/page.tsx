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
} from "@/lib/db-types";
import InventoryClient from "./InventoryClient";

// Slice 3 — full parts layer. Server component fetches both warehouses and
// parts (active=true only), client child renders + wires tab filtering,
// KPIs, and add/edit — same split as app/trips/page.tsx / app/fleet/page.tsx.
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();

  const [
    warehousesRes,
    partsRes,
    priceLotsRes,
    suppliersRes,
    unitsRes,
    purchaseOrdersRes,
    purchaseOrderLinesRes,
    purchaseOrderApprovalsRes,
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
        "id, po_number, supplier_id, warehouse_id, status, request_date, expected_delivery, note, requested_by, issued_at, received_by, received_date, rejected_by, rejected_at, rejection_reason, ai_generated, ai_rationale, ai_rationale_ar, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_order_lines")
      .select(
        "id, purchase_order_id, part_id, qty, unit_price_sar, received_qty, received_unit_price_sar, created_at"
      ),
    supabase
      .from("purchase_order_approvals")
      .select("id, purchase_order_id, approver_email, comment, approved_at")
      .order("approved_at", { ascending: true }),
  ]);

  const warehouses = (warehousesRes.data ?? []) as Warehouse[];
  const parts = (partsRes.data ?? []) as Part[];
  const priceLots = (priceLotsRes.data ?? []) as PriceLot[];
  const suppliers = (suppliersRes.data ?? []) as Supplier[];
  const units = (unitsRes.data ?? []) as Unit[];
  const purchaseOrders = (purchaseOrdersRes.data ?? []) as PurchaseOrder[];
  const purchaseOrderLines = (purchaseOrderLinesRes.data ?? []) as PurchaseOrderLine[];
  const purchaseOrderApprovals = (purchaseOrderApprovalsRes.data ?? []) as PurchaseOrderApproval[];
  const error =
    warehousesRes.error?.message ??
    partsRes.error?.message ??
    priceLotsRes.error?.message ??
    suppliersRes.error?.message ??
    unitsRes.error?.message ??
    purchaseOrdersRes.error?.message ??
    purchaseOrderLinesRes.error?.message ??
    purchaseOrderApprovalsRes.error?.message ??
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
      error={error}
    />
  );
}
