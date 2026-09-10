-- 0193_function_execute_lockdown.sql
-- Enforce "no new function is anon-executable" with an EVENT TRIGGER, because
-- default privileges demonstrably cannot enforce it here.
--
-- BARE STATEMENTS. No begin;/commit; — 0173+ rule, CLAUDE.md §5.
--
-- ===========================================================================
-- WHY THIS EXISTS: 0192 WAS NECESSARY AND NOT SUFFICIENT
-- ===========================================================================
-- 0192 revoked the anon EXECUTE entry from the (postgres, public, FUNCTIONS)
-- default-ACL row. Verified applied:
--
--     postgres       -> {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--     supabase_admin -> {postgres=X/supabase_admin,anon=X/supabase_admin,
--                        authenticated=X/supabase_admin,service_role=X/supabase_admin}
--
-- THEN THE CANARY FAILED. A throwaway function created after 0192 came back
-- anon-EXECUTABLE. So the footgun is NOT closed by the default-ACL revoke, and
-- 0192's own section-1 comment claiming it "closes" the mechanism is wrong —
-- corrected separately.
--
-- `postgres` cannot revoke the supabase_admin row: pg_has_role('postgres',
-- 'supabase_admin', 'member') = false, measured. There is no privilege path
-- from here to that row, and escalating to get one is not on the table.
--
-- ---------------------------------------------------------------------------
-- THE MECHANISM IS NOT FULLY IDENTIFIED, AND THAT IS AN OPEN ITEM
-- ---------------------------------------------------------------------------
-- Default ACLs key on the role that OWNS the new object, so a function created
-- and owned by `postgres` should draw on the postgres row alone. It did not.
-- Something else is granting.
--
-- The six event triggers on this database were enumerated, and NONE of them
-- grants on CREATE FUNCTION:
--
--     issue_graphql_placeholder   sql_drop         {DROP EXTENSION}
--     issue_pg_cron_access        ddl_command_end  {CREATE EXTENSION}
--     issue_pg_graphql_access     ddl_command_end  {CREATE EXTENSION}
--     issue_pg_net_access         ddl_command_end  {CREATE EXTENSION}
--     pgrst_ddl_watch             ddl_command_end  (all tags — NOTIFY only)
--     pgrst_drop_watch            sql_drop         (all tags — NOTIFY only)
--
-- THIS MATTERS FOR WHETHER 0193 ACTUALLY WORKS. This file revokes at
-- ddl_command_end. If whatever re-grants does so BEFORE that point, we win. If
-- it does so AFTER — a later hook, a background reconciler, a platform job —
-- then 0193 is defeated the same way 0192 was, and the post-apply canary is
-- what tells us which. Do not treat a green in-migration probe as the answer.
--
-- WHEN RE-RUNNING THE CANARY, CAPTURE THE FULL PICTURE, not just the boolean:
--     select current_user, session_user;
--     create function public._canary() returns int language sql as 'select 1';
--     select p.proowner::regrole::text as owner, p.proacl::text,
--            has_function_privilege('anon', p.oid, 'execute')
--       from pg_proc p where p.oid = 'public._canary()'::regprocedure;
--     drop function public._canary();
-- The OWNER and the raw proacl are what identify the grantor. The boolean alone
-- cannot. (proacl is read here as EVIDENCE OF PROVENANCE, not as a privilege
-- check — §6's ban on proacl matching is about deciding "is anon allowed", and
-- has_function_privilege still answers that above.)
--
-- ===========================================================================
-- EVENT-TRIGGER ORDERING — WHY THE NAME STARTS WITH zz_
-- ===========================================================================
-- Event triggers on the same event fire in ALPHABETICAL ORDER BY NAME. Four
-- others already fire on ddl_command_end here, the last of them
-- `pgrst_ddl_watch`. If any hook were to grant anon at ddl_command_end, ours
-- must run AFTER it or the grant simply lands again behind our back.
--
-- `zz_revoke_anon_execute_on_new_functions` sorts after every existing trigger.
-- This is not cosmetic and the prefix must not be tidied away.
--
-- ===========================================================================
-- THE ONE CATASTROPHIC FAILURE MODE, AND WHY IT IS IMPOSSIBLE HERE
-- ===========================================================================
-- AN EVENT TRIGGER THAT RAISES ON ddl_command_end FOR `CREATE FUNCTION` BLOCKS
-- EVERY CREATE FUNCTION IN THE DATABASE. That bricks every future migration,
-- and it bricks the fix for itself — you cannot CREATE OR REPLACE your way out
-- when CREATE is what is broken. (Recoverable via ALTER EVENT TRIGGER ...
-- DISABLE, but only by someone who knows that is the cause.)
--
-- So the trigger function CANNOT RAISE. Two independent layers:
--
--   · each per-object revoke sits in its OWN exception block, swallowing to a
--     raise notice — one un-revokable function cannot stop the others
--   · the whole body sits in a SECOND exception block, so even a failure in
--     the iteration itself, or in the notice path, is contained
--
-- THE FAILURE DIRECTION IS DELIBERATE: on any error this file lets CREATE
-- FUNCTION SUCCEED with the function possibly still anon-executable, rather
-- than blocking DDL. Availability beats the revoke, because a missed revoke is
-- caught — every security migration since 0164 asserts the schema-wide
-- invariant, and section (4) below asserts it too. A bricked database is not
-- caught by anything; it is discovered.
--
-- Nothing here removes §6's per-function `revoke execute ... from public, anon`
-- footer. This is a FLOOR under that discipline, not a replacement for it.
--
-- ===========================================================================
-- SCOPED TO SCHEMA public — THIS IS A SAFETY REQUIREMENT, NOT TIDINESS
-- ===========================================================================
-- An event trigger fires for DDL run by ANY role, not just ours. Supabase
-- platform upgrades run CREATE OR REPLACE FUNCTION in `storage`, `auth`,
-- `graphql` and `extensions` as supabase_admin — and several of those
-- functions are MEANT to be anon-callable (public storage buckets, the GraphQL
-- endpoint). An unscoped revoke would break Supabase Storage from inside our
-- own migration, at some unpredictable future upgrade, with no trace pointing
-- back here.
--
-- The loop therefore filters `schema_name = 'public'`. Functions created in
-- other schemas are the platform's to secure. Our invariant has only ever been
-- about `public`.
--
-- ===========================================================================
-- TWO QUESTIONS ASKED IN REVIEW, ANSWERED
-- ===========================================================================
-- Q: DOES IT FIRE ON `CREATE OR REPLACE FUNCTION` TOO?
-- A: YES, AND THAT IS THE MAIN PRIZE. PostgreSQL reports the command tag for
--    `CREATE OR REPLACE FUNCTION` as `CREATE FUNCTION` — there is no separate
--    "REPLACE FUNCTION" tag. So `when tag in ('CREATE FUNCTION')` covers both.
--
--    This closes the exact hole §6 describes: "A REDEFINED FUNCTION IS
--    EXECUTE-TO-PUBLIC AGAIN". 0115 defined issue_driver_payslip correctly,
--    0118 replaced it and did not re-revoke, and a SECURITY DEFINER money RPC
--    sat open until 0163. Under this trigger the 0118 mistake self-heals.
--    Probe (b) below tests exactly that path rather than assuming it.
--
-- Q: DOES REVOKING anon ON A TRIGGER FUNCTION HARM ANYTHING?
-- A: NO. EXECUTE privilege on a trigger function is checked when the TRIGGER IS
--    CREATED, not when it fires — at fire time the executor calls it directly.
--    So a trigger function with no anon grant keeps working for every role.
--    They are also unreachable via PostgREST, which is why §6 exempts them from
--    the invariant in the first place.
--
--    The 4 trigger functions currently anon-executable on production
--    (record_project_commission_change, record_salary_change, set_updated_at,
--    trips_station_offers_water_type) are NOT touched by this file — it acts on
--    new and replaced functions only. If one of them is later replaced it will
--    quietly lose anon, which is harmless for the reason above.
--
-- ===========================================================================
-- OPEN ITEM — `CREATE PROCEDURE` IS NOT COVERED. FLAGGING, NOT DECIDING.
-- ===========================================================================
-- A procedure gets the same default EXECUTE treatment and its command tag is
-- `CREATE PROCEDURE`, which this trigger does NOT match. Measured on production
-- 2026-09-10: ZERO procedures exist in `public`, so the gap is theoretical
-- today and closing it would change nothing observable.
--
-- It is left out because the spec for this file said `CREATE FUNCTION`, and
-- widening an enforcement trigger's blast radius is not a thing to do
-- unilaterally. The entire change, should it be ruled in:
--
--     when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
--
-- The loop body needs no change — a procedure is a pg_proc row and
-- `revoke execute on function <identity>` is not valid for it, so if this is
-- adopted the format string must become `revoke execute on routine %s`, which
-- covers both. Do not adopt half of that.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) The trigger function.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it runs as its owner (postgres) rather than as whoever
-- ran the DDL — a revoke requires ownership of the target, and postgres owns
-- everything this project creates. A function owned by someone else fails the
-- revoke, which the per-object handler swallows by design.
--
-- search_path pinned per 0180's discipline: a SECURITY DEFINER function with an
-- unpinned search_path is resolvable against a caller-controlled schema.
create or replace function public.revoke_anon_execute_on_new_functions()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  r record;
begin
  -- OUTER GUARD. Nothing below may propagate. See the header: a raise here
  -- blocks CREATE FUNCTION database-wide.
  begin
    for r in
      select c.object_identity, c.schema_name
        from pg_event_trigger_ddl_commands() c
       where c.classid = 'pg_proc'::regclass
         and c.schema_name = 'public'
    loop
      -- INNER GUARD, per object. One un-revokable function must not stop the
      -- rest of the batch, and a batch is normal: a single migration file
      -- creating twelve functions is one ddl_command_end per statement, but a
      -- DO block emitting several is one event with several commands.
      begin
        -- object_identity is already schema-qualified and correctly quoted by
        -- Postgres, e.g. public.issue_driver_payslip(uuid, date, text). Do NOT
        -- pass it through %I — that would double-quote the whole string,
        -- argument list and all, and the revoke would fail on every object.
        execute format('revoke execute on function %s from public, anon', r.object_identity);
      exception
        when others then
          raise notice
            '0193: could not revoke anon EXECUTE on % (% / %). Left as created - the schema-wide invariant assertion in a later migration will catch it if it matters.',
            r.object_identity, sqlstate, sqlerrm;
      end;
    end loop;
  exception
    when others then
      raise notice
        '0193: event-trigger body failed entirely (% / %). CREATE FUNCTION was allowed to proceed on purpose - blocking DDL is the worse failure.',
        sqlstate, sqlerrm;
  end;
end
$fn$;

-- The function is created BEFORE the trigger that would protect it, so it is
-- born with whatever the platform default gives it. Revoke explicitly. This is
-- the same footer §6 mandates, and it is load-bearing here rather than
-- ceremonial: an anon-executable SECURITY DEFINER function that runs revokes as
-- postgres is a worse object than the ones it was written to protect.
revoke execute on function public.revoke_anon_execute_on_new_functions() from public, anon;


-- ---------------------------------------------------------------------------
-- 2) The event trigger.
-- ---------------------------------------------------------------------------
-- Re-runnable. The name's zz_ prefix is ordering, not style — see the header.
drop event trigger if exists zz_revoke_anon_execute_on_new_functions;

create event trigger zz_revoke_anon_execute_on_new_functions
  on ddl_command_end
  when tag in ('CREATE FUNCTION')
  execute function public.revoke_anon_execute_on_new_functions();


-- ===========================================================================
-- VERIFICATION — ASSERTS (raise + rollback), PLUS ONE PROBE THAT ONLY PRINTS.
-- ===========================================================================
-- The distinction is the point of this block:
--
--   ASSERTIONS (1,2,4) check facts that are true inside this transaction and
--   must be true after it. They raise.
--
--   THE PROBE (3) checks whether the trigger BITES. It cannot be an assertion,
--   because PostgreSQL does not document whether an event trigger created in
--   this transaction fires for DDL later in the SAME transaction. If it does
--   not, a correct migration would roll itself back — a false catastrophe,
--   which §6 warns reads exactly like a real one. So the probe prints, and the
--   POST-APPLY canary below is the authority.
--
--   BUT THE PROBE IS NOT TOOTHLESS. It really does run CREATE FUNCTION, with
--   no exception handler around it. If the trigger function raises — the one
--   catastrophic failure mode — that CREATE fails, this block fails, and the
--   whole file rolls back. The brick is caught here, before production, rather
--   than on the next migration that tries to create a function.
-- ===========================================================================
do $$
declare
  v_evt_count   int;
  v_evt_enabled "char";
  v_evt_event   text;
  v_evt_tagged  boolean;
  v_fn_anon     boolean;
  v_probe_a     boolean;
  v_probe_b     boolean;
  v_bad_fns     text;
  v_bad_count   int;
begin
  -- (1) THE EVENT TRIGGER EXISTS, IS ENABLED, AND IS ON THE RIGHT EVENT+TAG.
  --     All four properties, because three of them being right is a trigger
  --     that silently never fires.
  select count(*) into v_evt_count
    from pg_event_trigger where evtname = 'zz_revoke_anon_execute_on_new_functions';

  if v_evt_count <> 1 then
    raise exception
      '0193: expected exactly 1 event trigger named zz_revoke_anon_execute_on_new_functions, found %. Rolling back.',
      v_evt_count;
  end if;

  select evtenabled, evtevent, ('CREATE FUNCTION' = any(evttags))
    into v_evt_enabled, v_evt_event, v_evt_tagged
    from pg_event_trigger where evtname = 'zz_revoke_anon_execute_on_new_functions';

  -- 'O' = enabled on origin, 'A' = always. 'D' = disabled, 'R' = replica only.
  if v_evt_enabled not in ('O', 'A') then
    raise exception
      '0193: event trigger evtenabled = %, expected O or A. A disabled trigger enforces nothing while looking present. Rolling back.',
      v_evt_enabled;
  end if;

  if v_evt_event is distinct from 'ddl_command_end' then
    raise exception '0193: event trigger is on event %, expected ddl_command_end. Rolling back.', v_evt_event;
  end if;

  if v_evt_tagged is not true then
    raise exception '0193: event trigger does not carry the CREATE FUNCTION tag. Rolling back.';
  end if;

  -- (2) THE TRIGGER FUNCTION IS NOT ANON-EXECUTABLE.
  --     has_function_privilege, identified by regprocedure — never proacl
  --     matching, never pg_get_function_identity_arguments(). §6, both traps.
  select has_function_privilege('anon', p.oid, 'execute')
    into v_fn_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text = 'revoke_anon_execute_on_new_functions()';

  if v_fn_anon is null then
    raise exception '0193: revoke_anon_execute_on_new_functions() not found by regprocedure. Rolling back.';
  end if;

  if v_fn_anon is not false then
    raise exception
      '0193: anon can execute revoke_anon_execute_on_new_functions(). A SECURITY DEFINER function that runs revokes as postgres must not be anon-callable. Rolling back.';
  end if;

  -- (3) THE PROBE. Prints, never raises on its own — but an exception thrown BY
  --     THE EVENT TRIGGER during these CREATEs is deliberately not caught.
  --
  --     (a) fresh CREATE FUNCTION
  execute 'create function public._0193_probe() returns int language sql as ''select 1''';

  select has_function_privilege('anon', 'public._0193_probe()', 'execute') into v_probe_a;

  --     (b) THE REDEFINE PATH — the 0115/0118 hole. Grant anon by hand, then
  --         CREATE OR REPLACE and see whether the trigger takes it back. This
  --         is the case that actually burned this project.
  execute 'grant execute on function public._0193_probe() to anon';
  execute 'create or replace function public._0193_probe() returns int language sql as ''select 2''';

  select has_function_privilege('anon', 'public._0193_probe()', 'execute') into v_probe_b;

  execute 'drop function public._0193_probe()';

  if v_probe_a is false and v_probe_b is false then
    raise notice '0193 PROBE: trigger bit on BOTH paths in-transaction (create=locked, create-or-replace=locked). Still run the post-apply canary - this ran inside the transaction that created the trigger.';
  else
    raise notice '0193 PROBE: trigger did NOT fully bite in-transaction (create anon=%, replace anon=%). This may be same-transaction event-trigger visibility rather than a broken trigger. NOT treated as failure. THE POST-APPLY CANARY DECIDES - run it before believing this file worked.',
      v_probe_a, v_probe_b;
  end if;

  -- (4) THE SCHEMA-WIDE INVARIANT still holds. Run AFTER the probe function is
  --     dropped, so a transient probe row cannot register as a violation.
  --     prokind in ('f','p') covers functions and procedures; measured 0
  --     procedures in public on 2026-09-10, so the widening is free today and
  --     correct the day one appears.
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
      '0193: INVARIANT BROKEN - % non-trigger function(s) in public are anon-executable: %. Rolling back.',
      v_bad_count, v_bad_fns;
  end if;

  raise notice '0193: event trigger present, enabled, correctly tagged; trigger function locked; invariant holds at % non-trigger anon-executable functions.', v_bad_count;
end $$;


-- ===========================================================================
-- POST-APPLY CANARY — THE ONLY REAL PROOF. RUN IT. DO NOT SKIP IT.
-- ===========================================================================
-- The block above ran inside the transaction that created the event trigger.
-- That is a different claim from "a function created tomorrow is locked". This
-- is the claim that matters, and it is the one the 0192 canary falsified — so
-- it is also the step that would have caught 0192's overclaim before it was
-- written down as fact.
--
-- Run as the role that actually writes migrations (the SQL Editor: postgres),
-- in a SEPARATE submission, after this file has committed.
--
--   -- who is creating, so the answer is attributable
--   select current_user, session_user;
--
--   -- (a) fresh create
--   create function public._0193_canary() returns int language sql as 'select 1';
--   select p.proowner::regrole::text            as owner,
--          p.proacl::text                       as raw_acl,
--          has_function_privilege('anon', p.oid, 'execute') as anon_exec
--     from pg_proc p where p.oid = 'public._0193_canary()'::regprocedure;
--   -- anon_exec MUST be false.
--
--   -- (b) the redefine path — the 0115/0118 hole, end to end
--   grant execute on function public._0193_canary() to anon;
--   select has_function_privilege('anon', 'public._0193_canary()', 'execute');  -- true, on purpose
--   create or replace function public._0193_canary() returns int language sql as 'select 2';
--   select has_function_privilege('anon', 'public._0193_canary()', 'execute');
--   -- MUST be false again. This is the trigger taking back a grant, which is
--   -- the whole point of the file.
--
--   drop function public._0193_canary();
--
-- IF (a) COMES BACK TRUE: the trigger is not firing, or something re-grants
-- AFTER ddl_command_end. Capture proowner and raw_acl from the query above —
-- the grantor is encoded in the acl (`anon=X/postgres` vs `anon=X/supabase_admin`)
-- and that identifies which mechanism is at work. 0193 does not close a
-- post-ddl_command_end re-grant and a different approach would be needed.
--
-- IF (a) IS FALSE BUT (b) IS TRUE: the tag does not cover CREATE OR REPLACE
-- after all, which would contradict the documented command tag. Report it —
-- that would be the more surprising result of the two.
--
-- ===========================================================================
-- IF THIS FILE EVER BRICKS CREATE FUNCTION — THE ESCAPE HATCH
-- ===========================================================================
-- Symptom: any migration containing CREATE FUNCTION fails with an error raised
-- from revoke_anon_execute_on_new_functions(). The two exception layers are
-- meant to make this impossible; write it down anyway, because the one thing
-- you cannot do in that state is CREATE OR REPLACE the fix.
--
--   alter event trigger zz_revoke_anon_execute_on_new_functions disable;
--   -- ... fix the function, then ...
--   alter event trigger zz_revoke_anon_execute_on_new_functions enable;
--
-- Full removal, if it ever comes to that:
--   drop event trigger if exists zz_revoke_anon_execute_on_new_functions;
--   drop function if exists public.revoke_anon_execute_on_new_functions();
--
-- Removing it returns the database to the 0192 posture, which the canary has
-- already shown is not sufficient. It is an escape hatch, not a fix.
-- ===========================================================================
