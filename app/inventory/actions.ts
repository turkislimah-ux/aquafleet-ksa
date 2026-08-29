"use server";

// Inventory page — Slice 2 (warehouses layer) + Slice 3 (parts layer) + Slice
// 4 (stock movements) + full-demo Phase 1 (suppliers entity, migration 0045,
// LIVE) + Phase 2 (FIFO price lots, migration 0046, LIVE). Warehouse/part/
// supplier creation follow the plain-table server-action pattern from
// app/trips/actions.ts's createWaterStation: validate -> insert -> revalidate
// (0043/0045 have no RPCs). No updatePart — preview/ has no part-edit UI, so
// this file doesn't invent one; parts change only via adjustStock (below,
// migration 0044's adjust_stock RPC) or the receiving flows further down
// (receiveLooseParts/receivePurchaseOrder), which call add_price_lot (0046)
// internally. Nothing hard-deletes — deactivate is a later slice.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type {
  Part,
  PriceLot,
  PurchaseOrder,
  StockMovement,
  StockReceipt,
  Supplier,
  Unit,
} from "@/lib/db-types";
// VAT (migration 0056) — updatePurchaseOrder (below) is the one PO mutation
// NOT backed by an RPC (flagged exception, see its own header), so it must
// mirror create_purchase_order's VAT math here in TypeScript rather than
// getting it "for free" server-side. Same per-line-then-summed rule, same
// borrowed-rate-only file every other VAT display in this feature uses —
// never lib/vat.ts (see lib/inventory-vat.ts's own header for why).
import { lineVat, calculateInventoryVatDocument } from "@/lib/inventory-vat";

// WAREHOUSE CREATION MOVED OUT — see lib/actions/warehouses.ts.
// createWarehouse and WarehouseInput used to open this file. A warehouse is now
// created (and, from here on, edited) in Settings rather than from the
// Inventory page header, so the action moved to the shared lib/actions/ home
// that operation-stations.ts already uses for exactly this reason: a lookup
// row that several surfaces read and one settings surface owns. It was MOVED,
// not copied — there is no createWarehouse here any more.
//
// The Inventory page still READS warehouses (app/inventory/page.tsx) and still
// tabs by them. Only the write path left.

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
  name_ar: string | null; // migration 0048, LIVE
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
    .select("id, name, name_ar, phone, email, contact_person, active, created_at")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (existing) return { error: null, supplier: existing as Supplier };

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name,
      name_ar: input.name_ar?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      contact_person: input.contact_person?.trim() || null,
    })
    .select("id, name, name_ar, phone, email, contact_person, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null, supplier: data as Supplier };
}

// ---------------------------------------------------------------------------
// Units of measure (migration 0049, LIVE) — lookup table, mirrors suppliers'
// role for parts.unit: `code` is what parts.unit stores (soft reference,
// no FK — see 0049's header). The New Item unit picker inline "add unit"
// affordance is the only writer here for now.
// ---------------------------------------------------------------------------

export type UnitInput = {
  code: string;
  label_en: string;
  label_ar: string | null;
};

export async function createUnit(
  input: UnitInput,
): Promise<{ error: string | null; unit?: Unit }> {
  const code = input.code?.trim() ?? "";
  const labelEn = input.label_en?.trim() ?? "";
  if (!code) return { error: "Unit code is required." };
  if (!labelEn) return { error: "English label is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("units")
    .insert({
      code,
      label_en: labelEn,
      label_ar: input.label_ar?.trim() || null,
    })
    .select("id, code, label_en, label_ar, active, created_at")
    .single();
  if (error) {
    // units.code has a unique constraint (0049) — surfaced as a clean
    // message instead of the raw constraint-name error.
    if (error.code === "23505") return { error: "Unit code already exists." };
    return { error: error.message };
  }

  revalidatePath("/inventory");
  return { error: null, unit: data as Unit };
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

// Returns the full inserted row (not just id) — the "New Item" flow inside
// ReceivePartsModal (Add Parts) needs the fresh part's fields immediately, to
// merge it into the in-progress receive draft as a line, without waiting on
// a server round-trip/page refresh. Same reasoning as createSupplier above.
export async function createPart(
  input: PartInput,
): Promise<{ error: string | null; part?: Part }> {
  const validationError = validatePart(input);
  if (validationError) return { error: validationError };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("parts")
    .insert(partFields(input))
    .select(
      "id, sku, name, name_ar, category, unit, unit_cost_sar, qty_on_hand, reorder_level, reorder_qty, lead_time_days, supplier, warehouse_id, active, created_at"
    )
    .single();
  if (error) return { error: friendlyError(error) };

  revalidatePath("/inventory");
  return { error: null, part: data as Part };
}

// Item 7 (polish round) — "Adjust Item": edit an EXISTING part's
// descriptive info. Deliberately NOT `PartInput` — a distinct type missing
// sku/qty_on_hand/warehouse_id entirely, so it's impossible even at the
// type level to pass them through this path, and the update payload below
// never includes those 3 keys either (belt-and-suspenders, not just a type
// guard). GUARDRAIL (Turki's explicit wording): qty_on_hand only ever
// moves through adjust_stock()/receive_loose_parts()/receive_purchase_order,
// never this form — sku is locked (identity, globally unique, 0043).
// warehouse_id is excluded too, on the same reasoning as sku: every
// purchase_order_lines/price_lots row already assumes a part's warehouse
// is stable (0050's one-SKU-one-warehouse guard) — letting it move here
// would retroactively invalidate that assumption for any PO/lot already
// tied to this part. No RPC — a plain, single-table update, same "not a
// data-integrity risk, no RPC needed" reasoning updatePurchaseOrder
// already established for editing a draft PO (Stage 3, item 6).
export type PartUpdateInput = Omit<PartInput, "sku" | "qty_on_hand" | "warehouse_id">;

function validatePartUpdate(input: PartUpdateInput): string | null {
  if (!input.name?.trim()) return "Part name is required.";
  const numericFields: [string, number | null][] = [
    ["Unit cost", input.unit_cost_sar],
    ["Reorder level", input.reorder_level],
    ["Reorder qty", input.reorder_qty],
    ["Lead time (days)", input.lead_time_days],
  ];
  for (const [label, value] of numericFields) {
    if (value != null && value < 0) return `${label} can't be negative.`;
  }
  return null;
}

export async function updatePart(
  partId: string,
  input: PartUpdateInput,
): Promise<{ error: string | null; part?: Part }> {
  if (!partId) return { error: "Missing part." };
  const validationError = validatePartUpdate(input);
  if (validationError) return { error: validationError };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("parts")
    .update({
      name: input.name.trim(),
      name_ar: input.name_ar?.trim() || null,
      category: input.category?.trim() || null,
      unit: input.unit?.trim() || null,
      unit_cost_sar: input.unit_cost_sar,
      reorder_level: input.reorder_level,
      reorder_qty: input.reorder_qty,
      lead_time_days: input.lead_time_days,
      supplier: input.supplier?.trim() || null,
    })
    .eq("id", partId)
    .select(
      "id, sku, name, name_ar, category, unit, unit_cost_sar, qty_on_hand, reorder_level, reorder_qty, lead_time_days, supplier, warehouse_id, active, created_at"
    )
    .single();
  if (error) return { error: friendlyError(error) };

  revalidatePath("/inventory");
  return { error: null, part: data as Part };
}

// ---------------------------------------------------------------------------
// Stock movements (Slice 4 — migration 0044, LIVE). qty_on_hand is never
// edited directly once a part exists (see AddPartModal — qty starts at 0,
// create-only); every post-creation change goes through adjust_stock() or
// receive_loose_parts() (below) so stock_movements stays a complete,
// gap-free audit ledger.
//
// Note: the single-part receive_stock() RPC (0044, LIVE) has no app-code
// caller anymore — the app-code wrapper that called it (receiveStock()) was
// dead code left behind when ReceiveStockModal was replaced end-to-end by
// the loose "Add Parts" flow (receiveLooseParts()/receive_loose_parts(),
// below); removed here. The RPC itself is untouched in the DB — same
// "flagged, not dropped" treatment as consume_from_lots (0046) — only the
// unreferenced app-code wrapper is gone.
//
// "Who acted" — same convention as unpay_invoice (app/trips/invoiceActions.ts)
// and customer_topups.entered_by (lib/actions/finance.ts): the authenticated
// user's email, read server-side, never a UI text field.
// ---------------------------------------------------------------------------

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
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

// addPriceLot() — the standalone single-part "Add new price" quick-action
// wrapper (called add_price_lot RPC directly) — was REMOVED here (Turki's
// post-e9a03d5 test feedback, test 6): it let a user add stock to a part
// with no invoice, no stock_receipts row, and no warehouse-consistency
// check, running in parallel to the real receiving flow below that DOES
// all three — two different ways to "add stock to a part" was the exact
// contradiction Turki flagged. ViewPartModal's "Add new price" button (was
// InventoryClient.tsx) now opens ReceivePartsModal prefilled with this part
// as a line instead (qty defaulted to clear reorder_level, price defaulted
// to the part's current price) — same RPC path as every other receipt,
// just pre-seeded. The add_price_lot() RPC itself stays live in the DB —
// receive_loose_parts/receive_purchase_order still call it once per line
// server-side; only this app-code wrapper and its one caller are gone.

// ---------------------------------------------------------------------------
// Loose "Add Parts" receive (full-demo Phase 3 — migration 0047, LIVE).
// Wraps receive_loose_parts(), preview/'s INV.confirmReceipt manual-mode
// path (no PO — Purchase Orders are a separate, later phase). Invoice
// file(s) are uploaded to the private stock-receipt-invoices bucket FIRST,
// using an app-generated key (never the raw filename — same convention as
// topup-proofs, lib/actions/finance.ts's recordTopup), because the RPC's
// p_files contract expects already-uploaded {storage_path, file_name,
// mime_type} pointers, not raw files. Grouped by warehouseId (an
// already-known real entity id at upload time) rather than a receipt id,
// since the receipt row doesn't exist until the RPC call returns.
//
// This is the ONLY app-code path that reaches receive_loose_parts — nothing
// here inserts into price_lots/parts/stock_receipts* directly; the RPC
// calls add_price_lot() (0046) once per line — now the ONLY caller of that
// RPC from this app's code (see the removed addPriceLot() note above).
// ---------------------------------------------------------------------------

const INVOICE_BUCKET = "stock-receipt-invoices";

export type ReceiveLine = { part_id: string; qty: number; unit_price_sar: number };

export async function receiveLooseParts(
  formData: FormData,
): Promise<{ error: string | null; id?: string }> {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const warehouseId = String(formData.get("warehouseId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const linesRaw = String(formData.get("linesJson") ?? "");
  const files = formData.getAll("invoiceFiles").filter((f): f is File => f instanceof File && f.size > 0);

  if (!supplierId) return { error: "Supplier is required." };
  if (!warehouseId) return { error: "Warehouse is required." };

  let lines: ReceiveLine[];
  try {
    lines = JSON.parse(linesRaw);
  } catch {
    return { error: "Invalid line items." };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: "At least one line item is required." };
  }
  for (const l of lines) {
    if (!l?.part_id) return { error: "Line item is missing a part." };
    if (!(l.qty > 0)) return { error: "Line item quantity must be positive." };
    if (l.unit_price_sar == null || l.unit_price_sar < 0) {
      return { error: "Line item price cannot be negative." };
    }
  }
  if (files.length === 0) return { error: "At least one invoice file is required." };

  const supabase = createClient();

  const uploaded: { storage_path: string; file_name: string; mime_type: string | null }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    const path = `${warehouseId}/receipt-${Date.now()}-${i}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadErr) {
      if (uploaded.length > 0) {
        await supabase.storage.from(INVOICE_BUCKET).remove(uploaded.map((u) => u.storage_path));
      }
      return { error: `Invoice upload failed: ${uploadErr.message}` };
    }
    uploaded.push({ storage_path: path, file_name: file.name, mime_type: file.type || null });
  }

  const { data, error } = await supabase.rpc("receive_loose_parts", {
    p_supplier_id: supplierId,
    p_warehouse_id: warehouseId,
    p_lines: lines,
    p_files: uploaded,
    p_note: note,
    p_actor: await actorEmail(supabase),
  });
  if (error) {
    // Best-effort cleanup — avoid orphaned storage objects for a receipt
    // that never landed. Ignore cleanup failures; the upload error below is
    // the one the user needs to see.
    await supabase.storage.from(INVOICE_BUCKET).remove(uploaded.map((u) => u.storage_path));
    return { error: error.message };
  }

  revalidatePath("/inventory");
  return { error: null, id: (data as { id?: string } | null)?.id };
}

// ---------------------------------------------------------------------------
// Purchase Orders (full-demo Phase 4 — migration 0050, LIVE). Wraps
// create_purchase_order()/issue_purchase_order() — draft->issued ONLY
// (receiving is Phase 5, approvals Phase 6, neither built here). Both RPCs
// are the ONLY writers to purchase_orders/purchase_order_lines; this file
// never inserts into either table directly. Neither RPC touches
// price_lots/parts.qty_on_hand/stock_movements — issuing a PO is a paper
// commitment, not a receiving event. No total is stored anywhere — the UI
// derives it from summing lines' qty*unit_price_sar at render.
// ---------------------------------------------------------------------------

export type PurchaseOrderLineInput = { part_id: string; qty: number; unit_price_sar: number };

export type CreatePurchaseOrderInput = {
  supplier_id: string;
  warehouse_id: string;
  lines: PurchaseOrderLineInput[];
  expected_delivery: string | null;
  note: string | null;
  // migration 0053 — set only when this draft came from "AI-Suggest"
  // (NewPOModal's aiSuggestion prop). Omitted/false on every ordinary draft.
  ai_generated?: boolean;
  ai_rationale?: string | null;
  ai_rationale_ar?: string | null;
};

// The RPC's own warehouse/part consistency guard (0050) raises with the
// mismatched part's raw uuid in the message — fine for a Postgres log, not
// something to show a non-technical user. The UI is expected to prevent
// this proactively (the "pick a part" dropdown is filtered to the PO's own
// warehouse — see NewPOModal), so this is a defense-in-depth fallback for
// the rare case a line goes stale (e.g. warehouse switched after adding
// lines) and slips through to the RPC anyway.
function friendlyPoError(message: string): string {
  if (message.includes("belongs to a different warehouse")) {
    return "One or more parts don't belong to the selected warehouse. Remove and re-add those lines.";
  }
  return message;
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<{ error: string | null; po?: PurchaseOrder }> {
  if (!input.supplier_id) return { error: "Supplier is required." };
  if (!input.warehouse_id) return { error: "Warehouse is required." };
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { error: "At least one line item is required." };
  }
  for (const l of input.lines) {
    if (!l?.part_id) return { error: "Line item is missing a part." };
    if (!(l.qty > 0)) return { error: "Line item quantity must be positive." };
    if (l.unit_price_sar == null || l.unit_price_sar < 0) {
      return { error: "Line item price cannot be negative." };
    }
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: input.supplier_id,
    p_warehouse_id: input.warehouse_id,
    p_lines: input.lines,
    p_expected_delivery: input.expected_delivery,
    p_note: input.note,
    p_actor: await actorEmail(supabase),
    p_ai_generated: input.ai_generated ?? false,
    p_ai_rationale: input.ai_rationale ?? null,
    p_ai_rationale_ar: input.ai_rationale_ar ?? null,
  });
  if (error) return { error: friendlyPoError(error.message) };

  revalidatePath("/inventory");
  return { error: null, po: data as PurchaseOrder };
}

// ---------------------------------------------------------------------------
// Edit a draft PO — "risky batch" Stage 3, item 6. App-only, NO RPC (Turki's
// explicit instruction for this whole stage). This is the ONE deliberate
// exception to every other PO mutation in this file going through a
// security-definer RPC in one transaction — flagged here, not slipped in
// quietly.
//
// WHY THIS IS ACCEPTABLE WITHOUT ONE: a draft PO carries zero real-world
// commitment yet — nothing issued, no stock moved, no approval chain
// started (that's the whole point of the draft/issued split, 0050). Worst
// case if this partially fails mid-way (see below) is a draft temporarily
// missing some lines — recoverable by editing again, not a data-integrity
// incident. This reasoning does NOT extend to issued/pending_approval/
// approved/rejected POs — this action refuses all of those, server-side,
// not just client-side.
//
// NOT ATOMIC — three separate Supabase calls, not one transaction (that's
// what an RPC would normally buy):
//   1. UPDATE purchase_orders header fields, gated on status='draft' (both
//      a fresh server-side read AND a WHERE clause on the update itself —
//      belt-and-suspenders against a race where the PO stopped being a
//      draft between the read and the write).
//   2. DELETE all existing purchase_order_lines for this PO.
//   3. INSERT the new line set.
// If (2) succeeds but (3) fails, the PO is left with zero lines until the
// user edits again — ugly, not dangerous, given point above. Every
// validation create_purchase_order's own RPC would normally enforce
// (supplier/warehouse exist+active, every line's part belongs to the
// chosen warehouse) is re-implemented here in TypeScript instead, since
// there's no RPC backing this to do it server-side otherwise.
export type UpdatePurchaseOrderInput = {
  supplier_id: string;
  warehouse_id: string;
  lines: PurchaseOrderLineInput[];
  expected_delivery: string | null;
  note: string | null;
};

export async function updatePurchaseOrder(
  poId: string,
  input: UpdatePurchaseOrderInput,
): Promise<{ error: string | null; po?: PurchaseOrder }> {
  if (!poId) return { error: "Missing purchase order." };
  if (!input.supplier_id) return { error: "Supplier is required." };
  if (!input.warehouse_id) return { error: "Warehouse is required." };
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { error: "At least one line item is required." };
  }
  for (const l of input.lines) {
    if (!l?.part_id) return { error: "Line item is missing a part." };
    if (!(l.qty > 0)) return { error: "Line item quantity must be positive." };
    if (l.unit_price_sar == null || l.unit_price_sar < 0) {
      return { error: "Line item price cannot be negative." };
    }
  }

  const supabase = createClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .single();
  if (fetchErr || !existing) return { error: "Purchase order not found." };
  if (existing.status !== "draft") {
    return { error: `Only a draft purchase order can be edited (current status: ${existing.status}).` };
  }

  const { data: supplierRow } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", input.supplier_id)
    .eq("active", true)
    .maybeSingle();
  if (!supplierRow) return { error: "Supplier not found or inactive." };

  const { data: warehouseRow } = await supabase
    .from("warehouses")
    .select("id")
    .eq("id", input.warehouse_id)
    .eq("active", true)
    .maybeSingle();
  if (!warehouseRow) return { error: "Warehouse not found or inactive." };

  const partIds = Array.from(new Set(input.lines.map((l) => l.part_id)));
  const { data: partsRows, error: partsErr } = await supabase
    .from("parts")
    .select("id, warehouse_id, active")
    .in("id", partIds);
  if (partsErr) return { error: partsErr.message };
  const partsById = new Map((partsRows ?? []).map((p) => [p.id, p]));
  for (const l of input.lines) {
    const part = partsById.get(l.part_id);
    if (!part || !part.active) return { error: "Part not found or inactive." };
    if (part.warehouse_id !== input.warehouse_id) {
      return { error: friendlyPoError(`Part belongs to a different warehouse than this purchase order.`) };
    }
  }

  const { data: po, error: updateErr } = await supabase
    .from("purchase_orders")
    .update({
      supplier_id: input.supplier_id,
      warehouse_id: input.warehouse_id,
      expected_delivery: input.expected_delivery,
      note: input.note?.trim() || null,
    })
    .eq("id", poId)
    .eq("status", "draft")
    .select()
    .single();
  if (updateErr || !po) return { error: updateErr?.message ?? "Could not update purchase order." };

  const { error: delErr } = await supabase.from("purchase_order_lines").delete().eq("purchase_order_id", poId);
  if (delErr) return { error: delErr.message };

  const { error: insErr } = await supabase.from("purchase_order_lines").insert(
    input.lines.map((l) => ({
      purchase_order_id: poId,
      part_id: l.part_id,
      qty: l.qty,
      unit_price_sar: l.unit_price_sar,
      line_vat_sar: lineVat(l.qty, l.unit_price_sar),
    })),
  );
  if (insErr) return { error: insErr.message };

  // VAT (0056) — recompute the header's ordered-side totals from the lines
  // just written, same as create_purchase_order does server-side. This is
  // the one PO-mutation path with no RPC behind it, so nothing else will
  // ever do this for a draft edit.
  const vatDoc = calculateInventoryVatDocument(
    input.lines.map((l) => ({ qty: l.qty, unitPriceSar: l.unit_price_sar })),
  );
  const { data: poWithTotals, error: totalsErr } = await supabase
    .from("purchase_orders")
    .update({ subtotal_sar: vatDoc.subtotal, vat_sar: vatDoc.vat, total_sar: vatDoc.total })
    .eq("id", poId)
    .select()
    .single();
  if (totalsErr || !poWithTotals) {
    return { error: totalsErr?.message ?? "Could not update purchase order totals." };
  }

  revalidatePath("/inventory");
  return { error: null, po: poWithTotals as PurchaseOrder };
}

export async function issuePurchaseOrder(
  poId: string,
): Promise<{ error: string | null; po?: PurchaseOrder }> {
  if (!poId) return { error: "Missing purchase order." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("issue_purchase_order", {
    p_po_id: poId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { error: null, po: data as PurchaseOrder };
}

// ---------------------------------------------------------------------------
// PO receiving (full-demo Phase 5 — migration 0051, LIVE; extra ad-hoc
// lines — migration 0055, LIVE). Wraps receive_purchase_order(), which
// itself calls receive_loose_parts() (0047) internally — so this action's
// job is identical to receiveLooseParts' above (upload invoice files
// first, since the RPC's contract expects already-uploaded {storage_path,
// file_name, mime_type} pointers, not raw files), plus reconciling against
// the PO's own lines. The mandatory-invoice check and the stock_receipts
// write happen inside receive_loose_parts, not here — this action does
// not (and must not) duplicate that validation.
//
// ReceivePoLineInput is now a union (0055) — each element is EITHER an
// existing PO line being reconciled (line_id) OR an extra part the
// supplier delivered that was never on the PO (part_id). Mirrors the RPC's
// own p_lines contract exactly (see 0055's header) — this action validates
// the SAME shape client-side first, then trusts the RPC's own validation
// (warehouse-consistency, duplicate-part, "already a real line") as the
// source of truth, same convention every other RPC wrapper in this file
// uses.
// ---------------------------------------------------------------------------

export type ReceivePoLineInput =
  | { line_id: string; received_qty: number; received_unit_price_sar: number }
  | { part_id: string; received_qty: number; received_unit_price_sar: number };

export async function receivePurchaseOrder(
  formData: FormData,
): Promise<{ error: string | null; receipt?: StockReceipt }> {
  const poId = String(formData.get("poId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const linesRaw = String(formData.get("linesJson") ?? "");
  const files = formData.getAll("invoiceFiles").filter((f): f is File => f instanceof File && f.size > 0);

  if (!poId) return { error: "Missing purchase order." };

  let lines: ReceivePoLineInput[];
  try {
    lines = JSON.parse(linesRaw);
  } catch {
    return { error: "Invalid line items." };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: "At least one line item is required." };
  }
  for (const l of lines) {
    const hasLineId = "line_id" in l && !!l.line_id;
    const hasPartId = "part_id" in l && !!l.part_id;
    if (hasLineId && hasPartId) return { error: "Line item cannot specify both line_id and part_id." };
    if (!hasLineId && !hasPartId) return { error: "Line item must specify either line_id or part_id." };
    if (!(l.received_qty > 0)) return { error: "Received quantity must be positive." };
    if (l.received_unit_price_sar == null || l.received_unit_price_sar < 0) {
      return { error: "Received unit price cannot be negative." };
    }
  }
  // Not strictly required server-side (receive_loose_parts, called inside
  // the RPC, is the actual enforcer) — checked here too so the upload loop
  // below doesn't run for a request that's going to be rejected anyway.
  if (files.length === 0) return { error: "At least one invoice file is required." };

  const supabase = createClient();

  const uploaded: { storage_path: string; file_name: string; mime_type: string | null }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    const path = `${poId}/receipt-${Date.now()}-${i}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadErr) {
      if (uploaded.length > 0) {
        await supabase.storage.from(INVOICE_BUCKET).remove(uploaded.map((u) => u.storage_path));
      }
      return { error: `Invoice upload failed: ${uploadErr.message}` };
    }
    uploaded.push({ storage_path: path, file_name: file.name, mime_type: file.type || null });
  }

  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_po_id: poId,
    p_lines: lines,
    p_files: uploaded,
    p_note: note,
    p_actor: await actorEmail(supabase),
  });
  if (error) {
    // Best-effort cleanup — avoid orphaned storage objects for a receipt
    // that never landed. Ignore cleanup failures; the RPC error below is
    // the one the user needs to see. friendlyPoError() covers the
    // extra-line warehouse-mismatch message (0055) — same substring
    // ("belongs to a different warehouse") create_purchase_order's own
    // guard raises, already handled by that helper.
    await supabase.storage.from(INVOICE_BUCKET).remove(uploaded.map((u) => u.storage_path));
    return { error: friendlyPoError(error.message) };
  }

  revalidatePath("/inventory");
  return { error: null, receipt: data as StockReceipt };
}

// ---------------------------------------------------------------------------
// Receipt Approvals (Stage B — migration 0057, revised to a matching-vote
// model by migration 0058, both LIVE). Wraps approve_stock_receipt()/
// reject_stock_receipt(), the canonical approval path for BOTH a loose
// (Direct) receive and a PO receive — every receipt is its own approvable
// invoice now (stock already booked at receive time in both cases; this
// is a pure after-the-fact sign-off, never a stock gate).
//
// VOTE MODEL (0058): both approvers must take the SAME action (two
// approves -> approved; two matching rejects -> rejected, same outcome,
// reason may differ). The first vote records only — no stock touched, no
// status change. A mismatched second vote is blocked server-side with a
// clear message (surfaced here as plain res.error, not re-derived
// client-side). The sole first voter can change their own vote freely
// pre-finalization by just calling either action again — there's no
// separate "change vote" endpoint, approve_stock_receipt/
// reject_stock_receipt already upsert the caller's own row. So a single
// call here may return a receipt whose status is STILL 'pending_approval'
// (first vote or a vote change) — that is success, not an error.
//
// IMPORTANT — keeping purchase_orders in lockstep for a PO-linked receipt,
// UNDER THE VOTE MODEL: approve_stock_receipt()/reject_stock_receipt()
// operate ONLY on stock_receipts/stock_receipt_approvals — they never
// touch purchase_orders (confirmed reading their live bodies). That table
// stays approve_purchase_order()/reject_purchase_order()'s job (0052,
// unchanged, its OWN separate immediate/count-based model — not a vote).
// Mirroring on EVERY vote (as this used to do, pre-0058) would drift once
// vote-changing exists: the PO ledger has no way to "un-approve" a stale
// mirrored vote if the receipt-side voter later switches to reject. Fixed
// by mirroring ONLY at the moment the receipt vote actually FINALIZES
// (returned status leaves 'pending_approval'):
//   - approve finalizes -> replay BOTH real voters' approvals onto
//     purchase_order_approvals (read back from stock_receipt_approvals,
//     so it's the actual two approvers, not guessed) — approve_purchase_
//     order is itself threshold-based (needs 2 distinct approvers), so
//     replaying both in the same moment reaches its own 2/2 immediately.
//   - reject finalizes -> reject_purchase_order is a single-shot terminal
//     action (no voting on the PO side at all), so call it once with the
//     completing actor + the receipt's own final rejection_reason.
// Best-effort either way: a PO-mirror failure (e.g. "already approved" on
// stale pre-0058 data) is logged, not thrown — the receipt-level result is
// this feature's real source of truth.
// ---------------------------------------------------------------------------

export type RejectionMode = "void_cost" | "remove_stock";

// Live status check — called client-side right before a vote action opens
// its modal AND again right before it submits (Turki's explicit ask:
// "re-check live status at click time"), since two real approvers acting
// close together can make cached page props stale between page load and
// the click. Read-only, no RPC needed.
// Returns `confirmedNotPending: true` ONLY when a real row was read back
// with a status other than 'pending_approval' — a genuine "someone else
// already resolved this" fact. On any read failure (network blip, RLS
// edge case, etc.) this fails OPEN (confirmedNotPending: false), since
// this check is a UX nicety layered on top of the real gate — the RPCs
// themselves (approve_stock_receipt/reject_stock_receipt) hard-enforce
// "status must be pending_approval" server-side regardless; blocking the
// UI on an inconclusive read here would just be a worse user experience
// for no real safety gain.
export async function getReceiptStatus(
  receiptId: string,
): Promise<{ status: StockReceipt["status"] | null; confirmedNotPending: boolean }> {
  if (!receiptId) return { status: null, confirmedNotPending: false };
  const supabase = createClient();
  const { data, error } = await supabase.from("stock_receipts").select("status").eq("id", receiptId).single();
  if (error || !data) return { status: null, confirmedNotPending: false };
  const status = data.status as StockReceipt["status"];
  return { status, confirmedNotPending: status !== "pending_approval" };
}

// Leads every purchase_orders-mirror failure returned by approveReceipt /
// rejectReceipt. The vote itself is already committed at this point, so the
// message has to say so — the operator must not read this as "try again".
const MIRROR_FAILED_PREFIX =
  "Your vote was recorded and this receipt is resolved, but the purchase order's own status could not be updated: ";

export async function approveReceipt(
  receiptId: string,
  comment: string | null,
): Promise<{ error: string | null; receipt?: StockReceipt }> {
  if (!receiptId) return { error: "Missing receipt." };

  const supabase = createClient();
  const actor = await actorEmail(supabase);
  const trimmedComment = comment?.trim() || null;

  const { data: receiptRow } = await supabase
    .from("stock_receipts")
    .select("po_id")
    .eq("id", receiptId)
    .single();

  const { data, error } = await supabase.rpc("approve_stock_receipt", {
    p_receipt_id: receiptId,
    p_comment: trimmedComment,
    p_actor: actor,
  });
  if (error) return { error: error.message };

  const receipt = data as StockReceipt;

  // Mirror onto purchase_orders ONLY once the vote actually finalizes —
  // see this file's own header for why mirroring every vote would drift
  // once vote-changing exists.
  //
  // The mirror is DERIVED state (stock_receipts is the source of truth, and
  // the approvals queue + its guard both read it now), so a failed mirror can
  // no longer wedge a row. It is still real drift, and a console.error that
  // RETURNED SUCCESS is exactly how five POs ended up pending_approval with an
  // approved receipt and zero votes. So it is returned, never swallowed.
  //
  // `receipt` is returned ALONGSIDE the error: the vote RPC already committed,
  // so the caller must be able to tell "vote landed, mirror drifted" from
  // "vote failed" and must not prompt for the same vote again.
  let mirrorError: string | null = null;
  if (receipt.status === "approved" && receiptRow?.po_id) {
    const { data: votes } = await supabase
      .from("stock_receipt_approvals")
      .select("approver_email, comment")
      .eq("stock_receipt_id", receiptId);

    for (const vote of votes ?? []) {
      const { error: poError } = await supabase.rpc("approve_purchase_order", {
        p_po_id: receiptRow.po_id,
        p_comment: vote.comment,
        p_actor: vote.approver_email,
      });
      if (poError && !/already approved/i.test(poError.message)) {
        mirrorError = poError.message;
      }
    }
  }

  revalidatePath("/inventory");
  if (mirrorError) {
    return { error: `${MIRROR_FAILED_PREFIX}${mirrorError}`, receipt };
  }
  return { error: null, receipt };
}

export async function rejectReceipt(
  receiptId: string,
  mode: RejectionMode,
  reason: string | null,
): Promise<{ error: string | null; receipt?: StockReceipt }> {
  if (!receiptId) return { error: "Missing receipt." };

  const supabase = createClient();
  const actor = await actorEmail(supabase);
  const trimmedReason = reason?.trim() || null;

  const { data: receiptRow } = await supabase
    .from("stock_receipts")
    .select("po_id")
    .eq("id", receiptId)
    .single();

  const { data, error } = await supabase.rpc("reject_stock_receipt", {
    p_receipt_id: receiptId,
    p_mode: mode,
    p_reason: trimmedReason,
    p_actor: actor,
  });
  if (error) return { error: error.message };

  const receipt = data as StockReceipt;

  // Mirror onto purchase_orders ONLY once the vote actually finalizes.
  // reject_purchase_order is single-shot/terminal (no vote of its own) —
  // one call, from the completing actor, with the receipt's own final
  // reason (not necessarily this call's p_reason — the first voter's own
  // reason may differ and is never compared, per the vote model).
  // Same contract as approveReceipt's mirror above: returned, not logged, and
  // always alongside `receipt` so the caller knows the vote itself landed.
  let mirrorError: string | null = null;
  if (receipt.status === "rejected" && receiptRow?.po_id) {
    const { error: poError } = await supabase.rpc("reject_purchase_order", {
      p_po_id: receiptRow.po_id,
      p_reason: receipt.rejection_reason,
      p_actor: actor,
    });
    if (poError && !/awaiting approval/i.test(poError.message)) {
      mirrorError = poError.message;
    }
  }

  revalidatePath("/inventory");
  if (mirrorError) {
    return { error: `${MIRROR_FAILED_PREFIX}${mirrorError}`, receipt };
  }
  return { error: null, receipt };
}
