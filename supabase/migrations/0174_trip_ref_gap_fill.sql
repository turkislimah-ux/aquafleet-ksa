-- 0174_trip_ref_gap_fill.sql
--
-- Gap-filling trip-ref allocator.
--
-- NO begin;/commit; WRAPPER — same reason as 0173. The Supabase SQL Editor
-- already submits in its own transaction; a nested begin; draws
-- `WARNING: there is already a transaction in progress`, is ignored, and the
-- trailing commit; then ends the EDITOR's transaction instead of a block of its
-- own. 0173 v1 reported success and created nothing that way. BARE STATEMENTS
-- ONLY. The editor's own transaction is what makes the redefine + the ACL
-- footer atomic, which is exactly what CLAUDE.md §6 requires ("re-revoke in the
-- same transaction"). Do not add a wrapper back.
--
-- READING THE OUTPUT: the change runs FIRST, the verification reads
-- pg_proc/has_function_privilege AFTER it. Statement 5 is the only evidence.
-- Statement 1 describes the OLD world and proves nothing about the new one.
--
--
-- WHAT CHANGES
-- ------------
-- ONLY the number-selection logic inside public.next_trip_ref_number(uuid,integer).
--
-- Today it is pure high-water: bump the counter, hand back the pre-bump value.
-- A number handed out and then deleted is burned forever, so AI-026 currently
-- has 8 holes below its high-water mark. After this migration the function hands
-- back the LOWEST unused number in that project's current-format series for that
-- year, and only falls back to high-water+1 once the series is contiguous.
--
-- WHAT DOES NOT CHANGE — and how that is guaranteed
-- --------------------------------------------------
--   * The ref STRING FORMAT, the YEAR DERIVATION, the WT- FALLBACK BRANCH and
--     the CLIENT-SUPPLIED-REF BYPASS all live in public.trips_set_ref(), which
--     this migration DOES NOT TOUCH AT ALL. Not redefined, not dropped, not
--     re-granted. That is the strongest possible form of "preserved byte for
--     byte": the function's prosrc and its ACL are literally the same rows.
--   * The signature, argument NAMES (p_project_id, p_year — `create or replace`
--     cannot change them anyway), return type, LANGUAGE plpgsql, SECURITY
--     DEFINER and `SET search_path TO 'public'` of next_trip_ref_number are all
--     carried over unchanged. SECURITY DEFINER is kept because that is what is
--     deployed now, not because this migration has an opinion about it.
--   * The counter-advance path is the same UPDATE ... returning next_number - 1
--     as 0033. When there is no gap, this function behaves identically to the
--     one it replaces, statement for statement.
--
--
-- WHY THE LOCK MOVES — THE ONE REAL STRUCTURAL CHANGE
-- ---------------------------------------------------
-- The deployed function takes NO explicit lock. Its only lock is the implicit
-- row lock that `UPDATE trip_ref_counter ...` acquires, and that happens at the
-- very END of the function. That is fine for pure high-water — the UPDATE is
-- both the read and the write, so it is atomic on its own.
--
-- It is NOT fine for gap-filling. A gap scan is a READ that decides a WRITE, and
-- between the two, another transaction can take the same gap. So the lock must
-- be acquired BEFORE the scan:
--
--     select next_number into v_next
--       from public.trip_ref_counter
--      where project_id = p_project_id and year = p_year
--      for update;                        -- <-- lock FIRST
--     ... then scan, then decide, then maybe update ...
--
-- Everything between that SELECT ... FOR UPDATE and the caller's COMMIT is
-- serialized per (project_id, year). Two concurrent inserts into the SAME
-- project+year queue; inserts into DIFFERENT projects never block each other.
--
--
-- WHY A DUPLICATE REF IS IMPOSSIBLE — LOCK **AND** 0173, TWO INDEPENDENT LAYERS
-- -----------------------------------------------------------------------------
-- Layer 1, the lock (READ COMMITTED, which is what PostgREST uses):
--   Txn A takes the counter lock, scans, picks 7, the trigger writes
--   'AI-026-0007', A commits. Txn B was blocked on FOR UPDATE the whole time;
--   the lock is released only at A's commit. B's gap-scan is a SEPARATE
--   statement executed after the lock is granted, so under READ COMMITTED it
--   takes a FRESH snapshot that includes A's committed trip — B sees 7 as taken
--   and picks 17. If A instead ROLLS BACK, 7 is free again and B correctly takes
--   7. This is why the lock must be held across the scan and not merely near it.
--
-- Layer 2, the 0173 unique index (project_id, ref) NULLS NOT DISTINCT:
--   Layer 1's argument depends on READ COMMITTED re-snapshotting per statement.
--   A caller running REPEATABLE READ or SERIALIZABLE holds one snapshot for the
--   whole transaction, so B would NOT see A's insert even after the lock is
--   granted, and both could pick 7. Note the counter row is NOT updated on a
--   gap fill, so there is no row version bump and hence no 40001 serialization
--   failure to catch it. The unique index is what catches it: the second insert
--   fails with 23505 and its transaction aborts. Loudly, at the database, which
--   is the entire point of 0173.
--
--   So: the lock makes collisions not happen under the isolation level we
--   actually run; the index makes a collision that somehow happens IMPOSSIBLE TO
--   PERSIST under any isolation level. Neither is a substitute for the other,
--   and 0174 must not be applied to a database where 0173 is absent.
--
--
-- THE SCAN RANGE IS [1 .. next_number - 1], NOT min..max OVER PRESENT ROWS
-- ------------------------------------------------------------------------
-- A min..max scan cannot see a BURNED TAIL. If AI-026 has issued 1..97 and rows
-- 94, 96 and 97 were deleted, max(present) is 95 and a min..max scan reports
-- only 94 — it never considers 96 or 97, which are just as free. Anchoring the
-- top of the range on the counter (the true high-water mark) is what makes the
-- allocator actually exhaustive. Live proof this matters: AI-026's counter is
-- 98 and its gaps are 7, 17, 69, 70, 71, 72, 94, 96.
--
-- generate_series(1, v_next - 1) is EMPTY when v_next = 1, so a brand-new series
-- skips the scan entirely and falls through to the high-water path, returning 1.
--
--
-- THE SERIES IS MATCHED BY PREFIX, NOT BY project_id ALONE
-- ---------------------------------------------------------
-- 153 live trips carry a project_id AND a legacy 'WT-...' ref (they were created
-- while their project's initials were still null; 0 projects have null initials
-- today). Matching on project_id alone would sweep those into the series and
-- corrupt the gap set. Matching on the exact prefix
-- `initials || '-' || lpad(year % 1000, 3) || '-'` — the same string
-- trips_set_ref builds — keeps WT- a separate series that is never a fillable
-- gap, which is the stated requirement. The probe
-- `project_id = ? and ref = ?` is an exact hit on the 0173 index; ~100 probes
-- per insert, microseconds.
--
-- Tolerances: a MISSING COUNTER ROW is created then re-locked (retry loop below
-- — a concurrent uncommitted insert is invisible to our SELECT under READ
-- COMMITTED, so one attempt is not enough). A project with NULL initials has no
-- current-format series at all, so the scan is SKIPPED and the function falls
-- back to pure high-water — identical to today's behaviour for that case.
--
--
-- MEASURED AGAINST THE LIVE DB IMMEDIATELY BEFORE DRAFTING:
--   AI 2026 next_number  98 · gaps {7,17,69,70,71,72,94,96}  (8)
--   KI 2026 next_number  85 · gaps {61,81,82,83}             (4)
--   VV 2025 next_number   3 · gaps {1,2}                     (2)
--   K1 2026 138 · RR 2026 122 · TH 2026 126 · VV 2026 145 — 0 gaps each
--   850 trips · 0 duplicate (project_id, ref) groups · trips_project_ref_unique
--   valid, ready, unique, NULLS NOT DISTINCT
--   next_trip_ref_number ACL: {postgres=X/postgres,authenticated=X/postgres,
--   service_role=X/postgres} — PUBLIC has NO execute, see the footer note.


-- 1. PRE-FLIGHT (diagnostic; describes the OLD world by necessity, proves
--    nothing about the change — statement 5 is what does that).
--    Expect: is_definer true, anon_exec false, auth_exec true, service_exec true,
--    and gap counts matching the header.
select
  p.prosecdef                                                          as is_definer,
  has_function_privilege('anon',          p.oid, 'execute')            as anon_exec,
  has_function_privilege('authenticated', p.oid, 'execute')            as auth_exec,
  has_function_privilege('service_role',  p.oid, 'execute')            as service_exec,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'trips'
      and indexname = 'trips_project_ref_unique')                      as index_0173_present,
  (select count(*) from public.trips)                                  as trips_total
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'next_trip_ref_number'
  and p.oid::regprocedure::text = 'next_trip_ref_number(uuid,integer)';


-- 2. THE CHANGE. Only the number-selection logic differs from 0033.
create or replace function public.next_trip_ref_number(p_project_id uuid, p_year integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_next     integer;
  v_gap      integer;
  v_initials text;
  v_prefix   text;
  v_attempt  integer := 0;
begin
  -- Ensure the counter row exists, then LOCK IT — in that order, and before any
  -- scan. `on conflict do nothing` does NOT lock the conflicting row and does
  -- not wait for a concurrent inserter's outcome in a way we can read, so under
  -- READ COMMITTED the following SELECT can legitimately find nothing on the
  -- first pass. Retry rather than assume.
  loop
    v_attempt := v_attempt + 1;

    insert into public.trip_ref_counter (project_id, year, next_number)
    values (p_project_id, p_year, 1)
    on conflict (project_id, year) do nothing;

    select next_number into v_next
      from public.trip_ref_counter
     where project_id = p_project_id
       and year       = p_year
     for update;

    exit when v_next is not null;

    if v_attempt >= 3 then
      raise exception
        'next_trip_ref_number: could not obtain counter row for project % year % after % attempts',
        p_project_id, p_year, v_attempt
        using errcode = 'internal_error';
    end if;
  end loop;

  -- From here to the caller's COMMIT, this (project_id, year) is serialized.

  -- The exact prefix trips_set_ref builds. A project with no initials has no
  -- current-format series, so there is nothing to scan: fall through to the
  -- high-water path, which is what happens today for that case.
  select initials into v_initials
    from public.projects
   where id = p_project_id;

  if v_initials is not null then
    v_prefix := v_initials || '-' || lpad((p_year % 1000)::text, 3, '0') || '-';

    -- Lowest unused number in [1 .. v_next - 1]. Anchored on the counter, not on
    -- max(present), so a burned tail is still reachable. generate_series is
    -- already ordered, so `limit 1` stops at the first hole instead of
    -- materialising the whole range.
    select g into v_gap
      from generate_series(1, v_next - 1) as g
     where not exists (
             select 1
               from public.trips t
              where t.project_id = p_project_id
                and t.ref        = v_prefix || lpad(g::text, 4, '0')
           )
     order by g
     limit 1;

    if v_gap is not null then
      -- Gap fill: hand back the hole and DO NOT advance the counter. The
      -- high-water mark is unchanged because no new number was issued — one was
      -- reused. The lock is still held; it releases at the caller's commit.
      return v_gap;
    end if;
  end if;

  -- Contiguous series (or no current-format series at all): issue high-water and
  -- advance by exactly 1. Byte-identical in effect to 0033's UPDATE.
  update public.trip_ref_counter
     set next_number = next_number + 1
   where project_id = p_project_id
     and year       = p_year
  returning next_number - 1 into v_next;

  return v_next;
end;
$function$;


-- 3. CLAUDE.md §6 FOOTER — MANDATORY, NOT OPTIONAL.
--    `create or replace function` resets the ACL to the Postgres default,
--    EXECUTE TO PUBLIC. anon inherits PUBLIC and the anon key ships in the
--    client bundle, so a SECURITY DEFINER function left at the default is
--    callable by anyone holding it — bypassing RLS, since a definer runs as its
--    owner. The offending entry is the PUBLIC one (empty grantee); revoking anon
--    alone leaves it and changes nothing. Both grantees, every time.
revoke execute on function public.next_trip_ref_number(uuid, integer) from public, anon;

-- 4. RE-GRANT WHAT THE REPLACE DESTROYED.
--    Measured before drafting: the deployed ACL is
--    {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} —
--    PUBLIC holds NO execute, which means authenticated and service_role hold
--    EXPLICIT grants. `create or replace` wipes them. Revoking alone would
--    therefore leave the function callable by NOBODY and break every trip
--    insert. This is not loosening anything: it restores exactly the two
--    grantees that are deployed now, and nothing else.
grant execute on function public.next_trip_ref_number(uuid, integer) to authenticated;
grant execute on function public.next_trip_ref_number(uuid, integer) to service_role;

-- public.trips_set_ref() is NOT redefined by this migration, so its ACL is
-- untouched and needs no footer. Deliberate: leaving it alone is what preserves
-- the WT- fallback and the client-supplied-ref bypass byte for byte.


-- 5. POST-FLIGHT — reads the REAL catalog, AFTER the change. Required reading:
--      fn_present         1
--      is_definer         true
--      search_path_set    true
--      anon_exec          FALSE   <- §6; if this is true, STOP, the footer failed
--      auth_exec          true    <- if false, trip inserts are broken
--      service_exec       true
--      has_gap_fill       true    <- the new body is actually deployed
--      trips_set_ref_untouched  true
--    Read back with has_function_privilege, never by matching proacl — '%=X/%'
--    also matches postgres=X/postgres and reports every function as leaking.
select
  count(*)                                                                   as fn_present,
  coalesce(bool_or(p.prosecdef), false)                                      as is_definer,
  coalesce(bool_or(p.proconfig::text like '%search_path=public%'), false)    as search_path_set,
  coalesce(bool_or(has_function_privilege('anon',          p.oid, 'execute')), true)  as anon_exec,
  coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'execute')), false) as auth_exec,
  coalesce(bool_or(has_function_privilege('service_role',  p.oid, 'execute')), false) as service_exec,
  coalesce(bool_or(p.prosrc like '%generate_series(1, v_next - 1)%'), false) as has_gap_fill,
  coalesce(bool_or(p.prosrc like '%for update%'), false)                     as has_row_lock,
  (select coalesce(bool_or(p2.prosrc like '%trips_ref_seq%'), false)
     from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
    where n2.nspname = 'public' and p2.proname = 'trips_set_ref')            as trips_set_ref_untouched
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'next_trip_ref_number'
  and p.oid::regprocedure::text = 'next_trip_ref_number(uuid,integer)';


-- 6. POST-FLIGHT DATA CHECK — this migration writes NO data. Every counter and
--    every gap set must be identical to the header's measurements, and
--    duplicate_groups must still be 0.
with c as (
  select c.project_id, c.year, c.next_number, p.initials,
         p.initials || '-' || lpad((c.year % 1000)::text, 3, '0') || '-' as prefix
    from public.trip_ref_counter c
    join public.projects p on p.id = c.project_id
)
select c.initials, c.year, c.next_number,
       coalesce(array_agg(g.g order by g.g) filter (where g.g is not null), '{}') as gaps,
       count(g.g)                                                                 as gap_count,
       (select count(*) from public.trips)                                        as trips_total,
       (select count(*)
          from (select project_id, ref from public.trips
                 group by project_id, ref having count(*) > 1) d)                 as duplicate_groups
  from c
  left join lateral (
    select g from generate_series(1, c.next_number - 1) g
     where not exists (
             select 1 from public.trips t
              where t.project_id = c.project_id
                and t.ref        = c.prefix || lpad(g::text, 4, '0')
           )
  ) g on true
 group by c.initials, c.year, c.next_number
 order by c.initials, c.year;
