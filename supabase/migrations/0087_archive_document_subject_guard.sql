-- 0087_archive_document_subject_guard.sql
-- Archive Phase 2 — the cross-row guard 0086 could not express.
--
-- 0086 added archive_document_groups.subject_kind and a CHECK that it agrees
-- with the group's tab. That is a SINGLE-ROW rule, so a CHECK could state it.
--
-- This migration enforces the OTHER half: that each DOCUMENT's subject
-- matches its parent group's declared subject_kind. That is a CROSS-ROW rule
-- (child row vs. parent row), which no CHECK constraint can express — hence a
-- trigger. Turki chose this over app-only enforcement (0086's Option B).
--
-- What it enforces, per the parent group's subject_kind:
--
--   none     -> driver_id, staff_id, truck_id ALL null   (company document)
--   driver   -> driver_id set;  staff_id, truck_id null
--   staff    -> staff_id  set;  driver_id, truck_id null
--   truck    -> truck_id  set;  driver_id, staff_id null
--   customer -> REJECTED outright — see the edge decision below.
--
-- Note this is STRICTLY TIGHTER than what already exists. 0084's
-- archive_documents_one_subject CHECK says "at most one subject is set"; it
-- cannot say WHICH, and it happily accepts zero. This trigger pins the exact
-- one, and makes it mandatory where the group demands a subject — so a
-- driver-group document can no longer be filed with no driver at all, which
-- would render as a ghost row belonging to nobody.
--
-- ===========================================================================
-- EDGE DECISION — customer groups (stating it, not skipping it)
-- ===========================================================================
-- DECIDED: REJECT. A document whose group is subject_kind='customer' raises.
--
-- Why reject rather than allow-as-subjectless: archive_documents has no
-- customer_id column, so a customer-group document could only be stored with
-- all three subject columns null — which is byte-for-byte identical to a
-- COMPANY document. The subject would live only in which group it happens to
-- sit in, with no FK to customers and no referential integrity at all. That
-- is exactly design (a) that 0084 rejected on the record ("polymorphic, no
-- FK — zero referential integrity"). Allowing it would smuggle that rejected
-- shape back in through a side door, and silently: nothing would error, the
-- data would just be unattributable later.
--
-- Rejecting is also the reversible direction. Today the Customer tab is
-- read-only by Turki's spec, so nothing legitimately hits this branch; if
-- that changes, the fix is additive and small.
--
-- AND — flagging it as a real Phase-3 question rather than treating "reject"
-- as the final answer: **do customers eventually need archived documents?**
-- (Signed service contracts and commercial registrations are the obvious
-- candidates, and this business plainly has both.) If yes, Phase 3 needs:
--   1. `customer_id uuid references public.customers(id) on delete restrict`
--      on archive_documents — a FIRST-and-only FK for the
--      archive_documents->customers pair, so the 0077 embed hazard stays
--      clear, exactly as the other three subjects did;
--   2. that column added to archive_documents_one_subject's num_nonnulls list;
--   3. the 'customer' branch below changed from a raise to a real check.
-- That is a genuine schema question with a cost, so it belongs in the Phase-3
-- conversation with you — not decided here by whichever branch I happened to
-- write today.
--
-- ===========================================================================
-- SECURITY — the archive's FIRST function, so 0083's rules apply in full
-- ===========================================================================
--  - SET search_path = public: pinned, so the function cannot be hijacked by
--    a caller-controlled search_path resolving `archive_document_groups` to
--    something else. Mandatory under 0083 for every function in this project.
--
--  - SECURITY INVOKER (the default, left explicit below for the reader).
--    Turki's instruction, and correct here: the function reads
--    archive_document_groups, whose RLS policy from 0084 already grants
--    `authenticated` full read. There is no privilege the caller lacks, so
--    DEFINER would buy nothing and would cost the usual DEFINER risk of
--    running the body as the owner. No reason to reach for it.
--
--    ONE CONSEQUENCE, handled deliberately below: under INVOKER the lookup
--    is subject to the caller's RLS. If a future policy narrowed group
--    visibility, the SELECT could return no row — and a guard that finds no
--    parent must NOT fall through to "allowed". The FK on group_id already
--    guarantees the parent EXISTS, so a not-found here means invisible, not
--    absent, and the function raises. Fail closed.
--
--  - EXECUTE revoked from PUBLIC and from anon. A trigger function is not
--    directly callable (its privileges are checked at CREATE TRIGGER time,
--    not at fire time), so this is belt-and-braces — but 0083's whole point
--    is that the surface stays at zero without anyone having to reason about
--    exceptions. `authenticated` is granted EXECUTE for the same reason: the
--    project's convention is that every function has an explicit, minimal
--    grant rather than an implicit one.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ADDITIVE: one function + one trigger. No table, column, policy or datum
--    is created, altered or dropped. RLS untouched.
--  - BEFORE INSERT OR UPDATE ... FOR EACH ROW: it validates only rows written
--    from now on. Existing rows are never re-checked and cannot be
--    invalidated by this migration (see the pre-flight query below, which
--    confirms there is nothing pre-existing that WOULD fail).
--  - It also fires on the RENEW path, which updates dates on an existing
--    document. That re-validates a subject that hasn't changed and passes —
--    intended, and cheap: one indexed primary-key lookup per written row.
--  - Re-runnable: `create or replace function` + `drop trigger if exists`
--    before `create trigger`.
--
-- PRE-FLIGHT (please run before applying — I have no DB read access this
-- session, so this is an assumption to confirm, not something I verified):
--
--     select d.id, g.tab, g.subject_kind,
--            d.driver_id, d.staff_id, d.truck_id
--     from public.archive_documents d
--     join public.archive_document_groups g on g.id = d.group_id
--     where not (
--       (g.subject_kind = 'none'   and num_nonnulls(d.driver_id, d.staff_id, d.truck_id) = 0)
--       or (g.subject_kind = 'driver' and d.driver_id is not null and d.staff_id is null and d.truck_id is null)
--       or (g.subject_kind = 'staff'  and d.staff_id  is not null and d.driver_id is null and d.truck_id is null)
--       or (g.subject_kind = 'truck'  and d.truck_id  is not null and d.driver_id is null and d.staff_id is null)
--     );
--
-- Expected: ZERO rows. Every document today is a Phase-1 company document in
-- a subject_kind='none' group with no subject set. If this returns anything,
-- STOP and tell me — the trigger would then block edits to those rows, and
-- the right response is a data fix, not a weakened guard.

begin;

-- ---------------------------------------------------------------------------
-- 1) The guard function.
-- ---------------------------------------------------------------------------
create or replace function public.archive_document_subject_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subject_kind text;
  v_group_title  text;
begin
  select g.subject_kind, g.title
    into v_subject_kind, v_group_title
    from public.archive_document_groups g
   where g.id = new.group_id;

  -- Fail closed. group_id is NOT NULL with an FK, so the parent is
  -- guaranteed to exist — not finding it means it is not VISIBLE to this
  -- caller under RLS. Allowing the write in that case would let the guard be
  -- bypassed by anyone who cannot see the group they are writing into.
  if v_subject_kind is null then
    raise exception
      'Archive: parent group % is not readable, cannot validate the document subject.', new.group_id
      using errcode = '23514';
  end if;

  if v_subject_kind = 'none' then
    if num_nonnulls(new.driver_id, new.staff_id, new.truck_id) > 0 then
      raise exception
        'Archive: group "%" holds company documents, which must have no driver, staff or truck subject.', v_group_title
        using errcode = '23514';
    end if;

  elsif v_subject_kind = 'driver' then
    if new.driver_id is null or new.staff_id is not null or new.truck_id is not null then
      raise exception
        'Archive: group "%" is a driver group — a document in it must have a driver subject and no other.', v_group_title
        using errcode = '23514';
    end if;

  elsif v_subject_kind = 'staff' then
    if new.staff_id is null or new.driver_id is not null or new.truck_id is not null then
      raise exception
        'Archive: group "%" is a staff group — a document in it must have a staff subject and no other.', v_group_title
        using errcode = '23514';
    end if;

  elsif v_subject_kind = 'truck' then
    if new.truck_id is null or new.driver_id is not null or new.staff_id is not null then
      raise exception
        'Archive: group "%" is a truck group — a document in it must have a truck subject and no other.', v_group_title
        using errcode = '23514';
    end if;

  elsif v_subject_kind = 'customer' then
    -- See the EDGE DECISION block at the top. archive_documents has no
    -- customer_id column, so a customer document has no way to record WHICH
    -- customer it belongs to. Refused rather than stored unattributable.
    raise exception
      'Archive: group "%" is a customer group, which cannot hold documents yet (archive_documents has no customer subject column).', v_group_title
      using errcode = '23514';

  else
    -- Unreachable while 0086's CHECK holds. Kept so that ADDING a value to
    -- that CHECK without teaching this function about it fails loudly on the
    -- first write, instead of silently accepting anything for the new kind.
    raise exception
      'Archive: unknown subject_kind "%" on group "%".', v_subject_kind, v_group_title
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.archive_document_subject_guard() is
  'BEFORE INSERT/UPDATE guard on archive_documents: the document''s subject column must match its parent group''s subject_kind (0086). Cross-row rule, so it cannot be a CHECK constraint. Fails closed if the parent group is not visible.';

-- ---------------------------------------------------------------------------
-- 2) Lock the function down per 0083. Trigger functions are not directly
--    callable, so this is defence in depth — the surface stays at zero
--    without anyone needing to remember why this one was an exception.
-- ---------------------------------------------------------------------------
revoke all on function public.archive_document_subject_guard() from public;
revoke all on function public.archive_document_subject_guard() from anon;
grant execute on function public.archive_document_subject_guard() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) The trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists archive_documents_subject_guard on public.archive_documents;
create trigger archive_documents_subject_guard
  before insert or update on public.archive_documents
  for each row execute function public.archive_document_subject_guard();

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — confirm it BITES, not just that it exists
-- ===========================================================================
-- 1) Trigger is attached and enabled ('O' = enabled, origin):
--      select tgname, tgenabled, pg_get_triggerdef(oid)
--      from pg_trigger
--      where tgrelid = 'public.archive_documents'::regclass
--        and not tgisinternal;
--
-- 2) Function is hardened — search_path pinned, INVOKER, anon at zero:
--      select p.proname, p.prosecdef as is_definer, p.proconfig,
--             has_function_privilege('anon',          p.oid, 'execute') as anon_can,
--             has_function_privilege('authenticated', p.oid, 'execute') as auth_can
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'archive_document_subject_guard';
--    Expect: is_definer = false, proconfig = {search_path=public},
--            anon_can = false, auth_can = true.
--
-- 3) IT BITES — each of these must RAISE, and the whole block rolls back so
--    nothing is left behind. Run them ONE AT A TIME (the first raise aborts
--    the transaction):
--
--    a) company group + a subject -> must raise
--      begin;
--        insert into public.archive_documents (group_id, title, driver_id)
--        select id, 'guard probe a', (select id from public.drivers limit 1)
--        from public.archive_document_groups where subject_kind = 'none' limit 1;
--      rollback;
--
--    b) driver group + NO subject -> must raise
--      begin;
--        insert into public.archive_document_groups (tab, title, subject_kind)
--        values ('staff', 'guard probe group', 'driver');
--        insert into public.archive_documents (group_id, title)
--        select id, 'guard probe b' from public.archive_document_groups
--        where title = 'guard probe group';
--      rollback;
--
--    c) driver group + a STAFF subject -> must raise
--      begin;
--        insert into public.archive_document_groups (tab, title, subject_kind)
--        values ('staff', 'guard probe group', 'driver');
--        insert into public.archive_documents (group_id, title, staff_id)
--        select id, 'guard probe c', (select id from public.staff limit 1)
--        from public.archive_document_groups where title = 'guard probe group';
--      rollback;
--
--    d) driver group + a DRIVER subject -> must SUCCEED (the guard must not
--       be so tight that the real Phase-2 path is blocked):
--      begin;
--        insert into public.archive_document_groups (tab, title, subject_kind)
--        values ('staff', 'guard probe group', 'driver');
--        insert into public.archive_documents (group_id, title, driver_id)
--        select id, 'guard probe d', (select id from public.drivers limit 1)
--        from public.archive_document_groups where title = 'guard probe group';
--      rollback;
--
-- 4) Existing Phase-1 documents still editable (the trigger fires on UPDATE):
--      begin;
--        update public.archive_documents set note = note where true;
--      rollback;
--    Expect: succeeds, row count = every existing document.
