-- 0069_outsourced_jobs_lifecycle.sql
-- Maintenance — Phase 4a continued: outsourced-job lifecycle RPCs. Builds
-- on 0068 (schema + create_outsourced_job). Zero stock/FIFO involvement,
-- same as 0068 — these RPCs exist for status-transition guards and
-- reliable actor capture, not for any invariant protection.
--
-- dispatch_outsourced_job(): scheduled -> in_progress, sets started_by.
-- UI button label is "Dispatch" (Turki's explicit wording) — the STORED
-- status value stays 'in_progress', same "value stays, label changes"
-- convention as corrective -> "Repair" elsewhere in this app. No stock, no
-- truck-status touch (matches the standing cross-module deferral).
--
-- complete_outsourced_job(): any non-completed status -> completed (same
-- permissiveness as complete_work_order — allowed directly from
-- 'scheduled' too, not forced through 'in_progress' first, since there's
-- no deduction event to gate on here). Hard guard: every
-- outsourced_job_task must already be done — no force-checking, same rule
-- as complete_work_order (0064's task-completion gate).
--
-- toggle_outsourced_job_task(): same shape as toggle_work_order_task,
-- blocked once the parent job is completed.
--
-- edit_outsourced_job(): editable while status <> 'completed' (no
-- 'cancelled' state exists for OS jobs). ALL inputs EXCEPT truck_id —
-- Turki's explicit call: a job's truck is fixed once created, same
-- immutability edit_work_order (0065) already gives its own truck_id (not
-- in that RPC's editable set either — this migration now matches that
-- precedent instead of diverging from it, as an earlier draft did). No
-- truck lookup/validation here at all, and title/title_ar are left
-- untouched by this UPDATE — they were correctly derived from the job's
-- truck at creation time and that truck can never change, so there is
-- nothing to re-derive. No reversal machinery of any kind — there is no
-- stock to move, so qty/line changes simply don't exist as a concept here.
-- Repairer set resyncs by delete-and-reinsert (no history to preserve,
-- unlike stock lines); tasks resync by the same text-match/preserve-done-
-- state reconciliation edit_work_order already uses, so editing an
-- in-progress job never silently un-checks completed work.
--
-- RPC DISCIPLINE: exact-signature drop-then-create, SECURITY DEFINER,
-- SET search_path = public, grant execute to authenticated — unchanged.

begin;

-- ----------------------------------------------------------------------------
-- dispatch_outsourced_job
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
  v_job public.outsourced_jobs;
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

  return v_job;
end;
$$;

grant execute on function public.dispatch_outsourced_job(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_outsourced_job
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

  return v_job;
end;
$$;

grant execute on function public.complete_outsourced_job(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- toggle_outsourced_job_task
-- ----------------------------------------------------------------------------
drop function if exists public.toggle_outsourced_job_task(uuid, boolean, text);
create or replace function public.toggle_outsourced_job_task(
  p_task_id uuid,
  p_done boolean,
  p_actor text default null
)
returns public.outsourced_job_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task       public.outsourced_job_tasks;
  v_job_status text;
begin
  select * into v_task from public.outsourced_job_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;

  select status into v_job_status from public.outsourced_jobs where id = v_task.outsourced_job_id;
  if v_job_status = 'completed' then
    raise exception 'Cannot modify tasks on a completed job.';
  end if;

  update public.outsourced_job_tasks set done = p_done where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.toggle_outsourced_job_task(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- edit_outsourced_job — editable while status <> 'completed'. ALL inputs
-- EXCEPT truck_id — a job's truck is fixed once created (Turki's call).
-- ----------------------------------------------------------------------------
drop function if exists public.edit_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
);
create or replace function public.edit_outsourced_job(
  p_job_id                  uuid,
  p_responsible_mechanic_id uuid,
  p_type                    text,
  p_start_date              date,
  p_estimated_finish        date,
  p_repairer_ids            jsonb,
  p_task_description_ids    jsonb,
  p_actor                   text default null
)
returns public.outsourced_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job         public.outsourced_jobs;
  v_mechanic    public.staff;
  v_repairer    jsonb;
  v_repairer_id uuid;
  v_task        jsonb;
  v_desc_id     uuid;
  v_desc        record;
  v_ordinal     int := 0;
  v_selected_en text[] := '{}';
begin
  select * into v_job from public.outsourced_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Outsourced job not found.';
  end if;
  if v_job.status = 'completed' then
    raise exception 'Cannot edit a completed job.';
  end if;

  select * into v_mechanic from public.staff
   where id = p_responsible_mechanic_id
     and role = 'mechanic'
     and active = true
     and terminated_at is null;
  if v_mechanic.id is null then
    raise exception 'Responsible mechanic not found, inactive, or not eligible.';
  end if;

  if p_start_date is null then
    raise exception 'Start date is required.';
  end if;
  if p_estimated_finish is null then
    raise exception 'Estimated finish date is required.';
  end if;

  if p_repairer_ids is null or jsonb_typeof(p_repairer_ids) <> 'array' or jsonb_array_length(p_repairer_ids) = 0 then
    raise exception 'At least one repairer is required.';
  end if;

  -- truck_id is NOT updated — a job's truck is fixed once created.
  -- title/title_ar are left untouched too: they were correctly derived
  -- from that same truck at creation time and it can never change, so
  -- there is nothing to re-derive here.
  update public.outsourced_jobs
     set responsible_mechanic_id = p_responsible_mechanic_id,
         type = p_type,
         start_date = p_start_date,
         estimated_finish = p_estimated_finish
   where id = p_job_id;

  -- Repairers: no history to preserve (unlike stock), plain resync.
  delete from public.outsourced_job_repairers where outsourced_job_id = p_job_id;

  for v_repairer in select * from jsonb_array_elements(p_repairer_ids)
  loop
    v_repairer_id := nullif(trim(both '"' from v_repairer::text), '')::uuid;
    perform 1 from public.repairers where id = v_repairer_id and active = true;
    if not found then
      raise exception 'Repairer % not found or inactive.', v_repairer_id;
    end if;

    insert into public.outsourced_job_repairers (outsourced_job_id, repairer_id)
    values (p_job_id, v_repairer_id)
    on conflict (outsourced_job_id, repairer_id) do nothing;
  end loop;

  -- Tasks: same text-match/preserve-done-state reconciliation as
  -- edit_work_order (0065) — never silently un-check completed work.
  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.outsourced_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Outsourced description % not found or inactive.', v_desc_id;
      end if;
      v_selected_en := array_append(v_selected_en, v_desc.en);

      if not exists (
        select 1 from public.outsourced_job_tasks
         where outsourced_job_id = p_job_id and description_en = v_desc.en
      ) then
        insert into public.outsourced_job_tasks (outsourced_job_id, description_en, description_ar, ordinal)
        values (p_job_id, v_desc.en, v_desc.ar, v_ordinal);
      end if;
      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  delete from public.outsourced_job_tasks
   where outsourced_job_id = p_job_id
     and not (description_en = any (v_selected_en));

  select * into v_job from public.outsourced_jobs where id = p_job_id;
  return v_job;
end;
$$;

grant execute on function public.edit_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
) to authenticated;

commit;
