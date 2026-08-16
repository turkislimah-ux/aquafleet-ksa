-- 0127_payslip_basis_effective_salary.sql
-- The FOURTH payroll-reading view finally reads effective salary.
-- Closes the gap 0125/0126 deliberately split out.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and applies.
--
-- ===========================================================================
-- WHY THIS WAS SPLIT OUT, AND WHY IT IS SAFE TO DO NOW
-- ===========================================================================
-- 0125 rewired v_payroll_monthly; v_pnl_monthly and v_monthly_only_costs
-- compose on it and inherited the fix for free. v_driver_payslip_basis is the
-- fourth, and it reads drivers.salary_sar DIRECTLY — so it was still costing
-- every month at the driver's CURRENT salary.
--
-- It was split out rather than folded in because create-or-replace must
-- reproduce all EIGHTEEN columns exactly in order and type (42P16), and this is
-- the payslip money path. Transcribing that from a truncated read is how a money
-- view gets quietly corrupted. This file was written against the FULL
-- pg_get_viewdef output; every CTE, join, predicate and column below is carried
-- over VERBATIM except the one CASE branch named in section 2.
--
-- IT IS A NO-OP TODAY, WHICH IS THE POINT OF DOING IT NOW. Every baseline sits
-- at its driver's employment floor and no non-baseline row exists, so the
-- effective salary resolved for any month a driver is counted in equals
-- d.salary_sar exactly. Nothing moves. Applying it while it cannot change a
-- figure is far safer than applying it after the first raise, when it would
-- change several at once and there would be no clean before/after.
--
-- ===========================================================================
-- WHAT CHANGES — one expression
-- ===========================================================================
-- In the `basis` CTE, base_salary_sar's ELSE branch:
--
--   before   ELSE COALESCE(d.salary_sar, 0::numeric)
--   after    ELSE COALESCE(<latest salary_history row for d, effective on or
--                           before that month's end>, 0::numeric)
--
-- That is the SAME resolution 0126 gave v_payroll_monthly — latest row with
-- effective_from <= month end, no fallback, because 0126 dated every baseline at
-- the employment floor. Two views, one rule.
--
-- The two guard branches ABOVE it are untouched: a driver hired after the month
-- ends, or terminated before it starts, still resolves to 0 and never reaches
-- the salary lookup at all.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY NOT CHANGED
-- ===========================================================================
-- · `salary_missing` stays `d.salary_sar IS NULL`. It is the payslip's
--   "this driver has no salary recorded" signal, and the base column remains the
--   current salary of record. A driver with a salary always has a history row
--   (0125's seed, plus the triggers), so the two agree today — and leaving it
--   alone keeps this migration to ONE changed expression, which is what makes
--   the no-op claim checkable.
-- · driver_payslips — ISSUED PAYSLIPS ARE FROZEN. This view feeds the PREVIEW
--   and the issue RPC's input; it never rewrites a slip that already exists.
--   The two issued slips read their own snapshot and cannot move.
-- · The commission half of the view — payouts, specials, adjustments, bonus —
--   verbatim. Commission is out of scope by ruling.
-- · net_sar stays `base + commission + specials + adjustments + bonus`, the
--   single definition 0118 established. It is not re-derived here.
-- ===========================================================================

begin;

create or replace view public.v_driver_payslip_basis as
 WITH months AS (
         SELECT v_report_months.month
           FROM v_report_months
        ), live_drivers AS (
         SELECT d.id,
            d.name,
            d.salary_sar,
            d.hire_date,
            d.terminated_at
           FROM drivers d
        ), matched_payouts AS (
         SELECT p.driver_id,
            date_trunc('month'::text, (p.paid_at AT TIME ZONE 'Asia/Riyadh'::text))::date AS month,
            count(*) AS payout_count,
            sum(p.base_sar) AS base_sar,
            sum(p.specials_sar) AS specials_sar,
            sum(p.adjustments_sar) AS adjustments_sar,
            sum(p.bonus_sar) AS bonus_sar,
            sum(p.total_sar) AS total_sar
           FROM commission_payouts p
          WHERE p.paid_at IS NOT NULL
          GROUP BY p.driver_id, (date_trunc('month'::text, (p.paid_at AT TIME ZONE 'Asia/Riyadh'::text))::date)
        ), basis AS (
         SELECT m.month AS period_start,
            d.id AS driver_id,
            d.name AS driver_name,
                CASE
                    WHEN d.hire_date IS NOT NULL AND d.hire_date > (m.month + '1 mon'::interval - '1 day'::interval)::date THEN 0::numeric
                    WHEN d.terminated_at IS NOT NULL AND (d.terminated_at AT TIME ZONE 'Asia/Riyadh'::text)::date < m.month THEN 0::numeric
                    -- EFFECTIVE salary (0126's rule): the latest history row in
                    -- force on or before this month's end. No fallback — every
                    -- baseline sits at the driver's employment floor.
                    ELSE COALESCE(( SELECT h.salary_sar
                       FROM salary_history h
                      WHERE h.driver_id = d.id
                        AND h.effective_from <= (m.month + '1 mon'::interval - '1 day'::interval)::date
                      ORDER BY h.effective_from DESC
                      LIMIT 1), 0::numeric)
                END AS base_salary_sar,
            d.salary_sar IS NULL AS salary_missing,
            d.hire_date IS NULL AS hire_date_missing,
                CASE
                    WHEN mp.driver_id IS NOT NULL THEN 'paid'::text
                    ELSE 'earned'::text
                END AS commission_basis,
            mp.driver_id IS NOT NULL AS commission_settled,
            COALESCE(mp.payout_count, 0::bigint) AS payout_count,
                CASE
                    WHEN mp.driver_id IS NOT NULL THEN mp.base_sar
                    ELSE COALESCE(( SELECT sum(t.commission_sar) AS sum
                       FROM trips t
                      WHERE t.driver_id = d.id AND t.stage = 'delivered'::text AND t.payout_id IS NULL AND date_trunc('month'::text, t.trip_date::timestamp with time zone)::date = m.month), 0::numeric)
                END AS commission_sar,
                CASE
                    WHEN mp.driver_id IS NOT NULL THEN mp.specials_sar
                    ELSE COALESCE(( SELECT sum(cs.amount_sar) AS sum
                       FROM commission_specials cs
                      WHERE cs.driver_id = d.id AND cs.status = 'approved'::text AND cs.payout_id IS NULL AND cs.month_key = to_char(m.month::timestamp with time zone, 'YYYY-MM'::text)), 0::numeric)
                END AS specials_sar,
                CASE
                    WHEN mp.driver_id IS NOT NULL THEN mp.adjustments_sar
                    ELSE COALESCE(( SELECT sum(ca.amount_sar) AS sum
                       FROM commission_adjustments ca
                      WHERE ca.driver_id = d.id AND ca.status = 'approved'::text AND ca.payout_id IS NULL AND ca.month_key = to_char(m.month::timestamp with time zone, 'YYYY-MM'::text)), 0::numeric)
                END AS adjustments_sar,
                CASE
                    WHEN mp.driver_id IS NOT NULL THEN mp.bonus_sar
                    ELSE COALESCE(( SELECT sum(cp.bonus_sar) AS sum
                       FROM commission_periods cp
                      WHERE cp.driver_id = d.id AND cp.bonus_status = 'approved'::text AND cp.month_key IS NOT NULL AND cp.month_key = to_char(m.month::timestamp with time zone, 'YYYY-MM'::text)), 0::numeric)
                END AS bonus_sar,
            ps.id AS issued_payslip_id,
            ps.payslip_number AS issued_payslip_number,
            d.terminated_at IS NOT NULL AS terminated,
            (d.terminated_at AT TIME ZONE 'Asia/Riyadh'::text)::date AS termination_date
           FROM months m
             CROSS JOIN live_drivers d
             LEFT JOIN matched_payouts mp ON mp.driver_id = d.id AND mp.month = m.month
             LEFT JOIN driver_payslips ps ON ps.driver_id = d.id AND ps.period_start = m.month
          WHERE (d.hire_date IS NULL OR d.hire_date <= (m.month + '1 mon'::interval - '1 day'::interval)::date) AND (d.terminated_at IS NULL OR (d.terminated_at AT TIME ZONE 'Asia/Riyadh'::text)::date >= m.month)
        )
 SELECT period_start,
    driver_id,
    driver_name,
    base_salary_sar,
    salary_missing,
    hire_date_missing,
    commission_basis,
    commission_settled,
    payout_count,
    commission_sar,
    specials_sar,
    adjustments_sar,
    bonus_sar,
    issued_payslip_id,
    issued_payslip_number,
    terminated,
    termination_date,
    base_salary_sar + commission_sar + specials_sar + adjustments_sar + bonus_sar AS net_sar
   FROM basis b;

-- create-or-replace does NOT preserve reloptions (CLAUDE.md section 6).
alter view public.v_driver_payslip_basis set (security_invoker = true);
revoke all on public.v_driver_payslip_basis from anon;
grant select on public.v_driver_payslip_basis to authenticated;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE NO-OP PROOF — the whole safety claim. Capture BEFORE applying and
--    compare after; it must be byte-identical for every row:
--      select period_start, driver_id, base_salary_sar, commission_sar, net_sar
--        from public.v_driver_payslip_basis
--       order by period_start, driver_id;
--
--    Or as one number, easier to diff:
--      select count(*) as rows,
--             sum(base_salary_sar) as base_total,
--             sum(net_sar)         as net_total,
--             md5(string_agg(period_start::text||':'||driver_id::text||':'
--                            ||base_salary_sar::text||':'||net_sar::text,
--                            ',' order by period_start, driver_id)) as fingerprint
--        from public.v_driver_payslip_basis;
--      -- The fingerprint MUST be identical before and after. Any change means
--      -- the effective-salary resolution disagrees with d.salary_sar somewhere,
--      -- which today it cannot — investigate before accepting.
--
-- B) THE TWO ISSUED PAYSLIPS NEVER MOVED. They read their own snapshot, not this
--    view, but prove it rather than asserting it:
--      select payslip_number, base_salary_sar, commission_sar, net_sar,
--             md5(row(payslip_number, period_start, base_salary_sar, commission_sar,
--                     specials_sar, adjustments_sar, bonus_sar, deductions_sar, net_sar)::text) as row_hash
--        from public.driver_payslips order by payslip_number;
--      -- PS-2026-000001  1,300.00 / 204.00 / 1,504.00  4c98509b50f2599dc65c797760d26aaa
--      -- PS-2026-000002  1,300.00 / 217.02 / 1,517.02  e27bcb32b466660a4b5265878325e42c
--
-- C) THE VIEW SHAPE IS UNCHANGED — 18 columns, same order and types:
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_driver_payslip_basis'
--       order by ordinal_position;
--      -- period_start, driver_id, driver_name, base_salary_sar, salary_missing,
--      -- hire_date_missing, commission_basis, commission_settled, payout_count,
--      -- commission_sar, specials_sar, adjustments_sar, bonus_sar,
--      -- issued_payslip_id, issued_payslip_number, terminated, termination_date,
--      -- net_sar
--
-- D) ALL FOUR PAYROLL-READING VIEWS NOW AGREE ON THE RULE. Expect 0 rows —
--    v_payroll_monthly's driver total must equal the sum of this view's
--    base_salary_sar for the same month:
--      select p.month, p.driver_salary_sar, b.basis_total
--        from public.v_payroll_monthly p
--        join (select period_start, sum(base_salary_sar) as basis_total
--                from public.v_driver_payslip_basis group by period_start) b
--          on b.period_start = p.month
--       where p.driver_salary_sar is distinct from b.basis_total;
--      -- NOTE: this may legitimately differ if a driver is excluded by one
--      -- view's window and not the other's — check the row rather than assuming
--      -- a defect. It is a consistency probe, not a hard invariant.
--
-- E) SECURITY FOOTER RESTATED:
--      select c.reloptions,
--             has_table_privilege('anon', c.oid,'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid,'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='v_driver_payslip_basis';
--      -- {security_invoker=true}, anon FALSE, authenticated TRUE.
--
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relkind='v';
--      -- expect 40 / 40 / 0 — this migration adds no view.
-- ===========================================================================
