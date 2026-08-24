-- 0164_revoke_public_execute_guarded_rpcs.sql
-- Revoke the default EXECUTE-to-PUBLIC grant from the three guarded money RPCs.
-- Completes the sweep 0163 started: after this, NO non-trigger function in
-- `public` is executable by anon.
--
-- ===========================================================================
-- THE DATABASE WAS CHANGED FIRST. THIS FILE IS THE RECORD, NOT THE SOURCE.
-- ===========================================================================
-- The architect applied this via MCP and verified it live BEFORE this file was
-- written. Do NOT re-run it against production. It IS idempotent — revoking a
-- privilege that is already gone is a no-op — so a second apply is harmless.
--
-- ===========================================================================
-- DEFENCE IN DEPTH, NOT AN OPEN HOLE — AND THE DISTINCTION FROM 0163 MATTERS
-- ===========================================================================
-- 0163 closed a hole that was PROVEN REACHABLE: `issue_driver_payslip` is
-- SECURITY DEFINER, so it ran as postgres, bypassed RLS and bypassed 0161's
-- table revoke. anon got all the way inside the function body — the probe came
-- back with a business-logic error, not a permission error.
--
-- THESE THREE ARE DIFFERENT. `archive_project_guarded`,
-- `restore_customer_guarded` and `return_customer_balance` are NOT security
-- definer. They execute as the caller, so as anon they hit 0161's revoke on
-- their first table access and fail with 42501. Nothing was exploitable, and
-- nothing was written through them.
--
-- SO WHY LOCK THEM. Because "safe" was a property of a DIFFERENT migration.
-- Their protection came from 0161 having removed anon's table grants — a layer
-- downstream of the function, and one that a future `grant` on a single table
-- could quietly undo without anyone connecting it to these RPCs. A money RPC
-- should not be callable by anonymous users at all; whether the call would then
-- fail is a second question, and relying on the answer is exactly the shape that
-- made the 0163 hole survive from 0118 until it was probed.
--
-- The 0163 hole is the argument. There, the same reasoning — "RLS will stop it"
-- — was true for every non-definer function and false for the one that mattered,
-- and the difference was invisible without checking prosecdef. Locking the
-- function itself does not require anyone to make that distinction correctly.
--
-- ===========================================================================
-- THE END STATE, MEASURED
-- ===========================================================================
-- Of 74 functions in `public`, anon can now execute FOUR, and all four return
-- `trigger`:
--     record_project_commission_change, record_salary_change,
--     trips_station_offers_water_type, set_updated_at
-- PostgREST does not expose functions returning trigger, so they are not
-- remotely callable. Section 2's second assert states this as the invariant:
-- **zero NON-TRIGGER functions anon-executable.** That is the number to hold, and
-- checking "anon-executable = 0" outright would fail on the four triggers and
-- read as a regression.
--
-- Verified from outside as well as in the catalog, with the anon key:
--     archive_project_guarded    HTTP 401 42501 permission denied for function
--     restore_customer_guarded   HTTP 401 42501 permission denied for function
--     return_customer_balance    HTTP 401 42501 permission denied for function
--
-- ===========================================================================
-- THIS WILL COME BACK IF THESE FUNCTIONS ARE TOUCHED. CLAUDE.md §6.
-- ===========================================================================
-- Same caveat as 0163, and it now has its own rule in CLAUDE.md §6.
-- **CREATE OR REPLACE and DROP+CREATE both reset a function's ACL to the
-- default, which is EXECUTE TO PUBLIC.** There is no default-privileges
-- equivalent for functions — 0161's `alter default privileges` covers TABLES
-- only — so nothing makes this stick.
--
-- ANY future migration that redefines one of these three, or any of 0163's
-- three, MUST re-revoke in the SAME transaction and read the ACL back. That is
-- how 0163's hole was created: 0115 defined `issue_driver_payslip`, 0118
-- replaced it, and the replacement did not re-revoke.
--
-- 0141 and 0142 own `restore_customer_guarded` and `return_customer_balance`;
-- 0143 owns `archive_project_guarded`. If any of those is ever revisited, this
-- revoke goes back in with it.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- No table data, no schema, no RLS policy, no view, no bucket, no app code, and
-- no function BODY. Privileges only, on three functions. `authenticated` and
-- `service_role` keep execute — the app calls all three as the signed-in user
-- (Archive's force-archive and restore, and the balance-return flow), and
-- section 2 fails the migration if that was taken away.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The revokes.
--
-- FROM `public` AND `anon`, BOTH. The offending grant is the PUBLIC one — an ACL
-- entry with an EMPTY grantee (`=X/postgres`) — which anon inherits. Revoking
-- from anon alone leaves it in place and changes nothing.
--
-- Signatures are the identity arguments read from
-- pg_get_function_identity_arguments; a REVOKE must match the exact signature,
-- and each of these has exactly one overload.
-- ---------------------------------------------------------------------
revoke execute on function public.archive_project_guarded(uuid, text, text) from public, anon;

revoke execute on function public.restore_customer_guarded(uuid, text) from public, anon;

revoke execute on function public.return_customer_balance(
  uuid, text, text, text, date, text, text
) from public, anon;

-- ---------------------------------------------------------------------
-- 2. Self-asserts. Any failure rolls all three revokes back.
--
-- Asserted with has_function_privilege(), never by pattern-matching proacl: a
-- naive `proacl::text like '%=X/%'` also matches `postgres=X/postgres` and
-- reports every function as PUBLIC-executable. That false positive was hit for
-- real while checking 0163.
-- ---------------------------------------------------------------------
do $$
declare
  v_leaked  text;
  v_lost    text;
  v_schema  text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_leaked
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('archive_project_guarded', 'restore_customer_guarded',
                       'return_customer_balance')
     and has_function_privilege('anon', p.oid, 'execute');

  if v_leaked is not null then
    raise exception 'anon can still execute: %', v_leaked;
  end if;

  -- The app calls all three as the signed-in user. A too-broad revoke breaks
  -- force-archive, customer restore and balance returns, and must fail HERE.
  select string_agg(p.proname, ', ' order by p.proname) into v_lost
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('archive_project_guarded', 'restore_customer_guarded',
                       'return_customer_balance')
     and not has_function_privilege('authenticated', p.oid, 'execute');

  if v_lost is not null then
    raise exception 'authenticated LOST execute on: % - revoke was too broad', v_lost;
  end if;

  -- THE SCHEMA-WIDE INVARIANT. Trigger functions are excluded deliberately:
  -- PostgREST cannot call them, and four of them legitimately remain
  -- anon-executable. Asserting "anon-executable = 0" outright would fail on
  -- those four and read as a regression.
  select string_agg(p.proname, ', ' order by p.proname) into v_schema
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and pg_get_function_result(p.oid) <> 'trigger'
     and has_function_privilege('anon', p.oid, 'execute');

  if v_schema is not null then
    raise exception 'non-trigger functions still anon-executable: %', v_schema;
  end if;

  raise notice 'no non-trigger function in public is anon-executable';
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE THREE ARE LOCKED, AND THE APP'S ROLE IS NOT.
--      select p.proname,
--             has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
--             has_function_privilege('authenticated', p.oid, 'execute') as authd_exec,
--             has_function_privilege('service_role', p.oid, 'execute')  as svc_exec
--        from pg_proc p
--       where p.pronamespace='public'::regnamespace
--         and p.proname in ('archive_project_guarded','restore_customer_guarded',
--                           'return_customer_balance')
--       order by 1;
--      -- expect all three: false / true / true
--
-- B) THE SCHEMA-WIDE INVARIANT — the number to hold.
--      select count(*) filter (where has_function_privilege('anon',p.oid,'execute')
--                                and pg_get_function_result(p.oid) <> 'trigger')
--               as anon_exec_non_trigger,
--             count(*) filter (where has_function_privilege('anon',p.oid,'execute')
--                                and pg_get_function_result(p.oid) = 'trigger')
--               as anon_exec_trigger_only,
--             count(*) as total
--        from pg_proc p
--       where p.pronamespace='public'::regnamespace and p.prokind='f';
--      -- expect 0 / 4 / 74
--      -- The 4 are trigger functions and are FINE. Do not "fix" them.
--
-- C) FROM OUTSIDE, WITH THE ANON KEY — the check that does not trust the catalog.
--      for fn in archive_project_guarded restore_customer_guarded return_customer_balance; do
--        curl -s -o /dev/null -w "$fn %{http_code}\n" -X POST \
--          "$SUPABASE_URL/rest/v1/rpc/$fn" \
--          -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--          -H "Content-Type: application/json" -d '{}'
--      done
--      -- expect 401 for all three, body 42501 "permission denied for function".
--
-- D) THE APP STILL WORKS FOR A SIGNED-IN USER. These cannot be checked from the
--    SQL editor, which runs as postgres. In-browser:
--      - Trips -> a project with an outstanding balance -> force archive with an
--        override reason  (archive_project_guarded)
--      - Archive -> Customers -> Restore on an archived customer
--        (restore_customer_guarded)
--      - Trips -> Finance -> return a prepaid customer's balance
--        (return_customer_balance)
--
-- E) NOTHING ELSE MOVED.
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 83 / 83
--
--      select count(*) from information_schema.role_table_grants
--       where grantee='anon' and table_schema='public';
--      -- expect 0 — 0161 still holds
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Do not roll this back. If a specific caller genuinely needs one of these,
-- grant it to THAT ROLE:
--     grant execute on function public.restore_customer_guarded(uuid, text) to authenticated;
-- Never back to `public` or `anon`.
-- ===========================================================================
