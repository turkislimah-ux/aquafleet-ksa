-- Batch 2 (finance-invoice-spec.md v3, statement rebuild) — postpaid Mark-Paid
-- gains payment_reference / payment_date / payment_note. These feed the
-- statement's payment rows (Batch 3) — not used by prepaid ("Pay with
-- Balance", Batch 1, has no cash/ref/proof; the engine already deducted at
-- delivery). Nullable, no backfill — existing paid invoices predate them.
--
-- payment_date is USER-ENTERED (when the payment actually happened) —
-- deliberately separate from paid_at (server-set, now(), when the row was
-- recorded in the app). Same "recorded vs. actual" split as customer_topups'
-- topup_date vs created_at.
--
-- See section 2/3 below for the pay_invoice()/unpay_invoice() signature notes.

begin;

-- ---------------------------------------------------------------------------
-- 1. invoices — three new nullable payment columns (postpaid only in
--    practice; prepaid's pay_invoice() call never sets them).
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists payment_reference text,
  add column if not exists payment_date      date,
  add column if not exists payment_note      text;

-- ---------------------------------------------------------------------------
-- 2. pay_invoice() — drop the old 3-arg signature, recreate with the three
--    new trailing params. Validation (proposed, Turki to confirm/adjust):
--      - bank_transfer: reference AND date REQUIRED (a real bank transaction
--        exists to reference/date) — same spirit as the existing proof-file
--        requirement for bank_transfer.
--      - cash: reference/date OPTIONAL (no transaction to point to; Turki
--        may still jot one down, e.g. a receipt number).
--      - note: ALWAYS optional, both methods.
--    Blank-vs-null handling is done TS-side (markInvoicePaid trims and sends
--    null for empty, same convention as recordTopup in lib/actions/finance.ts)
--    — this function only checks IS NULL, doesn't re-trim.
-- ---------------------------------------------------------------------------
drop function if exists public.pay_invoice(uuid, text, text);

create or replace function public.pay_invoice(
  p_invoice_id        uuid,
  p_payment_method    text,
  p_proof_path        text,
  p_payment_reference text,
  p_payment_date      date,
  p_payment_note      text
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invoices;
begin
  if p_payment_method not in ('cash', 'bank_transfer') then
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

  -- Lock every trip in both tables — covered AND unpaid (unchanged from
  -- 0027 — see that migration's comment for why unpaid trips lock too).
  update public.trips
     set invoice_id = p_invoice_id
   where id = any(coalesce(v_row.covered_trip_ids, array[]::uuid[])
             || coalesce(v_row.unpaid_trip_ids, array[]::uuid[]));

  return v_row;
end;
$$;

grant execute on function public.pay_invoice(uuid, text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. unpay_invoice() — same 3-arg signature (no overload risk), just clears
--    the three new fields alongside the existing payment fields it already
--    nulls on revert.
-- ---------------------------------------------------------------------------
create or replace function public.unpay_invoice(
  p_invoice_id uuid,
  p_reason     text,
  p_by         text
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invoices;
begin
  update public.invoices
     set status                = 'confirmed',
         paid_at               = null,
         payment_method        = null,
         proof_of_payment_path = null,
         payment_reference     = null,
         payment_date          = null,
         payment_note          = null,
         unpaid_at             = now(),
         unpaid_reason         = p_reason,
         unpaid_by             = p_by
   where id = p_invoice_id
     and status = 'paid'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in paid status (or does not exist) — cannot un-pay.';
  end if;

  -- NO trip release here (unchanged from 0030) — trips stay reserved to this
  -- invoice; only void/delete release. See 0030's header.

  return v_row;
end;
$$;

grant execute on function public.unpay_invoice(uuid, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'pay_invoice';
--   -- must return exactly ONE row: pay_invoice(uuid, text, text, text, date, text)
--
--   select oid::regprocedure from pg_proc where proname = 'unpay_invoice';
--   -- must return exactly ONE row: unpay_invoice(uuid, text, text) — unchanged
-- ---------------------------------------------------------------------------
