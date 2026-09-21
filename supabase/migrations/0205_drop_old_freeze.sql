-- 0205_drop_old_freeze.sql
-- Drop the pre-rebuild freeze: the per-invoice Balance/Remaining pair.
--
-- RULING (Turki): drop the old freeze entirely, keep nothing tangled. A
-- ledger-era invoice derives Balance and Remaining from the customer_ledger
-- rows that actually moved the money. No new stored columns.
--
-- WHAT THE FOUR COLUMNS HELD, and why nothing can reuse them. 0036 added them
-- as "what the pool looked like entering each table at confirm time": a FIFO
-- walk over the customer's whole lifetime, VAT-inclusive, frozen by
-- confirm_invoice. Three separate facts now make that meaningless:
--
--   * there is no pool. 0203 replaced the FIFO pool with an append-only
--     customer_ledger, so startingPool and the covered/unpaid walk are
--     expressions over a model that no longer exists;
--   * confirm is no longer a money moment. 0204 freezes amount_payable and
--     moves nothing, so "the pool at confirm time" describes an instant at
--     which, by law, nothing happens;
--   * there is no single moment to freeze. Money moves at Mark Paid, and can
--     move more than once — apply_balance_to_invoice is callable repeatedly
--     and cash arrives in instalments. A scalar pair cannot describe that.
--
-- They were never self-consistent either. On prod, invoice 026-000013 froze
-- covered_ledger_remaining 13,045.00 beside unpaid_ledger_balance 11,895.00,
-- and 026-000012 froze 49,000.00 beside 3,000.00 — two "balance" figures on
-- one document, because one is that invoice's covered remainder and the other
-- is the lifetime FIFO wall. Commit 994cdf4 retired the readers for exactly
-- that reason ("an invoice and a statement reported two different balances and
-- both looked authoritative") and the app has written literal NULLs into all
-- four ever since. 0 of 8 ledger-era invoices carry a value; the 10 that do
-- are all pre-0203, and no surface has rendered them since 994cdf4.
--
-- THE TWO SUBTOTAL COLUMNS STAY. covered_ledger_subtotal_sar and
-- unpaid_ledger_subtotal_sar are live: confirm still writes them and the
-- LEGACY document still reads them for its two trips-table feet
-- (app/trips/invoiceActions.ts, app/trips/InvoiceDetailModal.tsx). They are
-- truthfully named and describe a figure that still exists.
--
-- CONFIRM_INVOICE IS RE-EMITTED AT 21 ARGUMENTS, not 25. The four parameters
-- go with the columns; keeping them would leave four arguments that reach
-- nothing, in a signature every caller has to get positionally right. The
-- ONE-SIGNATURE RULE applies (aquafleet-domain): the exact 25-argument
-- function is DROPPED before the new one is created, so no call can ever be
-- ambiguous between them. p_actor survives unused, as it has since 0204 — it
-- is the audit actor for a ledger row this function does not write.
--
-- ORDER IS DELIBERATE: drop the function first, then the columns. The body
-- assigns to all four, so dropping the columns underneath a live function
-- would leave a function that only fails when someone confirms an invoice.
--
-- THE BODY IS 0204'S, VERBATIM, minus the four assignments: every guard (the
-- undelivered-trip count, the special-charge payload checks), the Tier A/B/C
-- totals assertions, the invoice-number claim and the freeze are unchanged.

begin;

-- =========================================================================
-- 1. The old signature goes first, while the columns it writes still exist.
-- =========================================================================

drop function if exists public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text);

-- =========================================================================
-- 2. The four columns. No CASCADE, deliberately: nothing should depend on
--    these, and if anything does, this migration must stop rather than take
--    it down quietly.
-- =========================================================================

alter table public.invoices
  drop column if exists covered_ledger_balance_sar,
  drop column if exists covered_ledger_remaining_sar,
  drop column if exists unpaid_ledger_balance_sar,
  drop column if exists unpaid_ledger_remaining_sar;

-- =========================================================================
-- 3. confirm_invoice at 21 arguments.
-- =========================================================================

create function public.confirm_invoice(
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
  p_unpaid_ledger_subtotal numeric default null,
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
         unpaid_ledger_subtotal_sar   = p_unpaid_ledger_subtotal,
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
  numeric, numeric, text, text) from anon, public;
grant execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, text, text) to authenticated, service_role;

-- =========================================================================
-- 4. VERIFICATION — raise on failure only.
-- =========================================================================

do $$
declare
  v_bad text;
begin
  -- The four columns are gone…
  select string_agg(column_name, ', ' order by column_name) into v_bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'invoices'
     and column_name in ('covered_ledger_balance_sar', 'covered_ledger_remaining_sar',
                         'unpaid_ledger_balance_sar', 'unpaid_ledger_remaining_sar');
  if v_bad is not null then
    raise exception '0205 verification: the old freeze columns still exist: %.', v_bad;
  end if;

  -- …and the two that are still read were NOT taken with them.
  select string_agg(c.name, ', ' order by c.name) into v_bad
    from (values ('covered_ledger_subtotal_sar'), ('unpaid_ledger_subtotal_sar')) as c(name)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = c.name);
  if v_bad is not null then
    raise exception '0205 verification: a subtotal column the legacy document reads was dropped: %.', v_bad;
  end if;

  -- EXACTLY ONE confirm_invoice, and it is the 21-argument one. Two would
  -- make every named-argument call ambiguous, which is the whole reason the
  -- old signature is dropped rather than replaced.
  if to_regprocedure('public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text)') is not null then
    raise exception '0205 verification: the old 25-argument confirm_invoice still exists.';
  end if;
  if to_regprocedure('public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text)') is null then
    raise exception '0205 verification: the 21-argument confirm_invoice is missing.';
  end if;
  select count(*)::text into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice';
  if v_bad <> '1' then
    raise exception '0205 verification: % confirm_invoice signatures exist, expected exactly 1.', v_bad;
  end if;

  -- Not executable by anon — direct grants AND grants to PUBLIC, which anon
  -- inherits. A fresh CREATE does not carry the old function's grants, so
  -- this proves the restated pair above actually landed.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0205 verification: confirm_invoice is executable by anon: %.', v_bad;
  end if;

  -- CONFIRM STILL MUST NOT MOVE MONEY (0204's ruling, re-asserted because
  -- this migration retypes the whole body). Reads the INSTALLED definition,
  -- so it cannot be satisfied by a body that only looks right in this file.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_invoice'
     and position('customer_ledger' in pg_get_functiondef(p.oid)) > 0;
  if v_bad is not null then
    raise exception '0205 verification: confirm_invoice references customer_ledger — confirm must not move money (%).', v_bad;
  end if;
end $$;

commit;
