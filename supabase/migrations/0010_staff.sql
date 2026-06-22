-- 0010_staff.sql
-- Management & Support Staff — the non-driver people (office + workshop).
-- WHY: the Drivers & People page's third tab (Management & Staff) needs its own
-- table. Drivers live in public.drivers; this is everyone else (managers, ops
-- supervisors, mechanics, inventory clerks, dispatchers).
--
-- Reality match: the demo's "depot" is our "station" (3 Riyadh stations), so the
-- location column is `station` (free text, like drivers.home_station).
-- All money: none here. authenticated-all RLS, same as every other table.
--
-- Run in the Supabase SQL editor (after 0009).

create extension if not exists pgcrypto;

create table if not exists public.staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_ar    text,
  role       text not null
               check (role in ('fleet_manager','ops_supervisor','mechanic','inventory_clerk','dispatcher')),
  station    text,
  email      text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;
drop policy if exists "authenticated_all_staff" on public.staff;
create policy "authenticated_all_staff"
  on public.staff for all to authenticated using (true) with check (true);
