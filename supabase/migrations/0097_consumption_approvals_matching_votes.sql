-- 0097_consumption_approvals_matching_votes.sql
-- Consumption approvals — THE SECOND VOTE MUST MATCH THE FIRST.
--
-- An event can never hold two different outcomes. Two matching votes complete
-- it, approved or rejected. This is a verbatim port of the rule that
-- approve_stock_receipt()/reject_stock_receipt() already enforce, moved into a
-- trigger because consumption_approvals has no RPC to put it in.
--
-- ===========================================================================
-- THE SOURCE RULE, READ FROM prosrc — NOT FROM A DESCRIPTION
-- ===========================================================================
-- approve_stock_receipt and reject_stock_receipt share one shape. In order:
--
--   1. SELECT the caller's OWN vote (stock_receipt_id + approver_email).
--      If found -> UPDATE it and RETURN. No matching check of any kind. The
--      body's own comment: "Sole voter (the only state reachable
--      pre-finalization) freely changing their own vote — approve<->reject".
--      It is safe there precisely BECAUSE the status gate above it means a
--      second vote cannot yet exist.
--
--   2. Otherwise SELECT any OTHER vote (limit 1).
--      If none -> INSERT. First vote. Nothing completes.
--
--   3. Otherwise this is the second, distinct voter, and it MUST MATCH:
--         if v_other_vote.action <> 'approve' then raise ...
--         if v_other_vote.action <> 'reject'  then raise ...
--         if v_other_vote.outcome <> p_mode   then raise ...   (reject only)
--      Match -> INSERT, then finalize.
--
-- Ported to consumption: an INSERT or UPDATE whose decision differs from any
-- OTHER existing vote on the same event is REFUSED. A sole voter with no one
-- else on the event may change their own vote freely. There is no outcome
-- column here (a consumption rejection carries a free-text reason, and the
-- receipt's own body never compares reasons either — "Reason is free-text per
-- voter and never compared"), so `decision` is the only thing matched.
--
-- ===========================================================================
-- RECONCILED TO LIVE — applied and verified by the architect
-- ===========================================================================
-- The body below is the LIVE definition, read back from prosrc, not the
-- draft. The architect applied a tightened version and it is the better one:
--
--   The draft excluded BOTH this row (c.id <> new.id) and the caller's own
--   vote (decided_by <> new.decided_by) before looking for a conflict. The id
--   exclusion alone is sufficient, because 0095's unique index already allows
--   a person only ONE row per event — so "the caller's own vote" and "this
--   row" are the same row on UPDATE, and on INSERT the caller has no row yet.
--   The decided_by clause was redundant, and redundant conditions in a guard
--   are places for a future edit to go subtly wrong.
--
--   It also filters `c.decision <> new.decision` inside the lookup rather than
--   fetching any other vote and comparing afterwards, so the query answers the
--   exact question being asked.
--
-- The message wording is the architect's too, and is what a user sees:
--   'This event already has a "approved" vote — a second voter must match it;
--    a split decision is not allowed.'
--
-- VERIFIED AGAINST LIVE: SECURITY INVOKER (prosecdef false), proconfig
-- {search_path=public}, anon cannot execute. Trigger tgtype 23 =
-- ROW | BEFORE | INSERT | UPDATE — DELETE is NOT guarded, which is what keeps
-- withdraw available.
--
-- BITE-TESTED against real data, all four behaviours confirmed:
--   first vote (approve by A)              -> ACCEPTED
--   conflicting second (reject by B)       -> BLOCKED, 23514, message above
--   sole voter A flips their own vote      -> ACCEPTED (allowed while sole)
--   matching second (approve by B)         -> ACCEPTED, event complete,
--                                             2 distinct voters
--
-- ===========================================================================
-- CONSEQUENCE YOU NEED TO RULE ON BEFORE APPLYING THIS
-- ===========================================================================
-- The receipt rule and the 30-day re-vote window do not compose on their own,
-- and the gap is real rather than cosmetic:
--
--   Two approvals complete an event. Inside the window, voter A wants to
--   change their mind. Their UPDATE now carries 'rejected' while B's row still
--   says 'approved' — two different outcomes on one event — so THIS TRIGGER
--   REFUSES IT. Under the matching rule, a completed event can never be
--   flipped by editing a vote. Nothing can drop it below two matching votes,
--   so "a re-vote returns it to the active tab as Pending" has no mechanism.
--
-- In the receipt system this never comes up: completion locks the receipt
-- immediately and both RPCs refuse everything afterwards. The window is a
-- consumption-only idea, so it needs a consumption-only answer.
--
-- THE ANSWER THIS MIGRATION IS BUILT FOR — WITHDRAW, THEN RE-VOTE:
--   To change a completed event, a voter first WITHDRAWS their vote (deletes
--   their own row). The event drops to one vote, becomes Pending again,
--   leaves the Ledger and returns to the active Approvals tab. The remaining
--   voter is now the sole voter and may change freely; the withdrawer may
--   vote again either way. Every rule above holds throughout, and the event is
--   never in a state where two rows disagree.
--
--   DELETE is deliberately NOT guarded by this trigger — withdrawing is the
--   escape hatch that makes the matching rule livable. 0096 still blocks the
--   delete once the event is more than 30 days past completion, so a locked
--   event cannot be unpicked this way. The two guards compose: 0097 says
--   "votes may not disagree", 0096 says "after 30 days, nothing changes".
--
--   If you would rather NOT have withdraw, say so and this migration should
--   not be applied as-is: without it, a completed consumption event is final
--   the moment it completes, exactly like a receipt, and the 30-day window
--   stops meaning anything.
--
-- ===========================================================================
-- WHAT THIS MEANS FOR "COMPLETED" — AND FOR 0096
-- ===========================================================================
-- With every vote on an event guaranteed to agree, completion needs no
-- decision logic at all:
--
--     COMPLETED = the 2nd DISTINCT voter's timestamp. Full stop.
--
-- The outcome is then simply whatever the votes say, since they all say the
-- same thing. "One objection ends it" is GONE — it was a rule that could
-- produce a completed event from a single vote, which the matching model has
-- no room for.
--
-- 0096 MUST BE UPDATED TO MATCH BEFORE IT IS APPLIED, and it has been: its
-- consumption_event_completed_at() no longer has a rejection branch. Apply
-- 0097 and 0096 together, in that order — 0097 establishes the invariant that
-- makes 0096's simpler definition correct.
--
-- ===========================================================================
-- EXISTING DATA — CHECKED, AND TWO EVENTS ARE ALREADY ILLEGAL UNDER THIS RULE
-- ===========================================================================
-- This trigger validates only rows being WRITTEN, so nothing existing is
-- rejected at apply time and no data is touched. But rows that already
-- disagree with their siblings become UNWRITABLE, and there are some:
--
--     event 1edc11e7-f83b-4b27-8de9-a85feb2a2ae4
--       approved by aaa@aaa.aaa
--       rejected by turkias.co@hotmail.com
--     event 8b527b52-17eb-4d9a-859a-bc0190af58d5
--       approved by aaa@aaa.aaa
--       rejected by turkias.co@hotmail.com
--
-- (17 vote rows across 10 events, 2 voters, at the time of drafting.)
--
-- Both are from the old "one objection ends it" model, where a disagreement
-- was a legitimate state. Under the matching rule they are events with two
-- different outcomes — which is exactly what this trigger exists to prevent.
-- They will render as neither completed nor cleanly pending until resolved,
-- and neither voter will be able to edit their row (any update repeats the
-- disagreement and is refused); only a withdraw will work.
--
-- THIS MIGRATION DOES NOT TOUCH THEM. Choosing which vote survives is a
-- business decision, not a migration's. Resolve each by deleting the losing
-- vote before or after applying:
--
--     delete from public.consumption_approvals
--      where id = '<the id of the vote being withdrawn>';
--
-- Re-run the detector afterwards to confirm it returns zero rows:
--
--     select coalesce(exit_permit_id, work_order_id, outsourced_job_id) as event,
--            count(distinct decision) as distinct_decisions, count(*) as votes
--       from public.consumption_approvals
--      group by 1
--     having count(distinct decision) > 1;
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- One function, SECURITY INVOKER (Postgres omits the keyword; its absence IS
-- invoker) with `set search_path = public` pinned — same posture as the
-- archive's guards in 0087/0092 and as 0096's. INVOKER is correct: it reads
-- only consumption_approvals, which the caller is already writing.
--
-- EXECUTE revoked from PUBLIC and anon. As 0087/0092 were corrected to say,
-- Supabase's `alter default privileges` also grants EXECUTE to
-- `authenticated` and `service_role` at creation time and this revoke does not
-- strip that — harmless for a trigger function, which raises "trigger
-- functions can only be called as triggers" if called directly.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - One function, one trigger, on ONE table. No table, column, constraint,
--    index, policy or row is altered. No data is written.
--  - NOTHING here moves stock. The guard only raises or returns.
--  - The inventory tables and their four RPCs are untouched.
--  - Re-runnable: create or replace function, drop trigger if exists.
--  - Trigger ORDER matters and is handled by naming: Postgres fires BEFORE
--    row triggers in alphabetical order, so
--    `consumption_approvals_lock_trg` (0096) runs before
--    `consumption_approvals_match_trg` (this one). The 30-day lock is
--    therefore reported in preference to a mismatch, which is the better
--    message: "this is history" beats "your vote disagrees" on a row nobody
--    can change either way.

begin;

CREATE OR REPLACE FUNCTION public.consumption_approvals_match_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_other text;
begin
  select c.decision into v_other
    from public.consumption_approvals c
   where c.id <> new.id
     and c.decision <> new.decision
     and (
       (new.exit_permit_id    is not null and c.exit_permit_id    = new.exit_permit_id)
       or (new.work_order_id     is not null and c.work_order_id     = new.work_order_id)
       or (new.outsourced_job_id is not null and c.outsourced_job_id = new.outsourced_job_id)
     )
   limit 1;

  if v_other is not null then
    raise exception 'This event already has a "%" vote — a second voter must match it; a split decision is not allowed.', v_other
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists consumption_approvals_match_trg on public.consumption_approvals;
create trigger consumption_approvals_match_trg
  before insert or update on public.consumption_approvals
  for each row execute function public.consumption_approvals_match_guard();

revoke execute on function public.consumption_approvals_match_guard() from public, anon;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) SHAPE — one function, INVOKER, pinned search_path, anon cannot execute:
--      select p.proname, p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname = 'consumption_approvals_match_guard';
--    Expect: false, {search_path=public}, false.
--
-- 2) TRIGGERS — this one fires on INSERT and UPDATE only (NOT delete, so
--    withdraw stays possible), and sorts AFTER the lock trigger:
--      select tgname, tgtype from pg_trigger
--       where tgrelid = 'public.consumption_approvals'::regclass
--         and not tgisinternal
--       order by tgname;
--
-- 3) IT BITES — each in its own transaction, rolled back. Pick one event with
--    exactly ONE vote for :e.
--    a) a SECOND voter with a DIFFERENT decision      -> must raise 23514
--    b) a SECOND voter with the SAME decision         -> must SUCCEED
--       (and the event is now complete)
--    c) the SOLE voter flipping their own vote, with
--       no other votes on the event                   -> must SUCCEED
--    d) after (b), either voter UPDATEing their row
--       to the opposite decision                      -> must raise 23514
--       (this is the consequence documented above — flipping a completed
--        event is impossible; withdraw first)
--    e) after (b), a voter DELETEing their own row    -> must SUCCEED
--       (withdraw — the event drops to one vote and reopens)
--    f) after (e), the remaining sole voter flipping  -> must SUCCEED
--
-- 4) A THIRD VOTER must also match:
--      with two matching votes present, a third voter with the opposite
--      decision -> 23514; with the same decision -> succeeds.
--
-- 5) THE TWO GUARDS COMPOSE — 0096 wins on a locked row:
--      age a completed event past 30 days, then attempt a MISMATCHED update.
--      Expect the LOCK message ("completed on ... and locked after 30 days"),
--      not the mismatch message, because the lock trigger sorts first.
--
-- 6) STILL INERT ON INVENTORY — re-run 0094's probe: snapshot
--    parts.qty_on_hand and price_lots.qty_remaining, count stock_movements,
--    vote/withdraw/re-vote on a consumption event, confirm every diff is zero
--    and the FIFO invariant holds. Roll back.
