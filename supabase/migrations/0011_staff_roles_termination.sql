-- 0011_staff_roles_termination.sql
-- Staff-tab additions (deliberate deviations from the demo):
--   1) CUSTOM ROLES via a first-class lookup table `staff_roles`, with
--      staff.role as a FK to staff_roles.key. The 5 built-ins are seeded as
--      is_default=true; "Add custom role" inserts a new staff_roles row
--      (key = slug, label = typed text), immediately selectable.
--   2) TERMINATION (soft delete) — `terminated_at` marks a staff member as left;
--      NULL = active. The active grid filters terminated_at IS NULL; the row is
--      preserved, never hard-deleted.
--
-- ORDERING IS LOAD-BEARING (will fail on existing data otherwise):
--   drop old CHECK → create table → seed defaults (keys == current staff.role
--   strings) → VERIFY every staff.role matches a seeded key → THEN add the FK.
--   The verify step raises (rolls back the whole tx) if any row wouldn't match,
--   so you see the offenders instead of a raw FK violation.
--
-- Run in the Supabase SQL editor (after 0010).

create extension if not exists pgcrypto;

begin;

-- 1) Drop the fixed 5-role CHECK on staff.role by DISCOVERY (name-agnostic — the
--    inline `check (role in (...))` in 0010 auto-named it). role stays NOT NULL.
do $$
declare r record;
begin
  for r in
    select con.conname as name
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'staff'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.staff drop constraint %I', r.name);
  end loop;
end $$;

-- 2) The roles lookup table. `key` is the stable machine value (FK target,
--    must be UNIQUE for the FK); `label` is the human text. Built-ins flagged.
create table if not exists public.staff_roles (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  label      text not null,
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_roles enable row level security;
drop policy if exists "authenticated_all_staff_roles" on public.staff_roles;
create policy "authenticated_all_staff_roles"
  on public.staff_roles for all to authenticated using (true) with check (true);

-- 3) Seed the 5 defaults. Keys EXACTLY match the strings currently in staff.role
--    (so existing rows already satisfy the FK). Idempotent on re-run.
insert into public.staff_roles (key, label, is_default) values
  ('fleet_manager',   'Fleet Manager',   true),
  ('ops_supervisor',  'Ops Supervisor',  true),
  ('mechanic',        'Mechanic',        true),
  ('inventory_clerk', 'Inventory Clerk', true),
  ('dispatcher',      'Dispatcher',      true)
on conflict (key) do nothing;

-- 4) VERIFY before the FK: every existing staff.role must resolve to a seeded
--    key. If not, STOP — raise with the offending values; the tx rolls back and
--    NOTHING is applied. (Add the missing keys, then re-run.)
do $$
declare bad text;
begin
  select string_agg(distinct s.role, ', ')
    into bad
  from public.staff s
  left join public.staff_roles r on r.key = s.role
  where r.key is null;

  if bad is not null then
    raise exception
      'staff.role values with no matching staff_roles.key: %. Seed these first; FK not added.', bad;
  end if;
end $$;

-- 5) THEN the FK. RESTRICT on delete (role in use can't be deleted); CASCADE on
--    update (key rename propagates to holders). Drop-if-exists makes it re-runnable.
alter table public.staff drop constraint if exists staff_role_fkey;
alter table public.staff
  add constraint staff_role_fkey
  foreign key (role) references public.staff_roles(key)
  on delete restrict on update cascade;

-- 6) TERMINATION (soft delete): NULL = active; a timestamp = left/terminated.
alter table public.staff add column if not exists terminated_at timestamptz;
create index if not exists staff_active_idx
  on public.staff (created_at desc) where terminated_at is null;

commit;
