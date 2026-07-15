-- 0034_invoice_number_yearly_drop_vat_ref.sql
-- Finance polish Batch C2 — new invoice-number format: YYY-NNNNNN
--   YYY    = last 3 digits of the CONFIRM year (extract(year from now()) —
--            same anchor the old vat_ref used, NOT the invoice period).
--   NNNNNN = 6-digit counter, PER YEAR, resets each year.
-- Customer-code prefix idea (considered during C2 recon) is DROPPED — plain
-- year+count, no customer/project identity in the invoice number.
--
-- Existing confirmed invoices are UNTOUCHED — invoice_number is a stored
-- column, frozen at confirm time, never recomputed at read time. Changing
-- generation for new rows cannot alter old rows' values. No backfill. Old
-- ('7') and new ('026-000001') numbers coexist forever in the same column —
-- both are plain text now, and every read site already renders it as
-- `#{invoice_number}` (InvoiceDetailModal.tsx, lib/invoicePdfTemplate.ts),
-- so '7' displays "#7" and '026-000001' displays "#026-000001". Deliberately
-- NOT special-cased per-format — a single, boring render path that already
-- existed needs zero new branching, and the leading zero unambiguously
-- signals "new scheme" without extra UI weight.
--
-- ALSO REMOVED HERE: vat_ref entirely (column + unique index + counter +
-- function + every app-code reference) — Bin Slimah's own human reference,
-- never a ZATCA requirement (see 0027 header), now redundant now that
-- invoice_number itself resets annually and carries a year, which was
-- vat_ref's only distinguishing feature. One number, not two.
--
-- COUNTER SHAPE: invoice_number_counter is DROPPED and RECREATED (old
-- shape was a global singleton row, id boolean; new shape is one row per
-- year, matching invoice_vat_ref_counter's now-dropped shape almost
-- exactly — same transactional-UPDATE discipline, not nextval(), so a
-- rolled-back confirm burns nothing. next_invoice_number() gains a
-- p_year argument (old no-arg overload dropped, not overloaded — every
-- caller is confirm_invoice(), a single call site, updated below in the
-- same migration).
--
-- ORDERING PRESERVED: confirm_invoice()'s undelivered-trip guard (0032)
-- still runs BEFORE the counter claim — a blocked confirm burns nothing.
-- Only one counter is claimed now (invoice_number), not two.

begin;

-- ============================================================================
-- 1. Drop the old vat_ref machinery entirely.
-- ============================================================================

drop index if exists public.invoices_vat_ref_unique;

alter table public.invoices
  drop column if exists vat_ref;

drop function if exists public.next_vat_ref_number(integer);
drop table if exists public.invoice_vat_ref_counter;

-- ============================================================================
-- 2. Drop the old global invoice_number_counter/next_invoice_number(), and
--    recreate both year-keyed — same shape/pattern invoice_vat_ref_counter
--    (0027) and trip_ref_counter (0033) already use.
-- ============================================================================

drop function if exists public.next_invoice_number();
drop table if exists public.invoice_number_counter;

create table public.invoice_number_counter (
  year        integer primary key,
  next_number integer not null default 1
);

alter table public.invoice_number_counter enable row level security;
drop policy if exists "authenticated_all_invoice_number_counter" on public.invoice_number_counter;
create policy "authenticated_all_invoice_number_counter"
  on public.invoice_number_counter for all to authenticated using (true) with check (true);

create or replace function public.next_invoice_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.invoice_number_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.invoice_number_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_invoice_number(integer) to authenticated;

-- ============================================================================
-- 3. invoices.invoice_number — integer -> text, lossless cast (7 -> '7').
--    The existing partial unique index (invoices_invoice_number_unique,
--    0025) is rebuilt automatically by ALTER COLUMN ... TYPE; no manual
--    drop/recreate needed, and its NULL-allowing semantics (draft invoices
--    have no number yet) are unchanged by the cast.
-- ============================================================================

alter table public.invoices
  alter column invoice_number type text using invoice_number::text;

-- ============================================================================
-- 4. confirm_invoice() — full body re-emitted (CREATE OR REPLACE requires
--    it). Only change from 0032: single counter claim (invoice_number,
--    year-keyed) instead of two (invoice_number + vat_ref); new format
--    string; v_vat_num/v_vat_ref locals removed. Undelivered-trip guard
--    position UNCHANGED (still first, before any counter claim).
-- ============================================================================
create or replace function public.confirm_invoice(
  p_invoice_id         uuid,
  p_seller_snapshot    jsonb,
  p_buyer_snapshot     jsonb,
  p_covered_lines      jsonb,
  p_unpaid_lines       jsonb,
  p_special_charges    jsonb,
  p_covered_trip_ids   uuid[],
  p_unpaid_trip_ids    uuid[],
  p_covered_subtotal   numeric,
  p_covered_vat        numeric,
  p_covered_total      numeric,
  p_due_subtotal       numeric,
  p_due_vat            numeric,
  p_due_total          numeric,
  p_grand_subtotal     numeric,
  p_grand_vat          numeric,
  p_grand_total        numeric
) returns public.invoices
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
begin
  -- Hard block (0032, unchanged): any trip whose trip_date falls within
  -- this invoice's period, for this invoice's customer's project, that
  -- isn't yet delivered blocks confirm entirely — BEFORE any counter claim,
  -- so a blocked confirm burns nothing.
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

  -- New format (0034): YYY-NNNNNN, NNNNNN gap-free WITHIN the year via
  -- next_invoice_number(year) (section 2 above). Year anchor is the CONFIRM
  -- year (now()), same anchor the old vat_ref used — not the invoice period.
  v_year   := extract(year from now())::integer;
  v_seq    := public.next_invoice_number(v_year);
  v_number := lpad((v_year % 1000)::text, 3, '0') || '-' || lpad(v_seq::text, 6, '0');

  update public.invoices
     set status                  = 'confirmed',
         invoice_number          = v_number,
         confirmed_at            = now(),
         seller_snapshot         = p_seller_snapshot,
         buyer_snapshot          = p_buyer_snapshot,
         covered_lines           = p_covered_lines,
         unpaid_lines            = p_unpaid_lines,
         special_charges_snapshot = p_special_charges,
         covered_trip_ids        = p_covered_trip_ids,
         unpaid_trip_ids         = p_unpaid_trip_ids,
         covered_subtotal_sar    = p_covered_subtotal,
         covered_vat_sar         = p_covered_vat,
         covered_total_sar       = p_covered_total,
         amount_due_subtotal_sar = p_due_subtotal,
         amount_due_vat_sar      = p_due_vat,
         amount_due_sar          = p_due_total,
         grand_subtotal_sar      = p_grand_subtotal,
         grand_vat_sar           = p_grand_vat,
         grand_total_sar         = p_grand_total
   where id = p_invoice_id
     and status = 'review'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in review status (or does not exist) — cannot confirm.';
  end if;

  return v_row;
end;
$$;

grant execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated;

commit;
