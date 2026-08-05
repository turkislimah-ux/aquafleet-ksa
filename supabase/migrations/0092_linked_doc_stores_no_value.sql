-- 0092_linked_doc_stores_no_value.sql
-- Archive — the DATABASE now refuses a linked document that carries its own
-- number or expiry.
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
-- 0089/0091 established the rule: for a LINKED (type + subject) combination
-- the number and its expiry live only on the subject's own record — driver,
-- staff member or truck — and the archive document stores NEITHER.
--
-- Until now that rule was enforced only by the app. This migration moves it
-- into the database: archive_linked_one_per_person() gains a v_is_linked
-- computation and a refuse-if-number-or-expiry block, raising 23514 if a
-- linked document arrives carrying either.
--
-- A raise, not a silent NULLing, for the same reason the app already chose:
-- quietly discarding a value someone typed is how "I entered it and it
-- vanished" bugs happen. The app never sends them, so this only fires on a
-- genuine mistake — or on a code path that was about to create a second copy
-- of a fact that is supposed to exist once.
--
-- ===========================================================================
-- RECONCILED TO LIVE — applied and bite-tested by the architect
-- ===========================================================================
-- The body below is the live definition, verbatim. The one-per-person
-- branches are BYTE-IDENTICAL to 0091's; only the v_is_linked declaration,
-- its computation, and the refusal block above them are new. Nothing that was
-- already working was reworded, so nothing already verified needed
-- re-verifying.
--
-- Note the function keeps its 0091 name despite now doing two jobs and
-- despite trucks not being people. Renaming means dropping and recreating the
-- dependent trigger — real churn and a real window where NOTHING is enforced,
-- to fix a wart. If it is ever worth doing it should be its own migration.
--
-- ===========================================================================
-- SECURITY (0083) — unchanged posture
-- ===========================================================================
-- SECURITY INVOKER (the default — Postgres omits the keyword; its absence IS
-- invoker, not an oversight), `set search_path to 'public'` pinned. INVOKER
-- stays correct: the function reads archive_document_groups,
-- archive_document_types and archive_documents, all already readable by the
-- caller under their authenticated-only policies.
--
-- `create or replace function` PRESERVES existing privileges, but the revoke
-- is re-issued so this file states the end state outright rather than
-- depending on history. NO counter-grant to authenticated — matching 0087,
-- 0089 and 0091. A trigger function's EXECUTE is checked at CREATE TRIGGER
-- time, not at fire time, so the trigger keeps firing for every caller while
-- nobody can call the function directly.
--
-- THE TRIGGER IS NOT RECREATED. archive_linked_one_per_person_trg already
-- points at this function by name, and `create or replace` swaps the body
-- underneath it. Touching the trigger would be pure risk for no gain.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - One function body replaced. No table, column, policy, index or row of
--    data is touched.
--  - 0087's subject guard is NOT touched.
--  - Fully re-runnable: `create or replace function` and a revoke, no DDL
--    that can collide on a second run.
--
-- ===========================================================================
-- APP CHANGE THAT SHIPS WITH THIS
-- ===========================================================================
-- The renew path had to change, and it is worth stating because the breakage
-- was not obvious: renewArchiveDocument() writes reference_no and expiry_date
-- onto the parent document. For a LINKED document that write is now REFUSED
-- by this guard, so renew would have failed outright.
--
-- It now writes the new values to the SUBJECT and passes NULL to the parent,
-- and — the part that would otherwise be quietly lost — the renewal SNAPSHOT
-- captures the subject's OUTGOING number and expiry, read server-side at
-- renew time. archive_document_renewals is history, not current state, so
-- this guard does not apply to it, and without that capture a linked
-- document's history would record blanks and the previous number would be
-- gone for good.

begin;

CREATE OR REPLACE FUNCTION public.archive_linked_one_per_person()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_type text; v_linked_driver text; v_linked_staff text; v_linked_truck text; v_is_linked boolean;
begin
  select g.type_key into v_type from public.archive_document_groups g where g.id = new.group_id;
  if v_type is null then return new; end if;
  select linked_driver_field, linked_staff_field, linked_truck_field
    into v_linked_driver, v_linked_staff, v_linked_truck
    from public.archive_document_types where key = v_type;
  v_is_linked := (new.driver_id is not null and v_linked_driver is not null)
              or (new.staff_id  is not null and v_linked_staff  is not null)
              or (new.truck_id  is not null and v_linked_truck  is not null);
  if v_is_linked then
    if new.reference_no is not null then
      raise exception 'A linked "%" document must not store its own number — it lives on the subject''s record.', v_type using errcode = '23514';
    end if;
    if new.expiry_date is not null then
      raise exception 'A linked "%" document must not store its own expiry — it lives on the subject''s record.', v_type using errcode = '23514';
    end if;
  end if;
  if new.driver_id is not null and v_linked_driver is not null then
    if exists (select 1 from public.archive_documents d where d.group_id = new.group_id and d.driver_id = new.driver_id and d.id <> new.id) then
      raise exception 'This driver already has a "%" document in this group (linked types allow one per person; renew instead).', v_type using errcode = '23505';
    end if;
  end if;
  if new.staff_id is not null and v_linked_staff is not null then
    if exists (select 1 from public.archive_documents d where d.group_id = new.group_id and d.staff_id = new.staff_id and d.id <> new.id) then
      raise exception 'This staff member already has a "%" document in this group (linked types allow one per person; renew instead).', v_type using errcode = '23505';
    end if;
  end if;
  if new.truck_id is not null and v_linked_truck is not null then
    if exists (select 1 from public.archive_documents d where d.group_id = new.group_id and d.truck_id = new.truck_id and d.id <> new.id) then
      raise exception 'This truck already has a "%" document in this group (linked types allow one per truck; renew instead).', v_type using errcode = '23505';
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
-- 1) The new block is present and the function is still hardened:
--      select p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon', p.oid, 'execute') as anon_can,
--             pg_get_functiondef(p.oid) like '%v_is_linked%' as has_value_guard
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'archive_linked_one_per_person';
--    Expect: false, {search_path=public}, false, true.
--
-- 2) Both triggers still attached, and 0087's guard untouched beside it:
--      select tgname from pg_trigger
--      where tgrelid = 'public.archive_documents'::regclass and not tgisinternal;
--    Expect archive_document_subject_guard_trg AND
--           archive_linked_one_per_person_trg.
--
-- 3) IT BITES — each in its own transaction, rolled back:
--    a) linked document carrying a reference_no        -> must raise 23514
--    b) linked document carrying an expiry_date        -> must raise 23514
--    c) linked document carrying NEITHER               -> must SUCCEED
--    d) a SECOND linked document for the same subject  -> must raise 23505
--       (proves the one-per-person branches still bite after the rewrite)
--    e) a NON-linked document WITH its own reference_no and expiry_date
--       -> must SUCCEED (the guard must not have leaked onto unlinked types)
--
-- 4) RENEW still works end to end, which is what the app change is for:
--    renew a linked document in the UI, then confirm
--      - the subject's own number/expiry now hold the NEW values,
--      - archive_documents.reference_no / expiry_date for that row are NULL,
--      - the newest archive_document_renewals row for it holds the OUTGOING
--        number and expiry (not blanks).
