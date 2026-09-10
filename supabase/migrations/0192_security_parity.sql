-- 0192_security_parity.sql
-- Narrow the anon-EXECUTE default on the postgres grantor, and put the two
-- out-of-band security objects into the migration set so a from-scratch rebuild
-- reproduces them.
--
-- THIS FILE DOES NOT CLOSE THE ANON-EXECUTE FOOTGUN. It was drafted believing it
-- did; the post-apply canary in section B below came back TRUE and falsified
-- that. 0193's event trigger is the enforcement. Section 1 explains what this
-- file does and does not buy — read it before quoting this one anywhere.
--
-- BARE STATEMENTS. No begin;/commit; — 0173+ rule, CLAUDE.md §5. The SQL Editor
-- wraps the submission; a nested begin; is ignored with a warning and the
-- trailing commit; would end the EDITOR's transaction, printing green grids for
-- work that never landed. That also satisfies §6's "re-revoke in the same
-- transaction": everything below is one transaction already.
--
-- ===========================================================================
-- WHAT THIS FILE IS FOR
-- ===========================================================================
-- An exhaustive catalog diff of production (ceqzmztewbborwgxnrqh) against a
-- from-scratch replay of 0001..0191 (vlyxazfinmlanjdttavg) found three
-- security-relevant divergences. Two of them are objects that EXIST on
-- production and are created by NO migration — so the rebuild is not merely
-- different, it is LESS SECURE. One of them is a live footgun on production
-- that no migration has ever addressed.
--
-- Categories measured IDENTICAL and therefore absent from this file: RLS flags
-- (87 tables), the policy set (89 policies), triggers (19), views (50),
-- sequences, extensions, column defaults, and all 1644 table grants.
--
-- ===========================================================================
-- 1) THE ANON-EXECUTE DEFAULT — DEFENCE IN DEPTH, NOT A FIX
-- ===========================================================================
-- READ THIS BEFORE BELIEVING THIS SECTION CLOSED ANYTHING. It did not, and an
-- earlier revision of this comment said it did. The canary run after this file
-- applied came back ANON-EXECUTABLE. The enforcement is 0193's event trigger.
--
-- Measured on production 2026-09-10, BEFORE this file:
--
--     pg_default_acl (postgres,       public, FUNCTIONS)
--       = {postgres=X,anon=X,authenticated=X,service_role=X}
--     pg_default_acl (supabase_admin, public, FUNCTIONS)
--       = {postgres=X,anon=X,authenticated=X,service_role=X}
--
-- This file revokes anon from the FIRST row only. The second is unreachable:
-- pg_has_role('postgres', 'supabase_admin', 'member') = false, measured, and
-- there is no privilege path from here to it.
--
-- WHAT THIS SECTION ACTUALLY BUYS: the postgres grantor — the role the SQL
-- Editor connects as, and the one that creates every function this project
-- owns — no longer hands anon EXECUTE by default. That is a real narrowing and
-- worth keeping. It is DEFENCE IN DEPTH on one grantor, and it is one of two
-- grantors.
--
-- WHAT IT DOES NOT BUY: a guarantee. A function created after this file still
-- came back anon-executable, so something outside the postgres default-ACL row
-- is granting — the supabase_admin row is the leading candidate and the
-- mechanism is not yet positively identified (0193's header carries the open
-- item and the exact query that would settle it).
--
-- THE ACTUAL ENFORCEMENT IS 0193: an event trigger on ddl_command_end for
-- CREATE FUNCTION that revokes public+anon on every new or replaced function in
-- schema public. That runs after whatever granted, which is why it works where
-- a default privilege cannot.
--
-- Nothing here removes §6's per-function `revoke execute ... from public, anon`
-- footer. Three layers now, and the middle one is the weakest.
--
-- SCOPE: ALTER DEFAULT PRIVILEGES changes what happens at CREATE time. It
-- rewrites no existing ACL and touches no existing function. Nothing that works
-- today stops working. The supabase_admin row is ATTEMPTED below and allowed to
-- fail; do NOT escalate to force it.
--
-- ===========================================================================
-- 2) stock_receipt_approvals — SECURED ON PRODUCTION BY NOTHING IN GIT
-- ===========================================================================
-- 0057_receipt_approval_direct_invoices.sql:96 creates the table with NO RLS,
-- NO policy and NO revoke. A repo-wide code-grep for the policy name
-- `authenticated_all_stock_receipt_approvals` returns ZERO hits, and a grep of
-- all 189 migrations for `stock_receipt_approvals` crossed with
-- (row level|policy|revoke|grant) returns NOTHING.
--
-- Yet production carries relrowsecurity = true and that exact policy. Somebody
-- enabled it out of band and git has no record. THE REBUILD LEAVES THE TABLE
-- WITH RLS OFF AND NO POLICY — an authenticated free-for-all with no gate.
--
-- This is the finding a naive hash comparison reports GREEN, because the
-- replay project had the same patch applied to it by hand during seeding. Both
-- sides matching proved the two patches matched, not that the migration set
-- produces the object.
--
-- Every statement below is idempotent and a no-op on production as measured.
--
-- ===========================================================================
-- 3) projects_set_initials() — anon EXECUTE, revoked on prod, not in git
-- ===========================================================================
-- Measured: has_function_privilege('anon', 'public.projects_set_initials()',
-- 'execute') is FALSE on production and TRUE on the rebuild. Nothing in
-- 0001..0191 revokes it — 0033, 0147 and 0180 are the only files that mention
-- the function, and 0180:20 is an ALTER FUNCTION ... SET search_path, which
-- does not touch an ACL. Another out-of-band change.
--
-- It is a TRIGGER function, so the §6 invariant — zero NON-TRIGGER functions
-- anon-executable — holds on both sides either way, and this is the lowest
-- severity item here. It is included because the standard for this pass is
-- parity, and because a one-line revoke that is a proven no-op on production
-- costs nothing.
--
-- THE OFFENDER IS THE PUBLIC ENTRY. `anon` inherits PUBLIC, so the revoke names
-- BOTH `public` and `anon`; revoking `anon` alone changes nothing.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) Default privileges: stop granting anon EXECUTE on future functions.
-- ---------------------------------------------------------------------------
-- Implicit FOR ROLE current_user = postgres. This is the row that matters.
alter default privileges in schema public revoke execute on functions from anon;

-- The supabase_admin-owned row. Expected to fail; MUST NOT abort the file.
-- The handler is a plpgsql subtransaction, so the failure is contained and the
-- statement above is not rolled back with it.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke execute on functions from anon';
  raise notice '0192: supabase_admin default-privilege revoke SUCCEEDED (unexpected, but fine).';
exception
  when insufficient_privilege then
    raise notice '0192: cannot alter supabase_admin default privileges (not a member) - EXPECTED, skipping. The postgres-grantor revoke above is the one that matters.';
  when others then
    raise notice '0192: supabase_admin default-privilege revoke skipped: % (%). Not fatal.', sqlerrm, sqlstate;
end $$;


-- ---------------------------------------------------------------------------
-- 2) stock_receipt_approvals: RLS, policy, anon revoke.
-- ---------------------------------------------------------------------------
alter table public.stock_receipt_approvals enable row level security;

-- §6: a new table in public still ends with this even though 0161 revoked anon
-- via default privileges. Default privileges only affect tables created AFTER
-- them, and on a fresh rebuild 0057 runs long before 0161 — the explicit line
-- is what makes the end state correct regardless of ordering.
revoke all on public.stock_receipt_approvals from anon;

-- PostgreSQL has no CREATE POLICY IF NOT EXISTS, at any version (confirmed
-- against the live server: PostgreSQL 17.6). The do-block is the only
-- idempotent form.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'stock_receipt_approvals'
       and policyname = 'authenticated_all_stock_receipt_approvals'
  ) then
    create policy "authenticated_all_stock_receipt_approvals"
      on public.stock_receipt_approvals
      for all to authenticated
      using (true) with check (true);
    raise notice '0192: created policy authenticated_all_stock_receipt_approvals (rebuild path).';
  else
    raise notice '0192: policy authenticated_all_stock_receipt_approvals already present - no-op (production path).';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3) projects_set_initials(): drop the inherited PUBLIC execute.
-- ---------------------------------------------------------------------------
revoke execute on function public.projects_set_initials() from public, anon;


-- ===========================================================================
-- VERIFICATION — ASSERTS, NOT PRINTS. A failure RAISES and rolls the file back.
-- ===========================================================================
-- CLAUDE.md §5: a migration's own result grid is a claim; the catalog is the
-- evidence. So this reads the catalog, and it raises rather than selecting, so
-- that nobody has to notice a wrong number in a grid.
--
-- §6's two inverting read-backs are both avoided deliberately:
--   · privilege is read with has_function_privilege(...), NEVER by matching
--     proacl text — a NULL proacl means "default privileges", not "no grants",
--     and reads as locked-down when it is wide open
--   · functions are identified by p.oid::regprocedure::text, NEVER by
--     pg_get_function_identity_arguments()
-- Both mistakes report a healthy function as a breach, or the reverse. A false
-- catastrophe reads exactly like a real one.
-- ===========================================================================
do $$
declare
  v_defacl_rows   int;
  v_anon_default  boolean;
  v_public_default boolean;
  v_rls           boolean;
  v_forced        boolean;
  v_policies      int;
  v_anon_tbl      text;
  v_auth_tbl      text;
  v_psi_anon      boolean;
  v_bad_fns       text;
  v_bad_count     int;
begin
  -- (1a) The postgres-grantor default ACL row must still EXIST. This is not
  --      pedantry: if the row is deleted, the built-in default applies instead,
  --      which is EXECUTE TO PUBLIC — strictly WORSE than what we started with,
  --      and it would read as "anon not listed" to a careless check.
  select count(*) into v_defacl_rows
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where d.defaclrole = 'postgres'::regrole
     and n.nspname = 'public'
     and d.defaclobjtype = 'f';

  if v_defacl_rows <> 1 then
    raise exception
      '0192: the (postgres, public, FUNCTIONS) default-ACL row is GONE (% rows). With no row, Postgres falls back to its built-in default of EXECUTE TO PUBLIC, which anon inherits - that is worse than before this file ran. Rolling back.',
      v_defacl_rows;
  end if;

  -- (1b) Neither anon nor PUBLIC may hold EXECUTE in that row. PUBLIC is
  --      grantee oid 0 in aclexplode, and it is checked because granting PUBLIC
  --      is how anon gets execute without anon ever being named.
  select bool_or(a.grantee = 'anon'::regrole::oid  and a.privilege_type = 'EXECUTE'),
         bool_or(a.grantee = 0                     and a.privilege_type = 'EXECUTE')
    into v_anon_default, v_public_default
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and n.nspname = 'public'
     and d.defaclobjtype = 'f';

  if coalesce(v_anon_default, false) or coalesce(v_public_default, false) then
    raise exception
      '0192: default privileges STILL grant EXECUTE on future functions (anon=%, PUBLIC=%). The revoke did not take. Rolling back.',
      coalesce(v_anon_default, false), coalesce(v_public_default, false);
  end if;

  -- (2a) RLS is on.
  select c.relrowsecurity, c.relforcerowsecurity
    into v_rls, v_forced
    from pg_class c
   where c.oid = 'public.stock_receipt_approvals'::regclass;

  if v_rls is not true then
    raise exception
      '0192: stock_receipt_approvals has relrowsecurity = %, expected true. Rolling back.', v_rls;
  end if;

  -- (2b) The policy exists, by NAME. A count alone would be satisfied by some
  --      other policy appearing, which is not the same guarantee.
  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'stock_receipt_approvals'
     and policyname = 'authenticated_all_stock_receipt_approvals';

  if v_policies <> 1 then
    raise exception
      '0192: expected exactly 1 policy named authenticated_all_stock_receipt_approvals on stock_receipt_approvals, found %. Rolling back.',
      v_policies;
  end if;

  -- (2c) anon holds NOTHING on the table, and authenticated is UNHARMED.
  --      The second half matters: a revoke aimed at anon that took out
  --      authenticated would lock the app out of its own approvals table, and
  --      RLS being on would make the failure look like a policy bug.
  select string_agg(p, ',' order by p) into v_anon_tbl
    from unnest(array['select','insert','update','delete','truncate','references','trigger']) p
   where has_table_privilege('anon', 'public.stock_receipt_approvals', p);

  if v_anon_tbl is not null then
    raise exception
      '0192: anon still holds [%] on stock_receipt_approvals. Rolling back.', v_anon_tbl;
  end if;

  select string_agg(p, ',' order by p) into v_auth_tbl
    from unnest(array['select','insert','update','delete']) p
   where has_table_privilege('authenticated', 'public.stock_receipt_approvals', p);

  if v_auth_tbl is distinct from 'delete,insert,select,update' then
    raise exception
      '0192: authenticated privileges on stock_receipt_approvals are [%], expected [delete,insert,select,update]. This file was supposed to touch anon only. Rolling back.',
      coalesce(v_auth_tbl, '<none>');
  end if;

  -- (3) projects_set_initials() is not anon-executable.
  select has_function_privilege('anon', p.oid, 'execute')
    into v_psi_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'projects_set_initials()';

  if v_psi_anon is null then
    raise exception
      '0192: projects_set_initials() was not found by regprocedure. Rolling back.';
  end if;

  if v_psi_anon is not false then
    raise exception
      '0192: anon can still execute projects_set_initials(). Rolling back.';
  end if;

  -- (4) THE SCHEMA-WIDE INVARIANT, restated in full: ZERO non-trigger functions
  --     in public are anon-executable. This is the one assertion here that is
  --     about the whole database rather than about this file's three changes,
  --     and it is the one worth having - it fails if ANY unrelated function has
  --     drifted open since 0164.
  --
  --     prokind in ('f','p') covers functions and procedures. Measured on
  --     production 2026-09-10: 0 procedures and 0 aggregates/windows exist in
  --     public, so this widening is free today and correct if one is added.
  --
  --     Trigger functions are excluded because they are unreachable via
  --     PostgREST and several legitimately remain anon-executable - measured
  --     4 on production, 5 on the rebuild, all with prorettype = trigger.
  select coalesce(string_agg(p.oid::regprocedure::text, ', '
                             order by p.oid::regprocedure::text), ''),
         count(*)
    into v_bad_fns, v_bad_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('anon', p.oid, 'execute');

  if v_bad_count <> 0 then
    raise exception
      '0192: INVARIANT BROKEN - % non-trigger function(s) in public are anon-executable: %. The anon key ships in the client bundle, and a SECURITY DEFINER function runs as its owner, bypassing RLS. Rolling back.',
      v_bad_count, v_bad_fns;
  end if;

  raise notice '0192: all four assertions passed. postgres-grantor default-ACL no longer grants anon (one grantor of two - NOT the whole footgun, see section 1), stock_receipt_approvals gated, projects_set_initials revoked, zero non-trigger functions anon-executable.';
end $$;


-- ===========================================================================
-- POST-APPLY READ-BACK — run these by hand afterwards. Do not skip them
-- because the block above passed: it ran INSIDE the transaction it was
-- guarding. These run after the commit, which is a different claim.
-- ===========================================================================
--
-- A) THE DEFAULT ACL. Expect exactly one row for (postgres, public, FUNCTIONS)
--    and no `anon=X` inside it. The supabase_admin row is expected to KEEP its
--    anon entry - that is the documented, deliberate non-change.
--
--      select pg_get_userbyid(d.defaclrole) as grantor,
--             n.nspname as schema,
--             d.defaclacl::text as acl
--        from pg_default_acl d
--        join pg_namespace n on n.oid = d.defaclnamespace
--       where d.defaclobjtype = 'f' and n.nspname = 'public'
--       order by 1;
--      -- postgres      -> {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      -- supabase_admin -> unchanged, still lists anon=X
--
-- B) PROVE THE DEFAULT ACTUALLY BITES, rather than trusting the catalog text.
--    This is the "prove a guard can fail before trusting green" step - create a
--    throwaway function and read its privilege back. Run as postgres:
--
--      create function public._0192_canary() returns int language sql as 'select 1';
--      select has_function_privilege('anon', 'public._0192_canary()', 'execute');
--      drop function public._0192_canary();
--
--    THIS CANARY WAS RUN ON PRODUCTION 2026-09-10 AND CAME BACK **TRUE**.
--    That is the measurement that falsified this file's original claim. The
--    postgres-grantor revoke above did take - assertion (1b) proves the row no
--    longer grants anon - and a function created afterwards was STILL born
--    anon-executable, so the grant comes from somewhere else. Section 1 has the
--    analysis; 0193 has the fix and the open item on the exact mechanism.
--
--    RE-RUNNING THIS TODAY RETURNS FALSE, and that is 0193's event trigger
--    doing it, not this file. Do not read a false here as section 1 working.
--    To attribute correctly, check pg_event_trigger for
--    zz_revoke_anon_execute_on_new_functions first.
--
-- C) THE TABLE.
--      select c.relrowsecurity, c.relforcerowsecurity
--        from pg_class c where c.oid = 'public.stock_receipt_approvals'::regclass;
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname='public' and tablename='stock_receipt_approvals';
--      -- expect relrowsecurity = true, and one ALL policy for {authenticated}.
--
-- D) THE FUNCTION, and the invariant. Expect zero rows from the second query.
--      select has_function_privilege('anon', 'public.projects_set_initials()', 'execute');
--      -- expect false.
--
--      select p.oid::regprocedure::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.prokind in ('f','p')
--         and p.prorettype <> 'trigger'::regtype
--         and has_function_privilege('anon', p.oid, 'execute');
--      -- expect 0 rows.
--
-- E) WHAT THIS FILE DELIBERATELY DID NOT DO, so the next reader does not think
--    it was forgotten. All of these are real divergences from the rebuild and
--    all are non-security:
--      · commission_types.label_ar is NOT NULL per 0080:66, nullable on prod
--      · staff_commissions_commission_type_fkey lacks its ON UPDATE CASCADE
--        ON DELETE RESTRICT on prod
--      · three prod-only indexes in no migration: staff_commissions_staff_id_idx,
--        stock_receipt_approvals_receipt_id_idx, stock_receipts_status_idx
--      · start_work_order(uuid,text) and dispatch_outsourced_job(uuid,text)
--        carry a post-0076 revision on prod that no migration contains
--    They are schema/logic parity, not security, and each needs its own ruling.
--    Keeping them out of a security file is the point - this one should be
--    reviewable in a sitting.
-- ===========================================================================
