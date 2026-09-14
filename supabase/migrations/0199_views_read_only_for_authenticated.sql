-- ===========================================================================
-- 0199 — EVERY public VIEW IS READ-ONLY FOR authenticated
-- ===========================================================================
-- CLAUDE.md §6 makes every view replacement restate a security footer, but that
-- footer only ever says `revoke all from anon; grant select to authenticated`.
-- It never revokes the WRITE privileges that Supabase's default ACL hands to
-- `authenticated` the moment a view is created. So the footer has been doing
-- exactly half its job, on all 50 views, since the first one.
--
-- Everything below was MEASURED against production before this file was
-- written. Nothing here is inferred from how Supabase usually behaves.
--
-- ---------------------------------------------------------------------------
-- 1) THE CURRENT GRANT SET — the full 7 on all 50, no exceptions.
-- ---------------------------------------------------------------------------
-- Grouping every view by its exact privilege string returns ONE row per role,
-- which is the strongest form of "no exceptions" — a single view that differed
-- would have split into its own row:
--
--   authenticated  DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE  50
--   postgres       DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE  50
--   service_role   DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE  50
--
-- `anon` does not appear at all. It holds nothing on any view, so there is
-- nothing to revoke from it and the footer's anon half has genuinely held.
--
-- ---------------------------------------------------------------------------
-- 2) WRITABLE vs NOT — 49 inert, ONE real.
-- ---------------------------------------------------------------------------
-- A grant only matters on a view Postgres can actually route a write through.
-- Every aggregate, UNION, DISTINCT or GROUP BY view is non-updatable by
-- construction: the write raises 0A000 before the privilege is ever consulted.
--
--   is_updatable=NO  / is_insertable_into=NO   49 views
--   is_updatable=YES / is_insertable_into=YES   1 view  v_customer_prepaid_balance
--
-- There are ZERO `instead of` triggers on any public view, so none of the 49
-- has been made writable by the other route.
--
-- THE ONE: `v_customer_prepaid_balance` is `select ... from customers c` with
-- its four money columns as scalar subqueries in the target list. Scalar
-- subqueries in the SELECT list do not block auto-updatability — only the FROM
-- clause shape does — so the view is auto-updatable onto `customers`, on the
-- two columns that map straight through: customer_id -> customers.id and
-- customer_name -> customers.name. `delete from v_customer_prepaid_balance`
-- deletes a CUSTOMER ROW, which would also drive straight through the
-- soft-delete lock in §6.
--
-- ---------------------------------------------------------------------------
-- 3) DOES ANYTHING LEGITIMATELY WRITE THROUGH A VIEW? No. Measured twice.
-- ---------------------------------------------------------------------------
--   * pg_proc: every function in `public` scanned, matching each of the 50 view
--     names against insert/update/delete in prosrc. ZERO hits. No SECURITY
--     DEFINER writer gets stranded.
--   * app code: app/, lib/, components/, scripts/ parsed for the supabase-js
--     shape `.from("v_x")` followed by .insert/.update/.upsert/.delete. 40 of
--     the 50 views are referenced; ZERO of those references is a write. A
--     second raw-text pass for `insert into v_` / `update v_` / `delete from v_`
--     across the same trees plus supabase/migrations also returned nothing.
-- The app writes base tables, as designed. Revoking write on views breaks
-- nothing, and the verification block below does not have to take that on
-- faith — it proves the reads still work.
--
-- ---------------------------------------------------------------------------
-- 4) anon AND service_role
-- ---------------------------------------------------------------------------
--   * anon: zero privileges on zero views, confirmed twice (absent from the
--     grant list; `anon_readable_views` census = 0). The sweep still issues a
--     `revoke all ... from anon` per view so the property is self-healing on
--     replay rather than merely true today.
--   * service_role: keeps all 7 on all 50, untouched and asserted afterwards.
--     It is the role that is SUPPOSED to be able to write.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CLOSES, AND WHAT IT DOES NOT. Stated plainly, because the
-- difference is the whole basis for scheduling this pre- or post-deploy.
-- ---------------------------------------------------------------------------
-- This removes a PATH, not a POWER. `v_customer_prepaid_balance` is
-- security_invoker, so a write through it is checked against `customers` AS THE
-- CALLING USER — and `authenticated` already holds all 7 privileges on
-- `customers` under an `authenticated_all_customers` FOR ALL policy. Anyone who
-- could have written customers through the view can still write customers
-- directly, with the same authority, after this migration.
--
-- So this is surface reduction and intent-stating, NOT a plugged escalation.
-- Calling it a closed hole would overstate it.
--
-- It is still worth doing: it removes the one path that would let a
-- hard DELETE reach `customers` while dressed as a balance report, it stops 49
-- meaningless grants from hiding the one that meant something, and it makes the
-- privilege set say what the design already assumes.
--
-- THE REAL EXPOSURE IS ONE LEVEL DOWN AND IS NOT IN THIS FILE'S SCOPE:
-- `customers` carries full grants plus a FOR ALL USING (true) policy, which is
-- the same shape 0198 just closed on notification_thresholds. Whether every
-- base table looks like that is a separate measurement and a separate decision.
-- Flagged here deliberately rather than fixed quietly.
--
-- TRIGGER and REFERENCES are left in place, as in 0198, but for a reason that
-- was measured this time rather than assumed. TRIGGER on a VIEW is not inert
-- the way it is on a table: it is the privilege needed to attach an
-- `instead of` trigger, which is precisely how a non-updatable view becomes
-- writable. That path is dead here because attaching one also requires a
-- trigger function, and `authenticated` has USAGE but NOT CREATE on schema
-- public, so it cannot create one. If CREATE is ever granted on public, revisit
-- this line first.
--
-- ---------------------------------------------------------------------------
-- THIS FILE IS POINT-IN-TIME, AND THAT IS A DELIBERATE SCOPE CHOICE
-- ---------------------------------------------------------------------------
-- The sweep below fixes the 50 views that EXIST. It does not change what
-- happens when the NEXT view is created: pg_default_acl still carries
-- `authenticated=arwdDxtm` for relations in public, from both the `postgres`
-- and `supabase_admin` grantors, so a view created by 0200 will come out with
-- the full 7 again and need sweeping again.
--
-- Closing that at the default is drafted and NOT applied, deliberately. It
-- lives in `.planning/post-deploy/0199b-default-acl-revoke.sql` and is
-- scheduled with the post-deploy RBAC and base-table permissions work, because
-- the only available lever (objtype 'r') covers TABLES as well as views and so
-- changes how every future table is created. That is a real trade and it is
-- management's call, not this migration's. Read that file before writing a
-- migration that creates a view or a table.
--
-- ---------------------------------------------------------------------------
-- REPLAY SAFETY
-- ---------------------------------------------------------------------------
-- Safe to replay. REVOKE and GRANT are idempotent, the sweep is driven off
-- pg_class rather than a hardcoded list, so re-running it re-asserts the same
-- end state and also picks up any view added since.
--
-- Materialized views are out of scope and there are none: the sweep and the
-- census both read relkind='v', matching §6's census exactly.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- THE SWEEP. Driven off pg_class, not a hardcoded list of 50, so it cannot
-- silently miss a view that was added between writing this and applying it.
-- `format('%I')` quotes every identifier.
--
-- security_invoker is NOT touched anywhere here. reloptions are left exactly as
-- they are, which is why the 50/50/0 census must come out unchanged below.
-- ---------------------------------------------------------------------------
do $$
declare
  r       record;
  swept   int := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind = 'v'
       and ns.nspname = 'public'
     order by c.relname
  loop
    -- The write privileges. TRUNCATE is not even a legal operation on a view;
    -- it is revoked anyway because the grant genuinely exists and leaving one
    -- member of the set behind invites the next reader to think it was meant.
    execute format(
      'revoke insert, update, delete, truncate on public.%I from authenticated',
      r.relname);

    -- Restated, not assumed. This is the privilege the app actually runs on,
    -- and it is the one that must survive the line above.
    execute format('grant select on public.%I to authenticated', r.relname);

    -- anon holds nothing today. Re-asserting it per view makes that a property
    -- this migration maintains rather than a fact it happens to inherit.
    execute format('revoke all on public.%I from anon', r.relname);

    swept := swept + 1;
  end loop;

  raise notice '0199: swept % public views', swept;
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — raises on any failure. Run in the same session, after apply.
-- ===========================================================================

do $$
declare
  n            int;
  r            record;
  tested       int := 0;
  col          text;
  write_ok     boolean;
  other_err    text;
begin
  -- 1) THE READ SURVIVES ON EVERY VIEW. The failure mode that matters most:
  --    all 50 are security_invoker, so losing SELECT does not error somewhere
  --    obvious, it empties screens.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and not has_table_privilege('authenticated', c.oid, 'select');
  if n <> 0 then
    raise exception
      '0199 FAIL: % views lost SELECT for authenticated. Reports and the bell go blank, not red.', n;
  end if;

  -- 2) NO WRITE PRIVILEGE SURVIVES ON ANY VIEW.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and (has_table_privilege('authenticated', c.oid, 'insert')
       or has_table_privilege('authenticated', c.oid, 'update')
       or has_table_privilege('authenticated', c.oid, 'delete')
       or has_table_privilege('authenticated', c.oid, 'truncate'));
  if n <> 0 then
    raise exception
      '0199 FAIL: authenticated still holds a write privilege on % views.', n;
  end if;

  -- 3) anon STILL HAS NOTHING — not just no SELECT, nothing at all.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete'));
  if n <> 0 then
    raise exception '0199 FAIL: anon holds a privilege on % views.', n;
  end if;

  -- 4) service_role IS UNTOUCHED. This migration must not have cost the one
  --    role that is supposed to be able to write.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and not (has_table_privilege('service_role', c.oid, 'select')
          and has_table_privilege('service_role', c.oid, 'insert')
          and has_table_privilege('service_role', c.oid, 'update')
          and has_table_privilege('service_role', c.oid, 'delete'));
  if n <> 0 then
    raise exception
      '0199 FAIL: service_role lost a privilege on % views. It is the role that SHOULD write.', n;
  end if;

  -- 5) THE §6 CENSUS IS UNCHANGED: 50 / 50 / 0. This migration touches grants
  --    only, so any movement here means it did something it was not asked to.
  --    If a view was legitimately added, change this number deliberately after
  --    confirming the sweep covered it — do not just make the error go away.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public';
  if n <> 50 then
    raise exception '0199 FAIL: public view count is %, expected 50.', n;
  end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and not (c.reloptions::text[] @> array['security_invoker=true']);
  if n <> 0 then
    raise exception '0199 FAIL: % public views are not security_invoker.', n;
  end if;

  -- 6) THE REAL PROOF. Privilege bits are what this migration edited, so
  --    asserting them proves only that the edit applied. This attempts an
  --    actual write, as the actual role, on every view Postgres considers
  --    updatable — today that is exactly one, v_customer_prepaid_balance, the
  --    only view where the grant was ever load-bearing.
  --
  --    `where false` matches no row. The privilege check fires before any row
  --    is examined, so the refusal is proven without touching data.
  for r in
    select v.table_name
      from information_schema.views v
     where v.table_schema = 'public'
       and (v.is_updatable = 'YES' or v.is_insertable_into = 'YES')
     order by v.table_name
  loop
    select c.column_name into col
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = r.table_name
       and c.is_updatable = 'YES'
     order by c.ordinal_position
     limit 1;

    if col is null then
      continue;  -- updatable relation, no updatable column: nothing to attempt
    end if;

    write_ok  := false;
    other_err := null;

    set local role authenticated;
    begin
      execute format('update public.%I set %I = %I where false',
                     r.table_name, col, col);
      write_ok := true;
    exception
      when insufficient_privilege then write_ok := false;
      when others                 then other_err := sqlerrm;
    end;
    reset role;

    if write_ok then
      raise exception
        '0199 FAIL: authenticated could still UPDATE public.% — the one view where the grant mattered is still open.', r.table_name;
    end if;

    if other_err is not null then
      -- Refused, but not by the privilege system. Worth a human look: it means
      -- assertion 2 is carrying this view alone.
      raise notice
        '0199 NOTE: write to public.% was refused by something other than privilege: %', r.table_name, other_err;
    end if;

    tested := tested + 1;
  end loop;

  if tested = 0 then
    -- Not a failure. It means no view is updatable at all, so assertion 2 is
    -- the entire guarantee and every write would raise 0A000 regardless.
    raise notice
      '0199 NOTE: no updatable view exists, so no write could be attempted. Assertion 2 stands alone: authenticated holds no write privilege on any of the 50.';
  else
    raise notice '0199: write refused as authenticated on % updatable view(s).', tested;
  end if;

  raise notice '0199 OK: all 50 public views are SELECT-only for authenticated, anon holds nothing, service_role is intact, census 50/50/0.';
end $$;

-- ---------------------------------------------------------------------------
-- AND THE END-TO-END PROOF: the app still reads. Run as authenticated, because
-- the owner bypasses RLS and would return rows even if this had broken the
-- read. These four span the shapes that matter — a UNION view, a money
-- rollup, the per-user notification feed, and the one view that was actually
-- updatable.
--
--   set local role authenticated;
--   select (select count(*) from public.v_active_alerts)             as alerts,
--          (select count(*) from public.v_pnl_by_period)             as pnl_rows,
--          (select count(*) from public.v_my_notifications)          as my_notifs,
--          (select count(*) from public.v_customer_prepaid_balance)  as prepaid_rows;
--
-- Expect alerts = 12, matching 0198's post-apply census. A ZERO or an error on
-- any of the four means a read broke and assertion 1 did not catch it —
-- roll back.
-- ---------------------------------------------------------------------------
