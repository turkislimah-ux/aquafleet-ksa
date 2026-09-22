-- ============================================================================
-- 0207_drop_legacy_prepaid.sql — THE DELETION
-- ============================================================================
-- Rulings (Turki): everything old goes; the 0203 ledger is the only model.
-- The app stopped reading every object dropped here in 0206 Groups A-C.
--
-- COLUMNS THE LEGACY DOCUMENT STILL RENDERS — VERIFIED IN CODE AND KEPT.
-- app/trips/invoiceActions.ts (the frozen read-back, toPdfInvoiceData) and
-- lib/invoiceViewModel.ts render an issued invoice from these stored columns,
-- and the 29 pre-ledger invoices remain openable until the deploy-phase wipe:
--   covered_lines, unpaid_lines, special_charges_snapshot,
--   covered_subtotal_sar, covered_vat_sar, covered_total_sar,
--   amount_due_subtotal_sar, amount_due_vat_sar, amount_due_sar,
--   grand_subtotal_sar, grand_vat_sar, grand_total_sar,
--   covered_ledger_subtotal_sar, unpaid_ledger_subtotal_sar, hide_amount_due
-- (amount_due_sar is also read by v_invoice_outstanding_live's frozen arm and
-- v_revenue_invoices.) NONE of these are dropped. unpaid_lines is not even
-- legacy-only: it is the ledger era's own line snapshot, so its confirm
-- parameter STAYS. The covered/due totals params also STAY — their columns
-- are legacy-rendered, and Tier B of the 0191 assertions closes over them.
--
-- WHAT IS DROPPED: covered_trip_ids and unpaid_trip_ids (read only by the
-- settlement RPCs' redundant re-stamp — replaced below by the 0030
-- reserve-at-draft linkage, which is where trips.invoice_id is really set),
-- the two pool views, return_customer_balance, the two dummy-data tables,
-- and projects.payment_mode (customers.payment_mode is the one authority,
-- 0206 Group C).
--
-- ORDER MATTERS: functions are re-emitted BEFORE the columns they used to
-- touch are dropped — plpgsql bodies are not dependency-tracked, so a column
-- drop under a live function fails at CALL time, not at drop time.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. confirm_invoice — 18 arguments. p_covered_lines, p_covered_trip_ids and
--    p_unpaid_trip_ids are gone: the ledger era has no covered lines (always
--    []) and the trip linkage is the draft reservation, not a frozen array.
--    Body otherwise verbatim, including every 0191 assertion — Tier A's line
--    sum simply loses its covered term, which was an empty array's zero.
--    New rows leave covered_lines NULL; the read-back's `?? []` renders that
--    identically to the [] confirm used to write.
-- ----------------------------------------------------------------------------

drop function if exists public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text, text);

create function public.confirm_invoice(
  p_invoice_id      uuid,
  p_seller_snapshot jsonb,
  p_buyer_snapshot  jsonb,
  p_unpaid_lines    jsonb,
  p_special_charges jsonb,
  p_covered_subtotal numeric,
  p_covered_vat      numeric,
  p_covered_total    numeric,
  p_due_subtotal     numeric,
  p_due_vat          numeric,
  p_due_total        numeric,
  p_grand_subtotal   numeric,
  p_grand_vat        numeric,
  p_grand_total      numeric,
  p_covered_ledger_subtotal numeric default null,
  p_unpaid_ledger_subtotal  numeric default null,
  p_payment_mode    text default null,
  p_actor           text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_seq               integer;
  v_year              integer;
  v_number            text;
  v_row               public.invoices;
  v_undelivered_count integer;
  v_payload_count     integer;
  v_payload_distinct  integer;
  v_charge_divergence text;
  v_line_sum          numeric;
begin
  select count(*) into v_undelivered_count
    from public.trips t
    join public.invoices i on i.id = p_invoice_id
    join public.projects p on p.customer_id = i.customer_id
   where t.project_id = p.id
     and t.trip_date between i.period_start and i.period_end
     and t.delivered_at is null;

  if v_undelivered_count > 0 then
    raise exception 'Cannot confirm — % trip(s) in this invoice''s period are not yet delivered.', v_undelivered_count;
  end if;

  if p_special_charges is not null and jsonb_typeof(p_special_charges) <> 'array' then
    raise exception 'confirm_invoice: p_special_charges must be a JSON array, got %.',
      jsonb_typeof(p_special_charges);
  end if;

  select count(*), count(distinct (e->>'id'))
    into v_payload_count, v_payload_distinct
    from jsonb_array_elements(
           case when jsonb_typeof(p_special_charges) = 'array'
                then p_special_charges
                else '[]'::jsonb end
         ) e;

  if v_payload_count <> v_payload_distinct then
    raise exception 'confirm_invoice: p_special_charges contains duplicate charge ids (% entries, % distinct).',
      v_payload_count, v_payload_distinct;
  end if;

  select string_agg(d.msg, '; ' order by d.msg)
    into v_charge_divergence
    from (
      select case
               when s.id is null then
                 'payload carries charge ' || c.id::text || ' which is not on this invoice'
               when c.id is null then
                 'payload OMITS charge ' || s.id::text || ' (' || s.label || ', '
                   || s.amount_sar::text || ' net / '
                   || round(s.amount_sar * (1 + public.vat_rate()), 2)::text || ' gross SAR)'
               else
                 'charge ' || s.id::text || ' amount differs: table '
                   || s.amount_sar::text || ' vs payload ' || c.amount_sar::text
             end as msg
        from (
          select sc.id, sc.label, sc.amount_sar
            from public.invoice_special_charges sc
           where sc.invoice_id = p_invoice_id
        ) s
        full outer join (
          select (e->>'id')::uuid    as id,
                 (e->>'amount_sar')::numeric as amount_sar
            from jsonb_array_elements(
                   case when jsonb_typeof(p_special_charges) = 'array'
                        then p_special_charges
                        else '[]'::jsonb end
                 ) e
        ) c on c.id = s.id
       where s.id is null
          or c.id is null
          or s.amount_sar is distinct from c.amount_sar
    ) d;

  if v_charge_divergence is not null then
    raise exception 'Cannot confirm — the special charges sent do not match this invoice''s charges, which have already consumed the customer''s balance: %.', v_charge_divergence
      using hint = 'Reopen the invoice so the charge table reloads, then confirm again. Confirming now would freeze an invoice that understates money already deducted.';
  end if;

  -- =====================================================================
  -- TOTALS ASSERTIONS (0191) — kept verbatim, minus the covered-lines term
  -- of Tier A's sum: with no covered payload it is an empty array's zero.
  -- =====================================================================

  select round(coalesce(sum(l.amount_sar), 0), 2)
    into v_line_sum
    from (
      select distinct
             a.e->>'kind'                  as kind,
             a.e->>'id'                    as id,
             (a.e->>'amount_sar')::numeric as amount_sar
        from (
          select e from jsonb_array_elements(
                          case when jsonb_typeof(p_unpaid_lines) = 'array'
                               then p_unpaid_lines else '[]'::jsonb end) e
          union all
          select e from jsonb_array_elements(
                          case when jsonb_typeof(p_special_charges) = 'array'
                               then p_special_charges else '[]'::jsonb end) e
        ) a
    ) l;

  if p_covered_subtotal is null or p_covered_vat is null or p_covered_total is null
     or p_due_subtotal is null or p_due_vat is null or p_due_total is null
     or p_grand_subtotal is null or p_grand_vat is null or p_grand_total is null then
    raise exception 'confirm_invoice: a document total arrived NULL (covered % / % / %, due % / % / %, grand % / % / %) — an invoice cannot be frozen around a figure that is missing.',
      p_covered_subtotal, p_covered_vat, p_covered_total,
      p_due_subtotal, p_due_vat, p_due_total,
      p_grand_subtotal, p_grand_vat, p_grand_total
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER A — the document must add up to the lines it prints.
  if round(v_line_sum, 2) is distinct from round(p_grand_subtotal, 2) then
    raise exception 'confirm_invoice: the invoice lines sum to % but the Grand Total subtotal says % — the document does not add up to its own lines (short by %).',
      v_line_sum, p_grand_subtotal, round(v_line_sum - p_grand_subtotal, 2)
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER B — covered + amount due = grand, on all three components.
  if round(p_covered_subtotal + p_due_subtotal, 2) is distinct from round(p_grand_subtotal, 2)
     or round(p_covered_vat + p_due_vat, 2) is distinct from round(p_grand_vat, 2)
     or round(p_covered_total + p_due_total, 2) is distinct from round(p_grand_total, 2) then
    raise exception 'confirm_invoice: covered + amount due does not equal grand — subtotal % + % vs %; VAT % + % vs %; total % + % vs %.',
      p_covered_subtotal, p_due_subtotal, p_grand_subtotal,
      p_covered_vat, p_due_vat, p_grand_vat,
      p_covered_total, p_due_total, p_grand_total
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER C — the printed VAT is ONE document-level pass, rounded once.
  if round(p_grand_vat, 2) is distinct from round(p_grand_subtotal * public.vat_rate(), 2) then
    raise exception 'confirm_invoice: grand VAT is % — one document-level pass over the % subtotal at the KSA rate gives %.',
      p_grand_vat, p_grand_subtotal, round(p_grand_subtotal * public.vat_rate(), 2)
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  v_year   := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq    := public.next_invoice_number(v_year);
  v_number := lpad((v_year % 1000)::text, 3, '0') || '-' || lpad(v_seq::text, 6, '0');

  update public.invoices
     set status                    = 'confirmed',
         invoice_number            = v_number,
         confirmed_at              = now(),
         seller_snapshot           = p_seller_snapshot,
         buyer_snapshot            = p_buyer_snapshot,
         unpaid_lines              = p_unpaid_lines,
         special_charges_snapshot  = p_special_charges,
         covered_subtotal_sar      = p_covered_subtotal,
         covered_vat_sar           = p_covered_vat,
         covered_total_sar         = p_covered_total,
         amount_due_subtotal_sar   = p_due_subtotal,
         amount_due_vat_sar        = p_due_vat,
         amount_due_sar            = p_due_total,
         grand_subtotal_sar        = p_grand_subtotal,
         grand_vat_sar             = p_grand_vat,
         grand_total_sar           = p_grand_total,
         covered_ledger_subtotal_sar  = p_covered_ledger_subtotal,
         unpaid_ledger_subtotal_sar   = p_unpaid_ledger_subtotal,
         payment_mode                 = p_payment_mode
   where id = p_invoice_id
     and status = 'review'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in review status (or does not exist) — cannot confirm.';
  end if;

  -- =====================================================================
  -- THE FREEZE — and nothing else (0204, verbatim).
  -- =====================================================================

  update public.invoices
     set prepaid_applied_sar = 0,
         amount_payable_sar  = round(v_row.grand_total_sar, 2)
   where id = p_invoice_id;

  select * into v_row from public.invoices where id = p_invoice_id;
  return v_row;
end;
$function$;

revoke execute on function public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) from anon, public;
grant execute on function public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The settlement RPCs lose the redundant array re-stamp. trips.invoice_id
--    is set at DRAFT (reserve-at-draft, 0030, via create_draft_invoice) and
--    released only by void/discard — the settlement-time
--    `set invoice_id where id = any(covered_trip_ids || unpaid_trip_ids)`
--    re-wrote a linkage that already existed, off two columns dropped below.
--    Everything else in each body is verbatim. pay_invoice's 'balance' mode
--    fallback also repoints from the projects column (dropped below) to
--    customers.payment_mode, the one authority.
--
--    unpay_invoice IS NOT RE-EMITTED (deviation from the instruction list,
--    stated in the return): its body references none of the dropped objects —
--    0030's "unpay does not release" means it never touched trips at all.
-- ----------------------------------------------------------------------------

drop function if exists public.pay_invoice(uuid, text, text, text, date, text);

create function public.pay_invoice(
  p_invoice_id uuid,
  p_payment_method text,
  p_proof_path text,
  p_payment_reference text,
  p_payment_date date,
  p_payment_note text
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.invoices;
  v_mode text;
begin
  if p_payment_method not in ('cash', 'bank_transfer', 'balance') then
    raise exception 'Invalid payment method: %', p_payment_method;
  end if;
  if p_payment_method = 'bank_transfer' and p_proof_path is null then
    raise exception 'bank_transfer payment requires a proof-of-payment file.';
  end if;
  if p_payment_method = 'bank_transfer' and p_payment_reference is null then
    raise exception 'bank_transfer payment requires a payment reference.';
  end if;
  if p_payment_method = 'bank_transfer' and p_payment_date is null then
    raise exception 'bank_transfer payment requires a payment date.';
  end if;

  -- 'balance' may only settle an invoice that resolves to prepaid mode.
  -- Resolve mode: invoice snapshot first, else the CUSTOMER's mode — the one
  -- authority (0206 Group C; projects.payment_mode is dropped in this
  -- migration). A NULL snapshot is NOT evidence of "not prepaid".
  if p_payment_method = 'balance' then
    select coalesce(i.payment_mode, c.payment_mode)
      into v_mode
      from public.invoices i
      join public.customers c on c.id = i.customer_id
     where i.id = p_invoice_id;
    if v_mode is distinct from 'prepaid' then
      raise exception 'balance payment is only valid for prepaid invoices (resolved mode: %).', coalesce(v_mode,'unknown');
    end if;
  end if;

  update public.invoices
     set status                 = 'paid',
         paid_at                = now(),
         payment_method         = p_payment_method,
         proof_of_payment_path  = p_proof_path,
         payment_reference      = p_payment_reference,
         payment_date           = p_payment_date,
         payment_note           = p_payment_note
   where id = p_invoice_id
     and status = 'confirmed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in confirmed status (or does not exist) — cannot mark paid.';
  end if;

  -- NO TRIP STAMP. The invoice's trips already carry invoice_id from the
  -- draft reservation (0030); the frozen-array re-stamp died with its columns.
  return v_row;
end;
$function$;

revoke execute on function public.pay_invoice(uuid, text, text, text, date, text) from anon, public;
grant execute on function public.pay_invoice(uuid, text, text, text, date, text) to authenticated, service_role;

drop function if exists public.apply_balance_to_invoice(uuid, text);

create function public.apply_balance_to_invoice(p_invoice_id uuid, p_actor text default null)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inv       public.invoices;
  v_mode      text;
  v_remainder numeric;
  v_available numeric;
  v_draw      numeric;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'confirmed' then
    raise exception 'Balance can only be applied to a confirmed invoice (current status: %).', v_inv.status;
  end if;
  if v_inv.amount_payable_sar is null then
    raise exception 'This invoice has no frozen amount payable (issued before the ledger model) — settle it with the legacy flow.';
  end if;

  select payment_mode into v_mode from public.customers where id = v_inv.customer_id for update;
  if v_mode is distinct from 'prepaid' then
    raise exception 'Balance can only be applied for a prepaid customer (mode: %).', coalesce(v_mode, 'unknown');
  end if;

  select s.remainder_sar into v_remainder
    from public.v_invoice_settlement s where s.invoice_id = p_invoice_id;
  select a.available_sar into v_available
    from public.v_customer_available a where a.customer_id = v_inv.customer_id;

  -- 0204: Available reserves the unsettled remainder of EVERY confirmed
  -- ledger-era invoice — including this one. Add this invoice's own
  -- remainder back before the draw (verbatim; see 0204 for the worked case).
  v_available := round(coalesce(v_available, 0) + coalesce(v_remainder, 0), 2);

  v_draw := round(least(coalesce(v_available, 0), coalesce(v_remainder, 0)), 2);
  if v_draw <= 0 then
    raise exception 'Nothing to apply — Available is % SAR and the invoice remainder is % SAR.',
      to_char(coalesce(v_available, 0), 'FM999,999,990.00'),
      to_char(coalesce(v_remainder, 0), 'FM999,999,990.00');
  end if;

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, invoice_id, note, created_by)
  values
    (v_inv.customer_id, 'balance_applied', -v_draw, p_invoice_id,
     'Balance applied to invoice ' || coalesce(v_inv.invoice_number, p_invoice_id::text), p_actor);

  if round(coalesce(v_remainder, 0) - v_draw, 2) = 0 then
    update public.invoices
       set status = 'paid', paid_at = now()
     where id = p_invoice_id
    returning * into v_inv;
    -- NO TRIP STAMP — see pay_invoice above; the draft reservation is the
    -- one linkage.
  else
    select * into v_inv from public.invoices where id = p_invoice_id;
  end if;

  return v_inv;
end;
$function$;

revoke execute on function public.apply_balance_to_invoice(uuid, text) from anon, public;
grant execute on function public.apply_balance_to_invoice(uuid, text) to authenticated, service_role;

drop function if exists public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text);

create function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_proof_path text default null,
  p_paid_on date default null,
  p_actor text default null,
  p_note text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inv       public.invoices;
  v_remainder numeric;
  v_method    text;
  v_reference text;
  v_proof     text;
begin
  v_method    := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  v_proof     := nullif(btrim(coalesce(p_proof_path, '')), '');

  if v_method is null or v_method not in ('cash', 'bank_transfer') then
    raise exception 'Invalid payment method: % (balance is applied via apply_balance_to_invoice).', p_method;
  end if;
  if v_method = 'bank_transfer' and v_proof is null then
    raise exception 'A bank transfer payment requires a proof-of-payment file.';
  end if;
  if v_method = 'bank_transfer' and v_reference is null then
    raise exception 'A bank transfer payment requires a payment reference.';
  end if;
  if v_method = 'bank_transfer' and p_paid_on is null then
    raise exception 'A bank transfer payment requires a payment date.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'confirmed' then
    raise exception 'Payments can only be recorded on a confirmed invoice (current status: %).', v_inv.status;
  end if;
  if v_inv.amount_payable_sar is null then
    raise exception 'This invoice has no frozen amount payable (issued before the ledger model) — settle it with the legacy flow.';
  end if;

  select s.remainder_sar into v_remainder
    from public.v_invoice_settlement s where s.invoice_id = p_invoice_id;

  if round(p_amount, 2) > coalesce(v_remainder, 0) then
    raise exception 'Payment of % SAR exceeds the invoice remainder of % SAR.',
      to_char(round(p_amount, 2), 'FM999,999,990.00'),
      to_char(coalesce(v_remainder, 0), 'FM999,999,990.00');
  end if;

  insert into public.invoice_payments
    (invoice_id, amount_sar, method, reference, proof_path, paid_on, note, created_by)
  values
    (p_invoice_id, round(p_amount, 2), v_method,
     v_reference, v_proof, p_paid_on,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor);

  if round(coalesce(v_remainder, 0) - round(p_amount, 2), 2) = 0 then
    update public.invoices
       set status = 'paid', paid_at = now()
     where id = p_invoice_id
    returning * into v_inv;
    -- NO TRIP STAMP — see pay_invoice above.
  end if;

  return v_inv;
end;
$function$;

revoke execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) from anon, public;
grant execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2b. NECESSARY ADDITION (stated as a deviation in the return): the two
--     project RPCs WRITE projects.payment_mode, and update_ also READS it for
--     its switch gate. plpgsql bodies are not dependency-tracked, so leaving
--     them would not block the column drop — it would break project create
--     and edit at RUNTIME. Both are re-emitted with the mode landing on
--     CUSTOMERS, the one authority; the app-side mirror write (0206 Group C)
--     becomes a harmless double-write of the same value. Signatures,
--     guards and everything else verbatim.
-- ----------------------------------------------------------------------------

drop function if exists public.create_project_with_customer(
  text, text, text, text, text, double precision, double precision, text,
  numeric, text, numeric, numeric, text, text, text, uuid[], text, text,
  text, text, text, text);

create function public.create_project_with_customer(
  p_cust_name text, p_cust_type text, p_contact_name text, p_phone text,
  p_delivery_address text, p_delivery_lat double precision, p_delivery_lng double precision,
  p_proj_name text, p_rate numeric, p_commission_mode text, p_commission_value numeric,
  p_commission_bump numeric, p_default_water_station text, p_water_type text,
  p_description text, p_driver_ids uuid[], p_payment_mode text, p_cust_email text,
  p_cust_name_ar text default null, p_cust_vat_number text default null,
  p_cust_cr_number text default null, p_cust_billing_address text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_cust_id uuid;
  v_proj_id uuid;
begin
  -- 1) Customer — CARRIES THE MODE (0206 Group C: customers.payment_mode is
  --    the one authority; the projects copy is dropped in this migration).
  insert into public.customers
    (name, name_ar, customer_type, contact_name, phone,
     delivery_site_address, delivery_lat, delivery_lng, email,
     vat_number, cr_number, billing_address, payment_mode)
  values
    (p_cust_name, p_cust_name_ar, p_cust_type, p_contact_name, p_phone,
     p_delivery_address, p_delivery_lat, p_delivery_lng, p_cust_email,
     p_cust_vat_number, p_cust_cr_number, p_cust_billing_address, p_payment_mode)
  returning id into v_cust_id;

  -- 2) Project linked to that customer. status falls to default 'active';
  --    default_station / location / location_lat / location_lng stay NULL.
  insert into public.projects
    (customer_id, name, rate_per_trip_sar, commission_mode,
     commission_value, commission_bump_pct, default_water_station,
     water_type, description)
  values
    (v_cust_id, p_proj_name, p_rate, p_commission_mode,
     p_commission_value, p_commission_bump, p_default_water_station,
     p_water_type, p_description)
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
$function$;

revoke execute on function public.create_project_with_customer(text, text, text, text, text, double precision, double precision, text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text, text, text, text, text) from anon, public;
grant execute on function public.create_project_with_customer(text, text, text, text, text, double precision, double precision, text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text, text, text, text, text) to authenticated, service_role;

drop function if exists public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision,
  text, numeric, text, text, text, uuid[], text, text, numeric, text, text,
  text, text);

create function public.update_project_with_customer(
  p_project_id uuid, p_cust_name text, p_cust_type text, p_contact_name text,
  p_phone text, p_delivery_address text, p_delivery_lat double precision,
  p_delivery_lng double precision, p_proj_name text, p_rate numeric,
  p_default_water_station text, p_water_type text, p_description text,
  p_driver_ids uuid[], p_payment_mode text, p_cust_email text,
  p_current_balance numeric default 0, p_cust_name_ar text default null,
  p_cust_vat_number text default null, p_cust_cr_number text default null,
  p_cust_billing_address text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_cust_id        uuid;
  v_current_mode   text;
  v_switch_blocked boolean;
  v_switch_reason  text;
begin
  -- The current mode is the CUSTOMER's (0206 Group C).
  select p.customer_id, c.payment_mode into v_cust_id, v_current_mode
    from public.projects p
    join public.customers c on c.id = p.customer_id
   where p.id = p_project_id;
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
         billing_address       = p_cust_billing_address,
         payment_mode          = p_payment_mode
   where id = v_cust_id;

  update public.projects
     set name                  = p_proj_name,
         rate_per_trip_sar     = p_rate,
         default_water_station = p_default_water_station,
         water_type            = p_water_type,
         description           = p_description
   where id = p_project_id;

  delete from public.project_drivers
   where project_id = p_project_id and driver_id <> all (p_driver_ids);
  insert into public.project_drivers (project_id, driver_id)
  select p_project_id, d from unnest(p_driver_ids) as d
  on conflict (project_id, driver_id) do nothing;

  return p_project_id;
end;
$function$;

revoke execute on function public.update_project_with_customer(uuid, text, text, text, text, text, double precision, double precision, text, numeric, text, text, text, uuid[], text, text, numeric, text, text, text, text) from anon, public;
grant execute on function public.update_project_with_customer(uuid, text, text, text, text, text, double precision, double precision, text, numeric, text, text, text, uuid[], text, text, numeric, text, text, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. THE DROPS, dependency-checked first, NO CASCADE anywhere. The 0206-era
--    receivables stack (v_invoice_outstanding_live, v_receivables_open,
--    v_receivables_aging, v_dashboard_action_items, v_active_alerts,
--    v_topups_monthly) SURVIVES — it reads only ledger sources now.
-- ----------------------------------------------------------------------------

do $deps$
declare
  v_dep text;
begin
  select string_agg(distinct dependent.relname, ', ')
    into v_dep
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class dependent on dependent.oid = r.ev_class
    join pg_class source on source.oid = d.refobjid
    join pg_namespace ns on ns.oid = source.relnamespace
   where d.classid = 'pg_rewrite'::regclass
     and ns.nspname = 'public'
     and dependent.relname <> source.relname
     and source.relname in ('v_customer_prepaid_balance', 'v_customer_amount_payable',
                            'customer_topups', 'customer_balance_returns')
     -- OUTSIDE dependents only. The four objects below depend on EACH OTHER
     -- (v_customer_amount_payable reads v_customer_prepaid_balance; both
     -- views read the two tables), so without this the check finds the drop
     -- set's own members and raises unconditionally — the migration could
     -- never commit. They all go in this transaction; what must block the
     -- drop is a dependent that SURVIVES it.
     and dependent.relname not in ('v_customer_prepaid_balance',
         'v_customer_amount_payable', 'customer_topups',
         'customer_balance_returns');
  if v_dep is not null then
    raise exception '0207: cannot drop the legacy prepaid objects — still depended on by: %', v_dep;
  end if;
end;
$deps$;

drop view public.v_customer_amount_payable;
drop view public.v_customer_prepaid_balance;

drop function public.return_customer_balance(uuid, text, text, text, date, text, text);

-- The dummy rows die with their tables (Turki's ruling). The two proof
-- Storage buckets are NOT touched here: topup-proofs also holds every LEDGER
-- proof photo, and balance-return-proofs' orphans go with the deploy wipe.
drop table public.customer_topups;
drop table public.customer_balance_returns;

-- The FIFO trip arrays — nothing reads them after step 2, nothing renders
-- them (see the header's kept-columns list), and confirm stopped writing
-- them in step 1.
alter table public.invoices
  drop column covered_trip_ids,
  drop column unpaid_trip_ids;

-- The mode's second copy. customers.payment_mode (NOT NULL since 0203) is
-- the one authority; every reader repointed in 0206 Group C, every writer
-- re-emitted above.
alter table public.projects drop column payment_mode;

-- ----------------------------------------------------------------------------
-- 4. report_metrics — the ledger-era prose, verbatim from the 0206 Group B
--    hand-off. scripts/metric-copy-check.ts re-anchors its byte-fidelity on
--    THIS block (its LEDGER_COPY_OVERRIDES table came out with that change),
--    so these literals must stay byte-identical to lib/i18n.ts's `en` side.
-- ----------------------------------------------------------------------------

update public.report_metrics set
  meaning = 'A prepaid customer''s ledger balance: money put on account minus what settlements and refunds have taken out. Not the spendable figure — that is Available.',
  formula = 'v_customer_ledger_balance.balance_sar: the sum of the customer''s customer_ledger rows — top-ups and corrections in; balance draws, applied balance and refunds out. Deducts at SETTLEMENT, not at delivery.',
  caveat  = 'Not a period measure and not app-computed: it is the ledger view''s own column, per customer, for the instant you are looking at. The spendable figure is Available — balance minus uninvoiced work minus confirmed unsettled invoices — which is always at or below this. Prepaid only — a postpaid customer has no ledger. Never place it in a period column or on a monthly trend line.'
where metric_key = 'paid_up_balance';

update public.report_metrics set
  formula = 'computeAmountPayable in app/trips/amountPayable.ts: zero minus the sum of consumingItems (lib/money.ts) over the delivered trips and non-void special charges that are not on a paid invoice, VAT-inclusive at the frozen trip rate. Negative means owed to us, zero means settled; <= 0 by construction.',
  caveat  = 'Only marking an invoice PAID reduces it — a deposit funds work rather than settling it, so nothing else moves this figure. Since the ledger cutover it renders for POSTPAID (and unset) customers only: a prepaid row shows no Amount Payable, because Available answers that question. Not a period measure and not a view.'
where metric_key = 'amount_payable';

update public.report_metrics set
  meaning = 'The money a prepaid customer holds on account: the sum of their ledger — deposits and corrections in, settlements and refunds out.',
  formula = 'v_customer_ledger_balance.balance_sar: the sum of the customer''s customer_ledger rows. Deducted at SETTLEMENT (a balance draw or a refund), not at delivery — delivered-but-unsettled work shows in Uninvoiced and is netted off in Available.',
  caveat  = 'Not a period measure and not app-computed: it is the ledger view''s own column, per customer, for the instant you are looking at. It is NOT the spendable figure — that is Available (balance minus uninvoiced work minus confirmed unsettled invoices). Since the ledger cutover the Running and Paid-up figures are ONE number, the ledger''s sum, kept as two entries only because both labels still appear on screens. Prepaid only — a postpaid customer has no ledger. Never place it in a period column or on a monthly trend line.'
where metric_key = 'running_balance';

-- ----------------------------------------------------------------------------
-- 5. Verification — the transaction refuses to commit on any failure.
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_name    text;
  v_n       int;
  v_def     text;
  v_checked int;
  v_bad     int;
begin
  -- 5a. Every dropped object is gone.
  foreach v_name in array array['v_customer_prepaid_balance', 'v_customer_amount_payable'] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception '0207 VERIFY: view % still exists.', v_name;
    end if;
  end loop;
  foreach v_name in array array['customer_topups', 'customer_balance_returns'] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception '0207 VERIFY: table % still exists.', v_name;
    end if;
  end loop;
  if to_regprocedure('public.return_customer_balance(uuid, text, text, text, date, text, text)') is not null then
    raise exception '0207 VERIFY: return_customer_balance still exists.';
  end if;
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name in ('covered_trip_ids', 'unpaid_trip_ids');
  if found then
    raise exception '0207 VERIFY: an invoices trip-id array column survived.';
  end if;
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'payment_mode';
  if found then
    raise exception '0207 VERIFY: projects.payment_mode survived.';
  end if;

  -- 5b. confirm_invoice: exactly one overload, 18 arguments, no anon, and no
  --     customer_ledger write hiding in it (confirm moves NO money — 0204).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice';
  if v_n <> 1 then
    raise exception '0207 VERIFY: expected 1 confirm_invoice, found %.', v_n;
  end if;
  select pronargs into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice';
  if v_n <> 18 then
    raise exception '0207 VERIFY: confirm_invoice has % arguments, expected 18.', v_n;
  end if;
  if has_function_privilege('anon',
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'confirm_invoice'), 'execute') then
    raise exception '0207 VERIFY: anon can execute confirm_invoice.';
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice';
  if v_def like '%customer_ledger%' then
    raise exception '0207 VERIFY: confirm_invoice references customer_ledger — confirm moves no money.';
  end if;

  -- 5c. The four re-emitted settlement/mode RPCs carry no trip-array or
  --     projects-mode reference.
  for v_name, v_def in
    select p.proname, pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('confirm_invoice', 'pay_invoice', 'apply_balance_to_invoice',
                         'record_invoice_payment', 'create_project_with_customer',
                         'update_project_with_customer')
  loop
    if v_def ~ '(covered_trip_ids|unpaid_trip_ids)' then
      raise exception '0207 VERIFY: % still references a trip-id array.', v_name;
    end if;
  end loop;

  -- 5d. A paid ledger-era invoice's trips are linked through the reservation.
  --     Measured on live rows where any exist: every trip line the frozen
  --     document lists must have its trip row reserved to the invoice.
  select count(*),
         count(*) filter (where not exists (
           select 1 from public.trips t
            where t.invoice_id = i.id and t.id = (e->>'id')::uuid))
    into v_checked, v_bad
    from public.invoices i
    cross join lateral jsonb_array_elements(coalesce(i.unpaid_lines, '[]'::jsonb)) e
   where i.status = 'paid' and i.amount_payable_sar is not null
     and e->>'kind' = 'trip';
  if v_checked = 0 then
    raise notice '0207 VERIFY: no paid ledger-era trip lines on this database — reservation linkage has nothing to measure here.';
  elsif v_bad > 0 then
    raise exception '0207 VERIFY: % of % paid ledger-era trip lines have no reserved trip row.', v_bad, v_checked;
  else
    raise notice '0207 VERIFY: reservation linkage holds for all % paid ledger-era trip line(s).', v_checked;
  end if;

  -- 5e. Every column the legacy document reads still exists — the header's
  --     list, checked name by name.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'invoices'
     and column_name in ('covered_lines', 'unpaid_lines', 'special_charges_snapshot',
                         'covered_subtotal_sar', 'covered_vat_sar', 'covered_total_sar',
                         'amount_due_subtotal_sar', 'amount_due_vat_sar', 'amount_due_sar',
                         'grand_subtotal_sar', 'grand_vat_sar', 'grand_total_sar',
                         'covered_ledger_subtotal_sar', 'unpaid_ledger_subtotal_sar',
                         'hide_amount_due');
  if v_n <> 15 then
    raise exception '0207 VERIFY: only % of the 15 legacy-document columns survive.', v_n;
  end if;
  select count(*) into v_n from public.invoices
   where amount_payable_sar is null and status in ('confirmed', 'paid', 'void');
  raise notice '0207 VERIFY: % legacy issued invoice(s) keep rendering from the frozen columns.', v_n;
end;
$verify$;

commit;
