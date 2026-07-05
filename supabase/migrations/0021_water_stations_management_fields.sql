-- 0021_water_stations_management_fields.sql
-- Additive fields on water_stations for the upcoming management UI:
-- coordinates (future route optimization) + fill_cost (cost-side only, for
-- future profitability reporting). Does NOT touch key, does NOT affect rates,
-- commission, or invoices. All nullable, no backfill, no default.

begin;

alter table public.water_stations
  add column if not exists latitude  numeric,
  add column if not exists longitude numeric,
  add column if not exists fill_cost numeric(12,2);

commit;
