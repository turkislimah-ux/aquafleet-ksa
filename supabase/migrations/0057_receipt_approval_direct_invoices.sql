-- 0057_receipt_approval_direct_invoices.sql
-- Inventory — Stage B ("the money + approval + archive batch"): approval
-- for direct (loose) receipts, alongside POs.
--
-- RECONCILIATION NOTE (read this first): this file originally held a
-- different draft (invoice_type/reject_outcome naming, a generalized
-- purchase_order_approvals table). That draft was NOT what actually got
-- applied — Turki (or whoever ran this) applied a different, simpler
-- design directly, confirmed live via the Supabase MCP before this file
-- was corrected: a NEW, SEPARATE `stock_receipt_approvals` table (not a
-- generalization of `purchase_order_approvals`), `receipt_type`/
-- `rejection_mode` naming (not `invoice_type`/`reject_outcome`), and
-- `approve_purchase_order`/`reject_purchase_order` (0052) were left
-- completely UNCHANGED, not dropped. This file has been rewritten to
-- transcribe exactly what is live now (columns, constraints, and full
-- function bodies pulled via `pg_get_functiondef`) so the migration
-- history stays truthful — do NOT re-run this; it is a record of what's
-- already applied, kept for history/reference only.
--
-- *** WHAT'S LIVE ***
-- stock_receipts gained: status ('pending_approval'|'approved'|'rejected',
--   not null, default 'pending_approval' — existing rows backfilled to
--   'approved', confirmed live), receipt_type ('direct'|'po', not null,
--   default 'direct' — existing rows backfilled from po_id is not null),
--   rejected_by/rejected_at/rejection_reason, rejection_mode
--   ('void_cost'|'remove_stock', nullable, set only when rejected).
-- stock_receipt_approvals — a NEW, separate table (id, stock_receipt_id
--   not null FK cascade, approver_email, comment, approved_at, UNIQUE on
--   stock_receipt_id+approver_email) — parallel to, not a merge of,
--   purchase_order_approvals (0052). Both tables coexist.
-- receive_loose_parts — stamps receipt_type='direct' at insert (status
--   defaults 'pending_approval' via the column default, not set
--   explicitly in the function body). Signature unchanged (still 6 args).
-- receive_purchase_order — after its existing call into
--   receive_loose_parts, ALSO sets receipt_type='po' on the resulting
--   stock_receipts row (single extra UPDATE column vs. before).
-- approve_stock_receipt(p_receipt_id, p_comment, p_actor) — NEW. Row-locks
--   the receipt, requires status='pending_approval', same staff-role
--   eligibility check as approve_purchase_order, same MIN_APPROVALS=2 via
--   stock_receipt_approvals, flips status to 'approved' at threshold.
--   Does NOT touch purchase_orders at all, even when po_id is set — a
--   PO-linked receipt's own purchase_orders.status is a SEPARATE field,
--   left to approve_purchase_order/reject_purchase_order (unchanged) to
--   manage. App code (actions.ts) is responsible for calling both RPCs
--   together when an invoice is PO-linked, to keep the two in lockstep —
--   see actions.ts's approveReceipt()/rejectReceipt() header for exactly
--   how (added in the app-code pass that accompanies this file).
-- reject_stock_receipt(p_receipt_id, p_mode, p_reason, p_actor) — NEW.
--   Row-locks the receipt, requires status='pending_approval', same
--   staff-role eligibility. p_mode is 'void_cost' or 'remove_stock'.
--   void_cost: reprices every price_lots row belonging to this receipt to
--   0 (qty untouched). remove_stock: BLOCKS (raises) if any of this
--   receipt's lots show qty_remaining < qty_purchased OR any 'consume'
--   stock_movements row exists for an affected part at/after this
--   receipt's own created_at; otherwise reverses qty_on_hand by the
--   lots' summed qty_remaining and (unlike this feature's usual
--   "never hard-delete a ledger row" convention elsewhere) DELETES the
--   affected price_lots rows outright, logging one 'adjust' stock_movements
--   row per part (reuses the existing movement_type, no new CHECK value
--   added). Both branches mark stock_receipts rejected with the reason/mode.
--
-- *** HOTFIX FOLDED IN SEPARATELY, NOT HERE *** — reject_stock_receipt's
-- body (both branches) reads `price_lots.stock_receipt_id`, a column this
-- migration did NOT add and `add_price_lot` never set — confirmed live
-- (price_lots has 8 columns, none named stock_receipt_id). This means
-- reject_stock_receipt could not have actually run successfully yet (it
-- would raise "column does not exist" the first time either branch
-- executed) — Postgres does not validate a plpgsql function's embedded
-- SQL against real schema at CREATE time, only at execution time, which is
-- how this shipped without erroring here. Fixed in
-- `0058_price_lots_receipt_link_hotfix.sql` (separate file, drafted
-- alongside the Stage B UI pass) — adds the column, threads it through
-- add_price_lot + receive_loose_parts. See that file for the full
-- reasoning; not repeated here since this file is a record of what 0057
-- itself actually contains, unedited beyond the reconciliation note above.

begin;

alter table public.stock_receipts
  add column if not exists status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected')),
  add column if not exists receipt_type text not null default 'direct'
    check (receipt_type in ('direct', 'po')),
  add column if not exists rejected_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists rejection_mode text
    check (rejection_mode is null or rejection_mode in ('void_cost', 'remove_stock'));

-- Backfill — existing rows already happened under the pre-approval world;
-- they read 'approved' (nothing retroactively gated), and receipt_type is
-- a mechanical re-statement of the already-true po_id fact.
update public.stock_receipts set status = 'approved' where status = 'pending_approval';
update public.stock_receipts set receipt_type = 'po' where po_id is not null and receipt_type = 'direct';

create table if not exists public.stock_receipt_approvals (
  id uuid primary key default gen_random_uuid(),
  stock_receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  approver_email text not null,
  comment text,
  approved_at timestamptz not null default now(),
  unique (stock_receipt_id, approver_email)
);

-- ----------------------------------------------------------------------------
-- receive_loose_parts — stamps receipt_type='direct'. Signature unchanged.
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

    perform public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);

    insert into public.stock_receipt_lines (receipt_id, part_id, qty, unit_price_sar, line_vat_sar)
    values (v_receipt.id, v_part_id, v_qty, v_price, v_line_vat);

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
-- receive_purchase_order — ONLY change vs 0055: stamps receipt_type='po'
-- alongside the existing po_id stamp. Signature unchanged (5 args).
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
  v_receipt             public.stock_receipts;
  v_line                jsonb;
  v_line_id             uuid;
  v_part_id             uuid;
  v_qty                 numeric(12, 2);
  v_price               numeric(12, 2);
  v_existing_part_id    uuid;
  v_extra_part_wh       uuid;
  v_line_ids            uuid[] := array[]::uuid[];
  v_extra_part_ids      uuid[] := array[]::uuid[];
  v_loose_lines         jsonb := '[]'::jsonb;
  v_po_line_count       integer;
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
        'part_id', v_existing_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    else
      if v_part_id = any(v_extra_part_ids) then
        raise exception 'Part % was submitted more than once as an extra line.', v_part_id;
      end if;

      select warehouse_id into v_extra_part_wh
        from public.parts where id = v_part_id and active = true;
      if v_extra_part_wh is null then
        raise exception 'Extra line part % not found or inactive.', v_part_id;
      end if;
      if v_extra_part_wh <> v_po.warehouse_id then
        raise exception 'Extra line part % belongs to a different warehouse than this purchase order.', v_part_id;
      end if;

      perform 1 from public.purchase_order_lines
       where purchase_order_id = p_po_id and part_id = v_part_id;
      if found then
        raise exception 'Part % is already a line on this purchase order.', v_part_id;
      end if;

      v_extra_part_ids := array_append(v_extra_part_ids, v_part_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    end if;
  end loop;

  if coalesce(array_length(v_line_ids, 1), 0) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      coalesce(array_length(v_line_ids, 1), 0), v_po_line_count;
  end if;

  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id, receipt_type = 'po'
   where id = v_receipt.id;

  update public.purchase_order_lines pol
     set received_qty = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric,
         received_line_vat_sar = round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2)
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  insert into public.purchase_order_lines (
    purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar,
    received_qty, received_unit_price_sar, received_line_vat_sar
  )
  select p_po_id, (elem->>'part_id')::uuid,
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2),
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2)
  from jsonb_array_elements(p_lines) elem
  where (elem->>'part_id') is not null;

  update public.purchase_orders po
     set status = 'pending_approval', received_by = p_actor, received_date = current_date,
         received_subtotal_sar = agg.sub, received_vat_sar = agg.vat, received_total_sar = agg.sub + agg.vat
    from (
      select coalesce(sum(pol.received_qty * pol.received_unit_price_sar), 0) as sub,
             coalesce(sum(pol.received_line_vat_sar), 0) as vat
      from public.purchase_order_lines pol
      where pol.purchase_order_id = p_po_id and pol.received_qty is not null
    ) agg
   where po.id = p_po_id;

  select * into v_receipt from public.stock_receipts where id = v_receipt.id;
  return v_receipt;
end;
$$;

grant execute on function public.receive_purchase_order(uuid, jsonb, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- approve_stock_receipt — new, parallel to approve_purchase_order (0052,
-- unchanged, still live). Does NOT touch purchase_orders.
-- ----------------------------------------------------------------------------
drop function if exists public.approve_stock_receipt(uuid, text, text);

create or replace function public.approve_stock_receipt(
  p_receipt_id uuid,
  p_comment    text default null,
  p_actor      text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt        public.stock_receipts;
  v_approval_count integer;
begin
  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Receipt not found.';
  end if;
  if v_receipt.status <> 'pending_approval' then
    raise exception 'Only a receipt awaiting approval can be approved (current status: %).', v_receipt.status;
  end if;
  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor and active = true and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to approve receipts.';
  end if;

  perform 1 from public.stock_receipt_approvals
   where stock_receipt_id = p_receipt_id and approver_email = p_actor;
  if found then
    raise exception 'You have already approved this receipt.';
  end if;

  insert into public.stock_receipt_approvals (stock_receipt_id, approver_email, comment)
  values (p_receipt_id, p_actor, nullif(trim(p_comment), ''));

  select count(*) into v_approval_count
    from public.stock_receipt_approvals where stock_receipt_id = p_receipt_id;

  if v_approval_count >= 2 then
    update public.stock_receipts set status = 'approved' where id = p_receipt_id
    returning * into v_receipt;
  end if;

  return v_receipt;
end;
$$;

grant execute on function public.approve_stock_receipt(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- reject_stock_receipt — new. p_mode is 'void_cost' or 'remove_stock'. See
-- this file's own header note above: the hotfix for the
-- price_lots.stock_receipt_id column this body depends on lives in
-- 0058, not here — this is a verbatim record of what 0057 itself created.
-- ----------------------------------------------------------------------------
drop function if exists public.reject_stock_receipt(uuid, text, text, text);

create or replace function public.reject_stock_receipt(
  p_receipt_id uuid,
  p_mode       text,
  p_reason     text default null,
  p_actor      text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt   public.stock_receipts;
  v_consumed  boolean;
  v_lot       record;
begin
  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Receipt not found.';
  end if;
  if v_receipt.status <> 'pending_approval' then
    raise exception 'Only a receipt awaiting approval can be rejected (current status: %).', v_receipt.status;
  end if;
  if p_mode is null or p_mode not in ('void_cost', 'remove_stock') then
    raise exception 'Rejection mode must be void_cost or remove_stock.';
  end if;
  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor and active = true and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to reject receipts.';
  end if;

  if p_mode = 'void_cost' then
    for v_lot in
      select pl.id, pl.part_id from public.price_lots pl
       where pl.stock_receipt_id = p_receipt_id
       for update
    loop
      update public.price_lots set price_sar = 0 where id = v_lot.id;
    end loop;

    update public.parts p
       set unit_cost_sar = coalesce((
         select pl.price_sar from public.price_lots pl
          where pl.part_id = p.id and pl.qty_remaining > 0
          order by pl.received_on desc, pl.created_at desc limit 1
       ), 0)
     where p.id in (select distinct part_id from public.price_lots where stock_receipt_id = p_receipt_id);

  else  -- remove_stock
    select exists (
      select 1 from public.price_lots pl
       where pl.stock_receipt_id = p_receipt_id
         and pl.qty_remaining < pl.qty_purchased
    ) or exists (
      select 1 from public.stock_movements sm
       where sm.movement_type = 'consume'
         and sm.part_id in (select part_id from public.price_lots where stock_receipt_id = p_receipt_id)
         and sm.created_at >= v_receipt.created_at
    ) into v_consumed;

    if v_consumed then
      raise exception 'Cannot remove this receipt''s stock — some of it has already been consumed. Use void-cost instead.';
    end if;

    for v_lot in
      select pl.part_id, sum(pl.qty_remaining) as qty from public.price_lots pl
       where pl.stock_receipt_id = p_receipt_id
       group by pl.part_id
    loop
      update public.parts set qty_on_hand = qty_on_hand - v_lot.qty where id = v_lot.part_id;
      insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
      select v_lot.part_id, 'adjust', -v_lot.qty, qty_on_hand, 'Receipt rejected — stock removed', p_actor
        from public.parts where id = v_lot.part_id;
    end loop;

    delete from public.price_lots where stock_receipt_id = p_receipt_id;

    update public.parts p
       set unit_cost_sar = coalesce((
         select pl.price_sar from public.price_lots pl
          where pl.part_id = p.id and pl.qty_remaining > 0
          order by pl.received_on desc, pl.created_at desc limit 1
       ), 0)
     where p.id in (
       select distinct part_id from public.stock_receipt_lines where receipt_id = p_receipt_id
     );
  end if;

  update public.stock_receipts
     set status = 'rejected', rejected_by = p_actor, rejected_at = now(),
         rejection_reason = nullif(trim(p_reason), ''), rejection_mode = p_mode
   where id = p_receipt_id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.reject_stock_receipt(uuid, text, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification — this migration is already applied; these are
-- reference checks against the live database:
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='stock_receipts'
--      and column_name in ('status','receipt_type','rejected_by','rejected_at','rejection_reason','rejection_mode');
--   -- all 6 present.
--
--   select status, receipt_type, count(*), count(po_id) as with_po
--     from public.stock_receipts group by status, receipt_type;
--   -- every po_id-not-null row must show receipt_type='po'.
--
--   select oid::regprocedure from pg_proc
--    where proname in ('approve_stock_receipt','reject_stock_receipt');
--   -- exactly one row each.
-- ---------------------------------------------------------------------------
