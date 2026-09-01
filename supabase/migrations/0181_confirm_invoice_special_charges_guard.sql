-- 0181_confirm_invoice_special_charges_guard.sql
--
-- MONEY BUG: a confirmed invoice could freeze with NO special charges while the
-- customer's prepaid balance was still consumed by those same charges.
--
-- Two sources of truth for one amount of money:
--   * v_customer_prepaid_balance.charge_consumption_sar =
--       sum(round(sc.amount_sar * 1.15, 2)) over invoice_special_charges
--       joined to every NON-VOID invoice — NO date filter of any kind.
--   * confirm_invoice is a scribe: it wrote special_charges_snapshot =
--       p_special_charges and grand_*_sar straight from client params and never
--       read invoice_special_charges at all.
-- So whenever the client's charge list disagreed with the table, the invoice
-- froze understated and nothing noticed.
--
-- Live proof (measured, not remembered): invoice 026-000015, Al Futam Trading
-- Co., prepaid, period 2026-09-01..2026-09-01, two "Water Meter Reader" charges
-- at 1,100.00 dated 2026-08-31 and 2026-08-30. snapshot_len = 0,
-- grand_total_sar = 540.50, balance consumed = 2 * round(1100 * 1.15, 2) =
-- 2,530.00 SAR against an invoice that showed no charges.
--
-- The client-side cause is lib/invoice.ts period-filtering charges by
-- charge_date; that is fixed in the same unit of work. THIS migration is the
-- net that makes the divergence impossible to persist again.
--
-- WHY AUDIT AND NOT RECOMPUTE. The brief asked the server to fold charge gross
-- into the grand totals. For prepaid it cannot, without breaking the money-core
-- boundary: whether a charge lands in Grand Total (covered) or Amount Due
-- (uncovered) is decided by the FIFO pool walk in lib/prepaid.ts over the
-- customer's FULL history, and the per-line `covered` boolean the UI renders
-- exists nowhere in the database. Reimplementing that walk in plpgsql would
-- create the third expression of money math this project forbids. So the
-- function becomes an AUDITOR instead: it derives the authoritative charge set
-- from invoice_special_charges — the SAME rows v_customer_prepaid_balance
-- counts — and RAISES unless the payload matches it exactly. Once the guard
-- passes, the payload is a proven faithful image of the table, so writing
-- p_special_charges IS writing table-derived data; it just also carries the
-- quantity / price / image / covered fields the snapshot needs.
--
-- COMPARE THE BASE amount_sar, NOT THE GROSS. Both sides then use identical
-- Postgres numeric arithmetic on identical 2dp inputs. Comparing gross would
-- mean checking JS round2(x * 1.15) against PG round(x * 1.15, 2), which
-- diverge on exact-half halalas (10.10 -> 11.61 in float64, 11.62 in numeric)
-- and would reject correct invoices. amount_sar is numeric(12,2) in the table
-- and travels through the payload untouched, so equality there is exact.
--
-- The guard runs BEFORE next_invoice_number() is claimed, so a rejected confirm
-- never burns an invoice number.
--
-- No-charge case is unchanged: both sides empty, the full outer join yields no
-- rows, nothing raises. Trip totalling, VAT rounding and the freeze law of 0027
-- are all untouched.
--
-- Signature is IDENTICAL to the live 24-arg identity — no call site changes.
-- CLAUDE.md 6: create or replace resets the ACL to EXECUTE TO PUBLIC, so the
-- re-revoke at the foot is mandatory, on BOTH public and anon.
--
-- THE FOOT MUST RE-GRANT AS WELL AS RE-REVOKE. The drop+create also WIPES the
-- explicit authenticated/service_role grants — the live proacl carries NO
-- PUBLIC entry, those two are explicit grants, not inherited. Revoking alone
-- leaves the function owner-only and the app loses confirm entirely. The grant
-- on the last line is NOT a leak; deleting it breaks invoicing. End-state ACL
-- must equal the pre-migration ACL exactly:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Read it back with has_function_privilege on all three roles plus anon —
-- never by proacl pattern-matching (6), and identify the function by
-- oid::regprocedure, never pg_get_function_identity_arguments().

drop function if exists public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text);

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
  p_covered_ledger_subtotal numeric default null::numeric,
  p_covered_ledger_balance numeric default null::numeric,
  p_covered_ledger_remaining numeric default null::numeric,
  p_unpaid_ledger_subtotal numeric default null::numeric,
  p_unpaid_ledger_balance numeric default null::numeric,
  p_unpaid_ledger_remaining numeric default null::numeric,
  p_payment_mode text default null::text
)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
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

  -- ---- SPECIAL-CHARGE AUDIT (see header) --------------------------------
  -- invoice_special_charges is the same source v_customer_prepaid_balance
  -- consumes from. If the payload does not match it exactly, the invoice would
  -- freeze divergent from the balance — reject instead.

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
                   || round(s.amount_sar * 1.15, 2)::text || ' gross SAR)'
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
  -- ---- end audit ---------------------------------------------------------

  v_year   := extract(year from now())::integer;
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

revoke execute on function public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon;

grant execute on function public.confirm_invoice(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
