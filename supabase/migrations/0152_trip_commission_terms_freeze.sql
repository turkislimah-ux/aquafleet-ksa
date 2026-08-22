-- 0152_trip_commission_terms_freeze.sql
-- Freeze the COMMISSION TERMS onto every delivered trip. Option B, ruled.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses rolled back, applies.
--
-- ===========================================================================
-- THE RULE THIS SERVES (decided; this file is only step 1 of 2)
-- ===========================================================================
-- A trip freezes the commission RATE it was delivered under.
-- recomputeDailyCommission keeps re-ranking positions by delivered_at, but
-- prices EACH trip at ITS OWN frozen rate at its live position, instead of
-- resolving ONE commission_config_at() for the whole (driver, project,
-- trip_date) bucket. A same-day rate change then reaches only trips delivered
-- after it; already-delivered trips never move to a newer rate.
--
-- THIS FILE DOES NOT IMPLEMENT THAT. It adds the three columns the rule needs
-- and stamps the trips that already exist. NOTHING IS PRICED DIFFERENTLY BY
-- THIS MIGRATION: no commission_sar is written, and no function that computes
-- one is touched. The stamp point (setTripStage/priceDelivery) and the
-- recompute rewire are APP CODE in app/trips/actions.ts and ship separately,
-- as a diff the architect reviews. Until that lands, the three columns are
-- written by this file and read by nobody, which is deliberate and is what
-- makes this migration inert.
--
-- ===========================================================================
-- WHY VALUES, NOT A REFERENCE TO THE HISTORY ROW - THE EVIDENCE
-- ===========================================================================
-- The obvious cheaper design is a project_commission_history_id FK on the trip.
-- It is wrong, and the live rows prove it rather than the argument.
--
-- set_project_commission (0148) upserts:
--     on conflict (project_id, effective_from) do update set
--       commission_mode = ..., commission_value = ..., commission_bump_pct = ...
-- and created_at is NOT in that SET list. So a history row is MUTABLE in place
-- for its whole effective date, and its created_at keeps pointing at the FIRST
-- write.
--
-- Measured, project "R TTT", trip_date 2026-08-22. ONE history row exists for
-- that date - effective_from 2026-08-22, commission_value 15.00, created_at
-- 11:48:48 - and six trips were delivered against it:
--
--     delivered_at 11:49:39   commission_sar 15.00
--     delivered_at 11:50:28   commission_sar 15.00
--     delivered_at 11:52:52   commission_sar 20.00
--     delivered_at 11:53:01   commission_sar 20.00
--     delivered_at 18:45:26   commission_sar 15.00
--     delivered_at 18:45:42   commission_sar 15.00
--
-- Read that sequence back and the row's whole life is visible in trips and
-- nowhere else: written at 11:48:48 holding 15.00, upserted to 20.00 around
-- 11:51, upserted BACK to 15.00 before 18:45. THREE writes, and created_at
-- still says 11:48:48 - because created_at is not in the SET list, it dates
-- the first write, not the current values.
--
-- So the row is not a fact, it is a mutable cell. A trip holding a FK to it
-- would have repriced twice that afternoon without anything touching the trip.
-- The 20.00 those two middle trips were delivered under survives NOWHERE
-- except trips.commission_sar - which is precisely why the trip must own a
-- COPY of the values, and why created_at cannot serve as the change-moment
-- signal a delivery-moment freeze would otherwise want.
--
-- Storing the VALUES makes the trip immune to the history table's mutability.
-- That is the design's real payoff, not a side effect.
--
-- ===========================================================================
-- COLUMN TYPES - RULED, AND THE ONE WAY THEY COULD BITE
-- ===========================================================================
-- Ruled: commission_mode text, commission_base_sar numeric(12,2),
--        commission_bump_pct numeric(6,2).
--
-- The SOURCE columns (project_commission_history.commission_value /
-- .commission_bump_pct) are bare `numeric`. These are scale-pinned instead, to
-- match the house style of every other frozen money column on trips
-- (rate_sar, commission_sar, filling_cost_sar are all numeric(12,2)).
--
-- Measured before ruling, so this is lossless TODAY:
--     max(scale(commission_value))    = 2      (12 history rows, 10.00 .. 60.00)
--     max(scale(commission_bump_pct)) = 2      (max bump 10.00)
--
-- THE ONE WAY IT COULD BITE, recorded so it is not rediscovered: 0148 validates
-- commission_value >= 0 and bump 0..50 but does NOT constrain SCALE. A future
-- 3-decimal entry (33.333) would be stored intact in the history row and ROUND
-- to 33.33 on the stamp, so the trip's frozen rate would no longer equal the
-- terms in force. If that ever matters, the fix belongs in
-- set_project_commission (round/validate at the source), NOT in a wider type
-- here - one 2dp rule beats two disagreeing precisions.
--
-- ===========================================================================
-- COLUMN NAMES
-- ===========================================================================
-- commission_base_sar, NOT commission_value. A column named commission_value
-- sitting beside commission_sar on the same row is two names one letter apart
-- where one is the INPUT RATE and the other is the MONEY PAID. `base` is the
-- word lib/commission.ts already uses for that argument
-- (commissionForNthTrip(base, mode, bumpPct, n)), so the column is named after
-- the parameter it feeds.
--
-- ===========================================================================
-- WHY THE BACKFILL CANNOT MOVE MONEY - STRUCTURE, NOT CARE
-- ===========================================================================
-- 1. The UPDATE's SET list names only the three NEW columns. It cannot move
--    commission_sar because it does not name commission_sar.
-- 2. The three columns did not exist one statement earlier, so nothing reads
--    them: no view, no function, no app code. Verified - the five views that
--    read trips.commission_sar are v_commissions_monthly, v_daily_operations,
--    v_driver_commission_by_project_monthly, v_driver_payslip_basis and
--    v_pnl_monthly, and all five are fingerprinted before and after below.
-- 3. Neither of the two BEFORE UPDATE triggers on trips can fire:
--    trips_set_ref_trigger is INSERT-only, and trips_station_type_guard_upd
--    carries WHEN (old.water_station is distinct from new.water_station
--    or old.water_type is distinct from new.water_type) - and this UPDATE
--    writes neither column.
-- 4. It is asserted anyway. Block (g) recomputes sum, non-null count and a
--    per-row md5 of commission_sar and RAISES if any of the three moved, so a
--    drift aborts the transaction rather than being reported afterwards.
--
-- ===========================================================================
-- WHAT THE BACKFILL CAN AND CANNOT RECOVER - STATED, NOT BURIED
-- ===========================================================================
-- The backfill sources each trip's frozen terms from
-- commission_config_at(project_id, trip_date) - "the rate in force on its
-- date". That resolver returns only the LAST config for that date, because
-- the same-day upsert overwrites in place (see the R TTT evidence above).
--
-- SO: a trip delivered under a SUPERSEDED same-day rate is stamped with the
-- later one. On today's data that is exactly two trips, both on the test
-- project R TTT (stored 20.00, stamped 15.00). RULED: accept, no
-- special-casing. They are test data, they are unpaid, and the money-safety
-- proof below is unaffected because it is measured per project and every REAL
-- project has zero unpaid divergence.
--
-- The corollary is a sequencing fact with teeth: every further same-day
-- commission change destroys another window of recoverable history. Once this
-- ships, that stops mattering - the trip carries its own copy.
--
-- ===========================================================================
-- MEASURED AT DRAFT TIME (2026-08-22). Anchors, not assumptions.
-- ===========================================================================
--   trips                                            836
--   delivered (delivered_at is not null)             759
--   stampable (delivered + project_id + driver_id)   757
--   delivered with a project but NO driver             1
--   delivered with a driver but NO project             1
--   sum(commission_sar)                        16,064.36
--   delivered rows with a NULL commission_sar          0
--   undelivered rows with a NON-NULL commission_sar    0
--   trips commission_sar md5    b4b524f95d797e94c15141db3a3d8d52
--
-- The md5 is recorded for the record only and is NOT asserted against a
-- constant - a trip delivered between drafting and applying would change it
-- legitimately. Block (g) compares before against after WITHIN this
-- transaction instead, which is the property that actually matters.
--
-- The five anchor COUNTS are asserted, because the architect asked to be told
-- if the shape moved. If trips were delivered during testing since drafting,
-- that raise is DRIFT, NOT A DEFECT: re-measure with block A of the
-- VERIFICATION section and edit the single _0152_anchor block below.
--
-- ===========================================================================
-- THE TWO TRIPS THAT KEEP THEIR NULL
-- ===========================================================================
-- One delivered trip has a project and no driver; one has a driver and no
-- project. Neither is stamped. No driver means no commission terms apply; no
-- project means there is no commission history to resolve and never will be
-- (this is the same direct-customer trip 0128 deliberately left NULL). The
-- UPDATE is written so they are simply not selected, rather than joined and
-- coalesced into something invented.
--
-- ===========================================================================
-- ACL: NOTHING TO RE-ISSUE, AND IT IS CHECKED
-- ===========================================================================
-- Unlike 0151 (where DROP FUNCTION discarded the ACL and every grant had to be
-- restated), trips carries TABLE-level grants only - pg_attribute.attacl is
-- NULL on every column - so new columns inherit the table privileges with no
-- grant statement. Block (h) reads that back with has_column_privilege rather
-- than assuming it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- (a) ANCHORS. ONE place to edit if the data moved since drafting.
-- ---------------------------------------------------------------------------
create temp table _0152_anchor on commit drop as
select 836::bigint as trips_total,
       759::bigint as delivered,
       757::bigint as stampable,
         1::bigint as deliv_no_project,
         1::bigint as deliv_no_driver;

-- ---------------------------------------------------------------------------
-- (b) MONEY FINGERPRINT, BEFORE. Captured first, before any DDL.
-- ---------------------------------------------------------------------------
create temp table _0152_money_before on commit drop as
select coalesce(sum(commission_sar), 0)                as total,
       count(*) filter (where commission_sar is not null) as stamped,
       md5(string_agg(id::text || ':' || coalesce(commission_sar::text, '-'),
                      ',' order by id))                as fp
  from public.trips;

-- The five views that read trips.commission_sar, fingerprinted through ONE
-- expression so the before and after images cannot drift by a typo. A temp
-- VIEW (not a table) - it is the definition; the tables below are its images.
create temp view _0152_money_views as
  select 'v_commissions_monthly'::text as view_name,
         (select md5(string_agg(month::text || ':' ||
                                coalesce(trip_commission_sar::text, '-'),
                                ',' order by month))
            from public.v_commissions_monthly) as fp
  union all
  select 'v_daily_operations',
         (select md5(string_agg(day::text || ':' ||
                                coalesce(trip_commission_sar::text, '-'),
                                ',' order by day))
            from public.v_daily_operations)
  union all
  select 'v_driver_commission_by_project_monthly',
         (select md5(string_agg(month::text || ':' || driver_id::text || ':' ||
                                project_id::text || ':' ||
                                coalesce(commission_sar::text, '-'),
                                ',' order by month, driver_id, project_id))
            from public.v_driver_commission_by_project_monthly)
  union all
  select 'v_driver_payslip_basis',
         (select md5(string_agg(period_start::text || ':' || driver_id::text || ':' ||
                                coalesce(commission_sar::text, '-') || ':' ||
                                coalesce(net_sar::text, '-'),
                                ',' order by period_start, driver_id))
            from public.v_driver_payslip_basis)
  union all
  select 'v_pnl_monthly',
         (select md5(string_agg(month::text || ':' ||
                                coalesce(commissions_sar::text, '-') || ':' ||
                                coalesce(net_profit_sar::text, '-'),
                                ',' order by month))
            from public.v_pnl_monthly);

create temp table _0152_views_before on commit drop as
select * from _0152_money_views;

-- ---------------------------------------------------------------------------
-- (c) PRE-FLIGHT. Refuse to run against a shape this file was not written for.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_exists      text;
  v_total       bigint;
  v_delivered   bigint;
  v_stampable   bigint;
  v_no_project  bigint;
  v_no_driver   bigint;
  v_bad         bigint;
  a             record;
begin
  -- (c1) None of the three columns may already exist. No `if not exists` on the
  --      adds below, deliberately: a re-run must fail loudly rather than
  --      quietly re-stamping over a rate the app has since frozen.
  select string_agg(attname, ', ' order by attname) into v_exists
    from pg_attribute
   where attrelid = 'public.trips'::regclass
     and attnum > 0 and not attisdropped
     and attname in ('commission_mode', 'commission_base_sar', 'commission_bump_pct');
  if v_exists is not null then
    raise exception
      E'public.trips already carries: %\n  0152 has already been applied. It is not re-runnable by design - re-stamping would overwrite rates the app has frozen since.',
      v_exists;
  end if;

  if exists (select 1 from pg_constraint
              where conrelid = 'public.trips'::regclass
                and conname  = 'trips_commission_terms_all_or_none') then
    raise exception 'Constraint trips_commission_terms_all_or_none already exists on public.trips.';
  end if;

  -- (c2) Shape anchors.
  select count(*),
         count(*) filter (where delivered_at is not null),
         count(*) filter (where delivered_at is not null
                            and project_id is not null
                            and driver_id  is not null),
         count(*) filter (where delivered_at is not null and project_id is null),
         count(*) filter (where delivered_at is not null and driver_id  is null)
    into v_total, v_delivered, v_stampable, v_no_project, v_no_driver
    from public.trips;

  select * into a from _0152_anchor;

  if (v_total, v_delivered, v_stampable, v_no_project, v_no_driver)
     is distinct from
     (a.trips_total, a.delivered, a.stampable, a.deliv_no_project, a.deliv_no_driver) then
    raise exception
      E'Anchor counts moved since this file was drafted.\n  expected  trips=%  delivered=%  stampable=%  no_project=%  no_driver=%\n  actual    trips=%  delivered=%  stampable=%  no_project=%  no_driver=%\n  If trips were delivered during testing this is DRIFT, NOT A DEFECT: re-measure with block A of the VERIFICATION section, edit the _0152_anchor block, and re-run.',
      a.trips_total, a.delivered, a.stampable, a.deliv_no_project, a.deliv_no_driver,
      v_total, v_delivered, v_stampable, v_no_project, v_no_driver;
  end if;

  -- (c3) Structural invariants, count-independent. These must hold whatever
  --      testing has happened: a delivered trip carries money, an undelivered
  --      one does not. If either fails, the commission model is already broken
  --      and freezing terms on top of it would preserve the break.
  select count(*) into v_bad
    from public.trips
   where delivered_at is not null and commission_sar is null;
  if v_bad <> 0 then
    raise exception '% delivered trip(s) carry a NULL commission_sar. Fix that before freezing terms.', v_bad;
  end if;

  select count(*) into v_bad
    from public.trips
   where delivered_at is null and commission_sar is not null;
  if v_bad <> 0 then
    raise exception '% undelivered trip(s) carry a non-NULL commission_sar. Fix that before freezing terms.', v_bad;
  end if;

  -- (c4) Every stampable trip must RESOLVE a config. The backfill uses an inner
  --      lateral join, which would silently skip a trip whose project has no
  --      commission history covering its trip_date. Catch it here, where the
  --      message can say so, rather than as a missing stamp afterwards.
  select count(*) into v_bad
    from public.trips t
    left join lateral public.commission_config_at(t.project_id, t.trip_date) c on true
   where t.delivered_at is not null
     and t.project_id is not null
     and t.driver_id  is not null
     and c.commission_mode is null;
  if v_bad <> 0 then
    raise exception
      E'% stampable delivered trip(s) resolve NO commission config for their trip_date.\n  Their project''s commission history begins after the trip date. Correct the history or the trip date before stamping.',
      v_bad;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- (d) THE COLUMNS. Nullable by design - see the all-or-none check below for
--     what "null" is allowed to mean, and the header for why there is no
--     "delivered implies stamped" constraint (the app rewire ships after this
--     migration, so trips delivered in the gap legitimately carry NULL until
--     the recompute's self-heal or a re-run of the backfill sweeps them).
-- ---------------------------------------------------------------------------
alter table public.trips
  add column commission_mode     text,
  add column commission_base_sar numeric(12,2),
  add column commission_bump_pct numeric(6,2);

comment on column public.trips.commission_mode is
  'FROZEN AT DELIVERY (0152). The commission mode in force at this trip''s delivery moment, copied by VALUE from commission_config_at(project_id, trip_date). NOT a live read and NOT a reference to project_commission_history - that row is mutable in place via the same-day upsert in set_project_commission, so a reference would silently reprice a delivered trip. NULL until delivered, and NULL forever for a trip with no project or no driver (no terms apply). Re-stamped on every re-delivery: a pushed-back-then-re-delivered trip is a new delivery and takes the then-current rate.';

comment on column public.trips.commission_base_sar is
  'FROZEN AT DELIVERY (0152). The per-trip base the scalable ramp multiplies - the `base` argument of commissionForNthTrip in lib/commission.ts. NOT the money paid: that is commission_sar, which is this base priced at the trip''s live position in its (driver, project, trip_date) bucket. numeric(12,2) matches the other frozen money columns on this table; the source column is bare numeric and is 2dp in every row on file.';

comment on column public.trips.commission_bump_pct is
  'FROZEN AT DELIVERY (0152). The scalable step percentage in force at this trip''s delivery moment. 0 for fixed mode, which ignores it entirely (commissionForNthTrip returns the base before reading n or bumpPct). Frozen alongside commission_mode and commission_base_sar - all three are written and cleared together; see the trips_commission_terms_all_or_none constraint.';

-- ALL THREE OR NONE. A half-stamped row is the dangerous state: an unstamped
-- base reaches commissionForNthTrip's `!Number.isFinite(base) || base <= 0`
-- guard and prices a SILENT ZERO. Non-negativity mirrors trips_filling_cost_nonneg.
-- Deliberately does NOT cap bump at 50 - that is set_project_commission's
-- validation, and this column must not out-constrain its own source.
alter table public.trips
  add constraint trips_commission_terms_all_or_none check (
    (    commission_mode     is null
     and commission_base_sar is null
     and commission_bump_pct is null)
    or
    (    commission_mode in ('fixed', 'scalable')
     and commission_base_sar is not null and commission_base_sar >= 0
     and commission_bump_pct is not null and commission_bump_pct >= 0)
  );

-- ---------------------------------------------------------------------------
-- (e) BACKFILL. Expect UPDATE 757.
--
--     Subquery form, not `from public.commission_config_at(t.project_id, ...)`
--     directly, so there is no ambiguity about which relation the function's
--     arguments are drawn from.
--
--     `commission_mode is null` makes this re-runnable and, more importantly,
--     stops it ever overwriting a stamp the app has already frozen. Run it
--     again unchanged after the app rewire deploys to sweep the gap window.
--
--     The two trips without a driver / without a project are not selected and
--     keep their NULL. See the header.
-- ---------------------------------------------------------------------------
update public.trips t
   set commission_mode     = s.commission_mode,
       commission_base_sar = s.commission_value,
       commission_bump_pct = s.commission_bump_pct
  from (
    select x.id,
           c.commission_mode,
           c.commission_value,
           c.commission_bump_pct
      from public.trips x
      join lateral public.commission_config_at(x.project_id, x.trip_date) c on true
     where x.delivered_at    is not null
       and x.project_id      is not null
       and x.driver_id       is not null
       and x.commission_mode is null
  ) s
 where s.id = t.id;

-- ---------------------------------------------------------------------------
-- (f) STAMP ASSERTIONS. Read the result back; do not assume the UPDATE did
--     what the WHERE clause says it did.
-- ---------------------------------------------------------------------------
do $stamped$
declare
  v_missed   bigint;
  v_wrong    bigint;
  v_half     bigint;
  v_drift    bigint;
  v_types    text;
begin
  -- (f1) Every stampable delivered trip is stamped.
  select count(*) into v_missed
    from public.trips
   where delivered_at is not null
     and project_id is not null
     and driver_id  is not null
     and commission_mode is null;
  if v_missed <> 0 then
    raise exception '% stampable delivered trip(s) were NOT stamped by the backfill.', v_missed;
  end if;

  -- (f2) Nothing was stamped that should not have been.
  select count(*) into v_wrong
    from public.trips
   where commission_mode is not null
     and (delivered_at is null or project_id is null or driver_id is null);
  if v_wrong <> 0 then
    raise exception
      '% trip(s) carry frozen terms but are undelivered, projectless or driverless. Terms must not exist without a delivery to freeze them at.',
      v_wrong;
  end if;

  -- (f3) All-or-none holds on every row. The constraint enforces it; this
  --      reads it back, because a constraint that was added but not violated
  --      proves nothing about the rows the backfill just wrote.
  select count(*) into v_half
    from public.trips
   where (commission_mode is null) is distinct from (commission_base_sar is null)
      or (commission_mode is null) is distinct from (commission_bump_pct is null);
  if v_half <> 0 then
    raise exception '% trip(s) are half-stamped. The all-or-none constraint did not hold.', v_half;
  end if;

  -- (f4) THE CORRECTNESS CHECK. Every stamped triple equals what
  --      commission_config_at returns for that project on that trip_date -
  --      byte for byte, not approximately. This is what makes the app rewire
  --      provably neutral later: the rewired recompute reads these columns,
  --      the current recompute reads that function, and here they are equal.
  select count(*) into v_drift
    from public.trips t
    join lateral public.commission_config_at(t.project_id, t.trip_date) c on true
   where t.commission_mode is not null
     and (t.commission_mode     is distinct from c.commission_mode
       or t.commission_base_sar is distinct from c.commission_value
       or t.commission_bump_pct is distinct from c.commission_bump_pct);
  if v_drift <> 0 then
    raise exception
      '% stamped trip(s) disagree with commission_config_at(project_id, trip_date). The stamp is not the resolver''s answer.',
      v_drift;
  end if;

  -- (f5) The types are what was ruled, read from the catalog rather than from
  --      the ALTER statement above.
  select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attname)
    into v_types
    from pg_attribute
   where attrelid = 'public.trips'::regclass
     and attname in ('commission_mode', 'commission_base_sar', 'commission_bump_pct');
  if v_types is distinct from
     'commission_base_sar numeric(12,2), commission_bump_pct numeric(6,2), commission_mode text' then
    raise exception E'Column types are not what was ruled.\n  got: %', v_types;
  end if;
end
$stamped$;

-- ---------------------------------------------------------------------------
-- (g) MONEY. This migration must not move a single commission_sar. Asserted
--     inside the transaction, so a drift ROLLS BACK instead of being noticed
--     afterwards.
-- ---------------------------------------------------------------------------
do $money$
declare
  b        record;
  v_total   numeric;
  v_stamped bigint;
  v_fp      text;
  v_bad     text;
begin
  select * into b from _0152_money_before;

  select coalesce(sum(commission_sar), 0),
         count(*) filter (where commission_sar is not null),
         md5(string_agg(id::text || ':' || coalesce(commission_sar::text, '-'), ',' order by id))
    into v_total, v_stamped, v_fp
    from public.trips;

  if v_total is distinct from b.total
     or v_stamped is distinct from b.stamped
     or v_fp is distinct from b.fp then
    raise exception
      E'THIS MIGRATION MOVED COMMISSION MONEY. It must not.\n  sum        before % / after %\n  non-null   before % / after %\n  row md5    before % / after %',
      b.total, v_total, b.stamped, v_stamped, b.fp, v_fp;
  end if;

  -- Second, independent check: the five views that read commission_sar.
  select string_agg(bv.view_name || '  before=' || coalesce(bv.fp, '(null)')
                                 || '  after='  || coalesce(av.fp, '(null)'), E'\n  ')
    into v_bad
    from _0152_views_before bv
    join _0152_money_views  av on av.view_name = bv.view_name
   where av.fp is distinct from bv.fp;

  if v_bad is not null then
    raise exception
      E'A commission-reading view moved. This migration adds unread columns and must be inert here.\n  %',
      v_bad;
  end if;
end
$money$;

-- ---------------------------------------------------------------------------
-- (h) ACL. New columns inherit the table grants because trips carries no
--     column-level ACL. Read that back rather than assuming it - 0151 is the
--     reason this block exists.
-- ---------------------------------------------------------------------------
do $acl$
declare
  v_col  text;
  v_role text;
begin
  foreach v_col in array array['commission_mode', 'commission_base_sar', 'commission_bump_pct'] loop
    foreach v_role in array array['authenticated', 'service_role'] loop
      if not has_column_privilege(v_role, 'public.trips', v_col, 'select') then
        raise exception 'Role % cannot SELECT public.trips.% - a grant was expected to be inherited and was not.', v_role, v_col;
      end if;
      if not has_column_privilege(v_role, 'public.trips', v_col, 'update') then
        raise exception 'Role % cannot UPDATE public.trips.% - a grant was expected to be inherited and was not.', v_role, v_col;
      end if;
    end loop;
  end loop;
end
$acl$;

-- Temp TABLES carry `on commit drop`; a temp VIEW cannot, so drop it by hand.
-- (An abort rolls it back with everything else - DDL is transactional here.)
drop view _0152_money_views;

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- New columns on an existing table. PostgREST reloads its schema cache on the
-- DDL event, but if a select of the new columns 400s with PGRST204 ("column
-- ... does not exist"), nudge it:
--     notify pgrst, 'reload schema';
-- Not needed until the app rewire ships - nothing selects these columns yet.
--
-- ===========================================================================
-- VERIFICATION - run these; do not assume.
-- ===========================================================================
--
-- A) SHAPE AND COVERAGE. This is also the block to re-measure from if the
--    pre-flight anchor raise fires.
--      select count(*)                                                   as trips_total,
--             count(*) filter (where delivered_at is not null)           as delivered,
--             count(*) filter (where delivered_at is not null
--                                and project_id is not null
--                                and driver_id  is not null)             as stampable,
--             count(*) filter (where delivered_at is not null and project_id is null) as deliv_no_project,
--             count(*) filter (where delivered_at is not null and driver_id  is null) as deliv_no_driver,
--             count(*) filter (where commission_mode is not null)        as stamped,
--             count(*) filter (where delivered_at is not null
--                                and project_id is not null
--                                and driver_id  is not null
--                                and commission_mode is null)            as missed
--        from public.trips;
--      -- expect 836 / 759 / 757 / 1 / 1 / 757 / 0
--      -- `missed` is the one that must be 0.
--
-- B) MONEY IS UNMOVED. The migration asserts this internally, but read it back.
--      select count(*)                          as trips,
--             sum(commission_sar)               as commission_total,
--             md5(string_agg(id::text || ':' || coalesce(commission_sar::text,'-'),
--                            ',' order by id))  as fp
--        from public.trips;
--      -- expect 836 / 16064.36 / b4b524f95d797e94c15141db3a3d8d52
--      -- (if trips were delivered between drafting and applying, the count,
--      --  total and md5 all move legitimately - what matters is that they are
--      --  identical either side of THIS migration, which block (g) enforced.)
--
-- C) EVERY STAMP EQUALS THE RESOLVER. Expect 0 rows:
--      select t.id, t.trip_date,
--             t.commission_mode, t.commission_base_sar, t.commission_bump_pct,
--             c.commission_mode, c.commission_value, c.commission_bump_pct
--        from public.trips t
--        join lateral public.commission_config_at(t.project_id, t.trip_date) c on true
--       where t.commission_mode is not null
--         and (t.commission_mode     is distinct from c.commission_mode
--           or t.commission_base_sar is distinct from c.commission_value
--           or t.commission_bump_pct is distinct from c.commission_bump_pct);
--
-- D) THE STAMPED TERMS PER PROJECT, eyeballed against what you know the rates
--    to be. Nothing here should surprise you.
--
--    GROUPED BY PROJECT ID, NOT NAME, AND THAT IS NOT PEDANTRY: there are TWO
--    projects called "King Salman Park" - an ARCHIVED one (1bbf496e, fixed
--    10.00, 3 delivered trips) and the ACTIVE one (7a94e22e, scalable 10.00 /
--    bump 3.00, 106 delivered trips). Grouped by name they read as one project
--    that changed mode mid-June, which is not what happened.
--
--      select p.id, p.name as project, p.archived_at is not null as archived,
--             t.commission_mode as mode, t.commission_base_sar as base,
--             t.commission_bump_pct as bump,
--             min(t.trip_date) as from_date, max(t.trip_date) as to_date,
--             count(*) as trips
--        from public.trips t join public.projects p on p.id = t.project_id
--       where t.commission_mode is not null
--       group by 1,2,3,4,5,6 order by 2, 3, 7;
--
--    Expect exactly these nine rows (757 trips total):
--      AAA Test 6                scalable 10.00 / 10.00   06-29..08-19   156
--      AAA Test 6                scalable 25.00 / 10.00   08-21..08-22     3
--      Airport facilities        scalable 12.00 /  2.00   07-16..08-15    85
--      King Salman Park (arch.)  fixed    10.00 /  0.00   06-29..06-29     3
--      King Salman Park          scalable 10.00 /  3.00   06-27..08-15   106
--      King Saud University      fixed    20.00 /  0.00   07-11..08-15   149
--      R TTT                     fixed    60.00 /  0.00   06-29..08-15   121
--      R TTT                     fixed    15.00 /  0.00   08-22..08-22     6
--      The Royal Court of Saudi  scalable 10.00 / 10.00   06-30..08-15   128
--
--    Only TWO projects split by rate, and both are test data: AAA Test 6 (the
--    2026-08-21 change to 25.00) and R TTT (the 2026-08-22 change to 15.00).
--    Every real project is a single row - no real commission rate has moved
--    since its baseline. That is also why the money-safety proof for the app
--    rewire holds: zero unpaid real-project trips can reprice.
--
--    R TTT's six 08-22 trips are the accepted casualty from the header: all six
--    are stamped 15.00, and two of them carry commission_sar 20.00 because they
--    were delivered under a superseded same-day rate that no longer exists
--    anywhere. RULED: accept. The first recompute of that bucket after the app
--    rewire will move those two to 15.00. Test data, unpaid, no real money.
--
-- E) THE ALL-OR-NONE CONSTRAINT IS ON AND HOLDS. Expect one row, and 0:
--      select conname, pg_get_constraintdef(oid)
--        from pg_constraint
--       where conrelid = 'public.trips'::regclass
--         and conname = 'trips_commission_terms_all_or_none';
--
--      select count(*) from public.trips
--       where (commission_mode is null) is distinct from (commission_base_sar is null)
--          or (commission_mode is null) is distinct from (commission_bump_pct is null);
--
-- F) THE COLUMNS ARE STILL UNREAD. The structural reason B can be trusted -
--    expect 0 on both:
--      select count(*) as views_reading_frozen_terms
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relkind='v'
--         and pg_get_viewdef(c.oid, true) ~ 'commission_(base_sar|bump_pct)\y';
--
--      select count(*) as routines_reading_frozen_terms
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public'
--         and p.prosrc ~ 'commission_(base_sar|bump_pct)\y';
--    -- Both go non-zero only when the app rewire ships, and it changes app
--    -- code, not SQL - so they should stay 0 permanently.
--
-- G) THE BOARD, in the browser, signed in. NOTHING SHOULD LOOK DIFFERENT.
--    That is the test. /trips -> Projects and /drivers -> Commissions must
--    show the same figures as before this ran. No UI reads the new columns.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Clean and total - this migration writes no existing column, so undoing it
-- loses nothing but the stamps, which the backfill regenerates identically.
--
--   begin;
--   alter table public.trips drop constraint trips_commission_terms_all_or_none;
--   alter table public.trips
--     drop column commission_mode,
--     drop column commission_base_sar,
--     drop column commission_bump_pct;
--   commit;
--
-- DO NOT ROLL BACK ONCE THE APP REWIRE IS LIVE. After that, these columns are
-- the sole record of the rate each delivered trip was frozen at, and
-- re-running the backfill would recover only "the last rate on that date" -
-- silently repricing any trip delivered under a superseded same-day rate. See
-- the R TTT evidence in the header. Roll back the app first, then this.
-- ===========================================================================
