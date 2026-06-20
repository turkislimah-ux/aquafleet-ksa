-- ============================================================================
-- Bousla — Phase 5 schema: Fleet list + Fleet Detail real fields
-- Run this in the Supabase SQL editor (after 0004).
-- Adds three truck-level columns the Fleet page renders (honest-empty when
-- null — no fake values seeded) and enforces unique plates so the Add Truck
-- modal can reject duplicates at the database, not just in the UI.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- trucks: new nullable columns
--   last_service_date         — Fleet table "Last Service" + Detail stat.
--   utilization_pct           — Fleet Detail "Utilization" stat (0–100).
--   fuel_efficiency_km_per_l  — Fleet Detail "Fuel Eff." stat (km/L).
-- All nullable, no default: a truck with no value renders "—", never a
-- fabricated number.
-- ----------------------------------------------------------------------------
alter table public.trucks
  add column if not exists last_service_date        date,
  add column if not exists utilization_pct          numeric(5, 2),
  add column if not exists fuel_efficiency_km_per_l  numeric(5, 2);

-- ----------------------------------------------------------------------------
-- Unique plate (case-insensitive). Backs the Add Truck dup-plate rejection.
-- lower() so "5041 ABJ" and "5041 abj" collide. If this index fails to
-- create, you already have duplicate plates — dedupe them first, then re-run.
-- ----------------------------------------------------------------------------
create unique index if not exists trucks_plate_lower_unique
  on public.trucks (lower(plate));
