-- 0123_dictionary_period_pointers.sql
-- Close 0100's known dictionary gap: point the ten P&L metrics at their period
-- view. DICTIONARY TEXT ONLY — no view, no RPC, no measure changes.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and applies.
--
-- ===========================================================================
-- 0100 WROTE DOWN ITS OWN FOLLOW-UP AND THIS IS IT
-- ===========================================================================
-- 0100 section 4, verbatim: "the entries for revenue, operating_cost,
-- operating_profit, net_profit, operating_margin, expenses and the four cost
-- buckets still read grain 'one month' and name only their monthly view. That
-- is now incomplete — each of those metrics IS available per quarter and per
-- year through v_pnl_by_period, and a reader (or an agent) trusting the
-- dictionary alone would conclude otherwise... what is missing is the pointer
-- from each metric to its period view. Closing that gap is a dictionary-only
-- follow-up, no view changes needed."
--
-- The count was re-checked rather than trusted: v_pnl_by_period exposes exactly
-- the same twelve measure columns as v_pnl_monthly, and mapping them to
-- dictionary keys gives TEN. 0100's list is correct.
--
-- ===========================================================================
-- THE POINTER IS ONLY WORTH ADDING IF IT IS TRUE — PROVEN BEFORE DRAFTING
-- ===========================================================================
-- Telling a reader "this metric is also in v_pnl_by_period" is a claim about
-- agreement. Checked on live data, all 3 months:
--
--   · v_pnl_by_period at MONTH grain reproduces v_pnl_monthly across all ten
--     measure columns: 3 month rows, 0 mismatched (IS DISTINCT FROM on every
--     column, so NULLs count as differences).
--   · Four sources map DIRECTLY:  v_revenue_monthly.revenue_sar,
--     v_parts_cost_monthly.parts_cost_sar, v_os_cost_monthly.os_cost_sar,
--     v_expenses_monthly.expenses_sar — each identical to its P&L column.
--   · TWO ARE COMPOSED, and that is why this is not a find-and-replace:
--       v_payroll_monthly      staff_salary_sar + driver_salary_sar = payroll_sar
--       v_commissions_monthly  trip_commission + specials + adjustments + bonus
--                              = commissions_sar
--     Both verified equal on all 3 months. The period view carries only the
--     COMBINED total, so pointing these two at it without saying the breakdown
--     is lost would mislead exactly the reader this gap exists to serve. Their
--     source_view text says so.
--
-- ===========================================================================
-- THE RATIO IS THE DANGEROUS ONE
-- ===========================================================================
-- operating_margin is a PERCENT, and giving it a quarter/year grain without a
-- warning would invite the error 0100 was written to prevent. 0100's own proof:
-- Q3-to-date margin is -38.7% computed from the period's own totals and +20.5%
-- if the monthly margins are averaged — IT FLIPS THE SIGN.
--
-- v_pnl_by_period recomputes the ratio per period rather than averaging, so the
-- figure is right; the risk is a reader doing their own arithmetic. Its caveat
-- gains that warning explicitly. The eight SAR measures are additive and need
-- no such note; filling_uncosted_trips is a count and is not one of the ten.
--
-- ===========================================================================
-- WHY THIS IS BEHAVIOURALLY INERT
-- ===========================================================================
-- `grain` and `source_view` are DISPLAY STRINGS. app/reports/page.tsx reads them
-- through String() into MetricDictionaryRow (lib/reports.ts) and renders them;
-- nothing parses either field, and no code branches on their contents — checked
-- by grep across app/ and lib/, whose only hits are that one coercion and the
-- type declaration.
--
-- THE FENCE IS `metric_key`, WHICH THIS FILE DOES NOT TOUCH. lib/report-builder
-- offers a block only if its key is live here, and lib/dashboard-widgets does the
-- same for Add Summary, re-checked server-side. No key is added, removed or
-- renamed, so both surfaces offer EXACTLY the same set before and after.
--
-- Idempotent by construction: ten UPDATEs keyed by metric_key, each setting a
-- final literal. Re-running changes nothing.
--
-- ===========================================================================
-- A SEPARATE GAP FOUND WHILE DOING THIS — FLAGGED, NOT FIXED HERE
-- ===========================================================================
-- There is NO dictionary entry for filling cost at all, even though
-- v_pnl_monthly and v_pnl_by_period have both carried filling_cost_sar and
-- filling_uncosted_trips since 0112/0113, and filling is a real P&L bucket (the
-- cost-mix doughnut's fifth slice). So the dictionary describes four of the five
-- operational cost buckets.
--
-- That is a 0112/0113 gap, not 0100's, and adding a metric_key is a semantic-
-- layer statement that deserves its own decision — it would also make filling
-- eligible for the report builder the moment BUILDER_METRICS names it. Left for
-- the architect to call separately rather than folded in here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) The four measures whose monthly source maps DIRECTLY to a P&L column.
-- ---------------------------------------------------------------------
update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_revenue_monthly (month) · v_pnl_by_period.revenue_sar (month, quarter or year)'
where metric_key = 'revenue';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_parts_cost_monthly (month) · v_pnl_by_period.parts_cost_sar (month, quarter or year)'
where metric_key = 'parts_cost_at_consumption';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_os_cost_monthly (month) · v_pnl_by_period.os_cost_sar (month, quarter or year)'
where metric_key = 'os_cost';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_expenses_monthly (month) · v_pnl_by_period.expenses_sar (month, quarter or year)'
where metric_key = 'expenses';

-- ---------------------------------------------------------------------
-- 2) The two that are COMPOSED in the P&L — the period view carries the
--    combined total only, and the text says so.
-- ---------------------------------------------------------------------
update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_payroll_monthly (month; staff and driver salary split out) · '
                || 'v_pnl_by_period.payroll_sar (month, quarter or year; combined total only)'
where metric_key = 'payroll_cost';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_commissions_monthly (month; trip commission, specials, adjustments and bonus '
                || 'split out) · v_pnl_by_period.commissions_sar (month, quarter or year; combined total only)'
where metric_key = 'commissions_cost';

-- ---------------------------------------------------------------------
-- 3) The three P&L totals already sourced from v_pnl_monthly.
-- ---------------------------------------------------------------------
update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_pnl_monthly (month) · v_pnl_by_period.operating_cost_sar (month, quarter or year)'
where metric_key = 'operating_cost';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_pnl_monthly (month) · v_pnl_by_period.operating_profit_sar (month, quarter or year)'
where metric_key = 'operating_profit';

update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_pnl_monthly (month) · v_pnl_by_period.net_profit_sar (month, quarter or year)'
where metric_key = 'net_profit';

-- ---------------------------------------------------------------------
-- 4) THE RATIO. Grain widens like the rest, but the caveat gains the
--    non-averaging warning — this is the one entry where a wider grain is
--    an invitation to compute it wrongly.
-- ---------------------------------------------------------------------
update public.report_metrics set
  grain = 'one month, quarter or year',
  source_view = 'v_pnl_monthly (month) · v_pnl_by_period.operating_margin_pct (month, quarter or year)',
  caveat = 'Null rather than zero in a month with no revenue — a margin on nothing is not a '
           || 'number. RATIOS DO NOT ADD OR AVERAGE ACROSS PERIODS: a quarter''s margin must be '
           || 'recomputed from that quarter''s own totals, which is what v_pnl_by_period does. '
           || 'Averaging the three monthly margins for Q3-to-date gives +20.5% where the correct '
           || 'figure is -38.7% — it flips the sign, not just the value.'
where metric_key = 'operating_margin';

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) ALL TEN NOW CARRY THE PERIOD GRAIN. Expect 10 rows, every one naming
--    v_pnl_by_period:
--      select metric_key, grain, source_view
--        from public.report_metrics
--       where grain = 'one month, quarter or year'
--       order by metric_key;
--      -- expect exactly: commissions_cost, expenses, net_profit, operating_cost,
--      -- operating_margin, operating_profit, os_cost, parts_cost_at_consumption,
--      -- payroll_cost, revenue.
--
-- B) NOTHING ELSE MOVED. The dictionary is 29 rows and no key changed:
--      select count(*) as metrics from public.report_metrics;
--      -- expect 29.
--
--      select metric_key from public.report_metrics
--       where grain = 'one month' order by metric_key;
--      -- 16 rows read 'one month' BEFORE; expect exactly SIX after:
--      --   collections, commissions_paid, monthly_only_cost, operations,
--      --   purchasing_spend, topups
--      -- None of those six is in v_pnl_by_period, so "one month" is CORRECT for
--      -- them and widening it would be a lie, not a completion. 16 - 10 = 6 is
--      -- also the arithmetic proof that this file touched ten rows and no more.
--
-- C) THE RATIO WARNING LANDED. Expect true:
--      select caveat ilike '%flips the sign%' as has_warning
--        from public.report_metrics where metric_key = 'operating_margin';
--
-- D) THE FENCE IS UNCHANGED — the check that this cannot alter behaviour.
--      select md5(string_agg(metric_key, ',' order by metric_key)) as key_fingerprint
--        from public.report_metrics;
--      -- Captured at drafting: b3bbb25d7b3d5e59e18dcf83a79b4f51
--      -- It must be IDENTICAL after applying:
--      -- lib/report-builder and lib/dashboard-widgets fence on metric_key, so an
--      -- unchanged key set proves the builder and Add Summary offer exactly the
--      -- same blocks as before.
--
-- E) THE CLAIM THE POINTERS MAKE IS STILL TRUE. Re-run the reconciliation the
--    header rests on — expect 3 rows, 0 mismatched:
--      select count(*) as month_rows,
--             count(*) filter (where m.revenue_sar is distinct from p.revenue_sar
--                                or m.parts_cost_sar is distinct from p.parts_cost_sar
--                                or m.os_cost_sar is distinct from p.os_cost_sar
--                                or m.payroll_sar is distinct from p.payroll_sar
--                                or m.commissions_sar is distinct from p.commissions_sar
--                                or m.operating_cost_sar is distinct from p.operating_cost_sar
--                                or m.operating_profit_sar is distinct from p.operating_profit_sar
--                                or m.expenses_sar is distinct from p.expenses_sar
--                                or m.net_profit_sar is distinct from p.net_profit_sar
--                                or m.operating_margin_pct is distinct from p.operating_margin_pct)
--               as mismatched
--        from public.v_pnl_monthly m
--        join public.v_pnl_by_period p
--          on p.period_type = 'month' and p.period_start = m.month;
--
-- F) THE APP STILL RENDERS. Dictionary text is display-only, so the risk is
--    layout rather than logic. In the browser, signed in:
--      · /reports -> Overview -> the metrics dictionary — the ten rows show the
--        wider grain and the two-source pointer. The composed pair (payroll_cost,
--        commissions_cost) say "combined total only"; operating_margin shows the
--        sign-flip warning. Check the longer source_view strings still wrap
--        rather than overflow their cell.
--      · /reports -> custom report builder — offers the SAME metric blocks as
--        before (fenced on metric_key, which this file does not touch).
--      · / (Dashboard) -> Add Summary — same, for the same reason.
-- ===========================================================================
