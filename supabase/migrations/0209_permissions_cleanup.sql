-- ===========================================================================
-- 0209 — PERMISSIONS CLEANUP: CLOSE THE LAST anon SURFACES IN public
-- ===========================================================================
-- DEPLOYMENT ITEM 4. Drafted by Code, applied by the architect. Do not
-- self-apply.
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD BY THE ARCHITECT, 2026-09-22. Re-measure before applying;
-- every count below is a point-in-time reading and will drift.
-- ---------------------------------------------------------------------------
--   * public TABLES: 0 hold any anon privilege. RLS on for all.        DONE
--   * pg_default_acl, grantor postgres, schema public:
--       objtype 'r' (tables + views) — anon already absent.            DONE
--       objtype 'f' (functions)      — anon already absent (0192).     DONE
--       objtype 'S' (sequences)      — anon STILL holds rwU.           OPEN → (a)
--   * SEQUENCES that exist: exactly 1, public.trips_ref_seq, and anon
--     holds usage + update on it.                                      OPEN → (b)
--   * FUNCTIONS anon can EXECUTE: exactly 4, all trigger functions.    OPEN → (c)
--
-- So this file closes three gaps and asserts the other two stayed shut. It is
-- a NARROWING ONLY — nothing here grants anything to anyone.
--
-- ---------------------------------------------------------------------------
-- (c) IS SAFE, AND 0193 ALREADY ANSWERED WHY — QUOTED, NOT RE-REASONED
-- ---------------------------------------------------------------------------
-- 0193's header: "EXECUTE privilege on a trigger function is checked when the
-- TRIGGER IS CREATED, not when it fires — at fire time the executor calls it
-- directly. So a trigger function with no anon grant keeps working for every
-- role." They are also unreachable through PostgREST, which is why CLAUDE.md
-- §6's non-trigger scoping exists at all.
--
-- 0083 measured the same four in 2025-09 and deliberately EXCLUDED them, to
-- keep a replay byte-identical to prod's end state. 0193 left them alone too,
-- acting on new and replaced functions only. Neither file argued they should
-- KEEP anon — both declined to change prod's end state as a side effect. This
-- file changes it on purpose, which is the whole point of the deployment item.
--
-- NOTHING IS GRANTED BACK. Checked before writing this, not assumed: every
-- reference to all four across the repo is a `create trigger ... execute
-- function`, an `alter function ... set search_path` (0180), or a comment.
-- Zero `.rpc(` calls in app code, zero `select`/`perform` call sites in SQL.
-- So `grant execute ... to authenticated, service_role` is NOT included — a
-- grant nothing calls is the privilege we are here to remove.
--
-- REVOKING FROM `public` IS THE LOAD-BEARING HALF. anon inherits whatever the
-- PUBLIC pseudo-role holds, and per 0147's header these functions still carry
-- the default PUBLIC EXECUTE. Revoking from anon alone would leave all four
-- anon-executable through PUBLIC and the verification below would catch it.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT IN THIS FILE
-- ---------------------------------------------------------------------------
-- 1. EVERY STATEMENT FROM .planning/post-deploy/0199b. All of 0199b acts on
--    `authenticated`, not anon — it revokes INSERT/UPDATE/DELETE/TRUNCATE from
--    the tables default so future tables stop being writable by default. None
--    of it is in effect, and none of it belongs here:
--      · different axis. This file is the anon sweep; 0199b changes what
--        `authenticated` can do to tables that do not exist yet.
--      · 0199b's own header forbids the packaging. "NO ENCLOSING TRANSACTION,
--        deliberately … it is the part with precedent for not working, and it
--        must not be able to take working DDL down with it." 0209 is one
--        begin;/commit;. Putting 0199b inside it does exactly what that line
--        says not to do.
--      · it is not free. After it, a newly created table gives `authenticated`
--        SELECT only, and the next migration that forgets an explicit write
--        grant fails in the browser rather than at migration time. It needs the
--        CLAUDE.md §6 footer note in the same commit and a post-apply canary in
--        a separate session. 0199b calls that mitigation "not optional".
--      · it is management's call (Turki's, 2026-09-14), scheduled with the
--        RBAC work, not folded into a cleanup.
--    It stays where it is, unrenumbered. Promote it as its own migration.
-- 2. supabase_admin's default privileges. Platform-owned; the architect's
--    instruction is explicit. 0199b's attempt-and-swallow block for that row is
--    dropped with the rest of it. (pg_has_role('postgres','supabase_admin',
--    'member') = false anyway, measured in 0192 and again in 0199b.)
-- 3. Any grant. See above.
--
-- ---------------------------------------------------------------------------
-- SCOPE, SAME NOTE 0192 AND 0199b BOTH CARRY
-- ---------------------------------------------------------------------------
-- (a) ALTER DEFAULT PRIVILEGES rewrites no existing ACL. It changes what a
-- sequence created AFTER this migration comes out holding. The one sequence
-- that exists today is fixed explicitly by (b) — that pairing is why both
-- statements are here and neither is redundant.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- (a) THE DEFAULT. Implicit FOR ROLE would also be postgres here, but it is
-- written out: this row is the one every object in public draws on, because
-- postgres owns all of them, and naming it makes the file say which of the two
-- grantor rows it touched.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- (b) THE ONE SEQUENCE THAT ALREADY EXISTS. anon holds usage + update on it
-- (measured); `all` also covers select, so the statement does not depend on
-- that reading staying accurate.
--
-- `authenticated` and `service_role` are NOT touched. public.trips_ref_seq
-- backs the per-project trip ref (0033, gap-filled in 0174) and anything that
-- draws from it keeps doing so.
-- ---------------------------------------------------------------------------
revoke all on sequence public.trips_ref_seq from anon;

-- ---------------------------------------------------------------------------
-- (c) THE FOUR TRIGGER FUNCTIONS. Exact signatures — all four are zero-arg and
-- return trigger, read off their defining migrations:
--   set_updated_at()                      0157_issue_reports
--   trips_station_offers_water_type()     0114_trips_station_water_type_guard
--   record_salary_change()                0125_salary_history
--   record_project_commission_change()    0147_project_commission_sync_trigger
--
-- `from anon, public` in that order matches the form 0083 settled on.
-- ---------------------------------------------------------------------------
revoke execute on function public.set_updated_at()                    from anon, public;
revoke execute on function public.trips_station_offers_water_type()   from anon, public;
revoke execute on function public.record_salary_change()              from anon, public;
revoke execute on function public.record_project_commission_change()  from anon, public;

-- ---------------------------------------------------------------------------
-- (e) VERIFICATION — RAISES, SO A FAILURE ROLLS THE WHOLE FILE BACK.
--
-- Every check uses has_*_privilege rather than reading relacl/proacl text,
-- because those functions resolve PUBLIC inheritance and role membership. A
-- privilege anon holds only through PUBLIC is still a privilege anon holds, and
-- an acl-text scan would miss exactly that case.
--
-- ONE THING THIS CANNOT SEE, stated rather than hidden: the implicit PUBLIC
-- EXECUTE that Postgres puts on every NEWLY created function does not appear in
-- pg_default_acl, so check 4 cannot assert its absence. That gap is 0193's
-- event trigger's job (zz_revoke_anon_execute_on_new_functions), not this
-- file's, and 0192's failure is the precedent for why a default-ACL revoke
-- alone was never going to cover it.
-- ---------------------------------------------------------------------------
do $$
declare
  n_tables  int;
  n_seqs    int;
  n_funcs   int;
  n_defacl  int;
  n_views   int;
  offenders text;
begin
  -- 1. No public TABLE gives anon anything at all.
  select count(*), coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    into n_tables, offenders
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'truncate')
       or has_table_privilege('anon', c.oid, 'references')
       or has_table_privilege('anon', c.oid, 'trigger'));

  if n_tables <> 0 then
    raise exception
      '0209 FAIL: % public table(s) still give anon a privilege: %. This file revokes nothing on tables — it asserts a state the architect measured as already clean, so a failure here means the measurement drifted or something re-granted. Investigate before re-running.',
      n_tables, offenders;
  end if;

  -- 2. No public SEQUENCE is usable by anon. usage/select/update are the three
  --    privileges a sequence has.
  select count(*), coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    into n_seqs, offenders
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage')
       or has_sequence_privilege('anon', c.oid, 'select')
       or has_sequence_privilege('anon', c.oid, 'update'));

  if n_seqs <> 0 then
    raise exception
      '0209 FAIL: % public sequence(s) still usable by anon: %. If the only name here is trips_ref_seq, the revoke above did not reach it — most likely anon is inheriting through the PUBLIC pseudo-role, which needs `revoke all on sequence public.trips_ref_seq from public` and a fresh look at who else reads it.',
      n_seqs, offenders;
  end if;

  -- 3. No public FUNCTION is executable by anon. Deliberately unfiltered by
  --    prokind: an aggregate or a procedure anon can execute counts too.
  select count(*), coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into n_funcs, offenders
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute');

  if n_funcs <> 0 then
    raise exception
      '0209 FAIL: % public function(s) still executable by anon: %. The four this file revokes are trigger functions; anything else named here is new since the 2026-09-22 measurement and needs its own decision, not a blanket revoke.',
      n_funcs, offenders;
  end if;

  -- 4. The postgres default-ACL rows for tables, functions and sequences give
  --    anon nothing, so a relation created tomorrow starts closed.
  select count(*),
         coalesce(string_agg(d.defaclobjtype::text, ', ' order by d.defaclobjtype::text), '')
    into n_defacl, offenders
    from pg_default_acl d
    join pg_namespace ns on ns.oid = d.defaclnamespace
   where ns.nspname = 'public'
     and d.defaclrole = 'postgres'::regrole
     and d.defaclobjtype in ('r', 'f', 'S')
     and exists (select 1
                   from aclexplode(d.defaclacl) a
                  where a.grantee = 'anon'::regrole);

  if n_defacl <> 0 then
    raise exception
      '0209 FAIL: the postgres default privileges in schema public still hand anon something on objtype(s) %. r = tables and views, f = functions, S = sequences. Every future object of that type would ship anon-readable.',
      offenders;
  end if;

  -- ADVISORY, NOT AN ASSERTION. Two readings that are worth printing and are
  -- deliberately not allowed to abort the migration:
  --
  --   (i) VIEWS. The architect measured tables; check 1 is scoped to tables to
  --       match that measurement exactly rather than failing on a surface
  --       nobody has read yet. If this prints non-zero, it is the next item.
  select count(*) into n_views
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind in ('v', 'm')
     and has_table_privilege('anon', c.oid, 'select');

  if n_views <> 0 then
    raise notice
      '0209 NOTICE: % public view(s)/matview(s) are anon-readable. Not asserted here — 0199 swept views for `authenticated` and this file was scoped to anon on tables, sequences and functions. Raise it as its own item.',
      n_views;
  end if;

  --  (ii) A PUBLIC-pseudo-role entry in the same default-ACL rows reaches anon
  --       just as surely as an anon entry does, but removing one is a wider
  --       blast radius than this file was scoped for.
  select count(*) into n_defacl
    from pg_default_acl d
    join pg_namespace ns on ns.oid = d.defaclnamespace
   where ns.nspname = 'public'
     and d.defaclrole = 'postgres'::regrole
     and d.defaclobjtype in ('r', 'f', 'S')
     and exists (select 1
                   from aclexplode(d.defaclacl) a
                  where a.grantee = 0);

  if n_defacl <> 0 then
    raise notice
      '0209 NOTICE: % postgres default-ACL row(s) in public grant the PUBLIC pseudo-role something. anon inherits PUBLIC, so this is a live path this file did not close. Decide it deliberately — revoking from PUBLIC affects every role at once.',
      n_defacl;
  end if;

  raise notice '0209 OK: anon holds nothing on public tables, sequences or functions, and the postgres defaults for r/f/S give anon nothing.';
end $$;

commit;

-- ===========================================================================
-- AFTER APPLYING — read in a SEPARATE session, once committed.
--
-- 0193's lesson, paid for once: an in-transaction probe can come out clean
-- while the platform re-grants afterwards. The four revokes here act on
-- EXISTING functions, which is not the path 0192 lost on, but the sequence
-- default (a) is the same shape of change that failed for functions — so the
-- one worth re-reading is a NEW sequence:
--
--   create sequence public._zz_0209_seq;
--   select c.relowner::regrole::text                        as owner,
--          coalesce(c.relacl::text, '(null)')                as raw_acl,
--          has_sequence_privilege('anon', c.oid, 'usage')    as anon_usage,
--          has_sequence_privilege('anon', c.oid, 'select')   as anon_select,
--          has_sequence_privilege('anon', c.oid, 'update')   as anon_update
--     from pg_class c
--     join pg_namespace ns on ns.oid = c.relnamespace
--    where ns.nspname = 'public' and c.relname = '_zz_0209_seq';
--   drop sequence public._zz_0209_seq;
--
-- WANT: all three false.
-- IF ANY COMES BACK TRUE: this is 0192 repeating on the sequence axis. The
-- explicit revoke on trips_ref_seq still stands and should not be rolled back;
-- durably closing the default needs 0193's event-trigger approach, extended to
-- CREATE SEQUENCE, rather than another default-privilege revoke.
--
-- DROP THE CANARY EVEN IF IT FAILS. A leftover sequence changes the count that
-- check 2 above asserts, for everyone who runs it next.
-- ===========================================================================
