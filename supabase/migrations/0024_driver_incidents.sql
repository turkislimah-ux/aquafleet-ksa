-- 0024_driver_incidents.sql
-- Driver incident log (work accidents, truck accidents, etc.), tied to a
-- driver. Drivers are SOFT-deleted (terminated_at marker, 0020) — the row
-- always exists, so a plain FK naturally survives termination; no special
-- handling needed. on delete cascade only matters for the theoretical
-- hard-delete case (keeps that path orphan-free); under the real soft-delete
-- model it never fires. Matches existing driver_id FK precedent (0012 leave).

create extension if not exists pgcrypto;

begin;

create table if not exists public.driver_incidents (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  incident_date date not null,
  type          text not null, -- free text, e.g. "Work accident", "Truck accident", "Other"
  description   text,
  created_at    timestamptz not null default now()
);

-- Always queried per-driver; unlike the tiny lookup tables this can grow.
create index if not exists driver_incidents_driver_idx
  on public.driver_incidents (driver_id);

alter table public.driver_incidents enable row level security;
drop policy if exists "authenticated_all_driver_incidents" on public.driver_incidents;
create policy "authenticated_all_driver_incidents"
  on public.driver_incidents for all to authenticated using (true) with check (true);

commit;
