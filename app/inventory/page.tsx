import { createClient } from "@/lib/supabase/server";
import type { Warehouse, Part, PriceLot, Supplier, Unit } from "@/lib/db-types";
import InventoryClient from "./InventoryClient";

// Slice 3 — full parts layer. Server component fetches both warehouses and
// parts (active=true only), client child renders + wires tab filtering,
// KPIs, and add/edit — same split as app/trips/page.tsx / app/fleet/page.tsx.
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();

  const [warehousesRes, partsRes, priceLotsRes, suppliersRes, unitsRes] = await Promise.all([
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
  ]);

  const warehouses = (warehousesRes.data ?? []) as Warehouse[];
  const parts = (partsRes.data ?? []) as Part[];
  const priceLots = (priceLotsRes.data ?? []) as PriceLot[];
  const suppliers = (suppliersRes.data ?? []) as Supplier[];
  const units = (unitsRes.data ?? []) as Unit[];
  const error =
    warehousesRes.error?.message ??
    partsRes.error?.message ??
    priceLotsRes.error?.message ??
    suppliersRes.error?.message ??
    unitsRes.error?.message ??
    null;

  return (
    <InventoryClient
      warehouses={warehouses}
      parts={parts}
      priceLots={priceLots}
      suppliers={suppliers}
      units={units}
      error={error}
    />
  );
}
