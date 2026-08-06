-- 0095_consumption_approvals_two_person.sql
-- Consumption approvals — ONE ROW PER EVENT becomes ONE ROW PER (EVENT,
-- APPROVER), so an event can collect two sign-offs like a purchase order does.
--
-- ===========================================================================
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- ===========================================================================
-- 0094 keyed this table on the EVENT alone — a deliberate divergence from
-- purchase_order_approvals at the time, on the reasoning that two people
-- recording opposite decisions would leave no way to say which one stands.
-- Turki has settled that differently: two approvals are REQUIRED, and a
-- rejection by anyone ends it. That resolves the ambiguity by rule instead of
-- by constraint, so the constraint can now widen.
--
--   DROPPED  the three per-event unique indexes (_permit_uniq, _wo_uniq,
--            _os_uniq)
--   TIGHTENED decided_by: text -> text NOT NULL. The approver is now part of
--            the key, exactly as purchase_order_approvals.approver_email is,
--            and a key column that can be NULL is not a key.
--   ADDED    three unique indexes on (FK, decided_by), each still PARTIAL on
--            the FK being non-null.
--
-- UNCHANGED, and none of it is touched below: the exactly-one-subject CHECK,
-- the decision CHECK, all three FKs and their ON DELETE CASCADE, the
-- (decision, decided_at desc) lookup index, RLS and its single policy. No
-- function and no trigger is created — this table stays inert, which is the
-- property the whole feature rests on.
--
-- ===========================================================================
-- THE BRIEF'S DATA-SAFETY PREMISE WAS WRONG — CHECKED, STILL SAFE
-- ===========================================================================
-- The instruction said "consumption_approvals has no real rows yet, so this is
-- data-safe". It has FOUR rows, all written during the in-browser test pass:
--
--   work_order      approved   turkias.co@hotmail.com
--   exit_permit     approved   turkias.co@hotmail.com
--   outsourced_job  approved   turkias.co@hotmail.com
--   work_order      rejected   turkias.co@hotmail.com  ("No actual Job was
--                                                        done", a re-decide —
--                                                        decided_at > created_at)
--
-- It is still data-safe, but for a reason worth stating rather than assumed:
--
--   1. SET NOT NULL succeeds because all four rows already carry a decided_by
--      (verified: 0 rows with decided_by is null). The app has always written
--      it; the column was only nullable to match the house's other actor
--      columns.
--   2. The new (FK, decided_by) unique indexes cannot collide, because the
--      indexes being dropped allowed at most ONE row per event in the first
--      place. A duplicate pair could not exist even in principle.
--
-- The four rows survive and keep their meaning. Under the new rule each now
-- counts as ONE of the two approvals its event needs — so an event that read
-- "Approved" before this migration will read "1 of 2 approvals" after it.
-- That is a real, visible change to already-tested data, and it is correct:
-- those events genuinely have one sign-off, not two. Nothing is deleted.
--
-- If you would rather start the two-person era clean, delete the four rows
-- yourself before or after applying — the migration does not do it, because
-- silently deleting decisions someone recorded is not a migration's business.
--
-- ===========================================================================
-- ORDER OF OPERATIONS
-- ===========================================================================
-- Drops first, then the column tighten, then the new indexes. The drops must
-- precede the new indexes so the table is never briefly under both rules at
-- once, and SET NOT NULL sits between them so the new indexes are created
-- against a column that is already guaranteed non-null.
--
-- All of it inside one transaction: either the table ends up fully under the
-- two-person rule or fully under the old one. A half-migrated approvals table
-- would silently accept a second row per event with no key to stop a third.
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- No functions are created or altered, so there is nothing to make SECURITY
-- DEFINER, nothing to pin a search_path on and nothing to revoke EXECUTE
-- from. RLS is untouched: still enabled, still exactly one policy
-- (authenticated, FOR ALL, using true with check true).
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - One table's indexes and one column's nullability. No other table,
--    column, constraint, policy, function or row is touched.
--  - No data is deleted, inserted or rewritten.
--  - Re-runnable: drop index if exists, create index if not exists, and
--    SET NOT NULL is idempotent on an already-NOT NULL column.

begin;

-- 1) The per-event rule goes. These are what limited an event to one approver.
drop index if exists public.consumption_approvals_permit_uniq;
drop index if exists public.consumption_approvals_wo_uniq;
drop index if exists public.consumption_approvals_os_uniq;

-- 2) The approver becomes part of the key, so it can no longer be NULL.
--    Mirrors purchase_order_approvals.approver_email, which is NOT NULL for
--    exactly this reason.
alter table public.consumption_approvals
  alter column decided_by set not null;

-- 3) ONE ROW PER (EVENT, APPROVER). Still partial: a row for one kind carries
--    NULL in the other two FKs, and there is no point indexing those.
--    Together these give the two-person model its guarantee — a single person
--    cannot approve the same event twice to reach two, because their second
--    attempt collides with their own first row and the app UPDATEs it instead.
create unique index if not exists consumption_approvals_permit_approver_uniq
  on public.consumption_approvals (exit_permit_id, decided_by)
  where exit_permit_id is not null;

create unique index if not exists consumption_approvals_wo_approver_uniq
  on public.consumption_approvals (work_order_id, decided_by)
  where work_order_id is not null;

create unique index if not exists consumption_approvals_os_approver_uniq
  on public.consumption_approvals (outsourced_job_id, decided_by)
  where outsourced_job_id is not null;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) INDEXES — the three old ones gone, the three new ones present, each
--    UNIQUE, PARTIAL, and keyed on (FK, decided_by); the decision index
--    untouched:
--      select indexname, indexdef from pg_indexes
--       where schemaname = 'public' and tablename = 'consumption_approvals'
--       order by indexname;
--    Expect exactly: _decision_idx, _os_approver_uniq, _permit_approver_uniq,
--    _wo_approver_uniq, _pkey. NO _permit_uniq / _wo_uniq / _os_uniq.
--
-- 2) COLUMN — decided_by is NOT NULL, nothing else changed:
--      select column_name, is_nullable from information_schema.columns
--       where table_schema = 'public' and table_name = 'consumption_approvals'
--       order by ordinal_position;
--
-- 3) UNCHANGED CONSTRAINTS — the two CHECKs and three cascading FKs still
--    exactly as 0094 left them:
--      select conname, pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.consumption_approvals'::regclass
--       order by contype, conname;
--
-- 4) STILL INERT — the property the feature rests on:
--      select count(*) from pg_trigger
--       where tgrelid = 'public.consumption_approvals'::regclass
--         and not tgisinternal;                                  -- expect 0
--      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname ilike '%consumption_approval%';
--                                                                -- expect 0
--
-- 5) THE FOUR EXISTING ROWS SURVIVED:
--      select count(*) from public.consumption_approvals;        -- expect 4
--
-- 6) IT BITES — each in its own transaction, rolled back. Pick any exited
--    permit id for :p.
--    a) two DIFFERENT approvers on the same permit    -> both SUCCEED
--       (this is the whole point of the migration)
--    b) the SAME approver twice on the same permit    -> second raises 23505
--    c) decided_by NULL                               -> raises 23502
--    d) two FKs set at once                           -> still raises 23514
--       (proves 0094's exactly-one CHECK was not disturbed)
--    e) decision = 'maybe'                            -> still raises 23514
--
-- 7) STILL INERT ON INVENTORY — the same probe 0094 shipped with, re-run
--    because the key changed and two rows per event now exist where one did:
--    snapshot parts.qty_on_hand and price_lots.qty_remaining, count
--    stock_movements, capture exit_permits/work_orders/outsourced_jobs status
--    columns, insert TWO approvals for one event from two different approvers,
--    then confirm every diff returns zero rows and the FIFO invariant holds.
--    Roll back.
