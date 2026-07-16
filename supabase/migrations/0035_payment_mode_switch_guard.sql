-- 0035_payment_mode_switch_guard.sql
-- Finance polish Batch C3 — switching a project's payment_mode requires the
-- project to be fully settled first. Function-only migration, no schema
-- change.
--
-- SCOPE LIMITATION (flag for future readers): this guard is PROJECT-scoped
-- (p_project_id), but invoices key off customer_id only (0025) — never
-- project_id. That's safe today only because 1 customer = 1 project is an
-- enforced constraint (0015's projects_customer_id_unique or equivalent) —
-- every project's customer has exactly one project, so "this project's
-- unpaid invoices" and "this project's customer's unpaid invoices" are
-- always the same set in practice. If multi-project customers are ever
-- introduced, this function's invoice-count query (which filters by
-- customer_id, not project_id) would start counting a DIFFERENT project's
-- invoices against this one — it would need to become genuinely
-- project-scoped (e.g. invoices gaining a project_id) at that point. Not
-- built for here — out of scope, per C3's locked decisions.
--
-- RULE (locked, three checks — all must pass to allow a mode change):
--   1. Zero invoices for this project's customer in draft/review/confirmed
--      — every invoice must be paid or void.
--   2. Zero delivered trips for this project with invoice_id is null
--      (nothing billable sitting un-reserved).
--   3. If switching AWAY from prepaid: caller-supplied current balance must
--      be exactly 0 — no leftover credit or shortfall carried across.
--
-- Blocks ONLY when the mode is actually CHANGING from a previously-set
-- value (current payment_mode is not null AND differs from the requested
-- one) — never the first-time forced choice on a legacy null-mode project,
-- and never a no-op resubmit of the same mode.
--
-- BALANCE IS CALLER-COMPUTED, not re-derived here (same precedent as
-- confirm_invoice(), 0027/0032, which takes already-computed VAT/subtotal/
-- total as numeric params instead of re-deriving money math in plpgsql):
-- lib/prepaid.ts's derivedBalance() is the ONE tested, pure-TS source for
-- this number. p_current_balance is trusted as-is; this function never
-- touches customer_topups or does trip-consumption math itself.
--
-- ENFORCEMENT: server-authoritative. can_switch_payment_mode(project_id,
-- new_mode, current_balance) returns (blocked, reason) and is called from
-- INSIDE update_project_with_customer (raises if blocked and the mode is
-- actually changing) — the unbypassable gate. app/trips/actions.ts's
-- checkPaymentModeSwitch() calls this SAME function directly (via
-- supabase.rpc) for ProjectModal's proactive client-side check, so the
-- UI's blocked reason and the DB's hard block can never disagree — no
-- duplicated predicate logic in two places (unlike the undelivered-trip
-- blocker in invoiceActions.ts, which predates this function and re-
-- queries by hand; this one ships as a standalone RPC from day one so both
-- call sites share it directly).
--
-- update_project_with_customer gains ONE new trailing param
-- (p_current_balance numeric) — signature change, so the old 19-arg
-- overload is DROPPED explicitly first (same pattern as 0026/0028), then
-- recreated with the new 20-arg signature, then re-GRANTed.

begin;

-- ============================================================================
-- 1. can_switch_payment_mode() — the single source of truth for the guard.
-- ============================================================================
create or replace function public.can_switch_payment_mode(
  p_project_id      uuid,
  p_new_mode        text,
  p_current_balance numeric default 0
) returns table(blocked boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id     uuid;
  v_current_mode    text;
  v_unpaid_invoices integer;
  v_unbilled_trips  integer;
  v_parts           text[] := '{}';
begin
  select customer_id, payment_mode into v_customer_id, v_current_mode
    from public.projects
   where id = p_project_id;

  if v_customer_id is null then
    raise exception 'Project not found.';
  end if;

  -- Not a real switch: first-time forced choice (legacy null mode) or a
  -- no-op resubmit of the current mode. Never block either.
  if v_current_mode is null or v_current_mode = p_new_mode then
    return query select false, null::text;
    return;
  end if;

  -- Rule 1: every invoice for this project's customer must be settled
  -- (paid or void) — none left in draft/review/confirmed.
  select count(*) into v_unpaid_invoices
    from public.invoices
   where customer_id = v_customer_id
     and status in ('draft', 'review', 'confirmed');

  if v_unpaid_invoices > 0 then
    v_parts := v_parts || (v_unpaid_invoices::text || ' unpaid invoice(s)');
  end if;

  -- Rule 2: no delivered trip for this project sitting un-invoiced.
  select count(*) into v_unbilled_trips
    from public.trips
   where project_id = p_project_id
     and delivered_at is not null
     and invoice_id is null;

  if v_unbilled_trips > 0 then
    v_parts := v_parts || (v_unbilled_trips::text || ' delivered trip(s) not yet invoiced');
  end if;

  -- Rule 3: switching AWAY from prepaid requires an exactly-zero balance —
  -- only checked in that direction (prepaid -> other), per the locked rule.
  if v_current_mode = 'prepaid' and p_new_mode <> 'prepaid' and p_current_balance <> 0 then
    v_parts := v_parts || ('remaining balance ' || to_char(p_current_balance, 'FM999999990.00') || ' SAR');
  end if;

  if array_length(v_parts, 1) is null then
    return query select false, null::text;
  else
    return query select true, ('Can''t switch: ' || array_to_string(v_parts, ', ') || ' — settle these first.');
  end if;
end;
$$;

grant execute on function public.can_switch_payment_mode(uuid, text, numeric) to authenticated;

-- ============================================================================
-- 2. update_project_with_customer — gains p_current_balance (trailing,
--    defaulted) and calls the guard before touching any row. Old 19-arg
--    signature dropped explicitly (signature change); body otherwise
--    IDENTICAL to 0028's version.
-- ============================================================================
drop function if exists public.update_project_with_customer(
  uuid,
  text, text, text, text, text, double precision, double precision,
  text, numeric, text, numeric, numeric, text, text, text,
  uuid[], text, text
);

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
  -- Finance C3 (0035): caller-computed prepaid balance (lib/prepaid.ts's
  -- derivedBalance()) — only consulted by can_switch_payment_mode() when
  -- switching AWAY from prepaid. Defaulted so old callers (none left after
  -- this migration ships, but safe belt-and-suspenders) don't hard-fail.
  p_current_balance   numeric default 0
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

  -- Finance C3: only a REAL change (current mode set AND different from the
  -- requested one) is gated — before any row is touched, so a blocked
  -- switch mutates nothing (same "check before write" discipline as
  -- confirm_invoice()'s undelivered-trip guard, 0032).
  if v_current_mode is not null and v_current_mode is distinct from p_payment_mode then
    select blocked, reason into v_switch_blocked, v_switch_reason
      from public.can_switch_payment_mode(p_project_id, p_payment_mode, p_current_balance);
    if v_switch_blocked then
      raise exception '%', v_switch_reason;
    end if;
  end if;

  update public.customers
     set name = p_cust_name, customer_type = p_cust_type, contact_name = p_contact_name,
         phone = p_phone, delivery_site_address = p_delivery_address,
         delivery_lat = p_delivery_lat, delivery_lng = p_delivery_lng, email = p_cust_email
   where id = v_cust_id;

  update public.projects
     set name = p_proj_name, rate_per_trip_sar = p_rate, commission_mode = p_commission_mode,
         commission_value = p_commission_value, commission_bump_pct = p_commission_bump,
         default_water_station = p_default_water_station, water_type = p_water_type,
         description = p_description, payment_mode = p_payment_mode
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
  uuid[], text, text, numeric
) to authenticated;

commit;
