-- 0173_trips_ref_unique_per_project.sql
--
-- Index only. No DDL on columns, no function/view replacement, no new table,
-- so none of CLAUDE.md §6's re-grant footers apply: an index inherits the
-- table's RLS and privileges and has none of its own. Nothing to revoke.
--
-- NO begin;/commit; WRAPPER — DELIBERATE, AND THE REASON v1 SILENTLY DID NOTHING
-- -----------------------------------------------------------------------------
-- The first draft of this file wrapped its statements in begin;/commit;. The
-- Supabase SQL Editor already submits in its own transaction, so that opened a
-- NESTED one — Postgres answers `WARNING: there is already a transaction in
-- progress` and ignores it, and the later `commit;` then ends the EDITOR's
-- transaction rather than a block of its own. The run reported success, three
-- result grids printed, and no index was created. Verified afterwards against
-- the live catalog: trips still had its original 8 indexes and
-- `trips_project_ref_unique` did not exist (42P01).
--
-- So: BARE STATEMENTS ONLY. Do not add a transaction wrapper back. The editor's
-- own transaction is what makes this atomic, and it is enough.
--
-- READING THE OUTPUT — the ordering below is the point:
--   The CREATE runs FIRST, the verification reads the catalog AFTER it. A
--   select that runs before the create can only ever describe the old world, so
--   it can print a passing row while the create goes on to fail. That is exactly
--   the false green that hid v1's failure, and the order here removes it.
--
--   The editor runs the submission as one implicit transaction, so a duplicate
--   raises 23505 on the CREATE and ABORTS the batch — statement 3 never runs and
--   NO final grid appears. Treat a missing final grid as a FAILURE, not a quiet
--   pass. That abort is the correct loud behaviour and is kept on purpose.
--
--   Statement 3 always returns exactly one row whether or not the index exists
--   (it counts over a join rather than casting to regclass), so a survived
--   failure reads as `index_present 0 / is_valid false`, never as an empty
--   result that could be mistaken for "nothing to report".
--
-- WHY
-- ---
-- public.trips.ref is assigned by the trips_set_ref BEFORE INSERT trigger, which
-- takes its sequence from next_trip_ref_number(project_id, year) for a project
-- trip and from the trips_ref_seq fallback for a bare-customer trip. Nothing in
-- the schema enforces that the result is actually unique — the counter is the
-- only thing standing between two rows and the same ref. This index is the
-- backstop for the gap-filling work: once a ref can be chosen rather than only
-- appended, a collision stops being hypothetical, and it must fail at the
-- database rather than silently produce two trips answering to one ref.
--
-- SCOPE — (project_id, ref), not ref alone. Each project numbers its own trips
-- from its own initials, so the pair is the real identity. ref happens to be
-- globally unique across all 850 live rows today, but that is a property of the
-- current data, not a rule anyone has stated, and a narrower index than the rule
-- would over-constrain.
--
-- NULLS NOT DISTINCT — DELIBERATE, and stricter than the default.
--   Postgres treats NULLs as distinct in a unique index by default, so a plain
--   CREATE UNIQUE INDEX would let unlimited rows share (NULL, 'WT-2026-0177').
--   project_id IS nullable and one live row is already NULL (WT-2026-0177, a
--   delivered bare-customer trip) — and trips_set_ref's else-branch exists
--   precisely to serve that case, so the hole sits exactly where the fallback
--   sequence writes. NULLS NOT DISTINCT closes it. Requires PG15+; the target
--   is PostgreSQL 17.6, verified.
--
--   This is NOT a workaround to force the index through — it is the opposite,
--   a STRICTER predicate. Verified beforehand that the data is clean under these
--   exact semantics (grouping by (project_id, ref), which compares NULLs as
--   equal, returns 0 duplicate groups), so it validates on its own merits.
--
-- NOT CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block, and the editor wraps the submission in one. A plain CREATE UNIQUE INDEX
-- takes an ACCESS EXCLUSIVE lock on trips for the duration, which at 850 rows is
-- milliseconds.
--
-- No ON CONFLICT, no WHERE, no partial predicate, nothing that would let a
-- duplicate slip past. If the CREATE fails with 23505, a real duplicate exists
-- and it needs to be seen, not routed around.
--
-- MEASURED AGAINST THE LIVE DB IMMEDIATELY BEFORE DRAFTING:
--   850 trips · 0 with ref IS NULL · 1 with project_id IS NULL
--   850 distinct (project_id, ref) pairs = 850 rows
--   0 duplicate (project_id, ref) groups, NULLs-as-equal
--   8 indexes on trips, 1 unique (trips_pkey) — no unique index on the pair
--
-- Idempotent: IF NOT EXISTS, so a re-run is a no-op.


-- 1. PRE-FLIGHT (diagnostic, runs before the create by necessity).
--    Expect: null_ref 0, duplicate_groups 0, index_already_present 0.
--    duplicate_groups > 0 means the CREATE below WILL fail with 23505 — read
--    this grid before the others. This statement proves nothing about the
--    create; statement 3 is what does that.
select
  (select count(*) from public.trips where ref is null)          as null_ref,
  (select count(*)
     from (
       select project_id, ref
       from public.trips
       group by project_id, ref
       having count(*) > 1
     ) d)                                                        as duplicate_groups,
  (select count(*)
     from pg_indexes
     where schemaname = 'public'
       and tablename  = 'trips'
       and indexname  = 'trips_project_ref_unique')              as index_already_present;


-- 2. THE CHANGE.
create unique index if not exists trips_project_ref_unique
  on public.trips (project_id, ref)
  nulls not distinct;


-- 3. POST-FLIGHT — reads the REAL catalog, AFTER the create.
--    Required reading, all in one row:
--      index_present      1
--      is_valid           true
--      is_unique          true
--      nulls_not_distinct true
--      trips_covered      850   (every row; a partial index would not be)
--      indexdef           CREATE UNIQUE INDEX trips_project_ref_unique ...
--    Anything else — above all `index_present 0` — means the index was NOT
--    created and 0173 has NOT been applied, whatever the earlier grids said.
select
  count(*)                                                             as index_present,
  coalesce(bool_or(i.indisvalid), false)                               as is_valid,
  coalesce(bool_or(i.indisunique), false)                              as is_unique,
  coalesce(bool_or(i.indnullsnotdistinct), false)                      as nulls_not_distinct,
  coalesce(bool_or(i.indisready), false)                               as is_ready,
  (select count(*) from public.trips)                                  as trips_covered,
  coalesce(max(pg_get_indexdef(i.indexrelid)), '(index absent)')       as indexdef
from pg_index i
join pg_class     c on c.oid = i.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'trips_project_ref_unique';
