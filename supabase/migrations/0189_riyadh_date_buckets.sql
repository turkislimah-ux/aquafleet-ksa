-- ===========================================================================
-- 0189 — RIYADH DATE BUCKETS: bare current_date is UTC on this database.
-- ===========================================================================
-- Measured on the live DB 2026-09-09 19:24 UTC, this session:
--
--   current_setting('TimeZone')                    = 'UTC'
--   now()                                          = 2026-09-09 19:24:19+00
--   current_date                                   = 2026-09-09
--   (now() at time zone 'Asia/Riyadh')::date        = 2026-09-09
--
-- They agree right now because it is 22:24 in Riyadh. They do NOT agree for
-- the first three hours of every Riyadh day. Frozen-clock probe, run on this
-- database, same session:
--
--   instant                    utc_date     riyadh_date   utc_year  riyadh_year
--   2026-09-30 20:59:00+00     2026-09-30   2026-09-30    2026      2026
--   2026-09-30 21:30:00+00     2026-09-30   2026-10-01    2026      2026   <-- month edge
--   2026-12-31 22:00:00+00     2026-12-31   2027-01-01    2026      2027   <-- year edge
--
-- Asia/Riyadh is a fixed +03:00 with no DST (pg_timezone_names: utc_offset
-- 03:00:00, is_dst false), so the Riyadh date is NEVER behind the UTC date --
-- it is ahead of it for three hours a day, and equal the rest of the time.
--
-- WHAT THIS COSTS, CONCRETELY. A purchase order raised at 01:00 Riyadh on
-- 1 January 2027 currently draws from the 2026 counter and prints
-- PO-2026-NNNN -- a numbering key AND a printed document, both wrong, both
-- gap-free-by-design so neither can be quietly renumbered afterwards. A trip
-- created in the same window gets a ref carrying last year. A stock receipt,
-- a price lot, a balance return and a truck's last_service_date all land on
-- yesterday. The month spine v_report_months stops one month short, so the
-- current month vanishes from every report built on it -- sixteen dependent
-- views, including v_driver_payslip_basis.
--
-- THE RULE APPLIED HERE: every site that buckets a DAY, a MONTH or a YEAR
-- takes (now() at time zone 'Asia/Riyadh')::date. Every site that records an
-- INSTANT keeps now() / timestamptz untouched -- an instant has no timezone
-- question to answer. Each object below is redefined from its LIVE body,
-- pulled from pg_get_functiondef / pg_get_viewdef this session, with ONLY the
-- date source changed. Nothing else in any body is edited.
--
-- WHAT IS DELIBERATELY LEFT ALONE, so a later reader does not "finish the job":
--
--   * greatest(current_date, (now() at time zone 'Asia/Riyadh')::date) --
--     six sites across 0104 / 0108 / 0109 / 0112 / 0130 / 0167. Since the
--     Riyadh date is never behind the UTC one, GREATEST already returns
--     Riyadh; the current_date arm is inert. Verified on the probe above:
--     greatest_of_both = 2026-10-01 and 2027-01-01 on the two edge instants.
--     Changing it would edit an expression that is already correct.
--   * 0046:302 -- a one-shot opening-balance backfill INSERT that ran years
--     of rows ago. Its current_date is spent; rewriting history is not the job.
--   * Superseded migration files (0050 / 0051 / 0053 / 0055 / 0056 / 0059 /
--     0075 / 0076 / 0079 / 0093 / 0188) still contain the old expressions.
--     Those are applied history. THE CATALOG IS THE RECORD -- every object
--     below was read out of pg_proc / pg_attrdef / pg_class, not off a file.
--
-- §6: create or replace function resets the ACL to EXECUTE TO PUBLIC, which
-- anon inherits, and the anon key ships in the client bundle. Every function
-- redefined here re-revokes from BOTH public and anon and restates the grants
-- it holds today. Measured pre-state, all eight:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   has_function_privilege('anon', ..., 'execute') = false
-- The verification block at the foot reads that back rather than assuming it.
--
-- §6: create or replace view silently drops reloptions, so each of the three
-- views restates its security footer. Measured pre-state, all three:
--   reloptions {security_invoker=true}, anon select false, authenticated true.
--
-- BARE STATEMENTS -- no begin;/commit; (0173+). The SQL Editor wraps the
-- submission in its own transaction, which is also what satisfies §6's
-- "re-revoke in the same transaction".
-- ===========================================================================


-- ===========================================================================
-- 1. NUMBERING KEYS -- the year bucket. Highest priority: these mint a
--    gap-free identifier AND print it on a document.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1a. create_purchase_order -- two sites: the year handed to next_po_number
--     (which picks the counter row) and the year printed into po_number.
--     They must move together or the printed reference stops matching the
--     counter it came from.
-- ---------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_supplier_id       uuid,
  p_warehouse_id      uuid,
  p_lines             jsonb,
  p_expected_delivery date    default null::date,
  p_note              text    default null::text,
  p_actor             text    default null::text,
  p_ai_generated      boolean default false,
  p_ai_rationale      text    default null::text,
  p_ai_rationale_ar   text    default null::text
)
returns public.purchase_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_po                public.purchase_orders;
  v_line              jsonb;
  v_part_id           uuid;
  v_qty               numeric(12, 2);
  v_price             numeric(12, 2);
  v_line_vat          numeric(12, 2);
  v_number            integer;
  v_part_warehouse_id uuid;
  v_subtotal          numeric(12, 2) := 0;
  v_vat_total         numeric(12, 2) := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and active = true;
  if not found then
    raise exception 'Supplier not found or inactive.';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id and active = true;
  if not found then
    raise exception 'Warehouse not found or inactive.';
  end if;

  v_number := public.next_po_number(extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer);

  insert into public.purchase_orders (
    po_number, supplier_id, warehouse_id, expected_delivery, note, requested_by,
    ai_generated, ai_rationale, ai_rationale_ar
  )
  values (
    'PO-' || extract(year from (now() at time zone 'Asia/Riyadh')::date)::text || '-' || lpad(v_number::text, 4, '0'),
    p_supplier_id, p_warehouse_id, p_expected_delivery, nullif(trim(p_note), ''), p_actor,
    coalesce(p_ai_generated, false), nullif(trim(p_ai_rationale), ''), nullif(trim(p_ai_rationale_ar), '')
  )
  returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'qty', '')::numeric;
    v_price   := nullif(v_line->>'unit_price_sar', '')::numeric;

    if v_part_id is null then
      raise exception 'Line item is missing part_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line item quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Line item price cannot be negative.';
    end if;

    select warehouse_id into v_part_warehouse_id
      from public.parts
     where id = v_part_id and active = true;

    if v_part_warehouse_id is null then
      raise exception 'Part not found or inactive.';
    end if;

    if v_part_warehouse_id <> p_warehouse_id then
      raise exception 'Part % belongs to a different warehouse than this purchase order.', v_part_id;
    end if;

    v_line_vat := round(v_qty * v_price * 0.15, 2);

    insert into public.purchase_order_lines (purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar)
    values (v_po.id, v_part_id, v_qty, v_price, v_line_vat);

    v_subtotal  := v_subtotal + (v_qty * v_price);
    v_vat_total := v_vat_total + v_line_vat;
  end loop;

  update public.purchase_orders
     set subtotal_sar = v_subtotal,
         vat_sar = v_vat_total,
         total_sar = v_subtotal + v_vat_total
   where id = v_po.id
  returning * into v_po;

  return v_po;
end;
$function$;

revoke execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text) from public, anon;
grant  execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. trips_set_ref -- the trip reference's year. current_date only reaches
--     this expression when trip_date is null, which is the same three-hour
--     window: an unstamped trip created at 01:00 Riyadh on 1 January takes
--     last year's sequence.
-- ---------------------------------------------------------------------------
create or replace function public.trips_set_ref()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_initials text;
  v_year     integer;
  v_seq      integer;
begin
  if new.ref is not null then
    return new;
  end if;

  v_year := extract(year from coalesce(new.trip_date, (now() at time zone 'Asia/Riyadh')::date))::integer;

  if new.project_id is not null then
    select initials into v_initials from public.projects where id = new.project_id;
  end if;

  if v_initials is not null then
    v_seq := public.next_trip_ref_number(new.project_id, v_year);
    new.ref := v_initials || '-' || lpad((v_year % 1000)::text, 3, '0')
                           || '-' || lpad(v_seq::text, 4, '0');
  else
    -- Bare-customer trip (no project), or a project row somehow missing
    -- initials — legacy fallback, unchanged shape from 0004.
    new.ref := 'WT-' || v_year::text || '-'
                      || lpad(nextval('public.trips_ref_seq')::text, 4, '0');
  end if;

  return new;
end;
$function$;

revoke execute on function public.trips_set_ref() from public, anon;
grant  execute on function public.trips_set_ref() to authenticated, service_role;


-- ===========================================================================
-- 2. DAY-BUCKET WRITES INSIDE FUNCTIONS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2a. receive_purchase_order -- stamps purchase_orders.received_date (a date
--     column) at receipt. Composes receive_loose_parts, which is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.receive_purchase_order(
  p_po_id  uuid,
  p_lines  jsonb,
  p_files  jsonb,
  p_note   text default null::text,
  p_actor  text default null::text
)
returns public.stock_receipts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_po                  public.purchase_orders;
  v_receipt             public.stock_receipts;
  v_line                jsonb;
  v_line_id             uuid;
  v_part_id             uuid;
  v_qty                 numeric(12, 2);
  v_price               numeric(12, 2);
  v_existing_part_id    uuid;
  v_extra_part_wh       uuid;
  v_line_ids            uuid[] := array[]::uuid[];
  v_extra_part_ids      uuid[] := array[]::uuid[];
  v_loose_lines         jsonb := '[]'::jsonb;
  v_po_line_count       integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'issued' then
    raise exception 'Only an issued purchase order can be received (current status: %).', v_po.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  select count(*) into v_po_line_count
    from public.purchase_order_lines
   where purchase_order_id = p_po_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'received_qty', '')::numeric;
    v_price   := nullif(v_line->>'received_unit_price_sar', '')::numeric;

    if v_line_id is not null and v_part_id is not null then
      raise exception 'Line item cannot specify both line_id and part_id.';
    end if;
    if v_line_id is null and v_part_id is null then
      raise exception 'Line item must specify either line_id (an existing PO line) or part_id (an extra item).';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Received quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Received unit price cannot be negative.';
    end if;

    if v_line_id is not null then
      if v_line_id = any(v_line_ids) then
        raise exception 'Line % was submitted more than once — each line must be received exactly once.', v_line_id;
      end if;

      select part_id into v_existing_part_id
        from public.purchase_order_lines
       where id = v_line_id and purchase_order_id = p_po_id;
      if not found then
        raise exception 'Line % does not belong to this purchase order.', v_line_id;
      end if;

      v_line_ids := array_append(v_line_ids, v_line_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_existing_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    else
      if v_part_id = any(v_extra_part_ids) then
        raise exception 'Part % was submitted more than once as an extra line.', v_part_id;
      end if;

      select warehouse_id into v_extra_part_wh
        from public.parts where id = v_part_id and active = true;
      if v_extra_part_wh is null then
        raise exception 'Extra line part % not found or inactive.', v_part_id;
      end if;
      if v_extra_part_wh <> v_po.warehouse_id then
        raise exception 'Extra line part % belongs to a different warehouse than this purchase order.', v_part_id;
      end if;

      perform 1 from public.purchase_order_lines
       where purchase_order_id = p_po_id and part_id = v_part_id;
      if found then
        raise exception 'Part % is already a line on this purchase order.', v_part_id;
      end if;

      v_extra_part_ids := array_append(v_extra_part_ids, v_part_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    end if;
  end loop;

  if coalesce(array_length(v_line_ids, 1), 0) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      coalesce(array_length(v_line_ids, 1), 0), v_po_line_count;
  end if;

  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id, receipt_type = 'po'
   where id = v_receipt.id;

  update public.purchase_order_lines pol
     set received_qty = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric,
         received_line_vat_sar = round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2)
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  insert into public.purchase_order_lines (
    purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar,
    received_qty, received_unit_price_sar, received_line_vat_sar
  )
  select p_po_id, (elem->>'part_id')::uuid,
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2),
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * 0.15, 2)
  from jsonb_array_elements(p_lines) elem
  where (elem->>'part_id') is not null;

  update public.purchase_orders po
     set status = 'pending_approval', received_by = p_actor, received_date = (now() at time zone 'Asia/Riyadh')::date,
         received_subtotal_sar = agg.sub, received_vat_sar = agg.vat, received_total_sar = agg.sub + agg.vat
    from (
      select coalesce(sum(pol.received_qty * pol.received_unit_price_sar), 0) as sub,
             coalesce(sum(pol.received_line_vat_sar), 0) as vat
      from public.purchase_order_lines pol
      where pol.purchase_order_id = p_po_id and pol.received_qty is not null
    ) agg
   where po.id = p_po_id;

  select * into v_receipt from public.stock_receipts where id = v_receipt.id;
  return v_receipt;
end;
$function$;

revoke execute on function public.receive_purchase_order(uuid,jsonb,jsonb,text,text) from public, anon;
grant  execute on function public.receive_purchase_order(uuid,jsonb,jsonb,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b. complete_work_order -- stamps trucks.last_service_date (a date column).
--     greatest() means a UTC-yesterday stamp is not merely wrong, it is
--     ABSORBED: the column keeps the older value and the service silently
--     does not register.
-- ---------------------------------------------------------------------------
create or replace function public.complete_work_order(
  p_wo_id uuid,
  p_actor text default null::text
)
returns public.work_orders
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
     set last_service_date = greatest(last_service_date, (now() at time zone 'Asia/Riyadh')::date)
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

revoke execute on function public.complete_work_order(uuid,text) from public, anon;
grant  execute on function public.complete_work_order(uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2c. complete_outsourced_job -- the same last_service_date stamp on the
--     outsourced track. Both tracks must move together or the two paths to
--     the same column disagree.
-- ---------------------------------------------------------------------------
create or replace function public.complete_outsourced_job(
  p_job_id uuid,
  p_actor  text default null::text
)
returns public.outsourced_jobs
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
     set last_service_date = greatest(last_service_date, (now() at time zone 'Asia/Riyadh')::date)
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

revoke execute on function public.complete_outsourced_job(uuid,text) from public, anon;
grant  execute on function public.complete_outsourced_job(uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2d. add_price_lot -- the FIFO lot's received_on. TWO sites, and both are
--     needed: the PARAMETER DEFAULT (evaluated at call time when the caller
--     omits the argument) and the coalesce in the body (which catches an
--     explicit null). Fixing only one leaves the other route on UTC.
--     Identity args are unchanged, so this stays one signature.
-- ---------------------------------------------------------------------------
create or replace function public.add_price_lot(
  p_part_id     uuid,
  p_price       numeric,
  p_qty         numeric,
  p_received_on date default (now() at time zone 'Asia/Riyadh')::date,
  p_note        text default null::text,
  p_actor       text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_part   public.parts;
  v_lot_id uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Received quantity must be positive.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Price cannot be negative.';
  end if;
  select * into v_part
    from public.parts
   where id = p_part_id
     and active = true
     for update;
  if v_part.id is null then
    raise exception 'Part not found or inactive.';
  end if;
  insert into public.price_lots (part_id, price_sar, qty_purchased, qty_remaining, received_on, note)
  values (p_part_id, p_price, p_qty, p_qty, coalesce(p_received_on, (now() at time zone 'Asia/Riyadh')::date), nullif(trim(p_note), ''))
  returning id into v_lot_id;
  update public.parts
     set qty_on_hand   = v_part.qty_on_hand + p_qty,
         unit_cost_sar = p_price
   where id = p_part_id
  returning * into v_part;
  insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
  values (p_part_id, 'receive_lot', p_qty, v_part.qty_on_hand, nullif(trim(p_note), ''), p_actor);
  return v_lot_id;
end;
$function$;

revoke execute on function public.add_price_lot(uuid,numeric,numeric,date,text,text) from public, anon;
grant  execute on function public.add_price_lot(uuid,numeric,numeric,date,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2e. record_exit_permit_return -- same two-site shape as add_price_lot:
--     parameter default plus the coalesce in the body.
-- ---------------------------------------------------------------------------
create or replace function public.record_exit_permit_return(
  p_permit_id   uuid,
  p_lines       jsonb,
  p_returned_on date default (now() at time zone 'Asia/Riyadh')::date,
  p_note        text default null::text,
  p_actor       text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_permit    public.exit_permits;
  v_return_id uuid;
  v_el        jsonb;
  v_line_id   uuid;
  v_qty       numeric(12, 2);
  v_line      public.exit_permit_lines;
begin
  select * into v_permit from public.exit_permits where id = p_permit_id for update;
  if v_permit.id is null then
    raise exception 'Exit permit not found.';
  end if;
  if v_permit.status <> 'exited' then
    raise exception 'Only an exited permit can take returns (this one is %).', v_permit.status;
  end if;
  if v_permit.kind <> 'returnable' then
    raise exception 'This permit is permanent — its items are not expected back.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A return must name at least one line.';
  end if;

  insert into public.exit_permit_returns (exit_permit_id, returned_on, note, created_by)
  values (p_permit_id, coalesce(p_returned_on, (now() at time zone 'Asia/Riyadh')::date), nullif(trim(p_note), ''), p_actor)
  returning id into v_return_id;

  for v_el in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_el ->> 'line_id')::uuid;
    v_qty     := (v_el ->> 'qty')::numeric;

    select * into v_line from public.exit_permit_lines
     where id = v_line_id and exit_permit_id = p_permit_id
     for update;
    if v_line.id is null then
      raise exception 'Line % does not belong to this permit.', v_line_id;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Return quantity must be positive.';
    end if;
    if v_line.qty_returned + v_qty > v_line.qty then
      raise exception 'Cannot return % — only % still outstanding on that line.',
        v_qty, v_line.qty - v_line.qty_returned;
    end if;

    insert into public.exit_permit_return_lines (exit_permit_return_id, exit_permit_line_id, qty)
    values (v_return_id, v_line_id, v_qty);

    update public.exit_permit_lines
       set qty_returned = qty_returned + v_qty
     where id = v_line_id;

    perform public.return_exit_permit_line(v_line_id, v_qty, p_actor);
  end loop;

  return v_return_id;
end;
$function$;

revoke execute on function public.record_exit_permit_return(uuid,jsonb,date,text,text) from public, anon;
grant  execute on function public.record_exit_permit_return(uuid,jsonb,date,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2f. return_customer_balance -- MONEY. The date frozen onto a real cash
--     refund record. NOTE the two deliberate differences from the functions
--     above, both preserved verbatim: this one is NOT security definer, and
--     its search_path is 'public', 'pg_temp'. Its parameter default is
--     already null (the caller is expected to pass a date), so only the
--     coalesce in the body changes.
-- ---------------------------------------------------------------------------
create or replace function public.return_customer_balance(
  p_customer_id uuid,
  p_method      text,
  p_reference   text default null::text,
  p_photo_path  text default null::text,
  p_returned_on date default null::date,
  p_note        text default null::text,
  p_actor       text default null::text
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_amount   numeric(12,2);
  v_archived timestamptz;
  v_id       uuid;
begin
  if p_method is null or p_method not in ('cash', 'bank_transfer') then
    raise exception 'Return method must be cash or bank_transfer.'
      using errcode = 'check_violation';
  end if;

  select ap.archived_at, ap.amount_payable_sar
    into v_archived, v_amount
    from public.v_customer_amount_payable ap
   where ap.customer_id = p_customer_id;

  if not found then
    raise exception 'Customer not found.';
  end if;

  if v_archived is null then
    raise exception 'Only an archived customer''s balance can be returned.'
      using errcode = 'check_violation';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'This customer holds no balance to return.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.customer_balance_returns where customer_id = p_customer_id) then
    raise exception 'This customer''s balance has already been returned.'
      using errcode = 'unique_violation';
  end if;

  insert into public.customer_balance_returns
    (customer_id, amount_sar, method, reference, photo_path, returned_on, note, returned_by)
  values
    (p_customer_id,
     v_amount,
     p_method,
     nullif(btrim(coalesce(p_reference, '')), ''),
     nullif(btrim(coalesce(p_photo_path, '')), ''),
     coalesce(p_returned_on, (now() at time zone 'Asia/Riyadh')::date),
     nullif(btrim(coalesce(p_note, '')), ''),
     nullif(btrim(coalesce(p_actor, '')), ''))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.return_customer_balance(uuid,text,text,text,date,text,text) from public, anon;
grant  execute on function public.return_customer_balance(uuid,text,text,text,date,text,text) to authenticated, service_role;


-- ===========================================================================
-- 3. COLUMN DEFAULTS -- six date columns whose default is bare CURRENT_DATE.
--    Every one is a calendar day the business reads, not an instant. A
--    default is the LAST line of defence: it fires exactly when no caller
--    supplied a date, which is the case nobody is watching.
-- ===========================================================================

-- trips.trip_date -- the day a trip is booked against. Drives revenue and
-- commission bucketing, the trip ref year (1b above) and every daily report.
alter table public.trips
  alter column trip_date set default (now() at time zone 'Asia/Riyadh')::date;

-- purchase_orders.request_date -- the day a PO was raised.
alter table public.purchase_orders
  alter column request_date set default (now() at time zone 'Asia/Riyadh')::date;

-- price_lots.received_on -- FIFO ordering key. Lots drain oldest-first, so a
-- date that lands a day early can change WHICH lot a consumption drains.
alter table public.price_lots
  alter column received_on set default (now() at time zone 'Asia/Riyadh')::date;

-- stock_receipts.received_on -- the receipt's own day, printed on the record.
alter table public.stock_receipts
  alter column received_on set default (now() at time zone 'Asia/Riyadh')::date;

-- exit_permit_returns.returned_on -- the day items came back through the gate.
alter table public.exit_permit_returns
  alter column returned_on set default (now() at time zone 'Asia/Riyadh')::date;

-- customer_balance_returns.returned_on -- MONEY. The date on a cash refund.
alter table public.customer_balance_returns
  alter column returned_on set default (now() at time zone 'Asia/Riyadh')::date;


-- ===========================================================================
-- 4. VIEWS -- three that bucket a day or a month off bare current_date.
--    Column names and types are unchanged in all three, so create or replace
--    is legal (42P16 only bites on insert/reorder/rename/retype) and the
--    dependent views do not need dropping. §6: each restates its security
--    footer, because create or replace view silently drops reloptions.
--
--    THE OTHER TWO VIEWS THAT MATCH current_date -- v_daily_operations and
--    v_delivered_revenue_daily -- ARE NOT TOUCHED. Their only hit is inside
--    greatest(current_date, riyadh), which already returns Riyadh.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4a. v_report_months -- THE MONTH SPINE, and the widest blast radius in this
--     file: sixteen views read it, including v_revenue_monthly (the P&L) and
--     v_driver_payslip_basis. Its upper bound is date_trunc('month',
--     current_date). At 01:00 Riyadh on the 1st the spine stops at LAST
--     month, so the current month is absent from every report built on it --
--     and a payslip preview for that month has no row to stand on.
--     The four coalesce fallbacks only fire on an empty source table; they
--     move too, so the lower bound cannot disagree with the upper.
-- ---------------------------------------------------------------------------
create or replace view public.v_report_months
with (security_invoker = true) as
  with bounds as (
    select least(
             coalesce((select min(confirmed_at)::date from public.invoices), (now() at time zone 'Asia/Riyadh')::date),
             coalesce((select min(trip_date)          from public.trips),    (now() at time zone 'Asia/Riyadh')::date),
             coalesce((select min(created_at)::date   from public.work_order_part_consumptions), (now() at time zone 'Asia/Riyadh')::date),
             coalesce((select min(expense_date)       from public.expenses), (now() at time zone 'Asia/Riyadh')::date)
           ) as lo
  )
  select generate_series(
           date_trunc('month', (select lo from bounds)),
           date_trunc('month', (now() at time zone 'Asia/Riyadh')::date),
           interval '1 month'
         )::date as month;

alter view public.v_report_months set (security_invoker = true);
revoke all on public.v_report_months from anon;
grant select on public.v_report_months to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. v_receivables_open -- receivables aging. days_outstanding and the three
--     bucket boundaries all subtract from current_date, so during the window
--     every open invoice reads a day younger than it is and an invoice
--     sitting exactly on 30 / 60 / 90 days prints the wrong bucket.
--     Body reproduced verbatim from 0137 (its comment included, since it
--     documents a 42P16 lesson that still applies); only the date source moves.
-- ---------------------------------------------------------------------------
create or replace view public.v_receivables_open as
select
  o.invoice_id,
  o.invoice_number,
  o.customer_id,
  c.name as customer_name,
  o.confirmed_at,
  o.period_end,
  -- Redundant today -- v_invoice_outstanding_live already pins this to numeric(12,2)
  -- above, so the cast is a no-op. It is written anyway so this file states the
  -- required type at the site the 42P16 error names, and cannot silently regress if
  -- the source view is ever re-drafted. The explicit alias is NOT optional dressing:
  -- this column's NAME is as load-bearing as its type (append-only rule), and relying
  -- on Postgres to name a cast expression is one assumption too many on a column that
  -- has already cost one apply cycle.
  o.outstanding_sar::numeric(12,2) as outstanding_sar,
  ((now() at time zone 'Asia/Riyadh')::date - o.confirmed_at::date) as days_outstanding,
  case
    when ((now() at time zone 'Asia/Riyadh')::date - o.confirmed_at::date) <= 30 then '0-30'
    when ((now() at time zone 'Asia/Riyadh')::date - o.confirmed_at::date) <= 60 then '31-60'
    when ((now() at time zone 'Asia/Riyadh')::date - o.confirmed_at::date) <= 90 then '61-90'
    else '90+'
  end as aging_bucket,
  o.frozen_amount_due_sar,
  o.outstanding_basis
from public.v_invoice_outstanding_live o
join public.customers c on c.id = o.customer_id
where o.outstanding_sar > 0::numeric;

alter view public.v_receivables_open set (security_invoker = true);
revoke all on public.v_receivables_open from anon;
grant select on public.v_receivables_open to authenticated;

-- ---------------------------------------------------------------------------
-- 4c. v_truck_day_state -- utilization. The two coalesce(closed_at::date,
--     current_date) expressions close an OPEN maintenance window at today.
--     One day early and the truck's window ends yesterday, so today's row
--     reads available while the truck is still in the workshop -- the state
--     is wrong in the direction that flatters the number.
--     The spine's greatest(current_date, riyadh) bound is LEFT AS IS: it
--     already resolves to Riyadh, and editing a correct expression to make
--     a grep read cleanly is not a fix.
-- ---------------------------------------------------------------------------
create or replace view public.v_truck_day_state as
with spine as (
  select generate_series(
           (select min(created_at)::date from public.trucks),
           greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
           interval '1 day')::date as day
),
down_windows as (
  -- RULING 1 + RULING 2: both tracks, started-or-finished work only.
  select w.truck_id,
         w.opened_at::date                                                as from_day,
         coalesce(w.closed_at::date, (now() at time zone 'Asia/Riyadh')::date) as to_day
    from public.work_orders w
   where w.status in ('in_progress', 'completed')
  union all
  select o.truck_id,
         o.start_date                                                     as from_day,
         coalesce(o.closed_at::date, (now() at time zone 'Asia/Riyadh')::date) as to_day
    from public.outsourced_jobs o
   where o.status in ('in_progress', 'completed')
),
worked as (
  select tr.truck_id, tr.trip_date as day
    from public.trips tr
   where tr.stage = 'delivered' and tr.truck_id is not null
   group by 1, 2
),
base as (
  select t.id as truck_id,
         t.plate,
         s.day,
         -- In service: created .. terminated, inclusive. A truck created or
         -- terminated mid-period is available only inside that window.
         (s.day >= t.created_at::date
          and (t.terminated_at is null or s.day <= t.terminated_at::date)) as in_service,
         (w.day is not null)                                               as worked,
         exists (select 1 from down_windows dw
                  where dw.truck_id = t.id
                    and s.day between dw.from_day and dw.to_day)           as has_down_window
    from public.trucks t
    cross join spine s
    left join worked w on w.truck_id = t.id and w.day = s.day
)
select d.truck_id,
       d.plate,
       d.day,
       d.in_service,
       d.worked,
       -- RULING 3: a delivered day is never a maintenance day.
       (d.has_down_window and not d.worked)                        as maintenance,
       (d.in_service and not (d.has_down_window and not d.worked)) as available
  from base d;

alter view public.v_truck_day_state set (security_invoker = true);
revoke all on public.v_truck_day_state from anon;
grant select on public.v_truck_day_state to authenticated;


-- ===========================================================================
-- 5. VERIFICATION -- read the CATALOG back, not this file's own claims.
--    §5: a migration's result grid is a claim; pg_proc / pg_attrdef /
--    pg_class / has_function_privilege are the evidence. Run every block.
-- ===========================================================================

-- 5a. The eight redefined functions: no bare current_date survives anywhere in
--     the definition (pg_get_functiondef, NOT prosrc -- prosrc omits parameter
--     defaults, and two of these carry the date in the signature), the Riyadh
--     expression is present, and anon still cannot execute.
--     EXPECT 8 rows, every bare_current_date false, every uses_riyadh true,
--     every anon_exec false, auth_exec and svc_exec true.
select p.oid::regprocedure::text                                    as ident,
       p.prosecdef                                                  as security_definer,
       lower(pg_get_functiondef(p.oid)) like '%current_date%'       as bare_current_date,
       lower(pg_get_functiondef(p.oid)) like '%asia/riyadh%'        as uses_riyadh,
       has_function_privilege('anon',          p.oid, 'execute')    as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute')    as auth_exec,
       has_function_privilege('service_role',  p.oid, 'execute')    as svc_exec
from pg_proc p
where p.oid = any (array[
  'public.add_price_lot(uuid,numeric,numeric,date,text,text)'::regprocedure,
  'public.complete_outsourced_job(uuid,text)'::regprocedure,
  'public.complete_work_order(uuid,text)'::regprocedure,
  'public.create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)'::regprocedure,
  'public.receive_purchase_order(uuid,jsonb,jsonb,text,text)'::regprocedure,
  'public.record_exit_permit_return(uuid,jsonb,date,text,text)'::regprocedure,
  'public.return_customer_balance(uuid,text,text,text,date,text,text)'::regprocedure,
  'public.trips_set_ref()'::regprocedure
])
order by 1;

-- 5b. Exactly one signature each -- no overload accumulated (0036/0037).
--     EXPECT 8 rows, every n = 1.
select n.nspname || '.' || p.proname as fn, count(*) as n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_price_lot','complete_outsourced_job','complete_work_order',
                    'create_purchase_order','receive_purchase_order','record_exit_permit_return',
                    'return_customer_balance','trips_set_ref')
group by 1 order by 1;

-- 5c. The house invariant, unchanged by this migration: ZERO non-trigger
--     functions in public are anon-executable.
--     EXPECT one row, anon_executable_non_trigger = 0.
select count(*) as anon_executable_non_trigger
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
  and p.prorettype <> 'trigger'::regtype;

-- 5d. Column defaults: no default anywhere in public still names current_date.
--     EXPECT ZERO ROWS.
select c.relname as table_name, a.attname as column_name,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
from pg_attrdef d
join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
join pg_class c on c.oid = d.adrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and lower(pg_get_expr(d.adbin, d.adrelid)) like '%current_date%'
order by 1, 2;

-- 5e. And the six now read Riyadh.
--     EXPECT 6 rows, every default_expr = ((now() AT TIME ZONE 'Asia/Riyadh'))::date
select c.relname as table_name, a.attname as column_name,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
from pg_attrdef d
join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
join pg_class c on c.oid = d.adrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (c.relname, a.attname) in (
    ('trips','trip_date'), ('purchase_orders','request_date'),
    ('price_lots','received_on'), ('stock_receipts','received_on'),
    ('exit_permit_returns','returned_on'), ('customer_balance_returns','returned_on'))
order by 1, 2;

-- 5f. Views: occurrence COUNTS, because v_truck_day_state deliberately keeps
--     one current_date inside greatest().
--     EXPECT exactly:
--       v_daily_operations         n_current_date 1   n_riyadh 1   (untouched)
--       v_delivered_revenue_daily  n_current_date 1   n_riyadh 1   (untouched)
--       v_receivables_open         n_current_date 0   n_riyadh 4
--       v_report_months            n_current_date 0   n_riyadh 5
--       v_truck_day_state          n_current_date 1   n_riyadh 3
select c.relname as view_name,
       (select count(*) from regexp_matches(lower(pg_get_viewdef(c.oid, true)), 'current_date', 'g')) as n_current_date,
       (select count(*) from regexp_matches(lower(pg_get_viewdef(c.oid, true)), 'asia/riyadh', 'g'))  as n_riyadh
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and c.relname in ('v_report_months','v_receivables_open','v_truck_day_state',
                    'v_daily_operations','v_delivered_revenue_daily')
order by 1;

-- 5g. The three replaced views kept their security footer.
--     EXPECT 3 rows, reloptions {security_invoker=true}, anon_select false,
--     auth_select true.
select c.relname, c.reloptions::text as reloptions,
       has_table_privilege('anon', c.oid, 'select')          as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('v_report_months','v_receivables_open','v_truck_day_state')
order by 1;

-- 5h. The whole view surface, per §6: views == security_invoker, and
--     anon_readable == 0. The absolute count is not the check.
select count(*) as views,
       count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
       count(*) filter (where has_table_privilege('anon', c.oid, 'select'))           as anon_readable
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public';

-- 5i. The month spine still reaches the current Riyadh month, and the
--     dependent views still resolve (this SELECT fails loudly if a replace
--     broke a dependency).
--     EXPECT max_month = date_trunc('month', Riyadh today), rows >= 1.
select count(*)                                                    as months,
       max(month)                                                  as max_month,
       date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date as expected_max,
       max(month) = date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date as spine_reaches_current_month
from public.v_report_months;

-- 5j. Smoke: the three replaced views and one dependent of each still execute.
select (select count(*) from public.v_report_months)            as report_months,
       (select count(*) from public.v_receivables_open)         as receivables_open,
       (select count(*) from public.v_truck_day_state)          as truck_day_state,
       (select count(*) from public.v_revenue_monthly)          as revenue_monthly,
       (select count(*) from public.v_receivables_aging)        as receivables_aging,
       (select count(*) from public.v_truck_utilization_monthly) as truck_utilization_monthly,
       (select count(*) from public.v_driver_payslip_basis)     as driver_payslip_basis;
