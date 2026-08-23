-- 0157_issue_reports.sql
-- Feature 2 (Settings), phase 2.1 — the user issue-report queue, with an
-- optional image attachment. DATA LAYER ONLY: no UI, no server actions. The
-- reporting popup and the upload flow are phase 2.2.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect applies via MCP.
--
-- ===========================================================================
-- WHAT THIS IS
-- ===========================================================================
-- A ticket queue for problems the two users hit while using the app. One row
-- per report: who raised it, what page they were on, what is wrong, optionally
-- a screenshot, and how it was resolved. Deliberately a plain table — no
-- workflow engine, no assignment, no priority. Two people share it; anything
-- more is machinery neither of them asked for.
--
-- THE BUCKET IS CREATED HERE. Checked before assuming: all ten existing buckets
-- were created by migrations (0027, 0031, 0032, 0040, 0047, 0067, 0068, 0084,
-- 0093, 0139), each with `insert into storage.buckets ... on conflict do
-- nothing`. This file follows that. The architect does not need to create
-- anything by hand.
--
-- ===========================================================================
-- NULLABLE reporter_id / resolved_by — THE LESSON FROM THE EARLIER DRAFT
-- ===========================================================================
-- Both are NULLABLE with `on delete set null`, and that pairing is the point.
-- An earlier draft had `reporter_id uuid NOT NULL ... on delete set null`, which
-- is SELF-CONTRADICTORY: deleting an auth user makes Postgres try to write NULL
-- into a NOT NULL column, so the delete fails with an opaque 23502 instead of
-- either succeeding or refusing on purpose.
--
-- Insert-time integrity does NOT come from NOT NULL. It comes from the RLS
-- WITH CHECK below: `reporter_id = auth.uid()` is false when reporter_id is
-- null, so a null-reporter row cannot be inserted by an authenticated caller.
-- NULL therefore only ever appears later, when an account is deleted — and it
-- correctly means "reported by someone no longer here", which is worth keeping
-- rather than a reason to lose the report.
--
-- ===========================================================================
-- STATUS: A PLAIN ENUM CHECK, DELIBERATELY NOT A STATE MACHINE
-- ===========================================================================
--   open -> in_progress -> resolved   is the happy path.
--   needs_info                        is a rejection back to the reporter.
--   resolved -> open                  IS ALLOWED. Tickets reopen.
--
-- NO TRANSITION CONSTRAINTS. Two users, in the same room, sharing one queue —
-- the cost of the database refusing a legitimate move is higher than the cost
-- of a wrong status somebody fixes in five seconds.
--
-- ALSO CONSIDERED AND REJECTED: a shape constraint tying resolved_at/resolved_by
-- to status = 'resolved'. It reads tidy, but it turns "reopen this ticket" into
-- an atomic two-column clear the app must get exactly right, and the first time
-- it does not, a legitimate reopen fails with a check violation. Given
-- reopening is explicitly supported, that constraint would be a trap set for the
-- feature it is meant to protect. resolution_note likewise carries either the
-- resolver's note OR the clarification request when status = 'needs_info', and
-- nothing polices which — the status says which one it is.
--
-- ===========================================================================
-- THE ATTACHMENT: ONE OPTIONAL PATH COLUMN, NOT A CHILD TABLE
-- ===========================================================================
-- `attachment_path text` — NULLABLE, because most reports will not have one.
--
-- It stores THE STORAGE PATH ONLY. Never bytes, never base64. A base64 image in
-- a text column bloats every SELECT of the queue, breaks the row-size budget on
-- a screenshot of any size, and makes the list view expensive for a thumbnail
-- nobody asked to see yet.
--
-- ONE COLUMN RATHER THAN AN attachments CHILD TABLE, per the brief and because
-- a single optional screenshot does not need a one-to-many. If a report ever
-- needs several images, THAT is the moment to add the child table — adding it
-- now would mean a join on every read for a cardinality of at most one.
--
-- PATH CONVENTION (for 2.2, not enforced here): app-generated and unique, never
-- the user's raw filename — same rule as every other bucket in this app
-- (0139's is `${customerId}/return-${Date.now()}.${ext}`). Uniqueness per upload
-- is what makes the narrow storage policy below sufficient; see there.
--
-- ===========================================================================
-- updated_at IS A TRIGGER, AND HERE IS THE EVIDENCE FOR THAT CHOICE
-- ===========================================================================
-- Measured before deciding: `company_settings.updated_at` is the only
-- comparable column in this schema, it has NO trigger, NO app code writes it,
-- and it currently reads 35 days stale. That is exactly the failure mode of
-- "the server action will set it" — it works until the second writer, or the
-- first writer someone forgets to update.
--
-- On a TICKET QUEUE that matters more than on a settings singleton: updated_at
-- is the column a person sorts by to find what moved today, and a silently
-- stale sort key is worse than no sort key. So the database maintains it.
--
-- BEFORE UPDATE triggers are already established here (0114's station guard), so
-- this introduces no new machinery. The trigger fires only when the row ACTUALLY
-- changed (`old.* is distinct from new.*`) — otherwise "last updated" would mean
-- "last written to", and re-saving an unchanged form would look like activity.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- company_settings, every notification object (0154/0155/0156), every money
-- view, pricing/commission/rates/invoicing, and every other storage bucket. It
-- only creates new objects; it alters nothing that exists.
--
-- issue_reports is a TABLE, not a view, so security_invoker does not apply. RLS
-- plus an explicit anon revoke is the gate. The site-wide view count is
-- untouched at 50 / 50 / 0 — verification block F confirms rather than assumes.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Shared updated_at trigger function.
--
-- `create or replace` so it is idempotent and so a later migration wanting the
-- same behaviour reuses this one rather than defining a second, slightly
-- different copy. Deliberately generic — it names no table and reads no column
-- but updated_at.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps NEW.updated_at = now(). Generic on purpose — attach it to any table with an updated_at column rather than writing a second near-identical function. Introduced by 0157.';

-- ---------------------------------------------------------------------
-- 2. THE TABLE
-- ---------------------------------------------------------------------
create table if not exists public.issue_reports (
  id              uuid        primary key default gen_random_uuid(),

  -- NULLABLE by design — see the header. RLS pins it to auth.uid() at insert;
  -- NULL here only ever means "the account was deleted afterwards".
  reporter_id     uuid        default auth.uid()
                              references auth.users(id) on delete set null,

  category        text        not null,
  title           text        not null,
  description     text,

  -- The route the reporter was on when they hit the problem. Captured by the
  -- app in phase 2.2 so a report is actionable without the reporter having to
  -- describe where they were — the detail people most often omit.
  page_route      text,

  -- Optional screenshot. STORAGE PATH ONLY, into the issue-report-images
  -- bucket created below. Never bytes, never base64 — see the header.
  attachment_path text,

  status          text        not null default 'open',

  -- Dual-purpose by design: the resolver's note when resolved, or the
  -- clarification being asked for when status = 'needs_info'. `status` says
  -- which, so a second column would only ever be the one nobody filled in.
  resolution_note text,

  resolved_by     uuid        references auth.users(id) on delete set null,
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint issue_reports_category_check
    check (category in ('bug','data','feature','question','other')),

  constraint issue_reports_status_check
    check (status in ('open','in_progress','needs_info','resolved')),

  -- A title of spaces is not a title. Cheap to enforce, and it is the one field
  -- the queue is unusable without.
  constraint issue_reports_title_nonblank
    check (nullif(btrim(title), '') is not null),

  -- An attachment_path of whitespace is a path to nothing. NULL means "no
  -- attachment"; '' or '   ' means "someone wrote an empty string", and the two
  -- must not be confusable when 2.2 decides whether to render an image.
  constraint issue_reports_attachment_path_nonblank
    check (attachment_path is null or nullif(btrim(attachment_path), '') is not null)
);

-- Queue reads are "open tickets, newest first" and "everything, newest first".
create index if not exists issue_reports_status_created_idx
  on public.issue_reports (status, created_at desc);
create index if not exists issue_reports_created_idx
  on public.issue_reports (created_at desc);

drop trigger if exists issue_reports_set_updated_at on public.issue_reports;
create trigger issue_reports_set_updated_at
  before update on public.issue_reports
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS on the table. Enabled, anon revoked, three policies and no fourth.
--
-- SELECT and UPDATE are open to any authenticated user because the team is two
-- people sharing one queue: either can triage, resolve or reopen the other's
-- ticket. Per-reporter restrictions would mean a report can only be fixed by
-- the person who cannot fix it.
--
-- INSERT is the one that is pinned. WITH CHECK (reporter_id = auth.uid()) means
-- a report cannot be filed under someone else's name, and — see the header — it
-- is also what makes the nullable reporter_id safe.
--
-- NO DELETE POLICY, on purpose. A report is closed by status, never removed:
-- deleting the record of a problem is how the same problem gets rediscovered
-- from scratch six months later. RLS denies by default, so the absence of a
-- policy IS the denial.
-- ---------------------------------------------------------------------
alter table public.issue_reports enable row level security;

drop policy if exists issue_reports_insert_own on public.issue_reports;
create policy issue_reports_insert_own
  on public.issue_reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists issue_reports_select_all on public.issue_reports;
create policy issue_reports_select_all
  on public.issue_reports for select to authenticated
  using (true);

drop policy if exists issue_reports_update_all on public.issue_reports;
create policy issue_reports_update_all
  on public.issue_reports for update to authenticated
  using (true) with check (true);

revoke all on public.issue_reports from anon;

comment on table public.issue_reports is
  'User issue-report queue (0157) — one row per problem a user reports from inside the app, with the route they were on and an optional screenshot path. Status is a plain enum (open / in_progress / needs_info / resolved) with NO transition constraints: tickets reopen, and a database that refuses a legitimate move costs more than a wrong status somebody fixes in seconds. resolution_note holds the resolver''s note, or the clarification request when status = needs_info. attachment_path is a storage path into issue-report-images, never image bytes. reporter_id and resolved_by are nullable with ON DELETE SET NULL so deleting an account does not fail or destroy the report; insert-time authorship is pinned by the RLS WITH CHECK instead. Both users read and update every row (two-person team). No DELETE policy — a report is closed, never deleted.';

comment on column public.issue_reports.attachment_path is
  'Storage path into the PRIVATE issue-report-images bucket, or NULL for no attachment. Path only — never bytes, never base64. Read back through a signed URL; the bucket is not public.';

-- ---------------------------------------------------------------------
-- 4. Storage bucket for issue-report screenshots — PRIVATE.
--
-- A separate bucket rather than reusing an existing one, following the same
-- one-bucket-per-purpose precedent as invoice-proofs (0027), special-charge-
-- images (0032), topup-proofs (0040), maintenance-photos (0067) and
-- balance-return-proofs (0139). PRIVATE like all ten of them — reads go through
-- a signed URL, never a public link.
--
-- POLICY SHAPE — TWO PATTERNS EXIST IN THIS SCHEMA AND THIS TAKES THE DOMINANT
-- ONE. Nine buckets use four granular policies named
-- `<bucket>_authenticated_{select,insert,update,delete}`; the newest (0139) uses
-- a single `for all` policy. This follows the nine, and grants the same FULL
-- CRUD to authenticated that all ten existing buckets have.
--
-- WHY FULL CRUD AND NOT JUST READ+UPLOAD: the 2.2 form lets a reporter replace
-- or remove a screenshot they attached by mistake. Replace needs UPDATE, remove
-- needs DELETE. Granting only SELECT+INSERT would mean the upload works and the
-- correction silently fails with an RLS error on the one action a flustered user
-- is most likely to take — right after attaching the wrong image.
--
-- ANON GETS NOTHING, on this bucket as on every other: there is no anon policy
-- anywhere on storage.objects, and none is added here. Private bucket, reads via
-- signed URL.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('issue-report-images', 'issue-report-images', false)
on conflict (id) do nothing;

drop policy if exists "issue_report_images_authenticated_select" on storage.objects;
create policy "issue_report_images_authenticated_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'issue-report-images');

drop policy if exists "issue_report_images_authenticated_insert" on storage.objects;
create policy "issue_report_images_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-report-images');

drop policy if exists "issue_report_images_authenticated_update" on storage.objects;
create policy "issue_report_images_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'issue-report-images')
  with check (bucket_id = 'issue-report-images');

drop policy if exists "issue_report_images_authenticated_delete" on storage.objects;
create policy "issue_report_images_authenticated_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'issue-report-images');

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- A new table. PostgREST reloads on the DDL event; if a select 404s with
-- PGRST205 ("Could not find the table ... in the schema cache"), nudge it:
--     notify pgrst, 'reload schema';
--
-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE TABLE EXISTS, RLS IS ON, ANON IS LOCKED OUT.
--      select c.relname, c.relkind, c.relrowsecurity as rls_enabled,
--             has_table_privilege('anon', c.oid, 'select') as anon_select,
--             has_table_privilege('anon', c.oid, 'insert') as anon_insert,
--             has_table_privilege('anon', c.oid, 'update') as anon_update
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='issue_reports';
--      -- expect: r / true / false / false / false
--
-- B) attachment_path IS NULLABLE, AND IS TEXT.
--      select attname, format_type(atttypid, atttypmod) as type, attnotnull
--        from pg_attribute
--       where attrelid='public.issue_reports'::regclass
--         and attname in ('attachment_path','reporter_id','resolved_by','title','status')
--       order by attname;
--      -- expect attachment_path text / false  (nullable)
--      --        reporter_id     uuid / false
--      --        resolved_by     uuid / false
--      --        status          text / true
--      --        title           text / true
--
-- C) THREE TABLE POLICIES, AND NO DELETE POLICY.
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname='public' and tablename='issue_reports'
--       order by cmd, policyname;
--      -- expect exactly 3: INSERT (with_check reporter_id = auth.uid()),
--      -- SELECT (qual true), UPDATE (true/true) — all {authenticated}.
--      -- No DELETE row: RLS denies by default.
--
-- D) THE CHECK CONSTRAINTS REJECT BAD VALUES. Every probe must ERROR, and all
--    are rolled back so nothing is written.
--
--      -- bad category -> 23514 issue_reports_category_check
--      begin;
--        insert into public.issue_reports (reporter_id, category, title)
--        values (null, 'nonsense', 'probe');
--      rollback;
--
--      -- bad status -> 23514 issue_reports_status_check
--      begin;
--        insert into public.issue_reports (reporter_id, category, title, status)
--        values (null, 'bug', 'probe', 'wontfix');
--      rollback;
--
--      -- blank title -> 23514 issue_reports_title_nonblank
--      begin;
--        insert into public.issue_reports (reporter_id, category, title)
--        values (null, 'bug', '   ');
--      rollback;
--
--      -- blank attachment_path -> 23514 issue_reports_attachment_path_nonblank
--      begin;
--        insert into public.issue_reports (reporter_id, category, title, attachment_path)
--        values (null, 'bug', 'probe', '   ');
--      rollback;
--
--      -- POSITIVE: all five categories insert, and a NULL attachment is fine
--      begin;
--        insert into public.issue_reports (reporter_id, category, title, attachment_path)
--        select null, c, 'probe ' || c, null
--          from unnest(array['bug','data','feature','question','other']) c;
--        select count(*) as inserted,
--               count(*) filter (where attachment_path is null) as without_attachment
--          from public.issue_reports where title like 'probe %';
--        -- expect 5 / 5
--      rollback;
--
--    NOTE: these pass reporter_id explicitly as NULL because they run in the SQL
--    editor, where auth.uid() is NULL and the table owner bypasses RLS. From the
--    app the INSERT policy applies and reporter_id must equal auth.uid() — that
--    half is verified in the browser at 2.2.
--
-- E) THE BUCKET EXISTS, IS PRIVATE, AND ITS POLICIES ARE RIGHT.
--      select id, name, public from storage.buckets where id = 'issue-report-images';
--      -- expect one row, public = false
--
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and policyname like 'issue_report_images%'
--       order by cmd;
--      -- expect exactly 4 rows, all {authenticated} — full CRUD, matching the
--      -- other ten buckets:
--      --   DELETE  qual       (bucket_id = 'issue-report-images')
--      --   INSERT  with_check (bucket_id = 'issue-report-images')
--      --   SELECT  qual       (bucket_id = 'issue-report-images')
--      --   UPDATE  qual + with_check (bucket_id = 'issue-report-images')
--      -- No anon row.
--
--      -- The count, stated separately so a missing policy is obvious:
--      select count(*) as issue_report_image_policies
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and policyname like 'issue_report_images%';
--      -- expect 4
--
--      -- anon must match NO policy on this bucket:
--      select count(*) as anon_policies_on_bucket
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and roles::text like '%anon%'
--         and coalesce(qual,'') || coalesce(with_check,'') like '%issue-report-images%';
--      -- expect 0
--
-- F) NOTHING ELSE MOVED.
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 50 / 50 / 0 — UNCHANGED. This file adds a table, not a view.
--
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 82 / 82  (was 81 / 81 before this file)
--
--      select count(*) as buckets from storage.buckets;
--      -- expect 11 (was 10)
--
--      select (select count(*) from public.v_active_alerts) as alerts,
--             (select count(*) from public.notification_dismissals) as dismissals;
--      -- expect 9 / 2, unchanged
--
-- G) updated_at IS MAINTAINED BY THE DATABASE, AND ONLY ON REAL CHANGES.
--      begin;
--        insert into public.issue_reports (reporter_id, category, title)
--        values (null, 'bug', 'touch probe');
--
--        update public.issue_reports set status = 'in_progress' where title = 'touch probe';
--        select updated_at > created_at as bumped_on_real_change
--          from public.issue_reports where title = 'touch probe';
--        -- expect true
--
--        select updated_at as before_noop from public.issue_reports where title = 'touch probe';
--        update public.issue_reports set status = 'in_progress' where title = 'touch probe';
--        select updated_at as after_noop from public.issue_reports where title = 'touch probe';
--        -- expect before_noop = after_noop  (the WHEN clause)
--      rollback;
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   begin;
--   drop policy if exists "issue_report_images_authenticated_select" on storage.objects;
--   drop policy if exists "issue_report_images_authenticated_insert" on storage.objects;
--   delete from storage.buckets where id = 'issue-report-images';
--   drop table if exists public.issue_reports;         -- takes its trigger with it
--   drop function if exists public.set_updated_at();   -- ONLY if nothing else uses it
--   commit;
--
-- TWO ORDER-OF-OPERATIONS TRAPS:
--
-- 1. `delete from storage.buckets` FAILS if the bucket still holds objects
--    (foreign key from storage.objects). Empty it first, and be sure that is
--    what you want — those are user-submitted screenshots:
--      select count(*) from storage.objects where bucket_id = 'issue-report-images';
--
-- 2. set_updated_at is generic and a later migration may have attached it to
--    another table. Check before dropping:
--      select tgrelid::regclass as attached_to
--        from pg_trigger
--       where tgfoid = 'public.set_updated_at'::regproc and not tgisinternal;
--      -- anything other than issue_reports means KEEP the function.
-- ===========================================================================
