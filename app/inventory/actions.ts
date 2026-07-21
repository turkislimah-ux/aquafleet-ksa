"use server";

// Inventory page — Slice 2 (warehouses layer) + Slice 3 (parts layer). Same
// server-action pattern as app/trips/actions.ts's createWaterStation:
// validate -> insert/update -> revalidate. Single-table writes, no RPC
// (migration 0043's header: "NO RPCs in this migration"). Nothing
// hard-deletes — deactivate is a later slice.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type WarehouseInput = {
  name: string;
  location: string | null;
  type: string | null;
  note: string | null;
};

export async function createWarehouse(
  input: WarehouseInput,
): Promise<{ error: string | null; id?: string }> {
  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Warehouse name is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .insert({
      name,
      location: input.location?.trim() || null,
      type: input.type?.trim() || null,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null, id: data?.id };
}

// ---------------------------------------------------------------------------
// Parts (Slice 3)
// ---------------------------------------------------------------------------

export type PartInput = {
  sku: string;
  name: string;
  name_ar: string | null;
  category: string | null;
  unit: string | null;
  unit_cost_sar: number | null;
  qty_on_hand: number;
  reorder_level: number | null;
  reorder_qty: number | null;
  lead_time_days: number | null;
  supplier: string | null;
  warehouse_id: string;
};

// Shared validation — both create and update funnel through this so the two
// never drift on what "valid" means.
function validatePart(input: PartInput): string | null {
  if (!input.sku?.trim()) return "SKU is required.";
  if (!input.name?.trim()) return "Part name is required.";
  if (!input.warehouse_id) return "Warehouse is required.";
  const numericFields: [string, number | null][] = [
    ["Unit cost", input.unit_cost_sar],
    ["Qty on hand", input.qty_on_hand],
    ["Reorder level", input.reorder_level],
    ["Reorder qty", input.reorder_qty],
    ["Lead time (days)", input.lead_time_days],
  ];
  for (const [label, value] of numericFields) {
    if (value != null && value < 0) return `${label} can't be negative.`;
  }
  return null;
}

function partFields(input: PartInput) {
  return {
    sku: input.sku.trim(),
    name: input.name.trim(),
    name_ar: input.name_ar?.trim() || null,
    category: input.category?.trim() || null,
    unit: input.unit?.trim() || null,
    unit_cost_sar: input.unit_cost_sar,
    qty_on_hand: input.qty_on_hand ?? 0,
    reorder_level: input.reorder_level,
    reorder_qty: input.reorder_qty,
    lead_time_days: input.lead_time_days,
    supplier: input.supplier?.trim() || null,
    warehouse_id: input.warehouse_id,
  };
}

// Postgres unique_violation — parts.sku has a unique constraint (0043).
// Surfaced as a clean message instead of the raw constraint-name error.
function friendlyError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "SKU already exists.";
  return error.message;
}

export async function createPart(
  input: PartInput,
): Promise<{ error: string | null; id?: string }> {
  const validationError = validatePart(input);
  if (validationError) return { error: validationError };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("parts")
    .insert(partFields(input))
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };

  revalidatePath("/inventory");
  return { error: null, id: data?.id };
}

export async function updatePart(
  id: string,
  input: PartInput,
): Promise<{ error: string | null }> {
  if (!id) return { error: "Missing part." };
  const validationError = validatePart(input);
  if (validationError) return { error: validationError };

  const supabase = createClient();
  const { error } = await supabase.from("parts").update(partFields(input)).eq("id", id);
  if (error) return { error: friendlyError(error) };

  revalidatePath("/inventory");
  return { error: null };
}
