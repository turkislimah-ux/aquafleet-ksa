-- 0090_drop_duplicate_linking_design.sql
-- Cleanup after the linking rework was DOUBLE-APPLIED by two concurrent
-- sessions, which left two competing designs for the same rule in the DB.
--
-- The surviving design (0089) puts the linked mapping in COLUMNS ON
-- archive_document_types (linked_driver_field / linked_staff_field) and
-- enforces one-per-person with archive_linked_one_per_person_trg.
--
-- The duplicate design — dropped here — used a separate archive_linked_types
-- MAPPING TABLE plus its own archive_one_linked_doc_per_person trigger. Two
-- triggers enforcing the same rule from two different sources of truth is
-- strictly worse than either one alone: they can disagree, and a future
-- reader has no way to tell which one is authoritative.
--
-- Order matters and is deliberate: TRIGGER, then FUNCTION, then TABLE. A
-- function cannot be dropped while a trigger still references it, and the
-- table cannot go while the function that reads it is still there.
--
-- Every statement is IF EXISTS, so this is safe to run whether or not the
-- duplicate ever landed in a given environment — which is the whole point,
-- since the two sessions did not apply the same things.
--
-- Nothing else is touched: 0087's subject guard and 0089's own trigger both
-- stay exactly as they are.

drop trigger if exists archive_one_linked_doc_per_person_trg on public.archive_documents;
drop function if exists public.archive_one_linked_doc_per_person();
drop table if exists public.archive_linked_types;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) All three are gone:
--      select to_regclass('public.archive_linked_types')          as tbl,
--             to_regproc('public.archive_one_linked_doc_per_person') as fn;
--    Expect both NULL.
--
-- 2) The SURVIVORS are still there — this is the half that matters most,
--    since a cleanup that overshoots is worse than one that undershoots:
--      select tgname from pg_trigger
--      where tgrelid = 'public.archive_documents'::regclass and not tgisinternal;
--    Expect archive_document_subject_guard_trg AND
--           archive_linked_one_per_person_trg, both present.
