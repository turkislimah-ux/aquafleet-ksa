-- 0061_maintenance_lifecycle.sql
-- Maintenance — Phase 2: work order lifecycle (start/complete) + real FIFO
-- deduction + task/notes editing. Builds on 0060 (schema + create_work_order,
-- reserve-only). Mirrors preview/'s pages-2.js MT.advance()/toggleTask()/
-- mechanic-notes-save flow, with one deliberate, Turki-approved departure
-- from preview's own simplified UI path (see complete_work_order below).
--
-- SCOPE THIS MIGRATION:
--   - work_orders gains started_by/completed_by (actor capture, alongside
--     created_by from 0060 — house RPC convention, one column per lifecycle
--     milestone, not a generic "last_modified_by").
--   - deduct_work_order_parts(): PRIVATE helper (no grant to authenticated —
--     only start_work_order/complete_work_order call it, as owner-executed
--     SECURITY DEFINER functions calling another function they own, which
--     needs no separate grant). Captures the TRUE FIFO-weighted price per
--     line by reading price_lots in the exact same order
--     (received_on asc, created_at asc) consume_from_lots itself uses, then
--     calls consume_from_lots to perform the ACTUAL deduction.
--     *** consume_from_lots remains the ONLY writer of price_lots.
--     qty_remaining / parts.qty_on_hand / stock_movements. *** This helper
--     never writes to any of those — only to work_order_parts.unit_price_sar
--     (a Maintenance-owned column) and work_orders.inventory_deducted_at.
--   - start_work_order(): open -> in_progress. Runs the deduction (if not
--     already run).
--   - complete_work_order(): any non-terminal status -> completed. Runs the
--     deduction if the WO was never started (mirrors preview's own "jump
--     straight to completed" path), forces every task done, RECOMPUTES
--     actual_cost_sar from the true consumed work_order_parts lines + labor
--     (does NOT copy estimated_cost_sar — Turki's explicit call, the
--     deliberate departure from preview's own simplified UI path, which just
--     copies the estimate verbatim).
--   - toggle_work_order_task(), save_work_order_notes(): small guarded
--     mutations, blocked once the parent WO is completed/cancelled.
--
-- TRUCK STATUS — DELIBERATELY OUT OF THIS MIGRATION (Turki's call, this
-- revision): neither start_work_order nor complete_work_order touch
-- trucks.status at all. Ship the Maintenance lifecycle now; truck-status
-- auto-linking is being redesigned as its OWN cross-module build (a real
-- ACTIVE/IDLE/MAINTENANCE state machine derived from driver-assignment +
-- active-maintenance across Fleet + Drivers + Maintenance, replacing the
-- Fleet page's current manual status dropdown entirely — same "derived,
-- never stored as a manual choice" shape as lib/driver-state.ts) — planned
-- separately, not folded into this phase.
--
-- work_orders.prior_truck_status (added by 0060) is now DORMANT — no writer,
-- no reader, anywhere in this build. Left in place rather than dropped,
-- same "parked unused column, not deleted" precedent this app already
-- follows for dormant objects (e.g. receive_stock's RPC, 0044, kept live
-- with no caller). Whoever designs the cross-module auto-status build
-- should decide then whether this column is reused or a fresh one is
-- cleaner — not decided here.
--
-- NOT in this migration: photos (Phase 3), outsourced track (Phase 4),
-- Fleet Detail wiring (Phase 5), truck-status auto-linking (separate,
-- cross-module build, see above). 'cancelled' still has no RPC/UI path
-- anywhere in this build (same dormant-enum-value precedent as 0060's own
-- header).
--
-- *** STOCK RULE UNCHANGED FROM 0060: a work order can never draw more than
-- on-hand. *** deduct_work_order_parts' pre-walk over price_lots is READ-ONLY
-- (a SELECT ... FOR UPDATE lock, matching consume_from_lots' own lock order
-- so there's no deadlock risk re-acquiring the same rows in the same
-- transaction) — it computes the weighted price ONLY, then hands the actual
-- deduction to consume_from_lots, which independently re-checks
-- qty_on_hand >= qty and raises if short. This is the SAME hard-block
-- 0060's create_work_order enforces at reservation time, now also
-- authoritative at consumption time — stock can drift between "schedule"
-- and "start" (another WO or a stock adjustment could have drawn it down),
-- so this is not a redundant check, it's the real, final gate.
--
-- RPC DISCIPLINE: exact-signature drop-then-create, SECURITY DEFINER,
-- SET search_path = public, grant execute to authenticated (except the
-- private helper) — same as every prior RPC in this project.

begin;

alter table public.work_orders
  add column if not exists started_by text,
  add column if not exists completed_by text;

-- ----------------------------------------------------------------------------
-- deduct_work_order_parts — PRIVATE helper, not granted to authenticated.
-- Only callable from within another SECURITY DEFINER function owned by the
-- same role (start_work_order / complete_work_order below), which needs no
-- separate grant to invoke a function it already owns.
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
  v_wo_number  text;
  v_line       record;
  v_lot        record;
  v_remaining  numeric(12, 2);
  v_take       numeric(12, 2);
  v_line_cost  numeric(12, 2);
  v_weighted   numeric(12, 2);
begin
  select wo_number into v_wo_number from public.work_orders where id = p_wo_id;

  for v_line in
    select id, part_id, qty from public.work_order_parts where work_order_id = p_wo_id
  loop
    v_remaining := v_line.qty;
    v_line_cost := 0;

    -- Read-only pre-walk, SAME FIFO order consume_from_lots uses
    -- (received_on asc, created_at asc) — locks these rows now so the
    -- price captured here is guaranteed to match what consume_from_lots
    -- actually drains a few lines below, within this same transaction.
    for v_lot in
      select qty_remaining, price_sar
        from public.price_lots
       where part_id = v_line.part_id
         and qty_remaining > 0
       order by received_on asc, created_at asc
       for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.qty_remaining, v_remaining);
      v_line_cost := v_line_cost + (v_take * v_lot.price_sar);
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Price-lot ledger is short for part % on work order % — qty_on_hand and lots have drifted.',
        v_line.part_id, v_wo_number;
    end if;

    v_weighted := round(v_line_cost / v_line.qty, 2);

    -- THE ONLY STOCK WRITE. Hard-blocks (raises) if qty_on_hand is now
    -- insufficient for this line — the authoritative, final check.
    perform public.consume_from_lots(v_line.part_id, v_line.qty, 'Work order ' || v_wo_number, p_actor);

    update public.work_order_parts
       set unit_price_sar = v_weighted
     where id = v_line.id;
  end loop;

  update public.work_orders set inventory_deducted_at = now() where id = p_wo_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- start_work_order — open -> in_progress. No truck-status write (see header).
-- ----------------------------------------------------------------------------
drop function if exists public.start_work_order(uuid, text);
create or replace function public.start_work_order(
  p_wo_id uuid,
  p_actor text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status <> 'open' then
    raise exception 'Only an open work order can be started (current status: %).', v_wo.status;
  end if;

  if v_wo.inventory_deducted_at is null then
    perform public.deduct_work_order_parts(p_wo_id, p_actor);
  end if;

  update public.work_orders
     set status = 'in_progress',
         started_by = p_actor
   where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.start_work_order(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_work_order — any non-terminal status -> completed. No truck-status
-- write, no restore (see header).
-- ----------------------------------------------------------------------------
drop function if exists public.complete_work_order(uuid, text);
create or replace function public.complete_work_order(
  p_wo_id uuid,
  p_actor text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo         public.work_orders;
  v_parts_cost numeric(12, 2);
  v_actual     numeric(12, 2);
begin
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status in ('completed', 'cancelled') then
    raise exception 'Work order is already %.', v_wo.status;
  end if;

  if v_wo.inventory_deducted_at is null then
    perform public.deduct_work_order_parts(p_wo_id, p_actor);
  end if;

  update public.work_order_tasks set done = true where work_order_id = p_wo_id;

  -- RECOMPUTE from the true consumed lines (unit_price_sar was just
  -- overwritten by deduct_work_order_parts with the real FIFO-weighted
  -- price) + labor. NOT a copy of estimated_cost_sar — Turki's explicit
  -- call, the deliberate departure from preview's own simplified UI path.
  select coalesce(sum(qty * unit_price_sar), 0) into v_parts_cost
    from public.work_order_parts
   where work_order_id = p_wo_id;

  v_actual := round(v_parts_cost + (v_wo.labor_hours * v_wo.labor_rate_sar), 2);

  update public.work_orders
     set status = 'completed',
         closed_at = now(),
         actual_cost_sar = v_actual,
         completed_by = p_actor
   where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- toggle_work_order_task — blocked once the parent WO is completed/cancelled.
-- No actor column exists on work_order_tasks (no per-task audit trail in
-- this schema, only WO-level lifecycle milestones carry created_by/
-- started_by/completed_by) — p_actor is accepted for RPC-signature
-- consistency with house convention but has nowhere to be stored here.
-- ----------------------------------------------------------------------------
drop function if exists public.toggle_work_order_task(uuid, boolean, text);
create or replace function public.toggle_work_order_task(
  p_task_id uuid,
  p_done boolean,
  p_actor text default null
)
returns public.work_order_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task      public.work_order_tasks;
  v_wo_status text;
begin
  select * into v_task from public.work_order_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;

  select status into v_wo_status from public.work_orders where id = v_task.work_order_id;
  if v_wo_status in ('completed', 'cancelled') then
    raise exception 'Cannot modify tasks on a % work order.', v_wo_status;
  end if;

  update public.work_order_tasks set done = p_done where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.toggle_work_order_task(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- save_work_order_notes — blocked once the WO is completed/cancelled. Same
-- "p_actor accepted, nowhere dedicated to store it" reasoning as the task
-- toggle above.
-- ----------------------------------------------------------------------------
drop function if exists public.save_work_order_notes(uuid, text, text);
create or replace function public.save_work_order_notes(
  p_wo_id uuid,
  p_notes text,
  p_actor text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
begin
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status in ('completed', 'cancelled') then
    raise exception 'Cannot edit notes on a % work order.', v_wo.status;
  end if;

  update public.work_orders set mechanic_notes = nullif(trim(p_notes), '') where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.save_work_order_notes(uuid, text, text) to authenticated;

commit;
