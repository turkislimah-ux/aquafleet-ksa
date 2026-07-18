-- 0038_confirm_invoice_drop_stale_overloads.sql
-- Corrective — 0036 and 0037 both re-emitted confirm_invoice() via
-- CREATE OR REPLACE with a DIFFERENT argument count than the version they
-- were meant to replace (23-arg and 24-arg respectively). Unlike every prior
-- confirm_invoice-touching migration (0027 -> 0032 -> 0034), neither one
-- DROPped the signature it was superseding first — so instead of one
-- function being replaced in place, Postgres kept accumulating overloads.
--
-- Live state before this migration (confirmed via pg_proc against the
-- running DB): THREE confirm_invoice signatures coexist —
--   17-arg  (pre-0036, no ledger cols, no payment_mode)  -- stale
--   23-arg  (0036, + 6 ledger cols, no payment_mode)     -- stale
--   24-arg  (0037, + payment_mode)                       -- current/correct
-- All three are GRANTed to `authenticated` and independently callable. The
-- app's only caller (app/trips/invoiceActions.ts confirmInvoice()) passes
-- all 24 named params, so it resolves to the correct 24-arg signature today
-- — but the two stale overloads sit there as a live footgun: any future
-- partial-payload call (fewer keys), a direct psql/PostgREST call, or client
-- drift could silently resolve to one of them instead of erroring loudly,
-- silently skipping the ledger/payment_mode columns on confirm.
--
-- This migration drops ONLY the two stale overloads by their exact type
-- signature. The 24-arg version (current CREATE OR REPLACE target) is
-- untouched — this is a pure cleanup, no behavior change for the live path.

begin;

drop function if exists public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
);

drop function if exists public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric
);

commit;
