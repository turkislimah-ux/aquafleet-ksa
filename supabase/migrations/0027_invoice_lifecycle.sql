-- 0027_invoice_lifecycle.sql
-- Finance Commit 5 — invoice lifecycle (spec v2 §6/§7/§8, locked decisions
-- from chat, superseding some of 0025's original 3-status sketch). NOT RUN
-- YET — drafted for review. Written to disk per CLAUDE.md's
-- verify-before-running discipline.
--
-- LIFECYCLE CHANGE: 0025 shipped `status check (draft|issued|paid)`. The
-- locked lifecycle is now Draft -> Review -> Confirmed -> Paid, + Void
-- (Confirmed replaces "Issued" terminology; Review and Void are new). Safe
-- to widen/rename in place — `invoices` has zero rows (feature unlaunched),
-- so no data migration is needed, just a constraint + column change.
--
-- WHY the "review" status is REAL DB STATE, not UI-only: Draft and Review
-- both stay live-recomputed (no snapshot exists until Confirm) — they only
-- differ by user intent ("still editing" vs "ready to confirm"). Making
-- Review a real status (a) lets 5c list "pending review" invoices without
-- component-local state that's lost on navigation/reload, (b) gives a
-- `reviewed_at` audit timestamp for free, (c) is zero extra complexity — it
-- reuses the exact same enum/column pattern draft/issued/paid already used,
-- not a special case bolted on.
--
-- WHY Confirm snapshots line items (new: covered_lines/unpaid_lines/
-- special_charges_snapshot jsonb + covered_trip_ids/unpaid_trip_ids uuid[]):
-- 0025 had no line-item snapshot at all (by design, since the OLD lifecycle
-- allowed re-issuing/refreshing right up to payment, so line items could
-- stay live-derived). The NEW locked lifecycle is stricter — "no revert to
-- draft after confirm" — so Confirmed is the terminal freeze point. If the
-- underlying trips changed between Confirm and Pay, the confirmed document
-- must NOT silently drift; it must show exactly what was confirmed. Hence
-- persisting the computed snapshot at confirm time, not re-deriving live
-- after that point. covered_trip_ids/unpaid_trip_ids (plain uuid[], not
-- parsed out of the jsonb) exist purely so pay_invoice() below can lock
-- trips with a simple `= any(...)` without parsing JSON in SQL.
--
-- VAT REFERENCE NUMBER (`vat_ref`) — APPROVED format: BS-YYYY-NNNNNN, e.g.
-- BS-2026-000001. NNNNNN resets to 1 each calendar year (the confirm year,
-- i.e. when Confirm actually runs — not the invoice period). ZATCA's
-- current mandatory phase (Phase 1, non-integrated) doesn't require a
-- second sequential reference distinct from the invoice's own number; this
-- is Bin Slimah's own human-facing reference, formatted per Turki's
-- decision, not a ZATCA mandate.
--
-- Annual reset means vat_ref's sequence CANNOT be derived from
-- invoice_number (which stays globally continuous across years, by
-- design — see next_invoice_number(), 0025). It needs its OWN counter,
-- keyed by year. See invoice_vat_ref_counter + next_vat_ref_number() below
-- for the gap-free-within-year mechanism, and confirm_invoice()'s body for
-- how it's claimed atomically alongside invoice_number.
--
-- customers.email: did not exist anywhere in the schema before this
-- migration (checked: no prior migration adds it). Needed for 5c's mailto
-- link and for buyer contact on the invoice; added here as nullable/
-- additive, same treatment as 0025's vat_number/cr_number/billing_address.

begin;

-- ---------------------------------------------------------------------------
-- 1. customers.email — additive, nullable.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists email text;

-- ---------------------------------------------------------------------------
-- 2. invoices — widen status enum, rename issued_at, add lifecycle audit
--    columns, add confirm-time snapshot columns, add split-total columns.
-- ---------------------------------------------------------------------------
alter table public.invoices
  drop constraint if exists invoices_status_check;

alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft', 'review', 'confirmed', 'paid', 'void'));

alter table public.invoices
  rename column issued_at to confirmed_at;

alter table public.invoices
  add column if not exists reviewed_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists unpaid_at timestamptz,
  add column if not exists unpaid_reason text,
  add column if not exists unpaid_by text; -- free text, matches entered_by/approved_by precedent

-- VAT reference — see header note. Unique-when-not-null, same pattern as
-- invoice_number (allows unlimited NULLs pre-confirm, no collisions after).
alter table public.invoices
  add column if not exists vat_ref text;

create unique index if not exists invoices_vat_ref_unique
  on public.invoices (vat_ref)
  where vat_ref is not null;

-- Confirm-time snapshot (frozen; never re-derived after confirm — see
-- header note). Nullable — only populated once status reaches 'confirmed'.
alter table public.invoices
  add column if not exists covered_lines jsonb,
  add column if not exists unpaid_lines jsonb,
  add column if not exists special_charges_snapshot jsonb,
  add column if not exists covered_trip_ids uuid[],
  add column if not exists unpaid_trip_ids uuid[];

-- Rename 0025's single subtotal/vat/total to grand_* (unambiguous once the
-- Covered / Amount Due split exists alongside it) and add the two other
-- totals. All three totals (grand / covered / amount due) are each their
-- own independent calculateVat() document-level rounding pass — see
-- lib/invoice.ts header for why they're not required to sum to each other.
alter table public.invoices
  rename column subtotal_sar to grand_subtotal_sar;
alter table public.invoices
  rename column vat_sar to grand_vat_sar;
alter table public.invoices
  rename column total_sar to grand_total_sar;

alter table public.invoices
  add column if not exists covered_subtotal_sar numeric(12, 2) not null default 0,
  add column if not exists covered_vat_sar numeric(12, 2) not null default 0,
  add column if not exists covered_total_sar numeric(12, 2) not null default 0,
  add column if not exists amount_due_subtotal_sar numeric(12, 2) not null default 0,
  add column if not exists amount_due_vat_sar numeric(12, 2) not null default 0,
  add column if not exists amount_due_sar numeric(12, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 3. invoice_vat_ref_counter / next_vat_ref_number() — per-year gap-free
--    counter for vat_ref's NNNNNN, mirroring next_invoice_number()'s
--    transactional-UPDATE discipline (0025) exactly, just keyed by year
--    instead of a singleton row.
--
--    NOT a sequence: nextval() does not roll back with its enclosing
--    transaction, so a failed confirm would burn a vat_ref number even
--    though nothing was written. A plain UPDATE rolls back with the
--    transaction it ran in — same reasoning 0025 already used for
--    invoice_number_counter, applied again here per-year.
--
--    Row-per-year is created lazily (INSERT ... ON CONFLICT DO NOTHING) on
--    first use of that year, then claimed via UPDATE ... RETURNING
--    next_number - 1, same claim pattern as next_invoice_number(). Two
--    concurrent confirms in the same brand-new year: both INSERTs race,
--    one wins/one no-ops on conflict (harmless either way — DO NOTHING,
--    no error), then both UPDATEs serialize on Postgres's normal
--    row-level lock for that (year) row — the second waits for the
--    first's transaction to finish, then claims the next value. Same
--    concurrency guarantee next_invoice_number() already relies on for
--    its singleton row, just per-year instead of global.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_vat_ref_counter (
  year        integer primary key,
  next_number integer not null default 1
);

create or replace function public.next_vat_ref_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.invoice_vat_ref_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.invoice_vat_ref_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_vat_ref_number(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. confirm_invoice() — THE atomic Review -> Confirmed transition.
--
--    Assembly math (line items, the three totals) happens in TypeScript
--    (lib/invoice.ts, pure/tested) BEFORE this is called — this function's
--    only job is to persist that already-computed result atomically
--    alongside the invoice_number + vat_ref claim. It does not recompute
--    anything.
--
--    Gap-free guarantee, BOTH counters: next_invoice_number() AND
--    next_vat_ref_number() AND the final UPDATE all run inside this single
--    function invocation, which Postgres treats as one transaction. If the
--    UPDATE's WHERE clause matches zero rows (invoice wasn't in 'review'
--    status — e.g. a race, or already confirmed) we RAISE, which aborts
--    the whole function, which rolls back BOTH counter claims together. A
--    failed confirm burns neither the invoice number nor the VAT ref
--    number, by construction, not by convention.
--
--    Year used for vat_ref is the CONFIRM year (now(), not the invoice
--    period) — matches the locked decision that annual reset tracks when
--    the document is actually issued.
-- ---------------------------------------------------------------------------
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
  v_number  integer;
  v_year    integer;
  v_vat_num integer;
  v_vat_ref text;
  v_row     public.invoices;
begin
  v_number := public.next_invoice_number();

  -- APPROVED format: BS-YYYY-NNNNNN, NNNNNN gap-free WITHIN the year via
  -- next_vat_ref_number() (section 3 above) — see migration header.
  v_year    := extract(year from now())::integer;
  v_vat_num := public.next_vat_ref_number(v_year);
  v_vat_ref := 'BS-' || v_year::text || '-' || lpad(v_vat_num::text, 6, '0');

  update public.invoices
     set status                  = 'confirmed',
         invoice_number          = v_number,
         vat_ref                 = v_vat_ref,
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

-- ---------------------------------------------------------------------------
-- 5. void_invoice() — the ONLY undo for a Confirmed invoice. Number and
--    vat_ref are NEVER cleared/reused (next_invoice_number() only ever
--    increments; a void just marks the row dead). No trip unlocking here —
--    Confirmed never locked trips (only Paid does), so there's nothing to
--    unlock.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_reason     text
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invoices;
begin
  update public.invoices
     set status      = 'void',
         voided_at   = now(),
         void_reason = p_reason
   where id = p_invoice_id
     and status = 'confirmed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in confirmed status (or does not exist) — cannot void.';
  end if;

  return v_row;
end;
$$;

grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. pay_invoice() — Confirmed -> Paid. Locks BOTH covered and unpaid trips
--    via trips.invoice_id (prevents any of them appearing on a future
--    invoice, and freezes them from edits — same derived-lock convention as
--    payout_id, no trigger). Amount collected is implicitly amount_due_sar
--    (full-only, no partial payment struct, per locked decision) — this
--    function does not take an amount param, only the payment method/proof.
-- ---------------------------------------------------------------------------
create or replace function public.pay_invoice(
  p_invoice_id     uuid,
  p_payment_method text,
  p_proof_path     text
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

  update public.invoices
     set status                 = 'paid',
         paid_at                = now(),
         payment_method         = p_payment_method,
         proof_of_payment_path  = p_proof_path
   where id = p_invoice_id
     and status = 'confirmed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in confirmed status (or does not exist) — cannot mark paid.';
  end if;

  -- Lock every trip in both tables — covered AND unpaid (see header note on
  -- why covered trips lock too: prevents a later backdated top-up from
  -- silently re-deriving a different Covered/Unpaid split under an
  -- already-paid, supposedly-immutable historical document).
  update public.trips
     set invoice_id = p_invoice_id
   where id = any(coalesce(v_row.covered_trip_ids, array[]::uuid[])
             || coalesce(v_row.unpaid_trip_ids, array[]::uuid[]));

  return v_row;
end;
$$;

grant execute on function public.pay_invoice(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. unpay_invoice() — gated admin action (the approval gate itself is a
--    UI/app-layer concern, not enforced here). Paid -> Confirmed: unlocks
--    every trip this invoice locked, clears payment fields, keeps
--    invoice_number/vat_ref/snapshot untouched (still the same confirmed
--    document, just not paid yet).
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
         unpaid_at             = now(),
         unpaid_reason         = p_reason,
         unpaid_by             = p_by
   where id = p_invoice_id
     and status = 'paid'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in paid status (or does not exist) — cannot un-pay.';
  end if;

  update public.trips
     set invoice_id = null
   where invoice_id = p_invoice_id;

  return v_row;
end;
$$;

grant execute on function public.unpay_invoice(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. invoice-proofs Storage bucket — proof-of-payment uploads for
--    bank_transfer pay_invoice() calls (app/trips/invoiceActions.ts's
--    markInvoicePaid()). Private bucket (public=false) — proofs are internal
--    financial records, never served by public URL; the app must fetch them
--    via signed URL. RLS on storage.objects mirrors the pattern of every
--    other table here (authenticated-only, no anon access) since this app
--    has no per-row-owner concept for staff — any authenticated staff user
--    manages any invoice's proof file, same trust boundary as the invoices
--    table itself has no owner-scoped RLS.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoice-proofs', 'invoice-proofs', false)
on conflict (id) do nothing;

create policy "invoice_proofs_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'invoice-proofs');

create policy "invoice_proofs_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoice-proofs');

create policy "invoice_proofs_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoice-proofs')
  with check (bucket_id = 'invoice-proofs');

create policy "invoice_proofs_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'invoice-proofs');

commit;
