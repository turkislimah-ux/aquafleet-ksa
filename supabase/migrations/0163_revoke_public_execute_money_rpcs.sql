-- 0163_revoke_public_execute_money_rpcs.sql
-- Revoke the default EXECUTE-to-PUBLIC grant from three money / money-adjacent
-- RPCs, so `anon` can no longer call them.
--
-- ===========================================================================
-- THE DATABASE WAS CHANGED FIRST. THIS FILE IS THE RECORD, NOT THE SOURCE.
-- ===========================================================================
-- The architect applied this via MCP and verified it live BEFORE this file was
-- written. Do NOT re-run it against production. It IS idempotent — revoking a
-- privilege that is already gone is a no-op — so a second apply is harmless.
--
-- ===========================================================================
-- WHAT WAS WRONG, AND IT WAS REACHABLE
-- ===========================================================================
-- Postgres grants EXECUTE on a new function to PUBLIC by default. Three
-- functions still carried that grant, which `anon` inherits. The Supabase anon
-- key is not a secret — it ships in the client bundle and is readable by anyone
-- who opens the site — so "anon can execute" means "the internet can execute".
--
-- **PROVEN REACHABLE, NOT THEORISED.** Probed over PostgREST with the anon key,
-- using a driver id that cannot exist:
--
--     anon -> issue_driver_payslip   HTTP 400  23514
--             "That driver was not on the payroll for that month."
--     anon -> next_invoice_number    HTTP 401  42501
--             "permission denied for function next_invoice_number"
--
-- The first is a BUSINESS-LOGIC error: anon got inside the function body and was
-- turned away by the function's own validation, not by the permission layer. The
-- second is the control — a correctly locked sibling — which proves the probe
-- distinguishes the two cases. After this migration all three answer 42501.
--
-- Nothing was ever written through it. The probe used a nonexistent driver, and
-- 0115 validates the driver BEFORE calling next_payslip_number, so not even a
-- counter number was consumed.
--
-- ===========================================================================
-- WHY THIS BEAT RLS AND 0161
-- ===========================================================================
-- `issue_driver_payslip` and `next_payslip_number` are SECURITY DEFINER, owned
-- by `postgres`. A definer function executes with the OWNER's rights, so:
--   - RLS on the tables it touches does not apply to it, and
--   - 0161's `revoke all ... from anon` on every public table does not apply
--     either, because the function is not acting as anon once it is inside.
-- Both walls this schema relies on were bypassed by design — that is what
-- SECURITY DEFINER means — leaving the EXECUTE grant as the only gate, and it
-- was open.
--
-- `pay_commission` is NOT a definer, so it ran as the caller and 0161 already
-- blocked its table access. It is included anyway: relying on "the revoke will
-- stop it" makes this function's safety depend on a different migration staying
-- in place, and a money RPC should not be callable by anon in the first place.
--
-- ===========================================================================
-- THE MODEL IS next_invoice_number, WHICH WAS ALREADY RIGHT
-- ===========================================================================
-- `next_invoice_number` and `next_po_number` carry
--     {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- with NO PUBLIC entry. The three fixed here now match that exactly.
-- `authenticated` and `service_role` KEEP execute — the app calls
-- issue_driver_payslip through `supabase.rpc(...)` as the signed-in user, and
-- section 2 asserts that still works.
--
-- ===========================================================================
-- THIS WILL COME BACK IF YOU TOUCH THESE FUNCTIONS. CLAUDE.md §7.
-- ===========================================================================
-- **CREATE OR REPLACE and DROP+CREATE both reset a function's ACL to the
-- default, which is EXECUTE TO PUBLIC.** §7 already records this from the 0151
-- parameter drop: "a fresh function is EXECUTE-to-PUBLIC — re-issue the grants
-- in the same transaction and read the ACL back, or a money RPC silently widens
-- to anon."
--
-- That is almost certainly how this happened: 0115 created
-- issue_driver_payslip, and 0118 replaced it — and the replacement did not
-- re-revoke.
--
-- SO: ANY FUTURE MIGRATION THAT REDEFINES ONE OF THESE THREE MUST END WITH THE
-- SAME REVOKE, IN THE SAME TRANSACTION, AND READ THE ACL BACK. This file does
-- not protect them; it only cleans up. There is no default-privileges equivalent
-- for functions that would make it stick the way 0161's does for tables.
--
-- ===========================================================================
-- THE SEVEN THAT REMAIN ANON-EXECUTABLE ARE ACCOUNTED FOR, NOT OVERLOOKED
-- ===========================================================================
-- Repo-wide this took anon-executable functions from 10 to 7 (of 74 total).
-- Measured, and each remaining one was checked:
--
--   archive_project_guarded, restore_customer_guarded, return_customer_balance
--     - NOT security definer. They execute as anon, and 0161 left anon with zero
--       privileges on every public table, so they fail on their first statement.
--       Worth revoking eventually for the same reason pay_commission was; not
--       urgent, and deliberately out of scope for a fix that was applied to
--       close a live hole.
--
--   record_project_commission_change, record_salary_change,
--   trips_station_offers_water_type, set_updated_at
--     - TRIGGER functions (they return `trigger`). PostgREST does not expose
--       functions returning trigger, so they are not remotely callable at all.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- No table data, no schema, no RLS policy, no view, no bucket, no app code, and
-- no function BODY. Privileges only, on three functions.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The revokes.
--
-- FROM `public` AND `anon`, BOTH, AND BOTH ARE NEEDED. The offending entry was
-- the PUBLIC one (`=X/postgres` — an ACL entry with an empty grantee); anon was
-- additionally listed explicitly. Revoking from anon alone would leave the
-- PUBLIC grant, which anon inherits, so nothing would change.
--
-- Signatures are the identity arguments read from
-- pg_get_function_identity_arguments — a REVOKE must match the exact signature,
-- and each of these has exactly one overload.
-- ---------------------------------------------------------------------
revoke execute on function public.issue_driver_payslip(uuid, date, text) from public, anon;

revoke execute on function public.next_payslip_number(integer) from public, anon;

revoke execute on function public.pay_commission(
  uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text
) from public, anon;

-- ---------------------------------------------------------------------
-- 2. Self-asserts. Any failure rolls all three revokes back.
--
-- Asserted with has_function_privilege(), NOT by pattern-matching proacl. A
-- naive `proacl::text like '%=X/%'` ALSO matches `postgres=X/postgres` and
-- reports every function as PUBLIC-executable — that false positive was hit
-- while checking this very fix. The PUBLIC entry has an EMPTY grantee, so the
-- only correct string test is `'{=X/%'` or `'%,=X/%'`; the privilege function
-- avoids the question entirely and is what belongs in an assert.
-- ---------------------------------------------------------------------
do $$
declare
  v_leaked text;
  v_lost   text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_leaked
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('issue_driver_payslip', 'next_payslip_number', 'pay_commission')
     and has_function_privilege('anon', p.oid, 'execute');

  if v_leaked is not null then
    raise exception 'anon can still execute: %', v_leaked;
  end if;

  -- The app calls issue_driver_payslip as the signed-in user. If this revoke
  -- was too broad, payslip issuing breaks — and it must fail HERE, at apply
  -- time, not at the next attempt to issue a payslip.
  select string_agg(p.proname, ', ' order by p.proname) into v_lost
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('issue_driver_payslip', 'next_payslip_number', 'pay_commission')
     and not has_function_privilege('authenticated', p.oid, 'execute');

  if v_lost is not null then
    raise exception 'authenticated LOST execute on: % - revoke was too broad', v_lost;
  end if;

  raise notice 'anon denied, authenticated retained, on all three RPCs';
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE THREE NOW MATCH THE MODEL.
--      select p.proname,
--             has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
--             has_function_privilege('authenticated', p.oid, 'execute') as authd_exec,
--             has_function_privilege('service_role', p.oid, 'execute')  as svc_exec,
--             p.proacl::text as acl
--        from pg_proc p
--       where p.pronamespace='public'::regnamespace
--         and p.proname in ('issue_driver_payslip','next_payslip_number',
--                           'pay_commission','next_invoice_number')
--       order by 1;
--      -- expect all four: anon false / authenticated true / service_role true,
--      -- and acl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      -- with NO leading '=X/' entry.
--
-- B) NO FUNCTION IN public IS PUBLIC-EXECUTABLE.
--      select count(*) as still_public_execute
--        from pg_proc p
--       where p.pronamespace='public'::regnamespace and p.prokind='f'
--         and (p.proacl::text like '{=X/%' or p.proacl::text like '%,=X/%');
--      -- expect 7 — the three guarded non-definer RPCs and the four trigger
--      -- functions listed in the header. NOT 0, and that is the correct answer.
--      -- Read the header before "fixing" it.
--
-- C) FROM OUTSIDE, WITH THE ANON KEY — the check that does not trust the catalog.
--      curl -s -o /dev/null -w '%{http_code}\n' -X POST \
--        "$SUPABASE_URL/rest/v1/rpc/issue_driver_payslip" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--        -H "Content-Type: application/json" \
--        -d '{"p_driver_id":"00000000-0000-0000-0000-000000000000",
--             "p_period_start":"2020-01-01","p_actor":"probe"}'
--      -- expect 401, body 42501 "permission denied for function".
--      -- BEFORE this migration it returned 400 with 23514 "That driver was not
--      -- on the payroll for that month" — a business error, which is what
--      -- proved anon was executing the body.
--
-- D) PAYSLIP ISSUING STILL WORKS FOR A SIGNED-IN USER. The app path, in-browser:
--    Reports -> a driver's payslip -> Issue. Must produce PS-<year>-NNNNNN.
--    This is the one behaviour that a too-broad revoke would have broken, and it
--    cannot be checked from the SQL editor, which runs as postgres.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Do not roll this back. It closes a hole through which an unauthenticated
-- caller could issue a payslip.
--
-- If a specific caller genuinely needs one of these, grant it to THAT ROLE:
--     grant execute on function public.next_payslip_number(integer) to authenticated;
-- Never back to `public` or `anon`.
-- ===========================================================================
