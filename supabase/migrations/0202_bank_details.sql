-- ===========================================================================
-- 0202_bank_details.sql
-- Bank details for drivers and staff: a bank_codes lookup, plus bank_code_id
-- and iban on both people tables.
--
-- WHY: salaries are paid by bank transfer. The payslip screen and print sheet
-- will show where the money goes, and a bank-transfer file (LATER app work,
-- not this migration) will read these columns. This file is the DATA only —
-- it touches no payslip table, no payslip view, and no money function.
--
-- bank_codes follows the vehicle_types shape (0201), which is violation_types
-- (0175) / staff_roles (0011) / units (0049): immutable key, bilingual label
-- pair, sort_order, active soft-retire flag, created_at, blank-checks, RLS +
-- per-table anon revoke. ONE deliberate divergence: `key` is not a lowercase
-- slug but the bank's 4-letter SWIFT/BIC prefix (NCBK, RJHI, ...) — a real
-- interbank identifier a transfer file can carry, so its shape is pinned by a
-- format CHECK rather than left to form discipline.
--
-- IBAN is nullable on both tables — a person without banking details on file
-- is a normal state, not an error. The format CHECK accepts only the
-- NORMALIZED Saudi shape (SA + 22 digits, uppercase, no spaces); the server
-- action is responsible for stripping spaces and upcasing before it writes,
-- and this constraint is the boundary that refuses anything else.
--
-- RE-RUNNABLE: `if not exists` everywhere, `on conflict (key) do nothing` on
-- the seed, constraint adds guarded on pg_constraint.
--
-- DRAFT — architect reviews; Turki applies in the Supabase SQL Editor.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. bank_codes — the managed lookup.
--
-- Shape copied from vehicle_types (0201). label_ar is NOT NULL: the table is
-- born bilingual, so no backfill migration will ever be needed for it.
-- sort_order carries the picker order below — the big retail banks first,
-- which alphabetical is not.
-- ---------------------------------------------------------------------------
create table if not exists public.bank_codes (
  id          uuid        primary key default gen_random_uuid(),

  key         text        not null,
  label       text        not null,
  label_ar    text        not null,

  sort_order  integer     not null default 0,
  active      boolean     not null default true,

  created_at  timestamptz not null default now(),

  constraint bank_codes_key_unique unique (key),

  -- The same three blank-checks every sibling lookup carries. key's is
  -- formally subsumed by the format check below; kept for shape parity.
  constraint bank_codes_key_not_blank      check (btrim(key) <> ''),
  constraint bank_codes_label_not_blank    check (btrim(label) <> ''),
  constraint bank_codes_label_ar_not_blank check (btrim(label_ar) <> ''),

  -- The divergence from the slug-key lookups: a bank's key IS its 4-letter
  -- BIC prefix, exactly, uppercase. 'rjhi' or 'RJHI ' is a different string
  -- to a bank's systems, so the shape is a constraint, not a convention.
  constraint bank_codes_key_format_check   check (key ~ '^[A-Z]{4}$')
);

-- Seed: thirteen banks, in picker order. `on conflict (key) do nothing`
-- keeps the file re-runnable AND never overwrites a label edited in-app.
insert into public.bank_codes (key, label, label_ar, sort_order) values
  ('NCBK', 'Saudi National Bank (SNB)', 'البنك الأهلي السعودي',    1),
  ('RJHI', 'Al Rajhi Bank',             'مصرف الراجحي',            2),
  ('RIBL', 'Riyad Bank',                'بنك الرياض',              3),
  ('SABB', 'Saudi Awwal Bank (SAB)',    'البنك السعودي الأول',     4),
  ('ARNB', 'Arab National Bank (ANB)',  'البنك العربي الوطني',     5),
  ('INMA', 'Alinma Bank',               'مصرف الإنماء',            6),
  ('BSFR', 'Banque Saudi Fransi',       'البنك السعودي الفرنسي',   7),
  ('SIBC', 'Saudi Investment Bank',     'البنك السعودي للاستثمار', 8),
  ('ALBI', 'Bank Albilad',              'بنك البلاد',              9),
  ('BJAZ', 'Bank Aljazira',             'بنك الجزيرة',             10),
  ('GULF', 'Gulf International Bank',   'بنك الخليج الدولي',       11),
  ('EBIL', 'Emirates NBD',              'بنك الإمارات دبي الوطني', 12),
  ('STCJ', 'STC Bank',                  'بنك إس تي سي',            13)
on conflict (key) do nothing;

-- RLS + the anon revoke. `using (true) with check (true)` — the shared-lookup
-- shape: bank vocabulary, either user maintains it. The revoke is restated
-- per-table because 0161's default-privilege change only covers tables
-- created after it, and this file must read correctly on its own
-- (CLAUDE.md section 6).
alter table public.bank_codes enable row level security;

drop policy if exists authenticated_all_bank_codes on public.bank_codes;
create policy authenticated_all_bank_codes
  on public.bank_codes for all to authenticated
  using (true) with check (true);

revoke all on public.bank_codes from anon;

comment on table public.bank_codes is
  'LOOKUP VOCABULARY for salary-transfer banks (0202). Same model as vehicle_types (0201), violation_types (0175), staff_roles (0011) and units (0049): an immutable `key`, a bilingual pair of display names, a sort_order for the picker, and an `active` flag that retires a bank without deleting it. drivers.bank_code_id and staff.bank_code_id reference this table by id with ON DELETE RESTRICT, so a hard delete of a bank someone points at fails loudly instead of orphaning the row; retiring means active = false. Unlike the slug-key lookups, `key` is the bank''s 4-letter SWIFT/BIC prefix — a real interbank identifier the transfer file carries — and bank_codes_key_format_check pins that shape.';

comment on column public.bank_codes.key is
  'IMMUTABLE identifier (CLAUDE.md section 6), and the bank''s 4-letter SWIFT/BIC prefix, uppercase, exactly (bank_codes_key_format_check). A rename updates label / label_ar and NEVER this — to a bank''s systems the key IS the identity.';

comment on column public.bank_codes.label_ar is
  'Arabic display name. NOT NULL, like vehicle_types.label_ar and for the same reason: the table is born with it, so any create form must collect Arabic. An English-only insert fails with 23502.';

comment on column public.bank_codes.active is
  'Soft-retire flag. FALSE hides the bank from the picker while keeping it readable on the people who already reference it. This is the delete path — there is no other one (CLAUDE.md section 6).';

comment on column public.bank_codes.sort_order is
  'Picker order, ascending. Ties break on label. Not a key and not stable identity — reordering the list is a display change and nothing may depend on a particular number.';


-- ---------------------------------------------------------------------------
-- 2. The new columns, on both people tables.
--
-- Both NULLABLE: banking details arrive when they arrive, and a person
-- without them must keep saving exactly as before. The FK autogenerates
-- drivers_bank_code_id_fkey / staff_bank_code_id_fkey — the verification
-- block below reads those default names.
-- ---------------------------------------------------------------------------
alter table public.drivers
  add column if not exists bank_code_id uuid references public.bank_codes(id) on delete restrict,
  add column if not exists iban         text;

alter table public.staff
  add column if not exists bank_code_id uuid references public.bank_codes(id) on delete restrict,
  add column if not exists iban         text;

comment on column public.drivers.bank_code_id is
  'Where this driver''s salary transfer goes — FK to bank_codes, ON DELETE RESTRICT. NULL = bank not on file. Independent of iban ON PURPOSE (either may be recorded first); the transfer-file builder must require BOTH before it emits a row.';

comment on column public.drivers.iban is
  'Saudi IBAN, NORMALIZED: SA + 22 digits, uppercase, no spaces (drivers_iban_format_check). NULL = not on file. The server action strips spaces and upcases before writing; this constraint is the boundary that refuses everything else.';

comment on column public.staff.bank_code_id is
  'Where this staff member''s salary transfer goes — FK to bank_codes, ON DELETE RESTRICT. NULL = bank not on file. Independent of iban ON PURPOSE (either may be recorded first); the transfer-file builder must require BOTH before it emits a row.';

comment on column public.staff.iban is
  'Saudi IBAN, NORMALIZED: SA + 22 digits, uppercase, no spaces (staff_iban_format_check). NULL = not on file. The server action strips spaces and upcases before writing; this constraint is the boundary that refuses everything else.';


-- ---------------------------------------------------------------------------
-- 3. IBAN format checks + FK indexes.
--
-- The checks are guarded because ADD CONSTRAINT has no IF NOT EXISTS. Both
-- columns are brand new and all-NULL, so validation is trivially clean — no
-- NOT VALID / VALIDATE split needed (that split existed in 0201 for a
-- constraint over PRE-EXISTING data).
--
-- The indexes: a plain index on each FK. Postgres does not create one, and an
-- unindexed FK makes every DELETE or key UPDATE on bank_codes seq-scan the
-- referencing table (supabase-postgres-best-practices,
-- schema-foreign-key-indexes). Free at today's row counts; here so it does
-- not have to be remembered later.
-- ---------------------------------------------------------------------------
do $add_iban_checks$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.drivers'::regclass
                    and conname  = 'drivers_iban_format_check') then
    alter table public.drivers
      add constraint drivers_iban_format_check
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.staff'::regclass
                    and conname  = 'staff_iban_format_check') then
    alter table public.staff
      add constraint staff_iban_format_check
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;
end $add_iban_checks$;

create index if not exists drivers_bank_code_id_idx
  on public.drivers (bank_code_id);

create index if not exists staff_bank_code_id_idx
  on public.staff (bank_code_id);


-- ---------------------------------------------------------------------------
-- 4. VERIFICATION — inside the transaction, so a failure rolls the whole file
-- back rather than leaving half of it applied.
--
-- NOTICE-vs-RAISE, per 0200/0201: THIS BLOCK EXITS 0 ON SUCCESS and raises
-- ONLY on a real failure. A silent, clean run IS the pass.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_banks bigint;
begin
  -- 1. The seed landed, and nothing else did.
  select count(*) into v_banks from public.bank_codes;
  if v_banks <> 13 then
    raise exception
      'FAIL 1: bank_codes holds % row(s), expected the 13 seeded banks.', v_banks;
  end if;

  -- 2-3. Both FKs exist, both RESTRICT, both pointing at bank_codes.
  if not exists (select 1 from pg_constraint
                  where conrelid    = 'public.drivers'::regclass
                    and conname     = 'drivers_bank_code_id_fkey'
                    and contype     = 'f'
                    and confrelid   = 'public.bank_codes'::regclass
                    and confdeltype = 'r') then
    raise exception
      'FAIL 2: drivers.bank_code_id FK to bank_codes (on delete restrict) is missing or wrong.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid    = 'public.staff'::regclass
                    and conname     = 'staff_bank_code_id_fkey'
                    and contype     = 'f'
                    and confrelid   = 'public.bank_codes'::regclass
                    and confdeltype = 'r') then
    raise exception
      'FAIL 3: staff.bank_code_id FK to bank_codes (on delete restrict) is missing or wrong.';
  end if;

  -- 4-5. Both IBAN format checks exist.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.drivers'::regclass
                    and conname  = 'drivers_iban_format_check'
                    and contype  = 'c') then
    raise exception 'FAIL 4: drivers_iban_format_check is missing.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.staff'::regclass
                    and conname  = 'staff_iban_format_check'
                    and contype  = 'c') then
    raise exception 'FAIL 5: staff_iban_format_check is missing.';
  end if;
end $verify$;

commit;


-- ===========================================================================
-- POST-APPLY — read-only. Run these; do not assume.
--
-- 1. The seed, in picker order:
--      select key, label, label_ar, sort_order, active
--        from public.bank_codes order by sort_order;
--
-- 2. The whole new constraint surface, in one look:
--      select conrelid::regclass as onto, conname,
--             pg_get_constraintdef(oid) as def
--        from pg_constraint
--       where conname in ('drivers_bank_code_id_fkey',  'staff_bank_code_id_fkey',
--                         'drivers_iban_format_check',  'staff_iban_format_check',
--                         'bank_codes_key_format_check','bank_codes_key_unique')
--       order by 1, 2;
--
-- 3. Closed to anon:
--      select has_table_privilege('anon', 'public.bank_codes', 'select');
--      -- must be false
-- ===========================================================================
