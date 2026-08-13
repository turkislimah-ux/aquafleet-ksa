-- 0106_projects_costmix_drivers.sql
-- Three new Dashboard surfaces, plus the fix that stops driver state from
-- being defined twice.
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--   v_driver_state_now         per-driver operational state — THE definition
--   v_fleet_state_now          REPLACED: now counts from that view
--   v_drivers_ops_now          the Drivers Ops board
--   v_project_trip_stages      trips per active project, per stage
--   v_cost_composition_monthly cost by type and share, per month
--
-- READ-ONLY BY CONSTRUCTION. Every object is a view over existing tables. No
-- table, column, constraint, policy, RPC or row is altered, and nothing here
-- reads or writes the money core (lib/prepaid.ts, lib/vat.ts, FIFO ledgers).
--
-- ===========================================================================
-- 1) THE DRIFT FIX — WHY v_fleet_state_now IS BEING REPLACED
-- ===========================================================================
-- 0103 embedded the driver-state rule as a CTE inside v_fleet_state_now and
-- flagged it, in its own header, as "KNOWN DUPLICATION, ACCEPTED WITH A
-- GUARD" — a second expression of lib/driver-state.ts. Adding a Drivers Ops
-- board would have made it a THIRD, and three copies of a precedence rule
-- drift silently and disagree on screen.
--
-- So the CTE is lifted out into v_driver_state_now, and both v_fleet_state_now
-- and v_drivers_ops_now read it. That leaves exactly TWO expressions of the
-- rule — this view and the TypeScript helper — and the app ships a drift check
-- comparing them on live data.
--
-- v_fleet_state_now's OUTPUT IS UNCHANGED: same 13 columns, same order, same
-- types (trucks_total and drivers_total stay bigint from a bare count(*); the
-- rest stay ::int). The truck-state logic is copied across untouched. The
-- verification block below proves old and new agree before this is trusted.
--
-- ONE DELIBERATE IMPROVEMENT while moving it. 0103 wrote:
--     d.id not in (select driver_id from project_drivers_active)
-- `NOT IN` against a subquery containing a single NULL evaluates to NULL, not
-- true — every driver would fall through to 'active'. Live, project_drivers
-- has 0 NULL driver_id rows, so the output is identical today; this is a trap
-- disarmed before it fires, not a behaviour change. Rewritten as `not exists`,
-- which is NULL-safe and matches what the TypeScript does (a Set lookup).
--
-- ===========================================================================
-- 2) DRIVER STATE IS NOT "ON THE ROAD" — AND THE DATA PROVES IT
-- ===========================================================================
-- The four states are lib/driver-state.ts's, unchanged:
--     on_leave > off_duty (no truck) > idle (no active project) > active
-- `active` means ASSIGNED — a truck and a live project — NOT that the driver
-- is currently driving.
--
-- Those are genuinely different things here. Live, three drivers have
-- in-flight trips and NO assigned truck (Fahad 2: 2 trips, Khalid 3: 3,
-- mohammed 2: 4), so their canonical state is `off_duty` while they hold work
-- in progress. The Kanban already knows: ProjectsBoard blurs a non-delivered
-- card whose driver has no truck.
--
-- Renaming `active` to "on the road" would therefore have printed a falsehood
-- on three of eleven rows. Instead the board carries state and current trip
-- stage as SEPARATE columns, and exposes the contradiction itself
-- (`state_conflicts_with_trips`) rather than letting one column quietly
-- overrule the other.
--
-- ===========================================================================
-- 3) COMPLIANCE — "NOT RECORDED" IS NOT "OK"
-- ===========================================================================
-- Five of eleven live drivers have a NULL iqama_expiry. A missing date is not
-- a passing check, so the status vocabulary is four-valued —
--   expired | expiring_soon (<= 30 days) | ok | not_recorded
-- — and never collapses the last into the third. Dates are Asia/Riyadh, so a
-- licence does not expire three hours early.
--
-- ===========================================================================
-- 4) PROJECTS — MATCHING THE KANBAN, AND THE ONE DEVIATION
-- ===========================================================================
-- The project set is the Kanban's own, read out of ProjectsBoard rather than
-- assumed: `activeList = projects.filter(p => p.status === "active")` over a
-- query already filtered by `.is("archived_at", null)`. So:
--     archived_at is null AND status = 'active'
--
-- THE DEVIATION, STATED RATHER THAN HIDDEN: the Kanban is DAY-SCOPED. Its
-- single filter point is `dayTrips` (trip_date === selectedDay), so it shows
-- one day at a time. This view is NOT day-scoped — a per-project stage chart
-- restricted to one day would be nearly empty and would say nothing about the
-- shape of a project.
--
-- The two stay reconcilable because the PREDICATE is identical and only the
-- date window differs: filter this view to a day and it equals that day's
-- board; leave it open and it equals the project's whole trip history. The
-- verification block asserts both directions.
--
-- Trips with no project_id are excluded — the board puts them in a separate
-- "Direct customer trips" card, not under any project. Live that is 1 trip of
-- 676. Excluded from the CHART, not from the world: total_trips per project
-- plus that fallback is the whole table, and the check below proves it.
--
-- ===========================================================================
-- 5) COST COMPOSITION — SHARES OF PUBLISHED FIGURES, NOTHING RECOMPUTED
-- ===========================================================================
-- Every cost figure is read from v_pnl_monthly, which already publishes all
-- five: parts, outsourced, payroll, commissions and manual expenses. Reading
-- the one view rather than joining v_expenses_monthly separately means there
-- is no second path by which the Dashboard's "other" could differ from the
-- P&L's.
--
-- MONTHLY, NOT DAILY, and that is a data fact rather than a preference:
-- payroll is staff.monthly_salary_sar / drivers.salary_sar and non-trip
-- commission is keyed by a text month_key (0104). Neither has a daily source,
-- so only a monthly grain can show true composition.
--
-- SHARES ARE RECOMPUTED PER ROW, NEVER AVERAGED (0100's rule). Each month's
-- share is that month's figure over that month's own total. The denominator
-- is operating_cost_sar + expenses_sar, because manual expenses are their own
-- P&L section (0098 rule 8) and are NOT inside operating cost — so the
-- denominator is stated explicitly as total_cost_sar rather than borrowed
-- from a column that means something narrower.
--
-- ===========================================================================
-- SECURITY
-- ===========================================================================
-- Every view is security_invoker = true, granted to authenticated, revoked
-- from anon — the rule 0098 set and 0103/0104/0105 followed. The footer is
-- restated AFTER the last create, including for the REPLACED
-- v_fleet_state_now: `create or replace view` does NOT preserve reloptions,
-- so without the restatement a replay silently reverts it to owner-run and
-- bypasses RLS on 68 tables.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) DRIVER STATE — the single SQL definition.
-- ---------------------------------------------------------------------
-- Precedence and predicates are lib/driver-state.ts's, in its order:
--   onLeave -> on_leave; no truck -> off_duty; no active project -> idle;
--   otherwise active. Terminated drivers are a PRE-FILTER, never a state
--   (CLAUDE.md §6), so they do not appear at all.
create or replace view public.v_driver_state_now
with (security_invoker = true) as
  with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today)
  select d.id as driver_id,
         d.name,
         case
           when exists (
             select 1 from public.leave_periods lp, riyadh r
              where lp.driver_id = d.id
                and lp.start_date <= r.today
                and r.today <= lp.end_date
           )                                                    then 'on_leave'
           when not exists (
             select 1 from public.trucks tk
              where tk.assigned_driver_id = d.id
                and tk.terminated_at is null
           )                                                    then 'off_duty'
           when not exists (
             select 1 from public.project_drivers pd
               join public.projects p on p.id = pd.project_id
              where pd.driver_id = d.id
                and p.archived_at is null
           )                                                    then 'idle'
           else 'active'
         end as state
    from public.drivers d
   where d.terminated_at is null;

comment on view public.v_driver_state_now is
  'Operational state per non-terminated driver — the SQL definition, mirroring '
  'lib/driver-state.ts precedence exactly (on_leave > off_duty > idle > '
  'active). v_fleet_state_now counts from this and v_drivers_ops_now reads it, '
  'so there is one SQL expression of the rule rather than three. `active` means '
  'assigned a truck and a live project; it does NOT mean currently driving.';

-- ---------------------------------------------------------------------
-- 2) v_fleet_state_now — same output, driver counts now composed.
-- ---------------------------------------------------------------------
-- Truck logic is 0103's, copied unchanged. Only the driver_state CTE is gone,
-- replaced by counts over v_driver_state_now. Column names, order and types
-- are preserved exactly: trucks_total/drivers_total stay bare count(*)
-- (bigint), every other count keeps its ::int.
create or replace view public.v_fleet_state_now
with (security_invoker = true) as
  with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today),
  busy_trucks as (
    select truck_id from public.work_orders     where status = 'in_progress' and truck_id is not null
    union
    select truck_id from public.outsourced_jobs where status = 'in_progress' and truck_id is not null
  ),
  truck_state as (
    select case
             when t.id in (select truck_id from busy_trucks) then 'maintenance'
             when t.assigned_driver_id is not null           then 'active'
             else 'idle'
           end as state
    from public.trucks t
    where t.terminated_at is null
  )
  select
    (select count(*) from truck_state)                                   as trucks_total,
    (select count(*) from truck_state where state = 'active')::int       as trucks_active,
    (select count(*) from truck_state where state = 'idle')::int         as trucks_idle,
    (select count(*) from truck_state where state = 'maintenance')::int  as trucks_maintenance,
    (select count(*) from public.v_driver_state_now)                     as drivers_total,
    (select count(*) from public.v_driver_state_now where state = 'active')::int   as drivers_active,
    (select count(*) from public.v_driver_state_now where state = 'idle')::int     as drivers_idle,
    (select count(*) from public.v_driver_state_now where state = 'off_duty')::int as drivers_off_duty,
    (select count(*) from public.v_driver_state_now where state = 'on_leave')::int as drivers_on_leave,
    -- No date predicate here on purpose: "in flight" is a stage, not a day.
    (select count(*) from public.trips t
      where t.stage in ('scheduled','loading','in_transit'))::int        as trips_in_flight,
    (select count(*) from public.trips t, riyadh r
      where t.trip_date = r.today)::int                                  as trips_today,
    (select count(*) from public.work_orders
      where status = 'in_progress')::int                                 as work_orders_running,
    (select count(*) from public.outsourced_jobs
      where status = 'in_progress')::int                                 as outsourced_running;

comment on view public.v_fleet_state_now is
  'Dashboard current-state counts. Truck state mirrors lib/truck-status.ts; '
  'driver counts are composed from v_driver_state_now (0106) rather than '
  'restating the rule, so the two cannot disagree. Dates are Asia/Riyadh. A '
  'drift check asserts the driver view and lib/driver-state.ts agree.';

-- ---------------------------------------------------------------------
-- 3) DRIVERS OPS — the live status board.
-- ---------------------------------------------------------------------
create or replace view public.v_drivers_ops_now
with (security_invoker = true) as
  with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today),
  -- Most-ADVANCED in-flight trip per driver. Ranked, not counted: a driver
  -- part-way through several trips is reported at the furthest one along.
  in_flight as (
    select t.driver_id,
           max(case t.stage when 'in_transit' then 3
                            when 'loading'    then 2
                            when 'scheduled'  then 1 end) as rank,
           count(*)::int as in_flight_trips
      from public.trips t
     where t.driver_id is not null
       and t.stage in ('scheduled','loading','in_transit')
     group by t.driver_id
  ),
  -- Expiry status per document. A NULL date is 'not_recorded', NEVER 'ok' —
  -- five of eleven live drivers have no iqama_expiry, and rendering that as
  -- a passing check would be a fabricated all-clear.
  compliance as (
    select d.id as driver_id,
           case when d.license_expiry is null then 'not_recorded'
                when d.license_expiry <  r.today then 'expired'
                when d.license_expiry <= r.today + 30 then 'expiring_soon'
                else 'ok' end as license_status,
           case when d.iqama_expiry is null then 'not_recorded'
                when d.iqama_expiry <  r.today then 'expired'
                when d.iqama_expiry <= r.today + 30 then 'expiring_soon'
                else 'ok' end as iqama_status
      from public.drivers d, riyadh r
     where d.terminated_at is null
  )
  select s.driver_id,
         s.name,
         s.state,
         (select tk.plate from public.trucks tk
           where tk.assigned_driver_id = s.driver_id
             and tk.terminated_at is null
           order by tk.plate limit 1)                       as truck_plate,
         case f.rank when 3 then 'in_transit'
                     when 2 then 'loading'
                     when 1 then 'scheduled' end            as trip_stage,
         coalesce(f.in_flight_trips, 0)                     as in_flight_trips,
         c.license_status,
         c.iqama_status,
         -- Worst of the two, for sorting and for one pill per row. Ordered by
         -- severity, with not_recorded ABOVE ok: an unknown expiry is a gap to
         -- close, not a clean bill of health.
         case when 'expired'       in (c.license_status, c.iqama_status) then 'expired'
              when 'expiring_soon' in (c.license_status, c.iqama_status) then 'expiring_soon'
              when 'not_recorded'  in (c.license_status, c.iqama_status) then 'not_recorded'
              else 'ok' end                                 as compliance_status,
         d.license_expiry,
         d.iqama_expiry,
         -- THE CONTRADICTION, SURFACED RATHER THAN RESOLVED. A driver with no
         -- truck is off_duty by the canonical rule, yet may hold in-flight
         -- trips — live, three do. Neither column is wrong; the pairing is.
         -- The Kanban already blurs these cards, and this flag is the same
         -- signal in the same words rather than a fourth opinion.
         (s.state in ('off_duty','on_leave') and coalesce(f.in_flight_trips, 0) > 0)
                                                            as state_conflicts_with_trips
    from public.v_driver_state_now s
    join public.drivers d   on d.id = s.driver_id
    join compliance c       on c.driver_id = s.driver_id
    left join in_flight f   on f.driver_id = s.driver_id;

comment on view public.v_drivers_ops_now is
  'Live per-driver board: canonical state (from v_driver_state_now), assigned '
  'truck, most-advanced in-flight trip stage, and licence/iqama compliance. '
  'State and trip stage are SEPARATE columns on purpose — `active` means '
  'assigned, not driving, and state_conflicts_with_trips marks the rows where '
  'the two genuinely disagree. A NULL expiry reads not_recorded, never ok.';

-- ---------------------------------------------------------------------
-- 4) PROJECTS — trips per active project, per stage.
-- ---------------------------------------------------------------------
-- Project predicate is the Kanban's own (archived_at is null AND status =
-- 'active'). NOT day-scoped — see the header for why, and for how the two
-- stay reconcilable. left join so a project with no trips still appears as a
-- zero row rather than vanishing from the chart.
create or replace view public.v_project_trip_stages
with (security_invoker = true) as
  select p.id   as project_id,
         p.name as project_name,
         count(*) filter (where t.stage = 'scheduled')::int  as scheduled,
         count(*) filter (where t.stage = 'loading')::int    as loading,
         count(*) filter (where t.stage = 'in_transit')::int as in_transit,
         count(*) filter (where t.stage = 'delivered')::int  as delivered,
         count(t.id)::int                                    as total_trips,
         count(*) filter (
           where t.stage in ('scheduled','loading','in_transit')
         )::int                                              as in_flight_trips
    from public.projects p
    left join public.trips t on t.project_id = p.id
   where p.archived_at is null
     and p.status = 'active'
   group by p.id, p.name;

comment on view public.v_project_trip_stages is
  'Trips per ACTIVE project (archived_at is null and status = active — the '
  'Kanban Projects board predicate), split across the four stages. Unlike the '
  'board this is NOT day-scoped: filtered to one trip_date it equals that '
  'day''s board, unfiltered it is the project''s whole history. Trips with no '
  'project are excluded here, matching the board, which shows them in its own '
  'Direct-customer card instead.';

-- ---------------------------------------------------------------------
-- 5) COST COMPOSITION — by type and share, per month.
-- ---------------------------------------------------------------------
-- Every figure is read from v_pnl_monthly. Nothing is recomputed; the shares
-- are proportions of already-published numbers, recomputed per month rather
-- than averaged across months (0100).
create or replace view public.v_cost_composition_monthly
with (security_invoker = true) as
  select pl.month,
         pl.parts_cost_sar   as parts_sar,
         pl.os_cost_sar      as outsourced_sar,
         pl.payroll_sar,
         pl.commissions_sar,
         pl.expenses_sar     as other_expenses_sar,
         -- Stated explicitly: operating_cost_sar covers only the four
         -- operational buckets. Manual expenses are their own P&L section
         -- (0098 rule 8), so the denominator has to name them.
         (pl.operating_cost_sar + pl.expenses_sar) as total_cost_sar,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0
              then round(pl.parts_cost_sar   / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as parts_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0
              then round(pl.os_cost_sar      / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as outsourced_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0
              then round(pl.payroll_sar      / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as payroll_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0
              then round(pl.commissions_sar  / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as commissions_pct,
         case when (pl.operating_cost_sar + pl.expenses_sar) > 0
              then round(pl.expenses_sar     / (pl.operating_cost_sar + pl.expenses_sar) * 100, 1) end as other_expenses_pct
    from public.v_pnl_monthly pl;

comment on view public.v_cost_composition_monthly is
  'Operating cost split five ways per month — parts, outsourced, payroll, '
  'commissions, other expenses — with each as a share of that month''s total. '
  'Every figure is read from v_pnl_monthly, so the Dashboard cannot disagree '
  'with the P&L. MONTHLY by necessity, not preference: payroll and non-trip '
  'commission have no daily source (0104). A month with no cost returns NULL '
  'shares rather than a fabricated 0%.';

-- ---------------------------------------------------------------------
-- 6) SECURITY — all five views, restated after the last create because
--    `create or replace view` does not preserve reloptions.
-- ---------------------------------------------------------------------
alter view public.v_driver_state_now         set (security_invoker = true);
alter view public.v_fleet_state_now          set (security_invoker = true);
alter view public.v_drivers_ops_now          set (security_invoker = true);
alter view public.v_project_trip_stages      set (security_invoker = true);
alter view public.v_cost_composition_monthly set (security_invoker = true);

revoke all on public.v_driver_state_now         from anon;
revoke all on public.v_fleet_state_now          from anon;
revoke all on public.v_drivers_ops_now          from anon;
revoke all on public.v_project_trip_stages      from anon;
revoke all on public.v_cost_composition_monthly from anon;

grant select on public.v_driver_state_now         to authenticated;
grant select on public.v_fleet_state_now          to authenticated;
grant select on public.v_drivers_ops_now          to authenticated;
grant select on public.v_project_trip_stages      to authenticated;
grant select on public.v_cost_composition_monthly to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. All five must report security_invoker=true. Check
--    v_fleet_state_now hardest: it was REPLACED, and a replace drops
--    reloptions.
--      select c.relname, c.reloptions
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname in ('v_driver_state_now','v_fleet_state_now',
--                           'v_drivers_ops_now','v_project_trip_stages',
--                           'v_cost_composition_monthly');
--
--    anon must not read any of them (expect false x5):
--      select has_table_privilege('anon','public.v_driver_state_now','select'),
--             has_table_privilege('anon','public.v_fleet_state_now','select'),
--             has_table_privilege('anon','public.v_drivers_ops_now','select'),
--             has_table_privilege('anon','public.v_project_trip_stages','select'),
--             has_table_privilege('anon','public.v_cost_composition_monthly','select');
--
-- B) v_fleet_state_now IS UNCHANGED. Its driver counts must still equal the
--    rule as 0103 wrote it, computed independently here. Expect 0 rows:
--      with old_rule as (
--        select case
--          when d.id in (select lp.driver_id from public.leave_periods lp
--                         where lp.driver_id is not null
--                           and lp.start_date <= (now() at time zone 'Asia/Riyadh')::date
--                           and (now() at time zone 'Asia/Riyadh')::date <= lp.end_date)
--               then 'on_leave'
--          when not exists (select 1 from public.trucks tk
--                            where tk.assigned_driver_id = d.id and tk.terminated_at is null)
--               then 'off_duty'
--          when d.id not in (select distinct pd.driver_id from public.project_drivers pd
--                              join public.projects p on p.id = pd.project_id
--                             where p.archived_at is null)
--               then 'idle'
--          else 'active' end as state
--        from public.drivers d where d.terminated_at is null
--      )
--      select * from public.v_fleet_state_now f
--       where f.drivers_total    <> (select count(*) from old_rule)
--          or f.drivers_active   <> (select count(*) from old_rule where state='active')
--          or f.drivers_idle     <> (select count(*) from old_rule where state='idle')
--          or f.drivers_off_duty <> (select count(*) from old_rule where state='off_duty')
--          or f.drivers_on_leave <> (select count(*) from old_rule where state='on_leave');
--
--    And the composition holds — expect 0 rows:
--      select * from public.v_fleet_state_now f
--       where f.drivers_total <> (select count(*) from public.v_driver_state_now)
--          or f.drivers_active <> (select count(*) from public.v_driver_state_now where state='active');
--
--    Column shape preserved (13 columns, bigint on the two totals):
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_fleet_state_now'
--       order by ordinal_position;
--
-- C) PROJECTS RECONCILE TO THE TRIPS TABLE, BOTH DIRECTIONS.
--
--    Per project and stage, against the base table — expect 0 rows:
--      select v.project_name, v.scheduled, v.loading, v.in_transit, v.delivered
--        from public.v_project_trip_stages v
--        join (
--          select t.project_id,
--                 count(*) filter (where t.stage='scheduled')::int  s,
--                 count(*) filter (where t.stage='loading')::int    l,
--                 count(*) filter (where t.stage='in_transit')::int i,
--                 count(*) filter (where t.stage='delivered')::int  d
--            from public.trips t group by t.project_id
--        ) b on b.project_id = v.project_id
--       where v.scheduled <> b.s or v.loading <> b.l
--          or v.in_transit <> b.i or v.delivered <> b.d;
--
--    The four stages account for every trip — expect 0 rows:
--      select * from public.v_project_trip_stages
--       where scheduled + loading + in_transit + delivered <> total_trips;
--
--    Nothing is lost: view total + trips with no project + trips on
--    non-active projects = the whole table.
--      select (select coalesce(sum(total_trips),0) from public.v_project_trip_stages)
--             + (select count(*) from public.trips t
--                 where t.project_id is null
--                    or not exists (select 1 from public.projects p
--                                    where p.id = t.project_id
--                                      and p.archived_at is null and p.status='active'))
--             as accounted,
--             (select count(*) from public.trips) as trips_total;
--      -- the two must be equal.
--
--    THE KANBAN CHECK. Filtered to one day, the view's predicate must equal
--    what the board renders for that day — expect 0 rows:
--      select p.name, b.stage, b.n
--        from (select t.project_id, t.stage, count(*)::int n
--                from public.trips t
--               where t.trip_date = (now() at time zone 'Asia/Riyadh')::date
--               group by 1,2) b
--        join public.projects p on p.id = b.project_id
--       where not (p.archived_at is null and p.status = 'active')
--         and b.project_id is not null;
--      -- i.e. every project the board would draw a card for today is one this
--      -- view also covers. Rows here mean the two predicates have diverged.
--
-- D) DRIVERS OPS.
--      select * from public.v_drivers_ops_now
--       order by compliance_status, state, name;
--      -- one row per non-terminated driver, no more:
--      select (select count(*) from public.v_drivers_ops_now) as ops_rows,
--             (select count(*) from public.drivers where terminated_at is null) as live_drivers;
--
--    A NULL expiry must never read 'ok' — expect 0 rows:
--      select driver_id, license_expiry, license_status, iqama_expiry, iqama_status
--        from public.v_drivers_ops_now
--       where (license_expiry is null and license_status <> 'not_recorded')
--          or (iqama_expiry   is null and iqama_status   <> 'not_recorded');
--
--    trip_stage is set exactly when there are in-flight trips — expect 0 rows:
--      select * from public.v_drivers_ops_now
--       where (in_flight_trips > 0) <> (trip_stage is not null);
--
--    Expect the conflict flag to be TRUE for the drivers who hold in-flight
--    trips with no assigned truck (live: Fahad 2, Khalid 3, mohammed 2):
--      select name, state, truck_plate, in_flight_trips, state_conflicts_with_trips
--        from public.v_drivers_ops_now where state_conflicts_with_trips;
--
-- E) COST COMPOSITION reconciles to the P&L — expect 0 rows:
--      select c.month, c.total_cost_sar, pl.operating_cost_sar, pl.expenses_sar
--        from public.v_cost_composition_monthly c
--        join public.v_pnl_monthly pl using (month)
--       where c.parts_sar          <> pl.parts_cost_sar
--          or c.outsourced_sar     <> pl.os_cost_sar
--          or c.payroll_sar        <> pl.payroll_sar
--          or c.commissions_sar    <> pl.commissions_sar
--          or c.other_expenses_sar <> pl.expenses_sar
--          or c.total_cost_sar     <> pl.operating_cost_sar + pl.expenses_sar;
--
--    The five parts sum to the total — expect 0 rows:
--      select * from public.v_cost_composition_monthly
--       where parts_sar + outsourced_sar + payroll_sar + commissions_sar
--             + other_expenses_sar <> total_cost_sar;
--
--    Shares sum to ~100 for any month with cost (rounding to 1dp can leave
--    +/- 0.1) — inspect, do not assert equality:
--      select month, parts_pct, outsourced_pct, payroll_pct, commissions_pct,
--             other_expenses_pct,
--             parts_pct + outsourced_pct + payroll_pct + commissions_pct
--               + other_expenses_pct as total_pct
--        from public.v_cost_composition_monthly order by month;
-- ===========================================================================
