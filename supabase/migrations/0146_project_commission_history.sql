-- 0146_project_commission_history.sql
-- Effective-dated DRIVER-COMMISSION config, keyed on PROJECT.
-- Step 1 of 3: the table, the baseline backfill, and the resolver.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
--
-- ===========================================================================
-- WHAT THIS IS FOR — the gap it closes, stated before the DDL
-- ===========================================================================
-- Driver commission config lives on `projects` as THREE MUTABLE COLUMNS:
-- commission_mode ('fixed' | 'scalable'), commission_value, commission_bump_pct.
-- There is exactly one value per project and it has no date. Editing it in the
-- project modal is a plain overwrite; the previous rate is gone.
--
-- The per-trip figure `trips.commission_sar` is STAMPED at delivery from those
-- columns AS THEY READ AT THAT MOMENT. That is the whole of the freeze, and it
-- is not as frozen as it looks:
--
--   · Editing project config does NOT re-stamp anything. The modal's own copy
--     says so: "Changes apply to future trips - already-delivered trips keep
--     their stamped commission."
--   · But `recomputeDailyCommission` (app/trips/actions.ts) DOES re-read the
--     CURRENT project config and reprice every UNPAID delivered trip in that
--     driver+project+trip_date bucket, and it runs on ordinary stage churn.
--     So a trip delivered in June under a 60 SAR rate is silently repriced at
--     today's rate the next time anything in its day-bucket is touched.
--   · `payout_id is not null` is the only true freeze. Paid trips keep their
--     slot in the scalable ramp numbering but are never rewritten.
--
-- So the config a past trip was priced under is unrecoverable, and the past can
-- move. This table makes the config itself dated, so "what was the rate on the
-- day this trip ran" becomes a question the database can answer.
--
-- THIS FILE DOES NOT WIRE ANY OF THAT UP. It is deliberately inert: it adds a
-- table, seeds it, and adds a read-only function that nothing calls yet. Step 2
-- changes the stamp and the recompute to read `commission_config_at()`. Landing
-- the structure while it cannot move a figure is the 0127 precedent - applying a
-- money change while it is provably a no-op is far safer than applying it after
-- the first rate edit, when several figures move at once and there is no clean
-- before/after.
--
-- ===========================================================================
-- IT TOUCHES NO TRIP. THAT IS ASSERTED, NOT CLAIMED.
-- ===========================================================================
-- No statement below writes to `trips`. Rather than ask you to take that on a
-- reading, block 0 fingerprints every trip's id + commission_sar into a temp
-- table at the top of the transaction and the assertions at the foot re-compute
-- it and compare. Any drift rolls the whole file back.
--
-- The fingerprint is CAPTURED, not hardcoded. A literal md5 in the file would
-- make this migration fail on a rebuilt database, or if one more trip is
-- delivered between drafting and applying - failures that have nothing to do
-- with what is being checked. Live reads 818 trips / 744 delivered / 744
-- stamped / 15,820.16 SAR total as of drafting; those numbers appear only in the
-- VERIFICATION block, as a sanity read, never as a gate.
--
-- ===========================================================================
-- THE BASELINE DATE — WHICH FLOOR, AND WHY
-- ===========================================================================
-- Every project gets EXACTLY ONE baseline row carrying its CURRENT config. The
-- only real decision is what date to put on it, and 0125/0126 already paid for
-- getting this wrong once:
--
--   0125 seeded every salary baseline at TODAY, so that one row was both the
--   immutable baseline AND today's current figure. The first raise anyone
--   entered upserted onto today's date, rewrote the baseline, and moved June and
--   July payroll. 0126 fixed it by moving the baseline BACKWARD to each person's
--   employment floor - which made the collision impossible rather than policed,
--   and removed the fallback branch entirely.
--
-- Same shape here. The floor chosen is:
--
--     least( projects.start_date,
--            min(trips.trip_date) for that project,
--            (projects.created_at at time zone 'Asia/Riyadh')::date )
--
-- `least()` ignores NULLs in Postgres and created_at is NOT NULL, so this always
-- yields a date. All three candidates are project-owned facts; none is invented.
--
-- WHY NOT A SENTINEL (1900-01-01). 0117 rejected a sentinel for the employment
-- floor and 0126 refused to reintroduce one. A sentinel also reads as a lie on
-- screen once this table is ever displayed: it asserts the rate was in force
-- decades before the customer existed. The project's own floor is honest and is
-- as early as any real fact about the project goes.
--
-- WHY ALL THREE TERMS AND NOT JUST created_at. On live today created_at is the
-- least term for all 7 projects, so the expression currently reduces to it. The
-- other two are in there because the INVARIANT is "on or before anything that
-- can be priced", not "the creation date" - and start_date in particular is NULL
-- on all 7 projects today, so it costs nothing now and is correct the day a
-- project is entered with a backdated contract start.
--
-- Measured floors (drafting date 2026-08-21) - floor <= earliest trip in all 7:
--
--     King Salman Park  (1bbf...)  floor 2026-06-27   earliest trip 2026-06-29
--     King Salman Park  (7a94...)  floor 2026-06-27   earliest trip 2026-06-27
--     VVV Test 2        (70dc...)  floor 2026-06-28   earliest trip 2026-06-29
--     RRR T             (fd40...)  floor 2026-06-28   earliest trip 2026-06-29
--     Royal Court       (0024...)  floor 2026-06-30   earliest trip 2026-06-30
--     King Saud Univ.   (dfab...)  floor 2026-07-11   earliest trip 2026-07-11
--     Airport facilities(4294...)  floor 2026-07-16   earliest trip 2026-07-16
--
-- Three of them sit ON their earliest trip. That is not a near miss: the
-- resolver's comparison is `effective_from <= p_on`, so an equal date resolves.
--
-- ===========================================================================
-- THE ONE HOLE, NAMED RATHER THAN HIDDEN -- OPEN, and Turki's call
-- ===========================================================================
-- Because the floor is a natural date and not a sentinel, a trip BACKDATED to
-- before its project's floor would resolve to NOTHING. Nothing in the schema
-- stops that: trip_date is free-entry and no constraint ties it to the project.
-- It has never happened - every project's earliest trip is on or after its
-- floor, which is what the assertion at the foot proves - but it is possible.
--
-- Two things are done about it here, and one is deliberately left undone:
--
--   · The resolver RETURNS ZERO ROWS in that case, not a row of NULLs and not a
--     row of zeroes. Zero rows is a signal step 2 can branch on. A commission of
--     0 SAR and "there is no config for this date" must not look alike in the
--     money path.
--   · Assertion (4) below proves no such trip exists at apply time.
--   · NOT DONE: no earliest-row fallback. 0125 had one and it was the mechanism
--     by which the past got rewritten. The rule stays single-branch, exactly as
--     specified: the greatest effective_from <= the date asked for. **Whether
--     step 2 should hard-error or fall back to `projects.commission_*` when the
--     resolver returns nothing is Turki's call, and belongs in step 2, not here.**
--
-- ONE DELIVERED TRIP HAS NO PROJECT AT ALL and therefore no baseline, ever:
--   id 2bf32c2d-6747-400b-bb8b-9e5db37c7317, trip_date 2026-07-15,
--   stage delivered, commission_sar 0.00.
-- It is already stamped at 0.00 and this file does not touch it. It is called
-- out because the assertions below scope to trips WITH a project (743 of the
-- 744 delivered), and that exclusion should be a stated fact rather than a
-- silently narrower query.
--
-- ===========================================================================
-- SECURITY POSTURE - MIRRORED FROM THE SIBLINGS, INCLUDING WHAT IS ABSENT
-- ===========================================================================
-- TABLE: same as `salary_history` (0125) - RLS enabled, ONE policy,
-- `for all to authenticated using (true) with check (true)`.
--
-- No `revoke ... from anon` on the table, and that is intentional rather than an
-- omission. Every base table in this schema carries Supabase's default anon
-- grant and is gated by RLS instead; salary_history, projects and trips all read
-- `has_table_privilege('anon', ..., 'select') = true` today and are all closed by
-- their to-authenticated policies. CLAUDE.md section 6's revoke-from-anon rule is
-- about VIEWS, which have no RLS of their own. Adding a table-level revoke here
-- would make this table the only one of its kind in the schema - a difference a
-- future reader would have to explain. Assertions (5) and (6) check the parts
-- that actually gate: RLS on, and the policy present.
--
-- FUNCTION: mirrored from `consumption_event_completed_at`, the schema's other
-- read-only SQL helper - `language sql`, `stable`, `security invoker`,
-- `set search_path to 'public'`, and an ACL of exactly
-- {postgres, authenticated, service_role} with EXECUTE revoked from PUBLIC and
-- anon. SECURITY INVOKER is the load-bearing half: the function reads an
-- RLS-enabled table, so an owner-run (definer) version would hand every caller
-- the whole commission history regardless of policy.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT DO
-- ===========================================================================
-- · No write to `trips`, and none to `trips.commission_sar`. Asserted.
-- · No change to `projects`. The three commission columns stay exactly where
--   they are and stay the source of truth until step 2 says otherwise. This
--   table is a SHADOW today.
-- · No trigger. Nothing keeps this table in sync with `projects` yet - by
--   design, because a trigger added now would start writing history rows that
--   nothing reads, from an edit path step 2 is about to change anyway.
-- · No view, so the view/security_invoker/anon counts are untouched (47/47/0).
-- · No call site. `commission_config_at()` has zero callers on purpose.
-- · No upper bound on commission_bump_pct - `projects` has none either (the
--   0-50 clamp lives in normalizeProjectInput, in app code). Inventing a CHECK
--   the source column lacks would let the backfill fail on data `projects`
--   accepts.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Fingerprint every trip BEFORE anything else runs. Assertion (1) at the
--    foot re-computes this and compares. `on commit drop` disposes of it when
--    the transaction ends, so nothing survives into the schema.
-- ---------------------------------------------------------------------
create temp table _0146_trips_before on commit drop as
select count(*)                                              as trips_all,
       count(*) filter (where commission_sar is not null)     as stamped,
       coalesce(sum(commission_sar), 0::numeric)              as commission_total,
       md5(coalesce(string_agg(id::text || ':' ||
                               coalesce(commission_sar::text, '~'),
                               ',' order by id), ''))         as fingerprint
  from public.trips;

-- ---------------------------------------------------------------------
-- 1) The table.
--
--    Types are lifted from `projects` rather than left bare: commission_value
--    numeric(12,2) and commission_bump_pct numeric(6,2) are what the source
--    columns are, and a widening here would let a value round on the way back.
--    The mode CHECK is `projects_commission_mode_check` verbatim.
--
--    ON DELETE CASCADE follows salary_history: history for a project that no
--    longer exists is unreadable by definition. (Projects are soft-archived in
--    this app, so this fires only on a genuine hard delete.)
-- ---------------------------------------------------------------------
create table if not exists public.project_commission_history (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  effective_from      date not null,
  commission_mode     text not null,
  commission_value    numeric(12, 2) not null,
  commission_bump_pct numeric(6, 2) not null default 0,
  note                text,
  created_at          timestamptz not null default now(),
  is_baseline         boolean not null default false,
  constraint project_commission_history_mode_check
    check (commission_mode = any (array['fixed'::text, 'scalable'::text])),
  constraint project_commission_history_value_nonneg
    check (commission_value >= 0),
  constraint project_commission_history_bump_nonneg
    check (commission_bump_pct >= 0)
);

comment on table public.project_commission_history is
  'Effective-dated driver-commission config per project. The row in force on a '
  'given day is the one with the greatest effective_from <= that day; read it '
  'through commission_config_at(), never by hand. projects.commission_mode / '
  '_value / _bump_pct remain the current-value columns and the edit surface.';

comment on column public.project_commission_history.effective_from is
  'First day this config applies. Baselines sit at the project floor - least of '
  'start_date, earliest trip_date and created_at (Riyadh) - so a change dated '
  'today can never collide with one. Same reasoning as 0126.';

comment on column public.project_commission_history.is_baseline is
  'True for the one row per project seeded by 0146 from projects.commission_*. '
  'Informational: the resolution rule does not read this column.';

-- UNIQUE, not merely indexed. Two things depend on it:
--   (a) the resolver's "greatest effective_from" is only well defined if a
--       project cannot hold two rows on one date;
--   (b) step 2's same-day edit needs a conflict target to upsert onto, exactly
--       as salary_history's trigger uses (driver_id, effective_from).
create unique index if not exists project_commission_history_project_date
  on public.project_commission_history (project_id, effective_from);

-- Descending companion for the lookup the resolver actually performs.
create index if not exists project_commission_history_lookup
  on public.project_commission_history (project_id, effective_from desc);

alter table public.project_commission_history enable row level security;

drop policy if exists authenticated_all_project_commission_history
  on public.project_commission_history;
create policy authenticated_all_project_commission_history
  on public.project_commission_history
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 2) Backfill: exactly one baseline per project, carrying that project's
--    CURRENT config, dated at the project floor.
--
--    Guarded twice on purpose. `not exists (... is_baseline)` is the real
--    idempotence - it keeps the count at one baseline per project no matter
--    what date a re-run would compute. `on conflict do nothing` is the
--    belt-and-braces for the exact-date collision.
--
--    Values are copied, never recomputed. commission_value and
--    commission_bump_pct go across as-is; assertion (3) reads them back.
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
       'Baseline seeded by 0146 from projects.commission_* at the project floor.',
       true
  from public.projects p
 where not exists (
         select 1 from public.project_commission_history h
          where h.project_id = p.id and h.is_baseline
       )
on conflict (project_id, effective_from) do nothing;

-- ---------------------------------------------------------------------
-- 3) The resolver. ONE definition of "which config applied on day X" - the
--    stamp and the recompute will both call this in step 2, so the two can
--    never drift the way they can today (both re-read projects independently).
--
--    Every column reference is qualified with `h.` because the RETURNS TABLE
--    output names shadow the table's own column names inside an SQL body; an
--    unqualified `commission_mode` here would raise "column reference is
--    ambiguous".
--
--    Returns ZERO ROWS when the project has no row in force on p_on. That is
--    the signal, and it is not the same thing as zero commission. See the hole
--    named in the header.
-- ---------------------------------------------------------------------
create or replace function public.commission_config_at(
  p_project_id uuid,
  p_on         date
)
returns table (
  commission_mode     text,
  commission_value    numeric,
  commission_bump_pct numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select h.commission_mode, h.commission_value, h.commission_bump_pct
    from public.project_commission_history h
   where h.project_id = p_project_id
     and h.effective_from <= p_on
   order by h.effective_from desc
   limit 1;
$$;

comment on function public.commission_config_at(uuid, date) is
  'The driver-commission config in force for a project on a given day: the row '
  'with the greatest effective_from <= p_on. Returns NO ROW when none is in '
  'force - that is an error condition for a caller pricing a trip, not a zero. '
  'Single source for the delivery stamp and the daily recompute (step 2).';

-- ACL to match consumption_event_completed_at exactly:
-- {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
revoke all on function public.commission_config_at(uuid, date) from public;
revoke all on function public.commission_config_at(uuid, date) from anon;
grant execute on function public.commission_config_at(uuid, date) to authenticated;
grant execute on function public.commission_config_at(uuid, date) to service_role;

-- ---------------------------------------------------------------------
-- 4) ASSERT THE END STATE. Any failure rolls back every write above,
--    including the table itself.
-- ---------------------------------------------------------------------
do $$
declare
  v_trips_all   bigint;
  v_stamped     bigint;
  v_total       numeric;
  v_fingerprint text;
  v_projects    bigint;
  v_baselines   bigint;
  v_mismatch    bigint;
  v_unreachable bigint;
  v_rls         boolean;
  v_policies    bigint;
  v_secdef      boolean;
  v_volatile    "char";
  v_anon_exec   boolean;
  v_auth_exec   boolean;
begin
  -- (1) NOT ONE TRIP MOVED. Re-compute the block-0 fingerprint and compare.
  select count(*),
         count(*) filter (where commission_sar is not null),
         coalesce(sum(commission_sar), 0::numeric),
         md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_sar::text, '~'),
                                 ',' order by id), ''))
    into v_trips_all, v_stamped, v_total, v_fingerprint
    from public.trips;

  if not exists (
       select 1 from _0146_trips_before b
        where b.trips_all         = v_trips_all
          and b.stamped           = v_stamped
          and b.commission_total  = v_total
          and b.fingerprint       = v_fingerprint
     ) then
    raise exception
      'trips changed during 0146. This migration must write nothing to trips; found % rows / % stamped / % total / fingerprint %. Rolling back.',
      v_trips_all, v_stamped, v_total, v_fingerprint;
  end if;

  -- (2) EXACTLY ONE BASELINE PER PROJECT - no project skipped, none doubled.
  select count(*) into v_projects from public.projects;

  select count(*) into v_baselines
    from (select h.project_id
            from public.project_commission_history h
           where h.is_baseline
           group by h.project_id
          having count(*) = 1) one_each;

  if v_baselines <> v_projects then
    raise exception
      'Baseline coverage is wrong: % projects but % of them have exactly one baseline row.',
      v_projects, v_baselines;
  end if;

  -- (3) THE RESOLVER AGREES WITH projects.commission_* AS OF TODAY. This is the
  --     no-op proof for step 2: wiring the function in must not move a figure.
  select count(*) into v_mismatch
    from public.projects p
    left join lateral public.commission_config_at(
      p.id, (now() at time zone 'Asia/Riyadh')::date
    ) c on true
   where c.commission_mode     is distinct from p.commission_mode
      or c.commission_value    is distinct from p.commission_value
      or c.commission_bump_pct is distinct from p.commission_bump_pct;

  if v_mismatch <> 0 then
    raise exception
      'commission_config_at() disagrees with projects.commission_* today for % project(s). The baseline must be a copy, not a recomputation.',
      v_mismatch;
  end if;

  -- (4) EVERY TRIP THAT HAS A PROJECT IS REACHABLE - its trip_date is on or
  --     after that project's floor, so the resolver can price it. Scoped to
  --     trips WITH a project: the one project-less delivered trip
  --     (2bf32c2d..., 2026-07-15, already stamped 0.00) has no baseline by
  --     construction and is excluded knowingly.
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
      '% trip(s) fall before their project baseline and would resolve to no config. The floor is too late - see the floor section in the header.',
      v_unreachable;
  end if;

  -- (5) RLS is on and the one policy is present. This, not a table grant, is
  --     what closes the table - same as salary_history.
  select c.relrowsecurity,
         (select count(*) from pg_policy pol where pol.polrelid = c.oid)
    into v_rls, v_policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'project_commission_history';

  if v_rls is not true or v_policies <> 1 then
    raise exception
      'project_commission_history security is wrong: rls=%, policies=%. Expected rls on with exactly one authenticated policy.',
      v_rls, v_policies;
  end if;

  -- (6) The resolver is INVOKER, STABLE, and not executable by anon. A definer
  --     version would leak the whole history past RLS.
  select p.prosecdef, p.provolatile,
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute')
    into v_secdef, v_volatile, v_anon_exec, v_auth_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commission_config_at';

  if v_secdef is not false or v_volatile <> 's'
     or v_anon_exec is not false or v_auth_exec is not true then
    raise exception
      'commission_config_at posture is wrong: security_definer=%, volatility=%, anon_exec=%, auth_exec=%. Expected false / s / false / true.',
      v_secdef, v_volatile, v_anon_exec, v_auth_exec;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION - run these separately; do NOT paste into the file above.
-- ===========================================================================
--
-- A) THE MONEY DID NOT MOVE. Capture BEFORE applying and compare after. The
--    in-file assertion already gates this, but the point of a rehearsal is to
--    see the number with your own eyes:
--      select count(*) as trips_all,
--             count(*) filter (where stage = 'delivered')      as delivered,
--             count(*) filter (where commission_sar is not null) as stamped,
--             sum(commission_sar)                              as commission_total,
--             md5(string_agg(id::text || ':' ||
--                            coalesce(commission_sar::text,'~'),
--                            ',' order by id))                 as fingerprint
--        from public.trips;
--      -- at drafting: 818 / 744 / 744 / 15820.16 /
--      --              45e7433255eb121d735874ab8bbd7292
--      -- Identical after. Any movement means something wrote to trips.
--
-- B) THE BASELINES. One per project, values copied, dated at the floor:
--      select p.name, h.effective_from, h.commission_mode, h.commission_value,
--             h.commission_bump_pct, h.is_baseline
--        from public.project_commission_history h
--        join public.projects p on p.id = h.project_id
--       order by h.effective_from, p.name;
--      -- expect 7 rows, all is_baseline true:
--      --   2026-06-27  King Salman Park (1bbf)  fixed     10.00   0.00
--      --   2026-06-27  King Salman Park (7a94)  scalable  10.00   3.00
--      --   2026-06-28  RRR T                    fixed     60.00   0.00
--      --   2026-06-28  VVV Test 2               scalable  10.00  10.00
--      --   2026-06-30  The Royal Court of Saudi scalable  10.00  10.00
--      --   2026-07-11  King Saud University     fixed     20.00   0.00
--      --   2026-07-16  Airport facilities       scalable  12.00   2.00
--
--      select count(*) as rows, count(*) filter (where is_baseline) as baselines,
--             count(distinct project_id) as projects_covered
--        from public.project_commission_history;
--      -- expect 7 / 7 / 7, against 7 rows in public.projects.
--
-- C) THE RESOLVER MATCHES TODAY'S CONFIG - the step-2 no-op proof. Expect 0 rows:
--      select p.name, p.commission_mode, p.commission_value, p.commission_bump_pct,
--             c.commission_mode, c.commission_value, c.commission_bump_pct
--        from public.projects p
--        left join lateral public.commission_config_at(
--          p.id, (now() at time zone 'Asia/Riyadh')::date) c on true
--       where (c.commission_mode, c.commission_value, c.commission_bump_pct)
--             is distinct from
--             (p.commission_mode, p.commission_value, p.commission_bump_pct);
--
-- D) IT RESOLVES ON THE FLOOR ITSELF, AND RETURNS NOTHING BELOW IT. Three
--    projects have a trip ON their floor date, so the boundary is load-bearing:
--      select * from public.commission_config_at(
--        '7a94e22e-83b3-45e8-a7d0-766da0855b8a', date '2026-06-27');  -- 1 row
--      select * from public.commission_config_at(
--        '7a94e22e-83b3-45e8-a7d0-766da0855b8a', date '2026-06-26');  -- 0 rows
--      -- Zero rows is the designed signal for "no config in force", NOT zero
--      -- commission. Step 2 must branch on it.
--
-- E) FORWARD-ONLY, REHEARSED. A change dated today must leave every past day
--    alone. Rolled back - it writes commission config:
--      begin;
--        insert into public.project_commission_history
--          (project_id, effective_from, commission_mode, commission_value,
--           commission_bump_pct, note)
--        values ('fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--                (now() at time zone 'Asia/Riyadh')::date,
--                'fixed', 999, 0, 'verification only');
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92', date '2026-07-01');
--        -- MUST still read fixed / 60.00 / 0.00. Any 999 here means the
--        -- baseline was reachable by a today-dated write - the 0125 defect.
--
--        select * from public.commission_config_at(
--          'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          (now() at time zone 'Asia/Riyadh')::date);
--        -- reads 999 - correct, today is genuinely now.
--      rollback;
--      select count(*) from public.project_commission_history;   -- back to 7
--
-- F) THE BASELINE CANNOT BE COLLIDED WITH. Expect 0 - a baseline sitting on
--    today's date is the exact 0125 hazard 0126 removed:
--      select count(*) as baselines_dated_today
--        from public.project_commission_history
--       where is_baseline
--         and effective_from = (now() at time zone 'Asia/Riyadh')::date;
--      -- A project CREATED today would legitimately have one, and that case is
--      -- harmless: it has no earlier day to protect.
--
-- G) SECURITY, READ BACK RATHER THAN ASSUMED:
--      select c.relrowsecurity as rls,
--             (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
--             has_table_privilege('authenticated', c.oid, 'select') as auth_sel
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='project_commission_history';
--      -- true / 1 / true - the same shape salary_history reads.
--
--      select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='commission_config_at';
--      -- false / s / {search_path=public} /
--      -- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- H) NO VIEW WAS ADDED OR REPLACED - the section 6 counts are untouched:
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 47 / 47 / 0, unchanged.
--
-- I) THE TEMP TABLE DID NOT SURVIVE. `on commit drop` should have taken it:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname = '_0146_trips_before';
--      -- expect 0.
-- ===========================================================================
