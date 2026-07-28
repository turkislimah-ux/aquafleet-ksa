-- 0062_lock_down_deduct_work_order_parts.sql
-- Maintenance — post-0061 fix. deduct_work_order_parts() was meant to be
-- private (only start_work_order/complete_work_order should ever call it —
-- calling it directly skips the inventory_deducted_at idempotency guard,
-- which lives in the two callers, not the helper itself, so a direct call
-- double-deducts stock). Simply never granting it to `authenticated` does
-- NOT make it private on Supabase: this project's public schema has a
-- default ACL (set by both the `postgres` and `supabase_admin` roles, see
-- pg_default_acl) that grants EXECUTE on every new function to `anon`,
-- `authenticated`, AND `service_role` automatically, independent of the
-- PUBLIC pseudo-role. A bare `revoke ... from public` would leave anon's
-- own direct grant untouched — anyone holding the public anon key could
-- still call it over the REST/RPC endpoint with zero login. This migration
-- revokes from all three roles plus PUBLIC, closing that gap for real.
--
-- start_work_order() / complete_work_order() are unaffected — as
-- SECURITY DEFINER functions they execute AS THEIR OWNER (postgres), and
-- Postgres ownership bypasses a function's own ACL entirely; only external
-- callers going through the API are gated by these grants.

begin;

revoke execute on function public.deduct_work_order_parts(uuid, text)
  from public, anon, authenticated, service_role;

commit;
