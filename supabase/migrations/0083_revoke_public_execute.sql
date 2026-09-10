-- 0083_revoke_public_execute.sql
-- Security hardening — every function in the public schema was reachable
-- by the anon role via Postgres's own default PUBLIC EXECUTE grant (the
-- implicit grant every new function gets unless explicitly revoked). This
-- revokes that blanket PUBLIC grant across all public-schema functions in
-- one pass, closing that off — anon can no longer call any RPC in this
-- app at all.
--
-- APPLIED DIRECTLY (not drafted first) — this file was written AFTER the
-- fact to match what's live, verified against the real DB before writing
-- a single line here (same "reconcile the file to reality" discipline as
-- 0081's delete_work_order/delete_outsourced_job reconciliation):
--   - 49 functions in public; 0 have anon EXECUTE, 46 have authenticated
--     EXECUTE (confirmed via has_function_privilege() over every one).
--   - The 3 without an authenticated grant (deduct_work_order_parts,
--     return_to_lots, consume_work_order_line) are internal helpers only
--     ever called FROM another SECURITY DEFINER function (never directly
--     via supabase.rpc() from app code) — correctly never had their own
--     authenticated grant to begin with, untouched by this migration.
--
-- Nothing else changes: this ONLY revokes the PUBLIC grant. Every
-- function's own pre-existing `GRANT EXECUTE ... TO authenticated`
-- (already present in each function's own original migration) is
-- untouched and still stands — that's the entire reason authenticated
-- access survives this revoke unharmed while anon's doesn't.
--
-- Idempotent: revoking a privilege that isn't held is a no-op, not an
-- error — safe to re-run.
--
-- ===========================================================================
-- POST-HOC CORRECTION, 2026-09-10 — THE HEADER CLAIM ABOVE WAS FALSE ON A
-- FRESH PROJECT, AND THIS EDIT IS WHAT MAKES IT TRUE
-- ===========================================================================
-- "anon can no longer call any RPC in this app at all" held on PRODUCTION,
-- which is where it was measured, and did NOT hold on a from-scratch replay.
-- Two distinct grants make a function anon-executable and this file only ever
-- removed one of them:
--
--   · the implicit PUBLIC grant — the EMPTY grantee entry, `=X/postgres`.
--     That is what `revoke ... from public` clears, and it is what the header
--     above describes.
--   · an EXPLICIT `anon=X/postgres` entry, handed out by the project's DEFAULT
--     PRIVILEGES at CREATE time. A `revoke ... from public` does not touch it.
--     Revoking PUBLIC and revoking anon are not the same statement.
--
-- A fresh Supabase project ships a postgres-grantor default ACL on schema
-- public granting anon on TABLES, SEQUENCES and FUNCTIONS. Measured on both
-- projects 2026-09-10, pg_default_acl still shows the fingerprint of exactly
-- that: postgres/public/S still grants anon, postgres/public/r no longer does
-- (0161 stripped it), postgres/public/f no longer does (0192 stripped it).
-- None of those strips have run yet at 0083. So on a replay every function
-- created before this file carries an explicit anon grant that this file left
-- in place, and the first assertion downstream that reads the posture back
-- correctly fails: 0150's assertion (3) on update_project_with_customer.
--
-- The fix belongs HERE, in the file that claims to close anon off, not in the
-- assertion that correctly reports it open. One word: `from public, anon`.
--
-- TRIGGER-SCOPED, deliberately. `p.prorettype <> 'trigger'::regtype` matches
-- 0192's predicate character-for-character and preserves production's END
-- STATE exactly. Measured on production 2026-09-10: precisely 4 functions are
-- anon-executable and all 4 are trigger functions —
-- record_project_commission_change(), record_salary_change(), set_updated_at()
-- and trips_station_offers_water_type(). A trigger function is invoked by the
-- executor, not by a role's EXECUTE bit, and is unreachable via PostgREST,
-- which is why CLAUDE.md §6's invariant is scoped to NON-TRIGGER functions.
-- Without this predicate a replay would strip those four and diverge (safely,
-- but visibly) from prod.
--
-- NO-OP ON PRODUCTION'S END STATE. Production is not re-applied — 0083 ran
-- there in 2025. On the semantics: prod already holds 0 anon-executable
-- NON-TRIGGER functions, so a replayed 0083 with this predicate lands on the
-- identical end state, and the added revoke is idempotent per the line above.
-- ===========================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype <> 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;
