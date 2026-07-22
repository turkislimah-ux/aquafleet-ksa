-- 0046_price_lots.sql
-- Inventory — Phase 2 of the full-demo build-out: FIFO price lots (preview/'s
-- `priceTiers` concept). Was flagged in 0043 as the biggest gap between the
-- v1 "one current cost" model and preview's real one: every receive there
-- creates a new costed batch, and consumption drains the OLDEST batch first
-- (FIFO), not a blended average. This migration builds that ledger. No UI —
-- app-code wrappers + drawer land in a later phase.
--
-- WHAT THIS TOUCHES: adds public.price_lots, extends
-- public.stock_movements.movement_type's CHECK, adds two RPCs
-- (add_price_lot, consume_from_lots). Does NOT touch lib/prepaid.ts,
-- lib/vat.ts, lib/invoice.ts, or any customer-facing money — same
-- internal-parts-cost-only boundary as 0043/0044. Does NOT touch or
-- deprecate 0044's receive_stock/adjust_stock — those two stay exactly as
-- they are; anything that phases them out (or routes them through lots) is
-- a later, separate step, not this migration.
--
-- RELATIONSHIP TO parts.unit_cost_sar / qty_on_hand: those two columns stay
-- exactly as 0043 defined them — a denormalized "current" cache (current
-- cost = most recent lot's price, qty_on_hand = live total). price_lots is
-- the real, structured, per-batch ledger underneath. Same "denormalized
-- snapshot vs. structured entity" split as parts.supplier (free text) vs.
-- the suppliers table (0045) — two mechanisms, deliberately not a
-- duplication. The two RPCs below are the ONLY things that write to lots,
-- and they keep both caches in sync every time, atomically.
--
-- INVARIANT (enforced by this migration, not just documented): for every
-- part, sum(price_lots.qty_remaining) == parts.qty_on_hand, always. Two
-- consequences:
--   1) add_price_lot / consume_from_lots lock the parts row FOR UPDATE
--      (same discipline as 0044) for the whole transaction, so concurrent
--      calls on the same part serialize instead of racing the invariant.
--   2) Pre-existing parts (created before this migration, entirely via
--      0043's plain insert / 0044's receive_stock/adjust_stock) have
--      qty_on_hand > 0 but zero lot rows — that would violate the invariant
--      from t=0. Backfilled below: one "opening balance" lot per such part,
--      priced at its current unit_cost_sar (0 if null — not fabricating a
--      cost history that doesn't exist), dated today. This is the same
--      "no backfill of history we don't have, but the running total must
--      still balance" precedent as 0038's legacy-invoice handling.
--
-- MOVEMENT_TYPE CHECK — decision: EXTEND, don't reuse 'receive'/'adjust'.
-- Reusing 'receive' would make a lot-backed receipt indistinguishable in
-- the ledger from a 0044 receive_stock call that never touched a lot —
-- the audit trail (stock_movements) exists precisely so you can tell those
-- apart later (e.g. once receive_stock is deprecated, "was this movement
-- lot-aware" needs to be answerable from history, not inferred). Same
-- reasoning for 'consume' vs 'adjust': adjust_stock is a manual correction
-- with an operator-authored reason note; consume_from_lots is a FIFO
-- drain driven by business logic (a later phase: PO receiving reversals,
-- work-order parts usage) with no operator "reason" — conflating the two
-- would blur "why did qty change" the same way the CHECK was designed to
-- prevent. Discovery-based ALTER (query pg_constraint, not a hardcoded
-- name) — 0044's inline CHECK auto-named itself, same as 0011's staff.role
-- precedent; this finds and drops it by definition-text match instead of
-- guessing the generated name.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before every `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as 0044's receive_stock/adjust_stock exactly.
--
-- RLS: same "authenticated_all_<table>" pattern as every other table in
-- this app.

begin;

-- ----------------------------------------------------------------------------
-- price_lots
-- One row per received batch. qty_purchased is the original batch size
-- (never mutated after insert — history); qty_remaining drains toward 0 as
-- consume_from_lots eats it oldest-first. A lot with qty_remaining = 0 is
-- fully consumed but stays (audit ledger, same append-only spirit as
-- stock_movements — never deleted).
-- ----------------------------------------------------------------------------
create table if not exists public.price_lots (
  id             uuid primary key default gen_random_uuid(),
  part_id        uuid not null references public.parts(id) on delete restrict,
  -- Internal parts cost only — same numeric(12,2) SAR convention as
  -- parts.unit_cost_sar (0043's MONEY NOTE applies here too).
  price_sar      numeric(12, 2) not null,
  qty_purchased  numeric(12, 2) not null,
  qty_remaining  numeric(12, 2) not null,
  received_on    date not null default current_date,
  note           text,
  created_at     timestamptz not null default now(),
  constraint price_lots_qty_purchased_nonneg check (qty_purchased >= 0),
  constraint price_lots_qty_remaining_range
    check (qty_remaining >= 0 and qty_remaining <= qty_purchased)
);

-- FIFO read pattern: "oldest remaining lot for this part" — received_on
-- first (business date), created_at as the tiebreaker for same-day batches
-- (insertion order).
create index if not exists price_lots_part_id_idx
  on public.price_lots (part_id);
create index if not exists price_lots_fifo_idx
  on public.price_lots (part_id, received_on, created_at)
  where qty_remaining > 0;

alter table public.price_lots enable row level security;
drop policy if exists "authenticated_all_price_lots" on public.price_lots;
create policy "authenticated_all_price_lots"
  on public.price_lots for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- stock_movements.movement_type — extend the fixed CHECK (discovery-based
-- drop, mirrors 0011's staff.role technique; name-agnostic since 0044's
-- inline check auto-named it).
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select con.conname as name
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'stock_movements'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%movement_type%'
  loop
    execute format('alter table public.stock_movements drop constraint %I', r.name);
  end loop;
end $$;

alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in ('receive', 'adjust', 'receive_lot', 'consume'));

-- ----------------------------------------------------------------------------
-- add_price_lot(p_part_id, p_price, p_qty, p_received_on, p_note, p_actor)
-- Records a new costed batch: inserts the lot, adds p_qty to
-- parts.qty_on_hand, sets parts.unit_cost_sar to this lot's price (the
-- "current cost" cache becomes the most-recently-received price — same
-- convention preview/'s partAvgCost-adjacent "latest tier" display expects),
-- logs a 'receive_lot' movement. p_qty must be positive.
-- ----------------------------------------------------------------------------
drop function if exists public.add_price_lot(uuid, numeric, numeric, date, text, text);

create or replace function public.add_price_lot(
  p_part_id      uuid,
  p_price        numeric,
  p_qty          numeric,
  p_received_on  date default current_date,
  p_note         text default null,
  p_actor        text default null
) returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Received quantity must be positive.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Price cannot be negative.';
  end if;

  -- Lock the part row for the duration of this transaction — same
  -- discipline as 0044's receive_stock/adjust_stock — so a concurrent
  -- add_price_lot/consume_from_lots on the same part serializes instead of
  -- racing the qty_on_hand <-> sum(qty_remaining) invariant.
  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;

  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;

  insert into public.price_lots (part_id, price_sar, qty_purchased, qty_remaining, received_on, note)
  values (p_part_id, p_price, p_qty, p_qty, coalesce(p_received_on, current_date), nullif(trim(p_note), ''));

  update public.parts
     set qty_on_hand   = v_part.qty_on_hand + p_qty,
         unit_cost_sar = p_price
   where id = p_part_id
  returning * into v_part;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'receive_lot', p_qty, v_part.qty_on_hand, nullif(trim(p_note), ''), p_actor);

  return v_part;
end;
$$;

grant execute on function public.add_price_lot(uuid, numeric, numeric, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- consume_from_lots(p_part_id, p_qty, p_note, p_actor)
-- Drains p_qty from the part's lots FIFO (oldest received_on/created_at
-- first), decrementing each lot's qty_remaining until satisfied. Subtracts
-- p_qty from parts.qty_on_hand and logs one 'consume' movement for the
-- whole call (not one per lot touched — the ledger records the net
-- business event; which lots funded it is reconstructable from price_lots
-- itself if ever needed). Raises if qty_on_hand can't cover p_qty, or if
-- the lot ledger itself is short (data-integrity guard — should never fire
-- if the invariant holds, but a hard stop beats silently going negative).
-- ----------------------------------------------------------------------------
drop function if exists public.consume_from_lots(uuid, numeric, text, text);

create or replace function public.consume_from_lots(
  p_part_id uuid,
  p_qty     numeric,
  p_note    text default null,
  p_actor   text default null
) returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part      public.parts;
  v_remaining numeric(12, 2);
  v_lot       record;
  v_take      numeric(12, 2);
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Consumed quantity must be positive.';
  end if;

  -- Lock the part row first — same ordering as add_price_lot, so the two
  -- never deadlock against each other on the same part.
  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;

  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;

  if v_part.qty_on_hand < p_qty then
    raise exception 'Not enough stock on hand: have %, requested %.', v_part.qty_on_hand, p_qty;
  end if;

  v_remaining := p_qty;

  -- Lock each candidate lot as we touch it (FOR UPDATE), oldest first.
  for v_lot in
    select id, qty_remaining
      from public.price_lots
     where part_id = p_part_id
       and qty_remaining > 0
     order by received_on asc, created_at asc
     for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_lot.qty_remaining, v_remaining);

    update public.price_lots
       set qty_remaining = qty_remaining - v_take
     where id = v_lot.id;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    -- The lot ledger couldn't cover it even though qty_on_hand said it
    -- could — a data-integrity break (e.g. missed backfill). Stop hard
    -- rather than let qty_on_hand and sum(qty_remaining) diverge further.
    raise exception 'Price-lot ledger is short by % for part %; qty_on_hand and lots have drifted.', v_remaining, p_part_id;
  end if;

  update public.parts
     set qty_on_hand = v_part.qty_on_hand - p_qty
   where id = p_part_id
  returning * into v_part;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'consume', -p_qty, v_part.qty_on_hand, nullif(trim(p_note), ''), p_actor);

  return v_part;
end;
$$;

grant execute on function public.consume_from_lots(uuid, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Backfill — required for the invariant to hold from t=0. Every existing
-- part with qty_on_hand > 0 and no lot rows yet gets exactly one "opening
-- balance" lot: qty_purchased = qty_remaining = current qty_on_hand, priced
-- at the part's current unit_cost_sar (0 if null — we don't know its real
-- historical cost, and fabricating one would be worse than admitting it's
-- unknown), dated today. Idempotent: only touches parts with zero existing
-- lots, so re-running this migration is a no-op the second time.
-- ----------------------------------------------------------------------------
insert into public.price_lots (part_id, price_sar, qty_purchased, qty_remaining, received_on, note)
select p.id,
       coalesce(p.unit_cost_sar, 0),
       p.qty_on_hand,
       p.qty_on_hand,
       current_date,
       'Opening balance (pre-FIFO backfill)'
  from public.parts p
 where p.qty_on_hand > 0
   and not exists (
     select 1 from public.price_lots pl where pl.part_id = p.id
   );

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'add_price_lot';
--   -- must return exactly ONE row: add_price_lot(uuid, numeric, numeric, date, text, text)
--
--   select oid::regprocedure from pg_proc where proname = 'consume_from_lots';
--   -- must return exactly ONE row: consume_from_lots(uuid, numeric, text, text)
--
--   -- Invariant check — must return ZERO rows:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
-- ---------------------------------------------------------------------------
