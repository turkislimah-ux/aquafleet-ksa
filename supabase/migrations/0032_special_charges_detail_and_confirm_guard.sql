-- 0032_special_charges_detail_and_confirm_guard.sql
-- Finance polish — Batch B (invoice logic). NOT RUN YET — drafted for
-- review, per CLAUDE.md's verify-before-running discipline. Two independent
-- changes bundled here since both ship together in this batch:
--
--   1. confirm_invoice() (0027) gains a hard SERVER-SIDE guard: refuses to
--      confirm an invoice if ANY trip within its period (same customer's
--      project) is not yet delivered (delivered_at is null). This mirrors
--      the UI-side check (app/trips/invoiceActions.ts's
--      getUndeliveredTripsForInvoice, used to disable Confirm + render the
--      blocker list) so the DB enforces the exact same condition — makes
--      the block unbypassable even via a direct RPC call, not just a
--      disabled button. Placed BEFORE next_invoice_number()/
--      next_vat_ref_number() so a blocked confirm burns neither counter —
--      same gap-free guarantee the existing "status != review" guard below
--      it already relies on (see 0027 header).
--
--   2. invoice_special_charges (0025) gains four new nullable columns —
--      charge_date, quantity (default 1), price_sar, image_path. All
--      nullable/defaulted since any existing draft/review charge rows
--      (label + amount_sar only, pre-this-batch shape) predate these
--      fields — no backfill; app code (lib/invoice.ts) falls back to
--      amount_sar as price with quantity 1 when price_sar is null.
--      amount_sar REMAINS the source of truth read by the VAT engine
--      (lib/invoice.ts's chargesToVatItems) — price_sar * quantity is
--      computed and written into amount_sar by the app at add/edit time,
--      never derived at read time inside the money-math path. No VAT/
--      total/subtotal formula changes anywhere.
--
--      image_path is an OPTIONAL, INTERNAL-ONLY attachment per charge (e.g.
--      a receipt photo) — never surfaced on the customer-facing invoice,
--      print, or PDF (app/trips/InvoiceDetailModal.tsx, lib/pdf.ts,
--      lib/invoicePdfTemplate.ts all continue to read only label/amount_sar/
--      date/quantity/price for display). New PRIVATE Storage bucket
--      `special-charge-images` below, mirroring the invoice-proofs pattern
--      (0027 section 8) exactly: private bucket, authenticated-only RLS.
--      Storage key is app-generated (invoiceId/chargeId-timestamp.ext — see
--      uploadSpecialChargeImage() in app/trips/invoiceActions.ts), never the
--      raw uploaded filename (the exact thing that broke before, per
--      CLAUDE.md's note on this batch).

begin;

-- ---------------------------------------------------------------------------
-- 1. confirm_invoice() — add the undelivered-trip guard. Full function body
--    re-emitted (CREATE OR REPLACE requires it); everything below the new
--    v_undelivered_count check is unchanged from 0027.
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
  v_number            integer;
  v_year              integer;
  v_vat_num           integer;
  v_vat_ref           text;
  v_row               public.invoices;
  v_undelivered_count integer;
begin
  -- Hard block (Finance polish batch B, item 2): any trip whose trip_date
  -- falls within this invoice's period, for this invoice's customer's
  -- project, that isn't yet delivered blocks confirm entirely. Mirrors the
  -- UI's getUndeliveredTripsForInvoice() query exactly (same predicate:
  -- project via customer_id, trip_date between period bounds, delivered_at
  -- is null) so UI and DB never disagree about what blocks.
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

  v_number := public.next_invoice_number();

  -- APPROVED format: BS-YYYY-NNNNNN, NNNNNN gap-free WITHIN the year via
  -- next_vat_ref_number() (0027 section 3) — see 0027's migration header.
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
-- 2. invoice_special_charges — new columns for the detailed input shape
--    (date/quantity/price) + an optional internal-only image reference.
-- ---------------------------------------------------------------------------
alter table public.invoice_special_charges
  add column if not exists charge_date date,
  add column if not exists quantity    numeric(12, 2) not null default 1,
  add column if not exists price_sar   numeric(12, 2),
  add column if not exists image_path  text;

-- ---------------------------------------------------------------------------
-- 3. special-charge-images Storage bucket — PRIVATE, same pattern as
--    invoice-proofs (0027 section 8). Internal-only: viewed via a
--    short-lived signed URL from an internal-only control next to the
--    charge row (app/trips/InvoiceDetailModal.tsx) — never a public link,
--    never rendered on the customer-facing invoice/print/PDF.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('special-charge-images', 'special-charge-images', false)
on conflict (id) do nothing;

create policy "special_charge_images_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'special-charge-images');

create policy "special_charge_images_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'special-charge-images');

create policy "special_charge_images_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'special-charge-images')
  with check (bucket_id = 'special-charge-images');

create policy "special_charge_images_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'special-charge-images');

commit;
