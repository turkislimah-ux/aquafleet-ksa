-- 0194_schema_convergence.sql
-- Close the four NON-SECURITY drifts between the migration files and the live
-- production catalog, measured 2026-09-10 against prod ceqzmztewbborwgxnrqh and
-- test vlyxazfinmlanjdttavg.
--
-- ===========================================================================
-- DIRECTION MATTERS MORE THAN THE DIFF — READ THIS BEFORE EDITING ANYTHING
-- ===========================================================================
-- "Convergence" is two opposite operations wearing one word, and confusing them
-- is how a parity migration turns into an outage:
--
--   files -> prod  = CODIFY. The file learns what production already runs.
--                    Applying it to prod changes NOTHING. Low risk by
--                    construction, because the no-op is provable.
--   prod  -> files = A REAL PRODUCTION CHANGE. The file is right, prod is
--                    behind, and applying this alters the live schema.
--
-- Per section, in this file:
--   1) start_work_order / dispatch_outsourced_job ... files <- prod   (CODIFY)
--   2) commission_types.label_ar SET NOT NULL ....... prod  <- files  (CHANGE)
--   3) staff_commissions FK actions ................. prod  <- files  (CHANGE)
--   4) indexes ...................................... BOTH, see section 4
--
-- ===========================================================================
-- THIS FILE IS CORRECT ON BOTH PATHS — APPLIED TO PROD, AND ON A FRESH REBUILD
-- ===========================================================================
-- Every statement below is idempotent or a no-op on whichever side already has
-- the object. On production it changes items 2, 3 and 4 only. On a from-scratch
-- `db reset`, where 0076 and 0080 have already run, items 2 and 3 are no-ops,
-- item 4's create-if-not-exists on the composite is a no-op and its drop-if-
-- exists finds nothing, and item 1 replaces 0076's text with production's.
-- Each section says which, in place. Do not "simplify" that away.
--
-- BARE STATEMENTS — no `begin;` / `commit;`. 0173+ rule (CLAUDE.md section 5):
-- the SQL Editor already wraps the submission, and a nested begin/commit ends
-- the EDITOR's transaction early, printing green grids over an empty run.
--
-- DRAFTED, NOT APPLIED. The architect applies this after review. Verify against
-- pg_index / pg_proc / pg_constraint afterwards — this file's own verification
-- block is a claim, and the catalog is the evidence (CLAUDE.md section 5).


-- ===========================================================================
-- 1) start_work_order(uuid,text) AND dispatch_outsourced_job(uuid,text)
--    DIRECTION: files <- prod. CODIFY. This is a NO-OP against production.
-- ===========================================================================
-- Production has carried a post-0076 revision of both functions that no
-- migration contains. Measured 2026-09-10: comment-stripped bodies differ
-- (first divergence at char 841 in start_work_order, 774 in
-- dispatch_outsourced_job), and `identical ignoring all whitespace` is FALSE —
-- so this is real text, not formatting and not comments.
--
-- IT IS ALSO A BEHAVIOUR-PRESERVING REFACTOR, WHICH IS WHY CODIFYING IT IS SAFE.
-- Three differences from 0076, each provably outcome-identical:
--
--   (a) The null-guard is HOISTED. 0076 tests `and assigned_driver_id is not
--       null` inside the UPDATE's WHERE; production tests
--       `v_truck.assigned_driver_id is not null` in the IF. The truck row is
--       already held by the `select ... for update` immediately above, so the
--       value read into v_truck and the value the UPDATE would see are the same
--       value. Neither version can touch a truck whose driver is already null.
--
--   (b) ALIASES. `wo`/`oj` here, `wo2`/`oj2` in 0076. No semantic content.
--
--   (c) SELF-EXCLUSION reads the PARAMETER (`p_wo_id` / `p_job_id`) rather than
--       the row (`v_wo.id` / `v_job.id`). Identical values — v_wo was selected
--       BY p_wo_id. In dispatch_outsourced_job the two `not exists` clauses are
--       additionally ORDER-SWAPPED, and AND is commutative.
--
-- So: no live work order behaves differently after this file. What changes is
-- that the repository stops lying about what runs.
--
-- THE BODIES BELOW ARE pg_get_functiondef() OUTPUT, LIFTED VERBATIM FROM THE
-- PRODUCTION CATALOG ON 2026-09-10. They are not retyped and must not be
-- tidied — reformatting them breaks the md5 assertion in section 5, which is
-- the only thing proving this section is the no-op it claims to be.
--
--   start_work_order(uuid,text)        md5 4214e90c5911905a6cc3b361c906b127
--   dispatch_outsourced_job(uuid,text) md5 6b501351440a5a038150a7c86818ef54
--
-- NOTE, NOT CHANGED HERE: both carry `SET search_path TO 'public'` without
-- `pg_temp`, which 0193's trigger function does include. Adding it would be a
-- behaviour change on a SECURITY DEFINER function and is outside the "codify
-- verbatim" ruling. Raise it separately if it should move.

CREATE OR REPLACE FUNCTION public.start_work_order(p_wo_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wo    public.work_orders;
  v_truck public.trucks;
begin
  select * into v_wo from public.work_orders where id = p_wo_id for update;
  if v_wo.id is null then
    raise exception 'Work order not found.';
  end if;
  if v_wo.status <> 'open' then
    raise exception 'Only an open work order can be started (current status: %).', v_wo.status;
  end if;

  if v_wo.inventory_deducted_at is null then
    perform public.deduct_work_order_parts(p_wo_id, p_actor);
  end if;

  update public.work_orders
     set status = 'in_progress',
         started_by = p_actor
   where id = p_wo_id
  returning * into v_wo;

  select * into v_truck from public.trucks where id = v_wo.truck_id for update;
  if v_truck.assigned_driver_id is not null
     and not exists (select 1 from public.work_orders wo
                      where wo.truck_id = v_wo.truck_id and wo.status = 'in_progress' and wo.id <> p_wo_id)
     and not exists (select 1 from public.outsourced_jobs oj
                      where oj.truck_id = v_wo.truck_id and oj.status = 'in_progress')
  then
    update public.trucks
       set driver_before_maintenance = assigned_driver_id,
           assigned_driver_id = null
     where id = v_wo.truck_id;
  end if;

  return v_wo;
end;
$function$
;

-- Section 6 footer. A REDEFINED FUNCTION IS EXECUTE-TO-PUBLIC AGAIN — create or
-- replace resets the ACL to the Postgres default, and anon inherits PUBLIC.
-- 0193's event trigger now also strips public+anon at ddl_command_end, but the
-- footer stays: it is the layer that does not depend on an event trigger
-- existing, and on a from-scratch rebuild the ordering that saves us is
-- incidental rather than designed. Revoking anon alone changes nothing — the
-- offender is the PUBLIC entry.
revoke execute on function public.start_work_order(uuid, text) from public, anon;
grant  execute on function public.start_work_order(uuid, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dispatch_outsourced_job(p_job_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS outsourced_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job   public.outsourced_jobs;
  v_truck public.trucks;
begin
  select * into v_job from public.outsourced_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Outsourced job not found.';
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'Only a scheduled job can be dispatched (current status: %).', v_job.status;
  end if;

  update public.outsourced_jobs
     set status = 'in_progress',
         started_by = p_actor
   where id = p_job_id
  returning * into v_job;

  select * into v_truck from public.trucks where id = v_job.truck_id for update;
  if v_truck.assigned_driver_id is not null
     and not exists (select 1 from public.outsourced_jobs oj
                      where oj.truck_id = v_job.truck_id and oj.status = 'in_progress' and oj.id <> p_job_id)
     and not exists (select 1 from public.work_orders wo
                      where wo.truck_id = v_job.truck_id and wo.status = 'in_progress')
  then
    update public.trucks
       set driver_before_maintenance = assigned_driver_id,
           assigned_driver_id = null
     where id = v_job.truck_id;
  end if;

  return v_job;
end;
$function$
;

revoke execute on function public.dispatch_outsourced_job(uuid, text) from public, anon;
grant  execute on function public.dispatch_outsourced_job(uuid, text) to authenticated, service_role;


-- ===========================================================================
-- 2) commission_types.label_ar -> NOT NULL
--    DIRECTION: prod <- files. A REAL PRODUCTION SCHEMA CHANGE.
-- ===========================================================================
-- 0080 declares the column NOT NULL. Production has attnotnull = false; the
-- constraint was never applied there.
--
-- Measured on production 2026-09-10, BEFORE this file: 6 rows, 0 with label_ar
-- IS NULL, 0 blank. (Test carries 5 rows — a data difference, not a schema one.)
--
-- THE GUARD BELOW IS NOT DECORATION. ALTER ... SET NOT NULL would fail on its
-- own if a null appeared between that measurement and this run, but it fails
-- with a generic 23502 naming neither the count nor what to do. One null makes
-- the whole file roll back; the explicit check says which column, how many rows
-- and that they must be filled first. Re-measure rather than trusting the 0.

do $$
declare
  v_nulls bigint;
begin
  select count(*) into v_nulls
    from public.commission_types
   where label_ar is null;

  if v_nulls <> 0 then
    raise exception
      '0194: commission_types.label_ar has % null row(s) - SET NOT NULL cannot apply. Fill them, then re-run this file. (Measured 0 on production 2026-09-10; this is a fresh reading.)',
      v_nulls;
  end if;
end
$$;

-- No-op on a fresh rebuild: 0080 already declared it NOT NULL.
alter table public.commission_types
  alter column label_ar set not null;


-- ===========================================================================
-- 3) staff_commissions_commission_type_fkey -> ON UPDATE CASCADE ON DELETE RESTRICT
--    DIRECTION: prod <- files. A CONSTRAINT-ACTION CHANGE, NOT A DATA CHANGE.
-- ===========================================================================
-- Measured 2026-09-10:
--   prod: FOREIGN KEY (commission_type) REFERENCES commission_types(key)
--         confupdtype = 'a' (NO ACTION), confdeltype = 'a' (NO ACTION)
--   file (0080:93) / test: same columns, ON UPDATE CASCADE ON DELETE RESTRICT
--         confupdtype = 'c',            confdeltype = 'r'
--
-- NO ROW CHANGES. Referential actions govern what happens to CHILD rows on a
-- future UPDATE or DELETE of a PARENT row. Recreating the constraint re-validates
-- the existing children (6 parent rows, trivial) and rewrites nothing.
--
-- The referenced side is commission_types_key_key UNIQUE (key) — present on both
-- catalogs, so the recreate has a unique index to bind to. The sibling FK
-- staff_commissions_staff_id_fkey is 'a'/'c' on BOTH sides and is not touched.
--
-- WORTH KNOWING, SO NOBODY LATER READS THIS AS A BUG THAT WAS BITING:
-- commission_types.key is an IMMUTABLE KEY under CLAUDE.md section 6 — a rename
-- updates the NAME, never the key. So ON UPDATE CASCADE describes an event the
-- architecture forbids, and is belt-and-braces. ON DELETE RESTRICT is the half
-- that does real work, and it differs from NO ACTION only in deferrability.
-- This section buys parity of TEXT, and close to nothing operationally. That is
-- a fine reason to do it, and a bad reason to claim it fixed something.

alter table public.staff_commissions
  drop constraint if exists staff_commissions_commission_type_fkey;

alter table public.staff_commissions
  add constraint staff_commissions_commission_type_fkey
  foreign key (commission_type)
  references public.commission_types(key)
  on update cascade
  on delete restrict;


-- ===========================================================================
-- 4) INDEX CONVERGENCE — THREE DISTINCT INDEXES, NOT FOUR
-- ===========================================================================
-- Measured 2026-09-10. Prod public index count 238, test 236; the +2 is exactly
-- this set (3 prod-only minus 1 file-only).
--
--   staff_commissions_staff_id_idx          prod YES / test no   btree (staff_id)
--   stock_receipt_approvals_receipt_id_idx  prod YES / test no   btree (stock_receipt_id)
--   stock_receipts_status_idx               prod YES / test no   btree (status)
--   staff_commissions_staff_idx (0080)      prod no  / test YES  btree (staff_id, commission_date DESC)
--
-- THE ORIGINAL PLAN WAS "BOTH SIDES CARRY ALL FOUR". THAT IS WRONG, AND THIS IS
-- WHY. A btree on (staff_id, commission_date DESC) serves every access path a
-- btree on (staff_id) serves, by leading-column prefix scan. Carrying both
-- leaves a permanently redundant index on BOTH databases: write amplification on
-- every insert and update to staff_commissions, extra pages to vacuum, and not
-- one query plan improved.
--
-- Usage on production, pg_stat_user_indexes, stats since 2026-05-22 15:13:20+00
-- (about 16 weeks):
--
--     stock_receipts_status_idx ................ 302 scans   KEEP, earns it
--     stock_receipt_approvals_receipt_id_idx ....  72 scans   KEEP, earns it
--     staff_commissions_pkey ....................   3 scans
--     staff_commissions_staff_id_idx ............   0 scans   DROP, subsumed
--
-- The one being dropped is the one that has never been scanned, and the
-- composite replacing it is strictly more capable. Net: both catalogs end with
-- the same three distinct indexes.
--
-- ORDER IS LOAD-BEARING. Create the composite FIRST so no window exists in which
-- staff_commissions has no index on staff_id; drop the subsumed one LAST. Both
-- are 16 KB, so CONCURRENTLY is unnecessary — and note CONCURRENTLY could not be
-- used here anyway, since it cannot run inside the SQL Editor's transaction.

-- FIRST — the file-only composite. No-op on a fresh rebuild (0080 created it).
create index if not exists staff_commissions_staff_idx
  on public.staff_commissions using btree (staff_id, commission_date desc);

-- THEN — codify the two prod-only indexes that earn their keep. No-op on prod.
create index if not exists stock_receipt_approvals_receipt_id_idx
  on public.stock_receipt_approvals using btree (stock_receipt_id);

create index if not exists stock_receipts_status_idx
  on public.stock_receipts using btree (status);

-- LAST — drop the subsumed single-column index. No-op on a fresh rebuild, where
-- it was never created in the first place.
drop index if exists public.staff_commissions_staff_id_idx;


-- ===========================================================================
-- 5) VERIFICATION — RAISES. A grid that prints is not a grid that passed.
-- ===========================================================================
-- CLAUDE.md section 5: a migration's own result-grid is NOT proof it applied.
-- A verification SELECT prints whatever it finds and the run still reads green.
-- These RAISE, so a failure rolls the whole file back rather than being read
-- past. The catalog is still the evidence — re-check pg_index / pg_proc /
-- pg_constraint / has_function_privilege afterwards.
--
-- ASSERTION (1) IS THE ONE THAT EARNS ITS KEEP. `create index if not exists`
-- checks the NAME and never the DEFINITION: an index of the right name and the
-- wrong columns is accepted silently. So the composite's definition is asserted,
-- not just its existence.
--
-- ASSERTION (5) PROVES SECTION 1 IS THE NO-OP IT CLAIMS. The two md5s are of
-- pg_get_functiondef() as read from PRODUCTION on 2026-09-10, before this file.
-- If the bodies above were reformatted, retyped or "tidied" in review, the
-- round-trip no longer reproduces those bytes and this fails. That is the whole
-- point: the claim "applying this changes nothing on prod" is checkable, so it
-- is checked rather than asserted in a comment.

do $$
declare
  v_def     text;
  v_cnt     bigint;
  v_upd     "char";
  v_del     "char";
  v_notnull boolean;
  v_bad_fns text;
begin
  -- (1) The composite exists AND has the right shape.
  select indexdef into v_def
    from pg_indexes
   where schemaname = 'public' and indexname = 'staff_commissions_staff_idx';

  if v_def is null then
    raise exception '0194 assert 1a FAILED: staff_commissions_staff_idx does not exist.';
  end if;
  if v_def !~* 'staff_id' or v_def !~* 'commission_date DESC' then
    raise exception
      '0194 assert 1b FAILED: staff_commissions_staff_idx exists but is not (staff_id, commission_date DESC). Actual: %. create index if not exists matched the NAME and accepted a different index - drop it and re-run.',
      v_def;
  end if;

  -- (2) The two codified prod-only indexes exist.
  select count(*) into v_cnt
    from pg_indexes
   where schemaname = 'public'
     and indexname in ('stock_receipt_approvals_receipt_id_idx', 'stock_receipts_status_idx');

  if v_cnt <> 2 then
    raise exception
      '0194 assert 2 FAILED: expected both stock_receipt_approvals_receipt_id_idx and stock_receipts_status_idx, found % of 2.',
      v_cnt;
  end if;

  -- (3) The subsumed index is gone.
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'staff_commissions_staff_id_idx') then
    raise exception
      '0194 assert 3 FAILED: staff_commissions_staff_id_idx still exists. It is subsumed by staff_commissions_staff_idx and had 0 scans in 16 weeks.';
  end if;

  -- (4) label_ar is NOT NULL.
  select a.attnotnull into v_notnull
    from pg_attribute a
   where a.attrelid = 'public.commission_types'::regclass
     and a.attname  = 'label_ar'
     and a.attnum > 0 and not a.attisdropped;

  if v_notnull is distinct from true then
    raise exception '0194 assert 4 FAILED: commission_types.label_ar is still nullable.';
  end if;

  -- (5) The FK carries CASCADE on update, RESTRICT on delete.
  select c.confupdtype, c.confdeltype into v_upd, v_del
    from pg_constraint c
   where c.conrelid = 'public.staff_commissions'::regclass
     and c.conname  = 'staff_commissions_commission_type_fkey';

  if v_upd is null then
    raise exception '0194 assert 5a FAILED: staff_commissions_commission_type_fkey does not exist.';
  end if;
  if v_upd <> 'c' or v_del <> 'r' then
    raise exception
      '0194 assert 5b FAILED: staff_commissions_commission_type_fkey has confupdtype=% confdeltype=%, expected c / r (ON UPDATE CASCADE ON DELETE RESTRICT).',
      v_upd::text, v_del::text;
  end if;

  -- (6) Both work-order functions reproduce production's bytes EXACTLY.
  select md5(pg_get_functiondef(p.oid)) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.oid::regprocedure::text = 'start_work_order(uuid,text)';

  if v_def is distinct from '4214e90c5911905a6cc3b361c906b127' then
    raise exception
      '0194 assert 6a FAILED: start_work_order(uuid,text) definition md5 is %, expected 4214e90c5911905a6cc3b361c906b127 (production, measured 2026-09-10). The body in section 1 was altered - this file no longer codifies what prod runs.',
      coalesce(v_def, '<function missing>');
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.oid::regprocedure::text = 'dispatch_outsourced_job(uuid,text)';

  if v_def is distinct from '6b501351440a5a038150a7c86818ef54' then
    raise exception
      '0194 assert 6b FAILED: dispatch_outsourced_job(uuid,text) definition md5 is %, expected 6b501351440a5a038150a7c86818ef54 (production, measured 2026-09-10). The body in section 1 was altered - this file no longer codifies what prod runs.',
      coalesce(v_def, '<function missing>');
  end if;

  -- (7) Section 6 grants on both functions.
  --     Read back with has_function_privilege, never proacl matching - the two
  --     wrong ways to read this INVERT the answer and report a healthy function
  --     as a breach. Identify by oid::regprocedure::text, never by
  --     pg_get_function_identity_arguments().
  --
  --     anon = false ALSO proves PUBLIC holds no grant: anon inherits PUBLIC, so
  --     a PUBLIC grant would make this true. There is no separate check to add.
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text in ('start_work_order(uuid,text)', 'dispatch_outsourced_job(uuid,text)')
     and has_function_privilege('anon',          p.oid, 'execute') = false
     and has_function_privilege('authenticated', p.oid, 'execute') = true
     and has_function_privilege('service_role',  p.oid, 'execute') = true;

  if v_cnt <> 2 then
    raise exception
      '0194 assert 7 FAILED: expected 2 work-order functions with anon-none / authenticated+service_role, found %. create or replace resets the ACL to EXECUTE TO PUBLIC - the footers in section 1 are what re-close it.',
      v_cnt;
  end if;

  -- (8) The schema-wide invariant still holds. This file replaced two SECURITY
  --     DEFINER functions; assert nothing anywhere came loose, not just these
  --     two. Trigger functions are excluded - they are unreachable via PostgREST
  --     and several legitimately remain anon-executable.
  --
  --     THIS PREDICATE IS 0192's, CHARACTER FOR CHARACTER, AND THAT IS
  --     DELIBERATE. Two different spellings of one invariant is how a guard
  --     stops guarding: the weaker one passes, everyone reads green, and nobody
  --     notices the two files disagree about what is being asserted. An earlier
  --     draft of this block also excluded prorettype = event_trigger, which
  --     0192 does NOT - that would have exempted
  --     revoke_anon_execute_on_new_functions, the one function whose whole job
  --     is enforcing this. If 0192's predicate changes, change this one with it.
  select coalesce(string_agg(p.oid::regprocedure::text, ', '
                             order by p.oid::regprocedure::text), ''),
         count(*)
    into v_bad_fns, v_cnt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('anon', p.oid, 'execute');

  if v_cnt <> 0 then
    raise exception
      '0194 assert 8 FAILED: % non-trigger function(s) in public are anon-executable: %. The invariant is zero. The anon key ships in the client bundle, and a SECURITY DEFINER function runs as its owner, bypassing RLS. Rolling back.',
      v_cnt, v_bad_fns;
  end if;

  raise notice '0194: all eight assertions passed. Work-order functions codified byte-exact from production and re-revoked, label_ar NOT NULL, FK carries cascade/restrict, three distinct indexes present and the subsumed one dropped.';
end
$$;
