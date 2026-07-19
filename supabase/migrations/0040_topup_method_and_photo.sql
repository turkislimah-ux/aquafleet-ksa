-- 0040_topup_method_and_photo.sql
-- Finance/Invoice polish — Batch B (Add Balance popup restructure). Brings
-- customer_topups' write path in line with the invoice payment step: a
-- cash/bank_transfer choice, with bank_transfer requiring a reference AND a
-- photo of the transfer (same reasoning 0027's pay_invoice() already applies
-- to invoice proof-of-payment).
--
-- NOT RUN YET — drafted for review per CLAUDE.md's verify-before-running
-- discipline. Turki reviews/runs in the Supabase SQL Editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. customer_topups — additive columns.
--    - method: nullable (legacy rows predate this batch — no backfill, same
--      "—" precedent as every other frozen-snapshot gap in this app, e.g.
--      legacy invoices before 0036). New rows always set it (app-validated in
--      recordTopup, lib/actions/finance.ts).
--    - photo_path: nullable — set only for bank_transfer (proof upload).
--    - reference already exists (0025) — now surfaced in the UI as "ETF Ref.
--      number"; no schema change needed, just a label.
--    - note already exists (0025) — stays, even though the rebuilt statement
--      (Batch 3) stopped rendering it on Add Balance rows; still collected
--      in the Add Balance form and visible in this new history popup's data,
--      just not on the printed statement.
--    - CHECK constraint mirrors pay_invoice()'s app-level rule at the DB
--      layer too: customer_topups has no RPC wrapper (recordTopup does a
--      plain table insert), so this is the only enforcement point below the
--      app. cash rows: method may be anything else (nullable) or 'cash',
--      free to carry or omit reference/photo (nulled by the app either way).
--      bank_transfer rows: reference AND photo_path both required.
-- ---------------------------------------------------------------------------
alter table public.customer_topups
  add column if not exists method     text,
  add column if not exists photo_path text;

alter table public.customer_topups
  drop constraint if exists customer_topups_method_check;
alter table public.customer_topups
  add constraint customer_topups_method_check
  check (method is null or method in ('cash', 'bank_transfer'));

alter table public.customer_topups
  drop constraint if exists customer_topups_bank_transfer_proof_check;
alter table public.customer_topups
  add constraint customer_topups_bank_transfer_proof_check
  check (
    method is distinct from 'bank_transfer'
    or (reference is not null and photo_path is not null)
  );

-- ---------------------------------------------------------------------------
-- 2. topup-proofs Storage bucket — PRIVATE, same pattern as invoice-proofs
--    (0027 section 8) and special-charge-images (0032 section 3). A separate
--    bucket rather than reusing invoice-proofs: topup proofs are keyed by
--    customer_id (no invoice exists yet at Add Balance time), a different
--    path shape than invoice-proofs' `${invoiceId}/proof-...` — same
--    one-bucket-per-proof-type precedent as those two. Storage key is
--    app-generated (`${customerId}/topup-${Date.now()}.${ext}`, see
--    recordTopup) — never the raw uploaded filename.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('topup-proofs', 'topup-proofs', false)
on conflict (id) do nothing;

create policy "topup_proofs_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'topup-proofs');

create policy "topup_proofs_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'topup-proofs');

create policy "topup_proofs_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'topup-proofs')
  with check (bucket_id = 'topup-proofs');

create policy "topup_proofs_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'topup-proofs');

commit;
