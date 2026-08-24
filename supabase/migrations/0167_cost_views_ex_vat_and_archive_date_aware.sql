-- 0167_cost_views_ex_vat_and_archive_date_aware.sql
--
-- TWO fixes to the reporting view layer, in one pass because they land on
-- overlapping surfaces and a half-applied pair would leave siblings disagreeing.
--
--   FIX 1  Workshop payments are expensed EX-VAT in the three COST views.
--   FIX 2  An archived customer or project drops out of history FROM its
--          archive moment forward, and stays in it before that moment.
--
-- DRAFTED TO DISK. NOT APPLIED. The architect applies via MCP after review.
--
-- SCOPE: NINE views are replaced — three for FIX 1, six for FIX 2. Two further
-- views inherit FIX 2 by composition and are deliberately not edited. One view
-- from the brief's FIX 2 list, `v_customer_prepaid_balance`, is deliberately OUT
-- OF SCOPE; see (C) below.
--
-- ===========================================================================
-- THREE DEPARTURES FROM THE BRIEF — READ BEFORE APPLYING
-- ===========================================================================
-- (A) and (B) are things the brief specified that this file deliberately does
-- NOT do, because measurement contradicted them. (C) is a view the brief listed
-- that this file deliberately omits, on the architect's decision. All three are
-- money. All three are flagged here rather than silently resolved in the SQL.
--
-- (A) `v_revenue_invoices` HAS NO WORKSHOP-COST PORTION. It was named as the
--     overlap between the two fixes ("apply subtotal_sar for the workshop-cost
--     portion AND the archived condition"). Its live body reads two tables:
--
--         FROM invoices i JOIN customers c ON c.id = i.customer_id
--
--     — no `workshop_payments`, no cost of any kind. Its three money columns are
--     `i.grand_subtotal_sar AS revenue_sar` (already the ex-VAT subtotal, which
--     is 0098's rule and correct), `i.grand_vat_sar AS vat_sar`, and
--     `i.grand_total_sar AS gross_sar` — legitimately gross, because that is what
--     the customer owes. Turning `gross_sar` into a subtotal would delete the
--     invoice's own total from the reporting layer.
--
--     Confirmed from the other side, by dependency rather than by grep — exactly
--     three views read `workshop_payments`, and they are exactly FIX 1's three:
--
--         v_daily_operations, v_maintenance_cost_per_truck_monthly, v_os_cost_monthly
--
--     So `v_revenue_invoices` is FIX 2 ONLY, and THE TWO FIXES DO NOT OVERLAP ON
--     ANY VIEW. The overlap almost certainly came from an earlier grep of ours
--     for view bodies mentioning `grand_total_sar`, which listed this view on the
--     strength of the `gross_sar` alias.
--
-- (B) `subtotal_sar` ALONE IS NOT THE EX-VAT COST — `workshop_payments` carries a
--     DISCOUNT column, and the brief's own expected number is the proof. Live:
--
--         rows                                    7
--         sum(subtotal_sar)               17,610.00
--         sum(discount_sar)                  580.00     (4 of the 7 rows)
--         sum(vat_sar)                     2,641.50
--         sum(grand_total_sar)            19,671.50
--         rows where grand_total <> subtotal - discount + vat        0
--
--     The identity holds on every row, so the ex-VAT cost is
--     `subtotal_sar - discount_sar` = 17,030.00, and the shift off the P&L is
--     19,671.50 - 17,030.00 = 2,641.50 — EXACTLY the VAT, which is what the
--     brief predicted. Bare `subtotal_sar` would have shifted only 2,061.50 and
--     left 580.00 of granted discount expensed as if it had been paid. This file
--     therefore sums `subtotal_sar - discount_sar` everywhere FIX 1 applies.
--
-- ===========================================================================
-- FIX 1 — WORKSHOP VAT LEAVES THE COST VIEWS
-- ===========================================================================
-- `grand_total_sar` is VAT-INCLUSIVE. Expensing it books VAT — money collected
-- for ZATCA and paid straight back out — as if it were the cost of the repair.
-- It is not a cost, it is a liability in transit, and CLAUDE.md §7 is explicit
-- that it never touches a profit figure.
--
-- Blast radius of the old figure, which is why this is worth a migration:
--
--     v_os_cost_monthly.os_cost_sar
--       -> v_pnl_monthly.operating_cost_sar
--         -> operating_profit_sar -> net_profit_sar -> margin %
--           -> v_pnl_by_period inherits every one of them
--             -> indicativeZakat() multiplies net_profit_sar by 2.5 %
--
-- So the overstatement moved the Zakat estimate too: 2,641.50 of phantom cost
-- all-time, ~66.04 SAR of Zakat. Profit RISES by 2,641.50 when this is applied.
--
-- THE TWO CASH VIEWS ARE DELIBERATELY NOT TOUCHED. `v_collections_monthly`
-- (money received from customers) and `v_purchasing_spend_monthly` (money sent
-- to suppliers) are VAT-INCLUSIVE ON PURPOSE — they answer "what moved through
-- the bank", and the bank moved the VAT. Neither is a source of v_pnl_monthly.
-- The rule for any future cost view: a P&L line is ex-VAT, a cash line is not.
--
-- The other two views in FIX 1 are not P&L, they are standalone statistics —
-- but they report the SAME workshop payments, so leaving them VAT-inclusive
-- would make per-truck maintenance and daily operations disagree with the P&L
-- by exactly the VAT. They move together or the reader cannot reconcile them.
--
-- ===========================================================================
-- FIX 2 — ARCHIVE IS DATE-AWARE, NOT A BLANKET ERASURE
-- ===========================================================================
-- Turki's rule, exactly: a customer or project appears in reports for periods
-- BEFORE it was archived; from `archived_at` forward it drops out. History stays
-- forever. Commission earned before the archive STAYS OWED — a driver does not
-- lose money he already drove for because an office record was tidied later.
--
-- So the test is per FACT ROW, never per entity:
--
--     INCLUDE when  archived_at IS NULL  OR  <the row's own date> < archived_at
--     EXCLUDE when  <the row's own date> >= archived_at
--
-- WHY THIS IS NOT A ONE-LINER, AND WHY EACH VIEW STATES ITS OWN DATE COLUMN:
-- "the row's own date" is a different column in every view, and picking the
-- wrong one is how a report starts disagreeing with its sibling. Each block
-- below names its choice and says why.
--
-- ---------------------------------------------------------------------------
-- GATE ON THE FINEST-GRAINED STAMP THE ROW HAS. A DAY IS TOO COARSE.
-- ---------------------------------------------------------------------------
-- `archived_at` is a timestamptz — an INSTANT. A `date` fact column can only say
-- "some time that day", so on the archive day itself a date comparison must
-- either grant the whole day (including work done after the archive) or refuse
-- the whole day (including work done before it). Both are wrong, and the second
-- one destroys money.
--
-- THIS IS NOT HYPOTHETICAL. It is live, and it is the reason this section was
-- rewritten mid-draft. Project KING SALMAN PARK (customer TURKI 1) carries three
-- delivered trips whose `trip_date` is 2026-06-29:
--
--     WT-2026-0029  delivered 2026-06-29 01:51:54 Riyadh   10.00 SAR
--     WT-2026-0030  delivered 2026-06-29 01:51:57 Riyadh   10.00 SAR
--     WT-2026-0032  delivered 2026-06-29 01:52:05 Riyadh   10.00 SAR
--     project/customer archived 2026-06-29 01:55:16 Riyadh
--
-- The work finished THREE MINUTES AND TWENTY SECONDS before the archive. Gating
-- on `trip_date` against the archive DATE throws all three away — both fall on
-- 2026-06-29 — and deletes 30.00 SAR of commission a driver had already earned.
-- That is the exact outcome Turki's rule forbids. Gating on `delivered_at`
-- against `archived_at` keeps them, which is why the commission view below gates
-- on the DELIVERY MOMENT while still bucketing by the WORK MONTH.
--
-- So the shapes are, in order of preference:
--
--   1. timestamptz fact column    <ts> < archived_at
--   2. date column WITH a timestamptz twin for the same row:
--          <d> <  (archived_at at time zone 'Asia/Riyadh')::date
--       OR (<d> = (archived_at at time zone 'Asia/Riyadh')::date AND <ts> < archived_at)
--      — a whole day before the archive always counts; the archive DAY itself
--        counts only for rows stamped before the archive moment.
--   3. date column with no twin at all: form 1 of the pair only. None currently.
--
-- The `at time zone 'Asia/Riyadh'` is not decoration either. A bare
-- `date < timestamptz` comparison casts the date using the SESSION TimeZone, so
-- the same view would answer differently for the API role and for a psql session
-- set to UTC. Collapsing the archive moment to a Riyadh-local DATE first makes
-- the boundary deterministic and puts it where the business day actually ends —
-- the same reason `todayKey()` exists on the TS side (§6).
--
-- STATE OF THE RULE BEFORE THIS MIGRATION, measured rather than assumed: of the
-- 11 views touching `projects`/`customers`, only 5 filtered `archived_at` at all,
-- and where the rule LOOKED like it held it mostly held by accident — revenue
-- from the one archived customer is 0.00 because that customer has no confirmed
-- invoice, not because anything filtered it.
--
-- MEASURED EFFECT OF FIX 2 ON TODAY'S DATA: NOTHING MOVES. Every archived-entity
-- fact row that exists predates its archive, so every view below returns exactly
-- what it returns now. FIX 2 is not a correction of today's figures — it is the
-- rule being stated in SQL instead of holding by luck. The only figures this
-- migration actually moves today are FIX 1's.
--
-- TWO VIEWS ARE NOT EDITED BECAUSE THEY INHERIT THE FILTER:
--
--     v_revenue_monthly    aggregates v_revenue_invoices     (edited below)
--     v_receivables_open   composes on v_invoice_outstanding_live (edited below)
--
-- Restating the condition inside them would be a second expression of one rule,
-- and a second expression is a future disagreement (§6's standing lesson). They
-- are verified BY DATA at the end of this file, not by grepping their bodies.
--
-- THREE VIEWS OUTSIDE THE SET WILL CHANGE VALUES ANYWAY, BY COMPOSITION —
-- expected, not a scope leak:
--
--     v_customer_amount_payable   through v_invoice_outstanding_live
--     v_receivables_aging         composes on v_receivables_open
--     v_daily_operations          takes revenue_sar from v_revenue_invoices
--
-- ===========================================================================
-- (C) v_customer_prepaid_balance IS DELIBERATELY OUT OF SCOPE
-- ===========================================================================
-- It was in the brief's nine. It was drafted, dry-run, and then REMOVED on the
-- architect's decision — recorded here so the omission reads as a choice rather
-- than a gap, and so the next person does not "complete" the set.
--
-- The reason is CLAUDE.md §7. That rule pins the prepaid balance to EXACTLY TWO
-- EXPRESSIONS — this view and `returnedTotal()` / `derivedBalanceItems` in
-- lib/prepaid.ts. Gating only the SQL side makes the two disagree BY
-- CONSTRUCTION for any archived customer with a post-archive fact row: a
-- half-applied two-sided rule, which is worse than an unapplied one because the
-- drift is silent. If it is ever wanted, it is a PAIRED migration — SQL and TS
-- in the same change — not a line added here.
--
-- Two supporting reasons, both of which survive the decision:
--
--   1. It is a BALANCE, not a period report. Every view in this file answers
--      "what happened in month X"; that one answers "what does this customer
--      hold NOW". A date filter on a running balance is a different claim.
--   2. Two of its four inputs have no business date at all —
--      `customer_balance_returns` and `invoice_special_charges` carry only
--      `created_at`, so the filter would lean on a bookkeeping timestamp.
--
-- Nothing is lost today: 1 archived customer of 8, 1 archived project of 8, and
-- no post-archive fact rows on either, so the gate would have changed no figure.
--
-- IT IS STILL READ BY THIS FILE, UNCHANGED. `v_invoice_outstanding_live` INNER
-- JOINs it for `balance_sar`. That join is untouched and the view it reads keeps
-- its live, ungated definition — which is the correct pairing, because dropping
-- an archived customer's ROW there would delete their pre-archive invoices from
-- receivables, the opposite of Turki's rule.
--
-- ===========================================================================
-- MECHANICS
-- ===========================================================================
-- Every `create or replace view` below restates the §6 security footer, because
-- replace silently drops reloptions — and re-states the view COMMENT where one
-- exists, because replace keeps the same OID and therefore keeps a comment that
-- no longer describes the view. FOUR of the nine carry a comment today
-- (v_activity_feed, v_daily_operations, v_driver_commission_by_project_monthly,
-- v_invoice_outstanding_live — measured, not assumed); the other five are given
-- one, so all nine end this file described.
--
-- `v_customer_prepaid_balance` keeps its LIVE comment untouched, which correctly
-- makes no mention of 0167 — it is not replaced here.
--
-- No column is added, removed, renamed, reordered or retyped anywhere in this
-- file, so 42P16 cannot fire. Checked rather than assumed: `subtotal_sar`,
-- `discount_sar` and `grand_total_sar` are all `numeric(12,2)`, so
-- `sum(subtotal_sar - discount_sar)` and `sum(grand_total_sar)` are both bare
-- `numeric` — identical to what each view already publishes.

begin;

-- ===========================================================================
-- FIX 1.1 — v_os_cost_monthly
-- ===========================================================================
-- The P&L's outsourced-maintenance cost line, and the one that reaches Zakat.
-- Bucketed by `coalesce(invoice_date, created_at::date)` — unchanged; only the
-- money column moves. `count(wp.id)` is kept over `count(*)`: the month spine is
-- a LEFT JOIN, and `count(*)` would report an empty month as 1 payment.
create or replace view public.v_os_cost_monthly as
  select
    m.month,
    coalesce(sum(wp.subtotal_sar - wp.discount_sar), 0::numeric) as os_cost_sar,
    coalesce(count(wp.id), 0::bigint)                            as payment_count
  from v_report_months m
  left join workshop_payments wp
    on date_trunc('month'::text, coalesce(wp.invoice_date, wp.created_at::date)::timestamp with time zone)::date = m.month
  group by m.month;

alter view public.v_os_cost_monthly set (security_invoker = true);
revoke all on public.v_os_cost_monthly from anon;
grant select on public.v_os_cost_monthly to authenticated;

comment on view public.v_os_cost_monthly is
  'Outsourced workshop cost per month, EX-VAT and NET OF DISCOUNT (0167): sum(subtotal_sar - discount_sar), never grand_total_sar. This is a P&L cost line — it feeds v_pnl_monthly.operating_cost_sar and therefore net_profit_sar and the indicative Zakat estimate — and VAT is a liability collected for ZATCA, not a cost (CLAUDE.md §7). Contrast v_purchasing_spend_monthly and v_collections_monthly, which are CASH views and stay VAT-inclusive on purpose. Bucketed by invoice_date, falling back to created_at. count(wp.id) not count(*): the month spine is a LEFT JOIN and count(*) reports an empty month as 1.';

-- ===========================================================================
-- FIX 1.2 — v_maintenance_cost_per_truck_monthly
-- ===========================================================================
-- Not a P&L view, but it reports the SAME payments per truck. Left VAT-inclusive
-- it would exceed the P&L's cost by exactly the VAT and no reader could
-- reconcile the two. Parts are already clean — `v_parts_consumption.cost_sar`
-- carries no VAT — so only the `os` CTE moves.
create or replace view public.v_maintenance_cost_per_truck_monthly as
  with parts as (
    select
      p.month,
      p.truck_id,
      sum(p.cost_sar)             as maintenance_parts_sar,
      count(distinct p.part_id)   as distinct_parts
    from v_parts_consumption p
    where p.source = 'maintenance'::text
      and p.truck_id is not null
    group by p.month, p.truck_id
  ), os as (
    select
      date_trunc('month'::text, coalesce(wp.invoice_date, wp.created_at::date)::timestamp with time zone)::date as month,
      oj.truck_id,
      sum(wp.subtotal_sar - wp.discount_sar) as os_payments_sar,
      count(wp.id)                           as os_payment_count
    from workshop_payments wp
    join outsourced_jobs oj on oj.id = wp.outsourced_job_id
    where oj.truck_id is not null
    group by
      (date_trunc('month'::text, coalesce(wp.invoice_date, wp.created_at::date)::timestamp with time zone)::date),
      oj.truck_id
  )
  select
    coalesce(parts.month, os.month)                          as month,
    coalesce(parts.truck_id, os.truck_id)                    as truck_id,
    tr.plate,
    coalesce(parts.maintenance_parts_sar, 0::numeric)        as maintenance_parts_sar,
    coalesce(parts.distinct_parts, 0::bigint)                as distinct_parts,
    coalesce(os.os_payments_sar, 0::numeric)                 as os_payments_sar,
    coalesce(os.os_payment_count, 0::bigint)                 as os_payment_count,
    coalesce(parts.maintenance_parts_sar, 0::numeric)
      + coalesce(os.os_payments_sar, 0::numeric)             as total_maintenance_sar
  from parts
  full join os on os.month = parts.month and os.truck_id = parts.truck_id
  join trucks tr on tr.id = coalesce(parts.truck_id, os.truck_id);

alter view public.v_maintenance_cost_per_truck_monthly set (security_invoker = true);
revoke all on public.v_maintenance_cost_per_truck_monthly from anon;
grant select on public.v_maintenance_cost_per_truck_monthly to authenticated;

comment on view public.v_maintenance_cost_per_truck_monthly is
  'Maintenance cost per truck per month: consumed parts plus outsourced workshop payments. Both halves are EX-VAT (0167) — parts always were, and os_payments_sar is now sum(subtotal_sar - discount_sar) so this agrees with the P&L''s v_os_cost_monthly instead of exceeding it by the VAT. FULL JOIN, because a truck can have parts with no outsourced work in a month or the reverse.';

-- ===========================================================================
-- FIX 1.3 — v_daily_operations
-- ===========================================================================
-- Same payments again, daily. Its `revenue_sar` reads v_revenue_invoices, so it
-- also inherits FIX 2 without being edited for it — recorded here so the value
-- change on this view is expected rather than investigated later.
create or replace view public.v_daily_operations as
  with spine as (
    select generate_series(
      ((select min(v_report_months.month) from v_report_months))::timestamp with time zone,
      greatest(current_date, (now() at time zone 'Asia/Riyadh'::text)::date)::timestamp with time zone,
      '1 day'::interval
    )::date as day
  ), revenue as (
    select
      r.confirmed_at::date  as day,
      sum(r.revenue_sar)    as revenue_sar,
      count(*)              as invoice_count
    from v_revenue_invoices r
    group by (r.confirmed_at::date)
  ), parts as (
    select p.day, sum(p.cost_sar) as parts_cost_sar
    from v_parts_consumption_daily p
    group by p.day
  ), outsourced as (
    select
      coalesce(wp.invoice_date, wp.created_at::date) as day,
      sum(wp.subtotal_sar - wp.discount_sar)         as os_cost_sar
    from workshop_payments wp
    group by (coalesce(wp.invoice_date, wp.created_at::date))
  ), commissions as (
    select t.trip_date as day, sum(t.commission_sar) as trip_commission_sar
    from trips t
    where t.stage = 'delivered'::text
    group by t.trip_date
  ), filling as (
    select
      t.trip_date as day,
      sum(t.filling_cost_sar) as filling_cost_sar,
      count(*) filter (where t.filling_cost_sar is null)::integer as uncosted_trips
    from trips t
    where t.stage = any (array['loading'::text, 'in_transit'::text, 'delivered'::text])
    group by t.trip_date
  ), manual_expenses as (
    select e.expense_date as day, sum(e.amount_sar) as expenses_sar
    from expenses e
    group by e.expense_date
  ), activity as (
    select
      t.trip_date as day,
      count(*) as trips_total,
      count(*) filter (where t.stage = 'delivered'::text) as trips_delivered
    from trips t
    group by t.trip_date
  )
  select
    s.day,
    date_trunc('month'::text, s.day::timestamp with time zone)::date  as month,
    coalesce(rv.revenue_sar, 0::numeric)                              as revenue_sar,
    coalesce(rv.invoice_count, 0::bigint)::integer                    as invoice_count,
    coalesce(pa.parts_cost_sar, 0::numeric)                           as parts_cost_sar,
    coalesce(os.os_cost_sar, 0::numeric)                              as os_cost_sar,
    coalesce(cm.trip_commission_sar, 0::numeric)                      as trip_commission_sar,
    coalesce(pa.parts_cost_sar, 0::numeric)
      + coalesce(os.os_cost_sar, 0::numeric)
      + coalesce(cm.trip_commission_sar, 0::numeric)
      + coalesce(fl.filling_cost_sar, 0::numeric)                     as direct_cost_sar,
    coalesce(rv.revenue_sar, 0::numeric)
      - coalesce(pa.parts_cost_sar, 0::numeric)
      - coalesce(os.os_cost_sar, 0::numeric)
      - coalesce(cm.trip_commission_sar, 0::numeric)
      - coalesce(fl.filling_cost_sar, 0::numeric)                     as direct_margin_sar,
    coalesce(ex.expenses_sar, 0::numeric)                             as expenses_sar,
    coalesce(ac.trips_total, 0::bigint)::integer                      as trips_total,
    coalesce(ac.trips_delivered, 0::bigint)::integer                  as trips_delivered,
    coalesce(fl.filling_cost_sar, 0::numeric)                         as filling_cost_sar,
    coalesce(fl.uncosted_trips, 0)                                    as filling_uncosted_trips
  from spine s
  left join revenue rv        on rv.day = s.day
  left join parts pa          on pa.day = s.day
  left join outsourced os     on os.day = s.day
  left join commissions cm    on cm.day = s.day
  left join filling fl        on fl.day = s.day
  left join manual_expenses ex on ex.day = s.day
  left join activity ac       on ac.day = s.day;

alter view public.v_daily_operations set (security_invoker = true);
revoke all on public.v_daily_operations from anon;
grant select on public.v_daily_operations to authenticated;

comment on view public.v_daily_operations is
  'One row per calendar day. revenue_sar is billed revenue bucketed by the day the invoice was CONFIRMED (UTC, so days sum to v_revenue_monthly exactly), and it now inherits the date-aware archive filter through v_revenue_invoices (0167). direct_cost_sar is parts + outsourced + trip commissions + FILLING (0112); the outsourced half is EX-VAT and net of discount as of 0167, matching v_os_cost_monthly and the P&L. Payroll and non-trip commission have no daily stamp and are reported per month by v_monthly_only_costs. direct_margin_sar is NOT profit. filling_uncosted_trips is filled trips with no price for their water type. filling columns are appended at the end (create-or-replace cannot insert mid-list, 42P16).';

-- ===========================================================================
-- FIX 2.1 — v_revenue_invoices
-- ===========================================================================
-- FACT DATE: `i.confirmed_at`. Revenue is recognised when the invoice is
-- confirmed — it is already the column this view buckets `month` on, so the
-- archive gate and the period the row reports in cannot drift apart.
--
-- This is the ROOT of the revenue chain. v_revenue_monthly and v_daily_operations
-- both read it and neither needs its own copy of the rule.
--
-- The customers join is already an INNER join in the live body and stays one —
-- `invoices.customer_id` has no NULLs (checked) and an invoice with no customer
-- is not a revenue document.
create or replace view public.v_revenue_invoices as
  select
    i.id                                                    as invoice_id,
    i.invoice_number,
    i.customer_id,
    c.name                                                  as customer_name,
    date_trunc('month'::text, i.confirmed_at)::date         as month,
    i.confirmed_at,
    i.paid_at,
    i.period_start,
    i.period_end,
    i.status,
    i.grand_subtotal_sar                                    as revenue_sar,
    i.grand_vat_sar                                         as vat_sar,
    i.grand_total_sar                                       as gross_sar,
    i.amount_due_sar,
    i.paid_at is not null                                   as is_paid
  from invoices i
  join customers c on c.id = i.customer_id
  where i.confirmed_at is not null
    and i.voided_at is null
    -- 0167: confirmed BEFORE the customer was archived, or never archived.
    and (c.archived_at is null or i.confirmed_at < c.archived_at);

alter view public.v_revenue_invoices set (security_invoker = true);
revoke all on public.v_revenue_invoices from anon;
grant select on public.v_revenue_invoices to authenticated;

comment on view public.v_revenue_invoices is
  'One row per confirmed, non-void invoice — the root of the revenue chain (v_revenue_monthly and v_daily_operations both compose on it and inherit its filters). revenue_sar is the EX-VAT subtotal, gross_sar is what the customer owes INCLUDING VAT, and they are deliberately both published: mixing them is how VAT re-enters profit (CLAUDE.md §7). 0167 added the date-aware archive gate on confirmed_at — an archived customer keeps every invoice confirmed before archived_at and contributes nothing from that moment on.';

-- ===========================================================================
-- FIX 2.2 — v_invoice_outstanding_live
-- ===========================================================================
-- FACT DATE: `i.confirmed_at`. Same choice as v_revenue_invoices and for the
-- same reason — an invoice enters the books when it is confirmed, so the same
-- documents are visible to the revenue side and the receivables side. Using
-- `period_end` instead would let a July-confirmed invoice for a June period
-- survive an end-of-June archive on one surface and not the other.
--
-- LEFT join to customers, not inner: this view already tolerates a missing
-- customer elsewhere in its shape, and an inner join here would silently drop
-- invoices rather than report them — the wrong failure for a receivables view.
--
-- The `pm` lateral still reads `projects` UNFILTERED, on purpose. It resolves a
-- payment MODE, which is configuration and not a fact with a date; excluding an
-- archived project there would flip a customer from prepaid to unknown-mode and
-- silently change how their old invoices are valued.
--
-- v_receivables_open composes on this view and inherits the gate.
create or replace view public.v_invoice_outstanding_live as
  with open_invoices as (
    select
      i.id                                        as invoice_id,
      i.invoice_number,
      i.customer_id,
      i.confirmed_at,
      i.period_end,
      i.amount_due_sar                            as frozen_amount_due_sar,
      coalesce(i.payment_mode, pm.resolved_mode)  as effective_payment_mode
    from invoices i
    left join customers c on c.id = i.customer_id
    left join lateral (
      select
        case when count(distinct p.payment_mode) = 1 then min(p.payment_mode) else null::text end as resolved_mode
      from projects p
      where p.customer_id = i.customer_id
        and p.payment_mode is not null
    ) pm on true
    where i.confirmed_at is not null
      and i.paid_at is null
      and i.voided_at is null
      -- 0167: confirmed BEFORE the customer was archived, or never archived.
      and (c.archived_at is null or i.confirmed_at < c.archived_at)
  ), allocated as (
    select
      o.invoice_id,
      o.invoice_number,
      o.customer_id,
      o.confirmed_at,
      o.period_end,
      o.frozen_amount_due_sar,
      o.effective_payment_mode,
      b.balance_sar,
      greatest(0::numeric, - b.balance_sar)   as shortfall_sar,
      w.customer_id is not null               as is_written_off,
      sum(o.frozen_amount_due_sar) over (
        partition by o.customer_id
        order by o.confirmed_at desc, o.invoice_number desc, o.invoice_id desc
        rows between unbounded preceding and current row
      ) as cum_frozen_newest_first
    from open_invoices o
    join v_customer_prepaid_balance b on b.customer_id = o.customer_id
    left join customer_write_offs w on w.customer_id = o.customer_id and w.reversed_at is null
  )
  select
    invoice_id,
    invoice_number,
    customer_id,
    confirmed_at,
    period_end,
    frozen_amount_due_sar,
    effective_payment_mode,
    balance_sar,
    shortfall_sar,
    (case
      when is_written_off then 0::numeric
      when effective_payment_mode = 'prepaid'::text
        then least(frozen_amount_due_sar, greatest(0::numeric, shortfall_sar - (cum_frozen_newest_first - frozen_amount_due_sar)))
      else frozen_amount_due_sar
    end)::numeric(12,2) as outstanding_sar,
    case
      when is_written_off then 'written_off'::text
      when effective_payment_mode = 'prepaid'::text then 'live_prepaid_balance'::text
      else 'frozen'::text
    end as outstanding_basis
  from allocated a;

alter view public.v_invoice_outstanding_live set (security_invoker = true);
revoke all on public.v_invoice_outstanding_live from anon;
grant select on public.v_invoice_outstanding_live to authenticated;

comment on view public.v_invoice_outstanding_live is
  'Per confirmed-unpaid invoice: what is still owed TODAY vs frozen at confirm. Postpaid/unknown-mode keep invoices.amount_due_sar byte-for-byte. A PREPAID invoice is capped at the customer''s live shortfall, allocated NEWEST-FIRST. A customer with an ACTIVE write-off (reversed_at is null, 0139/0141) reports 0.00 on basis ''written_off'' and leaves v_receivables_open by composition; reversing on restore brings it back the same way. 0167 added the date-aware archive gate on confirmed_at — the payment-mode lateral is deliberately NOT gated, because a payment mode is configuration, not a dated fact. Never rewrites the document (0137, extended by 0139, 0141 and 0167).';

-- ===========================================================================
-- FIX 2.3 — v_revenue_sales_returns
-- ===========================================================================
-- FACT DATE: `i.confirmed_at` — NOT `voided_at`, and this is the one non-obvious
-- choice in the file.
--
-- A sales return is a REVERSAL of a revenue row. If the two are gated on
-- different dates they desync: an invoice confirmed in June (pre-archive) and
-- voided in July (post-archive) would keep its revenue in v_revenue_invoices and
-- lose its reversal here, leaving revenue permanently overstated for a customer
-- who is supposed to have stopped reporting. Gating both on `confirmed_at` makes
-- that impossible — a reversal is visible exactly when the thing it reverses is.
--
-- The trade is that such a return still lists in the month it was VOIDED, which
-- may fall after the archive. That is a presentation quirk in a statement whose
-- whole purpose is to show reversals; overstated revenue is a wrong number.
-- Given the choice between a wrong number and an awkward row, take the row.
create or replace view public.v_revenue_sales_returns as
  select
    i.id                                            as invoice_id,
    i.invoice_number,
    i.customer_id,
    date_trunc('month'::text, i.voided_at)::date    as month,
    i.voided_at,
    i.void_reason,
    i.grand_subtotal_sar                            as reversed_revenue_sar
  from invoices i
  join customers c on c.id = i.customer_id
  where i.voided_at is not null
    and i.confirmed_at is not null
    -- 0167: gated on CONFIRMED_AT, deliberately not voided_at — a reversal must
    -- be visible exactly when the revenue it reverses is visible.
    and (c.archived_at is null or i.confirmed_at < c.archived_at);

alter view public.v_revenue_sales_returns set (security_invoker = true);
revoke all on public.v_revenue_sales_returns from anon;
grant select on public.v_revenue_sales_returns to authenticated;

comment on view public.v_revenue_sales_returns is
  'Voided confirmed invoices — sales returns, listed in the month they were VOIDED, carrying the EX-VAT subtotal they reverse. 0167 gates them on CONFIRMED_AT rather than voided_at, so a reversal is always visible on the same side of a customer archive as the revenue row it cancels; gating on voided_at could strand revenue with its reversal filtered away.';

-- ===========================================================================
-- FIX 2.4 — v_topups_monthly
-- ===========================================================================
-- FACT DATE: `tp.topup_date`, the business date the money was paid in — NOT
-- `created_at` on its own, which only records when someone typed it and would
-- exclude a backdated top-up that belongs to a month before the archive.
--
-- It is a `date`, so it takes the two-part shape from the header: a whole day
-- before the archive always counts, and the archive DAY ITSELF counts only for
-- top-ups whose `created_at` predates the archive moment. That second clause is
-- what a bare date comparison gets wrong, and the King Salman Park trips are the
-- live proof that same-day is not a rare case — an archive is usually done right
-- after the last piece of work.
--
-- The customers join goes INSIDE the derived table, not into the outer FROM:
-- the month spine is a LEFT JOIN and any join added at the outer level would
-- turn it inner and delete every month with no topups from the report.
create or replace view public.v_topups_monthly as
  select
    m.month,
    coalesce(sum(t.amount_sar), 0::numeric) as topups_sar,
    coalesce(count(t.id), 0::bigint)        as topup_count
  from v_report_months m
  left join (
    select tp.id, tp.amount_sar, tp.topup_date
    from customer_topups tp
    left join customers c on c.id = tp.customer_id
    -- 0167: paid in BEFORE the customer was archived, or never archived.
    where c.archived_at is null
       or tp.topup_date < (c.archived_at at time zone 'Asia/Riyadh')::date
       or (tp.topup_date = (c.archived_at at time zone 'Asia/Riyadh')::date
           and tp.created_at < c.archived_at)
  ) t on date_trunc('month'::text, t.topup_date::timestamp with time zone)::date = m.month
  group by m.month;

alter view public.v_topups_monthly set (security_invoker = true);
revoke all on public.v_topups_monthly from anon;
grant select on public.v_topups_monthly to authenticated;

comment on view public.v_topups_monthly is
  'Customer prepaid top-ups per month, bucketed on topup_date (the date the money was paid in), over the full report month spine. 0167 added the date-aware archive gate: a top-up counts if its topup_date falls wholly before its customer''s archived_at (compared as a Riyadh-local DATE so the boundary does not shift with the session TimeZone), or falls ON the archive day and was recorded before the archive moment. The customers join sits inside the derived table so the spine LEFT JOIN stays outer. count(t.id) not count(*): count(*) would report an empty month as 1 top-up.';

-- ===========================================================================
-- FIX 2.5 — v_driver_commission_by_project_monthly
-- ===========================================================================
-- FACT DATE: `t.delivered_at`, the DELIVERY MOMENT — not `trip_date`, even
-- though trip_date is what the view buckets its `month` on. The two jobs are
-- different: the bucket answers "which work month does this commission belong
-- to", the gate answers "had this happened yet when the archive ran". Only the
-- gate needs instant precision, and only the gate can destroy money by lacking
-- it — see the header's King Salman Park case, where three trips finished 3m20s
-- before the archive and a trip_date gate would have deleted 30.00 SAR of
-- earned commission because both fell on 2026-06-29.
--
-- Safe because this view is `stage = 'delivered'` only, and all 765 delivered
-- trips carry a non-null `delivered_at` (checked, not assumed — a NULL would
-- make the comparison NULL and silently drop the row).
--
-- BOTH archive columns apply, because a project can be archived on its own or
-- along with its customer, and the driver's claim must survive either:
--   - `p.archived_at`  the project the trip was driven for
--   - `pc.archived_at` that project's customer
-- Both joins are LEFT, so a direct-customer trip with no project (project_id
-- null) is kept — the view's existing contract, unchanged.
create or replace view public.v_driver_commission_by_project_monthly as
  select
    date_trunc('month'::text, t.trip_date::timestamp with time zone)::date as month,
    t.driver_id,
    d.name                                    as driver_name,
    t.project_id,
    p.name                                    as project_name,
    count(*)::integer                         as trips_delivered,
    coalesce(sum(t.commission_sar), 0::numeric) as commission_sar
  from trips t
  join drivers d on d.id = t.driver_id
  left join projects p on p.id = t.project_id
  left join customers pc on pc.id = p.customer_id
  where t.stage = 'delivered'::text
    and t.driver_id is not null
    -- 0167: DELIVERED before the project was archived, or never archived.
    -- delivered_at, not trip_date — a same-day delivery must not be erased.
    and (p.archived_at is null or t.delivered_at < p.archived_at)
    -- 0167: and before the project's CUSTOMER was archived.
    and (pc.archived_at is null or t.delivered_at < pc.archived_at)
  group by
    (date_trunc('month'::text, t.trip_date::timestamp with time zone)::date),
    t.driver_id, d.name, t.project_id, p.name;

alter view public.v_driver_commission_by_project_monthly set (security_invoker = true);
revoke all on public.v_driver_commission_by_project_monthly from anon;
grant select on public.v_driver_commission_by_project_monthly to authenticated;

comment on view public.v_driver_commission_by_project_monthly is
  'What each driver EARNED per project in the month he DROVE the trips — the work month, not the settlement month. Delivered trips only, because commission exists on no other stage and v_commissions_monthly filters the same way. Includes commission already paid out: unlike the payslip''s earned basis this does NOT filter payout_id IS NULL, because the question is what was earned, not what is still owed. A NULL project_id is a direct-customer trip and is kept, not dropped. 0167 gates on DELIVERED_AT against BOTH the project''s and its customer''s archived_at — commission earned before an archive stays owed, down to the minute; work delivered from that moment on drops out. The gate deliberately uses delivered_at while the month bucket uses trip_date: a same-day archive would otherwise erase a delivery that finished minutes before it.';

-- ===========================================================================
-- FIX 2.6 — v_activity_feed
-- ===========================================================================
-- FACT DATE: each branch's own `occurred_at`. The feed is a list of dated events
-- and every branch already selects the timestamp it happened at, so the gate is
-- literally "this event happened before the archive".
--
-- FIVE of the nineteen branches touch a customer or a project. The other
-- fourteen — work orders, outsourced jobs, exit permits, purchase orders, stock
-- receipts, commission payouts, expenses, archive documents — have no customer
-- or project at all and are reproduced unchanged:
--
--   trip_delivered      t.delivered_at   vs project + that project's customer
--   invoice_confirmed   i.confirmed_at   vs customer
--   invoice_paid        i.paid_at        vs customer
--   invoice_voided      i.voided_at      vs customer
--   topup_added         tu.created_at    vs customer   (occurred_at IS created_at here)
--
-- Every customer/project join in this view is LEFT, and the gate is written so a
-- NULL join partner passes — an event with no customer keeps appearing.
create or replace view public.v_activity_feed as
   select t.delivered_at            as occurred_at,
          'trip_delivered'::text    as kind,
          'trip'::text              as entity,
          t.id                      as entity_id,
          coalesce(t.ref, 'Trip'::text) as title,
          t.water_station           as subtitle,
          null::text                as actor
     from trips t
     left join projects tp on tp.id = t.project_id
     left join customers tc on tc.id = tp.customer_id
    where t.delivered_at is not null
      and (tp.archived_at is null or t.delivered_at < tp.archived_at)
      and (tc.archived_at is null or t.delivered_at < tc.archived_at)
  union all
   select i.confirmed_at            as occurred_at,
          'invoice_confirmed'::text as kind,
          'invoice'::text           as entity,
          i.id                      as entity_id,
          coalesce(i.invoice_number, 'Invoice'::text) as title,
          c.name                    as subtitle,
          null::text                as actor
     from invoices i
     left join customers c on c.id = i.customer_id
    where i.confirmed_at is not null
      and (c.archived_at is null or i.confirmed_at < c.archived_at)
  union all
   select i.paid_at                 as occurred_at,
          'invoice_paid'::text      as kind,
          'invoice'::text           as entity,
          i.id                      as entity_id,
          coalesce(i.invoice_number, 'Invoice'::text) as title,
          c.name                    as subtitle,
          null::text                as actor
     from invoices i
     left join customers c on c.id = i.customer_id
    where i.paid_at is not null
      and (c.archived_at is null or i.paid_at < c.archived_at)
  union all
   select i.voided_at               as occurred_at,
          'invoice_voided'::text    as kind,
          'invoice'::text           as entity,
          i.id                      as entity_id,
          coalesce(i.invoice_number, 'Invoice'::text) as title,
          c.name                    as subtitle,
          i.unpaid_by               as actor
     from invoices i
     left join customers c on c.id = i.customer_id
    where i.voided_at is not null
      and (c.archived_at is null or i.voided_at < c.archived_at)
  union all
   select w.opened_at               as occurred_at,
          'work_order_opened'::text as kind,
          'work_order'::text        as entity,
          w.id                      as entity_id,
          coalesce(w.wo_number, 'Work order'::text) as title,
          tk.plate                  as subtitle,
          w.created_by              as actor
     from work_orders w
     left join trucks tk on tk.id = w.truck_id
    where w.opened_at is not null
  union all
   select w.closed_at                  as occurred_at,
          'work_order_completed'::text as kind,
          'work_order'::text           as entity,
          w.id                         as entity_id,
          coalesce(w.wo_number, 'Work order'::text) as title,
          tk.plate                     as subtitle,
          w.completed_by               as actor
     from work_orders w
     left join trucks tk on tk.id = w.truck_id
    where w.closed_at is not null
  union all
   select o.created_at              as occurred_at,
          'outsourced_opened'::text as kind,
          'outsourced_job'::text    as entity,
          o.id                      as entity_id,
          coalesce(o.os_number, 'Outsourced job'::text) as title,
          tk.plate                  as subtitle,
          o.created_by              as actor
     from outsourced_jobs o
     left join trucks tk on tk.id = o.truck_id
    where o.created_at is not null
  union all
   select o.closed_at                  as occurred_at,
          'outsourced_completed'::text as kind,
          'outsourced_job'::text       as entity,
          o.id                         as entity_id,
          coalesce(o.os_number, 'Outsourced job'::text) as title,
          tk.plate                     as subtitle,
          o.completed_by               as actor
     from outsourced_jobs o
     left join trucks tk on tk.id = o.truck_id
    where o.closed_at is not null
  union all
   select e.exited_at              as occurred_at,
          'permit_exited'::text    as kind,
          'exit_permit'::text      as entity,
          e.id                     as entity_id,
          coalesce(e.ep_number, 'Exit permit'::text) as title,
          e.receiver_name          as subtitle,
          e.exited_by              as actor
     from exit_permits e
    where e.exited_at is not null
  union all
   select e.voided_at              as occurred_at,
          'permit_voided'::text    as kind,
          'exit_permit'::text      as entity,
          e.id                     as entity_id,
          coalesce(e.ep_number, 'Exit permit'::text) as title,
          e.void_reason            as subtitle,
          e.voided_by              as actor
     from exit_permits e
    where e.voided_at is not null
  union all
   select ca.decided_at                as occurred_at,
          'consumption_decided'::text  as kind,
          'consumption_approval'::text as entity,
          ca.id                        as entity_id,
          ca.decision                  as title,
          null::text                   as subtitle,
          ca.decided_by                as actor
     from consumption_approvals ca
    where ca.decided_at is not null
  union all
   select po.issued_at             as occurred_at,
          'po_issued'::text        as kind,
          'purchase_order'::text   as entity,
          po.id                    as entity_id,
          coalesce(po.po_number, 'Purchase order'::text) as title,
          su.name                  as subtitle,
          po.requested_by          as actor
     from purchase_orders po
     left join suppliers su on su.id = po.supplier_id
    where po.issued_at is not null
  union all
   select po.rejected_at           as occurred_at,
          'po_rejected'::text      as kind,
          'purchase_order'::text   as entity,
          po.id                    as entity_id,
          coalesce(po.po_number, 'Purchase order'::text) as title,
          po.rejection_reason      as subtitle,
          po.rejected_by           as actor
     from purchase_orders po
    where po.rejected_at is not null
  union all
   select pa.approved_at           as occurred_at,
          'po_approved'::text      as kind,
          'purchase_order'::text   as entity,
          pa.purchase_order_id     as entity_id,
          coalesce(po.po_number, 'Purchase order'::text) as title,
          null::text               as subtitle,
          pa.approver_email        as actor
     from purchase_order_approvals pa
     left join purchase_orders po on po.id = pa.purchase_order_id
    where pa.approved_at is not null
  union all
   select sr.created_at            as occurred_at,
          'stock_received'::text   as kind,
          'stock_receipt'::text    as entity,
          sr.id                    as entity_id,
          coalesce(su.name, 'Stock receipt'::text) as title,
          wh.name                  as subtitle,
          sr.received_by           as actor
     from stock_receipts sr
     left join suppliers su on su.id = sr.supplier_id
     left join warehouses wh on wh.id = sr.warehouse_id
    where sr.created_at is not null
  union all
   select tu.created_at            as occurred_at,
          'topup_added'::text      as kind,
          'customer'::text         as entity,
          tu.customer_id           as entity_id,
          c.name                   as title,
          tu.reference             as subtitle,
          null::text               as actor
     from customer_topups tu
     left join customers c on c.id = tu.customer_id
    where tu.created_at is not null
      and (c.archived_at is null or tu.created_at < c.archived_at)
  union all
   select cp.paid_at               as occurred_at,
          'commission_paid'::text  as kind,
          'driver'::text           as entity,
          cp.driver_id             as entity_id,
          d.name                   as title,
          cp.period_label          as subtitle,
          cp.approved_by           as actor
     from commission_payouts cp
     left join drivers d on d.id = cp.driver_id
    where cp.paid_at is not null
  union all
   select x.created_at              as occurred_at,
          'expense_recorded'::text  as kind,
          'expense'::text           as entity,
          x.id                      as entity_id,
          x.category                as title,
          x.note                    as subtitle,
          x.entered_by              as actor
     from expenses x
    where x.created_at is not null
  union all
   select ad.created_at             as occurred_at,
          'document_filed'::text    as kind,
          'archive_document'::text  as entity,
          ad.id                     as entity_id,
          ad.title,
          ad.issuing_entity         as subtitle,
          ad.created_by             as actor
     from archive_documents ad
    where ad.created_at is not null;

alter view public.v_activity_feed set (security_invoker = true);
revoke all on public.v_activity_feed from anon;
grant select on public.v_activity_feed to authenticated;

comment on view public.v_activity_feed is
  'Dashboard activity feed, reconstructed from existing lifecycle timestamps across modules. No event-log table and no triggers. A state with no stored timestamp produces no event rather than an invented one. Callers apply their own ORDER BY / LIMIT. 0167 gates the FIVE customer/project branches (trip_delivered, invoice_confirmed, invoice_paid, invoice_voided, topup_added) on each branch''s own occurred_at against archived_at; the other fourteen branches touch neither and are unfiltered. Every such join is LEFT and the gate passes a NULL partner, so an event with no customer keeps appearing.';

-- ===========================================================================
-- SELF-ASSERTS — this migration fails loudly rather than half-applying
-- ===========================================================================
do $$
declare
  v_bad  text;
  v_n    int;
  v_seen int;
  v_os   numeric;
  v_ex   numeric;
begin
  -- 1. Security footer intact on all NINE touched views.
  --    v_customer_prepaid_balance is NOT in this list and must not be added:
  --    it is out of scope (see (C) in the header), so its footer is not this
  --    migration's to guarantee.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in (
      'v_os_cost_monthly','v_maintenance_cost_per_truck_monthly','v_daily_operations',
      'v_revenue_invoices','v_invoice_outstanding_live','v_revenue_sales_returns',
      'v_topups_monthly','v_driver_commission_by_project_monthly',
      'v_activity_feed')
    and (
      not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
      or has_table_privilege('anon', c.oid, 'select')
      or not has_table_privilege('authenticated', c.oid, 'select')
    );
  if v_bad is not null then
    raise exception '0167: security footer wrong on: %', v_bad;
  end if;

  -- 2. All nine still exist (a typo in a view name would otherwise pass check 1
  --    by matching nothing at all).
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and c.relname in (
      'v_os_cost_monthly','v_maintenance_cost_per_truck_monthly','v_daily_operations',
      'v_revenue_invoices','v_invoice_outstanding_live','v_revenue_sales_returns',
      'v_topups_monthly','v_driver_commission_by_project_monthly',
      'v_activity_feed');
  if v_n <> 9 then
    raise exception '0167: expected 9 touched views, found %', v_n;
  end if;

  -- 3. FIX 1 landed: the P&L cost equals subtotal net of discount, and is short
  --    of the VAT-inclusive total by exactly the VAT.
  select coalesce(sum(os_cost_sar), 0) into v_os from v_os_cost_monthly;
  select coalesce(sum(subtotal_sar - discount_sar), 0) into v_ex from workshop_payments;
  if v_os <> v_ex then
    raise exception '0167: v_os_cost_monthly totals % but workshop ex-VAT net of discount is %', v_os, v_ex;
  end if;

  -- 4. FIX 1 is COMPLETE: no view anywhere still reads workshop_payments while
  --    the P&L is ex-VAT. Exactly three views may read that table, and all
  --    three are rewritten above.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from (
    select distinct c.oid, c.relname
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class
    where d.refobjid = 'public.workshop_payments'::regclass and c.relkind = 'v'
  ) c
  where c.relname not in ('v_os_cost_monthly','v_maintenance_cost_per_truck_monthly','v_daily_operations');
  if v_bad is not null then
    raise exception '0167: unexpected view reads workshop_payments and was not converted: %', v_bad;
  end if;

  -- 5. THE CASH VIEWS WERE NOT TOUCHED. VAT-inclusive is correct for money that
  --    actually moved; this asserts the fix did not overreach.
  if (select pg_get_viewdef('public.v_collections_monthly'::regclass, true)) not like '%grand_total_sar%' then
    raise exception '0167: v_collections_monthly lost grand_total_sar — cash views stay VAT-inclusive';
  end if;
  if (select pg_get_viewdef('public.v_purchasing_spend_monthly'::regclass, true)) not like '%grand_total_sar%' then
    raise exception '0167: v_purchasing_spend_monthly lost grand_total_sar — cash views stay VAT-inclusive';
  end if;

  -- 6. FIX 2 landed on the six views that carry the condition directly. Two more
  --    (v_revenue_monthly, v_receivables_open) inherit it and are checked by
  --    data, not by body text — see the read-only checks in the delivery notes.
  --    v_customer_prepaid_balance is out of scope and is NOT checked here: this
  --    assert must not fail looking for a change that was deliberately removed.
  select string_agg(v.relname, ', ' order by v.relname) into v_bad
  from (values
    ('v_revenue_invoices'),('v_invoice_outstanding_live'),('v_revenue_sales_returns'),
    ('v_topups_monthly'),('v_driver_commission_by_project_monthly'),
    ('v_activity_feed')
  ) as v(relname)
  where pg_get_viewdef(('public.' || v.relname)::regclass, true) not like '%archived_at%';
  if v_bad is not null then
    raise exception '0167: archive gate missing from: %', v_bad;
  end if;

  -- 7. COMMISSION EARNED BEFORE AN ARCHIVE STAYS OWED. Turki's rule as an
  --    invariant rather than a spot check: the view must report EXACTLY the
  --    delivered trips of archived entities that predate their archive — not
  --    one fewer (money erased) and not one more (rule not applied).
  --
  --    Counted, never assumed to be non-empty. An earlier draft asserted "some
  --    archived project still reports commission", which passes vacuously on
  --    data where no archived project has pre-archive trips — exactly the data
  --    that exists today. A check that cannot fail is not a check.
  select count(*) into v_n
  from trips t
  join projects p on p.id = t.project_id
  join customers pc on pc.id = p.customer_id
  where t.stage = 'delivered'
    and t.driver_id is not null
    and (p.archived_at is not null or pc.archived_at is not null)
    and (p.archived_at is null or t.delivered_at < p.archived_at)
    and (pc.archived_at is null or t.delivered_at < pc.archived_at);

  select coalesce(sum(m.trips_delivered), 0) into v_seen
  from v_driver_commission_by_project_monthly m
  join projects p on p.id = m.project_id
  join customers pc on pc.id = p.customer_id
  where p.archived_at is not null or pc.archived_at is not null;

  if v_n <> v_seen then
    raise exception '0167: archived entities have % pre-archive delivered trips but the commission view reports % — the gate is wrong in the money-losing direction', v_n, v_seen;
  end if;

  raise notice '0167 applied: 9 views replaced — 3 cost views ex-VAT net of discount (P&L cost now %), 6 gated on archived_at, 2 more inherit; cash views untouched, v_customer_prepaid_balance deliberately out of scope', v_ex;
end $$;

commit;
