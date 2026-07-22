"use server";

// Inventory page — Slice 2 (warehouses layer) + Slice 3 (parts layer) + Slice
// 4 (stock movements) + full-demo Phase 1 (suppliers entity, migration 0045,
// LIVE) + Phase 2 (FIFO price lots, migration 0046, LIVE). Warehouse/part/
// supplier creation follow the plain-table server-action pattern from
// app/trips/actions.ts's createWaterStation: validate -> insert -> revalidate
// (0043/0045 have no RPCs). No updatePart — preview/ has no part-edit UI, so
// this file doesn't invent one; parts change only via receiveStock/
// adjustStock/addPriceLot below. Those three DO call RPCs (migration 0044's
// receive_stock/adjust_stock + 0046's add_price_lot, all LIVE and applied).
// Nothing hard-deletes — deactivate is a later slice.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { PriceLot, StockMovement, Supplier } from "@/lib/db-types";

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
// Suppliers (full-demo build-out, Phase 1 — migration 0045, LIVE)
//
// No standalone suppliers page/list at this phase — mirrors preview/, which
// never has one either. This is reusable infrastructure: an inline "New
// supplier" modal + this action, both consumed later by Phase 3 (Add Parts/
// receive) and Phase 4 (Purchase Orders) supplier pickers. Not independently
// user-testable end-to-end until one of those wires a trigger to it.
// ---------------------------------------------------------------------------

export type SupplierInput = {
  name: string;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
};

// Case-insensitive dedupe — mirrors preview/'s addSupplier(), which returns
// the existing record instead of creating a duplicate when the trimmed name
// already matches (case-insensitively) an existing supplier.
export async function createSupplier(
  input: SupplierInput,
): Promise<{ error: string | null; supplier?: Supplier }> {
  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Supplier name is required." };

  const supabase = createClient();

  const { data: existing, error: lookupError } = await supabase
    .from("suppliers")
    .select("id, name, phone, email, contact_person, active, created_at")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (existing) return { error: null, supplier: existing as Supplier };

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      contact_person: input.contact_person?.trim() || null,
    })
    .select("id, name, phone, email, contact_person, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null, supplier: data as Supplier };
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

// ---------------------------------------------------------------------------
// Stock movements (Slice 4 — migration 0044, LIVE). These two wrap
// receive_stock()/adjust_stock() — qty_on_hand is never edited directly once
// a part exists (see AddPartModal — qty starts at 0, create-only); every
// post-creation change goes through one of these two RPCs so stock_movements
// stays a complete, gap-free audit ledger.
//
// "Who acted" — same convention as unpay_invoice (app/trips/invoiceActions.ts)
// and customer_topups.entered_by (lib/actions/finance.ts): the authenticated
// user's email, read server-side, never a UI text field.
// ---------------------------------------------------------------------------

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

export async function receiveStock(
  partId: string,
  qty: number,
  note: string | null,
): Promise<{ error: string | null }> {
  if (!partId) return { error: "Missing part." };
  if (!(qty > 0)) return { error: "Received quantity must be positive." };

  const supabase = createClient();
  const { error } = await supabase.rpc("receive_stock", {
    p_part_id: partId,
    p_qty: qty,
    p_note: note?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null };
}

export async function adjustStock(
  partId: string,
  newQty: number,
  note: string,
): Promise<{ error: string | null }> {
  if (!partId) return { error: "Missing part." };
  if (newQty == null || newQty < 0) return { error: "New quantity cannot be negative." };
  if (!note?.trim()) return { error: "Adjustment requires a note explaining the reason." };

  const supabase = createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_part_id: partId,
    p_new_qty: newQty,
    p_note: note.trim(),
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null };
}

export async function getPartMovements(
  partId: string,
): Promise<{ error: string | null; movements: StockMovement[] }> {
  if (!partId) return { error: "Missing part.", movements: [] };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, part_id, movement_type, qty_delta, qty_after, note, created_by, created_at")
    .eq("part_id", partId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message, movements: [] };

  return { error: null, movements: (data ?? []) as StockMovement[] };
}

// ---------------------------------------------------------------------------
// Price lots (Phase 2 — migration 0046, LIVE). FIFO cost ledger, preview/'s
// priceTiers/openPriceLot. add_price_lot is the ONLY writer — mirrors
// receiveStock/adjustStock above, never a plain insert into price_lots or a
// direct update of parts.qty_on_hand/unit_cost_sar. consume_from_lots (also
// in 0046) has no caller here — nothing in this app consumes parts yet
// (that's PO-receiving/work-order phases); it lights up when one of those
// lands.
// ---------------------------------------------------------------------------

export async function getPriceLots(
  partId: string,
): Promise<{ error: string | null; lots: PriceLot[] }> {
  if (!partId) return { error: "Missing part.", lots: [] };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_lots")
    .select("id, part_id, price_sar, qty_purchased, qty_remaining, received_on, note, created_at")
    .eq("part_id", partId)
    .order("received_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { error: error.message, lots: [] };

  return { error: null, lots: (data ?? []) as PriceLot[] };
}

export async function addPriceLot(
  partId: string,
  price: number,
  qty: number,
  receivedOn: string | null,
  note: string | null,
): Promise<{ error: string | null }> {
  if (!partId) return { error: "Missing part." };
  if (!(qty > 0)) return { error: "Incoming quantity must be positive." };
  if (price == null || price <= 0) return { error: "Price must be positive." };

  const supabase = createClient();
  const { error } = await supabase.rpc("add_price_lot", {
    p_part_id: partId,
    p_price: price,
    p_qty: qty,
    p_received_on: receivedOn || undefined,
    p_note: note?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null };
}
