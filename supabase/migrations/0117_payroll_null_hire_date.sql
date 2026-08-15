-- 0117_payroll_null_hire_date.sql
-- v_payroll_monthly stops billing people for months before they existed.
--
-- APPLIED AND VERIFIED (architect, 2026-08-15). Committed after apply, per the
-- reset incident in CLAUDE.md section 7.
--
-- Verified at apply: security_invoker intact and anon locked, column list
-- unchanged, June payroll 36,000.00 -> 25,000.00 (the 11,000.00 reconciled to
-- the six NULL-hire pre-record rows exactly), July 37,800.00 and August
-- 31,300.00 byte-identical to before, P&L June net -36,598.00 -> -25,598.00
-- with July and August untouched, and the payslip surface unaffected.
--
-- ===========================================================================
-- THIS MOVES A REAL P&L FIGURE. READ THE NUMBERS BEFORE APPLYING.
-- ===========================================================================
-- June 2026 payroll drops 36,000.00 -> 25,000.00. July and August do not move
-- at all. Full effect, measured by simulating both predicates side by side:
--
--   month     staff before/after     drivers before/after    payroll before/after
--   2026-06   15,100.00 / 10,600.00  20,900.00 / 14,400.00   36,000.00 / 25,000.00
--   2026-07   16,900.00 / 16,900.00  20,900.00 / 20,900.00   37,800.00 / 37,800.00
--   2026-08   16,900.00 / 16,900.00  14,400.00 / 14,400.00   31,300.00 / 31,300.00
--
-- Downstream, June only:
--   operating_cost   36,598.00 -> 25,598.00
--   operating_profit -36,598.00 -> -25,598.00
--   net_profit       -36,598.00 -> -25,598.00
--   operating_margin unchanged (NULL — June has no revenue, and a margin on
--                    nothing is not a number)
--
-- Nothing else in the P&L moves. Revenue, parts, outsourced, commissions,
-- filling and expenses are untouched by this file.
--
-- ===========================================================================
-- THE BUG
-- ===========================================================================
-- Both subqueries in v_payroll_monthly gate employment with
--
--     COALESCE(hire_date, '1900-01-01') <= month_end
--
-- so a person with NO hire date reads as "employed since 1900" and is billed
-- into every historical month the report covers. This is the same fabricated-
-- date defect 0116 fixed on the payslip view, still live in the P&L — and it is
-- worse here, because the payslip surface shows one row per person where a
-- reader might notice, while this is a single aggregate where 11,000 SAR of
-- salary for people who had not started is invisible.
--
-- ===========================================================================
-- THE FIX, AND WHY IT IS NOT THE ONE THAT WAS SUGGESTED
-- ===========================================================================
-- The lean handed to me was: exclude a NULL-hire person from payroll entirely
-- until a hire_date exists — "you cannot bill a cost you cannot date." I am
-- overriding that, with data, because it trades a smaller overstatement for a
-- larger and more certain UNDERSTATEMENT.
--
-- Who actually has no hire date (measured, all of them):
--
--   staff   Turki, fleet_manager, 4,500.00/month, ACTIVE, never terminated,
--           record created 2026-07-25
--   driver  Fahad 2   1,300.00  created 2026-07-02  terminated 2026-07-03
--   driver  Fahad 3   1,300.00  created 2026-07-02  terminated 2026-07-04
--   driver  Fahad 4   1,300.00  created 2026-07-03  terminated 2026-07-03
--   driver  Fahad 4   1,300.00  created 2026-07-03  terminated 2026-07-03
--   driver  Turki     1,300.00  created 2026-07-04  terminated 2026-07-04
--
-- Excluding them outright would have:
--   · correctly removed the June salary — none of these records existed in
--     June, so none of it was real; but also
--   · WRONGLY removed 4 of 5 drivers from JULY, where they demonstrably worked
--     — measured: 0 of the 5 have any trip in June, 4 of 5 have trips in July;
--     and
--   · WRONGLY removed the active fleet_manager's 4,500.00 from EVERY month
--     including August, where he is unambiguously employed.
--
-- August payroll would have fallen 31,300.00 -> 26,800.00 for a person who
-- works here today. A cost view that omits a current employee's salary is a
-- worse error than one that starts it too early, because it understates what
-- the business actually spends and nothing on screen hints at the gap.
--
-- SO: THE FLOOR MOVES FROM A FABRICATED DATE TO A REAL ONE.
--
--     COALESCE(hire_date, created_at::date) <= month_end
--
-- created_at is NOT NULL on both staff and drivers (verified), so the
-- expression can never fall through to nothing and no third fallback is needed.
--
-- WHAT THE NEW RULE CLAIMS, STATED PRECISELY: not "this person was hired on
-- their created_at" — that would be the same fabrication in a newer costume.
-- It claims only that THERE IS NO BASIS TO BILL THEM EARLIER THAN THE DATE
-- THEIR RECORD FIRST EXISTED. It is a floor on evidence, not an assertion
-- about employment. A person still counts from the first month the business
-- has any record of them, which is the earliest month anyone could honestly
-- defend, and they still stop at terminated_at exactly as before.
--
-- It also fixes every case correctly, which the alternative did not: June drops
-- the six who did not exist, July keeps the five drivers who drove, and every
-- month keeps the active fleet_manager from the month he appears onward.
--
-- The moment Turki fills in the real hire dates, this branch stops being
-- reachable for those rows and the figures follow the real dates — the fix
-- degrades to nothing on its own, with no flag to remember to remove.
--
-- ===========================================================================
-- SCOPE — WHAT THIS DOES NOT TOUCH
-- ===========================================================================
-- · THE COLUMN LIST IS UNCHANGED. Same five columns, same names, same order,
--   same types. Only two WHERE predicates change, so there is no 42P16 risk and
--   nothing downstream needs rewiring. v_pnl_monthly reads payroll_sar from
--   this view and picks the correction up automatically.
-- · salary_is_current_snapshot STAYS HARDCODED true. That is the deferred
--   effective-dated-salary item and is a different problem: this file fixes
--   WHICH MONTHS a person is billed for, not WHAT RATE they are billed at. A
--   past month is still costed at today's salary and the flag still says so.
-- · people_missing_salary is unchanged. It counts people with NO salary, and
--   all six people affected here HAVE one, so the two sets do not overlap
--   today. Noted rather than adjusted: it carries no hire_date predicate at
--   all, which is a separate question nobody has asked yet.
-- · NO DATA IS EDITED. Turki is filling in the missing hire dates himself; this
--   file only stops the view inventing one.
-- ===========================================================================

begin;

create or replace view public.v_payroll_monthly
with (security_invoker = true) as
select
  m.month,
  coalesce((
    select sum(coalesce(s.monthly_salary_sar, 0))
      from public.staff s
     -- FLOOR: the real created_at, never a fabricated 1900-01-01.
     where coalesce(s.hire_date, (s.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 month' - interval '1 day')::date
       and (s.terminated_at is null or s.terminated_at::date >= m.month)
  ), 0::numeric) as staff_salary_sar,
  coalesce((
    select sum(coalesce(d.salary_sar, 0))
      from public.drivers d
     where coalesce(d.hire_date, (d.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 month' - interval '1 day')::date
       and (d.terminated_at is null or d.terminated_at::date >= m.month)
  ), 0::numeric) as driver_salary_sar,
  -- UNCHANGED. Counts people with no salary recorded; carries no hire_date
  -- predicate, deliberately left as it was.
  ((select count(*) from public.staff s
     where s.monthly_salary_sar is null
       and (s.terminated_at is null or s.terminated_at::date >= m.month))
   + (select count(*) from public.drivers d
       where d.salary_sar is null
         and (d.terminated_at is null or d.terminated_at::date >= m.month))
  ) as people_missing_salary,
  -- UNCHANGED. Still true: salaries have no history, so a past period is costed
  -- at each person's CURRENT salary. Deferred item, not this file's problem.
  true as salary_is_current_snapshot
from public.v_report_months m;

comment on view public.v_payroll_monthly is
  'Monthly payroll cost. A person counts from the first month there is any '
  'basis to bill them — their hire_date, or failing that the date their record '
  'was created (0117) — and stops at terminated_at. It NEVER assumes a missing '
  'hire date means 1900-01-01, which billed six people for months before their '
  'records existed and overstated June 2026 by 11,000.00. The created_at floor '
  'asserts no hire date; it asserts only that nothing earlier is defensible. '
  'salary_is_current_snapshot is still true — a past month is costed at each '
  'person''s CURRENT salary, which is the separate deferred effective-dated '
  'salary item.';

-- SECURITY — restated after the create. `create or replace view` does not
-- preserve reloptions, and this view WAS security_invoker (verified before
-- drafting); without this it silently reverts to owner-run and bypasses RLS.
alter view public.v_payroll_monthly set (security_invoker = true);
revoke all on public.v_payroll_monthly from anon;
grant select on public.v_payroll_monthly to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. The view was REPLACED, so it lost its reloptions and
--    depends entirely on the footer above:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.v_payroll_monthly','select') as anon,
--             has_table_privilege('authenticated','public.v_payroll_monthly','select') as auth
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_payroll_monthly';
--      -- expect {security_invoker=true}, anon false, auth true.
--
-- B) COLUMN LIST UNCHANGED — this is a predicate fix, not a reshape:
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_payroll_monthly'
--       order by ordinal_position;
--      -- expect exactly: 1 month, 2 staff_salary_sar, 3 driver_salary_sar,
--      -- 4 people_missing_salary, 5 salary_is_current_snapshot.
--
-- C) THE CORRECTION, EXACTLY. Expect these figures and no others:
--      select to_char(month,'YYYY-MM') m, staff_salary_sar, driver_salary_sar,
--             staff_salary_sar + driver_salary_sar as payroll
--        from public.v_payroll_monthly order by month;
--      -- expect 2026-06  10,600.00 / 14,400.00 / 25,000.00   (was 36,000.00)
--      --        2026-07  16,900.00 / 20,900.00 / 37,800.00   (unchanged)
--      --        2026-08  16,900.00 / 14,400.00 / 31,300.00   (unchanged)
--
-- D) NO CORRECTLY-DATED PERSON LOST THEIR SALARY. This is the check that
--    matters most — the failure mode of this fix is dropping someone real.
--    Expect 0 rows:
--      select m.month, p.name, p.hire_date
--        from public.v_report_months m
--        cross join lateral (
--          select s.name, s.hire_date, s.terminated_at, s.monthly_salary_sar as sal
--            from public.staff s where s.hire_date is not null
--          union all
--          select d.name, d.hire_date, d.terminated_at, d.salary_sar
--            from public.drivers d where d.hire_date is not null
--        ) p
--       where p.sal is not null
--         and p.hire_date <= (m.month + interval '1 month' - interval '1 day')::date
--         and (p.terminated_at is null or p.terminated_at::date >= m.month)
--         -- ...and yet they are not represented in the month's total:
--         and not exists (
--           select 1 from public.v_payroll_monthly v
--            where v.month = m.month
--              and v.staff_salary_sar + v.driver_salary_sar > 0
--         );
--      -- Anyone with a REAL hire_date must be completely unaffected by this
--      -- migration; only the six NULL-hire rows change behaviour.
--
-- E) ONLY THE NULL-HIRE PEOPLE MOVED. Reconcile the difference to the penny:
--      select m.month,
--             coalesce(sum(x.sal),0) as excluded_now
--        from public.v_report_months m
--        cross join lateral (
--          select s.monthly_salary_sar as sal, s.hire_date, s.created_at, s.terminated_at
--            from public.staff s where s.hire_date is null
--          union all
--          select d.salary_sar, d.hire_date, d.created_at, d.terminated_at
--            from public.drivers d where d.hire_date is null
--        ) x
--       where x.sal is not null
--         and (x.created_at at time zone 'Asia/Riyadh')::date
--               > (m.month + interval '1 month' - interval '1 day')::date
--         and (x.terminated_at is null or x.terminated_at::date >= m.month)
--       group by m.month order by m.month;
--      -- expect 2026-06 = 11,000.00 (4,500 staff + 6,500 drivers), and
--      --        2026-07 = 0.00, 2026-08 = 0.00.
--      -- That 11,000.00 must equal exactly the June drop in block C.
--
-- F) THE P&L PICKED IT UP, and nothing else in it moved:
--      select to_char(month,'YYYY-MM') m, revenue_sar, parts_cost_sar, os_cost_sar,
--             payroll_sar, commissions_sar, filling_cost_sar, operating_cost_sar,
--             net_profit_sar, operating_margin_pct
--        from public.v_pnl_monthly order by month;
--      -- expect June: payroll 25,000.00, operating_cost 25,598.00,
--      --              net_profit -25,598.00, margin still NULL (no revenue).
--      -- expect July and August IDENTICAL to their pre-apply values:
--      --   Jul opcost 57,443.9700 / net 206.0300 / margin 18.7
--      --   Aug opcost 59,900.0200 / net -59,900.0200 / margin NULL
--      -- Revenue, parts, outsourced, commissions and filling must not move in
--      -- ANY month. If one does, this file did more than it claims.
--
-- G) THE PAYSLIP SURFACE IS UNAFFECTED. 0115/0116 read their own view, not this
--    one — a payslip's salary comes from v_driver_payslip_basis and an issued
--    slip is frozen regardless:
--      select payslip_number, base_salary_sar, net_sar from public.driver_payslips;
--      -- expect PS-2026-000001 unchanged, whatever it was before.
--
-- H) IT DEGRADES TO NOTHING ONCE THE DATA IS FIXED. After Turki fills in a real
--    hire_date for any of the six, that person's floor becomes their hire_date
--    and this branch stops applying to them:
--      select count(*) as still_relying_on_created_at
--        from (select hire_date from public.staff where monthly_salary_sar is not null
--              union all
--              select hire_date from public.drivers where salary_sar is not null) x
--       where hire_date is null;
--      -- 6 today. When this reaches 0 the COALESCE is dead code that costs
--      -- nothing and can stay as a guard against the next missing date.
-- ===========================================================================
