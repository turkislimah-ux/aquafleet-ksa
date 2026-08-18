-- 0132_driver_health_insurance.sql
--
-- Item 8. Two column changes on drivers. No money touches this file: no RPC is
-- created or replaced, no amount is computed, and nothing here is read by
-- pay_commission or any payout path.
--
-- 1. ADD drivers.health_insurance boolean, DEFAULT NULL.
--
--    Deliberately NULLABLE with NO default and NO backfill. Turki's ruling:
--    null means "not set yet", which is a DIFFERENT fact from an explicit No.
--    Defaulting existing drivers to false would silently assert that ~every
--    driver in the fleet has no health insurance — a claim nobody made, and one
--    that reads as a compliance problem on screen. Three display states
--    downstream: true = Yes (green), false = No (red), null = unknown
--    (neutral — NOT red).
--
--    This is why there is no `not null` and no `default false` here, and why a
--    later migration must not "tidy" one in: the tri-state IS the feature.
--
-- 2. DROP drivers.rating PERMANENTLY.
--
--    Dead since 0023 replaced the original safety/rating/hours/incidents block.
--    It has never had a form input — the app only ever rendered it read-only —
--    so no user has been able to set it since that migration. Architect verified
--    against the live database: 0 views and 0 functions reference the column, so
--    the drop cannot cascade.
--
--    The remaining references are all app-side TypeScript and are cleaned in the
--    UI batch that follows this migration.

alter table public.drivers
  add column if not exists health_insurance boolean;

comment on column public.drivers.health_insurance is
  'Tri-state, intentionally nullable: true = enrolled, false = explicitly not enrolled, null = not recorded yet. Null is NOT the same as false and must never be backfilled to it.';

alter table public.drivers
  drop column if exists rating;
