-- 0077_drop_driver_before_maintenance_fk.sql
-- 0076 added trucks.driver_before_maintenance as a SECOND FK to
-- drivers(id) (alongside the existing assigned_driver_id FK) — PostgREST
-- can't disambiguate which FK to embed on a plain trucks->drivers request,
-- which broke Fleet. Column stays (still written/read by 0076's driver
-- free/reassign logic); only the FK constraint is dropped.

alter table public.trucks
  drop constraint if exists trucks_driver_before_maintenance_fkey;
