-- 0028_customer_email_rpc.sql
-- Thread customers.email through BOTH project RPCs (create/update), same
-- pattern as 0026's payment_mode addition. WHY: migration 0025 already added
-- customers.email (nullable text) for the invoice Email/mailto feature, but
-- no form ever wrote to it — every customer's email is NULL, so the invoice
-- Email button has nothing to send to. This adds a single p_cust_email text
-- param to each function and writes it; nothing else changes.
--
-- OVERLOAD HANDLING: same as 0026 — adding a parameter changes the function
-- SIGNATURE, so `create or replace` would leave a stale second overload
-- behind. Drop the 0026-era signatures (the ones WITH p_payment_mode, no
-- email) first, then create the new ones, then re-grant for the new
-- arg-type lists.
--
-- Column stays nullable/optional — email is not a required field (mirrors
-- contact_name/phone: free text, empty string coerced to NULL in the app
-- layer, not enforced here).

begin;

-- 1) Drop the OLD signatures (post-0026, pre-email). -------------------------
drop function if exists public.create_project_with_customer(
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text, uuid[], text
);
drop function if exists public.update_project_with_customer(
  uuid,
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text, uuid[], text
);

-- 2) Recreate create_project_with_customer WITH p_cust_email. ---------------
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
  p_water_type       text,
  p_description      text,
  -- drivers
  p_driver_ids       uuid[],
  -- Finance (0025)
  p_payment_mode     text,
  -- Finance email (0028)
  p_cust_email       text
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
     delivery_site_address, delivery_lat, delivery_lng, email)
  values
    (p_cust_name, p_cust_type, p_contact_name, p_phone,
     p_delivery_address, p_delivery_lat, p_delivery_lng, p_cust_email)
  returning id into v_cust_id;

  -- 2) Project linked to that customer. status falls to default 'active';
  --    default_station / location / location_lat / location_lng are
  --    intentionally left NULL. payment_mode is written from p_payment_mode
  --    (CHECK constraint from 0025 still guards the value).
  insert into public.projects
    (customer_id, name, rate_per_trip_sar, commission_mode,
     commission_value, commission_bump_pct, default_water_station,
     water_type, description, payment_mode)
  values
    (v_cust_id, p_proj_name, p_rate, p_commission_mode,
     p_commission_value, p_commission_bump, p_default_water_station,
     p_water_type, p_description, p_payment_mode)
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
  text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text
) to authenticated;

-- 3) Recreate update_project_with_customer WITH p_cust_email. ---------------
create or replace function public.update_project_with_customer(
  p_project_id        uuid,
  -- customer
  p_cust_name         text,
  p_cust_type         text,
  p_contact_name      text,
  p_phone             text,
  p_delivery_address  text,
  p_delivery_lat      double precision,
  p_delivery_lng      double precision,
  -- project
  p_proj_name         text,
  p_rate              numeric,
  p_commission_mode   text,
  p_commission_value  numeric,
  p_commission_bump   numeric,
  p_default_water_station text,
  p_water_type        text,
  p_description       text,
  -- drivers (final desired set)
  p_driver_ids        uuid[],
  -- Finance (0025)
  p_payment_mode      text,
  -- Finance email (0028)
  p_cust_email        text
) returns uuid
language plpgsql
as $$
declare
  v_cust_id uuid;
begin
  -- Derive the customer from the project (single source of truth; prevents a
  -- client from pointing the update at a mismatched customer).
  select customer_id into v_cust_id
    from public.projects
   where id = p_project_id;
  if v_cust_id is null then
    raise exception 'Project not found.';
  end if;

  -- 1) Customer — ONLY the form-captured columns (now incl. email).
  update public.customers
     set name                  = p_cust_name,
         customer_type         = p_cust_type,
         contact_name          = p_contact_name,
         phone                 = p_phone,
         delivery_site_address = p_delivery_address,
         delivery_lat          = p_delivery_lat,
         delivery_lng          = p_delivery_lng,
         email                 = p_cust_email
   where id = v_cust_id;

  -- 2) Project — ONLY the form-captured columns.
  update public.projects
     set name                  = p_proj_name,
         rate_per_trip_sar     = p_rate,
         commission_mode       = p_commission_mode,
         commission_value      = p_commission_value,
         commission_bump_pct   = p_commission_bump,
         default_water_station = p_default_water_station,
         water_type            = p_water_type,
         description           = p_description,
         payment_mode          = p_payment_mode
   where id = p_project_id;

  -- 3) Driver assignments — DIFF reconcile (never touches trips).
  --    Remove assignments no longer in the set.
  delete from public.project_drivers
   where project_id = p_project_id
     and driver_id <> all (p_driver_ids);
  --    Add new ones; retained rows are left as-is (keep their created_at).
  insert into public.project_drivers (project_id, driver_id)
  select p_project_id, d
    from unnest(p_driver_ids) as d
  on conflict (project_id, driver_id) do nothing;

  -- 4) Hand back the edited project id.
  return p_project_id;
end;
$$;

grant execute on function public.update_project_with_customer(
  uuid,
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text,
  uuid[], text, text
) to authenticated;

commit;
