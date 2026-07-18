-- 0037_invoice_payment_mode_snapshot.sql
-- Finance rebuild Step 3 follow-up — frozen payment-mode snapshot on invoices.
--
-- v3's invoice structure (§9) diverges by payment mode: prepaid renders the
-- three-table/ledger layout, postpaid keeps the old single-table v2 shape
-- (lib/invoice.ts, lib/invoicePdfTemplate.ts). Rendering a CONFIRMED/PAID/VOID
-- invoice (print/PDF/email) needs to know which shape to use — but nothing on
-- `invoices` recorded this before now; the only source was the customer's
-- CURRENT project.payment_mode, which is wrong once a customer has switched
-- modes (migration 0035 supports exactly that, after full settlement). An
-- old confirmed invoice must always render in the mode it was actually
-- confirmed under, not whatever the project's mode is today.
--
-- Purely additive: one nullable text column, no backfill (same precedent as
-- 0034/0036 — pre-existing confirmed rows have no way to recover this
-- retroactively with certainty; callers fall back to the customer's current
-- project.payment_mode for those, which is correct for every invoice that
-- predates any mode switch — the overwhelming majority).
--
-- confirm_invoice() re-emitted (CREATE OR REPLACE requires the full body,
-- copied verbatim from 0036) with one new trailing param, p_payment_mode,
-- persisted alongside the other frozen-at-confirm columns.

begin;

alter table public.invoices
  add column if not exists payment_mode text;

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
  p_grand_total        numeric,
  p_covered_ledger_subtotal  numeric default null,
  p_covered_ledger_balance   numeric default null,
  p_covered_ledger_remaining numeric default null,
  p_unpaid_ledger_subtotal   numeric default null,
  p_unpaid_ledger_balance    numeric default null,
  p_unpaid_ledger_remaining  numeric default null,
  p_payment_mode             text default null
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

  -- Format unchanged from 0034: YYY-NNNNNN, NNNNNN gap-free WITHIN the
  -- year via next_invoice_number(year). Year anchor is the CONFIRM year.
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
$$;

grant execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  text
) to authenticated;

commit;
