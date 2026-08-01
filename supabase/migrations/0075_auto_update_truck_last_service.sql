-- 0075_auto_update_truck_last_service.sql
-- Maintenance — trucks.last_service_date now auto-updates on completion,
-- both tracks. Was purely hand-editable before (Truck Edit form's own
-- input) — a real job finishing should move it forward automatically,
-- same "the RPC is the source of truth" convention every other Maintenance
-- lifecycle transition already follows.
--
-- ONE new line per RPC, right after the row is marked completed:
--   update public.trucks
--      set last_service_date = greatest(last_service_date, current_date)
--    where id = <that job's truck_id>;
-- GREATEST(null, current_date) = current_date (GREATEST ignores nulls, per
-- Postgres docs) — a truck with no prior last_service_date seeds to today.
-- GREATEST also means this can only ever move the date FORWARD, never
-- backward — completing an old backdated job never regresses a truck's
-- already-later last_service_date.
--
-- Everything else in both functions is BYTE-IDENTICAL to their current live
-- versions (complete_work_order: 0064; complete_outsourced_job: 0069) — the
-- all-tasks gate, cost recompute, actor capture, and both signatures are
-- unchanged. No internal helper (deduct_work_order_parts, etc.) is
-- recreated here, so their existing REVOKEs stand untouched.
--
-- BACKFILL (added on redraft — this migration was reviewed but never
-- actually applied the first time, so every already-completed job's truck
-- still reads last_service_date = null): a one-time catch-up at the end,
-- GREATEST-ing each truck's existing value against the latest closed_at
-- among its own completed work orders and completed outsourced jobs.

begin;

-- ----------------------------------------------------------------------------
-- complete_work_order — signature unchanged (uuid, text). Body identical to
-- 0064's, plus the one new trucks update at the end, before return.
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

  -- NEW (0075) — auto-advance the truck's own last-service date. GREATEST
  -- ignores a null seed and never moves the date backward.
  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_wo.truck_id;

  return v_wo;
end;
$$;

grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_outsourced_job — signature unchanged (uuid, text). Body
-- identical to 0069's, plus the same one new trucks update at the end.
-- ----------------------------------------------------------------------------
drop function if exists public.complete_outsourced_job(uuid, text);
create or replace function public.complete_outsourced_job(
  p_job_id uuid,
  p_actor text default null
)
returns public.outsourced_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.outsourced_jobs;
begin
  select * into v_job from public.outsourced_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Outsourced job not found.';
  end if;
  if v_job.status = 'completed' then
    raise exception 'Outsourced job is already completed.';
  end if;

  if exists (
    select 1 from public.outsourced_job_tasks
     where outsourced_job_id = p_job_id and done = false
  ) then
    raise exception 'All tasks must be completed before this job can be marked complete.';
  end if;

  update public.outsourced_jobs
     set status = 'completed',
         closed_at = now(),
         completed_by = p_actor
   where id = p_job_id
  returning * into v_job;

  -- NEW (0075) — same auto-advance as complete_work_order, above.
  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_job.truck_id;

  return v_job;
end;
$$;

grant execute on function public.complete_outsourced_job(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Backfill — already-completed jobs never ran the auto-advance above (it
-- didn't exist yet), so every truck with completed maintenance still reads
-- last_service_date = null. One-time catch-up: for each truck, take the
-- GREATEST of its own current value, the latest closed_at date among its
-- completed work orders, and the latest closed_at date among its completed
-- outsourced jobs. GREATEST ignores nulls, so a truck's existing manual
-- seed (if any) is preserved and this can only ever move the date forward.
-- ----------------------------------------------------------------------------
update public.trucks t
   set last_service_date = greatest(
     t.last_service_date,
     (select max(wo.closed_at)::date from public.work_orders wo
       where wo.truck_id = t.id and wo.status = 'completed'),
     (select max(oj.closed_at)::date from public.outsourced_jobs oj
       where oj.truck_id = t.id and oj.status = 'completed')
   )
 where exists (select 1 from public.work_orders wo where wo.truck_id = t.id and wo.status = 'completed')
    or exists (select 1 from public.outsourced_jobs oj where oj.truck_id = t.id and oj.status = 'completed');

commit;
