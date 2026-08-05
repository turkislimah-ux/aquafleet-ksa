-- 0091_truck_registration_linking.sql
-- Archive Phase 3 (Truck tab) — vehicle registration as a LINKED type.
--
-- ===========================================================================
-- APPLY THIS FILE EXACTLY AS REVIEWED
-- ===========================================================================
-- The 0089 double-apply taught us that a reconstruction diverges from what
-- actually ran, and that the divergence is invisible until someone diffs it.
-- The function body below is COMPLETE and FINAL — it is not a sketch to be
-- retyped. Run this file verbatim; if anything about it needs changing, change
-- it here first and re-review, so the file and the database never disagree.
--
-- ===========================================================================
-- WHAT THIS DOES
-- ===========================================================================
-- Extends the "store each fact once" model (0088/0089) to trucks, with the
-- TRUCK as the subject:
--
--   1. trucks gains vehicle_registration + registration_expiry. The truck
--      OWNS them; the archive document for a registration stores NEITHER.
--   2. archive_document_types gains linked_truck_field — the gap 0089 left
--      open on purpose ("add the column when truck linking is actually
--      needed, alongside the truck columns it points at"). That is now.
--   3. The EXISTING 'registration' type (seeded by 0085 — no new type is
--      created here) is mapped to linked_truck_field = 'vehicle_registration'.
--   4. archive_linked_one_per_person() gains a THIRD branch so one
--      registration document per truck is enforced, exactly as driver and
--      staff already are.
--
-- Registration is the ONLY linked truck type this round. Every other truck
-- document type stays regular/non-linked and keeps the multiple-allowed
-- behaviour, same as non-linked staff types.
--
-- ===========================================================================
-- PIECE 1 — the truck's own columns
-- ===========================================================================
-- trucks today carries `plate` and `vin` and nothing else identity-like, so
-- there is genuinely nothing to reuse: a vehicle registration (istimara) is a
-- separate document number with its own expiry.
--
--   vehicle_registration  text  -- an identifier, never summed, can carry
--                               -- leading zeros. Same reasoning as 0088's
--                               -- iqama/licence numbers, and as
--                               -- customers.vat_number / cr_number.
--   registration_expiry   date  -- pairs with it, exactly like
--                               -- drivers.license_number/license_expiry.
--
-- Both NULLABLE with NO backfill: nobody has entered these yet, and a
-- fabricated value on a compliance date would be worse than an honest blank.
--
-- NO UNIQUE CONSTRAINT, for the same reason 0088 gave and for one more:
-- a registration number really is unique per vehicle, but adding the
-- constraint blind would reject the first save that collides with a typo in
-- an existing row nobody has noticed yet. It can be added later, once the
-- data exists to check against.
--
-- ===========================================================================
-- PIECE 2 — linked_truck_field
-- ===========================================================================
-- Same shape as linked_driver_field / linked_staff_field: a nullable text
-- column naming ONLY the number column on the subject's table. Non-null =
-- this type is linked for trucks, which is exactly what the purple Link pill
-- tests.
--
-- The matching EXPIRY column is resolved in app code from a closed union
-- (vehicle_registration -> registration_expiry), never string-munged out of
-- this value. That keeps the write surface as narrow as
-- app/archive/actions.ts's setPersonLinkedId() already makes it — a row in
-- this table can pick which of a few known targets is used, but can never
-- point a write at a column nobody wrote code for.
--
-- ===========================================================================
-- PIECE 3 — the one-per-subject trigger gains a truck branch
-- ===========================================================================
-- Two deliberate decisions here, both worth stating because a reviewer would
-- otherwise reasonably expect the opposite:
--
-- (a) The DRIVER AND STAFF BRANCHES ARE BYTE-IDENTICAL to the live function,
--     including their message wording. They are verified working; this
--     migration adds a third branch beside them and changes nothing else in
--     the body. Rewording them "for consistency" would mean re-verifying
--     behaviour nobody asked to change.
--
-- (b) The FUNCTION KEEPS ITS NAME, archive_linked_one_per_person(), even
--     though a truck is not a person. Renaming would mean dropping and
--     recreating the trigger that depends on it — real churn and a real
--     window where the rule is not enforced, to fix a wart. The truck
--     branch's own message says "one per truck" rather than "one per
--     person", so nothing a user reads is wrong. If the name is worth fixing
--     later it should be its own migration, not a rider on this one.
--
-- ===========================================================================
-- 0077 EMBED HAZARD — clear, and here is why
-- ===========================================================================
-- This migration adds NO FOREIGN KEY of any kind. Two new plain text/date
-- columns on trucks, one plain text column on archive_document_types, one
-- function replaced. The 0077 incident was specifically a SECOND FK between
-- the SAME table pair breaking PostgREST embed disambiguation; with zero new
-- FKs there is no pair to make ambiguous. Nothing that currently embeds
-- trucks or archive_document_types is affected.
--
-- ===========================================================================
-- SECURITY (0083) — unchanged posture, restated so the file is self-contained
-- ===========================================================================
-- archive_linked_one_per_person() stays SECURITY INVOKER (the default —
-- Postgres omits the keyword; its absence IS invoker, not an oversight) and
-- keeps `set search_path to 'public'` pinned. INVOKER remains correct: the
-- function reads archive_document_groups / archive_document_types /
-- archive_documents, all of which the caller can already read under their
-- existing authenticated-only policies, so DEFINER would buy nothing and cost
-- the usual owner-context risk.
--
-- `create or replace` PRESERVES existing privileges, but the revoke is
-- re-issued below so this file states the end state outright instead of
-- depending on history. NO counter-grant to authenticated — matching 0087 and
-- 0089. A trigger function's EXECUTE is checked at CREATE TRIGGER time, not
-- at fire time, so the trigger keeps firing for every caller while nobody can
-- call the function directly.
--
-- The TRIGGER IS NOT RECREATED here. It already points at this function by
-- name, and `create or replace function` swaps the body underneath it — so
-- touching the trigger would be pure risk for no gain.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE: two columns on trucks, one on archive_document_types, one
--    UPDATE of a single lookup row, one function body replaced.
--  - No column dropped, no table created, no RLS policy altered, no row of
--    real data written.
--  - 0087's subject guard is NOT touched.
--  - Fully re-runnable: `add column if not exists`, an idempotent UPDATE,
--    `create or replace function`, and no CREATE TRIGGER at all.
--
-- ===========================================================================
-- PRE-FLIGHT (run before applying — I have no DB read access this session,
-- so these are checks for you, not claims from me)
-- ===========================================================================
-- A) Confirm the columns really are absent (this migration assumes trucks has
--    no registration fields yet):
--      select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'trucks'
--        and column_name in ('vehicle_registration', 'registration_expiry');
--    Expect ZERO rows.
--
-- B) Confirm the 'registration' type exists and is active (0085 seeded it;
--    this migration maps it rather than creating it):
--      select key, label_en, active, linked_driver_field, linked_staff_field
--      from public.archive_document_types where key = 'registration';
--    Expect one row, active = true. If active is false it was retired through
--    the UI at some point and needs re-activating before it can be picked.
--
-- C) THE ONE THAT CAN BITE — any truck that already holds MORE THAN ONE
--    document in the same group. If such a group is later typed
--    'registration', the new branch will refuse the next write to those rows:
--      select group_id, truck_id, count(*)
--      from public.archive_documents
--      where truck_id is not null
--      group by 1,2 having count(*) > 1;
--    Expect ZERO rows today (the Truck tab has not shipped). If not, resolve
--    those before typing the group.

begin;

-- ---------------------------------------------------------------------------
-- 1) The truck's own registration columns.
-- ---------------------------------------------------------------------------
alter table public.trucks
  add column if not exists vehicle_registration text,
  add column if not exists registration_expiry  date;

comment on column public.trucks.vehicle_registration is
  'Vehicle registration (istimara) number. Owned by the TRUCK, not by a document: a registration-type archive document for this truck reads/writes THIS column and stores no number of its own. Pairs with registration_expiry.';
comment on column public.trucks.registration_expiry is
  'Expiry of the vehicle registration. The SINGLE source for a linked registration document''s red/yellow status — the document stores no expiry of its own.';

-- ---------------------------------------------------------------------------
-- 2) linked_truck_field — the third member of 0089's set.
-- ---------------------------------------------------------------------------
alter table public.archive_document_types
  add column if not exists linked_truck_field text;

comment on column public.archive_document_types.linked_truck_field is
  'Non-null = documents of this type on a TRUCK are LINKED: the number lives on trucks.<this column> and the document stores neither number nor expiry. Drives the purple Link pill. Only the NUMBER column is named; the app resolves the matching expiry column from a closed union.';

-- ---------------------------------------------------------------------------
-- 3) Map the EXISTING 'registration' type (0085 seeded it — not created here).
--
--    Registration is truck-only: linked_driver_field / linked_staff_field are
--    left exactly as they are (null), because a person does not hold a
--    vehicle registration. This UPDATE touches one column of one row.
-- ---------------------------------------------------------------------------
update public.archive_document_types
   set linked_truck_field = 'vehicle_registration'
 where key = 'registration';

-- ---------------------------------------------------------------------------
-- 4) The one-per-subject trigger function, with the truck branch added.
--
--    Driver and staff branches are byte-identical to the live definition —
--    see decision (a) in the header. Only the declaration of v_linked_truck,
--    its addition to the existing SELECT, and the third `if` block are new.
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
  v_linked_truck  text;
begin
  select g.type_key into v_type
    from public.archive_document_groups g
   where g.id = new.group_id;

  if v_type is null then
    return new;
  end if;

  select linked_driver_field, linked_staff_field, linked_truck_field
    into v_linked_driver, v_linked_staff, v_linked_truck
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

  if new.truck_id is not null and v_linked_truck is not null then
    if exists (
      select 1 from public.archive_documents d
       where d.group_id = new.group_id and d.truck_id = new.truck_id and d.id <> new.id
    ) then
      raise exception 'This truck already has a "%" document in this group (linked types allow one per truck; renew instead).', v_type
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$function$;

revoke execute on function public.archive_linked_one_per_person() from public, anon;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) Truck columns present, correct types, nullable:
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'trucks'
--        and column_name in ('vehicle_registration', 'registration_expiry');
--    Expect 2 rows: text/YES and date/YES.
--
-- 2) The mapping, and that it is TRUCK-ONLY:
--      select key, linked_driver_field, linked_staff_field, linked_truck_field
--      from public.archive_document_types order by key;
--    Expect registration -> null / null / 'vehicle_registration',
--           iqama        -> iqama_number / iqama_number / null,
--           license      -> license_number / null / null,
--           everything else all null.
--
-- 3) The function has the truck branch and is still hardened:
--      select p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can,
--             pg_get_functiondef(p.oid) like '%v_linked_truck%' as has_truck_branch
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'archive_linked_one_per_person';
--    Expect: false, {search_path=public}, false, true.
--
-- 4) The trigger was NOT disturbed (it still points at the same function, now
--    with a new body underneath it) — and 0087's guard is still beside it:
--      select tgname from pg_trigger
--      where tgrelid = 'public.archive_documents'::regclass and not tgisinternal;
--    Expect archive_document_subject_guard_trg AND
--           archive_linked_one_per_person_trg.
--
-- 5) IT BITES — each in its own transaction, rolled back. Needs a truck-tab
--    group typed 'registration' (create one in the app, or inline here):
--    a) a SECOND registration document for the same truck -> must raise 23505
--    b) the FIRST one for that truck -> must SUCCEED
--    c) a NON-linked truck group still accepts TWO documents for one truck
--    d) REGRESSION — driver and staff one-per-person still bite exactly as
--       before (the branches were not meant to change; prove they did not)
