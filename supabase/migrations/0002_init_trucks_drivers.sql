-- ============================================================================
-- Bousla — Phase 2 schema: drivers + trucks
-- Run this in the Supabase SQL editor (after 0001).
-- Order matters: drivers is created first because trucks references it.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- drivers
-- A driver. Test/seed data only for now (no real iqama / personal data).
-- A driver's "current truck" is NOT stored here — it is derived from
-- trucks.assigned_driver_id (one source of truth).
-- ----------------------------------------------------------------------------
create table if not exists public.drivers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  name_ar         text,
  iqama_number    text,
  license_expiry  date,
  status          text not null default 'active'
                    check (status in ('active', 'on_leave', 'inactive')),
  -- Left empty on purpose — no fake scores. Populated later from real data.
  safety_score    int,
  rating          numeric(3, 1),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- trucks
-- Riyadh-only operation. home_station is one of the 3 water stations
-- (placeholder labels for now). Driver assignment lives ONLY here.
-- ----------------------------------------------------------------------------
create table if not exists public.trucks (
  id                 uuid primary key default gen_random_uuid(),
  plate              text not null,
  model              text,
  year               int,
  capacity_m3        numeric(6, 2),
  status             text not null default 'idle'
                       check (status in ('active', 'idle', 'maintenance', 'out_of_service')),
  -- Left empty on purpose — no fake health values.
  health_score       int,
  home_station       text,
  odometer_km        int,
  engine_hours       int,
  vin                text,
  -- Assignment = single source of truth. If the driver is deleted, the truck
  -- simply becomes unassigned (set null) rather than blocking the delete.
  assigned_driver_id uuid references public.drivers(id) on delete set null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- A driver can be assigned to at most one truck at a time. Partial unique
-- index so multiple NULLs (unassigned trucks) are still allowed.
create unique index if not exists trucks_assigned_driver_unique
  on public.trucks (assigned_driver_id)
  where assigned_driver_id is not null;

-- Speeds up the driver-name join on the trucks list.
create index if not exists trucks_assigned_driver_idx
  on public.trucks (assigned_driver_id);

-- ============================================================================
-- Row Level Security — same policy as Phase 1: full read/write for any
-- logged-in (authenticated) user; the anon role gets nothing.
-- ============================================================================
alter table public.drivers enable row level security;
alter table public.trucks  enable row level security;

drop policy if exists "authenticated_all_drivers" on public.drivers;
create policy "authenticated_all_drivers"
  on public.drivers
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_trucks" on public.trucks;
create policy "authenticated_all_trucks"
  on public.trucks
  for all
  to authenticated
  using (true)
  with check (true);
