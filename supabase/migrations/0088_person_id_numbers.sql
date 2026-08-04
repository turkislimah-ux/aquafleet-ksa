-- 0088_person_id_numbers.sql
-- Archive Phase 2 adjustments — "the person owns the number".
--
-- ===========================================================================
-- THE MODEL THIS ENABLES
-- ===========================================================================
-- An Iqama number or a driving-licence number is an attribute of the PERSON,
-- not of a piece of paper. Renewing an Iqama does not issue a new number — it
-- extends the same one. So for the three linked combinations:
--
--     iqama-type document   on a driver  -> drivers.iqama_number  (exists)
--     iqama-type document   on a staff   -> staff.iqama_number    (NEW)
--     licence-type document on a driver  -> drivers.license_number (NEW)
--
-- ...the number is stored ONCE, on the person. The archive matrix's
-- Reference/ID cell for those documents reads and writes the PERSON's field;
-- the document's own reference_no stays unused for them, so a second copy of
-- the number never exists anywhere to drift out of sync. The document keeps
-- what genuinely renews: dates, files, and history.
--
-- ===========================================================================
-- COLUMN NAMES — matching what is already there
-- ===========================================================================
-- Both names are the missing halves of pairs this schema already has, so
-- neither introduces a new convention:
--
--   drivers.license_expiry  exists (0001)  ->  drivers.license_number  (NEW)
--   staff.iqama_expiry      exists (0023)  ->  staff.iqama_number      (NEW)
--
-- staff.iqama_number is also deliberately the SAME name as the column
-- drivers already carries. The two populations answer the same question, and
-- the app reads them through one shared code path in the matrix — a
-- staff-side variant spelling (staff_iqama_no, iqama_id, ...) would force a
-- per-population branch for no gain.
--
-- Both are `text`, not numeric: these are identifiers, not quantities. They
-- can carry leading zeros, they are never summed, and a numeric type would
-- silently destroy a leading zero on the first write. Same reasoning as
-- customers.vat_number / cr_number already in this schema.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES NOT DO — stated, not skipped
-- ===========================================================================
-- NO UNIQUE CONSTRAINT on either column, deliberately. In reality an Iqama
-- number is unique per person, so a partial unique index on the non-null
-- values is tempting. Two reasons it is not here:
--
--   1. It would reject the ENTIRE first save that collides, including the
--      common case of a typo in an existing row nobody has noticed yet —
--      turning a data-entry correction into a hard block with a raw
--      constraint error, before anyone has had a chance to fix the old row.
--   2. Existing rows have never been validated against it. I have no read
--      access to check for duplicates this session, so adding it blind risks
--      the migration itself failing on apply.
--
-- If you want it, the safe sequence is: apply this, let the numbers be
-- entered, then a later migration adds
--     create unique index ... on public.drivers (iqama_number)
--       where iqama_number is not null;
-- once a duplicate check has actually been run. Say the word and I will
-- write it as its own migration rather than folding it in here.
--
-- NO BACKFILL. Both columns start NULL for every existing row, which is
-- honest: nobody has entered these numbers yet. A driver's Iqama number
-- (drivers.iqama_number) is untouched — it already holds real data.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE ONLY: two nullable columns + one lookup row. No column is
--    altered or dropped, no data is rewritten.
--  - NO NEW FOREIGN KEY, so the 0077 PostgREST embed hazard is not in play.
--  - NO NEW FUNCTION, so nothing for the 0083 anon-hardening pass to cover.
--  - RLS untouched: both columns land on existing tables that already carry
--    their policies. Adding a column does not alter a policy.
--  - Re-runnable: `add column if not exists` + `on conflict (key) do nothing`.

begin;

-- ---------------------------------------------------------------------------
-- 1) drivers.license_number — the counterpart to the existing license_expiry.
-- ---------------------------------------------------------------------------
alter table public.drivers
  add column if not exists license_number text;

comment on column public.drivers.license_number is
  'Driving licence number. Owned by the PERSON, not by a document: a licence-type archive document for this driver reads/writes THIS field and leaves its own reference_no unused, so the number exists in exactly one place. Pairs with license_expiry.';

-- ---------------------------------------------------------------------------
-- 2) staff.iqama_number — same column name drivers already uses, because it
--    answers the same question and the archive matrix reads both through one
--    shared code path.
-- ---------------------------------------------------------------------------
alter table public.staff
  add column if not exists iqama_number text;

comment on column public.staff.iqama_number is
  'Iqama (residency) number. Owned by the PERSON, not by a document: an iqama-type archive document for this staff member reads/writes THIS field and leaves its own reference_no unused. Same name and meaning as drivers.iqama_number. Pairs with iqama_expiry.';

-- ---------------------------------------------------------------------------
-- 3) Seed the 'iqama' document type.
--
--    0085 seeded license/permit/insurance/registration/certificate/contract/
--    other — no iqama. The linked-number mapping keys off the type's stable
--    `key`, so 'iqama' has to exist as a real row rather than being matched
--    by title text. `on conflict do nothing` keeps this re-runnable and also
--    means a hand-added 'iqama' type (via the UI's inline add-new) is left
--    exactly as it is, labels included.
--
--    NOTE: if an 'iqama' type was already added through the UI and later
--    RETIRED (active = false), this insert will not re-activate it — the
--    conflict clause does nothing. Re-activating is what the inline add-new
--    flow already does on its own, so that path stays the one place that
--    decides. Worth a glance at the verification query below.
-- ---------------------------------------------------------------------------
insert into public.archive_document_types (key, label_en, label_ar) values
  ('iqama', 'Iqama', 'إقامة')
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) Both columns exist, text, nullable:
--      select table_name, column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public'
--        and (   (table_name = 'drivers' and column_name = 'license_number')
--             or (table_name = 'staff'   and column_name = 'iqama_number'));
--    Expect 2 rows, both text, both YES.
--
-- 2) The type is present AND ACTIVE (see the note above — if this returns
--    active = false, it was retired through the UI at some point and needs
--    re-activating before the linked mapping will offer it):
--      select key, label_en, label_ar, active
--      from public.archive_document_types
--      where key = 'iqama';
--
-- 3) Existing driver Iqama numbers untouched (this migration adds columns
--    only — the count should match whatever it was before):
--      select count(*) from public.drivers where iqama_number is not null;
--
-- 4) Nothing else changed on either table — row counts unaffected:
--      select (select count(*) from public.drivers) as drivers,
--             (select count(*) from public.staff)   as staff;
