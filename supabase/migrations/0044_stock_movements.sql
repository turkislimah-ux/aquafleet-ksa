-- 0044_stock_movements.sql
-- Inventory — Slice 4: receive/adjust stock + audit ledger.
--
-- SCOPE: ONE table (stock_movements, append-only) + TWO RPCs
-- (receive_stock, adjust_stock). No UI wired in this migration — app-code
-- server-action wrappers land in a later slice, same as 0043's "no RPCs in
-- this migration" note worked the other way around.
--
-- WHAT THIS TOUCHES: public.parts.qty_on_hand and public.stock_movements
-- ONLY. Does NOT touch invoices/prepaid/VAT tables, and lib/prepaid.ts,
-- lib/vat.ts, lib/invoice.ts are untouched by this migration — parts cost/
-- qty is internal-only money (see 0043's MONEY NOTE), never customer-facing.
--
-- STOCK_MOVEMENTS: append-only audit ledger — nothing here is ever updated
-- or deleted, only inserted (by the two RPCs below, never directly by app
-- code). movement_type is a genuine two-value CHECK (not free text like
-- parts.category) — 'receive'/'adjust' are a fixed business rule, not an
-- open-ended taxonomy. part_id is ON DELETE RESTRICT, matching parts'
-- warehouse_id precedent (0043) — an audit ledger must never be orphaned by
-- its subject row disappearing (parts are soft-deleted via `active` anyway,
-- never hard-deleted, so this should never actually fire).
--
-- CREATED_BY: this app's actual established "who acted" convention (grepped
-- across every migration) is a free TEXT column — entered_by (0025),
-- approved_by (commission_payouts), unpaid_by (0027, "free text, matches
-- entered_by/approved_by precedent") — explicitly because there is NO
-- auth.uid()/auth.users usage anywhere in this codebase. `created_by text`
-- matches that precedent exactly, nullable, with NO FK to auth.users and NO
-- server-side auth.uid() auto-capture — it's populated only via an explicit
-- p_actor param the two RPCs below accept and pass straight through.
--
-- RLS: same "authenticated_all_<table>" pattern as every other table in this
-- app (0002, 0014, 0043) — full read/write for any logged-in user.
--
-- CONCURRENCY: both RPCs `select ... for update` the parts row before
-- computing qty_after, so two concurrent receive/adjust calls on the same
-- part serialize instead of racing — same row-lock-then-write shape as this
-- app's other atomic counters (e.g. invoice/trip-ref numbering).
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before every `create or replace function`, `security definer` +
-- `set search_path = public`, and `grant execute ... to authenticated` —
-- mirrors 0039's pay_invoice/unpay_invoice (the most recent RPC migration
-- before this one) exactly.

begin;

-- ----------------------------------------------------------------------------
-- stock_movements
-- ----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.parts(id) on delete restrict,
  -- Fixed business rule (only two movement kinds exist) — CHECK, not free
  -- text, unlike parts.category/warehouses.type (0043).
  movement_type text not null check (movement_type in ('receive', 'adjust')),
  -- Same numeric(12,2) convention as parts.qty_on_hand (0043) — these are
  -- quantity columns, reusing the app's numeric precision convention for
  -- consistency, not because they're money.
  qty_delta     numeric(12, 2) not null,
  qty_after     numeric(12, 2) not null,
  note          text,
  -- See header comment: explicit, app-supplied, nullable — no auth.users FK,
  -- no auto-capture.
  created_by    text,
  created_at    timestamptz not null default now()
);

-- Speeds up a part's movement history view (later slice) and the
-- warehouse-scoped ledger reads.
create index if not exists stock_movements_part_id_idx
  on public.stock_movements (part_id);

alter table public.stock_movements enable row level security;
drop policy if exists "authenticated_all_stock_movements" on public.stock_movements;
create policy "authenticated_all_stock_movements"
  on public.stock_movements for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- receive_stock(p_part_id, p_qty, p_note, p_actor)
-- Adds p_qty to parts.qty_on_hand, logs a 'receive' movement. p_qty must be
-- positive (receiving zero/negative stock isn't a "receive" — that's what
-- adjust_stock is for).
-- ----------------------------------------------------------------------------
drop function if exists public.receive_stock(uuid, numeric, text, text);

create or replace function public.receive_stock(
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
  v_part public.parts;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Received quantity must be positive.';
  end if;

  -- Lock the part row for the duration of this transaction so concurrent
  -- receive/adjust calls on the same part serialize instead of racing.
  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;

  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;

  update public.parts
     set qty_on_hand = v_part.qty_on_hand + p_qty
   where id = p_part_id
  returning * into v_part;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'receive', p_qty, v_part.qty_on_hand, nullif(trim(p_note), ''), p_actor);

  return v_part;
end;
$$;

grant execute on function public.receive_stock(uuid, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- adjust_stock(p_part_id, p_new_qty, p_note, p_actor)
-- Sets parts.qty_on_hand directly to p_new_qty (a correction, e.g. after a
-- physical count), logs an 'adjust' movement with the computed delta. Unlike
-- receive_stock, a reason note is REQUIRED — a manual correction to the
-- audit trail needs one, receiving new stock doesn't.
-- ----------------------------------------------------------------------------
drop function if exists public.adjust_stock(uuid, numeric, text, text);

create or replace function public.adjust_stock(
  p_part_id  uuid,
  p_new_qty  numeric,
  p_note     text,
  p_actor    text default null
) returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part    public.parts;
  v_old_qty numeric(12, 2);
  v_delta   numeric(12, 2);
  v_note    text;
begin
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'New quantity cannot be negative.';
  end if;

  v_note := nullif(trim(p_note), '');
  if v_note is null then
    raise exception 'Adjustment requires a note explaining the reason.';
  end if;

  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;

  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;

  v_old_qty := v_part.qty_on_hand;
  v_delta   := p_new_qty - v_old_qty;

  update public.parts
     set qty_on_hand = p_new_qty
   where id = p_part_id
  returning * into v_part;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'adjust', v_delta, v_part.qty_on_hand, v_note, p_actor);

  return v_part;
end;
$$;

grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'receive_stock';
--   -- must return exactly ONE row: receive_stock(uuid, numeric, text, text)
--
--   select oid::regprocedure from pg_proc where proname = 'adjust_stock';
--   -- must return exactly ONE row: adjust_stock(uuid, numeric, text, text)
-- ---------------------------------------------------------------------------
