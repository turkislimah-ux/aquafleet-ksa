-- 0105_delivery_output_daily.sql
-- Delivery Output: delivered volume (by truck capacity) and delivered trips,
-- per day. ONE view, composed on 0104's day grain.
--
-- ===========================================================================
-- WHY CAPACITY AND NOT MEASURED VOLUME
-- ===========================================================================
-- Turki asked for delivered volume. The app has a column for it —
-- trips.tank_size_m3 — and it is unusable: checked live, 0 of 203 trips carry
-- a non-zero value. Charting it would draw a flat zero line and call it a
-- measurement. That was flagged rather than faked when the Dashboard was
-- rebuilt, and this file is the honest substitute Turki chose instead:
--
--   volume proxy = sum of the DELIVERING TRUCK's capacity_m3
--
-- trucks.capacity_m3 is real, entered data — 15 of 15 trucks populated, range
-- 18.00 to 33.00 m3, verified live before this was drafted. So the figure is
-- built from real rows, not an estimate or a constant.
--
-- BUT IT IS STILL A PROXY, AND THE UI MUST SAY SO. It is capacity DISPATCHED,
-- not litres delivered: a truck that ran half-full counts its full tank. It
-- answers "how much hauling capacity went out today" honestly and "how much
-- water was delivered" only approximately. The dictionary entry carries that
-- caveat and the chart must repeat it. The day trips start recording
-- tank_size_m3, this view gains a real measure and the proxy retires.
--
-- ===========================================================================
-- THE GAP THIS VIEW REFUSES TO HIDE
-- ===========================================================================
-- 2 of 154 delivered trips have NO truck_id. Their capacity is unknowable, so
-- they contribute to the trip COUNT and nothing to the capacity SUM. Rather
-- than let that quietly understate the bar, the view exposes
-- `trips_delivered_no_truck` per day so the UI can name the discrepancy — the
-- same call 0101 made when it kept driverless trips as an "Unassigned" row
-- instead of inner-joining them out of existence.
--
-- Live: 2 days carry such a trip. Every other day reconciles exactly.
--
-- ===========================================================================
-- WHY IT COMPOSES ON v_daily_operations
-- ===========================================================================
-- `trips_delivered` is NOT recounted here. It is read straight off
-- v_daily_operations (0104), which already publishes it per day and which
-- already reconciles to v_operations_monthly. Recounting it — even with an
-- identical predicate — would create a second definition of "a delivered
-- trip" that could drift from the P&L's. Composition makes disagreement
-- structurally impossible rather than merely unlikely.
--
-- Only the capacity sum and the no-truck count are new here.
--
-- ===========================================================================
-- ONE DELIBERATE DEVIATION FROM THE BRIEF — please rule on it
-- ===========================================================================
-- The brief specified "current month, by day". This view carries the FULL
-- 0104 spine instead, plus an `is_current_month` flag.
--
-- Reason: the revenue-vs-direct-cost card next to it has a month stepper,
-- because live data makes a current-month-only chart nearly empty — all
-- 70,650 SAR of confirmed revenue is in July, August has none, and August has
-- exactly ONE delivered trip (Aug 1) across 12 elapsed days. Two charts side
-- by side showing different months would be worse than either choice alone.
--
-- If you would rather have current-month-only, it is a one-predicate change
-- and nothing else in the file moves:
--   ... left join cap c on c.day = d.day
--   where d.month = date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date;
-- The UI reads `month` either way, so narrowing it does not break the chart —
-- it only removes the stepper's range.
--
-- ===========================================================================
-- DATES ARE ASIA/RIYADH
-- ===========================================================================
-- trips.trip_date is a plain DATE with no timezone, already recorded in local
-- terms, so the day buckets need no conversion. Riyadh matters for the ONE
-- derived date in this file: what counts as "the current month". That uses
-- `(now() at time zone 'Asia/Riyadh')::date`, matching 0103 and 0104 and the
-- app's own todayKey() helper. Using UTC current_date would flip the flag to
-- the wrong month for the last three hours of every month-end evening.
--
-- ===========================================================================
-- SECURITY
-- ===========================================================================
-- security_invoker = true, granted to authenticated, revoked from anon — the
-- rule 0098 set. Restated in the footer after the last create, so the file is
-- correct on a reset replay and not only on first apply (`create or replace
-- view` does not preserve reloptions).
--
-- READ-ONLY BY CONSTRUCTION. One view, one dictionary row. No table, column,
-- constraint, policy, RPC or row of operational data is altered.
-- ===========================================================================

begin;

create or replace view public.v_delivery_output_daily
with (security_invoker = true) as
  with cap as (
    -- The delivering truck's capacity, per day.
    --
    -- NO terminated_at FILTER, on purpose. A truck that has since been
    -- terminated still hauled that load; `terminated` is a pre-filter for
    -- ROSTERS, never a filter on history (CLAUDE.md section 6). Excluding it
    -- would silently shrink past months as trucks retire.
    --
    -- The join is many-to-one on trucks.id (primary key), so it cannot fan
    -- out and inflate the sum.
    select t.trip_date          as day,
           sum(tr.capacity_m3)  as capacity_m3,
           count(*)             as trips_with_truck
      from public.trips t
      join public.trucks tr on tr.id = t.truck_id
     where t.stage = 'delivered'
     group by 1
  )
  select d.day,
         d.month,
         -- The only derived date in this file. Riyadh, deliberately.
         ( d.month = date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date
         ) as is_current_month,
         -- READ, not recounted. v_daily_operations owns this definition.
         d.trips_delivered,
         coalesce(c.trips_with_truck, 0)::int                          as trips_delivered_with_truck,
         (d.trips_delivered - coalesce(c.trips_with_truck, 0))::int    as trips_delivered_no_truck,
         coalesce(c.capacity_m3, 0)                                    as capacity_m3
    from public.v_daily_operations d
    left join cap c on c.day = d.day;

comment on view public.v_delivery_output_daily is
  'Delivery Output per day: capacity_m3 is the sum of the DELIVERING TRUCK''s '
  'capacity over trips delivered that day — a PROXY for volume, because '
  'trips.tank_size_m3 is unpopulated on every row (0 of 203). It is capacity '
  'dispatched, not litres delivered; a half-full truck counts its full tank, '
  'and any UI showing it must say so. trips_delivered is read from '
  'v_daily_operations, never recounted, so it cannot disagree with the P&L or '
  'with v_operations_monthly. trips_delivered_no_truck is the honesty column: '
  'a delivered trip with no truck_id contributes to the count and nothing to '
  'the capacity sum, so the two can be reconciled on screen instead of the '
  'shortfall being invisible.';

-- ---------------------------------------------------------------------
-- DICTIONARY
-- ---------------------------------------------------------------------
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('delivery_output',
   'Delivery output',
   'How much hauling capacity went out on deliveries in a day, alongside how many trips it took.',
   'capacity_m3: sum of trucks.capacity_m3 over trips with stage = delivered on that trip_date, joined through trips.truck_id. trips_delivered: read directly from v_daily_operations, not recounted.',
   'count', 'one day', 'v_delivery_output_daily', 'operational',
   'capacity_m3 is a PROXY FOR VOLUME, not a measurement. trips.tank_size_m3 — the column that would hold real delivered volume — is unpopulated on all 203 trips, so this counts the full capacity of the truck that ran, whether or not it ran full. Read it as capacity dispatched. It also EXCLUDES delivered trips with no truck_id (2 of 154 live); those still count as trips, so trips_delivered can exceed what capacity_m3 accounts for — trips_delivered_no_truck reports exactly how many. Trucks are joined without a terminated_at filter on purpose: a since-terminated truck still hauled its historical loads.')
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

-- ---------------------------------------------------------------------
-- SECURITY — restated after the last create, per the replay rule.
-- ---------------------------------------------------------------------
alter view public.v_delivery_output_daily set (security_invoker = true);
revoke all on public.v_delivery_output_daily from anon;
grant select on public.v_delivery_output_daily to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE:
--      select c.relname, c.reloptions
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname = 'v_delivery_output_daily';
--      -- expect security_invoker=true
--      select has_table_privilege('anon','public.v_delivery_output_daily','select'),
--             has_table_privilege('authenticated','public.v_delivery_output_daily','select');
--      -- expect false, true
--
-- B) THE TRIP COUNT CANNOT DISAGREE WITH THE DAY GRAIN. Zero rows by
--    construction, but assert it anyway — expect 0 rows:
--      select v.day, v.trips_delivered, d.trips_delivered
--        from public.v_delivery_output_daily v
--        join public.v_daily_operations d using (day)
--       where v.trips_delivered <> d.trips_delivered;
--
-- C) ...NOR WITH THE MONTHLY OPERATIONS STATEMENT. Expect 0 rows:
--      select b.month, b.d as view_says, o.trips_delivered as reports_says
--        from (select month, sum(trips_delivered) as d
--                from public.v_delivery_output_daily group by month) b
--        join public.v_operations_monthly o using (month)
--       where b.d <> o.trips_delivered;
--
-- D) ...NOR WITH THE TRIPS TABLE ITSELF. Expect both columns equal (154/154
--    on today's data):
--      select (select sum(trips_delivered) from public.v_delivery_output_daily) as view_total,
--             (select count(*) from public.trips where stage = 'delivered')     as table_total;
--
-- E) THE 0103 CROSS-CHECK. The day grain's own "today" row must agree with
--    v_fleet_state_now, which counts trips on Riyadh today. Expect equal:
--      select d.trips_total as day_grain_today, f.trips_today as fleet_state_today
--        from public.v_daily_operations d
--        cross join public.v_fleet_state_now f
--       where d.day = (now() at time zone 'Asia/Riyadh')::date;
--
-- F) THE CAPACITY GAP IS ACCOUNTED FOR, NEVER NEGATIVE. Expect 0 rows:
--      select * from public.v_delivery_output_daily
--       where trips_delivered_no_truck < 0
--          or trips_delivered <> trips_delivered_with_truck + trips_delivered_no_truck;
--
--    And see it, so the UI's disclosure is checked against reality:
--      select day, trips_delivered, trips_delivered_with_truck,
--             trips_delivered_no_truck, capacity_m3
--        from public.v_delivery_output_daily
--       where trips_delivered_no_truck > 0 order by day;
--      -- expect 2 rows on today's data.
--
-- G) THE CURRENT-MONTH FLAG IS RIYADH-CORRECT:
--      select count(*) as current_month_days,
--             min(day) as first_day, max(day) as last_day
--        from public.v_delivery_output_daily where is_current_month;
--      -- expect first_day = the 1st of Riyadh's current month and
--      --        last_day  = Riyadh today (12 days on 2026-08-12).
--
-- H) WHAT THE CHART WILL SHOW — read before wiring:
--      select month, sum(trips_delivered) as trips, sum(capacity_m3) as capacity_m3
--        from public.v_delivery_output_daily group by month order by month;
--      -- On today's data the CURRENT month has exactly ONE delivered trip
--      -- (Aug 1). The month stepper is what makes this card readable at all
--      -- right now — see the deviation note in the header.
-- ===========================================================================
