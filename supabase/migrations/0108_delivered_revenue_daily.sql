-- 0108_delivered_revenue_daily.sql
-- DELIVERED (earned) revenue per day — a DASHBOARD-ONLY measure.
--
-- ===========================================================================
-- WHAT THIS IS, AND WHAT IT IS NOT
-- ===========================================================================
-- Billed revenue (v_revenue_monthly, v_pnl_monthly, every Reports statement)
-- is untouched by this file and stays the only revenue the P&L and margins
-- know about. Nothing here is read by Reports.
--
-- This adds a SECOND, differently-timed reading for the Dashboard's daily
-- chart: what the work delivered on a given day was worth, whether or not it
-- has been invoiced yet.
--
--   delivered revenue = for each trip with stage = 'delivered', its PROJECT'S
--                       rate_per_trip_sar, bucketed by the day it was
--                       delivered, in Asia/Riyadh
--
-- WHERE THE PRICE COMES FROM, checked before drafting rather than assumed:
--   · projects.rate_per_trip_sar — 7 of 7 projects priced, range 160.00-420.00
--   · a trip reaches it through trips.project_id
--   · it is NOT trips.rate_sar, which is NULL on every one of the 676 rows
--     (that NULL is the reason the whole Dashboard rebuild happened — the old
--     page summed it and rendered 0 beside Reports' 70,650)
--   · there is no customer-level rate column; the project is the only price
--
-- ===========================================================================
-- THE UNPRICEABLE TRIP IS COUNTED, NEVER GUESSED
-- ===========================================================================
-- 630 of 631 delivered trips are priceable. ONE delivered trip has no
-- project_id and therefore no rate. It contributes 0.00 to the revenue sum and
-- is counted in delivered_trips_unpriced, so the gap is visible on screen
-- instead of being quietly averaged in at some invented price. Live it sits in
-- July, so the gap is real today and not a theoretical branch.
--
-- ===========================================================================
-- TWO TIMEZONE / BUCKETING FACTS THE UI MUST NOT MISREPRESENT
-- ===========================================================================
-- (1) RIYADH MATTERS HERE — 237 of 631 delivered trips (38%) fall on a
--     DIFFERENT day under Asia/Riyadh than under UTC, because delivered_at is
--     a timestamptz and Riyadh is UTC+3. Bucketing in UTC would misplace more
--     than a third of the work. Hence
--     (t.delivered_at at time zone 'Asia/Riyadh')::date, matching
--     CLAUDE.md section 6's todayKey() rule.
--
--     KNOWN AND ACCEPTED CONSEQUENCE: v_daily_operations buckets INVOICED
--     revenue in UTC on purpose — 0104 needs `confirmed_at` to bucket exactly
--     as v_revenue_monthly's date_trunc does, or days would stop summing to
--     the month and the Dashboard would start disagreeing with Reports. So on
--     the chart the two revenue lines use different day boundaries: the
--     invoiced line is anchored to Reports, the delivered line to the real
--     working day. Each is correct for what it measures. This is a genuine
--     difference between the series, NOT an error to "fix" by forcing one of
--     them onto the other's calendar — doing that would either break 0104's
--     roll-up identity or misdate 38% of deliveries.
--
-- (2) THIS VIEW'S TRIP COUNTS ARE BUCKETED BY delivered_at.
--     v_delivery_output_daily (0105) counts delivered trips by trip_date —
--     "which day's schedule did this belong to", a different question from
--     "when was it actually delivered". Live, 545 of 631 delivered trips
--     (86%) fall on a different day under the two rules, largely because
--     deliveries were stamped in bulk well after their nominal trip_date.
--
--     **THE TWO COUNTS WILL NOT MATCH AND ARE NOT SUPPOSED TO.** Do not
--     "reconcile" them, and do not put them side by side as though they
--     answered the same question. The columns here are named
--     delivered_trips_priced / delivered_trips_unpriced rather than
--     trips_delivered precisely so nobody reads them as 0105's measure.
--
-- ===========================================================================
-- WHY A SEPARATE VIEW RATHER THAN A COLUMN ON v_daily_operations
-- ===========================================================================
-- Both were viable. This takes the separate view because v_daily_operations
-- carries proven reconciliations — daily sums against every monthly view, and
-- direct + monthly-only = operating cost — and the brief's own constraint was
-- that adding a column must not disturb them. A new view has ZERO blast radius
-- on those checks, and it mirrors how 0105 was added: its own view on the same
-- spine rather than fattening one.
--
-- THE SPINE IS DELIBERATELY IDENTICAL to v_daily_operations' — same lower
-- bound, same greatest(UTC today, Riyadh today) upper bound — so the two align
-- row for row and the chart can zip them by day without inventing or dropping
-- one. Every delivered day live (2026-06-27 to 2026-08-14) falls inside it.
--
-- Both figures are NET OF VAT: projects.rate_per_trip_sar is the pre-VAT rate
-- (prepaid consumes rate * 1.15 at delivery — lib/prepaid.ts), and billed
-- revenue is grand_subtotal_sar. The two lines are therefore comparable on one
-- axis without a VAT adjustment.
--
-- READ-ONLY BY CONSTRUCTION. One view, one dictionary row. No table, column,
-- constraint, policy, RPC or row is altered. The money core is not written.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) DELIVERED REVENUE, PER DAY.
-- ---------------------------------------------------------------------
create or replace view public.v_delivered_revenue_daily
with (security_invoker = true) as
  with spine as (
    -- Byte-identical to v_daily_operations' spine (0104) so the two views
    -- align row for row. Upper bound is TODAY, never month-end: a chart of
    -- the current month must not render future days as zero-revenue days.
    select generate_series(
             (select min(month) from public.v_report_months),
             greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
             interval '1 day'
           )::date as day
  ),
  delivered as (
    select (t.delivered_at at time zone 'Asia/Riyadh')::date as day,
           -- An unpriceable trip adds 0.00, never a guess. coalesce covers
           -- both a NULL project_id (the left join yields no row) and a
           -- project with no rate on file.
           sum(coalesce(p.rate_per_trip_sar, 0))                        as revenue_sar,
           count(*) filter (where p.rate_per_trip_sar is not null)::int  as priced,
           count(*) filter (where p.rate_per_trip_sar is null)::int      as unpriced
      from public.trips t
      -- LEFT join: a delivered trip with no project must still be COUNTED as
      -- unpriced. An inner join would silently drop it and the gap would
      -- vanish from the figure it is supposed to qualify.
      left join public.projects p on p.id = t.project_id
     where t.stage = 'delivered'
       and t.delivered_at is not null
     group by 1
  )
  select s.day,
         date_trunc('month', s.day)::date          as month,
         coalesce(d.revenue_sar, 0)                as delivered_revenue_sar,
         coalesce(d.priced, 0)                     as delivered_trips_priced,
         coalesce(d.unpriced, 0)                   as delivered_trips_unpriced
    from spine s
    left join delivered d on d.day = s.day;

comment on view public.v_delivered_revenue_daily is
  'DASHBOARD-ONLY. Earned (delivered) revenue per day: each delivered trip '
  'priced at its project''s rate_per_trip_sar, bucketed by the delivery day in '
  'Asia/Riyadh. NOT billed revenue — Reports, v_revenue_monthly and '
  'v_pnl_monthly are untouched and remain the only revenue the P&L knows. '
  'Differs from billed revenue by TIMING (delivered now, invoiced later) and '
  'by UNBILLED work. A trip with no project cannot be priced: it adds 0.00 and '
  'is counted in delivered_trips_unpriced, never guessed. Trip counts here are '
  'bucketed by delivered_at and will NOT match v_delivery_output_daily, which '
  'buckets by trip_date — 86% of delivered trips fall on different days under '
  'the two rules. Both figures are net of VAT.';

-- ---------------------------------------------------------------------
-- 2) DICTIONARY.
-- ---------------------------------------------------------------------
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('delivered_revenue_daily',
   'Delivered revenue (daily)',
   'What the day''s delivered work was worth, whether or not it has been invoiced yet.',
   'For each trip with stage = delivered, its project''s rate_per_trip_sar, summed by the delivery day in Asia/Riyadh. A delivered trip with no project contributes 0 and is counted separately as unpriced.',
   'SAR', 'one day', 'v_delivered_revenue_daily', 'accrual',
   'EARNED, NOT BILLED, and DASHBOARD-ONLY — Reports, v_pnl_monthly and every margin still use billed revenue, and this metric is never mixed into them. It differs from billed revenue two ways: TIMING (work is delivered before it is invoiced, so a month can show delivered revenue with zero billed) and COVERAGE (delivered work that has not been invoiced at all). Live, June shows 7,400 delivered against 0 billed and August 152,890 against 0 billed, while July shows 41,970 delivered against 70,650 billed — billed can exceed delivered because an invoice may cover earlier periods and special charges. Never add the two together. Bucketing is Asia/Riyadh (38% of trips change day versus UTC), which deliberately differs from the invoiced series'' UTC bucket — that one must stay UTC to keep summing to v_revenue_monthly.')
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

-- ---------------------------------------------------------------------
-- 3) SECURITY — restated after the last create, because `create or replace
--    view` does not preserve reloptions.
-- ---------------------------------------------------------------------
alter view public.v_delivered_revenue_daily set (security_invoker = true);

revoke all on public.v_delivered_revenue_daily from anon;

grant select on public.v_delivered_revenue_daily to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. Expect security_invoker=true, and anon false:
--      select c.relname, c.reloptions
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname = 'v_delivered_revenue_daily';
--      select has_table_privilege('anon','public.v_delivered_revenue_daily','select');
--
-- B) NOTHING REPORTS READS HAS MOVED. This migration must be invisible to the
--    P&L. Capture these BEFORE applying and compare after — expect identical:
--      select month, revenue_sar from public.v_revenue_monthly order by month;
--      select month, revenue_sar, operating_cost_sar, net_profit_sar,
--             operating_margin_pct from public.v_pnl_monthly order by month;
--    (0108 creates one new view and one dictionary row; it alters no existing
--     object, so any change here would mean something else ran.)
--
-- C) EVERY DELIVERED TRIP IS ACCOUNTED FOR — priced or explicitly unpriced.
--    Expect the three counts to agree at 631 / 630 / 1 on today's data:
--      select (select sum(delivered_trips_priced) + sum(delivered_trips_unpriced)
--                from public.v_delivered_revenue_daily)               as in_view,
--             (select count(*) from public.trips
--               where stage='delivered' and delivered_at is not null) as in_table,
--             (select sum(delivered_trips_unpriced)
--                from public.v_delivered_revenue_daily)               as unpriced;
--
--    The unpriced trip must contribute NOTHING to revenue — expect 0 rows:
--      select v.day, v.delivered_revenue_sar, v.delivered_trips_unpriced
--        from public.v_delivered_revenue_daily v
--       where v.delivered_trips_priced = 0
--         and v.delivered_trips_unpriced > 0
--         and v.delivered_revenue_sar <> 0;
--
-- D) THE REVENUE FIGURE MATCHES A HAND ROLL-UP — expect 0 rows:
--      select v.month, sum(v.delivered_revenue_sar) as view_rev, b.rev as base_rev
--        from public.v_delivered_revenue_daily v
--        join (
--          select date_trunc('month', (t.delivered_at at time zone 'Asia/Riyadh')::date)::date as month,
--                 sum(coalesce(p.rate_per_trip_sar, 0)) as rev
--            from public.trips t
--            left join public.projects p on p.id = t.project_id
--           where t.stage='delivered' and t.delivered_at is not null
--           group by 1
--        ) b on b.month = v.month
--       group by v.month, b.rev
--      having sum(v.delivered_revenue_sar) <> b.rev;
--
-- E) SPINE ALIGNS WITH v_daily_operations, row for row — expect 0 rows:
--      select coalesce(a.day, b.day) as day, a.day as in_ops, b.day as in_delivered
--        from public.v_daily_operations a
--        full join public.v_delivered_revenue_daily b on b.day = a.day
--       where a.day is null or b.day is null;
--
-- F) WHAT THE CHART WILL SHOW — read before wiring, so the shape is expected:
--      select v.month,
--             sum(v.delivered_revenue_sar)      as delivered,
--             sum(v.delivered_trips_unpriced)   as unpriced_trips,
--             r.revenue_sar                     as billed
--        from public.v_delivered_revenue_daily v
--        join public.v_revenue_monthly r on r.month = v.month
--       group by v.month, r.revenue_sar order by v.month;
--      -- expect roughly: Jun 7,400 delivered vs 0 billed; Jul 41,970 vs
--      -- 70,650 (billed HIGHER — invoices cover earlier periods and special
--      -- charges); Aug 152,890 vs 0. The two lines are supposed to diverge.
-- ===========================================================================
