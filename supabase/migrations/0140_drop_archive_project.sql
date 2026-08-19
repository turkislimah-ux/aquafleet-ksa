-- 0140_drop_archive_project.sql
--
-- DROP 0019's public.archive_project(uuid) PERMANENTLY. This closes 0139's Q5,
-- the one thing 0139 flagged as not self-contained.
--
-- WHY IT HAD TO OUTLIVE ITS REPLACEMENT FOR A WHILE
--
--   0139 added the debt guard: you cannot archive a project while its customer
--   still owes money, and a manager override is a WRITE-OFF recorded in
--   customer_write_offs. That guard lives in archive_project_guarded(uuid,
--   text, text) — a NEW function rather than a replacement of the old one,
--   because a function's argument list cannot change under create-or-replace.
--   The old two-line archive therefore stayed callable, and 0139 named it for
--   what it was: an unguarded back door around the whole guard. Anything that
--   could reach the RPC layer could archive a debt away by calling the older
--   name.
--
-- ORDERING — THE APP HALF LANDED FIRST, DELIBERATELY
--
--   Same code-then-migrate direction as rating/0132 and incidents_12mo/0133: a
--   PostgREST call naming a function that no longer exists fails outright, so
--   dropping first would break archiving the moment it applied. The app half
--   shipped in 2c9103e — app/trips/actions.ts calls archive_project_guarded and
--   nothing else calls the bare name. Re-verified at draft time across the
--   whole repo and inside the database (no plpgsql body, no view definition
--   mentions it). There were no app references left to strip; this is a bare
--   drop.
--
-- THIS IS A NO-OP AGAINST THE CURRENT PRODUCTION DATABASE — AND STILL REQUIRED
--
--   Measured before drafting, not assumed: public.archive_project(uuid) is
--   ALREADY ABSENT from the live database. The only archive_project* routine
--   present is archive_project_guarded(uuid,text,text). It was dropped
--   out-of-band at some point after 0139; no migration on disk removed it.
--
--   0019 is wrapped in a single begin/commit, so it was all-or-nothing, and its
--   other artifacts (projects.archived_at, customers.archived_at,
--   projects_active_idx, customers_active_idx) are all still present — the
--   function was created and later removed, not skipped.
--
--   That drift is exactly why this file must exist rather than be waved off as
--   already done. Migration history on disk is the reset path: replaying from
--   scratch runs 0019, which RECREATES the unguarded back door, and nothing
--   downstream removes it. Without this file a database reset silently
--   reintroduces the hole 0139 was written to close — the same class of problem
--   as an applied-but-uncommitted migration. `if exists` makes it idempotent:
--   a no-op against production today, a real drop on every replay.
--
--   The grant from 0019 (`grant execute ... to authenticated`) needs no separate
--   revoke — dropping a function drops its privileges with it.
--
-- BEFORE APPLYING — expect archive_project_guarded ONLY, and at most one row
-- for the bare name (the 0038 stray-overload lesson: one signature per RPC):
--
--   select p.oid::regprocedure::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'archive_project%';
--
-- AFTER APPLYING — expect exactly one row, archive_project_guarded(uuid,text,
-- text). The verification block at the foot of this file asserts both halves,
-- so a wrong result raises rather than printing quietly.

drop function if exists public.archive_project(uuid);

-- Assert the end state in the same run: the back door is gone AND the guarded
-- replacement survived. A drop migration that silently took out the wrong
-- function would otherwise look identical to a successful one.
do $$
declare
  v_bare    int;
  v_guarded int;
begin
  select count(*) into v_bare
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project';

  select count(*) into v_guarded
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  if v_bare <> 0 then
    raise exception
      'archive_project still present (% signature(s)) after the drop - an overload with a different argument list exists and is still an unguarded back door.',
      v_bare;
  end if;

  if v_guarded <> 1 then
    raise exception
      'archive_project_guarded should be present exactly once, found %. Archiving is now broken - restore it from 0139 before continuing.',
      v_guarded;
  end if;
end;
$$;
