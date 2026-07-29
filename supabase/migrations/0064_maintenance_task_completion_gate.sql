-- 0064_maintenance_task_completion_gate.sql
-- Maintenance — Turki's decision: REMOVE complete_work_order's old
-- "force-mark every task done" behavior (0061's original design).
-- Replace with a hard guard — a work order can only complete once EVERY
-- task on it is already checked. If any task is still undone, raise and
-- block. Greying "Mark Complete" until all tasks are checked is the UI's
-- job (app-code follow-up alongside this migration), not this RPC's — the
-- RPC stays the real, authoritative gate regardless of what the button
-- looks like.
--
-- A work order with zero tasks (create_work_order allows saving with no
-- description chips selected) is unaffected — the guard only fires when a
-- work_order_tasks row exists AND is undone; no rows means nothing to
-- block on.
--
-- Nothing else about complete_work_order changes: the deduction-if-never-
-- started path (deduct_work_order_parts), the actual_cost_sar recompute
-- from true consumed lines + labor, and completed_by/closed_at all stay
-- exactly as 0061 built them.
--
-- RPC DISCIPLINE: exact-signature drop-then-create (signature itself is
-- unchanged — uuid, text — but the body changes, and this project's own
-- convention is to still drop-then-create every time, defensively, not
-- just when the signature moves).

begin;

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

  -- Turki's gate: every task must already be checked. No more auto-forcing
  -- them done on completion.
  if exists (
    select 1 from public.work_order_tasks
     where work_order_id = p_wo_id and done = false
  ) then
    raise exception 'All tasks must be completed before this work order can be marked complete.';
  end if;

  if v_wo.inventory_deducted_at is null then
    perform public.deduct_work_order_parts(p_wo_id, p_actor);
  end if;

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

commit;
