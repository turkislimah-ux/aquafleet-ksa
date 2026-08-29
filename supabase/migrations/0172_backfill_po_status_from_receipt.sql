-- 0172_backfill_po_status_from_receipt.sql
--
-- Data cleanup only. No DDL, no function/view replacement, so none of §6's
-- re-grant footers apply.
--
-- WHY
-- ---
-- stock_receipts is the source of truth for approvals; purchase_orders.status
-- is a DERIVED mirror of it. Five purchase orders predate the vote model
-- (migration 0058) and were never mirrored: the PO still reads
-- 'pending_approval' while its own linked receipt is already resolved and has
-- zero vote rows. The app fix in this same commit makes the approvals queue
-- admit rows on the RECEIPT's status (the same predicate the vote guard uses),
-- so these five stop being visible-but-unvotable — but their PO status is
-- still wrong on the PO list and in every PO-status filter. This migration
-- repairs that stored value.
--
-- SCOPE — exact predicate, all three conditions required:
--   1. purchase_orders.status = 'pending_approval'      (mirror not applied)
--   2. linked stock_receipts.status IN ('approved','rejected')  (resolved)
--   3. ZERO rows in stock_receipt_approvals for that receipt    (pre-vote-model)
--
-- Condition 3 is what makes this safe. A receipt that is genuinely mid-vote
-- has >= 1 vote row, so it can never match. PO-2026-0009 and PO-2026-0014 are
-- exactly that case (receipt pending, one vote each) and are untouched.
--
-- Each PO takes its OWN receipt's resolved status — approved -> 'approved',
-- rejected -> 'rejected'. Nothing is hardcoded; a rejected receipt in this set
-- would correctly produce a rejected PO.
--
-- Status-plumbing only: no quantity, no price lot, no money column is touched,
-- and no vote row is fabricated. The receipts already carry their own
-- resolution; this only stops the PO from contradicting them.
--
-- Idempotent: after it runs, no matched PO is still 'pending_approval', so a
-- re-run matches zero rows and is a no-op. Verified beforehand that no PO has
-- more than one linked receipt, so the join cannot multiply rows.

begin;

-- Pre-flight: print what will be updated. Expect exactly 5 rows, every
-- receipt_status 'approved', every votes 0. If this prints anything else,
-- ROLLBACK and re-investigate rather than continuing.
select
  po.po_number,
  po.id                                             as po_id,
  po.status                                         as po_status_before,
  r.id                                              as receipt_id,
  r.status                                          as receipt_status,
  r.status                                          as po_status_after,
  (select count(*) from public.stock_receipt_approvals a
    where a.stock_receipt_id = r.id)                as votes
from public.purchase_orders po
join public.stock_receipts r on r.po_id = po.id
where po.status = 'pending_approval'
  and r.status in ('approved', 'rejected')
  and not exists (
    select 1 from public.stock_receipt_approvals a
    where a.stock_receipt_id = r.id
  )
order by po.po_number;

update public.purchase_orders po
set status = r.status
from public.stock_receipts r
where r.po_id = po.id
  and po.status = 'pending_approval'
  and r.status in ('approved', 'rejected')
  and not exists (
    select 1 from public.stock_receipt_approvals a
    where a.stock_receipt_id = r.id
  );

-- Post-flight: must return 0. Any remaining row means the UPDATE did not
-- apply and this transaction should be rolled back.
select count(*) as still_stuck
from public.purchase_orders po
join public.stock_receipts r on r.po_id = po.id
where po.status = 'pending_approval'
  and r.status in ('approved', 'rejected')
  and not exists (
    select 1 from public.stock_receipt_approvals a
    where a.stock_receipt_id = r.id
  );

-- Guard: the two legitimately-pending POs must survive untouched. Expect 2.
select count(*) as legitimately_pending_preserved
from public.purchase_orders po
join public.stock_receipts r on r.po_id = po.id
where po.status = 'pending_approval'
  and r.status = 'pending_approval';

commit;
