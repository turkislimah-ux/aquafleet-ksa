-- 0185 — WITHIN-MONTH NET COLLECTION RATE
--
-- WHY
-- ---
-- The Reports "Collected" card carried a foot reading "{v} of revenue",
-- computed in TS by lib/reports.ts's cashCoverage() as:
--
--     v_collections_monthly.collected_gross_sar   (VAT-INCLUSIVE, by paid_at)
--   / v_pnl_monthly.revenue_sar                   (VAT-EXCLUSIVE, by confirmed_at)
--
-- Three defects stacked in one number:
--   1. GROSS over NET — inflates the ratio by ~1.15x before any real signal.
--   2. DIFFERENT POPULATIONS — a paid_at numerator over a confirmed_at
--      denominator is not a coverage of the same thing, so it is unbounded.
--      Measured live: August 2026 read 109,020.00 / 50,700.00 = 215%.
--   3. It was named and documented as CASH. Since prepaid landed, an invoice
--      settled with payment_method='balance' moves NO cash — the cash arrived
--      earlier, at top-up. August 2026 was 105,225.00 of 109,020.00 balance.
--
-- Turki's ruling: the Collected KPI STAYS on settlement basis ("value of
-- invoices settled this month"), and its number does NOT change. So
-- v_collections_monthly is deliberately NOT TOUCHED by this migration — not
-- its logic, not its columns, not one value.
--
-- This migration therefore changes NO EXISTING FIGURE anywhere. It does ONE
-- thing: it redefines the RATIO printed under the card, by appending one new
-- column to two views. No existing column, and no existing row, is touched.
--
-- The companion change — stopping the metric dictionary from DESCRIBING that
-- unchanged Collected figure as "cash" — was split out into 0186. It edits a
-- TABLE (report_metrics), not a view, shares no object with this file, and the
-- two may run in either order. They are run together only for tidiness.
--
-- WHAT
-- ----
-- A within-month net collection rate: of the revenue BILLED in month M, how
-- much was also SETTLED inside M. Net over net, same population, therefore
-- <= 100% BY CONSTRUCTION rather than by hope — the numerator is a FILTERED
-- SUBSET of the very rows the denominator sums, not a second query against a
-- second view.
--
--     numerator   = sum(revenue_sar) over v_revenue_invoices rows that are
--                   settled and whose settle-month equals their confirm-month
--     denominator = sum(revenue_sar)            (existing, unchanged)
--
-- SETTLED PREDICATE — reused, not reinvented. v_collections_monthly counts an
-- invoice when `paid_at is not null and voided_at is null`. v_revenue_invoices
-- already carries `voided_at is null` in its own WHERE, so `paid_at is not
-- null` here is that identical predicate, not a second definition of settled.
--
-- MONTH BUCKETING — Riyadh-local for BOTH timestamps, per the project's
-- local-date convention (todayKey / `at time zone 'Asia/Riyadh'`, the same
-- form 0105/0109/0130 use). Measured 2026-09-08: ZERO invoices currently
-- straddle a UTC-vs-Riyadh month boundary on either confirmed_at or paid_at,
-- so this changes no present value — it is correct-going-forward, and the
-- reason to write it now rather than after the first 22:00-Riyadh confirm.
--
-- The same-month test is a property OF THE INVOICE (was it settled in the
-- month it was billed), evaluated Riyadh-local, and is then aggregated into
-- the EXISTING `month` bucket. That is what keeps the subset guarantee intact:
-- whichever bucket a row lands in, its numerator contribution lands in the
-- same one.
--
-- WHY THE COLUMN RIDES THE REVENUE CHAIN AND NOT THE COLLECTIONS VIEW
-- ------------------------------------------------------------------
-- The denominator lives on v_pnl_monthly (read as `p` in OverviewTab, where
-- withinMonthCollectionRate is called).
-- Putting the numerator on the SAME ROW means the ratio reads two columns of
-- one object — no second fetch, and no possibility of pairing month M's
-- numerator with month N's denominator.
--
-- v_revenue_invoices is NOT modified: it already exposes confirmed_at, paid_at
-- and revenue_sar, which is everything the filter needs. Two views change, not
-- three.
--
-- APPEND ONLY. `create or replace view` cannot insert, reorder, rename or
-- retype a column (42P16), and both views carry dependents:
--   v_revenue_monthly  <- v_pnl_monthly
--   v_pnl_monthly      <- v_cost_composition_monthly, v_pnl_by_period
-- Each new column therefore goes LAST, and every existing column keeps its
-- ordinal, name, type and expression byte-for-byte.
--
-- BARE STATEMENTS — no begin;/commit; (CLAUDE.md §5, 0173+). The SQL Editor
-- already wraps each submission in its own transaction.

-- ---------------------------------------------------------------------------
-- 1. v_revenue_monthly — append settled_same_month_revenue_sar
-- ---------------------------------------------------------------------------
-- Existing four columns reproduced EXACTLY as pg_get_viewdef returned them.
create or replace view public.v_revenue_monthly as
  select m.month,
         coalesce(sum(r.revenue_sar), 0::numeric)          as revenue_sar,
         coalesce(sum(r.vat_sar), 0::numeric)              as vat_sar,
         coalesce(count(r.invoice_id), 0::bigint)          as invoice_count,
         coalesce(count(distinct r.customer_id), 0::bigint) as customer_count,
         -- APPENDED (0185). Net revenue billed in this month that was ALSO
         -- settled in this month, Riyadh-local on both sides. A filtered
         -- subset of revenue_sar above, hence <= it by construction.
         coalesce(
           sum(r.revenue_sar) filter (
             where r.paid_at is not null
               and date_trunc('month', (r.paid_at      at time zone 'Asia/Riyadh'))::date
                 = date_trunc('month', (r.confirmed_at at time zone 'Asia/Riyadh'))::date
           ), 0::numeric
         ) as settled_same_month_revenue_sar
    from v_report_months m
    left join v_revenue_invoices r on r.month = m.month
   group by m.month;

alter view public.v_revenue_monthly set (security_invoker = true);
revoke all on public.v_revenue_monthly from anon;
grant select on public.v_revenue_monthly to authenticated;

comment on view public.v_revenue_monthly is
  'Billed revenue per month, EX-VAT, bucketed by the month the invoice was CONFIRMED. settled_same_month_revenue_sar (0185, appended LAST — 42P16, and v_pnl_monthly depends on this view) is the subset of revenue_sar whose invoices were also SETTLED within the same month, using v_collections_monthly''s settled predicate (paid_at not null; voided_at already excluded upstream by v_revenue_invoices) and Riyadh-local month bucketing on BOTH confirmed_at and paid_at. It is a filtered subset of revenue_sar, never a separate measure, so numerator <= denominator holds by construction. It does NOT equal v_collections_monthly.collected_gross_sar and is not meant to: that figure is VAT-INCLUSIVE, bucketed by paid_at alone, and unscoped by the archived-customer filter v_revenue_invoices applies.';

-- ---------------------------------------------------------------------------
-- 2. v_pnl_monthly — pass the new column through, LAST
-- ---------------------------------------------------------------------------
-- Every existing column reproduced EXACTLY (same order, same expressions) so
-- this is a pure append. filling_cost_sar / filling_uncosted_trips keep the
-- trailing positions 0112 gave them; the new column goes after both.
create or replace view public.v_pnl_monthly as
  select r.month,
         r.revenue_sar,
         p.parts_cost_sar,
         o.os_cost_sar,
         y.staff_salary_sar + y.driver_salary_sar as payroll_sar,
         c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar as commissions_sar,
         p.parts_cost_sar + o.os_cost_sar + y.staff_salary_sar + y.driver_salary_sar
           + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
           + f.filling_cost_sar as operating_cost_sar,
         r.revenue_sar - (p.parts_cost_sar + o.os_cost_sar + y.staff_salary_sar + y.driver_salary_sar
           + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
           + f.filling_cost_sar) as operating_profit_sar,
         e.expenses_sar,
         r.revenue_sar - (p.parts_cost_sar + o.os_cost_sar + y.staff_salary_sar + y.driver_salary_sar
           + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
           + f.filling_cost_sar) - e.expenses_sar as net_profit_sar,
         case
           when r.revenue_sar > 0::numeric then round(
             (r.revenue_sar - (p.parts_cost_sar + o.os_cost_sar + y.staff_salary_sar + y.driver_salary_sar
               + c.trip_commission_sar + c.specials_sar + c.adjustments_sar + c.bonus_sar
               + f.filling_cost_sar)) / r.revenue_sar * 100::numeric, 1)
           else null::numeric
         end as operating_margin_pct,
         f.filling_cost_sar,
         f.uncosted_trips as filling_uncosted_trips,
         -- APPENDED (0185). Pure passthrough — nothing recomputed here, so the
         -- ratio's numerator and denominator are two columns of ONE row.
         r.settled_same_month_revenue_sar
    from v_revenue_monthly r
    join v_parts_cost_monthly p using (month)
    join v_os_cost_monthly o using (month)
    join v_payroll_monthly y using (month)
    join v_commissions_monthly c using (month)
    join v_expenses_monthly e using (month)
    join v_filling_cost_monthly f using (month);

alter view public.v_pnl_monthly set (security_invoker = true);
revoke all on public.v_pnl_monthly from anon;
grant select on public.v_pnl_monthly to authenticated;

comment on view public.v_pnl_monthly is
  'Monthly P&L, assembled from the component views — nothing recomputed. operating_cost_sar is FIVE buckets as of 0112: parts, outsourced, payroll, commissions and filling. filling_cost_sar sits near the END of the column list because create-or-replace cannot insert mid-list (42P16) and v_pnl_by_period depends on this view. filling_uncosted_trips is filled trips with no price for their water type — cost unknown, not zero. settled_same_month_revenue_sar (0185) is appended LAST for the same 42P16 reason and is a straight passthrough from v_revenue_monthly: the net revenue billed in the month that was also settled within it. It rides this view so the within-month collection rate reads numerator and denominator off ONE row — it is NOT a P&L line and must never enter operating_cost_sar, operating_profit_sar or net_profit_sar.';

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after apply; read-only, safe to re-run)
--
-- NOTE: a result grid is a claim, not evidence (CLAUDE.md §5). A and B below
-- read the CATALOG, which is the evidence. Expect the stated shapes.
-- ---------------------------------------------------------------------------
--
-- A. APPEND-ONLY, and the new column is last with the expected type.
--    Expect settled_same_month_revenue_sar at attnum 6 on v_revenue_monthly
--    and attnum 14 on v_pnl_monthly, both `numeric`, and every OTHER column
--    unchanged in name/ordinal/type.
-- select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as typ
--   from pg_attribute a join pg_class c on c.oid = a.attrelid
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('v_revenue_monthly','v_pnl_monthly')
--    and a.attnum > 0 and not a.attisdropped
--  order by c.relname, a.attnum;
--
-- B. SECURITY FOOTER survived both replacements. Expect 2 rows, both
--    security_invoker = true and anon_readable = false.
-- select c.relname,
--        c.reloptions::text[] @> array['security_invoker=true'] as security_invoker,
--        has_table_privilege('anon', c.oid, 'select')           as anon_readable
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('v_revenue_monthly','v_pnl_monthly');
--
-- C. THE SUBSET GUARANTEE. Expect ZERO rows — any row here is a broken
--    invariant, not a rounding artefact.
-- select month, revenue_sar, settled_same_month_revenue_sar
--   from public.v_revenue_monthly
--  where settled_same_month_revenue_sar > revenue_sar;
--
-- D. NOTHING EXISTING MOVED. Expect ZERO rows: v_pnl_monthly's revenue_sar
--    must still equal v_revenue_monthly's, and both must still equal the
--    figures measured before this migration (0 / 70,650.00 / 50,700.00 /
--    8,470.00 for 2026-06 .. 2026-09).
-- select p.month, p.revenue_sar as pnl, r.revenue_sar as rev
--   from public.v_pnl_monthly p join public.v_revenue_monthly r using (month)
--  where p.revenue_sar <> r.revenue_sar;
--
-- E. THE RATIO ITSELF. Expect 2026-07 = 37.6, 2026-08 = 100.0,
--    2026-09 = 100.0, 2026-06 = NULL (no revenue — a rate on nothing is not
--    a number), and rate_pct <= 100 on every row.
-- select month, revenue_sar, settled_same_month_revenue_sar,
--        round(100 * settled_same_month_revenue_sar / nullif(revenue_sar, 0), 1) as rate_pct
--   from public.v_pnl_monthly order by month;
--
-- F. v_collections_monthly WAS NOT TOUCHED. Expect its four rows unchanged:
--    2026-06 = 0, 2026-07 = 30,532.50, 2026-08 = 109,020.00,
--    2026-09 = 9,740.50. If any of these moved, this migration overreached.
-- select month, collected_gross_sar, invoices_paid
--   from public.v_collections_monthly order by month;
--
-- G. NOTHING ELSE IN public CHANGED SHAPE. This file replaces exactly two
--    views; 0186 is the only file that touches report_metrics. Expect the
--    three counts to MATCH (CLAUDE.md §6 — the equality is the check, not
--    the number; 50 / 50 / 0 as measured 2026-09-08, and the new column
--    adds no view, so 50 / 50 / 0 again after this runs).
-- select count(*) as views,
--        count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--        count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where c.relkind = 'v' and n.nspname = 'public';
