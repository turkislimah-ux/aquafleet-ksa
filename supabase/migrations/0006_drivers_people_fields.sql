-- ============================================================================
-- Bousla — Phase 6 schema (1/3): Drivers tab extra columns
-- Run this in the Supabase SQL editor (after 0005).
-- Adds the driver-level fields the Drivers tab + Driver Detail modal render.
-- All nullable, no default: a driver with no value renders "—", never a
-- fabricated number. (0007 = commission tables, 0008 = staff — run after.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- drivers: new nullable columns
--   phone           — Driver Detail "Contact & ID".
--   hire_date       — Driver Detail "Contact & ID".
--   home_station    — Drivers table "Station" column. Riyadh-only: one of the 3
--                     stations (STATION_OPTIONS). Stored as text (no check) to
--                     match trucks.home_station; the form constrains the choices.
--   hours_this_week — Driver Detail "Employment". No real source yet → honest-
--                     empty "—" until populated.
--   incidents_12mo  — Driver Detail "Employment" + Drivers KPI. No real source
--                     yet → honest-empty; the KPI sums only non-null rows.
-- ----------------------------------------------------------------------------
alter table public.drivers
  add column if not exists phone           text,
  add column if not exists hire_date       date,
  add column if not exists home_station    text,
  add column if not exists hours_this_week numeric(5, 1),
  add column if not exists incidents_12mo  int;
