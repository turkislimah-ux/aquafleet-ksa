-- 0014_water_stations.sql
-- Water filling stations as a first-class lookup, plus FK wiring.
-- WHY: trips.water_station AND the new projects.default_water_station move from
-- free text to a controlled lookup (water_stations.key). This is the Trips/Loading
-- concept — WHERE a truck fills — and is DELIBERATELY SEPARATE from the Fleet
-- "depot/base" concept (STATION_OPTIONS: South 1/2, North). Do NOT unify them.
--
-- Two guards make this safe and loud. Whole thing is begin/commit-wrapped, so if
-- EITHER guard fires, NOTHING is applied:
--   Guard A (trips):    abort if any trips.water_station has no matching key.
--   Guard B (projects): abort if projects is non-empty — a NOT NULL FK needs a
--                       value per existing row, and there is no single safe default.

create extension if not exists pgcrypto;

begin;

-- 1) water_stations lookup (mirrors staff_roles / leave_types; inline slug CHECK).
create table if not exists public.water_stations (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null
               constraint water_stations_key_slug check (key ~ '^[a-z][a-z0-9_]*$'),
  name       text not null,
  city       text,
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.water_stations enable row level security;
drop policy if exists "authenticated_all_water_stations" on public.water_stations;
create policy "authenticated_all_water_stations"
  on public.water_stations for all to authenticated using (true) with check (true);

-- 2) Seed (Option B) — Riyadh-only, all default-eligible.
insert into public.water_stations (key, name, city, is_default) values
  ('manfuhah_station',     'Manfuhah Station',     'Riyadh', true),
  ('umm_al_hamam_station', 'Umm Al Hamam Station', 'Riyadh', true),
  ('olaya_filling_point',  'Olaya Filling Point',  'Riyadh', true)
on conflict (key) do nothing;

-- 3) Guard A — trips: every existing trips.water_station must resolve to a key.
do $$
declare v_bad text;
begin
  select string_agg(distinct water_station, ', ') into v_bad
  from public.trips
  where water_station is not null
    and water_station not in (select key from public.water_stations);
  if v_bad is not null then
    raise exception
      'Aborting: trips.water_station holds value(s) with no matching water_stations.key: [%]. No changes applied.', v_bad;
  end if;
end $$;

-- 4) Guard B — projects: refuse a NOT NULL FK add on a non-empty table.
do $$
declare v_count bigint;
begin
  select count(*) into v_count from public.projects;
  if v_count > 0 then
    raise exception
      'Aborting: projects has % row(s). default_water_station is NOT NULL FK and there is no single safe default (3 stations seeded, all is_default). No changes applied. Resolve first: clear demo projects, OR approve ONE default station for an explicit backfill.', v_count;
  end if;
end $$;

-- 5) Add projects.default_water_station (only reached when projects is empty).
alter table public.projects
  add column default_water_station text not null
    references public.water_stations(key)
    on delete restrict on update cascade;

-- 6) Convert trips.water_station to a FK (only reached when Guard A passed).
alter table public.trips
  add constraint trips_water_station_fkey
  foreign key (water_station) references public.water_stations(key)
  on delete restrict on update cascade;

commit;
