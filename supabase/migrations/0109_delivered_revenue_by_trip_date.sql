-- 0109_delivered_revenue_by_trip_date.sql
-- Re-bucket delivered revenue onto the day the trip RAN, not the day someone
-- pressed "delivered".
--
-- Replaces v_delivered_revenue_daily (0108). Same columns, same names, same
-- types, same spine — only the day a trip lands on changes. Still
-- DASHBOARD-ONLY: Reports, v_revenue_monthly and v_pnl_monthly are untouched
-- and remain the only revenue the P&L knows.
--
-- ===========================================================================
-- WHAT WENT WRONG IN 0108, AND HOW THE DATA SHOWED IT
-- ===========================================================================
-- 0108 bucketed by (delivered_at at time zone 'Asia/Riyadh')::date. On screen
-- that produced a line with revenue on THREE days of August and zero on every
-- other day, which Turki correctly read as looking like an error.
--
-- It was not a rendering fault. delivered_at records WHEN THE STAGE BUTTON WAS
-- PRESSED, not when the water was delivered, and this fleet advances trips on
-- the Kanban in bulk. The signature is unmistakable:
--
--   by delivered_at        by trip_date
--   ----------------       ---------------------------------------------
--   2026-08-01     1       2026-08-01   27      2026-08-08   39
--   2026-08-12   142       2026-08-02   52      2026-08-09   35
--   2026-08-13   310  <--  2026-08-03   53      2026-08-10   30
--   2026-08-14    25       2026-08-04   63      2026-08-11   30
--                          2026-08-05   62      2026-08-12   28
--                          2026-08-06   59
--
-- 310 trips did not happen on 13 August. That is one afternoon of clicking.
-- All-time the same split is 22 distinct days by delivered_at against 35 by
-- trip_date — the stamp collapses five weeks of work onto three afternoons.
--
-- ===========================================================================
-- WHY trip_date IS THE RIGHT DAY, NOT JUST THE PRETTIER ONE
-- ===========================================================================
--  · It is the OPERATIONAL day. A trip is created for a date and run on it;
--    trips.trip_date is what the business means by "that day's work".
--  · The Kanban is day-scoped BY trip_date (ProjectsBoard's `dayTrips` filter),
--    so this now matches the board a user would open to check the same day.
--  · v_delivery_output_daily (0105) already buckets its delivered-trip counts
--    by trip_date. 0108 disagreed with it on 86% of trips and needed a warning
--    telling readers not to reconcile the two. **That warning is now obsolete:
--    both views bucket the same way and their trip counts agree by
--    construction.** One less landmine.
--  · trip_date is a DATE column, so there is no timezone conversion at all —
--    0108's Riyadh-vs-UTC caveat disappears with it. Nothing to skew.
--
-- WHAT IS LOST, STATED PLAINLY: the ability to ask "when was this marked
-- delivered". That is an audit question about app usage, not an operational
-- one about earnings, and nothing on the Dashboard asks it. delivered_at is
-- untouched on the table and remains available to anything that needs it —
-- v_activity_feed (0103) still reads it, correctly, because "trip delivered"
-- as an EVENT really did occur when the button was pressed.
--
-- THE TOTAL DOES NOT MOVE. Re-bucketing redistributes days; it adds and drops
-- nothing. 631 delivered trips and 202,260.00 SAR before and after — asserted
-- in the verification block.
--
-- READ-ONLY BY CONSTRUCTION. One view replaced, one dictionary row amended.
-- No table, column, constraint, policy, RPC or row is altered.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) DELIVERED REVENUE, PER OPERATIONAL DAY.
-- ---------------------------------------------------------------------
-- Column list, order and types are 0108's, unchanged. Only the bucket moves.
create or replace view public.v_delivered_revenue_daily
with (security_invoker = true) as
  with spine as (
    -- Byte-identical to v_daily_operations' spine (0104) so the views align
    -- row for row. Upper bound is TODAY, never month-end: a chart of the
    -- current month must not render future days as zero-revenue days.
    select generate_series(
             (select min(month) from public.v_report_months),
             greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
             interval '1 day'
           )::date as day
  ),
  delivered as (
    -- trip_date, not delivered_at. See the header for the 310-trips-in-one-
    -- afternoon evidence. No timezone cast: trip_date is already a DATE.
    select t.trip_date as day,
           -- An unpriceable trip adds 0.00, never a guess.
           sum(coalesce(p.rate_per_trip_sar, 0))                        as revenue_sar,
           count(*) filter (where p.rate_per_trip_sar is not null)::int  as priced,
           count(*) filter (where p.rate_per_trip_sar is null)::int      as unpriced
      from public.trips t
      -- LEFT join: a delivered trip with no project must still be COUNTED as
      -- unpriced. An inner join would silently drop it and the gap would
      -- vanish from the figure it is supposed to qualify.
      left join public.projects p on p.id = t.project_id
     where t.stage = 'delivered'
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
  'priced at its project''s rate_per_trip_sar, bucketed by trips.trip_date — '
  'the day the trip RAN. 0109 moved this off delivered_at, which records when '
  'the stage button was pressed and collapsed five weeks of work onto three '
  'afternoons (310 trips stamped on one day). NOT billed revenue: Reports, '
  'v_revenue_monthly and v_pnl_monthly are untouched and remain the only '
  'revenue the P&L knows. Differs from billed revenue by TIMING (delivered '
  'now, invoiced later) and by UNBILLED work. A trip with no project cannot be '
  'priced: it adds 0.00 and is counted in delivered_trips_unpriced, never '
  'guessed. Trip counts here now share v_delivery_output_daily''s trip_date '
  'bucket, so the two agree. Net of VAT.';

-- ---------------------------------------------------------------------
-- 2) DICTIONARY — amended for the new bucket.
-- ---------------------------------------------------------------------
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('delivered_revenue_daily',
   'Delivered revenue (daily)',
   'What the day''s delivered work was worth, whether or not it has been invoiced yet.',
   'For each trip with stage = delivered, its project''s rate_per_trip_sar, summed by trips.trip_date — the day the trip ran. A delivered trip with no project contributes 0 and is counted separately as unpriced.',
   'SAR', 'one day', 'v_delivered_revenue_daily', 'accrual',
   'EARNED, NOT BILLED, and DASHBOARD-ONLY — Reports, v_pnl_monthly and every margin still use billed revenue, and this metric is never mixed into them. It differs from billed revenue two ways: TIMING (work is delivered before it is invoiced, so a month can show delivered revenue with zero billed) and COVERAGE (delivered work not invoiced at all). Billed can also EXCEED delivered, because an invoice may cover earlier periods and special charges. Never add the two together. Bucketed by trip_date (the operational day, and the same bucket the Kanban board and v_delivery_output_daily use), NOT by delivered_at — that column records when the stage button was pressed, and this fleet advances trips in bulk, which put 310 trips on a single day and left the rest of the month empty (0109).')
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
-- A) SECURITY GATE. The view was REPLACED, so it lost its reloptions and
--    depends on the footer above. Expect security_invoker=true, anon false:
--      select c.relname, c.reloptions from pg_class c
--        join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relkind='v'
--         and c.relname='v_delivered_revenue_daily';
--      select has_table_privilege('anon','public.v_delivered_revenue_daily','select');
--
-- B) THE TOTAL DID NOT MOVE. Re-bucketing redistributes; it must not add or
--    drop a riyal or a trip. Expect 631 / 631 and 202260.00 / 202260.00:
--      select (select sum(delivered_trips_priced) + sum(delivered_trips_unpriced)
--                from public.v_delivered_revenue_daily)          as trips_in_view,
--             (select count(*) from public.trips
--               where stage='delivered')                          as trips_in_table,
--             (select sum(delivered_revenue_sar)
--                from public.v_delivered_revenue_daily)          as rev_in_view,
--             (select sum(coalesce(p.rate_per_trip_sar,0))
--                from public.trips t
--                left join public.projects p on p.id=t.project_id
--               where t.stage='delivered')                        as rev_in_table;
--
-- C) THE BUG IS ACTUALLY FIXED — revenue is spread across the month, not piled
--    on three afternoons. Expect ~35 populated days all-time (was 22), and no
--    single day holding a fifth of the month:
--      select count(*) filter (where delivered_revenue_sar > 0) as days_with_revenue
--        from public.v_delivered_revenue_daily;
--      select day, delivered_trips_priced, delivered_revenue_sar
--        from public.v_delivered_revenue_daily
--       where month = date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date
--       order by day;
--      -- expect a plausible working rhythm (live August ran 27-63 trips/day),
--      -- NOT one 310-trip spike.
--
-- D) IT NOW AGREES WITH DELIVERY OUTPUT, which 0108 could not. Both bucket by
--    trip_date, so the delivered-trip counts must match exactly — expect 0 rows:
--      select r.day, r.delivered_trips_priced + r.delivered_trips_unpriced as rev_trips,
--             o.trips_delivered as output_trips
--        from public.v_delivered_revenue_daily r
--        join public.v_delivery_output_daily o on o.day = r.day
--       where r.delivered_trips_priced + r.delivered_trips_unpriced <> o.trips_delivered;
--      -- 0108 could not pass this: 86% of trips fell on different days.
--
-- E) NOTHING REPORTS READS HAS MOVED — expect identical before and after:
--      select month, revenue_sar from public.v_revenue_monthly order by month;
--      select month, revenue_sar, operating_cost_sar, net_profit_sar,
--             operating_margin_pct from public.v_pnl_monthly order by month;
--
-- F) SPINE STILL ALIGNS WITH v_daily_operations — expect 0 rows:
--      select coalesce(a.day, b.day) as day
--        from public.v_daily_operations a
--        full join public.v_delivered_revenue_daily b on b.day = a.day
--       where a.day is null or b.day is null;
-- ===========================================================================
