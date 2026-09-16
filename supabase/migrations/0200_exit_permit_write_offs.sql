-- ===========================================================================
-- 0200 — RETURNABLE-PERMIT WRITE-OFF
-- ===========================================================================
-- Closes rule 4 of 0197, which named this gap and deliberately left it open:
--
--     "RETURNABLE and WRITTEN OFF has no representation in this schema ...
--      a permit whose parts never come back stays open forever and, after
--      this migration, is never expensed at all. THAT IS A KNOWN, DELIBERATE
--      GAP ... Closing the gap needs a status, which is a schema change and a
--      UI, not a view predicate."
--
-- It needed an EVENT, not a status. Measured live before writing this:
-- EP-26-0004 is 2 x SKU-1002 with ONE already returned, plus 1 x OIL-5W30 —
-- 190.00 SAR outstanding across a PARTIALLY returned line. A permit-level
-- status cannot say "one of two lost, one came back", so the only permit this
-- feature exists for would have been mis-modelled on day one.
--
-- So: exit_permits.status DOES NOT MOVE. It stays CHECK (draft/exited/voided)
-- and every reader of it — the Archive filter, the approvals eligibility gate,
-- all three RPC guards, both overdue branches, the printable's masthead —
-- keeps its current meaning. A write-off is a per-line event recorded beside
-- returns, in the same two-table shape, and "closed" stays DERIVED: a permit
-- whose every line has qty_returned + qty_written_off = qty simply stops being
-- outstanding.
--
-- ---------------------------------------------------------------------------
-- A WRITE-OFF MOVES NO STOCK. READ THIS BEFORE "FIXING" ANYTHING BELOW.
-- ---------------------------------------------------------------------------
-- The parts left the warehouse at exit. confirm_exit_permit already decremented
-- price_lots, already decremented parts.qty_on_hand and already wrote the
-- stock_movements row. Deciding that they are not coming back changes no
-- physical quantity anywhere — it changes only whether that cost is allowed to
-- reach the P&L. write_off_exit_permit_line therefore touches price_lots,
-- parts and stock_movements NOT AT ALL, and that is correct. The missing stock
-- movement is missing on purpose. Restoring stock is what a RETURN does, and a
-- return is still a separate, explicit event even after a reversal.
--
-- ---------------------------------------------------------------------------
-- THE LANDMINE, AND WHY THE CHECK AND THE VIEW SHIP IN ONE MIGRATION
-- ---------------------------------------------------------------------------
-- Every existing reader of exit_permit_line_consumptions is written as
--
--     case when direction = 'consume' then +qty else -qty end
--
-- so a direction value that nobody handled is not ignored — it is counted as a
-- NEGATIVE. A 'write_off' row loose in that expression would silently subtract
-- cost, shrink a lot's apparent availability, and corrupt the stamped unit
-- price. Measured: exactly ONE view reads that table (v_parts_consumption_daily,
-- confirmed by pg_depend) and two internal functions read it in PL/pgSQL. The
-- app side types direction as a TS union, so there the compiler is the guard.
--
-- Every one of those sites is replaced in this file, in the same transaction
-- as the CHECK that first makes the new values insertable. There is no window
-- in which a write-off row can exist in front of a reader that has not been
-- taught about it.
--
-- The durable fix is a FILTER, not a wider case: the stock-side reads now say
-- `direction in ('consume','return')` explicitly, so a fifth direction value
-- invented in 2027 falls OUT of them instead of falling into the else branch.
--
-- ---------------------------------------------------------------------------
-- THREE QUESTIONS, THREE DIFFERENT EXPRESSIONS. Do not unify them.
-- ---------------------------------------------------------------------------
--   1. LOT AVAILABILITY — "which lot can still take a return, or be written
--      off?" Written-off units are NOT available, so this one counts all four
--      directions:
--          consume +q, return -q, write_off -q, write_off_reversal +q
--      Four-way with NO else: an unknown direction yields NULL and the lot
--      drops out of the `having > 0` filter rather than being mis-scored, and
--      the functions raise on an unknown direction before they get that far.
--
--   2. STAMPED UNIT PRICE (exit_permit_lines.unit_price_sar) — "what did the
--      units that left cost?" Deciding they are not coming back does not change
--      what they cost, so write-off rows are FILTERED OUT here. This also keeps
--      the UI's outstanding-value figure stable across a write-off, which is
--      what anyone reading the permit expects.
--
--   3. THE P&L — "what is a cost, and on what day?" Two disjoint arms:
--      permanent-exited consume/return rows (0197's rule, untouched), and the
--      new write_off / write_off_reversal rows. A row can never satisfy both:
--      the write-off RPC refuses a permanent permit outright.
--
-- ---------------------------------------------------------------------------
-- COST RECOGNITION: ONCE, AT THE DECISION. CLOSED MONTHS NEVER MOVE.
-- ---------------------------------------------------------------------------
-- The write-off recognises cost on write_off_date. It does NOT re-open the
-- exit month: the original consume rows stay fenced out by 0197's
-- `kind = 'permanent'`, and the new arm reads only write-off rows. Measured on
-- the live data, a write-off of EP-26-0004 dated today adds 190.00 SAR to
-- September 2026 and changes August 2026 by nothing.
--
-- A reversal does NOT un-recognise at the original date — that would rewrite a
-- month already reported. It posts a mirror CREDIT dated at the reversal, so a
-- write-off and its reversal net to zero over all time while each month keeps
-- the number it was closed with. Same discipline 0197 was written to defend: a
-- figure must not depend on when you look at it.
--
-- And the back door is bolted: record_exit_permit_return now REFUSES a return
-- against a line whose outstanding is already written off. Without that guard a
-- late return would quietly shrink a past month's recognised cost.
--
-- void_exit_permit is corrected for the same reason in reverse: its
-- outstanding is now qty - qty_returned - qty_written_off, so voiding a permit
-- with written-off lines cannot restore stock for units already given up.
--
-- ---------------------------------------------------------------------------
-- APPROVAL: SINGLE ACTOR, MANDATORY REASON, DATABASE-ENFORCED
-- ---------------------------------------------------------------------------
-- Matches customer_write_offs (0139) exactly: reason NOT NULL with a
-- btrim(reason) <> '' CHECK, actor recorded as free text like voided_by, and a
-- reversal that STAMPS reversed_at/reversed_by rather than deleting anything.
-- consumption_approvals is deliberately not involved — that table records an
-- opinion and gates nothing (see the header of app/consumption/actions.ts), and
-- the permit stays status='exited' so it keeps appearing there unchanged.
--
-- ---------------------------------------------------------------------------
-- ALSO FIXED HERE: A LIVE COUNT BUG, PRE-DATING THIS FEATURE
-- ---------------------------------------------------------------------------
-- The bell (v_active_alerts.permit_overdue) requires an outstanding line. The
-- dashboard (v_dashboard_action_items.permit_return_overdue) does not. Measured
-- live: dashboard 2, bell 1 — the dashboard counts EP-26-0002, which is 42 days
-- past its date and FULLY RETURNED. Both branches are touched by this migration
-- anyway, and leaving them disagreeing would mean a written-off permit clears
-- one and not the other.
--
-- ---------------------------------------------------------------------------
-- SAFETY / SCOPE
-- ---------------------------------------------------------------------------
--  - 2 new tables, 1 new column on exit_permit_lines, 1 new column on
--    exit_permit_line_consumptions, 2 new functions, 5 replaced functions,
--    3 replaced views. No row is deleted and no existing column is dropped.
--  - Column lists and order are UNCHANGED on all three views, so none of the
--    replacements can hit 42P16.
--  - Every view replacement restates its security footer (CLAUDE.md §6);
--    `create or replace view` drops reloptions every time.
--  - Re-runnable: `create table if not exists`, `add column if not exists`,
--    `drop constraint if exists` before each add, `create or replace function`,
--    guarded policy drops.
--
-- PRE-FLIGHT (run before applying; both must be null / 0):
--   select to_regclass('public.exit_permit_write_offs') as should_be_null;
--   select count(*) from public.exit_permit_line_consumptions
--    where direction not in ('consume','return');   -- expect 0
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) The event tables — shaped on exit_permit_returns / exit_permit_return_lines
--
--    Two tables rather than one flat table, for the reason 0093 gives about
--    returns: a write-off is a real-world decision ("these are not coming
--    back") that can cover several lines at once, and one table would either
--    lose the grouping or repeat the decision's metadata on every line.
--
--    amount_sar is FROZEN at the decision, exactly like customer_write_offs.
--    It is the figure someone put their name to. It is NOT what the P&L reads
--    — the ledger is — and the RPC asserts the two are equal before it
--    returns, so a drift between them is impossible rather than unlikely.
-- ---------------------------------------------------------------------------
create table if not exists public.exit_permit_write_offs (
  id              uuid primary key default gen_random_uuid(),
  exit_permit_id  uuid not null references public.exit_permits(id) on delete cascade,
  -- The date the cost is recognised on. Defaults to today in Riyadh (0189),
  -- never to a UTC date that can be yesterday at 03:00 local.
  write_off_date  date not null default (now() at time zone 'Asia/Riyadh')::date,
  -- Mandatory, and enforced HERE rather than only in the form: "with a reason"
  -- is the whole difference between a decision and a bypass (0139).
  reason          text not null constraint exit_permit_write_offs_reason_present
                    check (btrim(reason) <> ''),
  written_off_by  text,
  -- Frozen at the decision. See the note above.
  amount_sar      numeric(12, 2) not null default 0 check (amount_sar >= 0),
  note            text,
  created_at      timestamptz not null default now(),
  -- Reversal STAMPS, never deletes.
  reversed_at     timestamptz,
  reversed_by     text,
  reversal_reason text,
  -- A half-stamped reversal is a reversal nobody can attribute.
  constraint exit_permit_write_offs_reversal_shape check (
    (reversed_at is null     and reversed_by is null and reversal_reason is null) or
    (reversed_at is not null and reversed_by is not null and btrim(reversal_reason) <> '')
  )
);

create index if not exists exit_permit_write_offs_permit_idx
  on public.exit_permit_write_offs (exit_permit_id);
create index if not exists exit_permit_write_offs_open_idx
  on public.exit_permit_write_offs (exit_permit_id) where reversed_at is null;

alter table public.exit_permit_write_offs enable row level security;
drop policy if exists "authenticated_all_exit_permit_write_offs" on public.exit_permit_write_offs;
create policy "authenticated_all_exit_permit_write_offs"
  on public.exit_permit_write_offs for all to authenticated using (true) with check (true);

comment on table public.exit_permit_write_offs is
  'A decision that outstanding parts on a RETURNABLE exit permit are not coming back. Header per decision; quantities per line in exit_permit_write_off_lines; per-lot money in exit_permit_line_consumptions rows with direction=''write_off'', reachable from the line row. amount_sar is frozen at the decision and asserted equal to those ledger rows by the RPC; the P&L reads the ledger, not this column. A reversal stamps reversed_at/reversed_by and posts a mirror credit dated at the reversal — nothing is ever deleted and no closed month is ever rewritten.';

create table if not exists public.exit_permit_write_off_lines (
  id                       uuid primary key default gen_random_uuid(),
  exit_permit_write_off_id uuid not null references public.exit_permit_write_offs(id) on delete cascade,
  exit_permit_line_id      uuid not null references public.exit_permit_lines(id) on delete restrict,
  qty                      numeric(12, 2) not null check (qty > 0),
  created_at               timestamptz not null default now()
);

create index if not exists exit_permit_write_off_lines_write_off_idx
  on public.exit_permit_write_off_lines (exit_permit_write_off_id);
create index if not exists exit_permit_write_off_lines_line_idx
  on public.exit_permit_write_off_lines (exit_permit_line_id);

alter table public.exit_permit_write_off_lines enable row level security;
drop policy if exists "authenticated_all_exit_permit_write_off_lines" on public.exit_permit_write_off_lines;
create policy "authenticated_all_exit_permit_write_off_lines"
  on public.exit_permit_write_off_lines for all to authenticated using (true) with check (true);

comment on table public.exit_permit_write_off_lines is
  'Per-line quantity of one write-off decision. Grain matches exit_permit_return_lines deliberately: the PER-LOT allocation is not repeated here, it lives in exit_permit_line_consumptions.write_off_line_id pointing back at this row — the same division of labour returns already use, so there is exactly one place that says which lot a unit came from.';

-- ---------------------------------------------------------------------------
-- 2) exit_permit_lines.qty_written_off — the mirror of qty_returned.
--
--    Denormalised for the same reason qty_returned is: the guards, the void
--    path and both overdue branches need "what is still out" without walking
--    the event tables. Only write_off_exit_permit_lines and
--    reverse_exit_permit_write_off write it; never the app.
--
--    The over-return CHECK KEEPS ITS NAME. It still means the same thing —
--    nothing can leave a line twice — and any error message or reader that
--    names it stays correct.
-- ---------------------------------------------------------------------------
alter table public.exit_permit_lines
  add column if not exists qty_written_off numeric(12, 2) not null default 0;

alter table public.exit_permit_lines
  drop constraint if exists exit_permit_lines_qty_written_off_check;
alter table public.exit_permit_lines
  add constraint exit_permit_lines_qty_written_off_check check (qty_written_off >= 0);

alter table public.exit_permit_lines
  drop constraint if exists exit_permit_lines_not_over_returned;
alter table public.exit_permit_lines
  add constraint exit_permit_lines_not_over_returned
  check (qty_returned + qty_written_off <= qty);

comment on column public.exit_permit_lines.qty_written_off is
  'Running total given up as not coming back. Outstanding on a line is qty - qty_returned - qty_written_off everywhere, with no exceptions. Written only by write_off_exit_permit_lines and reverse_exit_permit_write_off.';

-- ---------------------------------------------------------------------------
-- 3) The ledger learns two directions — ATOMIC WITH EVERY READER BELOW.
--
--    write_off_line_id is what makes a reversal exact: it credits the rows
--    THAT write-off posted, lot for lot, instead of re-deriving an allocation
--    that may have moved. The shape CHECK is biconditional on purpose — a
--    consume row with a write-off parent, or a write-off row without one, are
--    both nonsense and both refused.
-- ---------------------------------------------------------------------------
alter table public.exit_permit_line_consumptions
  add column if not exists write_off_line_id uuid
  references public.exit_permit_write_off_lines(id) on delete restrict;

create index if not exists exit_permit_line_consumptions_write_off_idx
  on public.exit_permit_line_consumptions (write_off_line_id);

alter table public.exit_permit_line_consumptions
  drop constraint if exists exit_permit_line_consumptions_direction_check;
alter table public.exit_permit_line_consumptions
  add constraint exit_permit_line_consumptions_direction_check
  check (direction in ('consume', 'return', 'write_off', 'write_off_reversal'));

alter table public.exit_permit_line_consumptions
  drop constraint if exists exit_permit_line_consumptions_write_off_shape;
alter table public.exit_permit_line_consumptions
  add constraint exit_permit_line_consumptions_write_off_shape
  check ((direction in ('write_off', 'write_off_reversal')) = (write_off_line_id is not null));

comment on column public.exit_permit_line_consumptions.direction is
  'consume and return MOVE STOCK. write_off and write_off_reversal MOVE NO STOCK — they carry money only, recognising (or crediting) the cost of units that left and are not coming back. Readers must never use `case when direction = ''consume'' then +q else -q end`: a value that expression has not been taught about is counted as a negative. Filter explicitly.';

-- ---------------------------------------------------------------------------
-- 4a) write_off_exit_permit_line — INTERNAL. Allocates one write-off line
--     across the lots the units actually left on, and posts money-only rows.
--
--     Walks the SAME lots in the SAME order as return_exit_permit_line
--     (newest-touched first, positive net only) so a write-off and a later
--     return of the same line cannot disagree about which lot held what.
--
--     Returns the cost it posted, so the orchestrator can freeze that figure
--     on the header without re-deriving it from a second query.
--
--     TOUCHES NO STOCK. See the header.
-- ---------------------------------------------------------------------------
create or replace function public.write_off_exit_permit_line(
  p_write_off_line_id uuid
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line_id   uuid;
  v_qty       numeric(12, 2);
  v_remaining numeric(12, 2);
  v_take      numeric(12, 2);
  v_cost      numeric(12, 2) := 0;
  v_unknown   text;
  v_lot       record;
begin
  select wl.exit_permit_line_id, wl.qty
    into v_line_id, v_qty
    from public.exit_permit_write_off_lines wl
   where wl.id = p_write_off_line_id;
  if v_line_id is null then
    raise exception 'Write-off line not found.';
  end if;

  -- A direction nobody taught the sum below about would come out NULL and
  -- take its whole lot out of the loop silently. Refuse instead.
  select string_agg(distinct c.direction, ', ') into v_unknown
    from public.exit_permit_line_consumptions c
   where c.exit_permit_line_id = v_line_id
     and c.direction not in ('consume', 'return', 'write_off', 'write_off_reversal');
  if v_unknown is not null then
    raise exception 'Unknown ledger direction(s) % on this line — refusing to allocate a write-off.', v_unknown;
  end if;

  v_remaining := v_qty;

  -- LOT AVAILABILITY — question 1 in the header. All four directions, no else.
  for v_lot in
    select c.price_lot_id,
           sum(case when c.direction = 'consume'            then  c.qty
                    when c.direction = 'return'             then -c.qty
                    when c.direction = 'write_off'          then -c.qty
                    when c.direction = 'write_off_reversal' then  c.qty
               end) as net_qty,
           max(c.created_at) as last_touched
      from public.exit_permit_line_consumptions c
     where c.exit_permit_line_id = v_line_id
     group by c.price_lot_id
    having sum(case when c.direction = 'consume'            then  c.qty
                    when c.direction = 'return'             then -c.qty
                    when c.direction = 'write_off'          then -c.qty
                    when c.direction = 'write_off_reversal' then  c.qty
               end) > 0
     order by max(c.created_at) desc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_lot.net_qty, v_remaining);

    -- price_lots.price_sar is the price that lot came in at and never changes,
    -- which is why return_exit_permit_line reads it the same way.
    insert into public.exit_permit_line_consumptions
      (exit_permit_line_id, price_lot_id, direction, qty, unit_price_sar, write_off_line_id)
    select v_line_id, pl.id, 'write_off', v_take, pl.price_sar, p_write_off_line_id
      from public.price_lots pl
     where pl.id = v_lot.price_lot_id;

    v_cost      := v_cost + v_take * (select pl.price_sar from public.price_lots pl where pl.id = v_lot.price_lot_id);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Cannot write off % on this line — only % is still allocated against tracked lots.',
      v_qty, v_qty - v_remaining;
  end if;

  return round(v_cost, 2);
end;
$function$;

-- INTERNAL — not callable by any app role. Called on its own it would post
-- cost without an event header to explain or reverse it. See the security note
-- in 0093's header for why authenticated and service_role are revoked too.
revoke execute on function public.write_off_exit_permit_line(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4b) consume_exit_permit_line — REPLACED for one reason only.
--
--     Its stamped-unit-price recompute is question 2 in the header: what the
--     units that left cost, which a write-off does not change. The two sums
--     now FILTER to consume/return instead of relying on an else branch that
--     would have subtracted write-off rows.
--
--     Everything else is 0093 verbatim, including the FIFO order clause that
--     must stay identical to consume_from_lots'.
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

  -- 0200: stock directions only. A write-off does not change what the units
  -- that left cost.
  update public.exit_permit_lines
     set unit_price_sar = (
       select sum(case when c.direction = 'consume' then c.qty * c.unit_price_sar else -(c.qty * c.unit_price_sar) end)
              / nullif(sum(case when c.direction = 'consume' then c.qty else -c.qty end), 0)
         from public.exit_permit_line_consumptions c
        where c.exit_permit_line_id = p_exit_permit_line_id
          and c.direction in ('consume', 'return')
     )
   where id = p_exit_permit_line_id;
end;
$function$;

revoke execute on function public.consume_exit_permit_line(uuid, numeric, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4c) return_exit_permit_line — REPLACED for two reasons.
--
--     1. LOT AVAILABILITY (question 1) now counts write-offs against a lot.
--        Without this, a return could be restored to a lot whose units have
--        already been given up, putting stock back on the wrong lot at the
--        wrong price. Four-way, no else.
--     2. The stamped-unit-price recompute (question 2) filters to
--        consume/return, same as 4b.
--
--     The stock half — restoring the lot, the parts row, the single
--     stock_movements entry — is 0093 verbatim and moves nothing new.
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
  v_unknown        text;
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

  select string_agg(distinct c.direction, ', ') into v_unknown
    from public.exit_permit_line_consumptions c
   where c.exit_permit_line_id = p_exit_permit_line_id
     and c.direction not in ('consume', 'return', 'write_off', 'write_off_reversal');
  if v_unknown is not null then
    raise exception 'Unknown ledger direction(s) % on this line — refusing to return against it.', v_unknown;
  end if;

  v_remaining := p_qty;

  for v_lot in
    select c.price_lot_id,
           sum(case when c.direction = 'consume'            then  c.qty
                    when c.direction = 'return'             then -c.qty
                    when c.direction = 'write_off'          then -c.qty
                    when c.direction = 'write_off_reversal' then  c.qty
               end) as net_qty,
           max(c.created_at) as last_touched
      from public.exit_permit_line_consumptions c
     where c.exit_permit_line_id = p_exit_permit_line_id
     group by c.price_lot_id
    having sum(case when c.direction = 'consume'            then  c.qty
                    when c.direction = 'return'             then -c.qty
                    when c.direction = 'write_off'          then -c.qty
                    when c.direction = 'write_off_reversal' then  c.qty
               end) > 0
     order by max(c.created_at) desc
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
          and c.direction in ('consume', 'return')
     ), unit_price_sar)
   where id = p_exit_permit_line_id;
end;
$function$;

revoke execute on function public.return_exit_permit_line(uuid, numeric, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5a) write_off_exit_permit_lines — THE ORCHESTRATOR. One complete decision.
--
--     Refuses a PERMANENT permit outright: its parts were expensed the day
--     they left (0197 rule 1), so writing one off would count the same cost
--     twice. That refusal is what keeps the two P&L arms disjoint.
-- ---------------------------------------------------------------------------
create or replace function public.write_off_exit_permit_lines(
  p_permit_id      uuid,
  p_lines          jsonb,
  p_reason         text,
  p_write_off_date date default (now() at time zone 'Asia/Riyadh')::date,
  p_note           text default null::text,
  p_actor          text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_permit public.exit_permits;
  v_wo_id  uuid;
  v_el     jsonb;
  v_line_id uuid;
  v_qty    numeric(12, 2);
  v_line   public.exit_permit_lines;
  v_wl_id  uuid;
  v_cost   numeric(12, 2) := 0;
  v_ledger numeric(12, 2);
begin
  select * into v_permit from public.exit_permits where id = p_permit_id for update;
  if v_permit.id is null then
    raise exception 'Exit permit not found.';
  end if;
  if v_permit.status <> 'exited' then
    raise exception 'Only an exited permit can be written off (this one is %).', v_permit.status;
  end if;
  if v_permit.kind <> 'returnable' then
    raise exception 'This permit is permanent — its parts were already expensed when they left. Writing it off would count the same cost twice.';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A write-off needs a reason.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A write-off must name at least one line.';
  end if;

  -- amount_sar starts at 0 and is set at the bottom of this same function,
  -- inside this same transaction. No other session can observe the zero.
  insert into public.exit_permit_write_offs
    (exit_permit_id, write_off_date, reason, written_off_by, amount_sar, note)
  values
    (p_permit_id,
     coalesce(p_write_off_date, (now() at time zone 'Asia/Riyadh')::date),
     btrim(p_reason), p_actor, 0, nullif(btrim(p_note), ''))
  returning id into v_wo_id;

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
      raise exception 'Write-off quantity must be positive.';
    end if;
    if v_line.qty_returned + v_line.qty_written_off + v_qty > v_line.qty then
      raise exception 'Cannot write off % — only % still outstanding on that line.',
        v_qty, v_line.qty - v_line.qty_returned - v_line.qty_written_off;
    end if;

    insert into public.exit_permit_write_off_lines
      (exit_permit_write_off_id, exit_permit_line_id, qty)
    values (v_wo_id, v_line_id, v_qty)
    returning id into v_wl_id;

    update public.exit_permit_lines
       set qty_written_off = qty_written_off + v_qty
     where id = v_line_id;

    v_cost := v_cost + public.write_off_exit_permit_line(v_wl_id);
  end loop;

  -- FREEZE, THEN PROVE. The header carries the figure that was decided; the
  -- ledger carries the figure the P&L reads. Asserted equal here so they
  -- cannot drift apart later without someone editing rows by hand.
  select coalesce(sum(c.qty * c.unit_price_sar), 0) into v_ledger
    from public.exit_permit_line_consumptions c
    join public.exit_permit_write_off_lines wl on wl.id = c.write_off_line_id
   where wl.exit_permit_write_off_id = v_wo_id
     and c.direction = 'write_off';

  if round(v_ledger, 2) <> round(v_cost, 2) then
    raise exception 'Write-off total % disagrees with its own ledger rows % — refusing.',
      round(v_cost, 2), round(v_ledger, 2);
  end if;

  update public.exit_permit_write_offs
     set amount_sar = round(v_ledger, 2)
   where id = v_wo_id;

  return v_wo_id;
end;
$function$;

revoke execute on function public.write_off_exit_permit_lines(uuid, jsonb, text, date, text, text) from public, anon;
grant  execute on function public.write_off_exit_permit_lines(uuid, jsonb, text, date, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5b) reverse_exit_permit_write_off — the parts turned up after all.
--
--     Posts a MIRROR CREDIT of every row the write-off posted — same lot, same
--     qty, same stamped price, opposite direction — and stamps the header.
--     Nothing is deleted.
--
--     The credit is dated at the REVERSAL, not at the original write-off. The
--     cost was real in the month it was recognised; the recovery is real now.
--     Un-recognising at the old date would rewrite a month already reported,
--     which is exactly the disease 0197 was written to cure.
--
--     This does NOT put stock back. The parts physically arriving is still a
--     RETURN, recorded normally afterwards, which is what restores the lot and
--     qty_on_hand. Keeping them separate is what stops a reversal inventing
--     stock that never came back.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_exit_permit_write_off(
  p_write_off_id uuid,
  p_reason       text,
  p_actor        text default null::text
)
returns public.exit_permit_write_offs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wo public.exit_permit_write_offs;
  v_wl record;
begin
  select * into v_wo from public.exit_permit_write_offs where id = p_write_off_id for update;
  if v_wo.id is null then
    raise exception 'Write-off not found.';
  end if;
  if v_wo.reversed_at is not null then
    raise exception 'That write-off was already reversed on %.', v_wo.reversed_at::date;
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reversal needs a reason.';
  end if;

  for v_wl in
    select wl.id, wl.exit_permit_line_id, wl.qty
      from public.exit_permit_write_off_lines wl
     where wl.exit_permit_write_off_id = p_write_off_id
     for update
  loop
    insert into public.exit_permit_line_consumptions
      (exit_permit_line_id, price_lot_id, direction, qty, unit_price_sar, write_off_line_id)
    select c.exit_permit_line_id, c.price_lot_id, 'write_off_reversal', c.qty, c.unit_price_sar, c.write_off_line_id
      from public.exit_permit_line_consumptions c
     where c.write_off_line_id = v_wl.id
       and c.direction = 'write_off';

    update public.exit_permit_lines
       set qty_written_off = qty_written_off - v_wl.qty
     where id = v_wl.exit_permit_line_id;
  end loop;

  update public.exit_permit_write_offs
     set reversed_at     = now(),
         reversed_by     = p_actor,
         reversal_reason = btrim(p_reason)
   where id = p_write_off_id
  returning * into v_wo;

  return v_wo;
end;
$function$;

revoke execute on function public.reverse_exit_permit_write_off(uuid, text, text) from public, anon;
grant  execute on function public.reverse_exit_permit_write_off(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5c) record_exit_permit_return — THE GUARD.
--
--     Refuses a return against quantity that has already been written off.
--     Without it, a late return would net against a write-off and quietly
--     shrink the recognised cost of a month that is already closed — the back
--     door into exactly what 5b takes the front door to avoid.
--
--     Reverse the write-off first, then record the return. Two events, in the
--     order they happened.
--
--     Otherwise 0189 verbatim, including the Riyadh-dated default at both
--     sites (parameter default AND the coalesce in the body).
-- ---------------------------------------------------------------------------
create or replace function public.record_exit_permit_return(
  p_permit_id   uuid,
  p_lines       jsonb,
  p_returned_on date default (now() at time zone 'Asia/Riyadh')::date,
  p_note        text default null::text,
  p_actor       text default null::text
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
  values (p_permit_id, coalesce(p_returned_on, (now() at time zone 'Asia/Riyadh')::date), nullif(trim(p_note), ''), p_actor)
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
    -- 0200: written-off quantity is not returnable until the write-off is
    -- reversed. Named separately from the plain over-return message so the
    -- operator is told what to do, not just that they cannot.
    if v_line.qty_written_off > 0
       and v_line.qty_returned + v_line.qty_written_off + v_qty > v_line.qty then
      raise exception 'Cannot return % — % on that line has been written off. Reverse the write-off first, then record the return.',
        v_qty, v_line.qty_written_off;
    end if;
    if v_line.qty_returned + v_line.qty_written_off + v_qty > v_line.qty then
      raise exception 'Cannot return % — only % still outstanding on that line.',
        v_qty, v_line.qty - v_line.qty_returned - v_line.qty_written_off;
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
grant  execute on function public.record_exit_permit_return(uuid, jsonb, date, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5d) void_exit_permit — outstanding gains the write-off term.
--
--     0093's outstanding was qty - qty_returned. With write-offs in the world
--     that restores stock for units already given up: the void would put back
--     quantity whose cost is in a closed month, inventing stock AND leaving the
--     P&L holding a cost for parts now sitting on the shelf.
--
--     Everything else is 0093 verbatim, including the deliberate decision NOT
--     to bump qty_returned — it counts what physically came back, and a void is
--     a cancellation, not a return.
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
    select id, qty, qty_returned, qty_written_off from public.exit_permit_lines
     where exit_permit_id = p_permit_id
     for update
  loop
    v_outstanding := v_line.qty - v_line.qty_returned - v_line.qty_written_off;
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
grant  execute on function public.void_exit_permit(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) v_parts_consumption_daily — the recognition rule gains its second half.
--
--     0197's two maintenance branches and its permanent/exited exit-permit
--     branch are restated VERBATIM, with one addition to the third: an
--     explicit `direction in ('consume','return')` filter. Permanent permits
--     can never carry write-off rows (5a refuses them), so this changes no
--     row today — it is there so the arm cannot be poisoned by a direction
--     invented later.
--
--     The NEW arm reads write-off rows only, and dates each one by its EVENT,
--     not by the timestamp of the insert: write_off_date for the debit,
--     reversed_at (in Riyadh) for the credit. The two arms are disjoint by
--     direction and by kind, so no draw can reach the P&L twice.
--
--     Column list and order unchanged — seven columns, same types, same order.
--     No 42P16.
-- ---------------------------------------------------------------------------
create or replace view public.v_parts_consumption_daily as
  -- Maintenance, from the per-lot ledger.
  select 'maintenance'::text as source,
         c.created_at::date  as day,
         w.truck_id,
         wp.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end) as qty,
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end) as cost_sar,
         'ledger'::text as basis
    from public.work_order_part_consumptions c
    join public.work_order_parts wp on wp.id = c.work_order_part_id
    join public.work_orders w       on w.id  = wp.work_order_id
   group by 1, 2, 3, 4
  union all
  -- Maintenance, PRE-LEDGER: deducted before the ledger existed. Same stamped
  -- unit price, read from the parent row. See 0098 rule 5 — dropping this
  -- understates July parts cost by 72%.
  select 'maintenance', w.inventory_deducted_at::date,
         w.truck_id, wp.part_id,
         wp.qty, wp.qty * wp.unit_price_sar, 'line'
    from public.work_order_parts wp
    join public.work_orders w on w.id = wp.work_order_id
   where w.inventory_deducted_at is not null
     and not exists (select 1 from public.work_order_part_consumptions c
                      where c.work_order_part_id = wp.id)
  union all
  -- Exit permits, from their own per-lot ledger. No truck: a permit's
  -- destination may be a truck but the parts are not maintenance on it.
  --
  -- PERMANENT, EXITED ONLY (0197). A returnable permit is a loan, not a cost,
  -- and a voided one is not an event. Both are excluded here rather than left
  -- to net themselves out downstream. See the rule at the head of 0197.
  --
  -- 0200: stock directions only. Belt, not braces — a permanent permit cannot
  -- be written off — but this arm must never be reachable by a direction it
  -- has not been taught about.
  select 'exit_permit', c.created_at::date,
         null::uuid, l.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end),
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end),
         'ledger'
    from public.exit_permit_line_consumptions c
    join public.exit_permit_lines l on l.id = c.exit_permit_line_id
    join public.exit_permits     ep on ep.id = l.exit_permit_id
   where ep.status = 'exited'
     and ep.kind   = 'permanent'
     and c.direction in ('consume', 'return')
   group by 2, 4
  union all
  -- 0200 — RETURNABLE, WRITTEN OFF. The other half of 0197's rule 4.
  --
  -- Recognised ONCE, on the day the decision was made, at the FIFO price the
  -- units left at. The original consume rows stay fenced out above by
  -- kind='permanent', so nothing is counted twice and the exit month does not
  -- move.
  --
  -- A reversal is a CREDIT DATED AT THE REVERSAL, never an un-recognition at
  -- the original date. Over all time a write-off and its reversal sum to zero;
  -- month by month, each keeps the number it was closed with.
  select 'exit_permit',
         case when c.direction = 'write_off'
              then wo.write_off_date
              else (wo.reversed_at at time zone 'Asia/Riyadh')::date
         end,
         null::uuid, l.part_id,
         sum(case when c.direction = 'write_off' then c.qty else -c.qty end),
         sum(case when c.direction = 'write_off'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end),
         'ledger'
    from public.exit_permit_line_consumptions c
    join public.exit_permit_write_off_lines wl on wl.id = c.write_off_line_id
    join public.exit_permit_write_offs      wo on wo.id = wl.exit_permit_write_off_id
    join public.exit_permit_lines            l on l.id  = c.exit_permit_line_id
   where c.direction in ('write_off', 'write_off_reversal')
   group by 2, 4;

alter view public.v_parts_consumption_daily set (security_invoker = true);
revoke all on public.v_parts_consumption_daily from anon;
grant select on public.v_parts_consumption_daily to authenticated;

comment on view public.v_parts_consumption_daily is
  'Parts consumed (FIFO cost), one row per source/day/truck/part. BASE definition since 0104; v_parts_consumption rolls it up to the month rather than restating the maths. 0197: an exit-permit draw counts as consumption only when the permit is status=exited AND kind=permanent. 0200 adds the other half — a RETURNABLE permit whose parts are written off recognises that cost ONCE, on write_off_date, from direction=''write_off'' ledger rows, and a reversal posts a credit dated at the reversal so no closed month is ever rewritten. The two exit-permit arms are disjoint by direction and by kind. Write-off rows move no stock. Maintenance branches are unchanged.';

-- ---------------------------------------------------------------------
-- 7. v_active_alerts — THE BELL STOPS NAGGING ABOUT A WRITTEN-OFF PERMIT.
--
-- Restated VERBATIM from 0158 (the current definer) with exactly ONE change,
-- in the permit_overdue branch:
--
--     coalesce(el.qty_returned, 0) < el.qty
--  -> coalesce(el.qty_returned, 0) + coalesce(el.qty_written_off, 0) < el.qty
--
-- Without this the bell keeps flagging a permit whose outstanding parts were
-- written off — i.e. a decision was recorded, the money was booked, and the
-- alert still asks for the parts back forever. The write-off IS the resolution.
--
-- The whole body is restated because `create or replace view` needs the full
-- definition and because CLAUDE.md §6 forbids a partial view edit. Column list
-- is byte-identical to 0158, so no 42P16.
-- ---------------------------------------------------------------------
create or replace view public.v_active_alerts as
with th as (
  -- 0158: THRESHOLDS NOW RESOLVE PER VIEWER. Three layers, in order:
  --   1. this user's override in notification_thresholds_user (NULL = skip)
  --   2. the shared notification_thresholds singleton
  --   3. a hardcoded constant
  --
  -- Resolved PER COLUMN, not per row, which is the whole point: a user can
  -- raise their maintenance window and still inherit everyone else's document
  -- lead time. A row-level "use mine or use theirs" would force all four to
  -- move together.
  --
  -- ALWAYS EXACTLY ONE ROW, even with no user row and an empty singleton. The
  -- `from (select auth.uid())` seed guarantees a row exists to LEFT JOIN onto,
  -- and each scalar subquery yields NULL rather than no-row. A CROSS JOIN to an
  -- empty singleton would return ZERO rows and silently switch every alert in
  -- the app off — the same trap 0154 called out, now with a second table that
  -- can be empty.
  --
  -- auth.uid() is NULL for a non-user caller (the SQL editor, a service role).
  -- The LEFT JOIN then matches nothing and every threshold falls through to the
  -- shared default, which is the correct answer for "no particular viewer".
  select
    coalesce(u.low_runway_trips,
             (select low_runway_trips from public.notification_thresholds limit 1),
             10)::numeric as low_runway_trips,
    coalesce(u.doc_expiry_lead_days,
             (select doc_expiry_lead_days from public.notification_thresholds limit 1),
             30)::int     as lead_days,
    coalesce(u.maintenance_stuck_days,
             (select maintenance_stuck_days from public.notification_thresholds limit 1),
             7)::int      as stuck_days,
    coalesce(u.invoice_overdue_red_days,
             (select invoice_overdue_red_days from public.notification_thresholds limit 1),
             30)::int     as red_days
    from (select auth.uid() as uid) me
    left join public.notification_thresholds_user u on u.user_id = me.uid
),
riyadh as (
  select (now() at time zone 'Asia/Riyadh')::date as today
),
-- ONE ROW PER PREPAID CUSTOMER WALLET, not per project. A customer with two
-- prepaid projects has ONE balance, so per-project keying would fire the same
-- wallet twice with two identities and require two dismissals for one fact.
--
-- top_rate is the HIGHEST current rate among their active unarchived prepaid
-- projects — the conservative choice, because runway should be measured against
-- the most expensive work the wallet might fund next.
prepaid_cust as (
  select p.customer_id,
         max(p.rate_per_trip_sar)  as top_rate,
         count(*)::int             as prepaid_projects
    from public.projects p
    join public.customers c on c.id = p.customer_id
   where p.archived_at is null
     and c.archived_at is null
     and p.payment_mode = 'prepaid'
   group by p.customer_id
),
-- Effective expiry for an archive document: the newest renewal that has not
-- been superseded, else the document's own date. Per-group warning_days wins
-- over the global lead days where the group sets one.
doc_effective as (
  select a.id,
         a.title,
         coalesce(
           (select r.expiry_date
              from public.archive_document_renewals r
             where r.document_id = a.id and r.superseded_at is null
             order by r.expiry_date desc nulls last
             limit 1),
           a.expiry_date
         ) as expiry_date,
         coalesce(g.warning_days, (select lead_days from th)) as lead_days
    from public.archive_documents a
    left join public.archive_document_groups g on g.id = a.group_id
)
-- ---- YELLOW: prepaid wallet OVERDRAWN -----------------------------------
-- balance_sar read straight from v_customer_prepaid_balance. No balance is
-- recomputed here — 0142 fixed the returns debit at exactly two expressions and
-- this file adds no third.
select 'prepaid_overdrawn:customer:' || k.customer_id::text  as alert_identity,
       'yellow'::text                                        as severity,
       'finance'::text                                       as category,
       'customer'::text                                      as entity_type,
       k.customer_id                                         as entity_id,
       b.customer_name                                       as entity_label,
       b.balance_sar                                         as value_num,
       null::date                                            as value_date,
       jsonb_build_object('balance_sar', b.balance_sar,
                          'top_rate_per_trip_sar', k.top_rate,
                          'prepaid_projects', k.prepaid_projects) as payload
  from prepaid_cust k
  join public.v_customer_prepaid_balance b on b.customer_id = k.customer_id
 where b.balance_sar < 0

-- ---- YELLOW: prepaid wallet LOW RUNWAY ----------------------------------
-- Mutually exclusive with OVERDRAWN by the balance predicate (>= 0 here, < 0
-- there), so one wallet can never emit both identities at once.
union all
select 'prepaid_low_runway:customer:' || k.customer_id::text, 'yellow', 'finance',
       'customer', k.customer_id, b.customer_name, b.balance_sar, null,
       jsonb_build_object('balance_sar', b.balance_sar,
                          'top_rate_per_trip_sar', k.top_rate,
                          'low_runway_trips', th.low_runway_trips,
                          'trips_of_runway',
                          case when coalesce(k.top_rate,0) > 0
                               then round(b.balance_sar / k.top_rate, 1)
                               else null end,
                          'prepaid_projects', k.prepaid_projects)
  from prepaid_cust k
  join public.v_customer_prepaid_balance b on b.customer_id = k.customer_id
  cross join th
 where b.balance_sar >= 0
   and b.balance_sar < th.low_runway_trips * coalesce(k.top_rate, 0)

-- ---- RED: expired documents (four entity fields + archive) --------------
union all
select 'doc_expiry:driver:' || d.id::text || ':license', 'red', 'compliance',
       'driver', d.id, d.name, null, d.license_expiry,
       jsonb_build_object('field','license_expiry','expiry_date',d.license_expiry)
  from public.drivers d cross join riyadh r
 where d.terminated_at is null and d.license_expiry is not null
   and d.license_expiry < r.today
union all
select 'doc_expiry:driver:' || d.id::text || ':iqama', 'red', 'compliance',
       'driver', d.id, d.name, null, d.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',d.iqama_expiry)
  from public.drivers d cross join riyadh r
 where d.terminated_at is null and d.iqama_expiry is not null
   and d.iqama_expiry < r.today
union all
select 'doc_expiry:staff:' || s.id::text || ':iqama', 'red', 'compliance',
       'staff', s.id, s.name, null, s.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',s.iqama_expiry)
  from public.staff s cross join riyadh r
 where s.terminated_at is null and s.iqama_expiry is not null
   and s.iqama_expiry < r.today
union all
select 'doc_expiry:truck:' || t.id::text || ':registration', 'red', 'compliance',
       'truck', t.id, t.plate, null, t.registration_expiry,
       jsonb_build_object('field','registration_expiry','expiry_date',t.registration_expiry)
  from public.trucks t cross join riyadh r
 where t.terminated_at is null and t.registration_expiry is not null
   and t.registration_expiry < r.today
union all
select 'doc_expiry:document:' || de.id::text, 'red', 'compliance',
       'document', de.id, de.title, null, de.expiry_date,
       jsonb_build_object('field','archive_document','expiry_date',de.expiry_date)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null and de.expiry_date < r.today

-- ---- RED: part at or below reorder level --------------------------------
union all
select 'part_reorder:part:' || p.id::text, 'red', 'inventory',
       'part', p.id, p.name, p.qty_on_hand, null,
       jsonb_build_object('sku',p.sku,'qty_on_hand',p.qty_on_hand,
                          'reorder_level',p.reorder_level,'unit',p.unit)
  from public.parts p
 where p.active and p.reorder_level is not null
   and p.qty_on_hand <= p.reorder_level

-- ---- RED: work order stuck ----------------------------------------------
-- 'in_progress' IS included; see OVERLAP note (c) at the head of this file.
union all
select 'wo_stuck:work_order:' || w.id::text, 'red', 'maintenance',
       'work_order', w.id, coalesce(w.wo_number, w.title),
       (r.today - w.opened_at::date)::numeric, w.opened_at::date,
       jsonb_build_object('wo_number',w.wo_number,'truck_id',w.truck_id,
                          'status',w.status,'days_open',(r.today - w.opened_at::date))
  from public.work_orders w cross join riyadh r cross join th
 where w.status in ('open','in_progress','awaiting_parts')
   and w.opened_at is not null
   and w.opened_at::date < r.today - th.stuck_days

-- ---- RED / YELLOW: postpaid invoice outstanding -------------------------
-- Reuses v_receivables_open wholesale. No aging and no money math is restated:
-- days_outstanding, outstanding_sar and aging_bucket all come from that view.
-- Past due beyond red_days is red, past due within it is yellow.
union all
select 'invoice_overdue:invoice:' || ro.invoice_id::text,
       case when ro.days_outstanding > th.red_days then 'red' else 'yellow' end,
       'finance', 'invoice', ro.invoice_id, ro.invoice_number,
       ro.outstanding_sar, ro.period_end,
       jsonb_build_object('customer_name',ro.customer_name,
                          'outstanding_sar',ro.outstanding_sar,
                          'days_outstanding',ro.days_outstanding,
                          'aging_bucket',ro.aging_bucket)
  from public.v_receivables_open ro
  join public.v_invoice_outstanding_live o on o.invoice_id = ro.invoice_id
  cross join th
 where o.effective_payment_mode = 'postpaid'
   and ro.days_outstanding > 0

-- ---- YELLOW: documents expiring within lead days ------------------------
union all
select 'doc_expiry:driver:' || d.id::text || ':license', 'yellow', 'compliance',
       'driver', d.id, d.name, null, d.license_expiry,
       jsonb_build_object('field','license_expiry','expiry_date',d.license_expiry)
  from public.drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.license_expiry is not null
   and d.license_expiry >= r.today
   and d.license_expiry < r.today + th.lead_days
union all
select 'doc_expiry:driver:' || d.id::text || ':iqama', 'yellow', 'compliance',
       'driver', d.id, d.name, null, d.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',d.iqama_expiry)
  from public.drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.iqama_expiry is not null
   and d.iqama_expiry >= r.today
   and d.iqama_expiry < r.today + th.lead_days
union all
select 'doc_expiry:staff:' || s.id::text || ':iqama', 'yellow', 'compliance',
       'staff', s.id, s.name, null, s.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',s.iqama_expiry)
  from public.staff s cross join riyadh r cross join th
 where s.terminated_at is null and s.iqama_expiry is not null
   and s.iqama_expiry >= r.today
   and s.iqama_expiry < r.today + th.lead_days
union all
select 'doc_expiry:truck:' || t.id::text || ':registration', 'yellow', 'compliance',
       'truck', t.id, t.plate, null, t.registration_expiry,
       jsonb_build_object('field','registration_expiry','expiry_date',t.registration_expiry)
  from public.trucks t cross join riyadh r cross join th
 where t.terminated_at is null and t.registration_expiry is not null
   and t.registration_expiry >= r.today
   and t.registration_expiry < r.today + th.lead_days
union all
select 'doc_expiry:document:' || de.id::text, 'yellow', 'compliance',
       'document', de.id, de.title, null, de.expiry_date,
       jsonb_build_object('field','archive_document','expiry_date',de.expiry_date,
                          'lead_days',de.lead_days)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null
   and de.expiry_date >= r.today
   and de.expiry_date < r.today + de.lead_days

-- ---- YELLOW: employee returning from leave within 3 days ----------------
-- 3 days is a fixed product rule, not a threshold: it means "prepare for their
-- return", which does not vary with how noisy the other windows are. Promote it
-- to notification_thresholds if that turns out wrong.
union all
select 'leave_return:' || case when l.driver_id is not null then 'driver' else 'staff' end
         || ':' || coalesce(l.driver_id, l.staff_id)::text || ':' || l.id::text,
       'yellow', 'people',
       case when l.driver_id is not null then 'driver' else 'staff' end,
       coalesce(l.driver_id, l.staff_id),
       coalesce(d.name, s.name),
       (l.end_date - r.today)::numeric, l.end_date,
       jsonb_build_object('leave_type',l.leave_type,'end_date',l.end_date,
                          'days_until_return',(l.end_date - r.today))
  from public.leave_periods l
  cross join riyadh r
  left join public.drivers d on d.id = l.driver_id
  left join public.staff  s on s.id = l.staff_id
 where l.end_date is not null
   -- 0156: was `>= r.today`, now `> r.today`. THIS IS THE ONLY CHANGE IN THIS
   -- MIGRATION. Yellow is upcoming returns only; the blue employee_returned
   -- branch owns end_date = today. Disjoint by construction.
   and l.end_date >  r.today
   and l.end_date <= r.today + 3
   and coalesce(d.terminated_at, s.terminated_at) is null

-- ---- YELLOW: exit permit past expected return, not fully returned -------
union all
select 'permit_overdue:exit_permit:' || e.id::text, 'yellow', 'inventory',
       'exit_permit', e.id, e.ep_number,
       (r.today - e.expected_return_on)::numeric, e.expected_return_on,
       jsonb_build_object('ep_number',e.ep_number,
                          'expected_return_on',e.expected_return_on,
                          'days_overdue',(r.today - e.expected_return_on))
  from public.exit_permits e cross join riyadh r
 where e.status = 'exited'
   and e.expected_return_on is not null
   and e.expected_return_on < r.today
   and exists (select 1 from public.exit_permit_lines el
                where el.exit_permit_id = e.id
                  and coalesce(el.qty_returned, 0) + coalesce(el.qty_written_off, 0) < el.qty)

-- ---- BLUE: truck entered maintenance (work order opened today) ----------
-- Derived from work_orders.opened_at — no stored event, no server action.
-- LEFT JOIN trucks: a work order's truck_id is the entity, and the plate is
-- only a label. If the truck row is missing the alert still fires, because the
-- work order opening is the fact and the plate is decoration.
union all
select 'truck_in:work_order:' || w.id::text, 'blue', 'event',
       'truck', w.truck_id,
       coalesce(t.plate, '(no truck)') || ' · ' || coalesce(w.wo_number, w.title, '(no number)'),
       null, w.opened_at::date,
       jsonb_build_object('plate', t.plate,
                          'wo_number', w.wo_number,
                          'truck_id', w.truck_id)
  from public.work_orders w
  cross join riyadh r
  left join public.trucks t on t.id = w.truck_id
 where w.opened_at is not null
   and (w.opened_at at time zone 'Asia/Riyadh')::date = r.today

-- ---- BLUE: truck back in service (work order closed today) --------------
-- Derived from work_orders.closed_at. A work order opened AND closed on the
-- same day correctly produces BOTH blue rows — two different facts about the
-- same job, with two different identities, on one day.
union all
select 'truck_out:work_order:' || w.id::text, 'blue', 'event',
       'truck', w.truck_id,
       coalesce(t.plate, '(no truck)') || ' · ' || coalesce(w.wo_number, w.title, '(no number)'),
       null, w.closed_at::date,
       jsonb_build_object('plate', t.plate,
                          'wo_number', w.wo_number,
                          'truck_id', w.truck_id)
  from public.work_orders w
  cross join riyadh r
  left join public.trucks t on t.id = w.truck_id
 where w.closed_at is not null
   and (w.closed_at at time zone 'Asia/Riyadh')::date = r.today

-- ---- BLUE: employee returned today (leave ended today) ------------------
-- Derived from leave_periods.end_date. Terminated people are excluded on the
-- same coalesce the yellow leave branch uses, so someone terminated while on
-- leave does not "return".
--
-- The leave id is in the identity because one person can have several leave
-- periods; keying on the person alone would merge two returns into one.
--
-- See the KNOWN OVERLAP note at the head of this file: on the return day this
-- fires alongside the existing yellow leave_return branch.
union all
select 'employee_returned:' || case when l.driver_id is not null then 'driver' else 'staff' end
         || ':' || coalesce(l.driver_id, l.staff_id)::text || ':' || l.id::text,
       'blue', 'event',
       case when l.driver_id is not null then 'driver' else 'staff' end,
       coalesce(l.driver_id, l.staff_id),
       coalesce(d.name, s.name),
       null, l.end_date,
       jsonb_build_object('leave_type', l.leave_type,
                          'end_date', l.end_date)
  from public.leave_periods l
  cross join riyadh r
  left join public.drivers d on d.id = l.driver_id
  left join public.staff  s on s.id = l.staff_id
 where l.end_date = r.today
   and coalesce(d.terminated_at, s.terminated_at) is null;

alter view public.v_active_alerts set (security_invoker = true);
revoke all on public.v_active_alerts from anon;
grant select on public.v_active_alerts to authenticated;

comment on view public.v_active_alerts is
  'Every STATE alert plus the three derived BLUE event branches, all computed live (0154 + 0155 + 0156 + 0158 + 0200). Thresholds resolve PER VIEWER: notification_thresholds_user override, then the shared notification_thresholds singleton, then a hardcoded constant — resolved per column, so a user can override one threshold and inherit the rest. 0200: permit_overdue treats a WRITTEN-OFF quantity as resolved, so the bell stops asking for parts the business has already decided it will never see. Never store these alerts: a stored state alert survives the restock/renewal/payment/top-up that resolved it. Each row carries a stable alert_identity built from ids and reason only.';

-- ---------------------------------------------------------------------
-- 8. v_dashboard_action_items — FIXES A PRE-EXISTING COUNT BUG.
--
-- This one is NOT a write-off feature. It is a bug that the write-off work
-- uncovered and that would otherwise be blamed on the write-off.
--
-- LIVE TODAY: the dashboard card says 2 overdue permits, the bell shows 1.
-- The bell's branch (section 7) has always required an outstanding line; this
-- view never did. So EP-26-0002 — expected back 42 days ago, FULLY RETURNED —
-- is still counted here. Two surfaces, two different questions, one of them
-- wrong. Fixing it after shipping write-offs would look like the write-off
-- broke the number; fixing it here, in the same migration, keeps the blame
-- honest.
--
-- Restated VERBATIM from 0165 (the current definer) with exactly ONE change:
-- the permit_return_overdue branch gains the SAME outstanding predicate the
-- bell uses, including the new qty_written_off term. The two surfaces now
-- answer the identical question.
--
-- Column list byte-identical to 0165 (the 0165 self-assert on the column list
-- is re-run below). No 42P16.
-- ---------------------------------------------------------------------
create or replace view public.v_dashboard_action_items
with (security_invoker = true) as
 WITH riyadh AS (
         SELECT (now() AT TIME ZONE 'Asia/Riyadh'::text)::date AS today
        )
 SELECT kind,
    severity,
    item_count,
    oldest_at
   FROM ( SELECT 'po_pending_approval'::text AS kind,
            'high'::text AS severity,
            count(*)::integer AS item_count,
            min(po.created_at) AS oldest_at
           FROM purchase_orders po
          WHERE po.status = 'pending_approval'::text
        UNION ALL
         SELECT 'receipt_pending_approval'::text,
            'high'::text,
            count(*)::integer AS count,
            min(sr.created_at) AS min
           FROM stock_receipts sr
          WHERE sr.status = 'pending_approval'::text
        UNION ALL
         SELECT 'consumption_pending_approval'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(ca.created_at) AS min
           FROM consumption_approvals ca
          WHERE ca.decided_at IS NULL
        UNION ALL
         SELECT 'invoice_unpaid'::text,
            'high'::text,
            count(*)::integer AS count,
            min(r.confirmed_at) AS min
           FROM v_receivables_open r
        UNION ALL
         SELECT 'trip_overdue'::text,
            'high'::text,
            count(*)::integer AS count,
            min(t.created_at) AS min
           FROM trips t,
            riyadh r
          WHERE (t.stage = ANY (ARRAY['scheduled'::text, 'loading'::text, 'in_transit'::text])) AND t.trip_date < r.today
        UNION ALL
         SELECT 'work_order_open'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(w.opened_at) AS min
           FROM work_orders w
          WHERE w.status = ANY (ARRAY['open'::text, 'awaiting_parts'::text])
        UNION ALL
         SELECT 'po_awaiting_receipt'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(po.issued_at) AS min
           FROM purchase_orders po
          WHERE po.status = 'issued'::text
        UNION ALL
         SELECT 'outsourced_overdue'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(o.created_at) AS min
           FROM outsourced_jobs o,
            riyadh r
          WHERE o.status = 'in_progress'::text AND o.estimated_finish IS NOT NULL AND o.estimated_finish < r.today
        UNION ALL
         SELECT 'permit_return_overdue'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(e.exited_at) AS min
           FROM exit_permits e,
            riyadh r
          WHERE e.status = 'exited'::text AND e.expected_return_on IS NOT NULL AND e.expected_return_on < r.today AND (EXISTS ( SELECT 1
                   FROM exit_permit_lines el
                  WHERE el.exit_permit_id = e.id AND COALESCE(el.qty_returned, 0::numeric) + COALESCE(el.qty_written_off, 0::numeric) < el.qty))
        UNION ALL
         SELECT 'parts_below_reorder'::text,
            'low'::text,
            count(*)::integer AS count,
            NULL::timestamp with time zone AS timestamptz
           FROM parts p
          WHERE p.active AND p.reorder_level IS NOT NULL AND p.qty_on_hand <= p.reorder_level
        UNION ALL
         SELECT 'expiring_documents'::text,
            'medium'::text,
            count(*)::integer AS count,
            NULL::timestamp with time zone AS timestamptz
           FROM ( SELECT ad.expiry_date
                   FROM archive_documents ad
                     LEFT JOIN archive_document_groups g ON g.id = ad.group_id,
                    riyadh r
                  WHERE ad.expiry_date IS NOT NULL
                    AND ad.expiry_date < (r.today + COALESCE(g.warning_days, 30))
                UNION ALL
                 SELECT d.license_expiry
                   FROM drivers d,
                    riyadh r
                  WHERE d.terminated_at IS NULL AND d.license_expiry IS NOT NULL AND d.license_expiry < (r.today + 30)
                UNION ALL
                 SELECT d.iqama_expiry
                   FROM drivers d,
                    riyadh r
                  WHERE d.terminated_at IS NULL AND d.iqama_expiry IS NOT NULL AND d.iqama_expiry < (r.today + 30)
                UNION ALL
                 SELECT s.iqama_expiry
                   FROM staff s,
                    riyadh r
                  WHERE s.terminated_at IS NULL AND s.iqama_expiry IS NOT NULL AND s.iqama_expiry < (r.today + 30)
                UNION ALL
                 SELECT t.registration_expiry
                   FROM trucks t,
                    riyadh r
                  WHERE t.terminated_at IS NULL AND t.registration_expiry IS NOT NULL AND t.registration_expiry < (r.today + 30)) exp) k;

alter view public.v_dashboard_action_items set (security_invoker = true);
revoke all on public.v_dashboard_action_items from anon;
grant select on public.v_dashboard_action_items to authenticated;

comment on view public.v_dashboard_action_items is
  'Dashboard action-item counts, one row per kind (0165 + 0200). Archive-document windows read notification_thresholds.warning_days; the four identity expiries keep their hardcoded 30-day window. 0200: permit_return_overdue now requires an actually-outstanding line — returned OR written-off quantity resolves it — so this card and the bell (v_active_alerts.permit_overdue) answer the same question. Before 0200 they did not, and this view over-counted every fully-returned late permit.';

-- ===========================================================================
-- 9. STRUCTURAL SELF-ASSERTS — RUN INSIDE THIS TRANSACTION.
--
-- These fail the migration, not a later Tuesday. Anything asserted here is
-- something that, if wrong, is silent: a view that lost security_invoker, a
-- constraint whose `drop ... if exists` quietly matched nothing, a function
-- that came out of `create or replace` with Supabase's default ACL intact.
-- ===========================================================================
do $assert$
declare
  v_cols  text;
  v_def   text;
  v_n     int;
begin
  -- ---- 9a) COLUMN CENSUS. `create or replace view` can only APPEND columns
  -- (42P16 otherwise), so a mismatch here means a column was appended by
  -- accident and every downstream `select *` reader just changed shape.
  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_parts_consumption_daily'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'source,day,truck_id,part_id,qty,cost_sar,basis' then
    raise exception 'v_parts_consumption_daily column list changed: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_active_alerts'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'alert_identity,severity,category,entity_type,entity_id,entity_label,value_num,value_date,payload' then
    raise exception 'v_active_alerts column list changed: %', v_cols;
  end if;

  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_dashboard_action_items'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'kind,severity,item_count,oldest_at' then
    raise exception 'v_dashboard_action_items column list changed: %', v_cols;
  end if;

  -- ---- 9b) SECURITY FOOTER CENSUS, all three replaced views.
  select count(*) into v_n
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('v_parts_consumption_daily','v_active_alerts','v_dashboard_action_items')
     and c.reloptions @> array['security_invoker=true'];
  if v_n <> 3 then
    raise exception 'expected 3 security_invoker views, found %', v_n;
  end if;

  select count(*) into v_n
    from (values ('v_parts_consumption_daily'),('v_active_alerts'),('v_dashboard_action_items')) t(v)
   where has_table_privilege('anon', 'public.' || t.v, 'SELECT');
  if v_n <> 0 then
    raise exception 'anon can still read % of the replaced views', v_n;
  end if;

  select count(*) into v_n
    from (values ('v_parts_consumption_daily'),('v_active_alerts'),('v_dashboard_action_items')) t(v)
   where has_table_privilege('authenticated', 'public.' || t.v, 'SELECT');
  if v_n <> 3 then
    raise exception 'authenticated lost SELECT on % of the replaced views', 3 - v_n;
  end if;

  -- ---- 9c) THE CONSTRAINTS ACTUALLY MOVED.
  -- If a `drop constraint if exists` above matched nothing because the name
  -- was wrong, the OLD narrow check would still be standing and every single
  -- write-off insert would fail at runtime instead of here.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.exit_permit_line_consumptions'::regclass
     and conname  = 'exit_permit_line_consumptions_direction_check';
  if v_def is null
     or v_def not like '%write_off%'
     or v_def not like '%write_off_reversal%'
     or v_def not like '%consume%'
     or v_def not like '%return%' then
    raise exception 'direction check did not widen: %', coalesce(v_def, '<missing>');
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.exit_permit_line_consumptions'::regclass
     and conname  = 'exit_permit_line_consumptions_direction_check';
  if v_n <> 1 then
    raise exception 'expected exactly 1 direction check, found % (an old narrow one survived)', v_n;
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.exit_permit_lines'::regclass
     and conname  = 'exit_permit_lines_not_over_returned';
  if v_def is null or v_def not like '%qty_written_off%' then
    raise exception 'not_over_returned did not gain qty_written_off: %', coalesce(v_def, '<missing>');
  end if;

  -- ---- 9d) THE READER HANDLES THE NEW VALUE.
  -- The landmine in one assert: every reader of exit_permit_line_consumptions
  -- does `case when direction = 'consume' then +x else -x end`. A direction the
  -- reader does not name is counted NEGATIVE. So the daily view must mention
  -- both new values, and the third (return-netting) arm must be FILTERED to the
  -- two old directions rather than catching everything in its `else`.
  v_def := pg_get_viewdef('public.v_parts_consumption_daily'::regclass, true);
  if v_def not like '%write_off_reversal%' then
    raise exception 'v_parts_consumption_daily does not name write_off_reversal — new rows would be counted as negative cost';
  end if;
  if v_def not like '%direction = ANY%' and v_def not like '%direction IN%' then
    raise exception 'v_parts_consumption_daily has no direction filter — a future fifth direction would fall INTO the netting arm instead of out of it';
  end if;

  -- ---- 9e) FUNCTION ACL CENSUS (0093's two tiers).
  -- ORCHESTRATORS: callable by authenticated + service_role, never anon/public.
  select count(*) into v_n
    from (values ('write_off_exit_permit_lines(uuid, jsonb, text, date, text, text)'),
                 ('reverse_exit_permit_write_off(uuid, text, text)')) t(sig)
   where has_function_privilege('authenticated', 'public.' || t.sig, 'EXECUTE')
     and not has_function_privilege('anon', 'public.' || t.sig, 'EXECUTE');
  if v_n <> 2 then
    raise exception 'write-off orchestrator grants are wrong (% of 2 correct)', v_n;
  end if;

  -- INTERNAL: callable by NOBODY. Supabase's `alter default privileges` hands
  -- EXECUTE to authenticated AND service_role at creation time, so this is a
  -- revoke that must be re-proven every time the function is replaced.
  if has_function_privilege('authenticated', 'public.write_off_exit_permit_line(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.write_off_exit_permit_line(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.write_off_exit_permit_line(uuid)', 'EXECUTE') then
    raise exception 'write_off_exit_permit_line is an INTERNAL and must be callable by no role';
  end if;

  -- SECURITY DEFINER with a pinned search_path, on every function this
  -- migration wrote. An unpinned definer is a privilege-escalation hole.
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('write_off_exit_permit_line','write_off_exit_permit_lines',
                       'reverse_exit_permit_write_off','record_exit_permit_return',
                       'consume_exit_permit_line','return_exit_permit_line','void_exit_permit')
     and p.prosecdef
     and array_to_string(p.proconfig, ',') like '%search_path%';
  if v_n < 7 then
    raise exception 'expected 7 pinned SECURITY DEFINER functions, found %', v_n;
  end if;

  -- ---- 9f) RLS IS ON, AND THE NEW TABLES ARE NOT ANON-READABLE.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('exit_permit_write_offs','exit_permit_write_off_lines')
     and c.relrowsecurity;
  if v_n <> 2 then
    raise exception 'RLS not enabled on both write-off tables (found %)', v_n;
  end if;

  raise notice '0200 structural asserts passed.';
end $assert$;

commit;

-- ===========================================================================
-- 10. BEHAVIOURAL VERIFICATION — RUN THIS SEPARATELY, AFTER THE MIGRATION.
--
-- Not part of the migration transaction. It writes, proves, and ROLLS BACK.
-- Run it against the same database the migration was applied to; it picks a
-- real returnable permit with outstanding lines (preferring EP-26-0004) and
-- exercises the whole feature on it, then throws the work away.
--
-- It proves the eight things that, if wrong, are silent and expensive:
--   1. cost is recognised ONCE, on write_off_date
--   2. the ORIGINAL EXIT MONTH does not move — not by a halala
--   3. no negative-cost leak (the unhandled-direction landmine)
--   4. NO STOCK MOVES — not one movement row, not one lot unit
--   5. the frozen header amount equals the ledger it claims to summarise
--   6. a return on a written-off line is refused, with a message that says
--      what to do about it
--   7. a reversal credits AT THE REVERSAL DATE and still does not move the
--      closed write-off month
--   8. negative control: write-off + reversal nets to exactly zero, all time
--
-- HOW TO READ THE RESULT.
--
-- THIS BLOCK EXITS 0 ON SUCCESS. It raises ONLY when a claim actually fails.
--
-- It did not always. Until the 2026-09-16 ledger reconcile it raised on success
-- too, as a deliberate "success signal". That cost more than it bought: because
-- the raise was unconditional, `supabase db reset` and `supabase db push`
-- exited 1 against a PERFECTLY HEALTHY database, so the migration set could
-- never be used as a repeatable green/red gate. Proven in the Phase-1 replay:
-- 197 of 198 files applied unattended and this one still failed the run.
--
-- The two problems the old raise solved, and what carries them now:
--
--   1. NOTICES ARE HIDDEN by Supabase's SQL tooling and by MCP execute_sql, so
--      a silent pass used to be indistinguishable from "it never ran".
--      NOW: the EXIT CODE is the signal. 0 = every claim proved (or SKIPPED,
--      named as such). Non-zero = the message names the claim that broke.
--      That is precisely what a gate needs, and it is machine-readable.
--   2. If a caller wrapped this in its own transaction and swallowed the
--      `rollback;` below, the verification writes would COMMIT — inventing a
--      real write-off, on production, out of a test.
--      NOW: `rollback;` still discards the work, and the ASSERTION ADDED AFTER
--      IT re-reads the tables and RAISES if any verification row survived.
--
-- BE CLEAR ABOUT THE TRADE. Point 2 moves from PREVENTION to DETECTION: the old
-- raise made persistence impossible, the new assertion makes it impossible to go
-- unnoticed. That is a real, deliberate reduction in guarantee, accepted so the
-- file set can be a gate. The assertion is not decoration — to watch it fire,
-- comment out the `rollback;` and run it.
--
--   exit 0, NOTICE "0200 VERIFY PASSED — 11/11 ..."  -> PASS, nothing written.
--   exit 0, NOTICE "0200 VERIFY SKIPPED — ..."       -> no subject data on this
--     database (a fresh `db reset` has none). The claims were NOT proved here.
--     Do not record a pass. Re-run against a database that has exit permits.
--   ERROR "FAIL <n>: ..."                            -> a real failure, and the
--     message names the claim that broke.
--   ERROR "FAIL PERSISTENCE: ..."                    -> the rollback did not
--     take and a verification write-off is sitting in the table. DELETE IT.
-- ===========================================================================
begin;

create temp table _wo_verify (seq int, claim text, result text) on commit drop;

do $verify$
declare
  v_ep            uuid;
  v_ep_number     text;
  v_lines         jsonb;
  v_first_line    uuid;
  v_wo            uuid;
  v_wo_row        public.exit_permit_write_offs;
  v_amount        numeric(12, 2);
  v_expected      numeric(12, 2);
  v_ledger        numeric(12, 2);
  v_today         date := (now() at time zone 'Asia/Riyadh')::date;
  v_wo_date       date;
  v_exit_month    date;
  v_wo_month      date;
  v_rev_month     date;
  b_exit          numeric := 0;
  b_wo            numeric := 0;
  b_rev           numeric := 0;
  a_exit          numeric := 0;
  a_wo            numeric := 0;
  a_rev           numeric := 0;
  b_onhand        numeric;
  b_lots          numeric;
  b_moves         bigint;
  a_onhand        numeric;
  a_lots          numeric;
  a_moves         bigint;
  v_n             int;
  v_neg           numeric;
  v_summary       text;
begin
  -- ---- PICK A SUBJECT ---------------------------------------------------
  select e.id, e.ep_number into v_ep, v_ep_number
    from public.exit_permits e
   where e.status = 'exited'
     and e.kind   = 'returnable'
     and exists (select 1 from public.exit_permit_lines el
                  where el.exit_permit_id = e.id
                    and el.qty - el.qty_returned - el.qty_written_off > 0)
     -- A live write-off already on this permit would make v_expected below
     -- overstate: consume-minus-return still counts units a previous write-off
     -- has already taken out. Pick a clean subject instead of a clever sum.
     and not exists (select 1 from public.exit_permit_write_offs w
                      where w.exit_permit_id = e.id and w.reversed_at is null)
   order by (e.ep_number = 'EP-26-0004') desc, e.exited_at
   limit 1;
  if v_ep is null then
    -- An empty database is not a broken one. A fresh `supabase db reset` has
    -- no exit permits, and failing the whole migration run for that made the
    -- file set unusable as a gate. Report honestly and stop: SKIPPED is not a
    -- pass, and the header says so.
    raise notice '0200 VERIFY SKIPPED — no exited returnable permit with outstanding lines on this database, so the eleven claims were NOT proved here. This is not a pass. Re-run against a database that carries exit-permit data.';
    return;
  end if;

  select jsonb_agg(jsonb_build_object('line_id', el.id,
                                      'qty',     el.qty - el.qty_returned - el.qty_written_off)),
         min(el.id::text)::uuid
    into v_lines, v_first_line
    from public.exit_permit_lines el
   where el.exit_permit_id = v_ep
     and el.qty - el.qty_returned - el.qty_written_off > 0;

  -- Writing off the WHOLE outstanding balance must cost exactly what is still
  -- sitting on the line: everything consumed, minus everything returned.
  -- Derived from the ledger, not from the function under test.
  select round(coalesce(sum(case when c.direction = 'consume' then  c.qty * c.unit_price_sar
                                 when c.direction = 'return'  then -c.qty * c.unit_price_sar
                            end), 0), 2)
    into v_expected
    from public.exit_permit_line_consumptions c
    join public.exit_permit_lines el on el.id = c.exit_permit_line_id
   where el.exit_permit_id = v_ep;

  select date_trunc('month', (e.exited_at at time zone 'Asia/Riyadh')::date)::date
    into v_exit_month from public.exit_permits e where e.id = v_ep;

  -- BACKDATED ON PURPOSE, TO THE MONTH BEFORE THE EXIT. Three distinct months
  -- is what makes the two interesting claims testable rather than assumed:
  --   write-off month  <  exit month  <=  reversal month (today)
  -- If the write-off landed in the exit month, "the exit month did not move"
  -- would be unfalsifiable, and a 45-day offset lands there for any permit
  -- that left in the last six weeks — EP-26-0004 included.
  v_wo_date    := (v_exit_month - interval '1 month')::date;
  v_wo_month   := date_trunc('month', v_wo_date)::date;
  v_rev_month  := date_trunc('month', v_today)::date;

  -- ---- BEFORE ----------------------------------------------------------
  select coalesce(sum(cost_sar), 0) into b_exit from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_exit_month;
  select coalesce(sum(cost_sar), 0) into b_wo from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_wo_month;
  select coalesce(sum(cost_sar), 0) into b_rev from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_rev_month;

  select coalesce(sum(qty_on_hand), 0)  into b_onhand from public.parts;
  select coalesce(sum(qty_remaining), 0) into b_lots  from public.price_lots;
  select count(*)                        into b_moves from public.stock_movements;

  raise notice 'subject % | outstanding cost % | exit month % | write-off month % | reversal month %',
    v_ep_number, v_expected, v_exit_month, v_wo_month, v_rev_month;
  raise notice 'BEFORE  exit-month %  write-off-month %  reversal-month %', b_exit, b_wo, b_rev;

  insert into _wo_verify values (1, 'subject + baseline', format(
    '%s | outstanding %s | months: write-off %s (%s), exit %s (%s), reversal %s (%s)',
    v_ep_number, v_expected, v_wo_month, b_wo, v_exit_month, b_exit, v_rev_month, b_rev));

  -- ---- ACT: WRITE OFF ---------------------------------------------------
  v_wo := public.write_off_exit_permit_lines(
            v_ep, v_lines,
            'Verification run — this transaction is rolled back.',
            v_wo_date, null, 'migration-0200-verify');

  select * into v_wo_row from public.exit_permit_write_offs where id = v_wo;
  v_amount := v_wo_row.amount_sar;

  -- 5. FROZEN AMOUNT == LEDGER SUM
  select round(coalesce(sum(c.qty * c.unit_price_sar), 0), 2) into v_ledger
    from public.exit_permit_line_consumptions c
    join public.exit_permit_write_off_lines wl on wl.id = c.write_off_line_id
   where wl.exit_permit_write_off_id = v_wo and c.direction = 'write_off';
  if v_amount <> v_ledger then
    raise exception 'FAIL 5: frozen amount % <> ledger %', v_amount, v_ledger;
  end if;
  if v_amount <> v_expected then
    raise exception 'FAIL 5: write-off cost % <> outstanding cost % on the line', v_amount, v_expected;
  end if;
  insert into _wo_verify values (2, '5. frozen amount = ledger = outstanding',
    format('PROVED (%s)', v_amount));

  -- ---- AFTER (write-off) ------------------------------------------------
  select coalesce(sum(cost_sar), 0) into a_exit from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_exit_month;
  select coalesce(sum(cost_sar), 0) into a_wo from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_wo_month;

  -- 2. THE EXIT MONTH DOES NOT MOVE
  if v_exit_month <> v_wo_month and a_exit <> b_exit then
    raise exception 'FAIL 2: exit month moved % -> % (a returnable exit must never be a cost)', b_exit, a_exit;
  end if;
  insert into _wo_verify values (3, '2. exit month did not move',
    case when v_exit_month = v_wo_month then format('N/A (write-off month = exit month %s)', v_exit_month)
         else format('PROVED (%s still %s)', v_exit_month, a_exit) end);

  -- 1. COST RECOGNISED ONCE, ON write_off_date
  if round(a_wo - b_wo, 2) <> v_amount then
    raise exception 'FAIL 1: write-off month moved by % but the write-off was % ', round(a_wo - b_wo, 2), v_amount;
  end if;
  insert into _wo_verify values (4, '1. cost recognised once, on write_off_date',
    format('PROVED (%s moved %s -> %s, delta +%s)', v_wo_month, b_wo, a_wo, round(a_wo - b_wo, 2)));

  -- 3. NO NEGATIVE-COST LEAK. Before the direction filter shipped, a
  -- 'write_off' row fell into the netting arm's `else` and subtracted.
  select coalesce(min(cost_sar), 0) into v_neg
    from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_wo_month;
  if v_neg < 0 then
    raise exception 'FAIL 3: a negative exit-permit cost row (%) appeared — a direction is being counted as a credit', v_neg;
  end if;
  insert into _wo_verify values (5, '3. no negative-cost leak',
    format('PROVED (lowest row in %s is %s)', v_wo_month, v_neg));

  -- 4. NO STOCK MOVED
  select coalesce(sum(qty_on_hand), 0)  into a_onhand from public.parts;
  select coalesce(sum(qty_remaining), 0) into a_lots  from public.price_lots;
  select count(*)                        into a_moves from public.stock_movements;
  if a_onhand <> b_onhand or a_lots <> b_lots or a_moves <> b_moves then
    raise exception 'FAIL 4: a write-off moved stock (on_hand % -> %, lots % -> %, movements % -> %). It must not.',
      b_onhand, a_onhand, b_lots, a_lots, b_moves, a_moves;
  end if;
  insert into _wo_verify values (6, '4. no stock moved',
    format('PROVED (on_hand %s, lot units %s, movement rows %s — all unchanged)', a_onhand, a_lots, a_moves));

  -- CHECK CONSTRAINT: nothing is outstanding now, so one more unit is refused.
  begin
    perform public.write_off_exit_permit_lines(
      v_ep, jsonb_build_array(jsonb_build_object('line_id', v_first_line, 'qty', 1)),
      'over-write-off probe', v_wo_date, null, 'migration-0200-verify');
    raise exception 'FAIL CHECK: writing off more than outstanding was accepted';
  exception when others then
    if sqlerrm like 'FAIL CHECK%' then raise; end if;
    if sqlerrm not like '%still outstanding%' then
      raise exception 'FAIL CHECK: wrong error from the over-write-off guard: %', sqlerrm;
    end if;
  end;
  insert into _wo_verify values (7, 'CHECK. writing off more than outstanding refused', 'PROVED');

  -- 6. RETURN GUARD
  begin
    perform public.record_exit_permit_return(
      v_ep, jsonb_build_array(jsonb_build_object('line_id', v_first_line, 'qty', 1)),
      v_today, null, 'migration-0200-verify');
    raise exception 'FAIL 6: a return was accepted on a written-off line';
  exception when others then
    if sqlerrm like 'FAIL 6%' then raise; end if;
    if sqlerrm not like '%Reverse the write-off first%' then
      raise exception 'FAIL 6: wrong error from the return guard: %', sqlerrm;
    end if;
  end;
  insert into _wo_verify values (8, '6. return on a written-off line refused', 'PROVED (message says to reverse first)');

  -- ---- ACT: REVERSE -----------------------------------------------------
  select * into v_wo_row
    from public.reverse_exit_permit_write_off(
           v_wo, 'Verification reversal.', 'migration-0200-verify');
  if v_wo_row.reversed_at is null or v_wo_row.reversed_by is null then
    raise exception 'FAIL 7: reversal did not stamp reversed_at/reversed_by';
  end if;
  if not exists (select 1 from public.exit_permit_write_offs where id = v_wo) then
    raise exception 'FAIL 7: reversal DELETED the write-off. It must never delete.';
  end if;

  select coalesce(sum(cost_sar), 0) into a_exit from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_exit_month;
  select coalesce(sum(cost_sar), 0) into a_wo from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_wo_month;
  select coalesce(sum(cost_sar), 0) into a_rev from public.v_parts_consumption_daily
   where source = 'exit_permit' and date_trunc('month', day)::date = v_rev_month;

  -- 7. THE CLOSED MONTH STILL DOES NOT MOVE, AND THE CREDIT LANDS TODAY
  if round(a_wo - b_wo, 2) <> v_amount then
    raise exception 'FAIL 7: the reversal rewrote the closed write-off month (delta now %, should still be %)',
      round(a_wo - b_wo, 2), v_amount;
  end if;
  if round(a_rev - b_rev, 2) <> -v_amount then
    raise exception 'FAIL 7: reversal credit landed as % in the reversal month, expected %',
      round(a_rev - b_rev, 2), -v_amount;
  end if;
  if v_exit_month not in (v_wo_month, v_rev_month) and a_exit <> b_exit then
    raise exception 'FAIL 7: the exit month moved during reversal';
  end if;
  insert into _wo_verify values (9, '7. reversal credits at the reversal date, closed month frozen',
    format('PROVED (%s still +%s, %s %s)', v_wo_month, round(a_wo - b_wo, 2), v_rev_month, round(a_rev - b_rev, 2)));

  -- 8. NEGATIVE CONTROL: all time, the pair is worth nothing.
  select round(coalesce(sum(case when c.direction = 'write_off' then  c.qty * c.unit_price_sar
                                 when c.direction = 'write_off_reversal' then -c.qty * c.unit_price_sar
                            end), 0), 2)
    into v_ledger
    from public.exit_permit_line_consumptions c
    join public.exit_permit_write_off_lines wl on wl.id = c.write_off_line_id
   where wl.exit_permit_write_off_id = v_wo;
  if v_ledger <> 0 then
    raise exception 'FAIL 8: write-off plus reversal nets % over all time, expected 0', v_ledger;
  end if;

  select count(*) into v_n from public.exit_permit_lines
   where exit_permit_id = v_ep and qty_written_off <> 0;
  if v_n <> 0 then
    raise exception 'FAIL 8: % line(s) still carry qty_written_off after a full reversal', v_n;
  end if;
  insert into _wo_verify values (10, '8. write-off + reversal nets zero, all time',
    'PROVED (ledger nets 0, qty_written_off back to 0)');

  -- STOCK STILL UNTOUCHED AFTER THE REVERSAL TOO
  select coalesce(sum(qty_on_hand), 0)  into a_onhand from public.parts;
  select coalesce(sum(qty_remaining), 0) into a_lots  from public.price_lots;
  select count(*)                        into a_moves from public.stock_movements;
  if a_onhand <> b_onhand or a_lots <> b_lots or a_moves <> b_moves then
    raise exception 'FAIL 4: the reversal moved stock. It must not.';
  end if;
  insert into _wo_verify values (11, '4. stock still untouched after the reversal', 'PROVED');

  raise notice 'AFTER   exit-month %  write-off-month %  reversal-month %', a_exit, a_wo, a_rev;

  -- ---- REPORT, AND THROW THE WORK AWAY ----------------------------------
  -- The completeness check below is the one that matters: a block that proved
  -- only nine claims and exited 0 would be worse than one that failed loudly.
  -- It still RAISES, because that is a real failure.
  select string_agg(format('%s. %s  ->  %s', seq, claim, result), E'\n' order by seq)
    into v_summary from _wo_verify;
  select count(*) into v_n from _wo_verify;
  if v_n <> 11 then
    raise exception 'FAIL: only % of 11 claims recorded a result. Do not read this as a pass. %',
      v_n, coalesce(v_summary, '(none)');
  end if;

  -- Success is a NOTICE, not an exception: see the header. The exit code is the
  -- signal now. The `rollback;` below discards the work, and the assertion
  -- after it proves the rollback took.
  raise notice E'0200 VERIFY PASSED — 11/11 claims proved on % (write-off % SAR). NOTHING WAS WRITTEN.\n%',
    v_ep_number, v_amount, v_summary;
end $verify$;

-- This is now the ONLY thing standing between the verification writes and the
-- table, so it is no longer "belt and braces". The assertion below checks it.
rollback;

-- ===========================================================================
-- 10b. THE ROLLBACK ACTUALLY TOOK — ASSERTED, NOT ASSUMED.
--
-- Runs OUTSIDE the verification transaction, so it reads committed state. Every
-- write the block makes is stamped with the actor 'migration-0200-verify', so
-- a single surviving row is detectable and nameable. To see this fire, comment
-- out the `rollback;` above and run the section again.
-- ===========================================================================
do $persistence$
declare
  v_wo   int;
  v_line int;
begin
  select count(*) into v_wo
    from public.exit_permit_write_offs
   where written_off_by = 'migration-0200-verify'
      or reversed_by    = 'migration-0200-verify';

  select count(*) into v_line
    from public.exit_permit_line_consumptions c
    join public.exit_permit_write_off_lines wl on wl.id = c.write_off_line_id
    join public.exit_permit_write_offs w on w.id = wl.exit_permit_write_off_id
   where w.written_off_by = 'migration-0200-verify'
      or w.reversed_by    = 'migration-0200-verify';

  if v_wo <> 0 or v_line <> 0 then
    raise exception
      'FAIL PERSISTENCE: the verification did NOT roll back. % write-off header(s) and % ledger row(s) stamped migration-0200-verify are sitting in the tables. They are fabricated and must be deleted: delete from public.exit_permit_write_offs where written_off_by = ''migration-0200-verify'' or reversed_by = ''migration-0200-verify'';',
      v_wo, v_line;
  end if;

  raise notice '0200 PERSISTENCE ASSERTED — 0 write-off headers and 0 ledger rows stamped migration-0200-verify survive. The verification wrote nothing.';
end $persistence$;

-- ---------------------------------------------------------------------------
-- 11. THE TWO NUMBERS TURKI ASKED FOR — read-only, safe to run any time.
--
--   select date_trunc('month', day)::date as month,
--          round(sum(cost_sar) filter (where source = 'maintenance'), 2)  as maintenance_sar,
--          round(sum(cost_sar) filter (where source = 'exit_permit'), 2)  as exit_permit_sar,
--          round(sum(cost_sar), 2)                                        as total_sar
--     from public.v_parts_consumption_daily
--    group by 1 order by 1;
--
-- BEFORE this migration (measured live 2026-09-15):
--   2026-07   maintenance 4873.95   exit_permit    0.00   total 4873.95
--   2026-08   maintenance 3539.00   exit_permit   50.00   total 3589.00
--   2026-09   maintenance    0.00   exit_permit    0.00   total    0.00
--
-- AFTER, once EP-26-0004's outstanding 190.00 is written off dated 2026-09-15:
--   2026-07   unchanged                                   total 4873.95
--   2026-08   unchanged                                   total 3589.00
--   2026-09   maintenance    0.00   exit_permit  190.00   total  190.00
--
-- August does not move. That is the whole point of B3 + E2.
-- ---------------------------------------------------------------------------
