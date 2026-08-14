-- 0110_station_type_pricing_and_trip_fill_snapshot.sql
-- FOUNDATION ONLY — schema for water-station per-type pricing and the frozen
-- per-trip filling-cost snapshot.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES *NOT* DO, DELIBERATELY
-- ===========================================================================
-- It does NOT touch the P&L. No view is created, replaced or dropped here.
-- v_pnl_monthly, v_daily_operations, v_cost_composition_monthly and every
-- Reports statement read exactly what they read today, and every figure on
-- every screen is unchanged the moment this is applied.
--
-- That is on purpose. Filling cost cannot enter the P&L until real prices
-- exist and the 716 historical trips have been costed from them, and neither
-- can happen until the station UI ships. Wiring the views first would either
-- publish zeros as though they were measurements, or move operating cost the
-- instant the first price is typed. The phasing is in the plan; this file is
-- step one of it.
--
-- It also does NOT drop water_stations.fill_cost. See section 3.
--
-- ===========================================================================
-- 1) STATION PRICING BECOMES PER WATER TYPE
-- ===========================================================================
-- Today a station has ONE flat `fill_cost`, which cannot express "this station
-- sells potable at 70 and does not offer non-potable at all". The replacement
-- is two nullable price columns, and the NULLABILITY IS THE FEATURE:
--
--     price SET (including 0)  ->  that type IS offered at that price
--     price NULL               ->  that type is NOT offered here
--
-- 0 is a real, meaningful price — company-owned stations fill free — so it can
-- never be conflated with "no price". Everything downstream has to preserve
-- that distinction, which is why the columns are nullable rather than
-- `default 0`.
--
-- A CHECK enforces that a station offers at least one type. It is added NOT
-- VALID on purpose: all four existing stations currently have both new columns
-- NULL, so a validating constraint would fail on apply. The alternative —
-- seeding both types from the old flat fill_cost — would make the database
-- ASSERT that every station offers both types, which is exactly the thing
-- nobody knows yet. Turki enters the real prices in the UI, and a later
-- migration runs `validate constraint` once every row genuinely satisfies it.
--
-- Live shape this has to accommodate, checked before drafting:
--     furaian_station        potable 140 trips, non_potable   1
--     manfuhah_station       potable 106 trips, non_potable 210
--     umm_al_hamam_station   potable  13 trips, non_potable 246
--     olaya_filling_point    no trips at all (flat fill_cost 70.00)
-- Every station that has ever been used served BOTH types, so all three need
-- both prices or the backfill will leave gaps — flagged in the plan, not
-- papered over here.
--
-- ===========================================================================
-- 2) THE TRIP SNAPSHOT, AND WHY NULL IS NOT ZERO
-- ===========================================================================
-- trips.filling_cost_sar is the frozen cost of the fill for that trip, so a
-- later price change cannot silently reprice history — the same reasoning that
-- freezes a confirmed invoice's totals.
--
-- IT IS NULLABLE, AND NULL MEANS "NOT COSTED", NOT "FREE". All 716 existing
-- trips will read NULL until the backfill runs, and a trip whose station never
-- got a price for its type will STAY NULL rather than being coerced to 0.
-- Defaulting to 0 would silently book an un-costed fill as a free one and
-- understate cost with no way to find the affected rows. Whatever consumes
-- this column must count NULLs and say so, exactly as the delivered-revenue
-- work counts its unpriceable trip.
--
-- NOTE ON "MIRRORS commission_sar" — it mirrors the FREEZING, not the timing.
-- commission_sar is priced at DELIVERY (priceDelivery) and is deliberately
-- re-derived across a driver+project+day ramp. filling_cost_sar is captured
-- ONCE, at creation, and never recomputed by a ramp. Saying they work the same
-- way would mislead whoever reads this next.
--
-- ===========================================================================
-- 3) water_stations.fill_cost IS KEPT, NOT DROPPED
-- ===========================================================================
-- It holds the only price data that exists today (0.00 / 0.00 / 70.00 / 0.00)
-- and it is still read by the stations UI. Dropping it in the same migration
-- that adds its replacement would delete the reference Turki prices against,
-- and would break the modal before the new one ships. It is left in place,
-- unread by anything new, and retired in a later migration once the per-type
-- prices are entered and the backfill is verified. Marked deprecated via a
-- COMMENT so the intent is discoverable from the schema itself.
--
-- ===========================================================================
-- ADDITIVE AND REVERSIBLE
-- ===========================================================================
-- Three nullable columns, one NOT VALID check, two comments. No data is
-- written, no column dropped, no view touched, no RPC altered. The money core
-- (lib/prepaid.ts, lib/vat.ts, FIFO ledgers, every invoice RPC) is not read or
-- written by this file.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Per-water-type station pricing.
-- ---------------------------------------------------------------------
alter table public.water_stations
  add column if not exists fill_cost_potable_sar     numeric(12, 2),
  add column if not exists fill_cost_non_potable_sar numeric(12, 2);

-- A price may be 0 (company-owned station, fills free) but never negative.
alter table public.water_stations
  drop constraint if exists water_stations_fill_cost_potable_nonneg;
alter table public.water_stations
  add  constraint water_stations_fill_cost_potable_nonneg
  check (fill_cost_potable_sar is null or fill_cost_potable_sar >= 0);

alter table public.water_stations
  drop constraint if exists water_stations_fill_cost_non_potable_nonneg;
alter table public.water_stations
  add  constraint water_stations_fill_cost_non_potable_nonneg
  check (fill_cost_non_potable_sar is null or fill_cost_non_potable_sar >= 0);

-- At least one type must be offered. NOT VALID because today every row has
-- both columns NULL; a later migration validates it once the UI has been used.
-- Seeding from the old flat fill_cost to make it validate now would assert
-- that every station offers both types, which is not known.
alter table public.water_stations
  drop constraint if exists water_stations_offers_at_least_one_type;
alter table public.water_stations
  add  constraint water_stations_offers_at_least_one_type
  check (fill_cost_potable_sar is not null or fill_cost_non_potable_sar is not null)
  not valid;

comment on column public.water_stations.fill_cost_potable_sar is
  'What this station charges US to fill POTABLE water, per trip. NULL means '
  'this station does not offer potable at all; 0 is a real price (company-'
  'owned stations fill free) and must never be conflated with NULL.';

comment on column public.water_stations.fill_cost_non_potable_sar is
  'What this station charges US to fill NON-POTABLE water, per trip. NULL '
  'means not offered; 0 is a real price.';

comment on column public.water_stations.fill_cost is
  'DEPRECATED (0110) — the old flat per-fill cost, superseded by '
  'fill_cost_potable_sar / fill_cost_non_potable_sar. Kept because it holds '
  'the only price data that exists today and the stations UI still reads it. '
  'Retired in a later migration once per-type prices are entered and the trip '
  'backfill is verified. Do not add new readers.';

-- ---------------------------------------------------------------------
-- 2) The frozen per-trip snapshot.
-- ---------------------------------------------------------------------
alter table public.trips
  add column if not exists filling_cost_sar numeric(12, 2);

alter table public.trips
  drop constraint if exists trips_filling_cost_nonneg;
alter table public.trips
  add  constraint trips_filling_cost_nonneg
  check (filling_cost_sar is null or filling_cost_sar >= 0);

comment on column public.trips.filling_cost_sar is
  'FROZEN snapshot of what this trip''s fill cost us, taken from the station''s '
  'price for this trip''s water_type. Frozen so a later price change cannot '
  'reprice history. NULL means NOT COSTED (pre-backfill, or the station has no '
  'price for that type) and is NEVER the same as 0.00, which is a real free '
  'fill. Any consumer must count and disclose the NULLs. Unlike '
  'commission_sar, which is priced at delivery and re-derived across a day''s '
  'ramp, this is captured once and never recomputed.';

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) COLUMNS EXIST, NULLABLE, WITH NO DEFAULT (null must stay distinguishable
--    from 0):
--      select table_name, column_name, data_type, is_nullable, column_default
--        from information_schema.columns
--       where table_schema='public'
--         and ((table_name='water_stations' and column_name like 'fill_cost%')
--           or (table_name='trips' and column_name='filling_cost_sar'))
--       order by table_name, column_name;
--      -- expect is_nullable=YES and column_default=NULL on all three new ones.
--
-- B) CONSTRAINTS PRESENT, AND THE "at least one type" ONE IS NOT VALIDATED YET:
--      select conname, convalidated, pg_get_constraintdef(oid)
--        from pg_constraint
--       where conrelid in ('public.water_stations'::regclass, 'public.trips'::regclass)
--         and conname in ('water_stations_offers_at_least_one_type',
--                         'water_stations_fill_cost_potable_nonneg',
--                         'water_stations_fill_cost_non_potable_nonneg',
--                         'trips_filling_cost_nonneg');
--      -- expect convalidated = false for offers_at_least_one_type, true for
--      -- the three non-negative checks.
--
-- C) NOTHING WAS WRITTEN. Every new column must be entirely NULL:
--      select count(*) filter (where fill_cost_potable_sar is not null)     as potable_set,
--             count(*) filter (where fill_cost_non_potable_sar is not null) as non_potable_set,
--             count(*)                                                      as stations
--        from public.water_stations;
--      -- expect 0, 0, 4.
--      select count(*) filter (where filling_cost_sar is not null) as costed,
--             count(*)                                             as trips
--        from public.trips;
--      -- expect 0, 716.
--
-- D) THE OLD COLUMN IS UNTOUCHED — it is still the only price data:
--      select key, fill_cost from public.water_stations order by key;
--      -- expect furaian 0.00, manfuhah 0.00, olaya 70.00, umm_al_hamam 0.00.
--
-- E) THE P&L HAS NOT MOVED. This migration creates no view, so these must be
--    byte-identical to a capture taken before applying:
--      select month, revenue_sar, parts_cost_sar, os_cost_sar, payroll_sar,
--             commissions_sar, operating_cost_sar, operating_profit_sar,
--             expenses_sar, net_profit_sar, operating_margin_pct
--        from public.v_pnl_monthly order by month;
--      select month, sum(direct_cost_sar) from public.v_daily_operations
--       group by month order by month;
--      select * from public.v_cost_composition_monthly order by month;
--
-- F) THE CHECK ACTUALLY BITES once a row is touched. On a scratch row only —
--    do NOT run against a real station:
--      -- insert into public.water_stations (key, name) values ('_tmp','tmp');
--      -- expect success (NOT VALID means existing/!touched rows are exempt),
--      -- then after validate constraint it would fail. Left commented; the
--      -- real proof is the validate step in the later migration.
-- ===========================================================================
