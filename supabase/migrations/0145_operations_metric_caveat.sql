-- 0145_operations_metric_caveat.sql
--
-- Put the non-additivity warning on the `operations` metric definition, so the
-- glossary popup says what the Operations statement already says inline.
--
-- ===========================================================================
-- THIS ONE IS A REAL WRITE. 0144 WAS NOT.
-- ===========================================================================
-- 0144 reconciled the repo to live and changed nothing in production. This file
-- is the opposite: it is a CONTENT change, and after it applies the live
-- `operations` row is different from what it has been since 0098. They are
-- separate files for exactly that reason (§5, one logical unit) — a
-- reconciliation and a content change must not ride together, or the "this is a
-- no-op, apply it whenever" property of 0144 stops being true.
--
-- ORDER MATTERS AND IS NOT ACCIDENTAL. 0144 sets `operations.caveat = null`
-- (restoring 0098's shape); 0145 then sets it to the text below. On a rebuild
-- they run 0144 → 0145 and the end state is this file's text. The two do NOT
-- contradict each other, though a reader skimming them might think so:
-- 0144's assertion that the caveat is null is true AT 0144's moment, which is
-- the only moment it claims anything about.
--
-- ===========================================================================
-- WHY THE WARNING IS WORTH ADDING, AND WHAT IT IS *NOT* FIXING
-- ===========================================================================
-- Traced read-only before drafting. The product is already correct — this fixes
-- a documentation gap, not a wrong number, and it should not be described as a
-- bug fix:
--
--   * Overview's "Trucks active" tile is single-month BY CONSTRUCTION. It reads
--     `rowFor(operations, month)` (lib/reports.ts:450), which is a `find` on one
--     month. It cannot span a period.
--   * The Statements tab is the only surface that spans months (PERIOD_TYPES =
--     Monthly / Quarterly / Yearly, lib/reports.ts:137).
--   * There, `trucks_active` goes through `peakOver` — Math.max across the
--     period's monthly rows (StatementViews.tsx:748, lib/reports.ts:341).
--     **It is never summed anywhere in the app.**
--   * And it is already labelled in three places: the row suffix "most in any
--     one month" when multiMonth (StatementViews.tsx:934-938), a <Note> carrying
--     the full explanation (:997-1003), and the narrative sentence "at most N
--     trucks in any single month" (lib/reports.ts:653).
--
-- So the gap is the GLOSSARY only. MetricsGlossaryModal renders `caveat` and
-- nothing else describes this; with a null caveat it renders NOTHING at all —
-- deliberately, "absent never renders as a value" (MetricsGlossaryModal.tsx:30).
-- Which means today the glossary silently implies `operations` carries no
-- warning, while the statement three clicks away carries a strong one. This
-- file makes those two agree.
--
-- ===========================================================================
-- THE TEXT
-- ===========================================================================
-- Worded to match the statement's inline <Note> so a reader moving between the
-- two does not have to reconcile two different explanations of one rule, but
-- phrased for a METRIC DEFINITION rather than for a screen the reader is
-- already looking at.
--
-- It names BOTH on-screen labels on purpose. The same measure is called
-- "Trucks active" on the Overview tile and "Trucks that moved" in the statement;
-- a glossary entry that names only one leaves the reader unsure the warning
-- applies to the other.
--
-- LENGTH IS LOAD-BEARING, faintly. MetricsGlossaryModal's stacked-not-grid
-- layout is justified by a measurement in its header comment: "live max lengths
-- are caveat 785 chars". The assertion below holds this text inside that bound
-- so the comment stays true and the layout reasoning is not quietly invalidated.
--
-- No apostrophes in the text, so no doubling and nothing to mis-escape.
--
-- This whole file is one transaction; a failed assertion rolls the update back.
-- ===========================================================================
begin;

update public.report_metrics
   set caveat = 'Trips, delivered trips, work orders, outsourced jobs and exit permits are event counts and add across months. Trucks active does NOT: it is a distinct count of the trucks that moved within a single month, so adding months together double-counts any truck that worked in more than one. A period covering several months therefore reports the busiest single month rather than a total, and the Operations statement labels that figure "most in any one month" and calls it "Trucks that moved". A true whole-period distinct count cannot be derived from monthly figures at all.'
 where metric_key = 'operations';

-- ===========================================================================
-- AFTER APPLYING — assert the end state. Any failure rolls the update back.
--
-- Two claims: the warning is THERE, and nothing ELSE on the row moved. The
-- second matters more than it looks. An UPDATE with a mistyped WHERE, or a
-- `set` list that grew a stray column, is silent — report_metrics is pure
-- description, so a corrupted row shows up as wrong words in a popup, which is
-- exactly the kind of error nobody reports for months.
-- ===========================================================================
do $$
declare
  v_caveat      text;
  v_row_intact  int;
begin
  select caveat into v_caveat
    from public.report_metrics
   where metric_key = 'operations';

  -- (1) the warning exists at all
  if v_caveat is null or btrim(v_caveat) = '' then
    raise exception
      'operations.caveat is still empty after 0145. The entire purpose of this migration is that the glossary stops implying this metric carries no warning.';
  end if;

  -- (2) it is the RIGHT warning, not merely a non-null one. Checks the two
  --     claims the text exists to make, so a future careless edit that guts the
  --     meaning while leaving prose behind still fails here.
  if v_caveat not ilike '%distinct count%' or v_caveat not ilike '%busiest single month%' then
    raise exception
      'operations.caveat is present but no longer states that trucks active is a distinct count reported as the busiest single month. That is the whole warning - see StatementViews.tsx:997-1003, which must keep agreeing with it.';
  end if;

  -- (3) it stays inside the length MetricsGlossaryModal's layout was measured
  --     against (785 chars, per that file's header comment).
  if length(v_caveat) > 785 then
    raise exception
      'operations.caveat is % chars, past the 785 that MetricsGlossaryModal states as the live maximum. Either shorten it or re-measure and update that comment - do not leave the two disagreeing.',
      length(v_caveat);
  end if;

  -- (4) NOTHING ELSE ON THE ROW MOVED. Every other column still holds exactly
  --     what 0098 set and 0144 restored.
  select count(*) into v_row_intact
    from public.report_metrics
   where metric_key  = 'operations'
     and label       = 'Operational activity'
     and meaning     = 'Non-money activity: trips, active trucks, and maintenance frequency.'
     and formula     = 'Counts per month of trips, delivered trips, distinct trucks used, work orders, outsourced jobs and exit permits.'
     and unit        = 'count'
     and grain       = 'one month'
     and source_view = 'v_operations_monthly'
     and basis       = 'operational';

  if v_row_intact <> 1 then
    raise exception
      'The operations row is no longer in its 0098/0144 shape apart from the caveat (matched % rows). 0145 is supposed to touch ONE column.',
      v_row_intact;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- REHEARSAL (run separately, rolled back — do NOT paste into the file above).
-- Unlike 0144 this DOES change live, so look at the before and after.
--
--   begin;
--     select caveat from public.report_metrics where metric_key = 'operations';
--     -- expect: null
--
--     -- ... paste the UPDATE above here ...
--
--     select length(caveat) as chars, caveat
--       from public.report_metrics where metric_key = 'operations';
--
--     -- nothing else moved, and no other row was touched:
--     select metric_key, label, unit, grain, source_view, basis
--       from public.report_metrics
--      where metric_key in ('operations','operations_by_driver')
--      order by metric_key;
--     select count(*) from public.report_metrics;          -- still 30
--   rollback;
--
-- IN-BROWSER AFTER APPLYING: open Reports, click the glossary in the header,
-- find "Operational activity". The warning should now appear under it, and it
-- should read consistently with the note under the Operations statement in
-- tab 2 rather than contradicting it.
-- ===========================================================================
