-- 0017_update_project_with_customer.sql
-- Atomic "Manage project → Edit" update: one customer + its linked project +
-- driver-assignment reconciliation, in a SINGLE server-side transaction.
-- WHY a DB function: same reason as create (0016) — Supabase JS over PostgREST
-- runs each statement as its own request/transaction, so an app-side sequence
-- could half-apply an edit. This function does all writes in one transaction:
-- ANY failure rolls back EVERYTHING. Mirrors create_project_with_customer (0016)
-- and pay_commission (0009): plpgsql, SECURITY INVOKER (no security clause →
-- RLS-respecting), explicit grant.
--
-- EDIT-ONLY columns: only the form-captured fields are written. Untouched on
-- purpose: customers.name_ar / payment_model / active / default_station(legacy);
-- projects.status / water_type / location* / start_date / end_date /
-- default_station(legacy). The 1:1 rule is not in play (customer_id never changes).
--
-- DRIVER DIFF: removed assignments are deleted, added ones inserted, retained
-- ones left intact (keeping their created_at). trips are NEVER referenced — there
-- is no FK from trips to project_drivers, so removing an assignment cannot touch
-- a driver's past trips or their stamped commission_sar (historical record).

begin;

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
  p_description       text,
  -- drivers (final desired set)
  p_driver_ids        uuid[]
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

  -- 1) Customer — ONLY the form-captured columns.
  update public.customers
     set name                  = p_cust_name,
         customer_type         = p_cust_type,
         contact_name          = p_contact_name,
         phone                 = p_phone,
         delivery_site_address = p_delivery_address,
         delivery_lat          = p_delivery_lat,
         delivery_lng          = p_delivery_lng
   where id = v_cust_id;

  -- 2) Project — ONLY the form-captured columns.
  update public.projects
     set name                  = p_proj_name,
         rate_per_trip_sar     = p_rate,
         commission_mode       = p_commission_mode,
         commission_value      = p_commission_value,
         commission_bump_pct   = p_commission_bump,
         default_water_station = p_default_water_station,
         description           = p_description
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
  text, numeric, text, numeric, numeric, text, text,
  uuid[]
) to authenticated;

commit;
