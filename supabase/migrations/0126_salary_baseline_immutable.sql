-- 0126_salary_baseline_immutable.sql
-- Make forward-only STRUCTURAL: date the baseline at each person's employment
-- floor so a same-day raise can never rewrite the past.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and applies.
--
-- 0125 stays as applied history — we fix forward rather than rewriting an
-- applied migration (the 0038 / 0090 / 0109 precedent).
--
-- ===========================================================================
-- THE DEFECT
-- ===========================================================================
-- 0125 seeded every baseline at TODAY and resolved a month as "latest row with
-- effective_from <= month end, FALLING BACK to the earliest row". That made
-- today's seed row do two jobs at once:
--
--   role 1  the immutable BASELINE that pre-history months (Jun/Jul) fall back to
--   role 2  TODAY's current salary, which a raise updates
--
-- The trigger's same-day upsert corrects role 2 and silently rewrites role 1.
-- Proven, rolled back: a +100 raise entered today moved June payroll
-- 25,000 -> 25,100 and July 37,800 -> 37,900. Past reported profit rewrote.
--
-- A FUTURE-dated change was always fine. The defect is specifically a change
-- dated on or before the seed date — i.e. the FIRST RAISE ANYONE ENTERS.
--
-- ===========================================================================
-- THE FIX, AND WHY IT BETTERS THE MARKED-BASELINE APPROACH
-- ===========================================================================
-- The lean was: keep the fallback, but pin it to a baseline marked immutable.
-- This does something stronger — it MOVES THE BASELINE BACKWARD IN TIME, to
-- each person's employment floor, which removes the fallback entirely:
--
--     effective salary for a month
--       = the latest row with effective_from <= that month's END
--     (no second branch, no fallback, no special case)
--
-- Why this is better than marking the row immutable:
--
--   · ONE resolution path instead of two. The fallback branch — the thing that
--     went wrong — stops existing rather than being guarded.
--   · COLLISION BECOMES IMPOSSIBLE, not merely refused. The trigger writes
--     TODAY-dated rows; baselines are dated at employment start, which for
--     every existing person is in the past. An upsert cannot reach a baseline,
--     so there is no rule to enforce and nothing to forget.
--   · A marked baseline stays mutable IN PRINCIPLE — the trigger could still
--     land on its date. Date separation removes the possibility instead of
--     policing it.
--
-- WHY THE EMPLOYMENT FLOOR IS THE RIGHT DATE, and not a 1900 sentinel:
-- it is 0117's own floor, COALESCE(hire_date, created_at::date) — the same
-- expression v_payroll_monthly's employment window already uses. Because BOTH
-- rules key off the SAME date, they cannot disagree: a person is counted in a
-- month exactly when their baseline is resolvable in that month. 0117 also
-- explicitly rejected a 1900 sentinel for employment, and re-introducing one
-- here would invite the same confusion.
--
-- Live floors: drivers 2009-03-03 to 2026-07-04, staff 2011-01-20 to
-- 2026-07-25. Seven people (5 drivers, 2 staff) have floors AFTER 2026-06-30 —
-- and the employment window already excludes them from June, so they contribute
-- 0 by both rules. That agreement is by construction, not coincidence.
--
-- ===========================================================================
-- VALUE-NEUTRAL BY CONSTRUCTION
-- ===========================================================================
-- Only effective_from moves; no salary_sar value is touched, and no row is
-- added or removed. June resolves to the same figure it resolves to today — via
-- a direct match instead of the fallback. The acceptance test in block A proves
-- it rather than trusting this paragraph.
--
--   before  Jun 25,000.00   Jul 37,800.00   Aug 31,300.00
--   after   identical, AND identical again after a +100 raise entered today
--
-- ===========================================================================
-- WHAT THIS DOES NOT CHANGE
-- ===========================================================================
-- · The TRIGGERS. They already write today-dated rows and need no edit — which
--   is the point: the fix is in the data's shape, not in more behaviour.
-- · driver_payslips — the two frozen payslips are never read or recomputed.
-- · The 0117 employment-window floor, carried over verbatim again below.
-- · lib/prepaid.ts, lib/vat.ts, invoice math — no customer money here.
-- · v_driver_payslip_basis — still reads d.salary_sar directly and is still
--   scheduled for its own migration (see the review pack). It is a no-op today
--   because every resolved past month equals the current salary either way.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Mark the baselines. The resolution does NOT depend on this flag — the
--    date separation is the fix. It exists so "which row is the seeded
--    baseline" is queryable, and so the verification blocks can assert the
--    baselines were not mutated.
-- ---------------------------------------------------------------------
alter table public.salary_history
  add column if not exists is_baseline boolean not null default false;

comment on column public.salary_history.is_baseline is
  'True for the rows seeded by 0125 as each person''s opening salary. Dated at '
  'their employment floor by 0126 so a same-day change can never collide with '
  'one. Informational: the resolution rule does not read this column.';

update public.salary_history
   set is_baseline = true
 where note like 'Baseline seeded by 0125%';

-- ---------------------------------------------------------------------
-- 2) Move each baseline back to that person's employment floor — the same
--    expression the employment window uses. Values are untouched.
-- ---------------------------------------------------------------------
update public.salary_history h
   set effective_from = coalesce(
         d.hire_date, (d.created_at at time zone 'Asia/Riyadh')::date)
  from public.drivers d
 where h.driver_id = d.id
   and h.is_baseline;

update public.salary_history h
   set effective_from = coalesce(
         s.hire_date, (s.created_at at time zone 'Asia/Riyadh')::date)
  from public.staff s
 where h.staff_id = s.id
   and h.is_baseline;

-- ---------------------------------------------------------------------
-- 3) Resolution loses its fallback. Column list reproduced EXACTLY in order
--    and type (42P16). The employment window is 0117's, verbatim.
-- ---------------------------------------------------------------------
create or replace view public.v_payroll_monthly as
select
  m.month,
  coalesce((
    select sum(coalesce(
      (select h.salary_sar from public.salary_history h
        where h.staff_id = s.id
          and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
        order by h.effective_from desc limit 1),
      0::numeric))
      from public.staff s
     where coalesce(s.hire_date, (s.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 mon' - interval '1 day')::date
       and (s.terminated_at is null or s.terminated_at::date >= m.month)
  ), 0::numeric) as staff_salary_sar,
  coalesce((
    select sum(coalesce(
      (select h.salary_sar from public.salary_history h
        where h.driver_id = d.id
          and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
        order by h.effective_from desc limit 1),
      0::numeric))
      from public.drivers d
     where coalesce(d.hire_date, (d.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 mon' - interval '1 day')::date
       and (d.terminated_at is null or d.terminated_at::date >= m.month)
  ), 0::numeric) as driver_salary_sar,
  ((select count(*) from public.staff s
     where not exists (select 1 from public.salary_history h where h.staff_id = s.id)
       and (s.terminated_at is null or s.terminated_at::date >= m.month))
  + (select count(*) from public.drivers d
      where not exists (select 1 from public.salary_history h where h.driver_id = d.id)
        and (d.terminated_at is null or d.terminated_at::date >= m.month)))
    as people_missing_salary,
  -- Now that baselines sit at the employment floor, every month a person is
  -- counted in HAS a resolvable row — so this can no longer mean "fell back".
  -- It now answers the honest question it should: is this month costed at a
  -- salary that has never been superseded, i.e. still the opening figure?
  -- TRUE = no recorded change has taken effect on or before this month end.
  not exists (
    select 1 from public.salary_history h
     where not h.is_baseline
       and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
  ) as salary_is_current_snapshot
from public.v_report_months m;

alter view public.v_payroll_monthly set (security_invoker = true);
revoke all on public.v_payroll_monthly from anon;
grant select on public.v_payroll_monthly to authenticated;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE ACCEPTANCE TEST. This is the defect, re-run. It WRITES SALARY DATA, so
--    it runs inside a transaction that is ROLLED BACK, with a post-rollback
--    check. Under 0125 this moved June and July; it must not now.
--
--      -- step 1, before touching anything:
--      select to_char(month,'YYYY-MM') as month,
--             staff_salary_sar + driver_salary_sar as payroll
--        from public.v_payroll_monthly order by 1;
--      -- expect 2026-06 25,000.00 | 2026-07 37,800.00 | 2026-08 31,300.00
--
--      begin;
--        update public.drivers set salary_sar = salary_sar + 100
--         where id = (select id from public.drivers
--                      where salary_sar is not null and terminated_at is null
--                      order by id limit 1);
--
--        select to_char(month,'YYYY-MM') as month,
--               staff_salary_sar + driver_salary_sar as payroll
--          from public.v_payroll_monthly order by 1;
--        -- 2026-06 MUST still read 25,000.00
--        -- 2026-07 MUST still read 37,800.00
--        -- 2026-08 MAY read 31,400.00 — the current month is genuinely "now",
--        --         and reflecting a same-day raise there is correct.
--        -- ANY movement in June or July means the fix failed. Roll back and stop.
--
--        -- and the baseline itself must be untouched:
--        select count(*) as baselines_dated_today
--          from public.salary_history
--         where is_baseline
--           and effective_from = (now() at time zone 'Asia/Riyadh')::date;
--        -- expect 0 for every person hired before today — a baseline sitting on
--        -- today's date is the exact collision this migration removes.
--      rollback;
--
--      -- step 2, CONFIRM THE RESTORE — this is mandatory, it wrote salary data:
--      select count(*) as history_rows from public.salary_history;   -- expect 22
--      select to_char(month,'YYYY-MM'), staff_salary_sar + driver_salary_sar
--        from public.v_payroll_monthly order by 1;
--      -- back to 25,000.00 / 37,800.00 / 31,300.00
--
-- B) PAST MONTHS UNMOVED BY THE MIGRATION ITSELF. Capture BEFORE applying:
--      select to_char(m.month,'YYYY-MM') as month,
--             p.staff_salary_sar, p.driver_salary_sar, p.people_missing_salary,
--             n.payroll_sar, n.operating_cost_sar, n.net_profit_sar
--        from public.v_report_months m
--        join public.v_payroll_monthly p on p.month = m.month
--        join public.v_pnl_monthly n on n.month = m.month
--       order by 1;
--      -- 2026-06  10,600.00 / 14,400.00 / 4 / 25,000.00 / 25,598.00 / -25,598.00
--      -- 2026-07  16,900.00 / 20,900.00 / 3 / 37,800.00 / 57,443.9700 / 206.0300
--      -- 2026-08  16,900.00 / 14,400.00 / 3 / 31,300.00 / 59,900.0200 / -59,900.0200
--      -- JUNE MUST READ 25,000.00 — the 0117-corrected figure.
--
-- C) THE BASELINES MOVED IN DATE ONLY, NEVER IN VALUE. Expect 0 rows:
--      select h.id from public.salary_history h
--        left join public.drivers d on d.id = h.driver_id
--        left join public.staff   s on s.id = h.staff_id
--       where h.is_baseline
--         and h.salary_sar is distinct from coalesce(d.salary_sar, s.monthly_salary_sar);
--
--      select count(*) as rows, count(*) filter (where is_baseline) as baselines,
--             min(effective_from) as earliest, max(effective_from) as latest
--        from public.salary_history;
--      -- expect 22 / 22 / 2009-03-03 / 2026-07-25 — NOT all on one date any more.
--      -- (22 is correct and includes the 5 TERMINATED drivers, whose salaries
--      --  July's 20,900 depends on. 0125's own block C said 17; that was wrong.)
--
-- D) COLLISION IS NOW STRUCTURALLY IMPOSSIBLE for everyone hired before today:
--      select count(*) as baselines_on_todays_date
--        from public.salary_history
--       where is_baseline and effective_from = (now() at time zone 'Asia/Riyadh')::date;
--      -- expect 0 today. A person hired TODAY would legitimately have one, and
--      -- that case is harmless: the employment window gives them no earlier
--      -- month to protect.
--
-- E) A FUTURE-DATED RAISE STILL APPLIES FORWARD ONLY (no regression on 0125's
--    G behaviour). Rolled back:
--      begin;
--        insert into public.salary_history (driver_id, effective_from, salary_sar, note)
--        select id, date '2026-09-01', 9999, 'verification only'
--          from public.drivers where salary_sar is not null limit 1;
--        select to_char(month,'YYYY-MM'), driver_salary_sar
--          from public.v_payroll_monthly order by 1;
--        -- Jun / Jul / Aug ALL unchanged — September is beyond every month end.
--      rollback;
--      select count(*) from public.salary_history;   -- expect 22
--
-- F) THE FROZEN PAYSLIPS NEVER MOVED. Same two hashes as before 0125:
--      select payslip_number, base_salary_sar, commission_sar, net_sar,
--             md5(row(payslip_number, period_start, base_salary_sar, commission_sar,
--                     specials_sar, adjustments_sar, bonus_sar, deductions_sar, net_sar)::text) as row_hash
--        from public.driver_payslips order by payslip_number;
--      -- PS-2026-000001  1,300.00 / 204.00 / 1,504.00  4c98509b50f2599dc65c797760d26aaa
--      -- PS-2026-000002  1,300.00 / 217.02 / 1,517.02  e27bcb32b466660a4b5265878325e42c
--
-- G) VIEW SHAPE AND SECURITY FOOTER.
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_payroll_monthly'
--       order by ordinal_position;
--      -- month, staff_salary_sar, driver_salary_sar, people_missing_salary,
--      -- salary_is_current_snapshot — same order, same types.
--
--      select c.reloptions,
--             has_table_privilege('anon', c.oid,'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid,'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='v_payroll_monthly';
--      -- {security_invoker=true}, anon FALSE, authenticated TRUE.
--
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relkind='v';
--      -- expect 40 / 40 / 0 — this migration adds no view.
--
-- H) THE FLAG'S NEW MEANING READS TRUE TODAY. With no non-baseline row yet,
--    every month is still at its opening salary:
--      select to_char(month,'YYYY-MM'), salary_is_current_snapshot
--        from public.v_payroll_monthly order by 1;
--      -- expect TRUE for all three. NOTE this CHANGES August, which read false
--      -- under 0125 — because 0125's flag meant "fell back to the baseline" and
--      -- August's seed row was dated inside August. The new meaning is "no
--      -- recorded change has taken effect by this month end", which is true of
--      -- all three months and is the more useful statement. This is a
--      -- DELIBERATE change to a display flag, not a money figure.
-- ===========================================================================
