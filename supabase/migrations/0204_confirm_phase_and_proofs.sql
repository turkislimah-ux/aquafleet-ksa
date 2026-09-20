-- 0204_confirm_phase_and_proofs.sql
-- PREPAID REBUILD — STEP 3. DB ONLY; the app batch follows separately.
--
-- RULING (Turki): CONFIRM MUST NOT MOVE MONEY.
-- 0203 drew min(Available, grand_total) inside confirm_invoice. That made
-- confirming an invoice a payment, and a prepaid invoice could land on 'paid'
-- without anyone recording a settlement. From here, confirm only FREEZES:
-- prepaid_applied_sar = 0 and amount_payable_sar = grand_total, status stays
-- 'confirmed'. Money moves through apply_balance_to_invoice and
-- record_invoice_payment only; both already flip status to 'paid' when the
-- remainder reaches 0.
--
-- The balance still has to be reserved against confirmed debt, or a customer
-- could be refunded money he owes on an invoice already issued. That
-- reservation moves OUT of the ledger and INTO the Available view:
--   Available = Balance − Uninvoiced − unsettled remainder of ledger-era
--               confirmed invoices.
-- Continuity at confirm: the invoice's value leaves Uninvoiced and enters the
-- confirmed-remainder term in the same instant, so Available does not jump
-- (up to the halala drift between per-item and document-level rounding).
--
-- Pre-0203 confirmed invoices are EXCLUDED from that term: amount_payable_sar
-- is null on them and their money is already inside the seeded opening
-- balance. Counting them would deduct the same debt twice.
--
-- apply_balance_to_invoice changes by exactly one line, forced by the view
-- above: Available now reserves the invoice being settled, so that invoice's
-- own remainder is added back before the draw. Its behaviour is otherwise
-- untouched.
--
-- DRAFTED TO DISK ONLY — architect reviews, Turki applies in the SQL Editor.
-- NOT touched here: void_invoice, unpay_invoice, customer_ledger, and every
-- legacy prepaid object.

begin;

-- =========================================================================
-- 1. confirm_invoice — the draw is gone. Signature, guards, assertions and
--    freezes are otherwise verbatim from 0203, so this is a REPLACE, not a
--    drop-and-create: the identity argument list is unchanged and the
--    ONE-signature rule is not at risk.
--    p_actor survives unused. It is the audit actor for a ledger row this
--    function no longer writes, and dropping it would change the signature,
--    churn the app contract and the grants for nothing.
-- =========================================================================

create or replace function public.confirm_invoice(
  p_invoice_id uuid,
  p_seller_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_covered_lines jsonb,
  p_unpaid_lines jsonb,
  p_special_charges jsonb,
  p_covered_trip_ids uuid[],
  p_unpaid_trip_ids uuid[],
  p_covered_subtotal numeric,
  p_covered_vat numeric,
  p_covered_total numeric,
  p_due_subtotal numeric,
  p_due_vat numeric,
  p_due_total numeric,
  p_grand_subtotal numeric,
  p_grand_vat numeric,
  p_grand_total numeric,
  p_covered_ledger_subtotal numeric default null,
  p_covered_ledger_balance numeric default null,
  p_covered_ledger_remaining numeric default null,
  p_unpaid_ledger_subtotal numeric default null,
  p_unpaid_ledger_balance numeric default null,
  p_unpaid_ledger_remaining numeric default null,
  p_payment_mode text default null,
  p_actor text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
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
  -- TOTALS ASSERTIONS (0191) — kept verbatim.
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
                          case when jsonb_typeof(p_covered_lines) = 'array'
                               then p_covered_lines else '[]'::jsonb end) e
          union all
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

  -- =====================================================================
  -- End of 0191 assertions.
  -- =====================================================================

  v_year   := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq    := public.next_invoice_number(v_year);
  v_number := lpad((v_year % 1000)::text, 3, '0') || '-' || lpad(v_seq::text, 6, '0');

  update public.invoices
     set status                    = 'confirmed',
         invoice_number            = v_number,
         confirmed_at              = now(),
         seller_snapshot           = p_seller_snapshot,
         buyer_snapshot            = p_buyer_snapshot,
         covered_lines             = p_covered_lines,
         unpaid_lines              = p_unpaid_lines,
         special_charges_snapshot  = p_special_charges,
         covered_trip_ids          = p_covered_trip_ids,
         unpaid_trip_ids           = p_unpaid_trip_ids,
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
         covered_ledger_balance_sar   = p_covered_ledger_balance,
         covered_ledger_remaining_sar = p_covered_ledger_remaining,
         unpaid_ledger_subtotal_sar   = p_unpaid_ledger_subtotal,
         unpaid_ledger_balance_sar    = p_unpaid_ledger_balance,
         unpaid_ledger_remaining_sar  = p_unpaid_ledger_remaining,
         payment_mode                 = p_payment_mode
   where id = p_invoice_id
     and status = 'review'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in review status (or does not exist) — cannot confirm.';
  end if;

  -- =====================================================================
  -- THE FREEZE — and nothing else. Identical for prepaid and postpaid:
  -- the whole document is payable, none of it has been settled yet, and
  -- the status stays 'confirmed'. Settlement is a separate, deliberate act.
  -- Writing amount_payable_sar here (never NULL) is also what keeps
  -- invoiceEra() reading this invoice as ledger-era forever.
  -- =====================================================================

  update public.invoices
     set prepaid_applied_sar = 0,
         amount_payable_sar  = round(v_row.grand_total_sar, 2)
   where id = p_invoice_id;

  select * into v_row from public.invoices where id = p_invoice_id;
  return v_row;
end;
$$;

revoke execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text) from anon, public;
grant execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated, service_role;

-- =========================================================================
-- 2. v_customer_available — reserve confirmed, unsettled ledger-era debt.
--    42P16: the first five columns keep their name, type and order; only
--    available_sar's EXPRESSION changes and the new term is APPENDED.
--    'confirmed' only — 'paid' has no remainder, 'void' is not owed, and
--    draft/review are already counted inside Uninvoiced.
--    payable_sar not null excludes pre-0203 invoices, whose money is in the
--    seeded opening balance. remainder_sar is already net of payments,
--    applied balance and an active write-off (0203 §7).
-- =========================================================================

create or replace view public.v_customer_available as
select b.customer_id,
       b.customer_name,
       b.balance_sar,
       u.uninvoiced_sar,
       round(b.balance_sar - u.uninvoiced_sar - c.confirmed_unsettled_sar, 2) as available_sar,
       c.confirmed_unsettled_sar
  from public.v_customer_ledger_balance b
  join public.v_customer_uninvoiced u on u.customer_id = b.customer_id
 cross join lateral (
   select coalesce(round(sum(s.remainder_sar), 2), 0) as confirmed_unsettled_sar
     from public.v_invoice_settlement s
    where s.customer_id = b.customer_id
      and s.status = 'confirmed'
      and s.payable_sar is not null
      and s.remainder_sar > 0
 ) c;

alter view public.v_customer_available set (security_invoker = true);
revoke all on public.v_customer_available from anon;
grant select on public.v_customer_available to authenticated;

-- =========================================================================
-- 3. apply_balance_to_invoice — ONE line changes: the invoice being settled
--    must not be counted against itself. Signature, guards, draw, status
--    flip and trip release are otherwise verbatim from 0203, so this is a
--    REPLACE.
-- =========================================================================

create or replace function public.apply_balance_to_invoice(
  p_invoice_id uuid,
  p_actor      text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
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

  -- 0204: Available now reserves the unsettled remainder of EVERY confirmed
  -- ledger-era invoice — including this one. Add this invoice's own
  -- remainder back before the draw, or the invoice being settled is counted
  -- against itself: a customer whose confirmed debt exceeds his balance
  -- would be refused the balance he actually has (Balance 300 against a
  -- 400 remainder reads as Available -100, and nothing could ever be
  -- applied). The least() below still caps the draw at that remainder.
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

    update public.trips
       set invoice_id = p_invoice_id
     where id = any(coalesce(v_inv.covered_trip_ids, array[]::uuid[])
               || coalesce(v_inv.unpaid_trip_ids, array[]::uuid[]));
  else
    select * into v_inv from public.invoices where id = p_invoice_id;
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.apply_balance_to_invoice(uuid, text) from anon, public;
grant execute on function public.apply_balance_to_invoice(uuid, text) to authenticated, service_role;

-- =========================================================================
-- 4. record_refund — gains p_photo_path. Bank transfer needs a photo AND a
--    reference; cash needs neither (both still recorded when given).
--    The 6-argument signature is DROPPED, not left beside this one: the app
--    calls by NAME, and two candidates where one has a defaulted extra
--    argument is an ambiguity, not an overload.
--    Argument order mirrors record_topup exactly.
-- =========================================================================

drop function if exists public.record_refund(uuid, numeric, text, text, text, text);

create function public.record_refund(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text default null,
  p_photo_path  text default null,
  p_actor       text default null,
  p_note        text default null
)
returns public.customer_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year      integer;
  v_seq       integer;
  v_doc       text;
  v_method    text;
  v_reference text;
  v_photo     text;
  v_available numeric;
  v_row       public.customer_ledger;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;

  v_method    := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  v_photo     := nullif(btrim(coalesce(p_photo_path, '')), '');

  if v_method is null then
    raise exception 'Refund method is required.';
  end if;
  if v_method not in ('cash', 'bank_transfer') then
    raise exception 'Invalid refund method: % (expected cash or bank_transfer).', p_method;
  end if;
  if v_method = 'bank_transfer' and v_photo is null and v_reference is null then
    raise exception 'A bank transfer refund requires a photo of the transfer AND a transfer reference — both are missing.';
  end if;
  if v_method = 'bank_transfer' and v_photo is null then
    raise exception 'A bank transfer refund requires a photo of the transfer.';
  end if;
  if v_method = 'bank_transfer' and v_reference is null then
    raise exception 'A bank transfer refund requires a transfer reference.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select a.available_sar into v_available
    from public.v_customer_available a
   where a.customer_id = p_customer_id;

  if round(p_amount, 2) > coalesce(v_available, 0) then
    raise exception 'Refund of % SAR exceeds the customer''s Available balance of % SAR (Balance minus Uninvoiced minus unsettled confirmed invoices).',
      to_char(round(p_amount, 2), 'FM999,999,990.00'),
      to_char(coalesce(v_available, 0), 'FM999,999,990.00');
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq  := public.next_credit_note_number(v_year);
  v_doc  := 'CN-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, doc_number, method, reference, photo_path, note, created_by)
  values
    (p_customer_id, 'refund', -round(p_amount, 2), v_doc, v_method,
     v_reference, v_photo,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_refund(uuid, numeric, text, text, text, text, text) from anon, public;
grant execute on function public.record_refund(uuid, numeric, text, text, text, text, text) to authenticated, service_role;

-- =========================================================================
-- 5. record_topup — same proof rule, enforced in the RPC rather than only in
--    the form. Signature unchanged.
-- =========================================================================

create or replace function public.record_topup(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text default null,
  p_photo_path  text default null,
  p_actor       text default null,
  p_note        text default null
)
returns public.customer_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year      integer;
  v_seq       integer;
  v_doc       text;
  v_method    text;
  v_reference text;
  v_photo     text;
  v_row       public.customer_ledger;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Top-up amount must be greater than zero.';
  end if;

  v_method    := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  v_photo     := nullif(btrim(coalesce(p_photo_path, '')), '');

  if v_method is null then
    raise exception 'Top-up method is required.';
  end if;
  if v_method not in ('cash', 'bank_transfer') then
    raise exception 'Invalid top-up method: % (expected cash or bank_transfer).', p_method;
  end if;
  if v_method = 'bank_transfer' and v_photo is null and v_reference is null then
    raise exception 'A bank transfer top-up requires a photo of the transfer AND a transfer reference — both are missing.';
  end if;
  if v_method = 'bank_transfer' and v_photo is null then
    raise exception 'A bank transfer top-up requires a photo of the transfer.';
  end if;
  if v_method = 'bank_transfer' and v_reference is null then
    raise exception 'A bank transfer top-up requires a transfer reference.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  -- Customer row is the ledger mutex.
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq  := public.next_topup_receipt_number(v_year);
  v_doc  := 'RCT-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, doc_number, method, reference, photo_path, note, created_by)
  values
    (p_customer_id, 'topup', round(p_amount, 2), v_doc, v_method,
     v_reference, v_photo,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_topup(uuid, numeric, text, text, text, text, text) from anon, public;
grant execute on function public.record_topup(uuid, numeric, text, text, text, text, text) to authenticated, service_role;

-- =========================================================================
-- 6. record_invoice_payment — 0203 already required proof, reference and
--    date for a bank transfer, but tested them with `is null`, so a single
--    space satisfied the rule. Same signature, same guards, trimmed inputs.
--    The payment date stays required for a transfer: it is what reconciles
--    the row against the bank statement.
-- =========================================================================

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_method     text,
  p_reference  text default null,
  p_proof_path text default null,
  p_paid_on    date default null,
  p_actor      text default null,
  p_note       text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
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

    update public.trips
       set invoice_id = p_invoice_id
     where id = any(coalesce(v_inv.covered_trip_ids, array[]::uuid[])
               || coalesce(v_inv.unpaid_trip_ids, array[]::uuid[]));
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) from anon, public;
grant execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) to authenticated, service_role;

-- =========================================================================
-- 7. VERIFICATION — raise on failure only.
-- =========================================================================

do $$
declare
  v_bad text;
begin
  -- The replaced view keeps its security footer and stays closed to anon.
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and c.relname = 'v_customer_available'
       and (c.reloptions @> array['security_invoker=true'])
       and not has_table_privilege('anon', c.oid, 'select')
  ) then
    raise exception '0204 verification: v_customer_available is missing its security footer.';
  end if;

  -- The appended column exists (and the first five were not disturbed —
  -- 42P16 would have refused the REPLACE otherwise).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_customer_available'
       and column_name = 'confirmed_unsettled_sar' and ordinal_position = 6
  ) then
    raise exception '0204 verification: confirmed_unsettled_sar is not column 6 of v_customer_available.';
  end if;

  -- The 6-argument record_refund is gone; only the 7-argument one remains.
  if to_regprocedure('public.record_refund(uuid, numeric, text, text, text, text)') is not null then
    raise exception '0204 verification: the old 6-argument record_refund still exists — named-argument calls would be ambiguous.';
  end if;
  if to_regprocedure('public.record_refund(uuid, numeric, text, text, text, text, text)') is null then
    raise exception '0204 verification: the 7-argument record_refund is missing.';
  end if;

  -- Nothing recreated here may be executable by anon (direct grants AND
  -- grants to PUBLIC, which anon inherits).
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('confirm_invoice', 'apply_balance_to_invoice', 'record_refund',
                       'record_topup', 'record_invoice_payment')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0204 verification: function(s) executable by anon: %.', v_bad;
  end if;

  -- CONFIRM MUST NOT MOVE MONEY. This reads the installed function body, so
  -- it proves the ledger is not written from confirm_invoice by any path,
  -- including one added later by mistake. It is a source assertion, not a
  -- behavioural one: it cannot prove the rest of the function still freezes
  -- correctly, which is what the app-side test:db suite is for.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'confirm_invoice'
     and position('customer_ledger' in pg_get_functiondef(p.oid)) > 0;
  if v_bad is not null then
    raise exception '0204 verification: confirm_invoice still references customer_ledger — confirm must not move money (%).', v_bad;
  end if;

  -- And no invoice may be left on 'paid' by a confirm that drew nothing:
  -- a ledger-era paid invoice must have a settlement behind it.
  select string_agg(i.invoice_number, ', ') into v_bad
    from public.invoices i
   where i.status = 'paid'
     and i.amount_payable_sar is not null
     and i.amount_payable_sar > 0
     and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id)
     and not exists (select 1 from public.customer_ledger l
                      where l.invoice_id = i.id and l.entry_type in ('invoice_draw', 'balance_applied'));
  if v_bad is not null then
    raise exception '0204 verification: invoice(s) marked paid with no settlement behind them: %.', v_bad;
  end if;
end $$;

commit;
