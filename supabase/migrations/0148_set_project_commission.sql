-- 0148_set_project_commission.sql
-- ONE write path for a commission change: effective TODAY or on a FUTURE date.
-- Step 3a of 3 (write side). 3b is the display view (0149); 3c is app code.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
--
-- ===========================================================================
-- THIS FILE CALLS NOTHING AND MOVES NO FIGURE. Stated first, asserted at the foot.
-- ===========================================================================
-- It adds two functions - one that writes a commission change, one that cancels a
-- change that has not taken effect yet. It calls neither, no trigger calls either,
-- and no app code calls either until 3c. Block 0 fingerprints every trip's id +
-- commission_sar and assertion (1) rolls the whole file back on any drift.
-- Assertions (2) and (3) do the same for project_commission_history and for
-- projects.commission_*, the two things these functions exist to move.
--
-- ===========================================================================
-- WHY THE 0147 TRIGGER IS NOT ENOUGH ON ITS OWN
-- ===========================================================================
-- 0147 records a today-dated history row whenever projects.commission_* changes.
-- That is a complete answer for "change it today" and NO answer for "change it
-- from the 1st of next month": a future-dated change must land a history row at a
-- future effective_from WITHOUT moving projects.commission_*, because the new
-- terms are not in force yet.
--
-- The moment that is possible, projects.commission_* can be STALE - it holds the
-- value that was current when it was last written, not the value in force today.
-- And a stale current-value column turns the 0147 trigger from a safety net into
-- a trap, because the trigger only fires on a DIFFERENCE:
--
--     projects.commission_value      = 60   (stale - written in July)
--     commission_config_at(p, today) = 80   (a future row activated in August)
--
--   A user is shown 80, edits it to 60, and saves. `update projects set
--   commission_value = 60` is a NO-OP against a column that already reads 60.
--   The UPDATE trigger's WHEN clause is false. NO HISTORY ROW IS WRITTEN. The
--   resolver still answers 80, every trip from today on is priced at 80, and the
--   edit that was made, confirmed and displayed as saved did nothing at all.
--
-- That is why this function writes project_commission_history EXPLICITLY and
-- FIRST, and only then mirrors into projects. The history write does not depend
-- on a diff, so it cannot be skipped by one.
--
-- THE MIRROR IS DELIBERATELY IDEMPOTENT WITH THE TRIGGER. On the today path the
-- projects UPDATE re-fires projects_commission_history_upd, which upserts the
-- SAME (project_id, today) row with the SAME three values. 0147's DO UPDATE sets
-- only mode/value/bump - not `note`, not `is_baseline` - so the row this function
-- wrote survives intact with its own note. Two writers, one row, same values.
-- Assertion is by rehearsal D below, not by argument.
--
-- ORDER IS LOAD-BEARING: history first, projects second. Reversed, the trigger
-- would write the row with its generic note and this function's upsert would then
-- overwrite that note - the same row either way, but the provenance flips
-- depending on whether the value happened to differ. One order, one outcome.
--
-- ===========================================================================
-- FORWARD ONLY. NO BACKDATING, EVER. NOT A POLICY - A RAISE.
-- ===========================================================================
-- p_effective_from < today is REFUSED with an exception. It is not clamped, not
-- rounded up to today, and not silently accepted. The reasons compound:
--
--   · Trips before today are already stamped in trips.commission_sar. A backdated
--     config change does not move them by itself - but recomputeDailyCommission
--     reprices every UNPAID delivered trip in a driver+project+trip_date bucket
--     the next time that bucket churns, reading commission_config_at(project,
--     trip_date). A backdated row therefore reprices the past LATER, at a moment
--     nobody connects to the edit.
--   · Rows already paid out (payout_id not null) would NOT move, so a backdated
--     change would split one day's trips into repriced and frozen halves.
--   · 0146 and 0147 both spent their length arguing the baseline must sit at the
--     project floor precisely so the past is unreachable. A backdating write path
--     would hand back what both files were built to take away.
--
-- The floor for the check is TODAY IN RIYADH, matching 0147's v_today exactly
-- ((now() at time zone 'Asia/Riyadh')::date). Not UTC: between 00:00 and 02:59
-- Riyadh, a UTC floor is YESTERDAY and would admit a one-day backdate for three
-- hours a night. lib/commission.ts's monthKeyOf header documents this same trap
-- from the app side.
--
-- ===========================================================================
-- WHAT IT REPORTS BACK, AND WHY IT REPORTS RATHER THAN BLOCKS
-- ===========================================================================
-- A TODAY-dated change is, by design, in force for trips dated today - including
-- ones already delivered but not yet paid. Those WILL reprice on the next bucket
-- churn. That is the requested behaviour ("a change can take effect TODAY"), not
-- a defect, so this function does not block it.
--
-- It does refuse to let it happen unseen. The returned row carries
-- `repriceable_trips`: unpaid delivered trips on this project dated on or after
-- p_effective_from - exactly the set recomputeDailyCommission may rewrite. The UI
-- shows it in the confirm step. On live at drafting, delivered-unpaid trips dated
-- today = 0 and trips dated in the future = 0, so the count is 0 for every project
-- right now; it exists for the day that stops being true.
--
-- PAID trips are excluded from the count because payout_id is the one true freeze
-- and the recompute never writes them - the same rule priceDelivery already obeys.
--
-- ===========================================================================
-- CANCELLING A SCHEDULED CHANGE - STRICTLY FUTURE, AND NEVER THE BASELINE
-- ===========================================================================
-- A queued change is the one commission row that is safe to withdraw, because
-- nothing has been priced under it yet. cancel_project_commission() deletes it.
-- Every refusal is a RAISE. None of them silently declines and reports success.
--
--   · STRICTLY FUTURE ONLY (effective_from > today in Riyadh). A TODAY-dated row
--     is already in force: commission_config_at answers with it right now, and
--     anything delivered today was stamped from it. Deleting it would leave those
--     trips priced under terms that no longer exist in the history, and the next
--     churn of that driver+project+date bucket would re-price them to the PREVIOUS
--     period without anyone asking for it. Refused - and NOT clamped to "cancel
--     the next one instead". A cancel that quietly retargets a different row is
--     worse than a refusal, because the user is told a change went away and a
--     different change went away.
--   · NEVER A BASELINE, whatever its date. is_baseline is the project's opening
--     config and the row every past trip resolves against. Delete it and
--     commission_config_at returns ZERO ROWS for every date before the next
--     period, which step 2b turns into a hard error at delivery - the whole
--     project stops being able to price a trip. 0146's assertion (2) and 0147's
--     one-baseline-per-project invariant both assume it exists. This is checked
--     FIRST, ahead of the date guard, because it is the absolute rule: a
--     future-dated baseline is still a baseline, and the message the user gets
--     should be the reason that cannot be worked around, not the one that can.
--   · THE ROW MUST EXIST. Cancelling a date with nothing scheduled on it raises
--     instead of reporting a cheerful zero. A no-op dressed as a success is how a
--     user comes to believe a change was withdrawn while it is still queued.
--
-- IT DOES NOT TOUCH projects.commission_* AT ALL, and has nothing to undo there:
-- a future-dated write never mirrored into those columns in the first place - see
-- step (e) of set_project_commission. Rehearsal M reads the three columns back on
-- either side of a cancel rather than leaving that as a claim in prose.
--
-- ARCHIVED PROJECTS ARE ALLOWED HERE, where set_project_commission refuses them.
-- The asymmetry is deliberate. Queueing new terms onto a project nobody operates
-- is a data-entry mistake; withdrawing terms already queued on one is cleanup.
-- And archiving is reversible (0141 restore_customer_guarded), so refusing the
-- cancel would strand a live change that fires the moment the project comes back.
-- Removal is always safe. Addition is not.
--
-- DELETE, NOT A `cancelled_at` FLAG. commission_config_at (0146) resolves with
-- `effective_from <= p_on order by effective_from desc limit 1` and takes no
-- notice of any extra column. A soft-cancelled row would still win that ORDER BY
-- and would still price trips; making it not do so means editing the resolver,
-- which is explicitly out of scope for this step. The row being deleted has
-- priced nothing, is not yet history, and its own audit value is zero.
--
-- ===========================================================================
-- SECURITY POSTURE - MIRRORED FROM commission_config_at (0146)
-- ===========================================================================
-- SECURITY INVOKER, `set search_path to 'public'`, EXECUTE revoked from PUBLIC and
-- anon, granted to authenticated and service_role.
--
-- INVOKER is correct here and DEFINER would be wrong. Both tables this function
-- touches carry RLS with one `for all to authenticated using (true) with check
-- (true)` policy (read back at drafting, both of them), so an authenticated caller
-- already holds every privilege the body needs and the function adds no reach. A
-- definer version would let any role that can EXECUTE it rewrite commission config
-- for any project regardless of policy - handing out a privilege escalation to buy
-- nothing. 0146 made the same call for the same reason.
--
-- Note the asymmetry with 0147, which IS definer: that is a TRIGGER function, it
-- must write history from whatever role edits a project, and it cannot be called
-- directly (0A000). Different shape, different answer.
--
-- VOLATILE (the plpgsql default), not stable - it writes.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT DO
-- ===========================================================================
-- · No write to `trips`. Asserted.
-- · No write to `project_commission_history` and none to `projects`. Both
--   functions are defined, neither is invoked. Asserted, by fingerprint, on both
--   tables.
-- · No change to commission_config_at(), to either 0147 trigger, or to
--   record_project_commission_change(). Assertion (5) reads the triggers back.
-- · No change to update_project_with_customer / create_project_with_customer.
--   Those still write the three commission columns and still fire the 0147
--   trigger, which is one write path more than "a single model" allows. That is
--   settled - see RULING 2 below - but it is settled in 0150, not here. Keeping
--   the change to a live 24-parameter money RPC out of this file is what lets
--   this file's "nothing moved" assertions mean anything.
-- · No view. The section 6 counts stay 47 / 47 / 0. The display view is 0149,
--   deliberately separate so this file's "no view" assertion stays honest.
-- · No CHECK added to projects or to project_commission_history. The 0-50 bump
--   clamp is enforced IN THIS FUNCTION only, matching where it already lives
--   (normalizeProjectInput, app code). Adding a column CHECK would let the 0146
--   backfill fail on data `projects` accepts - 0146's own reasoning, unchanged.
--
-- ===========================================================================
-- RULING 2 - ONE WRITER FOR COMMISSION FIGURES. SETTLED, AND SETTLED IN 0150.
-- ===========================================================================
-- update_project_with_customer STOPS writing commission_mode / commission_value /
-- commission_bump_pct. Its 24-parameter signature is UNCHANGED and the three
-- parameters stay, ignored, so that no client breaks between the migration and
-- the deploy; the projects UPDATE simply loses three lines from its SET list.
-- That is 0150, drafted separately for the same reason 0149 is separate.
--
-- The alternative - leave it writing, and have the modal feed it
-- commission_config_at(project, today) - was rejected on three counts:
--
--   1. IT MAKES THE TWO RPCs NON-COMMUTATIVE. On a save where commission AND
--      another field both changed, both RPCs fire. With update_project_with_
--      customer LAST it writes the pre-filled OLD value over the mirror this
--      function just wrote, and because the values now differ it fires
--      projects_commission_history_upd, whose DO UPDATE rewrites the (project,
--      today) row back to the old figures. The change is reverted in the column
--      AND in the history, the screen says saved, and the surviving row carries
--      this function's note attached to values it never wrote. Silently wrong is
--      the worst available outcome. With the columns dropped from the SET list
--      the two calls commute and the order stops being load-bearing.
--   2. IT MAKES THE INVARIANT A PROPERTY OF ONE REACT COMPONENT. The RPC is
--      security invoker and granted to authenticated: any signed-in session can
--      call it with any commission figures it likes. "The modal passes the right
--      value" is a convention, and a convention is not a guard.
--   3. THE PRE-FILL IS A SNAPSHOT AND "IN FORCE" IS TIME-VARYING. A tab opened
--      yesterday holds yesterday's in-force value. A queued row activates
--      overnight. This morning the user edits the project NAME and saves - the
--      modal posts the stale figure, projects flips back, and the 0147 trigger
--      stamps a today-dated history row REVERSING terms nobody touched. No
--      pre-fill rule fixes this, because the pre-fill was correct when it was
--      read. Only removing the write does.
--
-- 3c calls update_project_with_customer FIRST and set_project_commission SECOND.
-- After 0150 they commute, so the order is not load-bearing - it is chosen so
-- that the commission writer runs LAST and therefore wins even if 0150 were ever
-- reverted or a third writer appeared.
--
-- 3c also calls set_project_commission ONLY when the commission form actually
-- differs from its pre-fill or an effective date was picked. Calling it on every
-- project save would upsert a today-dated "Commission change" row each time
-- somebody renamed a project, burying real changes in a timeline of non-events.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Fingerprint the money, the history table AND projects.commission_* before
--    anything runs. Assertions (1), (2) and (3) recompute and compare. `on commit
--    drop` disposes of it with the transaction.
--
--    projects is fingerprinted on the three commission columns specifically:
--    this file defines the only function that is allowed to mirror into them and
--    the only one that must never touch them, so "defining them did not move
--    them" is worth stating in the same terms as the other two.
-- ---------------------------------------------------------------------
create temp table _0148_before on commit drop as
select (select count(*) from public.trips)                                  as trips_all,
       (select coalesce(sum(commission_sar), 0::numeric) from public.trips)  as commission_total,
       (select md5(coalesce(string_agg(id::text || ':' ||
                                       coalesce(commission_sar::text, '~'),
                                       ',' order by id), ''))
          from public.trips)                                                 as trips_fingerprint,
       (select count(*) from public.project_commission_history)              as pch_rows,
       (select md5(coalesce(string_agg(id::text || ':' || effective_from::text || ':' ||
                                       commission_mode || ':' || commission_value::text || ':' ||
                                       commission_bump_pct::text || ':' || is_baseline::text,
                                       ',' order by id), ''))
          from public.project_commission_history)                            as pch_fingerprint,
       (select md5(coalesce(string_agg(id::text || ':' ||
                                       coalesce(commission_mode, '~') || ':' ||
                                       coalesce(commission_value::text, '~') || ':' ||
                                       coalesce(commission_bump_pct::text, '~'),
                                       ',' order by id), ''))
          from public.projects)                                              as proj_fingerprint;

-- ---------------------------------------------------------------------
-- 1) The function.
--
--    RETURNS TABLE, not void: the caller needs to know whether the change is
--    live now or queued, and how many unpaid delivered trips sit in its scope.
--    Returning it from the same transaction that wrote it means the UI cannot
--    show a count taken before the write.
--
--    Inside the ON CONFLICT DO UPDATE, the pre-existing row is reached through
--    the unqualified table name (project_commission_history.note) and the
--    incoming one through `excluded` - the two share every column name, so a
--    bare `note` there means nothing definite. The table name is NOT
--    schema-qualified in that position: the conflict target is resolved against
--    the statement's range table, whose entry is the bare relation name.
-- ---------------------------------------------------------------------
create or replace function public.set_project_commission(
  p_project_id     uuid,
  p_effective_from date,
  p_mode           text,
  p_value          numeric,
  p_bump_pct       numeric,
  p_note           text default null
)
-- OUTPUT NAMES ARE DELIBERATELY NOT THE COLUMN NAMES. In a plpgsql body the
-- RETURNS TABLE names become variables and are SUBSTITUTED into SQL statements,
-- so an output column called `effective_from` would be substituted into the
-- `on conflict (project_id, effective_from)` inference clause below and either
-- raise "column reference is ambiguous" or infer against the wrong thing. 0146
-- hit the same shadowing in a `language sql` body and answered it by qualifying
-- every reference with `h.`; an inference clause takes no qualifier, so here the
-- collision is removed at the source instead.
returns table (
  applied_from        date,
  applied_mode        text,
  applied_value       numeric,
  applied_bump_pct    numeric,
  applies_now         boolean,
  repriceable_trips   bigint
)
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_today      date := (now() at time zone 'Asia/Riyadh')::date;
  v_mode       text;
  v_value      numeric(12, 2);
  v_bump       numeric(6, 2);
  v_note       text;
  v_name       text;
  v_archived   timestamptz;
  v_repriceable bigint;
begin
  -- (a) The project must exist. Archived projects are refused: a soft-archived
  --     project is not being operated, and queuing terms onto one is a data
  --     entry mistake rather than an intention. Restoring it re-opens the path.
  select p.name, p.archived_at into v_name, v_archived
    from public.projects p
   where p.id = p_project_id;

  if not found then
    raise exception 'Project % does not exist.', p_project_id
      using errcode = 'no_data_found';
  end if;

  if v_archived is not null then
    raise exception
      'Project "%" is archived, so its commission terms cannot be changed. Restore it first.',
      v_name
      using errcode = 'check_violation';
  end if;

  -- (b) FORWARD ONLY. Refused, not clamped. See the header.
  if p_effective_from is null then
    raise exception 'An effective date is required.' using errcode = 'null_value_not_allowed';
  end if;

  if p_effective_from < v_today then
    raise exception
      'Commission changes cannot be backdated. The earliest allowed date is today (%), but % was given. Past trips are already priced under the terms that were in force; changing them is not an edit, it is a rewrite.',
      v_today, p_effective_from
      using errcode = 'check_violation';
  end if;

  -- (c) Shape of the values. The mode list is projects_commission_mode_check
  --     verbatim; the 0-50 bump clamp is normalizeProjectInput's, restated at
  --     the write boundary so a direct RPC call cannot get past it.
  if p_mode is null or p_mode not in ('fixed', 'scalable') then
    raise exception 'Commission mode must be fixed or scalable, not %.', coalesce(p_mode, '<null>')
      using errcode = 'check_violation';
  end if;

  if p_value is null or p_value < 0 then
    raise exception 'Commission value must be zero or more, not %.', coalesce(p_value::text, '<null>')
      using errcode = 'check_violation';
  end if;

  if coalesce(p_bump_pct, 0) < 0 or coalesce(p_bump_pct, 0) > 50 then
    raise exception 'Bump %% must be between 0 and 50, not %.', p_bump_pct
      using errcode = 'check_violation';
  end if;

  -- FIXED CARRIES NO BUMP. commissionForNthTrip() ignores bumpPct entirely when
  -- mode is fixed (scripts/commission-check.ts pins this: "fixed ignores bump%
  -- entirely"), and ProjectModal already zeroes it on submit. Normalising here
  -- means the stored row cannot claim a bump that could never apply.
  v_mode  := p_mode;
  v_value := round(p_value, 2);
  v_bump  := case when p_mode = 'fixed' then 0 else round(coalesce(p_bump_pct, 0), 2) end;
  v_note  := nullif(btrim(coalesce(p_note, '')), '');

  -- (d) HISTORY FIRST, and unconditionally. This is the write that must not
  --     depend on a diff - see the stale-column trap in the header.
  --
  --     is_baseline is NOT in the SET list, exactly as in 0147: if this lands on
  --     a project created today its one row is still that project's opening
  --     config, and clearing the flag would leave it with no baseline at all and
  --     break the invariant 0147 assertion (2) enforces.
  --
  --     `note` is preserved on a BASELINE row for the same provenance reason
  --     0147 gives, and overwritten on an ordinary change row so that a same-day
  --     re-edit reads as the edit it is.
  insert into public.project_commission_history
    (project_id, effective_from, commission_mode, commission_value,
     commission_bump_pct, note, is_baseline)
  values (p_project_id, p_effective_from, v_mode, v_value, v_bump,
          coalesce(v_note,
                   case when p_effective_from = v_today
                        then 'Commission change, effective immediately.'
                        else 'Commission change, scheduled ahead of its effective date.' end),
          false)
  on conflict (project_id, effective_from) do update set
    commission_mode     = excluded.commission_mode,
    commission_value    = excluded.commission_value,
    commission_bump_pct = excluded.commission_bump_pct,
    note                = case
                            when project_commission_history.is_baseline
                              then project_commission_history.note
                            else excluded.note
                          end;

  -- (e) MIRROR, only when the change is in force today. A future-dated change
  --     must leave projects.commission_* alone - the terms are not current yet.
  --
  --     This re-fires projects_commission_history_upd when the values differ. It
  --     upserts the same (project_id, today) row with the same three values and
  --     touches neither note nor is_baseline, so step (d)'s row survives whole.
  if p_effective_from = v_today then
    update public.projects
       set commission_mode     = v_mode,
           commission_value    = v_value,
           commission_bump_pct = v_bump
     where id = p_project_id;
  end if;

  -- (f) What the recompute may still rewrite: unpaid delivered trips on this
  --     project dated on or after the effective date. Reported, never blocked.
  --     payout_id is not null is excluded - the recompute never writes those.
  select count(*) into v_repriceable
    from public.trips t
   where t.project_id  = p_project_id
     and t.trip_date  >= p_effective_from
     and t.delivered_at is not null
     and t.payout_id is null;

  return query
  select p_effective_from,
         v_mode,
         v_value::numeric,
         v_bump::numeric,
         (p_effective_from = v_today),
         v_repriceable;
end;
$$;

comment on function public.set_project_commission(uuid, date, text, numeric, numeric, text) is
  'The ONE write path for a driver-commission change. Records a dated row in '
  'project_commission_history (upserting on a same-date re-edit) and, only when '
  'the date is today, mirrors it into projects.commission_*. Refuses any date '
  'before today in Riyadh - commission is forward-only. Writes history FIRST and '
  'unconditionally, so a change can never be lost to a no-op UPDATE when '
  'projects.commission_* has gone stale behind an activated future row.';

-- ACL mirrored from commission_config_at (0146):
-- {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
revoke all on function public.set_project_commission(uuid, date, text, numeric, numeric, text) from public;
revoke all on function public.set_project_commission(uuid, date, text, numeric, numeric, text) from anon;
grant execute on function public.set_project_commission(uuid, date, text, numeric, numeric, text) to authenticated;
grant execute on function public.set_project_commission(uuid, date, text, numeric, numeric, text) to service_role;

-- ---------------------------------------------------------------------
-- 2) CANCELLING A CHANGE THAT HAS NOT TAKEN EFFECT YET.
--
--    Every path out of this function is either one deleted row or an exception.
--    There is no third outcome, and in particular no "nothing to do" that
--    returns normally - see the header.
-- ---------------------------------------------------------------------
create or replace function public.cancel_project_commission(
  p_project_id     uuid,
  p_effective_from date
)
-- Same naming discipline as set_project_commission above: the output names are
-- deliberately NOT the column names, because in a plpgsql body RETURNS TABLE
-- names become variables and are substituted into every SQL statement in the
-- body - here that would include the DELETE's own WHERE clause.
returns table (
  cancelled_from      date,
  cancelled_mode      text,
  cancelled_value     numeric,
  cancelled_bump_pct  numeric,
  remaining_scheduled bigint
)
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_today     date := (now() at time zone 'Asia/Riyadh')::date;
  v_name      text;
  v_baseline  boolean;
  v_mode      text;
  v_value     numeric(12, 2);
  v_bump      numeric(6, 2);
  v_deleted   integer;
  v_remaining bigint;
begin
  select p.name into v_name
    from public.projects p
   where p.id = p_project_id;

  if not found then
    raise exception 'Project % does not exist.', p_project_id
      using errcode = 'no_data_found';
  end if;

  -- NO archived_at guard here, on purpose. set_project_commission has one; this
  -- function must not. See the asymmetry paragraph in the header - refusing to
  -- withdraw a queued change from an archived project strands it until the
  -- project is restored, at which point it fires.

  if p_effective_from is null then
    raise exception 'A date is required to say which scheduled change to cancel.'
      using errcode = 'null_value_not_allowed';
  end if;

  -- LOCK THE ROW BEFORE DECIDING ANYTHING ABOUT IT. Without `for update`, a
  -- concurrent set_project_commission on the same date could land between these
  -- guards and the DELETE, and the cancel would then remove figures it never
  -- read and never reported back as cancelled.
  select h.is_baseline, h.commission_mode, h.commission_value, h.commission_bump_pct
    into v_baseline, v_mode, v_value, v_bump
    from public.project_commission_history h
   where h.project_id = p_project_id
     and h.effective_from = p_effective_from
   for update;

  if not found then
    raise exception
      'No commission change is scheduled for project "%" on %. Nothing was cancelled.',
      v_name, p_effective_from
      using errcode = 'no_data_found';
  end if;

  -- THE ABSOLUTE RULE GOES FIRST. A baseline is refused whatever its date is,
  -- and the user should be told the reason that has no workaround rather than
  -- the one that does.
  if v_baseline then
    raise exception
      'The % row for project "%" is its opening commission, which every past trip resolves against, so it cannot be cancelled. Schedule a new change instead.',
      p_effective_from, v_name
      using errcode = 'check_violation';
  end if;

  if p_effective_from < v_today then
    raise exception
      'The commission change dated % on project "%" is in the past and has already priced trips, so it cannot be cancelled. It can only be superseded by a new change dated today (%) or later.',
      p_effective_from, v_name, v_today
      using errcode = 'check_violation';
  end if;

  -- TODAY IS REFUSED, NOT CLAMPED. It is in force as of this morning and may
  -- already have priced trips delivered today.
  if p_effective_from = v_today then
    raise exception
      'The commission change dated % on project "%" took effect today and may already have priced trips, so it cannot be cancelled. Schedule a new change instead. The earliest cancellable date is %.',
      p_effective_from, v_name, v_today + 1
      using errcode = 'check_violation';
  end if;

  delete from public.project_commission_history h
   where h.project_id = p_project_id
     and h.effective_from = p_effective_from;
  get diagnostics v_deleted = row_count;

  -- The row was found and locked a moment ago against the same predicate, so
  -- anything other than exactly 1 means the two WHERE clauses disagree. Raise
  -- rather than report a cancellation that did not happen.
  if v_deleted <> 1 then
    raise exception
      'Expected to cancel exactly one scheduled change for project "%" on %, but removed %. Rolling back.',
      v_name, p_effective_from, v_deleted;
  end if;

  -- NOTHING IS WRITTEN TO public.projects HERE, AND NOTHING NEEDS TO BE. Only a
  -- today-dated change ever mirrors into projects.commission_* (step (e) above),
  -- and a today-dated row cannot reach this line.

  select count(*) into v_remaining
    from public.project_commission_history h
   where h.project_id = p_project_id
     and h.effective_from > v_today;

  return query
  select p_effective_from,
         v_mode,
         v_value::numeric,
         v_bump::numeric,
         v_remaining;
end;
$$;

comment on function public.cancel_project_commission(uuid, date) is
  'Withdraws a commission change that has not taken effect yet. Deletes exactly '
  'one project_commission_history row and raises on every refusal - never a '
  'silent no-op. Refuses any date on or before today in Riyadh (a change in '
  'force may already have priced trips), refuses a baseline row at any date (it '
  'is what every past trip resolves against), and refuses a date with nothing '
  'scheduled on it. Does not touch projects.commission_* - a future-dated change '
  'never wrote there.';

revoke all on function public.cancel_project_commission(uuid, date) from public;
revoke all on function public.cancel_project_commission(uuid, date) from anon;
grant execute on function public.cancel_project_commission(uuid, date) to authenticated;
grant execute on function public.cancel_project_commission(uuid, date) to service_role;

-- ---------------------------------------------------------------------
-- 3) ASSERT THE END STATE. Any failure rolls back both functions too.
-- ---------------------------------------------------------------------
do $$
declare
  v_trips_all   bigint;
  v_total       numeric;
  v_fingerprint text;
  v_pch_rows    bigint;
  v_pch_fp      text;
  v_proj_fp     text;
  v_fn          text;
  v_secdef      boolean;
  v_lang        text;
  v_config      text[];
  v_anon_exec   boolean;
  v_auth_exec   boolean;
  v_ins_type    smallint;
  v_upd_type    smallint;
  v_views       bigint;
  v_invoker     bigint;
  v_anon_views  bigint;
begin
  -- (1) NOT ONE TRIP MOVED. The function is defined, not called.
  select count(*), coalesce(sum(commission_sar), 0::numeric),
         md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_sar::text, '~'),
                                 ',' order by id), ''))
    into v_trips_all, v_total, v_fingerprint
    from public.trips;

  if not exists (select 1 from _0148_before b
                  where b.trips_all         = v_trips_all
                    and b.commission_total  = v_total
                    and b.trips_fingerprint = v_fingerprint) then
    raise exception
      '0148 changed trips. It defines two functions and must call neither; found % rows / % total / fingerprint %. Rolling back.',
      v_trips_all, v_total, v_fingerprint;
  end if;

  -- (2) NO COMMISSION CONFIG MOVED EITHER. Same standard, applied to the table
  --     these functions exist to write - because defining a writer must not be
  --     indistinguishable from running one.
  select count(*),
         md5(coalesce(string_agg(id::text || ':' || effective_from::text || ':' ||
                                 commission_mode || ':' || commission_value::text || ':' ||
                                 commission_bump_pct::text || ':' || is_baseline::text,
                                 ',' order by id), ''))
    into v_pch_rows, v_pch_fp
    from public.project_commission_history;

  if not exists (select 1 from _0148_before b
                  where b.pch_rows        = v_pch_rows
                    and b.pch_fingerprint = v_pch_fp) then
    raise exception
      '0148 changed project_commission_history: % rows / fingerprint %. It must define both functions without invoking either. Rolling back.',
      v_pch_rows, v_pch_fp;
  end if;

  -- (3) NOR DID projects.commission_*. The mirror in set_project_commission is
  --     the only thing in this file that writes those three columns, and
  --     cancel_project_commission must never write them at all.
  select md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_mode, '~') || ':' ||
                                 coalesce(commission_value::text, '~') || ':' ||
                                 coalesce(commission_bump_pct::text, '~'),
                                 ',' order by id), ''))
    into v_proj_fp
    from public.projects;

  if not exists (select 1 from _0148_before b where b.proj_fingerprint = v_proj_fp) then
    raise exception
      '0148 changed projects.commission_*: fingerprint %. Defining a writer must not be indistinguishable from running one. Rolling back.',
      v_proj_fp;
  end if;

  -- (4) FUNCTION POSTURE, READ BACK, FOR BOTH FUNCTIONS. INVOKER is the
  --     load-bearing half - see the security section of the header. The loop is
  --     so that a second function cannot be added later with the first one's
  --     assertion still passing and saying nothing about it.
  foreach v_fn in array array['set_project_commission', 'cancel_project_commission'] loop
    select p.prosecdef, l.lanname, p.proconfig,
           has_function_privilege('anon', p.oid, 'execute'),
           has_function_privilege('authenticated', p.oid, 'execute')
      into v_secdef, v_lang, v_config, v_anon_exec, v_auth_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.proname = v_fn;

    if not found then
      raise exception '%() was not created by 0148. Rolling back.', v_fn;
    end if;

    if v_secdef is not false
       or v_lang is distinct from 'plpgsql'
       or v_config is null or not (v_config @> array['search_path=public'])
       or v_anon_exec is not false
       or v_auth_exec is not true then
      raise exception
        '%() posture is wrong: security_definer=%, language=%, config=%, anon_exec=%, auth_exec=%. Expected false / plpgsql / {search_path=public} / false / true.',
        v_fn, v_secdef, v_lang, v_config, v_anon_exec, v_auth_exec;
    end if;
  end loop;

  -- (5) THE 0147 TRIGGERS ARE UNTOUCHED. set_project_commission leans on the UPDATE
  --     trigger being idempotent with it; if either trigger has gone, the
  --     assumption in the header no longer describes the database.
  select (select t.tgtype from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname='projects'
            and t.tgname='projects_commission_history_ins'),
         (select t.tgtype from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relname='projects'
            and t.tgname='projects_commission_history_upd')
    into v_ins_type, v_upd_type;

  if v_ins_type is distinct from 5::smallint or v_upd_type is distinct from 17::smallint then
    raise exception
      'The 0147 sync triggers are not both present as expected: ins tgtype=%, upd tgtype=%. Expected 5 and 17.',
      v_ins_type, v_upd_type;
  end if;

  -- (6) NO VIEW WAS ADDED OR REPLACED. The display view is 0149; keeping them
  --     apart is what lets this assertion mean something.
  select count(*),
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']),
         count(*) filter (where has_table_privilege('anon', c.oid, 'select'))
    into v_views, v_invoker, v_anon_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname = 'public';

  if v_views <> v_invoker or v_anon_views <> 0 then
    raise exception
      'View posture moved during 0148: % views / % security_invoker / % anon-readable. Expected the two counts equal and zero anon.',
      v_views, v_invoker, v_anon_views;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION - run these separately; do NOT paste into the file above.
-- Every rehearsal writes commission config, so every one is wrapped in an
-- explicit rollback.
-- ===========================================================================
--
-- A) THE MONEY DID NOT MOVE. Capture before applying, compare after:
--      select count(*) as trips_all,
--             count(*) filter (where commission_sar is not null) as stamped,
--             sum(commission_sar) as commission_total,
--             md5(string_agg(id::text || ':' ||
--                            coalesce(commission_sar::text,'~'),
--                            ',' order by id)) as fingerprint
--        from public.trips;
--      -- Identical after. The in-file assertion gates it; run it to see it.
--
-- B) THE HISTORY TABLE DID NOT MOVE. At drafting: 8 rows / 7 baselines /
--    1 change (VVV Test 2, 2026-08-21, scalable 25.00 / 10.00 - written by the
--    0147 trigger in normal use, NOT by a migration):
--      select count(*) as rows,
--             count(*) filter (where is_baseline) as baselines,
--             count(*) filter (where not is_baseline) as changes
--        from public.project_commission_history;
--
-- C) BACKDATING IS REFUSED. No rollback needed - it must raise before it writes:
--      select * from public.set_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92', current_date - 1, 'fixed', 70, 0, null);
--      -- ERROR: Commission changes cannot be backdated...
--      -- A returned row here means the guard is not wired - REVERT.
--      select count(*) from public.project_commission_history;   -- still 8
--
-- D) TODAY-DATED: ONE ROW, AND THE MIRROR AGREES. RRR T, baseline 2026-06-28
--    fixed 60.00/0.00. ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date, 'scalable', 70, 5, 'rehearsal D');
--        -- applies_now = true. repriceable_trips = unpaid delivered trips
--        -- dated today or later on RRR T (0 at drafting).
--
--        select effective_from, commission_mode, commission_value,
--               commission_bump_pct, is_baseline, note
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--         order by effective_from;
--        -- EXACTLY 2 rows. Baseline 2026-06-28 fixed 60.00 0.00 true UNTOUCHED.
--        -- <today> scalable 70.00 5.00 false 'rehearsal D'.
--        -- THREE rows means the trigger and the function each wrote their own -
--        -- the idempotence claim in the header is false. REVERT.
--        -- A generic note ('Recorded automatically on commission config change.')
--        -- means the trigger overwrote ours - the write ORDER is reversed.
--
--        select commission_mode, commission_value, commission_bump_pct
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- scalable / 70.00 / 5.00 - the mirror ran.
--
--        -- AND THE PAST DID NOT MOVE:
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92', date '2026-07-01');
--        -- MUST still read fixed / 60.00 / 0.00.
--      rollback;
--
-- E) FUTURE-DATED: HISTORY MOVES, projects DOES NOT. This is the case 0147
--    cannot express. ROLLED BACK:
--      begin;
--        select commission_value from public.projects
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';   -- 60.00
--
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 30, 'fixed', 90, 0, 'rehearsal E');
--        -- applies_now = FALSE.
--
--        select commission_value from public.projects
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- STILL 60.00. A 90 here means the mirror ran on a future date and the
--        -- terms went live 30 days early - REVERT.
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date);
--        -- fixed / 60.00 / 0.00 - today is unaffected.
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 30);
--        -- fixed / 90.00 / 0.00 - it activates on its own date, no job, no timer.
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 29);
--        -- fixed / 60.00 / 0.00 - the day before is still the old terms.
--      rollback;
--
-- F) SAME-DATE RE-EDIT UPSERTS, never appends. ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 7, 'fixed', 80, 0, 'first');
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 7, 'scalable', 85, 6, 'second');
--        select count(*) as rows_for_that_date
--          from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--           and effective_from = (now() at time zone 'Asia/Riyadh')::date + 7;
--        -- 1. Reads scalable / 85.00 / 6.00 / note 'second'.
--      rollback;
--
-- G) THE STALE-COLUMN TRAP IS CLOSED. This is the whole reason the function
--    writes history before it mirrors. ROLLED BACK:
--      begin;
--        -- Manufacture the stale state: projects says 60, an "activated" row
--        -- dated today says 80. (Dated today rather than in the past so the
--        -- setup itself is not a backdate.)
--        insert into public.project_commission_history
--          (project_id, effective_from, commission_mode, commission_value,
--           commission_bump_pct, note, is_baseline)
--        values ('fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--                (now() at time zone 'Asia/Riyadh')::date, 'fixed', 80, 0, 'setup', false);
--        -- projects.commission_value is untouched and still reads 60 - stale.
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date);        -- 80.00
--        select commission_value from public.projects
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'; -- 60.00
--
--        -- The user is shown 80 and edits it to 60. Against projects this is a
--        -- no-op UPDATE and the 0147 trigger never fires.
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date, 'fixed', 60, 0, 'the edit');
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date);
--        -- MUST read 60.00. An 80.00 here is the trap still open: the edit was
--        -- confirmed on screen and changed nothing. That is the defect this
--        -- function exists to prevent - REVERT.
--      rollback;
--
-- H) AN ARCHIVED PROJECT IS REFUSED, and a nonexistent one too:
--      select * from public.set_project_commission(
--        gen_random_uuid(), current_date, 'fixed', 10, 0, null);
--      -- ERROR: Project ... does not exist.
--
-- I) SHAPE GUARDS. Each must raise, none must write:
--      select * from public.set_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92', current_date, 'hourly', 10, 0, null);
--      select * from public.set_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92', current_date, 'fixed', -1, 0, null);
--      select * from public.set_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92', current_date, 'scalable', 10, 51, null);
--      select count(*) from public.project_commission_history;   -- still 8
--
--    And fixed normalises the bump away rather than storing one that can never
--    apply. ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92', current_date, 'fixed', 10, 40, null);
--        -- returned applied_bump_pct = 0.00, not 40.00.
--      rollback;
--
-- J) SECURITY, READ BACK RATHER THAN ASSUMED. BOTH functions, two rows:
--      select p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public'
--         and p.proname in ('set_project_commission','cancel_project_commission');
--      -- 2 rows, each: false / v / {search_path=public} /
--      -- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      -- prosecdef TRUE on either would be a privilege escalation - see the header.
--      -- ONE row means a function is missing; the in-file assertion (4) should
--      -- already have rolled the file back, so seeing one here means the
--      -- assertion is not wired.
--
-- K) NO VIEW WAS ADDED - the section 6 counts are untouched:
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='v' and n.nspname='public';
--      -- expect 47 / 47 / 0, unchanged. 0149 takes it to 48 / 48 / 0.
--
-- L) THE TEMP TABLE DID NOT SURVIVE:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname = '_0148_before';
--      -- expect 0.
--
-- ---------------------------------------------------------------------------
-- CANCELLATION (M - R). Every one of these either deletes a row or must raise.
-- ---------------------------------------------------------------------------
--
-- M) CANCELLING A QUEUED CHANGE REMOVES IT AND TOUCHES NOTHING ELSE.
--    ROLLED BACK:
--      begin;
--        select commission_mode, commission_value, commission_bump_pct
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- fixed / 60.00 / 0.00 - write these three down.
--
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 14, 'scalable', 95, 8, 'rehearsal M');
--        -- applies_now = false.
--
--        select * from public.cancel_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 14);
--        -- ONE row: cancelled_from = +14, cancelled_mode = scalable,
--        -- cancelled_value = 95.00, cancelled_bump_pct = 8.00,
--        -- remaining_scheduled = 0. It reports WHAT it removed, so the UI can
--        -- name it in the confirmation rather than say "done".
--
--        select count(*) from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--           and effective_from = (now() at time zone 'Asia/Riyadh')::date + 14;
--        -- 0. The row is gone, not flagged.
--
--        select commission_mode, commission_value, commission_bump_pct
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- IDENTICAL to the three written down above. Any movement here means
--        -- the cancel wrote to projects, which it must never do - REVERT.
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 14);
--        -- back to fixed / 60.00 / 0.00 - the future has been returned to the
--        -- terms that were already in force.
--      rollback;
--
-- N) A TODAY-DATED CHANGE IS REFUSED, NOT CLAMPED, AND SURVIVES THE REFUSAL.
--    ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date, 'fixed', 75, 0, 'rehearsal N');
--        select * from public.cancel_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date);
--        -- ERROR: ... took effect today and may already have priced trips ...
--        -- SQLSTATE 23514. A returned row here is the guard missing.
--      rollback;
--      -- Then, in a FRESH transaction, prove the refusal left it alone. If the
--      -- raise had been a clamp onto "the next scheduled row", a DIFFERENT
--      -- change would have vanished instead - which is the reason it is a raise:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date, 'fixed', 75, 0, 'rehearsal N');
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 3, 'fixed', 85, 0, 'the next one');
--        savepoint s;
--          select * from public.cancel_project_commission(
--            'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--            (now() at time zone 'Asia/Riyadh')::date);   -- raises
--        rollback to savepoint s;
--        select effective_from, commission_value from public.project_commission_history
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'
--           and effective_from >= (now() at time zone 'Asia/Riyadh')::date
--         order by effective_from;
--        -- BOTH rows still there: today 75.00 and +3 85.00. Neither was touched.
--      rollback;
--
-- O) A BASELINE IS REFUSED, AND THE BASELINE REASON WINS OVER THE DATE REASON.
--    RRR T's baseline is 2026-06-28, which is BOTH a baseline AND in the past, so
--    this is also the ordering proof:
--      select * from public.cancel_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92', date '2026-06-28');
--      -- ERROR: The 2026-06-28 row ... is its opening commission ...
--      -- If the message instead says "is in the past", the two guards are the
--      -- wrong way round: a FUTURE-dated baseline would then fall through the
--      -- date check and be deleted. That is the case this ordering exists for.
--      select count(*) from public.project_commission_history
--       where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92' and is_baseline;
--      -- still 1.
--
-- P) A PAST NON-BASELINE CHANGE IS REFUSED. Nothing on live is both past and
--    non-baseline at drafting, so the row is manufactured. ROLLED BACK:
--      begin;
--        insert into public.project_commission_history
--          (project_id, effective_from, commission_mode, commission_value,
--           commission_bump_pct, note, is_baseline)
--        values ('fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--                (now() at time zone 'Asia/Riyadh')::date - 7,
--                'fixed', 65, 0, 'rehearsal P setup', false);
--        select * from public.cancel_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date - 7);
--        -- ERROR: ... is in the past and has already priced trips ...
--        -- NOT the baseline message - this row is is_baseline = false, so the
--        -- second guard is the one that must fire.
--      rollback;
--
-- Q) A DATE WITH NOTHING ON IT RAISES RATHER THAN REPORTING SUCCESS:
--      select * from public.cancel_project_commission(
--        'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--        (now() at time zone 'Asia/Riyadh')::date + 999);
--      -- ERROR: No commission change is scheduled for project "RRR T" on ...
--      -- SQLSTATE 02000. A zero-row result here is the silent no-op the header
--      -- rejects: the user is told the change was withdrawn and it was not.
--      select * from public.cancel_project_commission(gen_random_uuid(), current_date + 1);
--      -- ERROR: Project ... does not exist.
--
-- R) THE ARCHIVED ASYMMETRY, BOTH HALVES. ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 21, 'fixed', 100, 0, 'rehearsal R');
--
--        update public.projects set archived_at = now()
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--
--        savepoint s;
--          select * from public.set_project_commission(
--            'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--            (now() at time zone 'Asia/Riyadh')::date + 28, 'fixed', 110, 0, null);
--          -- ERROR: Project "RRR T" is archived ... ADDING is refused.
--        rollback to savepoint s;
--
--        select * from public.cancel_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 21);
--        -- SUCCEEDS. REMOVING is allowed. An error here means an archived
--        -- project's queued change is stranded until it is restored, at which
--        -- point it fires unannounced.
--      rollback;
-- ===========================================================================
