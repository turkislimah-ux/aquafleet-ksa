-- 0113_pnl_by_period_filling_bucket.sql
-- Expose the filling bucket on the quarter/year P&L, so its costs add up.
--
-- ===========================================================================
-- THIS CHANGES NO FIGURE. IT ADDS THE COLUMN THAT EXPLAINS ONE.
-- ===========================================================================
-- v_pnl_by_period already SUMS p.operating_cost_sar from v_pnl_monthly rather
-- than re-deriving it from the buckets, so when 0112 added filling to
-- operating cost this view picked it up automatically. Its operating cost,
-- operating profit, net profit and margins have been CORRECT since 0112.
--
-- What it does not do is show WHY. It exposes only the four original bucket
-- columns, so inside the view:
--
--     parts + outsourced + payroll + commissions  <  operating_cost_sar
--
-- and the difference is unexplained. Live, that gap is exactly the period's
-- filling cost:
--
--     month   Jun 2026      210.00
--     month   Jul 2026    1,285.00
--     month   Aug 2026    4,390.00
--     quarter Q2 2026      210.00
--     quarter Q3 2026    5,675.00
--     year    2026       5,885.00
--
-- A reader of the quarterly P&L would see costs that do not foot. This adds
-- filling_cost_sar so they do, and filling_uncosted_trips so the "cost unknown"
-- count travels at this grain too.
--
-- NOTHING ELSE MOVES. Every existing column keeps its name, position, type and
-- VALUE. Verified in the block below by comparing against a pre-apply capture.
--
-- ===========================================================================
-- APPEND-ONLY, AND WHY EVEN THOUGH NOTHING DEPENDS ON THIS VIEW
-- ===========================================================================
-- Checked via pg_depend rather than assumed: v_pnl_by_period has NO dependent
-- views. A drop-and-recreate would therefore have been safe here.
--
-- It is still `create or replace` with the new columns APPENDED, for two
-- reasons. First, 42P16 just cost an apply cycle on 0112 — the habit is worth
-- more than the one-off convenience. Second, "nothing depends on it today" is
-- a fact with a shelf life; a drop leaves a window where the view does not
-- exist, and the next person to add a dependent will not think to re-check
-- this file. Append-only has no such window and no such assumption.
--
-- Existing order preserved exactly (1-14): period_type, period_start,
-- period_end, label, revenue_sar, parts_cost_sar, os_cost_sar, payroll_sar,
-- commissions_sar, operating_cost_sar, operating_profit_sar, expenses_sar,
-- net_profit_sar, operating_margin_pct.
-- Appended: 15 filling_cost_sar, 16 filling_uncosted_trips.
--
-- ===========================================================================
-- THE UNCOSTED COUNT IS SUMMED, AND THAT IS CORRECT HERE
-- ===========================================================================
-- filling_uncosted_trips is a COUNT OF TRIPS, not a state, so unlike
-- people_missing_salary or trucks_active (0098's two non-additive measures) it
-- IS additive across months: a trip uncosted in June and a different trip
-- uncosted in July are two uncosted trips in Q2/Q3 combined. Summing is the
-- right operation, and the year row reading 13 is the true total rather than a
-- double count.
--
-- Money core untouched. One view replaced, no table, no RPC, no data written.
-- ===========================================================================

begin;

create or replace view public.v_pnl_by_period
with (security_invoker = true) as
   select 'month'::text as period_type,
          p.month as period_start,
          (p.month + interval '1 month' - interval '1 day')::date as period_end,
          to_char(p.month, 'Mon YYYY') as label,
          p.revenue_sar,
          p.parts_cost_sar,
          p.os_cost_sar,
          p.payroll_sar,
          p.commissions_sar,
          p.operating_cost_sar,
          p.operating_profit_sar,
          p.expenses_sar,
          p.net_profit_sar,
          p.operating_margin_pct,
          -- APPENDED (0113). At month grain these are just the monthly values.
          p.filling_cost_sar,
          p.filling_uncosted_trips
     from public.v_pnl_monthly p
   union all
   select 'quarter'::text,
          date_trunc('quarter', p.month)::date,
          (date_trunc('quarter', p.month) + interval '3 months' - interval '1 day')::date,
          'Q' || to_char(date_trunc('quarter', p.month), 'Q YYYY'),
          sum(p.revenue_sar),
          sum(p.parts_cost_sar),
          sum(p.os_cost_sar),
          sum(p.payroll_sar),
          sum(p.commissions_sar),
          sum(p.operating_cost_sar),
          sum(p.operating_profit_sar),
          sum(p.expenses_sar),
          sum(p.net_profit_sar),
          -- Ratios RECOMPUTE from the period's own totals, never averaged
          -- (0100). Unchanged from the existing definition — repeated here
          -- only because create-or-replace restates the whole body.
          case when sum(p.revenue_sar) > 0
               then round(sum(p.operating_profit_sar) / sum(p.revenue_sar) * 100, 1) end,
          -- APPENDED (0113). Additive measures, so summing is correct.
          sum(p.filling_cost_sar),
          sum(p.filling_uncosted_trips)::int
     from public.v_pnl_monthly p
    group by date_trunc('quarter', p.month)
   union all
   select 'year'::text,
          date_trunc('year', p.month)::date,
          (date_trunc('year', p.month) + interval '1 year' - interval '1 day')::date,
          to_char(date_trunc('year', p.month), 'YYYY'),
          sum(p.revenue_sar),
          sum(p.parts_cost_sar),
          sum(p.os_cost_sar),
          sum(p.payroll_sar),
          sum(p.commissions_sar),
          sum(p.operating_cost_sar),
          sum(p.operating_profit_sar),
          sum(p.expenses_sar),
          sum(p.net_profit_sar),
          case when sum(p.revenue_sar) > 0
               then round(sum(p.operating_profit_sar) / sum(p.revenue_sar) * 100, 1) end,
          sum(p.filling_cost_sar),
          sum(p.filling_uncosted_trips)::int
     from public.v_pnl_monthly p
    group by date_trunc('year', p.month);

comment on view public.v_pnl_by_period is
  'The P&L at month, quarter and year grain in one view. Additive measures sum '
  'across months; RATIOS RECOMPUTE from the period''s own totals and are never '
  'averaged (0100 — averaging monthly margins flipped the sign of a real '
  'quarter). operating_cost_sar is summed from v_pnl_monthly, so it has '
  'included filling since 0112; 0113 adds filling_cost_sar so the five buckets '
  'visibly add up to it, and filling_uncosted_trips so the count of fills with '
  'no price for their water type travels at this grain too. Both are appended '
  'at the end because create-or-replace cannot insert a column mid-list '
  '(42P16). filling_uncosted_trips is a trip COUNT and is genuinely additive, '
  'unlike people_missing_salary and trucks_active which are per-month states '
  'and must never be summed.';

-- ---------------------------------------------------------------------
-- SECURITY — restated after the create. `create or replace view` does not
-- preserve reloptions, and this view WAS security_invoker (verified before
-- drafting); without this it silently reverts to owner-run and bypasses RLS
-- on 68 tables.
-- ---------------------------------------------------------------------
alter view public.v_pnl_by_period set (security_invoker = true);
revoke all on public.v_pnl_by_period from anon;
grant select on public.v_pnl_by_period to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. The view was REPLACED, so it lost its reloptions and
--    depends entirely on the footer above:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.v_pnl_by_period','select') as anon
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_pnl_by_period';
--      -- expect {security_invoker=true} and anon = false.
--
-- B) COLUMN ORDER PRESERVED — 1-14 unchanged, 15-16 appended:
--      select ordinal_position, column_name
--        from information_schema.columns
--       where table_schema='public' and table_name='v_pnl_by_period'
--       order by ordinal_position;
--      -- 15 filling_cost_sar, 16 filling_uncosted_trips.
--
-- C) THE GAP IS CLOSED — five buckets equal operating cost at EVERY grain.
--    Expect 0 rows:
--      select period_type, label, operating_cost_sar,
--             parts_cost_sar + os_cost_sar + payroll_sar + commissions_sar
--               + filling_cost_sar as five_buckets
--        from public.v_pnl_by_period
--       where operating_cost_sar <> parts_cost_sar + os_cost_sar + payroll_sar
--                                 + commissions_sar + filling_cost_sar;
--
-- D) NO EXISTING FIGURE MOVED. Capture BEFORE applying:
--      select period_type, period_start, period_end, label, revenue_sar,
--             parts_cost_sar, os_cost_sar, payroll_sar, commissions_sar,
--             operating_cost_sar, operating_profit_sar, expenses_sar,
--             net_profit_sar, operating_margin_pct
--        from public.v_pnl_by_period order by period_type, period_start;
--    then re-run the IDENTICAL query after and diff. Every value must match —
--    this migration adds a column, it does not recompute anything. If a margin
--    or a total moved, the body was transcribed wrong.
--
-- E) THE SAME PERIOD ROWS COME BACK — no row added or lost by the rewrite:
--      select period_type, count(*) from public.v_pnl_by_period group by 1 order by 1;
--      -- expect month 3, quarter 2, year 1 on today's data.
--
-- F) THE NEW COLUMNS ROLL UP CORRECTLY from the monthly view. Expect 0 rows:
--      select b.period_type, b.label, b.filling_cost_sar, x.expected
--        from public.v_pnl_by_period b
--        join lateral (
--          select sum(p.filling_cost_sar) as expected
--            from public.v_pnl_monthly p
--           where p.month between b.period_start and b.period_end
--        ) x on true
--       where b.filling_cost_sar <> x.expected;
--
--    Same for the uncosted count — expect 0 rows:
--      select b.period_type, b.label, b.filling_uncosted_trips, x.expected
--        from public.v_pnl_by_period b
--        join lateral (
--          select sum(p.filling_uncosted_trips)::int as expected
--            from public.v_pnl_monthly p
--           where p.month between b.period_start and b.period_end
--        ) x on true
--       where b.filling_uncosted_trips <> x.expected;
--
-- G) THE EXPECTED VALUES, for eyeballing:
--      select period_type, label, filling_cost_sar, filling_uncosted_trips
--        from public.v_pnl_by_period order by period_type, period_start;
--      -- month  : Jun 210.00/10, Jul 1,285.00/3, Aug 4,390.00/0
--      -- quarter: Q2 210.00/10, Q3 5,675.00/3
--      -- year   : 2026 5,885.00/13
--      -- The year's 13 is the true total of uncosted trips, not a double
--      -- count — these are trip counts, which are additive.
--
-- H) v_pnl_monthly IS UNTOUCHED by this file:
--      select month, operating_cost_sar, filling_cost_sar, operating_margin_pct,
--             net_profit_sar from public.v_pnl_monthly order by month;
--      -- identical to the pre-apply capture; 0113 only reads it.
-- ===========================================================================
