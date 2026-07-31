-- 0072_outsourced_notes_and_task_gate.sql
-- Maintenance — two small OS-lifecycle additions:
--
-- 1. outsourced_jobs.notes (nullable text) + a DEDICATED
--    save_outsourced_job_notes RPC — Turki left this "your call" (fold
--    into edit_outsourced_job vs. a small notes RPC). Going with a
--    dedicated RPC to match the existing in-house precedent:
--    save_work_order_notes (0061) is ALREADY its own standalone RPC,
--    separate from edit_work_order, precisely because a single-field quick
--    save shouldn't carry a full edit form's validation weight (mechanic
--    eligibility, repairer set, task reconciliation, etc). Same reasoning
--    applies here. Blocked once status='completed' (no 'cancelled' state
--    exists for OS jobs, so that's the only terminal state to guard).
--
-- 2. toggle_outsourced_job_task() gains a NEW guard: raises if the parent
--    job's status is 'scheduled' — tasks are only checkable once
--    dispatched (in_progress). Combined with the EXISTING completed-block
--    (0069), the net effect is tasks are checkable ONLY while
--    status='in_progress'. "Mark Complete" being hidden while scheduled is
--    a UI-only fact (app-code, no RPC currently gates completion by
--    dispatch status) — this migration is the actual server-side floor for
--    the task-checking half of that rule.
--
-- IN-HOUSE PARITY EXPLICITLY NOT TOUCHED: toggle_work_order_task (0061)
-- is untouched by this migration — Turki's own note says that piece is
-- pending his decision, hold it. Do not add a matching guard there yet.

begin;

alter table public.outsourced_jobs
  add column if not exists notes text;

-- ----------------------------------------------------------------------------
-- save_outsourced_job_notes
-- ----------------------------------------------------------------------------
drop function if exists public.save_outsourced_job_notes(uuid, text, text);
create or replace function public.save_outsourced_job_notes(
  p_job_id uuid,
  p_notes text,
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
    raise exception 'Cannot edit notes on a completed job.';
  end if;

  update public.outsourced_jobs set notes = nullif(trim(p_notes), '') where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.save_outsourced_job_notes(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- toggle_outsourced_job_task — same signature as 0069, body gains the
-- scheduled-block.
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
  if v_job_status = 'scheduled' then
    raise exception 'Tasks cannot be checked before the job is dispatched.';
  end if;
  if v_job_status = 'completed' then
    raise exception 'Cannot modify tasks on a completed job.';
  end if;

  update public.outsourced_job_tasks set done = p_done where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

grant execute on function public.toggle_outsourced_job_task(uuid, boolean, text) to authenticated;

commit;
