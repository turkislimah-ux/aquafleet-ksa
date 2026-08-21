-- 0147_project_commission_sync_trigger.sql
-- Keep project_commission_history in step with projects.commission_*.
-- Step 2a of 3: the SYNC (write side). 2b is the READ side and comes after.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
--
-- ===========================================================================
-- THIS FILE MOVES NO COMMISSION FIGURE. Stated first, asserted at the foot.
-- ===========================================================================
-- 0146 landed the table, seeded seven baselines and added commission_config_at().
-- The resolver still has ZERO CALLERS. The delivery stamp (priceDelivery) and the
-- daily reprice (recomputeDailyCommission) both still read projects.commission_*
-- directly, exactly as they did before 0146, and this file does not change either
-- of them. Nothing here writes to `trips`, and nothing here reprices anything.
--
-- What this file does is make the history table STOP GOING STALE. From the moment
-- it applies, every project carries a dated record of its commission config, and
-- 2b can be wired in as a no-op rather than as a guess.
--
-- The money gate is not a promise. Block 0 fingerprints every trip's id +
-- commission_sar into a temp table before anything runs; assertion (1) at the foot
-- recomputes it and rolls the whole file back on any drift. Live reads
-- 818 trips / 744 delivered / 744 stamped / 15,820.16 SAR /
-- md5 45e7433255eb121d735874ab8bbd7292 at drafting - those numbers appear in the
-- VERIFICATION block only, as a sanity read, never as a gate. A literal md5 in the
-- file would fail on a rebuild or on one more delivery between drafting and apply.
--
-- ===========================================================================
-- WHY A TRIGGER AND NOT AN APP WRITE - the 0125 argument, and a second one
-- ===========================================================================
-- 0125 chose a trigger for salary because a missed history row DROPPED SOMEONE
-- FROM PAYROLL. The same argument holds here and there is a sharper one on top:
--
--   `projects.commission_*` has TWO edit surfaces, and one of them is already
--   incomplete. app/projects/actions.ts writes the project row on save, and its
--   parse() NEVER READS commission_bump_pct. An app-side history write bolted onto
--   that path would inherit the same blind spot and record a bump that is not the
--   bump on the row. The trigger sees `new.*` - the values Postgres actually
--   committed - so it cannot disagree with the base row, and it cannot be
--   forgotten by a third edit path added later.
--
-- TWO TRIGGERS, NOT ONE - the 0114 lesson, carried over verbatim from 0125. OLD
-- cannot be referenced in an INSERT trigger's WHEN clause, so a combined
-- INSERT OR UPDATE would have to bury the IS-DISTINCT-FROM test in the body and
-- would then enter the function on every unrelated project edit. Split, the UPDATE
-- trigger's WHEN is evaluated by the executor without a function call at all.
--
-- AFTER, not BEFORE, on both. The trigger writes to a DIFFERENT table, and
-- project_commission_history.project_id is an FK to projects(id) - in a BEFORE
-- INSERT trigger the parent row does not exist yet and the FK check would fail.
--
-- Direction stays one-way: projects.commission_* is the CURRENT value and the edit
-- surface; history is derived from it and never the reverse.
--
-- ===========================================================================
-- WHERE THIS DELIBERATELY DIVERGES FROM record_salary_change()
-- ===========================================================================
-- Shape and security are mirrored exactly (see the next section). The BEHAVIOUR of
-- the INSERT branch is not, and the difference is the whole point of 0126:
--
--   record_salary_change() on INSERT writes a TODAY-DATED, non-baseline row for a
--   newly hired person. 0125 seeded the same way for everyone and it was wrong:
--   one row was both the immutable baseline AND today's current figure, so the
--   first raise upserted onto today's date, rewrote the baseline, and moved June
--   and July payroll. 0126 fixed the SEEDED rows by moving them back to each
--   person's employment floor. It did not revisit the trigger, because for a
--   person hired today "today" IS the floor and the two coincide.
--
--   Here the two do NOT coincide. A project can be created with a backdated
--   start_date, and 0146's baselines sit at the project FLOOR, not at today. So
--   0147's INSERT branch writes a FLOOR-DATED, is_baseline = true row - the same
--   row 0146's backfill would have written had the project existed then. Anything
--   else and a project entered today with a January contract start would have its
--   January trips resolve to no config at all.
--
-- Second divergence, smaller: record_salary_change() guards each branch with
-- `if new.salary_sar is not null`, because drivers.salary_sar and
-- staff.monthly_salary_sar are NULLABLE and "no salary recorded" is the absence of
-- a row. Measured on live, all three commission columns are NOT NULL with defaults
-- ('fixed' / 0 / 0), so there is no null case to guard and no absence to model. A
-- copied guard here would be dead code that reads as if the column could be null.
--
-- ===========================================================================
-- SECURITY POSTURE - MIRRORED FROM 0125, INCLUDING WHAT IS ABSENT
-- ===========================================================================
-- FUNCTION: `language plpgsql`, `security definer`, `set search_path = public`,
-- `returns trigger`, `return null` - byte-for-byte the posture of
-- record_salary_change(). SECURITY DEFINER is load-bearing: the function writes to
-- an RLS-enabled table from whatever role happens to be editing the project, and a
-- definer function is how the sibling guarantees the history row lands regardless
-- of the caller's policy.
--
-- NO ACL STATEMENTS, and that is deliberate rather than forgotten. 0125 issued no
-- grant/revoke on record_salary_change(), so it carries the default PUBLIC EXECUTE
-- and anon holds it today. That grant is inert for a trigger function: calling one
-- directly raises 0A000 ("trigger functions can only be called as triggers") before
-- a single line of the body runs, because NEW and TG_OP do not exist outside
-- trigger context. Adding a revoke here would make this the only trigger function
-- in the schema with a non-default ACL - a difference a future reader would have to
-- explain, for no privilege actually closed. Same reasoning as 0146's decision not
-- to revoke anon on the table. Assertion (5) reads the posture back rather than
-- assuming it.
--
-- `projects` ALREADY CARRIES ONE TRIGGER: projects_set_initials_trigger, BEFORE
-- INSERT FOR EACH ROW. The two added here are AFTER, so the order on an insert is
-- set_initials -> row written -> baseline recorded. They do not interact:
-- set_initials touches only new.initials, and claim_project_initials() is pure
-- reads plus a pg_advisory_xact_lock - no sequence, no counter table. That matters
-- for the rehearsal below: a rolled-back test project consumes nothing at all.
--
-- ===========================================================================
-- THE CATCH-UP BACKFILL - NOT IN THE BRIEF, AND WHY IT IS HERE ANYWAY
-- ===========================================================================
-- Section 1 re-runs 0146's backfill for any project that has no baseline. On live
-- today it matches ZERO projects (7 projects, 7 baselines, verified at drafting)
-- and assertion (3) proves the row count moved by exactly the number it matched.
--
-- It is here because there is a real window: 0146 is already applied, 0147 is not,
-- and any project created in between gets no baseline from either. The INSERT
-- trigger only covers projects created AFTER it exists. Leaving that to 2b would
-- mean shipping the hard-error rule with a known class of project that trips it.
--
-- This is one logical unit with the trigger, not a second change riding along: the
-- invariant both halves serve is "every project has exactly one baseline, always",
-- and assertion (2) states it as one thing. The floor expression is 0146's,
-- unchanged, including the min(trip_date) term - a project created in the window
-- may already have trips.
--
-- ===========================================================================
-- THE SAME-DAY CASE, SPELLED OUT RATHER THAN DISCOVERED LATER
-- ===========================================================================
-- A project created TODAY gets a baseline dated today (its floor is its creation
-- date). If its commission is corrected the same day, the UPDATE branch's upsert
-- lands on that very row: (project_id, today) is the conflict target and there is
-- only one row per project per date. The three values are overwritten.
--
-- That is NOT the 0125 defect. The 0125 defect was a today-dated baseline sitting
-- in front of MONTHS of already-priced history. A project created today has no
-- earlier day to protect - 0146's verification note F says exactly this. For every
-- project older than today the baseline is at a past floor and a today-dated write
-- cannot reach it.
--
-- Two things the DO UPDATE deliberately leaves alone in that collision:
--   · is_baseline - the row stays honestly marked as the project's opening config,
--     which it still is. Flipping it to false would leave the project with no
--     baseline at all and break the invariant assertion (2) enforces.
--   · note - it keeps saying the row was recorded at creation, which is true of the
--     ROW. Overwriting it would erase the provenance of a baseline to describe an
--     edit. (0125's DO UPDATE sets only salary_sar for the same reason.)
--
-- ===========================================================================
-- THE HOLE 0146 NAMED IS STILL OPEN, AND THIS FILE DOES NOT WIDEN IT
-- ===========================================================================
-- A trip BACKDATED to before its project's floor resolves to nothing. trip_date is
-- free-entry and no constraint ties it to the project. 0146 asserted no such trip
-- exists; assertion (4) re-asserts it here, because the catch-up backfill above
-- creates new baselines and a new baseline is a new floor. The disposition is
-- ruled: 2b HARD-ERRORS on zero rows and never falls back to projects.commission_*.
--
-- ONE DELIVERED TRIP HAS NO PROJECT AT ALL and therefore no baseline, ever:
--   id 2bf32c2d-6747-400b-bb8b-9e5db37c7317, trip_date 2026-07-15, delivered,
--   commission_sar 0.00.
-- Assertion (4) scopes to trips WITH a project and excludes it knowingly. 2b must
-- branch on `project_id is null` BEFORE calling the resolver, or the hard-error
-- rule fires on a row that is already correct.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT DO
-- ===========================================================================
-- · No write to `trips` and no write to `trips.commission_sar`. Asserted.
-- · No change to `projects` - not a column, not a default, not a constraint.
--   The three commission columns stay the current-value source of truth.
-- · No change to commission_config_at(). It still has zero callers.
-- · No change to app code. priceDelivery and recomputeDailyCommission are 2b.
-- · No view, so the section 6 counts are untouched (47 / 47 / 0).
-- · No DELETE trigger - project_commission_history.project_id is ON DELETE
--   CASCADE, and projects are soft-archived, so a hard delete is the only case
--   and the FK already handles it.
-- · No behavioural rehearsal inside the transaction. Proving the trigger by
--   inserting a fake project mid-migration means a migration that writes test
--   data into a money-adjacent table, and someone re-runs it eventually. The
--   rehearsal is in the VERIFICATION block, rolled back, run by hand.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Fingerprint the money and the history table BEFORE anything runs.
--    Assertions (1) and (3) recompute and compare. `on commit drop` disposes
--    of it with the transaction, so nothing survives into the schema.
-- ---------------------------------------------------------------------
create temp table _0147_before on commit drop as
select (select count(*) from public.trips)                                       as trips_all,
       (select count(*) from public.trips where commission_sar is not null)      as stamped,
       (select coalesce(sum(commission_sar), 0::numeric) from public.trips)      as commission_total,
       (select md5(coalesce(string_agg(id::text || ':' ||
                                       coalesce(commission_sar::text, '~'),
                                       ',' order by id), ''))
          from public.trips)                                                     as fingerprint,
       (select count(*) from public.project_commission_history)                  as pch_rows,
       (select count(*) from public.project_commission_history
         where not is_baseline)                                                  as pch_nonbaseline,
       (select count(*) from public.projects p
         where not exists (select 1 from public.project_commission_history h
                            where h.project_id = p.id and h.is_baseline))        as uncovered;

-- ---------------------------------------------------------------------
-- 1) CATCH-UP: a baseline for any project that has none.
--
--    0146's backfill, verbatim, including the min(trip_date) term. Matches
--    zero rows on live today; it exists for the 0146-applied / 0147-not-yet
--    window. See the header.
--
--    `least()` ignores NULLs and created_at is NOT NULL, so the floor is
--    always a date. Values are COPIED from projects, never recomputed.
-- ---------------------------------------------------------------------
insert into public.project_commission_history
  (project_id, effective_from, commission_mode, commission_value,
   commission_bump_pct, note, is_baseline)
select p.id,
       least(
         p.start_date,
         (select min(t.trip_date) from public.trips t where t.project_id = p.id),
         (p.created_at at time zone 'Asia/Riyadh')::date
       ),
       p.commission_mode,
       p.commission_value,
       p.commission_bump_pct,
       'Baseline seeded by 0147 catch-up from projects.commission_* at the project floor.',
       true
  from public.projects p
 where not exists (
         select 1 from public.project_commission_history h
          where h.project_id = p.id and h.is_baseline
       )
on conflict (project_id, effective_from) do nothing;

-- ---------------------------------------------------------------------
-- 2) The sync function. One function, two branches on TG_OP - the same
--    single-function shape record_salary_change() uses for its two subjects.
--
--    Both branches upsert on (project_id, effective_from). That conflict
--    target is 0146's UNIQUE index and it is BARE - no `where` clause -
--    unlike salary_history's two PARTIAL indexes, which force
--    `on conflict (driver_id, effective_from) where driver_id is not null`.
--    project_commission_history has a single non-nullable subject column, so
--    the plain form is the correct inference target here.
-- ---------------------------------------------------------------------
create or replace function public.record_project_commission_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_floor date;
begin
  if tg_op = 'INSERT' then
    -- A NEW PROJECT gets its BASELINE, dated at the project floor.
    --
    -- Two terms, not 0146's three: the min(trip_date) term is dropped because
    -- trips.project_id is an FK to this row and no trip can reference a project
    -- that did not exist a moment ago. Carrying it would add an index scan to
    -- every project insert to read a value that is always NULL.
    --
    -- DO NOTHING, not DO UPDATE: nothing can legitimately be sitting on that
    -- date, and if something is, it is older than this statement and wins.
    v_floor := least(new.start_date, (new.created_at at time zone 'Asia/Riyadh')::date);

    insert into public.project_commission_history
      (project_id, effective_from, commission_mode, commission_value,
       commission_bump_pct, note, is_baseline)
    values (new.id, v_floor, new.commission_mode, new.commission_value,
            new.commission_bump_pct,
            'Baseline recorded automatically when the project was created.',
            true)
    on conflict (project_id, effective_from) do nothing;

  else
    -- A CONFIG CHANGE gets a NON-baseline row dated TODAY (Riyadh). Forward
    -- only: it can never be dated before a floor, because a floor is at most
    -- the project's creation date.
    --
    -- Last edit of the day wins - three edits on one day leave one row, which
    -- is what "the config in force on that day" has to mean. is_baseline and
    -- note are deliberately NOT in the SET list; see the header's same-day
    -- section.
    insert into public.project_commission_history
      (project_id, effective_from, commission_mode, commission_value,
       commission_bump_pct, note, is_baseline)
    values (new.id, v_today, new.commission_mode, new.commission_value,
            new.commission_bump_pct,
            'Recorded automatically on commission config change.',
            false)
    on conflict (project_id, effective_from) do update set
      commission_mode     = excluded.commission_mode,
      commission_value    = excluded.commission_value,
      commission_bump_pct = excluded.commission_bump_pct;
  end if;

  return null;
end;
$$;

comment on function public.record_project_commission_change() is
  'Keeps project_commission_history in step with projects.commission_*. On INSERT '
  'writes the project baseline at its floor; on a commission-changing UPDATE '
  'upserts a non-baseline row dated today (Riyadh). Writes history only - it '
  'never touches trips or any priced figure.';

-- ---------------------------------------------------------------------
-- 3) The triggers. AFTER on both (the row must exist for the FK, and the write
--    goes elsewhere). Two, not one - OLD is unavailable in an INSERT WHEN.
-- ---------------------------------------------------------------------
drop trigger if exists projects_commission_history_ins on public.projects;
create trigger projects_commission_history_ins
  after insert on public.projects
  for each row execute function public.record_project_commission_change();

drop trigger if exists projects_commission_history_upd on public.projects;
create trigger projects_commission_history_upd
  after update on public.projects
  for each row when (
        old.commission_mode     is distinct from new.commission_mode
     or old.commission_value    is distinct from new.commission_value
     or old.commission_bump_pct is distinct from new.commission_bump_pct
  )
  execute function public.record_project_commission_change();

-- ---------------------------------------------------------------------
-- 4) ASSERT THE END STATE. Any failure rolls back every write above,
--    the triggers and the function included.
-- ---------------------------------------------------------------------
do $$
declare
  v_trips_all    bigint;
  v_stamped      bigint;
  v_total        numeric;
  v_fingerprint  text;
  v_projects     bigint;
  v_baselines    bigint;
  v_rows         bigint;
  v_nonbaseline  bigint;
  v_unreachable  bigint;
  v_ins_type     smallint;
  v_ins_enabled  "char";
  v_upd_type     smallint;
  v_upd_enabled  "char";
  v_upd_def      text;
  v_secdef       boolean;
  v_lang         text;
  v_config       text[];
  v_rettype      oid;
begin
  -- (1) NOT ONE TRIP MOVED. This is the claim the header opens with.
  select count(*),
         count(*) filter (where commission_sar is not null),
         coalesce(sum(commission_sar), 0::numeric),
         md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_sar::text, '~'),
                                 ',' order by id), ''))
    into v_trips_all, v_stamped, v_total, v_fingerprint
    from public.trips;

  if not exists (
       select 1 from _0147_before b
        where b.trips_all        = v_trips_all
          and b.stamped          = v_stamped
          and b.commission_total = v_total
          and b.fingerprint      = v_fingerprint
     ) then
    raise exception
      '0147 changed trips. It must write nothing to trips; found % rows / % stamped / % total / fingerprint %. Rolling back.',
      v_trips_all, v_stamped, v_total, v_fingerprint;
  end if;

  -- (2) THE INVARIANT: every project has exactly one baseline. The catch-up
  --     and the INSERT trigger both exist to hold this.
  select count(*) into v_projects from public.projects;

  select count(*) into v_baselines
    from (select h.project_id
            from public.project_commission_history h
           where h.is_baseline
           group by h.project_id
          having count(*) = 1) one_each;

  if v_baselines <> v_projects then
    raise exception
      'Baseline coverage is wrong after 0147: % projects but % of them have exactly one baseline row.',
      v_projects, v_baselines;
  end if;

  -- (3) THE CATCH-UP ADDED EXACTLY WHAT IT MATCHED AND NOTHING ELSE. No
  --     non-baseline row was created or altered - 0147 writes no config change.
  select count(*), count(*) filter (where not is_baseline)
    into v_rows, v_nonbaseline
    from public.project_commission_history;

  if not exists (
       select 1 from _0147_before b
        where v_rows         = b.pch_rows + b.uncovered
          and v_nonbaseline  = b.pch_nonbaseline
     ) then
    raise exception
      'project_commission_history moved unexpectedly: % rows / % non-baseline after 0147. Expected before-count plus the uncovered projects, with the non-baseline count unchanged.',
      v_rows, v_nonbaseline;
  end if;

  -- (4) EVERY TRIP THAT HAS A PROJECT IS STILL REACHABLE. Re-checked because
  --     section 1 can create new floors. Scoped to trips WITH a project - the
  --     one project-less delivered trip is excluded knowingly (see header).
  select count(*) into v_unreachable
    from public.trips t
   where t.project_id is not null
     and not exists (
           select 1 from public.project_commission_history h
            where h.project_id = t.project_id
              and h.effective_from <= t.trip_date
         );

  if v_unreachable <> 0 then
    raise exception
      '% trip(s) fall before their project baseline and would resolve to no config. Step 2b hard-errors on that.',
      v_unreachable;
  end if;

  -- (5) BOTH TRIGGERS EXIST WITH THE RIGHT TIMING AND EVENTS.
  --     tgtype bits: ROW=1, INSERT=4, UPDATE=16, BEFORE=2 (absent = AFTER).
  --     AFTER INSERT ROW = 5. AFTER UPDATE ROW = 17. Same values the four
  --     salary_history triggers carry on live.
  select t.tgtype, t.tgenabled into v_ins_type, v_ins_enabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'projects'
     and t.tgname = 'projects_commission_history_ins';

  if v_ins_type is distinct from 5::smallint or v_ins_enabled is distinct from 'O'::"char" then
    raise exception
      'projects_commission_history_ins is wrong: tgtype=%, enabled=%. Expected 5 (AFTER INSERT FOR EACH ROW) and O.',
      v_ins_type, v_ins_enabled;
  end if;

  select t.tgtype, t.tgenabled, pg_get_triggerdef(t.oid)
    into v_upd_type, v_upd_enabled, v_upd_def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'projects'
     and t.tgname = 'projects_commission_history_upd';

  if v_upd_type is distinct from 17::smallint or v_upd_enabled is distinct from 'O'::"char" then
    raise exception
      'projects_commission_history_upd is wrong: tgtype=%, enabled=%. Expected 17 (AFTER UPDATE FOR EACH ROW) and O.',
      v_upd_type, v_upd_enabled;
  end if;

  -- (6) THE UPDATE TRIGGER IS GATED, AND ON ALL THREE COLUMNS. Without the
  --     WHEN clause it would write a history row on every unrelated project
  --     edit; missing one column and that column's changes go unrecorded.
  if v_upd_def is null
     or v_upd_def not like '% WHEN %'
     or v_upd_def not like '%commission_mode%'
     or v_upd_def not like '%commission_value%'
     or v_upd_def not like '%commission_bump_pct%' then
    raise exception
      'projects_commission_history_upd has no WHEN clause naming all three commission columns. Definition: %',
      coalesce(v_upd_def, '<null>');
  end if;

  -- (7) FUNCTION POSTURE, MIRRORED FROM record_salary_change AND READ BACK.
  select p.prosecdef, l.lanname, p.proconfig, p.prorettype
    into v_secdef, v_lang, v_config, v_rettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'record_project_commission_change';

  if v_secdef is not true
     or v_lang is distinct from 'plpgsql'
     or v_rettype is distinct from 'pg_catalog.trigger'::regtype::oid
     or v_config is null
     or not (v_config @> array['search_path=public']) then
    raise exception
      'record_project_commission_change posture is wrong: security_definer=%, language=%, rettype=%, config=%. Expected true / plpgsql / trigger / {search_path=public}.',
      v_secdef, v_lang, v_rettype::regtype, v_config;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION - run these separately; do NOT paste into the file above.
--
-- Every rehearsal here writes commission config, so every one of them is
-- wrapped in an explicit rollback. They are safe to run: claim_project_initials
-- (fired by the existing BEFORE INSERT trigger) is pure reads plus a
-- pg_advisory_xact_lock, so a rolled-back project consumes no sequence and no
-- counter - nothing survives the rollback.
-- ===========================================================================
--
-- A) THE MONEY DID NOT MOVE. Capture BEFORE applying, compare after. The in-file
--    assertion already gates this; the point of running it is to see it:
--      select count(*) as trips_all,
--             count(*) filter (where stage = 'delivered')        as delivered,
--             count(*) filter (where commission_sar is not null) as stamped,
--             sum(commission_sar)                                as commission_total,
--             md5(string_agg(id::text || ':' ||
--                            coalesce(commission_sar::text,'~'),
--                            ',' order by id))                   as fingerprint
--        from public.trips;
--      -- at drafting: 818 / 744 / 744 / 15820.16 /
--      --              45e7433255eb121d735874ab8bbd7292
--      -- Identical after. Any movement means something wrote to trips.
--
-- B) THE CATCH-UP WAS A NO-OP. Expect 7 / 7 / 0, unchanged from 0146:
--      select count(*) as rows,
--             count(*) filter (where is_baseline)     as baselines,
--             count(*) filter (where not is_baseline) as changes,
--             count(distinct project_id)              as projects_covered
--        from public.project_commission_history;
--      -- 7 / 7 / 0 / 7, against 7 rows in public.projects.
--      -- A non-zero `changes` here means something edited a project during the
--      -- apply - not a failure, but read it before continuing.
--
-- C) THE TRIGGERS ARE ON, AND projects NOW CARRIES THREE:
--      select t.tgname, t.tgtype, t.tgenabled, pg_get_triggerdef(t.oid)
--        from pg_trigger t
--        join pg_class c on c.oid = t.tgrelid
--        join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='projects' and not t.tgisinternal
--       order by t.tgname;
--      -- projects_commission_history_ins   5  O   AFTER INSERT ... FOR EACH ROW
--      -- projects_commission_history_upd  17  O   AFTER UPDATE ... WHEN (...)
--      -- projects_set_initials_trigger     7  O   BEFORE INSERT (pre-existing)
--
--      select p.prosecdef, p.proconfig, l.lanname, p.proacl::text
--        from pg_proc p
--        join pg_namespace n on n.oid=p.pronamespace
--        join pg_language l on l.oid=p.prolang
--       where n.nspname='public' and p.proname='record_project_commission_change';
--      -- true / {search_path=public} / plpgsql / default ACL (PUBLIC EXECUTE).
--      -- The default ACL is intentional and matches record_salary_change - see
--      -- the security section of the header.
--
-- D) REHEARSAL (a) - A CONFIG EDIT. RRR T: baseline 2026-06-28, fixed 60.00 /
--    0.00, one row today. ROLLED BACK.
--      begin;
--        select effective_from, commission_mode, commission_value,
--               commission_bump_pct, is_baseline
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--         order by effective_from;
--        -- 1 row: 2026-06-28  fixed  60.00  0.00  true
--
--        update public.projects set commission_value = 61
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--
--        select effective_from, commission_mode, commission_value,
--               commission_bump_pct, is_baseline, note
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--         order by effective_from;
--        -- EXACTLY 2 rows:
--        --   2026-06-28  fixed  60.00  0.00  true   <- BASELINE UNTOUCHED
--        --   <today>     fixed  61.00  0.00  false  <- the new row
--        -- If the baseline moved, the floor rule is broken - REVERT.
--
--        -- second edit the SAME DAY upserts; it must not add a third row
--        update public.projects
--           set commission_mode = 'scalable', commission_bump_pct = 5
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--
--        select count(*) as rows_now
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- still 2. Today's row now reads scalable / 61.00 / 5.00.
--
--        -- AND THE PAST DID NOT MOVE:
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92', date '2026-07-01');
--        -- MUST still read fixed / 60.00 / 0.00.
--      rollback;
--      select count(*) from public.project_commission_history;   -- back to 7
--
-- E) REHEARSAL (a-negative) - AN UNRELATED EDIT WRITES NOTHING. This is what
--    the WHEN clause buys. ROLLED BACK:
--      begin;
--        update public.projects set name = name || ' zz'
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        select count(*) as rows_now
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- still 1. A 2 here means the trigger fires on every project edit.
--      rollback;
--
-- F) REHEARSAL (b) - A NEW PROJECT. ROLLED BACK:
--      begin;
--        insert into public.projects
--          (customer_id, name, default_water_station, rate_per_trip_sar,
--           commission_mode, commission_value, commission_bump_pct)
--        values ('e958b840-c8e4-43db-9f3b-52fe5a923d7f', 'ZZZ 0147 rehearsal',
--                'manfuhah_station', 100, 'scalable', 7, 4)
--        returning id, initials, created_at;
--
--        select h.effective_from, h.commission_mode, h.commission_value,
--               h.commission_bump_pct, h.is_baseline, h.note
--          from public.project_commission_history h
--          join public.projects p on p.id = h.project_id
--         where p.name = 'ZZZ 0147 rehearsal';
--        -- EXACTLY ONE row: <today> / scalable / 7.00 / 4.00 / true /
--        -- 'Baseline recorded automatically when the project was created.'
--        -- Zero rows means the trigger did not fire; two means it is doubled.
--
--        -- a same-day correction lands ON that baseline, does not add a row,
--        -- and leaves it marked as the baseline:
--        update public.projects set commission_value = 9
--         where name = 'ZZZ 0147 rehearsal';
--        select h.effective_from, h.commission_value, h.is_baseline
--          from public.project_commission_history h
--          join public.projects p on p.id = h.project_id
--         where p.name = 'ZZZ 0147 rehearsal';
--        -- still ONE row: <today> / 9.00 / true. See the same-day section.
--
--        -- BACKDATED START DATE - the floor must follow it, not today:
--        insert into public.projects
--          (customer_id, name, default_water_station, rate_per_trip_sar,
--           commission_mode, commission_value, commission_bump_pct, start_date)
--        values ('e958b840-c8e4-43db-9f3b-52fe5a923d7f', 'ZZZ 0147 backdated',
--                'manfuhah_station', 100, 'fixed', 15, 0, date '2026-05-01');
--
--        select h.effective_from, h.commission_value, h.is_baseline
--          from public.project_commission_history h
--          join public.projects p on p.id = h.project_id
--         where p.name = 'ZZZ 0147 backdated';
--        -- ONE row dated 2026-05-01, NOT today. This is the divergence from
--        -- record_salary_change() the header defends - a today-dated baseline
--        -- here would strand every trip between May and now.
--      rollback;
--      select count(*) from public.projects;                     -- back to 7
--      select count(*) from public.project_commission_history;   -- back to 7
--
-- G) NO BASELINE IS DATED IN THE FUTURE, so a today-dated change can never sort
--    behind one. Expect 0:
--      select count(*) as baselines_in_the_future
--        from public.project_commission_history
--       where is_baseline
--         and effective_from > (now() at time zone 'Asia/Riyadh')::date;
--
-- H) THE GLOSSARY OF FLOORS, for the record. Every project, its floor, and its
--    earliest trip - floor must be <= earliest trip everywhere:
--      select p.name, h.effective_from as floor,
--             (select min(t.trip_date) from public.trips t
--               where t.project_id = p.id) as earliest_trip
--        from public.projects p
--        join public.project_commission_history h
--          on h.project_id = p.id and h.is_baseline
--       order by h.effective_from, p.name;
--
-- I) NO VIEW WAS ADDED OR REPLACED - the section 6 counts are untouched:
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 47 / 47 / 0, unchanged.
--
-- J) THE TEMP TABLE DID NOT SURVIVE:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname = '_0147_before';
--      -- expect 0.
-- ===========================================================================
