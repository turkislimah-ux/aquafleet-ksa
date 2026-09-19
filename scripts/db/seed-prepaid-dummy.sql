-- ============================================================================
-- seed-prepaid-dummy.sql — TEST-DATA SEED, NOT A MIGRATION
-- ============================================================================
-- Run manually in the Supabase SQL Editor AFTER 0203 is applied. Never run
-- through the migration pipeline; never run twice without reading the
-- idempotency note below.
--
-- Purpose: give every current prepaid customer one opening top-up so the new
-- customer_ledger reproduces the money the old system shows.
--
-- WHY legacy + uninvoiced, not legacy alone: the legacy
-- v_customer_prepaid_balance has ALREADY subtracted delivered trips that are
-- not yet on a confirmed invoice. In the new model those same trips live in
-- Uninvoiced and are drawn later at confirm — seeding Balance = legacy would
-- deduct them TWICE (measured on prod: MMM legacy 18,775 with 52,440
-- uninvoiced → Available −33,665). So the opening top-up is
--   round(legacy.balance_sar + uninvoiced.uninvoiced_sar, 2)
-- which makes the new model's Available ≈ the legacy balance:
--   Available = Balance − Uninvoiced = (legacy + uninvoiced) − uninvoiced
--             = legacy.
--
-- Customers where that sum is zero or negative get NO row: a zero-or-negative
-- top-up is impossible under customer_ledger_sign_check, and the absence of
-- rows already means Balance = 0.
--
-- Idempotent: skips any customer that already has a top-up whose note starts
-- with the seed tag below.
-- ============================================================================

do $$
declare
  v_cust record;
  v_seeded integer := 0;
  v_skipped integer := 0;
begin
  for v_cust in
    select c.id,
           c.name,
           round(coalesce(b.balance_sar, 0), 2)    as legacy_sar,
           round(coalesce(u.uninvoiced_sar, 0), 2) as uninvoiced_sar,
           round(coalesce(b.balance_sar, 0) + coalesce(u.uninvoiced_sar, 0), 2) as opening_sar
    from customers c
    left join v_customer_prepaid_balance b on b.customer_id = c.id
    left join v_customer_uninvoiced      u on u.customer_id = c.id
    where c.payment_mode = 'prepaid'
      and c.archived_at is null
    order by c.name
  loop
    -- Already seeded? Skip.
    if exists (
      select 1
      from customer_ledger cl
      where cl.customer_id = v_cust.id
        and cl.entry_type = 'topup'
        and cl.note like 'Opening balance (dummy seed%'
    ) then
      raise notice 'SKIP (already seeded): %', v_cust.name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_cust.opening_sar <= 0 then
      raise notice 'SKIP (legacy % + uninvoiced % = % ≤ 0, no row needed): %',
        v_cust.legacy_sar, v_cust.uninvoiced_sar, v_cust.opening_sar, v_cust.name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform record_topup(
      v_cust.id,
      v_cust.opening_sar,
      'bank_transfer',
      'OPENING-SEED',
      null,
      'seed@aquafleet.internal',
      'Opening balance (dummy seed — legacy v_customer_prepaid_balance + uninvoiced)'
    );

    raise notice 'SEEDED % SAR % (legacy % + uninvoiced %)',
      v_cust.name, v_cust.opening_sar, v_cust.legacy_sar, v_cust.uninvoiced_sar;
    v_seeded := v_seeded + 1;
  end loop;

  raise notice 'Done. Seeded: %, skipped: %', v_seeded, v_skipped;
end $$;

-- Post-check, per prepaid customer:
--   diff      = (legacy + uninvoiced) − ledger Balance  → expect 0 after seed
--   available = new-model Available                     → expect ≈ legacy
select c.name,
       round(coalesce(legacy.balance_sar, 0), 2)  as legacy_balance,
       round(coalesce(u.uninvoiced_sar, 0), 2)    as uninvoiced,
       round(coalesce(legacy.balance_sar, 0)
           + coalesce(u.uninvoiced_sar, 0), 2)    as expected_opening,
       coalesce(ledger.balance_sar, 0)            as ledger_balance,
       round(coalesce(legacy.balance_sar, 0)
           + coalesce(u.uninvoiced_sar, 0), 2)
         - coalesce(ledger.balance_sar, 0)        as diff,
       av.available_sar                           as available
from customers c
left join v_customer_prepaid_balance legacy on legacy.customer_id = c.id
left join v_customer_uninvoiced      u      on u.customer_id      = c.id
left join v_customer_ledger_balance  ledger on ledger.customer_id = c.id
left join v_customer_available       av     on av.customer_id     = c.id
where c.payment_mode = 'prepaid'
  and c.archived_at is null
order by c.name;
