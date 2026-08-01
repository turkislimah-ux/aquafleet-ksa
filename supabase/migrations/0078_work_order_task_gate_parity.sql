-- 0078_work_order_task_gate_parity.sql
-- In-house task-gate parity with the outsourced track — Turki's decision:
-- YES, match it. 0072 gave toggle_outsourced_job_task a guard blocking
-- while status='scheduled' (tasks only checkable once dispatched); this
-- was explicitly held back from toggle_work_order_task at the time
-- (0072's own header: "IN-HOUSE PARITY EXPLICITLY NOT TOUCHED... pending
-- his decision"). Now applying the same rule to the in-house side: tasks
-- are only checkable once the work order is started (in_progress), not
-- while still 'open'.
--
-- Signature unchanged (uuid, boolean, text). Body identical to 0061's
-- live version — not-found check, row lock, completed/cancelled block,
-- update, return — with ONE new block added: raise if status='open',
-- placed BEFORE the existing completed/cancelled check (same order 0072
-- used for the OS toggle's scheduled-then-completed pair). No other RPC
-- touched, no internal helper recreated.

begin;

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
  if v_wo_status = 'open' then
    raise exception 'Tasks cannot be checked before the work order is started.';
  end if;
  if v_wo_status in ('completed', 'cancelled') then
    raise exception 'Cannot modify tasks on a % work order.', v_wo_status;
  end if;

  update public.work_order_tasks set done = p_done where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.toggle_work_order_task(uuid, boolean, text) to authenticated;

commit;
