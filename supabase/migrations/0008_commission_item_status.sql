-- ============================================================================
-- Bousla — Phase 6 schema (3/3): commission item denial, payout deny, salary
-- Run in the Supabase SQL editor (after 0007).
--
-- 1) Per-item denial for specials & adjustments: a manager can DENY one line. A
--    denied line is NOT deleted — it stays visible, is EXCLUDED from the month
--    total, and carries a reason. status='active' (default) counts normally.
-- 2) Payout-level deny: extend the periods state machine with a 'denied'
--    decision (Pending → Approved → Paid, or → Denied) plus a reason.
-- 3) Driver salary: a standalone monthly salary on the driver. Display-only —
--    it does NOT factor into any commission or payout total.
-- ============================================================================

-- ----- per-item denial: commission_specials --------------------------------
alter table public.commission_specials
  add column if not exists status text not null default 'active'
    check (status in ('active', 'denied')),
  add column if not exists deny_reason text;

-- ----- per-item denial: commission_adjustments -----------------------------
alter table public.commission_adjustments
  add column if not exists status text not null default 'active'
    check (status in ('active', 'denied')),
  add column if not exists deny_reason text;

-- ----- payout-level deny: extend commission_periods status machine ----------
-- 0007 created an inline check (auto-named <table>_<col>_check) allowing
-- (pending, approved, paid). Re-create it to add 'denied'.
alter table public.commission_periods
  drop constraint if exists commission_periods_payout_status_check;
alter table public.commission_periods
  add constraint commission_periods_payout_status_check
    check (payout_status in ('pending', 'approved', 'paid', 'denied'));

alter table public.commission_periods
  add column if not exists deny_reason text;

-- ----- driver salary (standalone, not part of commission math) --------------
alter table public.drivers
  add column if not exists salary_sar numeric(12, 2);
