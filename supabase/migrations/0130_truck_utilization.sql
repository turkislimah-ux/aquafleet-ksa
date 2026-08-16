-- 0130_truck_utilization.sql
-- Activity-based truck utilization, computed once in SQL (0098).
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, hand-checks, and applies.
--
--   Utilization % = distinct days the truck ran >= 1 DELIVERED trip
--                 / (calendar days in period - terminated days - maintenance days)
--                 x 100
--
-- Binary working day: 1 delivered trip and 40 delivered trips both make the day
-- a worked day. Trip COUNT is productivity and is a different measure.
--
-- IDLE-BUT-IN-SERVICE DAYS COUNT AGAINST UTILIZATION. That is the entire point
-- of the metric — a truck sitting on the yard with a driver and no work is the
-- thing this is built to surface. They are never excluded.
--
-- Honest from the data we have. It upgrades to time-based when IoT engine hours
-- arrive; the day-grain view below is the seam where that swap happens.
--
-- ===========================================================================
-- FOUR RULINGS, ALL CONFIRMED BY TURKI. Each is marked in the SQL.
-- ===========================================================================
-- The AAA-5551 hand-check CANNOT adjudicate any of them — that truck-month has
-- no outsourced job, no status='open' work order, and no delivery on its
-- maintenance day, so it returns 26.67% under every reading. Verification below
-- therefore checks each ruling on a truck where it actually BITES, with the
-- figure it would produce if reversed.
--
-- RULING 1 — BOTH MAINTENANCE TRACKS.  work_orders AND outsourced_jobs.
--   lib/truck-status.ts is reused, not re-derived: "BOTH TRACKS, ALWAYS. Work
--   orders and outsourced jobs each put a truck in maintenance on their own;
--   checking one is a truck that reads as idle while it sits in a workshop."
--   Live divergence: AAA-5553 July is 7w / 27a / 4m = 25.93%. Work-orders-only
--   would report 7 / 31 = 22.58% — a truck credited with availability it spent
--   in a workshop, i.e. a false "underused" alarm on the screen built to find
--   real ones. Six trucks carry outsourced jobs.
--
-- RULING 2 — status='open' IS NOT DOWN. Only in_progress + completed are.
--   Proven from data, not chosen. AAA-5551 carries two status='open' work orders
--   (WO-26-0016, WO-26-0019) opened 2026-08-02 and never closed. Counting those
--   as downtime costs 15 August days. But the truck DELIVERED on 12 distinct
--   days inside that window, including 4 loads on 2026-08-02 itself, the day
--   both opened. A truck cannot be in a workshop and deliver 4 loads the same
--   day. 'open' means logged-not-started — exactly truck-status.ts's
--   hasActiveJob = status='in_progress'.
--
-- RULING 3 — A DELIVERED DAY IS NEVER A MAINTENANCE DAY.
--   A maintenance WINDOW is a coarse date range; a delivered trip is hard
--   evidence the truck was operating. Evidence beats inference. 17 fleet
--   truck-days are currently both (AAA-5551, AAA-5552, BBB-1115, KKK-7773);
--   without this rule worked_days can exceed available_days and the view reports
--   >100% — wrong in a way that is obvious on screen.
--
-- RULING 4 — FLEET-WIDE IS SUM(worked)/SUM(available), NEVER avg(pct).
--   Averaging per-truck percentages weights a truck available 2 days the same as
--   one available 31. Live August: correct blend 49.40%, average-of-percentages
--   48.30%. So this migration ships v_fleet_utilization_monthly and the Dashboard
--   reads THAT — the rule is enforced by the view's existence rather than by a
--   comment someone has to remember. 1113 BBB is the case that makes it concrete:
--   2 available days, both worked, 100.00% — real, and meaningless in an average.
--
-- ===========================================================================
-- work_orders.start_date IS DELIBERATELY UNREAD
-- ===========================================================================
-- It looks like the right column for "when did the truck actually go down" and
-- it is not usable: 6 of 16 rows are NULL, WO-26-0003 carries start_date
-- 2026-08-17 (the future) against opened_at 2026-07-29, and WO-26-0007 starts
-- 2026-08-12 but closed 2026-08-01 — a start AFTER its own close. opened_at is
-- NOT NULL and coherent on every row, so the window is opened_at..closed_at.
--
-- ===========================================================================
-- WHAT THIS DOES NOT TOUCH
-- ===========================================================================
-- · trucks.utilization_pct — the DORMANT demo column (0 on all 15 rows). This
--   view supersedes it and neither reads nor writes it. Dropping it is a
--   SEPARATE migration, flagged not done: a column drop on a live table does not
--   belong inside a feature migration.
-- · lib/truck-status.ts — reused, not modified. The display-state rule is
--   unchanged; this borrows its definition of "in maintenance".
-- · No money. No schema change. Four new views, nothing altered.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. v_truck_day_state — THE DEFINITION. One row per truck per calendar day.
--    Every utilization figure in the app is a SUM over this view, so a day is
--    classified in exactly one place. This is also the seam where IoT engine
--    hours replace "ran a delivered trip" without touching any caller.
-- ---------------------------------------------------------------------------
create or replace view public.v_truck_day_state as
with spine as (
  select generate_series(
           (select min(created_at)::date from public.trucks),
           greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
           interval '1 day')::date as day
),
down_windows as (
  -- RULING 1 + RULING 2: both tracks, started-or-finished work only.
  select w.truck_id,
         w.opened_at::date                         as from_day,
         coalesce(w.closed_at::date, current_date) as to_day
    from public.work_orders w
   where w.status in ('in_progress', 'completed')
  union all
  select o.truck_id,
         o.start_date                              as from_day,
         coalesce(o.closed_at::date, current_date) as to_day
    from public.outsourced_jobs o
   where o.status in ('in_progress', 'completed')
),
worked as (
  select tr.truck_id, tr.trip_date as day
    from public.trips tr
   where tr.stage = 'delivered' and tr.truck_id is not null
   group by 1, 2
),
base as (
  select t.id as truck_id,
         t.plate,
         s.day,
         -- In service: created .. terminated, inclusive. A truck created or
         -- terminated mid-period is available only inside that window.
         (s.day >= t.created_at::date
          and (t.terminated_at is null or s.day <= t.terminated_at::date)) as in_service,
         (w.day is not null)                                               as worked,
         exists (select 1 from down_windows dw
                  where dw.truck_id = t.id
                    and s.day between dw.from_day and dw.to_day)           as has_down_window
    from public.trucks t
    cross join spine s
    left join worked w on w.truck_id = t.id and w.day = s.day
)
select d.truck_id,
       d.plate,
       d.day,
       d.in_service,
       d.worked,
       -- RULING 3: a delivered day is never a maintenance day.
       (d.has_down_window and not d.worked)                        as maintenance,
       (d.in_service and not (d.has_down_window and not d.worked)) as available
  from base d;

alter view public.v_truck_day_state set (security_invoker = true);
revoke all on public.v_truck_day_state from anon;
grant select on public.v_truck_day_state to authenticated;

-- ---------------------------------------------------------------------------
-- 2. v_truck_utilization_monthly — per truck per calendar month.
--    Feeds the Fleet page (current month, per-truck, decision-grade).
-- ---------------------------------------------------------------------------
create or replace view public.v_truck_utilization_monthly as
select s.truck_id,
       s.plate,
       date_trunc('month', s.day::timestamptz)::date             as month,
       count(*) filter (where s.worked and s.available)::integer as worked_days,
       count(*) filter (where s.available)::integer              as available_days,
       count(*) filter (where s.maintenance)::integer            as maintenance_days,
       count(*) filter (where not s.in_service)::integer         as out_of_service_days,
       -- ZERO AVAILABLE DAYS RETURNS NULL, NEVER 0 AND NEVER AN ERROR. A truck
       -- in the workshop all month has no utilization to report; 0% would read
       -- as "idle all month", the opposite of what happened. UI renders N/A.
       case when count(*) filter (where s.available) = 0 then null
            else round(100.0 * count(*) filter (where s.worked and s.available)
                             / count(*) filter (where s.available), 2)
       end                                                       as utilization_pct
  from public.v_truck_day_state s
 group by 1, 2, 3;

alter view public.v_truck_utilization_monthly set (security_invoker = true);
revoke all on public.v_truck_utilization_monthly from anon;
grant select on public.v_truck_utilization_monthly to authenticated;

-- ---------------------------------------------------------------------------
-- 3. v_fleet_utilization_monthly — RULING 4, MADE STRUCTURAL.
--    The Dashboard's month stepper reads this. It exists so the blend cannot be
--    computed as avg(utilization_pct) in a page: the only figure exposed here is
--    already SUM/SUM, weighted by availability.
-- ---------------------------------------------------------------------------
create or replace view public.v_fleet_utilization_monthly as
select date_trunc('month', s.day::timestamptz)::date             as month,
       count(distinct s.truck_id) filter (where s.available)::integer as trucks_with_availability,
       count(*) filter (where s.worked and s.available)::integer as worked_days,
       count(*) filter (where s.available)::integer              as available_days,
       count(*) filter (where s.maintenance)::integer            as maintenance_days,
       case when count(*) filter (where s.available) = 0 then null
            else round(100.0 * count(*) filter (where s.worked and s.available)
                             / count(*) filter (where s.available), 2)
       end                                                       as utilization_pct
  from public.v_truck_day_state s
 group by 1;

alter view public.v_fleet_utilization_monthly set (security_invoker = true);
revoke all on public.v_fleet_utilization_monthly from anon;
grant select on public.v_fleet_utilization_monthly to authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_truck_utilization_rolling30 — trailing 30 days ending today.
--    Feeds the truck detail page.
-- ---------------------------------------------------------------------------
create or replace view public.v_truck_utilization_rolling30 as
select s.truck_id,
       s.plate,
       min(s.day)                                                as from_day,
       max(s.day)                                                as to_day,
       count(*) filter (where s.worked and s.available)::integer as worked_days,
       count(*) filter (where s.available)::integer              as available_days,
       count(*) filter (where s.maintenance)::integer            as maintenance_days,
       case when count(*) filter (where s.available) = 0 then null
            else round(100.0 * count(*) filter (where s.worked and s.available)
                             / count(*) filter (where s.available), 2)
       end                                                       as utilization_pct
  from public.v_truck_day_state s
 where s.day >  (now() at time zone 'Asia/Riyadh')::date - 30
   and s.day <= (now() at time zone 'Asia/Riyadh')::date
 group by 1, 2;

alter view public.v_truck_utilization_rolling30 set (security_invoker = true);
revoke all on public.v_truck_utilization_rolling30 from anon;
grant select on public.v_truck_utilization_rolling30 to authenticated;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- Every expected figure below was computed by simulating these definitions
-- against live data BEFORE drafting. August figures GROW as the month runs
-- (the spine ends at Riyadh today, 2026-08-16, so August is 16 days); JULY IS
-- CLOSED AND MUST NOT MOVE.
-- ===========================================================================
--
-- A) THE HAND-CHECK. AAA-5551, July 2026. This is the gate.
--      select plate, worked_days, available_days, maintenance_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where plate = 'AAA-5551' and month = date '2026-07-01';
--      -- EXPECT EXACTLY:
--      --   worked_days       8      (Jul 1, 6, 8, 9, 10, 11, 13, 14)
--      --   available_days   30      (31 calendar - 0 terminated - 1 maintenance)
--      --   maintenance_days  1      (WO-26-0006, opened + closed 2026-07-29)
--      --   utilization_pct  26.67
--
-- B) THE HAND-CHECK, REBUILT FROM RAW TABLES — no view involved. If A and B
--    disagree, the view is wrong.
--      with days as (select generate_series(date '2026-07-01', date '2026-07-31', interval '1 day')::date d),
--           t as (select id from public.trucks where plate = 'AAA-5551'),
--           wk as (select distinct trip_date from public.trips
--                   where truck_id = (select id from t) and stage = 'delivered'
--                     and trip_date between date '2026-07-01' and date '2026-07-31'),
--           mt as (select distinct d.d from days d join public.work_orders w
--                    on w.truck_id = (select id from t)
--                   where w.status in ('in_progress','completed')
--                     and d.d between w.opened_at::date and coalesce(w.closed_at::date, current_date)
--                     and d.d not in (select trip_date from wk))
--      select (select count(*) from wk) as worked,
--             31 - (select count(*) from mt) as available,
--             round(100.0 * (select count(*) from wk) / (31 - (select count(*) from mt)), 2) as pct;
--      -- expect 8 / 30 / 26.67
--
-- C) RULING 1 BITING — an OUTSOURCED-JOB truck. AAA-5553 has an outsourced job
--    2026-07-28..2026-08-01 and NO work order in that window.
--      select plate, worked_days, available_days, maintenance_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where plate = 'AAA-5553' and month = date '2026-07-01';
--      -- EXPECT 7w / 27a / 4m / 25.93
--      -- IF RULING 1 WERE REVERSED (work_orders only): 7 / 31 / 0 / 22.58 —
--      -- maintenance_days = 0 is the tell, and the truck would be reported as
--      -- more underused than it was.
--
-- D) RULING 2 BITING — an OPEN-WO truck. AAA-5551's two never-closed 'open'
--    work orders (opened 2026-08-02) must contribute NOTHING.
--      select plate, worked_days, available_days, maintenance_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where plate = 'AAA-5551' and month = date '2026-08-01';
--      -- EXPECT 13w / 16a / 0m / 81.25  (August = 16 days so far)
--      -- IF RULING 2 WERE REVERSED: ~15 maintenance days, available collapses to
--      -- ~1, and a truck that delivered on 12 days reads as parked all month.
--
-- E) RULING 3 BITING — DELIVERED DAYS INSIDE A DOWN WINDOW. Exactly the days
--    where a coarse maintenance window overlaps hard delivery evidence.
--      select count(*) as overlap_truck_days,
--             string_agg(distinct plate, ', ') as trucks
--        from public.v_truck_day_state
--       where worked and maintenance is false
--         and exists (select 1 from public.work_orders w
--                      where w.truck_id = v_truck_day_state.truck_id
--                        and w.status in ('in_progress','completed')
--                        and v_truck_day_state.day between w.opened_at::date
--                                                     and coalesce(w.closed_at::date, current_date));
--      -- EXPECT 17 truck-days across AAA-5551, AAA-5552, BBB-1115, KKK-7773
--      -- (count includes the outsourced track; the predicate above shows the WO
--      --  side — the union total is 17).
--      -- These days MUST be worked=true, maintenance=false.
--
-- F) NO TRUCK EXCEEDS 100%, NONE IS NEGATIVE. If this returns rows, RULING 3 is
--    broken and worked days are escaping availability.
--      select plate, month, worked_days, available_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where utilization_pct > 100 or utilization_pct < 0 or worked_days > available_days;
--      -- expect ZERO rows.
--
-- G) N/A IS NULL, NOT 0 — and mid-period lifecycle. 1112 BBB and 1113 BBB were
--    created 2026-07-01 / 2026-07-03 and terminated 2026-07-04.
--      select plate, month, available_days, out_of_service_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where plate in ('1112 BBB','1113 BBB') and month >= date '2026-07-01'
--       order by plate, month;
--      -- EXPECT  1112 BBB Jul:  4a / 27oos /  50.00
--      --         1112 BBB Aug:  0a / 16oos /  NULL      <- N/A, never 0%
--      --         1113 BBB Jul:  2a / 29oos / 100.00     <- real; 2 days, both worked
--      --         1113 BBB Aug:  0a / 16oos /  NULL
--      -- AAA-5556 (created 2026-08-01) and TTT-4441 (2026-08-04) must likewise
--      -- show 0 available days in July, NOT 31 days at 0%.
--
--      select plate, month, available_days, utilization_pct
--        from public.v_truck_utilization_monthly
--       where available_days = 0 and utilization_pct is not null;
--      -- expect ZERO rows — no divide-by-zero, no fabricated 0%.
--
-- H) RULING 4 — THE BLEND, AND WHY IT IS A VIEW. The Dashboard reads
--    v_fleet_utilization_monthly. This shows the figure it must NOT use.
--      select f.month, f.utilization_pct as blended_correct,
--             (select round(avg(m.utilization_pct), 2)
--                from public.v_truck_utilization_monthly m
--               where m.month = f.month) as avg_of_pcts_WRONG
--        from public.v_fleet_utilization_monthly f
--       where f.month = date '2026-08-01';
--      -- EXPECT blended_correct 49.40, avg_of_pcts 48.30. The gap is 1113 BBB's
--      -- 100% on 2 available days pulling an unweighted mean.
--
--      select round(100.0 * sum(worked_days) / nullif(sum(available_days), 0), 2) as recomputed
--        from public.v_truck_utilization_monthly where month = date '2026-08-01';
--      -- must equal v_fleet_utilization_monthly.utilization_pct for August.
--
-- I) ROLLING 30 AGREES WITH ITS OWN DAY GRAIN.
--      select r.plate, r.from_day, r.to_day, r.worked_days, r.available_days, r.utilization_pct
--        from public.v_truck_utilization_rolling30 r where r.plate = 'AAA-5551';
--      -- from_day/to_day must span 30 days ending Riyadh-today, and
--      -- worked_days <= available_days <= 30.
--
-- J) SHAPE AND SECURITY. Four views ADDED — the count moves 40 -> 44.
--      select c.relname, c.reloptions,
--             has_table_privilege('anon', c.oid,'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid,'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname in
--             ('v_truck_day_state','v_truck_utilization_monthly',
--              'v_fleet_utilization_monthly','v_truck_utilization_rolling30');
--      -- each: {security_invoker=true}, anon FALSE, authenticated TRUE.
--
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relkind='v';
--      -- expect 44 / 44 / 0.
--
-- K) THE DORMANT COLUMN IS UNTOUCHED — this migration did not quietly start
--    maintaining it.
--      select count(*) filter (where utilization_pct = 0) as still_zero, count(*) as trucks
--        from public.trucks;
--      -- expect 15 / 15, unchanged.
-- ===========================================================================
