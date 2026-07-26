-- 0056_inventory_vat.sql
-- Inventory — "risky batch" Stage 5: VAT on parts invoices (Turki's exact
-- money rules; design/placement is Claude Code's own — see CLAUDE.md §2).
-- Migration only. No UI, no app-code wrappers — those land in a follow-up
-- step, same split every prior phase used. DRAFTED TO DISK ONLY, NOT
-- APPLIED — Turki runs migrations, not Claude.
--
-- *** THE RULES, EXACTLY AS SPECIFIED ***
-- - Fixed 15% (ZATCA). Entered unit prices are VAT-EXCLUSIVE — VAT is
--   added on top, never baked into unit_price_sar/unit_cost_sar/price_sar.
-- - Rounding: PER LINE, then summed. line_vat = round(qty * unit_price * 0.15, 2).
--   Document VAT = sum of the (already-rounded) line VATs. This is the
--   OPPOSITE of lib/vat.ts's own documented convention (that file rounds
--   ONCE at the document level, per ZATCA's invoice-XML rule for CUSTOMER
--   invoices — see its header). Parts VAT is a genuinely separate concern
--   with its own explicit rule from Turki: never routed through
--   lib/vat.ts's calculateVat(). A new peer file, lib/inventory-vat.ts
--   (app-code stage, not this migration), borrows ONLY the 15% rate
--   (re-imports VAT_RATE from lib/prepaid.ts — a read, not a modification)
--   and does its own per-line-then-summed math. lib/vat.ts, lib/prepaid.ts,
--   lib/invoice.ts are NOT touched by this migration or that follow-up file.
--
-- *** WHAT CARRIES VAT, WHAT NEVER DOES ***
-- VAT is stored ONLY on the booking records below (purchase_order_lines,
-- purchase_orders, stock_receipt_lines, stock_receipts) — it is a parallel,
-- additive figure, never fed into the stock-cost path:
--   - add_price_lot(): UNTOUCHED. Still takes p_price = the VAT-EXCLUSIVE
--     unit price, exactly as before. Still the only writer of price_lots
--     and parts.qty_on_hand/unit_cost_sar.
--   - consume_from_lots(): UNTOUCHED.
--   - price_lots: NO new column. A FIFO ledger row, not a document — it
--     already carries the VAT-exclusive price_sar; any VAT figure for
--     display (e.g. a "stock batches" table) is `price_sar * qty_purchased
--     * 0.15`, computed live in a later app-code stage, not stored here.
--   - parts.unit_cost_sar: UNTOUCHED. Stays the VAT-exclusive "current
--     cost" cache exactly as 0043/0046 defined it. Stock value, inventory
--     value, financial analysis, consumption figures, and price trend all
--     read this column (or price_lots) and MUST stay VAT-free — nothing in
--     this migration changes what they read from.
-- Consequence: the FIFO invariant (sum(price_lots.qty_remaining) =
-- parts.qty_on_hand per part) is structurally unaffected — no function
-- touched by this migration writes price_lots or parts.qty_on_hand at all.
--
-- *** COLUMNS — ALL ADDITIVE, ALL NULLABLE-OR-SAFELY-DEFAULTED, NO BACKFILL ***
-- Every new column below is either NOT NULL DEFAULT 0 (ordered-side figures
-- — always computable the moment a PO/receipt is written, since qty/price
-- are always present at that point) or NULLABLE with NO default
-- (received-side figures — mirror the existing nullable
-- received_qty/received_unit_price_sar's own "null until actually
-- received" convention, 0051). NOTHING is backfilled for pre-existing rows
-- — including the already-booked PO-2026-0003 and its receipt. Their new
-- columns simply take the plain default/null: ordered-side reads as 0,
-- received-side reads as null, i.e. "pre-VAT/zero-VAT", not a fabricated
-- retroactive VAT figure. This is the same precedent already recorded in
-- CLAUDE.md for legacy invoices confirmed before migration 0036 (Balance/
-- Remaining render "—", never a fabricated 0; their charges are treated as
-- covered, best-available approximation, no backfill) — a historical
-- record is left honestly incomplete by a new field, not rewritten.
--   purchase_order_lines: + line_vat_sar (ordered-side, not null default 0)
--                         + received_line_vat_sar (nullable, no default)
--   purchase_orders:      + subtotal_sar, + vat_sar, + total_sar
--                           (ordered-side, not null default 0)
--                         + received_subtotal_sar, + received_vat_sar,
--                           + received_total_sar (nullable, no default)
--   stock_receipts:       + vat_sar, + grand_total_sar (not null default 0)
--                           total_cost_sar is UNCHANGED — keeps its exact
--                           existing meaning (pre-VAT subtotal), not
--                           renamed, so every existing reader (PODetailModal,
--                           ReceiveListModal, financial summary, etc.) needs
--                           zero changes for this migration to be safe.
--   stock_receipt_lines:  + line_vat_sar (not null default 0)
-- No CHECK constraints added on any of these — matches the closest existing
-- sibling precedent exactly: stock_receipts.total_cost_sar (also an
-- RPC-computed, never-user-input derived total) has no CHECK, and
-- purchase_order_lines.received_qty/received_unit_price_sar (also nullable
-- received-side fields) have none either — validation for all of these
-- lives in the RPC that computes them, not the schema, same convention.
--
-- *** ONE DELIBERATE PRECEDENT REVERSAL — FLAGGED, NOT SNUCK IN ***
-- Phase 4's own build notes state "PO total is NEVER stored — always
-- derived from purchase_order_lines at render, everywhere it's shown."
-- purchase_orders.subtotal_sar/vat_sar/total_sar (and their received_*
-- counterparts) reverse that specifically for VAT/subtotal/total, per
-- Turki's own explicit ask ("Store the VAT figures on the records...
-- document subtotal/VAT total/grand total... on stock_receipts and
-- purchase_orders... These are booked figures"). This can't silently drift
-- the way the original rule was designed to prevent: EVERY function that
-- ever writes purchase_order_lines for a given PO (create_purchase_order,
-- the app-code updatePurchaseOrder in a later stage, and
-- receive_purchase_order's own extra-line insert, 0055) is also the
-- function that recomputes and rewrites these three header columns in the
-- same transaction — there is no other writer left free to invalidate them.
--
-- *** RPCs TOUCHED — EXACT-SIGNATURE DROP BEFORE CREATE, SIGNATURE UNCHANGED ***
-- receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text)      — 0047
-- create_purchase_order(uuid, uuid, jsonb, date, text, text)    — 0050/0053
-- receive_purchase_order(uuid, jsonb, jsonb, text, text)        — 0051/0055
-- issue_purchase_order, add_price_lot, consume_from_lots: NOT touched.
--
-- receive_loose_parts is the ONE function that actually writes
-- stock_receipts/stock_receipt_lines — it's called directly (loose "Add
-- Parts") AND via receive_purchase_order, so adding VAT calc here once
-- covers both call paths through the exact same code, per Turki's own
-- "through the same single stock/money path" requirement. It ALREADY loops
-- over p_lines computing v_total (the pre-VAT subtotal, unchanged) — this
-- migration only adds a line_vat_sar/v_vat_total tally alongside that
-- existing loop, and two new columns on the final UPDATE. v_total's own
-- existing computation is untouched, byte-for-byte, to keep zero risk on
-- an already-live, already-booked column.
--
-- create_purchase_order computes ordered-side subtotal_sar/vat_sar/
-- total_sar + per-line line_vat_sar at draft-insert time — straightforward,
-- since every line is brand new in that same transaction.
--
-- receive_purchase_order (0055's 2-shape p_lines: existing line_id OR
-- extra part_id) computes received_line_vat_sar for BOTH shapes (the
-- existing-line reconcile UPDATE, and the extra-line INSERT — ordered =
-- received for extras, same "no real ordered figure for something never
-- ordered" reasoning 0055 already established for qty/unit_price_sar), then
-- refreshes ALL SIX purchase_orders header columns (ordered-side AND
-- received-side) from a single fresh aggregate over every
-- purchase_order_lines row for this PO — folded into the SAME final UPDATE
-- that already flips status/received_by/received_date, not a second
-- statement. Refreshing the ORDERED-side subtotal_sar/vat_sar/total_sar
-- here (not just received-side) is required specifically because 0055's
-- own extra-line INSERT changes the ordered-side line set for this PO —
-- without this refresh, a PO's stored ordered totals would go stale the
-- instant an extra line is received, which is exactly the staleness the
-- original "never store a PO total" rule existed to prevent.
--
-- RLS: NO new tables, NO RLS changes — every touched table's existing
-- "authenticated_all_<table>" policy is table-level, not column-level (same
-- convention as every prior migration in this feature), so it already
-- covers these new columns.

begin;

-- ----------------------------------------------------------------------------
-- purchase_order_lines — ordered-side VAT (always computable at insert) +
-- received-side VAT (nullable, mirrors received_qty/received_unit_price_sar's
-- own "null until actually received" convention, 0051).
-- ----------------------------------------------------------------------------
alter table public.purchase_order_lines
  add column if not exists line_vat_sar numeric(12, 2) not null default 0,
  add column if not exists received_line_vat_sar numeric(12, 2);

-- ----------------------------------------------------------------------------
-- purchase_orders — ordered-side booked totals (written by
-- create_purchase_order at draft time, kept in sync by
-- receive_purchase_order when extra lines are added) + received-side booked
-- totals (nullable, written only by receive_purchase_order).
-- ----------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists subtotal_sar numeric(12, 2) not null default 0,
  add column if not exists vat_sar numeric(12, 2) not null default 0,
  add column if not exists total_sar numeric(12, 2) not null default 0,
  add column if not exists received_subtotal_sar numeric(12, 2),
  add column if not exists received_vat_sar numeric(12, 2),
  add column if not exists received_total_sar numeric(12, 2);

-- ----------------------------------------------------------------------------
-- stock_receipts — total_cost_sar keeps its exact existing meaning
-- (pre-VAT subtotal), unchanged, unrenamed. vat_sar/grand_total_sar are new,
-- additive, written alongside it by receive_loose_parts.
-- ----------------------------------------------------------------------------
alter table public.stock_receipts
  add column if not exists vat_sar numeric(12, 2) not null default 0,
  add column if not exists grand_total_sar numeric(12, 2) not null default 0;

-- ----------------------------------------------------------------------------
-- stock_receipt_lines — per-line VAT, written alongside the existing
-- unit_price_sar (VAT-exclusive, unchanged) by receive_loose_parts.
-- ----------------------------------------------------------------------------
alter table public.stock_receipt_lines
  add column if not exists line_vat_sar numeric(12, 2) not null default 0;

-- ----------------------------------------------------------------------------
-- receive_loose_parts(p_supplier_id, p_warehouse_id, p_lines, p_files,
--                      p_note, p_actor) — UNCHANGED signature (0047).
-- ONLY new lines: v_line_vat/v_vat_total tally per iteration, line_vat_sar
-- on the stock_receipt_lines insert, vat_sar/grand_total_sar on the final
-- stock_receipts update. Every other statement — including v_total's own
-- accumulation and the add_price_lot() call (still passed the VAT-EXCLUSIVE
-- v_price, unchanged) — is byte-for-byte identical to 0047.
-- ----------------------------------------------------------------------------
drop function if exists public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text);

create or replace function public.receive_loose_parts(
  p_supplier_id  uuid,
  p_warehouse_id uuid,
  p_lines        jsonb,
  p_files        jsonb,
  p_note         text default null,
  p_actor        text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt   public.stock_receipts;
  v_line      jsonb;
  v_file      jsonb;
  v_part_id   uuid;
  v_qty       numeric(12, 2);
  v_price     numeric(12, 2);
  v_total     numeric(12, 2) := 0;
  v_lot_id    uuid;
  -- VAT (0056) — fixed 15% (ZATCA), entered prices are VAT-EXCLUSIVE.
  -- Rounded PER LINE, then summed — never a single document-level rounding
  -- (see this migration's header; the opposite of lib/vat.ts's own rule).
  v_line_vat  numeric(12, 2);
  v_vat_total numeric(12, 2) := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'At least one invoice file is required.';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and active = true;
  if not found then
    raise exception 'Supplier not found or inactive.';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id and active = true;
  if not found then
    raise exception 'Warehouse not found or inactive.';
  end if;

  insert into public.stock_receipts (supplier_id, warehouse_id, note, received_by)
  values (p_supplier_id, p_warehouse_id, nullif(trim(p_note), ''), p_actor)
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'qty', '')::numeric;
    v_price   := nullif(v_line->>'unit_price_sar', '')::numeric;

    if v_part_id is null then
      raise exception 'Line item is missing part_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line item quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Line item price cannot be negative.';
    end if;

    -- Same mechanism as Phase 2's "Add new price" — inserts the lot, bumps
    -- parts.qty_on_hand, syncs parts.unit_cost_sar, logs the 'receive_lot'
    -- movement. Nothing in this function touches price_lots/parts directly.
    -- v_price here is the VAT-EXCLUSIVE unit price, passed through
    -- UNCHANGED — VAT is computed below only for the stock_receipts/
    -- stock_receipt_lines records, never fed into add_price_lot,
    -- qty_on_hand, or price_lots.
    perform public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);

    select id into v_lot_id
      from public.price_lots
     where part_id = v_part_id
     order by created_at desc
     limit 1;

    -- Per-line VAT = 15% of (unit price x qty), rounded HERE, per line.
    v_line_vat := round(v_qty * v_price * 0.15, 2);

    insert into public.stock_receipt_lines (receipt_id, part_id, price_lot_id, qty, unit_price_sar, line_vat_sar)
    values (v_receipt.id, v_part_id, v_lot_id, v_qty, v_price, v_line_vat);

    v_total     := v_total + (v_qty * v_price);
    v_vat_total := v_vat_total + v_line_vat;
  end loop;

  for v_file in select * from jsonb_array_elements(p_files)
  loop
    if coalesce(v_file->>'storage_path', '') = '' or coalesce(v_file->>'file_name', '') = '' then
      raise exception 'Invoice file entry is missing storage_path or file_name.';
    end if;

    insert into public.stock_receipt_files (receipt_id, storage_path, file_name, mime_type)
    values (v_receipt.id, v_file->>'storage_path', v_file->>'file_name', nullif(v_file->>'mime_type', ''));
  end loop;

  -- Document VAT = SUM of the already-rounded line VATs (v_vat_total) — not
  -- a fresh round(subtotal * 0.15, 2). total_cost_sar's own computation
  -- (v_total) is unchanged from 0047.
  update public.stock_receipts
     set total_cost_sar  = v_total,
         vat_sar          = v_vat_total,
         grand_total_sar  = v_total + v_vat_total
   where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- create_purchase_order(p_supplier_id, p_warehouse_id, p_lines,
--                        p_expected_delivery, p_note, p_actor) — UNCHANGED
-- signature (0050/0053). ONLY new lines: v_line_vat/v_subtotal/v_vat_total
-- tally per iteration, line_vat_sar on the purchase_order_lines insert, a
-- final UPDATE writing subtotal_sar/vat_sar/total_sar onto the PO header.
-- Every validation/guard (supplier/warehouse active, per-line
-- warehouse-consistency check) is byte-for-byte identical to 0050/0053.
-- ----------------------------------------------------------------------------
drop function if exists public.create_purchase_order(uuid, uuid, jsonb, date, text, text);

create or replace function public.create_purchase_order(
  p_supplier_id       uuid,
  p_warehouse_id      uuid,
  p_lines             jsonb,
  p_expected_delivery date default null,
  p_note              text default null,
  p_actor             text default null
) returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po                 public.purchase_orders;
  v_line               jsonb;
  v_part_id            uuid;
  v_part_warehouse_id  uuid;
  v_qty                numeric(12, 2);
  v_price              numeric(12, 2);
  v_number             integer;
  -- VAT (0056) — same fixed-15%/per-line-then-summed rule as
  -- receive_loose_parts above. This PO is brand new in this transaction, so
  -- every line's VAT is computed fresh, nothing pre-existing to preserve.
  v_line_vat           numeric(12, 2);
  v_subtotal           numeric(12, 2) := 0;
  v_vat_total          numeric(12, 2) := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and active = true;
  if not found then
    raise exception 'Supplier not found or inactive.';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id and active = true;
  if not found then
    raise exception 'Warehouse not found or inactive.';
  end if;

  v_number := public.next_po_number(extract(year from current_date)::integer);

  insert into public.purchase_orders (
    po_number, supplier_id, warehouse_id, expected_delivery, note, requested_by
  )
  values (
    'PO-' || extract(year from current_date)::text || '-' || lpad(v_number::text, 4, '0'),
    p_supplier_id, p_warehouse_id, p_expected_delivery, nullif(trim(p_note), ''), p_actor
  )
  returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'qty', '')::numeric;
    v_price   := nullif(v_line->>'unit_price_sar', '')::numeric;

    if v_part_id is null then
      raise exception 'Line item is missing part_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line item quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Line item price cannot be negative.';
    end if;

    select warehouse_id into v_part_warehouse_id
      from public.parts
     where id = v_part_id and active = true;
    if not found then
      raise exception 'Part not found or inactive.';
    end if;
    -- One SKU lives in exactly one warehouse (management rule, 0043) — a PO
    -- for warehouse X can never carry a part whose home warehouse is Y; it
    -- could never be validly received against this PO's warehouse.
    if v_part_warehouse_id <> p_warehouse_id then
      raise exception 'Part % belongs to a different warehouse than this purchase order (warehouse_id %).',
        v_part_id, p_warehouse_id;
    end if;

    -- Per-line VAT = 15% of (unit price x qty), rounded HERE, per line.
    v_line_vat := round(v_qty * v_price * 0.15, 2);

    insert into public.purchase_order_lines (purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar)
    values (v_po.id, v_part_id, v_qty, v_price, v_line_vat);

    v_subtotal  := v_subtotal + round(v_qty * v_price, 2);
    v_vat_total := v_vat_total + v_line_vat;
  end loop;

  -- Document VAT = SUM of the already-rounded line VATs — never a fresh
  -- round(subtotal * 0.15, 2).
  update public.purchase_orders
     set subtotal_sar = v_subtotal,
         vat_sar       = v_vat_total,
         total_sar     = v_subtotal + v_vat_total
   where id = v_po.id
  returning * into v_po;

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, jsonb, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- receive_purchase_order(p_po_id, p_lines, p_files, p_note, p_actor) —
-- UNCHANGED signature (0051/0055's 5-arg version, 2-shape p_lines: existing
-- {line_id, received_qty, received_unit_price_sar} OR extra {part_id,
-- received_qty, received_unit_price_sar}). Every existing guard
-- (issued-only status, duplicate-line_id rejection, extra-line
-- warehouse/duplicate/already-a-real-line rejections, the completeness
-- check, the receive_loose_parts() call) is byte-for-byte identical to
-- 0055. ONLY new pieces:
--   1. received_line_vat_sar computed inline (round(received_qty *
--      received_unit_price_sar * 0.15, 2)) on BOTH the existing-line
--      reconcile UPDATE and the extra-line INSERT.
--   2. The final status/received_by/received_date UPDATE is now ONE
--      combined UPDATE that ALSO refreshes purchase_orders' six VAT/total
--      columns (ordered-side AND received-side) from a fresh aggregate over
--      every purchase_order_lines row for this PO — required because the
--      extra-line INSERT just below changes the ordered-side line set too;
--      without this refresh the header's ordered totals would go stale the
--      instant an extra line is received.
-- ----------------------------------------------------------------------------
drop function if exists public.receive_purchase_order(uuid, jsonb, jsonb, text, text);

create or replace function public.receive_purchase_order(
  p_po_id  uuid,
  p_lines  jsonb,
  p_files  jsonb,
  p_note   text default null,
  p_actor  text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po                  public.purchase_orders;
  v_receipt              public.stock_receipts;
  v_line                 jsonb;
  v_line_id              uuid;
  v_part_id              uuid;
  v_qty                  numeric(12, 2);
  v_price                numeric(12, 2);
  v_existing_part_id     uuid;
  v_extra_part_wh        uuid;
  v_line_ids             uuid[] := array[]::uuid[];
  v_extra_part_ids       uuid[] := array[]::uuid[];
  v_loose_lines          jsonb := '[]'::jsonb;
  v_po_line_count        integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'issued' then
    raise exception 'Only an issued purchase order can be received (current status: %).', v_po.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  select count(*) into v_po_line_count
    from public.purchase_order_lines
   where purchase_order_id = p_po_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'received_qty', '')::numeric;
    v_price   := nullif(v_line->>'received_unit_price_sar', '')::numeric;

    if v_line_id is not null and v_part_id is not null then
      raise exception 'Line item cannot specify both line_id and part_id.';
    end if;
    if v_line_id is null and v_part_id is null then
      raise exception 'Line item must specify either line_id (an existing PO line) or part_id (an extra item).';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Received quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Received unit price cannot be negative.';
    end if;

    if v_line_id is not null then
      -- Existing PO line — unchanged from 0051/0055.
      if v_line_id = any(v_line_ids) then
        raise exception 'Line % was submitted more than once — each line must be received exactly once.', v_line_id;
      end if;

      select part_id into v_existing_part_id
        from public.purchase_order_lines
       where id = v_line_id and purchase_order_id = p_po_id;
      if not found then
        raise exception 'Line % does not belong to this purchase order.', v_line_id;
      end if;

      v_line_ids := array_append(v_line_ids, v_line_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_existing_part_id,
        'qty', v_qty,
        'unit_price_sar', v_price
      ));
    else
      -- Extra / ad-hoc line — unchanged from 0055.
      if v_part_id = any(v_extra_part_ids) then
        raise exception 'Part % was submitted more than once as an extra line — each extra part must appear exactly once.', v_part_id;
      end if;

      select warehouse_id into v_extra_part_wh
        from public.parts
       where id = v_part_id and active = true;
      if v_extra_part_wh is null then
        raise exception 'Extra line part % not found or inactive.', v_part_id;
      end if;
      if v_extra_part_wh <> v_po.warehouse_id then
        raise exception 'Extra line part % belongs to a different warehouse than this purchase order.', v_part_id;
      end if;

      perform 1 from public.purchase_order_lines
       where purchase_order_id = p_po_id and part_id = v_part_id;
      if found then
        raise exception 'Part % is already a line on this purchase order — adjust its existing line (by line_id) instead of adding it again as an extra.', v_part_id;
      end if;

      v_extra_part_ids := array_append(v_extra_part_ids, v_part_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_part_id,
        'qty', v_qty,
        'unit_price_sar', v_price
      ));
    end if;
  end loop;

  if coalesce(array_length(v_line_ids, 1), 0) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      coalesce(array_length(v_line_ids, 1), 0), v_po_line_count;
  end if;

  -- Same mandatory-invoice gate, same stock_receipts/_lines/_files writes,
  -- same add_price_lot() per line, same VAT calc on the receipt itself
  -- (0056's own receive_loose_parts, above) — for ordered AND extra lines
  -- alike. Nothing here duplicates any of that.
  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id
   where id = v_receipt.id;

  -- Reconcile existing lines — unchanged from 0051/0055, PLUS the new
  -- received_line_vat_sar (0056): 15% of (received qty x received price),
  -- rounded per line.
  update public.purchase_order_lines pol
     set received_qty            = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric,
         received_line_vat_sar   = round(
           (elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2
         )
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  -- The PO now includes the extra lines too — unchanged from 0055, PLUS
  -- line_vat_sar/received_line_vat_sar (0056), both set to the same value
  -- (ordered = received for an extra, so its ordered-side and
  -- received-side VAT are identical too).
  insert into public.purchase_order_lines (
    purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar,
    received_qty, received_unit_price_sar, received_line_vat_sar
  )
  select
    p_po_id,
    (elem->>'part_id')::uuid,
    (elem->>'received_qty')::numeric,
    (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2),
    (elem->>'received_qty')::numeric,
    (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2)
  from jsonb_array_elements(p_lines) elem
  where (elem->>'part_id') is not null;

  -- 0056: refresh ALL SIX header VAT/total columns (ordered-side AND
  -- received-side) from a fresh aggregate over every purchase_order_lines
  -- row for this PO, now that the extra-line insert above may have changed
  -- the ordered-side line set. Folded into the SAME update that already
  -- flips status/received_by/received_date (unchanged from 0051/0055), not
  -- a second statement. Document totals = SUM of the already-rounded
  -- per-line VATs (line_vat_sar/received_line_vat_sar) — never a fresh
  -- round(subtotal * 0.15, 2).
  update public.purchase_orders po
     set status                = 'pending_approval',
         received_by           = p_actor,
         received_date         = current_date,
         subtotal_sar          = agg.subtotal,
         vat_sar               = agg.vat,
         total_sar             = agg.subtotal + agg.vat,
         received_subtotal_sar = agg.received_subtotal,
         received_vat_sar      = agg.received_vat,
         received_total_sar    = agg.received_subtotal + agg.received_vat
    from (
      select
        coalesce(sum(round(qty * unit_price_sar, 2)), 0)                   as subtotal,
        coalesce(sum(line_vat_sar), 0)                                     as vat,
        coalesce(sum(round(received_qty * received_unit_price_sar, 2)), 0) as received_subtotal,
        coalesce(sum(received_line_vat_sar), 0)                            as received_vat
      from public.purchase_order_lines
      where purchase_order_id = p_po_id
    ) agg
   where po.id = p_po_id;

  select * into v_receipt from public.stock_receipts where id = v_receipt.id;

  return v_receipt;
end;
$$;

grant execute on function public.receive_purchase_order(uuid, jsonb, jsonb, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'receive_loose_parts';
--   -- must return exactly ONE row: receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text)
--   select oid::regprocedure from pg_proc where proname = 'create_purchase_order';
--   -- must return exactly ONE row: create_purchase_order(uuid, uuid, jsonb, date, text, text)
--   select oid::regprocedure from pg_proc where proname = 'receive_purchase_order';
--   -- must return exactly ONE row: receive_purchase_order(uuid, jsonb, jsonb, text, text)
--
--   -- FIFO invariant — must return ZERO rows, exactly as every prior
--   -- migration in this feature (structurally unaffected — nothing here
--   -- writes price_lots or parts.qty_on_hand):
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--
--   -- PO-2026-0003 (and any other pre-migration PO/receipt) stays valid,
--   -- reads as pre-VAT/zero-VAT, not back-computed:
--   select po_number, subtotal_sar, vat_sar, total_sar,
--          received_subtotal_sar, received_vat_sar, received_total_sar
--     from public.purchase_orders
--    where po_number = 'PO-2026-0003';
--   -- expect: subtotal_sar/vat_sar/total_sar = 0, received_* = null
--   -- (unless/until a future receive re-fires for a DIFFERENT, newly-issued
--   -- PO — this one, already past 'issued', will never be touched again).
--
--   -- New-PO happy path (replace placeholders with real ids; part_id must
--   -- belong to warehouse_id):
--   -- select po_number, subtotal_sar, vat_sar, total_sar from public.create_purchase_order(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":10,"unit_price_sar":100}]'::jsonb,
--   --   null, 'VAT smoke test', 'you@example.com'
--   -- );
--   -- expect: subtotal_sar=1000.00, vat_sar=150.00, total_sar=1150.00
--   -- and the one purchase_order_lines row: line_vat_sar=150.00
--
--   -- Loose-receive happy path (replace placeholders; needs a real
--   -- supplier_id/warehouse_id/part_id and an already-uploaded invoice
--   -- file path):
--   -- select total_cost_sar, vat_sar, grand_total_sar from public.receive_loose_parts(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":4,"unit_price_sar":25}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   'VAT smoke test', 'you@example.com'
--   -- );
--   -- expect: total_cost_sar=100.00, vat_sar=15.00, grand_total_sar=115.00
--   -- and its one stock_receipt_lines row: line_vat_sar=15.00
-- ---------------------------------------------------------------------------
