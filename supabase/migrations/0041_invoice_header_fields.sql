-- 0041_invoice_header_fields.sql
-- Finance/Invoice polish — Batch D: invoice header restructure (buyer /
-- seller / invoice sections), finance-invoice-spec.md v3.
--
-- RECON FINDINGS (see CLAUDE.md/session report): most buyer-side fields
-- already exist as customers columns (name_ar, billing_address, vat_number,
-- cr_number — all added 0001/0025) but were never wired into
-- create_project_with_customer / update_project_with_customer or the
-- ProjectModal form. This migration widens BOTH RPCs to accept and write
-- those 4 pre-existing columns — no new customers columns needed.
--
-- Genuinely NEW columns: company_settings gains description/telephone/phone
-- (landline+mobile, distinct). VAT Registration Number reuses the existing
-- vat_number column on BOTH customers and company_settings (relabeled in the
-- UI only, per locked decision — do NOT add a second reg-number column). CR
-- Company Name reuses the existing company_settings.legal_name (relabeled).
--
-- No RPC change needed for company_settings: the seller snapshot is captured
-- via `select("*")` in invoiceActions.ts's assembleForCustomerPeriod — any
-- new column here flows into invoices.seller_snapshot automatically at
-- confirm. Only the app-level get/update actions (invoiceActions.ts) and the
-- CompanySettingsModal form needed widening (done in app code, no SQL here).
--
-- All new/newly-wired columns are nullable, additive, no backfill — required
-- going forward is a form-layer nicety only. Existing confirmed invoices'
-- frozen snapshots simply won't have these fields (same precedent as every
-- prior frozen-snapshot gap, e.g. 0036's legacy ledger-total columns).
--
-- OVERLOAD HANDLING (same drop-then-recreate discipline as 0026/0028/0034/
-- 0035): adding parameters changes each RPC's signature, so `create or
-- replace` alone would leave the old signature as a stale second overload.
-- Drop the exact current signatures first (18-arg create_project_with_
-- customer per 0028; 19-arg update_project_with_customer per 0035), then
-- recreate with the 4 new trailing customer params, then re-grant for the
-- new arg-type lists.

begin;

-- 1) company_settings — new seller fields (nullable, additive). -------------
alter table public.company_settings
  add column if not exists description text,
  add column if not exists telephone   text, -- landline
  add column if not exists phone       text; -- mobile

-- 2) Drop the OLD RPC signatures (post-0028 / post-0035, pre-header-fields). -
drop function if exists public.create_project_with_customer(
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text
);
drop function if exists public.update_project_with_customer(
  uuid,
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text,
  uuid[], text, text, numeric
);

-- 3) Recreate create_project_with_customer WITH the 4 new buyer fields. -----
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
  p_cust_email       text,
  -- Batch D — buyer header fields (pre-existing customers columns, newly
  -- wired). All nullable/optional.
  p_cust_name_ar          text default null,
  p_cust_vat_number       text default null,
  p_cust_cr_number        text default null,
  p_cust_billing_address  text default null
) returns uuid
language plpgsql
as $$
declare
  v_cust_id uuid;
  v_proj_id uuid;
begin
  -- 1) Customer. payment_model/active fall to their column defaults.
  insert into public.customers
    (name, name_ar, customer_type, contact_name, phone,
     delivery_site_address, delivery_lat, delivery_lng, email,
     vat_number, cr_number, billing_address)
  values
    (p_cust_name, p_cust_name_ar, p_cust_type, p_contact_name, p_phone,
     p_delivery_address, p_delivery_lat, p_delivery_lng, p_cust_email,
     p_cust_vat_number, p_cust_cr_number, p_cust_billing_address)
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
  text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text,
  text, text, text, text
) to authenticated;

-- 4) Recreate update_project_with_customer WITH the 4 new buyer fields. -----
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
  p_cust_email        text,
  -- Finance C3 (0035)
  p_current_balance   numeric default 0,
  -- Batch D — buyer header fields (pre-existing customers columns, newly
  -- wired). All nullable/optional.
  p_cust_name_ar          text default null,
  p_cust_vat_number       text default null,
  p_cust_cr_number        text default null,
  p_cust_billing_address  text default null
) returns uuid
language plpgsql
as $$
declare
  v_cust_id        uuid;
  v_current_mode   text;
  v_switch_blocked boolean;
  v_switch_reason  text;
begin
  select customer_id, payment_mode into v_cust_id, v_current_mode
    from public.projects
   where id = p_project_id;
  if v_cust_id is null then
    raise exception 'Project not found.';
  end if;

  if v_current_mode is not null and v_current_mode is distinct from p_payment_mode then
    select blocked, reason into v_switch_blocked, v_switch_reason
      from public.can_switch_payment_mode(p_project_id, p_payment_mode, p_current_balance);
    if v_switch_blocked then
      raise exception '%', v_switch_reason;
    end if;
  end if;

  update public.customers
     set name                  = p_cust_name,
         name_ar               = p_cust_name_ar,
         customer_type         = p_cust_type,
         contact_name          = p_contact_name,
         phone                 = p_phone,
         delivery_site_address = p_delivery_address,
         delivery_lat          = p_delivery_lat,
         delivery_lng          = p_delivery_lng,
         email                 = p_cust_email,
         vat_number            = p_cust_vat_number,
         cr_number             = p_cust_cr_number,
         billing_address       = p_cust_billing_address
   where id = v_cust_id;

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

  delete from public.project_drivers
   where project_id = p_project_id and driver_id <> all (p_driver_ids);
  insert into public.project_drivers (project_id, driver_id)
  select p_project_id, d from unnest(p_driver_ids) as d
  on conflict (project_id, driver_id) do nothing;

  return p_project_id;
end;
$$;

grant execute on function public.update_project_with_customer(
  uuid,
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text,
  uuid[], text, text, numeric,
  text, text, text, text
) to authenticated;

commit;
