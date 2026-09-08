-- Confidence harness for the DRIVER-RESTORE guard after 0188 dropped
-- drivers.active. Run in the Supabase SQL Editor AFTER 0188 has applied.
--
-- THIS SCRIPT ALWAYS ENDS IN AN ERROR, AND THAT IS THE DESIGN. It builds
-- scratch drivers/trucks/work-orders, drives the two RPCs against them, then
-- raises unconditionally so the Editor's transaction rolls every one of those
-- rows back. Read the raised message:
--
--   "OK - 4/4 PASS"      -> green. The rollback is deliberate; nothing leaked.
--   "FAILED - n of 4"    -> red, with a per-case line naming what it got.
--
-- Raising is what makes this safe to run against the live database: there is
-- no cleanup path that can half-succeed, and no scratch row can outlive the
-- run even if a case errors midway. Do NOT "fix" the raise into a commit.
--
-- WHY THIS SCRIPT EXISTS
-- ----------------------
-- complete_work_order and complete_outsourced_job each hand a truck back the
-- driver it had before maintenance. That guard tested TWO columns, `active`
-- and `terminated_at`. 0188 removes the first. Every live driver row is
-- active = true (16 of 16, measured), so no CURRENT row can tell the two
-- predicates apart — which is exactly why a regression here would be silent:
-- the drop looks correct on today's data whether or not `terminated_at` still
-- gates anything.
--
-- Cases 2 and 4 are therefore NEGATIVE CONTROLS. They assert that a TERMINATED
-- driver is still refused restore. Delete the surviving predicate along with
-- the dropped one and this script goes red; without them a green run would
-- only prove the block ran, not that it still discriminates.
--
-- The scratch work orders set inventory_deducted_at so complete_work_order
-- skips deduct_work_order_parts — this is a test of the restore guard, and it
-- must not move stock to run.

do $$
declare
  v_mechanic uuid;
  v_report   text := E'\n';
  v_failures int  := 0;
  v_truck    uuid;
  v_driver   uuid;
  v_tag      text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_assigned uuid;
  v_before   uuid;
begin
  select id into v_mechanic from public.staff order by created_at limit 1;
  if v_mechanic is null then
    raise exception 'No staff row to use as the mechanic; cannot build a scratch work order.';
  end if;

  -- -------------------------------------------------------------------------
  -- Case 1 — WORK ORDER, live driver. Must RESTORE.
  -- -------------------------------------------------------------------------
  insert into public.drivers (name, terminated_at)
       values ('ZZ scratch live wo ' || v_tag, null) returning id into v_driver;
  insert into public.trucks (plate, assigned_driver_id, driver_before_maintenance)
       values ('ZZ-WO-1-' || v_tag, null, v_driver) returning id into v_truck;
  insert into public.work_orders
         (wo_number, truck_id, type, priority, title, title_ar, due_by,
          assigned_mechanic_id, status, inventory_deducted_at)
       values ('ZZ-WO-1-' || v_tag, v_truck, 'corrective', 'low', 'scratch', 'scratch',
               now(), v_mechanic, 'in_progress', now());

  perform public.complete_work_order(
            (select id from public.work_orders where wo_number = 'ZZ-WO-1-' || v_tag),
            'drivers-active-restore-check');

  select assigned_driver_id, driver_before_maintenance
    into v_assigned, v_before
    from public.trucks where id = v_truck;

  if v_assigned is not distinct from v_driver and v_before is null then
    v_report := v_report || '[PASS] work order, live driver -> restored' || E'\n';
  else
    v_failures := v_failures + 1;
    v_report := v_report || format(
      '[FAIL] work order, live driver -> expected assigned=%s before=null, got assigned=%s before=%s%s',
      v_driver, v_assigned, v_before, E'\n');
  end if;

  -- -------------------------------------------------------------------------
  -- Case 2 — WORK ORDER, TERMINATED driver. NEGATIVE CONTROL: must NOT
  -- restore, and must still clear driver_before_maintenance.
  -- -------------------------------------------------------------------------
  insert into public.drivers (name, terminated_at)
       values ('ZZ scratch term wo ' || v_tag, now()) returning id into v_driver;
  insert into public.trucks (plate, assigned_driver_id, driver_before_maintenance)
       values ('ZZ-WO-2-' || v_tag, null, v_driver) returning id into v_truck;
  insert into public.work_orders
         (wo_number, truck_id, type, priority, title, title_ar, due_by,
          assigned_mechanic_id, status, inventory_deducted_at)
       values ('ZZ-WO-2-' || v_tag, v_truck, 'corrective', 'low', 'scratch', 'scratch',
               now(), v_mechanic, 'in_progress', now());

  perform public.complete_work_order(
            (select id from public.work_orders where wo_number = 'ZZ-WO-2-' || v_tag),
            'drivers-active-restore-check');

  select assigned_driver_id, driver_before_maintenance
    into v_assigned, v_before
    from public.trucks where id = v_truck;

  if v_assigned is null and v_before is null then
    v_report := v_report || '[PASS] work order, terminated driver -> refused (negative control)' || E'\n';
  else
    v_failures := v_failures + 1;
    v_report := v_report || format(
      '[FAIL] work order, terminated driver -> expected assigned=null before=null, got assigned=%s before=%s%s',
      v_assigned, v_before, E'\n');
  end if;

  -- -------------------------------------------------------------------------
  -- Case 3 — OUTSOURCED JOB, live driver. Must RESTORE.
  -- -------------------------------------------------------------------------
  insert into public.drivers (name, terminated_at)
       values ('ZZ scratch live oj ' || v_tag, null) returning id into v_driver;
  insert into public.trucks (plate, assigned_driver_id, driver_before_maintenance)
       values ('ZZ-OJ-1-' || v_tag, null, v_driver) returning id into v_truck;
  insert into public.outsourced_jobs
         (os_number, truck_id, responsible_mechanic_id, type, title, title_ar,
          start_date, estimated_finish, status)
       values ('ZZ-OJ-1-' || v_tag, v_truck, v_mechanic, 'corrective', 'scratch', 'scratch',
               current_date, current_date, 'in_progress');

  perform public.complete_outsourced_job(
            (select id from public.outsourced_jobs where os_number = 'ZZ-OJ-1-' || v_tag),
            'drivers-active-restore-check');

  select assigned_driver_id, driver_before_maintenance
    into v_assigned, v_before
    from public.trucks where id = v_truck;

  if v_assigned is not distinct from v_driver and v_before is null then
    v_report := v_report || '[PASS] outsourced job, live driver -> restored' || E'\n';
  else
    v_failures := v_failures + 1;
    v_report := v_report || format(
      '[FAIL] outsourced job, live driver -> expected assigned=%s before=null, got assigned=%s before=%s%s',
      v_driver, v_assigned, v_before, E'\n');
  end if;

  -- -------------------------------------------------------------------------
  -- Case 4 — OUTSOURCED JOB, TERMINATED driver. NEGATIVE CONTROL.
  -- -------------------------------------------------------------------------
  insert into public.drivers (name, terminated_at)
       values ('ZZ scratch term oj ' || v_tag, now()) returning id into v_driver;
  insert into public.trucks (plate, assigned_driver_id, driver_before_maintenance)
       values ('ZZ-OJ-2-' || v_tag, null, v_driver) returning id into v_truck;
  insert into public.outsourced_jobs
         (os_number, truck_id, responsible_mechanic_id, type, title, title_ar,
          start_date, estimated_finish, status)
       values ('ZZ-OJ-2-' || v_tag, v_truck, v_mechanic, 'corrective', 'scratch', 'scratch',
               current_date, current_date, 'in_progress');

  perform public.complete_outsourced_job(
            (select id from public.outsourced_jobs where os_number = 'ZZ-OJ-2-' || v_tag),
            'drivers-active-restore-check');

  select assigned_driver_id, driver_before_maintenance
    into v_assigned, v_before
    from public.trucks where id = v_truck;

  if v_assigned is null and v_before is null then
    v_report := v_report || '[PASS] outsourced job, terminated driver -> refused (negative control)' || E'\n';
  else
    v_failures := v_failures + 1;
    v_report := v_report || format(
      '[FAIL] outsourced job, terminated driver -> expected assigned=null before=null, got assigned=%s before=%s%s',
      v_assigned, v_before, E'\n');
  end if;

  -- -------------------------------------------------------------------------
  -- Unconditional raise — the rollback IS the cleanup. See the header.
  -- -------------------------------------------------------------------------
  if v_failures > 0 then
    raise exception 'drivers-active-restore-check FAILED - % of 4 cases%', v_failures, v_report;
  end if;

  raise exception 'drivers-active-restore-check OK - 4/4 PASS (this error is deliberate; it rolls the scratch rows back)%', v_report;
end $$;
