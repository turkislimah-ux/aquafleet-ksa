"use server";

// Inventory page — Slice 2 (warehouses layer). Same server-action pattern as
// app/trips/actions.ts's createWaterStation: validate -> insert -> revalidate.
// Single-table insert, no RPC (migration 0043's header: "NO RPCs in this
// migration"). Nothing hard-deletes — this file only ever inserts; deactivate/
// edit are later slices.

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
