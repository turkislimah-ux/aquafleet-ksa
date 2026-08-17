-- 0131_pay_commission_monthly.sql
-- Commission payment moves from an ALL-UNPAID SWEEP to ONE MONTH AT A TIME.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, hand-checks, and applies.
--
-- Today pay_commission (0009) tags EVERY unpaid delivered trip and EVERY unpaid
-- special/adjustment for the driver, with no date filter anywhere — the RPC's
-- three UPDATEs are unscoped and the app's own queries have no date predicate
-- either. period_label is a free-text caption produced from the server's local
-- clock; it never selects a row. That is already visible in live money: a payout
-- labelled "Jul 2026" locked 16 trips that were ALL driven in June, and another
-- "Jul 2026" payout spans June (240.00) and July (60.00).
--
-- After this migration a payment names its month. It pays that month's trips (by
-- trip_date), that month's specials/adjustments (by month_key) and that month's
-- bonus, tags only those rows, and period_label is DERIVED from the month paid.
--
-- THE MONEY MATH IS UNCHANGED. base/specials/adjustments/bonus are computed
-- exactly as they are today. What changes is WHICH rows one payment covers.
--
-- ===========================================================================
-- FLAGS FOR THE ARCHITECT — read before applying. Two of the four rulings in
-- the brief could not be implemented as written; both are implemented to their
-- INTENT with the mechanism corrected, and the evidence is here so the call is
-- the architect's, not mine.
-- ===========================================================================
--
-- FLAG A — RULING 3 IS A FALSE PREMISE. NOTHING IN THIS MIGRATION FIXES IT,
--          BECAUSE THERE IS NOTHING BROKEN.
--   The brief says approvePayout "does a plain .update() that silently no-ops
--   for the 12 of 16 drivers with no commission_periods row". It does not.
--   app/drivers/actions.ts:511 calls ensureCycle() at line 515 FIRST, and
--   ensureCycle (line 475) is already an upsert:
--       .upsert({ driver_id: driverId },
--               { onConflict: "driver_id", ignoreDuplicates: true })
--   The insert cannot fail for a missing column: every other column on
--   commission_periods carries a default or is nullable. It cannot fail on RLS
--   either: the single policy is authenticated_all_commission_periods, FOR ALL,
--   USING (true) WITH CHECK (true). setBonusStatus (line 486) calls ensureCycle
--   for the same reason. I reported this bug in the prior session and it was
--   wrong; the ruling inherited my error. Approve does create the row today.
--   (What DOES break for those drivers is different and is fixed here: Approve
--   approves every month at once — see FLAG D.)
--
-- FLAG B — THE GRAIN IN "12 OF 16" IS AMBIGUOUS AND BOTH READINGS ARE STATED.
--   Live: 4 commission_periods rows. Against ALL 16 drivers that is 12 without
--   a row; against the 11 non-terminated drivers the Commissions tab actually
--   shows, it is 7. Neither figure is adopted silently.
--
-- FLAG C — RULING 2's MECHANISM IS CORRECTED FROM created_at TO month_key.
--   The intent — "the bonus belongs to the month it was ENTERED" — is kept.
--   created_at cannot express it: it is when the ROW was created, usually by
--   ensureCycle during an unrelated approve/deny click, often months before any
--   bonus is typed. Live proof: Fahad 4's row was created 2026-07-03 by a bonus
--   REVIEW action and carries bonus_sar 0.00 — created_at names a month in which
--   no bonus was ever entered.
--   setCommissionBonus (actions.ts:394) ALREADY writes month_key with the month
--   the manager was viewing, and month_key is ALREADY the bonus's month
--   everywhere else money is reported:
--       0098 v_commissions_monthly:    bonus_status='approved' and cp.month_key = to_char(...)
--       0127 v_driver_payslip_basis:   same predicate
--   Using created_at would create a THIRD, divergent definition of the bonus's
--   month and put the payout at odds with both reports. month_key it is.
--
-- FLAG D — THE RE-GRAIN IS THE LOAD-BEARING DECISION HERE, AND IT IS NOT
--          COSMETIC. commission_periods TODAY IS ONE SINGLETON ROW PER DRIVER
--          (0009 dropped the (driver_id, month_key) uniqueness and made
--          month_key nullable, "label only"). A singleton row CANNOT express a
--          month-scoped payment, in two separate ways:
--     1. APPROVE. approvePayout flips every unpaid pending special/adjustment
--        for the driver, in every month. Approving June silently approves July's
--        items into v_commissions_monthly — a month that has not been reviewed.
--     2. THE BONUS WOULD BE DESTROYED, NOT TAGGED. 0009's reset does
--        `bonus_sar = 0, month_key = null`. Under month-scoping that erases a
--        PAID bonus from the month it belonged to, so v_commissions_monthly and
--        v_driver_payslip_basis would lose accrued money from a CLOSED month.
--        Every other component of a payout is tagged with payout_id and
--        preserved; the bonus is the only one wiped. Live history holds 200.00
--        of already-paid bonus — that is the size of the hole this would open.
--   So: month_key becomes NOT NULL, uniqueness moves to (driver_id, month_key),
--   and commission_periods gains its own payout_id tag. THE BONUS IS TAGGED,
--   NEVER ZEROED — same treatment as trips, specials and adjustments.
--
-- FLAG E — THE BASIS DIVERGENCE (RULING 4), AND MY PROPOSED RESOLUTION.
--   Pay counts PENDING + APPROVED (lib/commission-rows.ts countsForPay: status
--   <> 'denied'); v_commissions_monthly counts APPROVED only. Once approve is
--   month-scoped, approval flips that month's pending items to approved BEFORE
--   pay, so at pay time the two bases agree BY CONSTRUCTION — the payout can
--   only contain rows the report also counts. The residual gap is timing in the
--   pre-approval PREVIEW only, which is a preview of money not yet approved and
--   is honest as-is.
--   The one hole left: an item added AFTER approval and BEFORE pay is pending,
--   is counted by pay, and is not yet in the report. An optional STRICT GUARD is
--   drafted below (commented out, section 3b) that raises if a non-denied
--   PENDING item exists in the target month at pay time. It closes the hole at
--   the cost of forcing re-approval after a late edit. ARCHITECT'S CALL — it is
--   commented out, not omitted, so enabling it is one uncomment.
--
-- FLAG F — A TERMINATED DRIVER HOLDS UNPAID COMMISSION THAT THE UI CANNOT SHOW.
--   Turki (terminated 2026-07-03) carries 120.00 across 2 unpaid delivered
--   trips, both trip_date 2026-07-02/04. The Commissions tab pre-filters
--   terminated drivers, so this money is invisible there — but pay_commission
--   has no terminated filter and would pay it if called. NOT changed by this
--   migration (that is a policy question about final settlement, not a scoping
--   bug), recorded so it is not discovered as a surprise later.
--
-- ===========================================================================
-- WHAT THIS DOES NOT TOUCH
-- ===========================================================================
-- · THE 6 EXISTING PAYOUTS. No row of commission_payouts is inserted, updated
--   or deleted. Their labels stay exactly as they are, mislabelled or not.
--   Fingerprint asserted before AND after in verification (F).
-- · The money math. buildCurrentRows / buildPayoutSnapshot (lib/commission-rows)
--   are unchanged; the RPC still receives already-computed figures.
-- · trips.commission_sar, filling_cost_sar, rate_sar — the three frozen trip
--   figures are untouched. No trip's money changes; only its payout_id tag.
-- · v_commissions_monthly (0098), v_commissions_paid_monthly,
--   v_driver_payslip_basis (0127). No view is created, replaced or dropped.
-- · No new view, so the 44/44/0 view count and security posture do not move.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. REAL MONTH GRAIN ON commission_periods.
--    Backfill FIRST (the NOT NULL and the unique index both depend on it),
--    then the constraints, then the payout_id tag.
-- ---------------------------------------------------------------------------

-- 1a) Backfill the 3 NULL month_key rows from their creation month, read at
--     ASIA/RIYADH — not raw UTC, not the server's local clock. All three carry
--     bonus_sar 0.00, so this moves ZERO money; it only gives an empty cycle
--     row a month to live in. Live expectation:
--       mohammed 1  created 2026-06-22 09:59Z -> 2026-06
--       Khalid 1    created 2026-06-23 11:08Z -> 2026-06
--       Fahad 4     created 2026-07-03 17:47Z -> 2026-07
--     (Fahad 2 already carries 2026-08.) Different drivers, so no
--     (driver_id, month_key) collision is possible from this backfill.
--
--     THIS SUPERSEDES 0115's VERIFICATION BLOCK F, which asserts
--     `count(*) = 3` NULL-month_key rows and describes them as "EXCLUDED BY
--     PREDICATE, never removed". After 0131 that count is 0 and the payslip
--     predicate `month_key is not null` stops excluding anything. Nothing is
--     removed; the rows are given a month. See verification (I) for the proof
--     that no payslip figure moves.
update public.commission_periods
   set month_key = to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM')
 where month_key is null;

alter table public.commission_periods alter column month_key set not null;

-- 1b) ONE row per driver PER MONTH, not one row per driver.
drop index if exists public.commission_periods_one_open_per_driver;
create unique index if not exists commission_periods_driver_month_idx
  on public.commission_periods (driver_id, month_key);

-- 1c) The bonus becomes a TAGGED contributor, exactly like every other
--     component of a payout. FLAG D is the whole argument for this column.
alter table public.commission_periods
  add column if not exists payout_id uuid references public.commission_payouts(id) on delete set null;
create index if not exists commission_periods_unpaid_driver_idx
  on public.commission_periods (driver_id) where payout_id is null;

-- ---------------------------------------------------------------------------
-- 2. DROP THE EXACT OLD SIGNATURE FIRST (the 0036/0037 lesson — a stray
--    overload is how confirm_invoice ended up with three live versions).
--    Verified live before drafting: exactly ONE pay_commission exists,
--    prosecdef = false (SECURITY INVOKER), identity arguments
--      p_driver_id uuid, p_period_label text, p_base numeric, p_specials
--      numeric, p_adjustments numeric, p_bonus numeric, p_total numeric,
--      p_snapshot jsonb, p_approved_by text
--
--    NOTE ON THE NEW SIGNATURE: p_period_label text -> p_month_key text sits in
--    the SAME position with the SAME type, so the new function has an IDENTICAL
--    type signature. That is deliberate and has two consequences, both good:
--    the drop below yields a genuine REPLACEMENT rather than an overload pair,
--    and a stale caller still passing p_period_label fails loudly with
--    "no function matches" instead of silently paying under a caption.
-- ---------------------------------------------------------------------------
drop function if exists public.pay_commission(
  uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text);

-- ---------------------------------------------------------------------------
-- 3. MONTH-SCOPED PAY. Insert-plus-tag stays ATOMIC — one function, one
--    transaction, unchanged in that respect.
--    SECURITY INVOKER (no security clause), same as 0009: RLS must still apply
--    to the caller. Re-granted to authenticated at the end.
-- ---------------------------------------------------------------------------
create or replace function public.pay_commission(
  p_driver_id    uuid,
  p_month_key    text,     -- 'YYYY-MM'. THE SCOPE. Was p_period_label, a caption.
  p_base         numeric,
  p_specials     numeric,
  p_adjustments  numeric,
  p_bonus        numeric,
  p_total        numeric,
  p_snapshot     jsonb,
  p_approved_by  text default null
) returns uuid
language plpgsql
as $$
declare
  v_status    text;
  v_paid      uuid;
  v_id        uuid;
  v_start     date;
  v_end       date;
  v_label     text;
  -- HARDCODED ENGLISH MONTHS, NOT to_char(d,'Mon YYYY'). to_char's month name is
  -- lc_time-dependent, so the same payment would label differently on a server
  -- with a different locale. The label is stored money-adjacent text; it must be
  -- deterministic.
  v_months constant text[] := array[
    'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
begin
  -- Reject anything that is not YYYY-MM before it can select a single row.
  if p_month_key is null or p_month_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'pay_commission: p_month_key must be YYYY-MM (got %).',
      coalesce(p_month_key, 'null');
  end if;

  v_start := to_date(p_month_key, 'YYYY-MM');
  v_end   := (v_start + interval '1 month')::date;

  -- period_label IS DERIVED HERE AND NOWHERE ELSE. No clock is read: the label
  -- is a pure function of the month being paid, so it cannot disagree with the
  -- rows the payment covers, and there is no month-boundary/timezone hazard
  -- left to get wrong. The app passes the raw month key only.
  v_label := v_months[extract(month from v_start)::int] || ' ' || to_char(v_start, 'YYYY');

  -- STRICT pay: only from an APPROVED cycle FOR THAT MONTH. The message names
  -- the month, because "not approved" against a per-driver singleton used to be
  -- unambiguous and no longer is.
  select payout_status, payout_id
    into v_status, v_paid
    from public.commission_periods
   where driver_id = p_driver_id and month_key = p_month_key;

  if v_status is distinct from 'approved' then
    raise exception 'Payout for % must be approved before paying (got %).',
      v_label, coalesce(v_status, 'no cycle row');
  end if;

  -- The bonus can be paid ONCE. A month may legitimately be paid more than once
  -- (a back-dated trip delivered late is real — Khalid 1 already has two
  -- payouts under one label), so this is not a "month already paid" block; it is
  -- specifically a double-pay guard on the ONE component that is not row-level.
  -- The app must send p_bonus = 0 when the cycle row is already tagged.
  if v_paid is not null and coalesce(p_bonus, 0) <> 0 then
    raise exception 'Bonus for % was already paid (payout %); pass p_bonus = 0.',
      v_label, v_paid;
  end if;

  insert into public.commission_payouts
    (driver_id, approved_by, period_label,
     base_sar, specials_sar, adjustments_sar, bonus_sar, total_sar, snapshot)
  values
    (p_driver_id, p_approved_by, v_label,
     p_base, p_specials, p_adjustments, p_bonus, p_total,
     -- ONE definition of the label: the caller's snapshot cannot carry a
     -- different one, because this overwrites the key.
     coalesce(p_snapshot, '{}'::jsonb)
       || jsonb_build_object('periodLabel', v_label, 'monthKey', p_month_key))
  returning id into v_id;

  -- TRIPS — scoped by trip_date, the OPERATIONAL day. Not delivered_at: this
  -- fleet advances trips on the Kanban in bulk, so delivered_at records when a
  -- button was pressed (0109 re-bucketed the Dashboard onto trip_date for
  -- exactly this reason — 310 trips once landed on a single afternoon).
  -- delivered_at is not null stays as the "is it earned yet" test.
  update public.trips
     set payout_id = v_id
   where driver_id = p_driver_id
     and delivered_at is not null
     and payout_id is null
     and trip_date >= v_start
     and trip_date <  v_end;

  update public.commission_specials
     set payout_id = v_id,
         status = case when status = 'denied' then 'denied' else 'approved' end
   where driver_id = p_driver_id
     and payout_id is null
     and month_key = p_month_key;

  update public.commission_adjustments
     set payout_id = v_id,
         status = case when status = 'denied' then 'denied' else 'approved' end
   where driver_id = p_driver_id
     and payout_id is null
     and month_key = p_month_key;

  -- THE BONUS IS TAGGED, NEVER ZEROED (FLAG D). bonus_sar and month_key survive
  -- the payment, so v_commissions_monthly and v_driver_payslip_basis keep the
  -- month's accrual. 0009 set bonus_sar = 0 and month_key = null here.
  update public.commission_periods
     set payout_id = v_id,
         bonus_status = case when bonus_status = 'denied' then 'denied' else 'approved' end
   where driver_id = p_driver_id
     and month_key = p_month_key
     and payout_id is null;

  -- Reset ONLY this month's review gate. A further payment for the same month
  -- (a late back-dated trip) needs FRESH approval; it does not inherit this one.
  -- Other months are untouched — that is the whole point of the migration.
  update public.commission_periods
     set payout_status = 'pending',
         approved_by   = null
   where driver_id = p_driver_id
     and month_key  = p_month_key;

  return v_id;
end;
$$;

grant execute on function public.pay_commission(
  uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. OPTIONAL STRICT GUARD — FLAG E. NOT ENABLED. Architect's call.
--     Paste inside the function, immediately after the approval check, to
--     refuse paying a month that gained a pending item after it was approved.
--     Cost: a late edit forces Reopen -> Approve again.
--
--   if exists (
--     select 1 from public.commission_specials
--      where driver_id = p_driver_id and payout_id is null
--        and month_key = p_month_key and status = 'pending'
--     union all
--     select 1 from public.commission_adjustments
--      where driver_id = p_driver_id and payout_id is null
--        and month_key = p_month_key and status = 'pending')
--   then
--     raise exception '% has items added after approval; re-approve before paying.', v_label;
--   end if;
-- ---------------------------------------------------------------------------

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- Every expected figure below was measured against LIVE data before drafting,
-- on 2026-08-17. AUGUST GROWS with every delivery — re-read the current month
-- live and only hold June and July to a written number.
-- ===========================================================================
--
-- A) BEFORE APPLYING — the starting shape. Run this FIRST; B compares to it.
--      select count(*) as rows,
--             count(*) filter (where month_key is null)  as null_month,
--             count(*) filter (where bonus_sar <> 0)     as nonzero_bonus,
--             count(*) filter (where payout_status <> 'pending') as not_pending
--        from public.commission_periods;
--      -- EXPECT 4 / 3 / 0 / 0
--
--      select d.name, cp.month_key, cp.bonus_sar, cp.bonus_status,
--             to_char(cp.created_at at time zone 'Asia/Riyadh','YYYY-MM') as riyadh_month
--        from public.commission_periods cp join public.drivers d on d.id = cp.driver_id
--       order by cp.created_at;
--      -- EXPECT  mohammed 1  null  0.00  pending   2026-06
--      --         Khalid 1    null  0.00  pending   2026-06
--      --         Fahad 4     null  0.00  approved  2026-07
--      --         Fahad 2  2026-08  0.00  pending   2026-08
--
-- B) THE BACKFILL MOVED NO MONEY — RULING 2 PROVEN INERT TODAY.
--      select count(*) as rows,
--             count(*) filter (where month_key is null) as null_month,
--             sum(bonus_sar)                            as total_bonus,
--             count(*) filter (where bonus_sar <> 0)    as nonzero_bonus
--        from public.commission_periods;
--      -- EXPECT 4 / 0 / 0.00 / 0
--      -- 0 non-zero bonuses is the proof the bonus rule is FORWARD-ONLY: there
--      -- is no live bonus for a month attribution to move. If nonzero_bonus is
--      -- not 0, STOP — someone entered a bonus between drafting and applying,
--      -- and its month must be confirmed by hand before this migration runs.
--
--      select d.name, cp.month_key from public.commission_periods cp
--        join public.drivers d on d.id = cp.driver_id order by cp.month_key, d.name;
--      -- EXPECT  Khalid 1 2026-06, mohammed 1 2026-06, Fahad 4 2026-07,
--      --         Fahad 2 2026-08
--
-- C) THE RE-GRAIN LANDED.
--      select indexname, indexdef from pg_indexes
--       where schemaname='public' and tablename='commission_periods';
--      -- EXPECT commission_periods_driver_month_idx UNIQUE on (driver_id, month_key)
--      --        commission_periods_unpaid_driver_idx partial WHERE payout_id IS NULL
--      --        and NO commission_periods_one_open_per_driver
--
--      select column_name, is_nullable from information_schema.columns
--       where table_schema='public' and table_name='commission_periods'
--         and column_name in ('month_key','payout_id');
--      -- EXPECT month_key NO (not null), payout_id YES (nullable)
--
-- D) EXACTLY ONE pay_commission SIGNATURE, AND IT IS THE NEW ONE.
--      select p.oid::regprocedure as sig, p.prosecdef,
--             pg_get_function_identity_arguments(p.oid) as args
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='pay_commission';
--      -- EXPECT ONE row. prosecdef FALSE (security invoker, unchanged from 0009).
--      -- args must read p_month_key, NOT p_period_label. TWO ROWS = the drop
--      -- failed and there is an overload — STOP, that is the 0036/0037 failure.
--
-- E) THE MONEY IDENTITY — PER-MONTH PAYMENTS SUM TO THE OLD SWEEP.
--    This is the check the whole migration stands on: no riyal created, none
--    lost, only re-partitioned across months. Run it BEFORE applying (it reads
--    only live tables and needs none of this migration).
--      with base as (
--        select t.driver_id, to_char(t.trip_date,'YYYY-MM') as mk,
--               sum(t.commission_sar) as v
--          from public.trips t
--         where t.delivered_at is not null and t.payout_id is null
--         group by 1,2),
--      sp as (
--        select driver_id, month_key as mk, sum(amount_sar) as v
--          from public.commission_specials
--         where payout_id is null and status <> 'denied' group by 1,2),
--      adj as (
--        select driver_id, month_key as mk, sum(amount_sar) as v
--          from public.commission_adjustments
--         where payout_id is null and status <> 'denied' group by 1,2),
--      per_month as (
--        select driver_id, mk, sum(v) as month_total
--          from (select * from base union all select * from sp union all select * from adj) x
--         group by 1,2),
--      split as (
--        select driver_id, sum(month_total) as sum_of_months from per_month group by 1),
--      sweep as (
--        -- the OLD unscoped predicate, exactly as pay_commission ran it
--        select d.id as driver_id,
--               coalesce((select sum(t.commission_sar) from public.trips t
--                          where t.driver_id = d.id and t.delivered_at is not null
--                            and t.payout_id is null), 0)
--             + coalesce((select sum(s.amount_sar) from public.commission_specials s
--                          where s.driver_id = d.id and s.payout_id is null
--                            and s.status <> 'denied'), 0)
--             + coalesce((select sum(a.amount_sar) from public.commission_adjustments a
--                          where a.driver_id = d.id and a.payout_id is null
--                            and a.status <> 'denied'), 0) as old_sweep_total
--          from public.drivers d)
--      select d.name, sp2.sum_of_months, sw.old_sweep_total,
--             sp2.sum_of_months - sw.old_sweep_total as gap
--        from split sp2
--        join sweep sw on sw.driver_id = sp2.driver_id
--        join public.drivers d on d.id = sp2.driver_id
--       order by d.name;
--      -- EVERY `gap` MUST BE 0.00. A non-zero gap means a row carries a month
--      -- the split cannot see (a NULL/malformed month_key — see H) and that
--      -- money would be created or stranded by month-scoping. STOP if so.
--      --
--      -- EXPECTED SPLIT, measured live 2026-08-17 (base + specials + adjustments):
--      --   Khalid 2    Jul   520.30 | Aug 4,380.00            -> 4,900.30
--      --   mohammed 3  Jul   100.00 | Aug 4,360.00            -> 4,460.00
--      --   mohammed 1  Jul    98.40 | Aug 1,567.36            -> 1,665.76
--      --   Khalid 1    Jul   237.00 | Aug 1,159.00            -> 1,396.00
--      --   Fahad       Jun    10.00 | Jul 171.40 | Aug 749.50 ->   930.90
--      --   Fahad 3     Jul    50.00 (50 base +100 sp -100 adj) | Aug 865.00 -> 915.00
--      --   Fahad 2     Jul   280.00                           ->   280.00
--      --   Khalid 3    Jul   217.02                           ->   217.02
--      --   mohammed 2  Jul   105.90                           ->   105.90
--      --   Turki       Jul   120.00  <- TERMINATED, see FLAG F ->   120.00
--      -- Grand total across all drivers: 14,990.88.
--      -- Fahad 3's July is the basis-divergence case (FLAG E): +100.00 special
--      -- and -100.00 adjustment, BOTH status 'pending', netting to zero — so
--      -- pay and v_commissions_monthly happen to agree on the TOTAL today even
--      -- though they disagree on the basis. Do not read that as the gap being
--      -- closed by luck; approve-then-pay is what closes it.
--
-- F) THE 6 EXISTING PAYOUTS ARE UNTOUCHED. Run before AND after; identical.
--      select count(*) as payouts, sum(total_sar) as total, sum(base_sar) as base,
--             sum(specials_sar) as sp, sum(adjustments_sar) as adj,
--             sum(bonus_sar) as bonus,
--             md5(string_agg(id::text||period_label||total_sar::text, '|' order by id)) as fingerprint
--        from public.commission_payouts;
--      -- EXPECT 6 / 824.00 / 744.00 / 340.00 / -460.00 / 200.00
--      --        fingerprint 07b43655bcdb1c974101baaad8bb5fb2
--      -- The 200.00 of bonus is ALREADY-PAID history frozen in snapshots. It is
--      -- separate from "0 live bonuses" (B) and must not move either.
--
--      select period_label, count(*) from public.commission_payouts group by 1 order by 1;
--      -- EXPECT Jun 2026 = 2, Jul 2026 = 4. The mislabelled ones stay mislabelled.
--
-- G) NO ROW WAS RE-TAGGED OR UNTAGGED. This migration is DDL + one backfill of
--    a label column; it must not move a single payout_id.
--      select
--        (select count(*) from public.trips where payout_id is not null)                  as paid_trips,
--        (select count(*) from public.trips
--          where delivered_at is not null and payout_id is null)                          as unpaid_delivered,
--        (select count(*) from public.commission_specials where payout_id is not null)    as paid_specials,
--        (select count(*) from public.commission_specials where payout_id is null)        as unpaid_specials,
--        (select count(*) from public.commission_adjustments where payout_id is not null) as paid_adjustments,
--        (select count(*) from public.commission_adjustments where payout_id is null)     as unpaid_adjustments;
--      -- Identical before and after. The 2 unpaid extras are both Fahad 3,
--      -- month_key 2026-07, both 'pending' (+100.00 / -100.00).
--
--      select count(*) from public.commission_periods where payout_id is not null;
--      -- EXPECT 0 immediately after applying — the column is brand new and
--      -- nothing has been paid through the new RPC yet.
--
-- H) NOTHING ORPHANED BY THE NOT NULL. Every unpaid special/adjustment must
--    have a month_key the new scope can find, or its money silently stops being
--    payable.
--      select 'special' as kind, count(*) from public.commission_specials
--        where payout_id is null and (month_key is null or month_key !~ '^\d{4}-\d{2}$')
--      union all
--      select 'adjustment', count(*) from public.commission_adjustments
--        where payout_id is null and (month_key is null or month_key !~ '^\d{4}-\d{2}$');
--      -- EXPECT 0 / 0. Any row here is money that would become unreachable.
--
-- I) THE PAYSLIP AND COMMISSION REPORTS DO NOT MOVE. 0115's block F expected 3
--    NULL-month_key rows and this migration removes them (section 1a) — so the
--    check that matters is not the NULL count, it is whether any MONEY moved.
--      select month, total_sar, base_sar, specials_sar, adjustments_sar, bonus_sar
--        from public.v_commissions_monthly order by month;
--      -- Must be byte-identical before and after. All four backfilled rows carry
--      -- bonus_sar 0.00, and the view sums bonus only where bonus_status =
--      -- 'approved' AND month_key = the month — so giving a 0.00 bonus a month
--      -- adds 0.00 to that month. Fahad 4's row is the only backfilled one that
--      -- is 'approved', and it is 0.00.
--      -- Reference (payslip review table, from §7): Jun 428.00 / Jul 2,226.02 /
--      -- Aug 12,912.52 — August grows, June and July must not move.
--
--      select payslip_number, net_sar from public.driver_payslips order by payslip_number;
--      -- EXPECT PS-2026-000001 and PS-2026-000002 byte-identical. An ISSUED
--      -- payslip is a frozen document; if either figure moves, STOP and revert.
--
-- J) SMOKE TEST THE NEW RPC — ON ONE DRIVER, ONE MONTH, THEN CHECK THE SPLIT.
--    Suggested subject: Fahad, who is the only driver with THREE months
--    (Jun 10.00 / Jul 171.40 / Aug 749.50). Pay JUNE only.
--      -- after Approve (June) in the UI, then Pay (June):
--      select period_label, base_sar, total_sar, snapshot->>'monthKey' as month_key
--        from public.commission_payouts
--       where driver_id = (select id from public.drivers where name='Fahad')
--       order by paid_at desc limit 1;
--      -- EXPECT period_label 'Jun 2026', base 10.00, total 10.00,
--      --        month_key '2026-06'  <- derived in SQL, no clock read
--
--      select to_char(trip_date,'YYYY-MM') as mk, count(*),
--             count(*) filter (where payout_id is not null) as tagged
--        from public.trips
--       where driver_id = (select id from public.drivers where name='Fahad')
--         and delivered_at is not null
--       group by 1 order by 1;
--      -- EXPECT June fully tagged; JULY AND AUGUST STILL 0 TAGGED. That is the
--      -- entire migration in one row: under the old sweep all three months
--      -- would have been tagged by this single payment.
--
--      select month_key, payout_status, payout_id is not null as bonus_tagged
--        from public.commission_periods
--       where driver_id = (select id from public.drivers where name='Fahad')
--       order by month_key;
--      -- EXPECT the June row back to payout_status 'pending' with bonus_tagged
--      --        true; no other month affected.
--
-- K) THE LABEL IS DETERMINISTIC AND LOCALE-PROOF. The one thing a hardcoded
--    month array buys, checked directly.
--      set lc_time = 'de_DE.UTF-8';
--      select to_char(date '2026-06-01','Mon YYYY') as locale_dependent;
--      reset lc_time;
--      -- On a de_DE server that reads 'Jun 2026' or 'Juni 2026' depending on
--      -- build; the RPC's v_months array reads 'Jun 2026' on every server,
--      -- always. If this session errors on an unknown locale, the point stands
--      -- unproven but unchanged — the array reads no locale at all.
-- ===========================================================================
