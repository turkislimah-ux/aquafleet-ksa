-- 0107_projects_month_drivers_truck.sql
-- Two view changes from Turki's test of 0106. Both are REPLACEMENTS of views
-- 0106 introduced; no new object, no new table, no schema change.
--
--   v_project_trip_stages   whole history  ->  CURRENT Riyadh month
--   v_drivers_ops_now       richer truck cell + stage reads the LATEST trip
--
-- READ-ONLY BY CONSTRUCTION. Both are views over existing tables. Nothing here
-- reads or writes the money core (lib/prepaid.ts, lib/vat.ts, FIFO ledgers).
--
-- ===========================================================================
-- 1) PROJECTS — CURRENT MONTH, AND WHY THE FILTER'S POSITION IS THE WHOLE FIX
-- ===========================================================================
-- 0106 counted a project's entire trip history, so every bar was ~90%
-- delivered and the card said little about how the project is running NOW.
-- This scopes it to the current Riyadh month, which auto-resets on the 1st
-- with no job, no cache and no stored "current period" to go stale.
--
-- THE MONTH PREDICATE LIVES IN THE LEFT JOIN'S ON CLAUSE, NOT IN WHERE.
-- This is not style. A LEFT JOIN keeps the project row and NULLs the trip
-- columns when nothing matches; moving that same predicate into WHERE
-- evaluates it AFTER the join, and `NULL >= date` is not true, so the row is
-- discarded. A project with no trips this month would silently vanish from
-- the Dashboard instead of rendering as an empty card.
--
-- Measured, not assumed. Probing a month with no trips at all (2026-09):
--     join_version_rows  = 6      <- all six active projects, correctly empty
--     where_version_rows = 0      <- every card gone
-- On the 1st of any quiet month the WHERE form would blank the entire
-- section, and it would look like a data outage rather than a fresh month.
--
-- Bounds are half-open [month_start, next_month_start) rather than BETWEEN,
-- so the last day of the month cannot be double-counted or dropped, and the
-- predicate stays sargable against trips.trip_date.
--
-- ===========================================================================
-- 2) DRIVERS OPS — A TRUCK CELL THAT SAYS WHY, AND A STAGE THAT MEANS "NOW"
-- ===========================================================================
-- (a) MAINTENANCE-AWARE TRUCK. "No truck" was true but unhelpful: it did not
--     distinguish a driver with nothing assigned from one whose truck is in
--     the workshop. The cell now resolves in order —
--         assigned truck (trucks.assigned_driver_id)
--         else the truck of his latest in-flight trip
--     — and reports whether THAT truck is in maintenance, using the SAME
--     busy-truck definition v_fleet_state_now uses (an in-progress work order
--     or outsourced job). Reusing that definition rather than restating it is
--     the point: two spellings of "in maintenance" would drift.
--
--     `truck_source` says which of the two rules produced the plate, so the
--     UI never has to guess whether a plate is an assignment or an inference.
--
--     THE STATE IS UNCHANGED, deliberately. A driver whose only truck is in
--     the workshop still has no truck AVAILABLE, so he stays `off_duty` by
--     the canonical rule (lib/driver-state.ts, mirrored by
--     v_driver_state_now). This migration enriches the DISPLAY and touches
--     neither the state rule nor state_conflicts_with_trips.
--
--     Verified live before drafting — the label must appear only when true:
--         Khalid 3     trip truck AAA-5553   in maintenance   -> label
--         mohammed 2   trip truck KKK-7772   in maintenance   -> label
--         Fahad 2      trip truck 1113 BBB   NOT in maintenance -> no label
--     Fahad 2 is the control case: same "off_duty with in-flight trips"
--     shape, but his truck is free, so a blanket label would have been wrong
--     on one of the three rows.
--
--     ONE CASE BEYOND THE THREE, found while checking: Khalid 2 has an
--     ASSIGNED truck (AAA-5552) that is ALSO in maintenance. He is `active`,
--     not off_duty, because assignment is what the state rule reads. The flag
--     is therefore not exclusive to off_duty drivers, and the UI must not
--     assume it is — his row correctly shows an assigned plate WITH the
--     maintenance note.
--
-- (b) STAGE = THE MOST RECENT TRIP, NOT THE MOST ADVANCED. 0106 reported the
--     furthest-along in-flight stage, which answered "what is the best this
--     driver has going" — not "what is he doing now". A driver whose newest
--     trip is `scheduled` read as `in_transit` because an older trip was
--     still running. Live, that was wrong for Fahad 3 and Khalid 1, whose
--     newest trips are both scheduled.
--
--     TIEBREAK, STATED SO IT IS NOT REDISCOVERED LATER. Ordering is:
--         trip_date DESC          newest day wins
--         stage rank DESC         same day -> the most-advanced of that day
--                                 (in_transit > loading > scheduled)
--         id DESC                 final, arbitrary but STABLE
--     The last key exists so the result cannot flip between two otherwise
--     identical rows; without it the "same" query can return a different
--     truck on each run, which is the sort of instability that gets blamed
--     on the UI.
--
--     The same single trip supplies BOTH the stage and the fallback truck, so
--     the two can never describe different journeys.
--
-- in_flight_trips is still the full COUNT of in-flight trips, unchanged — the
-- stage describes one trip, the count describes the workload.
--
-- ===========================================================================
-- SECURITY
-- ===========================================================================
-- `create or replace view` does NOT preserve reloptions, so both views would
-- silently revert to owner-run — bypassing RLS on 68 tables — without the
-- footer below. It is restated after the last create, as in 0098/0103–0106.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) PROJECTS — current Riyadh month only.
-- ---------------------------------------------------------------------
-- Column list, order and types are 0106's, unchanged. Only the trip set
-- narrows. Project predicate stays the Kanban's own (archived_at is null and
-- status = 'active').
create or replace view public.v_project_trip_stages
with (security_invoker = true) as
  with month_bounds as (
    select date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date as from_day,
           (date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)
             + interval '1 month')::date                                      as to_day
  )
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
    cross join month_bounds m
    -- THE MONTH FILTER BELONGS HERE. In WHERE it would evaluate after the
    -- join and discard every project with no trips this month. See the header
    -- for the measured 6-vs-0 proof.
    left join public.trips t
           on t.project_id = p.id
          and t.trip_date >= m.from_day
          and t.trip_date <  m.to_day
   where p.archived_at is null
     and p.status = 'active'
   group by p.id, p.name;

comment on view public.v_project_trip_stages is
  'Trips per ACTIVE project (archived_at is null and status = active — the '
  'Kanban Projects board predicate), split across the four stages, for the '
  'CURRENT Asia/Riyadh month only (0107). Auto-resets on the 1st. The month '
  'filter sits in the LEFT JOIN, never in WHERE, so a project with no trips '
  'this month still returns a zero row instead of disappearing. Trips with no '
  'project are excluded, matching the board, which shows them in its own '
  'Direct-customer card.';

-- ---------------------------------------------------------------------
-- 2) DRIVERS OPS — richer truck cell, latest-trip stage.
-- ---------------------------------------------------------------------
-- The twelve columns 0106 published keep their names, order and types; the
-- two new ones are appended, as `create or replace view` requires.
create or replace view public.v_drivers_ops_now
with (security_invoker = true) as
  with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today),
  -- Same definition v_fleet_state_now uses for a busy truck. Restating it
  -- would be a second spelling of "in maintenance", free to drift.
  busy_trucks as (
    select truck_id from public.work_orders     where status = 'in_progress' and truck_id is not null
    union
    select truck_id from public.outsourced_jobs where status = 'in_progress' and truck_id is not null
  ),
  -- ONE trip per driver — the newest in-flight one. Supplies both the stage
  -- pill and the fallback truck, so the two cannot describe different
  -- journeys. Tiebreak documented in the header; id DESC makes it stable.
  latest_trip as (
    select distinct on (t.driver_id)
           t.driver_id,
           t.stage,
           t.truck_id,
           t.trip_date
      from public.trips t
     where t.driver_id is not null
       and t.stage in ('scheduled','loading','in_transit')
     order by t.driver_id,
              t.trip_date desc,
              case t.stage when 'in_transit' then 3
                           when 'loading'    then 2
                           when 'scheduled'  then 1 end desc,
              t.id desc
  ),
  -- The workload figure, separate from which trip the stage describes.
  in_flight as (
    select t.driver_id, count(*)::int as in_flight_trips
      from public.trips t
     where t.driver_id is not null
       and t.stage in ('scheduled','loading','in_transit')
     group by t.driver_id
  ),
  -- Expiry status per document. A NULL date is 'not_recorded', NEVER 'ok' —
  -- rendering a missing date as a passing check is a fabricated all-clear.
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
  ),
  -- Assigned truck first; the latest trip's truck only as a fallback.
  resolved_truck as (
    select s.driver_id,
           coalesce(a.id, lt.truck_id)                              as truck_id,
           coalesce(a.plate, tt.plate)                              as plate,
           case when a.id is not null      then 'assigned'
                when lt.truck_id is not null then 'trip' end        as truck_source
      from public.v_driver_state_now s
      left join lateral (
        select tk.id, tk.plate from public.trucks tk
         where tk.assigned_driver_id = s.driver_id
           and tk.terminated_at is null
         order by tk.plate
         limit 1
      ) a on true
      left join latest_trip lt on lt.driver_id = s.driver_id
      left join public.trucks tt on tt.id = lt.truck_id
  )
  select s.driver_id,
         s.name,
         s.state,
         rt.plate                                           as truck_plate,
         lt.stage                                           as trip_stage,
         coalesce(f.in_flight_trips, 0)                     as in_flight_trips,
         c.license_status,
         c.iqama_status,
         case when 'expired'       in (c.license_status, c.iqama_status) then 'expired'
              when 'expiring_soon' in (c.license_status, c.iqama_status) then 'expiring_soon'
              when 'not_recorded'  in (c.license_status, c.iqama_status) then 'not_recorded'
              else 'ok' end                                 as compliance_status,
         d.license_expiry,
         d.iqama_expiry,
         -- UNCHANGED from 0106. A driver with no truck is off_duty by the
         -- canonical rule yet may hold in-flight trips; neither column is
         -- wrong, the pairing is. Surfaced, not resolved.
         (s.state in ('off_duty','on_leave') and coalesce(f.in_flight_trips, 0) > 0)
                                                            as state_conflicts_with_trips,
         -- NEW (0107).
         rt.truck_source,
         (rt.truck_id is not null
          and rt.truck_id in (select truck_id from busy_trucks)) as truck_in_maintenance
    from public.v_driver_state_now s
    join public.drivers d      on d.id = s.driver_id
    join compliance c          on c.driver_id = s.driver_id
    join resolved_truck rt     on rt.driver_id = s.driver_id
    left join latest_trip lt   on lt.driver_id = s.driver_id
    left join in_flight f      on f.driver_id = s.driver_id;

comment on view public.v_drivers_ops_now is
  'Live per-driver board. State comes from v_driver_state_now and is NOT '
  'changed by 0107. truck_plate is the assigned truck, else the truck of the '
  'driver''s latest in-flight trip; truck_source says which. '
  'truck_in_maintenance uses the same busy-truck definition as '
  'v_fleet_state_now (in-progress work order or outsourced job) and can be '
  'true for an ASSIGNED truck too, so it is not exclusive to off_duty rows. '
  'trip_stage is the stage of the MOST RECENT in-flight trip (trip_date desc, '
  'then most-advanced stage that day, then id desc) — not the most advanced '
  'overall; in_flight_trips remains the full count. A NULL expiry reads '
  'not_recorded, never ok.';

-- ---------------------------------------------------------------------
-- 3) SECURITY — restated after the last create, because `create or replace
--    view` does not preserve reloptions.
-- ---------------------------------------------------------------------
alter view public.v_project_trip_stages set (security_invoker = true);
alter view public.v_drivers_ops_now     set (security_invoker = true);

revoke all on public.v_project_trip_stages from anon;
revoke all on public.v_drivers_ops_now     from anon;

grant select on public.v_project_trip_stages to authenticated;
grant select on public.v_drivers_ops_now     to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. Both were REPLACED, so both lost their reloptions and
--    depend on the footer above. Expect security_invoker=true on each:
--      select c.relname, c.reloptions
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname in ('v_project_trip_stages','v_drivers_ops_now');
--
--    anon must not read either (expect false x2):
--      select has_table_privilege('anon','public.v_project_trip_stages','select'),
--             has_table_privilege('anon','public.v_drivers_ops_now','select');
--
-- B) PROJECTS RECONCILE TO THIS MONTH'S TRIPS. Expect 0 rows:
--      with m as (
--        select date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)::date as f,
--               (date_trunc('month', (now() at time zone 'Asia/Riyadh')::date)
--                 + interval '1 month')::date as t
--      )
--      select v.project_name, v.scheduled, v.loading, v.in_transit, v.delivered, v.total_trips
--        from public.v_project_trip_stages v
--        left join (
--          select t.project_id,
--                 count(*) filter (where t.stage='scheduled')::int  s,
--                 count(*) filter (where t.stage='loading')::int    l,
--                 count(*) filter (where t.stage='in_transit')::int i,
--                 count(*) filter (where t.stage='delivered')::int  d,
--                 count(*)::int n
--            from public.trips t, m
--           where t.trip_date >= m.f and t.trip_date < m.t
--           group by t.project_id
--        ) b on b.project_id = v.project_id
--       where v.scheduled  <> coalesce(b.s,0) or v.loading   <> coalesce(b.l,0)
--          or v.in_transit <> coalesce(b.i,0) or v.delivered <> coalesce(b.d,0)
--          or v.total_trips<> coalesce(b.n,0);
--
--    The four stages still account for the total — expect 0 rows:
--      select * from public.v_project_trip_stages
--       where scheduled + loading + in_transit + delivered <> total_trips;
--
--    EVERY ACTIVE PROJECT STILL APPEARS, trips or not. This is the check that
--    catches the WHERE-vs-JOIN regression — the two counts must be equal:
--      select (select count(*) from public.v_project_trip_stages) as view_rows,
--             (select count(*) from public.projects
--               where archived_at is null and status = 'active') as active_projects;
--
--    Counts must now be SMALLER than 0106's whole-history figures (unless a
--    project only ever ran this month) — eyeball against the Kanban:
--      select project_name, scheduled, loading, in_transit, delivered, total_trips
--        from public.v_project_trip_stages order by project_name;
--
-- C) DRIVERS OPS — one row per live driver, no more:
--      select (select count(*) from public.v_drivers_ops_now) as ops_rows,
--             (select count(*) from public.drivers where terminated_at is null) as live_drivers;
--
--    The maintenance label must be TRUE only where it is true. Expect
--    Khalid 3 and mohammed 2 true, and Fahad 2 FALSE (his trip truck is free)
--    — Fahad 2 is the control case:
--      select name, state, truck_plate, truck_source, truck_in_maintenance,
--             trip_stage, in_flight_trips, state_conflicts_with_trips
--        from public.v_drivers_ops_now order by name;
--
--    truck_source must agree with the plate it produced — expect 0 rows:
--      select name, truck_plate, truck_source from public.v_drivers_ops_now
--       where (truck_plate is null) <> (truck_source is null);
--
--    An 'assigned' source must match a real assignment — expect 0 rows:
--      select o.name, o.truck_plate from public.v_drivers_ops_now o
--       where o.truck_source = 'assigned'
--         and not exists (select 1 from public.trucks tk
--                          where tk.assigned_driver_id = o.driver_id
--                            and tk.terminated_at is null
--                            and tk.plate = o.truck_plate);
--
--    trip_stage is set exactly when there are in-flight trips — expect 0 rows:
--      select name, trip_stage, in_flight_trips from public.v_drivers_ops_now
--       where (in_flight_trips > 0) <> (trip_stage is not null);
--
--    THE STAGE NOW MEANS "MOST RECENT". Expect 0 rows — the view's stage must
--    equal the stage of the driver's newest in-flight trip:
--      select o.name, o.trip_stage, x.stage as newest_stage, x.trip_date
--        from public.v_drivers_ops_now o
--        join lateral (
--          select t.stage, t.trip_date from public.trips t
--           where t.driver_id = o.driver_id
--             and t.stage in ('scheduled','loading','in_transit')
--           order by t.trip_date desc,
--                    case t.stage when 'in_transit' then 3 when 'loading' then 2 else 1 end desc,
--                    t.id desc
--           limit 1
--        ) x on true
--       where o.trip_stage <> x.stage;
--
--    STATE IS UNCHANGED by this migration — expect 0 rows:
--      select o.name, o.state, s.state from public.v_drivers_ops_now o
--        join public.v_driver_state_now s on s.driver_id = o.driver_id
--       where o.state <> s.state;
--
--    And the fleet counts still agree with the per-driver view — expect 0 rows:
--      select * from public.v_fleet_state_now f
--       where f.drivers_total  <> (select count(*) from public.v_driver_state_now)
--          or f.drivers_active <> (select count(*) from public.v_driver_state_now where state='active');
-- ===========================================================================
