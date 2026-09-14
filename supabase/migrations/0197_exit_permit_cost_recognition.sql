-- ===========================================================================
-- 0197 — EXIT-PERMIT COST RECOGNITION
-- ===========================================================================
-- A part that left the warehouse is a COST only if it is not coming back.
--
-- Until now v_parts_consumption_daily expensed EVERY exit-permit draw the day
-- it left, netting a later return against a later month. That made a
-- RETURNABLE permit — stock lent out and expected back — indistinguishable
-- from stock consumed, and it put 190.00 SAR of borrowed inventory into
-- August 2026's operating cost, where it reduced net profit by the same
-- amount and will reverse in whatever month the parts come home.
--
-- The rule this migration writes, and what carries each clause:
--
--   1. PERMANENT exits are a cost, at exit.
--      `exit_permits_kind_check` is CHECK (kind in ('returnable','permanent'))
--      and `exit_permits_return_date_shape` forces expected_return_on NULL on
--      exactly the permanent ones, so `kind = 'permanent'` is the whole test.
--      Live: EP-26-0003, 2 x OIL-5W30 @ 25.00 = 50.00, to Mahdia Farm. Stays.
--
--   2. RETURNABLE and still out is NOT a cost.
--      Live: EP-26-0004, 1 x SKU-1002 @ 165.00 + 1 x OIL-5W30 @ 25.00 =
--      190.00, out to a water station. THIS IS THE FIGURE THAT MOVES.
--
--   3. RETURNABLE and returned is NOT a cost either, and today already nets to
--      zero through its matching return rows. Excluding the whole permit
--      reaches the same zero WITHOUT the round trip through two months, so
--      there is no double-count and nothing is un-recognised: the pair the old
--      view added and subtracted is simply never added.
--      Live: EP-26-0002 and EP-26-0006, both net 0.00 before and after.
--
--   4. RETURNABLE and WRITTEN OFF has no representation in this schema.
--      `exit_permits_status_check` is CHECK (status in
--      ('draft','exited','voided')) — there is no 'closed', no 'written_off',
--      and exit_permit_lines has no write-off column. So a permit whose parts
--      never come back stays open forever and, after this migration, is never
--      expensed at all. THAT IS A KNOWN, DELIBERATE GAP, not an oversight: the
--      alternative available today is to expense on `expected_return_on <
--      current_date`, which would make net profit a function of the clock and
--      flip back the day the parts arrive. One permit is already in this state
--      (EP-26-0004, expected 2026-08-04, still out). Closing the gap needs a
--      status, which is a schema change and a UI, not a view predicate.
--
--   5. VOIDED permits are excluded outright.
--      The old view had NO status filter, so a void was only harmless when it
--      happened to post matching return rows. It does not always: EP-26-0001
--      is voided with exit_permit_lines.qty_returned = 1 of 3 — its counters
--      say 40,000.00 SAR is still out — while its ledger nets to zero. Those
--      two disagree, and under the old predicate a void that posted no returns
--      would have sat in the P&L permanently. `status = 'exited'` makes the
--      question moot instead of relying on the void path to clean up after
--      itself. Draft permits fall out the same way; stock has not left.
--
-- Net predicate: an exit-permit draw reaches the P&L only when
--     ep.status = 'exited' and ep.kind = 'permanent'.
--
-- WHY THE BASE VIEW AND NOT v_parts_cost_monthly. 0104 split the day grain out
-- of the month grain precisely so the two could not drift, and its own
-- verification block asserts that the daily view sums to the monthly one for
-- every month. Filtering only the monthly view would break that assertion and
-- leave the dashboard's daily chart disagreeing with the P&L it sits next to.
-- One predicate, in the definition, and every reader inherits it.
--
-- MAINTENANCE IS UNTOUCHED by rule and by construction: the maintenance branch
-- of this view does not read exit_permits at all, and
-- v_maintenance_cost_per_truck_monthly filters to source = 'maintenance'. The
-- per-truck table was never wrong and does not move.
--
-- Column lists and order are unchanged on both views, so neither replacement
-- can hit 42P16.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) v_parts_consumption_daily — the definition, with the recognition rule.
-- ---------------------------------------------------------------------------
-- Identical to 0104 in both maintenance branches, down to the group-by. The
-- ONLY change is in the exit-permit branch: a join to exit_permits and the
-- two-clause predicate above.
create or replace view public.v_parts_consumption_daily as
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
  --
  -- PERMANENT, EXITED ONLY (0197). A returnable permit is a loan, not a cost,
  -- and a voided one is not an event. Both are excluded here rather than left
  -- to net themselves out downstream. See the rule at the head of this file.
  select 'exit_permit', c.created_at::date,
         null::uuid, l.part_id,
         sum(case when c.direction = 'consume' then c.qty else -c.qty end),
         sum(case when c.direction = 'consume'
                  then c.qty * c.unit_price_sar
                  else -c.qty * c.unit_price_sar end),
         'ledger'
    from public.exit_permit_line_consumptions c
    join public.exit_permit_lines l on l.id = c.exit_permit_line_id
    join public.exit_permits     ep on ep.id = l.exit_permit_id
   where ep.status = 'exited'
     and ep.kind   = 'permanent'
   group by 2, 4;

alter view public.v_parts_consumption_daily set (security_invoker = true);
revoke all on public.v_parts_consumption_daily from anon;
grant select on public.v_parts_consumption_daily to authenticated;

comment on view public.v_parts_consumption_daily is
  'Parts consumed (FIFO cost), one row per source/day/truck/part. BASE definition since 0104; v_parts_consumption rolls it up to the month rather than restating the maths. As of 0197 an exit-permit draw counts as consumption only when the permit is status=exited AND kind=permanent: a RETURNABLE permit is stock on loan and not a cost while it is out, and a VOIDED permit is not an event at all (the old view had no status filter and depended on the void path posting matching return rows, which EP-26-0001 shows it does not always do). A returnable permit whose parts never come back is therefore never expensed — the schema has no written-off status, and expensing on expected_return_on would make profit a function of the clock. Maintenance branches are unchanged.';

-- ---------------------------------------------------------------------------
-- 2) v_maintenance_cost_per_truck_monthly — drop a dead predicate.
-- ---------------------------------------------------------------------------
-- `and p.truck_id is not null` could never exclude a row. work_orders.truck_id
-- is NOT NULL, so every source='maintenance' row carries a truck; the only
-- rows with a null truck_id are the exit-permit ones, which hardcode
-- null::uuid and are already excluded by source='maintenance'. The predicate
-- read as though truck-less maintenance existed and was being filtered out,
-- which is what sent an earlier investigation of the parts divergence looking
-- for work orders that cannot exist. Removing it changes no row; the NOT NULL
-- constraint is recorded in the comment so the reasoning outlives the diff.
--
-- Everything else — both CTEs, the FULL JOIN, the ex-VAT os sum from 0167 — is
-- restated verbatim.
create or replace view public.v_maintenance_cost_per_truck_monthly as
  with parts as (
    select
      p.month,
      p.truck_id,
      sum(p.cost_sar)             as maintenance_parts_sar,
      count(distinct p.part_id)   as distinct_parts
    from v_parts_consumption p
    where p.source = 'maintenance'::text
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
  'Maintenance cost per truck per month: consumed parts plus outsourced workshop payments. Both halves are EX-VAT (0167) — parts always were, and os_payments_sar is sum(subtotal_sar - discount_sar) so this agrees with the P&L''s v_os_cost_monthly instead of exceeding it by the VAT. FULL JOIN, because a truck can have parts with no outsourced work in a month or the reverse. This view does NOT move under 0197: it reads source=''maintenance'' only, and exit permits are the only thing 0197 changes. Its old `and p.truck_id is not null` was dropped in 0197 as dead — work_orders.truck_id is NOT NULL, so a maintenance row without a truck cannot exist.';

commit;

-- ===========================================================================
-- VERIFICATION — run after applying. Each block states what it must return.
-- ===========================================================================
--
-- 1) THE MONTH THAT MOVES, and only it. Expect exactly one changed row:
--    2026-08-01 parts 3779.0000 -> 3589.0000. June, July, September unchanged
--    at 0, 4873.9500, 0.
--
--      select month, parts_cost_sar, maintenance_parts_sar, exit_permit_parts_sar, qty
--        from public.v_parts_cost_monthly order by month;
--
--    Expected after: Aug parts_cost_sar 3589.0000, exit_permit_parts_sar
--    50.0000, qty 22.00 (was 24.00 — the two borrowed units leave with the
--    190.00). maintenance_parts_sar 3539.0000, unchanged.
--
-- 2) THE P&L. Expect one month, one quarter and one year to move by 190.00:
--
--      select month, parts_cost_sar, operating_cost_sar, net_profit_sar,
--             operating_margin_pct
--        from public.v_pnl_monthly order by month;
--
--    Aug 2026:  parts 3589.0000 · op cost 61558.9300 · net -10858.9300 · -21.4
--    Q3 2026:   parts 8462.9500 · op cost 151377.7900 · net -22737.7900 · -6.9
--    Year 2026: parts 8462.9500 · op cost 177075.7900 · net -48435.7900 · -25.0
--
-- 3) THE DAY GRAIN STILL SUMS TO THE MONTH — 0104's invariant, re-proven
--    because this migration edits the view that invariant is about. Expect
--    ZERO rows:
--
--      select d.month, d.parts, m.parts_cost_sar
--        from (select date_trunc('month', day)::date as month, sum(cost_sar) as parts
--                from public.v_parts_consumption_daily group by 1) d
--        join public.v_parts_cost_monthly m on m.month = d.month
--       where d.parts is distinct from m.parts_cost_sar;
--
--    Only 2026-08-05 changes at the day grain: 240.0000 -> 50.0000.
--
-- 4) NOTHING BUT PERMANENT EXITED PERMITS REACHES THE LEDGER. Expect ZERO rows:
--
--      select ep.ep_number, ep.status, ep.kind
--        from public.exit_permit_line_consumptions c
--        join public.exit_permit_lines l on l.id = c.exit_permit_line_id
--        join public.exit_permits ep on ep.id = l.exit_permit_id
--       where (ep.status, ep.kind) is distinct from ('exited','permanent')
--         and exists (select 1 from public.v_parts_consumption_daily v
--                      where v.source = 'exit_permit'
--                        and v.part_id = l.part_id
--                        and v.day = c.created_at::date);
--
-- 5) THE MAINTENANCE TABLE DID NOT MOVE. Expect 4873.9500 / 3539.0000 / 0,
--    the same figures as before this migration:
--
--      select month, sum(maintenance_parts_sar)
--        from public.v_maintenance_cost_per_truck_monthly group by 1 order by 1;
--
-- 6) SECURITY FOOTER CENSUS — CLAUDE.md §6. All three counts must match at 50
--    (50 views, 50 security_invoker, 0 anon_readable) unless a view was added
--    between this draft and the apply:
--
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--
-- ===========================================================================
-- AFTER APPLYING — app-side follow-ups that are NOT in this file
-- ===========================================================================
-- * scripts/doc-render-statements.ts pins the P&L rows as literals. The Aug
--   2026 row and the Q3 2026 row both move; see the handoff note in the
--   session report. Re-render and re-cut scripts/doc-page-counts.json.
-- * lib/i18n.ts's parts_cost_at_consumption glossary entry says "maintenance
--   draws plus non-maintenance exits". That is now "plus PERMANENT
--   non-maintenance exits", and the caveat should name the returnable gap in
--   rule 4 above.
-- * Stock out on a returnable permit is now neither a cost nor on-hand stock.
--   That is accurate — it is lent inventory — but nothing on any screen
--   reports it. 190.00 SAR is currently in that state.
