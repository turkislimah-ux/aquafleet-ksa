-- 0063_maintenance_labor_costing.sql
-- Maintenance — labor costing, Turki's decision: mechanic hourly cost =
-- monthly salary / monthly working hours (simplest tier, MVP-appropriate —
-- known to under-cost vs. a fully burdened rate, deliberate). Labor on a WO
-- = WO hours (now a real per-WO input, not a hardcoded constant) x that
-- hourly cost, SNAPSHOTTED onto work_orders.labor_rate_sar at
-- create/edit time so a later salary change never rewrites a historical
-- WO's cost. complete_work_order's own recompute (0061) already reads
-- labor_hours * labor_rate_sar and needs no change now that the rate is
-- real.
--
-- MONTHLY HOURS BASIS — verified against live schema before writing this:
-- staff.duty_hours (0023) is per-day/shift hours (People-page field
-- labelled "Duty hours", default 10, used for driver/staff scheduling) —
-- NOT itself a monthly figure. Monthly hours = duty_hours * a single
-- company-wide working-days-per-month constant (NOT per-staff — one work
-- calendar, not one per employee), which belongs on company_settings
-- (already the home for this app's other single global business
-- constants), not staff. New column:
--   company_settings.standard_working_days_per_month int, default 26
--   (a placeholder — Turki's own call to confirm/adjust via the existing
--   Company Settings form; not treated as an authoritative HR decision
--   baked in here).
--
-- SALARY COLUMN: staff.monthly_salary_sar numeric, nullable. Compensation
-- data — surfaced ONLY on the People page (this migration's app-code
-- follow-up adds the field there), never in the Maintenance UI, per
-- Turki's explicit instruction. Uses the SAME RLS this table already has
-- (authenticated_all_staff, full read/write for any logged-in user) — this
-- is the first genuinely sensitive field on a table with that simple,
-- already-established model; not a new precedent being introduced here,
-- flagged for awareness only.
--
-- create_work_order SIGNATURE CHANGE: gains p_labor_hours (with a default
-- of 4, matching the old hardcoded value, so the estimate math doesn't
-- silently change shape for any caller that omits it) inserted before the
-- existing trailing p_actor default param (Postgres requires defaulted
-- params trail non-defaulted ones). The OLD 8-arg signature is dropped
-- explicitly, not left as a second overload — same "exactly one live
-- signature" discipline as every RPC here.
--
-- HARD GUARD: if the assigned mechanic has no monthly_salary_sar set yet,
-- create_work_order refuses with a clear, actionable message rather than
-- silently defaulting to a 0 (free) labor cost or falling back to the old
-- 145 constant. A WO cannot be scheduled with a phantom labor cost.
--
-- RPC DISCIPLINE: exact-signature drop-then-create, SECURITY DEFINER,
-- SET search_path = public, grant execute to authenticated — unchanged
-- from every prior RPC here.

begin;

alter table public.staff
  add column if not exists monthly_salary_sar numeric(12, 2);

alter table public.company_settings
  add column if not exists standard_working_days_per_month int not null default 26;

-- Drop the OLD 8-arg create_work_order (0060) — replaced below by the
-- 9-arg version. Exactly one signature must remain live.
drop function if exists public.create_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, text
);
create or replace function public.create_work_order(
  p_truck_id             uuid,
  p_type                 text,
  p_priority             text,
  p_due_by               timestamptz,
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
  v_number         integer;
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

  v_number := public.next_wo_number();

  insert into public.work_orders (
    wo_number, truck_id, type, priority, status, title, title_ar,
    due_by, assigned_mechanic_id, odometer_at_service,
    labor_hours, labor_rate_sar, created_by
  )
  values (
    'WO-' || lpad(v_number::text, 4, '0'),
    p_truck_id, p_type, p_priority, 'open',
    'Maintenance — ' || v_truck.plate,
    'صيانة — ' || v_truck.plate,
    p_due_by, p_mechanic_staff_id, v_truck.odometer_km,
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
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, numeric, text
) to authenticated;

commit;
