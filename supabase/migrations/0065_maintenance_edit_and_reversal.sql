-- 0065_maintenance_edit_and_reversal.sql
-- Maintenance — item 4 of the revisions batch: edit_work_order (editable in
-- BOTH 'open' and 'in_progress'/'awaiting_parts', all inputs) + FIFO-accurate
-- stock reversal. Folds in all four fixes from design review plus the
-- revoke gotcha this project already hit once (0062).
--
-- ============================================================================
-- FIX A — shared consume helper, used by EVERY consume path
-- ============================================================================
-- consume_work_order_line() is factored out of deduct_work_order_parts
-- (0061) and is now the ONE place that (a) walks price_lots FIFO, (b)
-- records the per-lot draw into the new work_order_part_consumptions
-- ledger, and (c) calls consume_from_lots for the actual deduction.
-- deduct_work_order_parts (initial start-time deduction) and
-- edit_work_order (new line / qty-increase while in_progress) BOTH call
-- it — so the consumption ledger is always written wherever stock leaves,
-- never just on the "first" path. This was the correctness-critical gap:
-- without it, edits made after a WO started would consume stock for real
-- (through the same consume_from_lots) but leave no per-lot trace, making
-- any LATER reversal of that specific consumption impossible to do
-- accurately.
--
-- ============================================================================
-- NEW LEDGER — work_order_part_consumptions
-- ============================================================================
-- Append-only (same "never update/delete" convention as stock_movements).
-- One row per (work-order-part-line, price_lot) touched, direction
-- 'consume' or 'return', always a positive qty. Net qty currently held
-- against a given lot, for a given line = sum(consume) - sum(return) for
-- that (work_order_part_id, price_lot_id) pair. This is the ONLY source of
-- truth a reversal reads to know which lots to credit back and by how
-- much — consume_from_lots itself never recorded this, so it didn't exist
-- until now.
--
-- ============================================================================
-- FIX C — return_to_lots: reverse counterpart to consume_from_lots
-- ============================================================================
-- Same discipline, opposite direction:
--   - Locks the EXACT price_lots rows being restored (a plain UPDATE
--     inherently locks the row it modifies — same reasoning already
--     applied throughout this project's other RPCs).
--   - NO phantom lot ever created — restores qty_remaining on the lots
--     stock actually came from, found via the consumption ledger, walked
--     most-recent-first (the natural "undo what just happened" order for
--     a partial reversal spanning >1 lot).
--   - NO direct parts.qty_on_hand edit outside the one accounted
--     increment matching exactly what was restored to lots.
--   - Logs a stock_movements row, movement_type='return' (new value,
--     added additively — fix D, see below).
-- The aquafleet-domain skill (.claude/skills/aquafleet-domain/SKILL.md) is
-- updated in this same change to name consume_from_lots + return_to_lots as
-- the two (and only two) writers for consumption-shaped stock movement.
--
-- ============================================================================
-- FIX D — stock_movements CHECK widening is additive only
-- ============================================================================
-- Old constraint (verified live before writing this):
--   CHECK (movement_type = ANY (ARRAY['receive','adjust','receive_lot','consume']))
-- New constraint re-adds the full existing set PLUS 'return' — nothing
-- dropped, no existing row can ever fail re-validation.
--
-- ============================================================================
-- FIX B — edit_work_order locks the WO row first
-- ============================================================================
-- `select * into v_wo from work_orders where id = p_wo_id for update` is
-- the very first statement in edit_work_order's body, before any other
-- read or guard.
--
-- ============================================================================
-- edit_work_order — editable while status in ('open','in_progress',
-- 'awaiting_parts'). Every input from create_work_order is editable here
-- too (type/priority/due_by/mechanic/labor_hours/tasks/parts lines),
-- per Turki's explicit "all inputs" instruction.
-- ============================================================================
-- Re-validates mechanic eligibility and RE-SNAPSHOTS labor_rate_sar from
-- that mechanic's CURRENT salary — an edit is a legitimate re-snapshot
-- point (Turki's own labor rule: create/edit both snapshot, nothing ever
-- re-derives live at completion time).
--
-- TASKS reconciled by CURRENT text match against the newly-selected
-- repair_description ids — a task row whose text still matches a
-- currently-selected description KEEPS its done state (editing an
-- in-progress WO must never silently un-check work already done); rows for
-- deselected descriptions are removed; newly selected ones insert fresh
-- (done=false).
--
-- PARTS LINES diffed old-vs-new by part_id:
--   - status='open': pure reserve-only edit (add/remove/resize), same
--     on-hand hard-block create_work_order already enforces. Zero stock
--     touched — matches create's own reserve-only behavior.
--   - status in ('in_progress','awaiting_parts') (parts already left the
--     ledger, no future "start" event left to defer to):
--       * REMOVED line -> reverse its full net-consumed qty via
--         return_to_lots, then delete the line (cascades its now-settled
--         ledger rows) — same "delete after reversal" precedent this app
--         already set with reject_stock_receipt's remove_stock branch
--         deleting the exact price_lots rows it reverses (migration 0058).
--       * NEW line -> consume immediately via consume_work_order_line
--         (hard-blocks the same way start_work_order's own deduction does).
--       * QTY INCREASE -> consume just the delta via
--         consume_work_order_line.
--       * QTY DECREASE -> reverse just the delta via return_to_lots.
--   Every consume/return touch recomputes that line's unit_price_sar as the
--   TRUE blended weighted average across its full net consumption ledger —
--   never left stale.
--
-- ============================================================================
-- REVOKE GOTCHA (0062's lesson, reapplied) — dropping+recreating a
-- function on Supabase re-grants EXECUTE to PUBLIC/anon/authenticated/
-- service_role by default (schema-level default ACL, independent of any
-- explicit `grant ... to authenticated`). deduct_work_order_parts is
-- recreated in THIS migration (now a thin wrapper over
-- consume_work_order_line), so its 0062 revoke is void and must be
-- reapplied here. consume_work_order_line and return_to_lots are brand
-- new and need the same revoke from the moment they're created — this
-- migration subsumes 0062, no need to run it separately.
-- ============================================================================
--
-- RPC DISCIPLINE: exact-signature drop-then-create, SECURITY DEFINER,
-- SET search_path = public — unchanged. edit_work_order is granted to
-- authenticated (a real, direct app-callable entry point, same as
-- create_work_order/start_work_order/complete_work_order). The three
-- helpers (consume_work_order_line, return_to_lots, deduct_work_order_parts)
-- are explicitly revoked from public/anon/authenticated/service_role —
-- internal-only, callable only from within another SECURITY DEFINER
-- function owned by the same role, which needs no grant to invoke a
-- function it already owns.

begin;

-- ----------------------------------------------------------------------------
-- work_order_part_consumptions
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_part_consumptions (
  id                  uuid primary key default gen_random_uuid(),
  work_order_part_id  uuid not null references public.work_order_parts(id) on delete cascade,
  price_lot_id        uuid not null references public.price_lots(id) on delete restrict,
  direction           text not null check (direction in ('consume', 'return')),
  qty                 numeric(12, 2) not null check (qty > 0),
  unit_price_sar      numeric(12, 2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists work_order_part_consumptions_wop_id_idx
  on public.work_order_part_consumptions (work_order_part_id);
create index if not exists work_order_part_consumptions_lot_id_idx
  on public.work_order_part_consumptions (price_lot_id);

alter table public.work_order_part_consumptions enable row level security;
drop policy if exists "authenticated_all_work_order_part_consumptions" on public.work_order_part_consumptions;
create policy "authenticated_all_work_order_part_consumptions"
  on public.work_order_part_consumptions for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- stock_movements — additive CHECK widening (fix D). Full existing set
-- re-added, 'return' appended, nothing dropped.
-- ----------------------------------------------------------------------------
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array['receive', 'adjust', 'receive_lot', 'consume', 'return']));

-- ----------------------------------------------------------------------------
-- consume_work_order_line — PRIVATE. Shared by deduct_work_order_parts
-- (initial deduction) and edit_work_order (new line / qty increase).
-- Records per-lot draw into work_order_part_consumptions, then calls
-- consume_from_lots (the sole forward stock writer) for the real
-- deduction. Recomputes the line's blended unit_price_sar afterward.
-- ----------------------------------------------------------------------------
drop function if exists public.consume_work_order_line(uuid, numeric, text);
create or replace function public.consume_work_order_line(
  p_work_order_part_id uuid,
  p_qty numeric,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part_id   uuid;
  v_wo_id     uuid;
  v_wo_number text;
  v_remaining numeric(12, 2);
  v_take      numeric(12, 2);
  v_lot       record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Consume quantity must be positive.';
  end if;

  select part_id, work_order_id into v_part_id, v_wo_id
    from public.work_order_parts
   where id = p_work_order_part_id
   for update;
  if v_part_id is null then
    raise exception 'Work order part line not found.';
  end if;

  select wo_number into v_wo_number from public.work_orders where id = v_wo_id;

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

    insert into public.work_order_part_consumptions
      (work_order_part_id, price_lot_id, direction, qty, unit_price_sar)
    values
      (p_work_order_part_id, v_lot.id, 'consume', v_take, v_lot.price_sar);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Price-lot ledger is short for work order % — qty_on_hand and lots have drifted.', v_wo_number;
  end if;

  -- THE ONLY FORWARD STOCK WRITE.
  perform public.consume_from_lots(v_part_id, p_qty, 'Work order ' || v_wo_number, p_actor);

  update public.work_order_parts
     set unit_price_sar = (
       select sum(case when c.direction = 'consume' then c.qty * c.unit_price_sar else -(c.qty * c.unit_price_sar) end)
              / nullif(sum(case when c.direction = 'consume' then c.qty else -c.qty end), 0)
         from public.work_order_part_consumptions c
        where c.work_order_part_id = p_work_order_part_id
     )
   where id = p_work_order_part_id;
end;
$$;

revoke execute on function public.consume_work_order_line(uuid, numeric, text)
  from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- return_to_lots — PRIVATE. The reverse counterpart to consume_from_lots.
-- ----------------------------------------------------------------------------
drop function if exists public.return_to_lots(uuid, numeric, text);
create or replace function public.return_to_lots(
  p_work_order_part_id uuid,
  p_qty numeric,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part_id        uuid;
  v_wo_id          uuid;
  v_wo_number      text;
  v_remaining      numeric(12, 2);
  v_take           numeric(12, 2);
  v_total_returned numeric(12, 2) := 0;
  v_lot            record;
  v_purchased      numeric(12, 2);
  v_new_remaining  numeric(12, 2);
  v_after          numeric(12, 2);
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Reversal quantity must be positive.';
  end if;

  select part_id, work_order_id into v_part_id, v_wo_id
    from public.work_order_parts
   where id = p_work_order_part_id
   for update;
  if v_part_id is null then
    raise exception 'Work order part line not found.';
  end if;

  select wo_number into v_wo_number from public.work_orders where id = v_wo_id;

  v_remaining := p_qty;

  -- Net qty currently held per lot for this line, walked most-recent-first
  -- (the newest draws get undone first — the unambiguous order for a
  -- partial reversal spanning more than one lot).
  for v_lot in
    select c.price_lot_id,
           sum(case when c.direction = 'consume' then c.qty else -c.qty end) as net_qty,
           max(c.created_at) as last_touched
      from public.work_order_part_consumptions c
     where c.work_order_part_id = p_work_order_part_id
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
      raise exception 'Reversal would return more stock than lot % ever held.', v_lot.price_lot_id;
    end if;

    insert into public.work_order_part_consumptions
      (work_order_part_id, price_lot_id, direction, qty, unit_price_sar)
    select p_work_order_part_id, v_lot.price_lot_id, 'return', v_take, price_sar
      from public.price_lots where id = v_lot.price_lot_id;

    v_remaining := v_remaining - v_take;
    v_total_returned := v_total_returned + v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Cannot reverse % for this line — only % is net-consumed against tracked lots.',
      p_qty, v_total_returned;
  end if;

  update public.parts
     set qty_on_hand = qty_on_hand + v_total_returned
   where id = v_part_id
  returning qty_on_hand into v_after;

  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (v_part_id, 'return', v_total_returned, v_after, 'Reversal for work order ' || v_wo_number, p_actor);

  update public.work_order_parts
     set unit_price_sar = coalesce((
       select sum(case when c.direction = 'consume' then c.qty * c.unit_price_sar else -(c.qty * c.unit_price_sar) end)
              / nullif(sum(case when c.direction = 'consume' then c.qty else -c.qty end), 0)
         from public.work_order_part_consumptions c
        where c.work_order_part_id = p_work_order_part_id
     ), unit_price_sar)
   where id = p_work_order_part_id;
end;
$$;

revoke execute on function public.return_to_lots(uuid, numeric, text)
  from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- deduct_work_order_parts — now a thin wrapper (fix A): loops the WO's
-- lines and calls consume_work_order_line for each, instead of
-- reimplementing the FIFO walk itself.
-- ----------------------------------------------------------------------------
drop function if exists public.deduct_work_order_parts(uuid, text);
create or replace function public.deduct_work_order_parts(
  p_wo_id uuid,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
begin
  for v_line in
    select id, qty from public.work_order_parts where work_order_id = p_wo_id
  loop
    perform public.consume_work_order_line(v_line.id, v_line.qty, p_actor);
  end loop;

  update public.work_orders set inventory_deducted_at = now() where id = p_wo_id;
end;
$$;

revoke execute on function public.deduct_work_order_parts(uuid, text)
  from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- edit_work_order — PUBLIC entry point (authenticated).
-- ----------------------------------------------------------------------------
drop function if exists public.edit_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, numeric, text
);
create or replace function public.edit_work_order(
  p_wo_id                uuid,
  p_type                 text,
  p_priority             text,
  p_due_by               timestamptz,
  p_mechanic_staff_id    uuid,
  p_task_description_ids jsonb,
  p_lines                jsonb,
  p_labor_hours          numeric,
  p_actor                text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo             public.work_orders;
  v_mechanic       public.staff;
  v_days_per_month int;
  v_hourly_cost    numeric(12, 2);
  v_task           jsonb;
  v_desc_id        uuid;
  v_desc           record;
  v_ordinal        int := 0;
  v_selected_en    text[] := '{}';
  v_line           jsonb;
  v_part_id        uuid;
  v_qty            numeric(12, 2);
  v_part           public.parts;
  v_existing       record;
  v_line_id        uuid;
  v_old_qty        numeric(12, 2);
  v_net_consumed   numeric(12, 2);
  v_parts_cost     numeric(12, 2) := 0;
  v_estimated      numeric(12, 2);
begin
  -- Fix B: lock the WO row first, before any other read or guard.
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status in ('completed', 'cancelled') then
    raise exception 'Cannot edit a % work order.', v_wo.status;
  end if;

  select * into v_mechanic from public.staff
   where id = p_mechanic_staff_id
     and role = 'mechanic'
     and active = true
     and terminated_at is null;
  if v_mechanic.id is null then
    raise exception 'Mechanic not found, inactive, or not eligible.';
  end if;
  if v_mechanic.monthly_salary_sar is null then
    raise exception 'Mechanic % has no monthly salary set — add it on the People page before editing this work order.', v_mechanic.name;
  end if;
  if v_mechanic.duty_hours is null or v_mechanic.duty_hours <= 0 then
    raise exception 'Mechanic % has no valid duty hours set.', v_mechanic.name;
  end if;

  if p_due_by is null then
    raise exception 'Due date is required.';
  end if;
  if p_labor_hours is null or p_labor_hours <= 0 then
    raise exception 'Labor hours must be positive.';
  end if;

  select standard_working_days_per_month into v_days_per_month
    from public.company_settings where id = true;
  if v_days_per_month is null or v_days_per_month <= 0 then
    raise exception 'Standard working days per month is not configured.';
  end if;

  -- Re-snapshot from the mechanic's CURRENT salary — an edit is a
  -- legitimate re-snapshot point, same rule as create_work_order.
  v_hourly_cost := round(v_mechanic.monthly_salary_sar / (v_mechanic.duty_hours * v_days_per_month), 2);

  update public.work_orders
     set type = p_type,
         priority = p_priority,
         due_by = p_due_by,
         assigned_mechanic_id = p_mechanic_staff_id,
         labor_hours = p_labor_hours,
         labor_rate_sar = v_hourly_cost
   where id = p_wo_id;

  -- ---- Tasks: reconcile by current text, preserve done-state for matches ----
  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.repair_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Repair description % not found or inactive.', v_desc_id;
      end if;
      v_selected_en := array_append(v_selected_en, v_desc.en);

      if not exists (
        select 1 from public.work_order_tasks
         where work_order_id = p_wo_id and description_en = v_desc.en
      ) then
        insert into public.work_order_tasks (work_order_id, description_en, description_ar, ordinal)
        values (p_wo_id, v_desc.en, v_desc.ar, v_ordinal);
      end if;
      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  delete from public.work_order_tasks
   where work_order_id = p_wo_id
     and not (description_en = any (v_selected_en));

  -- ---- Parts lines: removals first ----
  for v_existing in
    select wop.id, wop.part_id, wop.qty
      from public.work_order_parts wop
     where wop.work_order_id = p_wo_id
  loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
       where nullif(l->>'part_id', '')::uuid = v_existing.part_id
    ) then
      select coalesce(sum(case when direction = 'consume' then qty else -qty end), 0) into v_net_consumed
        from public.work_order_part_consumptions
       where work_order_part_id = v_existing.id;

      if v_net_consumed > 0 then
        perform public.return_to_lots(v_existing.id, v_net_consumed, p_actor);
      end if;

      delete from public.work_order_parts where id = v_existing.id;
    end if;
  end loop;

  -- ---- Parts lines: adds + qty changes ----
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_part_id := nullif(v_line->>'part_id', '')::uuid;
      v_qty     := nullif(v_line->>'qty', '')::numeric;

      if v_part_id is null then
        raise exception 'Line item is missing part_id.';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Line item quantity must be positive.';
      end if;

      select * into v_part from public.parts where id = v_part_id and active = true;
      if v_part.id is null then
        raise exception 'Part not found or inactive.';
      end if;

      select id, qty into v_line_id, v_old_qty
        from public.work_order_parts
       where work_order_id = p_wo_id and part_id = v_part_id;

      if v_line_id is null then
        -- New line.
        if v_wo.status = 'open' then
          if v_qty > v_part.qty_on_hand then
            raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
              v_part.name, v_part.qty_on_hand, v_qty;
          end if;
          insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
          values (p_wo_id, v_part_id, v_qty, coalesce(v_part.unit_cost_sar, 0));
        else
          -- Already in progress — no future "start" event to defer to,
          -- consume now.
          insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
          values (p_wo_id, v_part_id, v_qty, coalesce(v_part.unit_cost_sar, 0))
          returning id into v_line_id;
          perform public.consume_work_order_line(v_line_id, v_qty, p_actor);
        end if;
      elsif v_qty <> v_old_qty then
        if v_wo.status = 'open' then
          if v_qty > v_part.qty_on_hand then
            raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
              v_part.name, v_part.qty_on_hand, v_qty;
          end if;
          update public.work_order_parts set qty = v_qty where id = v_line_id;
        else
          update public.work_order_parts set qty = v_qty where id = v_line_id;
          if v_qty > v_old_qty then
            perform public.consume_work_order_line(v_line_id, v_qty - v_old_qty, p_actor);
          else
            perform public.return_to_lots(v_line_id, v_old_qty - v_qty, p_actor);
          end if;
        end if;
      end if;
      -- else: unchanged line, left entirely alone.
    end loop;
  end if;

  select coalesce(sum(qty * unit_price_sar), 0) into v_parts_cost
    from public.work_order_parts where work_order_id = p_wo_id;

  v_estimated := round(v_parts_cost + (p_labor_hours * v_hourly_cost), 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.edit_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, numeric, text
) to authenticated;

commit;
