-- 0150_update_project_stops_writing_commission.sql
-- RULING 2: set_project_commission (0148) becomes the ONLY path by which a
-- commission figure changes on an existing project.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
-- APPLY AFTER 0148. It is meaningless before the replacement writer exists.
--
-- ===========================================================================
-- THE WHOLE CHANGE IS THREE DELETED LINES
-- ===========================================================================
-- update_project_with_customer's `update public.projects ... set` list loses:
--
--     commission_mode       = p_commission_mode,
--     commission_value      = p_commission_value,
--     commission_bump_pct   = p_commission_bump,
--
-- Nothing else moves. Not the payment-mode switch guard, not the customers
-- UPDATE, not the project_drivers diff, not the signature, not the security
-- posture, not the ACL. That is not a promise in a comment - assertion (2)
-- rebuilds the expected new definition by deleting exactly those three lines
-- from the definition captured before the replace and compares it to what
-- Postgres actually stored. Any other edit, anywhere in the 2,858-character
-- body, fails the file and rolls it back.
--
-- Measured at drafting: pg_get_functiondef is 2858 chars before and 2701 after
-- (157 = the three lines with their newlines), and the expected post-replace
-- definition hashes to 6eefccefbe0b9d8d5f8630b4a0f5d4bc. The assertion compares
-- the text, not the hash - the numbers are here so a reviewer can see the size
-- of the change without reading the diff.
--
-- ===========================================================================
-- WHY REMOVE THE WRITE RATHER THAN FEED IT THE RIGHT VALUE
-- ===========================================================================
-- The rejected alternative was to leave update_project_with_customer writing the
-- three columns and have the modal pass it commission_config_at(project, today) -
-- the in-force values - so its write is a no-op or a self-heal.
--
--   1. IT MAKES THE TWO RPCs NON-COMMUTATIVE. A save that changed commission AND
--      another field fires both. With update_project_with_customer running LAST
--      it writes the pre-filled OLD figures over the mirror set_project_commission
--      just wrote; the values now differ, so projects_commission_history_upd (0147)
--      fires and its DO UPDATE rewrites the (project, today) history row back to
--      the old figures too. The change is reverted in the column AND in the
--      history, the screen says saved, and the surviving row carries
--      set_project_commission's note over values it never wrote. With the three
--      lines gone the two calls commute and ordering stops being load-bearing.
--   2. IT MAKES THE INVARIANT A PROPERTY OF ONE REACT COMPONENT. This RPC is
--      security invoker and granted to authenticated - any signed-in session can
--      call it with any commission figures at all. "The modal passes the right
--      value" is a convention, and a convention is not a guard.
--   3. THE PRE-FILL IS A SNAPSHOT AND "IN FORCE" IS TIME-VARYING. A tab opened
--      yesterday holds yesterday's in-force value. A queued row activates
--      overnight. This morning the user renames the project and saves: the modal
--      posts the stale figure, projects flips back, and the 0147 trigger stamps a
--      today-dated history row REVERSING terms nobody touched. No pre-fill rule
--      fixes that, because the pre-fill was correct when it was read. Only
--      removing the write does.
--
-- ===========================================================================
-- THE SIGNATURE IS DELIBERATELY UNCHANGED. THE THREE PARAMETERS STAY, IGNORED.
-- ===========================================================================
-- p_commission_mode / p_commission_value / p_commission_bump remain in the
-- signature and are now read by nothing. That is not an oversight:
--
--   · Dropping them changes the identity signature, which means DROP + CREATE
--     rather than CREATE OR REPLACE. Between the migration running and the app
--     deploying, every project save would fail PGRST202 on a live money RPC.
--     Migrations here are run by hand in the SQL editor and deploys are separate,
--     so that window is real, not theoretical.
--   · If the DROP were ever skipped or partially applied, two overloads would
--     coexist and PostgREST would answer PGRST203 on every call - a worse
--     failure than the one being fixed.
--   · CREATE OR REPLACE keeps the ACL and makes the file reversible by re-running
--     the captured before-definition. Rollback is printed at the foot.
--   · They cannot be given DEFAULTs to let callers omit them - they sit at
--     positions 11-13 of 24 and everything after a defaulted parameter must also
--     be defaulted.
--
-- AN IGNORED PARAMETER IS A LOADED GUN AND THIS PROJECT HAS BEEN SHOT BY ONE.
-- customer_write_offs.payment_mode was written by an RPC and read by nothing from
-- 0139 to 0143 (CLAUDE.md section 7), and the answer there was to remove it. The
-- same answer applies here, in its own migration, once 3c has shipped and no
-- caller sends the values any more: at that point dropping the three parameters
-- has no live caller to break. Flagged as owed, not silently accepted.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY NOT TOUCHED
-- ===========================================================================
-- · create_project_with_customer. Creating a project still writes the three
--   columns, and the 0147 INSERT trigger still turns that into the baseline
--   history row. That is the intended creation path and it is not in scope.
-- · Both 0147 triggers. They are still how the creation baseline is written and
--   how set_project_commission's mirror stays idempotent. Assertion (6) reads
--   them back.
-- · projects.commission_* itself. The columns stay. After this file their only
--   writers are the creation INSERT and set_project_commission's today-only
--   mirror, and 0149's view exposes whether they have drifted from the in-force
--   answer. Nothing prices money off them any more - step 2b moved pricing to
--   commission_config_at(project, trip_date).
-- · The function's missing `set search_path`. It has none today (proconfig is
--   null) and it still has none after. Adding one would be a posture change
--   smuggled into a money RPC on the back of an unrelated fix; it belongs in a
--   hardening pass of its own, applied to every function that lacks it at once.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Capture what is there NOW - the definition, the posture, the ACL, and
--    fingerprints of the two tables this must not move. Assertions compare
--    against these. `on commit drop` disposes of it with the transaction.
-- ---------------------------------------------------------------------
create temp table _0150_before on commit drop as
select p.oid                     as fn_oid,
       pg_get_functiondef(p.oid) as def,
       p.prosecdef,
       p.provolatile,
       p.proconfig,
       p.proacl::text            as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'update_project_with_customer';

create temp table _0150_before_data on commit drop as
select (select md5(coalesce(string_agg(id::text || ':' ||
                                       coalesce(commission_mode, '~') || ':' ||
                                       coalesce(commission_value::text, '~') || ':' ||
                                       coalesce(commission_bump_pct::text, '~'),
                                       ',' order by id), ''))
          from public.projects)                                   as proj_fingerprint,
       (select count(*) from public.project_commission_history)    as pch_rows,
       (select md5(coalesce(string_agg(id::text || ':' || effective_from::text || ':' ||
                                       commission_mode || ':' || commission_value::text || ':' ||
                                       commission_bump_pct::text || ':' || is_baseline::text,
                                       ',' order by id), ''))
          from public.project_commission_history)                  as pch_fingerprint;

-- EXACTLY ONE OVERLOAD MUST EXIST BEFORE WE START. If there were two, the
-- CREATE OR REPLACE below would silently fix one and leave the other writing
-- commission - and PostgREST would be free to pick either.
do $$
declare v_n integer;
begin
  select count(*) into v_n from _0150_before;
  if v_n <> 1 then
    raise exception
      'Expected exactly 1 update_project_with_customer, found %. Resolve the overloads before running 0150.', v_n;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) The replacement. Byte-identical to the captured definition except that the
--    projects UPDATE no longer sets the three commission columns.
--
--    DO NOT REFLOW THIS BODY. Assertion (2) compares the stored source against
--    the before-definition with three lines deleted; re-indenting a line, even
--    harmlessly, fails the file. That strictness is the point - it is what makes
--    "only three lines changed" checkable rather than asserted.
--
--    No SECURITY clause and no SET clause, matching the original exactly
--    (prosecdef = false, proconfig = null). Restating either would change the
--    posture of a live money RPC as a side effect of this fix.
-- ---------------------------------------------------------------------
create or replace function public.update_project_with_customer(
  p_project_id            uuid,
  p_cust_name             text,
  p_cust_type             text,
  p_contact_name          text,
  p_phone                 text,
  p_delivery_address      text,
  p_delivery_lat          double precision,
  p_delivery_lng          double precision,
  p_proj_name             text,
  p_rate                  numeric,
  p_commission_mode       text,
  p_commission_value      numeric,
  p_commission_bump       numeric,
  p_default_water_station text,
  p_water_type            text,
  p_description           text,
  p_driver_ids            uuid[],
  p_payment_mode          text,
  p_cust_email            text,
  p_current_balance       numeric default 0,
  p_cust_name_ar          text default null::text,
  p_cust_vat_number       text default null::text,
  p_cust_cr_number        text default null::text,
  p_cust_billing_address  text default null::text
)
returns uuid
language plpgsql
as $$
declare
  v_cust_id        uuid;
  v_current_mode   text;
  v_switch_blocked boolean;
  v_switch_reason  text;
begin
  select customer_id, payment_mode into v_cust_id, v_current_mode
    from public.projects
   where id = p_project_id;
  if v_cust_id is null then
    raise exception 'Project not found.';
  end if;

  if v_current_mode is not null and v_current_mode is distinct from p_payment_mode then
    select blocked, reason into v_switch_blocked, v_switch_reason
      from public.can_switch_payment_mode(p_project_id, p_payment_mode, p_current_balance);
    if v_switch_blocked then
      raise exception '%', v_switch_reason;
    end if;
  end if;

  update public.customers
     set name                  = p_cust_name,
         name_ar               = p_cust_name_ar,
         customer_type         = p_cust_type,
         contact_name          = p_contact_name,
         phone                 = p_phone,
         delivery_site_address = p_delivery_address,
         delivery_lat          = p_delivery_lat,
         delivery_lng          = p_delivery_lng,
         email                 = p_cust_email,
         vat_number            = p_cust_vat_number,
         cr_number             = p_cust_cr_number,
         billing_address       = p_cust_billing_address
   where id = v_cust_id;

  update public.projects
     set name                  = p_proj_name,
         rate_per_trip_sar     = p_rate,
         default_water_station = p_default_water_station,
         water_type            = p_water_type,
         description           = p_description,
         payment_mode          = p_payment_mode
   where id = p_project_id;

  delete from public.project_drivers
   where project_id = p_project_id and driver_id <> all (p_driver_ids);
  insert into public.project_drivers (project_id, driver_id)
  select p_project_id, d from unnest(p_driver_ids) as d
  on conflict (project_id, driver_id) do nothing;

  return p_project_id;
end;
$$;

comment on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, numeric, numeric, text, text, text, uuid[], text, text,
  numeric, text, text, text, text) is
  'Edits a project and its 1:1 customer in one transaction. DOES NOT WRITE '
  'COMMISSION. p_commission_mode / p_commission_value / p_commission_bump are '
  'accepted for signature compatibility and ignored (0150); the only path that '
  'changes a commission figure on an existing project is '
  'set_project_commission (0148), so that a change cannot be reverted by an '
  'unrelated save carrying a stale pre-fill. Drop the three parameters once no '
  'caller sends them.';

-- ---------------------------------------------------------------------
-- 2) ASSERT. Any failure rolls the replacement back.
-- ---------------------------------------------------------------------
do $$
declare
  v_n           integer;
  v_def         text;
  v_expected    text;
  v_secdef      boolean;
  v_volatile    "char";
  v_config      text[];
  v_acl         text;
  v_anon_exec   boolean;
  v_auth_exec   boolean;
  v_proj_fp     text;
  v_pch_rows    bigint;
  v_pch_fp      text;
  v_ins_type    smallint;
  v_upd_type    smallint;
begin
  -- (1) STILL EXACTLY ONE OVERLOAD.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';
  if v_n <> 1 then
    raise exception
      'update_project_with_customer now has % definitions. CREATE OR REPLACE must not have produced an overload. Rolling back.', v_n;
  end if;

  select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text,
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         pg_get_functiondef(p.oid)
    into v_secdef, v_volatile, v_config, v_acl, v_anon_exec, v_auth_exec, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';

  -- (2) THE ONLY DIFFERENCE IS THE THREE COMMISSION LINES. This is the whole
  --     assurance of the file: rebuild the expected definition by deleting them
  --     from the before-image and demand an exact match. A stray edit anywhere
  --     else in the body - or a reflowed line, or a lost guard - fails here.
  --     Written as ONE E-string on one line on purpose: adjacent string literals
  --     are only concatenated when a newline separates them, and a reflow of this
  --     comment block could otherwise change what is being searched for.
  select replace(b.def, E'         commission_mode       = p_commission_mode,\n         commission_value      = p_commission_value,\n         commission_bump_pct   = p_commission_bump,\n', '')
    into v_expected
    from _0150_before b;

  if v_expected = (select b.def from _0150_before b) then
    raise exception
      'The three commission lines were not found in the captured definition of update_project_with_customer. It is not the body 0150 was written against - review before applying. Rolling back.';
  end if;

  if v_def is distinct from v_expected then
    raise exception
      'update_project_with_customer differs from "the old body minus the three commission lines". Expected % chars, got %. Something other than the commission write changed. Rolling back.',
      length(v_expected), length(v_def);
  end if;

  -- (3) POSTURE AND ACL UNCHANGED. A money RPC must not quietly become definer,
  --     change volatility, gain a search_path, or widen its grants because an
  --     unrelated line was deleted from its body.
  if v_secdef is not false
     or v_volatile is distinct from 'v'::"char"
     or v_config is not null
     or v_anon_exec is not false
     or v_auth_exec is not true
     or v_acl is distinct from (select b.acl from _0150_before b) then
    raise exception
      'update_project_with_customer posture moved: definer=%, volatile=%, config=%, anon=%, auth=%, acl=%. Rolling back.',
      v_secdef, v_volatile, v_config, v_anon_exec, v_auth_exec, v_acl;
  end if;

  -- (4) NO COMMISSION FIGURE MOVED. This file replaces a function; it must not
  --     have run one.
  select md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_mode, '~') || ':' ||
                                 coalesce(commission_value::text, '~') || ':' ||
                                 coalesce(commission_bump_pct::text, '~'),
                                 ',' order by id), ''))
    into v_proj_fp
    from public.projects;

  if not exists (select 1 from _0150_before_data d where d.proj_fingerprint = v_proj_fp) then
    raise exception '0150 changed projects.commission_*: fingerprint %. Rolling back.', v_proj_fp;
  end if;

  -- (5) AND NO HISTORY ROW WAS WRITTEN OR LOST.
  select count(*),
         md5(coalesce(string_agg(id::text || ':' || effective_from::text || ':' ||
                                 commission_mode || ':' || commission_value::text || ':' ||
                                 commission_bump_pct::text || ':' || is_baseline::text,
                                 ',' order by id), ''))
    into v_pch_rows, v_pch_fp
    from public.project_commission_history;

  if not exists (select 1 from _0150_before_data d
                  where d.pch_rows = v_pch_rows and d.pch_fingerprint = v_pch_fp) then
    raise exception
      '0150 changed project_commission_history: % rows / fingerprint %. Rolling back.', v_pch_rows, v_pch_fp;
  end if;

  -- (6) BOTH 0147 TRIGGERS SURVIVE. Creation still depends on the INSERT trigger
  --     for its baseline, and set_project_commission's mirror still depends on
  --     the UPDATE trigger being idempotent with it.
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
      'The 0147 sync triggers are not both present as expected: ins tgtype=%, upd tgtype=%. Expected 5 and 17. Rolling back.',
      v_ins_type, v_upd_type;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION - run separately. Anything that calls the RPC is rolled back.
-- ===========================================================================
--
-- A) THE DEFINITION IS 157 CHARACTERS SHORTER AND MENTIONS COMMISSION NOWHERE
--    IN ITS BODY:
--      select length(pg_get_functiondef(p.oid)) as len,
--             pg_get_functiondef(p.oid) like '%commission_mode       = p_commission_mode%' as still_writes
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- 2701 / false. (2858 / true before.) The parameters are still in the
--      -- header - that is expected; what must be gone is the SET-list line.
--
-- B) A SAVE THAT CARRIES WRONG COMMISSION FIGURES MOVES NOTHING. This is the
--    bug the file exists to close, exercised directly. ROLLED BACK:
--      begin;
--        select commission_mode, commission_value, commission_bump_pct
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- write these down.
--        select count(*) as pch_before from public.project_commission_history;
--
--        select public.update_project_with_customer(
--          p_project_id            => 'fd408e6e-5acf-4109-b474-28ae1b7e8e92',
--          p_cust_name             => (select c.name from public.customers c
--                                       join public.projects p on p.customer_id = c.id
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_cust_type             => (select c.customer_type from public.customers c
--                                       join public.projects p on p.customer_id = c.id
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_contact_name          => null,
--          p_phone                 => null,
--          p_delivery_address      => null,
--          p_delivery_lat          => null,
--          p_delivery_lng          => null,
--          p_proj_name             => (select p.name from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_rate                  => (select p.rate_per_trip_sar from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_commission_mode       => 'scalable',      -- deliberately wrong
--          p_commission_value      => 999,             -- deliberately wrong
--          p_commission_bump       => 49,              -- deliberately wrong
--          p_default_water_station => (select p.default_water_station from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_water_type            => (select p.water_type from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_description           => 'rehearsal B',
--          p_driver_ids            => (select coalesce(array_agg(pd.driver_id), '{}'::uuid[])
--                                        from public.project_drivers pd
--                                       where pd.project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_payment_mode          => (select p.payment_mode from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_cust_email            => null);
--
--        select commission_mode, commission_value, commission_bump_pct, description
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- The three commission columns are UNCHANGED - not 999, not scalable,
--        -- not 49. description IS 'rehearsal B', proving the call really ran and
--        -- the RPC still writes the fields it owns.
--        select count(*) from public.project_commission_history;
--        -- SAME as pch_before. Before 0150 this call would have moved the columns
--        -- AND fired the 0147 trigger, stamping a today-dated row for a change
--        -- nobody made.
--      rollback;
--
-- C) THE PAYMENT-MODE SWITCH GUARD IS UNTOUCHED. Not re-rehearsed here: its
--    bytes are inside the region assertion (2) compares, so if the guard had
--    changed the file would not have applied. Confirm it is still in there:
--      select pg_get_functiondef(p.oid) like '%can_switch_payment_mode%' as guard_present
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- true.
--
-- D) CREATION STILL WRITES COMMISSION AND STILL GETS A BASELINE. Out of scope
--    for this file, so confirm it was left alone:
--      select pg_get_functiondef(p.oid) like '%commission_value%' as still_writes
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='create_project_with_customer';
--      -- true.
--
-- E) POSTURE AND GRANTS, READ BACK:
--      select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- false / v / null /
--      -- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      -- Identical to before. proconfig NULL is correct here - see the header.
--
-- F) THE TEMP TABLES DID NOT SURVIVE:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname in ('_0150_before','_0150_before_data');
--      -- expect 0.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK. Re-running the captured definition restores the write. Take the
-- before-image FIRST, while it is still the live one:
--      select pg_get_functiondef(p.oid)
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
-- Save that text. Executing it verbatim puts the three lines back. The signature
-- never changed, so there is no DROP in either direction and no window where the
-- function does not exist.
-- ===========================================================================
