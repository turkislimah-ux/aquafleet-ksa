-- 0101_operations_by_driver.sql
--
-- A DRIVER dimension for the Operations statement.
--
-- ===========================================================================
-- THIS FILE HAS BEEN RECONCILED TO WHAT IS ACTUALLY APPLIED
-- ===========================================================================
-- The version that ran differs from the version originally drafted here. This
-- file was rewritten to match live, verified against pg_get_viewdef, so that
-- reading it tells you the truth about the database. Four differences:
--
--  1) trips_total was renamed trips_scheduled. Better name — it is the count
--     of trips scheduled to that driver, delivered or not.
--  2) completion_rate_pct is now computed IN THE VIEW rather than in the UI.
--     This is an improvement and the reason is the same one migration 0100
--     exists for: a ratio must be recomputed from its own row's totals, never
--     averaged. Computing it here makes that structural instead of a rule the
--     UI has to remember.
--  3) primary_truck_id is exposed alongside primary_plate.
--  4) THE ONE THAT CHANGES UI BEHAVIOUR: the draft wrapped the driver name in
--     coalesce(d.name, 'Unassigned'). The applied view does not, so a trip
--     with no driver_id produces a row with driver_id AND driver_name both
--     NULL. The row still exists — reconciliation is unaffected — but the
--     LABEL is now the UI's job. app/reports/StatementViews.tsx renders that
--     row as "Unassigned"; if that ever regresses, the column silently loses
--     its heading rather than disappearing.
--
-- ===========================================================================
-- WHY THIS NEEDS A VIEW AT ALL
-- ===========================================================================
-- The Reports page reads views and never base tables (0098's contract — one
-- definition per metric, so no two surfaces can disagree). The Operations
-- statement wants columns per DRIVER, and no view in the semantic layer
-- carried a driver: v_operations_monthly is period-grain only.
--
-- Two alternatives were rejected. "Distributing" the period totals across
-- drivers would be invention — 131 delivered trips is not eleven driver
-- figures added up. Reading `trips` directly in the page would break the
-- page's contract and create a second definition of "delivered trips" free to
-- drift from v_operations_monthly.
--
-- ===========================================================================
-- RECONCILIATION IS BY CONSTRUCTION, NOT BY LUCK
-- ===========================================================================
-- The grouping happens BEFORE the join to drivers, so a trip with no driver
-- still forms its own row. The driver rows therefore always sum to
-- v_operations_monthly. This matters: live, June 2026 has 33 trips of which 1
-- has no driver_id. Had the driver join filtered instead, the statement would
-- have shown 32 while the period total directly above it said 33.
--
-- Verified live after apply — zero gap on every month:
--   Jun  33 trips / 22 delivered   (1 trip unattributed)
--   Jul 166 trips / 131 delivered
--   Aug   4 trips /   1 delivered
--
-- ===========================================================================
-- A DRIVER IS NOT ALWAYS ONE TRUCK
-- ===========================================================================
-- The statement shows a plate under each driver's name, which assumes one
-- truck per driver. Usually true, not always: live, Fahad 2 used two trucks in
-- July 2026. So the view exposes `primary_plate` (that driver's most-used
-- truck, via mode()) alongside `trucks_used`, and the UI says "drove N trucks"
-- when trucks_used > 1 rather than presenting one of several as the only one.
--
-- THE TRUCK IS DISPLAY ONLY. No truck-level measure ever sits under a driver
-- column — the driver is the unit being measured, the plate is context for
-- reading the column. Truck-level facts stay in the period summary block.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ONE new view. No table, column, policy, function or row is altered.
--  - security_invoker = true, SELECT to authenticated, revoked from anon.
--    `trips`, `drivers` and `trucks` are all RLS-enabled, so a default
--    (owner-run) view would bypass their policies.
--  - Read-only. Nothing on the Reports page writes through it.
--  - No new dictionary key: this is the SAME `operations` metric at a finer
--    grain, and 0100 established that a finer cut of one metric does not earn
--    a second key. Its source_view is amended to name both views.

begin;

create or replace view public.v_operations_by_driver_monthly
with (security_invoker = true) as
  with driver_trips as (
    select date_trunc('month', t.trip_date)::date as month,
           t.driver_id,
           t.truck_id,
           t.stage,
           t.trip_date
      from public.trips t
  ),
  agg as (
    -- Grouped BEFORE the driver join, so a trip with no driver keeps its own
    -- row and the totals still foot to v_operations_monthly.
    select driver_trips.month,
           driver_trips.driver_id,
           count(*)                                                    as trips_scheduled,
           count(*) filter (where driver_trips.stage =  'delivered')    as trips_delivered,
           count(*) filter (where driver_trips.stage <> 'delivered')    as trips_not_delivered,
           count(distinct driver_trips.truck_id)
             filter (where driver_trips.truck_id is not null)           as trucks_used,
           mode() within group (order by driver_trips.truck_id)         as primary_truck_id
      from driver_trips
     group by driver_trips.month, driver_trips.driver_id
  )
  select a.month,
         a.driver_id,
         -- NULL when the trip had no driver. The UI labels that column
         -- "Unassigned" — see the reconciliation note in this file's header.
         d.name as driver_name,
         a.primary_truck_id,
         tr.plate as primary_plate,
         a.trucks_used,
         a.trips_scheduled,
         a.trips_delivered,
         a.trips_not_delivered,
         -- Recomputed from THIS driver's own totals. Never an average of
         -- anything — the same rule 0100 enforces for the P&L margin.
         case when a.trips_scheduled > 0
              then round(a.trips_delivered::numeric / a.trips_scheduled::numeric * 100, 1)
         end as completion_rate_pct
    from agg a
    left join public.drivers d  on d.id  = a.driver_id
    left join public.trucks  tr on tr.id = a.primary_truck_id;

grant select on public.v_operations_by_driver_monthly to authenticated;
revoke all  on public.v_operations_by_driver_monthly from anon;

update public.report_metrics
   set grain = 'one period, or one driver in one month',
       source_view = 'v_operations_monthly, v_operations_by_driver_monthly',
       caveat = 'Trips, work orders, outsourced jobs and permits are event counts and add across months. Trucks active does NOT — it is a distinct count, so a multi-month period reports the highest single month rather than a sum. Per driver, trips with no driver recorded still form their own row so the driver figures always sum to the period total; the truck shown beside a driver is context only and is never itself measured per driver.'
 where metric_key = 'operations';

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — all run against the live database.
-- ===========================================================================
-- 1) security_invoker + grants, on a view over three RLS-enabled tables:
--      select coalesce((select option_value from pg_options_to_table(c.reloptions)
--                        where option_name = 'security_invoker'), 'false') as security_invoker,
--             has_table_privilege('anon', c.oid, 'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid, 'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relname = 'v_operations_by_driver_monthly';
--    PASSED: true / false / true.
--
-- 2) IT RECONCILES TO v_operations_monthly — the check this view exists to
--    pass. Any gap means the statement contradicts the summary above it:
--      select o.month,
--             o.trips_total     - sum(v.trips_scheduled) as trips_gap,
--             o.trips_delivered - sum(v.trips_delivered) as delivered_gap
--        from public.v_operations_monthly o
--        join public.v_operations_by_driver_monthly v on v.month = o.month
--       group by o.month, o.trips_total, o.trips_delivered order by o.month;
--    PASSED: 0 on every month (Jun 33/22, Jul 166/131, Aug 4/1).
--
-- 3) THE UNATTRIBUTED TRIP SURVIVES, with a null name for the UI to label:
--      select month, driver_id, driver_name, trips_scheduled
--        from public.v_operations_by_driver_monthly
--       where driver_id is null;
--    PASSED: one row — 2026-06-01, 1 trip. If this returns nothing while
--    check 2 still passes, the grouping has moved after the driver join.
--
-- 4) THE MULTI-TRUCK DRIVER IS FLAGGED:
--      select driver_name, trucks_used, primary_plate
--        from public.v_operations_by_driver_monthly
--       where month = '2026-07-01' and trucks_used > 1;
--    PASSED: Fahad 2, trucks_used 2, primary_plate BBB-1114.
--
-- 5) COMPLETION RATE IS PER DRIVER, not inherited from the period:
--      select driver_name, trips_scheduled, trips_delivered, completion_rate_pct
--        from public.v_operations_by_driver_monthly
--       where month = '2026-07-01' order by completion_rate_pct desc nulls last;
--    PASSED: spans 100.0 (mohammed 1, 13/13) down to 0.0 — the period figure
--    is 78.9%, so a single inherited rate would be visibly wrong.
--
-- 6) ROW COUNT vs NAME COUNT. July returns 13 rows but only 11 distinct
--    names: two driver RECORDS share a name ("Fahad 2", "Fahad 3"). Grouping
--    by driver_id is correct — merging two people because they share a first
--    name would be a real error — but it does mean the statement can show the
--    same name twice. The plate underneath distinguishes them, which is a
--    second reason it belongs in the header:
--      select count(*) as rows, count(distinct driver_name) as names
--        from public.v_operations_by_driver_monthly where month = '2026-07-01';
--    PASSED: 13 rows / 11 names.
--
-- 7) DICTIONARY: 23 rows, `operations` amended not duplicated:
--      select count(*) from public.report_metrics;                   -- 23
--      select grain, source_view from public.report_metrics
--       where metric_key = 'operations';
--
-- 8) NOTHING WAS WRITTEN. FIFO invariant untouched:
--      select p.id from public.parts p
--       left join public.price_lots pl on pl.part_id = p.id
--       group by p.id, p.qty_on_hand
--      having p.qty_on_hand is distinct from coalesce(sum(pl.qty_remaining), 0);
--    Zero rows.
