-- 0124_dictionary_filling_cost.sql
-- Add the missing fifth operational cost bucket to the metrics dictionary.
-- DICTIONARY INSERT ONLY — no view, no RPC, no measure change.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews the entry text against live
-- data, confirms the fence move is exactly one key, and applies.
--
-- ===========================================================================
-- THE GAP 0123 FLAGGED
-- ===========================================================================
-- v_pnl_monthly and v_pnl_by_period have both carried filling_cost_sar and
-- filling_uncosted_trips since 0112/0113, and filling is a real P&L bucket —
-- the cost-mix doughnut's fifth slice, the one CLAUDE.md section 7 records as
-- having silently stopped footing for three months. But no dictionary entry
-- existed, so the vocabulary described FOUR of the five operational cost
-- buckets. A reader or an agent trusting the dictionary alone would conclude
-- filling is not a measured cost at all.
--
-- Turki ruled: add it, and make it selectable in the custom report builder.
--
-- ===========================================================================
-- IT IS A DIRECT-MAPPING BUCKET, NOT A COMPOSED ONE
-- ===========================================================================
-- 0123 had to split its ten metrics into direct and composed, because
-- v_payroll_monthly and v_commissions_monthly carry components that the period
-- view only exposes as a combined total. Filling is NOT one of those: its month
-- view publishes filling_cost_sar directly, exactly like v_revenue_monthly,
-- v_parts_cost_monthly, v_os_cost_monthly and v_expenses_monthly.
--
-- So the two-source pointer is the plain form, and it is TRUE — verified live
-- before drafting, all 3 months:
--
--   select count(*) as month_rows,
--          count(*) filter (where m.filling_cost_sar is distinct from p.filling_cost_sar
--                             or m.filling_uncosted_trips is distinct from p.filling_uncosted_trips)
--            as mismatched
--     from public.v_pnl_monthly m
--     join public.v_pnl_by_period p
--       on p.period_type = 'month' and p.period_start = m.month;
--   -- 3 rows, 0 mismatched.
--
-- ===========================================================================
-- THE CAVEAT IS THE WHOLE REASON THIS IS NOT A CLONE OF parts_cost
-- ===========================================================================
-- Filling is the only cost bucket with an UNCOSTED COMPANION. filling_cost_sar
-- totals the trips that HAD a price; a trip whose station/type pair carries no
-- price — grandfathered rows that predate per-type pricing — is excluded from
-- the money and counted separately in filling_uncosted_trips.
--
-- That means the total is SHORT by an unknown amount rather than complete, and
-- anyone reconciling filling cost against a trip count will be out unless they
-- know it. Live: 10 uncosted in June, 3 in July, 0 in August, against
-- 210.00 / 1,285.00 / 5,185.00 and 18 / 143 / 598 costed trips.
--
-- 0114's guard means no NEW uncosted trip can be created, so that count is
-- historical and fixed — but the historical total stays short, which is exactly
-- what the caveat has to say.
--
-- ===========================================================================
-- THE KEY, AND THE ROW SHAPE
-- ===========================================================================
-- metric_key = 'filling_cost'. Confirmed unused: zero existing keys match
-- '%fill%' (checked live). It follows the sibling naming style — os_cost,
-- payroll_cost, commissions_cost.
--
-- Every column is populated in the same style as parts_cost_at_consumption and
-- os_cost, whose full rows were read and mirrored rather than paraphrased, so
-- the dictionary reads consistently: a one-line `meaning`, a `formula` naming
-- the actual source columns, basis 'accrual', the 0123 two-source `source_view`
-- form, and grain 'one month, quarter or year'.
--
-- ===========================================================================
-- THIS ONE DOES MOVE THE FINGERPRINT — AND THAT IS THE INTENT
-- ===========================================================================
-- 0123's safety check was that the metric_key fingerprint stayed IDENTICAL,
-- proving a text-only change could not alter what the builder offers. This
-- migration is the opposite: a new pickable metric is the point.
--
--   before  29 keys  b3bbb25d7b3d5e59e18dcf83a79b4f51
--   after   30 keys  c4e9e453bafe97f19512423eca188f1a
--
-- Recorded here so the change is an ASSERTED expectation rather than a
-- surprise, and so a future drift check has the intended value to compare to.
--
-- ===========================================================================
-- THE FENCE MOVE — APP-SIDE, AND ALREADY COMMITTED
-- ===========================================================================
-- The dictionary row alone does NOT make the metric appear. lib/report-builder
-- keeps a module-private BUILDER_METRICS catalogue and offers a block only where
-- both agree: `BUILDER_METRICS.filter(m => known.has(m.key))`. So the fence
-- needed one entry too, plus the plumbing to carry the figure:
--
--   · Bucket gained a `filling` field (+ EMPTY), because the builder's
--     accumulator had no slot for it — the figure was fetched but never bucketed.
--   · The by-period branch sets `b.filling = p.filling_cost_sar`. PnlPeriodRow
--     ALREADY carried filling_cost_sar (lib/reports.ts), so no new query, no new
--     view read, nothing else to fetch.
--   · ONE new BUILDER_METRICS row: key 'filling_cost', groupings ["period"],
--     kind "sum", field "filling".
--
-- GROUPINGS ARE PERIOD-ONLY ON PURPOSE, matching the four buckets around it. The
-- figure comes from PnlPeriodRow, which is per-period; there is no per-customer
-- or per-truck filling view, so offering those groupings would promise a number
-- that does not exist.
--
-- ORDER IS SAFE IN BOTH DIRECTIONS. The app change is inert until this migration
-- lands: with 'filling_cost' absent from report_metrics, availableMetrics filters
-- the row out and the block simply does not appear. It fails CLOSED, which is
-- why the app could be committed first.
--
-- DELIBERATELY NOT TOUCHED: lib/dashboard-widgets' WIDGET_CATALOGUE, the Add
-- Summary fence. That is a different surface — a Dashboard TILE, with its own
-- bilingual label, display modes and href, and its own value plumbing. The
-- ruling was builder-eligibility; adding a Dashboard tile was not asked for and
-- is a one-line follow-up if it is ever wanted.
-- ===========================================================================

begin;

-- Idempotent: re-running updates the same row rather than erroring, matching
-- the on-conflict form 0100 used for this table.
insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat)
values (
  'filling_cost',
  'Water filling cost',
  'What water stations charged us to fill the trucks.',
  'Sum of trips.filling_cost_sar — the price frozen onto each trip at capture — '
    || 'for trips that have reached loading, in_transit or delivered, by trip month.',
  'SAR',
  'one month, quarter or year',
  'v_filling_cost_monthly (month) · v_pnl_by_period.filling_cost_sar (month, quarter or year)',
  'accrual',
  'THE TOTAL EXCLUDES UNPRICED TRIPS AND IS SHORT BY AN UNKNOWN AMOUNT. '
    || 'filling_cost_sar covers only trips that carried a filling price; a trip whose '
    || 'station did not price its water type — grandfathered rows predating per-type '
    || 'pricing — contributes nothing and is counted separately as uncosted_trips. '
    || 'Live: 10 uncosted in June, 3 in July, 0 in August. Anyone reconciling this cost '
    || 'against a trip count must read the uncosted figure beside it. Since 0114 no NEW '
    || 'uncosted trip can be created, so the count is historical and fixed — but the '
    || 'historical total stays short. A SCHEDULED trip has not filled yet and is '
    || 'excluded entirely, so summing trips.filling_cost_sar raw will EXCEED this view.'
)
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE DICTIONARY IS 30 ROWS. Expect 30:
--      select count(*) as metrics from public.report_metrics;
--
-- B) THE NEW ENTRY IS RIGHT. Expect one row, all three flags true:
--      select metric_key, grain, basis, unit,
--             (source_view like 'v_filling_cost_monthly%')      as names_month_view,
--             (source_view like '%v_pnl_by_period.filling_cost_sar%') as names_period_view,
--             (caveat ilike '%short by an unknown amount%')     as has_uncosted_caveat
--        from public.report_metrics where metric_key = 'filling_cost';
--      -- expect grain 'one month, quarter or year', basis 'accrual', unit 'SAR'.
--
-- C) THE FIVE OPERATIONAL COST BUCKETS ARE NOW ALL PRESENT. Expect 5 rows:
--      select metric_key from public.report_metrics
--       where metric_key in ('parts_cost_at_consumption','os_cost','payroll_cost',
--                            'commissions_cost','filling_cost')
--       order by metric_key;
--      -- This is the gap closing: four before, five after.
--
-- D) THE FINGERPRINT MOVED, TO THE EXPECTED VALUE. Unlike 0123, a change here is
--    CORRECT — but only this one:
--      select count(*) as keys,
--             md5(string_agg(metric_key, ',' order by metric_key)) as key_fingerprint
--        from public.report_metrics;
--      -- expect 30 and c4e9e453bafe97f19512423eca188f1a
--      -- (was 29 / b3bbb25d7b3d5e59e18dcf83a79b4f51). Any OTHER value means more
--      -- than one key moved — stop and diff the key list before going further.
--
-- E) THE POINTER'S CLAIM STILL HOLDS. Expect 3 rows, 0 mismatched:
--      select count(*) as month_rows,
--             count(*) filter (where m.filling_cost_sar is distinct from p.filling_cost_sar
--                                or m.filling_uncosted_trips is distinct from p.filling_uncosted_trips)
--               as mismatched
--        from public.v_pnl_monthly m
--        join public.v_pnl_by_period p
--          on p.period_type = 'month' and p.period_start = m.month;
--
-- F) THE MONEY IS UNMOVED — this migration writes no measure, and proves it:
--      select to_char(month,'YYYY-MM') as month, filling_cost_sar,
--             costed_trips, uncosted_trips
--        from public.v_filling_cost_monthly order by 1;
--      -- expect, unchanged:
--      --   2026-06    210.00    18 costed   10 uncosted
--      --   2026-07  1,285.00   143 costed    3 uncosted
--      --   2026-08  5,185.00   598 costed    0 uncosted
--      -- August grows with ongoing trips; the June and July rows must not move.
--
-- G) IT IS GENUINELY OFFERABLE — the point of the whole exercise. In the browser,
--    signed in:
--      · /reports -> custom report builder — "Water filling cost" now appears in
--        the metric list. Select it with grouping PERIOD and build: the column
--        shows 210.00 / 1,285.00 / 5,185.00 for Jun / Jul / Aug, matching check F.
--      · Select it together with Operating cost — filling is INSIDE operating
--        cost (since 0112), so the filling column must be a component of it, not
--        an addition to it. Both are legitimate columns; they do not sum.
--      · Switch grouping to CUSTOMER or TRUCK — "Water filling cost" must
--        disappear from the selectable list (groupings are period-only). If it
--        stays selectable there, the groupings array is wrong.
--      · / (Dashboard) -> Add Summary — filling must NOT appear. It was
--        deliberately not added to that catalogue; seeing it there means
--        WIDGET_CATALOGUE was touched when it should not have been.
-- ===========================================================================
