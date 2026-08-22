-- 0151_update_project_commission_params_defaulted.sql
-- STEP 1 OF 3 in removing p_commission_mode / p_commission_value /
-- p_commission_bump from update_project_with_customer.
--
--   0151 (this file) : make the three parameters OPTIONAL. The function accepts
--                      calls WITH them and calls WITHOUT them. Nothing else
--                      changes - the body is byte-identical to 0150's.
--   step 2 (app)     : stop sending them from the project-save modal, deploy.
--   step 3 (0152)    : drop the three parameters for real, once nothing sends
--                      them. That is when the signature finally shrinks.
--
-- The three steps exist so there is never a moment where a project save fails.
-- Doing 0151 and 0152 as one migration would put every save on PGRST202 for the
-- whole gap between running the SQL and shipping the deploy - and migrations
-- here are run by hand in the SQL editor while deploys are separate, so that gap
-- is real, not theoretical. 0150 already recorded that reasoning as the reason
-- the parameters were LEFT IN; this file is the beginning of taking them out.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews, rehearses and applies.
-- APPLY AFTER 0150. The body this file recreates is 0150's body.
--
-- ===========================================================================
-- WHY THIS IS DROP + CREATE AND NOT CREATE OR REPLACE
-- ===========================================================================
-- The three parameters sit at positions 11, 12 and 13 of 24. Postgres only
-- allows TRAILING defaults - every parameter after a defaulted one must also be
-- defaulted - so they cannot be given `default null` where they stand without
-- defaulting the eleven parameters that follow them. They have to move to the
-- end. Moving a parameter changes the argument-type list, and the argument-type
-- list IS the function's identity: CREATE OR REPLACE cannot do it (it would
-- create a second overload alongside the first, and PostgREST answers PGRST203
-- on every call when two overloads exist).
--
-- So: DROP the old signature, CREATE the new one, IN ONE TRANSACTION. If the
-- CREATE fails for any reason the DROP rolls back with it and the live function
-- is untouched. There is no committed state in which the function is missing.
--
-- RE-RUNNING THIS FILE FAILS LOUDLY, ON PURPOSE. The DROP names the OLD 24-type
-- list, which no longer exists after a successful apply, so a second run dies
-- with 42883 before touching anything. `drop function if exists` would have made
-- the file silently re-runnable and that is worse: it would mean a partial
-- earlier run could be papered over.
--
-- ===========================================================================
-- WHAT MAKES REORDERING SAFE: POSTGREST BINDS ARGUMENTS BY NAME
-- ===========================================================================
-- THIS IS THE LOAD-BEARING PREMISE OF THE WHOLE FILE. supabase-js sends
-- `.rpc('update_project_with_customer', { p_project_id: ..., p_cust_name: ... })`
-- and PostgREST turns that object into a NAMED-argument call
-- (`p_project_id => $1, p_cust_name => $2, ...`). Named binding does not care
-- what order the parameters are declared in. app/trips/actions.ts is the only
-- caller and it passes an object, so every existing call keeps resolving to the
-- same parameters after the reorder.
--
-- THE CONVERSE IS THE HAZARD AND IT IS WORTH STATING PLAINLY: any POSITIONAL
-- caller written against the old order breaks here, and one shape of it breaks
-- QUIETLY. Old positions 11/12/13 were (text, numeric, numeric); new 11/12/13
-- are (text, text, text). A positional call passing a numeric-typed expression
-- at position 12 fails resolution loudly (no implicit numeric->text cast), but a
-- positional call passing bare quoted literals - which are `unknown` and coerce
-- to anything - would bind p_water_type to a commission mode and never complain.
-- There are no positional callers in this repo. If you write one by hand in the
-- SQL editor after this file, use `=>`.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY NOT TOUCHED
-- ===========================================================================
-- · THE BODY. Byte-identical to 0150's, asserted two ways: md5(prosrc) before
--   equals md5(prosrc) after, AND the whole pg_get_functiondef is rebuilt from
--   the before-image with ONLY the parameter list swapped and compared exactly.
--   The payment-mode switch guard, the customers UPDATE, the projects UPDATE
--   (which still does NOT write the three commission columns - that was 0150),
--   the project_drivers diff and the return are all inside that comparison. Do
--   not reflow the body below; a re-indented line fails the file.
-- · THE SECURITY POSTURE. No SECURITY clause and no SET clause, matching the
--   original exactly (prosecdef = false, proconfig = null). The function's
--   missing `set search_path` stays missing. Adding one would be a posture change
--   smuggled into a money RPC on the back of a parameter reorder; it belongs in a
--   hardening pass of its own, applied to every function that lacks one at once.
-- · THE GRANTS - in effect. DROP FUNCTION discards the ACL, so this file has to
--   re-issue it, and re-issuing is not the same as preserving. The revoke/grant
--   block below is written to reproduce the captured ACL string exactly
--   ({postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}) and
--   assertion (4) compares the new proacl to the captured one character for
--   character rather than checking that "authenticated can execute".
-- · projects.commission_* and project_commission_history. Fingerprinted before
--   and after. This file replaces a function; it must not run one.
-- · set_project_commission (0148) remains the ONLY writer of a commission figure
--   on an existing project, and v_project_commission_now (0149) remains the
--   display source. Neither is referenced here.
--
-- Measured at drafting, against the live 0150 function:
--   pronargs 24, pronargdefaults 5, md5(prosrc) e0a731881696673fac355ab5269dc5c8,
--   length(prosrc) 1948, length(pg_get_functiondef) 2701, prosecdef false,
--   provolatile v, proconfig null,
--   proacl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
-- After this file: pronargs still 24, pronargdefaults 5 -> 8, prosrc md5 and
-- length UNCHANGED, and length(pg_get_functiondef) 2701 -> 2764. That +63 is
-- exactly ' DEFAULT NULL::text' (19) + ' DEFAULT NULL::numeric' (22) twice -
-- moving three parameters costs nothing, defaulting them costs 63 characters,
-- and there is no room in the arithmetic for anything else to have changed.
-- The assertions compare the TEXT, not these numbers; they are here so a
-- reviewer can size the change without reading the diff.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Capture what is there NOW - definition, parameter list, posture, owner,
--    ACL, and fingerprints of the two tables this must not move. Every
--    assertion at the foot compares against these. This MUST run before the
--    DROP: after the DROP there is nothing left to read. `on commit drop`
--    disposes of it with the transaction either way.
-- ---------------------------------------------------------------------
create temp table _0151_before on commit drop as
select p.oid                                as fn_oid,
       pg_get_functiondef(p.oid)            as def,
       pg_get_function_arguments(p.oid)     as args,
       p.prosrc,
       md5(p.prosrc)                        as src_md5,
       p.pronargs,
       p.pronargdefaults,
       p.prosecdef,
       p.provolatile,
       p.proconfig,
       p.proacl::text                       as acl,
       pg_get_userbyid(p.proowner)          as owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'update_project_with_customer';

create temp table _0151_before_data on commit drop as
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

-- PRE-FLIGHT. Refuse to run against anything other than the function this file
-- was written against. Exactly one overload, and the exact 0150 body - because
-- the CREATE below RETYPES that body from source, and if the live one had
-- drifted this file would silently overwrite the drift instead of preserving it.
do $$
declare
  v_n   integer;
  v_md5 text;
begin
  select count(*) into v_n from _0151_before;
  if v_n <> 1 then
    raise exception
      'Expected exactly 1 update_project_with_customer, found %. Resolve the overloads before running 0151.', v_n;
  end if;

  select b.src_md5 into v_md5 from _0151_before b;
  if v_md5 is distinct from 'e0a731881696673fac355ab5269dc5c8' then
    raise exception
      'update_project_with_customer body is md5 %, expected e0a731881696673fac355ab5269dc5c8 (the 0150 body). 0151 recreates that body verbatim and would overwrite whatever changed it. Reconcile first.', v_md5;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) DROP the old signature by its exact 24-type list. Named here in full
--    rather than by name alone so that if a second overload ever appeared
--    between the pre-flight and this line, the DROP could still only remove
--    the one it was aimed at.
-- ---------------------------------------------------------------------
drop function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, numeric, numeric, text, text, text, uuid[], text, text,
  numeric, text, text, text, text);

-- ---------------------------------------------------------------------
-- 2) CREATE the same function with the three commission parameters moved to
--    the end and defaulted null.
--
--    Parameters 1-10 and the eleven that used to follow the commission block
--    keep their existing order and their existing defaults. The commission
--    three are appended at 22/23/24, each `default null` with an explicit cast
--    so the catalog renders `DEFAULT NULL::text` / `DEFAULT NULL::numeric` and
--    the read-back in assertion (3) is comparing against a known string rather
--    than whatever Postgres would have inferred.
--
--    DO NOT REFLOW THE BODY. Assertion (2) demands md5(prosrc) is unchanged and
--    assertion (5) rebuilds the entire functiondef from the before-image; a
--    harmless re-indent fails the file. That strictness is the point - it is
--    what makes "only the parameter list moved" checkable rather than asserted.
--
--    No SECURITY clause and no SET clause, matching the original exactly.
-- ---------------------------------------------------------------------
create function public.update_project_with_customer(
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
  p_cust_billing_address  text default null::text,
  p_commission_mode       text default null::text,
  p_commission_value      numeric default null::numeric,
  p_commission_bump       numeric default null::numeric
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

-- ---------------------------------------------------------------------
-- 3) RE-ISSUE THE GRANTS. DROP FUNCTION discarded them and a freshly created
--    function is EXECUTE-to-PUBLIC by default (proacl null renders as "owner
--    plus PUBLIC"). Without this block the reorder would have quietly widened a
--    money RPC to anon. The order of these statements is what reproduces the
--    captured ACL string exactly: revoke materialises the default ACL and strips
--    PUBLIC, then the grants append authenticated and service_role in that
--    order. Assertion (4) compares the result to the captured string.
--
--    `from anon` is a no-op today - anon holds no explicit entry, and revoking a
--    privilege that was never granted adds nothing to the ACL. It is written
--    anyway so the file states the intent rather than relying on PUBLIC's
--    removal to have covered it.
-- ---------------------------------------------------------------------
revoke all on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric) from public;

revoke all on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric) from anon;

grant execute on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric) to authenticated;

grant execute on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric) to service_role;

comment on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric) is
  'Edits a project and its 1:1 customer in one transaction. DOES NOT WRITE '
  'COMMISSION - set_project_commission (0148) is the only path that changes a '
  'commission figure on an existing project, so that a change cannot be '
  'reverted by an unrelated save carrying a stale pre-fill (0150). '
  'p_commission_mode / p_commission_value / p_commission_bump were moved to the '
  'end of the parameter list and defaulted null in 0151 so the function accepts '
  'calls with OR without them: they are APPENDED AND DEFAULTED PENDING REMOVAL. '
  'Callers bind by name (PostgREST), so the reorder is transparent to them. '
  'Drop the three parameters in the next migration once no caller sends them - '
  'that is the point of defaulting rather than dropping now.';

-- ---------------------------------------------------------------------
-- 4) ASSERT. Any failure rolls the DROP and the CREATE back together.
-- ---------------------------------------------------------------------
do $$
declare
  v_n            integer;
  v_def          text;
  v_args         text;
  v_src          text;
  v_src_md5      text;
  v_nargs        smallint;
  v_ndefaults    smallint;
  v_argnames     text[];
  v_secdef       boolean;
  v_volatile     "char";
  v_config       text[];
  v_acl          text;
  v_owner        text;
  v_anon_exec    boolean;
  v_auth_exec    boolean;
  v_svc_exec     boolean;
  v_pub_exec     boolean;
  v_expect_args  text;
  v_expect_def   text;
  v_before_args  text;
  v_before_def   text;
  v_proj_fp      text;
  v_pch_rows     bigint;
  v_pch_fp       text;
begin
  -- (1) EXACTLY ONE OVERLOAD. The whole reason this is DROP + CREATE rather
  --     than a second CREATE is that two overloads make PostgREST answer
  --     PGRST203 on every call. Read it back rather than trusting the DROP ran.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';
  if v_n <> 1 then
    raise exception
      'update_project_with_customer now has % definitions, expected exactly 1. Rolling back.', v_n;
  end if;

  select pg_get_functiondef(p.oid), pg_get_function_arguments(p.oid),
         p.prosrc, md5(p.prosrc), p.pronargs, p.pronargdefaults, p.proargnames,
         p.prosecdef, p.provolatile, p.proconfig, p.proacl::text,
         pg_get_userbyid(p.proowner),
         has_function_privilege('anon',          p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role',  p.oid, 'execute'),
         has_function_privilege('public',        p.oid, 'execute')
    into v_def, v_args, v_src, v_src_md5, v_nargs, v_ndefaults, v_argnames,
         v_secdef, v_volatile, v_config, v_acl, v_owner,
         v_anon_exec, v_auth_exec, v_svc_exec, v_pub_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';

  select b.args, b.def into v_before_args, v_before_def from _0151_before b;

  -- (2) THE BODY IS BYTE-IDENTICAL. Not "equivalent", not "still has the guard"
  --     - the same 1948 characters. This is the strongest statement the file can
  --     make and it is the one that matters: a parameter reorder must not be a
  --     vehicle for a body edit.
  if v_src_md5 is distinct from (select b.src_md5 from _0151_before b) then
    raise exception
      'update_project_with_customer body changed: was md5 %, now md5 % (% chars). 0151 must reorder parameters and nothing else. Rolling back.',
      (select b.src_md5 from _0151_before b), v_src_md5, length(v_src);
  end if;

  -- (3) THE PARAMETER LIST IS THE OLD ONE WITH THE COMMISSION THREE MOVED TO
  --     THE END AND DEFAULTED. Derived from the captured before-image rather
  --     than pasted, so the expectation cannot drift from what was actually
  --     there. The `position(...) = 0` guard fires first: if the three are not
  --     sitting where this file believes they sit, the replace would be a no-op
  --     and the expectation would quietly become "the old list plus three more".
  if position('p_commission_mode text, p_commission_value numeric, p_commission_bump numeric, '
              in v_before_args) = 0 then
    raise exception
      'The three commission parameters were not found at positions 11-13 of the captured signature: %. It is not the function 0151 was written against. Rolling back.',
      v_before_args;
  end if;

  v_expect_args := replace(
      v_before_args,
      'p_commission_mode text, p_commission_value numeric, p_commission_bump numeric, ',
      '')
    || ', p_commission_mode text DEFAULT NULL::text'
    || ', p_commission_value numeric DEFAULT NULL::numeric'
    || ', p_commission_bump numeric DEFAULT NULL::numeric';

  if v_args is distinct from v_expect_args then
    raise exception
      E'Parameter list is not the old list with the commission three appended and defaulted.\n  expected: %\n  got: %',
      v_expect_args, v_args;
  end if;

  -- (3b) SAID AGAIN STRUCTURALLY, because a string compare can be satisfied by
  --      a signature that is right in text and wrong in shape: 24 parameters,
  --      the last three are the commission three IN ORDER, and 8 of them carry
  --      defaults - which, since Postgres only allows trailing defaults, is what
  --      proves the last three each have one.
  if v_nargs <> 24 then
    raise exception 'Expected 24 parameters, found %. Rolling back.', v_nargs;
  end if;
  if v_ndefaults <> 8 then
    raise exception
      'Expected 8 defaulted (trailing) parameters, found % - the commission three are not all defaulted. Rolling back.', v_ndefaults;
  end if;
  if v_argnames[22] is distinct from 'p_commission_mode'
     or v_argnames[23] is distinct from 'p_commission_value'
     or v_argnames[24] is distinct from 'p_commission_bump' then
    raise exception
      'The last three parameters are %, %, % - expected p_commission_mode, p_commission_value, p_commission_bump. Rolling back.',
      v_argnames[22], v_argnames[23], v_argnames[24];
  end if;

  -- (4) POSTURE AND ACL, READ BACK RATHER THAN ASSUMED. DROP discarded the ACL
  --     and section 3 re-issued it; this is the check that the re-issue landed
  --     EXACTLY where the original was - same owner, same string, PUBLIC and
  --     anon excluded, authenticated and service_role included. A fresh CREATE
  --     also defaults to invoker/volatile/no-proconfig, but "defaults to" is not
  --     evidence.
  if v_secdef is not false
     or v_volatile is distinct from 'v'::"char"
     or v_config is not null
     or v_pub_exec is not false
     or v_anon_exec is not false
     or v_auth_exec is not true
     or v_svc_exec is not true
     or v_owner is distinct from (select b.owner from _0151_before b)
     or v_acl is distinct from (select b.acl from _0151_before b) then
    raise exception
      'Posture or grants moved: definer=%, volatile=%, config=%, public=%, anon=%, auth=%, service_role=%, owner=%, acl=% (was owner=%, acl=%). Rolling back.',
      v_secdef, v_volatile, v_config, v_pub_exec, v_anon_exec, v_auth_exec,
      v_svc_exec, v_owner, v_acl,
      (select b.owner from _0151_before b), (select b.acl from _0151_before b);
  end if;

  -- (5) THE WHOLE DEFINITION DIFFERS ONLY IN THE PARAMETER LIST. Rebuild the
  --     expected new definition by taking the captured one and substituting the
  --     old parenthesised argument list for the new one - nothing else - and
  --     demand an exact match. (2) already pinned the body by hash; this pins
  --     everything around it too: the RETURNS clause, the LANGUAGE clause, the
  --     absence of a SECURITY or SET clause, the dollar-quoting.
  v_expect_def := replace(v_before_def,
                          '(' || v_before_args || ')',
                          '(' || v_expect_args || ')');

  if v_expect_def = v_before_def then
    raise exception
      'Could not locate the argument list inside the captured definition of update_project_with_customer. Rolling back.';
  end if;

  if v_def is distinct from v_expect_def then
    raise exception
      'Definition is not "the old definition with only the parameter list reordered". Expected % chars, got %. Something outside the signature changed. Rolling back.',
      length(v_expect_def), length(v_def);
  end if;

  -- (6) THE BODY STILL GUARDS THE PAYMENT-MODE SWITCH AND STILL DOES NOT WRITE
  --     THE THREE COMMISSION COLUMNS. Redundant given (2) - the hash already
  --     covers both - and written anyway, because these two are the properties
  --     a reader of this file actually cares about and a hash does not name
  --     them. If (2) ever gets weakened, these keep standing.
  if v_src not like '%can_switch_payment_mode(p_project_id, p_payment_mode, p_current_balance)%' then
    raise exception
      'The payment-mode switch guard is missing from the recreated body. Rolling back.';
  end if;
  if v_src like '%commission_mode       = p_commission_mode%'
     or v_src like '%commission_value      = p_commission_value%'
     or v_src like '%commission_bump_pct   = p_commission_bump%' then
    raise exception
      'The recreated body writes projects.commission_* - 0150 removed that and 0151 must not put it back. Rolling back.';
  end if;

  -- (7) NO COMMISSION FIGURE MOVED. This file replaces a function; it must not
  --     have run one.
  select md5(coalesce(string_agg(id::text || ':' ||
                                 coalesce(commission_mode, '~') || ':' ||
                                 coalesce(commission_value::text, '~') || ':' ||
                                 coalesce(commission_bump_pct::text, '~'),
                                 ',' order by id), ''))
    into v_proj_fp
    from public.projects;

  if not exists (select 1 from _0151_before_data d where d.proj_fingerprint = v_proj_fp) then
    raise exception '0151 changed projects.commission_*: fingerprint %. Rolling back.', v_proj_fp;
  end if;

  -- (8) AND NO HISTORY ROW WAS WRITTEN OR LOST.
  select count(*),
         md5(coalesce(string_agg(id::text || ':' || effective_from::text || ':' ||
                                 commission_mode || ':' || commission_value::text || ':' ||
                                 commission_bump_pct::text || ':' || is_baseline::text,
                                 ',' order by id), ''))
    into v_pch_rows, v_pch_fp
    from public.project_commission_history;

  if not exists (select 1 from _0151_before_data d
                  where d.pch_rows = v_pch_rows and d.pch_fingerprint = v_pch_fp) then
    raise exception
      '0151 changed project_commission_history: % rows / fingerprint %. Rolling back.', v_pch_rows, v_pch_fp;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- AFTER COMMIT: POSTGREST MUST SEE THE NEW SIGNATURE
-- ===========================================================================
-- Supabase installs a `pgrst_ddl_watch` event trigger that issues
-- `notify pgrst, 'reload schema'` on DDL, so the cache should refresh by itself.
-- It is not issued inside the transaction above because that transaction is
-- scoped to the function and nothing else. If a save returns PGRST202 right
-- after applying, run this once, on its own:
--      notify pgrst, 'reload schema';
--
-- ===========================================================================
-- VERIFICATION - run separately. Anything that calls the RPC is rolled back.
-- ===========================================================================
--
-- A) THE SIGNATURE MOVED AND THE BODY DID NOT:
--      select pg_get_function_arguments(p.oid)                as args,
--             p.pronargs, p.pronargdefaults,
--             md5(p.prosrc)                                   as src_md5,
--             length(p.prosrc)                                as src_len
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- 24 / 8 / e0a731881696673fac355ab5269dc5c8 / 1948.
--      -- The md5 and the length are the SAME as before this file ran. Only
--      -- pronargdefaults moved, 5 -> 8.
--
-- B) POSTURE AND GRANTS, AFTER A DROP THAT DISCARDED THEM:
--      select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text,
--             has_function_privilege('anon', p.oid, 'execute')   as anon,
--             has_function_privilege('public', p.oid, 'execute') as pub
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- false / v / null /
--      -- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--      -- / false / false. Identical to before. proconfig NULL is correct here -
--      -- see the header.
--
-- C) THE OLD CALL SHAPE STILL WORKS - this is the promise the file exists to
--    keep, and it is the one that must be rehearsed against a REAL project.
--    ROLLED BACK:
--      begin;
--        select name, description, rate_per_trip_sar,
--               commission_mode, commission_value, commission_bump_pct
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
--          p_commission_mode       => 'scalable',      -- still accepted, still ignored
--          p_commission_value      => 999,             -- still accepted, still ignored
--          p_commission_bump       => 49,              -- still accepted, still ignored
--          p_default_water_station => (select p.default_water_station from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_water_type            => (select p.water_type from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_description           => 'rehearsal C - old call shape',
--          p_driver_ids            => (select coalesce(array_agg(pd.driver_id), '{}'::uuid[])
--                                        from public.project_drivers pd
--                                       where pd.project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_payment_mode          => (select p.payment_mode from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_cust_email            => null);
--
--        select description, commission_mode, commission_value, commission_bump_pct
--          from public.projects where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- description IS 'rehearsal C - old call shape', proving the call
--        -- resolved and ran DESPITE the parameters having moved - because
--        -- PostgREST and this rehearsal both bind by NAME. The three commission
--        -- columns are UNCHANGED: not 999, not scalable, not 49 (that is 0150's
--        -- guarantee, re-confirmed).
--        select count(*) from public.project_commission_history;  -- = pch_before
--      rollback;
--
-- D) THE NEW CALL SHAPE WORKS TOO - the point of the whole file. Same call with
--    the three commission arguments simply ABSENT. Before 0151 this failed
--    42883 / PGRST202; after it, it must succeed. ROLLED BACK:
--      begin;
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
--          p_default_water_station => (select p.default_water_station from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_water_type            => (select p.water_type from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_description           => 'rehearsal D - new call shape',
--          p_driver_ids            => (select coalesce(array_agg(pd.driver_id), '{}'::uuid[])
--                                        from public.project_drivers pd
--                                       where pd.project_id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_payment_mode          => (select p.payment_mode from public.projects p
--                                      where p.id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92'),
--          p_cust_email            => null);
--
--        select description from public.projects
--         where id = 'fd408e6e-5acf-4109-b474-28ae1b7e8e92';
--        -- 'rehearsal D - new call shape'. That is step 2's call shape, working
--        -- before step 2 ships. That overlap is the whole reason for 0151.
--      rollback;
--
-- E) THE PAYMENT-MODE SWITCH GUARD IS UNTOUCHED. Not re-rehearsed: its bytes are
--    inside the hash assertion (2) compared, so if it had changed the file would
--    not have applied. Confirm it is still there:
--      select p.prosrc like '%can_switch_payment_mode%' as guard_present
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- true.
--
-- F) CREATION IS OUT OF SCOPE AND WAS LEFT ALONE. create_project_with_customer
--    still writes the three columns and still gets its 0147 baseline row:
--      select pg_get_function_arguments(p.oid) like '%p_commission_value%' as still_takes,
--             p.prosrc like '%commission_value%'                           as still_writes
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='create_project_with_customer';
--      -- true / true.
--
-- G) THE TEMP TABLES DID NOT SURVIVE:
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relname in ('_0151_before','_0151_before_data');
--      -- expect 0.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK. Take the before-image FIRST, while the old function is still live:
--      select pg_get_functiondef(p.oid), p.proacl::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
-- Save that text. To reverse: in ONE transaction, drop the NEW signature and run
-- the saved definition, then re-issue the grants - the drop discards them in this
-- direction too.
--      begin;
--        drop function public.update_project_with_customer(
--          uuid, text, text, text, text, text, double precision, double precision,
--          text, numeric, text, text, text, uuid[], text, text, numeric, text,
--          text, text, text, text, numeric, numeric);
--        -- <paste the saved CREATE OR REPLACE definition here>
--        revoke all  on function public.update_project_with_customer(
--          uuid, text, text, text, text, text, double precision, double precision,
--          text, numeric, text, numeric, numeric, text, text, text, uuid[], text,
--          text, numeric, text, text, text, text) from public, anon;
--        grant execute on function public.update_project_with_customer(
--          uuid, text, text, text, text, text, double precision, double precision,
--          text, numeric, text, numeric, numeric, text, text, text, uuid[], text,
--          text, numeric, text, text, text, text) to authenticated, service_role;
--      commit;
-- Rolling back is only safe while the app still SENDS the three arguments, i.e.
-- before step 2 deploys. After step 2, reverting 0151 breaks every save.
-- ===========================================================================
