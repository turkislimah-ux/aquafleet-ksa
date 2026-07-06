-- 0022_operation_stations.sql
-- Promotes "station of operation" (truck/driver/staff BASE — where they start
-- from) from a hardcoded array into a managed table with FK references.
-- DELIBERATELY SEPARATE from water_stations (0014) — do NOT unify.
-- Old free-text columns are nulled then dropped (text->uuid has no meaning-
-- preserving cast); fresh nullable uuid FK columns added under the same names.

create extension if not exists pgcrypto;

begin;

create table if not exists public.operation_stations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  latitude   numeric,
  longitude  numeric,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.operation_stations enable row level security;
drop policy if exists "authenticated_all_operation_stations" on public.operation_stations;
create policy "authenticated_all_operation_stations"
  on public.operation_stations for all to authenticated using (true) with check (true);

update public.drivers set home_station = null where home_station is not null;
update public.trucks  set home_station = null where home_station is not null;
update public.staff   set station      = null where station      is not null;

alter table public.drivers drop column if exists home_station;
alter table public.drivers add column home_station uuid
  references public.operation_stations(id) on delete set null;

alter table public.trucks drop column if exists home_station;
alter table public.trucks add column home_station uuid
  references public.operation_stations(id) on delete set null;

alter table public.staff drop column if exists station;
alter table public.staff add column station uuid
  references public.operation_stations(id) on delete set null;

commit;
