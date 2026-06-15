-- ============================================================================
-- Bousla — Phase 3 schema: trips + Kanban support
-- Run this in the Supabase SQL editor (after 0001 and 0002).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Alter existing tables (all new columns nullable so existing rows survive).
-- water_type lives on projects (per business rule); customers have none.
-- default_station lets new trips auto-fill the loading station.
-- ----------------------------------------------------------------------------
alter table public.projects
  add column if not exists water_type text
    check (water_type in ('potable', 'non_potable'));
alter table public.projects
  add column if not exists default_station text;

alter table public.customers
  add column if not exists default_station text;

-- ----------------------------------------------------------------------------
-- trips
-- A single water delivery run. Must reference EITHER a project OR a bare
-- customer (at least one). Stage advances scheduled -> loading -> in_transit
-- -> delivered; each *_at is stamped when the trip ENTERS that stage. Stage
-- changes are funneled through one action so GPS automation can drive it later.
-- ----------------------------------------------------------------------------
create table if not exists public.trips (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects(id) on delete restrict,
  customer_id    uuid references public.customers(id) on delete restrict,
  water_station  text not null,
  truck_id       uuid references public.trucks(id) on delete set null,
  driver_id      uuid references public.drivers(id) on delete set null,
  water_type     text not null check (water_type in ('potable', 'non_potable')),
  rate_sar       numeric(12, 2),
  stage          text not null default 'scheduled'
                   check (stage in ('scheduled', 'loading', 'in_transit', 'delivered')),
  trip_date      date not null default current_date,
  scheduled_at   timestamptz default now(),
  loading_at     timestamptz,
  in_transit_at  timestamptz,
  delivered_at   timestamptz,
  created_at     timestamptz not null default now(),
  -- A trip must hang off a project or a customer (or both).
  constraint trips_project_or_customer
    check (project_id is not null or customer_id is not null)
);

-- The board queries by day + stage and joins to project/customer.
create index if not exists trips_project_idx   on public.trips (project_id);
create index if not exists trips_customer_idx  on public.trips (customer_id);
create index if not exists trips_trip_date_idx on public.trips (trip_date);
create index if not exists trips_stage_idx      on public.trips (stage);

-- ============================================================================
-- Row Level Security — same policy as Phases 1-2: full read/write for any
-- logged-in (authenticated) user; the anon role gets nothing.
-- ============================================================================
alter table public.trips enable row level security;

drop policy if exists "authenticated_all_trips" on public.trips;
create policy "authenticated_all_trips"
  on public.trips
  for all
  to authenticated
  using (true)
  with check (true);
