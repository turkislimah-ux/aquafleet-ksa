-- 0020_driver_truck_termination.sql
-- Soft-delete termination for drivers and trucks, mirroring staff.terminated_at
-- (0011). Marker = terminated_at timestamptz (NULL = active). Restorable later
-- from Archive — this migration only ADDS columns, no data destruction, no
-- backfill. Existing rows stay active (terminated_at NULL).
--
-- Trucks carry extra required-at-the-app-layer context (reason/price/released
-- date) — kept nullable at the DB level on purpose (see note below) so this
-- migration never violates existing active rows.
--
-- NOT touched here: drivers.active (dropped separately in Commit 2, the
-- deactivated-state removal — out of scope for this migration).
--
-- No RPC: termination is a plain single-table .update() (mirrors
-- terminateStaff, app/drivers/actions.ts), same for restoration (null the
-- columns back out). No cross-table atomicity need like archive_project (0019)
-- had for project+customer.

begin;

-- 1) Drivers — termination marker + user-entered termination date. -----------
alter table public.drivers add column if not exists terminated_at timestamptz;
alter table public.drivers add column if not exists termination_date date;

-- 2) Trucks — termination marker + reason/price/released-date. All nullable —
--    the APP enforces "required when terminating", not a DB constraint, so
--    every existing active truck (which has none of these) stays valid.
alter table public.trucks add column if not exists terminated_at timestamptz;
alter table public.trucks add column if not exists termination_reason text;
alter table public.trucks drop constraint if exists trucks_termination_reason_check;
alter table public.trucks
  add constraint trucks_termination_reason_check
  check (termination_reason is null or termination_reason in ('sold', 'total_loss'));
alter table public.trucks add column if not exists termination_price numeric(12,2);
alter table public.trucks add column if not exists released_date date;

-- 3) Partial active indexes (style mirrors staff_active_idx / projects_active_idx).
create index if not exists drivers_active_idx
  on public.drivers (created_at desc) where terminated_at is null;
create index if not exists trucks_active_idx
  on public.trucks (created_at desc) where terminated_at is null;

commit;
