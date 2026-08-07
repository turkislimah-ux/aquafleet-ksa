-- 0098_reports_semantic_layer.sql
-- Reports — the SEMANTIC LAYER: every metric defined ONCE, in SQL.
--
-- ===========================================================================
-- WHAT THIS IS FOR
-- ===========================================================================
-- Both Reports tabs read these views and never re-derive a number in
-- TypeScript. A future AI agent reads the same views plus report_metrics (the
-- dictionary) and therefore cannot disagree with the UI about what "revenue"
-- means. That is the whole point: one definition, many surfaces.
--
-- READ-ONLY BY CONSTRUCTION. Every object here is a VIEW over existing tables,
-- plus TWO new tables that hold data nothing else owns (manual expenses, and
-- the dictionary itself). No view writes. Nothing on the Reports page touches
-- stock, invoices, or any source record.
--
-- ===========================================================================
-- SECURITY — security_invoker, and why it is not optional here
-- ===========================================================================
-- A Postgres view runs as its OWNER by default, which BYPASSES row-level
-- security on the tables underneath it. This database has RLS enabled on 68
-- tables. A default view over invoices/salaries/commissions would be a hole
-- straight through all of it for anyone granted SELECT on the view.
--
-- Every view below is created `with (security_invoker = true)` (PG 15+; this
-- database is 17.6, verified). The caller's own RLS applies exactly as if they
-- had queried the tables directly. SELECT is granted to `authenticated` and
-- explicitly revoked from `anon`.
--
-- These are the FIRST views in this schema — `information_schema.views` for
-- `public` returns zero rows today — so there is no existing convention to
-- match, and this file sets it: every future view gets security_invoker.
--
-- ===========================================================================
-- THE MONEY RULES, AND WHAT THE LIVE DATA FORCED
-- ===========================================================================
-- Each of these was checked against real rows before being written down.
--
-- 1) REVENUE IS ACCRUAL, AND "CONFIRMED" MEANS `confirmed_at IS NOT NULL`,
--    NOT `status = 'confirmed'`. The brief said revenue = confirmed invoices.
--    Taken literally as a status filter that is WRONG here: `paid` invoices
--    were confirmed first and keep their confirmed_at. Live, `status='confirmed'`
--    alone is 5 invoices / 44,100.00 SAR subtotal, while confirmed-or-paid is
--    16 invoices / 70,650.00 SAR. A status filter would have hidden 26,550.00 —
--    38% of revenue. So: confirmed_at is not null AND voided_at is null.
--
-- 2) REVENUE IS NET OF VAT — `grand_subtotal_sar`, not `grand_total_sar`.
--    VAT is a collected liability, not income. Using the total would inflate
--    revenue by exactly 15% and make every margin wrong.
--
-- 3) VOIDED INVOICES ARE EXCLUDED. Four void invoices carry a confirmed_at
--    (28,960 SAR subtotal) — they were confirmed, then voided. 'void' is the
--    stored status the UI labels "Sales Return". Excluding them makes revenue
--    net of returns. They are still visible in their own view
--    (v_revenue_sales_returns) so the figure is never silently dropped.
--
-- 4) PARTS COST = FIFO CONSUMPTION ONLY. PO purchases are NEVER a P&L line —
--    a purchase is inventory until consumed, and expensing both double-counts.
--    The scale of that error, live: parts consumed July+August total 3,544 SAR
--    from the ledgers, while stock RECEIPTS over the same window total
--    204,021.50 SAR. Expensing receipts would overstate cost ~57x. Purchasing
--    appears only in v_purchasing_spend, which is labelled as a CASH/
--    procurement view and is deliberately NOT a P&L input.
--
-- 5) PARTS COST INCLUDES THE PRE-LEDGER FALLBACK, because the Consumption page
--    already does and the two must agree. The maintenance per-lot ledger does
--    not cover its own history: two completed work orders were deducted before
--    it existed. Ledger-only July COGS is 1,374 SAR; the two pre-ledger lines
--    add 3,499.95 — so a ledger-only P&L would understate July parts cost by
--    72%. The fallback reads work_order_parts.qty * unit_price_sar, which is
--    the SAME stamped figure written by the same RPC, not a recomputation.
--
-- 6) COMMISSIONS ARE ACCRUAL, matching revenue. Cost lands in the month the
--    commission was EARNED (trips.commission_sar on delivered trips, by
--    trip_date, plus approved specials/adjustments/bonus by month_key) — not
--    the month it was paid out. commission_payouts drives a separate CASH view
--    (v_commissions_paid_monthly). Summing both would double-count: a payout's
--    base_sar is itself the sum of those trips.
--    Adjustments are SIGNED and are frequently negative (live: -360.00 in June,
--    -100.00 in July) — they are deductions. They are added, not summed by
--    absolute value, so a deduction correctly REDUCES commission cost.
--
-- 7) COLLECTIONS ARE SEPARATE FROM REVENUE, never conflated. v_collections is
--    cash in, at paid_at. Prepaid top-ups are cash in too but are NOT revenue
--    and NOT an invoice payment — they get their own view.
--
-- 8) NON-APP EXPENSES ARE MEASURED SEPARATELY. They are their own P&L section
--    and are never merged into the four operational buckets. v_pnl_monthly
--    exposes operating_profit_sar (before manual expenses) AND net_profit_sar
--    (after), so the effect of whatever has been recorded is always visible
--    rather than blended away.
--
-- ===========================================================================
-- TWO LIMITATIONS, STATED RATHER THAN HIDDEN
-- ===========================================================================
-- A) SALARIES HAVE NO HISTORY. staff.monthly_salary_sar and drivers.salary_sar
--    are CURRENT values with no effective-dating anywhere. Payroll for a past
--    month is therefore today's salary applied to whoever was employed then
--    (hire_date / termination_date DO exist, so the employment window is
--    real). A raise retroactively changes every historical month. The view
--    exposes `salary_is_current_snapshot = true` and a count of people with no
--    salary recorded (3 of 9 staff today) so the UI can say so out loud.
--    Fixing this properly needs an effective-dated salary history table — the
--    same mechanism the deferred commission-rate history needs. Out of scope
--    here; flagged in the dictionary.
--
-- B) REVENUE PER TRUCK IS AN ALLOCATION, not a measured figure.
--    trips.rate_sar is NULL on all 203 rows, so a trip carries no revenue of
--    its own. Revenue reaches a truck only through trips.invoice_id: each
--    invoice's subtotal is split EQUALLY across its linked trips, and each
--    trip carries its share to its truck. Invoices with no linked trips
--    (every voided one, and any charge-only invoice) allocate nothing. The
--    dictionary says this in plain language so nobody reads it as measured.
--
-- ===========================================================================
-- A TRAP THIS FILE AVOIDS, WORTH NAMING
-- ===========================================================================
-- Joining invoices to trips and summing invoice columns FANS OUT: the same
-- invoice total is counted once per linked trip. Checked live — that join
-- reports 63,900 SAR against a true 44,100. Every view here aggregates the
-- invoice grain FIRST and joins after, or divides by the trip count when
-- allocating on purpose.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - Two new tables (expenses, report_metrics), both with RLS + one policy.
--  - N views, all security_invoker, all read-only.
--  - NO existing table, column, constraint, policy, function or row is
--    altered. No RPC is created — expenses are plain authenticated writes,
--    the same call the archive/consumption draft paths already make.
--  - Re-runnable: create table if not exists, create or replace view,
--    drop policy if exists before create policy, dictionary seeded with
--    `on conflict (metric_key) do update`.

begin;

-- ===========================================================================
-- 1) NON-APP EXPENSES — the one thing here that stores rather than derives.
-- ===========================================================================
-- Shape kept deliberately small: what was spent, when, on what, by whom.
--
-- `category` is FREE TEXT, not a lookup table or a CHECK. That mirrors the
-- explicit precedent set for parts.category (Turki's own instruction: a free
-- combo, existing values offered, new ones allowed). A fixed list would be
-- wrong on the day a category nobody predicted is needed, and this table's
-- whole purpose is the costs the app does not model.
--
-- Editable and deletable by design — this is manual bookkeeping, and manual
-- entry means typos. It carries no lifecycle, no approval and no soft-delete,
-- deliberately: it is not an operational document, and a wrong number should
-- be correctable rather than voided-and-reissued.
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  expense_date date        not null,
  category     text        not null check (length(trim(category)) > 0),
  amount_sar   numeric(12, 2) not null check (amount_sar > 0),
  note         text,
  entered_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists expenses_date_idx     on public.expenses (expense_date desc);
create index if not exists expenses_category_idx on public.expenses (category);

alter table public.expenses enable row level security;
drop policy if exists "authenticated_all_expenses" on public.expenses;
create policy "authenticated_all_expenses"
  on public.expenses for all to authenticated using (true) with check (true);

-- ===========================================================================
-- 2) THE METRICS DICTIONARY — plain language, one row per metric.
-- ===========================================================================
-- This is the half of the semantic layer a human or an agent READS. The views
-- carry the maths; this carries the meaning, the grain, and the caveats. If a
-- metric's definition changes, both move together or the layer is lying.
create table if not exists public.report_metrics (
  metric_key   text primary key,
  label        text not null,
  meaning      text not null,   -- plain language, no SQL
  formula      text not null,   -- how it is computed, in words
  unit         text not null check (unit in ('SAR', 'count', 'percent', 'ratio', 'days')),
  grain        text not null,   -- what one row means
  source_view  text not null,
  basis        text not null check (basis in ('accrual', 'cash', 'state', 'operational')),
  caveat       text
);

alter table public.report_metrics enable row level security;
drop policy if exists "authenticated_read_report_metrics" on public.report_metrics;
create policy "authenticated_read_report_metrics"
  on public.report_metrics for select to authenticated using (true);

-- ===========================================================================
-- 3) MONTH SPINE — every view buckets against the same calendar.
-- ===========================================================================
-- Built from the real activity range so an empty month still appears as a
-- zero row rather than vanishing from a report.
create or replace view public.v_report_months
with (security_invoker = true) as
  with bounds as (
    select least(
             coalesce((select min(confirmed_at)::date from public.invoices), current_date),
             coalesce((select min(trip_date)          from public.trips),    current_date),
             coalesce((select min(created_at)::date   from public.work_order_part_consumptions), current_date),
             coalesce((select min(expense_date)       from public.expenses), current_date)
           ) as lo
  )
  select generate_series(
           date_trunc('month', (select lo from bounds)),
           date_trunc('month', current_date),
           interval '1 month'
         )::date as month;

-- ===========================================================================
-- 4) REVENUE (accrual) — the P&L top line.
-- ===========================================================================
create or replace view public.v_revenue_invoices
with (security_invoker = true) as
  select i.id             as invoice_id,
         i.invoice_number,
         i.customer_id,
         c.name           as customer_name,
         date_trunc('month', i.confirmed_at)::date as month,
         i.confirmed_at,
         i.paid_at,
         i.period_start,
         i.period_end,
         i.status,
         i.grand_subtotal_sar as revenue_sar,   -- NET of VAT. See rule 2.
         i.grand_vat_sar      as vat_sar,
         i.grand_total_sar    as gross_sar,
         i.amount_due_sar,
         (i.paid_at is not null) as is_paid
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.confirmed_at is not null      -- rule 1: confirmed OR paid
     and i.voided_at is null;            -- rule 3: sales returns excluded

-- Voided-after-confirmation invoices, kept visible rather than silently
-- dropped from the world.
create or replace view public.v_revenue_sales_returns
with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_number, i.customer_id,
         date_trunc('month', i.voided_at)::date as month,
         i.voided_at, i.void_reason,
         i.grand_subtotal_sar as reversed_revenue_sar
    from public.invoices i
   where i.voided_at is not null
     and i.confirmed_at is not null;

create or replace view public.v_revenue_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(r.revenue_sar), 0)  as revenue_sar,
         coalesce(sum(r.vat_sar), 0)      as vat_sar,
         coalesce(count(r.invoice_id), 0) as invoice_count,
         coalesce(count(distinct r.customer_id), 0) as customer_count
    from public.v_report_months m
    left join public.v_revenue_invoices r on r.month = m.month
   group by m.month;

-- ===========================================================================
-- 5) COLLECTIONS (cash) — never conflated with revenue.
-- ===========================================================================
create or replace view public.v_collections_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(i.grand_total_sar), 0) as collected_gross_sar,
         coalesce(count(i.id), 0)            as invoices_paid
    from public.v_report_months m
    left join public.invoices i
           on date_trunc('month', i.paid_at)::date = m.month
          and i.paid_at is not null
          and i.voided_at is null
   group by m.month;

-- Prepaid top-ups: cash in, but NOT revenue and NOT an invoice payment.
create or replace view public.v_topups_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(t.amount_sar), 0) as topups_sar,
         coalesce(count(t.id), 0)       as topup_count
    from public.v_report_months m
    left join public.customer_topups t
           on date_trunc('month', t.topup_date)::date = m.month
   group by m.month;

-- ===========================================================================
-- 6) RECEIVABLES — state, not a period measure.
-- ===========================================================================
create or replace view public.v_receivables_open
with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_number, i.customer_id,
         c.name as customer_name,
         i.confirmed_at,
         i.period_end,
         i.amount_due_sar as outstanding_sar,
         (current_date - i.confirmed_at::date) as days_outstanding,
         case
           when (current_date - i.confirmed_at::date) <= 30  then '0-30'
           when (current_date - i.confirmed_at::date) <= 60  then '31-60'
           when (current_date - i.confirmed_at::date) <= 90  then '61-90'
           else '90+'
         end as aging_bucket
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.confirmed_at is not null
     and i.paid_at is null
     and i.voided_at is null
     and i.amount_due_sar > 0;

create or replace view public.v_receivables_aging
with (security_invoker = true) as
  select b.aging_bucket,
         coalesce(sum(r.outstanding_sar), 0) as outstanding_sar,
         coalesce(count(r.invoice_id), 0)    as invoice_count
    from (values ('0-30'), ('31-60'), ('61-90'), ('90+')) as b(aging_bucket)
    left join public.v_receivables_open r on r.aging_bucket = b.aging_bucket
   group by b.aging_bucket;

-- ===========================================================================
-- 7) PARTS COST AT CONSUMPTION — the only parts line in the P&L.
-- ===========================================================================
-- Net of returns on both ledgers, PLUS the pre-ledger fallback (rule 5).
-- Grain: one row per consumption event, so the monthly roll-up and the
-- per-truck view share one definition.
create or replace view public.v_parts_consumption
with (security_invoker = true) as
  -- Maintenance, from the per-lot ledger.
  select 'maintenance'::text as source,
         date_trunc('month', c.created_at)::date as month,
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
  -- unit price, read from the parent row. See rule 5.
  select 'maintenance', date_trunc('month', w.inventory_deducted_at)::date,
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
  select 'exit_permit', date_trunc('month', c.created_at)::date,
         null::uuid, l.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end),
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end),
         'ledger'
    from public.exit_permit_line_consumptions c
    join public.exit_permit_lines l on l.id = c.exit_permit_line_id
   group by 2, 4;

create or replace view public.v_parts_cost_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(p.cost_sar), 0)                                          as parts_cost_sar,
         coalesce(sum(p.cost_sar) filter (where p.source = 'maintenance'), 0)  as maintenance_parts_sar,
         coalesce(sum(p.cost_sar) filter (where p.source = 'exit_permit'), 0)  as exit_permit_parts_sar,
         coalesce(sum(p.qty), 0)                                               as qty
    from public.v_report_months m
    left join public.v_parts_consumption p on p.month = m.month
   group by m.month;

-- ===========================================================================
-- 8) OUTSOURCED VENDOR COST.
-- ===========================================================================
create or replace view public.v_os_cost_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(wp.grand_total_sar), 0) as os_cost_sar,
         coalesce(count(wp.id), 0)            as payment_count
    from public.v_report_months m
    left join public.workshop_payments wp
           on date_trunc('month', coalesce(wp.invoice_date, wp.created_at::date))::date = m.month
   group by m.month;

-- ===========================================================================
-- 9) PAYROLL — allocated per month from the employment window.
-- ===========================================================================
-- See limitation A: the AMOUNT is today's salary; only the WINDOW is
-- historical. `people_missing_salary` is exposed so the UI can disclose it.
create or replace view public.v_payroll_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(( select sum(coalesce(s.monthly_salary_sar, 0))
                      from public.staff s
                     where coalesce(s.hire_date, '1900-01-01') <= (m.month + interval '1 month' - interval '1 day')::date
                       and (s.terminated_at is null or s.terminated_at::date >= m.month) ), 0) as staff_salary_sar,
         coalesce(( select sum(coalesce(d.salary_sar, 0))
                      from public.drivers d
                     where coalesce(d.hire_date, '1900-01-01') <= (m.month + interval '1 month' - interval '1 day')::date
                       and (d.terminated_at is null or d.terminated_at::date >= m.month) ), 0) as driver_salary_sar,
         ( select count(*) from public.staff s
            where s.monthly_salary_sar is null
              and (s.terminated_at is null or s.terminated_at::date >= m.month) )
         + ( select count(*) from public.drivers d
              where d.salary_sar is null
                and (d.terminated_at is null or d.terminated_at::date >= m.month) ) as people_missing_salary,
         true as salary_is_current_snapshot
    from public.v_report_months m;

-- ===========================================================================
-- 10) COMMISSIONS — accrual (earned), plus a separate cash view.
-- ===========================================================================
create or replace view public.v_commissions_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(( select sum(t.commission_sar) from public.trips t
                     where t.stage = 'delivered'
                       and date_trunc('month', t.trip_date)::date = m.month ), 0) as trip_commission_sar,
         coalesce(( select sum(cs.amount_sar) from public.commission_specials cs
                     where cs.status = 'approved'
                       and cs.month_key = to_char(m.month, 'YYYY-MM') ), 0)       as specials_sar,
         coalesce(( select sum(ca.amount_sar) from public.commission_adjustments ca
                     where ca.status = 'approved'
                       and ca.month_key = to_char(m.month, 'YYYY-MM') ), 0)       as adjustments_sar,
         coalesce(( select sum(cp.bonus_sar) from public.commission_periods cp
                     where cp.bonus_status = 'approved'
                       and cp.month_key = to_char(m.month, 'YYYY-MM') ), 0)       as bonus_sar
    from public.v_report_months m;

-- CASH counterpart. NEVER add this to the P&L alongside the accrual view —
-- a payout's base_sar is the same trip commission already counted above.
create or replace view public.v_commissions_paid_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(p.total_sar), 0) as commissions_paid_sar,
         coalesce(count(p.id), 0)      as payout_count
    from public.v_report_months m
    left join public.commission_payouts p
           on date_trunc('month', p.paid_at)::date = m.month
          and p.paid_at is not null
   group by m.month;

-- ===========================================================================
-- 11) NON-APP EXPENSES — their own section, never merged.
-- ===========================================================================
create or replace view public.v_expenses_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(e.amount_sar), 0) as expenses_sar,
         coalesce(count(e.id), 0)       as entry_count
    from public.v_report_months m
    left join public.expenses e
           on date_trunc('month', e.expense_date)::date = m.month
   group by m.month;

create or replace view public.v_expenses_by_category
with (security_invoker = true) as
  select date_trunc('month', e.expense_date)::date as month,
         e.category,
         sum(e.amount_sar) as expenses_sar,
         count(*)          as entry_count
    from public.expenses e
   group by 1, 2;

-- ===========================================================================
-- 12) THE P&L — assembled from the views above, nothing recomputed.
-- ===========================================================================
-- operating_profit_sar is BEFORE manual expenses; net_profit_sar is after.
-- Both are exposed so the effect of what has been recorded manually is always
-- visible rather than blended into the operational buckets (rule 8).
create or replace view public.v_pnl_monthly
with (security_invoker = true) as
  select r.month,
         r.revenue_sar,
         p.parts_cost_sar,
         o.os_cost_sar,
         (y.staff_salary_sar + y.driver_salary_sar) as payroll_sar,
         (c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar) as commissions_sar,
         ( p.parts_cost_sar + o.os_cost_sar
           + y.staff_salary_sar + y.driver_salary_sar
           + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
         ) as operating_cost_sar,
         ( r.revenue_sar
           - ( p.parts_cost_sar + o.os_cost_sar
               + y.staff_salary_sar + y.driver_salary_sar
               + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar )
         ) as operating_profit_sar,
         e.expenses_sar,
         ( r.revenue_sar
           - ( p.parts_cost_sar + o.os_cost_sar
               + y.staff_salary_sar + y.driver_salary_sar
               + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar )
           - e.expenses_sar
         ) as net_profit_sar,
         case when r.revenue_sar > 0 then round(
           ( r.revenue_sar
             - ( p.parts_cost_sar + o.os_cost_sar
                 + y.staff_salary_sar + y.driver_salary_sar
                 + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar )
           ) / r.revenue_sar * 100, 1) end as operating_margin_pct
    from public.v_revenue_monthly     r
    join public.v_parts_cost_monthly  p using (month)
    join public.v_os_cost_monthly     o using (month)
    join public.v_payroll_monthly     y using (month)
    join public.v_commissions_monthly c using (month)
    join public.v_expenses_monthly    e using (month);

-- ===========================================================================
-- 13) PER-TRUCK VIEWS.
-- ===========================================================================
-- Revenue per truck is an ALLOCATION (limitation B): each invoice's subtotal
-- split equally across its linked trips. The invoice grain is aggregated
-- BEFORE the join so the total cannot fan out.
create or replace view public.v_revenue_per_truck_monthly
with (security_invoker = true) as
  with inv as (
    select r.invoice_id, r.month, r.revenue_sar,
           (select count(*) from public.trips t where t.invoice_id = r.invoice_id) as trip_count
      from public.v_revenue_invoices r
  )
  select inv.month,
         t.truck_id,
         tr.plate,
         sum(inv.revenue_sar / nullif(inv.trip_count, 0)) as allocated_revenue_sar,
         count(t.id) as trips
    from inv
    join public.trips  t  on t.invoice_id = inv.invoice_id
    join public.trucks tr on tr.id = t.truck_id
   where inv.trip_count > 0
   group by inv.month, t.truck_id, tr.plate;

create or replace view public.v_maintenance_cost_per_truck_monthly
with (security_invoker = true) as
  select p.month,
         p.truck_id,
         tr.plate,
         sum(p.cost_sar) as maintenance_parts_sar,
         count(distinct p.part_id) as distinct_parts
    from public.v_parts_consumption p
    join public.trucks tr on tr.id = p.truck_id
   where p.source = 'maintenance' and p.truck_id is not null
   group by p.month, p.truck_id, tr.plate;

-- ===========================================================================
-- 14) PURCHASING — a CASH/procurement view. NOT a P&L input (rule 4).
-- ===========================================================================
create or replace view public.v_purchasing_spend_monthly
with (security_invoker = true) as
  select m.month,
         coalesce(sum(sr.grand_total_sar), 0) as received_stock_value_sar,
         coalesce(count(sr.id), 0)            as receipt_count
    from public.v_report_months m
    left join public.stock_receipts sr
           on date_trunc('month', sr.received_on)::date = m.month
   group by m.month;

-- ===========================================================================
-- 15) OPERATIONAL — beyond money.
-- ===========================================================================
create or replace view public.v_operations_monthly
with (security_invoker = true) as
  select m.month,
         ( select count(*) from public.trips t
            where date_trunc('month', t.trip_date)::date = m.month )                       as trips_total,
         ( select count(*) from public.trips t
            where t.stage = 'delivered'
              and date_trunc('month', t.trip_date)::date = m.month )                       as trips_delivered,
         ( select count(distinct t.truck_id) from public.trips t
            where t.truck_id is not null
              and date_trunc('month', t.trip_date)::date = m.month )                       as trucks_active,
         ( select count(*) from public.work_orders w
            where date_trunc('month', coalesce(w.closed_at, w.opened_at))::date = m.month) as work_orders,
         ( select count(*) from public.outsourced_jobs oj
            where date_trunc('month', coalesce(oj.closed_at, oj.start_date::timestamptz))::date = m.month) as outsourced_jobs,
         ( select count(*) from public.exit_permits ep
            where ep.exited_at is not null
              and date_trunc('month', ep.exited_at)::date = m.month )                      as exit_permits
    from public.v_report_months m;

-- ===========================================================================
-- 16) GRANTS — authenticated only, anon explicitly out.
-- ===========================================================================
grant select on
  public.v_report_months, public.v_revenue_invoices, public.v_revenue_sales_returns,
  public.v_revenue_monthly, public.v_collections_monthly, public.v_topups_monthly,
  public.v_receivables_open, public.v_receivables_aging, public.v_parts_consumption,
  public.v_parts_cost_monthly, public.v_os_cost_monthly, public.v_payroll_monthly,
  public.v_commissions_monthly, public.v_commissions_paid_monthly,
  public.v_expenses_monthly, public.v_expenses_by_category, public.v_pnl_monthly,
  public.v_revenue_per_truck_monthly, public.v_maintenance_cost_per_truck_monthly,
  public.v_purchasing_spend_monthly, public.v_operations_monthly
to authenticated;

revoke all on
  public.v_report_months, public.v_revenue_invoices, public.v_revenue_sales_returns,
  public.v_revenue_monthly, public.v_collections_monthly, public.v_topups_monthly,
  public.v_receivables_open, public.v_receivables_aging, public.v_parts_consumption,
  public.v_parts_cost_monthly, public.v_os_cost_monthly, public.v_payroll_monthly,
  public.v_commissions_monthly, public.v_commissions_paid_monthly,
  public.v_expenses_monthly, public.v_expenses_by_category, public.v_pnl_monthly,
  public.v_revenue_per_truck_monthly, public.v_maintenance_cost_per_truck_monthly,
  public.v_purchasing_spend_monthly, public.v_operations_monthly
from anon;

-- ===========================================================================
-- 17) SEED THE DICTIONARY.
-- ===========================================================================
insert into public.report_metrics (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('revenue',
   'Revenue',
   'What the business earned by invoicing customers, excluding VAT.',
   'Sum of grand_subtotal_sar over invoices that have been confirmed (confirmed_at is set) and not voided, bucketed by the month they were confirmed.',
   'SAR', 'one month', 'v_revenue_monthly', 'accrual',
   'Excludes VAT, which is a collected liability rather than income. A paid invoice still counts — it was confirmed first. Voided invoices (shown in the UI as Sales Returns) are excluded and appear in v_revenue_sales_returns instead.'),

  ('collections',
   'Collections',
   'Cash actually received against invoices in the month.',
   'Sum of grand_total_sar over invoices whose paid_at falls in the month. VAT-inclusive, because that is what was banked.',
   'SAR', 'one month', 'v_collections_monthly', 'cash',
   'Deliberately NOT revenue and never added to it. An invoice earns revenue when confirmed and produces collections when paid, often in different months.'),

  ('topups',
   'Prepaid top-ups',
   'Money prepaid customers put on account, before any invoice consumes it.',
   'Sum of customer_topups.amount_sar by topup_date month.',
   'SAR', 'one month', 'v_topups_monthly', 'cash',
   'Cash in, but neither revenue nor an invoice payment. Kept separate so it cannot be mistaken for either.'),

  ('receivables_outstanding',
   'Outstanding receivables',
   'Money invoiced and confirmed but not yet paid, as of right now.',
   'Sum of amount_due_sar over invoices confirmed, unpaid, not voided, with amount_due_sar > 0.',
   'SAR', 'current state', 'v_receivables_open', 'state',
   'A statement about today, not about a period. It does not belong on a monthly trend line.'),

  ('receivables_aging',
   'Receivables aging',
   'How long outstanding invoices have been waiting, in 30-day bands.',
   'v_receivables_open bucketed by days since confirmed_at into 0-30, 31-60, 61-90 and 90+.',
   'SAR', 'one aging band', 'v_receivables_aging', 'state',
   'Ages from confirmation, because that is when the invoice became a claim. There are no payment-terms columns in this schema to age from a due date.'),

  ('parts_cost_at_consumption',
   'Parts cost',
   'The FIFO cost of parts that actually left stock — maintenance draws plus non-maintenance exits.',
   'Net of returns from both per-lot ledgers (consume minus return), plus a fallback of work_order_parts.qty x unit_price_sar for work orders deducted before the ledger existed.',
   'SAR', 'one month', 'v_parts_cost_monthly', 'accrual',
   'Purchases are NOT a cost here — a purchase is inventory until consumed, and expensing both would double-count. Live, receipts over the same window are roughly 57x the consumption figure. The pre-ledger fallback is the same stamped price from the other end of the same write, not a recomputation.'),

  ('os_cost',
   'Outsourced repair cost',
   'What outside workshops were paid for repairs.',
   'Sum of workshop_payments.grand_total_sar by invoice_date month.',
   'SAR', 'one month', 'v_os_cost_monthly', 'accrual', null),

  ('payroll_cost',
   'Payroll',
   'Monthly salaries of staff and drivers employed during the month.',
   'Sum of staff.monthly_salary_sar and drivers.salary_sar for people whose employment window overlaps the month.',
   'SAR', 'one month', 'v_payroll_monthly', 'accrual',
   'IMPORTANT: salaries have no history in this schema. The amount is each person''s CURRENT salary, so a raise retroactively changes every past month. Only the employment window is historical. people_missing_salary counts those with no salary recorded, who contribute zero.'),

  ('commissions_cost',
   'Commissions',
   'Driver commission earned in the month.',
   'Trip commission on delivered trips by trip_date, plus approved specials, adjustments and bonuses by month_key.',
   'SAR', 'one month', 'v_commissions_monthly', 'accrual',
   'Earned, not paid. commission_payouts drives the separate cash view; adding both would double-count, since a payout''s base is the same trip commission. Adjustments are signed and are often negative deductions, which correctly reduce the total.'),

  ('commissions_paid',
   'Commissions paid',
   'Commission actually paid out in the month.',
   'Sum of commission_payouts.total_sar by paid_at month.',
   'SAR', 'one month', 'v_commissions_paid_monthly', 'cash',
   'The cash counterpart to commissions_cost. Never add the two together.'),

  ('expenses',
   'Other expenses',
   'Costs recorded by hand that the app does not otherwise model.',
   'Sum of expenses.amount_sar by expense_date month.',
   'SAR', 'one month', 'v_expenses_monthly', 'accrual',
   'Measured separately and never merged into the operational buckets. The P&L shows operating profit before these and net profit after, so their effect is always visible.'),

  ('operating_cost',
   'Operating cost',
   'The four operational cost buckets added together.',
   'parts_cost_at_consumption + os_cost + payroll_cost + commissions_cost.',
   'SAR', 'one month', 'v_pnl_monthly', 'accrual',
   'Excludes manually recorded expenses by design — those sit in their own section.'),

  ('operating_profit',
   'Operating profit',
   'Revenue minus the four operational cost buckets, before manual expenses.',
   'revenue - operating_cost.',
   'SAR', 'one month', 'v_pnl_monthly', 'accrual', null),

  ('net_profit',
   'Net profit',
   'Operating profit after manually recorded expenses.',
   'operating_profit - expenses.',
   'SAR', 'one month', 'v_pnl_monthly', 'accrual',
   'Only as complete as what has been entered by hand. If no expenses are recorded, this equals operating profit.'),

  ('operating_margin',
   'Operating margin',
   'What share of revenue survives the operational costs.',
   'operating_profit / revenue x 100, null when revenue is zero.',
   'percent', 'one month', 'v_pnl_monthly', 'accrual',
   'Null rather than zero in a month with no revenue — a margin on nothing is not a number.'),

  ('revenue_per_truck',
   'Revenue per truck',
   'Invoiced revenue attributed to each truck.',
   'Each invoice''s revenue split EQUALLY across the trips linked to it; each trip carries its share to its truck.',
   'SAR', 'one truck in one month', 'v_revenue_per_truck_monthly', 'accrual',
   'An ALLOCATION, not a measurement. trips.rate_sar is empty throughout this schema, so a trip carries no revenue of its own. Invoices with no linked trips allocate nothing.'),

  ('maintenance_cost_per_truck',
   'Maintenance cost per truck',
   'FIFO cost of parts consumed by work orders on each truck.',
   'v_parts_consumption filtered to maintenance, grouped by truck and month.',
   'SAR', 'one truck in one month', 'v_maintenance_cost_per_truck_monthly', 'accrual',
   'Parts only. Outsourced repair spend is tracked per job, not per truck, and labour is not costed anywhere in this schema.'),

  ('purchasing_spend',
   'Purchasing spend',
   'Value of stock received into the warehouses.',
   'Sum of stock_receipts.grand_total_sar by received_on month.',
   'SAR', 'one month', 'v_purchasing_spend_monthly', 'cash',
   'A procurement/cash view ONLY. It is deliberately not a P&L line — that cost reaches the P&L later, as parts_cost_at_consumption, when the stock is actually used.'),

  ('operations',
   'Operational activity',
   'Non-money activity: trips, active trucks, and maintenance frequency.',
   'Counts per month of trips, delivered trips, distinct trucks used, work orders, outsourced jobs and exit permits.',
   'count', 'one month', 'v_operations_monthly', 'operational', null)
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) EVERY VIEW IS security_invoker. This is the security gate — if any row
--    comes back false, that view bypasses RLS on 68 tables and must be fixed
--    before any UI reads it:
--      select c.relname,
--             coalesce((select option_value from pg_options_to_table(c.reloptions)
--                        where option_name = 'security_invoker'), 'false') as security_invoker
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'v'
--       order by 1;
--    Expect 'true' on all 21.
--
-- 2) anon cannot read them:
--      select has_table_privilege('anon', 'public.v_pnl_monthly', 'select');  -- false
--      select has_table_privilege('authenticated', 'public.v_pnl_monthly', 'select'); -- true
--
-- 3) REVENUE MATCHES A HAND COUNT. The rule-1 trap:
--      select count(*), sum(grand_subtotal_sar) from public.invoices
--       where confirmed_at is not null and voided_at is null;
--    Expect 16 invoices / 70,650.00 — and the same total from
--      select sum(revenue_sar) from public.v_revenue_monthly;
--    If the second is 44,100.00 the view is filtering on status and is wrong.
--
-- 4) NO FAN-OUT. Revenue must not inflate when trips are involved:
--      select sum(revenue_sar) from public.v_revenue_monthly;                  -- 70,650.00
--      select sum(allocated_revenue_sar) from public.v_revenue_per_truck_monthly;
--    Today these are EQUAL (70,650.00, across 9 trucks) because every non-void
--    invoice happens to have linked trips. The allocation may legitimately fall
--    BELOW the total once a charge-only invoice exists, but it must NEVER
--    exceed it. If it does, the join is fanning out — the exact bug that made
--    a naive invoice-to-trip join report 63,900 against a true 44,100.
--
-- 5) PARTS COST INCLUDES THE PRE-LEDGER FALLBACK:
--      select month, parts_cost_sar from public.v_parts_cost_monthly order by 1;
--    Expect July = 4,873.95 (1,374.00 ledger + 3,499.95 pre-ledger) and
--    August = 2,170.00. A July figure of 1,374 means the fallback branch is
--    missing.
--
-- 6) PURCHASES ARE NOT IN THE P&L:
--      select sum(operating_cost_sar) from public.v_pnl_monthly;
--    Must be far below sum(received_stock_value_sar) from
--    v_purchasing_spend_monthly (204,021.50). If they are close, receipts have
--    leaked into the P&L.
--
-- 7) THE P&L FOOTS. For every month:
--      select month,
--             operating_cost_sar
--               - (parts_cost_sar + os_cost_sar + payroll_sar + commissions_sar) as cost_gap,
--             operating_profit_sar - (revenue_sar - operating_cost_sar)          as op_gap,
--             net_profit_sar - (operating_profit_sar - expenses_sar)             as net_gap
--        from public.v_pnl_monthly;
--    All three gaps must be 0.00 on every row.
--
-- 8) EXPENSES ARE SEPARATE: with zero rows in public.expenses,
--    operating_profit_sar = net_profit_sar on every month. Insert one expense
--    and only net_profit_sar moves.
--
-- 9) MONTH SPINE HAS NO GAPS:
--      select count(*), min(month), max(month) from public.v_report_months;
--    Expect a contiguous run ending at the current month.
--
-- 10) NOTHING WAS WRITTEN. This migration creates only views + 2 new tables:
--      select count(*) from public.expenses;        -- 0
--      select count(*) from public.report_metrics;  -- 19
--    and the FIFO invariant is untouched (no view can write):
--      select p.id from public.parts p
--       left join public.price_lots pl on pl.part_id = p.id
--       group by p.id, p.qty_on_hand
--      having p.qty_on_hand is distinct from coalesce(sum(pl.qty_remaining), 0);
--    Zero rows.
