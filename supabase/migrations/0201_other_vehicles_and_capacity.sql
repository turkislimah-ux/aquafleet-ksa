-- ===========================================================================
-- 0201 — OPERATION VEHICLES, AND A CAPACITY THAT CARRIES ITS UNIT
-- ===========================================================================
-- APPLIED prod + test 2026-09-16. Verified: 16 trucks, 483 m³, both constraints
-- validated, views 50 / 50 / 0, utilization unchanged.
--
-- WHAT THIS DOES
--   1. public.vehicle_types — a managed bilingual lookup, same model as
--      violation_types (0175) / staff_roles (0011) / units (0049).
--   2. trucks.vehicle_class  — 'truck' (the water fleet) or 'operation'.
--   3. trucks.vehicle_type_id — which kind of operation vehicle. NULL for trucks.
--   4. trucks.capacity_value + trucks.capacity_unit — capacity that states its
--      own unit instead of encoding it in a column name.
--   5. trucks_capacity_m3_consistent_check — capacity_m3 STAYS a plain stored
--      numeric column and is tied to capacity_value/capacity_unit by a
--      constraint, not by a generated expression.
--   6. trucks_vehicle_class_shape_check — the two class shapes, NOT VALID
--      then VALIDATEd.
--   7. Two indexes, and v_truck_day_state narrowed to vehicle_class = 'truck'
--      so operation vehicles never enter a utilization denominator.
--   8. A verification block that RAISES if any of it is untrue.
--
-- ---------------------------------------------------------------------------
-- RUN ORDER — READ THIS BEFORE APPLYING
-- ---------------------------------------------------------------------------
-- Apply 0201 FIRST, then deploy the app build that writes capacity_value and
-- capacity_unit. In that order, and close together.
--
-- Between the two, the CURRENT app's write path fails. app/fleet/actions.ts:82
-- (createTruck) and :145 (updateTruck) write capacity_m3 and nothing else, so
-- they leave capacity_value NULL and trip 23514 on
-- trucks_capacity_m3_consistent_check. Add-Truck and Edit-Truck are down for
-- the length of the deploy. NOTHING ELSE IS: every read keeps working, every
-- other page keeps working, and no existing row changes.
--
-- The reverse order is not an option. A build that writes capacity_value
-- against the pre-0201 schema fails 42703 — the column does not exist yet.
-- There is no order with a zero window; this is the short one, and it fails in
-- the loud, obvious place rather than silently.
--
-- Read sites are untouched by design. capacity_m3 keeps its name, its type,
-- its values, and its position in the column order:
--   app/page.tsx:162, app/archive/page.tsx:127, app/fleet/FleetClient.tsx:513,
--   app/fleet/page.tsx:202, app/fleet/[id]/FleetDetailClient.tsx:350/463/489,
--   app/maintenance/page.tsx:57, app/trips/page.tsx:138/176/263.
--
-- ---------------------------------------------------------------------------
-- WHY A CHECK CONSTRAINT AND NOT A GENERATED COLUMN
-- ---------------------------------------------------------------------------
-- A generated capacity_m3 would be read-only (428C9 on any write) and would
-- have forced a DROP COLUMN, which in turn forces dropping and recreating
-- v_delivery_output_daily and moves capacity_m3 to the end of the column
-- order. A CHECK constraint buys the same guarantee — capacity_m3 can never
-- disagree with capacity_value — while leaving the column, the view and the
-- column order exactly where they are. The cost is that the app must write
-- both, and the constraint is what makes sure it does.
--
-- The predicate uses IS NOT DISTINCT FROM, not =, because both sides are
-- nullable and `null = null` is null, which a CHECK treats as passing. An
-- operation vehicle rated in litres must land capacity_m3 = NULL, and this is
-- the form that actually enforces it.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS MEASURED, NOT ASSUMED (2026-09-16)
-- ---------------------------------------------------------------------------
-- PROD (ceqzmztewbborwgxnrqh), public.trucks:
--   16 rows · 0 with capacity_m3 NULL · capacities are 18.00 and 33.00 only
--   · 15 rows at status = 'active' · 9 rows with a driver assigned.
--   => after the backfill below, both constraints VALIDATE clean on today's
--      data. If a capacity-less truck is added before this runs, VALIDATE
--      fails LOUDLY and names the constraint. Intended, not a surprise.
--
-- TEST (vlyxazfinmlanjdttavg), public.trucks: 0 rows. VALIDATE there proves
-- the SYNTAX, not the data. The data claim can only be made on prod.
--
-- VIEWS THAT READ public.trucks (pg_depend + pg_rewrite, live, 10 of them):
--   v_active_alerts, v_activity_feed, v_dashboard_action_items,
--   v_delivery_output_daily, v_driver_state_now, v_drivers_ops_now,
--   v_maintenance_cost_per_truck_monthly, v_operations_by_driver_monthly,
--   v_revenue_per_truck_monthly, v_truck_day_state.
--
-- THE UTILIZATION FAMILY READS trucks IN EXACTLY ONE PLACE. Measured, not
-- assumed: v_truck_utilization_monthly, v_fleet_utilization_monthly and
-- v_truck_utilization_rolling30 all select `from v_truck_day_state s` and
-- contain NO trucks alias at all. Only v_truck_day_state joins public.trucks.
-- So the class filter goes in one view and the other three inherit it. They
-- are NOT replaced here — a byte-identical CREATE OR REPLACE would be a no-op
-- that risks 42P16 for nothing. The verify block still checks all four.
--
-- Live column counts before this file (pg_attribute):
--   v_truck_day_state 7 · v_truck_utilization_monthly 8 ·
--   v_fleet_utilization_monthly 6 · v_truck_utilization_rolling30 8.
-- v_truck_day_state keeps all 7, same order, same types (42P16).
--
-- v_fleet_state_now IS DELIBERATELY NOT CHANGED. Its truck counts will include
-- operation vehicles until someone decides otherwise. That is a decision, not
-- an oversight.
--
-- THE VIEW BODY IN SECTION 8 IS THE LIVE ONE. Dumped with
-- pg_get_viewdef('public.v_truck_day_state'::regclass, true) against the test
-- project and compared against its source (0189:904, which superseded
-- 0130:91) — they agree. Restated here in 0189's hand-written form with the
-- class filter added and nothing else touched.
--
-- RE-RUNNABLE: `if not exists` everywhere, `on conflict (key) do nothing` on
-- the seed, constraint adds guarded on pg_constraint, view via CREATE OR
-- REPLACE. The backfill's WHERE matches nothing on a second run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. vehicle_types — the managed lookup.
--
-- Shape copied from violation_types (0175), which is itself staff_roles (0011)
-- and units (0049): an immutable `key`, a bilingual label pair, an `active`
-- soft-retire flag, created_at. label_ar is NOT NULL, as in 0175 — the table is
-- born bilingual, so no backfill migration will ever be needed for it.
--
-- sort_order is the one addition to that shape. The seeded five have a
-- deliberate order (the two the yard actually owns first) and alphabetical is
-- not it; archive_document_groups (0084) already uses an integer sort_order for
-- the same reason.
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_types (
  id          uuid        primary key default gen_random_uuid(),

  key         text        not null,
  label       text        not null,
  label_ar    text        not null,

  sort_order  integer     not null default 0,
  active      boolean     not null default true,

  created_at  timestamptz not null default now(),

  constraint vehicle_types_key_unique unique (key),

  -- Blank-but-present is what NOT NULL does not catch: a form that submits an
  -- empty string produces a nameless row in the picker. Same three checks
  -- violation_types carries.
  constraint vehicle_types_key_not_blank      check (btrim(key) <> ''),
  constraint vehicle_types_label_not_blank    check (btrim(label) <> ''),
  constraint vehicle_types_label_ar_not_blank check (btrim(label_ar) <> '')
);

-- Seed. `on conflict (key) do nothing` makes the file re-runnable AND, more
-- importantly, does not overwrite a label Turki has since edited in-app.
insert into public.vehicle_types (key, label, label_ar, sort_order) values
  ('pickup',       'Pickup',       'بيك أب',      1),
  ('diesel_truck', 'Diesel truck', 'شاحنة ديزل',  2),
  ('tractor',      'Tractor',      'جرار',        3),
  ('crane',        'Crane',        'رافعة',       4),
  ('other',        'Other',        'أخرى',        5)
on conflict (key) do nothing;

-- RLS + the anon revoke. `using (true) with check (true)` — the shared-lookup
-- shape, not the own-row shape: a vehicle type is fleet vocabulary, either user
-- maintains it. The revoke is restated per-table even though 0161 already
-- revoked anon schema-wide, because 0161's default-privilege change only covers
-- tables created after it and this file must read correctly on its own
-- (CLAUDE.md section 6).
alter table public.vehicle_types enable row level security;

drop policy if exists authenticated_all_vehicle_types on public.vehicle_types;
create policy authenticated_all_vehicle_types
  on public.vehicle_types for all to authenticated
  using (true) with check (true);

revoke all on public.vehicle_types from anon;

comment on table public.vehicle_types is
  'LOOKUP VOCABULARY for operation vehicles — vehicle_class = ''operation'' (0201). Same model as violation_types (0175), staff_roles (0011) and units (0049): an immutable `key`, a bilingual pair of display names, a sort_order for the picker, and an `active` flag that retires a type without deleting it. Turki maintains this list in-app. NO CODE MAY HARDCODE A KEY FROM THIS TABLE — the list is user-editable and a key that code depends on is a key that stops being editable. trucks.vehicle_type_id references this table by id with ON DELETE RESTRICT, so a hard delete of a type a vehicle points at fails loudly instead of orphaning the row; retiring means active = false.';

comment on column public.vehicle_types.key is
  'IMMUTABLE identifier (CLAUDE.md section 6). A rename updates label / label_ar and NEVER this.';

comment on column public.vehicle_types.label_ar is
  'Arabic display name. NOT NULL, like violation_types.label_ar and for the same reason: the table is born with it, so the in-app create form must collect Arabic. An English-only insert fails with 23502.';

comment on column public.vehicle_types.active is
  'Soft-retire flag. FALSE hides the type from the picker while keeping it readable on the vehicles that already reference it. This is the delete path — there is no other one (CLAUDE.md section 6).';

comment on column public.vehicle_types.sort_order is
  'Picker order, ascending. Ties break on label. Not a key and not stable identity — reordering the list is a display change and nothing may depend on a particular number.';


-- ---------------------------------------------------------------------------
-- 2-4. The new trucks columns.
--
-- vehicle_class defaults to 'truck' so all 16 existing rows classify correctly
-- without an UPDATE, and so a row inserted by code that has never heard of this
-- column still lands in the right class. PG11+ does not rewrite the table for a
-- non-volatile default.
--
-- capacity_unit defaults to 'm3' for the same reason: the fleet is cubic metres
-- today, and a writer that omits the unit must not invent litres.
-- ---------------------------------------------------------------------------
alter table public.trucks
  add column if not exists vehicle_class   text not null default 'truck',
  add column if not exists vehicle_type_id uuid references public.vehicle_types(id) on delete restrict,
  add column if not exists capacity_value  numeric,
  add column if not exists capacity_unit   text not null default 'm3';

-- Domain checks on the two new text columns. Separate named constraints rather
-- than inline, matching trucks_status_check / trucks_termination_reason_check —
-- each one named for the column it guards.
-- Guarded because ADD CONSTRAINT has no IF NOT EXISTS.
do $add_domain_checks$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.trucks'::regclass
                    and conname  = 'trucks_vehicle_class_check') then
    alter table public.trucks
      add constraint trucks_vehicle_class_check
      check (vehicle_class in ('truck', 'operation'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.trucks'::regclass
                    and conname  = 'trucks_capacity_unit_check') then
    alter table public.trucks
      add constraint trucks_capacity_unit_check
      check (capacity_unit in ('m3', 'l'));
  end if;
end $add_domain_checks$;

-- BACKFILL. Must run BEFORE either of the two constraints below is validated:
-- it is what makes today's 16 rows satisfy them. Re-running is a no-op — the
-- WHERE matches nothing once the columns agree.
update public.trucks
   set capacity_value = capacity_m3,
       capacity_unit  = 'm3'
 where capacity_value is distinct from capacity_m3
    or capacity_unit  is distinct from 'm3';


-- ---------------------------------------------------------------------------
-- 5. capacity_m3 stays a plain numeric column, tied to its source.
--
-- The column is NOT dropped, NOT regenerated, NOT reordered, and no view is
-- touched by this section. The constraint is the whole mechanism: capacity_m3
-- must equal capacity_value when the unit is m3, and must be NULL when it is
-- litres. A litre-rated vehicle therefore contributes NULL to
-- v_delivery_output_daily's sum(), which sum() skips — a bowser measured in
-- litres can never silently inflate a cubic-metre total.
--
-- IS NOT DISTINCT FROM, not =: with `=` a row holding NULL on both sides
-- evaluates to NULL, and a CHECK passes on NULL. That would let a litre-rated
-- vehicle keep a stale capacity_m3 forever.
--
-- NOT VALID then VALIDATE, same as section 6, so a row that disagrees fails
-- with this constraint's own name instead of an anonymous rewrite error.
-- ---------------------------------------------------------------------------
do $add_capacity_check$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.trucks'::regclass
                    and conname  = 'trucks_capacity_m3_consistent_check') then
    alter table public.trucks
      add constraint trucks_capacity_m3_consistent_check
      check (
        capacity_m3 is not distinct from
        (case when capacity_unit = 'm3' then capacity_value end)
      ) not valid;
  end if;
end $add_capacity_check$;

alter table public.trucks validate constraint trucks_capacity_m3_consistent_check;

comment on column public.trucks.capacity_m3 is
  'The cubic-metre reading of capacity_value. Kept as a plain stored column so that every reader written before 0201 — and v_delivery_output_daily''s capacity sum — keeps working unchanged. It is NOT free to diverge: trucks_capacity_m3_consistent_check pins it to capacity_value when capacity_unit = ''m3'' and forces it NULL when the unit is litres. WRITE IT TOGETHER WITH capacity_value AND capacity_unit, always, in the same statement.';

comment on column public.trucks.capacity_value is
  'The capacity number, in whatever unit capacity_unit names. NULL means unknown / not applicable. For vehicle_class = ''truck'' it is NOT NULL and the unit is m3 — enforced by trucks_vehicle_class_shape_check.';

comment on column public.trucks.capacity_unit is
  'The unit capacity_value is measured in: ''m3'' or ''l''. NOT NULL, defaulted to ''m3'' — a writer that omits the unit must not invent litres. Trucks are pinned to m3 by trucks_vehicle_class_shape_check; litres exists for operation vehicles.';

comment on column public.trucks.vehicle_class is
  '''truck'' = the water fleet, the only thing this table held before 0201. ''operation'' = a support vehicle (pickup, crane, tractor ...), which carries a vehicle_type_id instead of a capacity and takes no driver assignment. The two shapes are enforced by trucks_vehicle_class_shape_check. Operation vehicles are excluded from v_truck_day_state and therefore from every utilization figure; they are NOT excluded from v_fleet_state_now.';

comment on column public.trucks.vehicle_type_id is
  'Which kind of operation vehicle this is (vehicle_types, 0201). NOT NULL when vehicle_class = ''operation'', and NULL when it is ''truck'' — a truck''s type is the fact that it is a truck. ON DELETE RESTRICT: retiring a type means active = false, never a delete.';


-- ---------------------------------------------------------------------------
-- 6. The two class shapes, in one constraint.
--
-- NOT VALID then VALIDATE, deliberately in two statements. NOT VALID makes the
-- constraint bind on every future write immediately; VALIDATE then walks the
-- existing 16 rows and FAILS THE WHOLE MIGRATION if any of them disagrees.
--
-- vehicle_class is NOT NULL and constrained to two values, so exactly one
-- branch is live per row and neither NULL nor a third value can slip past.
--
-- NOTE WHAT IS *NOT* HERE: no clause on trucks.status. Measured — status is
-- written in exactly one place (app/fleet/actions.ts:88, the literal 'active'
-- at insert), never transitioned afterwards by any app path, any RPC or any
-- trigger, and never read for display (lib/truck-status.ts derives state).
-- Constraining a dead column would only have made createTruck fail.
-- ---------------------------------------------------------------------------
do $add_shape_check$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.trucks'::regclass
                    and conname  = 'trucks_vehicle_class_shape_check') then
    alter table public.trucks
      add constraint trucks_vehicle_class_shape_check
      check (
           (vehicle_class = 'truck'
            and capacity_unit   = 'm3'
            and capacity_value  is not null
            and vehicle_type_id is null)
        or (vehicle_class = 'operation'
            and vehicle_type_id    is not null
            and assigned_driver_id is null)
      ) not valid;
  end if;
end $add_shape_check$;

alter table public.trucks validate constraint trucks_vehicle_class_shape_check;


-- ---------------------------------------------------------------------------
-- 7. Indexes.
--
-- vehicle_class: partial on the live fleet, because every list that will split
-- trucks from operation vehicles already filters terminated_at is null — the
-- same shape trucks_active_idx (0002) uses.
--
-- vehicle_type_id: a plain index on the FK. Postgres does not create one, and
-- an unindexed FK makes every DELETE or key UPDATE on vehicle_types seq-scan
-- trucks (supabase-postgres-best-practices, schema-foreign-key-indexes). At 16
-- rows this is free either way; it is here so it does not have to be
-- remembered at 16 000.
-- ---------------------------------------------------------------------------
create index if not exists trucks_vehicle_class_idx
  on public.trucks (vehicle_class)
  where terminated_at is null;

create index if not exists trucks_vehicle_type_id_idx
  on public.trucks (vehicle_type_id);


-- ---------------------------------------------------------------------------
-- 8. v_truck_day_state — operation vehicles out of the utilization denominator.
--
-- This is the ONLY view in the utilization family that reads public.trucks.
-- v_truck_utilization_monthly, v_fleet_utilization_monthly and
-- v_truck_utilization_rolling30 all read `from v_truck_day_state s` and are
-- left alone; they inherit the filter.
--
-- Body restated verbatim from 0189:904 (which superseded 0130:91) and verified
-- against the live pg_get_viewdef. Same 7 columns, same order, same types —
-- 42P16 permits nothing else. CREATE OR REPLACE keeps the comment; it does NOT
-- keep reloptions or grants, so the footer is restated below (CLAUDE.md §6).
--
-- TWO lines changed, both the same predicate:
--   · the spine's min(created_at) subquery — so an operation vehicle can never
--     lengthen the day spine, which would inflate out_of_service_days.
--   · the base CTE's trucks alias — the one that matters.
-- The base CTE had no WHERE clause before, so the predicate appears as `where`
-- rather than `and`. Nothing else in the body moved.
-- ---------------------------------------------------------------------------
create or replace view public.v_truck_day_state as
with spine as (
  select generate_series(
           (select min(created_at)::date from public.trucks
             where vehicle_class = 'truck'),
           greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
           interval '1 day')::date as day
),
down_windows as (
  -- RULING 1 + RULING 2: both tracks, started-or-finished work only.
  select w.truck_id,
         w.opened_at::date                                                as from_day,
         coalesce(w.closed_at::date, (now() at time zone 'Asia/Riyadh')::date) as to_day
    from public.work_orders w
   where w.status in ('in_progress', 'completed')
  union all
  select o.truck_id,
         o.start_date                                                     as from_day,
         coalesce(o.closed_at::date, (now() at time zone 'Asia/Riyadh')::date) as to_day
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
   -- 0201: utilization measures the WATER FLEET. An operation vehicle has no
   -- trips by construction, so leaving it in would add a permanent row of
   -- available-but-never-worked days and drag every fleet percentage down.
   where t.vehicle_class = 'truck'
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
-- 9. VERIFICATION — inside the transaction, so a failure rolls the whole file
-- back rather than leaving half of it applied.
--
-- NOTICE-vs-RAISE, per 0200: THIS BLOCK EXITS 0 ON SUCCESS and raises ONLY on a
-- real failure. It does not raise to announce a pass — an unconditional raise
-- is what made 0200 fail `supabase db reset` against a healthy database, and
-- the exit code is the signal that a gate can actually read. NOTICES ARE
-- INVISIBLE through Supabase's SQL tooling and through MCP execute_sql, so a
-- silent, clean run IS the pass.
--
-- THE SECTION-6 TRIPLE IS EMITTED AS A NOTICE BELOW AND MAY NOT REACH YOU.
-- Post-apply check 5 runs the same query as a SELECT. Use that one.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_bad_cap   bigint;
  v_bad_shape bigint;
  v_types     bigint;
  v_seen      integer := 0;
  v_rec       record;
  v_views     bigint;
  v_invoker   bigint;
  v_anon      bigint;
begin
  -- 1. capacity_m3 agrees with its source on every row.
  select count(*) into v_bad_cap
    from public.trucks
   where capacity_m3 is distinct from
         (case when capacity_unit = 'm3' then capacity_value end);
  if v_bad_cap > 0 then
    raise exception
      'FAIL 1: % truck row(s) where capacity_m3 disagrees with capacity_value/capacity_unit. trucks_capacity_m3_consistent_check should have caught this.', v_bad_cap;
  end if;

  -- 2. No row disagrees with its own class shape.
  select count(*) into v_bad_shape
    from public.trucks
   where not (
        (vehicle_class = 'truck'
         and capacity_unit   = 'm3'
         and capacity_value  is not null
         and vehicle_type_id is null)
     or (vehicle_class = 'operation'
         and vehicle_type_id    is not null
         and assigned_driver_id is null)
   );
  if v_bad_shape > 0 then
    raise exception
      'FAIL 2: % truck row(s) violate trucks_vehicle_class_shape_check.', v_bad_shape;
  end if;

  -- 3. The seed landed, and nothing else did.
  select count(*) into v_types from public.vehicle_types;
  if v_types <> 5 then
    raise exception
      'FAIL 3: vehicle_types holds % row(s), expected the 5 seeded types.', v_types;
  end if;

  -- 4. The whole utilization family is security_invoker and closed to anon —
  -- the one this file replaced, and the three that read it.
  for v_rec in
    select c.relname,
           coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) as inv,
           has_table_privilege('anon', c.oid, 'select')                            as anon_ok
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and c.relname in ('v_truck_day_state',
                         'v_truck_utilization_monthly',
                         'v_fleet_utilization_monthly',
                         'v_truck_utilization_rolling30')
  loop
    if not v_rec.inv then
      raise exception 'FAIL 4: % is not security_invoker. The footer did not take.', v_rec.relname;
    end if;
    if v_rec.anon_ok then
      raise exception 'FAIL 5: anon can SELECT %. The revoke did not take.', v_rec.relname;
    end if;
    v_seen := v_seen + 1;
  end loop;

  if v_seen <> 4 then
    raise exception
      'FAIL 6: expected 4 utilization-family views, found %. One was renamed or dropped.', v_seen;
  end if;

  -- 5. The section-6 triple, for the architect to compare. NOTICE only — see
  -- the header warning, and post-apply check 5.
  select count(*),
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']),
         count(*) filter (where has_table_privilege('anon', c.oid, 'select'))
    into v_views, v_invoker, v_anon
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname = 'public';

  raise notice
    '0201 VIEW SURFACE — views: %, security_invoker: %, anon_readable: %. The first two must match and the third must be 0 (CLAUDE.md section 6).',
    v_views, v_invoker, v_anon;
end $verify$;

commit;


-- ===========================================================================
-- POST-APPLY — read-only. Run these; do not assume.
-- ===========================================================================
-- 1) The new columns exist, and capacity_m3 is still a plain stored column
--    (is_generated must read NEVER):
--
--      select column_name, data_type, is_generated, column_default
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'trucks'
--         and column_name in ('capacity_m3','capacity_value','capacity_unit',
--                             'vehicle_class','vehicle_type_id')
--       order by column_name;
--
-- 2) Nothing moved. The fleet's capacity total must be what it was before:
--
--      select count(*) as trucks, sum(capacity_m3) as total_m3,
--             count(*) filter (where capacity_m3 is null) as null_m3
--        from public.trucks;
--      -- prod on 2026-09-16, before: 16 trucks, 0 null.
--
-- 3) The constraints are VALIDATED, not merely present (convalidated = true):
--
--      select conname, convalidated, pg_get_constraintdef(oid)
--        from pg_constraint
--       where conrelid = 'public.trucks'::regclass
--         and conname in ('trucks_vehicle_class_check',
--                         'trucks_capacity_unit_check',
--                         'trucks_capacity_m3_consistent_check',
--                         'trucks_vehicle_class_shape_check')
--       order by conname;
--
-- 4) Utilization did not move. Run this BEFORE applying too, and compare —
--    with zero operation vehicles in the table the numbers must be identical:
--
--      select month, trucks_with_availability, worked_days, available_days,
--             utilization_pct
--        from public.v_fleet_utilization_monthly
--       order by month desc limit 6;
--
-- 5) The section-6 triple as a SELECT, because the NOTICE above may not reach
--    you. views == security_invoker, anon_readable == 0:
--
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--
-- 6) The write path is now strict, as intended. This MUST fail with 23514
--    (trucks_capacity_m3_consistent_check) — it is what the old app does:
--
--      begin;
--        update public.trucks set capacity_m3 = capacity_m3 + 1
--         where id = (select id from public.trucks limit 1);
--      rollback;
-- ===========================================================================
