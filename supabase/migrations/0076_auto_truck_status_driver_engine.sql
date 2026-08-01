-- 0076_auto_truck_status_driver_engine.sql
-- Auto Truck-Status — Phase 1 (DB engine only). Truck status DISPLAY
-- (MAINTENANCE / ACTIVE / IDLE, derived at read time from
-- assigned_driver_id + any in_progress WO/OS job) is Phase 2, not built
-- here. This migration only builds the driver free/reassign logic that
-- display will eventually read alongside.
--
-- MODEL: "entering maintenance" = a job goes in_progress (start_work_order /
-- dispatch_outsourced_job). "Released" = a job completes (complete_work_order
-- / complete_outsourced_job). FIRST-IN / LAST-OUT, spanning BOTH tracks:
--   - FIRST-IN: if the truck had NO OTHER in_progress WO or OS job at the
--     moment this job enters in_progress, and it currently has a driver,
--     free the driver (assigned_driver_id -> driver_before_maintenance,
--     assigned_driver_id -> null). If another job is already in_progress on
--     that truck, this is a second-or-later job entering maintenance — do
--     nothing to the driver (it's already freed, or was never assigned).
--   - LAST-OUT: after this job completes, if the truck has NO REMAINING
--     in_progress WO or OS job, attempt to give the driver back — only if
--     driver_before_maintenance is set, that driver is active/not-
--     terminated, that driver is not currently assigned to ANY truck, and
--     this truck currently has no driver. Either way (reassigned or not),
--     clear driver_before_maintenance — it's a one-shot memory per
--     maintenance episode, not a running history.
--
-- RACE SAFETY: each of the four functions already locks its own job row
-- (`for update`) at the top — but two DIFFERENT jobs on the SAME truck
-- aren't serialized by that alone. Each function additionally locks the
-- truck row (`select ... for update`) immediately before its first-in/
-- last-out block, so concurrent start/dispatch/complete calls for the same
-- truck can't race the exists-checks below.
--
-- EXCLUDING THE JOB'S OWN ROW FROM ITS OWN CHECK:
--   - FIRST-IN runs AFTER this job's own row is already flipped to
--     in_progress, so its own table's exists-check must exclude its own id
--     (otherwise it would always find itself) — the OTHER table needs no
--     exclusion (different id space, never collides).
--   - LAST-OUT runs AFTER this job's own row is already flipped to
--     completed, so its own table's exists-check (which only looks for
--     status = 'in_progress') already structurally excludes it — no
--     explicit id-exclusion needed there.
--
-- EVERYTHING ELSE in all four functions is BYTE-IDENTICAL to their current
-- live bodies (start_work_order: 0061; dispatch_outsourced_job: 0069; both
-- complete_* : 0075, which already carries the trucks.last_service_date
-- write — untouched, kept, this migration only ADDS the driver block after
-- it) — same FIFO deduction, reserve-only guards, all-tasks gate, cost
-- recompute, actor capture. No internal helper (deduct_work_order_parts,
-- etc.) is recreated here, so their existing REVOKEs stand untouched. No
-- signature changes anywhere.

begin;

alter table public.trucks
  add column if not exists driver_before_maintenance uuid references public.drivers(id) on delete set null;

-- ----------------------------------------------------------------------------
-- start_work_order — signature unchanged (uuid, text). Body identical to
-- 0061's, plus the truck lock + FIRST-IN driver-free block at the end.
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
  v_wo    public.work_orders;
  v_truck public.trucks;
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

  -- NEW (0076) — FIRST-IN driver-free, both tracks. Lock the truck row
  -- first so a concurrent start/dispatch/complete on the same truck can't
  -- race this check.
  select * into v_truck from public.trucks where id = v_wo.truck_id for update;

  if not exists (
    select 1 from public.work_orders wo2
     where wo2.truck_id = v_wo.truck_id and wo2.status = 'in_progress' and wo2.id <> v_wo.id
  ) and not exists (
    select 1 from public.outsourced_jobs oj2
     where oj2.truck_id = v_wo.truck_id and oj2.status = 'in_progress'
  ) then
    update public.trucks
       set driver_before_maintenance = assigned_driver_id,
           assigned_driver_id = null
     where id = v_wo.truck_id and assigned_driver_id is not null;
  end if;

  return v_wo;
end;
$$;

grant execute on function public.start_work_order(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- dispatch_outsourced_job — signature unchanged (uuid, text). Body
-- identical to 0069's, plus the same truck lock + FIRST-IN block.
-- ----------------------------------------------------------------------------
drop function if exists public.dispatch_outsourced_job(uuid, text);
create or replace function public.dispatch_outsourced_job(
  p_job_id uuid,
  p_actor text default null
)
returns public.outsourced_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job   public.outsourced_jobs;
  v_truck public.trucks;
begin
  select * into v_job from public.outsourced_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Outsourced job not found.';
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'Only a scheduled job can be dispatched (current status: %).', v_job.status;
  end if;

  update public.outsourced_jobs
     set status = 'in_progress',
         started_by = p_actor
   where id = p_job_id
  returning * into v_job;

  -- NEW (0076) — same FIRST-IN driver-free as start_work_order, above.
  select * into v_truck from public.trucks where id = v_job.truck_id for update;

  if not exists (
    select 1 from public.work_orders wo2
     where wo2.truck_id = v_job.truck_id and wo2.status = 'in_progress'
  ) and not exists (
    select 1 from public.outsourced_jobs oj2
     where oj2.truck_id = v_job.truck_id and oj2.status = 'in_progress' and oj2.id <> v_job.id
  ) then
    update public.trucks
       set driver_before_maintenance = assigned_driver_id,
           assigned_driver_id = null
     where id = v_job.truck_id and assigned_driver_id is not null;
  end if;

  return v_job;
end;
$$;

grant execute on function public.dispatch_outsourced_job(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_work_order — signature unchanged (uuid, text). Body identical to
-- 0075's (which already carries the last_service_date write), plus the
-- truck lock + LAST-OUT reassign-or-clear block at the end.
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
  v_truck      public.trucks;
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

  -- (0075) — auto-advance the truck's own last-service date. GREATEST
  -- ignores a null seed and never moves the date backward.
  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_wo.truck_id;

  -- NEW (0076) — LAST-OUT: lock the truck row, then attempt reassign (or
  -- just clear the memory) if no in_progress job remains on it, both
  -- tracks.
  select * into v_truck from public.trucks where id = v_wo.truck_id for update;

  if not exists (
    select 1 from public.work_orders wo2
     where wo2.truck_id = v_wo.truck_id and wo2.status = 'in_progress'
  ) and not exists (
    select 1 from public.outsourced_jobs oj2
     where oj2.truck_id = v_wo.truck_id and oj2.status = 'in_progress'
  ) then
    if v_truck.driver_before_maintenance is not null
       and v_truck.assigned_driver_id is null
       and exists (
         select 1 from public.drivers d
          where d.id = v_truck.driver_before_maintenance
            and d.active = true
            and d.terminated_at is null
            and not exists (
              select 1 from public.trucks t2
               where t2.assigned_driver_id = v_truck.driver_before_maintenance
            )
       )
    then
      update public.trucks
         set assigned_driver_id = driver_before_maintenance,
             driver_before_maintenance = null
       where id = v_wo.truck_id;
    else
      update public.trucks
         set driver_before_maintenance = null
       where id = v_wo.truck_id;
    end if;
  end if;

  return v_wo;
end;
$$;

grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_outsourced_job — signature unchanged (uuid, text). Body
-- identical to 0075's, plus the same truck lock + LAST-OUT block.
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
  v_job   public.outsourced_jobs;
  v_truck public.trucks;
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

  -- (0075) — same auto-advance as complete_work_order, above.
  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_job.truck_id;

  -- NEW (0076) — same LAST-OUT block as complete_work_order, above.
  select * into v_truck from public.trucks where id = v_job.truck_id for update;

  if not exists (
    select 1 from public.work_orders wo2
     where wo2.truck_id = v_job.truck_id and wo2.status = 'in_progress'
  ) and not exists (
    select 1 from public.outsourced_jobs oj2
     where oj2.truck_id = v_job.truck_id and oj2.status = 'in_progress'
  ) then
    if v_truck.driver_before_maintenance is not null
       and v_truck.assigned_driver_id is null
       and exists (
         select 1 from public.drivers d
          where d.id = v_truck.driver_before_maintenance
            and d.active = true
            and d.terminated_at is null
            and not exists (
              select 1 from public.trucks t2
               where t2.assigned_driver_id = v_truck.driver_before_maintenance
            )
       )
    then
      update public.trucks
         set assigned_driver_id = driver_before_maintenance,
             driver_before_maintenance = null
       where id = v_job.truck_id;
    else
      update public.trucks
         set driver_before_maintenance = null
       where id = v_job.truck_id;
    end if;
  end if;

  return v_job;
end;
$$;

grant execute on function public.complete_outsourced_job(uuid, text) to authenticated;

commit;
