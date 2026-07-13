-- 0031_invoice_pdfs_bucket.sql
-- Finance — invoice PDF export (spec §7/§11). Adds the private Storage
-- bucket that caches GENERATED invoice PDFs, separate from `invoice-proofs`
-- (0027) which holds USER-UPLOADED payment-proof files — different
-- lifecycle/purpose, kept as two buckets rather than one.
--
-- Caching model (see app/trips/invoiceActions.ts's getInvoicePdf()):
--   - draft/review invoices: NEVER cached here — content is still live/
--     mutable, always regenerated on each download.
--   - confirmed/paid/void invoices: generated on first download, uploaded
--     to this bucket at a deterministic path (`${invoiceId}.pdf`), and
--     every later download reads the cached bytes instead of calling the
--     PDF provider again — safe because that snapshot can never change.
-- Nothing is generated eagerly at confirm time; this bucket stays empty
-- for an invoice until someone actually clicks "Download PDF".
--
-- Private bucket (public=false) — same trust boundary as invoice-proofs:
-- any authenticated staff user may read/write any invoice's PDF (no
-- per-row-owner concept in this app), RLS just gates anon vs authenticated.
--
-- NOT RUN YET — drafted for review per CLAUDE.md's verify-before-running
-- discipline. Turki reviews/runs in the Supabase SQL Editor.

begin;

insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', false)
on conflict (id) do nothing;

create policy "invoice_pdfs_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'invoice-pdfs');

create policy "invoice_pdfs_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoice-pdfs');

create policy "invoice_pdfs_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoice-pdfs')
  with check (bucket_id = 'invoice-pdfs');

create policy "invoice_pdfs_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'invoice-pdfs');

commit;
