-- 0180_pin_function_search_path.sql
--
-- Pins search_path on the 8 functions the security advisor flags as
-- function_search_path_mutable. A function with no search_path setting resolves
-- unqualified names against the CALLER's path, so a caller who prepends a
-- schema they control can shadow a table or operator the body meant to reach.
--
-- ALTER FUNCTION ... SET is NOT create-or-replace: it touches only the
-- function's proconfig. The body is untouched and the ACL is untouched, so
-- CLAUDE.md §6's re-revoke rule does not apply here — nothing resets EXECUTE
-- to PUBLIC. Verify with proconfig, not by reading the body.
--
-- public stays FIRST in the path so every unqualified reference in these
-- bodies keeps resolving exactly as it does today — this is deliberately
-- non-breaking. pg_temp goes LAST so the temp schema cannot shadow anything.

alter function public.archive_project_guarded(uuid, text, text) set search_path = public, pg_temp;
alter function public.create_project_with_customer(text, text, text, text, text, double precision, double precision, text, numeric, text, numeric, numeric, text, text, text, uuid[], text, text, text, text, text, text) set search_path = public, pg_temp;
alter function public.pay_commission(uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text) set search_path = public, pg_temp;
alter function public.projects_set_initials() set search_path = public, pg_temp;
alter function public.restore_customer_guarded(uuid, text) set search_path = public, pg_temp;
alter function public.return_customer_balance(uuid, text, text, text, date, text, text) set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.update_project_with_customer(uuid, text, text, text, text, text, double precision, double precision, text, numeric, text, text, text, uuid[], text, text, numeric, text, text, text, text) set search_path = public, pg_temp;
