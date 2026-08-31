-- 0178_violation_notice_image.sql
-- TRAFFIC VIOLATIONS — an OPTIONAL notice photo, and the private bucket it
-- lives in. One nullable column, one bucket, four storage policies.
--
-- WHAT THIS FILE CREATES:
--   1. public.driver_violations.image_path (text, nullable)
--   2. storage bucket 'violation-images' (PRIVATE)
--   3. four policies violation_images_authenticated_{select,insert,update,delete}
--      on storage.objects
-- It creates NO table. The filename reads "violation_notice_image"; the object
-- in §1 is a COLUMN on an existing table. Read these lines, not the filename
-- (CLAUDE.md §5 — a migration's filename is not its object name).
--
-- DRAFTED, NOT APPLIED. Per CLAUDE.md §5 the architect runs it.
--
-- BARE STATEMENTS — no begin; / commit;. 0032 and 0157, the templates below,
-- carry them because they predate the 0173-v1 incident where a nested begin;
-- was ignored and the file's trailing commit; closed the SQL EDITOR's
-- transaction: every grid printed clean and nothing was created. This file has
-- none.
--
-- ===========================================================================
-- ONE FILE OWNS THE COLUMN AND ITS BUCKET — 0032's shape
--
-- TEMPLATED ON invoice_special_charges.image_path (0032 §2, :152) for the
-- column, and on 0157_issue_reports.sql (:267) for the bucket block.
--
-- Same shape on purpose: ONE optional internal image, addressed by a nullable
-- text path into a PRIVATE bucket, read back through a short-lived signed URL
-- from an internal-only control. Column name matches that precedent exactly.
--
-- 0032 creates special-charge-images AND its four policies in the same file as
-- the column. That is the convention and this file follows it. All 12 live
-- buckets were created BY a migration — 0027, 0031, 0032, 0040, 0047, 0067,
-- 0068, 0084, 0093, 0139, 0157, 0159 — so a `supabase db reset` reproduces the
-- column AND the bucket it points into. Creating the bucket out of band would
-- leave a restored database holding paths into a bucket that does not exist.
--
-- The multi-file alternative — a child table carrying storage_path + file_name
-- + mime_type (stock_receipt_files 0047:145, archive_document_files 0084) — is
-- the wrong shape here. One violation, one notice. 0047:140 states the same
-- split: a child table when there are many, a path column when there is one.
--
-- ===========================================================================
-- RE-RUN SAFETY — drop-if-exists then create, NOT `create policy if not exists`
--
-- Postgres has no IF NOT EXISTS for CREATE POLICY, and the form appears ZERO
-- times in this repo. The measured convention is `drop policy if exists ... on
-- storage.objects;` immediately before each `create policy` — used by 0047,
-- 0067, 0068, 0084, 0093, 0139, 0157, 0159, 0162 (9 files). The four oldest
-- bucket migrations (0027, 0031, 0032, 0040) use a bare create and would raise
-- 42710 on a second run; this file uses the current form instead.
--
-- The bucket insert is `on conflict (id) do nothing`, identical in 0032, 0157
-- and 0159.
--
-- FOUR SEPARATE POLICIES, and the infix spelled out. Two live buckets deviate
-- and are NOT copied: balance-return-proofs collapses to a single ALL policy
-- (0139:273) and exit-permits drops the _authenticated_ infix (0093:449).
--
-- NO bucket-level size or MIME limit is set, because none of the 12 live
-- buckets sets one. The 5 MB cap and the image allow-list are enforced in the
-- app by validateImageFile / ALLOWED_IMAGE_MIME (lib/utils.ts:44).
--
-- ===========================================================================
-- WHAT THIS DOES NOT TOUCH
--
-- v_driver_payslip_basis is the one view that reads driver_violations, and it is
-- NOT redefined here. A new column is invisible to a view that names its
-- columns, so §6's create-or-replace-can-only-APPEND rule (42P16) is not in play.
--
-- image_path is DISPLAY ONLY. No deduction, no freeze, no payslip figure reads
-- it, so this file does not change money and does not go through the money gate.
--
-- RLS on driver_violations needs no change: 0176 already enabled it with an
-- authenticated_all_* policy and revoked anon. A column inherits the table's
-- policies; there is nothing per-column to grant. RLS on storage.objects is
-- already enabled by Supabase — this file only adds policies to it.
--
-- Additive and METADATA-ONLY: a nullable text column with no default rewrites no
-- rows and backfills nothing, taking only a brief ACCESS EXCLUSIVE lock.
-- ===========================================================================

-- ---------------------------------------------------------------------
-- 1. THE COLUMN
-- ---------------------------------------------------------------------

alter table public.driver_violations
  add column if not exists image_path text;

comment on column public.driver_violations.image_path is
  'OPTIONAL pointer to a photo of the government violation notice, held in the PRIVATE violation-images bucket. NULL means no photo and is the normal case. The value is an APP-GENERATED storage key of the form driver_id/violation_id-epoch.ext, NEVER the uploaded filename — the same rule 0032 states for special-charge images, where raw filenames had broken before. Read back only through a short-lived signed URL issued by a server action; there is no public URL for this bucket anywhere in the app. DISPLAY ONLY: deductions, payslip freezing and v_driver_payslip_basis all ignore it, so it carries no money meaning. It SURVIVES A VOID on purpose — a voided violation keeps its evidence, matching invoices and exit_permits, whose proofs are likewise left in place when the row is voided.';

-- ---------------------------------------------------------------------
-- 2. THE BUCKET — private, no public URL anywhere in the app
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('violation-images', 'violation-images', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. THE FOUR STORAGE POLICIES — authenticated only, this bucket only
-- ---------------------------------------------------------------------

drop policy if exists "violation_images_authenticated_select" on storage.objects;
create policy "violation_images_authenticated_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'violation-images');

drop policy if exists "violation_images_authenticated_insert" on storage.objects;
create policy "violation_images_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'violation-images');

drop policy if exists "violation_images_authenticated_update" on storage.objects;
create policy "violation_images_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'violation-images')
  with check (bucket_id = 'violation-images');

drop policy if exists "violation_images_authenticated_delete" on storage.objects;
create policy "violation_images_authenticated_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'violation-images');

-- ===========================================================================
-- VERIFY AFTER APPLY — the catalog, not this file's result grid (CLAUDE.md §5).
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'driver_violations'
--     and column_name = 'image_path';
--   -- expect exactly ONE row: image_path | text | YES | null
--
--   select col_description(a.attrelid, a.attnum) is not null as has_comment
--   from pg_attribute a
--   where a.attrelid = 'public.driver_violations'::regclass
--     and a.attname = 'image_path';
--   -- expect true
--
--   select id, public from storage.buckets where id = 'violation-images';
--   -- expect one row, public = false
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'violation_images_%' order by policyname;
--   -- expect FOUR rows: delete, insert, select, update
-- ===========================================================================
