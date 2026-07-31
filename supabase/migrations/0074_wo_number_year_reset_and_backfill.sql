-- 0074_wo_number_year_reset_and_backfill.sql
-- Maintenance — Phase 2 numbering fix, BOTH tracks.
--
-- PART A — in-house WO numbering now mirrors what 0070 already did for OS:
-- WO-YY-#### (YY = last 2 digits of the year), sequence resets each year.
-- Replaces the singleton wo_number_counter/next_wo_number() (0060) with a
-- YEAR-KEYED counter — byte-identical shape/technique to os_number_counter
-- (0070), which itself mirrored po_number_counter (0050). next_wo_number
-- gains a p_year param. create_work_order's title/title_ar now become the
-- wo_number itself too (mirrors 0070's os_number-is-the-title change) —
-- the old "Maintenance — {plate}" auto-title is dropped. ONLY the
-- numbering/title lines in create_work_order change — labor-rate
-- snapshot, reserve-only parts, out-of-stock hard block, start_date
-- (0073), and the 10-arg signature are all carried over byte-identical.
-- edit_work_order is UNTOUCHED — it never wrote wo_number/title at all
-- (title is a create-time-only snapshot in this app), so there's nothing
-- for this migration to touch there.
--
-- PART B — backfill. Unlike 0070 (which explicitly left old-format OS
-- rows alone — no collision risk, the new format carries a "-YY-" segment
-- the old one never had) and 0073/0060 (additive, no-backfill precedent),
-- Turki's explicit instruction THIS time is to renumber existing test-data
-- rows on both tracks so they read the new format too. Renumbered in
-- created_at order, per calendar year of each row's own created_at (a row
-- from 2025 gets a 2025-year sequence, a 2026 row gets 2026's), title/
-- title_ar overwritten to the new number string on both tracks (in-house
-- included now, per Part A's own title change). Safe because nothing in
-- this app references wo_number/os_number by string anywhere — every FK
-- is the row's uuid id; these columns are unique, display-only.
--
-- After backfill, each year's counter is seeded to (that year's backfilled
-- row count + 1) so the next NEW job of that year continues right after
-- the last backfilled one, no collision.

begin;

-- ----------------------------------------------------------------------------
-- PART A.1 — wo_number_counter: drop the old singleton, replace with a
-- year-keyed table, identical shape to os_number_counter (0070).
-- ----------------------------------------------------------------------------
drop function if exists public.next_wo_number();
drop table if exists public.wo_number_counter;

create table public.wo_number_counter (
  year        int primary key,
  next_number int not null default 1
);

alter table public.wo_number_counter enable row level security;
drop policy if exists "authenticated_all_wo_number_counter" on public.wo_number_counter;
create policy "authenticated_all_wo_number_counter"
  on public.wo_number_counter for all to authenticated using (true) with check (true);

drop function if exists public.next_wo_number(integer);
create or replace function public.next_wo_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.wo_number_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.wo_number_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_wo_number(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- PART A.2 — create_work_order: same 10-arg signature 0073 left it at.
-- Only the numbering + title lines change; everything else (labor
-- snapshot, mechanic guards, reserve-only parts hard block, start_date)
-- is copied verbatim from 0073.
-- ----------------------------------------------------------------------------
drop function if exists public.create_work_order(
  uuid, text, text, timestamptz, date, uuid, jsonb, jsonb, numeric, text
);
create or replace function public.create_work_order(
  p_truck_id             uuid,
  p_type                 text,
  p_priority             text,
  p_due_by               timestamptz,
  p_start_date           date,
  p_mechanic_staff_id    uuid,
  p_task_description_ids jsonb,
  p_lines                jsonb,
  p_labor_hours          numeric default 4,
  p_actor                text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo             public.work_orders;
  v_truck          public.trucks;
  v_mechanic       public.staff;
  v_days_per_month int;
  v_hourly_cost    numeric(12, 2);
  v_year           integer;
  v_number         integer;
  v_number_text    text;
  v_task           jsonb;
  v_desc_id        uuid;
  v_desc           record;
  v_ordinal        int := 0;
  v_line           jsonb;
  v_part_id        uuid;
  v_qty            numeric(12, 2);
  v_part           public.parts;
  v_unit_price     numeric(12, 2);
  v_parts_cost     numeric(12, 2) := 0;
  v_estimated      numeric(12, 2);
begin
  select * into v_truck from public.trucks where id = p_truck_id and active = true;
  if v_truck.id is null then
    raise exception 'Truck not found or inactive.';
  end if;

  select * into v_mechanic from public.staff
   where id = p_mechanic_staff_id
     and role = 'mechanic'
     and active = true
     and terminated_at is null;
  if v_mechanic.id is null then
    raise exception 'Mechanic not found, inactive, or not eligible.';
  end if;

  if v_mechanic.monthly_salary_sar is null then
    raise exception 'Mechanic % has no monthly salary set — add it on the People page before scheduling a work order.', v_mechanic.name;
  end if;

  if v_mechanic.duty_hours is null or v_mechanic.duty_hours <= 0 then
    raise exception 'Mechanic % has no valid duty hours set.', v_mechanic.name;
  end if;

  if p_due_by is null then
    raise exception 'Due date is required.';
  end if;

  if p_start_date is null then
    raise exception 'Start date is required.';
  end if;

  if p_labor_hours is null or p_labor_hours <= 0 then
    raise exception 'Labor hours must be positive.';
  end if;

  select standard_working_days_per_month into v_days_per_month
    from public.company_settings where id = true;
  if v_days_per_month is null or v_days_per_month <= 0 then
    raise exception 'Standard working days per month is not configured.';
  end if;

  -- SNAPSHOT: computed now, from this mechanic's CURRENT salary, and never
  -- re-derived later — a later salary change must not rewrite this WO's
  -- historical cost.
  v_hourly_cost := round(v_mechanic.monthly_salary_sar / (v_mechanic.duty_hours * v_days_per_month), 2);

  v_year := extract(year from now())::integer;
  v_number := public.next_wo_number(v_year);
  -- "YY" = last 2 digits of the year, always 2 digits (mod 100, lpad 2) —
  -- same technique 0070's create_outsourced_job already uses.
  v_number_text := 'WO-' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_number::text, 4, '0');

  -- Title IS the number now, same both-languages-identical-string
  -- treatment 0070 gave the OS track — an id, not translatable content.
  -- Truck plate no longer appears in the title at all.
  insert into public.work_orders (
    wo_number, truck_id, type, priority, status, title, title_ar,
    due_by, start_date, assigned_mechanic_id, odometer_at_service,
    labor_hours, labor_rate_sar, created_by
  )
  values (
    v_number_text,
    p_truck_id, p_type, p_priority, 'open',
    v_number_text, v_number_text,
    p_due_by, p_start_date, p_mechanic_staff_id, v_truck.odometer_km,
    p_labor_hours, v_hourly_cost, p_actor
  )
  returning * into v_wo;

  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.repair_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Repair description % not found or inactive.', v_desc_id;
      end if;

      insert into public.work_order_tasks (work_order_id, description_en, description_ar, ordinal)
      values (v_wo.id, v_desc.en, v_desc.ar, v_ordinal);

      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_part_id := nullif(v_line->>'part_id', '')::uuid;
      v_qty     := nullif(v_line->>'qty', '')::numeric;

      if v_part_id is null then
        raise exception 'Line item is missing part_id.';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Line item quantity must be positive.';
      end if;

      select * into v_part from public.parts where id = v_part_id and active = true;
      if v_part.id is null then
        raise exception 'Part not found or inactive.';
      end if;

      if v_qty > v_part.qty_on_hand then
        raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
          v_part.name, v_part.qty_on_hand, v_qty;
      end if;

      v_unit_price := coalesce(v_part.unit_cost_sar, 0);

      insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
      values (v_wo.id, v_part_id, v_qty, v_unit_price);

      v_parts_cost := v_parts_cost + (v_qty * v_unit_price);
    end loop;
  end if;

  v_estimated := round(v_parts_cost + (v_wo.labor_hours * v_wo.labor_rate_sar), 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = v_wo.id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.create_work_order(
  uuid, text, text, timestamptz, date, uuid, jsonb, jsonb, numeric, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- PART B.1 — backfill existing work_orders to WO-YY-#### in created_at
-- order, per calendar year of each row's own created_at. title/title_ar
-- overwritten to the same number string (Part A's own title change now
-- applies retroactively too — the old "Maintenance — {plate}" title is
-- gone everywhere, not just for new rows).
-- ----------------------------------------------------------------------------
with numbered as (
  select
    id,
    extract(year from created_at)::integer as yr,
    row_number() over (
      partition by extract(year from created_at)
      order by created_at, id
    ) as rn
  from public.work_orders
)
update public.work_orders wo
   set wo_number = 'WO-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0'),
       title     = 'WO-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0'),
       title_ar  = 'WO-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0')
  from numbered
 where wo.id = numbered.id;

-- Seed each year's counter to (backfilled row count for that year) + 1,
-- so the next NEW work order that year continues right after, no
-- collision. Insert-or-update since a year might already have a counter
-- row from live testing today.
insert into public.wo_number_counter (year, next_number)
select extract(year from created_at)::integer as yr, count(*) + 1
  from public.work_orders
 group by yr
on conflict (year) do update
   set next_number = greatest(public.wo_number_counter.next_number, excluded.next_number);

-- ----------------------------------------------------------------------------
-- PART B.2 — backfill existing outsourced_jobs to OS-YY-#### the same
-- way. 0070 deliberately left pre-0070 rows alone at the time ("no
-- collision risk, nothing to reconcile") — Turki's explicit instruction
-- now supersedes that call for this batch: renumber them too, same
-- created_at-ordered, per-year technique.
-- ----------------------------------------------------------------------------
with numbered as (
  select
    id,
    extract(year from created_at)::integer as yr,
    row_number() over (
      partition by extract(year from created_at)
      order by created_at, id
    ) as rn
  from public.outsourced_jobs
)
update public.outsourced_jobs oj
   set os_number = 'OS-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0'),
       title     = 'OS-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0'),
       title_ar  = 'OS-' || lpad((numbered.yr % 100)::text, 2, '0') || '-' || lpad(numbered.rn::text, 4, '0')
  from numbered
 where oj.id = numbered.id;

insert into public.os_number_counter (year, next_number)
select extract(year from created_at)::integer as yr, count(*) + 1
  from public.outsourced_jobs
 group by yr
on conflict (year) do update
   set next_number = greatest(public.os_number_counter.next_number, excluded.next_number);

commit;
