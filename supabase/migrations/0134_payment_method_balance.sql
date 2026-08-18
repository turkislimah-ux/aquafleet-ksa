-- 0134 — payment_method gains 'balance', for prepaid credit settlements.
--
-- APPLIED. THIS FILE HAS BEEN RECONCILED TO WHAT ACTUALLY RAN, and the
-- reconciliation is the reason to read the next paragraph before "fixing" it
-- back. The drafted guard resolved the customer's project mode with a plain
-- scalar subquery; the applied guard wraps it in a single-mode aggregate
-- (count(distinct …) = 1) that returns NULL rather than an arbitrary row when a
-- customer somehow has projects in two different modes. The body below is the
-- APPLIED one, verified against pg_get_functiondef. Same precedent as
-- 0099/0100/0101 (files rewritten to match live) and 0038/0090/0109 (a
-- correction is recorded, not squashed).
--
-- WHY THIS MIGRATION EXISTS AT ALL. The request that produced it said
-- "no migration needed — invoices.payment_method is free text". It is NOT free
-- text, and there are TWO independent gates, either of which would have made a
-- 'balance' write fail:
--
--   1. 0025 line 181:
--        check (payment_method is null or payment_method in ('cash','bank_transfer'))
--   2. 0039's pay_invoice() body:
--        if p_payment_method not in ('cash','bank_transfer')
--          then raise exception 'Invalid payment method: %'
--
-- The RPC guard fires FIRST, so flipping the app half without this migration
-- would not have produced a bad label — it would have made EVERY prepaid
-- settlement fail outright ("Invalid payment method: balance"). That is a live
-- outage on the money path, which is why the app half is gated behind this
-- file rather than shipped alongside it.
--
-- WHAT 'balance' MEANS. A prepaid customer's invoice is settled by drawing the
-- amount down from credit they already topped up. No cash changes hands at the
-- moment of settlement, and the money was already consumed at delivery by
-- lib/prepaid.ts's FIFO walk — the pay action only records and locks. Storing
-- 'cash' for that (which is what the app does today, see
-- InvoiceDetailModal.onMarkPaidBalance) overstates cash receipts in internal
-- reporting. This is a REPORTING-ACCURACY change: no amount, no balance, no
-- VAT figure and no ledger row moves, in this migration or the app half.
--
-- NO BACKFILL, DELIBERATELY. Two populations of already-paid invoices, and
-- neither is rewritten:
--   (a) payment_mode='prepaid' + payment_method='cash' — on the evidence,
--       exactly the mislabel this fixes. LEFT ALONE: rewriting the stored
--       method on a settled document changes a historical record after the
--       fact, and the instruction was explicit that an existing
--       cash/bank_transfer value is never overwritten.
--   (b) payment_mode=null (pre-0037, before the snapshot existed) — CANNOT be
--       classified either way. Inventing a mode for them would be worse than
--       leaving them as recorded.
-- So 'balance' describes settlements made from now on, and any report splitting
-- cash from balance must expect the pre-0134 period to read cash-heavy.
--
-- Counts for both populations sit in verification block C below, where they are
-- an apply-time before/after IDENTITY check ("nothing moved") rather than a
-- claim about the world. They are deliberately not restated up here as prose:
-- population (a) can still grow until the app half ships, so a number in this
-- header would go stale while reading like a fixed fact.
--
-- SCOPE: one CHECK constraint and one function body. No amount column, no
-- view, no trigger, no ledger. lib/prepaid.ts / vat.ts / invoice.ts are
-- untouched by the app half too.

begin;

-- ---------------------------------------------------------------------------
-- 1. invoices.payment_method — widen the allowed set.
--
-- Drop-and-re-add rather than a second constraint: two overlapping CHECKs on
-- one column is how a later reader ends up reading only one of them. The name
-- is preserved (invoices_payment_method_check — verified live) so anything
-- matching on the constraint name keeps working.
--
-- NULL stays allowed: an unpaid invoice has no method, and unpay_invoice()
-- nulls the column on revert.
-- ---------------------------------------------------------------------------
alter table public.invoices
  drop constraint if exists invoices_payment_method_check;

alter table public.invoices
  add constraint invoices_payment_method_check
  check (payment_method is null
         or payment_method in ('cash', 'bank_transfer', 'balance'));

comment on column public.invoices.payment_method is
  'How a paid invoice was settled. cash / bank_transfer = money received now. '
  'balance = drawn from a PREPAID customer''s existing credit, no fresh payment '
  '(0134). NULL until paid. Rows paid before 0134 read cash even where the '
  'settlement was from balance — not backfilled, see 0134''s header.';

-- ---------------------------------------------------------------------------
-- 2. pay_invoice() — accept 'balance', and refuse it on a postpaid invoice.
--
-- CREATE OR REPLACE, NOT drop+recreate: the signature is byte-identical to
-- 0039's, so replacing in place cannot produce a second overload. That is the
-- 0038 rule (exactly one signature per RPC) satisfied by construction rather
-- than by a drop that has to name the old argument list correctly. Verified
-- live before drafting: exactly one pay_invoice, the 6-arg one.
--
-- THE PREPAID CHECK IS THE POINT OF THIS HALF, not the widened allowlist.
-- Without it, 'balance' is merely a third string anyone can store on any
-- invoice, and the read-only audit ("does 'balance' only ever land on real
-- prepaid settlements?") would be checking a convention rather than a rule.
-- With it, the audit holds by construction going forward.
--
-- HOW PREPAID IS RESOLVED, AND WHY IT IS NOT JUST THE SNAPSHOT COLUMN.
-- invoices.payment_mode is 0037's frozen snapshot, and it is NULL on any
-- invoice confirmed before 0037 existed. THE RULE, not a row count: a NULL
-- snapshot is not evidence of "not prepaid" — it is evidence that no snapshot
-- was taken. Keying the guard on the snapshot alone would therefore refuse a
-- legitimate settlement of any such invoice. So it resolves snapshot-first,
-- falling back to the customer's project — which is EXACTLY what the UI
-- already does (InvoiceDetailModal: `payment_mode ?? projectPaymentMode`).
-- The two must agree: if the screen offers "Pay with Balance" the RPC must
-- accept it, and any other resolution here would put a refusal behind a button
-- that is already enabled.
--
-- DO NOT re-justify this coalesce with a live count of NULL-snapshot invoices.
-- That population is transient — it shrinks as old invoices settle and grows
-- again only if 0037's snapshot ever fails to write — so a count here would be
-- stale within weeks and would read as the REASON for the coalesce rather than
-- an illustration of it. The reason is the UI-agreement rule above, which holds
-- at a count of zero. (For the record, at drafting the population was non-empty;
-- the design does not depend on that and must not be revisited if it empties.)
--
-- THE LOOKUP IS BY customer_id. There is no invoices.project_id — invoices key
-- off the customer and always have (0025) — so customer_id is the only join
-- available, not a preference.
--
-- WHY THE SUBQUERY AGGREGATES INSTEAD OF JUST SELECTING THE ROW.
-- projects_customer_id_unique (0015) makes customer→project 1:1 TODAY, so the
-- distinct count can only be 0 or 1 and the aggregate returns exactly what a
-- plain scalar subquery would. It is written this way for the case that unique
-- is lifted: multi-project customers are an explicitly deferred Finance item,
-- and on the day it lands a customer could hold a prepaid project and a
-- postpaid one. A plain subquery would then return whichever row Postgres felt
-- like and silently authorise a balance settlement on the strength of the wrong
-- project. count(distinct …) = 1 else NULL makes that ambiguity resolve to
-- "unknown", and the guard below refuses anything that is not exactly
-- 'prepaid' — so it FAILS CLOSED rather than guessing.
-- NOTE FOR WHOEVER BUILDS MIXED-MODE CUSTOMERS: this resolution is the thing to
-- revisit. It will refuse a legitimate settlement for such a customer, which is
-- the correct failure while there is no per-invoice project to disambiguate.
-- Zero mixed-mode customers exist today, which is why the refusal is unreachable
-- and NOT a reason to weaken it now.
--
-- This is NOT expressible as a table CHECK: it needs a join, and a CHECK is
-- also retroactive, which would re-validate every pre-0134 paid row.
--
-- 'balance' requires NO proof, NO reference and NO date: there is no external
-- transaction to evidence. The bank_transfer requirements below are unchanged,
-- verbatim from 0039.
-- ---------------------------------------------------------------------------
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
  v_row  public.invoices;
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
  -- Resolve mode: invoice snapshot first, else the customer's project mode.
  -- Invoices link by customer_id (there is no invoices.project_id); every customer
  -- is single-mode today (0 mixed-mode customers) so the distinct project mode is
  -- unambiguous. A NULL snapshot is NOT evidence of "not prepaid" — resolve through
  -- the customer's projects, do not treat null as non-prepaid.
  -- NOTE: if multi-project customers with MIXED modes are ever introduced (a deferred
  -- feature), this single-mode resolution must be revisited.
  -- Resolved BEFORE the update, so a refusal leaves the invoice untouched
  -- rather than rolling back a write.
  if p_payment_method = 'balance' then
    select coalesce(
             i.payment_mode,
             (select case when count(distinct pr.payment_mode) = 1
                          then max(pr.payment_mode) else null end
                from public.projects pr where pr.customer_id = i.customer_id)
           )
      into v_mode
      from public.invoices i
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

-- unpay_invoice() NEEDS NO CHANGE and is deliberately not touched: it already
-- sets payment_method = null on revert, which is correct for 'balance' too.

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after apply; read-only, safe to re-run)
-- ---------------------------------------------------------------------------
-- A. The constraint allows exactly three values plus NULL.
--    Expect: CHECK (... = ANY (ARRAY['cash','bank_transfer','balance'])).
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.invoices'::regclass
--    and conname = 'invoices_payment_method_check';
--
-- B. STILL EXACTLY ONE pay_invoice. Expect 1 row, the 6-arg signature.
--    More than one means an overload was created — stop and fix (0038).
-- select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'pay_invoice';
--
-- C. NOTHING WAS BACKFILLED. This is an IDENTITY check: run it BEFORE apply,
--    run it after, expect the two to match exactly — and ZERO 'balance' rows
--    until the app half ships and a real prepaid invoice is settled.
--    Distribution measured at drafting was postpaid/bank_transfer 1,
--    prepaid/cash 2, null/bank_transfer 1, null/cash 7. THAT IS A READING,
--    NOT AN EXPECTATION: prepaid/cash can still grow until the app half
--    ships. Compare against your own pre-apply run, never against these
--    numbers.
-- select payment_mode, payment_method, count(*)
--   from public.invoices where status = 'paid' group by 1,2 order by 1,2;
--
-- D. THE AUDIT QUERY — A STANDING CHECK, not a one-off apply-time reading.
--    Expect ZERO rows, forever: a 'balance' row whose resolved mode is not
--    prepaid. The guard makes this hold by construction for anything settled
--    THROUGH pay_invoice; the widened CHECK constraint on its own would still
--    permit 'balance' on any row, so this query is what covers a direct write
--    that bypasses the RPC. Re-run it after any change to the pay path.
--
--    THE RESOLUTION BELOW IS A COPY OF THE GUARD'S, DELIBERATELY IDENTICAL —
--    including the single-mode aggregate. An audit that resolves mode
--    differently from the rule it audits reports its own disagreement as a
--    finding. If the guard changes, change this too, in the same commit.
-- select i.id, i.invoice_number, i.payment_mode, i.payment_method
--   from public.invoices i
--  where i.payment_method = 'balance'
--    and coalesce(i.payment_mode,
--                 (select case when count(distinct pr.payment_mode) = 1
--                              then max(pr.payment_mode) else null end
--                    from public.projects pr
--                   where pr.customer_id = i.customer_id)) is distinct from 'prepaid';
