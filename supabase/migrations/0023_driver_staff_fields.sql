-- 0023_driver_staff_fields.sql
-- New driver/staff form fields: duty_hours (replaces the old hours/safety/
-- rating/incidents display — those columns are NOT dropped here, left dead
-- per the deferred-cleanup convention; the code prompt removes their form
-- controls), iqama_expiry (both), and staff.hire_date (staff had none;
-- drivers already has hire_date from 0006).
--
-- duty_hours defaults to 10 at the DB level so existing rows backfill
-- automatically instead of reading as NULL/"—". iqama_expiry / hire_date are
-- optional per person, so nullable, matching the `date` type convention used
-- throughout this schema (license_expiry, hire_date, last_service_date,
-- termination_date, released_date, start_date/end_date all use `date`, never
-- timestamptz).

begin;

alter table public.drivers
  add column if not exists duty_hours integer not null default 10,
  add column if not exists iqama_expiry date;

alter table public.staff
  add column if not exists duty_hours integer not null default 10,
  add column if not exists iqama_expiry date,
  add column if not exists hire_date date;

commit;
