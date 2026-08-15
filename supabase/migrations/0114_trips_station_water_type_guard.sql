-- 0114_trips_station_water_type_guard.sql
-- A permanent, database-level guarantee that a trip's station actually fills
-- its water type. Enforcement only — no money is written, no view is touched.
--
-- ===========================================================================
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
-- ===========================================================================
-- The rule spans two tables: the trip carries the water type, the station
-- carries the prices. A CHECK cannot read another table. A FOREIGN KEY cannot
-- express it either — the valid set depends on which of two nullable price
-- columns is populated on the parent row.
--
-- More importantly a constraint of any kind would be RETROACTIVE. 13 trips at
-- Umm Al Hamam are potable and predate per-type pricing; they are legitimately
-- grandfathered and Turki's decision to stop offering potable there does not
-- make that history false. `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID`
-- would leave them alone at first, but any later VALIDATE — or a `pg_restore`,
-- which re-checks everything — would reject the dump. A BEFORE trigger only
-- ever inspects the NEW row, so history is structurally out of reach rather
-- than protected by remembering not to validate something.
--
-- ===========================================================================
-- IT IS THE SECOND LAYER, NOT THE FIRST
-- ===========================================================================
-- The app already gates this (lib/station-pricing.ts's decideStationChange,
-- both trip-edit paths in app/trips/actions.ts, and both station pickers). That
-- layer stays, and stays first, because it can refuse BEFORE the write with a
-- sentence in the user's own screen and can disable the option in the picker so
-- the mistake is not reachable. This layer exists because the app gate is
-- reachable only through the app: a psql session, a future importer, a bulk fix
-- typed into the SQL editor, or a server action someone adds next year all
-- bypass it. The gate that must not be forgotten belongs in the database.
--
-- The two layers say the SAME SENTENCE, deliberately — the message below is
-- word-for-word the app's. Whichever catches it, the user reads one thing.
--
-- ===========================================================================
-- WHAT IT DOES NOT DO
-- ===========================================================================
-- It does NOT write filling_cost_sar. The re-snapshot stays in the app, where
-- the freeze rule lives (a delivered trip's cost never moves; a re-parked trip's
-- does). A trigger that also priced the row would put half the money rule in
-- SQL and half in TypeScript, which is how the gate came apart the first time.
-- This function reads two columns and either returns NEW or raises. Nothing else.
--
-- No view, no RPC, no money-core table is touched.
--
-- ===========================================================================
-- CONSEQUENCE THE REVIEWER SHOULD SIGN OFF ON: NEW TRIPS CAN NO LONGER BE
-- UNCOSTED
-- ===========================================================================
-- createTrip currently records a NULL filling_cost_sar when the station does
-- not price the chosen type, and its comment says so: "NULL IS A REAL OUTCOME
-- AND IS NOT AN ERROR ... blocking the pick is the UI's job; this path records
-- what is true." After this migration that combination cannot be inserted at
-- all — the insert raises instead.
--
-- So from apply-time onward, `filling_uncosted_trips` becomes a purely
-- HISTORICAL measure: the only rows that can carry a NULL cost are ones that
-- already existed (13 today, all June–July) or a row at a station with no
-- prices at all, which `water_stations_offers_at_least_one_type` already makes
-- impossible. The count will not grow. That is the intended tightening, but it
-- is a real change to a documented contract and it is stated here rather than
-- discovered later. createTrip's comment becomes stale on apply and should be
-- corrected in the same pass.
--
-- ===========================================================================
-- FOUR SCHEMA FACTS THAT SHAPED THIS, EACH CHECKED LIVE RATHER THAN ASSUMED
-- ===========================================================================
--  1. `trips.water_station` is NOT NULL and carries `trips_water_station_fkey`
--     -> water_stations(key) ON UPDATE CASCADE ON DELETE RESTRICT. So a station
--     key that does not exist is impossible, and the not-found branch below is
--     unreachable while that FK holds. It is written anyway, and it ALLOWS,
--     matching the app helper's behaviour for an unknown station — a guard that
--     cannot see the pricing must not invent a verdict.
--
--  2. "Clearing the station" cannot produce NULL — the column forbids it — and
--     cannot produce '' either, because the FK requires a real key and
--     `water_stations_key_slug` (`^[a-z][a-z0-9_]*$`) forbids an empty one.
--     The empty/NULL skip below is therefore unreachable today. It is kept
--     because it is the behaviour the app gate promises, and if the column is
--     ever made nullable this guard should already agree.
--     SEPARATE FINDING, NOT FIXED HERE: setTripStation's comment claims "Empty
--     string is allowed (direct-customer trips are never required to have
--     one)". That is stale — `setTripStation(id, "")` fails on the FK today,
--     with or without this migration.
--
--  3. `water_stations_offers_at_least_one_type` is a VALIDATED CHECK, so a
--     station with neither price cannot exist. The unpriced-station allowance
--     below is unreachable while that holds. It is kept for parity with
--     `stationBlockedForType`, which allows a legacy unpriced station: if that
--     CHECK is ever relaxed, the two layers still agree instead of silently
--     diverging.
--
--  4. `water_type` is NOT NULL with a CHECK limiting it to potable /
--     non_potable, so the type is always one of the two and the mapping to a
--     price column is total.
--
-- ===========================================================================
-- WHY SECURITY DEFINER, AND WHY THAT IS SAFE HERE
-- ===========================================================================
-- Live, `water_stations` has one RLS policy: authenticated, ALL, USING (true).
-- `trips` has the identical policy, so anyone who can write a trip can already
-- read every station and an INVOKER function would work today.
--
-- It is DEFINER anyway because the failure mode matters. If water_stations RLS
-- is ever narrowed, an invoker function's lookup returns no row, `not found`
-- allows, and this guard FAILS OPEN — silently, with no error, exactly when
-- someone tightened security. An enforcement guard must fail closed. Running as
-- owner means the check always sees the true pricing.
--
-- The risk that normally comes with DEFINER is not present: no dynamic SQL, no
-- user-supplied identifier, no write, `search_path` pinned to public so nothing
-- can be shadowed, and the only data it reveals is the name of a station the
-- caller just referenced by key. It mirrors `trips_set_ref` (also DEFINER, also
-- `search_path=public`, also a BEFORE trigger on this table).
--
-- NO REVOKE FOOTER, DELIBERATELY. The views' revoke-anon rule does not apply:
-- Postgres refuses to invoke a trigger function directly ("trigger functions
-- can only be called as triggers"), so the default PUBLIC EXECUTE grant confers
-- nothing callable. Revoking it would also be a live risk for no gain, since
-- EXECUTE on a trigger function is checked at CREATE TRIGGER time.
--
-- ===========================================================================
-- THE TWO GUARDS THAT KEEP IT OFF EVERY UNRELATED WRITE
-- ===========================================================================
--  A. The UPDATE trigger's WHEN clause. Postgres evaluates it WITHOUT entering
--     the function, so an update that leaves both columns alone — the 0111
--     backfill setting filling_cost_sar, a stage move, a commission recompute,
--     an invoice_id stamp — never calls this code at all. Only a real station
--     or water-type change is inspected.
--
--  B. `pg_trigger_depth() > 1` on UPDATE. The FK is ON UPDATE CASCADE, so
--     renaming a station's KEY rewrites `trips.water_station` on every trip
--     that points at it — which looks exactly like a station change and would
--     re-validate the 13 grandfathered rows, refusing a legitimate admin
--     rename. Depth 1 means a direct write; a cascade arrives at depth 2 and is
--     passed through. Same technique and same reasoning as 0096's 30-day lock,
--     which guards DELETE only at depth 1 so FK cascades still work.
--     (An INSERT is never a cascade, so the insert path has no depth guard.)
-- ===========================================================================

begin;

create or replace function public.trips_station_offers_water_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_name text;
  v_this_price   numeric;   -- the price for THIS trip's water type
  v_other_price  numeric;   -- the price for the other type
begin
  -- (B) A cascade is not a station change. Renaming a station key rewrites
  -- water_station on every trip that points at it via ON UPDATE CASCADE; that
  -- must not re-validate history. Guard B in the header.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  -- No station on the row, or no type: nothing to validate. Unreachable while
  -- both columns are NOT NULL (fact 2 in the header) — kept so this layer
  -- promises what the app gate promises.
  if coalesce(new.water_station, '') = '' or new.water_type is null then
    return new;
  end if;

  select w.name,
         case new.water_type
           when 'potable' then w.fill_cost_potable_sar
           else                w.fill_cost_non_potable_sar
         end,
         case new.water_type
           when 'potable' then w.fill_cost_non_potable_sar
           else                w.fill_cost_potable_sar
         end
    into v_station_name, v_this_price, v_other_price
    from public.water_stations w
   where w.key = new.water_station;

  -- Unknown station. Unreachable while the FK holds (fact 1). A guard that
  -- cannot read the pricing must not invent a verdict — the FK is what refuses
  -- this row, and it will do so a moment from now.
  if not found then
    return new;
  end if;

  -- OFFERED. NOT NULL is the whole test: 0.00 is a REAL price — a company-owned
  -- station that fills free — and must pass here. Any truthiness test, any
  -- `coalesce(v_this_price, 0)`, any `> 0` reintroduces the exact bug the
  -- two-nullable-column schema was shaped to prevent.
  if v_this_price is not null then
    return new;
  end if;

  -- Legacy station with NEITHER price: allows both types, exactly as
  -- selectableWaterTypes and stationBlockedForType do, so a pre-0110 row cannot
  -- freeze edits. Unreachable while water_stations_offers_at_least_one_type
  -- holds (fact 3).
  if v_other_price is null then
    return new;
  end if;

  -- The station prices the OTHER type and not this one. Refuse.
  -- Word-for-word the app gate's message, so the user reads one sentence no
  -- matter which layer caught it. 23514 (check_violation) matches 0092's
  -- linked-document guard, the closest precedent in this schema.
  raise exception '% does not fill % water. Pick a station that does, or add that type to this station under Manage stations.',
        v_station_name,
        case new.water_type when 'potable' then 'potable' else 'non-potable' end
    using errcode = '23514';
end;
$$;

comment on function public.trips_station_offers_water_type() is
  'Refuses a trip whose water_station does not price its water_type. The '
  'database half of a rule the app also enforces (lib/station-pricing.ts). '
  'Inspects only the NEW row, so the 13 grandfathered Umm Al Hamam potable '
  'trips are structurally out of reach. Writes nothing — filling_cost_sar is '
  'the app''s job, because the freeze rule (a delivered trip''s cost never '
  'moves) lives there. NULL means the type is not offered; 0.00 is a real '
  'free-fill price and passes.';

-- INSERT — always checked. An insert is never an FK cascade, so no depth guard.
drop trigger if exists trips_station_type_guard_ins on public.trips;
create trigger trips_station_type_guard_ins
  before insert on public.trips
  for each row
  execute function public.trips_station_offers_water_type();

-- UPDATE — checked ONLY when the station or the type actually changes.
-- The WHEN clause is guard A: Postgres evaluates it without entering the
-- function, so every other update on this table (the 0111 backfill, stage
-- moves, commission recomputes, invoice stamps) costs nothing and is never
-- inspected. OLD cannot be referenced in an INSERT trigger's WHEN clause, which
-- is why this is a second trigger rather than one INSERT OR UPDATE trigger with
-- the test buried in the body.
drop trigger if exists trips_station_type_guard_upd on public.trips;
create trigger trips_station_type_guard_upd
  before update on public.trips
  for each row
  when (old.water_station is distinct from new.water_station
        or old.water_type is distinct from new.water_type)
  execute function public.trips_station_offers_water_type();

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
--
-- Every block that writes is wrapped in an explicit transaction ending in
-- ROLLBACK, so the whole suite leaves the table byte-identical. Run them in
-- order; block H re-checks the fingerprint at the end.
-- ===========================================================================
--
-- A) THE OBJECTS EXIST AND ARE SHAPED AS INTENDED:
--      select t.tgname,
--             t.tgenabled,
--             pg_get_triggerdef(t.oid) as def
--        from pg_trigger t
--       where t.tgrelid = 'public.trips'::regclass and not t.tgisinternal
--       order by t.tgname;
--      -- expect trips_set_ref_trigger (pre-existing) plus the two new ones;
--      -- tgenabled 'O' on all three; the _upd one must show its WHEN clause.
--
--      select p.prosecdef, p.proconfig
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='trips_station_offers_water_type';
--      -- expect prosecdef = true and proconfig = {search_path=public}.
--
-- B) IT BLOCKS a potable trip moving to Umm Al Hamam (which prices non-potable
--    only). Expect the raise, then a clean rollback:
--      begin;
--        update public.trips set water_station='umm_al_hamam_station'
--         where ref='KI-026-0062';   -- potable, in_transit, at Manfuhah
--      rollback;
--      -- expect: ERROR ... "Umm Al Hamam Station does not fill potable water.
--      --         Pick a station that does, or add that type to this station
--      --         under Manage stations."  SQLSTATE 23514
--
-- C) IT ALLOWS the same trip moving to a station that DOES price potable:
--      begin;
--        update public.trips set water_station='shas_water_station'
--         where ref='KI-026-0062'
--         returning ref, water_station, water_type, filling_cost_sar;
--      rollback;
--      -- expect 1 row, no error. NOTE filling_cost_sar comes back UNCHANGED at
--      -- 15.00 even though Shas prices potable at 80.00 — this trigger does not
--      -- reprice, by design. The app's re-snapshot is what moves it, and that
--      -- is the point of keeping the money rule in one place.
--
-- D) IT ALLOWS a valid non-potable move TO Umm Al Hamam — the gate is
--    type-specific, not a blanket ban on the station:
--      begin;
--        update public.trips set water_station='umm_al_hamam_station'
--         where ref='AI-026-0021'    -- non_potable, in_transit, at Manfuhah
--         returning ref, water_station, water_type;
--      rollback;
--      -- expect 1 row, no error.
--
-- E) IT DOES NOT FIRE when station and type are unchanged. This is the one that
--    protects every unrelated write in the app — if it fails, the backfill
--    pattern and every stage move are broken:
--      begin;
--        -- same station, same type, only the money column moves
--        update public.trips set filling_cost_sar = filling_cost_sar
--         where water_station='umm_al_hamam_station' and water_type='potable';
--        -- expect UPDATE 13, no error: these are the grandfathered rows, and
--        -- they are INVALID under the new rule yet must still be writable.
--        update public.trips set stage = stage where ref='KI-026-0062';
--        -- expect UPDATE 1, no error.
--        update public.trips set water_station = water_station where ref='KI-026-0062';
--        -- expect UPDATE 1, no error — assigning the SAME value is not
--        -- DISTINCT FROM itself, so the WHEN clause skips it.
--      rollback;
--
-- F) INSERT IS GATED TOO. Expect a raise on the first, success on the second:
--      begin;
--        insert into public.trips (project_id, water_station, water_type, trip_date)
--        select project_id, 'umm_al_hamam_station', 'potable', current_date
--          from public.trips where ref='KI-026-0062';
--      rollback;
--      -- expect ERROR 23514, same sentence as B.
--
--      begin;
--        insert into public.trips (project_id, water_station, water_type, trip_date)
--        select project_id, 'manfuhah_station', 'potable', current_date
--          from public.trips where ref='KI-026-0062'
--        returning ref, water_station, water_type, filling_cost_sar;
--      rollback;
--      -- expect 1 row, no error, filling_cost_sar NULL — the trigger does not
--      -- price a row; createTrip does that server-side before the insert.
--
-- G) THE 13 GRANDFATHERED ROWS ARE UNTOUCHED — the whole point of a trigger
--    over a constraint:
--      select count(*) as still_there, min(trip_date) as first_day,
--             max(trip_date) as last_day, count(filling_cost_sar) as costed
--        from public.trips
--       where water_station='umm_al_hamam_station' and water_type='potable';
--      -- expect 13 / 2026-06-29 / 2026-07-05 / 0.
--      -- Every one of these violates the new rule and every one still exists.
--
-- H) NO MONEY MOVED, ANYWHERE. Captured immediately before drafting; re-run
--    after applying and after the blocks above:
--      select count(*) as trips, count(filling_cost_sar) as costed,
--             sum(filling_cost_sar) as filling_total,
--             md5(string_agg(id::text||':'||coalesce(filling_cost_sar::text,'null'),
--                            ',' order by id)) as fingerprint
--        from public.trips;
--      -- expect EXACTLY:
--      --   trips 739 | costed 726 | filling_total 6280.00
--      --   fingerprint b8e4cdb82803445915a4bdf1733bbee9
--      -- A different fingerprint with the same total means a row's cost moved
--      -- and another's compensated — which a total alone would hide.
--
-- I) THE P&L IS UNMOVED. This migration adds enforcement, not arithmetic:
--      select to_char(month,'YYYY-MM') as m, filling_cost_sar, filling_uncosted_trips,
--             operating_cost_sar, net_profit_sar, operating_margin_pct
--        from public.v_pnl_monthly order by month;
--      -- expect Jun 210.00/10, Jul 1,285.00/3, Aug 4,390.00/0 — identical to
--      -- the figures verified before this file existed.
--
-- J) THE APP SURFACES THE RAISE RATHER THAN 500-ING. Confirmed by reading the
--    three write paths, all of which already return the error instead of
--    throwing: createTrip, setTripStage and setTripStation each end in
--    `if (error) return { error: error.message }`, and supabase-js puts the
--    RAISE message — the sentence above, not a stack trace — in `error.message`.
--    ProjectsBoard renders it through setError / the picker's own error line.
--    So the DB message reaches the user in the same place the app gate's does.
--    Worth one browser check anyway, because it is the only part of this file
--    that cannot be proven in SQL: force it by temporarily removing the app
--    gate's early return, or by running B against a real session.
-- ===========================================================================
