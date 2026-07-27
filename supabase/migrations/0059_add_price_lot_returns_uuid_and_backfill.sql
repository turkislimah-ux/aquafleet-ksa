-- 0059_add_price_lot_returns_uuid_and_backfill.sql
-- Fixes the "new receipts still landing with null price_lot_id" bug found
-- after 0058. Drafted to disk only — NOT applied. Turki runs this in the
-- Supabase SQL Editor.
--
-- *** ROOT CAUSE ***
-- Both receiving paths (receive_loose_parts for Direct, receive_purchase_
-- order for PO) write stock_receipt_lines through ONE shared function:
-- receive_purchase_order composes on receive_loose_parts for every line
-- (existing PO lines AND 0055's extra/ad-hoc lines alike) and never
-- writes stock_receipt_lines itself — confirmed by reading its live body.
-- So the bug, wherever it is, is inside receive_loose_parts, and hits
-- both paths identically, which matches what was reported.
--
-- Inside receive_loose_parts, per line, 0058 did:
--   perform public.add_price_lot(...);
--   select id into v_lot_id from public.price_lots
--    where part_id = v_part_id order by created_at desc limit 1;
--   insert into stock_receipt_lines (..., price_lot_id, ...) values (..., v_lot_id, ...);
--
-- Verified live against the real table (not assumed): of 9 current null
-- rows, they split into two genuinely different buckets —
--   (1) 4 rows (receipts 212cdd78, bff9209b) — status='rejected',
--       rejection_mode='remove_stock'. stock_receipt_lines.price_lot_id's
--       own FK is `ON DELETE SET NULL`
--       (stock_receipt_lines_price_lot_id_fkey); reject_stock_receipt's
--       remove_stock branch DELETEs those exact price_lots rows, and the
--       FK auto-nulls the very price_lot_id that identified them. This is
--       CORRECT, not a bug — the lot is genuinely gone, the receipt is
--       already terminal, nothing to fix.
--   (2) 5 rows (receipts efaee627, 106c852b, 35cfce87, 939ab3cb,
--       3e7f0303) — a REAL bug. For every one of these, the matching
--       price_lots row demonstrably exists (same part_id, qty_purchased,
--       price_sar, and created_at matching to the microsecond — proof of
--       same transaction) and is NOT deleted, NOT claimed by any other
--       line — yet price_lot_id is null. The "order by created_at desc
--       limit 1" lookup is a guess by recency, not an authoritative
--       reference to the row the SAME call just created, and it is
--       provably wrong on live data. (Ruled out: pre-fix historical data —
--       bff9209b's own successful remove_stock reject, same day, hours
--       earlier, proves 0058's guard/traversal was already live and
--       working before these 5 were created. Ruled out: same-part-twice-
--       in-one-receipt collision, the specific risk flagged in 0058's own
--       header — checked directly, zero receipts anywhere in the table
--       have a duplicate part_id within one receipt_id.) The exact trigger
--       for why the lookup misses wasn't pinned down from static analysis
--       alone — Postgres's own transaction semantics say a select right
--       after an insert in the same transaction should always see it, so
--       this shouldn't be reachable by the code as written at all. That
--       itself is the point: a recency guess is fragile in a way a direct
--       reference structurally cannot be, regardless of the precise
--       failure mode.
--
-- *** FIX ***
-- Stop guessing. add_price_lot already knows exactly which row it just
-- inserted — hand that back directly instead of making the caller re-find
-- it by recency.
--
--   add_price_lot: RETURNS changes from `parts` to `uuid` (the new
--     price_lots.id). Verified before making this change: the ONLY caller
--     anywhere — app code (grepped app/, lib/ — zero direct RPC calls,
--     only comments) or any other live DB function (grepped every
--     pg_proc body for the string, only receive_loose_parts calls it) —
--     is receive_loose_parts's own `perform public.add_price_lot(...)`,
--     which already DISCARDS the return value entirely. Changing the
--     return shape is safe; nothing depends on getting a `parts` row
--     back. Every other line of add_price_lot's body — the row-locked
--     parts read, the price_lots insert, the qty_on_hand/unit_cost_sar
--     update, the receive_lot stock_movements log — is byte-for-byte
--     unchanged; only what gets returned changes.
--   receive_loose_parts: same signature (still 6 args). Per line,
--     `v_lot_id := public.add_price_lot(...)` directly — the "select ...
--     order by created_at desc limit 1" lookup is deleted entirely, not
--     just corrected. Each call gets back exactly the row it created, with
--     zero ambiguity regardless of how many other lots exist for that
--     part, regardless of same-part-twice (still zero live occurrences,
--     but now provably safe either way), regardless of whatever caused
--     the miss above.
--   receive_purchase_order: NOT touched. It only calls receive_loose_parts
--     (unchanged call site — receive_loose_parts's signature doesn't
--     change) and writes purchase_order_lines (no price_lot_id column
--     there at all) — nothing in it needs to change for this fix.
--
-- *** BACKFILL ***
-- Touches ONLY price_lot_id — never qty_on_hand/qty_remaining/qty_
-- purchased, so the FIFO invariant is untouched by it, not just
-- "shouldn't be affected."
--   - The 4 remove_stock-rejected rows (bucket 1): NOT touched. Their lot
--     is genuinely gone; nothing to backfill; this is the correct
--     permanent state.
--   - The 5 real-bug rows (bucket 2): backfilled via an unambiguous match
--     only — same part_id + qty_purchased + price_sar + created_at to a
--     price_lots row that (a) is the ONLY row matching all four, and (b)
--     isn't already claimed by any other stock_receipt_lines row. Dry-run
--     verified against live data before writing this: exactly these 5
--     rows match, each to exactly one unclaimed lot; the 4 bucket-1 rows
--     correctly produce zero candidates (their lots were deleted, gone).
--     Anywhere a future null row doesn't have an unambiguous match, this
--     statement leaves it null — stays honestly un-rejectable (both
--     outcomes), same precedent as every other frozen-snapshot gap in
--     this feature. No rows are hardcoded by UUID — the match conditions
--     alone are what make this safe to re-run/re-review.
--
-- RPC discipline unchanged: exact-signature drop-before-create, security
-- definer, search_path, one signature each, verified after.
-- lib/prepaid.ts/vat.ts/invoice.ts/inventory-vat.ts not touched, as always.

begin;

-- ----------------------------------------------------------------------------
-- add_price_lot — RETURNS uuid (the new price_lots.id) instead of parts.
-- Every other line of the body is unchanged.
-- ----------------------------------------------------------------------------
drop function if exists public.add_price_lot(uuid, numeric, numeric, date, text, text);

create or replace function public.add_price_lot(
  p_part_id     uuid,
  p_price       numeric,
  p_qty         numeric,
  p_received_on date default current_date,
  p_note        text default null,
  p_actor       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part   public.parts;
  v_lot_id uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Received quantity must be positive.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Price cannot be negative.';
  end if;

  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;

  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;

  insert into public.price_lots (part_id, price_sar, qty_purchased, qty_remaining, received_on, note)
  values (p_part_id, p_price, p_qty, p_qty, coalesce(p_received_on, current_date), nullif(trim(p_note), ''))
  returning id into v_lot_id;

  update public.parts
     set qty_on_hand   = v_part.qty_on_hand + p_qty,
         unit_cost_sar = p_price
   where id = p_part_id
  returning * into v_part;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'receive_lot', p_qty, v_part.qty_on_hand, nullif(trim(p_note), ''), p_actor);

  return v_lot_id;
end;
$$;

grant execute on function public.add_price_lot(uuid, numeric, numeric, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- receive_loose_parts — captures add_price_lot's return value directly as
-- price_lot_id. No lookup. Signature unchanged (still 6 args).
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
  v_lot_id    uuid;
  v_line_vat  numeric(12, 2);
  v_total     numeric(12, 2) := 0;
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

  insert into public.stock_receipts (supplier_id, warehouse_id, note, received_by, receipt_type)
  values (p_supplier_id, p_warehouse_id, nullif(trim(p_note), ''), p_actor, 'direct')
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

    v_line_vat := round(v_qty * v_price * 0.15, 2);

    -- Fix: capture the exact lot this call created — no lookup, no guess.
    v_lot_id := public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);

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

  update public.stock_receipts
     set total_cost_sar = v_total,
         vat_sar = v_vat_total,
         grand_total_sar = v_total + v_vat_total
   where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Backfill — price_lot_id ONLY, unambiguous matches only. See this
-- migration's own header for the exact conditions and the verified dry-run.
-- ----------------------------------------------------------------------------
update public.stock_receipt_lines srl
   set price_lot_id = pl.id
  from public.price_lots pl
 where srl.price_lot_id is null
   and pl.part_id = srl.part_id
   and pl.qty_purchased = srl.qty
   and pl.price_sar = srl.unit_price_sar
   and pl.created_at = srl.created_at
   and not exists (
     select 1 from public.stock_receipt_lines srl2 where srl2.price_lot_id = pl.id
   )
   and (
     select count(*) from public.price_lots pl2
      where pl2.part_id = srl.part_id
        and pl2.qty_purchased = srl.qty
        and pl2.price_sar = srl.unit_price_sar
        and pl2.created_at = srl.created_at
   ) = 1;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'add_price_lot';
--   -- exactly one row: add_price_lot(uuid, numeric, numeric, date, text, text)
--   select prorettype::regtype from pg_proc where proname = 'add_price_lot';
--   -- must read "uuid", not "parts".
--   select oid::regprocedure from pg_proc where proname = 'receive_loose_parts';
--   -- exactly one row: receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text)
--
--   -- Backfill result — should now show exactly the 5 real-bug rows fixed,
--   -- the 4 remove_stock-rejected rows still null (correct):
--   select sr.status, sr.rejection_mode, count(*) filter (where srl.price_lot_id is null) as still_null
--     from public.stock_receipt_lines srl
--     join public.stock_receipts sr on sr.id = srl.receipt_id
--    group by sr.status, sr.rejection_mode;
--   -- 4 still null, all status='rejected' and rejection_mode='remove_stock'.
--
--   -- No new row can land null-linked going forward (both Direct and PO,
--   -- since PO composes receive_loose_parts) — smoke test after a real
--   -- receive through the app on EACH path:
--   -- select count(*), count(price_lot_id) from public.stock_receipt_lines
--   --  where created_at > now() - interval '1 hour';
--   -- both counts must match for anything received after this migration,
--   -- on a fresh receive through EITHER "Add Parts" (direct) or "Receive
--   -- Purchase Order" (po) — not just one of the two paths.
--
--   -- FIFO invariant, unaffected by this migration (backfill only ever
--   -- touches price_lot_id, never qty_on_hand/qty_remaining/qty_purchased):
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return zero rows.
-- ---------------------------------------------------------------------------
