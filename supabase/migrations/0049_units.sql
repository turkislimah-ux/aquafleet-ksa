-- 0049_units.sql
-- Inventory — units of measure as a first-class lookup table (architect's
-- recommendation: a unit has a CODE and a MEANING, which parts.unit's plain
-- free text can't hold on its own). Mirrors the same shape/role suppliers
-- (0045) plays for parts.supplier: a structured source table that pickers
-- read from and "add unit" inline-create modals write to, while the
-- consuming column stays a soft, denormalized reference — NOT an FK.
--
-- SCOPE: ONE table + seed data. No FK from parts.unit — parts.unit (0043)
-- is UNTOUCHED by this migration and stays free text, storing the unit's
-- CODE (e.g. 'ea', 'L') as a snapshot, same denormalized convention as
-- parts.supplier. This keeps existing parts rows valid with zero backfill,
-- and matches this app's established precedent: structured lookup table +
-- soft-reference text column are two deliberately different mechanisms
-- (see 0045's own header for the identical reasoning on suppliers).
--
-- NOT in this migration (follow-up app-code pass, once this is reviewed and
-- run): the unit picker UI (reads from this table instead of the hardcoded
-- CREATE_UNITS list) and an inline "add unit" affordance (writes here, same
-- pattern as "+ Supplier"/"+ Warehouse" inside Add Parts). Category is
-- explicitly NOT changed by this migration — it stays free text (Turki's
-- own instruction), only units move to a lookup table.
--
-- SEED: preview/'s own CREATE_UNITS set (ea/L/set/kg/m) plus common
-- fleet-parts units of measure not in that original set (ml/g/box/pair/
-- roll/pack/ton) — labelled EN + AR so "meaning" travels with the code, not
-- just the glyph (the gap free text couldn't hold).
--
-- RLS: same "authenticated_all_<table>" pattern as every other lookup
-- table in this app (warehouses/parts 0043, suppliers 0045) — full
-- read/write for any logged-in user, anon gets nothing.
--
-- SOFT-DELETE: `active boolean not null default true`, same convention as
-- every other entity table here — retiring a unit (if that's ever needed)
-- is a pre-filter, never a hard delete, consistent with warehouses/
-- suppliers/parts.

begin;

create table if not exists public.units (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label_en   text not null,
  label_ar   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.units enable row level security;
drop policy if exists "authenticated_all_units" on public.units;
create policy "authenticated_all_units"
  on public.units for all to authenticated using (true) with check (true);

-- Seed — preview/'s CREATE_UNITS (ea/L/set/kg/m) + common additions.
insert into public.units (code, label_en, label_ar) values
  ('ea',   'Each (ea)',        'قطعة'),
  ('L',    'Liter (L)',        'لتر'),
  ('ml',   'Milliliter (ml)',  'مل'),
  ('set',  'Set',              'طقم'),
  ('kg',   'Kilogram (kg)',    'كيلوغرام'),
  ('g',    'Gram (g)',         'غرام'),
  ('m',    'Meter (m)',        'متر'),
  ('box',  'Box',              'كرتون'),
  ('pair', 'Pair',             'زوج'),
  ('roll', 'Roll',             'لفة'),
  ('pack', 'Pack',             'عبوة'),
  ('ton',  'Ton',              'طن')
on conflict (code) do nothing;

commit;
