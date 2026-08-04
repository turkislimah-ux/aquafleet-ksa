-- 0084_archive_documents.sql
-- Archive page rebuild, Phase 1 — the UNIVERSAL document schema.
--
-- Turki's model is two-step: create a GROUP (title + optional description +
-- color + its own expiring-soon threshold in days), then add DOCUMENTS to
-- that group. One schema serves ALL FOUR tabs (Company now; Staff / Truck /
-- Customer in Phases 2-3) — the tab is a column on the group, not a
-- separate table per tab.
--
-- This migration is ADDITIVE ONLY: 3 new tables + 1 new private storage
-- bucket. It alters NO existing table, drops nothing, and adds NO function
-- (so there is nothing new for the 0083 anon-hardening pass to re-cover —
-- see the "no RPC" note at the bottom for why plain CRUD is correct here).
--
-- ===========================================================================
-- DESIGN DECISION 1 — SUBJECT LINKING (three nullable FK columns)
-- ===========================================================================
-- A document may optionally belong to a subject: a driver, a staff member,
-- or a truck (three separate tables in this app). Company documents have no
-- subject at all. Three shapes were considered:
--
--   (a) polymorphic (subject_type text + subject_id uuid, NO FK) — rejected:
--       zero referential integrity, a deleted driver silently orphans rows.
--   (b) one join table per subject type — rejected: three extra tables and
--       a three-way UNION on every read, for what is a single optional link.
--   (c) THREE NULLABLE FK COLUMNS + a CHECK that at most one is set — CHOSEN.
--
-- (c) keeps real FK integrity per subject, and — critically — it does NOT
-- reintroduce the 0077 PostgREST hazard. That incident was specifically about
-- a SECOND FK between the SAME table pair (trucks had assigned_driver_id AND
-- driver_before_maintenance, both -> drivers, so a plain trucks->drivers
-- embed became ambiguous and Fleet broke). Here each pair appears exactly
-- ONCE: archive_documents->drivers, archive_documents->staff,
-- archive_documents->trucks. Three FKs, three DIFFERENT target tables, so
-- every embed stays unambiguous.
--
-- DELETE BEHAVIOUR (architect's call at apply time, and the right one): the
-- three SUBJECT FKs are ON DELETE RESTRICT, not cascade. A regulatory
-- document must OUTLIVE its subject — the spec's own soft-delete sub-tabs
-- exist precisely because a terminated driver's documents still matter. With
-- RESTRICT, a hard delete of a driver/staff/truck from outside the archive is
-- REFUSED rather than silently destroying compliance records. This also lines
-- up with the app-wide "soft-delete, not hard-delete" architecture lock
-- (terminated_at on drivers/trucks/staff) — a terminated subject keeps its
-- row, so its documents keep resolving normally.
--
-- group_id stays ON DELETE CASCADE by contrast: deleting a group is an
-- explicit, deliberate act INSIDE the archive on the container itself, not a
-- side effect of unrelated cleanup elsewhere in the app.
--
-- VERIFIED BEFORE WRITING THIS (live, via the Supabase MCP): a query for any
-- table pair already carrying >1 FK returned ZERO rows across drivers/staff/
-- trucks — i.e. the 0077 duplicate was the only one and it is long gone, and
-- these three new FKs each add a first-and-only link for their pair. No
-- existing embed anywhere in the app is affected (nothing embeds a table
-- that doesn't exist yet).
--
-- ===========================================================================
-- DESIGN DECISION 2 — RENEWAL HISTORY (append-only child table)
-- ===========================================================================
-- Renewing must PRESERVE the superseded version — regulators ask about past
-- coverage, so an UPDATE-in-place that overwrites issue/expiry dates is
-- exactly wrong. Two shapes were considered:
--
--   (a) version rows in archive_documents itself (self-FK + is_current flag)
--       — rejected: every read of "the current documents" then needs a
--       WHERE is_current, and any missed filter silently double-counts a
--       document in the expiry summary. One wrong query = wrong compliance
--       numbers.
--   (b) a SEPARATE append-only history table — CHOSEN.
--
-- archive_documents always holds exactly ONE row per document = its CURRENT
-- state. Renewing writes the OUTGOING values into archive_document_renewals
-- (append-only), then updates the parent row in place with the new dates.
-- Consequences that make this the safer shape:
--   - "current documents" is just `select * from archive_documents` — no
--     filter to forget, so the expiry summary can't double-count.
--   - history is structurally append-only (nothing updates it), which is the
--     same discipline stock_movements / work_order_part_consumptions already
--     use in this app for audit trails.
--   - a document's file set follows the CURRENT version (files table FKs the
--     document); superseded-version files stay attached to their renewal row
--     via the same files table's nullable renewal_id — so an old license scan
--     is still retrievable, not deleted.
--
-- ===========================================================================
-- DESIGN DECISION 3 — STATUS IS DERIVED, NEVER STORED
-- ===========================================================================
-- Valid / Expiring soon / Expired is computed at READ time from
-- (expiry_date, the group's own warning_days). No status column exists
-- anywhere in this migration, deliberately: a stored status silently goes
-- stale the moment a date passes with no write to the row. Same rule as this
-- app's derived driver-state (lib/driver-state.ts) and derived truck-status
-- (lib/truck-status.ts), both of which are computed per-render and never
-- persisted. Phase 1's app code will own this computation in a lib/ helper.
--
-- ===========================================================================
-- DESIGN DECISION 4 — NO MATERIALIZED EMPTY ROWS (Phase-2 requirement)
-- ===========================================================================
-- In Phases 2-3, the Staff/Truck tabs show EVERY driver/truck as a row in
-- EVERY group, with the gaps visible (that's the point — a missing document
-- is the finding). Those empty rows are DERIVED at display time by
-- LEFT JOINing the subject list against this table. The schema therefore
-- requires NO placeholder/empty document rows to exist, and nothing here
-- forces one: archive_documents rows are created only when a real document
-- is added. This note exists so a future phase doesn't "helpfully" start
-- inserting empty rows to make a grid easier to render.

begin;

-- ---------------------------------------------------------------------------
-- 1) archive_document_groups — the user-created group (the two-step model's
--    first step). `tab` is what makes one schema serve all four tabs.
--    `warning_days` is PER-GROUP (Turki's explicit ask): a vehicle licence
--    might warn at 30 days while an insurance policy warns at 90.
-- ---------------------------------------------------------------------------
create table if not exists public.archive_document_groups (
  id           uuid primary key default gen_random_uuid(),
  tab          text not null check (tab in ('company', 'staff', 'truck', 'customer')),
  title        text not null,
  description  text,
  -- Free-form color token chosen in the UI. Kept as text (not an enum) for
  -- the same reason parts.category is free text — the palette is a UI
  -- concern and shouldn't need a migration to extend.
  color        text,
  -- Expiring-soon window for every document in THIS group. Positive-only;
  -- a 0-day window would make "expiring soon" meaningless (it would equal
  -- "expired"), so the CHECK forbids it.
  warning_days integer not null default 30 check (warning_days > 0),
  -- Display order within a tab; ties broken by created_at at read time.
  sort_order   integer not null default 0,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists archive_document_groups_tab_idx
  on public.archive_document_groups (tab, sort_order, created_at);

alter table public.archive_document_groups enable row level security;
drop policy if exists "authenticated_all_archive_document_groups" on public.archive_document_groups;
create policy "authenticated_all_archive_document_groups"
  on public.archive_document_groups for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2) archive_documents — one row per document = its CURRENT state.
--    The four universal inputs (reference number / issue date / expiry date /
--    note) are deliberately generic so ONE form fits any regulatory document.
--    Every one is NULLABLE except the group link: a document can legitimately
--    have no expiry (a permanent CR extract), no reference number, or be
--    filed before its dates are known.
-- ---------------------------------------------------------------------------
create table if not exists public.archive_documents (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.archive_document_groups(id) on delete cascade,
  title         text not null,
  reference_no  text,
  issue_date    date,
  expiry_date   date,
  note          text,

  -- OPTIONAL subject link — see DESIGN DECISION 1. Exactly one of these may
  -- be set (or none, for a company document). ON DELETE RESTRICT: a
  -- regulatory document must SURVIVE its subject, so a hard delete of a
  -- driver/staff/truck from outside the archive is refused rather than
  -- silently destroying compliance records.
  driver_id     uuid references public.drivers(id) on delete restrict,
  staff_id      uuid references public.staff(id)   on delete restrict,
  truck_id      uuid references public.trucks(id)  on delete restrict,

  created_by    text,
  created_at    timestamptz not null default now(),

  -- At most one subject. num_nonnulls(...) = 0 is the company case.
  -- Mirrors leave_periods' own one-person CHECK (0012), which uses the same
  -- num_nonnulls idiom for exactly this "exactly one of N FKs" shape.
  constraint archive_documents_one_subject
    check (num_nonnulls(driver_id, staff_id, truck_id) <= 1),

  -- A document can't expire before it was issued. Both nullable, so this
  -- only fires when BOTH are present.
  constraint archive_documents_date_order
    check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);

create index if not exists archive_documents_group_idx
  on public.archive_documents (group_id, created_at desc);
-- The expiry summary + the red/yellow highlighting both scan by expiry_date;
-- partial index skips the no-expiry rows those queries never care about.
create index if not exists archive_documents_expiry_idx
  on public.archive_documents (expiry_date) where expiry_date is not null;
-- Phase 2-3: the Staff/Truck grids LEFT JOIN subjects against these.
create index if not exists archive_documents_driver_idx on public.archive_documents (driver_id) where driver_id is not null;
create index if not exists archive_documents_staff_idx  on public.archive_documents (staff_id)  where staff_id  is not null;
create index if not exists archive_documents_truck_idx  on public.archive_documents (truck_id)  where truck_id  is not null;

alter table public.archive_documents enable row level security;
drop policy if exists "authenticated_all_archive_documents" on public.archive_documents;
create policy "authenticated_all_archive_documents"
  on public.archive_documents for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) archive_document_renewals — APPEND-ONLY history. One row per SUPERSEDED
--    version (see DESIGN DECISION 2). These are snapshots of what the parent
--    row used to hold, never live values — so they are plain columns, not
--    FKs to anything that could later change underneath them.
-- ---------------------------------------------------------------------------
create table if not exists public.archive_document_renewals (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.archive_documents(id) on delete cascade,
  -- The superseded values, snapshotted at renewal time.
  reference_no  text,
  issue_date    date,
  expiry_date   date,
  note          text,
  -- When this version was replaced (i.e. when the renewal happened).
  superseded_at timestamptz not null default now(),
  superseded_by text,
  created_at    timestamptz not null default now()
);

create index if not exists archive_document_renewals_document_idx
  on public.archive_document_renewals (document_id, superseded_at desc);

alter table public.archive_document_renewals enable row level security;
drop policy if exists "authenticated_all_archive_document_renewals" on public.archive_document_renewals;
create policy "authenticated_all_archive_document_renewals"
  on public.archive_document_renewals for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) archive_document_files — MULTIPLE files per document (front/back scans,
--    receipts). Same shape as workshop_payment_files (0068) /
--    work_order_part_photos (0067): metadata row here, bytes in a private
--    bucket, signed URLs fetched on demand.
--
--    renewal_id (nullable) is what keeps a superseded version's OWN scans
--    retrievable: files uploaded against the current version have it NULL;
--    when a renewal happens the app stamps the outgoing files with the new
--    renewal row's id, so they stay attached to the version they belong to
--    instead of being deleted or silently re-attributed to the new one.
-- ---------------------------------------------------------------------------
create table if not exists public.archive_document_files (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.archive_documents(id) on delete cascade,
  renewal_id   uuid references public.archive_document_renewals(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  uploaded_at  timestamptz not null default now()
);

create index if not exists archive_document_files_document_idx
  on public.archive_document_files (document_id, uploaded_at);
create index if not exists archive_document_files_renewal_idx
  on public.archive_document_files (renewal_id) where renewal_id is not null;

alter table public.archive_document_files enable row level security;
drop policy if exists "authenticated_all_archive_document_files" on public.archive_document_files;
create policy "authenticated_all_archive_document_files"
  on public.archive_document_files for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5) archive-documents Storage bucket — PRIVATE, identical four-policy
--    pattern to outsourced-invoices (0068) / maintenance-photos (0067) /
--    stock-receipt-invoices (0047).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('archive-documents', 'archive-documents', false)
on conflict (id) do nothing;

drop policy if exists "archive_documents_authenticated_select" on storage.objects;
create policy "archive_documents_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'archive-documents');

drop policy if exists "archive_documents_authenticated_insert" on storage.objects;
create policy "archive_documents_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'archive-documents');

drop policy if exists "archive_documents_authenticated_update" on storage.objects;
create policy "archive_documents_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'archive-documents')
  with check (bucket_id = 'archive-documents');

drop policy if exists "archive_documents_authenticated_delete" on storage.objects;
create policy "archive_documents_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'archive-documents');

commit;

-- ===========================================================================
-- NO RPC — deliberate, flagged rather than assumed.
-- ===========================================================================
-- Every mutation here is plain single-table CRUD with no cross-table
-- invariant to protect: no counter/sequence (nothing is gap-free numbered),
-- no stock, no money, no multi-table transaction. That matches this app's
-- own established "plain write, no RPC" precedent — updateRepairer /
-- deleteRepairer, the part-photo upload/remove path, and staff_commissions
-- (0080), all of which are plain writes for exactly this reason.
--
-- The ONE operation with a sequencing concern is RENEW (insert history row,
-- then update the parent). If that ever needs to be atomic, it becomes an
-- RPC — and per the 0083 anon hardening it must then be created with
-- SECURITY DEFINER + SET search_path = public + GRANT EXECUTE TO
-- authenticated ONLY (never PUBLIC/anon). Phase 1 does not add one; the
-- worst case on a partial failure is a history row without its parent
-- update, which is visible and re-doable, not silent corruption.
