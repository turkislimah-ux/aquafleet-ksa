-- 0144_reconcile_operations_by_driver_metric.sql
--
-- Make the REPO agree with the DATABASE about the Operations metrics dictionary.
-- Turki's decision (2026-08-21): KEEP the live shape — the driver cut of the
-- Operations metric gets its OWN dictionary key, `operations_by_driver`.
--
-- ===========================================================================
-- STOP -- DO NOT RUN THIS FILE AGAINST LIVE. (Added 2026-08-21, after 0145.)
-- ===========================================================================
-- Everything below was written BEFORE 0145 was applied, and the "no-op" claim
-- it makes was true then. IT IS NOT TRUE NOW.
--
-- 0145 put a 569-char caveat on the `operations` row. Step 2 of this file sets
-- `caveat = null`. Live already matches this file on grain, source_view and the
-- operations_by_driver upsert -- so running it today changes exactly ONE column:
-- it deletes 0145's warning and the glossary silently renders nothing again.
--
-- AND IT WILL TELL YOU IT SUCCEEDED. Assertion (2) below checks `caveat is null`
-- because that is 0098's shape, which is what this file restores. After the wipe
-- that assertion PASSES and the transaction COMMITS.
--
-- The file is still correct where it matters: on a REBUILD it runs 0144 -> 0145
-- and the end state is 0145's text. Order is the safety property. Applying it by
-- hand today runs 0145 -> 0144, reversed, and the last writer wins.
--
-- Turki's decision 2026-08-21: LEAVE IT UNAPPLIED. It needs no ledger row to do
-- its job. If it ever must go in, run 0145 again IMMEDIATELY after it.
-- ===========================================================================
--
-- THIS MIGRATION IS A NO-OP AGAINST PRODUCTION TODAY. That is not an argument
-- against writing it — it is the whole reason it exists. Same shape as 0140:
-- MIGRATION HISTORY ON DISK IS THE RESET PATH. Replaying from scratch today
-- produces a database that does NOT match live, and this file is what closes
-- that gap. Nothing here changes the current database; everything here changes
-- what a rebuild produces.
--
-- ===========================================================================
-- WHAT DIVERGED, AND WHICH SIDE IS WHICH
-- ===========================================================================
-- Two migrations named 0101 exist and they disagree:
--
--   * ON DISK, 0101_operations_by_driver.sql runs
--       update report_metrics set grain=..., source_view=..., caveat=...
--        where metric_key = 'operations'
--     amending the SINGLE existing key to cover both grains. Its header argues
--     the case from 0100's precedent: a finer cut of one metric does not earn
--     a second key.
--
--   * IN THE LEDGER ONLY, 0101_operations_by_driver_reapply INSERTS a second
--     key, 'operations_by_driver'. It was applied through MCP and never
--     committed as a file. Its own header calls itself "identical to the
--     reviewed+verified file". It is not identical; on this exact point it is
--     the opposite.
--
-- LIVE FOLLOWS THE REAPPLY, and the proof is unusually clean: the live
-- `operations` row matches 0098_reports_semantic_layer.sql FIELD FOR FIELD --
-- label, meaning, formula, unit, grain, source_view, basis, and a NULL caveat.
-- It is 0098's row, untouched. Disk 0101's UPDATE never ran at all.
--
-- Verified before drafting, on the live DB:
--   * report_metrics.metric_key is the PRIMARY KEY, so `on conflict
--     (metric_key)` below is a valid inference target.
--   * basis 'operational' and unit 'count' both satisfy the table's CHECKs.
--   * Exactly TWO files on disk write the 'operations' key: 0098 (the original
--     insert) and 0101 (the amendment). ZERO files insert 'operations_by_driver'
--     -- which is precisely why live cannot currently be rebuilt from the repo.
--   * v_operations_by_driver_monthly itself is NOT divergent: live
--     pg_get_viewdef matches disk 0101 exactly. Only the dictionary rows drifted.
--     This migration therefore touches NO view and NO view definition.
--
-- ===========================================================================
-- WHY KEEPING THE SECOND KEY MAKES 0101'S AMENDMENT REDUNDANT
-- ===========================================================================
-- 0101 amended `operations` because, with no second key, the single entry had
-- to describe both grains at once. Once the driver grain owns a key, that is no
-- longer true: `operations` describes the period grain and `operations_by_driver`
-- describes the driver grain. The live shape is internally consistent, and the
-- amendment is not merely unapplied but unnecessary. So this file restores
-- 0098's values rather than inventing new ones.
--
-- ===========================================================================
-- ONE THING THIS FILE DELIBERATELY DOES NOT CARRY OVER -- READ BEFORE APPLYING
-- ===========================================================================
-- Disk 0101's caveat text has TWO halves. The driver half is already covered,
-- almost verbatim, by the caveat on 'operations_by_driver' below. The PERIOD
-- half is not covered anywhere:
--
--   "Trips, work orders, outsourced jobs and permits are event counts and add
--    across months. Trucks active does NOT - it is a distinct count, so a
--    multi-month period reports the highest single month rather than a sum."
--
-- That is a real warning about the `operations` metric itself, and LIVE HAS NO
-- CAVEAT ON `operations` AT ALL (it is null, per 0098). Setting caveat = null
-- below is faithful convergence on live -- it is NOT an endorsement of the gap.
--
-- It is left out on purpose, because adding it would be a CONTENT change riding
-- inside a RECONCILIATION migration, and §5 is one logical unit per change.
-- **OPEN, and Turki's call: whether a follow-up migration should put the
-- non-additivity warning back on `operations`.** Nothing is broken without it;
-- a reader summing "trucks active" across a multi-month period gets a wrong
-- number with nothing on screen to warn them.
--
-- This whole file is one transaction. A failed assertion at the foot rolls back
-- both writes together.
-- ===========================================================================
begin;

-- ===========================================================================
-- 1. The key the decision keeps.
--
-- Values are lifted verbatim from the live row (read back with quote_literal so
-- the escaping is the database's, not mine). Against production this UPDATE
-- writes the identical bytes it reads; on a replay it is the only thing that
-- creates the key at all.
--
-- `on conflict ... do update` rather than `do nothing`: if a future hand-edit
-- drifts this row, replaying should CORRECT it, not silently accept it.
-- ===========================================================================
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat)
values
  ('operations_by_driver',
   'Delivery performance by driver',
   'Each driver''s trip workload and delivery completion in the month; the truck they drove is shown for context only.',
   'Trips grouped by driver and month: scheduled = all trips, delivered = stage delivered, completion rate = delivered / scheduled x 100 from that driver''s own totals.',
   'count',
   'one driver in one month',
   'v_operations_by_driver_monthly',
   'operational',
   'The driver is the measured unit; the truck (primary_plate) is display-only context, and trucks_used flags when a driver drove more than one. Trips with no driver fall into an Unassigned bucket in the UI so the columns still foot to the period total. Completion rate is per driver from own totals, never averaged across drivers.')
on conflict (metric_key) do update set
  label       = excluded.label,
  meaning     = excluded.meaning,
  formula     = excluded.formula,
  unit        = excluded.unit,
  grain       = excluded.grain,
  source_view = excluded.source_view,
  basis       = excluded.basis,
  caveat      = excluded.caveat;

-- ===========================================================================
-- 2. Undo 0101's amendment of the period-grain key.
--
-- NO-OP TODAY (live already holds exactly these values, unchanged since 0098).
-- On a replay this runs AFTER 0101 and puts the row back, which is the entire
-- point: without it, a rebuilt database describes the driver grain twice --
-- once on this row and once on the key inserted above.
--
-- Only the three fields 0101 touches are restored. label / meaning / formula /
-- unit / basis are left alone because 0101 never touched them and 0098 already
-- sets them to the live values.
-- ===========================================================================
update public.report_metrics
   set grain       = 'one month',
       source_view = 'v_operations_monthly',
       caveat      = null
 where metric_key = 'operations';

-- ===========================================================================
-- 3. AFTER APPLYING -- assert the end state. Any failure rolls back BOTH writes.
--
-- Note what is NOT asserted: the total row count in report_metrics. It is 30
-- today, but a replay reaches this file with whatever later migrations have
-- added, and pinning an absolute would make this file fail for reasons that
-- have nothing to do with it. The invariant is the SHAPE of these two rows.
-- ===========================================================================
do $$
declare
  v_driver_key   int;
  v_ops_restored int;
  v_view_exists  int;
  v_invoker      boolean;
  v_anon_read    boolean;
begin
  -- (1) the kept key exists, exactly once, pointing at the driver view
  select count(*) into v_driver_key
    from public.report_metrics
   where metric_key   = 'operations_by_driver'
     and source_view  = 'v_operations_by_driver_monthly'
     and grain        = 'one driver in one month';

  if v_driver_key <> 1 then
    raise exception
      'operations_by_driver should be present exactly once with its own grain and source_view, found %. Keeping this key IS the decision 0144 records.',
      v_driver_key;
  end if;

  -- (2) the period key is back to 0098's shape -- all three fields 0101 moves
  select count(*) into v_ops_restored
    from public.report_metrics
   where metric_key  = 'operations'
     and grain       = 'one month'
     and source_view = 'v_operations_monthly'
     and caveat is null;

  if v_ops_restored <> 1 then
    raise exception
      'The operations row is not in its 0098 shape after 0144 (matched % rows). On a replay this means 0101 amended it and this file did not put it back, so the driver grain is now described twice.',
      v_ops_restored;
  end if;

  -- (3) the view the kept key PROMISES actually exists. A dictionary entry
  --     naming a view that is not there is a glossary that lies.
  select count(*) into v_view_exists
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'v_operations_by_driver_monthly'
     and c.relkind = 'v';

  if v_view_exists <> 1 then
    raise exception
      'report_metrics now names v_operations_by_driver_monthly but that view does not exist. On a replay this means 0144 ran before 0101.';
  end if;

  -- (4) and it is still readable the way the glossary reader reads it. 0103
  --     proved a bare `create or replace view` drops security_invoker silently
  --     and nobody notices for 26 seconds or forever. Cheap to check here.
  select coalesce((select option_value::boolean
                     from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), false),
         has_table_privilege('anon', c.oid, 'select')
    into v_invoker, v_anon_read
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'v_operations_by_driver_monthly';

  if v_invoker is not true then
    raise exception
      'v_operations_by_driver_monthly has lost security_invoker. It reads trips, drivers and trucks, all RLS-enabled, so an owner-run view bypasses their policies. See §6.';
  end if;

  if v_anon_read is not false then
    raise exception
      'anon can SELECT v_operations_by_driver_monthly. Every view in this database is revoked from anon - see §6.';
  end if;
end;
$$;

commit;

-- ===========================================================================
-- REHEARSAL / VERIFICATION (run separately -- do NOT paste into the file above).
--
-- Against production this file should change NOTHING. Prove it rather than
-- assume it: capture the two rows first, apply, then diff.
--
--   -- before
--   select metric_key, grain, source_view, caveat
--     from public.report_metrics
--    where metric_key in ('operations','operations_by_driver')
--    order by metric_key;
--
--   -- after applying, the same query must return identical rows, and:
--   select count(*) from public.report_metrics;          -- still 30
--
--   -- the glossary still resolves every key it shows to a real view:
--   select m.metric_key, m.source_view
--     from public.report_metrics m
--    where m.source_view not like '%,%'
--      and to_regclass('public.' || m.source_view) is null;
--   -- expect zero rows. (Keys whose source_view names TWO views are skipped
--   --  by the like -- 0098 stores a couple that way.)
-- ===========================================================================
