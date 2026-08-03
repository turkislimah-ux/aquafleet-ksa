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

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
