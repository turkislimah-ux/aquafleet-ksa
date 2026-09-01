-- 0182_discard_draft_or_review_invoice.sql
--
-- PROBLEM: delete_draft_invoice rejects everything that is not 'draft'
--   if v_status <> 'draft' then
--     raise exception 'Only draft invoices can be deleted (status: %).', v_status;
-- but an invoice sits in 'review' for the whole confirm step, and while it sits
-- there it HOLDS things:
--   * trips.invoice_id points at it — those trips are reserved and cannot be
--     put on another invoice (lib/db-types.ts: invoice_id set = RESERVED).
--   * invoice_special_charges rows are FK-bound to it, and
--     v_customer_prepaid_balance.charge_consumption_sar sums every charge on a
--     NON-VOID invoice, so a stale review invoice keeps eating prepaid credit.
-- There is no path out. void_invoice is for a document that was issued and must
-- stay on the books with a number; a review invoice was never issued. So a
-- stale review invoice is unclearable today and quietly holds money and trips.
--
-- WHY EXTEND delete_draft_invoice IN PLACE RATHER THAN ADD discard_invoice.
-- Adding a second function would leave TWO paths that release trips and free
-- balance, and this project has already paid for that mistake: 0019 shipped
-- archive_project, 0139 added archive_project_guarded, and 0140 had to DROP the
-- unguarded one because the second path was the back door around the first.
-- CLAUDE.md 6 states the rule plainly — "Do not add a second one." One function,
-- one signature, one call site (app/trips/invoiceActions.ts:281), nothing to
-- keep in sync, and the migration is self-contained: no TypeScript has to land
-- before or after it for the app to keep working.
--
-- THE NAME IS NOW HISTORICAL and slightly narrow — it deletes draft OR review.
-- Renaming to discard_invoice would be honest but would drop the old name,
-- breaking the live call site until a TS change lands alongside; that trade is
-- not worth a breakage window for a cosmetic gain. If the name is to change it
-- should be its own pure-rename unit, migration + call site committed together.
--
-- WHAT "DISCARD" RELEASES — measured from pg_constraint, not assumed. invoices
-- has exactly TWO FK children:
--   invoice_special_charges.invoice_id -> invoices(id) ON DELETE CASCADE  (confdeltype 'c')
--   trips.invoice_id                   -> invoices(id) ON DELETE SET NULL (confdeltype 'n')
-- Nothing else references invoices, so the delete leaves no orphan.
--   * Trips: the explicit `update ... set invoice_id = null` is kept from the
--     original body. The FK would do it anyway, but the statement is what makes
--     the release readable at the call site, and it is the pattern this function
--     already had. Not reimplemented, not removed.
--   * Charges: cascade. Deleting the rows is what frees the balance, and it
--     frees it on BOTH sides at once — v_customer_prepaid_balance's charge term
--     and the TS engine's fetch (app/trips/page.tsx:354 and
--     app/trips/invoiceActions.ts, both scoped `status <> 'void'`) stop seeing
--     the charge because the row no longer exists, not because one of them
--     applies a filter the other does not. No new divergence of the 0181 kind.
--
-- WHAT STAYS REJECTED, and why the error names the right door:
--   'confirmed' / 'paid' -> void_invoice(uuid, text) — an issued document keeps
--     its number and stays on the books; deleting it would punch a hole in the
--     invoice sequence. 'paid' additionally has to go through
--     unpay_invoice(uuid, text, text) first.
--   'void'              -> already discarded; nothing to release.
-- Names taken from pg_proc this turn, not from memory.
--
-- Signature, return type, SECURITY DEFINER and SET search_path TO 'public' are
-- IDENTICAL to the live function — no call site changes.
--
-- CLAUDE.md 6 ACL FOOTER — BOTH LINES ARE LOAD-BEARING. drop+create resets the
-- ACL to the Postgres default (EXECUTE TO PUBLIC, which anon inherits) AND wipes
-- the explicit grants. Measured live proacl for delete_draft_invoice(uuid):
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- No PUBLIC entry — authenticated and service_role are EXPLICIT grants. So
-- revoking alone would leave the function owner-only and the app could no
-- longer delete a draft at all; granting alone would leave it anon-reachable
-- with the anon key that ships in the client bundle. Both lines, every time.
-- This is the exact trap that nearly shipped in 0181. End-state ACL must equal
-- the pre-migration ACL above, read back with has_function_privilege on
-- authenticated / service_role / anon — never by proacl pattern-matching (6),
-- and identify the function by oid::regprocedure.

drop function if exists public.delete_draft_invoice(uuid);

create or replace function public.delete_draft_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status is null then
    raise exception 'Invoice not found.';
  end if;

  if v_status not in ('draft', 'review') then
    if v_status = 'paid' then
      raise exception 'Cannot discard a paid invoice. Un-pay it first, then void it — a paid document stays on the books.'
        using hint = 'unpay_invoice(uuid, text, text), then void_invoice(uuid, text).';
    elsif v_status = 'confirmed' then
      raise exception 'Cannot discard a confirmed invoice — it has been issued and carries an invoice number. Void it instead.'
        using hint = 'void_invoice(uuid, text).';
    elsif v_status = 'void' then
      raise exception 'This invoice is already void — its trips and charges are released, there is nothing to discard.';
    else
      raise exception 'Only draft or review invoices can be discarded (status: %).', v_status;
    end if;
  end if;

  -- Release the reserved trips, then delete. The charges go with the invoice
  -- through invoice_special_charges_invoice_id_fkey (ON DELETE CASCADE), which
  -- is what frees the customer's held prepaid balance.
  update public.trips set invoice_id = null where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;
end;
$function$;

revoke execute on function public.delete_draft_invoice(uuid) from public, anon;

grant execute on function public.delete_draft_invoice(uuid) to authenticated, service_role;
