-- Polish item 2 — separate labor from the cost total (in-house only, OS has
-- no labor). The work order estimated/actual cost becomes PARTS ONLY.
--
-- Three functions change, one line each — the labor term is dropped from
-- the cost-total calculation:
--   create_work_order:   v_estimated := round(v_parts_cost + (v_wo.labor_hours * v_wo.labor_rate_sar), 2);
--                     -> v_estimated := round(v_parts_cost, 2);
--   edit_work_order:     v_estimated := round(v_parts_cost + (p_labor_hours * v_hourly_cost), 2);
--                     -> v_estimated := round(v_parts_cost, 2);
--   complete_work_order: v_actual    := round(v_parts_cost + (v_wo.labor_hours * v_wo.labor_rate_sar), 2);
--                     -> v_actual    := round(v_parts_cost, 2);
--
-- Everything else in all three functions is BYTE-IDENTICAL to the live
-- versions (confirmed via pg_get_functiondef before drafting this file) —
-- labor_hours/labor_rate_sar are still computed and stored (the UI display
-- still needs them), the mechanic salary/duty-hours hard block stays (the
-- rate is still needed for the labor figure), and the FIFO deduction /
-- reserve-only / all-tasks-done gate / last_service / driver-reassign logic
-- are all untouched.
--
-- No signature change on any of the three functions (same params, same
-- return type) — CREATE OR REPLACE is sufficient, no DROP FUNCTION needed,
-- no risk of a stray overload. GRANT EXECUTE re-stated anyway, harmless.

-- ---------------------------------------------------------------------------
-- create_work_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_work_order(p_truck_id uuid, p_type text, p_priority text, p_due_by timestamp with time zone, p_start_date date, p_mechanic_staff_id uuid, p_task_description_ids jsonb, p_lines jsonb, p_labor_hours numeric DEFAULT 4, p_actor text DEFAULT NULL::text)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_hourly_cost := round(v_mechanic.monthly_salary_sar / (v_mechanic.duty_hours * v_days_per_month), 2);

  v_year := extract(year from now())::integer;
  v_number := public.next_wo_number(v_year);
  v_number_text := 'WO-' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_number::text, 4, '0');

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

  -- Polish item 2 — parts-only total, labor term dropped.
  v_estimated := round(v_parts_cost, 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = v_wo.id
  returning * into v_wo;

  return v_wo;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_work_order(uuid, text, text, timestamptz, date, uuid, jsonb, jsonb, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- edit_work_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_work_order(p_wo_id uuid, p_type text, p_priority text, p_due_by timestamp with time zone, p_start_date date, p_mechanic_staff_id uuid, p_task_description_ids jsonb, p_lines jsonb, p_labor_hours numeric, p_actor text DEFAULT NULL::text)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        if v_wo.status = 'open' then
          if v_qty > v_part.qty_on_hand then
            raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
              v_part.name, v_part.qty_on_hand, v_qty;
          end if;
          insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
          values (p_wo_id, v_part_id, v_qty, coalesce(v_part.unit_cost_sar, 0));
        else
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
    end loop;
  end if;

  select coalesce(sum(qty * unit_price_sar), 0) into v_parts_cost
    from public.work_order_parts where work_order_id = p_wo_id;

  -- Polish item 2 — parts-only total, labor term dropped.
  v_estimated := round(v_parts_cost, 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = p_wo_id
  returning * into v_wo;

  return v_wo;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.edit_work_order(uuid, text, text, timestamptz, date, uuid, jsonb, jsonb, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_work_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_work_order(p_wo_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                    where d.id = v_truck.driver_before_maintenance and d.active = true and d.terminated_at is null)
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

GRANT EXECUTE ON FUNCTION public.complete_work_order(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill — recompute existing rows to parts-only.
--   estimated_cost_sar: every work order's own parts sum (all statuses).
--   actual_cost_sar: parts sum for COMPLETED work orders only — non-
--   completed rows' actual_cost_sar is left exactly as-is (untouched).
-- ---------------------------------------------------------------------------
UPDATE public.work_orders wo
   SET estimated_cost_sar = COALESCE((
         SELECT SUM(wop.qty * wop.unit_price_sar)
           FROM public.work_order_parts wop
          WHERE wop.work_order_id = wo.id
       ), 0)::numeric(12, 2);

UPDATE public.work_orders wo
   SET actual_cost_sar = COALESCE((
         SELECT SUM(wop.qty * wop.unit_price_sar)
           FROM public.work_order_parts wop
          WHERE wop.work_order_id = wo.id
       ), 0)::numeric(12, 2)
 WHERE wo.status = 'completed';
