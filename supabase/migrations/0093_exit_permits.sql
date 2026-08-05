-- 0093_exit_permits.sql
-- Consumption page, Phase 1 — EXIT PERMITS.
--
-- A permit is a gate pass for parts leaving a warehouse for NON-maintenance
-- reasons. This is the first money-touching schema since maintenance, so it
-- follows the money rules exactly: stock moves ONLY through the existing
-- add_price_lot / consume_from_lots / return_to_lots family, every stock-
-- moving step is an RPC, and a per-lot ledger records cost + receipt lineage
-- so a return or a void can reverse precisely rather than approximately.
--
-- ===========================================================================
-- TWO FINDINGS FROM READING THE LIVE HELPERS — BOTH CHANGE THE DESIGN
-- ===========================================================================
-- The brief said returns would restore stock "via return_to_lots". Having
-- read the live definitions rather than assuming, that is NOT POSSIBLE, and
-- the second finding is subtler and more important. Both are the reason this
-- migration adds two permit-specific helpers instead of calling the existing
-- ones directly.
--
-- FINDING 1 — return_to_lots is hard-wired to work orders. Its signature is
--   return_to_lots(p_work_order_part_id uuid, p_qty numeric, p_actor text)
-- and its body reads public.work_order_parts by that id, reads
-- work_orders.wo_number, reads AND writes work_order_part_consumptions, and
-- finally updates work_order_parts.unit_price_sar. There is no part_id or
-- generic-line parameter anywhere in it. An exit-permit line cannot be passed
-- to it at all.
--
--   Options considered:
--   (a) Generalise return_to_lots to take a polymorphic line reference —
--       REJECTED. It is live and load-bearing for maintenance reversal;
--       changing its signature or body to serve a second caller puts a
--       working money path at risk for no benefit to that caller.
--   (b) A permit-specific sibling with the SAME algorithm against the
--       permit's own ledger — CHOSEN, below, as return_exit_permit_line().
--       Same FIFO-reversal logic, same over-return guard, same weighted-
--       average recompute; different ledger table. Maintenance is untouched.
--
-- FINDING 2 — consume_from_lots does NOT report which lots it drew from.
-- It walks price_lots FIFO, decrements them, updates parts.qty_on_hand and
-- writes one stock_movements row, then returns the PARTS row. Nothing in its
-- return value identifies the lots. So a per-lot ledger cannot be built from
-- its output.
--
-- How the house actually solves this (consume_work_order_line, live): it
-- performs its OWN FIFO walk over price_lots in the same order
-- (received_on asc, created_at asc) writing the ledger rows, and THEN calls
-- consume_from_lots to do the real decrement. Two passes over the same
-- ordering: the first only reads and records, the second mutates. That is
-- the pattern consume_exit_permit_line() below mirrors EXACTLY — same order
-- clause, same short-ledger guard, same trailing weighted-average update.
-- Deviating from it would risk the two passes disagreeing about which lots
-- were involved, which is precisely how a cost figure goes quietly wrong.
--
-- ===========================================================================
-- LIFECYCLE — the state machine to review
-- ===========================================================================
--   draft  --confirm_exit_permit()-->  exited  --void_exit_permit()--> voided
--                                        |
--                                        +--record_exit_permit_return()--> (stays exited)
--
--   draft   paperwork only. NO stock movement, no EP number, freely editable
--           and deletable by plain writes gated on status='draft' — no RPC,
--           because nothing has moved yet and there is no invariant to
--           protect. Deleting a draft leaves no numbering gap because the
--           number is not claimed until exit.
--   exited  the money moment has happened: stock deducted, per-lot ledger
--           written, FIFO cost stamped on each line, EP number assigned.
--   voided  terminal. Restores only what is still OUTSTANDING (see below).
--
-- RETURNS apply to RETURNABLE permits only and do NOT change status — a
-- partly-returned permit is still an exited permit. Multiple return events
-- per permit, each carrying per-line quantities.
--
-- VOID vs RETURNS — the interaction worth reviewing closely. Void restores
-- ONLY the still-outstanding quantity per line:
--     outstanding = qty_exited - qty_returned_so_far
-- Returns have already restored their own share, so voiding after a partial
-- return must not restore that share a second time. The ledger makes this
-- exact rather than inferred: the net per lot is
--     sum(consume) - sum(return)
-- and return_exit_permit_line() walks only lots with a positive net, so it
-- is structurally incapable of returning more than was taken. A permit with
-- everything already returned voids cleanly with zero stock movement.
--
-- ===========================================================================
-- DESTINATION — nullable FKs + CHECK, not a polymorphic pair
-- ===========================================================================
-- Following the archive's subject pattern (0084 decision 1) rather than a
-- (target_type, target_id) pair: four nullable FK columns with a CHECK that
-- at most one is set, plus 'other' + free text. Real referential integrity
-- per target, and a deleted station/project/truck/customer cannot silently
-- orphan a permit.
--
-- 0077 EMBED HAZARD — cleared. Four new FKs, but each is the FIRST and ONLY
-- FK for its table pair: exit_permits -> water_stations / projects / trucks /
-- customers are four DIFFERENT target tables. The 0077 incident was a SECOND
-- FK between the SAME pair (trucks had two to drivers). Every embed here
-- stays unambiguous. Same for exit_permits -> warehouses and -> staff.
--
-- ON DELETE RESTRICT on all of them: a permit is a gate-pass record of
-- something that physically happened, so its destination must not be
-- deletable out from under it — same reasoning as the archive's subject FKs.
--
-- ===========================================================================
-- NUMBERING — EP-YY-####, claimed at exit only
-- ===========================================================================
-- ep_number_counter + next_ep_number(year) mirror wo_number_counter /
-- next_wo_number exactly (verified against the live definitions). Claimed
-- inside confirm_exit_permit, so a deleted draft leaves no gap. Drafts render
-- "Draft" client-side — ep_number stays NULL until exit, which is also what
-- makes the partial unique index below meaningful.
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- Every function here is SECURITY DEFINER + `set search_path = public`.
-- DEFINER is correct (unlike the archive's guard triggers) because these
-- functions write price_lots, parts and stock_movements on behalf of a caller
-- who must not be able to write them directly.
--
-- THE SIX FUNCTIONS SPLIT INTO TWO TIERS, and the split is a real security
-- boundary rather than tidiness:
--
--   ORCHESTRATORS — callable by `authenticated`:
--       confirm_exit_permit, record_exit_permit_return, void_exit_permit
--     Each represents a complete, self-consistent PERMIT EVENT. They claim
--     the number, write the event rows, keep qty_returned in step, and only
--     then move stock.
--
--   INTERNALS — callable by NOBODY (revoked from public, anon, authenticated
--   AND service_role):
--       next_ep_number, consume_exit_permit_line, return_exit_permit_line
--     These move stock or claim a number WITHOUT any surrounding event, so a
--     direct call would leave the books inconsistent. The sharp example:
--     return_exit_permit_line called on its own restores lots and
--     qty_on_hand but never bumps exit_permit_lines.qty_returned — and
--     qty_returned is exactly what void_exit_permit reads to decide what is
--     still outstanding. One direct call and a later void would restore that
--     quantity a SECOND time. Revoking is what makes that unreachable rather
--     than merely undocumented.
--
--     DEFINER nesting is why this costs nothing: the orchestrators run as the
--     owner, so they can still call the internals fine.
--
-- WHY service_role IS REVOKED EXPLICITLY: Supabase's own `alter default
-- privileges` grants EXECUTE on every new function to authenticated AND
-- service_role at creation time (confirmed live while reconciling 0087/0092).
-- Revoking only public and anon would therefore leave BOTH of those grants
-- standing. The revoke lines below name all four roles for that reason.
--
-- ===========================================================================
-- WHAT IS NOT HERE, DELIBERATELY
-- ===========================================================================
--  - APPROVALS. Phase 2, mirroring purchase_order_approvals, non-blocking,
--    covering permits AND work-order draws including history. No column is
--    reserved for it here — adding one now would be a guess at a shape that
--    phase will decide.
--  - RBAC. Any authenticated user can act, per the stated default. The RPCs
--    take an actor string for the record, exactly like every other actor
--    field in this app; they do not enforce a role.
--  - OVERDUE. A returnable past its expected_return_on is a DERIVED state,
--    computed at read like every other status in this app (driver state,
--    truck status, archive expiry). No stored flag, nothing to go stale.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE ONLY: 6 new tables, 5 new functions, 1 new private bucket.
--    No existing table, column, function, policy or row is altered.
--    consume_from_lots / return_to_lots / consume_work_order_line /
--    deduct_work_order_parts are READ but NOT MODIFIED.
--  - stock_movements needs no CHECK change: the permit path writes only
--    'consume' (via consume_from_lots) and 'return' (directly, exactly as
--    return_to_lots already does), both already permitted by 0046's CHECK.
--  - Re-runnable: `create table if not exists`, `create or replace function`,
--    guarded policy drops, `on conflict do nothing` on the bucket.
--
-- PRE-FLIGHT (run before applying):
--   select to_regclass('public.exit_permits') as should_be_null;
--   select id from storage.buckets where id = 'exit-permits';  -- expect 0 rows

begin;

-- ---------------------------------------------------------------------------
-- 1) Numbering counter — mirrors wo_number_counter exactly.
-- ---------------------------------------------------------------------------
create table if not exists public.ep_number_counter (
  year        integer primary key,
  next_number integer not null
);

alter table public.ep_number_counter enable row level security;
drop policy if exists "authenticated_all_ep_number_counter" on public.ep_number_counter;
create policy "authenticated_all_ep_number_counter"
  on public.ep_number_counter for all to authenticated using (true) with check (true);

create or replace function public.next_ep_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_number integer;
begin
  insert into public.ep_number_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.ep_number_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$function$;

-- INTERNAL — not callable by any app role. See the security note in the
-- header for why authenticated and service_role are revoked too.
revoke execute on function public.next_ep_number(integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) exit_permits — the header.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permits (
  id            uuid primary key default gen_random_uuid(),

  -- NULL until confirm_exit_permit claims one. The partial unique index below
  -- enforces uniqueness only over claimed numbers, so any number of drafts
  -- can coexist.
  ep_number     text,

  status        text not null default 'draft'
                  check (status in ('draft', 'exited', 'voided')),

  -- RETURNABLE requires an expected return date; PERMANENT must not carry
  -- one. Enforced below rather than left to the form.
  kind          text not null check (kind in ('returnable', 'permanent')),
  expected_return_on date,

  -- ONE warehouse per permit. Every line's part must belong to it — enforced
  -- in confirm_exit_permit, where it actually matters, and surfaced in the UI
  -- so the picker never offers a part that would be rejected.
  warehouse_id  uuid not null references public.warehouses(id) on delete restrict,

  -- DESTINATION — at most one FK set, or 'other' with free text.
  destination_kind text not null
    check (destination_kind in ('water_station', 'project', 'truck', 'customer', 'other')),
  destination_water_station_id uuid references public.water_stations(id) on delete restrict,
  destination_project_id       uuid references public.projects(id)       on delete restrict,
  destination_truck_id         uuid references public.trucks(id)         on delete restrict,
  destination_customer_id      uuid references public.customers(id)      on delete restrict,
  destination_other_text       text,

  -- RECEIVER — a staff member OR a free-text external name, never both.
  receiver_staff_id uuid references public.staff(id) on delete restrict,
  receiver_name     text,

  carrier_name  text,
  note          text,

  issued_by     text,
  exited_at     timestamptz,
  exited_by     text,
  voided_at     timestamptz,
  voided_by     text,
  void_reason   text,

  created_by    text,
  created_at    timestamptz not null default now(),

  -- The destination FK matches its declared kind, and exactly one is set.
  constraint exit_permits_destination_shape check (
    (destination_kind = 'water_station'
       and destination_water_station_id is not null
       and num_nonnulls(destination_project_id, destination_truck_id, destination_customer_id) = 0)
    or (destination_kind = 'project'
       and destination_project_id is not null
       and num_nonnulls(destination_water_station_id, destination_truck_id, destination_customer_id) = 0)
    or (destination_kind = 'truck'
       and destination_truck_id is not null
       and num_nonnulls(destination_water_station_id, destination_project_id, destination_customer_id) = 0)
    or (destination_kind = 'customer'
       and destination_customer_id is not null
       and num_nonnulls(destination_water_station_id, destination_project_id, destination_truck_id) = 0)
    or (destination_kind = 'other'
       and num_nonnulls(destination_water_station_id, destination_project_id,
                        destination_truck_id, destination_customer_id) = 0
       and nullif(trim(destination_other_text), '') is not null)
  ),

  -- Exactly one receiver identity.
  constraint exit_permits_receiver_shape check (
    (receiver_staff_id is not null and receiver_name is null)
    or (receiver_staff_id is null and nullif(trim(receiver_name), '') is not null)
  ),

  -- A returnable states when it is due back; a permanent one cannot.
  constraint exit_permits_return_date_shape check (
    (kind = 'returnable' and expected_return_on is not null)
    or (kind = 'permanent' and expected_return_on is null)
  ),

  -- A number exists exactly when the permit has left. Voided keeps its
  -- number — the physical document went out and the record must stay
  -- findable by it.
  constraint exit_permits_number_shape check (
    (status = 'draft' and ep_number is null)
    or (status in ('exited', 'voided') and ep_number is not null)
  )
);

create unique index if not exists exit_permits_ep_number_uniq
  on public.exit_permits (ep_number) where ep_number is not null;
create index if not exists exit_permits_status_idx on public.exit_permits (status, created_at desc);
create index if not exists exit_permits_warehouse_idx on public.exit_permits (warehouse_id);

alter table public.exit_permits enable row level security;
drop policy if exists "authenticated_all_exit_permits" on public.exit_permits;
create policy "authenticated_all_exit_permits"
  on public.exit_permits for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) exit_permit_lines — inventory parts only.
--
--    unit_price_sar is the FIFO cost STAMPED at exit, recomputed as the
--    weighted average of the line's own ledger whenever that ledger changes
--    (exit, return, void) — same treatment work_order_parts.unit_price_sar
--    gets. It is 0 on a draft because nothing has been drawn yet; that is
--    honest, not a placeholder.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permit_lines (
  id             uuid primary key default gen_random_uuid(),
  exit_permit_id uuid not null references public.exit_permits(id) on delete cascade,
  part_id        uuid not null references public.parts(id) on delete restrict,
  qty            numeric(12, 2) not null check (qty > 0),
  unit_price_sar numeric(12, 2) not null default 0,
  -- Running total of what has come back on this line. Only
  -- record_exit_permit_return writes it; never the app.
  qty_returned   numeric(12, 2) not null default 0 check (qty_returned >= 0),
  note           text,
  created_at     timestamptz not null default now(),
  constraint exit_permit_lines_not_over_returned check (qty_returned <= qty)
);

create index if not exists exit_permit_lines_permit_idx on public.exit_permit_lines (exit_permit_id);
create index if not exists exit_permit_lines_part_idx on public.exit_permit_lines (part_id);

alter table public.exit_permit_lines enable row level security;
drop policy if exists "authenticated_all_exit_permit_lines" on public.exit_permit_lines;
create policy "authenticated_all_exit_permit_lines"
  on public.exit_permit_lines for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) exit_permit_line_consumptions — the per-lot ledger.
--
--    Deliberately the SAME shape as work_order_part_consumptions (0065):
--    one row per (line, lot, direction), append-only, never updated. This is
--    what makes a return or a void exact — it names the lot each unit came
--    from and the price it came in at, so stock goes back to the lot it left.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permit_line_consumptions (
  id                  uuid primary key default gen_random_uuid(),
  exit_permit_line_id uuid not null references public.exit_permit_lines(id) on delete cascade,
  price_lot_id        uuid not null references public.price_lots(id) on delete restrict,
  direction           text not null check (direction in ('consume', 'return')),
  qty                 numeric(12, 2) not null check (qty > 0),
  unit_price_sar      numeric(12, 2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists exit_permit_line_consumptions_line_idx
  on public.exit_permit_line_consumptions (exit_permit_line_id);
create index if not exists exit_permit_line_consumptions_lot_idx
  on public.exit_permit_line_consumptions (price_lot_id);

alter table public.exit_permit_line_consumptions enable row level security;
drop policy if exists "authenticated_all_exit_permit_line_consumptions" on public.exit_permit_line_consumptions;
create policy "authenticated_all_exit_permit_line_consumptions"
  on public.exit_permit_line_consumptions for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5) Return EVENTS — a header per event + its per-line quantities.
--
--    Two tables rather than one flat table because a return is a real-world
--    event ("the driver brought three of them back on Tuesday") that can
--    cover several lines at once. One table would either lose the grouping
--    or repeat the event metadata on every line.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permit_returns (
  id             uuid primary key default gen_random_uuid(),
  exit_permit_id uuid not null references public.exit_permits(id) on delete cascade,
  returned_on    date not null default current_date,
  note           text,
  created_by     text,
  created_at     timestamptz not null default now()
);

create index if not exists exit_permit_returns_permit_idx on public.exit_permit_returns (exit_permit_id);

alter table public.exit_permit_returns enable row level security;
drop policy if exists "authenticated_all_exit_permit_returns" on public.exit_permit_returns;
create policy "authenticated_all_exit_permit_returns"
  on public.exit_permit_returns for all to authenticated using (true) with check (true);

create table if not exists public.exit_permit_return_lines (
  id                   uuid primary key default gen_random_uuid(),
  exit_permit_return_id uuid not null references public.exit_permit_returns(id) on delete cascade,
  exit_permit_line_id  uuid not null references public.exit_permit_lines(id) on delete restrict,
  qty                  numeric(12, 2) not null check (qty > 0),
  created_at           timestamptz not null default now()
);

create index if not exists exit_permit_return_lines_return_idx
  on public.exit_permit_return_lines (exit_permit_return_id);
create index if not exists exit_permit_return_lines_line_idx
  on public.exit_permit_return_lines (exit_permit_line_id);

alter table public.exit_permit_return_lines enable row level security;
drop policy if exists "authenticated_all_exit_permit_return_lines" on public.exit_permit_return_lines;
create policy "authenticated_all_exit_permit_return_lines"
  on public.exit_permit_return_lines for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6) Attachments — child table + private bucket, the established pattern.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permit_files (
  id             uuid primary key default gen_random_uuid(),
  exit_permit_id uuid not null references public.exit_permits(id) on delete cascade,
  storage_path   text not null,
  file_name      text not null,
  mime_type      text,
  uploaded_by    text,
  uploaded_at    timestamptz not null default now()
);

create index if not exists exit_permit_files_permit_idx on public.exit_permit_files (exit_permit_id);

alter table public.exit_permit_files enable row level security;
drop policy if exists "authenticated_all_exit_permit_files" on public.exit_permit_files;
create policy "authenticated_all_exit_permit_files"
  on public.exit_permit_files for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('exit-permits', 'exit-permits', false)
on conflict (id) do nothing;

drop policy if exists "exit_permits_select" on storage.objects;
create policy "exit_permits_select" on storage.objects
  for select to authenticated using (bucket_id = 'exit-permits');
drop policy if exists "exit_permits_insert" on storage.objects;
create policy "exit_permits_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'exit-permits');
drop policy if exists "exit_permits_update" on storage.objects;
create policy "exit_permits_update" on storage.objects
  for update to authenticated using (bucket_id = 'exit-permits');
drop policy if exists "exit_permits_delete" on storage.objects;
create policy "exit_permits_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'exit-permits');

-- ---------------------------------------------------------------------------
-- 7) consume_exit_permit_line — MIRRORS consume_work_order_line exactly.
--
--    Two FIFO passes in the same order, for the reason given in FINDING 2:
--    this one reads price_lots and writes the ledger, then consume_from_lots
--    does the actual decrement, the parts update and the stock_movements row.
--    The ordering clause (received_on asc, created_at asc) is identical in
--    both so the two passes cannot disagree about which lots were involved.
-- ---------------------------------------------------------------------------
create or replace function public.consume_exit_permit_line(
  p_exit_permit_line_id uuid,
  p_qty numeric,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_part_id   uuid;
  v_permit_id uuid;
  v_ep_number text;
  v_remaining numeric(12, 2);
  v_take      numeric(12, 2);
  v_lot       record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Consume quantity must be positive.';
  end if;

  select part_id, exit_permit_id into v_part_id, v_permit_id
    from public.exit_permit_lines
   where id = p_exit_permit_line_id
   for update;
  if v_part_id is null then
    raise exception 'Exit permit line not found.';
  end if;

  select ep_number into v_ep_number from public.exit_permits where id = v_permit_id;

  v_remaining := p_qty;

  for v_lot in
    select id, qty_remaining, price_sar
      from public.price_lots
     where part_id = v_part_id
       and qty_remaining > 0
     order by received_on asc, created_at asc
     for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_lot.qty_remaining, v_remaining);

    insert into public.exit_permit_line_consumptions
      (exit_permit_line_id, price_lot_id, direction, qty, unit_price_sar)
    values
      (p_exit_permit_line_id, v_lot.id, 'consume', v_take, v_lot.price_sar);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Price-lot ledger is short for exit permit % — qty_on_hand and lots have drifted.',
      coalesce(v_ep_number, '(draft)');
  end if;

  perform public.consume_from_lots(v_part_id, p_qty,
    'Exit permit ' || coalesce(v_ep_number, '(draft)'), p_actor);

  update public.exit_permit_lines
     set unit_price_sar = (
       select sum(case when c.direction = 'consume' then c.qty * c.unit_price_sar else -(c.qty * c.unit_price_sar) end)
              / nullif(sum(case when c.direction = 'consume' then c.qty else -c.qty end), 0)
         from public.exit_permit_line_consumptions c
        where c.exit_permit_line_id = p_exit_permit_line_id
     )
   where id = p_exit_permit_line_id;
end;
$function$;

-- INTERNAL — not callable by any app role. See the security note in the
-- header for why authenticated and service_role are revoked too.
revoke execute on function public.consume_exit_permit_line(uuid, numeric, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) return_exit_permit_line — MIRRORS return_to_lots' algorithm.
--
--    See FINDING 1: return_to_lots itself cannot be reused. This is the same
--    logic against exit_permit_line_consumptions — walk the line's own lots
--    newest-touched first, restore only where the NET is positive, refuse to
--    put back more than a lot ever held, append 'return' ledger rows, then
--    one parts update and one stock_movements row for the whole reversal.
--
--    Because it walks only positive-net lots, it is structurally incapable of
--    returning more than was taken — which is what makes void-after-partial-
--    return safe without any extra bookkeeping.
-- ---------------------------------------------------------------------------
create or replace function public.return_exit_permit_line(
  p_exit_permit_line_id uuid,
  p_qty numeric,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_part_id        uuid;
  v_permit_id      uuid;
  v_ep_number      text;
  v_remaining      numeric(12, 2);
  v_take           numeric(12, 2);
  v_total_returned numeric(12, 2) := 0;
  v_lot            record;
  v_purchased      numeric(12, 2);
  v_new_remaining  numeric(12, 2);
  v_after          numeric(12, 2);
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Return quantity must be positive.';
  end if;

  select part_id, exit_permit_id into v_part_id, v_permit_id
    from public.exit_permit_lines
   where id = p_exit_permit_line_id
   for update;
  if v_part_id is null then
    raise exception 'Exit permit line not found.';
  end if;

  select ep_number into v_ep_number from public.exit_permits where id = v_permit_id;

  v_remaining := p_qty;

  for v_lot in
    select c.price_lot_id,
           sum(case when c.direction = 'consume' then c.qty else -c.qty end) as net_qty,
           max(c.created_at) as last_touched
      from public.exit_permit_line_consumptions c
     where c.exit_permit_line_id = p_exit_permit_line_id
     group by c.price_lot_id
    having sum(case when c.direction = 'consume' then c.qty else -c.qty end) > 0
     order by last_touched desc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_lot.net_qty, v_remaining);

    update public.price_lots
       set qty_remaining = qty_remaining + v_take
     where id = v_lot.price_lot_id
    returning qty_purchased, qty_remaining into v_purchased, v_new_remaining;

    if v_new_remaining > v_purchased then
      raise exception 'Return would put back more stock than lot % ever held.', v_lot.price_lot_id;
    end if;

    insert into public.exit_permit_line_consumptions
      (exit_permit_line_id, price_lot_id, direction, qty, unit_price_sar)
    select p_exit_permit_line_id, v_lot.price_lot_id, 'return', v_take, price_sar
      from public.price_lots where id = v_lot.price_lot_id;

    v_remaining := v_remaining - v_take;
    v_total_returned := v_total_returned + v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Cannot return % for this line — only % is net-consumed against tracked lots.',
      p_qty, v_total_returned;
  end if;

  update public.parts
     set qty_on_hand = qty_on_hand + v_total_returned
   where id = v_part_id
  returning qty_on_hand into v_after;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (v_part_id, 'return', v_total_returned, v_after,
          'Return against exit permit ' || coalesce(v_ep_number, '(draft)'), p_actor);

  update public.exit_permit_lines
     set unit_price_sar = coalesce((
       select sum(case when c.direction = 'consume' then c.qty * c.unit_price_sar else -(c.qty * c.unit_price_sar) end)
              / nullif(sum(case when c.direction = 'consume' then c.qty else -c.qty end), 0)
         from public.exit_permit_line_consumptions c
        where c.exit_permit_line_id = p_exit_permit_line_id
     ), unit_price_sar)
   where id = p_exit_permit_line_id;
end;
$function$;

-- INTERNAL — not callable by any app role. See the security note in the
-- header for why authenticated and service_role are revoked too.
revoke execute on function public.return_exit_permit_line(uuid, numeric, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) confirm_exit_permit — THE MONEY MOMENT.
--
--    Claims the number, deducts every line, stamps the FIFO cost, flips the
--    status. All in one transaction: a permit cannot end up numbered but
--    un-deducted, or deducted without a number.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_exit_permit(
  p_permit_id uuid,
  p_actor text default null
)
returns public.exit_permits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_permit    public.exit_permits;
  v_line      record;
  v_year      integer;
  v_seq       integer;
  v_bad_part  text;
  v_count     integer;
begin
  select * into v_permit from public.exit_permits where id = p_permit_id for update;
  if v_permit.id is null then
    raise exception 'Exit permit not found.';
  end if;
  if v_permit.status <> 'draft' then
    raise exception 'Only a draft permit can be confirmed (this one is %).', v_permit.status;
  end if;

  select count(*) into v_count from public.exit_permit_lines where exit_permit_id = p_permit_id;
  if v_count = 0 then
    raise exception 'A permit must have at least one line before it can leave.';
  end if;

  -- Every line's part must belong to the permit's own warehouse. Checked here
  -- rather than by a constraint because it is a cross-table rule; the UI
  -- also restricts the picker so this should never fire in normal use.
  select p.name into v_bad_part
    from public.exit_permit_lines l
    join public.parts p on p.id = l.part_id
   where l.exit_permit_id = p_permit_id
     and p.warehouse_id is distinct from v_permit.warehouse_id
   limit 1;
  if v_bad_part is not null then
    raise exception 'Part "%" does not belong to this permit''s warehouse.', v_bad_part;
  end if;

  v_year := extract(year from now())::integer;
  v_seq  := public.next_ep_number(v_year);

  update public.exit_permits
     set ep_number = 'EP-' || to_char(v_year % 100, 'FM00') || '-' || to_char(v_seq, 'FM0000'),
         status    = 'exited',
         exited_at = now(),
         exited_by = p_actor
   where id = p_permit_id
  returning * into v_permit;

  -- Deduct AFTER the number exists, so the ledger's stock_movements note and
  -- the permit's own number agree.
  for v_line in
    select id, qty from public.exit_permit_lines where exit_permit_id = p_permit_id
  loop
    perform public.consume_exit_permit_line(v_line.id, v_line.qty, p_actor);
  end loop;

  return v_permit;
end;
$function$;

revoke execute on function public.confirm_exit_permit(uuid, text) from public, anon;
grant execute on function public.confirm_exit_permit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) record_exit_permit_return — a partial, multi-line return event.
--
--     p_lines is [{"line_id": uuid, "qty": numeric}, ...].
-- ---------------------------------------------------------------------------
create or replace function public.record_exit_permit_return(
  p_permit_id uuid,
  p_lines jsonb,
  p_returned_on date default current_date,
  p_note text default null,
  p_actor text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_permit    public.exit_permits;
  v_return_id uuid;
  v_el        jsonb;
  v_line_id   uuid;
  v_qty       numeric(12, 2);
  v_line      public.exit_permit_lines;
begin
  select * into v_permit from public.exit_permits where id = p_permit_id for update;
  if v_permit.id is null then
    raise exception 'Exit permit not found.';
  end if;
  if v_permit.status <> 'exited' then
    raise exception 'Only an exited permit can take returns (this one is %).', v_permit.status;
  end if;
  if v_permit.kind <> 'returnable' then
    raise exception 'This permit is permanent — its items are not expected back.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A return must name at least one line.';
  end if;

  insert into public.exit_permit_returns (exit_permit_id, returned_on, note, created_by)
  values (p_permit_id, coalesce(p_returned_on, current_date), nullif(trim(p_note), ''), p_actor)
  returning id into v_return_id;

  for v_el in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_el ->> 'line_id')::uuid;
    v_qty     := (v_el ->> 'qty')::numeric;

    select * into v_line from public.exit_permit_lines
     where id = v_line_id and exit_permit_id = p_permit_id
     for update;
    if v_line.id is null then
      raise exception 'Line % does not belong to this permit.', v_line_id;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Return quantity must be positive.';
    end if;
    if v_line.qty_returned + v_qty > v_line.qty then
      raise exception 'Cannot return % — only % still outstanding on that line.',
        v_qty, v_line.qty - v_line.qty_returned;
    end if;

    insert into public.exit_permit_return_lines (exit_permit_return_id, exit_permit_line_id, qty)
    values (v_return_id, v_line_id, v_qty);

    update public.exit_permit_lines
       set qty_returned = qty_returned + v_qty
     where id = v_line_id;

    perform public.return_exit_permit_line(v_line_id, v_qty, p_actor);
  end loop;

  return v_return_id;
end;
$function$;

revoke execute on function public.record_exit_permit_return(uuid, jsonb, date, text, text) from public, anon;
grant execute on function public.record_exit_permit_return(uuid, jsonb, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) void_exit_permit — restores ONLY what is still outstanding.
--
--     outstanding = qty - qty_returned, per line. Anything already returned
--     was restored by its own return event; restoring it again here would
--     invent stock. A fully-returned permit voids with zero movement.
--
--     qty_returned is deliberately NOT bumped to qty here: it counts what
--     physically came back, and a void is a cancellation, not a return. The
--     ledger already records the reversal.
-- ---------------------------------------------------------------------------
create or replace function public.void_exit_permit(
  p_permit_id uuid,
  p_reason text default null,
  p_actor text default null
)
returns public.exit_permits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_permit      public.exit_permits;
  v_line        record;
  v_outstanding numeric(12, 2);
begin
  select * into v_permit from public.exit_permits where id = p_permit_id for update;
  if v_permit.id is null then
    raise exception 'Exit permit not found.';
  end if;
  if v_permit.status <> 'exited' then
    raise exception 'Only an exited permit can be voided (this one is %).', v_permit.status;
  end if;

  for v_line in
    select id, qty, qty_returned from public.exit_permit_lines
     where exit_permit_id = p_permit_id
     for update
  loop
    v_outstanding := v_line.qty - v_line.qty_returned;
    if v_outstanding > 0 then
      perform public.return_exit_permit_line(v_line.id, v_outstanding, p_actor);
    end if;
  end loop;

  update public.exit_permits
     set status      = 'voided',
         voided_at   = now(),
         voided_by   = p_actor,
         void_reason = nullif(trim(p_reason), '')
   where id = p_permit_id
  returning * into v_permit;

  return v_permit;
end;
$function$;

revoke execute on function public.void_exit_permit(uuid, text, text) from public, anon;
grant execute on function public.void_exit_permit(uuid, text, text) to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) Tables + RLS:
--      select tablename, rowsecurity from pg_tables
--      where schemaname='public' and tablename like 'exit_permit%' or tablename='ep_number_counter';
--    Expect 6 tables, rowsecurity true on all.
--
-- 2) 0083 posture — every new function DEFINER, search_path pinned, anon 0:
--      select p.proname, p.prosecdef, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can
--      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname in
--        ('next_ep_number','consume_exit_permit_line','return_exit_permit_line',
--         'confirm_exit_permit','record_exit_permit_return','void_exit_permit');
--    Expect prosecdef true and {search_path=public} on all six, anon false on
--    all six, and the TWO TIERS visible in the ACL:
--      orchestrators -> {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      internals     -> {postgres=X/postgres}      (nobody but the owner)
--    Then re-run the global sweep: anon-executable function count in public
--    must still be 0.
--
-- 3) 0077 — no table pair with more than one FK:
--      select conrelid::regclass, confrelid::regclass, count(*)
--      from pg_constraint where contype='f' and conrelid='public.exit_permits'::regclass
--      group by 1,2 having count(*) > 1;
--    Expect ZERO rows.
--
-- 4) Maintenance untouched — these must be byte-identical to before:
--      select md5(pg_get_functiondef(oid)) from pg_proc
--      where proname in ('return_to_lots','consume_work_order_line','consume_from_lots');
--
-- 5) BITE TESTS, each in its own transaction, rolled back. Use a real part
--    with known qty_on_hand and at least TWO price lots, so the FIFO split is
--    actually exercised rather than assumed:
--
--    a) draft with no lines -> confirm  => must raise 'at least one line'
--    b) line whose part is in ANOTHER warehouse -> confirm => must raise
--    c) valid draft -> confirm =>
--         - ep_number matches EP-YY-####,
--         - status='exited',
--         - parts.qty_on_hand dropped by exactly the line qty,
--         - exit_permit_line_consumptions has one row PER LOT touched,
--           summing to the line qty,
--         - exit_permit_lines.unit_price_sar equals the weighted average of
--           those rows (this is the FIFO-cost check that matters),
--         - exactly ONE stock_movements 'consume' row.
--    d) confirm the same permit again => must raise (not a draft)
--    e) return part of one line => qty_returned rises, lots go back, a
--       'return' ledger row appears, ONE 'return' stock_movement
--    f) return more than outstanding => must raise, and NOTHING is written
--       (prove by re-checking qty_returned and qty_on_hand)
--    g) VOID after that partial return => restores ONLY the remainder.
--       Verify parts.qty_on_hand is now exactly back to its pre-confirm
--       value — no more, no less. This is the double-restore check.
--    h) void a fully-returned permit => status flips, qty_on_hand UNCHANGED
--    i) return against a voided permit => must raise
--    j) return against a PERMANENT permit => must raise
--    k) FIFO invariant across the whole exercise:
--         select p.id from public.parts p
--         where p.qty_on_hand <> coalesce((select sum(l.qty_remaining)
--           from public.price_lots l where l.part_id = p.id), 0);
--       Expect ZERO rows — before and after.
