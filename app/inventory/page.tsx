import { createClient } from "@/lib/supabase/server";
import type { Warehouse } from "@/lib/db-types";
import InventoryClient from "./InventoryClient";

// Slice 2 — data-backed shell (warehouses only; parts/KPIs are placeholders
// until later slices). Server component fetches, client child renders +
// wires the "Create Warehouse" flow — same split as app/trips/page.tsx /
// app/fleet/page.tsx.
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("warehouses")
    .select("id, name, location, type, note, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });

  const warehouses = (data ?? []) as Warehouse[];

  return <InventoryClient warehouses={warehouses} error={error ? error.message : null} />;
}
