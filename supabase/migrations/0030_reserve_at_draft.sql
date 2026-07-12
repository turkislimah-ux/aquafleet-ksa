-- 0030_reserve_at_draft.sql
-- Finance — reserve-at-draft trip reservation (both modes) + postpaid
-- un-gating support. Locked decisions (Turki, chat): NOT RUN YET — drafted
-- for review per CLAUDE.md's verify-before-running discipline.
--
-- RESERVED vs LOCKED — the one thing to hold in your head reading this file:
--   trips.invoice_id set  = RESERVED. Exclusive to that invoice (no other
--     non-void invoice may also bill this trip), but the trip stays fully
--     EDITABLE/reversible — drafting an invoice must never freeze a trip.
--   trips.invoice_id set AND that invoice's status = 'paid' = LOCKED.
--     Immutable — no edit/stage/reversal/delete. UNCHANGED from before this
--     migration; only paid status locks, exactly as spec v2 §6/§21 says.
-- Before this migration, invoice_id was set ONLY at pay_invoice() (so
-- "reserved" and "locked" happened to coincide in time). After this
-- migration, invoice_id is set much earlier (at draft) — the two concepts
-- must be read as distinct from here on. Nothing in the app may treat
-- "has invoice_id" as "is locked" — only status = 'paid' locks.
--
-- LIFECYCLE RULE (new): a trip is reserved (invoice_id set) the moment it's
-- placed on a draft invoice, and released (invoice_id cleared) only when
-- that invoice is voided or deleted. A trip can be on at most one non-void
-- invoice at a time. Un-pay (paid -> confirmed) does NOT release — see (5)
-- below, this is a deliberate change from the previous shipped behavior.
--
-- Reservation is synced on EXPLICIT actions only (create-draft, move-to-
-- review) — never as a side effect of merely viewing/previewing an invoice.
-- See app/trips/invoiceActions.ts for the call sites.

begin;

-- ---------------------------------------------------------------------------
-- 1. create_draft_invoice() — atomically inserts the draft invoice row AND
--    reserves its initial trip set. p_trip_ids is computed in TypeScript
--    (lib/invoice.ts's assembleInvoice, via the reserved-elsewhere exclusion
--    — see that file) BEFORE this call, so by the time this RPC runs the
--    requested trips should already exclude anything reserved by another
--    invoice. The conflict check below is a race-safety net (two people
--    drafting overlapping invoices concurrently), not the primary filter.
--
--    Claim is conditional (`where invoice_id is null`) — never steals a
--    trip that's already reserved. If ANY requested trip turns out to be
--    reserved elsewhere by the time this runs, we raise, which rolls back
--    the whole function (insert + claim together) — no half-created draft,
--    no half-claimed trip set.
-- ---------------------------------------------------------------------------
create or replace function public.create_draft_invoice(
  p_customer_id  uuid,
  p_period_start date,
  p_period_end   date,
  p_trip_ids     uuid[]
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row            public.invoices;
  v_conflict_count int;
begin
  insert into public.invoices (customer_id, period_start, period_end, status)
  values (p_customer_id, p_period_start, p_period_end, 'draft')
  returning * into v_row;

  update public.trips
     set invoice_id = v_row.id
   where id = any(coalesce(p_trip_ids, array[]::uuid[]))
     and invoice_id is null;

  select count(*) into v_conflict_count
    from public.trips
   where id = any(coalesce(p_trip_ids, array[]::uuid[]))
     and invoice_id is not null
     and invoice_id <> v_row.id;

  if v_conflict_count > 0 then
    raise exception 'One or more trips are already reserved by another invoice (% conflict(s)) — refresh and try again.', v_conflict_count;
  end if;

  return v_row;
end;
$$;

grant execute on function public.create_draft_invoice(uuid, date, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. sync_draft_reservation() — re-syncs an EXISTING draft/review invoice's
--    reservation to a freshly-computed desired trip set (called explicitly
--    from setInvoiceReview() before the status flip — see invoiceActions.ts;
--    never called from a read-only preview). Releases trips no longer
--    desired, claims newly-desired trips, raises on conflict — same
--    release-then-claim-then-verify shape as create_draft_invoice() above,
--    all inside one transaction so a conflict rolls back BOTH the release
--    and the claim together (never a half-synced reservation).
--
--    Guarded to draft/review only — confirmed/paid/void invoices have a
--    frozen trip set (confirm_invoice's snapshot) and must never have their
--    reservation silently rewritten by this function.
-- ---------------------------------------------------------------------------
create or replace function public.sync_draft_reservation(
  p_invoice_id uuid,
  p_trip_ids   uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status         text;
  v_conflict_count int;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status is null then
    raise exception 'Invoice not found.';
  end if;
  if v_status not in ('draft', 'review') then
    raise exception 'Invoice is not draft/review (status: %) — cannot sync reservation.', v_status;
  end if;

  -- Release: trips this invoice currently reserves that are no longer desired.
  update public.trips
     set invoice_id = null
   where invoice_id = p_invoice_id
     and not (id = any(coalesce(p_trip_ids, array[]::uuid[])));

  -- Claim: newly-desired trips that are currently unreserved.
  update public.trips
     set invoice_id = p_invoice_id
   where id = any(coalesce(p_trip_ids, array[]::uuid[]))
     and invoice_id is null;

  select count(*) into v_conflict_count
    from public.trips
   where id = any(coalesce(p_trip_ids, array[]::uuid[]))
     and invoice_id is not null
     and invoice_id <> p_invoice_id;

  if v_conflict_count > 0 then
    raise exception 'One or more trips are already reserved by another invoice (% conflict(s)) — refresh and try again.', v_conflict_count;
  end if;
end;
$$;

grant execute on function public.sync_draft_reservation(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. delete_draft_invoice() — abandons a draft, releasing its trips.
--    Draft-only by design (a Review invoice must go Back to Draft first via
--    the existing revertInvoiceToDraft() action, then delete — no separate
--    review-delete path). invoice_special_charges cascades automatically
--    (0025: `references invoices(id) on delete cascade`).
-- ---------------------------------------------------------------------------
create or replace function public.delete_draft_invoice(
  p_invoice_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status is null then
    raise exception 'Invoice not found.';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft invoices can be deleted (status: %).', v_status;
  end if;

  update public.trips set invoice_id = null where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;
end;
$$;

grant execute on function public.delete_draft_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. void_invoice() — MODIFIED. Previously did not touch trips at all
--    ("Confirmed never locked trips, so there's nothing to unlock" — that
--    comment predates reserve-at-draft and is now WRONG: a confirmed
--    invoice's trips have been reserved since draft/review). Void is the
--    release point for a confirmed invoice's reservation.
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

  -- Release: void frees every trip this invoice had reserved.
  update public.trips
     set invoice_id = null
   where invoice_id = p_invoice_id;

  return v_row;
end;
$$;

grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. unpay_invoice() — MODIFIED. Previously cleared trips.invoice_id on
--    every Paid -> Confirmed revert. Under the new rule, release only
--    happens on void/delete — un-pay reverses PAYMENT, not RESERVATION, so
--    the trips stay reserved to this (now-confirmed-again) invoice. This is
--    a deliberate behavior change to already-shipped code (locked decision,
--    Turki) — un-paying no longer frees trips for another invoice to claim;
--    voiding is the only way to do that from here.
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

  -- NO trip release here (changed from the original 0027 version) — trips
  -- stay reserved to this invoice; only void/delete release. See header.

  return v_row;
end;
$$;

grant execute on function public.unpay_invoice(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. pay_invoice() — UNCHANGED. Its `set invoice_id = p_invoice_id` step is
--    now a harmless idempotent re-write (draft/review already reserved
--    these trips via create_draft_invoice/sync_draft_reservation above) —
--    left in place as defense-in-depth rather than removed, since it costs
--    nothing to re-assert and guarantees pay_invoice is still correct even
--    if some future path ever confirms an invoice without having gone
--    through the reserve flow.
-- ---------------------------------------------------------------------------

commit;
