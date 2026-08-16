-- 0129_delivered_revenue_frozen_rate.sql
-- The Dashboard's delivered revenue bills from the FROZEN trip rate, like
-- prepaid and invoices already do.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and applies.
--
-- ===========================================================================
-- A DEFECT THIS WORKSTREAM CREATED, CLOSED BEFORE IT COULD BITE
-- ===========================================================================
-- `d0813b9` switched prepaid consumption and invoice lines onto the frozen
-- `trips.rate_sar`. This view was left pricing each delivered trip at its
-- PROJECT'S CURRENT rate, so from the first rate change onward the Dashboard's
-- delivered revenue would disagree with what the customer is actually billed —
-- one number, two ways, on two screens.
--
-- It is the same defect class this session has spent several rounds closing
-- (two cost doughnuts with swapped colours; the CustomersTab revenue basis;
-- truck status derived twice). The difference is that this one was NEWLY
-- CREATED rather than inherited, which is exactly why it gets closed now
-- instead of being written into the deferred tail.
--
-- ===========================================================================
-- SAFE NOW BECAUSE IT IS A NO-OP — PROVEN, NOT ASSUMED
-- ===========================================================================
-- No rate has ever moved, so the two bases agree on every existing trip. The
-- replacement definition was run against live data BEFORE drafting and returns
-- exactly what the live view returns:
--
--     month      revenue      priced  unpriced
--     2026-06      6,200.00      22       0
--     2026-07     43,170.00     130       1
--     2026-08    187,750.00     585       0
--     TOTAL      237,120.00     737       1
--
-- Switching while it CANNOT move a figure is the same principle every
-- structural change in this workstream followed: land it when the before/after
-- is provably identical, not after a rate change when several figures move at
-- once and there is nothing clean to diff against.
--
-- ===========================================================================
-- THE UNPRICED SPLIT IS PRESERVED, AND THE ORPHAN IS WHY IT EXISTS
-- ===========================================================================
-- One delivered trip has NO PROJECT and therefore no frozen rate. It must keep
-- counting as UNPRICED — never billed at zero, never at an invented rate. That
-- is the same refusal 0128's backfill made when it declined to stamp it.
--
-- The split simply moves onto the same column as the money:
--     priced    = count(*) filter (where t.rate_sar is not null)
--     unpriced  = count(*) filter (where t.rate_sar is null)
-- Live, that is 737 / 1 both before and after — the orphan is the 1, in July.
--
-- ===========================================================================
-- THE `projects` JOIN IS DROPPED, DELIBERATELY
-- ===========================================================================
-- Once the rate comes from the trip, the LEFT JOIN to projects has no purpose.
-- Removing it is not tidying: while it remains, the view still MENTIONS
-- `rate_per_trip_sar`, and the next person changing this file could reasonably
-- reach for it again. The simulation above was run WITHOUT the join and returned
-- identical rows — a LEFT JOIN that is read by nothing cannot change a row count.
--
-- ===========================================================================
-- AFTER THIS, ALL FOUR CONSUMERS READ ONE RATE BASIS — KEEP THEM ALIGNED
-- ===========================================================================
--   prepaid consumption   ConsumingTrip.rate_sar   <- trips.rate_sar  (d0813b9)
--   invoice lines         ConsumingTrip.rate_sar   <- trips.rate_sar  (d0813b9)
--   delivered revenue     this view                <- trips.rate_sar  (0129)
--   Customers Revenue KPI CustomersTab.tsx         <- trips.rate_sar  (0129)
--
-- THAT ALIGNMENT IS THE POINT OF THE CHANGE, not a side effect. Anything that
-- reaches for `projects.rate_per_trip_sar` to price DELIVERED work is
-- reintroducing the defect this file removes — the project rate is what NEW work
-- will cost, not what past work did.
--
-- THE FOURTH SURFACE WAS FOUND BY ITS OWN COMMENT. CustomersTab's Revenue KPI
-- summed the project's CURRENT rate while claiming in a comment to "reconcile to
-- v_delivered_revenue_daily riyal-for-riyal". True the day it was written; false
-- from the first rate change. It ships in this same batch, on the same column,
-- with the comment rewritten to state the basis rather than assert the outcome —
-- a comment that names WHY two numbers agree survives a change that a comment
-- merely asserting they agree does not.
--
-- ===========================================================================
-- WHAT IS NOT TOUCHED
-- ===========================================================================
-- · The DASHBOARD-ONLY rule from 0108/0109 stands: this is EARNED revenue, never
--   billed revenue, and `v_revenue_monthly` / `v_pnl_monthly` remain the only
--   revenue the P&L knows. Never add the two.
-- · The `trip_date` bucketing 0109 corrected to. Untouched.
-- · trips.rate_sar itself — this reads it, nothing here writes it.
-- · lib/prepaid.ts, lib/vat.ts, invoice math.
-- ===========================================================================

begin;

-- create-or-replace: the five columns are reproduced EXACTLY in order and type
-- (day, month, delivered_revenue_sar, delivered_trips_priced,
-- delivered_trips_unpriced). Nothing added, nothing removed — 42P16.
create or replace view public.v_delivered_revenue_daily as
 WITH spine AS (
         SELECT generate_series((( SELECT min(v_report_months.month) AS min
                   FROM v_report_months))::timestamp with time zone, GREATEST(CURRENT_DATE, (now() AT TIME ZONE 'Asia/Riyadh'::text)::date)::timestamp with time zone, '1 day'::interval)::date AS day
        ), delivered AS (
         SELECT t.trip_date AS day,
            -- FROZEN rate: what this trip was worth on the day it was
            -- delivered, matching prepaid consumption and invoice lines.
            sum(COALESCE(t.rate_sar, 0::numeric)) AS revenue_sar,
            count(*) FILTER (WHERE t.rate_sar IS NOT NULL)::integer AS priced,
            -- The project-less trip has no frozen rate and stays UNPRICED —
            -- counted honestly rather than billed at zero.
            count(*) FILTER (WHERE t.rate_sar IS NULL)::integer AS unpriced
           FROM trips t
          WHERE t.stage = 'delivered'::text
          GROUP BY t.trip_date
        )
 SELECT s.day,
    date_trunc('month'::text, s.day::timestamp with time zone)::date AS month,
    COALESCE(d.revenue_sar, 0::numeric) AS delivered_revenue_sar,
    COALESCE(d.priced, 0) AS delivered_trips_priced,
    COALESCE(d.unpriced, 0) AS delivered_trips_unpriced
   FROM spine s
     LEFT JOIN delivered d ON d.day = s.day;

-- create-or-replace does NOT preserve reloptions (CLAUDE.md section 6).
alter view public.v_delivered_revenue_daily set (security_invoker = true);
revoke all on public.v_delivered_revenue_daily from anon;
grant select on public.v_delivered_revenue_daily to authenticated;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) BYTE-IDENTICAL TODAY. Capture BEFORE applying and compare after:
--      select to_char(month,'YYYY-MM') as month,
--             sum(delivered_revenue_sar) as revenue,
--             sum(delivered_trips_priced) as priced,
--             sum(delivered_trips_unpriced) as unpriced
--        from public.v_delivered_revenue_daily group by 1
--      union all
--      select 'TOTAL', sum(delivered_revenue_sar), sum(delivered_trips_priced),
--             sum(delivered_trips_unpriced) from public.v_delivered_revenue_daily
--      order by 1;
--      -- expect, unchanged:
--      --   2026-06     6,200.00    22 priced   0 unpriced
--      --   2026-07    43,170.00   130 priced   1 unpriced
--      --   2026-08   187,750.00   585 priced   0 unpriced
--      --   TOTAL     237,120.00   737 priced   1 unpriced
--      -- AUGUST GROWS with ongoing deliveries — if time has passed, re-take the
--      -- BEFORE rather than reconciling against the row above. June and July are
--      -- closed and must not move.
--
-- B) THE ORPHAN IS STILL COUNTED, NOT BILLED. Expect 1 row, revenue 0:
--      select t.ref, t.stage, t.project_id, t.rate_sar
--        from public.trips t
--       where t.stage = 'delivered' and t.rate_sar is null;
--      -- exactly one row, project_id NULL. It contributes 0.00 to revenue and
--      -- 1 to delivered_trips_unpriced. If it ever shows a rate, something
--      -- invented one — see 0128's refusal to stamp it.
--
-- C) THE VIEW NO LONGER MENTIONS THE CURRENT RATE. Expect false / true:
--      select pg_get_viewdef('public.v_delivered_revenue_daily'::regclass,true) ~ 'rate_per_trip_sar'
--               as still_reads_project_rate,
--             pg_get_viewdef('public.v_delivered_revenue_daily'::regclass,true) ~ 't\.rate_sar'
--               as reads_frozen_rate;
--
-- D) SHAPE AND SECURITY.
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_delivered_revenue_daily'
--       order by ordinal_position;
--      -- day, month, delivered_revenue_sar, delivered_trips_priced,
--      -- delivered_trips_unpriced — same order, same types.
--
--      select c.reloptions,
--             has_table_privilege('anon', c.oid,'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid,'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='v_delivered_revenue_daily';
--      -- {security_invoker=true}, anon FALSE, authenticated TRUE.
--
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relkind='v';
--      -- expect 40 / 40 / 0 — this replaces a view, it does not add one.
--
-- E) THE INTENDED NEW BEHAVIOUR — the test that proves WHY this was done. It
--    writes a project rate, so it runs inside a transaction that is ROLLED BACK,
--    with a post-rollback check.
--
--      -- BEFORE:
--      select sum(delivered_revenue_sar) from public.v_delivered_revenue_daily;  -- 237,120.00
--
--      begin;
--        update public.projects set rate_per_trip_sar = rate_per_trip_sar + 50
--         where name = 'Airport facilities';
--
--        select sum(delivered_revenue_sar) from public.v_delivered_revenue_daily;
--        -- MUST STILL READ 237,120.00. Past delivered trips hold their frozen
--        -- rate, exactly as prepaid and invoices now do.
--        --
--        -- UNDER THE OLD DEFINITION this would have read 237,120 + (80 x 50) =
--        -- 241,120 — the retroactive repricing this migration removes, and the
--        -- figure that would have disagreed with the customer's bill.
--      rollback;
--
--      -- CONFIRM THE RESTORE — mandatory, it wrote a rate:
--      select rate_per_trip_sar from public.projects where name = 'Airport facilities';
--      -- expect 410.00
--      select sum(delivered_revenue_sar) from public.v_delivered_revenue_daily;  -- 237,120.00
--
-- F) THE THREE CONSUMERS AGREE. Delivered trips priced on one basis everywhere:
--      select sum(t.rate_sar) filter (where t.stage='delivered') as frozen_all_trips
--        from public.trips t;
--      -- 237,120.00 — the same total this view reports, because both now read
--      -- the same column. Prepaid reads it per project through
--      -- ConsumingTrip.rate_sar; invoices through the same type.
-- ===========================================================================
