-- 0100_pnl_by_period.sql
--
-- Period roll-ups for the P&L: month, quarter and year from ONE view.
--
-- ===========================================================================
-- THIS FILE HAS BEEN RECONCILED TO WHAT IS ACTUALLY APPLIED
-- ===========================================================================
-- The version that ran differs from the version originally drafted here. This
-- file was rewritten to match the live database, verified against
-- pg_get_viewdef for both views and against report_metrics for the dictionary,
-- so that reading this file tells you the truth about the database.
--
-- FOUR differences, recorded rather than quietly absorbed:
--
--  1) STRUCTURE. Drafted as one CROSS JOIN over a grain list with a single
--     sum list; applied as three UNION ALL branches. The output is equivalent.
--     The cost is that the ten-column sum list now appears three times, so an
--     edit to how a P&L line aggregates has to be made in three places and
--     will be made in two. Noted as a maintenance hazard, not a defect.
--
--  2) months_in_period WAS DROPPED. The draft carried a count of contributing
--     months so the UI could mark a partial quarter or year. The applied view
--     has 14 columns and no such column. The Reports UI therefore marks a
--     period as in-progress by comparing period_end to today, which is honest
--     presentation logic over dates rather than a metric, and needs no schema.
--
--  3) THE DICTIONARY WAS AMENDED DIFFERENTLY, and this one has a live
--     consequence — see the section at the bottom of this file.
--
--  4) The 42803 that failed the first apply ("column must appear in the GROUP
--     BY clause") came from the UNION rewrite, not from the draft: in a UNION
--     branch the label is built from raw p.month sitting beside aggregates,
--     whereas the drafted form selected it from an already-grouped CTE column.
--     The fix carried into this file is the applied one — derive the label
--     from the same date_trunc expression that the branch groups by.
--
-- ===========================================================================
-- WHY THIS IS A MIGRATION AND NOT TYPESCRIPT
-- ===========================================================================
-- Additive measures (revenue, each cost bucket, profit) sum across months
-- correctly. RATIOS DO NOT. Averaging monthly margins is not the period's
-- margin, and on live data it does not merely drift — it flips the sign:
--
--   Q3-to-date (Jul + Aug 2026)
--     revenue         70,650.00
--     operating cost  97,971.47
--     profit         -27,321.47
--     TRUE margin       -38.7%
--
--     averaging the monthly margins (20.5%, null, null) -> +20.5%
--
-- A 59-point error pointing the wrong way. So the margin is recomputed from
-- the period's OWN revenue, in SQL, defined once.
--
-- ===========================================================================
-- BUILT ON THE MONTHLY VIEWS, NOT ON RAW TABLES
-- ===========================================================================
-- Both roll-ups read v_pnl_monthly / v_expenses_by_category and nothing else.
-- The monthly layer stays the single source and these views INHERIT its
-- correctness rather than re-implementing it. A bug in the monthly layer
-- propagates here too — the correct trade, since one wrong number everywhere
-- beats two different numbers in two places.
--
-- The month branch passes operating_margin_pct straight through instead of
-- recomputing it. For a single month the recomputation is the same arithmetic
-- on the same inputs, so this cannot disagree with v_pnl_monthly; it is
-- equal BY CONSTRUCTION rather than by coincidence.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - Two NEW views. No existing view, table, column, policy or row altered.
--  - One NEW dictionary row. No existing dictionary row is modified.
--  - security_invoker = true on both, SELECT to authenticated, revoked anon.
--    Verified live: both true, anon false, authenticated true.
--  - Read-only derivations. Nothing on the Reports page writes through these.

begin;

-- ===========================================================================
-- 1) THE P&L AT EVERY GRAIN
-- ===========================================================================
create or replace view public.v_pnl_by_period
with (security_invoker = true) as
  -- MONTH: a pass-through. Equal to v_pnl_monthly by construction.
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
         p.operating_margin_pct
    from public.v_pnl_monthly p

  union all

  -- QUARTER. The label is derived from the SAME date_trunc the branch groups
  -- by — referencing p.month raw here is what raised 42803 on the first apply.
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
         -- RECOMPUTED, never averaged. Null when the period earned nothing,
         -- matching the monthly view's convention: a margin on no revenue is
         -- not a number, and 0.0% would be a lie rather than a gap.
         case when sum(p.revenue_sar) > 0
              then round(sum(p.operating_profit_sar) / sum(p.revenue_sar) * 100, 1)
         end
    from public.v_pnl_monthly p
   group by date_trunc('quarter', p.month)

  union all

  -- YEAR.
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
              then round(sum(p.operating_profit_sar) / sum(p.revenue_sar) * 100, 1)
         end
    from public.v_pnl_monthly p
   group by date_trunc('year', p.month);

-- ===========================================================================
-- 2) EXPENSES BY CATEGORY, SAME GRAINS
-- ===========================================================================
-- No month spine behind this one — v_expenses_by_category groups real rows, so
-- a category with no spend in a period is absent rather than present at zero.
-- That is the right shape for a statement section listing what was spent.
create or replace view public.v_expenses_by_category_period
with (security_invoker = true) as
  select 'month'::text as period_type,
         e.month as period_start,
         (e.month + interval '1 month' - interval '1 day')::date as period_end,
         to_char(e.month, 'Mon YYYY') as label,
         e.category,
         e.expenses_sar,
         e.entry_count
    from public.v_expenses_by_category e

  union all

  select 'quarter'::text,
         date_trunc('quarter', e.month)::date,
         (date_trunc('quarter', e.month) + interval '3 months' - interval '1 day')::date,
         'Q' || to_char(date_trunc('quarter', e.month), 'Q YYYY'),
         e.category,
         sum(e.expenses_sar),
         sum(e.entry_count)
    from public.v_expenses_by_category e
   group by date_trunc('quarter', e.month), e.category

  union all

  select 'year'::text,
         date_trunc('year', e.month)::date,
         (date_trunc('year', e.month) + interval '1 year' - interval '1 day')::date,
         to_char(date_trunc('year', e.month), 'YYYY'),
         e.category,
         sum(e.expenses_sar),
         sum(e.entry_count)
    from public.v_expenses_by_category e
   group by date_trunc('year', e.month), e.category;

-- ===========================================================================
-- 3) GRANTS — same gate as 0098.
-- ===========================================================================
grant select on public.v_pnl_by_period, public.v_expenses_by_category_period
to authenticated;

revoke all on public.v_pnl_by_period, public.v_expenses_by_category_period
from anon;

-- ===========================================================================
-- 4) DICTIONARY — one new entry.
-- ===========================================================================
-- The applied approach adds a single entry describing the period view, rather
-- than amending the ten existing P&L metric entries in place.
--
-- KNOWN CONSEQUENCE, recorded here because it is the kind of thing that rots
-- silently: the entries for revenue, operating_cost, operating_profit,
-- net_profit, operating_margin, expenses and the four cost buckets still read
-- grain "one month" and name only their monthly view. That is now incomplete —
-- each of those metrics IS available per quarter and per year through
-- v_pnl_by_period, and a reader (or an agent) trusting the dictionary alone
-- would conclude otherwise. The non-averaging warning does survive, on the
-- pnl_by_period entry below, so the dangerous mistake is still documented;
-- what is missing is the pointer from each metric to its period view.
-- Closing that gap is a dictionary-only follow-up, no view changes needed.
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat)
values
  ('pnl_by_period',
   'P&L by period',
   'The monthly P&L rolled up to month, quarter or year — one shape, three grains.',
   'Sums of the monthly P&L columns per period; operating margin recomputed from the period''s own totals (operating_profit / revenue x 100), null when the period has no revenue.',
   'SAR',
   'one period (month, quarter or year)',
   'v_pnl_by_period',
   'accrual',
   'Amounts add across months; RATIOS do not. The margin here is always recomputed from the period''s own totals — averaging monthly margins would be wrong (a quarter can be loss-making while its only revenue month shows a positive margin).')
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — all of these were run against the live database.
-- ===========================================================================
-- 1) security_invoker on BOTH new views, and anon locked out:
--      select c.relname,
--             coalesce((select option_value from pg_options_to_table(c.reloptions)
--                        where option_name = 'security_invoker'), 'false') as security_invoker,
--             has_table_privilege('anon', c.oid, 'select') as anon_can_read,
--             has_table_privilege('authenticated', c.oid, 'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname in ('v_pnl_by_period','v_expenses_by_category_period');
--    PASSED: both security_invoker true, anon false, authenticated true.
--
-- 2) THE MONTH GRAIN MUST REPRODUCE v_pnl_monthly EXACTLY. The strongest check
--    here: if the roll-up is right, rolling up by month changes nothing.
--      select count(*) from public.v_pnl_by_period p
--        join public.v_pnl_monthly m on m.month = p.period_start
--       where p.period_type = 'month'
--         and (p.revenue_sar          is distinct from m.revenue_sar
--           or p.parts_cost_sar       is distinct from m.parts_cost_sar
--           or p.os_cost_sar          is distinct from m.os_cost_sar
--           or p.payroll_sar          is distinct from m.payroll_sar
--           or p.commissions_sar      is distinct from m.commissions_sar
--           or p.operating_cost_sar   is distinct from m.operating_cost_sar
--           or p.operating_profit_sar is distinct from m.operating_profit_sar
--           or p.expenses_sar         is distinct from m.expenses_sar
--           or p.net_profit_sar       is distinct from m.net_profit_sar
--           or p.operating_margin_pct is distinct from m.operating_margin_pct);
--    PASSED: 0 rows. Note `is distinct from`, not `<>` — a null margin on both
--    sides must count as equal, which `<>` would not.
--
-- 3) THE CASE THAT JUSTIFIED THIS FILE:
--      select label, revenue_sar, operating_profit_sar, operating_margin_pct
--        from public.v_pnl_by_period where period_type = 'quarter' order by period_start;
--    PASSED: Q3 2026 = 70,650.00 revenue, -27,321.47 profit, -38.7 margin.
--    NOT the +20.5% that averaging the months would have produced.
--
-- 4) EVERY GRAIN FOOTS TO THE SAME TOTAL:
--      select period_type, sum(revenue_sar), sum(operating_cost_sar), sum(net_profit_sar)
--        from public.v_pnl_by_period group by period_type;
--    PASSED: all three grains identical, revenue 70,650.00 each.
--
-- 5) MARGIN IS NULL, NOT ZERO, WHERE REVENUE IS ZERO:
--      select count(*) from public.v_pnl_by_period
--       where revenue_sar = 0 and operating_margin_pct is not null;
--    PASSED: 0 rows.
--
-- 6) PERIOD BOUNDS, no off-by-one:
--      select distinct period_type, period_start, period_end
--        from public.v_pnl_by_period order by period_type, period_start;
--    PASSED: month 2026-07-01 -> 2026-07-31; quarter 2026-07-01 -> 2026-09-30;
--    year 2026-01-01 -> 2026-12-31.
--
-- 7) LABELS read as intended at each grain:
--      select distinct period_type, label from public.v_pnl_by_period order by 1, 2;
--    "Jul 2026" / "Q3 2026" / "2026".
--
-- 8) EXPENSES VIEW IS EMPTY BUT VALID (expenses has 0 rows today):
--      select count(*) from public.v_expenses_by_category_period;   -- 0
--    After inserting one expense it must appear at all THREE grains, same
--    amount, three labels.
--
-- 9) DICTIONARY:
--      select count(*) from public.report_metrics;                  -- 22
--      select metric_key, grain from public.report_metrics
--       where metric_key = 'pnl_by_period';
--
-- 10) NOTHING WAS WRITTEN. FIFO invariant untouched:
--      select p.id from public.parts p
--       left join public.price_lots pl on pl.part_id = p.id
--       group by p.id, p.qty_on_hand
--      having p.qty_on_hand is distinct from coalesce(sum(pl.qty_remaining), 0);
--    PASSED: 0 rows.
