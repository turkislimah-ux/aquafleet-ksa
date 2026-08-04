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
-- RECONCILED TO THE LIVE FUNCTION BODY. An earlier revision of this file
-- carried a RECONSTRUCTION of archive_linked_one_per_person() (I have no DB
-- read access — the Supabase MCP returns "You do not have permission to
-- perform this action" on every query — so it could not be diffed at the
-- time). The architect has since supplied pg_get_functiondef()'s output and
-- the body below is now that, verbatim.
--
-- Worth recording what the reconstruction got WRONG, since it is the case for
-- reconciling rather than trusting a plausible-looking body: it collapsed the
-- two populations into one coalesce()d subject check with a single error
-- message, and gated the self-row exclusion on tg_op. Live keeps driver and
-- staff as two independent branches, each with its own message naming which
-- population it is about, and excludes the current row with a plain
-- `d.id <> new.id` that works for INSERT and UPDATE alike. Same rule, but not
-- the same code — and the messages a user would have seen were different.
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
-- app/archive/actions.ts's setPersonLinkedId() already makes it: the app picks
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
--  - PARTIALLY re-runnable: `add column if not exists`, a guarded DO block
--    for the FK, and `create or replace` for the function are all safe to
--    repeat. The CREATE TRIGGER is NOT guarded by a preceding drop — that
--    matches live, and it is the safer shape for a file that has already been
--    double-applied once: a second run ERRORS on the trigger instead of
--    quietly recreating it.
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
--    Body below is the LIVE definition, verbatim (see the header note).
--    SECURITY INVOKER is the default, so Postgres omits the keyword — its
--    absence here IS invoker, not an oversight.
--
--    Note the trigger is created WITHOUT a preceding `drop trigger if
--    exists`, matching live. Re-running this file therefore errors on the
--    CREATE TRIGGER rather than silently recreating it — which is the safer
--    failure for a file that has already been double-applied once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_linked_one_per_person()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_type          text;
  v_linked_driver text;
  v_linked_staff  text;
begin
  select g.type_key into v_type
    from public.archive_document_groups g
   where g.id = new.group_id;

  if v_type is null then
    return new;
  end if;

  select linked_driver_field, linked_staff_field
    into v_linked_driver, v_linked_staff
    from public.archive_document_types
   where key = v_type;

  if new.driver_id is not null and v_linked_driver is not null then
    if exists (
      select 1 from public.archive_documents d
       where d.group_id = new.group_id and d.driver_id = new.driver_id and d.id <> new.id
    ) then
      raise exception 'This driver already has a "%" document in this group (linked types allow one per person; renew instead).', v_type
        using errcode = '23505';
    end if;
  end if;

  if new.staff_id is not null and v_linked_staff is not null then
    if exists (
      select 1 from public.archive_documents d
       where d.group_id = new.group_id and d.staff_id = new.staff_id and d.id <> new.id
    ) then
      raise exception 'This staff member already has a "%" document in this group (linked types allow one per person; renew instead).', v_type
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$function$;

revoke execute on function public.archive_linked_one_per_person() from public, anon;

CREATE TRIGGER archive_linked_one_per_person_trg BEFORE INSERT OR UPDATE ON public.archive_documents
  FOR EACH ROW EXECUTE FUNCTION archive_linked_one_per_person();

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
