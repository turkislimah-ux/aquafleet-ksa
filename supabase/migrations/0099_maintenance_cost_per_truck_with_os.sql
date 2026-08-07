-- 0099_maintenance_cost_per_truck_with_os.sql
--
-- Fixes the review finding on v_maintenance_cost_per_truck_monthly: the view
-- was parts-only and its dictionary caveat claimed outsourced spend is
-- "tracked per job, not per truck". That claim is FALSE and is corrected here.
--
-- ===========================================================================
-- WHAT WAS VERIFIED BEFORE WRITING THIS
-- ===========================================================================
-- The path is real and complete:
--   workshop_payments.outsourced_job_id -> outsourced_jobs.truck_id -> trucks
--   * outsourced_jobs: 6 rows, 6 with truck_id (100%)
--   * workshop_payments: 7 rows, 7 with outsourced_job_id (100%)
-- Every riyal of OS spend is attributable to a truck today:
--   total workshop_payments        19,671.50
--   attributable via job -> truck  19,671.50
--   v_os_cost_monthly total        19,671.50
-- All three agree, so adding the per-truck split loses nothing.
--
-- The omission mattered: OS spend (19,671.50) is roughly 2.8x total parts
-- consumption (7,043.95). A parts-only "maintenance cost per truck" was not a
-- rounding error, it was the smaller half of the number.
--
-- ===========================================================================
-- ONE CORRECTION TO THE REVIEW BRIEF — PLEASE READ BEFORE APPLYING
-- ===========================================================================
-- The brief said to add a total "matching the Consumption page's definition,"
-- on the grounds that "the Consumption page's top-costly-trucks already counts
-- OS payments per truck."
--
-- It does not. Checked directly:
--   * lib/parts-usage.ts byTruck() skips every row where
--     `r.source !== "maintenance"`, and UsageRow.source is only ever
--     'maintenance' or 'exit_permit' — there is no OS source in that type.
--   * PartsUsageTab.tsx contains no reference to workshop_payments or
--     outsourced_jobs at all.
--   * byTruck() also feeds the weekly-summary bullets (top truck, repeat
--     visits), so those are parts-only too.
-- The Consumption page's top-costly-trucks is PARTS ONLY.
--
-- So building a single parts+OS number and calling it "the Consumption page's
-- definition" would have produced the very divergence this fix exists to
-- prevent, just pointing the other way.
--
-- WHAT THIS FILE DOES INSTEAD: exposes BOTH measures as separately named
-- columns from the one view, so neither surface has to re-derive anything and
-- neither name can be mistaken for the other:
--   maintenance_parts_sar   <- parts only. What Consumption shows today.
--   os_payments_sar         <- outsourced vendor spend for that truck.
--   total_maintenance_sar   <- parts + OS. The true cost of maintaining it.
-- The dictionary gets one entry per measure, so "maintenance cost per truck"
-- can never again mean two things silently.
--
-- FOLLOW-UP, NOT DONE HERE: the Consumption page still computes its own
-- parts-only figure in TypeScript. The real end state is that page reading
-- maintenance_parts_sar from this view. That is app code and belongs in a
-- Consumption phase, not in a schema migration — flagging it rather than
-- quietly leaving two derivations alive.
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - ONE view replaced, three dictionary rows upserted. Nothing else.
--  - CREATE OR REPLACE VIEW is used deliberately: it preserves the existing
--    grants from 0098 (authenticated SELECT, anon revoked). The three new
--    columns are APPENDED after the existing five in their original order,
--    which is what CREATE OR REPLACE requires — it cannot reorder or retype
--    existing columns. security_invoker is restated because REPLACE does not
--    inherit reloptions.
--  - Reads only. No table, column, constraint, policy or row is altered.
--  - Trucks with OS spend but no parts (and vice versa) now both appear: the
--    month/truck keys are UNIONed, not inner-joined, so neither side can hide
--    the other. Previously a truck with only OS work was invisible.

begin;

create or replace view public.v_maintenance_cost_per_truck_monthly
with (security_invoker = true) as
  with parts as (
    select p.month,
           p.truck_id,
           sum(p.cost_sar)           as maintenance_parts_sar,
           count(distinct p.part_id) as distinct_parts
      from public.v_parts_consumption p
     where p.source = 'maintenance'
       and p.truck_id is not null
     group by p.month, p.truck_id
  ),
  os as (
    -- Same date rule as v_os_cost_monthly — coalesce(invoice_date, created_at)
    -- so the per-truck split reconciles to the P&L bucket month for month. A
    -- different date rule here would silently move money between periods.
    -- Payment -> job is many-to-one, so this cannot fan out.
    select date_trunc('month', coalesce(wp.invoice_date, wp.created_at::date))::date as month,
           oj.truck_id,
           sum(wp.grand_total_sar) as os_payments_sar,
           count(*)                as os_payment_count
      from public.workshop_payments wp
      join public.outsourced_jobs oj on oj.id = wp.outsourced_job_id
     where oj.truck_id is not null
     group by 1, 2
  ),
  keys as (
    select month, truck_id from parts
    union
    select month, truck_id from os
  )
  select k.month,
         k.truck_id,
         tr.plate,
         coalesce(p.maintenance_parts_sar, 0) as maintenance_parts_sar,
         coalesce(p.distinct_parts, 0)        as distinct_parts,
         coalesce(o.os_payments_sar, 0)       as os_payments_sar,
         coalesce(o.os_payment_count, 0)      as os_payment_count,
         coalesce(p.maintenance_parts_sar, 0)
           + coalesce(o.os_payments_sar, 0)   as total_maintenance_sar
    from keys k
    join public.trucks tr on tr.id = k.truck_id
    left join parts p on p.month = k.month and p.truck_id = k.truck_id
    left join os    o on o.month = k.month and o.truck_id = k.truck_id;

-- ---------------------------------------------------------------------------
-- Dictionary: correct the false caveat, and name all three measures.
-- ---------------------------------------------------------------------------
insert into public.report_metrics (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat) values
  ('maintenance_cost_per_truck',
   'Maintenance cost per truck',
   'What it cost to keep each truck running — parts consumed plus outsourced repair spend.',
   'Parts: v_parts_consumption filtered to maintenance, by truck and month. Outsourced: workshop_payments joined through outsourced_jobs to the truck, by the same month rule as the P&L. total_maintenance_sar is the two added.',
   'SAR', 'one truck in one month', 'v_maintenance_cost_per_truck_monthly', 'accrual',
   'Labour on in-house work orders is not costed anywhere in this schema, so it is in neither figure. Outsourced spend IS attributable per truck (outsourced_jobs carries truck_id, and all payments trace to a truck today); if a job were ever saved without a truck its payments would drop out of this view while remaining in the P&L total.'),

  ('maintenance_parts_per_truck',
   'Parts cost per truck',
   'The FIFO cost of parts consumed by each truck''s work orders. Excludes outsourced repairs.',
   'v_parts_consumption filtered to maintenance, grouped by truck and month.',
   'SAR', 'one truck in one month', 'v_maintenance_cost_per_truck_monthly', 'accrual',
   'This is the narrower of the two truck-cost measures and is what the Consumption page''s top-costly-trucks table shows. Live, it is the SMALLER half: parts total 7,043.95 against 19,671.50 of outsourced spend. Do not present it as the cost of maintaining a truck.'),

  ('os_cost_per_truck',
   'Outsourced repair cost per truck',
   'What outside workshops were paid, attributed to the truck the job was for.',
   'Sum of workshop_payments.grand_total_sar joined via outsourced_job_id to outsourced_jobs.truck_id, bucketed by coalesce(invoice_date, created_at).',
   'SAR', 'one truck in one month', 'v_maintenance_cost_per_truck_monthly', 'accrual',
   'Uses the same month rule as os_cost so the per-truck split reconciles to the P&L bucket exactly — verified at 19,671.50 both ways.')
on conflict (metric_key) do update set
  label = excluded.label, meaning = excluded.meaning, formula = excluded.formula,
  unit = excluded.unit, grain = excluded.grain, source_view = excluded.source_view,
  basis = excluded.basis, caveat = excluded.caveat;

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) security_invoker SURVIVED THE REPLACE. This is the gate — REPLACE does
--    not inherit reloptions, so if the `with (...)` clause were ever dropped
--    this view would silently start bypassing RLS:
--      select coalesce((select option_value from pg_options_to_table(c.reloptions)
--                        where option_name = 'security_invoker'), 'false')
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public'
--         and c.relname = 'v_maintenance_cost_per_truck_monthly';
--    Expect 'true'.
--
-- 2) GRANTS SURVIVED (the reason for REPLACE over DROP+CREATE):
--      select has_table_privilege('authenticated','public.v_maintenance_cost_per_truck_monthly','select'); -- true
--      select has_table_privilege('anon','public.v_maintenance_cost_per_truck_monthly','select');          -- false
--
-- 3) OS RECONCILES TO THE P&L — no truck-level money missing:
--      select (select sum(os_payments_sar) from public.v_maintenance_cost_per_truck_monthly) as per_truck,
--             (select sum(os_cost_sar)     from public.v_os_cost_monthly)                    as pnl;
--    Expect both 19,671.50. If per_truck is lower, some job lost its truck_id.
--
-- 4) PARTS DID NOT CHANGE — this migration must not move the existing number:
--      select sum(maintenance_parts_sar) from public.v_maintenance_cost_per_truck_monthly;
--    Expect 6,803.95 (total parts 7,043.95 minus the 240.00 exit-permit
--    portion, which is not maintenance and never belonged to a truck).
--
-- 5) THE TOTAL FOOTS on every row:
--      select count(*) from public.v_maintenance_cost_per_truck_monthly
--       where total_maintenance_sar <> maintenance_parts_sar + os_payments_sar;
--    Zero rows.
--
-- 6) OS-ONLY TRUCKS NOW APPEAR (they were invisible before):
--      select month, plate, maintenance_parts_sar, os_payments_sar
--        from public.v_maintenance_cost_per_truck_monthly
--       where maintenance_parts_sar = 0 order by 1, 2;
--    Expect exactly 4 such rows out of 15 — e.g. July BBB-1118 at 7,417.50
--    parts-free. Under the old inner-join view those 4 truck-months did not
--    exist at all.
--
-- 7) NO FAN-OUT from the payment->job join:
--      select sum(os_payment_count) from public.v_maintenance_cost_per_truck_monthly;
--    Expect 7 — exactly the row count of workshop_payments.
--
-- 8) DICTIONARY: 21 rows now (19 + the 2 new keys; maintenance_cost_per_truck
--    was updated in place, not inserted):
--      select count(*) from public.report_metrics;                       -- 21
--      select metric_key, caveat from public.report_metrics
--       where metric_key like '%per_truck%' order by 1;
--    The old "tracked per job, not per truck" text must be gone.
--
-- 9) NOTHING WAS WRITTEN. FIFO invariant untouched:
--      select p.id from public.parts p
--       left join public.price_lots pl on pl.part_id = p.id
--       group by p.id, p.qty_on_hand
--      having p.qty_on_hand is distinct from coalesce(sum(pl.qty_remaining), 0);
--    Zero rows.
