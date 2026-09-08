-- 0188 — drop drivers.active.
--
-- `active` was a second, weaker liveness flag alongside `terminated_at`, which
-- §6 already names as the soft-delete key. Measured before drafting: exactly
-- two objects read it, both SECURITY DEFINER RPCs, in the identical
-- driver-restore block that hands a truck back its pre-maintenance driver.
-- Nothing else depends on it — the only pg_depend entry is its own
-- `default true` (pg_attrdef), and both non-internal triggers on `drivers`
-- have empty UPDATE-OF column lists, so neither is disturbed by the drop.
--
-- Behaviour is unchanged. Every live row has active = true, and the
-- terminated_at predicate that stays behind is the one that actually gates
-- restore. This removes the redundant predicate, not the rule.
--
-- Code-then-migrate (§5): the TypeScript that selected `active` ships in the
-- same unit as this file.
--
-- §6: `create or replace function` resets the ACL to EXECUTE-TO-PUBLIC, and
-- `anon` inherits PUBLIC. Both functions are SECURITY DEFINER, so each
-- redefinition below restates today's exact posture, measured immediately
-- before drafting and identical on both:
--
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- BOTH `authenticated` AND `service_role` are re-granted. Granting only
-- `authenticated` would silently drop service_role's execute — a behaviour
-- change dressed as a comment fix. The revoke names `public, anon` because the
-- offender is the PUBLIC entry and revoking anon alone changes nothing.
-- Identity args confirmed via p.oid::regprocedure::text.
--
-- Bare statements — no begin;/commit; (§5, 0173+).

-- ---------------------------------------------------------------------------
-- 1. complete_work_order(uuid,text) — drop `d.active = true`, keep
--    `d.terminated_at is null`. Otherwise byte-identical to live.
-- ---------------------------------------------------------------------------
create or replace function public.complete_work_order(p_wo_id uuid, p_actor text default null::text)
returns work_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Polish item 2 — parts-only total, labor term dropped.
  v_actual := round(v_parts_cost, 2);

  update public.work_orders
     set status = 'completed',
         closed_at = now(),
         actual_cost_sar = v_actual,
         completed_by = p_actor
   where id = p_wo_id
  returning * into v_wo;

  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_wo.truck_id;

  select * into v_truck from public.trucks where id = v_wo.truck_id for update;
  if not exists (select 1 from public.work_orders wo
                  where wo.truck_id = v_wo.truck_id and wo.status = 'in_progress')
     and not exists (select 1 from public.outsourced_jobs oj
                      where oj.truck_id = v_wo.truck_id and oj.status = 'in_progress')
  then
    if v_truck.driver_before_maintenance is not null
       and v_truck.assigned_driver_id is null
       and exists (select 1 from public.drivers d
                    where d.id = v_truck.driver_before_maintenance and d.terminated_at is null)
       and not exists (select 1 from public.trucks t
                        where t.assigned_driver_id = v_truck.driver_before_maintenance)
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
$function$;

grant execute on function public.complete_work_order(uuid, text) to authenticated, service_role;
revoke execute on function public.complete_work_order(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. complete_outsourced_job(uuid,text) — same single-predicate removal.
-- ---------------------------------------------------------------------------
create or replace function public.complete_outsourced_job(p_job_id uuid, p_actor text default null::text)
returns outsourced_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  update public.trucks
     set last_service_date = greatest(last_service_date, current_date)
   where id = v_job.truck_id;

  select * into v_truck from public.trucks where id = v_job.truck_id for update;
  if not exists (select 1 from public.work_orders wo
                  where wo.truck_id = v_job.truck_id and wo.status = 'in_progress')
     and not exists (select 1 from public.outsourced_jobs oj
                      where oj.truck_id = v_job.truck_id and oj.status = 'in_progress')
  then
    if v_truck.driver_before_maintenance is not null
       and v_truck.assigned_driver_id is null
       and exists (select 1 from public.drivers d
                    where d.id = v_truck.driver_before_maintenance and d.terminated_at is null)
       and not exists (select 1 from public.trucks t
                        where t.assigned_driver_id = v_truck.driver_before_maintenance)
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
$function$;

grant execute on function public.complete_outsourced_job(uuid, text) to authenticated, service_role;
revoke execute on function public.complete_outsourced_job(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. The column itself. Last, so no redefinition above can reference a
--    column that is already gone.
-- ---------------------------------------------------------------------------
alter table public.drivers drop column active;

-- ---------------------------------------------------------------------------
-- 4. Verification. Every row must read ok = true. §5: this grid is a claim,
--    not proof — it reads the catalog, which is the evidence.
--
--    The four grant checks all go through has_function_privilege, NEVER
--    through proacl or aclexplode. A create-or-replace resets proacl to NULL,
--    and NULL explodes to ZERO ROWS — so an aclexplode test for a PUBLIC
--    grantee reads "absent" in exactly the state where PUBLIC has execute.
--    That is §6's "never via proacl matching" in its other direction: the
--    false clean, not the false catastrophe.
-- ---------------------------------------------------------------------------
select 'column dropped' as check_name,
       not exists (
         select 1 from pg_attribute a
          where a.attrelid = 'public.drivers'::regclass
            and a.attname = 'active'
            and a.attnum > 0
            and not a.attisdropped
       ) as ok
union all
select 'no function references active',
       not exists (
         select 1
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral regexp_split_to_table(p.prosrc, E'\n') as l(line)
          where n.nspname = 'public'
            and p.proname in ('complete_work_order', 'complete_outsourced_job')
            and btrim(l.line) !~ '^--'
            and l.line ~ '\mactive\M'
       )
union all
select 'authenticated CAN execute both',
       has_function_privilege('authenticated', 'public.complete_work_order(uuid,text)', 'execute')
       and has_function_privilege('authenticated', 'public.complete_outsourced_job(uuid,text)', 'execute')
union all
select 'service_role CAN execute both',
       has_function_privilege('service_role', 'public.complete_work_order(uuid,text)', 'execute')
       and has_function_privilege('service_role', 'public.complete_outsourced_job(uuid,text)', 'execute')
union all
select 'anon CANNOT execute either',
       not has_function_privilege('anon', 'public.complete_work_order(uuid,text)', 'execute')
       and not has_function_privilege('anon', 'public.complete_outsourced_job(uuid,text)', 'execute')
union all
select 'PUBLIC CANNOT execute either',
       not has_function_privilege('public', 'public.complete_work_order(uuid,text)', 'execute')
       and not has_function_privilege('public', 'public.complete_outsourced_job(uuid,text)', 'execute');
