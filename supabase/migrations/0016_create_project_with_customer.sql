-- 0016_create_project_with_customer.sql
-- Atomic "New Project" creation: one customer + one linked project + driver
-- assignments, in a SINGLE server-side transaction.
-- WHY a DB function: Supabase JS over PostgREST runs each .insert() as its own
-- request/transaction — there is no BEGIN..COMMIT spanning multiple JS calls, so
-- an app-side sequence could orphan a customer if the project insert failed.
-- This function does all inserts in one transaction: ANY failure rolls back
-- EVERYTHING → zero orphaned rows. Mirrors pay_commission (0009): plpgsql,
-- SECURITY INVOKER (no security clause → RLS-respecting), explicit grant.
--
-- 1:1 rule (projects_customer_id_unique, migration 0015) is caught and turned
-- into a friendly message. In normal flow the customer is brand-new each call,
-- so the unique violation is a guardrail rather than an expected path.

begin;

create or replace function public.create_project_with_customer(
  -- customer
  p_cust_name        text,
  p_cust_type        text,
  p_contact_name     text,
  p_phone            text,
  p_delivery_address text,
  p_delivery_lat     double precision,
  p_delivery_lng     double precision,
  -- project
  p_proj_name        text,
  p_rate             numeric,
  p_commission_mode  text,
  p_commission_value numeric,
  p_commission_bump  numeric,
  p_default_water_station text,
  p_description      text,
  -- drivers
  p_driver_ids       uuid[]
) returns uuid
language plpgsql
as $$
declare
  v_cust_id uuid;
  v_proj_id uuid;
begin
  -- 1) Customer. payment_model/active fall to their column defaults.
  insert into public.customers
    (name, customer_type, contact_name, phone,
     delivery_site_address, delivery_lat, delivery_lng)
  values
    (p_cust_name, p_cust_type, p_contact_name, p_phone,
     p_delivery_address, p_delivery_lat, p_delivery_lng)
  returning id into v_cust_id;

  -- 2) Project linked to that customer. status falls to default 'active';
  --    default_station / location / location_lat / location_lng / water_type
  --    are intentionally left NULL.
  insert into public.projects
    (customer_id, name, rate_per_trip_sar, commission_mode,
     commission_value, commission_bump_pct, default_water_station, description)
  values
    (v_cust_id, p_proj_name, p_rate, p_commission_mode,
     p_commission_value, p_commission_bump, p_default_water_station, p_description)
  returning id into v_proj_id;

  -- 3) Driver assignments (one row per id; created_at defaults).
  insert into public.project_drivers (project_id, driver_id)
  select v_proj_id, d from unnest(p_driver_ids) as d;

  -- 4) Hand back the new project id.
  return v_proj_id;

exception
  -- 1:1 guardrail → friendly copy straight from the DB.
  when unique_violation then
    raise exception 'A project for this customer already exists (one customer = one project).';
end;
$$;

grant execute on function public.create_project_with_customer(
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, uuid[]
) to authenticated;

commit;
