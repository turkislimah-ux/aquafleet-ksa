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
// ON DELETE RESTRICT and that restriction IS the guard — see deleteWarehouse.
// The column stays in the select only because Warehouse (in
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

// THREE routes read warehouses, not one. app/inventory/page.tsx tabs by them,
// and app/consumption/page.tsx + app/maintenance/page.tsx both select
// "id, name" for their pickers — so a rename that only revalidated /inventory
// would leave the old name showing on two other pages. Same shape as
// operation-stations.ts's revalidateAll(), and for the same reason.
//
// createWarehouse revalidated /inventory alone when it moved here, because that
// commit was a relocation and changing behaviour mid-move would have hidden the
// change inside a diff that claimed to be a no-op. This is that fix, made on
// purpose: a newly created warehouse has to become pickable everywhere it can
// be picked, not just where it is tabbed.
function revalidateWarehouses() {
  revalidatePath("/inventory");
  revalidatePath("/consumption");
  revalidatePath("/maintenance");
}

// ==========================================================================
// THE FOUR TABLES THAT POINT AT A WAREHOUSE
// ==========================================================================
// Measured, not remembered: pg_constraint reports exactly four FKs onto
// warehouses — parts, stock_receipts, purchase_orders, exit_permits — every one
// of them ON DELETE RESTRICT (confdeltype = 'r') on a NOT NULL warehouse_id.
// That last detail matters: a dependent row can never be orphaned into a null,
// so "has no dependents" is the whole of "is safe to delete".
//
// The list is named ONCE because two things have to agree about what "in use"
// means — whether the Delete control appears, and what the failure says when a
// delete is refused. If a fifth table ever points here, adding it to this array
// is what makes both correct at the same time.
const DEPENDENT_TABLES = [
  "parts",
  "stock_receipts",
  "purchase_orders",
  "exit_permits",
] as const;

// One message for both refusal paths — the pre-check and the 23503 — because
// they are the same fact about the same row, and two wordings would read as two
// different problems.
const IN_USE =
  "Can't delete — this warehouse has stock or history. Its parts, receipts, purchase orders and exit permits have to be gone first.";

// EXISTENCE, NOT A COUNT. `limit(1)` stops at the first matching row; an exact
// count would walk every part in the warehouse to answer a yes/no question. All
// four tables carry a btree index on warehouse_id, so each probe is a lookup.
//
// FAILS CLOSED. If a probe errors we report "in use", which hides the Delete
// control rather than offering a destructive action on evidence we do not have.
async function isInUse(
  supabase: ReturnType<typeof createClient>,
  warehouseId: string,
): Promise<boolean> {
  const probes = await Promise.all(
    DEPENDENT_TABLES.map((table) =>
      supabase.from(table).select("id").eq("warehouse_id", warehouseId).limit(1),
    ),
  );
  return probes.some((p) => p.error !== null || (p.data?.length ?? 0) > 0);
}

// `deletable` is computed here rather than in the component because it is a
// fact about the database, not about the view: the four probes are the same
// reads deleteWarehouse repeats before it acts.
export type WarehouseRow = Warehouse & { deletable: boolean };

// Oldest first — the same ordering the Inventory page's warehouse tabs use, so
// the list in Settings reads in the order the user already knows.
export async function listWarehouses(): Promise<{
  error: string | null;
  warehouses: WarehouseRow[];
}> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message, warehouses: [] };

  const rows = (data ?? []) as Warehouse[];
  // Annotated in the same call that fetches the rows, so a row and its Delete
  // affordance always come from one moment. Fetching them separately would let
  // the button describe a state the list no longer shows.
  const inUse = await Promise.all(rows.map((w) => isInUse(supabase, w.id)));
  return {
    error: null,
    warehouses: rows.map((w, i) => ({ ...w, deletable: !inUse[i] })),
  };
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

  revalidateWarehouses();
  return { error: null, warehouse: data as Warehouse };
}

// Edit. Plain UPDATE — warehouses has no RPC and needs none: RLS already grants
// authenticated the write, and there is no cross-table invariant to hold. Same
// validation and same empty-string-to-null mapping as create, because a field
// cleared in the editor has to mean what a field left blank at creation means.
//
// THE SET LIST IS THE GUARANTEE. Exactly the four editable columns appear in
// it, so `active` cannot be written by this path even by accident — it is not
// "left alone by convention", it is absent. `id` and `created_at` likewise.
//
// Returns the updated row so the caller can render what the database actually
// stored rather than echoing back the draft it just sent.
export async function updateWarehouse(
  id: string,
  input: WarehouseInput,
): Promise<{ error: string | null; warehouse?: Warehouse }> {
  if (!id) return { error: "Missing warehouse." };
  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Warehouse name is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .update({
      name,
      location: input.location?.trim() || null,
      type: input.type?.trim() || null,
      note: input.note?.trim() || null,
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  // PGRST116 is "no rows returned" from .single() — here that means the row is
  // gone, not that the update was rejected. Postgres reports a matched-nothing
  // UPDATE as success, so without this the editor would show a raw PostgREST
  // code for the one situation a user can actually understand.
  if (error) {
    if (error.code === "PGRST116") return { error: "That warehouse no longer exists." };
    return { error: error.message };
  }

  revalidateWarehouses();
  return { error: null, warehouse: data as Warehouse };
}

// Delete. HARD, and deliberately so — see the header note on `active`. There is
// no soft-delete for a warehouse because there is nothing a hidden warehouse
// could mean: the row is only ever deletable when nothing references it, so
// there is no history to preserve by keeping it.
//
// ==========================================================================
// TWO GUARDS, AND THE SECOND ONE IS THE REAL ONE
// ==========================================================================
// The pre-check exists for the MESSAGE, not for the safety. Between reading the
// four tables and issuing the DELETE, another user can receive stock into this
// warehouse — no amount of checking first closes that window, because the check
// and the delete are not one transaction.
//
// What actually makes this safe is the schema: all four FKs are ON DELETE
// RESTRICT, so Postgres refuses the DELETE itself and raises 23503
// (foreign_key_violation). That is the guard. Catching 23503 turns a database
// error code into the same sentence the pre-check would have shown, so the race
// and the ordinary case are indistinguishable to whoever is looking at it.
//
// This is also why no RPC is needed. A guarded function would re-implement in
// plpgsql a rule the constraints already enforce, and could only get it wrong.
export async function deleteWarehouse(id: string): Promise<{ error: string | null }> {
  if (!id) return { error: "Missing warehouse." };

  const supabase = createClient();

  // Repeated server-side rather than trusting that the button was hidden: the
  // control's absence is a UI fact, and a server action is reachable without it.
  if (await isInUse(supabase, id)) return { error: IN_USE };

  // RETURNING the id distinguishes "deleted it" from "matched nothing".
  // Postgres reports a DELETE that hit zero rows as success, so without this a
  // second click on a stale list would report a removal that did not happen.
  const { data, error } = await supabase
    .from("warehouses")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23503") return { error: IN_USE };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "That warehouse no longer exists." };

  revalidateWarehouses();
  return { error: null };
}
