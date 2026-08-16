-- 0120_fleet_state_now_drop_truck_columns.sql
-- Remove the dead truck derivation from v_fleet_state_now.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, re-runs the dependency and
-- driver-count checks independently, and applies this.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- Truck status had TWO derivations: `truckOpsStatus` in lib/truck-status.ts
-- (the Fleet page's rule, and the truth) and this view's `truck_state` CTE,
-- which restated the same precedence in SQL with no guard between them.
--
-- Option C (commit 8e2ccf6) pointed the Dashboard at the TypeScript rule via
-- lib/actions/truck-state.ts and removed the four truck fields from the
-- `FleetStateNow` type. That left the view still COMPUTING them, read by
-- nobody. This migration deletes the derivation itself, so there is exactly
-- one expression of truck status in the system rather than one live and one
-- dormant waiting to be picked up again by someone who finds it in a select.
--
-- lib/truck-status.ts is NOT touched. It stays the source.
--
-- ===========================================================================
-- DRIVER STATE IS NOT TOUCHED — CHECKED, NOT ASSUMED
-- ===========================================================================
-- v_driver_state_now is READ-ONLY here. This migration does not reference it
-- in any DDL, does not drop it, does not recreate it, and does not alter its
-- grants. The five driver-count subqueries below are carried over BYTE-FOR-BYTE
-- from the current pg_get_viewdef output — same expressions, same casts, same
-- aliases, same order relative to each other.
--
-- The two derivations shared NO object: `truck_state` read `trucks` and
-- `busy_trucks`; the driver counts read `v_driver_state_now`. Dropping the
-- former cannot reach the latter. lib/actions/driver-state-drift.ts compares
-- v_driver_state_now against lib/driver-state.ts and is unaffected — it never
-- reads this view.
--
-- ===========================================================================
-- THIS CANNOT BE A `create or replace view` — AND THE REASON MATTERS
-- ===========================================================================
-- CLAUDE.md section 6 records that `create or replace view` can only APPEND a
-- column (error 42P16, which cost 0112 an apply cycle). The same restriction
-- forbids REMOVING one: the replacement query must reproduce every existing
-- column, in order, with the same type. Dropping the four leading truck
-- columns is exactly what it refuses.
--
-- So this is `drop view` + `create view`. That is only safe because nothing
-- depends on the view. Verified before drafting — re-run all three:
--
--   -- views whose definition references it .......... expect 0
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'v' and c.relname <> 'v_fleet_state_now'
--      and pg_get_viewdef(c.oid, true) ilike '%v_fleet_state_now%';
--
--   -- functions/RPCs referencing it .................. expect 0
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--      and pg_get_functiondef(p.oid) ilike '%v_fleet_state_now%';
--
--   -- pg_depend rewrite entries pointing at it ....... expect 0
--   select dep.relname from pg_depend d
--     join pg_rewrite r on r.oid = d.objid
--     join pg_class dep on dep.oid = r.ev_class
--     join pg_class src on src.oid = d.refobjid
--    where src.relname = 'v_fleet_state_now' and dep.relname <> 'v_fleet_state_now';
--
-- The drop is written WITHOUT `cascade` deliberately: if a dependency has
-- appeared since this was drafted, this must FAIL rather than silently destroy
-- whatever grew on top of it.
--
-- ===========================================================================
-- NO APP CHANGE IS NEEDED, AND THAT WAS CHECKED BEFORE DRAFTING
-- ===========================================================================
-- The usual ordering rule is code-stops-reading-first, then drop. Here the code
-- already stopped, in 8e2ccf6:
--   · `trucks_total` / `trucks_idle` / `trucks_maintenance` — one hit in the
--     whole app, a COMMENT at lib/dashboard.ts:228. No code reads them.
--   · `trucks_active` — appears in app/reports/* and lib/reports.ts, but that
--     is `v_operations_monthly.trucks_active`, a DIFFERENT measure (distinct
--     trucks that moved in a period). Out of scope, untouched.
--   · `FleetStateNow` (lib/dashboard.ts) names no truck field at all.
-- The two readers of this view — app/page.tsx:61 and
-- lib/actions/dashboard-widgets.ts:78 — both `select("*")` and consume only the
-- driver/trip/job keys by name, so a narrower result set changes nothing for
-- them. There is therefore no Part-A-first ordering to observe.
--
-- ===========================================================================
-- THE ANON GRANT IS THE REAL HAZARD IN THIS FILE
-- ===========================================================================
-- The security footer below is NOT a formality here. Supabase ships default
-- privileges (pg_default_acl, granted by both `postgres` and `supabase_admin`)
-- that grant anon/authenticated/service_role on every NEWLY CREATED relation in
-- `public`. The live view has no anon grant only because an earlier migration
-- revoked it — and a REVOKE does not survive a DROP.
--
-- So a plain drop-and-create silently hands `anon` SELECT back, and reloptions
-- go with the old view too, meaning it also reverts to owner-run and bypasses
-- RLS. Both are invisible failures: the view keeps returning the same row, just
-- readable by the wrong role, with the wrong privileges. Check D below is what
-- proves it did not happen.
-- ===========================================================================

begin;

-- No `cascade`: fail loudly if something has come to depend on this.
drop view if exists public.v_fleet_state_now;

create view public.v_fleet_state_now as
 WITH riyadh AS (
         SELECT (now() AT TIME ZONE 'Asia/Riyadh'::text)::date AS today
        )
 SELECT ( SELECT count(*) AS count
           FROM v_driver_state_now) AS drivers_total,
    (( SELECT count(*) AS count
           FROM v_driver_state_now
          WHERE v_driver_state_now.state = 'active'::text))::integer AS drivers_active,
    (( SELECT count(*) AS count
           FROM v_driver_state_now
          WHERE v_driver_state_now.state = 'idle'::text))::integer AS drivers_idle,
    (( SELECT count(*) AS count
           FROM v_driver_state_now
          WHERE v_driver_state_now.state = 'off_duty'::text))::integer AS drivers_off_duty,
    (( SELECT count(*) AS count
           FROM v_driver_state_now
          WHERE v_driver_state_now.state = 'on_leave'::text))::integer AS drivers_on_leave,
    (( SELECT count(*) AS count
           FROM trips t
          WHERE t.stage = ANY (ARRAY['scheduled'::text, 'loading'::text, 'in_transit'::text])))::integer AS trips_in_flight,
    (( SELECT count(*) AS count
           FROM trips t,
            riyadh r
          WHERE t.trip_date = r.today))::integer AS trips_today,
    (( SELECT count(*) AS count
           FROM work_orders
          WHERE work_orders.status = 'in_progress'::text))::integer AS work_orders_running,
    (( SELECT count(*) AS count
           FROM outsourced_jobs
          WHERE outsourced_jobs.status = 'in_progress'::text))::integer AS outsourced_running;

-- MANDATORY, NOT DECORATIVE — see the anon-grant note in the header. A dropped
-- view takes its reloptions and its revoke with it.
alter view public.v_fleet_state_now set (security_invoker = true);
revoke all on public.v_fleet_state_now from anon;
grant select on public.v_fleet_state_now to authenticated;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE SAFETY PROOF: EVERY DRIVER COUNT IS BYTE-IDENTICAL.
--
--    THIS IS THE ONLY CHECK THAT CAN CATCH THE FAILURE THAT WOULD MATTER, so
--    run the BEFORE half FIRST, before the begin; block above, and keep the
--    output. Everything else in this file is structural.
--
--      -- BEFORE (run prior to applying):
--      select drivers_total, drivers_active, drivers_idle,
--             drivers_off_duty, drivers_on_leave,
--             trips_in_flight, trips_today,
--             work_orders_running, outsourced_running
--        from public.v_fleet_state_now;
--
--      -- AFTER (run once applied): same query, same nine columns.
--
--    Captured live at drafting time, for reference only — these are LIVE
--    OPERATIONAL counts and will legitimately have moved by the time this is
--    applied, so compare AFTER against YOUR OWN BEFORE, never against this row:
--      drivers_total 11, drivers_active 6, drivers_idle 1, drivers_off_duty 4,
--      drivers_on_leave 0, trips_in_flight 87, trips_today 0,
--      work_orders_running 2, outsourced_running 2.
--
--    trips_today is the one figure that can move for a legitimate reason
--    unrelated to this change: it is Riyadh-bucketed, so a BEFORE taken before
--    midnight Riyadh and an AFTER taken after it will differ. Take both inside
--    the same day, or re-take the BEFORE.
--
--    A drivers_* figure that moves between BEFORE and AFTER means the driver
--    subqueries were NOT carried over verbatim. Do not reason about which
--    answer is right — restore and re-diff the expressions.
--
-- B) THE FOUR TRUCK COLUMNS ARE GONE. Expect 0 rows:
--      select column_name from information_schema.columns
--       where table_schema = 'public' and table_name = 'v_fleet_state_now'
--         and column_name in ('trucks_total','trucks_active','trucks_idle','trucks_maintenance');
--
--    And the CTEs with them — expect false, false:
--      select pg_get_viewdef('public.v_fleet_state_now'::regclass, true) ilike '%busy_trucks%' as has_busy,
--             pg_get_viewdef('public.v_fleet_state_now'::regclass, true) ilike '%truck_state%' as has_truck_state;
--
-- C) EVERY OTHER COLUMN SURVIVED, AND THE SHAPE MATCHES THE APP.
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'v_fleet_state_now'
--       order by ordinal_position;
--    Expect EXACTLY these nine, in this order and with these types — this is
--    the `FleetStateNow` type in lib/dashboard.ts, which both readers
--    (app/page.tsx and lib/actions/dashboard-widgets.ts) cast their `select("*")`
--    result to:
--      1 drivers_total        bigint
--      2 drivers_active       integer
--      3 drivers_idle         integer
--      4 drivers_off_duty     integer
--      5 drivers_on_leave     integer
--      6 trips_in_flight      integer
--      7 trips_today          integer
--      8 work_orders_running  integer
--      9 outsourced_running   integer
--    Count 13 before, 9 after. drivers_total stays `bigint` (an uncast count())
--    exactly as it was — do not "tidy" it to integer, that is a type change to
--    a column the app already consumes.
--
-- D) SECURITY — THE CHECK THIS FILE IS MOST LIKELY TO FAIL.
--      select c.relname, c.reloptions,
--             has_table_privilege('anon', c.oid, 'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid, 'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relname = 'v_fleet_state_now';
--      -- expect reloptions {security_invoker=true}, anon_can_read FALSE,
--      -- auth_can_read TRUE. anon TRUE means the revoke did not take and the
--      -- default privileges won — STOP and re-run the footer.
--
--    Then the whole-schema figure, which is the standing number in CLAUDE.md
--    section 6:
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v';
--      -- expect 40 / 40 / 0 — unchanged, since this replaces a view rather
--      -- than adding or removing one.
--
-- E) THE VIEW STILL WORKS, AND SO DOES THE PAGE.
--      select * from public.v_fleet_state_now;
--      -- expect exactly ONE row and no error. This view has no FROM at the top
--      -- level, so a missing row would mean something far stranger than a
--      -- filtering mistake.
--
--    And v_driver_state_now, untouched but worth proving so:
--      select count(*) from public.v_driver_state_now;
--      -- expect 11, the same figure drivers_total reports in check A.
--
--    In the browser, signed in:
--      · /            — Dashboard loads. "Fleet right now" shows truck counts
--                       (these come from lib/actions/truck-state.ts, NOT this
--                       view) and the driver counts beside them are unchanged.
--      · /fleet       — unchanged and unaffected; it never read this view.
--    A Dashboard that renders truck counts but blank driver counts means the
--    view read failed — check D first, since a lost grant looks exactly like
--    that.
--
-- F) REVERSIBILITY. There is no down migration, but unlike 0119 this one loses
--    NO DATA — it is a derivation, not storage. If it needs undoing, the prior
--    definition is `pg_get_viewdef` output preserved in this repo's history and
--    in the header of the Option C commit (8e2ccf6); re-creating it would
--    reintroduce the second truck-status derivation, which is the entire thing
--    this file removes. Do not undo it to "fix" a truck count — a wrong truck
--    count after this is a bug in lib/truck-status.ts or its Dashboard fetcher,
--    and that is where it must be fixed.
-- ===========================================================================
