-- ============================================================================
-- 0206_ledger_receivables.sql
-- ============================================================================
-- REPOINT THE RECEIVABLES STACK ONTO THE LEDGER MODEL. DROP NOTHING.
--
-- Rulings (Turki, all decided):
--   * A ledger-era invoice's outstanding figure is its SETTLEMENT REMAINDER
--     (amount_payable_sar - payments - unreversed balance draws), not the old
--     pool-shortfall allocation. The allocation dies here.
--   * Legacy invoices (amount_payable_sar IS NULL) fall to their FROZEN
--     amount_due_sar - the same figure today's 'frozen' arm reports.
--   * customers.payment_mode is the authoritative mode for a customer.
--   * The Top-ups monthly series reads customer_ledger topups ONLY. The
--     legacy customer_topups rows are dummy data; 0207 drops the table, so
--     unioning it here would only recreate the dependency being removed.
--   * record_refund (0204) is the only refund door. return_customer_balance
--     is NOT touched here - the app stops calling it next, 0207 drops it.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--   * No DROPs. Every legacy object survives untouched for 0207.
--   * confirm_invoice unchanged. pay_invoice / apply_balance_to_invoice /
--     record_invoice_payment unchanged.
--   * v_customer_prepaid_balance / v_customer_amount_payable unchanged -
--     after this file, nothing in the receivables stack reads them.
--
-- MECHANICS. Both views are re-created with CREATE OR REPLACE, keeping the
-- exact column names, types and order (42P16 enforces this: the statement
-- itself fails if a column moved or changed type, so a successful apply IS
-- the column-parity proof). Because REPLACE keeps the view's identity, the
-- four dependents above v_invoice_outstanding_live - v_receivables_open,
-- v_receivables_aging, v_dashboard_action_items, v_active_alerts - read the
-- new definition automatically and need NO re-emission; their security
-- footers are restated below anyway, per discipline.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. v_invoice_outstanding_live - outstanding from settlement, not the pool
-- ----------------------------------------------------------------------------
-- Same 11 columns, same order, same types as the 0139-era definition:
--   invoice_id uuid, invoice_number text, customer_id uuid,
--   confirmed_at timestamptz, period_end date,
--   frozen_amount_due_sar numeric(12,2), effective_payment_mode text,
--   balance_sar numeric, shortfall_sar numeric,
--   outstanding_sar numeric(12,2), outstanding_basis text
--
-- WHAT CHANGED:
--   * outstanding_sar, ledger era: GREATEST(payable - paid - applied, 0),
--     restated inline from the same terms v_invoice_settlement derives
--     (invoice_payments; unreversed balance_applied ledger rows). A written-
--     off customer's open invoices still read 0, as before.
--   * outstanding_sar, legacy era: the invoice's own frozen amount_due_sar.
--     The prepaid pool-shortfall allocation (newest-first window over
--     v_customer_prepaid_balance) is GONE - that was the last reader of the
--     pool in this stack.
--   * outstanding_basis: 'settlement' is the new ledger-era value.
--     'written_off' and 'frozen' keep their meaning; 'live_prepaid_balance'
--     can no longer occur.
--   * effective_payment_mode: the invoice's own frozen stamp still wins
--     (it is a document fact); the FALLBACK for unstamped invoices is now
--     customers.payment_mode (authoritative per ruling) instead of the old
--     resolve-from-projects lateral.
--   * balance_sar / shortfall_sar: kept for column parity, now sourced from
--     v_customer_ledger_balance instead of the pool. shortfall_sar remains
--     GREATEST(0, -balance): "how negative is this customer's balance".
--     Nothing in the app reads either column today; they exist so 42P16
--     accepts the REPLACE.

create or replace view public.v_invoice_outstanding_live as
with open_invoices as (
  select i.id                as invoice_id,
         i.invoice_number,
         i.customer_id,
         i.confirmed_at,
         i.period_end,
         i.amount_due_sar    as frozen_amount_due_sar,
         i.amount_payable_sar,
         -- Frozen stamp first; customers.payment_mode is the authoritative
         -- fallback (ruling). The projects-derived lateral is gone.
         coalesce(i.payment_mode, c.payment_mode) as effective_payment_mode
    from public.invoices i
    left join public.customers c on c.id = i.customer_id
   where i.confirmed_at is not null
     and i.paid_at is null
     and i.voided_at is null
     and (c.archived_at is null or i.confirmed_at < c.archived_at)
),
settled as (
  -- The settlement terms, restated per open invoice. Same expressions as
  -- v_invoice_settlement (0204): cash/transfer money through
  -- invoice_payments; balance money through unreversed balance_applied
  -- ledger rows (stored negative, hence the sign flip).
  select o.invoice_id,
         coalesce((select round(sum(ip.amount_sar), 2)
                     from public.invoice_payments ip
                    where ip.invoice_id = o.invoice_id), 0) as paid_sar,
         coalesce((select round(-sum(x.amount_sar), 2)
                     from public.customer_ledger x
                    where x.invoice_id = o.invoice_id
                      and x.entry_type = 'balance_applied'
                      and not exists (select 1 from public.customer_ledger r
                                       where r.reversal_of = x.id)), 0) as applied_sar
    from open_invoices o
)
select o.invoice_id,
       o.invoice_number,
       o.customer_id,
       o.confirmed_at,
       o.period_end,
       o.frozen_amount_due_sar,
       o.effective_payment_mode,
       b.balance_sar,
       greatest(0::numeric, -b.balance_sar) as shortfall_sar,
       (case
          when w.customer_id is not null then 0::numeric
          when o.amount_payable_sar is not null
            then greatest(round(o.amount_payable_sar - s.paid_sar - s.applied_sar, 2), 0::numeric)
          else o.frozen_amount_due_sar
        end)::numeric(12,2)                 as outstanding_sar,
       case
         when w.customer_id is not null then 'written_off'::text
         when o.amount_payable_sar is not null then 'settlement'::text
         else 'frozen'::text
       end                                  as outstanding_basis
  from open_invoices o
  join settled s  on s.invoice_id  = o.invoice_id
  join public.v_customer_ledger_balance b on b.customer_id = o.customer_id
  left join public.customer_write_offs w
         on w.customer_id = o.customer_id and w.reversed_at is null;

alter view public.v_invoice_outstanding_live set (security_invoker = true);
revoke all on public.v_invoice_outstanding_live from anon;
grant select on public.v_invoice_outstanding_live to authenticated;

comment on view public.v_invoice_outstanding_live is
  'Per-open-invoice outstanding (0206). Ledger-era invoices: settlement '
  'remainder = amount_payable - invoice_payments - unreversed balance draws, '
  'floored at 0; basis ''settlement''. Legacy invoices: frozen amount_due_sar; '
  'basis ''frozen''. Written-off customers read 0. The 0139 prepaid '
  'pool-shortfall allocation is gone; nothing here reads '
  'v_customer_prepaid_balance any more.';

-- ----------------------------------------------------------------------------
-- 2. v_topups_monthly - the series reads the ledger
-- ----------------------------------------------------------------------------
-- Same 3 columns: month date, topups_sar numeric, topup_count bigint.
--
-- Source is customer_ledger entry_type = 'topup' ONLY (ruling: the legacy
-- customer_topups rows are dummy and the table goes in 0207 - no union).
-- The ledger has no separate entry date; created_at IS the top-up moment
-- (record_topup writes it), bucketed in Riyadh local terms like every other
-- monthly view. The archived-customer gate mirrors the old one: rows stamped
-- before the archive stay in the series, rows after it (impossible today,
-- cheap to keep true) do not.

create or replace view public.v_topups_monthly as
select m.month,
       coalesce(sum(t.amount_sar), 0::numeric) as topups_sar,
       coalesce(count(t.id), 0)                as topup_count
  from public.v_report_months m
  left join (
    select cl.id, cl.amount_sar, cl.created_at
      from public.customer_ledger cl
      left join public.customers c on c.id = cl.customer_id
     where cl.entry_type = 'topup'
       and (c.archived_at is null or cl.created_at < c.archived_at)
  ) t
    on date_trunc('month', (t.created_at at time zone 'Asia/Riyadh'))::date = m.month
 group by m.month;

alter view public.v_topups_monthly set (security_invoker = true);
revoke all on public.v_topups_monthly from anon;
grant select on public.v_topups_monthly to authenticated;

comment on view public.v_topups_monthly is
  'Monthly balance additions (0206): customer_ledger entry_type=''topup'' '
  'bucketed by Riyadh-local month of created_at. Reads NOTHING from the '
  'legacy customer_topups table (dummy data, dropped in 0207).';

-- ----------------------------------------------------------------------------
-- 3. restore_customer_guarded - re-emitted with its comments repointed
-- ----------------------------------------------------------------------------
-- FINDING, stated plainly: the live function EXECUTES no read of
-- v_customer_prepaid_balance or customer_balance_returns and never has -
-- 0141's body only names them in a DO-NOT-FIX comment explaining why restore
-- writes no balance. That comment text is exactly what dependency text-scans
-- (including 0207's own drop-time checks) trip on, and it is why prod and
-- test currently disagree: prod's copy has lost its comments, test's kept
-- them. So the function is re-emitted with IDENTICAL behaviour and the
-- comment rewritten in ledger terms - after this file, no text scan finds a
-- legacy name in it, and prod and test converge on one definition.

drop function if exists public.restore_customer_guarded(uuid, text);

create function public.restore_customer_guarded(
  p_customer_id uuid,
  p_actor       text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_archived_at   timestamptz;
  v_exists        boolean;
  v_proj_total    int;
  v_proj_archived int;
  v_active_wo     int;
  v_now           timestamptz := now();
  v_actor         text := nullif(btrim(coalesce(p_actor, '')), '');
begin
  -- ---- the customer must exist -------------------------------------------
  select true, c.archived_at
    into v_exists, v_archived_at
    from public.customers c
   where c.id = p_customer_id;

  if v_exists is not true then
    raise exception 'Customer not found.';
  end if;

  -- ---- and must actually be archived -------------------------------------
  -- Not a no-op on purpose: "restore" for a live customer means the caller
  -- is working from a stale list.
  if v_archived_at is null then
    raise exception
      'This customer is not archived, so there is nothing to restore.'
      using errcode = 'check_violation';
  end if;

  -- ---- exactly one project, and it must be archived too -------------------
  select count(*), count(*) filter (where p.archived_at is not null)
    into v_proj_total, v_proj_archived
    from public.projects p
   where p.customer_id = p_customer_id;

  if v_proj_total <> 1 then
    raise exception
      'Expected exactly 1 project for this customer, found %. Restore cannot decide which project to bring back - restore the project side by hand and revisit restore_customer_guarded (0141) before lifting projects_customer_id_unique.',
      v_proj_total;
  end if;

  if v_proj_archived <> 1 then
    raise exception
      'This customer is archived but its project is not. Archiving always stamps both in one transaction (0019/0139), so this is drift - investigate before restoring.';
  end if;

  -- ---- at most one ACTIVE write-off ---------------------------------------
  select count(*)
    into v_active_wo
    from public.customer_write_offs w
   where w.customer_id = p_customer_id
     and w.reversed_at is null;

  if v_active_wo > 1 then
    raise exception
      'Found % ACTIVE write-offs for this customer; at most 1 is possible. The partial unique index is missing or was bypassed - fix that before restoring.',
      v_active_wo;
  end if;

  -- ---- reverse the write-off (KEEP the row) -------------------------------
  update public.customer_write_offs
     set reversed_at = v_now,
         reversed_by = v_actor
   where customer_id = p_customer_id
     and reversed_at is null;

  -- ---- clear both stamps, together ----------------------------------------
  update public.projects
     set archived_at = null
   where customer_id = p_customer_id
     and archived_at is not null;

  update public.customers
     set archived_at = null
   where id = p_customer_id
     and archived_at is not null;

  -- NO MONEY MOVES HERE, AND NONE SHOULD EVER. Restore un-archives; it does
  -- not write the ledger. The append-only ledger (0203) already holds every
  -- top-up, draw and refund exactly as they happened, so the restored
  -- customer's Balance/Available are simply readable again, unchanged.
  return p_customer_id;
end;
$function$;

revoke all on function public.restore_customer_guarded(uuid, text) from public;
revoke all on function public.restore_customer_guarded(uuid, text) from anon;
grant execute on function public.restore_customer_guarded(uuid, text) to authenticated;

comment on function public.restore_customer_guarded(uuid, text) is
  'Un-archives a customer + their single project and reverses the active '
  'write-off if one exists (0141, comments repointed 0206). Moves no money: '
  'the 0203 ledger already holds the account exactly as it stands.';

-- ----------------------------------------------------------------------------
-- 4. Security footers restated for the untouched dependents
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE above kept v_invoice_outstanding_live's identity, so
-- these four read the new definition with NO re-emission. Their footers are
-- restated per discipline (a footer can be restated without recreating the
-- view), and the verification block below measures all six.

alter view public.v_receivables_open        set (security_invoker = true);
revoke all on public.v_receivables_open        from anon;
grant select on public.v_receivables_open        to authenticated;

alter view public.v_receivables_aging       set (security_invoker = true);
revoke all on public.v_receivables_aging       from anon;
grant select on public.v_receivables_aging       to authenticated;

alter view public.v_dashboard_action_items  set (security_invoker = true);
revoke all on public.v_dashboard_action_items  from anon;
grant select on public.v_dashboard_action_items  to authenticated;

alter view public.v_active_alerts           set (security_invoker = true);
revoke all on public.v_active_alerts           from anon;
grant select on public.v_active_alerts           to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Verification - the transaction refuses to commit on any failure
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_name     text;
  v_bad      int;
  v_checked  int;
  v_overload int;
begin
  -- 5a. Footer + anon on every view this file touched or sits above.
  for v_name in
    select unnest(array['v_invoice_outstanding_live', 'v_receivables_open',
                        'v_receivables_aging', 'v_dashboard_action_items',
                        'v_active_alerts', 'v_topups_monthly'])
  loop
    perform 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_name and c.relkind = 'v'
        and c.reloptions::text[] @> array['security_invoker=true'];
    if not found then
      raise exception '0206 VERIFY: % is missing security_invoker=true.', v_name;
    end if;
    if has_table_privilege('anon', ('public.' || v_name)::regclass, 'select') then
      raise exception '0206 VERIFY: anon can read %.', v_name;
    end if;
  end loop;

  -- 5b. The legacy dependencies are actually gone from the new definitions.
  if pg_get_viewdef('public.v_invoice_outstanding_live'::regclass)
       like '%v_customer_prepaid_balance%' then
    raise exception '0206 VERIFY: v_invoice_outstanding_live still reads the pool.';
  end if;
  if pg_get_viewdef('public.v_topups_monthly'::regclass) like '%customer_topups%' then
    raise exception '0206 VERIFY: v_topups_monthly still reads customer_topups.';
  end if;

  -- 5c. restore_customer_guarded: one overload, no anon execute, no legacy
  --     names anywhere in it - body OR comments (the whole point of 3).
  select count(*) into v_overload
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restore_customer_guarded';
  if v_overload <> 1 then
    raise exception '0206 VERIFY: expected 1 restore_customer_guarded, found %.', v_overload;
  end if;
  if has_function_privilege('anon',
       'public.restore_customer_guarded(uuid, text)'::regprocedure, 'execute') then
    raise exception '0206 VERIFY: anon can execute restore_customer_guarded.';
  end if;
  if pg_get_functiondef('public.restore_customer_guarded(uuid, text)'::regprocedure)
       ~ '(v_customer_prepaid_balance|customer_balance_returns)' then
    raise exception '0206 VERIFY: restore_customer_guarded still names a legacy object.';
  end if;

  -- 5d. THE LAW, on live rows: every ledger-era open invoice's outstanding
  --     equals payable - paid - applied (floored at 0), re-derived here from
  --     the base tables so the check does not read its own answer back.
  --     Written-off customers are excluded: their arm is pinned to 0 above.
  select count(*),
         count(*) filter (where o.outstanding_sar is distinct from
           greatest(round(i.amount_payable_sar - pay.paid - app.applied, 2),
                    0::numeric)::numeric(12,2))
    into v_checked, v_bad
    from public.v_invoice_outstanding_live o
    join public.invoices i on i.id = o.invoice_id
    cross join lateral (
      select coalesce(round(sum(ip.amount_sar), 2), 0) as paid
        from public.invoice_payments ip where ip.invoice_id = i.id) pay
    cross join lateral (
      select coalesce(round(-sum(x.amount_sar), 2), 0) as applied
        from public.customer_ledger x
       where x.invoice_id = i.id and x.entry_type = 'balance_applied'
         and not exists (select 1 from public.customer_ledger r
                          where r.reversal_of = x.id)) app
   where o.outstanding_basis = 'settlement';
  if v_checked = 0 then
    raise notice '0206 VERIFY: no open ledger-era invoices on this database - settlement equality has nothing to measure here (checked on the other project or exercised by test:db).';
  elsif v_bad > 0 then
    raise exception '0206 VERIFY: % of % ledger-era open invoices break outstanding = payable - paid - applied.', v_bad, v_checked;
  else
    raise notice '0206 VERIFY: settlement equality holds for all % open ledger-era invoice(s).', v_checked;
  end if;

  -- 5e. Basis values are only the three that exist now.
  select count(*) into v_bad
    from public.v_invoice_outstanding_live
   where outstanding_basis not in ('settlement', 'frozen', 'written_off');
  if v_bad > 0 then
    raise exception '0206 VERIFY: % rows carry a retired outstanding_basis value.', v_bad;
  end if;
end;
$verify$;

commit;
