-- 0085_archive_document_identity_fields.sql
-- Archive refinement — three OPTIONAL identity attributes on a document:
-- issuing entity, holder name, and a document type (a managed pick-list).
--
-- ADDITIVE ONLY: one new lookup table + three new NULLABLE columns on
-- archive_documents. Alters no existing behaviour, drops nothing, backfills
-- nothing, and adds NO function — so there is nothing new for the 0083
-- anon-hardening pass to re-cover (see the "no RPC" note at the bottom).
--
-- ===========================================================================
-- WHY THESE THREE ARE **NOT** IN THE RENEWAL SNAPSHOT
-- ===========================================================================
-- archive_document_renewals is deliberately UNCHANGED by this migration.
-- It snapshots what actually CHANGES at renewal — reference number, issue
-- date, expiry date, note. The three fields added here are IDENTITY
-- attributes of the document itself:
--
--   issuing_entity  — who issued it (the ministry/authority/insurer)
--   holder_name     — whose name it is in
--   type_key        — what kind of document it is
--
-- A renewed vehicle licence is still issued by the same authority, still in
-- the same holder's name, and is still a vehicle licence. If any of those
-- three genuinely change, that is a CORRECTION to the document's identity —
-- an EDIT — not a new period of coverage. Snapshotting them per renewal
-- would imply they varied version-to-version, which would be misleading in
-- exactly the audit conversation this history exists to serve.
--
-- Practical consequence, stated so a future phase doesn't "fix" it: the
-- renewal history rows show the same identity as the current document,
-- because that identity is read from the parent row. That is correct.
--
-- ===========================================================================
-- DESIGN — document type as a managed pick-list (mirrors commission_types)
-- ===========================================================================
-- Same shape migration 0080 established for commission_types, and for the
-- same reasons:
--   - `key` is the stable machine value and the FK target (not the label),
--     so renaming a type's display label never rewrites child rows.
--   - `on delete restrict` — a type IN USE cannot be deleted (Turki's
--     explicit requirement). Postgres refuses the delete outright rather
--     than orphaning or nulling documents.
--   - `on update cascade` — renaming the KEY itself propagates to every
--     document that references it.
--   - `active` allows retiring a type from the picker WITHOUT deleting it,
--     which is the safe way to remove an in-use type from future selection
--     while every historical document keeps resolving. Inline "add new
--     type" re-activates an existing key rather than erroring on a
--     duplicate, exactly like addStaffCommissionType already does.
--
-- Bilingual label_en/label_ar matches commission_types / repairer_types.
-- The inline-add flow supplies one typed label for both (same UX as leave
-- types, staff roles and repairer types — none of those prompt for a
-- separate Arabic label either); a real translation can be edited in later.
--
-- type_key is NULLABLE (unlike commission_types' NOT NULL usage): every one
-- of the three fields here is optional per the requirement, and documents
-- already exist from Phase 1 with no type at all. A NOT NULL column would
-- have needed a backfill and a fabricated default type for real records.

begin;

-- ---------------------------------------------------------------------------
-- 1) archive_document_types — the managed pick-list.
-- ---------------------------------------------------------------------------
create table if not exists public.archive_document_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label_en   text not null,
  label_ar   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.archive_document_types enable row level security;
drop policy if exists "authenticated_all_archive_document_types" on public.archive_document_types;
create policy "authenticated_all_archive_document_types"
  on public.archive_document_types for all to authenticated using (true) with check (true);

-- Starter set — deliberately SMALL and generic (the regulatory document
-- kinds this business actually files), not an attempt to enumerate every
-- possibility. Inline "add new type" covers the rest, and `active` retires
-- any of these that don't fit without deleting them.
insert into public.archive_document_types (key, label_en, label_ar) values
  ('license',      'License',                'رخصة'),
  ('permit',       'Permit',                 'تصريح'),
  ('insurance',    'Insurance',              'تأمين'),
  ('registration', 'Registration',           'تسجيل'),
  ('certificate',  'Certificate',            'شهادة'),
  ('contract',     'Contract',               'عقد'),
  ('other',        'Other',                  'أخرى')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) archive_documents — three optional identity fields.
--    All NULLABLE, no defaults: an existing Phase-1 document simply reads
--    null on each, and the UI renders "—" (never a fabricated value).
-- ---------------------------------------------------------------------------
alter table public.archive_documents
  add column if not exists issuing_entity text,
  add column if not exists holder_name    text,
  add column if not exists type_key       text;

-- FK added separately from the column so this migration stays re-runnable
-- (add column if not exists + a guarded constraint add).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'archive_documents_type_key_fkey'
      and conrelid = 'public.archive_documents'::regclass
  ) then
    alter table public.archive_documents
      add constraint archive_documents_type_key_fkey
      foreign key (type_key) references public.archive_document_types(key)
      on delete restrict on update cascade;
  end if;
end $$;

-- Supports the "is this type in use?" check the UI runs before offering a
-- delete, and any future group-by-type view.
create index if not exists archive_documents_type_key_idx
  on public.archive_documents (type_key) where type_key is not null;

commit;

-- ===========================================================================
-- POSTGREST EMBED CHECK — archive_documents -> archive_document_types is a
-- FIRST-AND-ONLY FK for that table pair, so it does not reintroduce the 0077
-- ambiguity (that incident was a SECOND FK between trucks and drivers). The
-- three subject FKs added in 0084 each still point at a different table.
-- Verified live before writing this file: no table pair in this schema
-- carries more than one FK.
--
-- NO RPC — same reasoning as 0084: plain single-table CRUD, no counter, no
-- stock, no money, no cross-table invariant. The "a type in use can't be
-- deleted" rule is enforced by the FK's own ON DELETE RESTRICT in the
-- database, not by application logic — which is why it needs no function.
-- If a future need does add one, per the 0083 hardening it must be
-- SECURITY DEFINER + SET search_path = public + GRANT EXECUTE TO
-- authenticated ONLY (never PUBLIC/anon).
-- ===========================================================================
