-- 0012_leave.sql
-- Leave & absence — a NARROW manager-records-leave model (no request/approve
-- workflow, no balances/accruals/limits). "On leave today" is COMPUTED from
-- leave_periods (start_date <= today <= end_date), never from drivers.status.
--
-- leave_types : extensible lookup (same pattern as staff_roles) — 4 seeded
--   defaults; managers can add custom types later.
-- leave_periods: one row = one person's leave window. Exactly one of
--   (driver_id, staff_id) is set. Overlaps allowed by design (no exclusion).
--
-- Run in the Supabase SQL editor (after 0011).

create extension if not exists pgcrypto;

begin;

-- 1) Leave type lookup. key = stable FK target (unique); label = human text.
create table if not exists public.leave_types (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  label      text not null,
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.leave_types enable row level security;
drop policy if exists "authenticated_all_leave_types" on public.leave_types;
create policy "authenticated_all_leave_types"
  on public.leave_types for all to authenticated using (true) with check (true);

insert into public.leave_types (key, label, is_default) values
  ('paid',     'Paid leave',   true),
  ('sick',     'Sick leave',   true),
  ('unpaid',   'Unpaid leave', true),
  ('off_duty', 'Off duty',     true)
on conflict (key) do nothing;

-- 2) Leave periods. Exactly one person ref; leave_type FK to leave_types(key).
--    No overlap constraint — overlapping periods are allowed.
create table if not exists public.leave_periods (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid references public.drivers(id) on delete cascade,
  staff_id   uuid references public.staff(id)   on delete cascade,
  leave_type text not null references public.leave_types(key) on delete restrict on update cascade,
  start_date date not null,
  end_date   date not null,
  note       text,
  created_at timestamptz not null default now(),
  constraint leave_periods_one_person check (num_nonnulls(driver_id, staff_id) = 1),
  constraint leave_periods_date_order check (end_date >= start_date)
);

create index if not exists leave_periods_driver_idx on public.leave_periods (driver_id, start_date, end_date);
create index if not exists leave_periods_staff_idx  on public.leave_periods (staff_id,  start_date, end_date);

alter table public.leave_periods enable row level security;
drop policy if exists "authenticated_all_leave_periods" on public.leave_periods;
create policy "authenticated_all_leave_periods"
  on public.leave_periods for all to authenticated using (true) with check (true);

commit;
