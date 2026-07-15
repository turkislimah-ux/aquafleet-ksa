-- 0033_trip_ref_per_project.sql
-- Finance polish Batch C1 — new trip-ref format: XX-YYY-NNNN
--   XX   = 2-letter project initials (stable, assigned once, immutable).
--   YYY  = last 3 digits of the YEAR THE TRIP HAPPENED (trip_date's year —
--          not now()/created_at — consistent with commission scaling and
--          billing periods, which all key on trip_date).
--   NNNN = trip counter, PER PROJECT, resets each year.
--
-- Existing trips are UNTOUCHED — ref is a stored column (0004), frozen at
-- insert time, never recomputed at read time. Changing generation for new
-- rows cannot alter old rows' values. No backfill of trips.ref. Old
-- ("WT-2026-0161") and new ("TR-026-0001") refs coexist forever in the same
-- column; lib/trip-ref.ts already treats ref as an opaque string (no
-- parsing), so zero app-code changes are required for this migration.
--
-- DEVIATION FROM PLAN, flagging explicitly: the plan said "drop the old
-- column DEFAULT + trips_ref_seq". We drop the DEFAULT (generation now
-- lives in a trigger, not a column default) but we do NOT drop
-- trips_ref_seq — trips.project_id is NULLABLE (a trip can hang off a bare
-- customer with no project, per 0003's trips_project_or_customer check, and
-- app/trips/actions.ts genuinely allows creating trips with a customer only,
-- no project). Those trips have no project to derive initials from, so they
-- keep falling back to the legacy WT-<year>-<seq> scheme, which still needs
-- trips_ref_seq. Dropping it would leave bare-customer trips with a NULL ref
-- forever. Kept as a fallback-only generator.
--
-- ALSO A DESIGN CHANGE FROM THE PLAN, in the app's favor: rather than only
-- wiring create_project_with_customer (0026) to claim initials, we put the
-- claim in a BEFORE INSERT trigger on projects itself. Reason found during
-- build: app/projects/actions.ts:createProject() is a second, orphaned
-- insert path (`.from("projects").insert(row)`, no RPC, unlinked from any
-- nav route today, but still a live server action reachable by URL) that
-- bypasses the RPC entirely. A trigger covers every insert path uniformly
-- (RPC, the orphaned route, any future path) instead of only the one RPC we
-- were told to patch — same "the app writes nothing, the DB generates it"
-- discipline 0004 already established for trips.ref.
--
-- Concurrency: project-initials claiming AND per-project-per-year trip
-- counting both use the same transactional-UPDATE discipline as
-- next_vat_ref_number() (0027) — plain UPDATEs, not sequences, so a rolled-
-- back transaction burns nothing. Initials claiming additionally takes a
-- session-scoped advisory lock (pg_advisory_xact_lock) to serialize the
-- multi-candidate scan itself: with only a UNIQUE constraint, two concurrent
-- inserts could both read "TH is free" before either commits and collide.
-- The advisory lock makes the whole claim-a-candidate scan atomic across
-- concurrent project creations. Table volume here is tiny (dozens of
-- projects, not thousands of trips), so a single serializing lock is simpler
-- and safer than a retry-on-conflict loop, with no meaningful throughput cost.

begin;

-- ============================================================================
-- 1. projects.initials — stable per-project prefix, claimed once, immutable.
-- ============================================================================

alter table public.projects
  add column if not exists initials text;

-- claim_project_initials() — 3-tier deterministic candidate scan, guarded by
-- an advisory lock so concurrent claims can't race past each other.
--   Tier 1: first 2 letters of the name (letters only, uppercased).
--     "The Royal Court" -> "TH"
--   Tier 2 (multi-word only): first letter of word 1 + first letter of word 2.
--     "The Royal Court" -> "TR" (used if "TH" is already taken)
--   Tier 3 (guaranteed to terminate): first letter of word 1 + a scanned
--     suffix, 1-9 then A-Z (T1, T2, ... T9, TA, TB, ...). Bounded by 35
--     candidates — far above any realistic project count for this business.
create or replace function public.claim_project_initials(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_letters_only text;
  v_words        text[];
  v_word1        text;
  v_word2        text;
  v_candidate    text;
  i              int;
begin
  -- Serialize the whole claim (scan + pick) across concurrent callers.
  -- Released automatically at the end of this transaction.
  perform pg_advisory_xact_lock(hashtext('claim_project_initials'));

  v_letters_only := upper(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z ]', '', 'g'));
  v_words := array_remove(regexp_split_to_array(trim(v_letters_only), '\s+'), '');

  -- Tier 1.
  v_candidate := left(regexp_replace(v_letters_only, '\s', '', 'g'), 2);
  if length(coalesce(v_candidate, '')) = 2
     and not exists (select 1 from public.projects where initials = v_candidate) then
    return v_candidate;
  end if;

  -- Tier 2 (needs at least two words).
  if array_length(v_words, 1) >= 2 then
    v_word1 := v_words[1];
    v_word2 := v_words[2];
    v_candidate := left(v_word1, 1) || left(v_word2, 1);
    if length(coalesce(v_candidate, '')) = 2
       and not exists (select 1 from public.projects where initials = v_candidate) then
      return v_candidate;
    end if;
  end if;

  -- Tier 3 — guaranteed backstop.
  v_word1 := coalesce(nullif(v_words[1], ''), 'X');
  for i in 1..9 loop
    v_candidate := left(v_word1, 1) || i::text;
    if not exists (select 1 from public.projects where initials = v_candidate) then
      return v_candidate;
    end if;
  end loop;
  for i in 0..25 loop
    v_candidate := left(v_word1, 1) || chr(65 + i);
    if not exists (select 1 from public.projects where initials = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'Could not assign unique project initials for "%"', p_name;
end;
$$;

grant execute on function public.claim_project_initials(text) to authenticated;

-- One-time backfill for EXISTING projects, in deterministic order
-- (created_at asc, id asc as a tiebreak) so collisions resolve the same way
-- every time this migration would be replayed against the same data.
do $$
declare
  r record;
begin
  for r in
    select id, name from public.projects
    where initials is null
    order by created_at asc, id asc
  loop
    update public.projects
       set initials = public.claim_project_initials(r.name)
     where id = r.id;
  end loop;
end;
$$;

-- Now that every existing row has a value, lock the column down.
alter table public.projects
  alter column initials set not null;

alter table public.projects
  drop constraint if exists projects_initials_unique;
alter table public.projects
  add constraint projects_initials_unique unique (initials);

-- BEFORE INSERT trigger — claims initials for ANY insert path (the RPC,
-- the orphaned app/projects/actions.ts route, or anything future), the same
-- "app writes nothing, DB generates it" pattern trips.ref already uses.
create or replace function public.projects_set_initials()
returns trigger
language plpgsql
as $$
begin
  if new.initials is null then
    new.initials := public.claim_project_initials(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_set_initials_trigger on public.projects;
create trigger projects_set_initials_trigger
  before insert on public.projects
  for each row execute function public.projects_set_initials();

-- ============================================================================
-- 2. trip_ref_counter — per-project, per-year, gap-free counter for NNNN.
--    Same transactional-UPDATE shape as invoice_vat_ref_counter (0027):
--    row-per-(project, year) created lazily, claimed via UPDATE ... RETURNING
--    next_number - 1. A rolled-back transaction burns nothing (not a
--    sequence — see 0027's header for why that distinction matters).
-- ============================================================================

create table if not exists public.trip_ref_counter (
  project_id  uuid not null references public.projects(id) on delete cascade,
  year        integer not null,
  next_number integer not null default 1,
  primary key (project_id, year)
);

alter table public.trip_ref_counter enable row level security;
drop policy if exists "authenticated_all_trip_ref_counter" on public.trip_ref_counter;
create policy "authenticated_all_trip_ref_counter"
  on public.trip_ref_counter for all to authenticated using (true) with check (true);

create or replace function public.next_trip_ref_number(p_project_id uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.trip_ref_counter (project_id, year, next_number)
  values (p_project_id, p_year, 1)
  on conflict (project_id, year) do nothing;

  update public.trip_ref_counter
     set next_number = next_number + 1
   where project_id = p_project_id
     and year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_trip_ref_number(uuid, integer) to authenticated;

-- ============================================================================
-- 3. trips.ref generation — BEFORE INSERT trigger replaces the column
--    DEFAULT (0004). Year anchor is trip_date (LOCKED — not now()).
--    Project-linked trips get the new XX-YYY-NNNN format. Bare-customer
--    trips (project_id is null — a real, currently-used path, see header)
--    fall back to the legacy WT-<year>-<seq> scheme via trips_ref_seq.
-- ============================================================================

alter table public.trips
  alter column ref drop default;

create or replace function public.trips_set_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initials text;
  v_year     integer;
  v_seq      integer;
begin
  if new.ref is not null then
    return new;
  end if;

  v_year := extract(year from coalesce(new.trip_date, current_date))::integer;

  if new.project_id is not null then
    select initials into v_initials from public.projects where id = new.project_id;
  end if;

  if v_initials is not null then
    v_seq := public.next_trip_ref_number(new.project_id, v_year);
    new.ref := v_initials || '-' || lpad((v_year % 1000)::text, 3, '0')
                           || '-' || lpad(v_seq::text, 4, '0');
  else
    -- Bare-customer trip (no project), or a project row somehow missing
    -- initials — legacy fallback, unchanged shape from 0004.
    new.ref := 'WT-' || v_year::text || '-'
                      || lpad(nextval('public.trips_ref_seq')::text, 4, '0');
  end if;

  return new;
end;
$$;

drop trigger if exists trips_set_ref_trigger on public.trips;
create trigger trips_set_ref_trigger
  before insert on public.trips
  for each row execute function public.trips_set_ref();

commit;
