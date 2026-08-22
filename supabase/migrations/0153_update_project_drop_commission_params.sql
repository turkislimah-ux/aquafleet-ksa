-- 0153_update_project_drop_commission_params.sql
-- Drop p_commission_mode / p_commission_value / p_commission_bump from
-- update_project_with_customer. Step 3 of 3, the last one.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect re-measures, reviews, rehearses
-- rolled back, applies.
--
-- ===========================================================================
-- THE THREE STEPS, AND WHY THIS ONE IS SAFE
-- ===========================================================================
--   0150  the function STOPPED WRITING projects.commission_* . The three
--         parameters stayed in the signature but became dead weight - accepted,
--         bound, ignored. set_project_commission (0148) became the sole path
--         that moves a commission figure on an existing project.
--   0151  the three moved to the END of the parameter list and were defaulted
--         null, so the function accepts the call WITH or WITHOUT them. Postgres
--         allows only TRAILING defaults, which is why they had to move, which is
--         why it was a DROP+CREATE rather than a CREATE OR REPLACE.
--   0153  this file. The app stopped sending them (step 2, commit 44b461d, live),
--         so the parameters can go for real.
--
-- The window 0151 existed to create is what makes this safe: at no point was
-- there a version of the function that a live caller could not call.
--
-- ===========================================================================
-- VERIFIED BEFORE DRAFTING - the app really has stopped sending them
-- ===========================================================================
-- Grepped the whole repo at HEAD, not assumed:
--
--   app/trips/actions.ts:1139   the ONE caller of update_project_with_customer.
--                               Sends 21 arguments. No p_commission_* .
--   app/trips/actions.ts:982-4  p_commission_mode / _value / _bump ARE still
--                               sent here - to create_project_with_customer,
--                               a DIFFERENT function with a different signature
--                               that genuinely writes them at creation, where
--                               0147's INSERT trigger turns them into the
--                               baseline history row. NOT TOUCHED BY THIS FILE.
--
-- ProjectModal is not a caller; it mentions the RPC only in comments.
--
-- And from the database side, where a caller would not show up in a grep:
--   routines whose prosrc references update_project_with_customer : 0
--   views whose definition references it                          : 0
-- So the app is the only caller, and the app no longer sends the three.
--
-- ===========================================================================
-- THE BODY DOES NOT CHANGE. AT ALL.
-- ===========================================================================
-- The body never referenced the three parameters - measured, not assumed:
--   position('p_commission' in prosrc)    = 0
--   position('commission_mode' in prosrc) = 0
-- so removing them from the signature cannot change a line of it. prosrc is
-- byte-identical before and after, and assertion (2) pins that both ways: equal
-- to the captured before-image AND equal to the literal md5 e0a731881696673f...
-- carried since 0150.
--
-- The body text below was SPLICED FROM 0151, not retyped. Retyping a 1,948-byte
-- body to be byte-identical is a coin flip; the md5 assertion would catch a slip,
-- but catching it during the architect's apply is worse than not making it.
--
-- DO NOT REFLOW IT. Assertion (2) demands the md5 is unchanged and assertion (5)
-- rebuilds the whole functiondef from the before-image. A harmless re-indent
-- fails the file, and that strictness is the point: it is what makes "only the
-- parameter list shrank" checkable rather than asserted.
--
-- ===========================================================================
-- DROP DISCARDS THE ACL. AGAIN.
-- ===========================================================================
-- A freshly created function is EXECUTE-to-PUBLIC by default. Without the
-- re-grant block this would quietly widen a money RPC to anon - the same trap
-- 0151 had to handle, and the reason assertion (4) compares the resulting ACL
-- string to the captured before-image rather than trusting the statements.
--
-- Measured before-image ACL:
--   postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
-- No PUBLIC entry, no anon entry. The revoke/grant order below reproduces that
-- string exactly: revoke materialises the default ACL and strips PUBLIC, then
-- the two grants append in that order.
--
-- ===========================================================================
-- ONE DISCREPANCY FOUND WHILE MEASURING - READ THIS
-- ===========================================================================
-- The COMMENT on the live function does not match the comment in the committed
-- 0151 file. Live is 489 characters; the file's concatenated literal is 717.
-- Live is missing the clause "so that a change cannot be reverted by an
-- unrelated save carrying a stale pre-fill" and abbreviates the rest.
--
-- Everything that matters is identical - body md5 e0a731881696673fac355ab5269dc5c8,
-- the 24-argument signature with the commission three last and defaulted, and the
-- ACL above - so the applied 0151 was functionally the file. Only the comment
-- prose differs, which suggests the version actually run in the SQL editor was
-- edited by hand after the RAISE-arity fix.
--
-- CONSEQUENCE, and why it is called out rather than quietly fixed: replaying
-- 0151 from disk would produce a DIFFERENT comment than production carries. This
-- file does not assert on the comment text - an assertion would false-trip
-- against one version or the other - it just replaces it. After 0153 the comment
-- on disk and the comment in production agree again.
--
-- ===========================================================================
-- MEASURED AT DRAFT TIME (2026-08-23). Anchors, not assumptions.
-- ===========================================================================
--   overloads of update_project_with_customer          1 (oid 20979)
--   pronargs                                          24
--   md5(prosrc)         e0a731881696673fac355ab5269dc5c8
--   length(prosrc)                                  1948
--   prosecdef                                      false  (invoker)
--   provolatile                                      'v'  (volatile)
--   proconfig                                       null
--   owner                                       postgres
--   length(pg_get_functiondef)                      2764  -> expect 2622 after
--   length(identity_arguments)                       ...  -> expect 467 after
--
--   projects                                           8
--   projects.commission_* md5   51fc9b9bdd490851314580a10100eede
--   project_commission_history rows                   13
--   project_commission_history md5  fcb658e2a4adb0be694aee6dbad2d955
--
-- The two data fingerprints are captured BEFORE and compared AFTER inside this
-- transaction, so they cannot go stale between drafting and applying. They are
-- recorded here for the record only. This file writes no table - if either
-- moves, something is very wrong and the transaction aborts.
--
-- NOT RE-RUNNABLE, deliberately: no `if exists` on the DROP. A replay must fail
-- loudly against a 21-argument function rather than half-succeed.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) CAPTURE THE BEFORE-IMAGE. Everything the assertions compare against is
--    read from the live catalog here, so they check a real transition rather
--    than a transcription of one.
-- ---------------------------------------------------------------------
create temp table _0153_before on commit drop as
select p.oid                                       as oid,
       md5(p.prosrc)                               as body_md5,
       p.prosrc                                    as body,
       pg_get_function_identity_arguments(p.oid)   as ident_args,
       pg_get_function_arguments(p.oid)            as full_args,
       pg_get_functiondef(p.oid)                   as def,
       p.pronargs                                  as nargs,
       p.prosecdef                                 as secdef,
       p.provolatile                               as volatility,
       p.proconfig                                 as config,
       pg_get_userbyid(p.proowner)                 as owner,
       coalesce(array_to_string(p.proacl::text[], ' | '), '(default: PUBLIC EXECUTE)') as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'update_project_with_customer';

create temp table _0153_before_data on commit drop as
select (select count(*) from public.projects) as projects,
       (select md5(string_agg(id::text || ':' || coalesce(commission_mode, '-') || ':' ||
                              coalesce(commission_value::text, '-') || ':' ||
                              coalesce(commission_bump_pct::text, '-'), ',' order by id))
          from public.projects) as projects_commission_fp,
       (select count(*) from public.project_commission_history) as history_rows,
       (select md5(string_agg(id::text || ':' || project_id::text || ':' ||
                              effective_from::text || ':' ||
                              coalesce(commission_mode, '-') || ':' ||
                              coalesce(commission_value::text, '-') || ':' ||
                              coalesce(commission_bump_pct::text, '-') || ':' ||
                              coalesce(is_baseline::text, '-'), ',' order by id))
          from public.project_commission_history) as history_fp;

-- ---------------------------------------------------------------------
-- 2) PRE-FLIGHT. Refuse to run against anything but the exact function 0151
--    left behind.
-- ---------------------------------------------------------------------
do $preflight$
declare
  b              record;
  v_overloads    bigint;
  v_ident_suffix text := ', p_commission_mode text, p_commission_value numeric, p_commission_bump numeric';
  v_full_suffix  text := ', p_commission_mode text DEFAULT NULL::text, p_commission_value numeric DEFAULT NULL::numeric, p_commission_bump numeric DEFAULT NULL::numeric';
begin
  select count(*) into v_overloads from _0153_before;
  if v_overloads <> 1 then
    raise exception
      'Expected exactly ONE overload of public.update_project_with_customer, found %. This file drops one exact signature and cannot be trusted against an ambiguous set.',
      v_overloads;
  end if;

  select * into b from _0153_before;

  -- (a) THE BODY IS THE 0150/0151 BODY. Pinned to a literal, so this file
  --     refuses to run against a function whose body has drifted - the whole
  --     premise is that the body does not change.
  if b.body_md5 <> 'e0a731881696673fac355ab5269dc5c8' then
    raise exception
      E'Body md5 is not the 0150/0151 body.\n  expected e0a731881696673fac355ab5269dc5c8\n  got      %\n  Something rewrote update_project_with_customer since 0151. Re-read it before dropping anything.',
      b.body_md5;
  end if;

  -- (b) THE SIGNATURE IS THE 24-ARG FORM 0151 PRODUCED, with the commission
  --     three LAST and DEFAULTED. Checked as a SUFFIX, because that is the
  --     property this file relies on: it removes a tail, not a middle.
  if b.nargs <> 24 then
    raise exception 'Expected 24 parameters (the 0151 form), found %.', b.nargs;
  end if;

  if right(b.ident_args, length(v_ident_suffix)) <> v_ident_suffix then
    raise exception
      E'The commission three are not the last three parameters.\n  expected the identity arguments to end with: %\n  they end with: %',
      v_ident_suffix, right(b.ident_args, length(v_ident_suffix));
  end if;

  if right(b.full_args, length(v_full_suffix)) <> v_full_suffix then
    raise exception
      E'The commission three are not defaulted null at the end.\n  expected the arguments to end with: %\n  they end with: %',
      v_full_suffix, right(b.full_args, length(v_full_suffix));
  end if;

  -- (c) The functiondef must contain its own argument list verbatim, or
  --     assertion (5) below cannot rebuild the expected definition by
  --     substitution.
  if position('(' || b.full_args || ')' in b.def) = 0 then
    raise exception 'pg_get_functiondef does not contain its own argument list verbatim; assertion (5) could not rebuild the expected definition.';
  end if;

  -- (d) POSTURE BEFORE. The CREATE below carries no SECURITY clause and no SET
  --     clause; if the function were security definer or config-pinned today,
  --     recreating it plainly would silently change its posture.
  if b.secdef then
    raise exception 'update_project_with_customer is SECURITY DEFINER today; the CREATE below is plain and would change that.';
  end if;
  if b.volatility <> 'v' then
    raise exception 'Expected volatile (provolatile = v), found %.', b.volatility;
  end if;
  if b.config is not null then
    raise exception 'update_project_with_customer carries a SET clause (proconfig = %); the CREATE below has none.', b.config::text;
  end if;

  -- (e) THE BODY NEVER REFERENCED THE THREE. This is the fact that makes the
  --     drop a signature-only change. Assert it rather than trusting the
  --     earlier measurement.
  if position('p_commission' in b.body) <> 0 then
    raise exception 'The body references p_commission - dropping the parameters would break it. This file assumes it does not.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 3) DROP THE 24-ARG FORM, then CREATE the 21-arg one. ONE TRANSACTION: if the
--    CREATE fails, the DROP rolls back with it and there is never a window
--    where the function is missing.
--
--    No `if exists`. A re-run must fail loudly.
-- ---------------------------------------------------------------------
drop function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text, text, numeric, numeric);

-- ---------------------------------------------------------------------
-- 4) THE 21-ARG FUNCTION. Identical to what was just dropped except that the
--    last three parameters are gone. Same order, same defaults, same return
--    type, same language, no SECURITY clause, no SET clause.
--
--    THE BODY BELOW IS SPLICED FROM 0151 AND IS BYTE-IDENTICAL. Do not reflow it.
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

-- ---------------------------------------------------------------------
-- 5) RE-ISSUE THE GRANTS. DROP FUNCTION discarded them. Order matters: the
--    revokes materialise the default ACL and strip PUBLIC, then the grants
--    append authenticated and service_role in that order, reproducing the
--    captured string exactly. Assertion (4) compares the result.
--
--    `from anon` is a no-op today - anon holds no explicit entry - but it is
--    written so the file states the intent rather than relying on PUBLIC's
--    removal to have covered it.
-- ---------------------------------------------------------------------
revoke all on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text) from public;

revoke all on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text) from anon;

grant execute on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text) to authenticated;

grant execute on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text) to service_role;

comment on function public.update_project_with_customer(
  uuid, text, text, text, text, text, double precision, double precision, text,
  numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
  text) is
  'Edits a project and its 1:1 customer in one transaction. DOES NOT WRITE '
  'COMMISSION, and no longer has anywhere to put one: p_commission_mode / '
  'p_commission_value / p_commission_bump were dropped from the signature in '
  '0153, after 0150 stopped the body writing the three columns and 0151 moved '
  'the parameters to the end and defaulted them null so callers could stop '
  'sending them without a broken-save window. set_project_commission (0148) is '
  'the only path that changes a commission figure on an existing project, so '
  'that a change cannot be reverted by an unrelated save carrying a stale '
  'pre-fill. Passing a commission argument here is now a PGRST202, which is the '
  'intended outcome: the mistake fails loudly instead of being ignored. '
  'create_project_with_customer is a DIFFERENT function and still takes its '
  'three - creation genuinely writes them, and 0147''s INSERT trigger turns that '
  'into the baseline commission history row.';

-- ---------------------------------------------------------------------
-- 6) ASSERTIONS. Read the catalog back; do not assume the statements above did
--    what they say.
-- ---------------------------------------------------------------------
do $assert$
declare
  b              record;
  v_overloads    bigint;
  v_oid          oid;
  v_nargs        int;
  v_md5          text;
  v_body         text;
  v_ident        text;
  v_full         text;
  v_def          text;
  v_secdef       boolean;
  v_vol          "char";
  v_config       text[];
  v_owner        text;
  v_acl          text;
  v_names        text[];
  v_expect_ident text;
  v_expect_full  text;
  v_expect_def   text;
  v_diff_at      int;
  v_ident_suffix text := ', p_commission_mode text, p_commission_value numeric, p_commission_bump numeric';
  v_full_suffix  text := ', p_commission_mode text DEFAULT NULL::text, p_commission_value numeric DEFAULT NULL::numeric, p_commission_bump numeric DEFAULT NULL::numeric';
begin
  select * into b from _0153_before;

  -- (1) EXACTLY ONE OVERLOAD. A leftover 24-arg copy would mean the DROP
  --     targeted something else and PostgREST would face an ambiguous call.
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';
  if v_overloads <> 1 then
    raise exception 'Expected exactly ONE overload after this migration, found %.', v_overloads;
  end if;

  select p.oid, p.pronargs, md5(p.prosrc), p.prosrc,
         pg_get_function_identity_arguments(p.oid),
         pg_get_function_arguments(p.oid),
         pg_get_functiondef(p.oid),
         p.prosecdef, p.provolatile, p.proconfig,
         pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proacl::text[], ' | '), '(default: PUBLIC EXECUTE)'),
         p.proargnames
    into v_oid, v_nargs, v_md5, v_body, v_ident, v_full, v_def,
         v_secdef, v_vol, v_config, v_owner, v_acl, v_names
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_project_with_customer';

  -- (2) THE BODY IS UNTOUCHED, pinned two ways: equal to the captured
  --     before-image, and equal to the literal carried since 0150.
  if v_md5 <> b.body_md5 then
    raise exception
      E'The body changed. It must not - the three parameters were never referenced in it.\n  before %\n  after  %',
      b.body_md5, v_md5;
  end if;
  if v_md5 <> 'e0a731881696673fac355ab5269dc5c8' then
    raise exception
      E'Body md5 is not the pinned 0150/0151 value.\n  expected e0a731881696673fac355ab5269dc5c8\n  got      %',
      v_md5;
  end if;
  if v_body <> b.body then
    raise exception 'The body text differs from the before-image even though the md5 matched. Refusing.';
  end if;

  -- (3) 21 PARAMETERS, AND NONE OF THEM IS A COMMISSION PARAMETER.
  if v_nargs <> 21 then
    raise exception 'Expected 21 parameters after the drop, found %.', v_nargs;
  end if;
  if 'p_commission_mode' = any(v_names)
     or 'p_commission_value' = any(v_names)
     or 'p_commission_bump' = any(v_names) then
    raise exception
      'A commission parameter survived the drop. Parameter names are now: %',
      array_to_string(v_names, ', ');
  end if;

  -- The expected argument lists are DERIVED from the before-image by removing
  -- the suffix, not pasted in. A pasted expectation only proves the paste was
  -- copied correctly; a derived one proves the transition.
  v_expect_ident := left(b.ident_args, length(b.ident_args) - length(v_ident_suffix));
  v_expect_full  := left(b.full_args,  length(b.full_args)  - length(v_full_suffix));

  if v_ident <> v_expect_ident then
    raise exception
      E'The identity argument list is not the old list with the commission three removed.\n  expected: %\n  got:      %',
      v_expect_ident, v_ident;
  end if;
  if v_full <> v_expect_full then
    raise exception
      E'The argument list is not the old list with the commission three removed.\n  expected: %\n  got:      %',
      v_expect_full, v_full;
  end if;

  -- (4) OWNER AND ACL MATCH THE BEFORE-IMAGE. DROP discarded the ACL and a
  --     fresh function is EXECUTE-to-PUBLIC; this is the check that the
  --     re-grant block put it back exactly, rather than approximately.
  if v_owner <> b.owner then
    raise exception E'Owner changed.\n  before %\n  after  %', b.owner, v_owner;
  end if;
  if v_acl <> b.acl then
    raise exception
      E'The ACL does not match the before-image. A money RPC must not have been widened.\n  before %\n  after  %',
      b.acl, v_acl;
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'anon can EXECUTE update_project_with_customer. It must not.';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'authenticated cannot EXECUTE update_project_with_customer. The app would break.';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'service_role cannot EXECUTE update_project_with_customer.';
  end if;

  -- (5) THE WHOLE DEFINITION, rebuilt from the before-image by swapping only
  --     the argument list. This is what proves nothing else moved - not the
  --     return type, not the language, not a line of the body.
  v_expect_def := replace(b.def, '(' || b.full_args || ')', '(' || v_expect_full || ')');
  if v_def <> v_expect_def then
    -- Point at the first byte that differs rather than dumping two 2.7 KB
    -- definitions into one exception. A window either side is enough to see
    -- what moved, and it stays readable in the SQL editor.
    v_diff_at := 1;
    while v_diff_at <= least(length(v_def), length(v_expect_def))
          and substr(v_def, v_diff_at, 1) = substr(v_expect_def, v_diff_at, 1) loop
      v_diff_at := v_diff_at + 1;
    end loop;
    raise exception
      E'The definition is not the before-image with only the argument list shrunk.\n  expected length %, actual length %\n  first difference at byte %\n  expected there: %\n  actual there:   %',
      length(v_expect_def), length(v_def), v_diff_at,
      substr(v_expect_def, greatest(1, v_diff_at - 60), 120),
      substr(v_def,        greatest(1, v_diff_at - 60), 120);
  end if;

  -- (6) POSTURE READ BACK: invoker, volatile, no config. Not assumed from the
  --     absence of a clause in the CREATE.
  if v_secdef then
    raise exception 'The recreated function is SECURITY DEFINER. It must be invoker.';
  end if;
  if v_vol <> 'v' then
    raise exception 'The recreated function is not volatile (provolatile = %).', v_vol;
  end if;
  if v_config is not null then
    raise exception 'The recreated function carries a SET clause (proconfig = %).', v_config::text;
  end if;

  -- (7) THE PAYMENT-MODE GUARD IS STILL IN THE BODY. It is the one piece of
  --     business logic in here that money depends on, so it gets named rather
  --     than covered only by the md5.
  if position('can_switch_payment_mode' in v_body) = 0 then
    raise exception 'The payment-mode switch guard is missing from the body.';
  end if;
  if position('payment_mode          = p_payment_mode' in v_body) = 0 then
    raise exception 'The body no longer writes projects.payment_mode.';
  end if;

  -- (8) THE BODY STILL DOES NOT WRITE THE COMMISSION COLUMNS, and no longer
  --     mentions the parameters at all.
  if position('commission' in v_body) <> 0 then
    raise exception 'The body mentions commission. It must not - 0150 removed the last reference.';
  end if;
end
$assert$;

-- ---------------------------------------------------------------------
-- 7) DATA FINGERPRINTS. This file writes no table. If either fingerprint moved,
--    something ran that should not have and the transaction aborts.
-- ---------------------------------------------------------------------
do $data$
declare
  d             record;
  v_n_projects  bigint;
  v_fp_projects text;
  v_n_history   bigint;
  v_fp_history  text;
begin
  select * into d from _0153_before_data;

  select count(*),
         md5(string_agg(id::text || ':' || coalesce(commission_mode, '-') || ':' ||
                        coalesce(commission_value::text, '-') || ':' ||
                        coalesce(commission_bump_pct::text, '-'), ',' order by id))
    into v_n_projects, v_fp_projects
    from public.projects;

  select count(*),
         md5(string_agg(id::text || ':' || project_id::text || ':' ||
                        effective_from::text || ':' ||
                        coalesce(commission_mode, '-') || ':' ||
                        coalesce(commission_value::text, '-') || ':' ||
                        coalesce(commission_bump_pct::text, '-') || ':' ||
                        coalesce(is_baseline::text, '-'), ',' order by id))
    into v_n_history, v_fp_history
    from public.project_commission_history;

  if v_n_projects is distinct from d.projects
     or v_fp_projects is distinct from d.projects_commission_fp then
    raise exception
      E'projects.commission_* moved. This migration writes no table.\n  count  before % / after %\n  md5    before % / after %',
      d.projects, v_n_projects, d.projects_commission_fp, v_fp_projects;
  end if;

  if v_n_history is distinct from d.history_rows
     or v_fp_history is distinct from d.history_fp then
    raise exception
      E'project_commission_history moved. This migration writes no table.\n  count  before % / after %\n  md5    before % / after %',
      d.history_rows, v_n_history, d.history_fp, v_fp_history;
  end if;
end
$data$;

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- The signature CHANGED, so PostgREST's cached function shape is stale until it
-- reloads. It reloads on the DDL event; if a project save 404s with PGRST202
-- ("Could not find the function ... in the schema cache") immediately after,
-- nudge it:
--     notify pgrst, 'reload schema';
--
-- A PGRST202 mentioning p_commission_mode / p_commission_value /
-- p_commission_bump is NOT a cache problem - it means a caller is still sending
-- them. That caller is the bug, not this migration.
--
-- ===========================================================================
-- VERIFICATION - run these; do not assume.
-- ===========================================================================
--
-- A) ONE OVERLOAD, 21 PARAMETERS, NO COMMISSION PARAMETERS.
--      select p.oid, p.pronargs, md5(p.prosrc) as body_md5,
--             pg_get_function_identity_arguments(p.oid) as args,
--             'p_commission_mode' = any(p.proargnames) as has_mode,
--             'p_commission_value' = any(p.proargnames) as has_value,
--             'p_commission_bump' = any(p.proargnames) as has_bump
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- expect ONE row, pronargs 21, body_md5 e0a731881696673fac355ab5269dc5c8,
--      -- and false / false / false.
--
-- B) POSTURE AND ACL.
--      select p.prosecdef, p.provolatile, p.proconfig,
--             pg_get_userbyid(p.proowner) as owner,
--             array_to_string(p.proacl::text[], ' | ') as acl,
--             has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
--             has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute,
--             has_function_privilege('service_role', p.oid, 'execute')  as svc_can_execute
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='update_project_with_customer';
--      -- expect false / v / null / postgres
--      --   postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
--      -- and false / true / true. anon_can_execute TRUE is the failure that
--      -- matters most; the migration asserts it, check it anyway.
--
-- C) THE FUNCTION STILL WORKS, REHEARSED AND ROLLED BACK. Pick a real project
--    and save it unchanged - 21 named arguments, no commission.
--      begin;
--      select public.update_project_with_customer(
--        p_project_id           => (select id from public.projects where archived_at is null order by name limit 1),
--        p_cust_name            => (select c.name from public.projects p join public.customers c on c.id=p.customer_id
--                                    where p.archived_at is null order by p.name limit 1),
--        p_cust_type            => (select c.customer_type from public.projects p join public.customers c on c.id=p.customer_id
--                                    where p.archived_at is null order by p.name limit 1),
--        p_contact_name         => null,
--        p_phone                => null,
--        p_delivery_address     => null,
--        p_delivery_lat         => null,
--        p_delivery_lng         => null,
--        p_proj_name            => (select name from public.projects where archived_at is null order by name limit 1),
--        p_rate                 => (select rate_per_trip_sar from public.projects where archived_at is null order by name limit 1),
--        p_default_water_station=> (select default_water_station from public.projects where archived_at is null order by name limit 1),
--        p_water_type           => (select water_type from public.projects where archived_at is null order by name limit 1),
--        p_description          => (select description from public.projects where archived_at is null order by name limit 1),
--        p_driver_ids           => (select coalesce(array_agg(driver_id), '{}'::uuid[]) from public.project_drivers
--                                    where project_id = (select id from public.projects where archived_at is null order by name limit 1)),
--        p_payment_mode         => (select payment_mode from public.projects where archived_at is null order by name limit 1),
--        p_cust_email           => (select c.email from public.projects p join public.customers c on c.id=p.customer_id
--                                    where p.archived_at is null order by p.name limit 1)
--      );
--      rollback;
--      -- Returns the project id. The five trailing defaulted parameters are
--      -- omitted on purpose - that is the call shape the app now uses.
--
-- D) THE OLD CALL SHAPE IS NOW AN ERROR, AND THAT IS THE POINT. Expect
--    42883 "function ... does not exist":
--      begin;
--      select public.update_project_with_customer(
--        p_project_id => '00000000-0000-0000-0000-000000000000'::uuid,
--        p_commission_mode => 'fixed');
--      rollback;
--
-- E) COMMISSION DATA IS UNMOVED. The migration asserts it; read it back.
--      select count(*) as projects,
--             md5(string_agg(id::text || ':' || coalesce(commission_mode,'-') || ':' ||
--                            coalesce(commission_value::text,'-') || ':' ||
--                            coalesce(commission_bump_pct::text,'-'), ',' order by id)) as fp
--        from public.projects;
--      -- expect 8 / 51fc9b9bdd490851314580a10100eede
--
--      select count(*) as history_rows from public.project_commission_history;
--      -- expect 13 (was 12 at the 0152 draft; a commission change has been made
--      --  since, which is expected - the count is a pointer, the in-transaction
--      --  fingerprint comparison is the check.)
--
-- F) NOTHING ELSE REFERENCES THE FUNCTION. Both expect 0:
--      select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname <> 'update_project_with_customer'
--         and p.prosrc like '%update_project_with_customer%';
--
--      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relkind='v'
--         and pg_get_viewdef(c.oid,true) like '%update_project_with_customer%';
--
-- G) THE BOARD, in the browser, signed in. This is the one that matters:
--      - /trips -> Projects -> Manage a project -> change the NAME -> Save.
--        It sticks. That is the 21-argument call going through.
--      - Change the payment mode on a project that has a balance and confirm the
--        switch guard still refuses with its message.
--      - Change a commission through its own control and confirm it applies -
--        that path is set_project_commission and never touched this function.
--      - Create a NEW project with a commission. It must still work:
--        create_project_with_customer is a different function and keeps its
--        three parameters.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Recreate the 24-argument form by re-running 0151's section 2 CREATE, its four
-- revoke/grant statements and its comment. The body is unchanged either way, so
-- nothing is lost - only the signature widens back.
--
-- Do it in ONE transaction with the drop, exactly as this file does:
--
--   begin;
--   drop function public.update_project_with_customer(
--     uuid, text, text, text, text, text, double precision, double precision, text,
--     numeric, text, text, text, uuid[], text, text, numeric, text, text, text,
--     text);
--   -- ... then paste 0151's create + revokes + grants + comment ...
--   commit;
--
-- ONLY NEEDED IF A CALLER STILL SENDS THE THREE. Nothing in the repo does, and
-- the app half shipped in 44b461d - so a rollback here is a signal that a caller
-- was missed, not that this migration was wrong. Find the caller first.
-- ===========================================================================
