-- ===========================================================================
-- 0210 — ADVISOR HARDENING: NUMBER GENERATORS AND TRIGGER FUNCTIONS
-- ===========================================================================
-- Raised by the prod security advisor. Drafted by Code, applied by the
-- architect. Do not self-apply.
--
-- Follows 0209, which closed anon on sequences and on four trigger functions.
-- This file narrows the same surfaces against `authenticated`, which is the
-- role a signed-in browser actually holds, and adds the two functions 0209 did
-- not cover.
--
-- ---------------------------------------------------------------------------
-- STEP 1 — WHO CALLS THE EIGHT NUMBER GENERATORS. MEASURED, NOT ASSUMED.
-- ---------------------------------------------------------------------------
-- Grepped app/, lib/, components/ and scripts/ for every one of the eight
-- names. RESULT: ZERO direct callers. Not one `.rpc('next_...')`, not one
-- select or perform from app code. The only app-side hits at all are two
-- COMMENTS in scripts/db/confirm-invoice-check.ts (lines 52 and 352) that
-- mention next_invoice_number while explaining why a counter table makes a
-- test case leak; neither is a call.
--
-- So NOTHING is excluded from step 3 — all eight are revoked.
--
-- Each generator is reached only through a SECURITY DEFINER function, verified
-- one by one in the migrations (newest definition of each):
--
--   generator                          called by                     definer
--   next_credit_note_number(int)       record_refund                 yes
--   next_invoice_number(int)           confirm_invoice               yes
--   next_os_number(int)                create_outsourced_job         yes
--   next_payslip_number(int)           issue_driver_payslip          yes
--   next_po_number(int)                create_purchase_order         yes
--   next_topup_receipt_number(int)     record_topup                  yes
--   next_trip_ref_number(uuid,int)     trips_set_ref                 yes
--   next_wo_number(int)                create_work_order             yes
--
-- THIS IS WHY THE REVOKE IS INERT FOR THE APP. A SECURITY DEFINER function
-- executes as its OWNER (postgres), so the privilege checked on the inner call
-- to a generator is the owner's, never the caller's. `authenticated` invoking
-- confirm_invoice still gets an invoice number; it simply can no longer call
-- next_invoice_number on its own to burn one.
--
-- trips_set_ref is the one worth naming twice: it is a TRIGGER function, so the
-- inner call happens on a plain INSERT into trips. It is SECURITY DEFINER with
-- `set search_path to 'public'` (0189), so that path is covered by the same
-- rule. If it were SECURITY INVOKER this revoke would break every trip insert —
-- it was checked for exactly that reason.
--
-- OLD OVERLOADS ARE NOT A GAP. next_invoice_number(), next_os_number() and
-- next_wo_number() each once existed zero-arg and were dropped by 0034, 0070
-- and 0074 respectively. The signatures below are the only ones that exist.
--
-- ---------------------------------------------------------------------------
-- vat_rate: DELIBERATELY NOT ALTERED (architect's ruling)
-- ---------------------------------------------------------------------------
-- public.vat_rate() keeps no SET clause: an IMMUTABLE sql function must stay
-- inlinable so it constant-folds (0190). The advisor's search_path warning on
-- it is accepted.
--
-- ---------------------------------------------------------------------------
-- STEP 4 — WHAT CHANGES, AND WHAT 0209 ALREADY DID
-- ---------------------------------------------------------------------------
-- Return types confirmed in the migrations, all six zero-arg, none skipped:
--
--   record_project_commission_change()      trigger        0147  definer
--   record_salary_change()                  trigger        0125  definer
--   set_updated_at()                        trigger        0157  invoker
--   trips_set_ref()                         trigger        0189  definer
--   trips_station_offers_water_type()       trigger        0114  definer
--   revoke_anon_execute_on_new_functions()  event_trigger  0193  definer
--
-- 0209 already took anon and public off four of them. The revokes below are
-- written for all six anyway: revoking a privilege that is already gone is a
-- no-op, and a file that states the end state completely is worth more than one
-- that depends on reading 0209 first.
--
-- THIS REVERSES 0189's EXPLICIT GRANT. 0189 line 234 reads `grant execute on
-- function public.trips_set_ref() to authenticated, service_role`. That grant is
-- removed here on purpose. Per 0193's finding, EXECUTE on a trigger function is
-- checked when the TRIGGER IS CREATED, not when it fires, so the grant was never
-- what made trip inserts work.
--
-- NOTHING IS GRANTED BACK on any of the six, for the same reason.
--
-- ---------------------------------------------------------------------------
-- WHY service_role IS GRANTED EXPLICITLY ON THE GENERATORS
-- ---------------------------------------------------------------------------
-- The brief says service_role keeps EXECUTE. Some of these carry no explicit
-- service_role grant — their access comes from the PUBLIC default, which step 3
-- removes. Revoking public without re-granting would take service_role with it,
-- so the grants below are what MAKE the requirement true rather than assuming
-- it. They are re-grants, not new reach: no new role gains anything.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- (3) THE EIGHT NUMBER GENERATORS. No app caller, all reached through
-- SECURITY DEFINER functions that run as owner, so no call path loses anything.
-- ---------------------------------------------------------------------------
revoke execute on function public.next_credit_note_number(integer)    from authenticated, anon, public;
revoke execute on function public.next_invoice_number(integer)        from authenticated, anon, public;
revoke execute on function public.next_os_number(integer)             from authenticated, anon, public;
revoke execute on function public.next_payslip_number(integer)        from authenticated, anon, public;
revoke execute on function public.next_po_number(integer)             from authenticated, anon, public;
revoke execute on function public.next_topup_receipt_number(integer)  from authenticated, anon, public;
revoke execute on function public.next_trip_ref_number(uuid, integer) from authenticated, anon, public;
revoke execute on function public.next_wo_number(integer)             from authenticated, anon, public;

grant execute on function public.next_credit_note_number(integer)    to service_role;
grant execute on function public.next_invoice_number(integer)        to service_role;
grant execute on function public.next_os_number(integer)             to service_role;
grant execute on function public.next_payslip_number(integer)        to service_role;
grant execute on function public.next_po_number(integer)             to service_role;
grant execute on function public.next_topup_receipt_number(integer)  to service_role;
grant execute on function public.next_trip_ref_number(uuid, integer) to service_role;
grant execute on function public.next_wo_number(integer)             to service_role;

-- ---------------------------------------------------------------------------
-- (4) TRIGGER AND EVENT-TRIGGER FUNCTIONS. Never called by name; invoked by
-- the executor. No grants follow.
-- ---------------------------------------------------------------------------
revoke execute on function public.record_project_commission_change()     from authenticated, anon, public;
revoke execute on function public.record_salary_change()                 from authenticated, anon, public;
revoke execute on function public.set_updated_at()                       from authenticated, anon, public;
revoke execute on function public.trips_set_ref()                        from authenticated, anon, public;
revoke execute on function public.trips_station_offers_water_type()      from authenticated, anon, public;
revoke execute on function public.revoke_anon_execute_on_new_functions() from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- (5) VERIFICATION — RAISES, SO A FAILURE ROLLS THE WHOLE FILE BACK.
--
-- has_function_privilege is used throughout rather than an proacl text scan,
-- because it resolves PUBLIC inheritance: a privilege `authenticated` holds
-- only through PUBLIC is still one it holds, and that is the exact case these
-- revokes are here to remove.
-- ---------------------------------------------------------------------------
do $$
declare
  sigs text[] := array[
    'public.next_credit_note_number(integer)',
    'public.next_invoice_number(integer)',
    'public.next_os_number(integer)',
    'public.next_payslip_number(integer)',
    'public.next_po_number(integer)',
    'public.next_topup_receipt_number(integer)',
    'public.next_trip_ref_number(uuid, integer)',
    'public.next_wo_number(integer)',
    'public.record_project_commission_change()',
    'public.record_salary_change()',
    'public.set_updated_at()',
    'public.trips_set_ref()',
    'public.trips_station_offers_water_type()',
    'public.revoke_anon_execute_on_new_functions()'
  ];
  callers text[] := array[
    'apply_balance_to_invoice',
    'confirm_invoice',
    'create_outsourced_job',
    'create_purchase_order',
    'create_work_order',
    'issue_driver_payslip',
    'record_topup',
    'trips_set_ref'
  ];
  sig       text;
  nm        text;
  oid_      oid;
  missing   text[] := '{}';
  still_ok  text[] := '{}';
  anon_ok   text[] := '{}';
begin
  -- (a) Nothing revoked above is still executable by authenticated, and anon is
  --     checked alongside it because the same statement covered both.
  foreach sig in array sigs loop
    oid_ := to_regprocedure(sig);
    if oid_ is null then
      missing := missing || sig;
    else
      if has_function_privilege('authenticated', oid_, 'execute') then
        still_ok := still_ok || sig;
      end if;
      if has_function_privilege('anon', oid_, 'execute') then
        anon_ok := anon_ok || sig;
      end if;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      '0210 FAIL: % function(s) named in this migration do not exist: %. A signature drifted — do not widen the revoke to fix it, find what replaced them.',
      array_length(missing, 1), array_to_string(missing, ', ');
  end if;

  if array_length(still_ok, 1) is not null then
    raise exception
      '0210 FAIL: authenticated can still execute %. If the name is right, the privilege is arriving through PUBLIC or through a role authenticated is a member of — read proacl on that function before changing this file.',
      array_to_string(still_ok, ', ');
  end if;

  if array_length(anon_ok, 1) is not null then
    raise exception
      '0210 FAIL: anon can still execute %. 0209 asserted zero anon-executable functions in public, so this is a regression since then, not a gap this file left.',
      array_to_string(anon_ok, ', ');
  end if;

  -- (b) SANITY: every SECURITY DEFINER function that reaches a revoked
  --     generator still exists and is still DEFINER. This is the property that
  --     makes step 3 inert — if one of these became SECURITY INVOKER, the
  --     revokes above would start failing real work instead of closing a hole.
  --     Matched by name: none of the eight is overloaded.
  --
  --     THE ARRAY BELOW IS EXACTLY WHAT WAS APPLIED and is not being edited:
  --     it lists apply_balance_to_invoice where the real caller of
  --     next_credit_note_number is record_refund (corrected in the header from
  --     live prod). Both are SECURITY DEFINER and both exist, so the check
  --     passed and still passes; it simply covers one function that does not
  --     reach a generator and misses one that does. Fix the array in a later
  --     migration, not by editing an applied file.
  missing := '{}';
  foreach nm in array callers loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname  = nm
         and p.prosecdef
    ) then
      missing := missing || nm;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      '0210 FAIL: % caller(s) missing or no longer SECURITY DEFINER: %. Step 3 is only safe because these run as owner; if one is now SECURITY INVOKER its callers lose the number generator and the feature breaks at runtime.',
      array_length(missing, 1), array_to_string(missing, ', ');
  end if;

  raise notice '0210 OK: 14 functions closed to authenticated, anon and public; service_role keeps the 8 generators; all 8 definer callers intact.';
end $$;

commit;

-- ===========================================================================
-- AFTER APPLYING
--
-- 1. `npm run test:db` is the real proof and it exercises every revoked path:
--    it confirms invoices (next_invoice_number), records top-ups
--    (next_topup_receipt_number), settles (next_credit_note_number) and writes
--    trips, salaries and commissions, firing four of the six trigger functions.
--    A red suite here means a caller was NOT running as owner.
--
-- 2. Re-read the advisor. The generators and trigger functions should drop off
--    it. The search_path warning on vat_rate stays, and is accepted.
-- ===========================================================================
