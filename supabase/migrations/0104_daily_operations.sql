-- 0104_daily_operations.sql
-- The DAY grain for the semantic layer: daily revenue vs daily DIRECT cost.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- The Dashboard's "Revenue vs cost" chart is monthly. Turki asked for daily
-- performance across a monthly period. There was no day-grain object in the
-- layer, and the Dashboard is forbidden from deriving one in TypeScript, so
-- the fix is a migration rather than a join added to the page.
--
-- ===========================================================================
-- THE DECISION THIS FILE ENCODES, AND WHAT IT COSTS
-- ===========================================================================
-- A full daily P&L IS NOT POSSIBLE from this data, and pretending otherwise
-- would have been the whole bug. Measured live before drafting:
--
--   month     operating_cost   payroll     payroll as % of cost
--   2026-06      36,388.00     36,000.00        98.9%
--   2026-07      56,158.97     37,800.00        67.3%
--   2026-08      41,812.50     31,300.00        74.9%
--
-- Payroll has NO daily source. It is staff.monthly_salary_sar and
-- drivers.salary_sar — monthly figures with no per-day event behind them.
-- Commission specials, adjustments and bonuses are keyed by a text month_key
-- ('YYYY-MM') for the same reason. Spreading either evenly across days would
-- invent a number that no row in this database supports.
--
-- So this file measures DIRECT cost only — the three cost sources that carry
-- a real per-day stamp — and names it `direct_cost_sar`, never `cost`:
--
--   parts consumption   FIFO ledgers, stamped at consumption
--   outsourced payments workshop_payments, by the P&L's own date rule
--   trip commissions    delivered trips, by trip_date
--
-- WHAT IS DELIBERATELY EXCLUDED, and how the UI is kept honest about it:
-- v_monthly_only_costs reports the exact excluded riyals per month, so the
-- chart can state the gap as a NUMBER instead of a vague disclaimer. Live,
-- that gap is the majority of cost every month. A reader who sees only
-- `direct_cost_sar` and thinks "cost" will conclude the business is wildly
-- profitable. The UI must label this line "Direct cost" and show the
-- monthly-only figure beside it. That is not a nicety; it is the condition
-- under which this view is safe to render at all.
--
-- ===========================================================================
-- REVENUE AT DAY GRAIN IS INVOICING DAY, NOT WORK DAY
-- ===========================================================================
-- Revenue is defined ONCE, in 0098: confirmed, non-voided invoices, net of
-- VAT, bucketed by confirmed_at. This file does NOT redefine it — it reads
-- v_revenue_invoices, the same rows the monthly view reads, and buckets them
-- one level finer. Sum of days therefore equals the month EXACTLY, by
-- construction, and the verification block below proves it.
--
-- The consequence, and it is visible immediately: revenue lands on the day an
-- invoice was CONFIRMED, not on the days the trips ran. Live, all 70,650 SAR
-- of confirmed revenue sits in July across 8 days, with a single 40,800 SAR
-- invoice on 2026-07-27; June and August have none at all. The daily chart
-- will show spikes, not a smooth line, and the current month (August) will
-- show zero revenue against real daily cost.
--
-- That is the true shape of this business's invoicing, and it is preferable
-- to the alternative — pricing delivered trips off projects.rate_per_trip_sar
-- to manufacture a smooth "daily revenue" — which would create a SECOND
-- definition of revenue that disagrees with Reports. trips.rate_sar is NULL
-- on all 203 rows (0098, limitation B), so there is no honest per-trip
-- revenue to use anyway.
--
-- ===========================================================================
-- WHY v_parts_consumption IS TOUCHED, AND WHY THAT IS SAFE
-- ===========================================================================
-- Parts cost is the one direct source with no day-grain object: 0098 defined
-- v_parts_consumption already aggregated to month. Restating its union in a
-- new daily view would have created a SECOND definition of parts cost, which
-- is exactly what the semantic layer exists to prevent.
--
-- Instead the definition MOVES DOWN one level: v_parts_consumption_daily is
-- now the base (same three branches, same predicates, same stamped prices,
-- byte-for-byte the 0098 logic with `::date` where `date_trunc('month', ...)`
-- stood), and v_parts_consumption is replaced by a thin month-grain roll-up
-- over it. Its column list, order, types and OUTPUT ROWS are unchanged.
--
-- Verified live before drafting rather than assumed:
--   rows_now = 18, rows_after_regroup = 18
-- i.e. re-aggregating at its own key collapses nothing, so the two existing
-- consumers — v_parts_cost_monthly (0098) and v_maintenance_cost_per_truck_
-- monthly (0099), both of which group by month anyway — see an identical
-- relation. No app code reads v_parts_consumption directly (grepped).
-- The verification block below re-proves this AFTER apply, per month/truck/
-- part, not just as a row count.
--
-- ===========================================================================
-- SECURITY
-- ===========================================================================
-- Every view here is security_invoker = true, granted to authenticated,
-- revoked from anon — the rule 0098 set and 0103 followed.
--
-- NOTE for a reset replay: `create or replace view` does NOT preserve
-- reloptions, so v_parts_consumption's security_invoker is restated in the
-- footer even though it is also inline. The footer covers ALL FOUR views and
-- sits after the last create, so this file is self-sufficient on replay.
--
-- READ-ONLY BY CONSTRUCTION. Four views and four dictionary rows. No table,
-- column, constraint, policy, RPC or row of operational data is altered.
-- Nothing here touches lib/prepaid.ts's world: no invoice, top-up, ledger or
-- FIFO lot is read for anything other than SELECT.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) PARTS CONSUMPTION AT DAY GRAIN — the definition, moved down a level.
-- ---------------------------------------------------------------------
-- Identical to 0098's v_parts_consumption in every predicate. The ONLY
-- change is the bucket: `c.created_at::date` where it read
-- `date_trunc('month', c.created_at)::date`. Both evaluate in the same
-- session timezone, so truncating the day to a month reproduces the old
-- bucket exactly.
create or replace view public.v_parts_consumption_daily
with (security_invoker = true) as
  -- Maintenance, from the per-lot ledger.
  select 'maintenance'::text as source,
         c.created_at::date  as day,
         w.truck_id,
         wp.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end) as qty,
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end) as cost_sar,
         'ledger'::text as basis
    from public.work_order_part_consumptions c
    join public.work_order_parts wp on wp.id = c.work_order_part_id
    join public.work_orders w       on w.id  = wp.work_order_id
   group by 1, 2, 3, 4
  union all
  -- Maintenance, PRE-LEDGER: deducted before the ledger existed. Same stamped
  -- unit price, read from the parent row. See 0098 rule 5 — dropping this
  -- understates July parts cost by 72%.
  select 'maintenance', w.inventory_deducted_at::date,
         w.truck_id, wp.part_id,
         wp.qty, wp.qty * wp.unit_price_sar, 'line'
    from public.work_order_parts wp
    join public.work_orders w on w.id = wp.work_order_id
   where w.inventory_deducted_at is not null
     and not exists (select 1 from public.work_order_part_consumptions c
                      where c.work_order_part_id = wp.id)
  union all
  -- Exit permits, from their own per-lot ledger. No truck: a permit's
  -- destination may be a truck but the parts are not maintenance on it.
  select 'exit_permit', c.created_at::date,
         null::uuid, l.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end),
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end),
         'ledger'
    from public.exit_permit_line_consumptions c
    join public.exit_permit_lines l on l.id = c.exit_permit_line_id
   group by 2, 4;

comment on view public.v_parts_consumption_daily is
  'Parts consumed (FIFO cost), one row per source/day/truck/part. This is the '
  'BASE definition as of 0104; v_parts_consumption rolls it up to the month '
  'rather than defining the same maths a second time.';

-- ---------------------------------------------------------------------
-- 2) v_parts_consumption — now a roll-up, not a definition.
-- ---------------------------------------------------------------------
-- Same seven columns, same order, same types, same rows. Downstream
-- (v_parts_cost_monthly, v_maintenance_cost_per_truck_monthly, v_pnl_monthly
-- through them) is untouched by design and re-proven by the checks below.
create or replace view public.v_parts_consumption
with (security_invoker = true) as
  select d.source,
         date_trunc('month', d.day)::date as month,
         d.truck_id,
         d.part_id,
         sum(d.qty)      as qty,
         sum(d.cost_sar) as cost_sar,
         d.basis
    from public.v_parts_consumption_daily d
   group by d.source, date_trunc('month', d.day)::date, d.truck_id, d.part_id, d.basis;

comment on view public.v_parts_consumption is
  'Parts consumed (FIFO cost) per month/source/truck/part. Unchanged in shape '
  'since 0098; as of 0104 it composes on v_parts_consumption_daily so the '
  'month and day grains cannot drift apart.';

-- ---------------------------------------------------------------------
-- 3) THE DAY GRAIN — revenue vs direct cost.
-- ---------------------------------------------------------------------
-- Every component below reads either an existing view or the SAME predicate
-- the corresponding monthly view uses, one bucket finer. The verification
-- block asserts each one sums back to its monthly counterpart for every
-- month; if any of them ever stops reconciling, this view is wrong, not the
-- monthly one.
create or replace view public.v_daily_operations
with (security_invoker = true) as
  with spine as (
    -- Same lower bound as the month spine, so the two calendars start
    -- together. Upper bound is TODAY, never the end of the month: a chart of
    -- the current month must not render future days as zero-revenue days.
    -- greatest() of the UTC and Riyadh dates so the evening 3-hour window
    -- where they disagree cannot hide today from a Riyadh user.
    select generate_series(
             (select min(month) from public.v_report_months),
             greatest(current_date, (now() at time zone 'Asia/Riyadh')::date),
             interval '1 day'
           )::date as day
  ),
  revenue as (
    -- The SAME rows v_revenue_monthly reads, bucketed by day. Not a second
    -- revenue definition: confirmed-and-not-voided, net of VAT, all decided
    -- in 0098 and inherited here.
    select r.confirmed_at::date as day,
           sum(r.revenue_sar)   as revenue_sar,
           count(*)             as invoice_count
      from public.v_revenue_invoices r
     group by 1
  ),
  parts as (
    select p.day, sum(p.cost_sar) as parts_cost_sar
      from public.v_parts_consumption_daily p
     group by 1
  ),
  outsourced as (
    -- coalesce(invoice_date, created_at::date) is the P&L's own date rule
    -- (v_os_cost_monthly, and again in 0099). A different rule here would
    -- silently move money between days AND break the monthly reconciliation.
    select coalesce(wp.invoice_date, wp.created_at::date) as day,
           sum(wp.grand_total_sar) as os_cost_sar
      from public.workshop_payments wp
     group by 1
  ),
  commissions as (
    -- Accrual, matching 0098 rule 6: earned on the trip's own date. Specials,
    -- adjustments and bonuses are month_key-only and are excluded here on
    -- purpose — they appear in v_monthly_only_costs instead.
    select t.trip_date as day, sum(t.commission_sar) as trip_commission_sar
      from public.trips t
     where t.stage = 'delivered'
     group by 1
  ),
  manual_expenses as (
    -- Carried as its OWN column, never folded into direct_cost_sar. 0098
    -- rule 8 keeps manual expenses a separate P&L section, and the daily
    -- view keeps that separation rather than quietly blending it away.
    select e.expense_date as day, sum(e.amount_sar) as expenses_sar
      from public.expenses e
     group by 1
  ),
  activity as (
    select t.trip_date as day,
           count(*)                                     as trips_total,
           count(*) filter (where t.stage = 'delivered') as trips_delivered
      from public.trips t
     group by 1
  )
  select s.day,
         date_trunc('month', s.day)::date          as month,
         coalesce(rv.revenue_sar, 0)               as revenue_sar,
         coalesce(rv.invoice_count, 0)::int        as invoice_count,
         coalesce(pa.parts_cost_sar, 0)            as parts_cost_sar,
         coalesce(os.os_cost_sar, 0)               as os_cost_sar,
         coalesce(cm.trip_commission_sar, 0)       as trip_commission_sar,
         ( coalesce(pa.parts_cost_sar, 0)
         + coalesce(os.os_cost_sar, 0)
         + coalesce(cm.trip_commission_sar, 0) )   as direct_cost_sar,
         ( coalesce(rv.revenue_sar, 0)
         - coalesce(pa.parts_cost_sar, 0)
         - coalesce(os.os_cost_sar, 0)
         - coalesce(cm.trip_commission_sar, 0) )   as direct_margin_sar,
         coalesce(ex.expenses_sar, 0)              as expenses_sar,
         coalesce(ac.trips_total, 0)::int          as trips_total,
         coalesce(ac.trips_delivered, 0)::int      as trips_delivered
    from spine s
    left join revenue         rv on rv.day = s.day
    left join parts           pa on pa.day = s.day
    left join outsourced      os on os.day = s.day
    left join commissions     cm on cm.day = s.day
    left join manual_expenses ex on ex.day = s.day
    left join activity        ac on ac.day = s.day;

comment on view public.v_daily_operations is
  'One row per calendar day, from the first month of activity to today. '
  'revenue_sar is the SAME measure as v_revenue_monthly, bucketed by the day '
  'the invoice was confirmed — so it is INVOICING day, not work day, and it '
  'is lumpy by nature. direct_cost_sar is parts + outsourced + trip '
  'commissions ONLY: payroll and non-trip commission have no daily source and '
  'are reported per month by v_monthly_only_costs. direct_margin_sar is '
  'therefore NOT profit and must never be labelled as such. Manual expenses '
  'are a separate column, never inside direct_cost_sar (0098 rule 8).';

-- ---------------------------------------------------------------------
-- 4) WHAT THE DAY GRAIN CANNOT SEE — stated as a number, per month.
-- ---------------------------------------------------------------------
-- Composes on the existing monthly views; defines no new maths. One row per
-- month, deliberately: a per-day copy of a monthly figure would invite
-- summing it 30 times.
create or replace view public.v_monthly_only_costs
with (security_invoker = true) as
  select m.month,
         (y.staff_salary_sar + y.driver_salary_sar)             as payroll_sar,
         (c.specials_sar + c.adjustments_sar + c.bonus_sar)     as commission_non_trip_sar,
         ( y.staff_salary_sar + y.driver_salary_sar
         + c.specials_sar + c.adjustments_sar + c.bonus_sar )   as monthly_only_cost_sar,
         y.people_missing_salary,
         y.salary_is_current_snapshot
    from public.v_report_months      m
    join public.v_payroll_monthly    y using (month)
    join public.v_commissions_monthly c using (month);

comment on view public.v_monthly_only_costs is
  'The cost a daily chart cannot show, per month, as an exact figure. '
  'Payroll is monthly by source (staff.monthly_salary_sar, drivers.salary_sar) '
  'and commission specials/adjustments/bonus are keyed by a text month_key. '
  'Identity, checkable: sum(v_daily_operations.direct_cost_sar) over a month '
  '+ monthly_only_cost_sar = v_pnl_monthly.operating_cost_sar. Any UI drawing '
  'daily cost must show this beside it.';

-- ---------------------------------------------------------------------
-- 5) DICTIONARY — the half a human or an agent reads.
-- ---------------------------------------------------------------------
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('daily_revenue',
   'Revenue (daily)',
   'Revenue for a single day — the same measure as monthly revenue, on a finer calendar.',
   'Sum of grand_subtotal_sar over confirmed, non-voided invoices, bucketed by the DAY confirmed_at falls on. Read from v_revenue_invoices, so it is the same rows as v_revenue_monthly and sums back to it exactly.',
   'SAR', 'one day', 'v_daily_operations', 'accrual',
   'This is INVOICING day, not work day. Revenue lands on the day an invoice was confirmed, not across the days its trips ran, so the daily series is lumpy by nature — live, one invoice puts 40,800 SAR on a single day. Days with no invoicing read 0 and that is correct, not missing data.'),

  ('daily_direct_cost',
   'Direct cost (daily)',
   'The part of operating cost that can honestly be attributed to a single day.',
   'Parts consumed at FIFO cost (v_parts_consumption_daily) + outsourced workshop payments by coalesce(invoice_date, created_at) + commission earned on trips delivered that day.',
   'SAR', 'one day', 'v_daily_operations', 'accrual',
   'NOT the same measure as operating_cost. It EXCLUDES payroll and commission specials/adjustments/bonus, which have no daily source at all — payroll alone was 67-99% of operating cost in every month measured. Never present this as "cost" without showing monthly_only_cost beside it.'),

  ('daily_direct_margin',
   'Direct margin (daily)',
   'Daily revenue minus the cost that has a daily source. A contribution figure, not profit.',
   'daily_revenue - daily_direct_cost, computed per day in SQL.',
   'SAR', 'one day', 'v_daily_operations', 'accrual',
   'NOT profit and never to be labelled as such: it is measured before payroll, non-trip commission and manual expenses. It will look far healthier than the real operating margin, because most cost is missing from it by construction.'),

  ('monthly_only_cost',
   'Cost with no daily source',
   'How much cost a daily view cannot see, for the month.',
   'Payroll (staff.monthly_salary_sar + drivers.salary_sar over the employment window) + approved commission specials, adjustments and bonus, all of which are monthly by source.',
   'SAR', 'one month', 'v_monthly_only_costs', 'accrual',
   'Exists so a daily chart can state its own blind spot as a number instead of a disclaimer. Never divide it across days — no row in this database supports a per-day split. Payroll also carries 0098 limitation A: the amount is each person''s CURRENT salary, only the employment window is historical.')
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

-- ---------------------------------------------------------------------
-- 6) SECURITY — all four views. Restated here because `create or replace
--    view` does not preserve reloptions, and this file must be correct on a
--    reset replay, not only on first apply.
-- ---------------------------------------------------------------------
alter view public.v_parts_consumption_daily set (security_invoker = true);
alter view public.v_parts_consumption       set (security_invoker = true);
alter view public.v_daily_operations        set (security_invoker = true);
alter view public.v_monthly_only_costs      set (security_invoker = true);

revoke all on public.v_parts_consumption_daily from anon;
revoke all on public.v_parts_consumption       from anon;
revoke all on public.v_daily_operations        from anon;
revoke all on public.v_monthly_only_costs      from anon;

grant select on public.v_parts_consumption_daily to authenticated;
grant select on public.v_parts_consumption       to authenticated;
grant select on public.v_daily_operations        to authenticated;
grant select on public.v_monthly_only_costs      to authenticated;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) SECURITY GATE. All four must report security_invoker=true:
--      select c.relname, c.reloptions
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--         and c.relname in ('v_parts_consumption_daily','v_parts_consumption',
--                           'v_daily_operations','v_monthly_only_costs');
--      -- v_parts_consumption is the one to check hardest: it was REPLACED,
--      -- and a replace drops reloptions.
--
--    anon must not read any of them (expect false x4):
--      select has_table_privilege('anon','public.v_daily_operations','select'),
--             has_table_privilege('anon','public.v_parts_consumption','select'),
--             has_table_privilege('anon','public.v_parts_consumption_daily','select'),
--             has_table_privilege('anon','public.v_monthly_only_costs','select');
--
-- B) v_parts_consumption IS UNCHANGED. Not a row count — a full symmetric
--    difference against what 0098 produced. Expect ZERO rows:
--      with rebuilt as (
--        select source, month, truck_id, part_id, qty, cost_sar, basis
--          from public.v_parts_consumption
--      ), original as (
--        select 'maintenance'::text as source,
--               date_trunc('month', c.created_at)::date as month,
--               w.truck_id, wp.part_id,
--               sum(case when c.direction='consume' then c.qty else -c.qty end) as qty,
--               sum(case when c.direction='consume' then c.qty*c.unit_price_sar
--                        else -c.qty*c.unit_price_sar end) as cost_sar,
--               'ledger'::text as basis
--          from public.work_order_part_consumptions c
--          join public.work_order_parts wp on wp.id = c.work_order_part_id
--          join public.work_orders w on w.id = wp.work_order_id
--         group by 1,2,3,4
--        union all
--        select 'maintenance', date_trunc('month', w.inventory_deducted_at)::date,
--               w.truck_id, wp.part_id, wp.qty, wp.qty*wp.unit_price_sar, 'line'
--          from public.work_order_parts wp
--          join public.work_orders w on w.id = wp.work_order_id
--         where w.inventory_deducted_at is not null
--           and not exists (select 1 from public.work_order_part_consumptions c
--                            where c.work_order_part_id = wp.id)
--        union all
--        select 'exit_permit', date_trunc('month', c.created_at)::date,
--               null::uuid, l.part_id,
--               sum(case when c.direction='consume' then c.qty else -c.qty end),
--               sum(case when c.direction='consume' then c.qty*c.unit_price_sar
--                        else -c.qty*c.unit_price_sar end),
--               'ledger'
--          from public.exit_permit_line_consumptions c
--          join public.exit_permit_lines l on l.id = c.exit_permit_line_id
--         group by 2,4
--      )
--      select 'only_in_new' as side, * from (select * from rebuilt except all select * from original) a
--      union all
--      select 'only_in_old', * from (select * from original except all select * from rebuilt) b;
--      -- expect 0 rows. Anything here means downstream P&L moved.
--
--    And the figure that actually matters downstream — expect 0 rows:
--      select p.month, p.parts_cost_sar, l.month, l.parts_cost_sar
--        from public.v_parts_cost_monthly p
--        full join (select date_trunc('month', day)::date as month,
--                          sum(cost_sar) as parts_cost_sar
--                     from public.v_parts_consumption_daily group by 1) l
--          on l.month = p.month
--       where coalesce(p.parts_cost_sar,0) <> coalesce(l.parts_cost_sar,0);
--
-- C) THE ROLL-UP GUARANTEE. Daily must sum to monthly for EVERY month, on
--    every component. Expect 0 rows:
--      select d.month, d.revenue_sar, r.revenue_sar,
--             d.parts_cost_sar, p.parts_cost_sar,
--             d.os_cost_sar, o.os_cost_sar,
--             d.trip_commission_sar, c.trip_commission_sar
--        from (select month,
--                     sum(revenue_sar)         as revenue_sar,
--                     sum(parts_cost_sar)      as parts_cost_sar,
--                     sum(os_cost_sar)         as os_cost_sar,
--                     sum(trip_commission_sar) as trip_commission_sar
--                from public.v_daily_operations group by month) d
--        join public.v_revenue_monthly     r using (month)
--        join public.v_parts_cost_monthly  p using (month)
--        join public.v_os_cost_monthly     o using (month)
--        join public.v_commissions_monthly c using (month)
--       where d.revenue_sar         <> r.revenue_sar
--          or d.parts_cost_sar      <> p.parts_cost_sar
--          or d.os_cost_sar         <> o.os_cost_sar
--          or d.trip_commission_sar <> c.trip_commission_sar;
--      -- If this ever returns a row, the Dashboard is disagreeing with
--      -- Reports about the same figure. That is the failure this whole
--      -- layer exists to make impossible.
--
-- D) THE COST IDENTITY. Direct + monthly-only must reconstruct operating
--    cost exactly. Expect 0 rows:
--      select d.month, d.direct, k.monthly_only_cost_sar, pl.operating_cost_sar
--        from (select month, sum(direct_cost_sar) as direct
--                from public.v_daily_operations group by month) d
--        join public.v_monthly_only_costs k using (month)
--        join public.v_pnl_monthly       pl using (month)
--       where d.direct + k.monthly_only_cost_sar <> pl.operating_cost_sar;
--
--    Manual expenses stay outside both (0098 rule 8) — expect 0 rows:
--      select d.month, d.expenses_sar, e.expenses_sar
--        from (select month, sum(expenses_sar) as expenses_sar
--                from public.v_daily_operations group by month) d
--        join public.v_expenses_monthly e using (month)
--       where d.expenses_sar <> e.expenses_sar;
--
-- E) SHAPE. Spine covers every day with no gaps and stops at today:
--      select count(*) as days, min(day), max(day),
--             count(*) filter (where revenue_sar > 0) as days_with_revenue
--        from public.v_daily_operations;
--      -- expect min = 2026-06-01, max = today (Riyadh), days = the exact
--      -- difference + 1, days_with_revenue = 8 on today's data.
--
-- F) WHAT THE CHART WILL ACTUALLY SHOW — read this before wiring the UI:
--      select month,
--             sum(revenue_sar)     as revenue,
--             sum(direct_cost_sar) as direct_cost
--        from public.v_daily_operations group by month order by month;
--      select month, monthly_only_cost_sar from public.v_monthly_only_costs
--       order by month;
--      -- On today's data August has ZERO revenue and ~10,512 SAR of direct
--      -- cost against 31,300 SAR of payroll it cannot see. The current-month
--      -- chart is therefore mostly empty and mostly blind. That is the data,
--      -- not a bug — but it is the reason the monthly-only figure has to be
--      -- on screen next to it.
-- ===========================================================================
