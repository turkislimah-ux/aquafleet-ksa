-- 0116_driver_commission_by_project.sql
-- The commission review table's grain, and the one flag the payslip register
-- needs to label a terminated driver.
--
-- APPLIED AND VERIFIED (architect, 2026-08-15). Committed after apply, per the
-- reset incident in CLAUDE.md section 7: a migration that is applied but
-- uncommitted is exactly what a replay drops.
--
-- Verification at apply: column order preserved (terminated=16,
-- termination_date=17, no 42P16), both views security_invoker + anon-locked,
-- the review view reconciles to v_commissions_monthly to the riyal
-- (Jun 428.00 / Jul 2,226.02 / Aug 12,912.52, diff 0 at every month), all 10
-- NULL-hire rows flag terminated=true, payslip preview figures unmoved
-- (d4f3fed1 Jul still 204.00), and the two bases differ for 2 July drivers —
-- so the label distinction the UI draws is a real one, not a decorative one.
--
-- ===========================================================================
-- WHY THIS FILE EXISTS AT ALL — I WAS TOLD TO STOP RATHER THAN ADD IT
-- ===========================================================================
-- The instruction was: if the review table needs a figure that is not cleanly
-- available from existing views/columns without a schema change, STOP and flag
-- it. It does, twice, so this was the flag — drafted rather than described,
-- because a file you can read and run is a better handover than a paragraph
-- asking for one.
--
-- WHAT IS MISSING, MEASURED:
--
-- 1. NO VIEW CARRIES DRIVER x WORK-MONTH x PROJECT COMMISSION. Checked every
--    view in public: exactly one has both driver_id and a commission column,
--    and it is v_driver_payslip_basis — which is SETTLEMENT-month by design and
--    is the very figure this table must not be confused with.
--    v_operations_by_driver_monthly has the driver grain but no commission and
--    no project split; v_commissions_monthly has commission but is fleet-level.
--
-- 2. v_driver_payslip_basis CANNOT SAY WHO IS TERMINATED. It exposes
--    hire_date_missing and salary_missing, not employment status. A terminated
--    driver simply stops appearing after his termination month — inside the
--    window he is indistinguishable from an active one. The ruling that
--    "terminated outranks no-hire-date" therefore cannot be implemented in the
--    UI today: the UI has no way to know.
--
-- Reading public.trips directly from the page would answer both and is the
-- thing 0098 exists to prevent — a metric defined on the page instead of in
-- SQL, free to disagree with the P&L's own commission line. So: a view.
--
-- ===========================================================================
-- THE RESOLVED QUESTION — DELIVERED TRIPS ONLY
-- ===========================================================================
-- Asked, and answered from the data rather than by preference:
--
--   stage        trips   with commission   commission total
--   delivered      730               730          15,566.54
--   in_transit      26                 0               0.00
--   loading         16                 0               0.00
--   scheduled       45                 0               0.00
--
-- COMMISSION ONLY EXISTS ON DELIVERED TRIPS. The engine stamps commission_sar
-- at delivery and clears it on any move out of delivered, so the MONEY figure
-- is identical whichever way this is filtered — only the COUNTS move.
--
-- Delivered-only is chosen for three reasons:
--   · "What the driver earned" is earnings, and a scheduled trip has earned
--     nothing. Counting it beside an earnings total implies unpaid work.
--   · The trip count sits next to the money in the same row. Counting 45 trips
--     that contributed 0.00 would make every per-trip reading wrong.
--   · v_commissions_monthly — the EXISTING accrual definition, which the P&L
--     reads — already filters stage = 'delivered'. Matching it means this table
--     cannot disagree with the P&L about what trip commission means. Diverging
--     would create a second definition of the same word, which is precisely the
--     drift 0098 forbids.
--
-- NOTE THE DELIBERATE DIFFERENCE FROM THE PAYSLIP. The payslip's EARNED basis
-- also filters payout_id IS NULL, because a settled trip must not be counted
-- twice across documents. This view does NOT: it is the total earned in the
-- work month, paid or not, which is a different question asked on purpose.
-- That is exactly why the surface must label the two tables distinctly.
--
-- ===========================================================================
-- TRIPS WITH NO PROJECT ARE KEPT
-- ===========================================================================
-- project_id is nullable — direct-customer trips have none, and the Kanban
-- already shows them as their own "Direct customer trips" card. They are real
-- work with real commission, so they are grouped under a NULL project_id here
-- rather than dropped by an inner join. The UI names that row; a NULL project
-- name is the UI's job, same convention as the Operations statement's
-- "Unassigned" driver row (0101).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE REVIEW GRAIN: one row per driver per work month per project.
--    The page sums these rows for a driver total — summing view output, the
--    same operation every statement already performs across a period.
-- ---------------------------------------------------------------------------
create or replace view public.v_driver_commission_by_project_monthly
with (security_invoker = true) as
select
  date_trunc('month', t.trip_date)::date        as month,
  t.driver_id,
  d.name                                        as driver_name,
  t.project_id,
  p.name                                        as project_name,
  count(*)::int                                 as trips_delivered,
  coalesce(sum(t.commission_sar), 0)            as commission_sar
from public.trips t
join public.drivers d on d.id = t.driver_id
left join public.projects p on p.id = t.project_id
-- DELIVERED ONLY — see the header. Commission exists nowhere else, and this
-- matches v_commissions_monthly's own predicate so the two cannot drift.
where t.stage = 'delivered'
  and t.driver_id is not null
group by 1, 2, 3, 4, 5;

comment on view public.v_driver_commission_by_project_monthly is
  'What each driver EARNED per project in the month he DROVE the trips — the '
  'work month, not the settlement month. Delivered trips only, because '
  'commission exists on no other stage and v_commissions_monthly filters the '
  'same way. Includes commission already paid out: unlike the payslip''s '
  'earned basis this does NOT filter payout_id IS NULL, because the question '
  'is what was earned, not what is still owed. A NULL project_id is a '
  'direct-customer trip and is kept, not dropped.';

alter view public.v_driver_commission_by_project_monthly set (security_invoker = true);
revoke all on public.v_driver_commission_by_project_monthly from anon;
grant select on public.v_driver_commission_by_project_monthly to authenticated;

-- ---------------------------------------------------------------------------
-- 2. TERMINATION, ON THE PAYSLIP BASIS VIEW.
--    APPENDED, never inserted mid-list: create-or-replace cannot reorder or
--    insert a column (42P16 — the error 0112 hit). Columns 1-15 keep their
--    names, positions and types exactly; 16 and 17 are new.
--
--    Existing order preserved: period_start, driver_id, driver_name,
--    base_salary_sar, salary_missing, hire_date_missing, commission_basis,
--    commission_settled, payout_count, commission_sar, specials_sar,
--    adjustments_sar, bonus_sar, issued_payslip_id, issued_payslip_number.
--    Appended: 16 terminated, 17 termination_date.
--
--    WHY THE UI NEEDS IT: the ruling is that a driver who is BOTH terminated
--    AND missing a hire date must read as TERMINATED — the more important fact
--    outranks the data gap. Both of today's states coincide on the same five
--    people, so without this flag the label cannot be chosen correctly. The
--    ISSUE BLOCK IS UNCHANGED: hire_date_missing still refuses in
--    issue_driver_payslip, and terminated does not become a second refusal —
--    a terminated driver's final month is a legitimate payslip.
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
)
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
  -- APPENDED (0116).
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
       or (d.terminated_at at time zone 'Asia/Riyadh')::date >= m.month);

comment on view public.v_driver_payslip_basis is
  'One row per driver per report month: the salary and commission a payslip '
  'would carry. THE PAGE READS THIS AND NEVER RE-DERIVES IT (0098), and '
  'issue_driver_payslip freezes from this same view so a preview and the '
  'document it becomes cannot disagree. commission_basis is paid when a payout '
  'was SETTLED in the month (by paid_at, Asia/Riyadh) and earned otherwise; on '
  'the earned basis only trips with payout_id IS NULL are counted, which is '
  'what stops a trip appearing on two payslips. Covers ALL drivers including '
  'terminated ones, so history does not vanish. A driver with hire_date IS NULL '
  'is SHOWN with hire_date_missing = true and CANNOT be issued a payslip. '
  '0116 appended terminated/termination_date so the UI can label a terminated '
  'driver as such — that is a LABEL rule only; termination does not block '
  'issue, because a final month is a legitimate payslip.';

alter view public.v_driver_payslip_basis set (security_invoker = true);
revoke all on public.v_driver_payslip_basis from anon;
grant select on public.v_driver_payslip_basis to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY, both views. Expect security_invoker=true and anon=false:
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.'||c.relname,'select') as anon
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public'
--         and c.relname in ('v_driver_commission_by_project_monthly','v_driver_payslip_basis');
--
-- B) COLUMN ORDER PRESERVED on the replaced view — 1-15 unchanged, 16/17 new:
--      select ordinal_position, column_name from information_schema.columns
--       where table_schema='public' and table_name='v_driver_payslip_basis'
--       order by ordinal_position;
--      -- expect 16 terminated, 17 termination_date, and 1-15 exactly as before.
--
-- C) NO PAYSLIP FIGURE MOVED. Capture BEFORE applying:
--      select period_start, driver_id, base_salary_sar, commission_basis,
--             commission_sar, specials_sar, adjustments_sar, bonus_sar
--        from public.v_driver_payslip_basis order by period_start, driver_id;
--    Re-run after and diff. Every value must match — this appends two columns
--    and recomputes nothing. Issued payslips are frozen rows and cannot move
--    regardless, but the PREVIEW must not move either.
--
-- D) THE FLAG IS RIGHT. All five NULL-hire drivers are terminated:
--      select driver_name, period_start, hire_date_missing, terminated, termination_date
--        from public.v_driver_payslip_basis
--       where hire_date_missing order by driver_name, period_start;
--      -- expect 10 rows, terminated = true on every one, dates 2026-07-03/04.
--      -- Any row with terminated = false would break the label ruling.
--
-- E) THE REVIEW TABLE'S OWN FIGURES, Jul 2026 work month:
--      select driver_name, sum(trips_delivered) trips,
--             count(*) projects, sum(commission_sar) earned
--        from public.v_driver_commission_by_project_monthly
--       where month = date '2026-07-01'
--       group by driver_name order by earned desc;
--      -- expect, top rows: Khalid 2  25 trips / 3 projects / 520.30
--      --                   Fahad 2   11 / 3 / 280.00
--      --                   Khalid 1  21 / 1 / 263.00
--
-- F) IT AGREES WITH THE P&L'S OWN COMMISSION LINE. Expect 0 rows — the review
--    table is a different GRAIN of the same money, never a different figure:
--      select c.month, c.trip_commission_sar as pnl, x.review
--        from public.v_commissions_monthly c
--        join lateral (
--          select coalesce(sum(v.commission_sar),0) as review
--            from public.v_driver_commission_by_project_monthly v
--           where v.month = c.month
--        ) x on true
--       where c.trip_commission_sar <> x.review;
--      -- A mismatch means this view drifted from the accrual definition the
--      -- P&L reads — stop, do not ship the table.
--      -- NOTE the one legitimate gap: v_commissions_monthly counts delivered
--      -- trips with NO driver too, while this view requires driver_id (a
--      -- commission with no driver has nobody to review). If this returns rows,
--      -- check that difference FIRST before assuming a real drift:
--      --   select count(*), sum(commission_sar) from public.trips
--      --    where stage='delivered' and driver_id is null;
--
-- G) DIRECT-CUSTOMER TRIPS SURVIVE (no inner join dropped them):
--      select count(*) as rows_with_no_project
--        from public.v_driver_commission_by_project_monthly where project_id is null;
--      -- Whatever the count, these rows must EXIST if any delivered trip has
--      -- no project. Cross-check:
--      --   select count(*) from public.trips
--      --    where stage='delivered' and driver_id is not null and project_id is null;
--
-- H) THE TWO BASES GENUINELY DIFFER — this is the whole reason the surface has
--    to label them. For Jul 2026, work-month earned vs payslip settlement:
--      select b.driver_name,
--             b.commission_basis, b.commission_sar as payslip_figure,
--             coalesce(w.earned,0) as work_month_earned
--        from public.v_driver_payslip_basis b
--        left join lateral (
--          select sum(v.commission_sar) as earned
--            from public.v_driver_commission_by_project_monthly v
--           where v.driver_id = b.driver_id and v.month = b.period_start
--        ) w on true
--       where b.period_start = date '2026-07-01'
--       order by work_month_earned desc;
--      -- The two columns SHOULD disagree for several drivers. If they match
--      -- everywhere, one of the two bases is not doing what it claims.
-- ===========================================================================
