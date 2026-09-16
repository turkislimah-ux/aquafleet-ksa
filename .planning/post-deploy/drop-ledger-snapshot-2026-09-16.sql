-- ===========================================================================
-- DROP THE PRE-REWRITE LEDGER SNAPSHOT — PROD — drafted 2026-09-16
-- DRAFTED, NOT APPLIED. Run in the Supabase SQL Editor, PROD.
--
-- THE DROP IS IRREVERSIBLE. It is now also FREE: STEP 0 has been run and its
-- output is committed, so the snapshot no longer holds anything unique.
-- ===========================================================================
--
-- WHAT THE SNAPSHOT HELD THAT NOTHING ELSE DID — NOW PRESERVED
-- ---------------------------------------------------------------------------
-- The rewrite carried 124 of the old 133 bodies forward into the new ledger
-- rows, so those are safe. Of the 9 rows it dropped, 2 were exact duplicate
-- re-applies whose twin survives (0063, 0064 — identical md5). The other SEVEN
-- were, until 580d42b, the only copy in existence. Measured 2026-09-16 against
-- prod live and against every tracked file in the repo:
--
--   version         name                                    chars  in live  in repo
--   20260804203631  0089_archive_group_type_and_linking      3456    no      580d42b
--   20260806020704  0097_consumption_approvals_matching_...  1628    no      580d42b
--   20260811000538  0103_dashboard_views_fix                 4456    no      580d42b
--   20260811000604  0103_restore_invoker_action_items         196    no      580d42b
--   20260818202229  0134b_fix_balance_guard_customer_join    3362    no      580d42b
--   20260823235411  revoke_anon_default_privileges            459    no      580d42b
--   20260910185821  reconcile_0193_trigger_fn_text           2454    no      580d42b
--                                                           ------
--                                                           15,811 characters
--
-- Why they were in no file: five were SQUASHED into later files during
-- development, so no file ever carried them. Two (0089, 0097) are the EARLIER
-- half of a same-day re-apply pair whose bodies genuinely differ from the later
-- one — the file matches the later body, so the earlier body was unrecorded.
--
-- All seven now live, byte-exact and md5-verified, in
--   .planning/post-deploy/ledger-orphan-bodies-2026-09-16.sql   (580d42b)
--
-- prod-ledger-backup-2026-09-16.sql remains the manifest for all 133 rows
-- (version, name, md5, length). It does NOT hold their SQL — a manifest proves
-- what was there, it cannot reconstruct it. The bodies file is what does that.
--
-- WHAT THE DROP STILL COSTS: the database-side undo. After STEP 2 there is no
-- table to restore the old ledger FROM, only the manifest and the bodies. The
-- rewrite is already verified on prod and test (198 rows, 1:1 with the files,
-- schema proved byte-identical against a clean from-files rebuild), so the undo
-- is protecting against nothing that is still open. STEP 1 refuses the drop
-- unless that is still true at the moment it runs.
-- ===========================================================================


-- ===========================================================================
-- STEP 0 — PRESERVE FIRST. ALREADY DONE (580d42b). Read-only, and kept here
-- because it is the proof, not just the method: re-run it and it must still
-- return the same seven bodies that
--   .planning/post-deploy/ledger-orphan-bodies-2026-09-16.sql
-- already holds. If it returns MORE than seven, something has changed since
-- 2026-09-16 and the new ones are not preserved — stop and preserve them
-- before going near STEP 2.
--
-- Generates the bodies as one text value, ON THE SERVER, by selecting snapshot
-- rows whose statements md5 appears nowhere in the live ledger.
-- ===========================================================================
select string_agg(
         format(E'-- ===================================================================\n'
                 '-- %s  %s\n'
                 '-- md5 %s   %s characters\n'
                 '-- Retired by the 2026-09-16 ledger reconcile. Recorded here because\n'
                 '-- this is the only surviving copy. NOT a migration: do not run it.\n'
                 '-- ===================================================================\n%s',
                s.version, s.name,
                md5(array_to_string(s.statements, chr(10))),
                length(array_to_string(s.statements, chr(10))),
                array_to_string(s.statements, chr(10))),
         E'\n\n\n' order by s.version)
  from supabase_migrations.schema_migrations_backup_20260916 s
 where not exists (
   select 1 from supabase_migrations.schema_migrations m
    where md5(array_to_string(m.statements, chr(10)))
        = md5(array_to_string(s.statements, chr(10))));


-- ===========================================================================
-- STEP 1 — THE GUARD. Refuses to drop the undo unless the thing it was
-- protecting actually succeeded. Read-only; raises.
-- ===========================================================================
do $guard$
declare
  v_live   int;
  v_bad    int;
  v_dup    int;
  v_snap   int;
  v_gap    text;
  v_absent text;
begin
  if to_regclass('supabase_migrations.schema_migrations_backup_20260916') is null then
    raise exception 'Snapshot is already gone. Nothing to drop.';
  end if;

  select count(*) into v_snap from supabase_migrations.schema_migrations_backup_20260916;
  if v_snap <> 133 then
    raise exception
      'Snapshot holds % rows, not the 133 it was taken with. This is not the table this script was written for. ABORTING.', v_snap;
  end if;

  select count(*) into v_live from supabase_migrations.schema_migrations;
  if v_live <> 198 then
    raise exception
      'Live ledger holds % rows, expected 198. The rewrite is not in the state that makes this undo disposable. ABORTING.', v_live;
  end if;

  select count(*) into v_bad from supabase_migrations.schema_migrations
   where version !~ '^[0-9]{4}$';
  if v_bad > 0 then
    raise exception 'Live ledger still has % timestamp-shaped version(s). ABORTING.', v_bad;
  end if;

  select count(*) into v_dup
    from (select version from supabase_migrations.schema_migrations
           group by version having count(*) > 1) d;
  if v_dup > 0 then
    raise exception 'Live ledger has % duplicate version(s). ABORTING.', v_dup;
  end if;

  select string_agg(g::text, ', ' order by g) into v_absent
    from generate_series(1, 200) g
   where g not in (135, 136)
     and not exists (select 1 from supabase_migrations.schema_migrations m
                      where m.version = lpad(g::text, 4, '0'));
  if v_absent is not null then
    raise exception 'Live ledger is missing expected version(s): %. ABORTING.', v_absent;
  end if;

  select string_agg(version, ', ') into v_gap from supabase_migrations.schema_migrations
   where version in ('0135', '0136');
  if v_gap is not null then
    raise exception 'Live ledger contains repo-gap version(s) %. ABORTING.', v_gap;
  end if;

  raise notice 'GUARD PASSED — live ledger is 198 rows, 0001..0200, gaps intact, no duplicates, no timestamp versions. The snapshot is genuinely redundant for everything except the seven bodies named in the header.';
end $guard$;


-- ===========================================================================
-- STEP 2 — THE DROP. Irreversible. STEP 0 is saved (580d42b) and STEP 1 must
-- have raised nothing. Run this ONLY in the Supabase SQL Editor against PROD.
-- ===========================================================================
drop table supabase_migrations.schema_migrations_backup_20260916;

do $after$
begin
  if to_regclass('supabase_migrations.schema_migrations_backup_20260916') is not null then
    raise exception 'Table still present after drop. Investigate.';
  end if;
  raise notice 'SNAPSHOT DROPPED. The 2026-09-16 ledger rewrite no longer has a database-side undo. prod-ledger-backup-2026-09-16.sql still records what the old ledger held (version, name, md5, length) for all 133 rows, and ledger-orphan-bodies-2026-09-16.sql holds the SQL of the seven bodies that lived only here.';
end $after$;


-- ===========================================================================
-- AFTER — read-only.
-- ===========================================================================
-- select to_regclass('supabase_migrations.schema_migrations_backup_20260916') as should_be_null,
--        count(*) as ledger_rows from supabase_migrations.schema_migrations;
