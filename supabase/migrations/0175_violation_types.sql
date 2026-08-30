-- 0175_violation_types.sql
-- TRAFFIC VIOLATIONS, STAGE 1 of 2 — the LOOKUP table only.
-- 0176 adds the child table that points at it. Schema only: no view change, no
-- RPC, no deductions wiring, nothing reads this yet.
--
-- DRAFTED, NOT APPLIED. Per CLAUDE.md §5 the architect runs it.
--
-- ===========================================================================
-- WHY A SEPARATE FILE FROM THE CHILD TABLE
--
-- The lookup is a vocabulary; the child is a ledger of events. They have
-- different lifetimes — the type list gets edited in-app forever, the child
-- table's shape should not. Splitting them mirrors 0011 (staff_roles) and 0012
-- (leave_types), which are the two tables this one is modelled on, and means a
-- future change to the vocabulary does not have to reopen a money-bearing file.
--
-- ===========================================================================
-- THE SHAPE IS staff_roles / leave_types, MEASURED NOT ASSUMED
--
-- Both live tables were read out of the catalog before this was written and are
-- byte-identical in column order and defaults:
--   id uuid pk default gen_random_uuid() · key text not null · label text not
--   null · is_default boolean not null default false · active boolean not null
--   default true · created_at timestamptz not null default now() · label_ar text
--
-- ONE DELIBERATE DEPARTURE: label_ar is NOT NULL here.
-- On those two tables it is nullable, and that is an artefact of HOW it arrived,
-- not a design choice — 0168 appended the column to tables that already held
-- rows, so nullable was the only option, and 0169/0170 then backfilled the
-- built-ins by hand. Two custom rows on leave_types still carry label_ar NULL.
-- This table is born empty, so it can require both languages from the first row
-- and never need a backfill migration.
--
-- *** THE CONSEQUENCE, STATED SO IT IS NOT DISCOVERED IN STAGE 2 ***
-- NOT NULL means the in-app "add violation type" form MUST collect an Arabic
-- label. An insert with only an English name will fail with 23502. The existing
-- leave-type / role create forms take ONE field, so the violations form cannot
-- be copied from them unchanged. If Turki would rather type one name and have
-- Arabic optional, this is the line to change — make it nullable and let
-- arText(label, label_ar, lang) fall back, exactly as LeaveSection does today.
--
-- ===========================================================================
-- key IS THE IMMUTABLE IDENTIFIER (CLAUDE.md §6)
--
-- A rename edits `label` / `label_ar`. It NEVER edits `key`. Unlike
-- leave_periods.leave_type — which is an FK to leave_types.key and so makes the
-- key structurally load-bearing — 0176 references violation_types(id), so `key`
-- carries no FK. It is still immutable: it is what code, seeds and any future
-- report would match on, and a rewritten key silently re-points meaning.
--
-- RETIRING A TYPE IS `active = false`, NEVER A DELETE. 0176's FK is ON DELETE
-- RESTRICT precisely so the delete path fails loudly. A deactivated type stays
-- readable on the historical rows that point at it and drops out of the picker.
--
-- ===========================================================================
-- THE SEED LIST — A STARTING SET, NOT A CLOSED ONE
--
-- Twelve common Saudi traffic violations, all is_default = true. This is the
-- same "seed the builtins, let the user add more" model as 0012's four leave
-- types. Turki adds, renames and deactivates types in-app; nothing here is
-- final, and no code should hardcode any of these keys.
--
-- `overloading` is on the list because this is a water-transport fleet of ~40
-- trucks, not because it is a common private-car offence.
--
-- `other` is the catch-all so a violation with no matching type can still be
-- logged rather than forcing a new type row mid-entry.
--
-- *** THE ARABIC NEEDS TURKI'S EYES BEFORE THIS RUNS ***
-- These are written, not carried from an existing dictionary — there is no
-- prior violations vocabulary in lib/i18n.ts to copy from. 0169 and 0170 both
-- ended with Turki's own shorter spellings replacing the dictionary's, and in
-- both cases the LIVE ROW became the truth and the migration file was corrected
-- to match it (CLAUDE.md §5, the database outranks the notes). Expect the same
-- here: if he edits a name in-app after this runs, the row wins and this file
-- gets corrected, not re-run.
--
-- ===========================================================================
-- NO begin; / commit; — CLAUDE.md §5, BARE STATEMENTS ONLY.
--
-- Worth stating because this file's own template breaks the rule: 0166 wraps
-- itself at :100/:258. That file predates the 0173-v1 incident, where a nested
-- begin; was ignored with a warning and the trailing commit; closed the SQL
-- Editor's OWN transaction — every grid printed clean and nothing was created.
-- Copy 0166's table shape and security footer. Do not copy its wrapper.
--
-- pgcrypto is not declared here. It is installed live (confirmed against
-- pg_extension), and no migration since 0157 re-declares it.
-- ===========================================================================

-- ---------------------------------------------------------------------
-- 1. THE TABLE
-- ---------------------------------------------------------------------
create table if not exists public.violation_types (
  id          uuid        primary key default gen_random_uuid(),

  key         text        not null,
  label       text        not null,
  label_ar    text        not null,

  is_default  boolean     not null default false,
  active      boolean     not null default true,

  created_at  timestamptz not null default now(),

  constraint violation_types_key_unique unique (key),

  -- Blank-but-present is the failure mode a NOT NULL does not catch: a form
  -- that submits an empty string satisfies the column and produces a nameless
  -- type in the picker. Mirrors the non-blank checks on expenses.category.
  constraint violation_types_key_not_blank      check (btrim(key) <> ''),
  constraint violation_types_label_not_blank    check (btrim(label) <> ''),
  constraint violation_types_label_ar_not_blank check (btrim(label_ar) <> '')
);

-- ---------------------------------------------------------------------
-- 2. SEED — the built-in vocabulary.
--
-- `on conflict (key) do nothing` copies 0012's seed exactly, which makes the
-- whole file re-runnable: a second run inserts nothing and, critically, does
-- NOT overwrite a label Turki has since edited in-app.
-- ---------------------------------------------------------------------
insert into public.violation_types (key, label, label_ar, is_default) values
  ('speeding',             'Speeding',                        'تجاوز السرعة المحددة',              true),
  ('red_light',            'Running a red light',             'قطع الإشارة الحمراء',                true),
  ('illegal_parking',      'Parking in a prohibited place',   'الوقوف في مكان ممنوع',              true),
  ('phone_use',            'Using a phone while driving',     'استخدام الجوال أثناء القيادة',       true),
  ('no_seatbelt',          'Not wearing a seatbelt',          'عدم ربط حزام الأمان',                true),
  ('wrong_lane',           'Driving in the wrong lane',       'القيادة في المسار الخاطئ',           true),
  ('reckless_driving',     'Reckless driving',                'القيادة بتهور',                      true),
  ('expired_license',      'Expired driving licence',         'رخصة قيادة منتهية الصلاحية',        true),
  ('expired_registration', 'Expired vehicle registration',    'استمارة مركبة منتهية الصلاحية',     true),
  ('no_insurance',         'Driving without valid insurance', 'القيادة بدون تأمين ساري',           true),
  ('overloading',          'Overloading the vehicle',         'تحميل المركبة بأكثر من المسموح',    true),
  ('other',                'Other',                           'أخرى',                               true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. RLS + the anon revoke.
--
-- `using (true) with check (true)` — the shared-lookup shape staff_roles and
-- leave_types already use, not the own-row shape of user_profiles. A violation
-- type is fleet vocabulary; either user maintains it.
--
-- The revoke is kept even though 0161 already revoked anon across the schema
-- and changed default privileges. That change only covers tables created AFTER
-- it, so on a fresh db reset every earlier migration creates its table first —
-- and the per-table line is what makes this migration correct read on its own
-- (CLAUDE.md §6).
-- ---------------------------------------------------------------------
alter table public.violation_types enable row level security;

drop policy if exists authenticated_all_violation_types on public.violation_types;
create policy authenticated_all_violation_types
  on public.violation_types for all to authenticated
  using (true) with check (true);

revoke all on public.violation_types from anon;

-- ---------------------------------------------------------------------
-- 4. Comments — the rules, stated where a schema dump repeats them.
-- ---------------------------------------------------------------------
comment on table public.violation_types is
  'LOOKUP VOCABULARY for traffic violations (0175). Same model as staff_roles (0011) and leave_types (0012): an immutable `key`, a bilingual pair of display names, an `is_default` marker for the seeded built-ins, and an `active` flag that retires a type without deleting it. Turki maintains this list in-app. NO CODE MAY HARDCODE A KEY FROM THIS TABLE — the list is user-editable and a key that code depends on is a key that stops being editable. driver_violations (0176) references this table by id with ON DELETE RESTRICT, so a hard delete of a type that history points at fails loudly instead of orphaning rows; retiring means active = false.';

comment on column public.violation_types.key is
  'IMMUTABLE identifier (CLAUDE.md section 6). A rename updates label / label_ar and NEVER this. Unlike leave_types.key it carries no FK — 0176 points at id — but it is still the stable handle for seeds and any future report, and rewriting one silently re-points meaning on every historical row.';

comment on column public.violation_types.label_ar is
  'Arabic display name. NOT NULL, unlike staff_roles.label_ar and leave_types.label_ar — those two are nullable only because 0168 appended the column to already-populated tables. This one is born with it, so no backfill migration will ever be needed. CONSEQUENCE: the in-app create form must collect Arabic; an English-only insert fails with 23502. The app resolves a name through arText(label, label_ar, lang), which would fall back to English if this were ever relaxed to nullable.';

comment on column public.violation_types.active is
  'Soft-retire flag. FALSE hides the type from the picker while keeping it readable on the historical violations that reference it. This is the delete path for a violation type — there is no other one (CLAUDE.md section 6: soft-delete, not hard-delete).';

comment on column public.violation_types.is_default is
  'TRUE for the twelve types seeded by 0175. Marks a built-in so a future migration can target the seeded set without touching types Turki added by hand — exactly how 0169 and 0170 scoped their Arabic backfills with `and is_default = true`.';

-- ===========================================================================
-- VERIFY AFTER APPLY — the catalog, not this file's result grid (CLAUDE.md §5).
--
--   -- 1. Table exists, RLS on, anon locked out, one policy.
--   select c.relname, c.relrowsecurity as rls,
--          has_table_privilege('anon', c.oid, 'select') as anon_select,
--          has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'violation_types';
--   -- expect: t / false / true / 1
--
--   -- 2. Column shape matches the two sibling lookups, with label_ar NOT NULL.
--   select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull
--     from pg_attribute a
--     join pg_class c on c.oid = a.attrelid
--     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--    where c.relname = 'violation_types' and a.attnum > 0 and not a.attisdropped
--    order by a.attnum;
--
--   -- 3. Seed landed, both languages present on all twelve.
--   select count(*) as total,
--          count(*) filter (where is_default) as builtins,
--          count(*) filter (where btrim(label_ar) = '') as blank_ar
--     from public.violation_types;
--   -- expect: 12 / 12 / 0
--
--   select key, label, label_ar from public.violation_types order by key;
--   -- READ THE ARABIC COLUMN IN THE GRID before accepting it. Turki's wording
--   -- wins over anything written here; if he changes one, the row is the truth
--   -- and this file gets corrected, not re-run.
-- ===========================================================================
