-- 0015_one_project_per_customer.sql
-- Business rule LOCKED: one customer = one project. Enforced at the DB so a
-- customer_id can never appear on two project rows.
-- WHY here (not app-only): projects.customer_id is already a NOT NULL FK; this
-- adds a UNIQUE constraint so the 1:1 is guaranteed regardless of which code
-- path inserts. Projects is currently empty, so the guard passes trivially —
-- but the guard is real: if duplicates ever exist, we abort and name them
-- rather than silently dropping/merging rows.
-- Whole thing is begin/commit-wrapped: if the guard fires, NOTHING is applied.

begin;

-- Guard: refuse to add the constraint while any customer_id is on >1 project.
do $$
declare v_dupes text;
begin
  select string_agg(customer_id::text, ', ')
    into v_dupes
  from (
    select customer_id
    from public.projects
    group by customer_id
    having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception
      'Aborting: customer_id(s) appear on more than one project: [%]. One customer = one project. Resolve the duplicates manually first; no changes applied.', v_dupes;
  end if;
end $$;

-- Re-runnable: drop then add.
alter table public.projects drop constraint if exists projects_customer_id_unique;
alter table public.projects
  add constraint projects_customer_id_unique unique (customer_id);

commit;
