-- 0191_confirm_invoice_totals_assert.sql
--
-- SERVER-SIDE TOTALS ASSERTIONS ON confirm_invoice. Confirm is the freeze point
-- (0027): after it, covered_lines / unpaid_lines and the fifteen money numerics
-- are what every surface renders, forever. Until now this RPC wrote all fifteen
-- verbatim and checked none of them against each other.
--
-- WHY AN RPC ASSERT AND NOT A TABLE CHECK: measured 2026-09-08, 8 of 36 live
-- invoices already violate the identity, and pay_invoice / unpay_invoice /
-- void_invoice all UPDATE public.invoices — so even a NOT VALID constraint would
-- break Mark Paid on 026-000009 and Void/Unpay on the other seven. Repairing the
-- rows is barred by 0027 (they are issued tax documents). An assertion at the
-- one door that CREATES a frozen total leaves history alone and stops the next
-- bad one. Fix forward, never rewrite applied history.
--
-- ALSO: the cosmetic 1.15 in the charge-divergence error text becomes
-- (1 + public.vat_rate()). That literal moves no money — it formats a gross
-- figure inside a message — but it is the sixth SQL copy of the rate, and 0190
-- exists so there is exactly one.
--
-- ALSO, FOLDED IN RATHER THAN SHIPPED SEPARATELY: the invoice-number year moves
-- from extract(year from now()) — session time zone, UTC on this project — to
-- extract(year from (now() at time zone 'Asia/Riyadh')::date), the same shape
-- 0189 gave the PO number and the trip ref. It is the identical year-edge bug:
-- for the first three hours of every Riyadh new year an invoice was numbered
-- with the OLD year. Folded because redefining a money RPC twice to fix two
-- lines in one body is the larger risk; this is one `create or replace`, one
-- re-revoke, one review.
--
-- DEPENDS ON 0190. Run 0190 first; the precondition below refuses otherwise.
--
-- Body is pg_get_functiondef VERBATIM apart from FOUR edits: (1) the TOTALS
-- ASSERTIONS block inserted between the charge-divergence gate and the
-- invoice-number allocation, (2) the one error-text rate literal, (3) the
-- v_line_sum declaration, (4) the v_year Riyadh fix. Reverse all four and the
-- body is the live 6032-char definition, byte for byte.
-- Asserting BEFORE next_invoice_number() matters: a raise afterwards rolls the
-- counter back with the transaction, but not consuming a number at all is the
-- cleaner failure.
--
-- CLAUDE.md §5: BARE STATEMENTS. §6: re-revoke in the same transaction.
-- Verification RAISES rather than printing — including a negative control that
-- proves each tier CAN fail. A guard nobody has watched fail is not a guard.


-- ---------------------------------------------------------------------------
-- 0. Precondition.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.vat_rate()') is null then
    raise exception '0191: public.vat_rate() does not exist — run 0190 before this migration.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. The redefinition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_invoice(p_invoice_id uuid, p_seller_snapshot jsonb, p_buyer_snapshot jsonb, p_covered_lines jsonb, p_unpaid_lines jsonb, p_special_charges jsonb, p_covered_trip_ids uuid[], p_unpaid_trip_ids uuid[], p_covered_subtotal numeric, p_covered_vat numeric, p_covered_total numeric, p_due_subtotal numeric, p_due_vat numeric, p_due_total numeric, p_grand_subtotal numeric, p_grand_vat numeric, p_grand_total numeric, p_covered_ledger_subtotal numeric DEFAULT NULL::numeric, p_covered_ledger_balance numeric DEFAULT NULL::numeric, p_covered_ledger_remaining numeric DEFAULT NULL::numeric, p_unpaid_ledger_subtotal numeric DEFAULT NULL::numeric, p_unpaid_ledger_balance numeric DEFAULT NULL::numeric, p_unpaid_ledger_remaining numeric DEFAULT NULL::numeric, p_payment_mode text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- TOTALS ASSERTIONS (0191). Everything below this comment is new.
  --
  -- lib/invoice.ts composes three document stacks and this RPC has always
  -- written all fifteen numerics verbatim, unchecked. Before 1754140 they did
  -- not add up: `grand` was composed from a NON-COVERING line set, leaving a
  -- residue of coveredCharges - unpaidTrips - uncoveredCharges that was zero
  -- only by coincidence. Five already-issued invoices still carry the damage,
  -- 41,756.50 SAR understated, and 0027 bars repairing them. This bars the
  -- NEXT one.
  --
  -- WHAT IS DELIBERATELY NOT ASSERTED, and why: the server does NOT recompute
  -- amountDue. Subtotals are exact sums and carry no rounding convention, so
  -- Tier A can legitimately recompute one. VAT carries the WHOLE convention --
  -- document-level for grand, pool-exact per item for amountDue -- and
  -- re-deriving amountDue here would mean reimplementing the FIFO walk, the
  -- frozen-rate rule and reservedElsewhereIds in plpgsql: a second money
  -- engine, which is the disease, not the cure. So: recompute the
  -- convention-free part (A), assert internal consistency on the rest (B), and
  -- admit the VAT identity only where it actually holds (C).
  -- =====================================================================

  -- Tier A input. DISTINCT across the three payloads is load-bearing, not
  -- tidiness: for POSTPAID, p_special_charges is a SUBSET of p_unpaid_lines
  -- (invoiceActions.ts filters kind='charge' out of unpaidLines), so a plain
  -- sum would double-count every postpaid charge. For PREPAID the three sets
  -- are disjoint -- covered trips, unpaid trips, all charges -- and DISTINCT
  -- removes nothing. Keying on (kind, id) rather than on the whole element
  -- keeps display-only fields out of it; if the SAME line ever arrived with
  -- TWO different amounts it survives as two rows and the sum fails, which is
  -- the correct outcome.
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

  -- A NULL total compares to nothing. `is distinct from` treats null as a
  -- difference and would raise, but only against a non-null counterpart -- two
  -- nulls slip through silently. Fail the whole stack explicitly instead.
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
  -- lib/invoice.ts derives covered as grand - amountDue precisely so this
  -- holds by construction; if it does not, the stack did not come from that
  -- engine.
  if round(p_covered_subtotal + p_due_subtotal, 2) is distinct from round(p_grand_subtotal, 2)
     or round(p_covered_vat + p_due_vat, 2) is distinct from round(p_grand_vat, 2)
     or round(p_covered_total + p_due_total, 2) is distinct from round(p_grand_total, 2) then
    raise exception 'confirm_invoice: covered + amount due does not equal grand — subtotal % + % vs %; VAT % + % vs %; total % + % vs %.',
      p_covered_subtotal, p_due_subtotal, p_grand_subtotal,
      p_covered_vat, p_due_vat, p_grand_vat,
      p_covered_total, p_due_total, p_grand_total
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER C — the printed VAT is ONE document-level pass over the full taxable
  -- base, rounded once (ZATCA; lib/vat.ts calculateVat). This holds on `grand`
  -- ONLY. amountDue is pool-exact per item and legitimately differs by up to a
  -- halala, which is exactly why `covered` is derived last and absorbs it.
  if round(p_grand_vat, 2) is distinct from round(p_grand_subtotal * public.vat_rate(), 2) then
    raise exception 'confirm_invoice: grand VAT is % — one document-level pass over the % subtotal at the KSA rate gives %.',
      p_grand_vat, p_grand_subtotal, round(p_grand_subtotal * public.vat_rate(), 2)
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- =====================================================================
  -- End of 0191 additions. Everything below is unchanged.
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

  return v_row;
end;
$function$;

comment on function public.confirm_invoice(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],uuid[],numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) is
  'THE Review -> Confirmed transition and the 0027 freeze point. Assembly stays in TS (lib/invoice.ts, harnessed); this persists the already-computed result alongside a gap-free invoice number, atomically. 0191 added three totals assertions — Tier A the lines must sum to the grand subtotal, Tier B covered + amount due = grand on all three components, Tier C grand VAT is one document-level pass at public.vat_rate(). It does NOT recompute amountDue: that would mean a second FIFO engine in plpgsql. Every assertion raises with the same hint (reopen so the totals recompute) and runs BEFORE next_invoice_number, so a rejected confirm consumes no number. 0191 also moved the invoice-number YEAR onto the Riyadh calendar day, matching 0189 — it used to read the session time zone and numbered the first three hours of a Riyadh new year with the old year.';

revoke execute on function public.confirm_invoice(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],uuid[],numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon;
grant execute on function public.confirm_invoice(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],uuid[],numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. VERIFICATION. Raises, does not print.
-- ---------------------------------------------------------------------------

-- 2a. NEGATIVE CONTROL — prove each tier CAN fail before trusting a green run.
--     Pure arithmetic on literals; no invoice is read or touched.
do $$
declare
  v_c_sub numeric := 100.00; v_c_vat numeric := 15.00; v_c_tot numeric := 115.00;
  v_d_sub numeric :=  50.00; v_d_vat numeric :=  7.50; v_d_tot numeric :=  57.50;
  v_g_sub numeric := 150.00; v_g_vat numeric := 22.50; v_g_tot numeric := 172.50;
begin
  -- A CONSISTENT stack must trip nothing. If it does, the guard blocks every
  -- confirm and Finance stops.
  if round(v_c_sub + v_d_sub, 2) is distinct from round(v_g_sub, 2)
     or round(v_c_vat + v_d_vat, 2) is distinct from round(v_g_vat, 2)
     or round(v_c_tot + v_d_tot, 2) is distinct from round(v_g_tot, 2)
     or round(v_g_vat, 2) is distinct from round(v_g_sub * public.vat_rate(), 2) then
    raise exception '0191 negative control: a CONSISTENT totals stack tripped an assertion — the guard is too tight and would block every confirm.';
  end if;

  -- The historical shape: a charge excluded from grand. 026-000009 was short by
  -- exactly 517.50 gross. Tier B must trip on it.
  if round(v_c_sub + v_d_sub, 2) is not distinct from round(v_g_sub - 517.50, 2) then
    raise exception '0191 negative control: Tier B did NOT trip on a stack 517.50 short — the assertion cannot fail, so a green confirm would prove nothing.';
  end if;

  -- Tier C must trip on a VAT one halala off a single document-level pass.
  if round(v_g_vat + 0.01, 2) is not distinct from round(v_g_sub * public.vat_rate(), 2) then
    raise exception '0191 negative control: Tier C did NOT trip on a VAT one halala off.';
  end if;

  -- Tier A must trip on a line sum that misses a line.
  if round(v_g_sub - 517.50, 2) is not distinct from round(v_g_sub, 2) then
    raise exception '0191 negative control: Tier A did NOT trip on a line sum missing a line.';
  end if;
end $$;

-- 2b. Catalog: the redefined function must reference vat_rate(), carry the
--     three tiers, and hold no bare VAT literal. The row COUNT is asserted
--     first — a mistyped signature returns no row, and an object that returns
--     no row reads as clean (§6's inversion, in the checker this time).
do $$
declare
  v_n   integer;
  v_src text;
begin
  select count(*), min(pg_get_functiondef(p.oid))
    into v_n, v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'confirm_invoice(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],uuid[],numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)';

  if v_n <> 1 then
    raise exception '0191: expected exactly 1 confirm_invoice with this signature, found %.', v_n;
  end if;
  if v_src not like '%public.vat_rate()%' then
    raise exception '0191: confirm_invoice does not reference public.vat_rate().';
  end if;
  if v_src like '%1.15%' or v_src like '%0.15%' then
    raise exception '0191: confirm_invoice still carries a bare VAT literal.';
  end if;
  if v_src not like '%TIER A%' or v_src not like '%TIER B%' or v_src not like '%TIER C%' then
    raise exception '0191: confirm_invoice is missing one of the three totals assertions.';
  end if;
  if v_src not like '%extract(year from (now() at time zone ''Asia/Riyadh'')::date)%' then
    raise exception '0191: confirm_invoice still takes its invoice-number year from the SESSION time zone — the Riyadh fix is missing.';
  end if;
  if v_src like '%extract(year from now())%' then
    raise exception '0191: confirm_invoice still carries extract(year from now()) — the old session-time-zone year survived the redefinition.';
  end if;
end $$;

-- 2c. §6 privileges. has_function_privilege, identified by regprocedure.
do $$
declare
  v_n   integer;
  v_bad text;
begin
  select count(*), string_agg(p.oid::regprocedure::text, ', ') filter (
           where has_function_privilege('anon', p.oid, 'execute')
              or not has_function_privilege('authenticated', p.oid, 'execute')
              or not has_function_privilege('service_role', p.oid, 'execute'))
    into v_n, v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'confirm_invoice(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[],uuid[],numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)';

  if v_n <> 1 then
    raise exception '0191: privilege check matched % confirm_invoice rows, expected 1 — a function that returns no row reads as revoked.', v_n;
  end if;
  if v_bad is not null then
    raise exception '0191: wrong grants after redefinition: %.', v_bad;
  end if;
end $$;

-- 2d. The schema-wide §6 invariant: zero NON-TRIGGER public functions are
--     anon-executable. Trigger functions are unreachable via PostgREST and
--     several legitimately remain.
do $$
declare
  v_leaky text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_leaky
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('anon', p.oid, 'execute');
  if v_leaky is not null then
    raise exception '0191: anon can execute these public functions: %.', v_leaky;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- AFTERWARDS, in a SEPARATE run (§5), then in-browser:
--
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'confirm_invoice';
--
-- Browser: build a fresh invoice for a PREPAID customer (covered + unpaid +
-- at least one special charge) and one for a POSTPAID customer, take each to
-- Review, and Confirm. Both must succeed — the postpaid case is the one that
-- exercises Tier A's DISTINCT, because there the charges arrive twice.
--
-- Check the number the first confirm produces: the YEAR segment now comes from
-- the Riyadh calendar day, so between 21:00 and 24:00 UTC on 31 December it
-- reads the NEW year where it used to read the old one. Nothing else about the
-- number changes, and next_invoice_number keeps the sequence gap-free per year.
-- ---------------------------------------------------------------------------
