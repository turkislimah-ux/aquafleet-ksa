-- 0086_archive_group_subject_kind.sql
-- Archive Phase 2 (Staff tab) — the ONE schema gap.
--
-- ===========================================================================
-- THE PROBLEM
-- ===========================================================================
-- The Staff tab holds two different populations: DRIVERS (drivers table) and
-- MANAGEMENT STAFF (staff table). A group like "Driving Licence" belongs to
-- drivers; "Employment Contract" may belong to management staff. Today a
-- group knows only its `tab` ('staff'), which is not enough.
--
-- It cannot be inferred from the group's documents, and that is the whole
-- point of this phase: a NEWLY CREATED group has zero documents, and the
-- Staff tab's core feature is that every person appears as a row whether or
-- not they have a document. An empty "Work Permit" group must still render
-- the full driver list. With nothing to infer from, an empty group would
-- render an empty table — the exact opposite of "the gaps are the finding".
--
-- So the population is an attribute of the GROUP, declared when it is
-- created. This migration adds it.
--
-- ===========================================================================
-- DESIGN DECISION — subject_kind on the group (not a boolean, not a new table)
-- ===========================================================================
-- Shapes considered:
--
--   (a) a boolean `is_driver_group` — rejected: it answers only the Staff
--       tab's question, and answers it in a form that can't grow. The Truck
--       and Customer tabs would each need their own flag, and "which
--       population" would end up spread across three booleans that can
--       contradict each other.
--
--   (b) a separate archive_group_audiences table — rejected: a join table
--       for what is exactly one value per group. It also permits states the
--       model has no meaning for (a group with two audiences, or none).
--
--   (c) ONE `subject_kind` column naming the population, constrained to
--       agree with `tab` — CHOSEN.
--
-- (c) uses the vocabulary archive_documents already speaks. That table's
-- CHECK is literally named archive_documents_one_subject and its columns are
-- driver_id / staff_id / truck_id — the SUBJECT of a document. This column
-- says which of those a group's rows are keyed by. 'none' = a company
-- document with no subject, which is exactly Phase 1's existing behaviour.
--
-- The value set covers all four tabs now, so Phases 3+ need NO further
-- migration for this: the truck tab creates groups with subject_kind
-- 'truck', the customer tab with 'customer'.
--
-- ===========================================================================
-- OPEN DECISION FOR THE ARCHITECT — how strictly to enforce the subject match
-- ===========================================================================
-- This migration guarantees that a group's subject_kind AGREES WITH ITS TAB
-- (a plain table-level CHECK; single-row, so a CHECK can express it).
--
-- It does NOT guarantee that each DOCUMENT's subject matches its group's
-- subject_kind — e.g. that a document in a subject_kind='driver' group has
-- driver_id set rather than staff_id. That is a CROSS-ROW rule (document vs.
-- its parent group), which a CHECK constraint cannot express. Two options:
--
--   OPTION A (WRITTEN BELOW — recommended): app-enforced. The document form
--   is always opened FROM a specific row of a specific group's matrix, so
--   the group and the subject are both supplied by the UI, from the same
--   click. There is no free-text subject field and no path where a user
--   types a mismatched subject. This keeps the archive's established
--   "plain CRUD, no functions" shape (0084/0085), which also means nothing
--   new for the 0083 anon-hardening pass to re-cover.
--
--   OPTION B: add a BEFORE INSERT OR UPDATE trigger on archive_documents
--   that looks up the parent group and raises on a mismatch. Real belt-and-
--   braces, but it introduces the archive's FIRST function — which then has
--   to be SECURITY DEFINER + SET search_path = public + EXECUTE granted to
--   `authenticated` only, per 0083, and re-audited on every future pass.
--
-- I recommend A: the failure it defends against has no user-reachable path,
-- and B buys that coverage at the cost of reopening a surface (functions)
-- the archive has deliberately kept at zero. If you want B, say so and I
-- will write it as 0087 rather than fold it in here — the column and the
-- trigger are separable, and the column is what Phase 2 is blocked on.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE ONLY: one column + one CHECK on an existing table. No table is
--    created or dropped, no data is rewritten, no column is removed.
--  - NO NEW FOREIGN KEY, so the 0077 PostgREST hazard (a SECOND FK between
--    the SAME table pair breaking embed disambiguation) is not in play here
--    at all — this migration adds no FK of any kind.
--  - NO NEW FUNCTION, so there is nothing for the 0083 anon-hardening pass
--    to re-cover.
--  - RLS is untouched: the column lands on archive_document_groups, which
--    already carries its authenticated-only policy from 0084. Adding a
--    column does not alter a policy.
--  - Re-runnable: `add column if not exists` + the constraint added inside a
--    guarded DO block.
--
-- PRE-FLIGHT (please run before applying — I have no DB read access this
-- session, so this is stated as an assumption, not as something I verified):
--
--     select tab, count(*) from public.archive_document_groups group by tab;
--
-- Expected: 'company' only, since Phase 1 is all that has shipped. The new
-- column defaults to 'none', which satisfies the CHECK for company rows. If
-- any NON-company group already exists, the constraint below will refuse to
-- be added (loudly, which is correct) — tell me and I will add a backfill.

begin;

-- ---------------------------------------------------------------------------
-- 1) The column. Default 'none' = "no subject", which is precisely what every
--    existing (company) group is, so existing rows are already correct.
-- ---------------------------------------------------------------------------
alter table public.archive_document_groups
  add column if not exists subject_kind text not null default 'none';

comment on column public.archive_document_groups.subject_kind is
  'Which population this group''s rows are keyed by: none (company document, no subject) | driver | staff | truck | customer. Declared at group creation because an EMPTY group must still render its full subject list — it cannot be inferred from documents that do not exist yet. Must agree with tab (see archive_document_groups_subject_kind_matches_tab).';

-- ---------------------------------------------------------------------------
-- 2) Value domain + tab agreement, as ONE constraint.
--
--    Kept as a single constraint rather than two because the allowed values
--    are not independent of the tab — listing them separately would let a
--    reader think 'truck' is legal on the staff tab as long as it's in the
--    value list. The per-tab branches below ARE the value domain:
--
--      company  -> 'none'                 (no subject; Phase 1's behaviour)
--      staff    -> 'driver' | 'staff'     (the two populations of this phase)
--      truck    -> 'truck'
--      customer -> 'customer'
--
--    Note 'none' is legal ONLY on the company tab. A staff-tab group with no
--    declared population is exactly the broken state this migration exists
--    to prevent, so it is refused rather than defaulted.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'archive_document_groups_subject_kind_matches_tab'
      and conrelid = 'public.archive_document_groups'::regclass
  ) then
    alter table public.archive_document_groups
      add constraint archive_document_groups_subject_kind_matches_tab
      check (
        (tab = 'company'  and subject_kind = 'none')
        or (tab = 'staff'    and subject_kind in ('driver', 'staff'))
        or (tab = 'truck'    and subject_kind = 'truck')
        or (tab = 'customer' and subject_kind = 'customer')
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) No new index, deliberately.
--
--    archive_document_groups_tab_idx (tab, sort_order, created_at) from 0084
--    already serves every read this phase makes: the Staff tab fetches
--    `where tab = 'staff'` and splits the handful of returned rows by
--    subject_kind in memory. Group counts are in the tens — an index on a
--    5-value column here would be read overhead, not a win.
-- ---------------------------------------------------------------------------

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) Column present, correct default, NOT NULL:
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public'
--        and table_name = 'archive_document_groups'
--        and column_name = 'subject_kind';
--    Expect: text | NO | 'none'::text
--
-- 2) Constraint present:
--      select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--      where conrelid = 'public.archive_document_groups'::regclass
--        and conname = 'archive_document_groups_subject_kind_matches_tab';
--
-- 3) Existing rows still valid (should return 0):
--      select count(*) from public.archive_document_groups
--      where not (
--        (tab = 'company'  and subject_kind = 'none')
--        or (tab = 'staff'    and subject_kind in ('driver','staff'))
--        or (tab = 'truck'    and subject_kind = 'truck')
--        or (tab = 'customer' and subject_kind = 'customer')
--      );
--
-- 4) The constraint actually bites (should RAISE, then roll back):
--      begin;
--        insert into public.archive_document_groups (tab, title, subject_kind)
--        values ('staff', 'constraint probe', 'none');
--      rollback;
--
-- 5) RLS unchanged — anon still at zero on this table:
--      select polname, roles::text from pg_policies
--      where schemaname = 'public' and tablename = 'archive_document_groups';
--    Expect the single authenticated_all_archive_document_groups policy.
