-- 0096_approval_lock_30_days.sql
-- Approvals Ledger — the 30-DAY LOCK on CONSUMPTION approvals, enforced by
-- the DATABASE.
--
-- A completed consumption approval stays re-votable for 30 days. After that
-- it is immutable history: no update, no delete, no additional vote — and not
-- because the UI hides a button, but because the database refuses the write.
-- A stray script, a mistaken server action, a hand-run SQL statement and a
-- malicious client all hit the same wall.
--
-- ===========================================================================
-- SCOPE — ONE TABLE. The inventory tables are deliberately NOT touched.
-- ===========================================================================
-- An earlier draft of this migration also guarded purchase_order_approvals
-- and stock_receipt_approvals. That is gone, and the reason it is gone is
-- worth recording, because "we guarded fewer things" normally reads as a gap:
--
--   BOTH INVENTORY TABLES ARE ALREADY LOCKED AT COMPLETION, by their own
--   RPCs. approve_purchase_order, reject_purchase_order, approve_stock_receipt
--   and reject_stock_receipt each open with
--       if <parent>.status <> 'pending_approval' then raise
--   and the completing vote is what moves the parent off 'pending_approval'.
--   So the moment a PO or a receipt completes, every write path into its
--   approval table already refuses. Their window is not 30 days; it is zero.
--
--   In the Ledger they are VIEW-ONLY (Turki's decision B(ii)), so no new write
--   path is being opened for them either.
--
--   Adding a trigger there would therefore guard nothing, while reaching into
--   the inventory money path — the same path where the completing reject
--   DELETES price_lots rows and adjusts parts.qty_on_hand. Putting a new
--   trigger on a table that a live stock-moving RPC writes, to enforce a rule
--   that is already enforced, is risk with no return.
--
-- CONSUMPTION IS DIFFERENT, and that difference is the whole reason this file
-- exists: consumption_approvals is written by PLAIN app writes (0094 creates
-- no RPC at all), and 0095's model is explicitly re-votable with no status
-- gate anywhere. Today a consumption vote can be changed forever. This is the
-- only one of the three that has an open window to close.
--
-- ===========================================================================
-- WHY A TRIGGER AND NOT A POLICY OR A CHECK
-- ===========================================================================
-- A CHECK cannot do it: the lock depends on OTHER ROWS (when the event reached
-- its second vote), and a CHECK may only see the row in front of it.
--
-- An RLS policy could cover today's writer — the app, as `authenticated` —
-- but it guards a ROLE, not a RULE. Anything reaching the table as
-- service_role, or through a future SECURITY DEFINER function, would bypass
-- it silently. A trigger fires for every writer regardless of role, DEFINER
-- context or entry point, and stays correct if this table ever gains an RPC
-- like its inventory siblings have.
--
-- ===========================================================================
-- WHAT "COMPLETED" MEANS HERE — ONE DEFINITION, SHARED WITH 0097
-- ===========================================================================
--     COMPLETED = the 2nd DISTINCT voter's timestamp. Full stop.
--
-- No decision logic, and that is not a simplification — it is what 0097's
-- matching-vote trigger makes true. With every vote on an event guaranteed to
-- agree, the outcome is whatever the votes say, and the only question left is
-- WHEN the second one arrived.
--
-- EARLIER DRAFTS OF THIS FILE ALSO TREATED A SINGLE REJECTION AS COMPLETION
-- ("one objection ends it"). That rule is GONE. It could produce a completed
-- event from ONE vote, which the matching model has no room for, and it would
-- have made this guard and the Ledger disagree with the trigger about what is
-- complete. 0097 and this file now share one definition.
--
-- APPLY ORDER: 0097 FIRST, then this. 0097 establishes the invariant (votes
-- on an event never disagree) that makes the definition below correct.
--
-- THE CLOCK IS THE DATABASE'S. now() at the moment of the write, compared
-- against a timestamp derived from rows the client cannot forge. No client
-- clock, no app-supplied "as of" parameter, nothing passed in — so the window
-- cannot be widened by lying about the time.
--
-- ===========================================================================
-- THE CASCADE CARVE-OUT (kept, per direction)
-- ===========================================================================
-- consumption_approvals cascades from all three subjects (0094). If the guard
-- blocked every delete, deleting a work order with a locked approval would
-- start failing — a NEW failure in a path that works today, caused by a
-- feature that is supposed to be about history.
--
-- So the DELETE guard fires only on a DIRECT delete, detected with
-- pg_trigger_depth() = 1. A cascade from the parent runs inside the FK's own
-- internal trigger, arrives at depth 2, and is allowed: the whole event is
-- being removed, and an approval about a deleted event is not history, it is
-- a dangling opinion (0094's own reasoning for ON DELETE CASCADE).
--
-- ===========================================================================
-- WHAT IS GUARDED, AND WHY INSERT IS IN THE LIST
-- ===========================================================================
--   UPDATE  a locked vote cannot be flipped.
--   DELETE  a locked vote cannot be removed (direct deletes only).
--   INSERT  a THIRD vote cannot arrive on a locked event. Left open, someone
--           could add a rejection to a two-year-old approved event and change
--           what the Ledger reports without touching either original vote.
--
-- THE COMPLETING SECOND VOTE IS NEVER BLOCKED. At BEFORE-INSERT time that
-- vote does not exist yet, so the event is not complete and its completion
-- time is NULL. The lock can only ever engage on the write AFTER completion,
-- and only 30 days after it.
--
-- ===========================================================================
-- SCOPE — WHAT THIS DOES **NOT** LOCK, STATED PLAINLY
-- ===========================================================================
-- This guards the VOTES. It does not guard the subjects: exit_permits,
-- work_orders and outsourced_jobs stay writable by everything that writes
-- them today. A locked ledger row means "the votes are frozen", not "the
-- whole document is frozen". Extending the lock to the subjects would guard
-- tables that unrelated live flows still update, so it is not a safe add-on
-- to this migration.
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- Two functions: one completion helper, one guard. Both are SECURITY INVOKER
-- (Postgres omits the keyword; its absence IS invoker) with
-- `set search_path = public` pinned. INVOKER is correct — exactly as for the
-- archive's guards in 0087/0092 — because both read only the table the caller
-- is already touching. DEFINER would grant reach they do not need.
--
-- EXECUTE is revoked from PUBLIC and anon on both. As 0087/0092 were corrected
-- to say: Supabase's `alter default privileges` grants EXECUTE on new
-- functions to `authenticated` AND `service_role` at creation time, and the
-- revoke below does not strip those. Harmless for the guard — calling a
-- trigger function directly raises "trigger functions can only be called as
-- triggers" — and harmless for the helper, which is read-only and returns a
-- timestamp the caller can already compute from rows it can already read.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - Two functions and one trigger added, on ONE table. No table, column,
--    constraint, index, policy or row is altered. No data is written.
--  - No existing function is replaced. The four inventory RPCs are untouched,
--    and so are both inventory approval tables.
--  - NOTHING here moves stock. The guard only ever raises or returns.
--  - Re-runnable: create or replace function, drop trigger if exists before
--    create trigger.
--  - LIVE DATA IMPACT, checked before drafting: 3 consumption events are
--    complete, all minutes old. Applying this locks nothing that exists
--    today; the first lock falls 30 days after those completions.

begin;

-- ---------------------------------------------------------------------------
-- 1) COMPLETION — the rule, isolated.
-- ---------------------------------------------------------------------------
create or replace function public.consumption_event_completed_at(
  p_exit_permit_id uuid,
  p_work_order_id uuid,
  p_outsourced_job_id uuid
)
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  with rows_for_event as (
    select decision, decided_by, decided_at
      from public.consumption_approvals
     where (p_exit_permit_id    is not null and exit_permit_id    = p_exit_permit_id)
        or (p_work_order_id     is not null and work_order_id     = p_work_order_id)
        or (p_outsourced_job_id is not null and outsourced_job_id = p_outsourced_job_id)
  )
  -- The 2nd DISTINCT voter's timestamp, whatever the decision was — 0097
  -- guarantees they all match. Grouping by voter before ordering is what
  -- stops one person re-voting from supplying the second signature
  -- themselves.
  select decided_at
    from (
      select decided_by, min(decided_at) as decided_at
        from rows_for_event
       group by decided_by
    ) distinct_voters
   order by decided_at
   offset 1 limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- 2) THE GUARD
-- ---------------------------------------------------------------------------
create or replace function public.consumption_approvals_lock_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_permit       uuid;
  v_wo           uuid;
  v_os           uuid;
  v_completed_at timestamptz;
begin
  -- Cascade from the subject being deleted — allowed. See the header.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- The subject never moves between events (0094's CHECK allows exactly one,
  -- and no code path rewrites it), so OLD is the right source on UPDATE.
  if tg_op = 'INSERT' then
    v_permit := new.exit_permit_id;
    v_wo     := new.work_order_id;
    v_os     := new.outsourced_job_id;
  else
    v_permit := old.exit_permit_id;
    v_wo     := old.work_order_id;
    v_os     := old.outsourced_job_id;
  end if;

  v_completed_at := public.consumption_event_completed_at(v_permit, v_wo, v_os);

  if v_completed_at is not null and v_completed_at < now() - interval '30 days' then
    raise exception 'This approval was completed on % and locked after 30 days. Locked approvals are history and cannot be changed.', v_completed_at::date
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) ATTACH — BEFORE, so a locked write never happens rather than being undone.
-- ---------------------------------------------------------------------------
drop trigger if exists consumption_approvals_lock_trg on public.consumption_approvals;
create trigger consumption_approvals_lock_trg
  before insert or update or delete on public.consumption_approvals
  for each row execute function public.consumption_approvals_lock_guard();

-- ---------------------------------------------------------------------------
-- 4) 0083 posture
-- ---------------------------------------------------------------------------
revoke execute on function public.consumption_event_completed_at(uuid, uuid, uuid) from public, anon;
revoke execute on function public.consumption_approvals_lock_guard() from public, anon;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) SHAPE — two functions, both INVOKER with a pinned search_path, anon
--    unable to execute either:
--      select p.proname, p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('consumption_event_completed_at',
--                           'consumption_approvals_lock_guard');
--    Expect two rows: is_definer false, {search_path=public}, anon_can false.
--
-- 2) EXACTLY ONE TRIGGER, on the consumption table only — the re-scope:
--      select c.relname, t.tgname
--        from pg_trigger t join pg_class c on c.oid = t.tgrelid
--       where not t.tgisinternal
--         and c.relname in ('consumption_approvals','purchase_order_approvals',
--                           'stock_receipt_approvals');
--    Expect ONE row: consumption_approvals / consumption_approvals_lock_trg.
--    The two inventory tables must have NO non-internal trigger.
--
-- 3) COMPLETION MATH matches what the Ledger will show:
--      select coalesce(exit_permit_id, work_order_id, outsourced_job_id) as event,
--             count(*) as votes,
--             public.consumption_event_completed_at(exit_permit_id, work_order_id,
--                                                   outsourced_job_id) as completed_at
--        from public.consumption_approvals
--       group by 1, exit_permit_id, work_order_id, outsourced_job_id
--       order by completed_at nulls last;
--    Expect a non-null completed_at on exactly the completed events (3 today)
--    and NULL on every event still collecting.
--
-- 4) IT DOES NOT BITE YET — nothing is older than 30 days, so a re-vote on a
--    completed event must still SUCCEED. In a rolled-back transaction:
--      update public.consumption_approvals set decided_at = decided_at
--       where id = (select id from public.consumption_approvals limit 1);
--    Expect success.
--
-- 5) IT BITES WHEN IT SHOULD — the test that matters. Take ONE completed
--    event, age BOTH its votes past the window, then try every write.
--      begin;
--      -- the ageing update is itself still legal: at the moment it runs the
--      -- event's completion is inside the window
--      update public.consumption_approvals
--         set decided_at = decided_at - interval '40 days',
--             created_at = created_at - interval '40 days'
--       where work_order_id = <a completed event>;              -- SUCCEEDS
--
--      -- now every one of these must raise 23514:
--      update public.consumption_approvals set decision = 'rejected'
--       where work_order_id = <that event> limit 1;             -- 23514
--      delete from public.consumption_approvals
--       where work_order_id = <that event>;                     -- 23514
--      insert into public.consumption_approvals
--        (work_order_id, decision, decided_by)
--        values (<that event>, 'approved', 'third@probe');      -- 23514
--      rollback;
--
-- 6) AN UNCOMPLETED EVENT IS NEVER LOCKED, however old. Age a ONE-vote event
--    100 days back and confirm a second vote still inserts fine — an event
--    that never completed has no completion clock and must stay open.
--      begin;
--      update public.consumption_approvals
--         set decided_at = decided_at - interval '100 days'
--       where <a single-vote event>;
--      insert into public.consumption_approvals
--        (work_order_id, decision, decided_by)
--        values (<that event>, 'approved', 'second@probe');     -- must SUCCEED
--      rollback;
--
-- 7) CASCADE STILL WORKS — the deliberate carve-out:
--      begin;
--      update public.consumption_approvals
--         set decided_at = decided_at - interval '40 days',
--             created_at = created_at - interval '40 days'
--       where work_order_id = <a completed event>;
--      delete from public.work_orders where id = <that work order>;
--    Expect SUCCESS (the approval rows cascade away), NOT 23514.
--    Then confirm a DIRECT delete of a locked vote still raises 23514.
--    Roll back.
--
-- 8) INVENTORY UNTOUCHED — prove the re-scope did not quietly change them:
--      -- a receipt approval row is still writable exactly as before
--      -- (subject to its own RPC's status gate, which this file did not alter)
--      select count(*) from pg_trigger
--       where tgrelid in ('public.purchase_order_approvals'::regclass,
--                         'public.stock_receipt_approvals'::regclass)
--         and not tgisinternal;                                  -- expect 0
--
-- 9) STILL INERT ON INVENTORY — re-run 0094's probe now that a trigger exists
--    on the table at all: snapshot parts.qty_on_hand and
--    price_lots.qty_remaining, count stock_movements, vote and re-vote on a
--    consumption event, then confirm every diff is zero and the FIFO
--    invariant holds. Roll back.
