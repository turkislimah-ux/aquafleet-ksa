-- 0112_filling_cost_into_pnl.sql
-- Filling cost enters the money model. THIS MIGRATION MOVES THE P&L.
--
-- ===========================================================================
-- REDRAFTED AFTER A FAILED APPLY — 42P16, AND WHY THE FIX IS APPEND-ONLY
-- ===========================================================================
-- The first draft placed filling_cost_sar in the middle of each select, next
-- to the buckets it belongs with. Postgres refused:
--
--     ERROR 42P16: cannot change name of view column "operating_cost_sar"
--                  to "filling_cost_sar"
--
-- `create or replace view` may APPEND columns but may never insert, rename or
-- reorder existing ones. Nothing applied; the rollback was clean.
--
-- THE OBVIOUS FIX — drop and recreate — WOULD HAVE BEEN DESTRUCTIVE. Two views
-- depend on v_pnl_monthly (confirmed via pg_depend, not assumed):
--
--     public.v_cost_composition_monthly   recreated by this file
--     public.v_pnl_by_period              NOT recreated by this file
--
-- `drop ... cascade` would therefore have silently destroyed v_pnl_by_period,
-- which powers the Reports quarter/year P&L, and nothing here would have put
-- it back. So all three existing views stay `create or replace`, every
-- existing column keeps its exact NAME and POSITION, and the new columns are
-- APPENDED at the end.
--
-- Existing columns may change their EXPRESSION — operating cost, direct cost,
-- totals and percentages all now include filling — which is allowed and is the
-- whole point. Only the shape is frozen.
--
-- The money logic is unchanged from the verified draft: filling 210.00 /
-- 1,285.00 / 4,390.00 for Jun/Jul/Aug, July net profit 1,491.03 -> 206.03.
-- Only column order moved.
--
-- ===========================================================================
-- WHAT MOVES, AND BY HOW MUCH
-- ===========================================================================
-- Every prior migration in this feature was invisible to Reports by design.
-- This one is not. Measured on live data:
--
--   month     operating cost           filling      margin          net profit
--   2026-06   36,388.00 -> 36,598.00   +  210.00    n/a             -36,388 -> -36,598
--   2026-07   56,158.97 -> 57,443.97   +1,285.00    20.5% -> 18.7%    1,491.03 ->   206.03
--   2026-08   53,010.42 -> 57,400.42   +4,390.00    n/a             -53,010 -> -57,400
--
-- JULY NET PROFIT DROPS 86%, from 1,491.03 to 206.03. That is the intended
-- consequence of costing something real that was never costed — but it is the
-- kind of movement that gets reported as a bug weeks later, so the numbers
-- that produced it are written down here.
--
-- ===========================================================================
-- WHICH TRIPS INCUR THE COST — A DECISION, NOT AN OBVIOUS DEFAULT
-- ===========================================================================
-- The cost is incurred when the truck FILLS. A trip still in `scheduled` has
-- not filled, can still be deleted, and must not book cost. So:
--
--     stage in ('loading', 'in_transit', 'delivered')
--
-- The choice is material — live totals across the three months:
--
--     all trips (incl. scheduled)   6,280.00
--     filled or beyond              5,885.00   <-- used here
--     delivered only                5,500.00
--
-- 45 scheduled trips carry a snapshot but have not filled; including them
-- would book 395.00 for fills that have not happened. Delivered-only would
-- drop 385.00 of fills that genuinely did happen on trips still in transit.
-- `loading_at` is stamped on only 84 rows so it cannot be the signal — stage
-- is the reliable one.
--
-- THIS DIFFERS FROM COMMISSION, which is delivered-only, and the difference is
-- deliberate: commission is EARNED on delivery, a fill is PAID at the pump.
-- Same daily grain, same trip_date bucket, different trigger. Do not "make
-- them consistent" later.
--
-- ===========================================================================
-- THE 13 UNCOSTED TRIPS ARE NEVER TREATED AS ZERO
-- ===========================================================================
-- 13 trips (10 June, 3 July — all umm_al_hamam_station x potable, a type that
-- station does not offer) have filling_cost_sar NULL, meaning NOT COSTED.
--
-- sum() SKIPS NULLS, so each monthly figure is the sum of what IS known, and
-- the count of what is not travels WITH it on every view that publishes a
-- filling figure. A surface showing the money without the count shows a total
-- that is quietly short — the same failure as rendering an unread figure as 0.
--
-- ===========================================================================
-- WHAT CHANGES
-- ===========================================================================
--   NEW      v_filling_cost_monthly              month + uncosted count
--   NEW      v_filling_cost_by_station_monthly   month x station x type
--   REPLACED v_pnl_monthly                       cols 1-11 kept, 2 appended
--   REPLACED v_daily_operations                  cols 1-12 kept, 2 appended
--   REPLACED v_cost_composition_monthly          cols 1-12 kept, 3 appended
--
--   v_monthly_only_costs UNCHANGED — filling has a daily source, so it is not
--   a monthly-only cost. That is what keeps identity 2 true.
--
--   v_pnl_by_period is NOT touched and does not need to be: it SUMS
--   p.operating_cost_sar rather than re-deriving it from the buckets, so it
--   inherits filling automatically. See verification J for the one gap that
--   leaves, which is real and needs its own decision.
--
-- Money core untouched: no invoice RPC, no prepaid/VAT/FIFO path read or
-- written. Filling is additive.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) FILLING COST PER MONTH, with its own uncosted count. (NEW — no column
--    order constraint applies to a view that does not yet exist.)
-- ---------------------------------------------------------------------
create or replace view public.v_filling_cost_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(t.filling_cost_sar), 0)                           as filling_cost_sar,
         count(t.id) filter (where t.filling_cost_sar is not null)::int as costed_trips,
         count(t.id) filter (where t.filling_cost_sar is null)::int     as uncosted_trips
    from public.v_report_months m
    left join public.trips t
           on date_trunc('month', t.trip_date)::date = m.month
          and t.stage in ('loading', 'in_transit', 'delivered')
   group by m.month;

comment on view public.v_filling_cost_monthly is
  'What it cost US to fill, per month, from the frozen per-trip snapshot '
  '(trips.filling_cost_sar, 0110/0111), bucketed by trip_date. Counts trips '
  'that have FILLED — stage loading/in_transit/delivered — because a scheduled '
  'trip has not been to the pump. Deliberately unlike commission, which is '
  'delivered-only: commission is earned on delivery, a fill is paid at the '
  'pump. uncosted_trips is filled trips whose station has no price for their '
  'water type; their cost is UNKNOWN, not zero, and any surface showing '
  'filling_cost_sar must show this count too.';

-- ---------------------------------------------------------------------
-- 2) THE SAME FIGURE BY STATION AND WATER TYPE (Reports cost sub-tab). NEW.
-- ---------------------------------------------------------------------
create or replace view public.v_filling_cost_by_station_monthly
with (security_invoker = true) as
  select date_trunc('month', t.trip_date)::date                       as month,
         t.water_station                                              as station_key,
         w.name                                                       as station_name,
         t.water_type,
         coalesce(sum(t.filling_cost_sar), 0)                         as filling_cost_sar,
         count(*) filter (where t.filling_cost_sar is not null)::int  as costed_trips,
         count(*) filter (where t.filling_cost_sar is null)::int      as uncosted_trips
    from public.trips t
    -- LEFT join: a trip pointing at a since-deleted station key must still
    -- carry its cost. station_name goes NULL and the UI labels it, rather than
    -- the row vanishing from a total that is supposed to foot.
    left join public.water_stations w on w.key = t.water_station
   where t.stage in ('loading', 'in_transit', 'delivered')
   group by 1, 2, 3, 4;

comment on view public.v_filling_cost_by_station_monthly is
  'Filling cost per month, station and water type — the Reports cost sub-tab '
  'grain. Same trip predicate as v_filling_cost_monthly, so summing this by '
  'month equals that view exactly. station_name is NULL for a trip whose '
  'station key no longer exists; the cost still counts.';

-- ---------------------------------------------------------------------
-- 3) THE P&L. Columns 1-11 keep their exact names and positions (42P16);
--    filling is APPENDED as 12-13. Existing expressions change to include it.
-- ---------------------------------------------------------------------
create or replace view public.v_pnl_monthly
with (security_invoker = true) as
  select r.month,                                                        -- 1
         r.revenue_sar,                                                  -- 2
         p.parts_cost_sar,                                               -- 3
         o.os_cost_sar,                                                  -- 4
         (y.staff_salary_sar + y.driver_salary_sar) as payroll_sar,      -- 5
         (c.trip_commission_sar + c.specials_sar
          + c.adjustments_sar + c.bonus_sar) as commissions_sar,         -- 6
         -- 7: now FIVE buckets. Same name, same position, new expression.
         ( p.parts_cost_sar + o.os_cost_sar
           + y.staff_salary_sar + y.driver_salary_sar
           + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
           + f.filling_cost_sar
         ) as operating_cost_sar,
         ( r.revenue_sar                                                 -- 8
           - ( p.parts_cost_sar + o.os_cost_sar
               + y.staff_salary_sar + y.driver_salary_sar
               + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
               + f.filling_cost_sar )
         ) as operating_profit_sar,
         e.expenses_sar,                                                 -- 9
         ( r.revenue_sar                                                 -- 10
           - ( p.parts_cost_sar + o.os_cost_sar
               + y.staff_salary_sar + y.driver_salary_sar
               + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
               + f.filling_cost_sar )
           - e.expenses_sar
         ) as net_profit_sar,
         case when r.revenue_sar > 0 then round(                         -- 11
           ( r.revenue_sar
             - ( p.parts_cost_sar + o.os_cost_sar
                 + y.staff_salary_sar + y.driver_salary_sar
                 + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
                 + f.filling_cost_sar )
           ) / r.revenue_sar * 100, 1) end as operating_margin_pct,
         -- APPENDED (0112). New columns go at the END or the replace fails.
         f.filling_cost_sar,                                             -- 12
         f.uncosted_trips as filling_uncosted_trips                      -- 13
    from public.v_revenue_monthly      r
    join public.v_parts_cost_monthly   p using (month)
    join public.v_os_cost_monthly      o using (month)
    join public.v_payroll_monthly      y using (month)
    join public.v_commissions_monthly  c using (month)
    join public.v_expenses_monthly     e using (month)
    join public.v_filling_cost_monthly f using (month);

comment on view public.v_pnl_monthly is
  'Monthly P&L, assembled from the component views — nothing recomputed. '
  'operating_cost_sar is FIVE buckets as of 0112: parts, outsourced, payroll, '
  'commissions and filling. filling_cost_sar sits at the END of the column '
  'list rather than beside the other buckets because create-or-replace cannot '
  'insert a column mid-list (42P16) and v_pnl_by_period depends on this view, '
  'so dropping it was not an option. operating_profit is before manual '
  'expenses, net_profit after (0098 rule 8). filling_uncosted_trips is filled '
  'trips with no price for their water type — cost unknown, not zero.';

-- ---------------------------------------------------------------------
-- 4) THE DAY GRAIN. Columns 1-12 kept; filling APPENDED as 13-14.
-- ---------------------------------------------------------------------
create or replace view public.v_daily_operations
with (security_invoker = true) as
  with spine as (
    select generate_series(
             (select min(month) from public.v_report_months),
             greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
             interval '1 day'
           )::date as day
  ),
  revenue as (
    select r.confirmed_at::date as day,
           sum(r.revenue_sar)   as revenue_sar,
           count(*)             as invoice_count
      from public.v_revenue_invoices r
     group by 1
  ),
  parts as (
    select p.day, sum(p.cost_sar) as parts_cost_sar
      from public.v_parts_consumption_daily p
     group by 1
  ),
  outsourced as (
    select coalesce(wp.invoice_date, wp.created_at::date) as day,
           sum(wp.grand_total_sar) as os_cost_sar
      from public.workshop_payments wp
     group by 1
  ),
  commissions as (
    select t.trip_date as day, sum(t.commission_sar) as trip_commission_sar
      from public.trips t
     where t.stage = 'delivered'
     group by 1
  ),
  -- NEW (0112). Same trip_date bucket as commission, FILLED predicate rather
  -- than delivered-only — a fill is paid at the pump, not on delivery.
  filling as (
    select t.trip_date as day,
           sum(t.filling_cost_sar)                                 as filling_cost_sar,
           count(*) filter (where t.filling_cost_sar is null)::int as uncosted_trips
      from public.trips t
     where t.stage in ('loading', 'in_transit', 'delivered')
     group by 1
  ),
  manual_expenses as (
    select e.expense_date as day, sum(e.amount_sar) as expenses_sar
      from public.expenses e
     group by 1
  ),
  activity as (
    select t.trip_date as day,
           count(*)                                      as trips_total,
           count(*) filter (where t.stage = 'delivered') as trips_delivered
      from public.trips t
     group by 1
  )
  select s.day,                                                    -- 1
         date_trunc('month', s.day)::date    as month,             -- 2
         coalesce(rv.revenue_sar, 0)         as revenue_sar,       -- 3
         coalesce(rv.invoice_count, 0)::int  as invoice_count,     -- 4
         coalesce(pa.parts_cost_sar, 0)      as parts_cost_sar,    -- 5
         coalesce(os.os_cost_sar, 0)         as os_cost_sar,       -- 6
         coalesce(cm.trip_commission_sar, 0) as trip_commission_sar, -- 7
         -- 8: now FOUR daily sources. Same name and position, new expression.
         ( coalesce(pa.parts_cost_sar, 0)
         + coalesce(os.os_cost_sar, 0)
         + coalesce(cm.trip_commission_sar, 0)
         + coalesce(fl.filling_cost_sar, 0) )  as direct_cost_sar,
         ( coalesce(rv.revenue_sar, 0)                             -- 9
         - coalesce(pa.parts_cost_sar, 0)
         - coalesce(os.os_cost_sar, 0)
         - coalesce(cm.trip_commission_sar, 0)
         - coalesce(fl.filling_cost_sar, 0) )  as direct_margin_sar,
         coalesce(ex.expenses_sar, 0)        as expenses_sar,      -- 10
         coalesce(ac.trips_total, 0)::int    as trips_total,       -- 11
         coalesce(ac.trips_delivered, 0)::int as trips_delivered,  -- 12
         -- APPENDED (0112).
         coalesce(fl.filling_cost_sar, 0)     as filling_cost_sar, -- 13
         coalesce(fl.uncosted_trips, 0)::int  as filling_uncosted_trips -- 14
    from spine s
    left join revenue         rv on rv.day = s.day
    left join parts           pa on pa.day = s.day
    left join outsourced      os on os.day = s.day
    left join commissions     cm on cm.day = s.day
    left join filling         fl on fl.day = s.day
    left join manual_expenses ex on ex.day = s.day
    left join activity        ac on ac.day = s.day;

comment on view public.v_daily_operations is
  'One row per calendar day. revenue_sar is billed revenue bucketed by the day '
  'the invoice was CONFIRMED (UTC, so days sum to v_revenue_monthly exactly). '
  'direct_cost_sar is parts + outsourced + trip commissions + FILLING (0112) — '
  'the four cost sources with a real per-day stamp. Payroll and non-trip '
  'commission still have none and are reported per month by '
  'v_monthly_only_costs. direct_margin_sar is NOT profit. '
  'filling_uncosted_trips is filled trips with no price for their water type — '
  'cost unknown, not zero. filling columns are appended at the end because '
  'create-or-replace cannot insert mid-list (42P16).';

-- ---------------------------------------------------------------------
-- 5) COST COMPOSITION. Columns 1-12 kept; filling APPENDED as 13-15.
-- ---------------------------------------------------------------------
create or replace view public.v_cost_composition_monthly
with (security_invoker = true) as
  select pl.month,                                                 -- 1
         pl.parts_cost_sar   as parts_sar,                         -- 2
         pl.os_cost_sar      as outsourced_sar,                    -- 3
         pl.payroll_sar,                                           -- 4
         pl.commissions_sar,                                       -- 5
         pl.expenses_sar     as other_expenses_sar,                -- 6
         -- 7: operating_cost_sar now includes filling, so the total does too.
         (pl.operating_cost_sar + pl.expenses_sar) as total_cost_sar,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 8
              then round(pl.parts_cost_sar   / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as parts_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 9
              then round(pl.os_cost_sar      / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as outsourced_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 10
              then round(pl.payroll_sar      / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as payroll_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 11
              then round(pl.commissions_sar  / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as commissions_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 12
              then round(pl.expenses_sar     / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as other_expenses_pct,
         -- APPENDED (0112). The sixth slice.
         pl.filling_cost_sar as filling_sar,                       -- 13
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0   -- 14
              then round(pl.filling_cost_sar / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as filling_pct,
         pl.filling_uncosted_trips                                 -- 15
    from public.v_pnl_monthly pl;

comment on view public.v_cost_composition_monthly is
  'Operating cost split SIX ways per month as of 0112 — parts, outsourced, '
  'payroll, commissions, filling, other expenses — each with its share of that '
  'month''s total. Every figure is read from v_pnl_monthly, so the Dashboard '
  'cannot disagree with the P&L. Shares recompute per month, never averaged '
  '(0100). A month with no cost returns NULL shares, not 0%. The filling '
  'columns are appended rather than sitting beside the other buckets — '
  'create-or-replace cannot insert mid-list (42P16).';

-- ---------------------------------------------------------------------
-- 6) SECURITY — all five, restated after the last create. `create or replace
--    view` does not preserve reloptions, so without this the three REPLACED
--    views silently revert to owner-run and bypass RLS on 68 tables.
-- ---------------------------------------------------------------------
alter view public.v_filling_cost_monthly            set (security_invoker = true);
alter view public.v_filling_cost_by_station_monthly set (security_invoker = true);
alter view public.v_pnl_monthly                     set (security_invoker = true);
alter view public.v_daily_operations                set (security_invoker = true);
alter view public.v_cost_composition_monthly        set (security_invoker = true);

revoke all on public.v_filling_cost_monthly            from anon;
revoke all on public.v_filling_cost_by_station_monthly from anon;
revoke all on public.v_pnl_monthly                     from anon;
revoke all on public.v_daily_operations                from anon;
revoke all on public.v_cost_composition_monthly        from anon;

grant select on public.v_filling_cost_monthly            to authenticated;
grant select on public.v_filling_cost_by_station_monthly to authenticated;
grant select on public.v_pnl_monthly                     to authenticated;
grant select on public.v_daily_operations                to authenticated;
grant select on public.v_cost_composition_monthly        to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. All five INVOKER, none anon-readable. Check the three
--    REPLACED ones hardest — a replace drops reloptions:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.'||c.relname,'select') as anon
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relkind='v'
--         and c.relname in ('v_filling_cost_monthly','v_filling_cost_by_station_monthly',
--                           'v_pnl_monthly','v_daily_operations','v_cost_composition_monthly');
--
-- A2) COLUMN ORDER PRESERVED — the thing that failed last time. The first 11 /
--     12 / 12 columns must be unchanged, with the new ones appended after:
--      select table_name, ordinal_position, column_name
--        from information_schema.columns
--       where table_schema='public'
--         and table_name in ('v_pnl_monthly','v_daily_operations','v_cost_composition_monthly')
--       order by table_name, ordinal_position;
--      -- v_pnl_monthly            1-11 unchanged, 12 filling_cost_sar, 13 filling_uncosted_trips
--      -- v_daily_operations       1-12 unchanged, 13 filling_cost_sar, 14 filling_uncosted_trips
--      -- v_cost_composition_monthly 1-12 unchanged, 13 filling_sar, 14 filling_pct,
--      --                            15 filling_uncosted_trips
--
-- A3) v_pnl_by_period SURVIVED. It was never dropped, so it must still exist
--     and still return rows:
--      select period_type, count(*) from public.v_pnl_by_period group by 1;
--      -- expect month / quarter / year all present.
--
-- B) IDENTITY 1 — operating_cost is the sum of its FIVE buckets. Expect 0 rows:
--      select month, operating_cost_sar,
--             parts_cost_sar + os_cost_sar + payroll_sar + commissions_sar
--               + filling_cost_sar as bucket_sum
--        from public.v_pnl_monthly
--       where operating_cost_sar <> parts_cost_sar + os_cost_sar + payroll_sar
--                                 + commissions_sar + filling_cost_sar;
--
-- C) IDENTITY 2 — daily direct + monthly-only = operating cost. The one
--    filling could have broken by landing on one side only. Expect 0 rows:
--      select d.month, d.direct, k.monthly_only_cost_sar, pl.operating_cost_sar
--        from (select month, sum(direct_cost_sar) as direct
--                from public.v_daily_operations group by month) d
--        join public.v_monthly_only_costs k using (month)
--        join public.v_pnl_monthly       pl using (month)
--       where d.direct + k.monthly_only_cost_sar <> pl.operating_cost_sar;
--
-- D) IDENTITY 3 — the six composition figures sum to the total. Expect 0 rows:
--      select * from public.v_cost_composition_monthly
--       where parts_sar + outsourced_sar + payroll_sar + commissions_sar
--             + filling_sar + other_expenses_sar <> total_cost_sar;
--
-- E) IDENTITY 4 — daily sums to monthly, per component INCLUDING filling.
--    Expect 0 rows:
--      select d.month
--        from (select month,
--                     sum(revenue_sar)         as revenue_sar,
--                     sum(parts_cost_sar)      as parts_cost_sar,
--                     sum(os_cost_sar)         as os_cost_sar,
--                     sum(trip_commission_sar) as trip_commission_sar,
--                     sum(filling_cost_sar)    as filling_cost_sar
--                from public.v_daily_operations group by month) d
--        join public.v_revenue_monthly      r using (month)
--        join public.v_parts_cost_monthly   p using (month)
--        join public.v_os_cost_monthly      o using (month)
--        join public.v_commissions_monthly  c using (month)
--        join public.v_filling_cost_monthly f using (month)
--       where d.revenue_sar         <> r.revenue_sar
--          or d.parts_cost_sar      <> p.parts_cost_sar
--          or d.os_cost_sar         <> o.os_cost_sar
--          or d.trip_commission_sar <> c.trip_commission_sar
--          or d.filling_cost_sar    <> f.filling_cost_sar;
--
-- F) THE STATION SPLIT RECONCILES TO THE MONTHLY TOTAL — expect 0 rows:
--      select b.month, b.total, f.filling_cost_sar
--        from (select month, sum(filling_cost_sar) as total,
--                     sum(uncosted_trips) as uncosted
--                from public.v_filling_cost_by_station_monthly group by month) b
--        join public.v_filling_cost_monthly f using (month)
--       where b.total <> f.filling_cost_sar or b.uncosted <> f.uncosted_trips;
--
-- G) THE MOVEMENT IS THE EXPECTED ONE:
--      select month, filling_cost_sar, uncosted_trips, costed_trips
--        from public.v_filling_cost_monthly order by month;
--      -- expect Jun 210.00 / 10 uncosted, Jul 1,285.00 / 3, Aug 4,390.00 / 0.
--      select month, operating_cost_sar, operating_margin_pct, net_profit_sar
--        from public.v_pnl_monthly order by month;
--      -- expect Jun 36,598.00 | Jul 57,443.97, 18.7%, 206.03 | Aug 57,400.42.
--      -- If July's margin and net profit did NOT move, filling never reached
--      -- the P&L and something is wrong.
--
-- H) NOTHING ELSE MOVED. Revenue is not a cost:
--      select month, revenue_sar from public.v_revenue_monthly order by month;
--      select month, revenue_sar from public.v_pnl_monthly order by month;
--      select month, sum(delivered_revenue_sar) from public.v_delivered_revenue_daily
--       group by month order by month;
--      -- all identical to the pre-apply capture.
--
-- I) THE UNCOSTED COUNT AGREES ON EVERY SURFACE THAT SHOWS THE MONEY:
--      select 'pnl' as src, month, filling_uncosted_trips from public.v_pnl_monthly
--      union all select 'composition', month, filling_uncosted_trips from public.v_cost_composition_monthly
--      union all select 'monthly', month, uncosted_trips from public.v_filling_cost_monthly
--      union all select 'daily', month, sum(filling_uncosted_trips)::int
--                  from public.v_daily_operations group by month
--       order by month, src;
--      -- every source must agree per month: Jun 10, Jul 3, Aug 0.
--
-- J) A REAL GAP THIS FILE DOES NOT CLOSE — v_pnl_by_period. It SUMS
--    p.operating_cost_sar, so its operating cost DOES include filling and its
--    margin is right. But it exposes only the four original bucket columns, so
--    INSIDE that view the bucket sum no longer equals operating cost:
--      select period_type, label, operating_cost_sar,
--             parts_cost_sar + os_cost_sar + payroll_sar + commissions_sar as four_buckets,
--             operating_cost_sar - (parts_cost_sar + os_cost_sar + payroll_sar
--                                   + commissions_sar) as unexplained
--        from public.v_pnl_by_period order by period_type, period_start;
--      -- `unexplained` equals that period's filling cost. The figures are
--      -- CORRECT; what is missing is a filling column to explain the gap.
--      -- Adding one is a separate migration (append-only again) plus the
--      -- Reports quarter/year UI. Decide before Turki reads a quarterly P&L
--      -- whose buckets do not add up.
-- ===========================================================================
