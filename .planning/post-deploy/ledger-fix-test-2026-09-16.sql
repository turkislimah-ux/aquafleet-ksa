-- ===========================================================================
-- LEDGER FIX — TEST PROJECT (vlyxazfinmlanjdttavg) — 2026-09-16
-- DRAFTED, NOT APPLIED. Run in the Supabase SQL Editor against TEST ONLY.
-- ===========================================================================
--
-- READ THE GUARD BEFORE YOU PASTE THIS ANYWHERE.
-- The first statement aborts unless the current database is the test project.
-- It keys on a fact only test has: its ledger holds 197 rows numbered 0001..0199.
-- Prod holds 133 timestamp rows, so this script cannot run there by accident.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ASKED, AND WHAT MEASURING FOUND INSTEAD
-- ---------------------------------------------------------------------------
-- The brief said "stamp 0195-0200 correctly". Measured against the repo on
-- 2026-09-16, that is more than is needed:
--
--   test ledger rows      197
--   repo migration files  198
--   name drift            0 of 197   <- every stamped row already matches its file
--   orphan ledger rows    0
--   missing               1          <- 0200_exit_permit_write_offs, and only that
--
-- 0195, 0196, 0197, 0198 and 0199 are already stamped with the correct version
-- AND the correct name. Restamping them would be a no-op dressed as a fix, so
-- this script does not do it. It stamps 0200 and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY 0200 IS MISSING, AND WHY STAMPING IT IS HONEST
-- ---------------------------------------------------------------------------
-- In the Phase-1 replay, 197 of 198 files applied unattended. 0200 exited 1:
--
--   ERROR: No exited returnable permit with outstanding lines — nothing to
--          verify against. (SQLSTATE P0001) At statement: 65
--
-- That error comes from 0200's VERIFY block, not its DDL. The file commits its
-- DDL at line 1715 and only then opens a second transaction for verification,
-- so the DDL landed and survived: exit_permit_write_offs and
-- exit_permit_write_off_lines both exist on test, and the Phase-1 byte-diff
-- found the whole catalog identical to prod. The file IS applied. The ledger
-- row is therefore a true statement, and its absence is the lie.
--
-- THE CAVEAT, STATED RATHER THAN BURIED: stamping 0200 records that the DDL
-- applied. It does NOT record that 0200's eleven behavioural claims were proved
-- on test — they were not, because test carries no exit-permit data to prove
-- them against. That is a data gap, not a schema gap, and Phase 1 was a schema
-- proof. Do not read this row as a money-logic pass.
--
-- ---------------------------------------------------------------------------
-- WHY created_by IS LEFT NULL HERE WHEN PROD USES AN EMAIL
-- ---------------------------------------------------------------------------
-- All 197 existing test rows carry created_by = NULL, because test was built by
-- a direct replay rather than by the CLI acting as a signed-in user. The new row
-- matches its neighbours. Copying prod's 'turkislimah@gmail.com' onto a database
-- that user never touched would make the ledger say something untrue in order to
-- look tidy. Test's ledger should describe how test was built.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- GUARD — refuse to run anywhere that is not the test project.
-- ---------------------------------------------------------------------------
do $guard$
declare n int; bad int;
begin
  select count(*) into n from supabase_migrations.schema_migrations;
  select count(*) into bad from supabase_migrations.schema_migrations
   where version !~ '^[0-9]{4}$';
  if bad > 0 then
    raise exception
      'WRONG DATABASE. % row(s) here use timestamp versions, which is prod''s shape. This script is for the TEST project only. ABORTING.', bad;
  end if;
  if n <> 197 then
    raise exception
      'WRONG DATABASE OR ALREADY FIXED. Expected the 197-row test ledger, found % rows. ABORTING.', n;
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '0200') then
    raise exception '0200 is already stamped. Nothing to do.';
  end if;
  raise notice 'GUARD PASSED — test project, 197 rows, 0200 absent.';
end $guard$;

-- ---------------------------------------------------------------------------
-- THE STAMP. One row. Same column shape as its 197 neighbours.
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations
  (version, name, statements, created_by, idempotency_key, rollback)
values (
  '0200',
  'exit_permit_write_offs',
  array[
    '-- Stamped 2026-09-16 during the Phase-2 ledger reconcile.'                  || chr(10) ||
    '-- 0200''s DDL applied cleanly in the Phase-1 replay and is byte-identical'  || chr(10) ||
    '-- to prod. The replay exited 1 only because 0200''s verify block raises on' || chr(10) ||
    '-- success by design, and raises first when there is no subject data to'     || chr(10) ||
    '-- verify against. See supabase/migrations/0200_exit_permit_write_offs.sql'  || chr(10) ||
    '-- and .planning/post-deploy/0200-verify-noraise.patch.'
  ],
  null,
  null,
  null
);

-- ---------------------------------------------------------------------------
-- VERIFICATION — RAISES ON ANY FAILURE.
-- To see it fail on purpose: change '0200' above to '0201' and re-run.
-- ---------------------------------------------------------------------------
do $verify$
declare n int; bad text;
begin
  select count(*) into n from supabase_migrations.schema_migrations;
  if n <> 198 then
    raise exception 'FAIL: ledger holds % rows, expected 198.', n;
  end if;

  select count(*) into n
    from (select version from supabase_migrations.schema_migrations
           group by version having count(*) > 1) d;
  if n <> 0 then raise exception 'FAIL: % duplicate version(s).', n; end if;

  select string_agg(version, ', ' order by version) into bad
    from supabase_migrations.schema_migrations where version !~ '^[0-9]{4}$';
  if bad is not null then raise exception 'FAIL: non-filename version(s): %', bad; end if;

  -- 0001..0200 present, 0135/0136 absent — the repo's exact shape.
  select string_agg(g::text, ', ' order by g) into bad
    from generate_series(1, 200) g
   where g not in (135, 136)
     and not exists (select 1 from supabase_migrations.schema_migrations m
                      where m.version = lpad(g::text, 4, '0'));
  if bad is not null then raise exception 'FAIL: expected version(s) absent: %', bad; end if;

  if exists (select 1 from supabase_migrations.schema_migrations
              where version in ('0135', '0136')) then
    raise exception 'FAIL: 0135/0136 are repo gaps and must not appear.';
  end if;

  select name into bad from supabase_migrations.schema_migrations where version = '0200';
  if bad <> 'exit_permit_write_offs' then
    raise exception 'FAIL: 0200 stamped under the name %, expected exit_permit_write_offs.', bad;
  end if;

  raise notice 'TEST LEDGER VERIFIED — 198 rows, 0001..0200 with 0135/0136 absent, no duplicates, no timestamp versions. Test is now a faithful rebuild target with an honest ledger.';
end $verify$;

commit;


-- ===========================================================================
-- AFTER — read-only.
-- ===========================================================================
-- select count(*) as rows, min(version) as first, max(version) as last
--   from supabase_migrations.schema_migrations;
--
-- select version, name from supabase_migrations.schema_migrations
--  where version >= '0195' order by version;
--
-- ---------------------------------------------------------------------------
-- UNDO, if ever needed. One row, so no snapshot table is warranted.
-- ---------------------------------------------------------------------------
-- delete from supabase_migrations.schema_migrations where version = '0200';
