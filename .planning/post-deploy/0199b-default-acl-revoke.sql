-- ===========================================================================
-- 0199b — THE DURABLE HALF OF 0199. DRAFTED, REVIEWED, **NOT APPLIED**.
-- ===========================================================================
-- DELIBERATELY NOT IN supabase/migrations/. It carries no migration number and
-- must not be applied by whoever finds it. It is scheduled with the POST-DEPLOY
-- RBAC + base-table permissions work (Turki's call, 2026-09-14).
--
-- WHEN THAT WORK STARTS: renumber this to the next free migration number, move
-- it into supabase/migrations/, re-measure every figure quoted below against
-- live before trusting any of them, and have the architect review it again.
-- The numbers here were measured on 2026-09-14 and will drift.
--
-- ---------------------------------------------------------------------------
-- WHAT 0199 DID, AND WHAT IT LEFT OPEN
-- ---------------------------------------------------------------------------
-- 0199 (applied) swept the 50 views that EXISTED: authenticated came out
-- holding REFERENCES, SELECT, TRIGGER and nothing else on all 50, verified
-- live. That fix is point-in-time and complete for those 50.
--
-- It did NOT change what happens at CREATE time. pg_default_acl still carries,
-- measured live after 0199 applied:
--
--   grantor         objtype  acl
--   postgres        r        {postgres=arwdDxtm/postgres,
--                             authenticated=arwdDxtm/postgres,
--                             service_role=arwdDxtm/postgres}
--   supabase_admin  r        {postgres=arwdDxtm/supabase_admin,
--                             anon=arwdDxtm/supabase_admin,
--                             authenticated=arwdDxtm/supabase_admin,
--                             service_role=arwdDxtm/supabase_admin}
--
-- objtype 'r' covers VIEWS as well as tables. So the next migration that
-- creates a view re-opens the gap on that view the instant it is created, and
-- 0199's sweep has to be run again. This file closes it at the default.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS DEFERRED: objtype 'r' COVERS TABLES TOO, AND THE ASSUMPTION THAT
-- MADE THAT LOOK FREE DID NOT SURVIVE MEASUREMENT
-- ---------------------------------------------------------------------------
-- There is no views-only objtype. Revoking write in the default necessarily
-- changes how every future TABLE is created as well.
--
-- This was reviewed on the understanding that base tables grant writes
-- EXPLICITLY (the `authenticated_all_*` pattern) and would be unaffected.
-- THAT UNDERSTANDING IS WRONG. Measured, not assumed:
--
--   * 86 of 88 public tables give `authenticated` INSERT/UPDATE/DELETE today.
--   * Grepping all 199 migrations for a grant of a WRITE privilege to
--     `authenticated` on a table returns ZERO. Not one. The only table-level
--     grant form present anywhere is `grant select`.
--   * What `authenticated_all_*` actually is: 81 occurrences of
--     `... for all to authenticated using (true) with check (true)`. Those are
--     RLS POLICIES, in pg_policies. A policy is not a grant. A policy decides
--     which ROWS are visible once you already hold the privilege; the privilege
--     itself came from somewhere else.
--   * Somewhere else is this default ACL. Every write privilege on all 86
--     tables was handed out by pg_default_acl at CREATE time.
--
-- WHAT THAT DOES AND DOES NOT MEAN:
--   * EXISTING TABLES CANNOT BE LOCKED BY THIS. ALTER DEFAULT PRIVILEGES
--     changes what happens at CREATE time and rewrites no existing ACL. All 88
--     tables keep exactly the privileges they have. Nothing that works today
--     stops working. Same scope note 0192 carries.
--   * FUTURE TABLES CHANGE BEHAVIOUR, AND THIS IS THE REAL COST. After this, a
--     newly created table gives `authenticated` SELECT and nothing else. Since
--     this project has never once written an explicit write grant, the next
--     migration that creates a table the app writes to produces a table the app
--     can read but not write — and it fails at RUNTIME as a permission error in
--     the browser, not at migration time where it would be obvious.
--
-- A safer default bought with a new way to break. That is why it is management's
-- call and not a quiet cleanup. The §6 footer note at the bottom is the
-- mitigation and it is not optional.
--
-- ---------------------------------------------------------------------------
-- THIS MAY NOT HOLD, AND THIS PROJECT HAS ALREADY SEEN IT NOT HOLD
-- ---------------------------------------------------------------------------
-- 0192 did exactly this for FUNCTIONS: `alter default privileges in schema
-- public revoke execute on functions from anon`. 0193 then records that a
-- throwaway function created afterwards came back anon-EXECUTABLE ANYWAY.
-- Something on this platform grants outside the postgres default-ACL row, and
-- 0193 states plainly that the mechanism was never fully identified. 0193 had
-- to install an event trigger to win.
--
-- So this file is expected to be a REAL NARROWING and is NOT expected to be a
-- GUARANTEE. The canary tells us which, and per 0193 the authority is the
-- POST-APPLY canary, not the in-migration one: if whatever re-grants does so
-- after ddl_command_end, an in-transaction probe comes out clean and is wrong.
--
-- SUPABASE_ADMIN'S ROW IS UNREACHABLE, measured, not assumed:
-- pg_has_role('postgres','supabase_admin','member') = false. It is ATTEMPTED
-- below and allowed to fail, exactly as 0192 does. Do NOT escalate to force it.
-- It also matters less than it looks: default ACLs key on the role that OWNS
-- the new object, and all 88 tables and all 50 views in public are owned by
-- `postgres`. The postgres row is the one our migrations actually draw on.
--
-- SELECT IS KEPT THROUGHOUT. `authenticated` must still read a new view the
-- moment it is created or the next report ships blank. REFERENCES and TRIGGER
-- are left alone for the reasons in 0199's header.
-- ===========================================================================

-- NO ENCLOSING TRANSACTION, deliberately. When this is promoted to a migration
-- it should stay separable from anything else in that file: it is the part with
-- precedent for not working, and it must not be able to take working DDL down
-- with it.

-- Implicit FOR ROLE current_user = postgres, which owns all 138 relations in
-- public. This is the row that matters.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from authenticated;

-- The supabase_admin-owned row. Expected to fail — postgres is not a member,
-- measured — and MUST NOT abort the file. The handler is a plpgsql
-- subtransaction, so the failure is contained and the statement above is not
-- rolled back with it. Same shape as 0192.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke insert, update, delete, truncate on tables from authenticated';
  raise notice '0199b: supabase_admin default-privilege revoke SUCCEEDED (unexpected, but fine).';
exception
  when insufficient_privilege then
    raise notice '0199b: cannot alter supabase_admin default privileges (not a member) - EXPECTED, skipping. The postgres-grantor revoke above is the one our objects draw on, since postgres owns all of them.';
end $$;

-- ---------------------------------------------------------------------------
-- THE CANARY — does a view created AFTER the default-revoke come out clean?
--
-- The throwaway is created, measured, and DROPPED BEFORE ANY RAISE, so the
-- assertion cannot leave a stray view behind and cannot break the 50-count
-- census on a re-run. It is deliberately not security_invoker: it exists for
-- three statements and is never read.
--
-- PER 0193, A GREEN HERE IS NOT THE ANSWER. If the platform re-grants after
-- ddl_command_end, this in-transaction probe passes and a real view created
-- tomorrow is still wide open. The post-apply canary below is the authority.
-- Do not skip it because this printed OK.
-- ---------------------------------------------------------------------------
do $$
declare
  can_ins  boolean;
  can_upd  boolean;
  can_del  boolean;
  can_sel  boolean;
  raw_acl  text;
begin
  execute 'drop view if exists public._zz_0199b_grant_canary';
  execute 'create view public._zz_0199b_grant_canary as select 1 as one';

  select has_table_privilege('authenticated','public._zz_0199b_grant_canary','insert'),
         has_table_privilege('authenticated','public._zz_0199b_grant_canary','update'),
         has_table_privilege('authenticated','public._zz_0199b_grant_canary','delete'),
         has_table_privilege('authenticated','public._zz_0199b_grant_canary','select'),
         coalesce(c.relacl::text, '(null)')
    into can_ins, can_upd, can_del, can_sel, raw_acl
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = '_zz_0199b_grant_canary';

  -- Dropped before any raise below. Cleanup is not conditional on passing.
  execute 'drop view public._zz_0199b_grant_canary';

  if not can_sel then
    raise exception
      '0199b FAIL: the default-privilege revoke went too far — a new view does not even grant SELECT to authenticated. Raw acl was %. Every future view would ship blank.', raw_acl;
  end if;

  if can_ins or can_upd or can_del then
    raise exception
      '0199b CANARY FAILED: a view created after the default-revoke still grants write to authenticated (insert=%, update=%, delete=%). Raw acl was %. This is the 0192 outcome repeating: something grants outside the postgres default-ACL row. 0199''s sweep of the existing 50 still stands and should NOT be rolled back — but the gap is not durably closed, and closing it needs 0193''s event-trigger approach rather than a default-privilege revoke.',
      can_ins, can_upd, can_del, raw_acl;
  end if;

  raise notice
    '0199b CANARY OK (in-transaction): a new view came out SELECT-only for authenticated. Raw acl %. Run the POST-APPLY canary below before believing it.', raw_acl;
end $$;

-- ---------------------------------------------------------------------------
-- §6 FOOTER NOTE — GOES INTO CLAUDE.md §6 WHEN THIS IS APPLIED, NOT BEFORE.
--
-- NEW VIEWS: unchanged. `grant select on public.X to authenticated;` is still
-- the whole story, and the default no longer adds write behind it.
--
-- NEW TABLES: CHANGED, AND THIS IS THE ONE THAT WILL BITE. A table created
-- after this migration gives `authenticated` SELECT ONLY. The
-- `authenticated_all_X` policy that every table carries is an RLS POLICY, not a
-- grant — it decides which rows are visible once the privilege is already held,
-- and it will happily sit there granting nothing while the app gets permission
-- denied. If the app writes the table, the migration MUST now say so:
--
--   grant select, insert, update, delete on public.X to authenticated;
--
-- Omitting it does not fail the migration. It fails later, in the browser, as a
-- permission error on the first write. The 88 tables that predate this file are
-- unaffected and keep the privileges they already have.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- THE POST-APPLY CANARY — THIS IS THE AUTHORITY, NOT THE IN-MIGRATION ONE.
--
-- 0193's lesson, paid for once already: the in-transaction probe after 0192
-- looked fine and the mechanism still re-granted. Run this in a SEPARATE
-- session, after the migration has fully committed, and read the OWNER and the
-- RAW ACL rather than just the boolean — the owner is what identifies which
-- default-ACL row the new object actually drew on.
--
--   select current_user, session_user;
--   create view public._zz_0199b_after as select 1 as one;
--   select c.relowner::regrole::text as owner,
--          coalesce(c.relacl::text,'(null)') as raw_acl,
--          has_table_privilege('authenticated', c.oid, 'select') as sel,
--          has_table_privilege('authenticated', c.oid, 'insert') as ins,
--          has_table_privilege('authenticated', c.oid, 'update') as upd,
--          has_table_privilege('authenticated', c.oid, 'delete') as del
--     from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
--    where ns.nspname='public' and c.relname='_zz_0199b_after';
--   drop view public._zz_0199b_after;
--
-- WANT: sel = true, ins/upd/del = false.
-- IF ins/upd/del COME BACK TRUE: this is 0192 repeating. 0199's sweep is still
-- correct and stays. This file is defeated, and durably closing the gap needs
-- 0193's event-trigger approach — a `zz_`-prefixed ddl_command_end trigger that
-- sorts after pgrst_ddl_watch — not another default-privilege revoke.
--
-- ALSO RE-RUN THE SAME CANARY WITH A TABLE, not just a view. The table is where
-- the cost lands and it is the half that was never probed:
--   create table public._zz_0199b_tbl (id int);  -- then read its relacl
--
-- DROP THE CANARY EVEN IF IT FAILS. A leftover relation breaks the 50/50/0
-- census for everyone who runs it next.
-- ---------------------------------------------------------------------------
