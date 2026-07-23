-- 0050_purchase_orders.sql
-- Inventory — Phase 4 of the full-demo build-out: Purchase Orders CORE
-- (preview/'s INV.openNewPO / savePO / the "po" mode of the same draft
-- modal Phase 3's receive flow uses in manual mode). Migration only. No UI,
-- no app-code wrappers — those land in a follow-up step, same split Phase 3
-- used.
--
-- SCOPE THIS MIGRATION — draft -> issued ONLY:
--   public.purchase_orders, public.purchase_order_lines, a gap-free
--   po_number generator, create_purchase_order() (inserts a draft),
--   issue_purchase_order() (draft -> issued transition). That's it.
-- NOT in this migration (later phases, separate migrations, per the
-- Inventory build-in-phases plan — CLAUDE.md §7):
--   - PO receiving (Phase 5) — no received_qty/received_unit_price_sar
--     columns on purchase_order_lines yet. Preview's own PO lines DO carry
--     those fields already (initialized 0/null at creation), but this app's
--     own precedent (0047's header: "a PO-linked mode is a later addition,
--     not a column stubbed in now") is to not pre-stub columns a later
--     phase will add — Phase 5 ALTERs this table when receiving lands.
--   - Approvals (Phase 6) — no approvals table, no rejection columns. The
--     status CHECK below includes the full lifecycle value set ('received',
--     'pending_approval', 'approved', 'rejected') so Phase 5/6 don't need a
--     CHECK-constraint migration later, but nothing in THIS phase's RPCs can
--     ever produce those values — only 'draft'/'issued' are reachable here.
--   - Financial Analysis / AI-suggest-PO (Phase 7).
-- Does NOT touch 0043's warehouses/parts, 0044's receive_stock/adjust_stock,
-- 0045's suppliers, 0046's price_lots/add_price_lot/consume_from_lots,
-- 0047's stock_receipts*, 0048's suppliers.name_ar, or 0049's units — all
-- stay exactly as they are. Does NOT touch lib/prepaid.ts, lib/vat.ts,
-- lib/invoice.ts, or any customer-facing money — same internal-parts-cost-
-- only boundary as every prior Inventory migration.
--
-- *** A PO TOUCHES NO STOCK ***
-- create_purchase_order()/issue_purchase_order() never call add_price_lot,
-- never write price_lots, never touch parts.qty_on_hand/unit_cost_sar, and
-- never insert a stock_movements row. Issuing a PO is a paper commitment to
-- buy, not a receiving event — stock only moves when a PO is RECEIVED
-- (Phase 5, its own RPC, symmetrical to receive_loose_parts). Nothing here
-- creates an inventory movement.
--
-- PO NUMBER — gap-free, server-generated, NOT count(*)+1:
-- Preview's own nextPOId() is `PO-2026-${purchaseOrders.length+1}` — a
-- client-side count(*)+1 toy, exactly the race this app already fixed once
-- for invoice numbers (see 0034's header). Reusing that same fix instead of
-- inventing a new one: a per-year counter table
-- (po_number_counter: year int pk, next_number int) + an atomic
-- `UPDATE ... SET next_number = next_number + 1 ... RETURNING next_number-1`
-- inside next_po_number(p_year), identical shape to
-- next_invoice_number(p_year) (0034) / invoice_vat_ref_counter (0027) /
-- trip_ref_counter (0033). One UPDATE statement per Postgres session is
-- serialized by the row lock the UPDATE itself takes — no separate SELECT-
-- then-INSERT race window, no gaps, no duplicates under concurrency. Format
-- kept identical to preview's: `PO-{year}-{4-digit zero-padded}`
-- (e.g. PO-2026-0001) — only the generation MECHANISM changed, not the
-- shape callers/UI will see.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as 0044/0046/0047. All three functions in this file follow it, including
-- next_po_number.
--
-- WAREHOUSE/PART CONSISTENCY GUARD (create_purchase_order): one SKU lives
-- in exactly one warehouse (0043's model — parts.warehouse_id is not
-- multi-warehouse-split). Each line is checked that its part's
-- warehouse_id matches the PO's own p_warehouse_id — a PO for warehouse X
-- can never carry a line for a part whose home warehouse is Y, since that
-- part could never be validly received against this PO. Rejected with a
-- clear exception, not silently allowed or silently reassigned.
--
-- RLS: same "authenticated_all_<table>" pattern as every other table.
--
-- ON DELETE CHOICES:
--   purchase_orders.supplier_id / .warehouse_id -> RESTRICT. Same reasoning
--     as stock_receipts (0047): suppliers/warehouses are soft-deleted
--     (active flag), never hard-deleted — RESTRICT makes that a hard
--     guarantee, a historical PO can never be orphaned by either
--     disappearing.
--   purchase_order_lines.purchase_order_id -> CASCADE. Lines are owned,
--     dependent rows of their PO header — same precedent as
--     stock_receipt_lines.receipt_id (0047). No delete path exists on
--     purchase_orders yet (forward-looking, same as 0047's note).
--   purchase_order_lines.part_id -> RESTRICT, same reasoning/precedent as
--     price_lots.part_id (0046) / stock_receipt_lines.part_id (0047).

begin;

-- ----------------------------------------------------------------------------
-- po_number_counter / next_po_number(p_year) — gap-free yearly PO numbering.
-- Identical shape to invoice_number_counter/next_invoice_number (0034).
-- ----------------------------------------------------------------------------
create table if not exists public.po_number_counter (
  year        integer primary key,
  next_number integer not null default 1
);

alter table public.po_number_counter enable row level security;
drop policy if exists "authenticated_all_po_number_counter" on public.po_number_counter;
create policy "authenticated_all_po_number_counter"
  on public.po_number_counter for all to authenticated using (true) with check (true);

drop function if exists public.next_po_number(integer);

create or replace function public.next_po_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.po_number_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.po_number_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_po_number(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- purchase_orders — one row per PO header. status CHECK carries the FULL
-- lifecycle preview models (draft -> issued -> received -> pending_approval
-- -> approved OR rejected) even though only draft/issued are reachable
-- through this phase's two RPCs below — later phases extend behavior, not
-- this constraint.
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  po_number          text not null unique,
  supplier_id        uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id       uuid not null references public.warehouses(id) on delete restrict,
  status             text not null default 'draft'
    check (status in ('draft', 'issued', 'received', 'pending_approval', 'approved', 'rejected')),
  request_date       date not null default current_date,
  expected_delivery  date,
  note               text,
  -- Actor convention — same as stock_receipts.received_by / stock_movements
  -- .created_by: the authenticated user's email, read server-side, never a
  -- UI text field.
  requested_by       text,
  issued_at          timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists purchase_orders_supplier_id_idx
  on public.purchase_orders (supplier_id);
create index if not exists purchase_orders_warehouse_id_idx
  on public.purchase_orders (warehouse_id);
create index if not exists purchase_orders_status_idx
  on public.purchase_orders (status);

alter table public.purchase_orders enable row level security;
drop policy if exists "authenticated_all_purchase_orders" on public.purchase_orders;
create policy "authenticated_all_purchase_orders"
  on public.purchase_orders for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- purchase_order_lines — one row per part ordered on a given PO. Ordered
-- qty/price ONLY (planned amounts) — no received_qty/received_unit_price_sar
-- yet, see header note (Phase 5 adds those via ALTER TABLE when receiving
-- lands, not stubbed here).
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  part_id             uuid not null references public.parts(id) on delete restrict,
  qty                 numeric(12, 2) not null check (qty > 0),
  unit_price_sar       numeric(12, 2) not null check (unit_price_sar >= 0),
  created_at          timestamptz not null default now()
);

create index if not exists purchase_order_lines_po_id_idx
  on public.purchase_order_lines (purchase_order_id);
create index if not exists purchase_order_lines_part_id_idx
  on public.purchase_order_lines (part_id);

alter table public.purchase_order_lines enable row level security;
drop policy if exists "authenticated_all_purchase_order_lines" on public.purchase_order_lines;
create policy "authenticated_all_purchase_order_lines"
  on public.purchase_order_lines for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- create_purchase_order(p_supplier_id, p_warehouse_id, p_lines,
--                        p_expected_delivery, p_note, p_actor)
-- p_lines: jsonb array of {"part_id": uuid, "qty": numeric,
--          "unit_price_sar": numeric} — one per part ordered.
--
-- Inserts ONE purchase_orders row (status='draft', po_number generated via
-- next_po_number()) + N purchase_order_lines rows. Touches NOTHING else —
-- no price_lots, no parts.qty_on_hand, no stock_movements. One transaction:
-- any line failure rolls back the whole PO, no partial drafts. Every line's
-- part must belong to p_warehouse_id (see header's WAREHOUSE/PART
-- CONSISTENCY GUARD) — a mismatch fails the whole call.
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

    insert into public.purchase_order_lines (purchase_order_id, part_id, qty, unit_price_sar)
    values (v_po.id, v_part_id, v_qty, v_price);
  end loop;

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, jsonb, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- issue_purchase_order(p_po_id, p_actor)
-- draft -> issued ONLY. Refuses anything not currently 'draft' (issuing
-- twice, or issuing a PO some later phase moved past draft, is an error,
-- not a silent no-op). Row-locked (FOR UPDATE) so two concurrent issue
-- calls on the same PO can't both succeed. Touches NOTHING else — no
-- price_lots, no parts.qty_on_hand, no stock_movements. Issuing is a status
-- flip, never an inventory event.
-- ----------------------------------------------------------------------------
drop function if exists public.issue_purchase_order(uuid, text);

create or replace function public.issue_purchase_order(
  p_po_id uuid,
  p_actor text default null
) returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'draft' then
    raise exception 'Only a draft purchase order can be issued (current status: %).', v_po.status;
  end if;

  perform 1 from public.purchase_order_lines where purchase_order_id = p_po_id;
  if not found then
    raise exception 'Purchase order has no line items.';
  end if;

  update public.purchase_orders
     set status = 'issued',
         issued_at = now()
   where id = p_po_id
  returning * into v_po;

  return v_po;
end;
$$;

grant execute on function public.issue_purchase_order(uuid, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'create_purchase_order';
--   -- must return exactly ONE row:
--   -- create_purchase_order(uuid, uuid, jsonb, date, text, text)
--
--   select oid::regprocedure from pg_proc where proname = 'issue_purchase_order';
--   -- must return exactly ONE row:
--   -- issue_purchase_order(uuid, text)
--
--   -- A PO must never move stock — invariant unchanged after any call here:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return ZERO rows, exactly as before this migration
--
--   -- Smoke test (uses a real supplier_id/warehouse_id/part_id; part_id
--   -- MUST belong to that warehouse_id or this raises the new consistency-
--   -- guard exception; replace placeholders before running):
--   -- select * from public.create_purchase_order(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":10,"unit_price_sar":12.50}]'::jsonb,
--   --   null, 'Smoke test', 'you@example.com'
--   -- );
--   -- select * from public.issue_purchase_order('<po-uuid-from-above>', 'you@example.com');
--   -- po_number should read PO-<current year>-0001 (or next in sequence).
-- ---------------------------------------------------------------------------
