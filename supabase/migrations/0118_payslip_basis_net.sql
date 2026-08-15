-- 0118_payslip_basis_net.sql
-- One definition of net pay, in SQL, read by both the preview and the freeze.
--
-- APPLIED AND VERIFIED (architect, 2026-08-15). Committed after apply, per the
-- reset incident in CLAUDE.md section 7.
--
-- Verified at apply: view security_invoker and anon-locked; RPC still exactly
-- one signature, SECURITY DEFINER, search_path pinned; net_sar appended as
-- column 18 with 16/17 intact and no 42P16; the view's net_sar equals the old
-- expression on every row (0 mismatches); both frozen payslips reconcile to
-- view net minus deductions (0 mismatches — PS-2026-000001 still 1,504.00,
-- PS-2026-000002 still 1,517.02); and both guards survived the recreate, with
-- the NULL-hire and running-month cases still refusing 23514.
--
-- ===========================================================================
-- THE DRIFT THIS CLOSES, AND WHY IT CANNOT CLOSE WITHOUT A SCHEMA CHANGE
-- ===========================================================================
-- Net pay is currently expressed TWICE:
--
--   SQL  issue_driver_payslip (0115), inside the INSERT:
--          v_basis.base_salary_sar + v_basis.commission_sar
--            + v_basis.specials_sar + v_basis.adjustments_sar
--            + v_basis.bonus_sar - 0
--   TS   payslipPreviewNet (lib/reports.ts), for the unissued preview:
--          base + commission + specials + adjustments + bonus
--
-- They agree today. Nothing makes them keep agreeing, and the failure is
-- silent: the register would show one net, the issued document another, and
-- both would look like plausible numbers. That is exactly the class of drift 0098
-- exists to prevent — a metric defined on the page rather than once in SQL.
--
-- I WAS ASKED WHETHER THIS COULD BE CLOSED WITHOUT A MIGRATION. It cannot, and
-- the alternatives are worth recording so nobody re-proposes them:
--   · Drop the net column for unissued rows — removes the register's single
--     most useful figure (what would I pay this month) to fix a bookkeeping
--     concern. The cure is worse.
--   · Have the page call a function for the preview — still a schema change,
--     and a round trip per row.
--   · Leave it documented — that is today's state, and documentation has never
--     stopped two expressions diverging.
--
-- So: the view gains the column, and — this is the part that actually closes
-- the drift — THE RPC STOPS COMPUTING IT TOO. Adding net_sar to the view while
-- leaving the RPC's own sum in place would give three expressions instead of
-- two. After this file there is exactly ONE, in the view; the RPC reads it and
-- subtracts deductions, and the page reads it and displays it.
--
-- ===========================================================================
-- DEDUCTIONS, AND WHY net_sar IS DEFINED BEFORE THEM
-- ===========================================================================
-- driver_payslips.deductions_sar exists and is always 0 — there is no
-- deductions data source yet (deliberately: the column ships so the document's
-- arithmetic is complete and adding a source later changes no issued slip).
--
-- The view therefore CANNOT know about deductions: they are a property of the
-- document being issued, not of the basis. net_sar here is the five components
-- summed — everything the basis knows — and the RPC applies the deduction:
--
--     net_sar (from the view)  -  deductions_sar  =  the document's net
--
-- Today deductions are 0 so the two are equal, which is why the frozen figures
-- do not move. When a deductions source arrives, ONLY the RPC's subtraction
-- changes; the view's definition of what the five components add up to stays
-- correct, and the preview stays honest by showing the pre-deduction figure it
-- actually knows.
--
-- ===========================================================================
-- SAFETY
-- ===========================================================================
-- APPEND-ONLY. net_sar becomes column 18; columns 1-17 keep their names,
-- positions and types exactly. create-or-replace cannot insert or reorder a
-- column (42P16, the error 0112 hit).
--
-- NO ISSUED PAYSLIP CHANGES. driver_payslips rows are frozen and this file does
-- not write to that table. Both live documents (PS-2026-000001 and
-- PS-2026-000002) must read identically before and after — verification block D
-- proves it.
--
-- NO FIGURE MOVES AT ALL, in fact: the view's new column computes what the RPC
-- already computed, and the RPC now reads it instead. This is a refactor with a
-- proof obligation, not a change to anyone's pay.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE VIEW GAINS net_sar (column 18, appended).
--    Whole body restated because create-or-replace requires it; columns 1-17
--    are byte-identical to 0116's definition.
-- ---------------------------------------------------------------------------
create or replace view public.v_driver_payslip_basis
with (security_invoker = true) as
with months as (
  select month from public.v_report_months
),
live_drivers as (
  select d.id, d.name, d.salary_sar, d.hire_date, d.terminated_at
    from public.drivers d
),
matched_payouts as (
  select p.driver_id,
         date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date as month,
         count(*)                     as payout_count,
         sum(p.base_sar)              as base_sar,
         sum(p.specials_sar)          as specials_sar,
         sum(p.adjustments_sar)       as adjustments_sar,
         sum(p.bonus_sar)             as bonus_sar,
         sum(p.total_sar)             as total_sar
    from public.commission_payouts p
   where p.paid_at is not null
   group by 1, 2
),
basis as (
  select
    m.month                                        as period_start,
    d.id                                           as driver_id,
    d.name                                         as driver_name,
    case
      when d.hire_date is not null
       and d.hire_date > (m.month + interval '1 month' - interval '1 day')::date
        then 0::numeric
      when d.terminated_at is not null and (d.terminated_at at time zone 'Asia/Riyadh')::date < m.month
        then 0::numeric
      else coalesce(d.salary_sar, 0)
    end                                            as base_salary_sar,
    (d.salary_sar is null)                         as salary_missing,
    (d.hire_date is null)                          as hire_date_missing,
    case when mp.driver_id is not null then 'paid' else 'earned' end as commission_basis,
    (mp.driver_id is not null)                     as commission_settled,
    coalesce(mp.payout_count, 0)                   as payout_count,
    case when mp.driver_id is not null then mp.base_sar else coalesce((
      select sum(t.commission_sar) from public.trips t
       where t.driver_id = d.id
         and t.stage = 'delivered'
         and t.payout_id is null
         and date_trunc('month', t.trip_date)::date = m.month
    ), 0) end                                      as commission_sar,
    case when mp.driver_id is not null then mp.specials_sar else coalesce((
      select sum(cs.amount_sar) from public.commission_specials cs
       where cs.driver_id = d.id
         and cs.status = 'approved'
         and cs.payout_id is null
         and cs.month_key = to_char(m.month, 'YYYY-MM')
    ), 0) end                                      as specials_sar,
    case when mp.driver_id is not null then mp.adjustments_sar else coalesce((
      select sum(ca.amount_sar) from public.commission_adjustments ca
       where ca.driver_id = d.id
         and ca.status = 'approved'
         and ca.payout_id is null
         and ca.month_key = to_char(m.month, 'YYYY-MM')
    ), 0) end                                      as adjustments_sar,
    case when mp.driver_id is not null then mp.bonus_sar else coalesce((
      select sum(cp.bonus_sar) from public.commission_periods cp
       where cp.driver_id = d.id
         and cp.bonus_status = 'approved'
         and cp.month_key is not null
         and cp.month_key = to_char(m.month, 'YYYY-MM')
    ), 0) end                                      as bonus_sar,
    ps.id                                          as issued_payslip_id,
    ps.payslip_number                              as issued_payslip_number,
    (d.terminated_at is not null)                  as terminated,
    (d.terminated_at at time zone 'Asia/Riyadh')::date as termination_date
  from months m
  cross join live_drivers d
  left join matched_payouts mp
         on mp.driver_id = d.id and mp.month = m.month
  left join public.driver_payslips ps
         on ps.driver_id = d.id and ps.period_start = m.month
  where (d.hire_date is null
         or d.hire_date <= (m.month + interval '1 month' - interval '1 day')::date)
    and (d.terminated_at is null
         or (d.terminated_at at time zone 'Asia/Riyadh')::date >= m.month)
)
select
  b.*,
  -- APPENDED (0118). THE ONE DEFINITION OF NET PAY. Before deductions, which
  -- the basis cannot know — see the header. issue_driver_payslip reads this and
  -- subtracts deductions_sar; the page reads it and shows it. Neither one adds
  -- the components up again.
  (b.base_salary_sar + b.commission_sar + b.specials_sar
     + b.adjustments_sar + b.bonus_sar)            as net_sar
from basis b;

comment on view public.v_driver_payslip_basis is
  'One row per driver per report month: the salary and commission a payslip '
  'would carry. THE PAGE READS THIS AND NEVER RE-DERIVES IT (0098), and '
  'issue_driver_payslip freezes from this same view so a preview and the '
  'document it becomes cannot disagree. commission_basis is paid when a payout '
  'was SETTLED in the month (by paid_at, Asia/Riyadh) and earned otherwise; on '
  'the earned basis only trips with payout_id IS NULL are counted, which is '
  'what stops a trip appearing on two payslips. Covers ALL drivers including '
  'terminated ones. A driver with hire_date IS NULL is SHOWN with '
  'hire_date_missing = true and CANNOT be issued a payslip; terminated is a '
  'LABEL rule only and does not block issue (0116). net_sar (0118) is the ONE '
  'definition of net pay, BEFORE deductions — the RPC subtracts those, the '
  'page displays this, and neither re-adds the components.';

alter view public.v_driver_payslip_basis set (security_invoker = true);
revoke all on public.v_driver_payslip_basis from anon;
grant select on public.v_driver_payslip_basis to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE RPC STOPS COMPUTING NET. This is the half that actually closes the
--    drift — without it this file would ADD a third expression, not remove one.
--    Exactly one signature, dropped explicitly before recreate (0038's lesson).
--    Body is otherwise unchanged from 0115.
-- ---------------------------------------------------------------------------
drop function if exists public.issue_driver_payslip(uuid, date, text);

create or replace function public.issue_driver_payslip(
  p_driver_id    uuid,
  p_period_start date,
  p_actor        text
)
returns public.driver_payslips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_basis      record;
  v_row        public.driver_payslips;
  v_number     text;
  v_snap       jsonb;
  v_deductions numeric(12,2) := 0;   -- no source yet; see 0115 and the header
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'An actor is required to issue a payslip.' using errcode = '23514';
  end if;
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'A payslip period must start on the first day of a month.'
      using errcode = '23514';
  end if;
  if p_period_start >= date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date then
    raise exception 'That month has not finished yet — a payslip can only be issued for a completed month.'
      using errcode = '23514';
  end if;

  perform 1 from public.drivers where id = p_driver_id for update;

  if exists (select 1 from public.driver_payslips
              where driver_id = p_driver_id and period_start = p_period_start) then
    raise exception 'This driver already has a payslip issued for that month.'
      using errcode = '23505';
  end if;

  select * into v_basis
    from public.v_driver_payslip_basis
   where driver_id = p_driver_id and period_start = p_period_start;

  if not found then
    raise exception 'That driver was not on the payroll for that month.'
      using errcode = '23514';
  end if;

  if v_basis.hire_date_missing then
    raise exception 'This driver has no hire date, so a payslip period cannot be established. Set the hire date first.'
      using errcode = '23514';
  end if;

  v_number := public.next_payslip_number(extract(year from p_period_start)::int);

  select jsonb_build_object(
    'driver_name',        v_basis.driver_name,
    'salary_at_issue',    v_basis.base_salary_sar,
    'salary_missing',     v_basis.salary_missing,
    'commission_basis',   v_basis.commission_basis,
    'payout_count',       v_basis.payout_count,
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'period_label', p.period_label, 'paid_at', p.paid_at,
               'base_sar', p.base_sar, 'specials_sar', p.specials_sar,
               'adjustments_sar', p.adjustments_sar, 'bonus_sar', p.bonus_sar,
               'total_sar', p.total_sar) order by p.paid_at)
        from public.commission_payouts p
       where p.driver_id = p_driver_id
         and p.paid_at is not null
         and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start
    ), '[]'::jsonb),
    'covered_trips', coalesce((
      select jsonb_build_object(
               'count', count(*), 'first_trip', min(t.trip_date), 'last_trip', max(t.trip_date),
               'ids', jsonb_agg(t.id order by t.trip_date))
        from public.trips t
       where t.driver_id = p_driver_id
         and (
           case when v_basis.commission_basis = 'paid'
                then t.payout_id in (
                       select p.id from public.commission_payouts p
                        where p.driver_id = p_driver_id and p.paid_at is not null
                          and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start)
                else t.stage = 'delivered' and t.payout_id is null
                     and date_trunc('month', t.trip_date)::date = p_period_start
           end)
    ), jsonb_build_object('count', 0)),
    'issued_from', 'v_driver_payslip_basis'
  ) into v_snap;

  insert into public.driver_payslips (
    payslip_number, driver_id, period_start, issued_by,
    commission_basis, commission_settled,
    base_salary_sar, commission_sar, specials_sar, adjustments_sar, bonus_sar,
    deductions_sar, net_sar, snapshot
  ) values (
    v_number, p_driver_id, p_period_start, p_actor,
    v_basis.commission_basis, v_basis.commission_settled,
    v_basis.base_salary_sar, v_basis.commission_sar, v_basis.specials_sar,
    v_basis.adjustments_sar, v_basis.bonus_sar,
    v_deductions,
    -- READS the view's net and applies the deduction. Does NOT re-add the
    -- components — that sum now exists in exactly one place (0118).
    v_basis.net_sar - v_deductions,
    v_snap
  ) returning * into v_row;

  insert into public.driver_payslip_payouts (payslip_id, payout_id)
  select v_row.id, p.id
    from public.commission_payouts p
   where p.driver_id = p_driver_id
     and p.paid_at is not null
     and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start;

  return v_row;
end;
$$;

comment on function public.issue_driver_payslip(uuid, date, text) is
  'Issues (freezes) a driver payslip for a completed month and assigns its '
  'gap-free number. Reads v_driver_payslip_basis — the same view the preview '
  'reads — so the document equals what was on screen, and since 0118 it reads '
  'that view''s net_sar rather than re-adding the components, so net pay has '
  'exactly one definition. Refuses a running month, a duplicate, a driver not '
  'on the payroll that month, and a driver with no hire date. Writes no '
  'commission math: every figure is read from an existing source.';

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. The view was REPLACED, so it lost its reloptions:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.v_driver_payslip_basis','select') as anon,
--             has_table_privilege('authenticated','public.v_driver_payslip_basis','select') as auth
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_driver_payslip_basis';
--      -- expect {security_invoker=true}, anon false, auth true.
--
--    And exactly ONE signature of the RPC, still DEFINER with search_path:
--      select p.proname, p.prosecdef, p.proconfig,
--             count(*) over (partition by p.proname) as signatures
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname = 'issue_driver_payslip';
--      -- expect 1 row: prosecdef true, {search_path=public}, signatures 1.
--
-- B) APPEND-ONLY. 1-17 unchanged, 18 new:
--      select ordinal_position, column_name
--        from information_schema.columns
--       where table_schema='public' and table_name='v_driver_payslip_basis'
--       order by ordinal_position;
--      -- expect 16 terminated, 17 termination_date, 18 net_sar.
--
-- C) NO EXISTING FIGURE MOVED. Capture BEFORE applying:
--      select period_start, driver_id, base_salary_sar, commission_basis,
--             commission_sar, specials_sar, adjustments_sar, bonus_sar,
--             terminated, hire_date_missing
--        from public.v_driver_payslip_basis order by period_start, driver_id;
--    Re-run the IDENTICAL query after and diff. Every value must match — this
--    appends a computed column and changes no input.
--
-- D) THE TWO ISSUED PAYSLIPS ARE UNTOUCHED. They are frozen rows; this file
--    does not write to driver_payslips, and if either moves something is very
--    wrong:
--      select payslip_number, base_salary_sar, commission_sar, specials_sar,
--             adjustments_sar, bonus_sar, deductions_sar, net_sar
--        from public.driver_payslips order by payslip_number;
--      -- expect PS-2026-000001 and PS-2026-000002 EXACTLY as before.
--
-- E) THE VIEW'S net_sar EQUALS WHAT THE OLD EXPRESSION PRODUCED. Expect 0 rows:
--      select period_start, driver_name, net_sar,
--             base_salary_sar + commission_sar + specials_sar
--               + adjustments_sar + bonus_sar as recomputed
--        from public.v_driver_payslip_basis
--       where net_sar <> base_salary_sar + commission_sar + specials_sar
--                        + adjustments_sar + bonus_sar;
--
-- F) AND IT AGREES WITH THE ALREADY-ISSUED DOCUMENTS. For each issued payslip,
--    the frozen net must equal what the view would produce for that
--    driver+month today, minus its deductions. Expect 0 rows:
--      select ps.payslip_number, ps.net_sar as frozen,
--             b.net_sar - ps.deductions_sar as from_view
--        from public.driver_payslips ps
--        join public.v_driver_payslip_basis b
--          on b.driver_id = ps.driver_id and b.period_start = ps.period_start
--       where ps.net_sar <> b.net_sar - ps.deductions_sar;
--      -- A row here means the freeze and the preview disagree, which is the
--      -- exact condition this migration exists to make impossible. Note it
--      -- can also legitimately fire if a salary changed since issue — check
--      -- base_salary_sar against the slip's snapshot->>'salary_at_issue'
--      -- before concluding the refactor is at fault.
--
-- G) A REAL ISSUE STILL WORKS, rolled back — proves the RPC's new read path:
--      begin;
--        select payslip_number, base_salary_sar, commission_sar, net_sar,
--               deductions_sar
--          from public.issue_driver_payslip(
--                 (select driver_id from public.v_driver_payslip_basis
--                   where period_start = date '2026-06-01'
--                     and not hire_date_missing
--                     and issued_payslip_id is null limit 1),
--                 date '2026-06-01', 'verify@aquafleet');
--      rollback;
--      -- expect one row, net_sar equal to that driver's view net_sar, and
--      -- deductions_sar 0. Then confirm the counter rolled back too:
--      --   select * from public.payslip_number_counter where year = 2026;
--
-- H) THE GUARDS STILL REFUSE. None of them were touched, but the function was
--    recreated, so prove they survived:
--      begin;
--        select public.issue_driver_payslip(
--          (select id from public.drivers where hire_date is null limit 1),
--          date '2026-06-01', 'verify@aquafleet');
--      rollback;
--      -- expect 23514 'This driver has no hire date...'
--      begin;
--        select public.issue_driver_payslip(
--          (select driver_id from public.v_driver_payslip_basis
--            where not hire_date_missing limit 1),
--          date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date,
--          'verify@aquafleet');
--      rollback;
--      -- expect 23514 'That month has not finished yet...'
-- ===========================================================================
