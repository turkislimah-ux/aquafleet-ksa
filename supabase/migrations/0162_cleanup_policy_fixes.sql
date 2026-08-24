-- 0162_cleanup_policy_fixes.sql
-- Two consistency fixes found by a schema sweep. Neither changes behaviour in
-- normal use; both remove a way for a future change to go wrong quietly.
--
-- ===========================================================================
-- THE DATABASE WAS CHANGED FIRST. THIS FILE IS THE RECORD, NOT THE SOURCE.
-- ===========================================================================
-- The architect applied both via MCP and verified them live BEFORE this file was
-- written. Do NOT re-run it against production; it exists so the repo matches
-- the DB and so a fresh `db reset` reproduces the same end state.
--
-- Both statements are idempotent (`drop policy if exists` then create), so a
-- second apply is harmless — unlike 0160's drop.
--
-- Both definitions were read out of the live catalog rather than reconstructed:
--     select policyname, cmd, roles, qual, with_check from pg_policies where ...
--
-- ===========================================================================
-- FIX 1 — payslip_number_counter HAD NO POLICY, AND ITS SIX SIBLINGS ALL DO
-- ===========================================================================
-- Seven counter tables exist: ep_number_counter, invoice_number_counter,
-- os_number_counter, payslip_number_counter, po_number_counter,
-- trip_ref_counter, wo_number_counter. All seven have RLS ENABLED. Six carried
-- an `authenticated_all_<table>` policy; payslip_number_counter carried none.
--
-- RLS with no policy denies everything, so any direct access by `authenticated`
-- was refused. This adds the identical policy its six siblings have.
--
-- **PAYSLIP ISSUING WAS NOT BROKEN, AND THIS DID NOT FIX IT. CHECKED, NOT
-- ASSUMED.** The counter is only ever touched by `next_payslip_number(integer)`,
-- which is called by `issue_driver_payslip(...)`. Both are SECURITY DEFINER and
-- owned by `postgres` — verified in pg_proc.prosecdef — so they execute as the
-- owner and RLS on the counter never applies to them. The app never touches the
-- table directly either: `app/reports/actions.ts` calls
-- `supabase.rpc("issue_driver_payslip", ...)` and nothing else references the
-- counter. So payslip numbers were being allocated correctly the whole time,
-- through a path the missing policy could not reach. No fallback, no silent
-- failure, nothing to backfill.
--
-- WHY ADD IT THEN. Because "safe because every caller happens to be SECURITY
-- DEFINER" is a property of today's callers, not of the table. The first piece
-- of code that reads this counter directly — a report, an admin screen, a
-- diagnostic — would be refused with an RLS error that looks like a bug in the
-- new code rather than a gap in the old schema. Six siblings say what the
-- convention is; this makes the seventh agree.
--
-- ===========================================================================
-- FIX 2 — exit_permits_update HAD `USING` BUT NO `WITH CHECK`
-- ===========================================================================
-- On an UPDATE policy the two clauses do different jobs: USING decides which
-- rows you may update, WITH CHECK decides what they are allowed to look like
-- AFTERWARDS. With USING alone, Postgres allows the row to be rewritten into
-- anything the policy would not have let you select in the first place.
--
-- Concretely: `exit_permits_update` restricted updates to objects in the
-- `exit-permits` bucket, but nothing stopped an update from setting
-- `bucket_id` to a DIFFERENT bucket — moving an object out of the bucket whose
-- policy authorised the update. The three sibling policies on this bucket
-- (select/insert/delete) each carry the single clause their command needs;
-- update was the one that needs both and had one.
--
-- No behaviour change in normal use: the app never rewrites `bucket_id`, and
-- Supabase's storage API does not expose that as an update. This closes the
-- shape, not an incident.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- No table data, no schema, no function, no view, no other policy, no bucket,
-- no app code. Two policies, and the anon revoke that belongs beside one of them.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. payslip_number_counter — the policy its six siblings already have.
--
-- `for all ... using (true) with check (true)` is copied from those siblings
-- verbatim, deliberately: a counter is an internal allocator with no per-user
-- dimension, and inventing a narrower predicate for one of seven identical
-- tables would make the odd one out harder to reason about, not safer. The real
-- protection is that anon holds no grant (0161) and that every caller goes
-- through a SECURITY DEFINER RPC.
-- ---------------------------------------------------------------------
drop policy if exists authenticated_all_payslip_number_counter on public.payslip_number_counter;
create policy authenticated_all_payslip_number_counter
  on public.payslip_number_counter for all to authenticated
  using (true) with check (true);

-- Belt and braces. 0161 already swept every public table, and it runs before
-- this file on a fresh reset — but the per-table revoke is the stated idiom
-- (0154/0157/0159) and it keeps this migration correct read on its own.
revoke all on public.payslip_number_counter from anon;

-- ---------------------------------------------------------------------
-- 2. exit_permits_update — restated WITH the missing WITH CHECK.
--
-- Drop and recreate rather than ALTER: Postgres has no syntax to add a WITH
-- CHECK to an existing policy, so the pair below IS the edit. The USING
-- expression is unchanged and the WITH CHECK mirrors it exactly, which is the
-- shape the other buckets' update policies use (0157's and 0159's image buckets
-- both carry using + with_check on UPDATE).
-- ---------------------------------------------------------------------
drop policy if exists "exit_permits_update" on storage.objects;
create policy "exit_permits_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'exit-permits')
  with check (bucket_id = 'exit-permits');

-- ---------------------------------------------------------------------
-- 3. Self-asserts. Any failure rolls both fixes back.
-- ---------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_check   text;
begin
  -- Every counter table must now carry exactly one authenticated policy.
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname like '%\_counter'
     and c.relkind = 'r'
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
     );

  if v_missing is not null then
    raise exception 'counter tables still have no RLS policy: %', v_missing;
  end if;

  -- The UPDATE policy must have BOTH clauses. A null with_check is the bug.
  select coalesce(with_check, '<null>') into v_check
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'exit_permits_update';

  if v_check is null or v_check = '<null>' then
    raise exception 'exit_permits_update still has no WITH CHECK';
  end if;

  raise notice 'all counter tables have a policy; exit_permits_update has with_check %', v_check;
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) ALL SEVEN COUNTERS NOW MATCH.
--      select c.relname, c.relrowsecurity as rls, p.policyname, p.cmd, p.roles::text
--        from pg_class c
--        join pg_namespace n on n.oid = c.relnamespace
--        left join pg_policies p on p.schemaname='public' and p.tablename=c.relname
--       where n.nspname='public' and c.relkind='r' and c.relname like '%\_counter'
--       order by c.relname;
--      -- expect 7 rows, each rls=true with one authenticated_all_<table> ALL
--      -- policy on {authenticated}. No NULL policyname.
--
-- B) anon STILL HOLDS NOTHING (0161 must not have been undone).
--      select count(*) from information_schema.role_table_grants
--       where grantee='anon' and table_schema='public';
--      -- expect 0
--
-- C) THE STORAGE POLICY HAS BOTH CLAUSES.
--      select policyname, cmd, qual, with_check
--        from pg_policies
--       where schemaname='storage' and tablename='objects'
--         and policyname like 'exit_permits%'
--       order by cmd;
--      -- expect 4 rows, all {authenticated}:
--      --   DELETE  qual only
--      --   INSERT  with_check only
--      --   SELECT  qual only
--      --   UPDATE  BOTH qual and with_check = (bucket_id = 'exit-permits')
--
-- D) PAYSLIP ISSUING STILL WORKS THROUGH THE RPC — the thing this must not
--    have broken. Rolled back; nothing is written.
--      begin;
--        select public.next_payslip_number(extract(year from current_date)::int);
--        -- expect PS-<year>-NNNNNN, one higher than the stored last_number
--      rollback;
--
--      select * from public.payslip_number_counter order by year;
--      -- expect the counter UNMOVED by the rolled-back call above
--
-- E) NOTHING ELSE MOVED.
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 83 / 83
--
--      select count(*) as buckets from storage.buckets;
--      -- expect 12
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Reverting means restoring two WORSE states, so think before running it.
--
--   begin;
--   drop policy if exists authenticated_all_payslip_number_counter on public.payslip_number_counter;
--   drop policy if exists "exit_permits_update" on storage.objects;
--   create policy "exit_permits_update"
--     on storage.objects for update to authenticated
--     using (bucket_id = 'exit-permits');          -- back to no WITH CHECK
--   commit;
--
-- The first drop returns payslip_number_counter to "RLS on, no policy", which
-- denies `authenticated` everything. That is survivable only for as long as
-- every caller stays SECURITY DEFINER. The second restores a policy that lets an
-- update move an object out of the bucket that authorised it. Neither is a state
-- worth returning to; if something here needs undoing, undo the specific half.
-- ===========================================================================
