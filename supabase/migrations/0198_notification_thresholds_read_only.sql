-- ===========================================================================
-- 0198 — notification_thresholds IS READ-ONLY FOR authenticated
-- ===========================================================================
-- `notification_thresholds` holds the ORG-WIDE alert defaults: one row, read by
-- v_active_alerts to decide when a document is expiring, when a part is below
-- reorder, when a work order is stuck, when an invoice turns red. It is shared
-- state — every user's notifications are computed from it.
--
-- Its only policy was `authenticated_all_notification_thresholds`, FOR ALL
-- USING (true) WITH CHECK (true), and `authenticated` also held the full
-- default grant set. So any signed-in user could rewrite the thresholds for
-- EVERYONE through the API, and the first anyone would know is that the alerts
-- changed for the whole company.
--
-- NO LEGITIMATE WRITE PATH IS LOST. Measured before writing this:
--   * Settings writes the PER-USER table `notification_thresholds_user`
--     (lib/actions/notification-settings.ts:246), never this one.
--   * ZERO functions in `public` so much as mention this table, so there is no
--     SECURITY DEFINER writer to strand — checked against pg_proc.prosrc, not
--     assumed.
--   * The single row is seeded data, not user-generated.
-- Org defaults now change the way other seeded reference data changes: through
-- service_role or a migration.
--
-- SELECT MUST SURVIVE, AND THAT IS THE WHOLE RISK IN THIS FILE. v_active_alerts
-- is `security_invoker = true`, so it reads this table AS THE CALLING USER. If
-- `authenticated` loses SELECT, every alert silently disappears for every user
-- and the bell goes empty — a far worse outcome than the hole being closed.
-- The verification block therefore proves the read still works by actually
-- performing it as the `authenticated` role, not by inspecting a grant.
--
-- BELT AND SUSPENDERS, deliberately. The policy governs RLS; the grant governs
-- the base privilege. Either alone would stop the write. Both are set so that
-- neither one is load-bearing on its own, and so that a future
-- `create policy ... for all` cannot silently re-open the table.
--
-- REFERENCES and TRIGGER are left in place. Neither writes a row: REFERENCES
-- only allows an FK pointed at this table and TRIGGER requires rights on the
-- table that `authenticated` does not have in practice. Revoking them is
-- outside the brief and would be a change nobody asked for.
--
-- `anon` holds nothing on this table today and this migration keeps it that
-- way — it is not in the grant list at all, so there is nothing to revoke.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) RLS: one SELECT-only policy replaces the FOR ALL one.
-- ---------------------------------------------------------------------------
drop policy if exists authenticated_all_notification_thresholds
  on public.notification_thresholds;

-- FOR SELECT only. No WITH CHECK clause exists on a SELECT policy, which is
-- the point: there is no write side to get wrong. With no INSERT/UPDATE/DELETE
-- policy present, RLS denies those commands by default for non-bypassing
-- roles, so this single policy is the entire access surface.
create policy read_notification_thresholds
  on public.notification_thresholds
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2) Grants: drop the base write privileges, keep the read.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate
  on public.notification_thresholds from authenticated;

-- Restated rather than assumed. If a future migration revokes everything and
-- re-grants, this line is the one that keeps the bell working.
grant select on public.notification_thresholds to authenticated;

comment on table public.notification_thresholds is
  'Org-wide alert thresholds: ONE row, read by v_active_alerts to decide what is expiring, low, stuck or overdue for every user. READ-ONLY to authenticated as of 0198 — it was FOR ALL USING (true) with full grants, so any signed-in user could change the alert rules for the whole company. Writes now require service_role or a migration. SELECT must never be revoked from authenticated: v_active_alerts is security_invoker, so losing the read empties the notification bell for everyone rather than erroring visibly. Per-user overrides live in notification_thresholds_user and are unaffected.';

commit;

-- ===========================================================================
-- VERIFICATION — raises on any failure. Run in the same session, after apply.
-- Every assertion states what it is protecting, not just what it checks.
-- ===========================================================================

do $$
declare
  n         int;
  write_ok  boolean := false;
begin
  -- 1) THE READ SURVIVES — the failure mode that matters most.
  if not has_table_privilege('authenticated', 'public.notification_thresholds', 'select') then
    raise exception
      '0198 FAIL: authenticated lost SELECT. v_active_alerts is security_invoker, so every notification would silently vanish.';
  end if;

  -- 2) NO WRITE PRIVILEGE SURVIVES, at the grant level.
  if has_table_privilege('authenticated', 'public.notification_thresholds', 'insert')
     or has_table_privilege('authenticated', 'public.notification_thresholds', 'update')
     or has_table_privilege('authenticated', 'public.notification_thresholds', 'delete')
     or has_table_privilege('authenticated', 'public.notification_thresholds', 'truncate') then
    raise exception
      '0198 FAIL: authenticated still holds a write privilege on notification_thresholds.';
  end if;

  -- 3) EXACTLY ONE POLICY, AND IT IS A PLAIN SELECT POLICY.
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'notification_thresholds';
  if n <> 1 then
    raise exception '0198 FAIL: expected exactly 1 policy on notification_thresholds, found %.', n;
  end if;

  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'notification_thresholds'
     and cmd = 'SELECT' and with_check is null;
  if n <> 1 then
    raise exception
      '0198 FAIL: the surviving policy is not a write-free SELECT policy — an ALL or write policy is still present.';
  end if;

  -- 4) anon STILL HAS NOTHING.
  if has_table_privilege('anon', 'public.notification_thresholds', 'select') then
    raise exception '0198 FAIL: anon can read notification_thresholds.';
  end if;

  -- 5) THE ROW IS STILL THERE AND STILL READABLE AS authenticated. Reading it
  --    as the owner would prove nothing — the owner bypasses RLS. This reads
  --    it as the role the app actually uses.
  set local role authenticated;
  select count(*) into n from public.notification_thresholds;
  reset role;
  if n <> 1 then
    raise exception
      '0198 FAIL: authenticated reads % threshold rows, expected 1. The bell is empty.', n;
  end if;

  -- 6) AND A WRITE AS authenticated IS ACTUALLY REFUSED. `where false` matches
  --    nothing; the privilege check fires before any row is touched, so this
  --    proves the refusal without depending on a row existing.
  set local role authenticated;
  begin
    update public.notification_thresholds set low_runway_trips = low_runway_trips where false;
    write_ok := true;
  exception
    when insufficient_privilege then write_ok := false;
  end;
  reset role;
  if write_ok then
    raise exception '0198 FAIL: authenticated could still UPDATE notification_thresholds.';
  end if;

  -- 7) THE PER-USER TABLE IS UNTOUCHED — its own-row policy still scopes to
  --    auth.uid(). This migration must not have widened or narrowed it.
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'notification_thresholds_user'
     and policyname = 'own_notification_thresholds_user'
     and qual like '%auth.uid()%';
  if n <> 1 then
    raise exception
      '0198 FAIL: own_notification_thresholds_user is missing or no longer scoped to auth.uid().';
  end if;

  if not has_table_privilege('authenticated', 'public.notification_thresholds_user', 'update') then
    raise exception
      '0198 FAIL: the per-user override table lost UPDATE — Settings can no longer save a threshold.';
  end if;

  -- 8) SECURITY FOOTER CENSUS UNCHANGED. This migration touches a TABLE, so
  --    the view census must read exactly as it did before: 50 / 50 / 0.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public';
  if n <> 50 then
    raise exception '0198 FAIL: public view count is %, expected 50.', n;
  end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and not (c.reloptions::text[] @> array['security_invoker=true']);
  if n <> 0 then
    raise exception '0198 FAIL: % public views are not security_invoker.', n;
  end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where c.relkind = 'v' and ns.nspname = 'public'
     and has_table_privilege('anon', c.oid, 'select');
  if n <> 0 then
    raise exception '0198 FAIL: % public views are readable by anon.', n;
  end if;

  raise notice '0198 OK: notification_thresholds is read-only to authenticated, the row still reads as authenticated, the per-user table and the view census are unchanged.';
end $$;

-- ---------------------------------------------------------------------------
-- AND THE END-TO-END PROOF: alerts still come out. Expect the same 12 rows,
-- across the same 8 kinds, that the table returned before this migration.
-- Run it as `authenticated`, not as the owner — the owner bypasses RLS and
-- would return rows even if this migration had broken the read.
--
--   set local role authenticated;
--   select split_part(alert_identity, ':', 1) as kind, severity, count(*)
--     from public.v_active_alerts group by 1, 2 order by 1, 2;
--
-- Expected, measured as authenticated after apply: doc_expiry red 2 /
-- yellow 2, invoice_overdue yellow 1, part_reorder red 1, permit_overdue
-- yellow 1, prepaid_low_runway yellow 1, prepaid_overdrawn yellow 2,
-- wo_stuck red 2. Twelve rows.
--
-- prepaid_low_runway and prepaid_overdrawn are TWO branches, not one: a
-- prepaid account that is merely running low and one that has gone past its
-- balance are different facts about different customers, and 0154 has emitted
-- them separately since the view was written. An earlier draft of this comment
-- folded them into a single bucket of three, which made the census read 6
-- kinds. Twelve was right; six was not.
--
-- A count of ZERO here means the read broke and assertion 1 did not catch it
-- — roll back.
-- ---------------------------------------------------------------------------
