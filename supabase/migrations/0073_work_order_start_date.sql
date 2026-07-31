-- 0073_work_order_start_date.sql
-- Maintenance — work_orders gains start_date, so the calendar can place
-- BOTH tracks (in-house + outsourced) by the same kind of field.
-- due_by is UNCHANGED and still drives in-house overdue — start_date is
-- purely additive, for calendar placement parity with outsourced_jobs'
-- own start_date (0068). Nullable: existing work_orders rows have no
-- value and are not backfilled (same "additive, no backfill for
-- historical rows" precedent this project already follows everywhere
-- else) — create_work_order/edit_work_order both require it as an input
-- going forward, so every NEW row always gets one even though the column
-- itself stays nullable for backward compatibility with what's already
-- there.
--
-- IN-HOUSE TASK-GATE PARITY IS NOT PART OF THIS MIGRATION — Turki's own
-- note: that piece (should toggle_work_order_task also block while
-- status='open', mirroring the new OS scheduled-block from 0072) is
-- pending his decision. toggle_work_order_task (0061) is untouched here.
--
-- Both create_work_order and edit_work_order gain a required p_start_date
-- param, inserted right after p_due_by (before the mechanic/tasks/lines
-- params) — neither function has a default for it, matching due_by's own
-- required-not-defaulted treatment. Every other guard/behavior in both
-- functions (labor-rate snapshot, out-of-stock hard block, FIFO reversal
-- machinery, legacy-consumption guard) is carried over UNCHANGED from
-- 0066's own edit_work_order and 0063's own create_work_order — this
-- migration only adds the one new column/param, nothing else moves.

begin;

alter table public.work_orders
  add column if not exists start_date date;

-- ----------------------------------------------------------------------------
-- create_work_order — was 9-arg (0063), now 10-arg (adds p_start_date).
-- ----------------------------------------------------------------------------
drop function if exists public.create_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, numeric, text
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

  v_number := public.next_wo_number();

  insert into public.work_orders (
    wo_number, truck_id, type, priority, status, title, title_ar,
    due_by, start_date, assigned_mechanic_id, odometer_at_service,
    labor_hours, labor_rate_sar, created_by
  )
  values (
    'WO-' || lpad(v_number::text, 4, '0'),
    p_truck_id, p_type, p_priority, 'open',
    'Maintenance — ' || v_truck.plate,
    'صيانة — ' || v_truck.plate,
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
-- edit_work_order — was 9-arg (0066), now 10-arg (adds p_start_date).
-- Every reversal/legacy-guard/FIFO behavior carried over unchanged from
-- 0066 — only the new column/param is added.
-- ----------------------------------------------------------------------------
drop function if exists public.edit_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, numeric, text
);
create or replace function public.edit_work_order(
  p_wo_id                uuid,
  p_type                 text,
  p_priority             text,
  p_due_by               timestamptz,
  p_start_date           date,
  p_mechanic_staff_id    uuid,
  p_task_description_ids jsonb,
  p_lines                jsonb,
  p_labor_hours          numeric,
  p_actor                text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo             public.work_orders;
  v_mechanic       public.staff;
  v_days_per_month int;
  v_hourly_cost    numeric(12, 2);
  v_task           jsonb;
  v_desc_id        uuid;
  v_desc           record;
  v_ordinal        int := 0;
  v_selected_en    text[] := '{}';
  v_line           jsonb;
  v_part_id        uuid;
  v_qty            numeric(12, 2);
  v_part           public.parts;
  v_existing       record;
  v_line_id        uuid;
  v_old_qty        numeric(12, 2);
  v_net_consumed   numeric(12, 2);
  v_parts_cost     numeric(12, 2) := 0;
  v_estimated      numeric(12, 2);
begin
  -- Fix B (0065): lock the WO row first, before any other read or guard.
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status in ('completed', 'cancelled') then
    raise exception 'Cannot edit a % work order.', v_wo.status;
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
    raise exception 'Mechanic % has no monthly salary set — add it on the People page before editing this work order.', v_mechanic.name;
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

  -- Re-snapshot from the mechanic's CURRENT salary — an edit is a
  -- legitimate re-snapshot point, same rule as create_work_order.
  v_hourly_cost := round(v_mechanic.monthly_salary_sar / (v_mechanic.duty_hours * v_days_per_month), 2);

  update public.work_orders
     set type = p_type,
         priority = p_priority,
         due_by = p_due_by,
         start_date = p_start_date,
         assigned_mechanic_id = p_mechanic_staff_id,
         labor_hours = p_labor_hours,
         labor_rate_sar = v_hourly_cost
   where id = p_wo_id;

  -- ---- Tasks: reconcile by current text, preserve done-state for matches ----
  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.repair_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Repair description % not found or inactive.', v_desc_id;
      end if;
      v_selected_en := array_append(v_selected_en, v_desc.en);

      if not exists (
        select 1 from public.work_order_tasks
         where work_order_id = p_wo_id and description_en = v_desc.en
      ) then
        insert into public.work_order_tasks (work_order_id, description_en, description_ar, ordinal)
        values (p_wo_id, v_desc.en, v_desc.ar, v_ordinal);
      end if;
      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  delete from public.work_order_tasks
   where work_order_id = p_wo_id
     and not (description_en = any (v_selected_en));

  -- ---- Parts lines: removals first ----
  for v_existing in
    select wop.id, wop.part_id, wop.qty
      from public.work_order_parts wop
     where wop.work_order_id = p_wo_id
  loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
       where nullif(l->>'part_id', '')::uuid = v_existing.part_id
    ) then
      select coalesce(sum(case when direction = 'consume' then qty else -qty end), 0) into v_net_consumed
        from public.work_order_part_consumptions
       where work_order_part_id = v_existing.id;

      if v_wo.status <> 'open' and v_wo.inventory_deducted_at is not null and v_net_consumed = 0 then
        raise exception 'Part % on this work order was consumed before per-lot tracking existed (a legacy work order) — it cannot be safely removed or reduced here. Leave this line as-is.',
          v_existing.part_id;
      end if;

      if v_net_consumed > 0 then
        perform public.return_to_lots(v_existing.id, v_net_consumed, p_actor);
      end if;

      delete from public.work_order_parts where id = v_existing.id;
    end if;
  end loop;

  -- ---- Parts lines: adds + qty changes ----
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

      select id, qty into v_line_id, v_old_qty
        from public.work_order_parts
       where work_order_id = p_wo_id and part_id = v_part_id;

      if v_line_id is null then
        -- New line.
        if v_wo.status = 'open' then
          if v_qty > v_part.qty_on_hand then
            raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
              v_part.name, v_part.qty_on_hand, v_qty;
          end if;
          insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
          values (p_wo_id, v_part_id, v_qty, coalesce(v_part.unit_cost_sar, 0));
        else
          -- Already in progress — no future "start" event to defer to,
          -- consume now.
          insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
          values (p_wo_id, v_part_id, v_qty, coalesce(v_part.unit_cost_sar, 0))
          returning id into v_line_id;
          perform public.consume_work_order_line(v_line_id, v_qty, p_actor);
        end if;
      elsif v_qty <> v_old_qty then
        if v_wo.status = 'open' then
          if v_qty > v_part.qty_on_hand then
            raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
              v_part.name, v_part.qty_on_hand, v_qty;
          end if;
          update public.work_order_parts set qty = v_qty where id = v_line_id;
        else
          if v_qty < v_old_qty then
            select coalesce(sum(case when direction = 'consume' then qty else -qty end), 0) into v_net_consumed
              from public.work_order_part_consumptions
             where work_order_part_id = v_line_id;

            if v_wo.inventory_deducted_at is not null and v_net_consumed = 0 then
              raise exception 'Part % on this work order was consumed before per-lot tracking existed (a legacy work order) — its quantity cannot be safely reduced here. Leave this line as-is.',
                v_part.name;
            end if;
          end if;

          update public.work_order_parts set qty = v_qty where id = v_line_id;
          if v_qty > v_old_qty then
            perform public.consume_work_order_line(v_line_id, v_qty - v_old_qty, p_actor);
          else
            perform public.return_to_lots(v_line_id, v_old_qty - v_qty, p_actor);
          end if;
        end if;
      end if;
      -- else: unchanged line, left entirely alone.
    end loop;
  end if;

  select coalesce(sum(qty * unit_price_sar), 0) into v_parts_cost
    from public.work_order_parts where work_order_id = p_wo_id;

  v_estimated := round(v_parts_cost + (p_labor_hours * v_hourly_cost), 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.edit_work_order(
  uuid, text, text, timestamptz, date, uuid, jsonb, jsonb, numeric, text
) to authenticated;

commit;
