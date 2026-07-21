import { createClient } from "@/lib/supabase/server";
import type { Warehouse, Part } from "@/lib/db-types";
import InventoryClient from "./InventoryClient";

// Slice 3 — full parts layer. Server component fetches both warehouses and
// parts (active=true only), client child renders + wires tab filtering,
// KPIs, and add/edit — same split as app/trips/page.tsx / app/fleet/page.tsx.
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();

  const [warehousesRes, partsRes] = await Promise.all([
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
  ]);

  const warehouses = (warehousesRes.data ?? []) as Warehouse[];
  const parts = (partsRes.data ?? []) as Part[];
  const error = warehousesRes.error?.message ?? partsRes.error?.message ?? null;

  return <InventoryClient warehouses={warehouses} parts={parts} error={error} />;
}
