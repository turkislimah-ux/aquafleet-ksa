-- 0161_revoke_anon_grants.sql
-- Revoke every privilege the `anon` role holds on every table in `public`, so
-- the GRANTS agree with the RLS that was already blocking it.
--
-- ===========================================================================
-- THE DATABASE WAS CHANGED FIRST. THIS FILE IS THE RECORD, NOT THE SOURCE.
-- ===========================================================================
-- The architect applied this via MCP and verified it live BEFORE this file was
-- written. Stated so the next reader does not assume it was applied from disk.
--
-- It IS idempotent, unlike 0160 — revoking a privilege that is already gone is a
-- no-op, so re-running is harmless. It is still not something to run against
-- production for no reason.
--
-- ===========================================================================
-- WHY — THE GRANTS DISAGREED WITH THE RLS, AND ONLY THE RLS WAS DOING ANYTHING
-- ===========================================================================
-- Supabase creates every table in `public` with default grants to `anon` and
-- `authenticated`. Before this migration `anon` held **539 privilege rows across
-- 77 tables** — every one of them INERT, because RLS is enabled on all tables
-- and not one policy admits the `anon` role. So anon could reach the API, be
-- refused zero rows by RLS, and get an empty result rather than a refusal.
--
-- That is a defensible posture and it is not the one this schema states
-- everywhere else. 0154, 0157 and 0159 each end with `revoke all on <table> from
-- anon` — the newer tables already said out loud that anon has no business here.
-- This extends that to the tables that predate the idiom.
--
-- **THE ARITHMETIC CONFIRMS THE IDIOM WAS WORKING.** There are 83 tables in
-- public and anon held grants on 77 of them. The 6 it did NOT hold are exactly
-- the tables created by migrations that already carried the revoke:
-- notification_thresholds, notification_prefs, notification_dismissals (0154),
-- issue_reports (0157), notification_thresholds_user (0158) and user_profiles
-- (0159). 83 − 77 = 6, and those are the six.
--
-- DEFENCE IN DEPTH, NOT A FIX. Nothing was exploitable before this: RLS was
-- already the wall. What changes is that a mistake is now caught twice — if
-- someone ever writes a policy with `to public` or forgets a `to authenticated`,
-- the missing grant still refuses anon. One wall is a single point of failure
-- even when it is a good wall.
--
-- ===========================================================================
-- `authenticated` IS DELIBERATELY UNTOUCHED
-- ===========================================================================
-- This revokes from `anon` ONLY. `authenticated` keeps every grant it had —
-- measured after the apply: 931 privilege rows across 133 relations, and it
-- still selects `invoices`, `trips`, `staff` and everything else the app reads.
--
-- THE APP RUNS AS `authenticated`. Every server action and every page uses the
-- request-scoped client from lib/supabase/server, which carries the caller's
-- cookies, so the app never touches the database as anon once someone is signed
-- in. Section 2's assertion fails the migration if this revoke ever widens to
-- `authenticated`, because a too-broad revoke would take the whole app down and
-- should do so loudly, at apply time, rather than at the next page load.
--
-- ===========================================================================
-- THE ONE PRE-AUTH PATH IN THE APP, AND WHY IT STILL WORKS
-- ===========================================================================
-- Audited before applying, because a path that expected "empty, no error" and
-- now gets a permission error is the only way this could break anything.
--
-- Exactly one browser-client (anon-key) table query exists in the whole app:
-- `app/login/page.tsx` reading `user_profiles.default_route`. It runs AFTER
-- `signInWithPassword` has succeeded and after its error return, so it carries a
-- session and runs as `authenticated`. Not a pre-auth path.
--
-- There is one genuine pre-auth read: `AppShell` calls `fetchMyAvatarUrl()` in a
-- mount effect, and that effect is registered ABOVE the `if (pathname ===
-- "/login") return` early return — so it fires on the login page, with no
-- session, as anon, against `user_profiles`.
--
-- **IT FAILS SAFE, AND THAT IS BY CONSTRUCTION RATHER THAN BY LUCK.**
-- `fetchMyAvatarUrl` does not destructure `error` from the query, so a 42501
-- lands as `data = null` exactly like an empty result did before; the body is
-- also wrapped in try/catch and every failure path returns null. The header
-- falls back to initials, which the login page does not render anyway.
-- Confirmed in a real browser after the apply: /login returns 200, both inputs
-- and the Sign in button render, and there are ZERO console or page errors.
--
-- **DO NOT "FIX" THIS BY RE-GRANTING user_profiles TO anon.** That would undo
-- the hardening for a call that should not be made at all. The correct fix is a
-- session check inside `fetchMyAvatarUrl` so it returns null without querying —
-- one line, tracked separately, and a behaviour improvement rather than a
-- prerequisite for this migration.
--
-- ===========================================================================
-- TWO PARTS: A SWEEP OF WHAT EXISTS, AND A RULE FOR WHAT COMES NEXT
-- ===========================================================================
-- Section 1 is a POINT-IN-TIME sweep. On its own it would go stale immediately:
-- Supabase's DEFAULT PRIVILEGES on schema `public` grant the full set to anon,
-- so the next table created would be handed `arwdDxtm` at birth and the sweep
-- would silently stop describing reality. Measured before writing this, not
-- assumed — both the `postgres` and `supabase_admin` default ACLs listed
-- anon=arwdDxtm.
--
-- Section 3 closes that: `alter default privileges in schema public revoke all
-- on tables from anon`, so a new table is never granted to anon in the first
-- place. It is role-scoped to `postgres`, which is correct here because every
-- table in this schema is owned by postgres and migrations run as postgres — the
-- reasoning is at section 3 itself.
--
-- **THE PER-MIGRATION IDIOM STAYS MANDATORY. DO NOT DELETE IT FROM FUTURE
-- MIGRATIONS.** Every migration that creates a table in `public` must still end
-- with
--     revoke all on public.<table> from anon;
-- exactly as 0154/0157/0159 do. Two reasons, and the first is not optional:
--
--   1. Section 3 only affects tables created AFTER it runs. Every table that
--      already exists was covered by section 1, not by section 3 — and any
--      migration that ran before 0161 and is replayed on a fresh database
--      creates its table BEFORE section 3 executes. On a `db reset` the ordering
--      does the work, and the per-table revoke is what makes each of those
--      migrations correct in isolation.
--   2. It keeps each migration readable on its own. A reader of 0157 should not
--      have to know 0161 exists to know that anon cannot read issue_reports.
--
-- Belt and braces. The default-privileges line is the belt; it does not replace
-- the braces.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- No table data, no schema, no RLS policy, no view, no function, no bucket, and
-- no app code. Privileges only, for one role. Views are not included because
-- they were already anon-locked — the site-wide check in CLAUDE.md §6 has read
-- 0 anon-readable views for many migrations, and section 3 re-asserts it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The sweep.
--
-- A LOOP RATHER THAN 77 EXPLICIT STATEMENTS, on purpose. An explicit list is a
-- snapshot of the table set on the day it was written: replay it against a
-- database whose earlier migrations have since added a table and the list
-- silently misses it. The loop asks the catalog what exists at the moment it
-- runs, so it is correct at whatever position in the sequence it executes.
--
-- relkind in ('r','p') — ordinary and partitioned tables. There are no
-- partitioned tables in this schema today; including the kind costs nothing and
-- means the sweep does not quietly skip one if that changes.
--
-- format() with %s on a regclass, which quotes identifiers correctly. Not string
-- concatenation of relname, which breaks on anything needing quoting.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select c.oid::regclass as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by 1
  loop
    execute format('revoke all on %s from anon', r.tbl);
    v_count := v_count + 1;
  end loop;

  raise notice 'revoked all privileges from anon on % public tables', v_count;
end $$;

-- ---------------------------------------------------------------------
-- 2. Self-asserts. Any failure rolls the whole thing back.
--
-- The second one matters more than the first: a revoke that hit `authenticated`
-- would take the entire app down, and it must fail HERE, at apply time, rather
-- than at the next page load.
-- ---------------------------------------------------------------------
do $$
declare
  v_anon int;
  v_auth int;
begin
  select count(*) into v_anon
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';

  if v_anon <> 0 then
    raise exception 'anon still holds % privilege rows on public tables', v_anon;
  end if;

  select count(*) into v_auth
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public';

  if v_auth = 0 then
    raise exception 'authenticated lost every privilege - the revoke was too broad';
  end if;

  -- A concrete read the app actually performs, not just a count.
  if not has_table_privilege('authenticated', 'public.invoices', 'select') then
    raise exception 'authenticated can no longer select invoices - revoke was too broad';
  end if;

  raise notice 'anon: 0 privileges. authenticated: % privilege rows, still reads invoices.', v_auth;
end $$;

-- ---------------------------------------------------------------------
-- 3. THE STANDING RULE — stop future tables being granted to anon at birth.
--
-- Sections 1-2 are a point-in-time sweep. Without this line, the next table
-- created in `public` is handed the full anon set again by Supabase's default
-- privileges, and the sweep silently stops describing reality.
--
-- ROLE-SCOPED, AND THAT IS THE SUBTLETY. `alter default privileges` with no
-- FOR ROLE applies to the CURRENT role only. Measured on this database rather
-- than assumed: there are default ACLs for TWO roles, `postgres` and
-- `supabase_admin`, and both list anon=arwdDxtm. This statement, run as
-- postgres, clears the postgres one and leaves supabase_admin's in place.
--
-- THAT IS THE CORRECT SCOPE HERE, not a gap to patch. A default ACL only fires
-- for objects created BY that role, and every one of the 83 tables in `public`
-- is owned by `postgres` — measured. Migrations run as postgres, so postgres is
-- the role whose defaults decide what a new table gets. Nothing in this
-- project's workflow creates a table as supabase_admin.
--
-- Do NOT reflexively add `for role supabase_admin` to "finish the job": postgres
-- may not be permitted to alter another role's defaults, and it would be
-- changing behaviour for a path this project does not use. If something ever
-- does create tables as supabase_admin, that is the moment to revisit it.
--
-- THE PER-MIGRATION IDIOM STAYS MANDATORY ANYWAY. This line only affects tables
-- created AFTER it runs. Every table created by a migration that ran BEFORE it —
-- which is all 83 of them — was covered by section 1, not by this. And a future
-- migration should still end with `revoke all on public.<table> from anon`:
-- belt and braces, and it keeps each migration readable on its own without
-- requiring the reader to know 0161 exists.
-- ---------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;

do $$
declare
  v_anon_default int;
begin
  -- Scoped to the postgres role deliberately — see above. Counting across all
  -- roles would still find supabase_admin's entry and read as a failure.
  select count(*) into v_anon_default
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public'
     and d.defaclobjtype = 'r'
     and pg_get_userbyid(d.defaclrole) = 'postgres'
     and d.defaclacl::text like '%anon=%';

  if v_anon_default <> 0 then
    raise exception 'default privileges for postgres still grant to anon on new tables';
  end if;

  raise notice 'future tables owned by postgres will not be granted to anon';
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) anon HOLDS NOTHING ON public.
--      select count(*) as anon_privileges
--        from information_schema.role_table_grants
--       where grantee='anon' and table_schema='public';
--      -- expect 0   (was 539 across 77 tables)
--
--      select has_table_privilege('anon','public.invoices','select') as anon_invoices,
--             has_table_privilege('anon','public.trips','select')    as anon_trips,
--             has_table_privilege('anon','public.staff','select')    as anon_staff;
--      -- expect false / false / false
--
-- B) authenticated IS UNTOUCHED.
--      select count(*) as authd_privileges,
--             count(distinct table_name) as authd_relations
--        from information_schema.role_table_grants
--       where grantee='authenticated' and table_schema='public';
--      -- expect 931 / 133 — unchanged by this migration
--
--      select has_table_privilege('authenticated','public.invoices','select') as authd_invoices;
--      -- expect true
--
-- C) THE END STATE THE APP DEPENDS ON, unchanged.
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 83 / 83
--
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 50 / 50 / 0 — views were already anon-locked; this file does
--      -- not touch them, and the 0 confirms it did not need to.
--
-- D) FUTURE TABLES ARE NO LONGER GRANTED TO anon (section 3).
--
--    READ THE ROLE COLUMN BEFORE JUDGING THIS ONE. There are default ACLs for
--    two roles and only the `postgres` one is in scope — a default ACL fires
--    only for objects created by that role, every table here is owned by
--    postgres, and migrations run as postgres. A query that does not filter by
--    role will still find supabase_admin's entry and look like a failure.
--
--      select pg_get_userbyid(d.defaclrole) as owner_role, d.defaclacl::text
--        from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--       where n.nspname='public' and d.defaclobjtype='r'
--       order by 1;
--      -- expect the postgres row to have NO anon= entry.
--      -- expect the supabase_admin row to STILL have one — out of scope, and
--      -- unreachable by anything this project does.
--
--    The end-to-end check, which is the one that actually matters:
--      create table public.zz_anon_probe(id int);
--      select has_table_privilege('anon','public.zz_anon_probe','select');
--      drop table public.zz_anon_probe;
--      -- expect false. Before section 3 this returned true.
--      -- Run it inside begin/rollback if you would rather not create anything.
--
-- E) FROM OUTSIDE, WITH THE ANON KEY — the check that does not trust the
--    catalog. Any public table should answer 401 / 42501 rather than [].
--      curl -s -o /dev/null -w '%{http_code}\n' \
--        "$SUPABASE_URL/rest/v1/invoices?select=*&limit=1" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--      -- expect 401, body code 42501. Before this migration: 200 with [].
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Restoring the previous state means re-granting Supabase's defaults to anon:
--
--   begin;
--   do $$
--   declare r record;
--   begin
--     for r in select c.oid::regclass as tbl
--                from pg_class c join pg_namespace n on n.oid = c.relnamespace
--               where n.nspname='public' and c.relkind in ('r','p')
--     loop
--       execute format('grant all on %s to anon', r.tbl);
--     end loop;
--   end $$;
--   commit;
--
-- **THINK BEFORE RUNNING THAT.** It re-grants on ALL tables including the six
-- that never had anon grants (0154/0157/0158/0159 revoked them explicitly), so
-- it does not restore the prior state — it produces a MORE permissive one than
-- existed before this migration. If a rollback is ever genuinely needed, grant
-- the single table that needs it and nothing else.
--
-- And re-read the header first: no anon read ever WORKED, because RLS returned
-- zero rows. Rolling this back restores an error message, not a capability.
-- ===========================================================================
