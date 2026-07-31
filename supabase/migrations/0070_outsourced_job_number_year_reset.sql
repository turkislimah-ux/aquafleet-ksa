-- 0070_outsourced_job_number_year_reset.sql
-- Maintenance — OS number format change: OS-YY-#### (YY = last 2 digits of
-- the year), sequence RESETS each year. Replaces the singleton
-- os_number_counter (0068) with a YEAR-KEYED counter — same technique
-- po_number_counter (0050) already uses, verified against its live
-- definition before writing this (year int PK, next_number int default 1,
-- atomic `insert ... on conflict (year) do nothing` seed followed by
-- `update ... returning next_number - 1`), not reinvented.
--
-- IN-HOUSE WO-NNNN IS UNCHANGED — wo_number_counter/next_wo_number (0060)
-- are untouched by this migration. This is OS-only.
--
-- TITLE CHANGE: the job's title/title_ar now become the os_number itself
-- (e.g. "OS-26-0001") — dropping the old "Outsource — {plate}" auto-title.
-- Both language columns get the SAME string: an id/number is not
-- translatable content, unlike the in-house WO's plate-derived title,
-- which stays as-is.
--
-- NO BACKFILL: existing outsourced_jobs rows created during Phase 4 testing
-- keep their old-format os_number/title (e.g. "OS-0001" / "Outsource — X").
-- No collision risk with the new format (it carries a "-YY-" segment the
-- old one never had), so there's nothing to reconcile — same "additive,
-- no backfill for historical rows" precedent this project already follows
-- elsewhere (VAT columns, price_lot_id backfill, etc).
--
-- edit_outsourced_job (0069) is UNTOUCHED — it already never wrote
-- title/title_ar (truck and title are both immutable after creation,
-- Turki's earlier call), so this migration doesn't need to touch it.

begin;

-- Drop the old singleton counter + its function entirely.
drop function if exists public.next_os_number();
drop table if exists public.os_number_counter;

-- ----------------------------------------------------------------------------
-- os_number_counter — YEAR-KEYED, identical shape/technique to
-- po_number_counter (0050).
-- ----------------------------------------------------------------------------
create table public.os_number_counter (
  year        int primary key,
  next_number int not null default 1
);

alter table public.os_number_counter enable row level security;
drop policy if exists "authenticated_all_os_number_counter" on public.os_number_counter;
create policy "authenticated_all_os_number_counter"
  on public.os_number_counter for all to authenticated using (true) with check (true);

drop function if exists public.next_os_number(integer);
create or replace function public.next_os_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.os_number_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.os_number_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_os_number(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- create_outsourced_job — same 8-arg signature as 0068, body updated for
-- the new numbering + title.
-- ----------------------------------------------------------------------------
drop function if exists public.create_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
);
create or replace function public.create_outsourced_job(
  p_truck_id                uuid,
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
  v_truck       public.trucks;
  v_mechanic    public.staff;
  v_year        integer;
  v_number      integer;
  v_number_text text;
  v_repairer    jsonb;
  v_repairer_id uuid;
  v_task        jsonb;
  v_desc_id     uuid;
  v_desc        record;
  v_ordinal     int := 0;
begin
  select * into v_truck from public.trucks where id = p_truck_id and active = true;
  if v_truck.id is null then
    raise exception 'Truck not found or inactive.';
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

  v_year := extract(year from now())::integer;
  v_number := public.next_os_number(v_year);
  -- "YY" = last 2 digits of the year, always 2 digits (mod 100, lpad 2).
  v_number_text := 'OS-' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_number::text, 4, '0');

  -- Title IS the number now — an id, not translatable content, so both
  -- language columns get the same string. Truck plate no longer appears
  -- in the title at all.
  insert into public.outsourced_jobs (
    os_number, truck_id, responsible_mechanic_id, type,
    title, title_ar, start_date, estimated_finish, status, created_by
  )
  values (
    v_number_text,
    p_truck_id, p_responsible_mechanic_id, p_type,
    v_number_text, v_number_text,
    p_start_date, p_estimated_finish, 'scheduled', p_actor
  )
  returning * into v_job;

  for v_repairer in select * from jsonb_array_elements(p_repairer_ids)
  loop
    v_repairer_id := nullif(trim(both '"' from v_repairer::text), '')::uuid;
    perform 1 from public.repairers where id = v_repairer_id and active = true;
    if not found then
      raise exception 'Repairer % not found or inactive.', v_repairer_id;
    end if;

    insert into public.outsourced_job_repairers (outsourced_job_id, repairer_id)
    values (v_job.id, v_repairer_id)
    on conflict (outsourced_job_id, repairer_id) do nothing;
  end loop;

  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.outsourced_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Outsourced description % not found or inactive.', v_desc_id;
      end if;

      insert into public.outsourced_job_tasks (outsourced_job_id, description_en, description_ar, ordinal)
      values (v_job.id, v_desc.en, v_desc.ar, v_ordinal);

      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  return v_job;
end;
$$;

grant execute on function public.create_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
) to authenticated;

commit;
