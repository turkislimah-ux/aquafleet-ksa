"use server";

// Warehouse management. Lives outside any single app/ route dir, mirroring the
// lib/actions/operation-stations.ts precedent: warehouses are a shared LOOKUP
// concept (Inventory, purchase orders, stock receipts, exit permits all point
// at one), and the editor for them now lives in Settings, which is a dialog
// rendered by AppShell on every route rather than a page under app/.
//
// ==========================================================================
// createWarehouse MOVED HERE — IT WAS NOT REWRITTEN
// ==========================================================================
// It was app/inventory/actions.ts's createWarehouse, called by the Inventory
// page header's "Create Warehouse" button. That button is gone; creating a
// warehouse is a settings act, not an inventory act. The function itself is
// byte-for-byte what it was: same trim rules, same empty-string-to-null
// mapping, same select, same revalidatePath("/inventory"). Only its address
// changed, so there is exactly one create path and no second implementation to
// drift from the first.
//
// ==========================================================================
// `active` IS READ, NEVER WRITTEN, NEVER SHOWN
// ==========================================================================
// warehouses.active exists (0043) and every live row is true. Nothing in the
// Settings editor sets it and nothing displays it: there is no deactivate
// concept for warehouses, because the four dependent tables are all
// ON DELETE RESTRICT and that restriction IS the guard — see deleteWarehouse
// when it lands. The column stays in the select only because Warehouse (in
// lib/db-types.ts) declares it and narrowing the row type here would buy a
// promise the type system already can't break.
//
// listWarehouses does NOT filter on active, unlike app/inventory/page.tsx.
// That is deliberate: Settings is the place a row is administered, so it shows
// every row that exists rather than the subset one page chooses to render. No
// row is inactive today and no code path here can make one.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Warehouse } from "@/lib/db-types";

const COLUMNS = "id, name, location, type, note, active, created_at";

export type WarehouseInput = {
  name: string;
  location: string | null;
  type: string | null;
  note: string | null;
};

// Oldest first — the same ordering the Inventory page's warehouse tabs use, so
// the list in Settings reads in the order the user already knows.
export async function listWarehouses(): Promise<{
  error: string | null;
  warehouses: Warehouse[];
}> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message, warehouses: [] };
  return { error: null, warehouses: (data ?? []) as Warehouse[] };
}

// Returns the full inserted row (not just id). Kept from the original: a caller
// that needs to select the new warehouse immediately can, without waiting for a
// refetch.
export async function createWarehouse(
  input: WarehouseInput,
): Promise<{ error: string | null; warehouse?: Warehouse }> {
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
    .select(COLUMNS)
    .single();
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null, warehouse: data as Warehouse };
}
