-- 0067_maintenance_part_photos.sql
-- Maintenance — Phase 3: per-part-line photo capture on a work order.
-- Mirrors preview/'s pages-2.js Parts Replaced photo grid (upload/view/
-- remove, up to 4 photos per line) — see MT.uploadPhoto/removePhoto/
-- openLightbox in that file.
--
-- PATTERN REUSE, NOT INVENTION: identical shape to stock_receipt_files +
-- the stock-receipt-invoices bucket (migration 0047) — a plain metadata
-- table (pointer + display name) backed by a private Storage bucket with
-- the same four authenticated-only policies. No RPC, same as
-- stock_receipt_files itself isn't wrapped in its own RPC beyond the
-- receipt-creation flow that inserts it — here uploads happen post-hoc,
-- one at a time, against an already-existing work_order_parts line, so a
-- plain server-action insert/delete is the right shape (no invariant to
-- protect, no security-definer needed — same reasoning 0043's warehouses/
-- parts tables gave for having no RPCs at all).
--
-- *** NO COUPLING TO THE CONSUMPTION LEDGER OR ANY STOCK PATH *** — this
-- table only references work_order_parts.id (cascade on delete, so a
-- line's photos disappear if the line itself is ever removed — same as
-- reversal's own "delete the settled line" precedent). It does NOT touch
-- price_lots, parts.qty_on_hand, stock_movements, or
-- work_order_part_consumptions in any way, and no existing RPC
-- (consume_work_order_line/return_to_lots/deduct_work_order_parts/
-- edit_work_order/create_work_order/start_work_order/complete_work_order)
-- is touched by this migration. Photos are pure documentation.
--
-- COUNT/SIZE LIMITS are enforced app-side (Phase 3's app-code follow-up),
-- same split as stock_receipt_files' own mandatory-invoice-count check
-- living in receive_loose_parts rather than a DB constraint — a "max 4
-- rows per work_order_part_id" isn't something a CHECK constraint can
-- express cleanly (would need a trigger), and preview's own limits (4
-- photos, 2 MB/file) are UX guardrails, not data-integrity rules, so a
-- plain app-level check is the right level for them, not a DB one.
--
-- RLS: "authenticated_all_<table>" — same house pattern as every other
-- lookup/operational table.

begin;

-- ----------------------------------------------------------------------------
-- work_order_part_photos — metadata for photos attached to a replaced
-- part line. Actual bytes live in the maintenance-photos Storage bucket
-- below; this table is just the pointer + display name.
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_part_photos (
  id                  uuid primary key default gen_random_uuid(),
  work_order_part_id  uuid not null references public.work_order_parts(id) on delete cascade,
  storage_path        text not null,
  file_name           text not null,
  mime_type           text,
  uploaded_at         timestamptz not null default now()
);

create index if not exists work_order_part_photos_wop_id_idx
  on public.work_order_part_photos (work_order_part_id);

alter table public.work_order_part_photos enable row level security;
drop policy if exists "authenticated_all_work_order_part_photos" on public.work_order_part_photos;
create policy "authenticated_all_work_order_part_photos"
  on public.work_order_part_photos for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- maintenance-photos Storage bucket — PRIVATE, identical pattern to
-- stock-receipt-invoices (0047) / topup-proofs (0040) / invoice-pdfs
-- (0031): public=false, four policies (select/insert/update/delete), all
-- scoped to `to authenticated` with no per-row narrowing (same "logged in
-- or not" access model every bucket in this app already uses). App-
-- generated storage key expected shape:
-- `${workOrderPartId}/photo-${Date.now()}.${ext}` — never the raw
-- uploaded filename, same convention as every other bucket here.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('maintenance-photos', 'maintenance-photos', false)
on conflict (id) do nothing;

drop policy if exists "maintenance_photos_authenticated_select" on storage.objects;
create policy "maintenance_photos_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'maintenance-photos');

drop policy if exists "maintenance_photos_authenticated_insert" on storage.objects;
create policy "maintenance_photos_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'maintenance-photos');

drop policy if exists "maintenance_photos_authenticated_update" on storage.objects;
create policy "maintenance_photos_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'maintenance-photos')
  with check (bucket_id = 'maintenance-photos');

drop policy if exists "maintenance_photos_authenticated_delete" on storage.objects;
create policy "maintenance_photos_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'maintenance-photos');

commit;
