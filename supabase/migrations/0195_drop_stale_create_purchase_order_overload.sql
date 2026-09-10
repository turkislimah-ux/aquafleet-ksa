-- 0195_drop_stale_create_purchase_order_overload.sql
--
-- FILES -> PRODUCTION CONVERGENCE. A NO-OP ON PRODUCTION'S END STATE.
-- Production already has exactly ONE create_purchase_order, the 9-arg. The
-- 6-arg was dropped there BY HAND and no migration records it, so the file set
-- still creates both and a from-scratch replay RESURRECTS the dead one. This
-- migration codifies that out-of-band removal. It is not a new decision: the
-- decision was made at 0053 and this file is where it finally lands in the set.
--
-- THE LAST DIVERGENCE THE PRISTINE REPLAY SURFACED. The 2026-09-10 rebuild
-- (aquafleet-test wiped, 0001 -> 0194 replayed unattended, 192 files, exit 0,
-- then test:db 293/293) left 13 of 14 object categories byte-identical to
-- production. This overload is the fourteenth.
--
-- ===========================================================================
-- WHO CREATED WHICH, AND WHY THE 9-ARG SUPERSEDES THE 6-ARG
-- ===========================================================================
--
--   0050:205  CREATES the 6-arg (p_supplier_id, p_warehouse_id, p_lines,
--             p_expected_delivery, p_note, p_actor). The original.
--
--   0053:62   CREATES the 9-arg, adding p_ai_generated boolean default false,
--             p_ai_rationale text default null, p_ai_rationale_ar text default
--             null. SAME six leading parameters, in the same order, with the
--             same types -- three OPTIONAL parameters appended. That is what
--             makes it a supersession and not a sibling: every call the 6-arg
--             could serve, the 9-arg serves identically by defaulting the
--             three new ones.
--
--             0053 KNEW this and said so, at 0053:58-59, immediately above its
--             own drop:
--                 "Drop the OLD 6-arg signature (0050) -- being replaced by the
--                  9-arg version below, not overloaded alongside it."
--             So "not overloaded alongside it" is the standing ruling. It is
--             0053's, not this file's.
--
--   0056:314  RE-CREATES THE 6-ARG. This is the whole bug. 0056 adds VAT to the
--             RPC and was authored against 0050's shape, not 0053's. Its own
--             header, 0056:304-306, states the false premise in plain sight:
--                 "UNCHANGED signature (0050/0053)"
--             The signature was NOT unchanged as of 0053 -- 0053 had already
--             moved it to nine parameters three files earlier. 0056's
--             `drop function if exists ...(uuid,uuid,jsonb,date,text,text)` at
--             0056:312 therefore dropped NOTHING (0053 had already removed that
--             signature), and its create then added a SECOND overload beside
--             the 9-arg instead of replacing it.
--
--   0189:85   `create or replace` on the 9-arg (Riyadh date buckets).
--   0190:226  `create or replace` on the 9-arg (vat_rate() constant).
--             Both touch the 9-arg ONLY. Nothing has touched the 6-arg since
--             0056.
--
-- ===========================================================================
-- WHY THIS IS NOT MERELY COSMETIC ON A REBUILD
-- ===========================================================================
--
-- Measured on the pristine replay, 2026-09-10, both overloads present:
--
--   pronargs | uses vat_rate() | bare 0.15/1.15 literal | Riyadh date handling
--   ---------+-----------------+------------------------+---------------------
--      6     | false           | TRUE                   | false
--      9     | true            | false                  | true
--
-- The stale 6-arg is frozen at 0056 semantics and computes VAT as
-- `round(v_qty * v_price * 0.15, 2)` -- a bare literal, which is exactly the
-- thing 0190 exists to eliminate. It also predates 0189's Riyadh date buckets.
--
-- 0190's own no-bare-literal guard did NOT catch it, and that is not a hole in
-- 0190: that guard scopes itself by exact regprocedure (0190:665 names
-- 'create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)'),
-- so a DIFFERENT signature of the same name is outside its five named objects
-- by construction. A guard pinned to a signature cannot see an overload.
--
-- REACHABILITY. app/inventory/actions.ts:548 sends all nine named parameters,
-- so PostgREST resolves the 9-arg and the 6-arg is dead today -- that is why
-- this never surfaced as a bug. It is dead by CALLER HABIT, not by structure:
-- any caller that omits p_ai_generated / p_ai_rationale / p_ai_rationale_ar
-- lands on the 6-arg and silently gets the stale VAT path. Dropping it makes
-- that unreachable by structure.
--
-- NOT A SECURITY ISSUE. Both overloads read anon_exec = false and auth_exec =
-- true on the replay, so the 0192 invariant was never in question here. The
-- assertion below re-checks it anyway, schema-wide, because a drop is a
-- catalog change and this file should not be the one that takes that on trust.
--
-- ===========================================================================
-- THE GENERAL LESSON -- this is the reusable half
-- ===========================================================================
--
-- ADDING A PARAMETER DOES NOT EDIT A FUNCTION. IT CREATES A SECOND ONE.
-- `create or replace function` matches on the full argument-type list, so a
-- new signature is a NEW object and the old one keeps existing, keeps its own
-- body, and keeps its own grants. The old signature must be dropped EXPLICITLY,
-- BY ITS OWN ARGUMENT LIST, in the SAME migration that widens it -- 0053 did
-- exactly that and was right to.
--
-- Two failure modes follow, and both bit here:
--   1. A LATER migration that edits "the function" from an OUT-OF-DATE
--      signature revives the dead one instead of editing the live one. 0056.
--   2. Assertions pinned to one regprocedure report the live object healthy
--      while the stale twin sits beside it, unmeasured. 0190.
-- The catalog is the check: count the overloads by name, do not assume one.
--
-- ===========================================================================
-- 1) THE DROP
-- ===========================================================================
-- No-op on production (already absent, dropped out-of-band). On a replay this
-- removes the resurrected overload. `if exists` is what makes it safe on both.

drop function if exists public.create_purchase_order(uuid, uuid, jsonb, date, text, text);

-- ===========================================================================
-- 2) VERIFICATION -- RAISES. Not a result grid.
-- ===========================================================================
-- A migration's own SELECT output is a claim; a raise is the evidence
-- (CLAUDE.md section 5). All three assertions are inside one block so a
-- failure rolls the file back.

do $$
declare
  v_count   integer;
  v_sigs    text;
  v_the_sig text;
  v_bad_fns   text;
  v_bad_count integer;
begin
  -- (1) EXACTLY ONE create_purchase_order REMAINS, AND IT IS THE 9-ARG.
  --     Counting by NAME, not by signature, is the point -- a signature-scoped
  --     check is what let the stale twin survive nine migrations (see 0190
  --     above). Identify by oid::regprocedure::text, never by
  --     pg_get_function_identity_arguments() (CLAUDE.md section 6).
  select count(*),
         coalesce(string_agg(p.oid::regprocedure::text, ', '
                             order by p.oid::regprocedure::text), '')
    into v_count, v_sigs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_purchase_order';

  if v_count <> 1 then
    raise exception
      '0195: expected exactly 1 create_purchase_order in public, found % -- %. The 6-arg overload was not removed, or a third signature exists.',
      v_count, v_sigs;
  end if;

  select p.oid::regprocedure::text
    into v_the_sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_purchase_order';

  if v_the_sig <> 'create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)' then
    raise exception
      '0195: the surviving create_purchase_order is %, not the 9-arg. The WRONG overload was dropped -- roll back.',
      v_the_sig;
  end if;

  -- (2) THE SURVIVOR DID NOT LOSE ITS GRANT. A drop cannot change another
  --     object's ACL, so this is cheap; it is here because "the right one
  --     survived" and "the right one still works" are different claims.
  if not has_function_privilege('authenticated', v_the_sig::regprocedure, 'execute') then
    raise exception
      '0195: authenticated lost EXECUTE on %. The app calls this RPC from a signed-in session.',
      v_the_sig;
  end if;

  -- (3) THE SCHEMA-WIDE INVARIANT STILL HOLDS. Restated character for
  --     character from 0192:320-329 -- prokind in ('f','p'), prorettype
  --     <> trigger, has_function_privilege('anon', ...). If 0192's predicate
  --     ever changes, change this one with it, or this quietly stops guarding.
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
      '0195: INVARIANT BROKEN - % non-trigger function(s) in public are anon-executable: %. The anon key ships in the client bundle, and a SECURITY DEFINER function runs as its owner, bypassing RLS. Rolling back.',
      v_bad_count, v_bad_fns;
  end if;

  raise notice '0195: all three assertions passed. One create_purchase_order remains (%), authenticated retains EXECUTE, zero non-trigger functions anon-executable.', v_the_sig;
end $$;

-- ===========================================================================
-- POST-APPLY READ-BACK -- run these by hand afterwards. Do not skip them
-- because the block above passed: it ran INSIDE the transaction it was
-- checking, and a migration's own result is not proof it applied
-- (CLAUDE.md section 5).
-- ===========================================================================
--
-- A) ONE OVERLOAD, AND IT IS THE 9-ARG:
--      select p.oid::regprocedure::text as sig,
--             pg_get_function_result(p.oid) as result,
--             has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
--             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'create_purchase_order';
--      -- expect exactly 1 row:
--      --   create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)
--      --   purchase_orders | anon_exec = false | auth_exec = true
--
-- B) THE SURVIVOR CARRIES 0190's CONSTANT AND NO BARE LITERAL:
--      select pg_get_functiondef(p.oid) ~ 'vat_rate\(\)'   as uses_vat_rate,
--             pg_get_functiondef(p.oid) ~ '0\.15|1\.15'    as bare_vat_literal
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'create_purchase_order';
--      -- expect uses_vat_rate = true, bare_vat_literal = false.
--      -- Before this file, a REPLAY returned a second row reading
--      -- false / true -- that row is the object this migration removes.
--
-- C) THE INVARIANT, READ BACK OUTSIDE THE TRANSACTION:
--      select p.oid::regprocedure::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.prokind in ('f','p')
--         and p.prorettype <> 'trigger'::regtype
--         and has_function_privilege('anon', p.oid, 'execute');
--      -- expect 0 rows.
--
-- D) THE APP PATH STILL RESOLVES. app/inventory/actions.ts:548 sends all nine
--    named parameters; create one draft PO in the browser and confirm it is
--    numbered and its header carries subtotal_sar / vat_sar / total_sar.
--
-- E) WHAT THIS FILE DELIBERATELY DID NOT DO. It does not re-grant, re-revoke
--    or redefine anything. The 6-arg's grants (0050:289, 0056:419) die with
--    the object; the 9-arg's footer was last restated at 0190:319-320 and is
--    untouched here. It also does not address the non-security parity items
--    0192:400-410 lists -- those still need their own rulings.
