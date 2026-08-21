-- 0149_v_project_commission_now.sql
-- The commission terms IN FORCE TODAY, per project, for DISPLAY.
-- Step 3b of 3. 3a is the write RPC (0148); 3c is app code.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
--
-- ===========================================================================
-- WHY A VIEW AND NOT "JUST READ projects.commission_*"
-- ===========================================================================
-- Once 0148 lands, a commission change can be dated in the FUTURE, and a
-- future-dated change deliberately does NOT move projects.commission_*. On the
-- day it activates, the three columns on `projects` stop describing the terms in
-- force. Nothing recalculates them, because there is no job and none is wanted -
-- commission_config_at(project, date) answers from the history table on demand.
--
-- So projects.commission_* becomes a WRITE-SIDE MIRROR of the last today-dated
-- change, not a current-value column. Every screen still reading it is showing a
-- figure that is right until the first future-dated change activates and quietly
-- wrong afterwards.
--
-- The rule "which config is in force on day X" already has exactly one
-- expression - commission_config_at(). This view does not add a second: it CALLS
-- it. Resolving "today's terms" by hand in a page loader (an order-by-desc-limit-1
-- over project_commission_history) would be a second copy of a money-bucketing
-- rule, which is the class of duplicate lib/commission.ts's monthKeyOf header
-- describes hunting down and deleting.
--
-- ===========================================================================
-- WHY NOT ONE RPC CALL PER PROJECT INSTEAD
-- ===========================================================================
-- The surfaces that need this render a LIST: the projects table, the customers
-- table, the trips-page project header. Calling the resolver per row is N round
-- trips to answer one question, and PostgREST cannot join an .rpc() to a
-- .from('projects') select. A view is joinable and selectable in the same request
-- the page already makes.
--
-- THE ARCHIVE PAGE IS NOT ONE OF THESE SURFACES, and is deliberately left out.
-- "What commission did this archived project run on" is a question about the day
-- it was archived, not about today - today's answer for a dead project is a
-- figure that was never in force for a single trip. That surface renders ONE
-- project at a time, so it can call commission_config_at(project, archived_date)
-- directly and get the honest answer. Folding both questions into one view would
-- make the column mean two things depending on the row.
--
-- ===========================================================================
-- WHAT `projects_column_is_stale` IS FOR
-- ===========================================================================
-- The last column compares projects.commission_* against the resolved in-force
-- config and reports disagreement. It is a DRIFT GUARD in the house pattern
-- (v_driver_state_now's, asserted at Dashboard load) and it is expected to read
-- FALSE for every project until the first future-dated change activates.
--
-- It is not decoration. While update_project_with_customer still writes the three
-- columns - see 0148's OPEN DECISION - a TRUE here means a project save is one
-- click away from stamping today-dated history for a change nobody made. Having
-- the condition queryable is what makes that observable instead of theoretical.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT DO
-- ===========================================================================
-- · No write to `trips`, `projects`, or `project_commission_history`. Asserted -
--   a view definition must not move a figure, and this one is read-only by
--   construction, but the fingerprint costs nothing and says so.
-- · No change to commission_config_at(), to set_project_commission(), or to
--   either 0147 trigger.
-- · No REPLACEMENT of an existing view - this is a new name, so the 42P16
--   append-only restriction in CLAUDE.md section 6 does not apply here. It WILL
--   apply to every future change to this view: columns can only be appended.
-- · No app change. Nothing selects from this view until 3c.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Fingerprint. A view cannot write, and this proves it did not.
-- ---------------------------------------------------------------------
create temp table _0149_before on commit drop as
select (select coalesce(sum(commission_sar), 0::numeric) from public.trips)     as commission_total,
       (select md5(coalesce(string_agg(id::text || ':' ||
                                       coalesce(commission_sar::text, '~'),
                                       ',' order by id), ''))
          from public.trips)                                                    as trips_fingerprint,
       (select count(*) from public.project_commission_history)                 as pch_rows,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'v' and n.nspname = 'public')                        as views_before;

-- ---------------------------------------------------------------------
-- 1) The view.
--
--    `now()` inside a view is evaluated per query, in the querying transaction,
--    so this answers "today" at read time rather than freezing the day the view
--    was created. `at time zone 'Asia/Riyadh'` matches 0147's trigger and 0148's
--    guard exactly - a UTC date here would show yesterday's terms between 00:00
--    and 02:59 Riyadh, which is the same three-hour trap lib/commission.ts's
--    monthKeyOf header documents from the app side.
--
--    LEFT JOIN LATERAL, not an inner join: a project whose earliest history row
--    is dated after today resolves to NO ROW, and that project must still appear
--    here with NULL terms rather than vanish from a projects list. NULL terms on
--    screen is a visible problem; a missing project is an invisible one. It
--    cannot happen today (every baseline sits at or below the project floor, and
--    0147 assertion (4) holds the invariant) but the join type is what keeps a
--    display surface from silently dropping rows if it ever does.
--
--    Archived projects are INCLUDED. Filtering is the caller's job - the trips
--    page already filters `archived_at is null` on projects and joins by id, and
--    a view that pre-filters would force a second view for the surfaces that do
--    not want that.
-- ---------------------------------------------------------------------
create or replace view public.v_project_commission_now as
select p.id                              as project_id,
       p.archived_at,
       -- The terms in force TODAY. NULL only if no history row is on or before
       -- today, which is the same no-row signal the resolver gives the pricing
       -- path - and which 2b hard-errors on rather than guessing.
       c.commission_mode,
       c.commission_value,
       c.commission_bump_pct,
       -- The next SCHEDULED change, if one is queued. NULL when nothing is
       -- pending. This is what lets a screen say "changes to X on the 1st"
       -- instead of showing today's figure with no hint that it is about to move.
       nx.effective_from                 as next_effective_from,
       nx.commission_mode                as next_commission_mode,
       nx.commission_value               as next_commission_value,
       nx.commission_bump_pct            as next_commission_bump_pct,
       -- DRIFT GUARD. See the header. Expected false everywhere until the first
       -- future-dated change activates.
       ((p.commission_mode, p.commission_value, p.commission_bump_pct)
         is distinct from
        (c.commission_mode, c.commission_value, c.commission_bump_pct))
                                         as projects_column_is_stale
  from public.projects p
  left join lateral public.commission_config_at(
         p.id, (now() at time zone 'Asia/Riyadh')::date
       ) c on true
  left join lateral (
         select h.effective_from, h.commission_mode, h.commission_value,
                h.commission_bump_pct
           from public.project_commission_history h
          where h.project_id = p.id
            and h.effective_from > (now() at time zone 'Asia/Riyadh')::date
          order by h.effective_from
          limit 1
       ) nx on true;

comment on view public.v_project_commission_now is
  'Driver-commission terms IN FORCE TODAY (Riyadh) per project, resolved through '
  'commission_config_at() - the one definition - plus the next scheduled change '
  'if any. THE DISPLAY SOURCE for current terms; projects.commission_* is a '
  'write-side mirror of the last today-dated change and goes stale the moment a '
  'future-dated change activates. Not for pricing: a trip is priced at '
  'commission_config_at(project, trip_date), never at today.';

-- SECTION 6 SECURITY FOOTER. Restated in full, as every view replacement must
-- be - `create or replace view` silently drops reloptions.
alter view public.v_project_commission_now set (security_invoker = true);
revoke all on public.v_project_commission_now from anon;
grant select on public.v_project_commission_now to authenticated;

-- ---------------------------------------------------------------------
-- 2) ASSERT THE END STATE.
-- ---------------------------------------------------------------------
do $$
declare
  v_total      numeric;
  v_fp         text;
  v_pch        bigint;
  v_views      bigint;
  v_invoker    bigint;
  v_anon_v     bigint;
  v_before_v   bigint;
  v_this_inv   boolean;
  v_anon_sel   boolean;
  v_auth_sel   boolean;
  v_stale      bigint;
  v_unresolved bigint;
begin
  -- (1) NOTHING WAS WRITTEN.
  select coalesce(sum(commission_sar), 0::numeric),
         md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_sar::text, '~'),
                                 ',' order by id), ''))
    into v_total, v_fp from public.trips;
  select count(*) into v_pch from public.project_commission_history;

  if not exists (select 1 from _0149_before b
                  where b.commission_total  = v_total
                    and b.trips_fingerprint = v_fp
                    and b.pch_rows          = v_pch) then
    raise exception
      '0149 changed data. A view definition must write nothing; trips total %, fingerprint %, history rows %. Rolling back.',
      v_total, v_fp, v_pch;
  end if;

  -- (2) EXACTLY ONE VIEW WAS ADDED, and the section 6 counts still agree.
  select count(*),
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']),
         count(*) filter (where has_table_privilege('anon', c.oid, 'select'))
    into v_views, v_invoker, v_anon_v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname = 'public';

  select b.views_before into v_before_v from _0149_before b;

  if v_views <> v_before_v + 1 then
    raise exception
      'Expected exactly one new view: % before, % after.', v_before_v, v_views;
  end if;

  if v_views <> v_invoker or v_anon_v <> 0 then
    raise exception
      'View posture is wrong after 0149: % views / % security_invoker / % anon-readable. The two counts must match with zero anon.',
      v_views, v_invoker, v_anon_v;
  end if;

  -- (3) THIS view specifically - the aggregate above can pass while the new one
  --     is the broken member if another view were somehow miscounted.
  select (c.reloptions::text[] @> array['security_invoker=true']),
         has_table_privilege('anon', c.oid, 'select'),
         has_table_privilege('authenticated', c.oid, 'select')
    into v_this_inv, v_anon_sel, v_auth_sel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'v_project_commission_now';

  if v_this_inv is not true or v_anon_sel is not false or v_auth_sel is not true then
    raise exception
      'v_project_commission_now security is wrong: security_invoker=%, anon_select=%, auth_select=%. Expected true / false / true.',
      v_this_inv, v_anon_sel, v_auth_sel;
  end if;

  -- (4) IT AGREES WITH projects.commission_* TODAY. This is the no-op proof for
  --     3c: repointing the display surfaces at this view must not move a figure
  --     on screen. A non-zero count is not necessarily a fault - it is exactly
  --     what a project with an ACTIVATED future-dated change looks like - but
  --     none can exist yet, because set_project_commission() is the only way to
  --     create one and 0148 does not call it.
  select count(*) into v_stale
    from public.v_project_commission_now where projects_column_is_stale;

  if v_stale <> 0 then
    raise exception
      '% project(s) already disagree with projects.commission_*. Nothing has been able to create a future-dated change yet, so this means the resolver and the columns have drifted by some other route. Read it before continuing.',
      v_stale;
  end if;

  -- (5) EVERY PROJECT RESOLVES. A NULL here would mean a project whose earliest
  --     history row is dated after today - it would render as blank terms and,
  --     more seriously, its trips would hit 2b's hard error.
  select count(*) into v_unresolved
    from public.v_project_commission_now where commission_mode is null;

  if v_unresolved <> 0 then
    raise exception
      '% project(s) resolve to no commission config today. Every project must have a baseline at or before its floor - see 0147 assertion (2).',
      v_unresolved;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION - run these separately; do NOT paste into the file above.
-- Nothing here writes, except rehearsal D which is rolled back.
-- ===========================================================================
--
-- A) THE SHAPE, AND THE NO-OP PROOF. Every row must agree with projects today,
--    and next_* must be NULL everywhere (nothing can schedule yet):
--      select p.name, v.commission_mode, v.commission_value, v.commission_bump_pct,
--             v.next_effective_from, v.projects_column_is_stale
--        from public.v_project_commission_now v
--        join public.projects p on p.id = v.project_id
--       order by p.name;
--      -- At drafting, expect 7 rows matching projects.commission_* exactly:
--      --   Airport facilities        scalable  12.00   2.00
--      --   King Salman Park (1bbf)   fixed     10.00   0.00
--      --   King Salman Park (7a94)   scalable  10.00   3.00
--      --   King Saud University      fixed     20.00   0.00
--      --   RRR T                     fixed     60.00   0.00
--      --   The Royal Court of Saudi  scalable  10.00  10.00
--      --   VVV Test 2                scalable  25.00  10.00
--      -- VVV Test 2 reads 25.00 because a REAL today-dated edit was recorded by
--      -- the 0147 trigger on 2026-08-21. Its BASELINE is still 10.00 and its
--      -- June/July trips still price at 10.00 - which is the whole point.
--      -- next_effective_from: NULL on all 7. projects_column_is_stale: false on
--      -- all 7 (assertion (4) gates this).
--
-- B) IT IS NOT A PRICING SOURCE, and the difference is visible. Today's terms
--    vs the terms a past trip is actually priced under:
--      select v.commission_value as in_force_today,
--             c.commission_value as in_force_on_2026_07_10
--        from public.v_project_commission_now v
--        left join lateral public.commission_config_at(
--          v.project_id, date '2026-07-10') c on true
--       where v.project_id = '70dc...';   -- VVV Test 2
--      -- 25.00 vs 10.00. Anything that PRICES must use the second column.
--
-- C) SECURITY, READ BACK:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon', c.oid, 'select')          as anon_sel,
--             has_table_privilege('authenticated', c.oid, 'select') as auth_sel
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_project_commission_now';
--      -- {security_invoker=true} / false / true
--
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='v' and n.nspname='public';
--      -- 48 / 48 / 0 (was 47 / 47 / 0). CLAUDE.md section 7's view count moves.
--
-- D) THE FUTURE-DATED CASE, END TO END. Requires 0148. ROLLED BACK:
--      begin;
--        select * from public.set_project_commission(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date + 14, 'fixed', 90, 0, 'rehearsal');
--
--        select commission_value, next_effective_from, next_commission_value,
--               projects_column_is_stale
--          from public.v_project_commission_now
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- 60.00 / <today+14> / 90.00 / false
--        -- Today's terms unchanged, the pending change VISIBLE, and not yet
--        -- stale because it has not activated. A 90.00 in the first column
--        -- means the terms went live 14 days early - REVERT.
--      rollback;
--
-- E) THE DRIFT FLAG ACTUALLY FIRES. Manufacture an activated future change by
--    writing a today-dated history row WITHOUT touching projects - the exact
--    state a future-dated change reaches on its effective date. ROLLED BACK:
--      begin;
--        insert into public.project_commission_history
--          (project_id, effective_from, commission_mode, commission_value,
--           commission_bump_pct, note, is_baseline)
--        values ('fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--                (now() at time zone 'Asia/Riyadh')::date, 'fixed', 90, 0, 'setup', false);
--
--        select commission_value, projects_column_is_stale
--          from public.v_project_commission_now
--         where project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- 90.00 / TRUE. A false here means the guard compares nothing and the
--        -- column is decoration - REVERT.
--      rollback;
--
-- F) THE TEMP TABLE DID NOT SURVIVE:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname = '_0149_before';
--      -- expect 0.
-- ===========================================================================
