-- 0159_user_profiles.sql
-- Feature 2 (Settings), phase 2.2c — the self-entered personal profile.
-- DATA LAYER ONLY: no UI, no server actions. The Profile section is step 2.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect applies via MCP.
--
-- ===========================================================================
-- THE HARD BOUNDARY — READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
-- ===========================================================================
-- This table holds ONLY information a user typed about themselves, for their
-- colleagues to see. It is NOT an employee record and must never become one.
--
--   NO foreign key to staff, drivers or leave_periods. Not now, not later,
--   not "just a nullable staff_id for convenience".
--   NO iqama, no salary, no leave, no employment dates, no HR role.
--   NO backfill FROM an employee record into these columns.
--   NO join TO one in any view, RPC or query.
--
-- All three of those tables exist in this schema right now — measured:
-- `drivers`, `leave_periods`, `staff` are all present in public. So the link is
-- one line away at any time, and the only thing preventing it is that nobody
-- writes that line.
--
-- THE ABSENCE OF AN auth-TO-EMPLOYEE LINK IS A SAFETY FEATURE, NOT A GAP.
-- Right now there is no path from "who is logged in" to "which employee record
-- is this". That means no accidental query can widen from a cosmetic profile to
-- payroll, leave balances or identity documents, because the join does not
-- exist to be written. Adding the link here would create that path for a
-- job-title label — the smallest possible reason for the largest possible
-- widening.
--
-- The leave-history display discussed alongside this phase is DEFERRED to the
-- RBAC project and is deliberately NOT built here. When it is built, it goes
-- through a real permission model, not through this table.
--
-- The boundary is restated in the table comment so it survives in the database
-- itself, where anyone reading a schema dump will see it. Verification block E
-- asserts it mechanically rather than trusting the comment.
--
-- ===========================================================================
-- WHAT THIS IS
-- ===========================================================================
-- One row per auth user. Every column except the key and updated_at is
-- NULLABLE, because a profile is optional in whole and in part: no row at all
-- and a row of all-NULLs are the same state — "nothing filled in" — and the app
-- must render both identically. A brand-new user has no row, and that is not an
-- error condition. Same shape as notification_prefs (0154), which the app
-- already treats this way.
--
-- ===========================================================================
-- THE TWO FIELDS THAT LOOK LIKE HR DATA AND ARE NOT
-- ===========================================================================
-- `job_title` is a FREE-TEXT COSMETIC LABEL. It is what the user chooses to
-- call themselves on their own profile card. It is NOT the HR job title, NOT a
-- permission, NOT a role, and nothing may branch on it. When RBAC arrives, the
-- role lives in the RBAC model; if this column and that model ever disagree,
-- this one is simply wrong and harmless. Making anything depend on it would
-- turn a text box into a privilege escalation.
--
-- `emergency_contact_name` / `emergency_contact_number` are what the USER chose
-- to share with their colleagues so somebody in the office can reach a relative
-- in a hurry. They are NOT the HR emergency contact of record. Do not use them
-- for payroll, insurance, or anything official — the official one lives in the
-- employee file, which this table cannot see and must not mirror.
--
-- ===========================================================================
-- preferred_language IS COSMETIC AND CAN DISAGREE WITH THE REAL UI LANGUAGE
-- ===========================================================================
-- THE REAL i18n SWITCH IS NOT THIS COLUMN. Measured, not assumed: the app reads
-- and writes `localStorage["lang"]` in components/AppShell.tsx (lines 61 and
-- 73), typed `Lang = "en" | "ar"` from lib/i18n.ts. That is what actually
-- renders the interface, it is per-device, and it is untouched by this file.
--
-- So this column is a SECOND place a language appears, and the two are allowed
-- to disagree — a user can set 'ar' here and read the app in English on a
-- different laptop. That is a real trap, stated plainly rather than papered
-- over: do NOT wire this column into the language switch as a "sync", because
-- a per-account value and a per-device value have different lifetimes and the
-- sync would fight the user every time they switch machines. If the language
-- switch ever should become per-account, that is a deliberate change that
-- REPLACES localStorage, not a second writer added beside it.
--
-- The check accepts exactly 'en', 'ar' or NULL, matching Lang's two members, so
-- the column cannot drift to a third language the app cannot render.
--
-- ===========================================================================
-- default_route IS TEXT, AND THE APP VALIDATES IT — BOTH ENDS
-- ===========================================================================
-- Stored as a plain string. There is nothing to reference: routes are a
-- TypeScript array (`NAV` in lib/nav.ts, twelve entries: /, /fleet, /drivers,
-- /trips, /routes, /maintenance, /predictive, /iot, /inventory, /consumption,
-- /reports, /archive), not a table, and creating a routes table to satisfy a FK
-- would invent a schema object to describe a constant.
--
-- Step 2 validates against NAV AT WRITE TIME, as specified. But write-time
-- validation alone is not enough and step 2 must do both ends: a route that is
-- valid today can be renamed or removed by a future release, and the stored
-- string will still be sitting there pointing at a 404. THE READ PATH MUST FALL
-- BACK when the stored value is no longer in NAV — treat unknown as "no
-- preference" and land on the dashboard. A landing page that 404s on login is a
-- user who cannot get into the app at all.
--
-- ===========================================================================
-- BLANK STRINGS: GUARDED ON THE TWO COLUMNS WHERE '' MEANS SOMETHING BROKEN
-- ===========================================================================
-- `avatar_path` and `default_route` carry a nonblank CHECK. Everything else
-- does not, and the split is deliberate.
--
-- For those two, '' is not "empty", it is a POINTER TO NOTHING: a blank storage
-- path makes the app request a signed URL for an object that cannot exist, and
-- a blank route is a navigation target that resolves nowhere. Both fail at a
-- distance, in a different place from where the bad value was written. Same
-- reasoning as 0157's issue_reports_attachment_path_nonblank.
--
-- For the free-text columns — display_name, job_title, bio, the contacts, the
-- emails — '' and NULL mean exactly the same thing to every reader: nothing was
-- provided. A blank name renders as blank text, which is visible, harmless and
-- self-correcting. Seven more constraints would buy nothing and would make the
-- form reject a field the user simply cleared.
--
-- THE APP SHOULD STILL NORMALISE '' TO NULL ON SAVE, and step 2 will. Note the
-- reason, because this codebase has been bitten by it twice in the last two
-- commits: '' is FALSY BUT NOT NULLISH. `name ?? fallback` keeps the empty
-- string and renders blank, while `name || fallback` does not. Storing NULL
-- means both spellings behave, instead of only one of them.
--
-- ===========================================================================
-- NO FORMAT CHECK ON THE EMAIL OR THE PHONE NUMBERS
-- ===========================================================================
-- Measured before deciding: this schema has ZERO email- or phone-format check
-- constraints on any of its 83 tables. Adding the first one here would be both
-- inconsistent and actively harmful — an email regex eventually rejects a
-- legitimate address (plus-addressing, long TLDs, unicode domains) and a KSA
-- phone regex eventually rejects a legitimate landline, international number or
-- WhatsApp-only number. The failure mode is a user who cannot save their own
-- profile and has no way to argue with the database.
--
-- These are self-entered, optional, and read by a human who can tell whether a
-- number looks right. The app may WARN. The database does not refuse.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- staff, drivers, leave_periods, company_settings, every notification object
-- (0154/0155/0156/0158), issue_reports (0157), every money view, and every
-- other storage bucket. It only creates new objects; it alters nothing that
-- exists. The one thing it REUSES is set_updated_at(), which it attaches to but
-- does not redefine.
--
-- user_profiles is a TABLE, not a view, so security_invoker does not apply. RLS
-- plus an explicit anon revoke is the gate. The site-wide view count is
-- untouched at 50 / 50 / 0 — verification block G confirms rather than assumes.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. THE TABLE
--
-- NO INDEXES BEYOND THE PRIMARY KEY, and that is a decision rather than an
-- omission. There is exactly one access pattern — "fetch my own row by
-- user_id" — and the PK already serves it. This table is never scanned, never
-- sorted, never filtered by any other column. An index on display_name would
-- support a people-search this table is explicitly not for.
-- ---------------------------------------------------------------------
create table if not exists public.user_profiles (
  -- ON DELETE CASCADE, matching notification_prefs, notification_dismissals and
  -- notification_thresholds_user — measured, all three cascade. A profile
  -- describing a deleted account is not worth keeping, unlike an issue report
  -- (0157), which is evidence of a problem and therefore survives its author
  -- with a NULLed reporter_id. Different data, different rule.
  --
  -- NO `default auth.uid()` HERE, and that also differs from issue_reports on
  -- purpose. The three per-user tables above have no default either; the app
  -- must pass user_id explicitly for the upsert's conflict target anyway, so a
  -- default would only ever cover an INSERT that FORGOT the key. On a table of
  -- personal data, that INSERT should fail loudly with a 23502 rather than
  -- quietly succeed against whoever happens to be calling.
  --
  -- THIS IS THE ONLY FOREIGN KEY THIS TABLE WILL EVER HAVE. See the header.
  user_id                  uuid primary key
                           references auth.users(id) on delete cascade,

  -- Optional. May mirror the auth display name, may differ, may be absent.
  -- Nothing derives from it and no uniqueness is enforced: two colleagues are
  -- allowed to both be "Turki".
  display_name             text,

  -- FREE-TEXT COSMETIC LABEL. Not a role, not a permission. See the header.
  job_title                text,

  -- The user's own number, shared here because they chose to. Not the HR
  -- contact of record. No format check — see the header.
  contact_number           text,

  -- Their own address, separate from the login email. The login email lives in
  -- auth.users and is NOT copied here: duplicating it would create a second
  -- copy that goes stale the moment the account email changes.
  personal_email           text,

  -- Self-shared, for a colleague in a hurry. NOT the HR emergency contact.
  emergency_contact_name   text,
  emergency_contact_number text,

  bio                      text,

  -- COSMETIC display label. NOT the i18n switch — that is localStorage["lang"].
  -- See the header; this column is allowed to disagree with the rendered UI.
  preferred_language       text,

  -- Post-login landing page. A route string validated by the app against NAV at
  -- write time AND falling back on read. See the header.
  default_route            text,

  -- Storage PATH into the private profile-images bucket created below. Never
  -- bytes, never base64: an image in a text column bloats every profile read
  -- and blows the row-size budget on any real photograph.
  avatar_path              text,

  updated_at               timestamptz not null default now(),

  -- Null-tolerant, in this schema's established idiom (0158). NULL means "no
  -- preference"; any non-NULL value must be one of the two languages the app
  -- can actually render (Lang in lib/i18n.ts).
  constraint user_profiles_preferred_language_check
    check (preferred_language is null or preferred_language in ('en','ar')),

  -- '' is a path to nothing. NULL means "no avatar"; '' means someone wrote an
  -- empty string, and step 2 must not have to tell those apart before deciding
  -- whether to request a signed URL.
  constraint user_profiles_avatar_path_nonblank
    check (avatar_path is null or nullif(btrim(avatar_path), '') is not null),

  -- '' is a route to nowhere. Same reasoning.
  constraint user_profiles_default_route_nonblank
    check (default_route is null or nullif(btrim(default_route), '') is not null)
);

-- ---------------------------------------------------------------------
-- 2. updated_at, maintained by the database.
--
-- REUSES set_updated_at() from 0157 rather than defining a second near-
-- identical function. Measured before writing this: the function exists and is
-- already attached to issue_reports and notification_thresholds_user. This
-- makes three.
--
-- The WHEN clause matters. Without it, "last updated" would mean "last written
-- to", and re-saving an unchanged profile form would look like activity.
-- ---------------------------------------------------------------------
drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS — one policy, own row only, both directions.
--
-- FOR ALL with USING and WITH CHECK both pinned to auth.uid() is the exact
-- shape the three existing per-user tables use (own_notification_prefs,
-- own_notification_dismissals, own_notification_thresholds_user) — measured,
-- not copied from memory. The name follows that convention.
--
-- BOTH CLAUSES ARE REQUIRED AND THEY DO DIFFERENT JOBS. USING controls which
-- rows you can see and modify; WITH CHECK controls what the row is allowed to
-- look like AFTERWARDS. With USING alone, a user could UPDATE their own row and
-- set user_id to someone else's — handing their profile to another account.
--
-- THIS IS DELIBERATELY NARROWER THAN issue_reports (0157), which lets either
-- user read and edit every ticket because a two-person team shares one queue.
-- A profile is not shared work: it is one person's own information, and there
-- is no task that requires editing somebody else's. Reads are own-row too, so
-- the Profile section shows you yourself and nothing else.
--
-- NOTE FOR WHOEVER BUILDS THE COLLEAGUE-FACING VIEW: if profiles ever need to
-- be visible to other users, that is a SEPARATE, EXPLICIT change — a second
-- SELECT policy exposing a chosen SUBSET of columns through a view, not a
-- widening of this one. `select using (true)` here would expose personal email,
-- personal phone and next-of-kin to every account in one line.
-- ---------------------------------------------------------------------
alter table public.user_profiles enable row level security;

drop policy if exists own_user_profiles on public.user_profiles;
create policy own_user_profiles
  on public.user_profiles for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.user_profiles from anon;

-- ---------------------------------------------------------------------
-- 4. Comments — the boundary, stated where it survives a schema dump.
-- ---------------------------------------------------------------------
comment on table public.user_profiles is
  'Self-entered personal profile (0159) — one optional row per auth user, every column nullable, RLS restricted to user_id = auth.uid() for both read and write. EXPLICITLY NOT LINKED TO ANY EMPLOYEE OR HR RECORD BY DESIGN: no foreign key to staff, drivers or leave_periods, no iqama, no salary, no leave, no employment data, and none may be added. The absence of an auth-to-employee link is a safety feature — it means no query can widen from a cosmetic profile to payroll or identity documents, because the join does not exist. job_title is a free-text cosmetic label, NOT a role and NOT a permission; nothing may branch on it. The emergency contact is what the user chose to share with colleagues, NOT the HR contact of record. preferred_language is a display label only — the real UI language is localStorage["lang"] and the two are allowed to disagree. avatar_path is a storage path into profile-images, never image bytes. No row at all and a row of all-NULLs are the same state: nothing filled in.';

comment on column public.user_profiles.user_id is
  'The auth user this profile belongs to. THE ONLY FOREIGN KEY THIS TABLE HAS, and the only one it may ever have — do not add a staff_id, driver_id or any other employee link, however convenient. See the table comment.';

comment on column public.user_profiles.job_title is
  'FREE-TEXT COSMETIC LABEL the user chose for their own profile card. NOT the HR job title, NOT a role, NOT a permission. Nothing may branch on this value; when RBAC arrives the role lives there, and if the two disagree this column is simply wrong and harmless.';

comment on column public.user_profiles.preferred_language is
  'COSMETIC display label: en, ar, or NULL for no preference. NOT the i18n switch — the app renders from localStorage["lang"] (components/AppShell.tsx), which is per-device while this is per-account, so the two can legitimately disagree. Do not wire this into the language switch as a sync.';

comment on column public.user_profiles.default_route is
  'Post-login landing route as a plain string, validated by the app against NAV (lib/nav.ts) at write time. THE READ PATH MUST ALSO FALL BACK: a route valid today can be removed by a later release, and a stored 404 would lock the user out of the app on login. Unknown value means no preference — land on the dashboard.';

comment on column public.user_profiles.avatar_path is
  'Storage path into the PRIVATE profile-images bucket, or NULL for no avatar. Path only — never bytes, never base64. Read back through a signed URL; the bucket is not public.';

comment on column public.user_profiles.emergency_contact_name is
  'Self-shared, so a colleague can reach someone in a hurry. NOT the HR emergency contact of record — do not use for payroll, insurance or anything official.';

-- ---------------------------------------------------------------------
-- 5. Storage bucket for avatars — PRIVATE.
--
-- A separate bucket, one per purpose, following all eleven existing buckets.
-- PRIVATE like all eleven — measured, every one has public = false. Reads go
-- through a signed URL, never a public link. An avatar is a photograph of a
-- named person; a public bucket would make it fetchable by anyone who learned
-- the URL, forever, with no session behind it.
--
-- POLICY SHAPE — FOUR GRANULAR POLICIES, WHICH IS THE LIVE MAJORITY.
-- Re-measured against the database rather than trusting 0157's header: of the
-- eleven buckets, TEN use four policies named
-- `<bucket>_authenticated_{select,insert,update,delete}` and exactly ONE
-- (balance-return-proofs, 0139) uses a single `for all`. This follows the ten.
--
-- WHY FULL CRUD, CONCRETELY. Replacing an avatar needs two of these and which
-- two depends on a path decision step 2 has not made yet:
--   - a STABLE path (`<uid>/avatar.png`) overwrites in place — needs UPDATE,
--     and the app must then cache-bust the signed URL or the old face persists;
--   - a UNIQUE path (`<uid>/avatar-<ts>.png`) writes a new object — needs
--     DELETE to remove the old one, or every change orphans a file forever.
-- Granting only SELECT+INSERT would work for the upload and then fail on the
-- second one, which is the FIRST thing a user does after picking a bad photo.
-- Both are granted so step 2 can choose on its merits instead of choosing
-- around an RLS error.
--
-- WRITE ACCESS IS SCOPED TO THE BUCKET, NOT TO THE OWNER'S FOLDER — stated
-- openly because it is the one place this bucket is looser than the table above
-- it. Any authenticated user could technically overwrite another's avatar
-- object. Three reasons it stays this way: no bucket in this schema path-scopes
-- (this would be the first, and an inconsistent policy is one nobody maintains
-- correctly); the trust model is already two colleagues who can edit each
-- other's tickets and see all money; and a `(storage.foldername(name))[1] =
-- auth.uid()::text` predicate would hard-couple this migration to a path
-- convention step 2 has not written yet, so a mismatch would surface as an
-- opaque RLS failure on upload. If avatars ever need owner-scoped writes, the
-- policy and the path convention change together, in one migration, or not at
-- all.
--
-- ANON GETS NOTHING, here as everywhere: there is no anon policy anywhere on
-- storage.objects across all eleven buckets — measured — and none is added.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', false)
on conflict (id) do nothing;

drop policy if exists "profile_images_authenticated_select" on storage.objects;
create policy "profile_images_authenticated_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-images');

drop policy if exists "profile_images_authenticated_insert" on storage.objects;
create policy "profile_images_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-images');

drop policy if exists "profile_images_authenticated_update" on storage.objects;
create policy "profile_images_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-images')
  with check (bucket_id = 'profile-images');

drop policy if exists "profile_images_authenticated_delete" on storage.objects;
create policy "profile_images_authenticated_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-images');

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
--             has_table_privilege('anon', c.oid, 'update') as anon_update,
--             has_table_privilege('anon', c.oid, 'delete') as anon_delete
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='user_profiles';
--      -- expect: r / true / false / false / false / false
--
-- B) EVERY SELF-ENTERED COLUMN IS NULLABLE. Only user_id and updated_at are not.
--      select attname, format_type(atttypid, atttypmod) as type, attnotnull
--        from pg_attribute
--       where attrelid='public.user_profiles'::regclass
--         and attnum > 0 and not attisdropped
--       order by attnum;
--      -- expect 12 rows. attnotnull TRUE on exactly two: user_id (uuid) and
--      -- updated_at (timestamp with time zone). All ten others text / false:
--      --   display_name, job_title, contact_number, personal_email,
--      --   emergency_contact_name, emergency_contact_number, bio,
--      --   preferred_language, default_route, avatar_path
--
--      -- Stated as a single assertion so a stray NOT NULL is obvious:
--      select count(*) filter (where attnotnull) as not_nullable
--        from pg_attribute
--       where attrelid='public.user_profiles'::regclass
--         and attnum > 0 and not attisdropped;
--      -- expect 2
--
-- C) ONE POLICY, OWN-ROW, BOTH DIRECTIONS.
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname='public' and tablename='user_profiles';
--      -- expect exactly 1 row:
--      --   own_user_profiles / ALL / {authenticated}
--      --   qual       (user_id = auth.uid())
--      --   with_check (user_id = auth.uid())
--      -- BOTH must be present. with_check NULL would let a user reassign their
--      -- row to another account.
--
-- D) preferred_language ACCEPTS 'en' / 'ar' / NULL AND REJECTS ANYTHING ELSE.
--
--    THESE PROBES MUST USE A REAL auth.users ROW. A gen_random_uuid() placeholder
--    raises 23503 foreign_key_violation before the CHECK is ever evaluated, so
--    the probe would "fail" for the wrong reason and prove nothing. Every block
--    below therefore selects a live user id inline. The rollback protects it.
--
--    These run as the table owner in the SQL editor, which BYPASSES RLS — so
--    they test the CHECK constraints only. The RLS half is verified in-browser
--    at step 2. All rolled back; nothing is written.
--
--      -- POSITIVE: all three accepted values, on one real user
--      begin;
--        insert into public.user_profiles (user_id, preferred_language)
--        values ((select id from auth.users order by created_at limit 1), 'en')
--        on conflict (user_id) do update set preferred_language = 'en';
--
--        update public.user_profiles set preferred_language = 'ar'
--         where user_id = (select id from auth.users order by created_at limit 1);
--
--        update public.user_profiles set preferred_language = null
--         where user_id = (select id from auth.users order by created_at limit 1);
--
--        select 'en / ar / null all accepted' as result;
--      rollback;
--
--    EACH NEGATIVE BELOW MUST RAISE. If any one of them succeeds, the matching
--    constraint is missing — that is the finding, not a passing test.
--
--      -- a third language -> 23514 user_profiles_preferred_language_check
--      begin;
--        update public.user_profiles set preferred_language = 'fr'
--         where user_id = (select id from auth.users order by created_at limit 1);
--      rollback;
--
--      -- empty string is not a language either -> same 23514
--      begin;
--        update public.user_profiles set preferred_language = ''
--         where user_id = (select id from auth.users order by created_at limit 1);
--      rollback;
--
--      -- blank avatar_path -> 23514 user_profiles_avatar_path_nonblank
--      begin;
--        update public.user_profiles set avatar_path = '   '
--         where user_id = (select id from auth.users order by created_at limit 1);
--      rollback;
--
--      -- blank default_route -> 23514 user_profiles_default_route_nonblank
--      begin;
--        update public.user_profiles set default_route = ''
--         where user_id = (select id from auth.users order by created_at limit 1);
--      rollback;
--
--      -- POSITIVE: NULL is fine for both guarded columns — that is exactly what
--      -- "no avatar" and "no preference" mean, and a guard that rejected NULL
--      -- would make the fields unclearable.
--      begin;
--        insert into public.user_profiles (user_id, avatar_path, default_route)
--        values ((select id from auth.users order by created_at limit 1), null, null)
--        on conflict (user_id) do update set avatar_path = null, default_route = null;
--        select 'nulls accepted on both guarded columns' as result;
--      rollback;
--
-- E) THE HARD BOUNDARY, ASSERTED MECHANICALLY.
--
--    A WHITELIST, not a blacklist. Checking "no FK to staff" would pass a new FK
--    to some other employee-ish table. This asserts the table's ONLY foreign key
--    is to auth.users, so ANY future link trips it.
--
--      select conname, pg_get_constraintdef(oid) as def,
--             confrelid::regclass::text as references_table
--        from pg_constraint
--       where conrelid = 'public.user_profiles'::regclass and contype = 'f';
--      -- expect EXACTLY ONE row:
--      --   user_profiles_user_id_fkey
--      --   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
--      --   references_table = auth.users
--      -- ANY other row is a boundary violation. There is no acceptable second FK.
--
--      -- The count, so a missing row is as visible as an extra one:
--      select count(*) as foreign_keys,
--             count(*) filter (where confrelid = 'auth.users'::regclass) as to_auth_users
--        from pg_constraint
--       where conrelid = 'public.user_profiles'::regclass and contype = 'f';
--      -- expect 1 / 1
--
--      -- No column NAMED after an employee record either — catches a plain uuid
--      -- column added without a constraint, which a FK check alone would miss:
--      select attname from pg_attribute
--       where attrelid = 'public.user_profiles'::regclass
--         and attnum > 0 and not attisdropped
--         and (attname ilike '%staff%' or attname ilike '%driver%'
--              or attname ilike '%employee%' or attname ilike '%iqama%'
--              or attname ilike '%salary%' or attname ilike '%leave%');
--      -- expect ZERO rows
--
--      -- And nothing anywhere references user_profiles either — it is a leaf:
--      select conrelid::regclass::text as from_table, conname
--        from pg_constraint
--       where confrelid = 'public.user_profiles'::regclass and contype = 'f';
--      -- expect ZERO rows
--
-- F) THE BUCKET EXISTS, IS PRIVATE, AND HAS FOUR POLICIES AND NO ANON.
--      select id, name, public from storage.buckets where id = 'profile-images';
--      -- expect one row, public = false
--
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and policyname like 'profile_images%'
--       order by cmd;
--      -- expect exactly 4 rows, all {authenticated}:
--      --   DELETE  qual       (bucket_id = 'profile-images')
--      --   INSERT  with_check (bucket_id = 'profile-images')
--      --   SELECT  qual       (bucket_id = 'profile-images')
--      --   UPDATE  qual + with_check (bucket_id = 'profile-images')
--      -- No anon row.
--
--      select count(*) as profile_image_policies
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and policyname like 'profile_images%';
--      -- expect 4
--
--      -- anon must match NO policy on this bucket:
--      select count(*) as anon_policies_on_bucket
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and roles::text like '%anon%'
--         and coalesce(qual,'') || coalesce(with_check,'') like '%profile-images%';
--      -- expect 0
--
-- G) NOTHING ELSE MOVED.
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
--      -- expect 84 / 84  (measured at 83 / 83 immediately before drafting this)
--
--      select count(*) as buckets from storage.buckets;
--      -- expect 12 (was 11)
--
--      -- The tables this file must not have touched, byte for byte:
--      select count(*) as staff, (select count(*) from public.drivers) as drivers,
--             (select count(*) from public.leave_periods) as leave_periods
--        from public.staff;
--      -- expect unchanged from before the apply
--
--      -- set_updated_at now serves three tables, not two:
--      select tgrelid::regclass::text as attached_to
--        from pg_trigger
--       where tgfoid = 'public.set_updated_at'::regproc and not tgisinternal
--       order by 1;
--      -- expect issue_reports, notification_thresholds_user, user_profiles
--
-- H) updated_at IS MAINTAINED BY THE DATABASE, AND ONLY ON REAL CHANGES.
--    Same real-user requirement as block D. Rolled back; nothing is written.
--
--      begin;
--        insert into public.user_profiles (user_id, bio)
--        values ((select id from auth.users order by created_at limit 1), 'touch probe')
--        on conflict (user_id) do update set bio = 'touch probe';
--
--        -- Both halves in ONE query so the two timestamps are directly
--        -- comparable rather than eyeballed across two result grids.
--        with u as (select id from auth.users order by created_at limit 1),
--             before_change as (
--               select updated_at from public.user_profiles where user_id = (select id from u)
--             ),
--             do_change as (
--               update public.user_profiles set bio = 'touch probe 2'
--                where user_id = (select id from u)
--               returning updated_at
--             )
--        select (select updated_at from do_change) > (select updated_at from before_change)
--                 as bumped_on_real_change;
--        -- expect true
--
--        with u as (select id from auth.users order by created_at limit 1),
--             before_noop as (
--               select updated_at from public.user_profiles where user_id = (select id from u)
--             ),
--             do_noop as (
--               update public.user_profiles set bio = 'touch probe 2'   -- SAME value
--                where user_id = (select id from u)
--               returning updated_at
--             )
--        select (select updated_at from do_noop) is not distinct from
--               (select updated_at from before_noop) as unchanged_on_noop;
--        -- expect true — the WHEN clause suppressed the trigger.
--        -- NOTE: do_noop still RETURNS a row (the UPDATE matched and wrote the
--        -- same value); what must not have moved is updated_at.
--      rollback;
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   begin;
--   drop policy if exists "profile_images_authenticated_select" on storage.objects;
--   drop policy if exists "profile_images_authenticated_insert" on storage.objects;
--   drop policy if exists "profile_images_authenticated_update" on storage.objects;
--   drop policy if exists "profile_images_authenticated_delete" on storage.objects;
--   delete from storage.buckets where id = 'profile-images';
--   drop table if exists public.user_profiles;   -- takes its trigger with it
--   commit;
--
-- DO NOT DROP set_updated_at(). This file does not create it and 0157 did.
-- After this migration THREE tables depend on it (issue_reports,
-- notification_thresholds_user, user_profiles), so dropping it here would
-- silently stop maintaining updated_at on two unrelated tables. Confirm before
-- touching it at all:
--     select tgrelid::regclass as attached_to
--       from pg_trigger
--      where tgfoid = 'public.set_updated_at'::regproc and not tgisinternal;
--
-- AND: `delete from storage.buckets` FAILS if the bucket still holds objects
-- (foreign key from storage.objects). Empty it first, and be sure that is what
-- you want — those are users' own photographs:
--     select count(*) from storage.objects where bucket_id = 'profile-images';
-- ===========================================================================
